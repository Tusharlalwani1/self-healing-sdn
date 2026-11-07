import { useSDNStore } from '../stores/sdnStore';
import type { RecoveryVerification } from '../types';
import { Panel, Metric, Status } from './ui/Primitives';
import { formatMetric, metric } from '../services/metrics';
import { topologyLabel } from '../stores/topologySelectionStore';

function formatVerificationMetric(value: unknown, unit: string): string {
  const number = metric(value);
  return number === null ? 'N/A' : `${Number(number.toFixed(2))}${unit}`;
}

export function RecoveryVerificationCard({ verification }: { verification?: RecoveryVerification | null }) {
  const live = useSDNStore(s => s.verification);
  const error = useSDNStore(s => s.verificationError);
  const value = verification === undefined ? live : verification;
  const status = value?.verification_status || (verification === undefined ? 'NOT_STARTED' : 'NOT_RECORDED');
  const available = (v: boolean | null | undefined, yes: string, no: string) => v == null ? 'Unavailable' : v ? yes : no;
  return <Panel title="Recovery verification" aside={<Status tone={status === 'VERIFIED' ? 'good' : status === 'DEGRADED' ? 'warning' : status === 'FAILED' ? 'bad' : 'neutral'}>{status.replaceAll('_', ' ')}</Status>}>
    <div className="panel-body">
      {verification === undefined && error && <p role="alert">Verification API error: {error}</p>}
      <p>{value ? `${value.controller_mode || 'Unknown controller'} / ${topologyLabel(value.topology_id)} / ${value.source_host || 'N/A'} → ${value.destination_host || 'N/A'}` : 'No verification incident in this runtime.'}</p>
      {value && <p>Failure: {value.failed_link.join(' ↔ ')} · Job: <code>{value.job_id || 'N/A'}</code></p>}
      {value && <p className="measurement-note">Latest incident result, not continuous network health. Failure requested: <time dateTime={new Date(value.failure_timestamp * 1000).toISOString()}>{new Date(value.failure_timestamp * 1000).toLocaleString()}</time></p>}
      <dl className="metric-row">
        <Metric label="Reachability" value={available(value?.reachability_restored, 'Restored', 'Not restored')}/>
        <Metric label="Post-failure Tx / Rx" value={`${formatMetric(value?.post_recovery_tx)} / ${formatMetric(value?.post_recovery_rx)}`}/>
        <Metric label="Post-failure packet loss" value={formatVerificationMetric(value?.post_recovery_loss_percent, '%')}/>
        <Metric label="Successful-reply average RTT" value={formatVerificationMetric(value?.post_recovery_avg_rtt_ms, ' ms')}/>
        <Metric label="Stability" value={available(value?.stability_passed, 'Passed', 'Failed')}/>
        <Metric label="Path verification" value={value?.path_verification_status || 'UNAVAILABLE'}/>
        <Metric label="Verification duration" value={formatVerificationMetric(value?.verification_duration_sec, ' s')}/>
      </dl>
      <p>{value?.reason || (verification === undefined ? 'No active end-to-end traffic evidence is available for recovery verification.' : 'Recovery verification was not recorded for this experiment.')}</p>
      {value?.persistence_error && <p role="alert">{value.persistence_error}</p>}
      <p className="measurement-note">{value?.evidence_scope || 'Service verification does not identify a forwarding path or measure local Fast Failover switching time.'}</p>
    </div>
  </Panel>;
}
