import type { RecoveryVerification } from '../types';

// Validate message shape only. Quality classification belongs to the backend.
export function isVerification(value: unknown): value is RecoveryVerification {
  if (!value || typeof value !== 'object') return false;
  const v = value as RecoveryVerification;
  return typeof v.verification_id === 'string' && typeof v.runtime_id === 'string' &&
    typeof v.controller_generation === 'string' && typeof v.topology_id === 'string' &&
    typeof v.reason === 'string' && Number.isFinite(v.failure_timestamp) &&
    Array.isArray(v.failed_link) && v.failed_link.every(n => typeof n === 'string') &&
    ['NOT_STARTED','VERIFYING','VERIFIED','DEGRADED','FAILED'].includes(v.verification_status) &&
    v.path_verification_status === 'UNAVAILABLE' &&
    [v.reachability_restored, v.stability_passed].every(n => n === null || typeof n === 'boolean') &&
    [v.post_recovery_tx,v.post_recovery_rx,v.post_recovery_loss_percent,
      v.post_recovery_avg_rtt_ms,v.verification_duration_sec].every(n => n === null || (typeof n === 'number' && Number.isFinite(n)));
}
