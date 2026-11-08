import { useSDNStore } from '../stores/sdnStore';
import { Panel, Status } from './ui/Primitives';
import { intentNumber, type IntentEvaluation, type ServiceIntent } from '../services/intent';
import { topologyLabel } from '../stores/topologySelectionStore';

const summaries = {
  SATISFIED: 'Your service requirements were met after recovery.',
  VIOLATED: 'Recovered service did not meet the selected requirements.',
  UNAVAILABLE: 'Service requirements could not be evaluated from the available evidence.',
  EVALUATING: 'Evaluating your service requirements after recovery.',
  NOT_EVALUATED: 'No service intent evaluation has been recorded.',
};
const controllerLabels: Record<string, string> = {
  adaptive: 'Adaptive', baseline: 'Baseline', reactive: 'Reactive', fast_failover: 'Fast Failover',
};

export function ServiceIntentCard({evaluation, intent}: {evaluation?: IntentEvaluation | null; intent?: ServiceIntent | null}) {
  const live = useSDNStore(s => s.intentEvaluation);
  const error = useSDNStore(s => s.intentError);
  const value = evaluation === undefined ? live : evaluation;
  const status = value?.evaluation_status || 'NOT_EVALUATED';
  const snapshot = value?.intent_snapshot ?? intent;
  return <Panel className="service-intent-card" title="SERVICE INTENT" aside={<Status tone={status === 'SATISFIED' ? 'good' : status === 'VIOLATED' ? 'bad' : 'neutral'}>{status.replaceAll('_',' ')}</Status>}>
    <div className="panel-body">
      {evaluation === undefined && error && <p role="alert">Intent API error: {error}</p>}
      <p className="intent-profile">{snapshot?.name || 'N/A'}</p>
      <p className="intent-summary">{summaries[status]}</p>
      {value ? <>
        <div className="intent-comparison-scroll" role="region" aria-label="Service requirement comparison" tabIndex={0}>
        <table className="intent-comparison"><caption className="sr-only">Service requirements: target versus measured actual values</caption><thead><tr><th scope="col">Requirement</th><th scope="col">Target</th><th scope="col">Actual</th><th scope="col">Status</th></tr></thead>
          <tbody>{Object.entries(value.requirements).map(([key, row]) => <tr key={key} className={row.status === 'FAIL' ? 'intent-requirement-failed' : undefined}>
            <th scope="row">{({reachability:'Reachability',packet_loss:'Packet Loss',average_rtt:'Post-Recovery Avg RTT'} as Record<string,string>)[key] || key}</th>
            <td>{key === 'reachability' ? 'Required' : `≤ ${intentNumber(row.target, row.unit === '%' ? '%' : ' ms')}`}</td>
            <td>{key === 'reachability' ? row.actual === null ? 'N/A' : row.actual ? 'Restored' : 'Not restored' : intentNumber(row.actual, row.unit === '%' ? '%' : ' ms')}</td>
            <td><Status tone={row.status === 'FAIL' ? 'bad' : row.status === 'PASS' ? 'good' : 'neutral'}>{row.status === 'PASS' ? 'Pass' : row.status === 'FAIL' ? 'Fail' : 'Unavailable'}</Status></td></tr>)}</tbody></table>
        </div>
        <div className="intent-context" aria-label="Service context">
          <span>{value.source_host || 'N/A'} → {value.destination_host || 'N/A'}</span>
          <span>{controllerLabels[value.controller_mode || ''] || value.controller_mode || 'N/A'}</span>
          <span>{topologyLabel(value.topology_id)}</span>
        </div>
        {value.persistence_error && <p role="alert">{value.persistence_error}</p>}
      </> : null}
      <details className="intent-technical-details">
        <summary>Technical details</summary>
        <dl>
          {Object.entries({
            'Verification ID': value?.verification_id,
            'Traffic job ID': value?.job_id,
            'Evaluation ID': value?.evaluation_id,
            Priority: snapshot?.priority,
            'Verification status': value?.verification_status,
            'Reason code': value?.reason_code,
            Reason: value?.reason,
            'Measurement source': value?.measurement_source,
          }).map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail || 'N/A'}</dd></div>)}
        </dl>
        <p>Priority is metadata; it does not enforce QoS. Intent evaluation uses measured post-failure evidence produced by the Recovery Verification Engine.</p>
        <p>Recovery VERIFIED does not necessarily mean Service Intent SATISFIED. This evaluates a bounded service window, not exact outage duration, switching latency or an observed forwarding path.</p>
        {typeof value?.evidence?.evidence_scope === 'string' && <p>{value.evidence.evidence_scope}</p>}
      </details>
    </div>
  </Panel>;
}
