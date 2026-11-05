import type { TrafficStats } from '../types';

export const emptyTraffic = (): TrafficStats => ({ active: false, transmitted: 0,
  received: 0, loss_percent: 0, duration_sec: 0, history: [],
  min_rtt: null, avg_rtt: null, max_rtt: null, last_rtt: null });

export function acceptTraffic(current: TrafficStats, incoming: TrafficStats,
  runtimeId: string | null, running: boolean, allowNew: boolean): boolean {
  if (!incoming || (runtimeId && incoming.runtime_id !== runtimeId)) return false;
  if (incoming.active && !running) return false;
  if (runtimeId && incoming.job_id && incoming.traffic_sequence == null) return false;
  if ((incoming.traffic_sequence ?? 0) < (current.traffic_sequence ?? 0)) return false;
  if (incoming.job_id !== current.job_id && !allowNew) return false;
  if (incoming.job_id && incoming.job_id === current.job_id && current.active === false && incoming.active) return false;
  return true;
}
