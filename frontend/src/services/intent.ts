export interface ServiceIntent {
  profile_id: 'standard' | 'interactive' | 'reliable' | 'bulk' | 'custom';
  name: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  require_reachability: boolean;
  max_loss_percent: number | null;
  max_avg_rtt_ms: number | null;
}
export interface IntentSelection {
  profile_id: ServiceIntent['profile_id'];
  custom?: ServiceIntent;
}
export interface IntentEvaluation {
  evaluation_id: string;
  verification_id: string;
  verification_status: string;
  runtime_id: string;
  runtime_revision: number;
  topology_id: string;
  controller_mode: string | null;
  controller_generation: string | null;
  experiment_id: string | null;
  job_id: string | null;
  traffic_sequence?: number | null;
  source_host: string | null;
  destination_host: string | null;
  failed_link: string[];
  failure_timestamp: number;
  intent_snapshot: ServiceIntent | null;
  evaluation_status: 'NOT_EVALUATED' | 'EVALUATING' | 'SATISFIED' | 'VIOLATED' | 'UNAVAILABLE';
  requirements: Record<string, {target: number | boolean; actual: number | boolean | null; unit: string; status: 'PASS' | 'FAIL' | 'UNAVAILABLE'}>;
  reason_code: string;
  reason: string;
  created_at: number;
  completed_at: number | null;
  measurement_source: string;
  evidence: Record<string, unknown>;
  persistence_error?: string | null;
}

export function customIntentError(intent: ServiceIntent): string | null {
  if (!intent.name.trim() || intent.name.length > 80) return 'Enter an intent name (1–80 characters).';
  if (!['LOW','NORMAL','HIGH','CRITICAL'].includes(intent.priority)) return 'Choose a known priority.';
  const loss = intent.max_loss_percent, rtt = intent.max_avg_rtt_ms;
  if (loss !== null && (!Number.isFinite(loss) || loss < 0 || loss > 100)) return 'Maximum loss must be between 0 and 100%.';
  if (rtt !== null && (!Number.isFinite(rtt) || rtt <= 0 || rtt > 60000)) return 'Maximum average RTT must be greater than 0 and at most 60000 ms.';
  if (!intent.require_reachability && loss === null && rtt === null) return 'Configure at least one service requirement.';
  return null;
}

export function intentNumber(value: unknown, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(2))}${unit}` : 'N/A';
}

export function isIntentEvaluation(value: unknown): value is IntentEvaluation {
  if (!value || typeof value !== 'object') return false;
  const v = value as IntentEvaluation;
  return typeof v.evaluation_id === 'string' && typeof v.verification_id === 'string' &&
    typeof v.runtime_id === 'string' && Number.isInteger(v.runtime_revision) &&
    typeof v.controller_generation === 'string' && typeof v.topology_id === 'string' &&
    typeof v.reason === 'string' && Number.isFinite(v.failure_timestamp) &&
    ['NOT_EVALUATED','EVALUATING','SATISFIED','VIOLATED','UNAVAILABLE'].includes(v.evaluation_status) &&
    Array.isArray(v.failed_link) && v.failed_link.every(n => typeof n === 'string') &&
    !!v.requirements && typeof v.requirements === 'object' && Object.values(v.requirements).every(r =>
      r && typeof r.unit === 'string' && ['PASS','FAIL','UNAVAILABLE'].includes(r.status) &&
      [r.target, r.actual].every(n => n === null || typeof n === 'boolean' || (typeof n === 'number' && Number.isFinite(n)))) &&
    (v.intent_snapshot === null || (!!v.intent_snapshot && typeof v.intent_snapshot.name === 'string'));
}

export function intentCounts(records: {summary: Record<string, any>}[]) {
  const evaluations = records.map(r => r.summary?.intent_evaluation).filter(isIntentEvaluation);
  const satisfied = evaluations.filter(e => e.evaluation_status === 'SATISFIED').length;
  const violated = evaluations.filter(e => e.evaluation_status === 'VIOLATED').length;
  const unavailable = evaluations.filter(e => e.evaluation_status === 'UNAVAILABLE').length;
  const reasons: Record<string, number> = {};
  for (const e of evaluations) for (const [name, result] of Object.entries(e.requirements))
    if (result.status === 'FAIL') reasons[name] = (reasons[name] || 0) + 1;
  return {total: evaluations.length, satisfied, violated, unavailable,
    satisfiedRate: satisfied + violated ? 100 * satisfied / (satisfied + violated) : null, reasons};
}
