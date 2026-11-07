import React from 'react';
import assert from 'node:assert/strict';
import { beforeEach, afterEach, test, mock } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSDNStore } from '../src/stores/sdnStore';
import { AnalyticsView } from '../src/pages/AnalyticsView';
import { TrafficView } from '../src/pages/TrafficView';
import { ExperimentLabView } from '../src/pages/ExperimentLabView';
import { controllerComparison, controllerTimingEvents, formatMetric, ovsEntryCount, topologyCounts } from '../src/services/metrics';
import { emptyTopology } from '../src/services/topology';
import { emptyTraffic } from '../src/services/telemetry';
import type { ExperimentRecord, TopologyLink } from '../src/types';

const record = (extra: Partial<ExperimentRecord> = {}): ExperimentRecord => ({
  id: 'real', controller: 'reactive', status: 'COMPLETED', start_time: '2026-11-02', failure_link: 's1-s2',
  packets_transmitted: 10, packets_received: 9, packet_loss_percent: 10, summary: {}, ...extra,
});
beforeEach(() => {
  useSDNStore.setState({ experimentsHistory: [], experimentRunning: false, experimentProgress: null,
    trafficStats: emptyTraffic(), topology: emptyTopology(), simulationState: 'STOPPED' });
  mock.method(React, 'useSyncExternalStore', (_subscribe: unknown, snapshot: () => unknown) => snapshot());
});
afterEach(() => mock.restoreAll());

test('empty history produces no fabricated comparisons or charts', () => {
  assert.deepEqual(controllerComparison([]), []);
  const html = renderToStaticMarkup(<AnalyticsView />);
  assert.match(html, /No completed experiment data available/);
  assert.doesNotMatch(html, /83\.3|15\.2|3\.4|Sub-ms|20\.4|10.*20 ms Recovery/);
});

test('only completed persisted records contribute; failed/cancelled do not become samples', () => {
  const rows = controllerComparison([record({ recovery_duration_ms: 5 }),
    record({ status: 'CANCELLED', packet_loss_percent: 100, recovery_duration_ms: 999 }),
    record({ status: 'FAILED', packet_loss_percent: 100, recovery_duration_ms: 999 })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].completedCount, 1);
  assert.equal(rows[0].packetLoss, 10);
  assert.equal(rows[0].processingMs, 5);
});

test('null is excluded from denominator, and measurement counts are exact', () => {
  const row = controllerComparison([record({ recovery_duration_ms: 5, avg_rtt_ms: null }),
    record({ recovery_duration_ms: null, avg_rtt_ms: 20 })])[0];
  assert.equal(row.processingMs, 5);
  assert.equal(row.processingSamples, 1);
  assert.equal(row.avgRttMs, 20);
  assert.equal(row.rttSamples, 1);
  assert.equal(row.lossSamples, 2);
});

test('controller groups preserve association and baseline has no processing recovery sample', () => {
  const rows = controllerComparison([record({ controller: 'fast_failover', recovery_duration_ms: 6.8 }),
    record({ controller: 'baseline', recovery_duration_ms: 0 }), record({ recovery_duration_ms: 2.7 })]);
  assert.equal(rows.find(row => row.controller === 'fast_failover')?.processingMs, 6.8);
  assert.equal(rows.find(row => row.controller === 'reactive')?.processingMs, 2.7);
  assert.equal(rows.find(row => row.controller === 'baseline')?.processingMs, null);
});

test('zero is retained; null, undefined and nonfinite numbers render N/A', () => {
  assert.equal(formatMetric(0, ' ms', 1), '0.0 ms');
  assert.equal(formatMetric(0, '%'), '0%');
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(formatMetric(value), 'N/A');
});

test('no transmissions has unavailable loss; no replies has unavailable RTT', () => {
  const row = controllerComparison([record({ packets_transmitted: 0, packets_received: 0,
    packet_loss_percent: 0, avg_rtt_ms: 0 })])[0];
  assert.equal(row.packetLoss, null);
  assert.equal(row.avgRttMs, null);
  assert.equal(row.lossSamples, 0);
});

test('topology counts use reported arrays and exact link states without 4/2 fallbacks', () => {
  assert.deepEqual(topologyCounts(emptyTopology()), { switches: 0, hosts: 0, up: 0, down: 0 });
  const topology = { ...emptyTopology(), switches: ['s1', 's2'], hosts: ['h1'],
    links: [{ status: 'UP' }, { status: 'DOWN' }] as TopologyLink[] };
  assert.deepEqual(topologyCounts(topology), { switches: 2, hosts: 1, up: 1, down: 1 });
});

test('processing history excludes unrelated success events and retains actual zero duration', () => {
  const events = controllerTimingEvents([
    { timestamp: 1, level: 'SUCCESS', source: 'CONTROLLER', message: 'startup' },
    { timestamp: 2, level: 'SUCCESS', source: 'CONTROLLER', message: 'processed', details: { type: 'HEALED', duration_ms: 0 } },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].details?.duration_ms, 0);
});

test('OVS counts exclude protocol headers; missing is N/A, measured empty is zero', () => {
  assert.equal(ovsEntryCount(undefined, 'flows'), null);
  assert.equal(ovsEntryCount([], 'groups'), 0);
  assert.equal(ovsEntryCount(['OFPST_FLOW reply (OF1.3)', ' cookie=0x0, table=0, actions=CONTROLLER'], 'flows'), 1);
  assert.equal(ovsEntryCount(['OFPST_GROUP_DESC reply', ' group_id=1,type=ff,bucket=watch_port:2'], 'groups'), 1);
});

test('analytics labels processing, shows measured sample count and no unsupported outage claim', () => {
  useSDNStore.setState({ experimentsHistory: [record({ recovery_duration_ms: 2.7 })] });
  const html = renderToStaticMarkup(<AnalyticsView />);
  assert.match(html, /Controller Processing/);
  assert.match(html, /2\.7 ms/);
  assert.match(html, /not network outage/);
  assert.match(html, /Local FF switching time is not measured/);
});

test('traffic 100 percent loss retains actual counters and N/A RTT', () => {
  useSDNStore.setState({ trafficStats: { ...emptyTraffic(), job_id: 'owned', transmitted: 8,
    received: 0, loss_percent: 100, avg_rtt: null, accounting_complete: true } });
  const html = renderToStaticMarkup(<TrafficView />);
  assert.ok(html.includes('Overall Job Avg RTT'));
  assert.match(html, /100%/);
  assert.match(html, /N\/A/);
  assert.match(html, /FINAL \/ IDLE/);
});

test('history renders null as N/A and legitimate zero as zero', () => {
  useSDNStore.setState({ experimentsHistory: [record({ recovery_duration_ms: 0, avg_rtt_ms: 0,
    packet_loss_percent: 0, packets_received: 10 }), record({ id: 'failed', status: 'FAILED',
    packets_transmitted: null, packets_received: null, packet_loss_percent: null, avg_rtt_ms: null })] });
  const html = renderToStaticMarkup(<ExperimentLabView />);
  assert.match(html, /0\.0 ms/);
  assert.match(html, /0\.00 ms/);
  assert.match(html, /N\/A/);
  assert.doesNotMatch(html, /Recovery Time/);
});
