import type { EventLogEntry, ExperimentRecord, TopologyResponse } from '../types';

export function metric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function formatMetric(value: unknown, unit = '', digits?: number): string {
  const number = metric(value);
  return number === null ? 'N/A' : `${digits === undefined ? number : number.toFixed(digits)}${unit}`;
}

export function controllerComparison(records: ExperimentRecord[]) {
  return [ ['baseline', 'Baseline'], ['reactive', 'Reactive'], ['fast_failover', 'Fast Failover'], ['adaptive', 'Adaptive'] ].flatMap(([id, name]) => {
    const completed = records.filter(record => record.status === 'COMPLETED' && record.controller === id);
    if (!completed.length) return [];
    const average = (key: keyof ExperimentRecord) => {
      const values = completed.map(record => (key === 'packet_loss_percent' && record.packets_transmitted === 0) ||
        (key === 'avg_rtt_ms' && record.packets_received === 0) ? null : metric(record[key]))
        .filter((value): value is number => value !== null);
      return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length };
    };
    const loss = average('packet_loss_percent');
    const processing = id === 'baseline' ? { value: null, count: 0 } : average('recovery_duration_ms');
    const rtt = average('avg_rtt_ms');
    return [{ name, controller: id, completedCount: completed.length, packetLoss: loss.value,
      processingMs: processing.value, avgRttMs: rtt.value,
      lossSamples: loss.count, processingSamples: processing.count, rttSamples: rtt.count }];
  });
}

export function topologyCounts(topology: TopologyResponse) {
  return { switches: topology.switches.length, hosts: topology.hosts.length,
    up: topology.links.filter(link => link.status === 'UP').length,
    down: topology.links.filter(link => link.status === 'DOWN').length };
}

export function controllerTimingEvents(events: EventLogEntry[]) {
  return events.filter(event => event.source === 'CONTROLLER' && event.level === 'SUCCESS' &&
    ['HEALED', 'ROUTE_RECOMPUTED'].includes(event.details?.type) && metric(event.details?.duration_ms) !== null);
}

export function ovsEntryCount(lines: string[] | undefined, kind: 'flows' | 'groups') {
  return lines ? lines.filter(line => (kind === 'flows' ? /\bcookie=/ : /\bgroup_id=/).test(line)).length : null;
}
