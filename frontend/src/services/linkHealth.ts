export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN';
export interface LinkHealth {
  runtime_id: string; runtime_revision: number; topology_id: string; controller_generation: string | null;
  link_id: string; src: string; dst: string; operational_status: 'UP' | 'DOWN'; health_status: HealthStatus;
  configured_additional_delay_ms: number; configured_loss_percent: number; injected: boolean;
  observed_loss_percent: number | null; observed_avg_rtt_ms: number | null;
  sample_count: number | null; observation_window_sec: number | null;
  detected_at: number; sampled_at: number; reason_code: string; reason: string;
  measurement_source: string; evidence_scope: string;
}
export interface HealthSnapshot {
  runtime_id: string; runtime_revision: number; topology_id: string; controller_generation: string | null;
  simulation_state: string; sequence: number; links: LinkHealth[]; threshold_label: string;
  config: {healthy_additional_delay_ms:number;critical_additional_delay_ms:number;healthy_loss_percent:number;critical_loss_percent:number};
}
export function isHealthSnapshot(value: unknown): value is HealthSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as HealthSnapshot;
  return typeof s.runtime_id === 'string' && Number.isInteger(s.runtime_revision) && s.runtime_revision >= 0 &&
    Number.isInteger(s.sequence) && s.sequence >= 0 && typeof s.topology_id === 'string' &&
    (s.controller_generation === null || typeof s.controller_generation === 'string') &&
    !!s.config && typeof s.config === 'object' && Object.values(s.config).every(Number.isFinite) &&
    Array.isArray(s.links) && new Set(s.links.map(l=>l?.link_id)).size === s.links.length &&
    s.links.every(l => !!l && typeof l.link_id === 'string' && typeof l.src === 'string' && typeof l.dst === 'string' &&
      [l.reason,l.reason_code,l.measurement_source,l.evidence_scope].every(v=>typeof v==='string') &&
      ['UP','DOWN'].includes(l.operational_status) && ['HEALTHY','DEGRADED','CRITICAL','UNKNOWN'].includes(l.health_status) &&
      (l.operational_status !== 'DOWN' || l.health_status === 'UNKNOWN') &&
      l.runtime_id === s.runtime_id && l.runtime_revision === s.runtime_revision && l.topology_id === s.topology_id &&
      l.controller_generation === s.controller_generation &&
      [l.configured_additional_delay_ms,l.configured_loss_percent,l.detected_at,l.sampled_at].every(Number.isFinite) &&
      [l.observed_loss_percent,l.observed_avg_rtt_ms].every(v => v === null || Number.isFinite(v)));
}
export const healthNumber = (value: number | null | undefined, unit = '') =>
  value == null || !Number.isFinite(value) ? 'N/A' : `${Number(value.toFixed(2))}${unit}`;
export const linkKey = (src: string, dst: string) => [src,dst].sort().join('-');
export function healthAppearance(operational: string, health: HealthStatus = 'UNKNOWN') {
  if (operational === 'DOWN') return {label:'DOWN',color:'#b64a41',dash:'6 6',tone:'bad' as const};
  if (health === 'CRITICAL') return {label:'UP / CRITICAL',color:'#b64a41',dash:'2 4',tone:'bad' as const};
  if (health === 'DEGRADED') return {label:'UP / DEGRADED',color:'#9d762f',dash:'8 3',tone:'warning' as const};
  if (health === 'HEALTHY') return {label:'UP / HEALTHY',color:'#52714c',dash:undefined,tone:'good' as const};
  return {label:'UP / UNKNOWN',color:'#a8b09e',dash:undefined,tone:'neutral' as const};
}
