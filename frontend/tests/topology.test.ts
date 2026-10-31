import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { emptyTopology, mergeTopology } from '../src/services/topology';
import { useSDNStore } from '../src/stores/sdnStore';

const originalFetch = globalThis.fetch;
const node = { id: 's1', name: 's1', type: 'switch' as const, ports: {} };
const link = {
  id: 's1-s2', src: 's1', dst: 's2', src_intf: 's1-eth2', dst_intf: 's2-eth1',
  status: 'UP' as const, bw: 10, delay: '5ms',
};
const running = () => mergeTopology(emptyTopology(), {
  nodes: [node], links: [link], switches: ['s1', 's2'], hosts: ['h1', 'h2'],
  active_controller: 'reactive', simulation_state: 'RUNNING',
  active_paths: [['s1', 's2', 's4']], backup_paths: [['s1', 's3', 's4']],
});
function ws(message: object) { useSDNStore.getState().handleWebSocketMessage(message); }
function pendingRequests() {
  const replies: ((payload: unknown) => void)[] = [];
  globalThis.fetch = (() => new Promise<Response>((resolve) => {
    replies.push((payload) => resolve(new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
  })) as typeof fetch;
  return replies;
}
beforeEach(() => {
  useSDNStore.setState({ topology: emptyTopology(), simulationState: 'STOPPED', activeController: null });
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('raw worker WS keeps lifecycle, paths, and absent arrays after REST hydration', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify(running()))) as typeof fetch;
  await useSDNStore.getState().fetchTopology();
  ws({ event_type: 'TOPOLOGY_UPDATE', topology: {
    status: 'ok', nodes: [node], links: [{ ...link, status: 'DOWN' }],
  } });
  const s = useSDNStore.getState();
  assert.equal(s.simulationState, 'RUNNING');
  assert.equal(s.topology.simulation_state, 'RUNNING');
  assert.equal(s.topology.links[0].status, 'DOWN');
  assert.deepEqual(s.topology.active_paths, [['s1', 's2', 's4']]);
  assert.deepEqual(s.topology.backup_paths, [['s1', 's3', 's4']]);
  assert.deepEqual(s.topology.switches, ['s1', 's2']);
  assert.equal(s.activeController, 'reactive');
});

test('WS before hydration wins changed fields while late REST fills untouched metadata', async () => {
  const replies = pendingRequests();
  const request = useSDNStore.getState().fetchTopology();
  ws({ event_type: 'INITIAL_STATE', controller: 'reactive', simulation_state: 'RUNNING', active_paths: [] });
  ws({ event_type: 'TOPOLOGY_UPDATE', topology: { nodes: [node], links: [{ ...link, status: 'DOWN' }] } });
  ws({ event_type: 'PATH_ACTIVE', path: ['s1', 's3', 's4'] });
  replies[0]({ ...running(), simulation_state: 'STOPPED', active_controller: null });
  await request;
  const s = useSDNStore.getState();
  assert.equal(s.simulationState, 'RUNNING');
  assert.equal(s.activeController, 'reactive');
  assert.equal(s.topology.links[0].status, 'DOWN');
  assert.deepEqual(s.topology.active_paths, [['s1', 's3', 's4']]);
  assert.deepEqual(s.topology.switches, ['s1', 's2']);
});

test('older overlapping REST requests cannot undo a newer restoration', async () => {
  const replies = pendingRequests();
  const older = useSDNStore.getState().fetchTopology();
  const newer = useSDNStore.getState().fetchTopology();
  replies[1](running());
  await newer;
  replies[0]({ ...running(), links: [{ ...link, status: 'DOWN' }] });
  await older;
  assert.equal(useSDNStore.getState().topology.links[0].status, 'UP');
});

test('empty topology and explicit empty paths clear arrays without guessing STOPPED', () => {
  useSDNStore.setState({ topology: running(), simulationState: 'RUNNING', activeController: 'reactive' });
  ws({ event_type: 'TOPOLOGY_UPDATE', topology: { status: 'not_running', nodes: [], links: [], active_paths: [] } });
  assert.equal(useSDNStore.getState().simulationState, 'RUNNING');
  assert.deepEqual(useSDNStore.getState().topology.nodes, []);
  assert.deepEqual(useSDNStore.getState().topology.active_paths, []);
  const result = mergeTopology(emptyTopology(), { nodes: null, links: undefined, active_paths: [undefined], backup_paths: null });
  for (const key of ['nodes', 'links', 'switches', 'hosts', 'active_paths', 'backup_paths'] as const) {
    assert.deepEqual(result[key], []);
  }
});

test('explicit lifecycle states survive partial topology and late REST snapshots', async () => {
  const replies = pendingRequests();
  for (const state of ['STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'ERROR']) {
    const request = useSDNStore.getState().fetchTopology();
    ws({ event_type: 'SIMULATION_STATUS', state }); // also starts a fresh GET
    ws({ event_type: 'TOPOLOGY_UPDATE', topology: { nodes: [], links: [] } });
    replies[replies.length - 2](running());
    replies[replies.length - 1]({ nodes: [], links: [] });
    await request;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(useSDNStore.getState().simulationState, state);
    assert.equal(useSDNStore.getState().topology.simulation_state, state);
  }
});

test('reconnect snapshot hydrates paths and accepts explicit null controller', () => {
  ws({ event_type: 'TOPOLOGY_UPDATE', topology: { nodes: [node] } });
  ws({ event_type: 'INITIAL_STATE', controller: 'baseline', simulation_state: 'RUNNING', active_paths: [['s1', 's2', 's4']] });
  ws({ event_type: 'INITIAL_STATE', controller: 'fast_failover', simulation_state: 'RUNNING', active_paths: [] });
  assert.equal(useSDNStore.getState().activeController, 'fast_failover');
  assert.deepEqual(useSDNStore.getState().topology.nodes, [node]);
  assert.deepEqual(useSDNStore.getState().topology.active_paths, []);
  ws({ event_type: 'INITIAL_STATE', controller: null, simulation_state: 'STOPPED' });
  assert.equal(useSDNStore.getState().activeController, null);
  assert.equal(useSDNStore.getState().topology.active_controller, null);
});

test('late controller-list hydration cannot undo a controller WS change', async () => {
  const replies = pendingRequests();
  const request = useSDNStore.getState().fetchControllers();
  ws({ event_type: 'CONTROLLER_STATUS', controller: 'fast_failover' });
  replies[0]([]);
  await request;
  assert.equal(useSDNStore.getState().activeController, 'fast_failover');
  replies[1]([{ id: 'fast_failover', is_active: true }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(useSDNStore.getState().topology.active_controller, 'fast_failover');
});

test('healing followed by restoration does not lose the new path', async () => {
  globalThis.fetch = (async () => new Response('[]')) as typeof fetch;
  useSDNStore.setState({ topology: running(), simulationState: 'RUNNING', activeController: 'reactive' });
  ws({ event_type: 'HEALED', new_path: ['s1', 's3', 's4'] });
  ws({ event_type: 'TOPOLOGY_UPDATE', topology: { links: [link] } });
  assert.deepEqual(useSDNStore.getState().topology.active_paths, [['s1', 's3', 's4']]);
  assert.equal(useSDNStore.getState().topology.links[0].status, 'UP');
});
