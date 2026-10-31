import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { api } from '../src/services/api';
import { emptyTopology, mergeTopology } from '../src/services/topology';
import { useSDNStore } from '../src/stores/sdnStore';

const originalFetch = globalThis.fetch;
const link = { id: 's1-s2', src: 's1', dst: 's2', src_intf: 's1-eth2', dst_intf: 's2-eth1', status: 'UP' as const };
const running = () => mergeTopology(emptyTopology(), {
  links: [link], simulation_state: 'RUNNING', active_controller: 'baseline',
  active_paths: [['s1', 's2', 's4']],
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function reject(message = 'Mininet worker unavailable', status = 503) {
  globalThis.fetch = (async () => response({ detail: { message } }, status)) as typeof fetch;
}
beforeEach(() => {
  useSDNStore.setState({ topology: running(), simulationState: 'RUNNING', activeController: 'baseline',
    controllers: [{ id: 'baseline', name: 'Baseline', status: 'READY', is_active: true, description: '', features: [] }],
    error: null, loading: false, experimentRunning: false,
    trafficStats: { active: false, transmitted: 0, received: 0, loss_percent: 0, duration_sec: 0, history: [] },
  });
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('non-2xx rejects with backend message, string detail, and validation reason', async () => {
  for (const detail of [{ message: 'Network is not running' }, 'Network is not running', [{ msg: 'Network is not running' }]]) {
    globalThis.fetch = (async () => response({ detail }, 409)) as typeof fetch;
    await assert.rejects(api.startTraffic({}), /Network is not running/);
  }
});

test('legacy HTTP 200 operation failure and malformed JSON never resolve successfully', async () => {
  for (const body of [{ status: 'error', message: 'OVS failed' }, { success: false, message: 'OVS failed' }, { status: 'FAILED', message: 'OVS failed' }]) {
    globalThis.fetch = (async () => response(body)) as typeof fetch;
    await assert.rejects(api.restoreAllLinks(), /OVS failed/);
  }
  globalThis.fetch = (async () => new Response('bad json')) as typeof fetch;
  await assert.rejects(api.startSimulation(), /Invalid JSON/);
});

test('failed start does not show RUNNING and always clears loading', async () => {
  useSDNStore.setState({ topology: emptyTopology(), simulationState: 'STOPPED' });
  reject();
  await assert.rejects(useSDNStore.getState().startSimulation(), /worker unavailable/);
  const state = useSDNStore.getState();
  assert.equal(state.simulationState, 'ERROR');
  assert.equal(state.loading, false);
  assert.equal(state.error, 'Mininet worker unavailable');
});

test('failed stop and reset reject, preserve current state, and finish loading', async () => {
  reject();
  for (const action of ['stopSimulation', 'resetSimulation'] as const) {
    await assert.rejects(useSDNStore.getState()[action](), /worker unavailable/);
    assert.equal(useSDNStore.getState().simulationState, 'RUNNING');
    assert.equal(useSDNStore.getState().loading, false);
  }
});

test('failed link down or up never fabricates a successful link state', async () => {
  reject('Both endpoints could not be confirmed', 502);
  for (const desired of ['down', 'up'] as const) {
    await assert.rejects(useSDNStore.getState().setLinkStatus('s1', 's2', desired), /endpoints/);
    assert.equal(useSDNStore.getState().topology.links[0].status, 'UP');
  }
});

test('partial restore rejects and refreshes actual partial state', async () => {
  globalThis.fetch = (async (url) => String(url).endsWith('/restore-all')
    ? response({ detail: { message: 'Link restoration failed for 1 of 6 links', results: [{ status: 'error' }] } }, 502)
    : response({ ...running(), links: [{ ...link, status: 'DOWN' }] })) as typeof fetch;
  await assert.rejects(useSDNStore.getState().restoreAllLinks(), /1 of 6/);
  assert.equal(useSDNStore.getState().topology.links[0].status, 'DOWN');
  assert.match(useSDNStore.getState().error || '', /1 of 6/);
});

test('failed traffic start or stop does not claim the requested state', async () => {
  reject();
  await assert.rejects(useSDNStore.getState().startTraffic(), /worker unavailable/);
  assert.equal(useSDNStore.getState().trafficStats.active, false);
  useSDNStore.setState({ trafficStats: { ...useSDNStore.getState().trafficStats, active: true } });
  await assert.rejects(useSDNStore.getState().stopTraffic(), /worker unavailable/);
  assert.equal(useSDNStore.getState().trafficStats.active, true);
});

test('failed controller switch re-fetches backend status without claiming readiness', async () => {
  globalThis.fetch = (async (url) => String(url).endsWith('/select')
    ? response({ detail: { message: 'Dataplane cleanup failed' } }, 502)
    : response([{ id: 'reactive', status: 'FAILED', is_active: true }])) as typeof fetch;
  await assert.rejects(useSDNStore.getState().selectController('reactive'), /cleanup failed/);
  assert.equal(useSDNStore.getState().controllers[0].status, 'FAILED');
  assert.equal(useSDNStore.getState().loading, false);
  assert.equal(useSDNStore.getState().error, 'Dataplane cleanup failed');
});

test('successful simulation, link, and traffic actions still update from confirmed replies', async () => {
  let simulationState: 'RUNNING' | 'STOPPED' = 'RUNNING';
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith('/api/topology')) return response({ ...running(), simulation_state: simulationState });
    if (String(url).endsWith('/api/controllers')) return response([]);
    if (String(url).endsWith('/api/simulation/stop')) simulationState = 'STOPPED';
    return response({ status: 'ok', active: true, job_id: 'test' });
  }) as typeof fetch;
  useSDNStore.setState({ topology: emptyTopology(), simulationState: 'STOPPED' });
  await useSDNStore.getState().startSimulation();
  assert.equal(useSDNStore.getState().simulationState, 'RUNNING');
  await useSDNStore.getState().setLinkStatus('s1', 's2', 'up');
  assert.equal(useSDNStore.getState().topology.links[0].status, 'UP');
  await useSDNStore.getState().startTraffic();
  assert.equal(useSDNStore.getState().trafficStats.active, true);
  await useSDNStore.getState().stopTraffic();
  assert.equal(useSDNStore.getState().trafficStats.active, false);
  await useSDNStore.getState().stopSimulation();
  assert.equal(useSDNStore.getState().simulationState, 'STOPPED');
  assert.equal(useSDNStore.getState().loading, false);
});

test('failed experiment ends pending state and preserves the backend error', async () => {
  reject('Restoration failed', 502);
  await assert.rejects(useSDNStore.getState().runExperiment({ controller: 'reactive' }), /Restoration failed/);
  assert.equal(useSDNStore.getState().experimentRunning, false);
  assert.equal(useSDNStore.getState().experimentProgress, null);
  assert.equal(useSDNStore.getState().error, 'Restoration failed');
});
