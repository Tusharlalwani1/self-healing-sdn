import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { useTrafficConfigurationStore } from '../src/stores/trafficConfigurationStore';
import { useSDNStore } from '../src/stores/sdnStore';
import { emptyTraffic } from '../src/services/telemetry';
import type { TrafficStats } from '../src/types';

const originalFetch = globalThis.fetch;
beforeEach(() => {
  useTrafficConfigurationStore.setState(useTrafficConfigurationStore.getInitialState());
  useSDNStore.setState({ runtimeId: 'config-runtime', runtimeRevision: 1, simulationState: 'RUNNING', trafficStats: emptyTraffic(), error: null });
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('traffic request draft retains the original defaults', () => {
  assert.deepEqual(useTrafficConfigurationStore.getState().configuration, { src: 'h1', dst: 'h2', interval: 0.05, count: 300 });
});

for (const configuration of [
  { src: 'h1', dst: 'h2', interval: 0.05, count: 500 },
  { src: 'h2', dst: 'h1', interval: 0.1, count: 1000 },
  { src: 'h1', dst: 'h2', interval: 0.05, count: 300 },
]) {
  test(`${configuration.count}-packet request and subsequent telemetry preserve the entire user draft`, async () => {
    useTrafficConfigurationStore.getState().setConfiguration(configuration);
    let posted: unknown;
    const job: TrafficStats = { ...emptyTraffic(), runtime_id: 'config-runtime', traffic_sequence: 1, job_id: 'config-job', active: true };
    let response = job;
    globalThis.fetch = (async (_url, options) => {
      if (options?.method === 'POST') posted = JSON.parse(String(options.body));
      return new Response(JSON.stringify(response));
    }) as typeof fetch;
    await useSDNStore.getState().startTraffic({ ...useTrafficConfigurationStore.getState().configuration });
    assert.deepEqual(posted, configuration);
    useSDNStore.getState().handleWebSocketMessage({ event_type: 'TRAFFIC_STARTED', stats: job });
    useSDNStore.getState().handleWebSocketMessage({ event_type: 'TRAFFIC_TICK', stats: { ...job, transmitted: 97, received: 97 } });
    assert.equal(useSDNStore.getState().trafficStats.transmitted, 97);
    assert.deepEqual(useTrafficConfigurationStore.getState().configuration, configuration);
    response = { ...job, active: false, accounting_complete: true, transmitted: configuration.count, received: configuration.count, avg_rtt: 21.9 };
    useSDNStore.getState().handleWebSocketMessage({ event_type: 'TRAFFIC_COMPLETED', stats: response });
    await useSDNStore.getState().fetchTrafficStats();
    useSDNStore.getState().setTab('topology');
    useSDNStore.getState().setTab('traffic');
    assert.equal(useSDNStore.getState().trafficStats.transmitted, configuration.count);
    assert.equal(useSDNStore.getState().trafficStats.active, false);
    assert.deepEqual(useTrafficConfigurationStore.getState().configuration, configuration);
  });
}

test('quick-action jobs and late result telemetry cannot replace next-request edits', async () => {
  const draft = { src: 'h2', dst: 'h1', interval: 0.5, count: 1000 };
  useTrafficConfigurationStore.getState().setConfiguration(draft);
  const job = { ...emptyTraffic(), runtime_id: 'config-runtime', traffic_sequence: 2, job_id: 'quick-job', active: true };
  globalThis.fetch = (async () => new Response(JSON.stringify(job))) as typeof fetch;
  await useSDNStore.getState().startTraffic({ src: 'h1', dst: 'h2', interval: 0.05, count: 200 });
  useTrafficConfigurationStore.getState().setConfiguration({ count: 100 });
  useSDNStore.getState().handleWebSocketMessage({ event_type: 'TRAFFIC_COMPLETED', stats: { ...job, active: false, transmitted: 200, received: 200 } });
  assert.deepEqual(useTrafficConfigurationStore.getState().configuration, { ...draft, count: 100 });
});
