import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { useSDNStore } from '../src/stores/sdnStore';
import { emptyTraffic } from '../src/services/telemetry';
import { emptyTopology, mergeTopology } from '../src/services/topology';
import type { TrafficStats } from '../src/types';

const originalFetch = globalThis.fetch;
const job = (id: string, sequence: number, extra: Partial<TrafficStats> = {}): TrafficStats => ({
  ...emptyTraffic(), job_id: id, runtime_id: 'R1', runtime_revision: 1,
  traffic_sequence: sequence, controller: 'reactive', controller_generation: 'g1', active: true, ...extra,
});
const ws = (event_type: string, stats: TrafficStats) => useSDNStore.getState().handleWebSocketMessage({ event_type, stats });
beforeEach(() => {
  useSDNStore.setState({ runtimeId: 'R1', runtimeRevision: 1, simulationState: 'RUNNING',
    trafficStats: emptyTraffic(), topology: mergeTopology(emptyTopology(), { simulation_state: 'RUNNING' }),
    activeController: 'reactive', experimentRunId: null, experimentRunning: false, error: null });
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('A updates A, B starts fresh, delayed A tick/final/start cannot overwrite B', () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  ws('TRAFFIC_TICK', job('A', 1, { transmitted: 100, received: 80 }));
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 100);
  ws('TRAFFIC_STARTED', job('B', 2));
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 0);
  for (const type of ['TRAFFIC_TICK', 'TRAFFIC_COMPLETED', 'TRAFFIC_STARTED']) {
    ws(type, job('A', 1, { transmitted: 120 }));
    assert.equal(useSDNStore.getState().trafficStats.job_id, 'B');
    assert.equal(useSDNStore.getState().trafficStats.active, true);
  }
});

test('final same-job accounting stays final; later live tick cannot revive it', () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  ws('TRAFFIC_COMPLETED', job('A', 1, { active: false, transmitted: 7, received: 5,
    loss_percent: 28.57, accounting_complete: true }));
  ws('TRAFFIC_TICK', job('A', 1, { transmitted: 6 }));
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 7);
  assert.equal(useSDNStore.getState().trafficStats.active, false);
});

test('late REST A result cannot overwrite newer B', async () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  let reply!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { reply = resolve; })) as typeof fetch;
  const pending = useSDNStore.getState().fetchTrafficStats();
  ws('TRAFFIC_STARTED', job('B', 2));
  reply(new Response(JSON.stringify(job('A', 1))));
  await pending;
  assert.equal(useSDNStore.getState().trafficStats.job_id, 'B');
});

test('STOPPED removes live ownership; old runtime cannot revive after restart', () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'SIMULATION_STATUS', state: 'STOPPED',
    runtime_id: 'R1', runtime_revision: 1 });
  ws('TRAFFIC_TICK', job('A', 1, { transmitted: 50 }));
  assert.equal(useSDNStore.getState().trafficStats.active, false);
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'INITIAL_STATE', simulation_state: 'RUNNING',
    runtime_id: 'R2', runtime_revision: 2 });
  ws('TRAFFIC_TICK', job('A', 99));
  ws('TRAFFIC_COMPLETED', job('A', 99, { active: false }));
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'SIMULATION_STATUS', state: 'STOPPED',
    runtime_id: 'R1', runtime_revision: 1 });
  assert.equal(useSDNStore.getState().runtimeId, 'R2');
  assert.equal(useSDNStore.getState().simulationState, 'RUNNING');
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 0);
  assert.equal(useSDNStore.getState().trafficStats.active, false);
});

test('controller switch does not relabel existing traffic', () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'CONTROLLER_STATUS', controller: 'baseline', status: 'READY' });
  ws('TRAFFIC_TICK', job('A', 1, { controller_changed: true, transmitted: 20 }));
  assert.equal(useSDNStore.getState().activeController, 'baseline');
  assert.equal(useSDNStore.getState().trafficStats.controller, 'reactive');
  assert.equal(useSDNStore.getState().trafficStats.controller_changed, true);
});

test('new start response cannot erase newer WS accounting for that job', async () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  let reply!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { reply = resolve; })) as typeof fetch;
  const pending = useSDNStore.getState().startTraffic();
  ws('TRAFFIC_STARTED', job('B', 2));
  ws('TRAFFIC_TICK', job('B', 2, { transmitted: 18, received: 17 }));
  reply(new Response(JSON.stringify({ status: 'ok', ...job('B', 2) })));
  await pending;
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 18);
});

test('old final stop HTTP response cannot finalize B', async () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  let reply!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { reply = resolve; })) as typeof fetch;
  const pending = useSDNStore.getState().stopTraffic();
  ws('TRAFFIC_STARTED', job('B', 2));
  reply(new Response(JSON.stringify({ status: 'ok', ...job('A', 1, { active: false }) })));
  await pending;
  assert.equal(useSDNStore.getState().trafficStats.job_id, 'B');
  assert.equal(useSDNStore.getState().trafficStats.active, true);
});

test('old experiment finish and progress cannot finalize or contaminate current run', () => {
  useSDNStore.setState({ experimentRunId: 'current', experimentRunning: true });
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'EXPERIMENT_FINISHED', run_id: 'old', experiment: { id: 'old' } });
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'EXPERIMENT_PROGRESS', run_id: 'old', status: 'PREPARING' });
  assert.equal(useSDNStore.getState().experimentRunId, 'current');
  assert.equal(useSDNStore.getState().experimentRunning, true);
});

test('late initial snapshot for A cannot replace B in the same runtime', () => {
  ws('TRAFFIC_STARTED', job('B', 2, { transmitted: 12 }));
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'INITIAL_STATE', runtime_id: 'R1',
    runtime_revision: 1, simulation_state: 'RUNNING', traffic: job('A', 1) });
  assert.equal(useSDNStore.getState().trafficStats.job_id, 'B');
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 12);
});

test('older running lifecycle update cannot undo a confirmed stop revision', () => {
  ws('TRAFFIC_STARTED', job('A', 1));
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'SIMULATION_STATUS', runtime_id: 'R1',
    runtime_revision: 2, state: 'STOPPED' });
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'SIMULATION_STATUS', runtime_id: 'R1',
    runtime_revision: 1, state: 'RUNNING' });
  assert.equal(useSDNStore.getState().simulationState, 'STOPPED');
  assert.equal(useSDNStore.getState().trafficStats.active, false);
});

test('delayed stop-simulation acknowledgement cannot stop a newer runtime', async () => {
  let reply!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { reply = resolve; })) as typeof fetch;
  const pending = useSDNStore.getState().stopSimulation();
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'INITIAL_STATE', runtime_id: 'R2',
    runtime_revision: 2, simulation_state: 'RUNNING' });
  ws('TRAFFIC_STARTED', job('B', 2, { runtime_id: 'R2', runtime_revision: 2 }));
  reply(new Response(JSON.stringify({ status: 'ok', runtime_id: 'R1', runtime_revision: 1 })));
  await pending;
  assert.equal(useSDNStore.getState().simulationState, 'RUNNING');
  assert.equal(useSDNStore.getState().trafficStats.job_id, 'B');
  assert.equal(useSDNStore.getState().trafficStats.active, true);
});

test('reconnect hydrates current experiment, while stale snapshot cannot replace an owned run', () => {
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'INITIAL_STATE', runtime_id: 'R1',
    runtime_revision: 1, simulation_state: 'RUNNING', experiment_run_id: 'current' });
  assert.equal(useSDNStore.getState().experimentRunning, true);
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'INITIAL_STATE', runtime_id: 'R1',
    runtime_revision: 1, simulation_state: 'RUNNING', experiment_run_id: 'old' });
  assert.equal(useSDNStore.getState().experimentRunId, 'current');
});
