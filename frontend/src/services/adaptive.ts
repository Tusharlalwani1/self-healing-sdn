export interface AdaptiveCandidate {
  candidate_id: string;
  path: string[];
  components: Record<string, number | null>;
  reason: string;
}
export interface AdaptiveCycle {
  cycle_id: string; runtime_id: string; runtime_revision: number; topology_id: string;
  controller_generation: string; job_id: string; traffic_sequence: number;
  created_at: number; sequence: number; status: string; outcome: string | null;
  trigger: string; trigger_link: string[] | null; reason: string;
  intent_snapshot: {name: string} | null;
  selected_candidate?: AdaptiveCandidate;
  installed_path: string[] | null; observed_path: null; path_scope: string;
  config: {max_attempts: number};
  candidates: AdaptiveCandidate[];
  attempts: {attempt: number; status: string; candidate: AdaptiveCandidate;
    verification: {verification_status: string} | null;
    intent_evaluation: {evaluation_status: string} | null}[];
}

export function isAdaptive(value: unknown): value is AdaptiveCycle {
  if (!value || typeof value !== 'object') return false;
  const v = value as AdaptiveCycle;
  const path = (p: unknown) => Array.isArray(p) && p.every(n => typeof n === 'string');
  const candidate = (c: AdaptiveCandidate) => c && typeof c === 'object' && typeof c.candidate_id === 'string' &&
    path(c.path) && typeof c.reason === 'string' && c.components && typeof c.components === 'object' &&
    Object.values(c.components).every(n => n === null || (typeof n === 'number' && Number.isFinite(n)));
  return typeof v.cycle_id === 'string' && typeof v.runtime_id === 'string' &&
    Number.isFinite(v.runtime_revision) && Number.isFinite(v.created_at) && Number.isFinite(v.sequence) &&
    typeof v.controller_generation === 'string' && typeof v.job_id === 'string' &&
    Array.isArray(v.attempts) && v.attempts.every(a => a && typeof a.attempt === 'number' && typeof a.status === 'string' && candidate(a.candidate) &&
      (a.verification === null || (a.verification && typeof a.verification.verification_status === 'string')) &&
      (a.intent_evaluation === null || (a.intent_evaluation && typeof a.intent_evaluation.evaluation_status === 'string'))) &&
    Array.isArray(v.candidates) && v.candidates.every(candidate) && typeof v.reason === 'string' &&
    typeof v.path_scope === 'string' && v.observed_path === null && typeof v.trigger === 'string' &&
    (v.trigger_link === null || path(v.trigger_link)) &&
    v.config && Number.isFinite(v.config.max_attempts) &&
    (v.intent_snapshot === null || (v.intent_snapshot && typeof v.intent_snapshot.name === 'string')) &&
    (v.selected_candidate === undefined || candidate(v.selected_candidate)) &&
    ['EVALUATING','APPLYING','VERIFYING','RE_EVALUATING','COMPLETED'].includes(v.status) &&
    (v.outcome === null || ['SATISFIED','BEST_ACHIEVABLE','FAILED','ESCALATED'].includes(v.outcome)) &&
    (v.installed_path === null || path(v.installed_path));
}

export function pathContains(path: string[] | null | undefined, a: string, b: string) {
  return !!path?.some((node,i) => i+1 < path.length && ((node === a && path[i+1] === b) || (node === b && path[i+1] === a)));
}
