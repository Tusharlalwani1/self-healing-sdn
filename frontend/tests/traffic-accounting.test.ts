import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { useSDNStore } from '../src/stores/sdnStore';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const sample = (transmitted: number, received: number, active = true) => ({
  job_id: 'c06', active, transmitted, received,
  loss_percent: transmitted ? Math.round(10000 * (transmitted - received) / transmitted) / 100 : 0,
  duration_sec: 1, history: [], min_rtt: null, avg_rtt: null, max_rtt: null,
});

test('WebSocket outage and recovery preserve worker cumulative accounting', () => {
  for (const [tx, rx] of [[100, 80], [120, 80], [140, 100]]) {
    const stats = sample(tx, rx);
    useSDNStore.getState().handleWebSocketMessage({ event_type: 'TRAFFIC_TICK', stats });
    assert.deepEqual(useSDNStore.getState().trafficStats, stats);
  }
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 140);
  assert.equal(useSDNStore.getState().trafficStats.received, 100);
});

test('stop adopts final drained counters rather than last live tick', async () => {
  useSDNStore.setState({ trafficStats: sample(100, 80) });
  const final = { ...sample(107, 85, false), accounting_complete: true };
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'ok', ...final }))) as typeof fetch;
  await useSDNStore.getState().stopTraffic();
  assert.equal(useSDNStore.getState().trafficStats.transmitted, 107);
  assert.equal(useSDNStore.getState().trafficStats.received, 85);
  assert.equal(useSDNStore.getState().trafficStats.loss_percent, final.loss_percent);
  assert.equal(useSDNStore.getState().trafficStats.accounting_complete, true);
});

test('confirmed new job resets previous totals and RTT', async () => {
  useSDNStore.setState({ trafficStats: { ...sample(100, 80, false), avg_rtt: 2 } });
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'ok', job_id: 'new', active: true }))) as typeof fetch;
  await useSDNStore.getState().startTraffic();
  const stats = useSDNStore.getState().trafficStats;
  assert.equal(stats.job_id, 'new');
  assert.equal(stats.transmitted, 0);
  assert.equal(stats.received, 0);
  assert.equal(stats.avg_rtt, null);
});
