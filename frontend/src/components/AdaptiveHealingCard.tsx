import { Check, ArrowRight, Route, ShieldCheck, Activity, Zap } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { Panel, Status } from './ui/Primitives';
import type { RecoveryVerification } from '../types';

type Tone = 'good' | 'warning' | 'bad' | 'neutral';
const tone = (status?: string | null): Tone => status === 'SATISFIED' || status === 'VERIFIED' ? 'good'
  : status === 'FAILED' || status === 'VIOLATED' ? 'bad'
  : status === 'BEST_ACHIEVABLE' || status === 'ESCALATED' || status === 'DEGRADED' ? 'warning' : 'neutral';
const metric = (value: unknown, unit: string) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  ? `${Number(value.toFixed(2))}${unit}` : null;

function RouteChips({path}: {path: string[] | null | undefined}) {
  return path?.length ? <ol className="adaptive-route" aria-label="Installed route nodes">{path.map((node,i) =>
    <li key={`${i}:${node}`}>{i > 0 && <span aria-hidden="true" className="adaptive-route-connector">—</span>}<span className="adaptive-route-node">{node}</span></li>)}</ol> : <span className="muted">Unavailable</span>;
}

export function AdaptiveHealingCard() {
  const value = useSDNStore(s => s.adaptive);
  const error = useSDNStore(s => s.adaptiveError);
  const controller = useSDNStore(s => s.activeController);
  if (controller !== 'adaptive') return null;
  const last = value?.attempts.at(-1);
  // Display existing attempt evidence only; no calculation or fallback to job metrics.
  const verification = last?.verification as Partial<RecoveryVerification> | null | undefined;
  const recovery = verification?.verification_status || (value?.status === 'VERIFYING' ? 'VERIFYING' : null);
  const intent = last?.intent_evaluation?.evaluation_status;
  const profile = value?.intent_snapshot?.name;
  const profileLabel = profile ? (/intent/i.test(profile) ? profile : `${profile} Intent`) : 'Intent unavailable';
  const retry = !!value && ((last?.attempt ?? 0) > 1 || value.status === 'RE_EVALUATING');
  const badge = value?.outcome?.replaceAll('_',' ') || (!value ? 'NOT STARTED' : retry ? 'RE-HEALING' : 'HEALING');
  const selected = value?.selected_candidate || last?.candidate;
  const loss = metric(verification?.post_recovery_loss_percent, '%');
  const rtt = metric(verification?.post_recovery_avg_rtt_ms, ' ms');
  const previous = value?.attempts.at(-2);
  const retryReason = retry && previous?.verification?.verification_status === 'VERIFIED' && previous.intent_evaluation?.evaluation_status === 'VIOLATED';
  const summaryTitle = value?.outcome === 'SATISFIED' ? 'HEALING COMPLETE' : value?.outcome === 'BEST_ACHIEVABLE' ? 'BEST ACHIEVABLE'
    : value?.outcome === 'FAILED' ? 'RECOVERY NOT VERIFIED' : value?.outcome === 'ESCALATED' ? 'OPERATOR REVIEW REQUIRED'
    : retry ? 'RE-HEALING IN PROGRESS' : 'HEALING IN PROGRESS';
  const summary = value?.outcome === 'SATISFIED' ? `Recovery was verified and the ${profile || 'selected'} service intent was satisfied.`
    : value?.outcome === 'BEST_ACHIEVABLE' ? 'Service recovered, but the selected requirements remain unmet. No justified better candidate was available.'
    : value?.outcome === 'FAILED' ? 'Recovery verification did not pass. Review the measured evidence before continuing.'
    : value?.outcome === 'ESCALATED' ? 'Automated healing could not safely continue. Review the decision details.'
    : retryReason ? 'Another recovery candidate was selected because the previous attempt restored connectivity but violated the service intent.'
    : value?.status === 'RE_EVALUATING' ? 'Reviewing fresh evidence for a justified, untried recovery candidate.'
    : 'Selecting a recovery candidate and checking the resulting service against the selected intent.';
  return <Panel className="service-intent-card adaptive-healing-card" title="ADAPTIVE HEALING" aside={<Status tone={tone(value?.outcome)}>{badge}</Status>}>
    <div className="panel-body">
      {error && <p role="alert">Adaptive API error: {error}</p>}
      {!value ? <div className="adaptive-idle"><Route size={20} aria-hidden="true"/><div><strong>Ready for adaptive healing</strong><p>No adaptive cycle in this runtime. Start owned traffic to evaluate available routes.</p></div></div> : <>
        <div className="adaptive-meta"><span>{profileLabel}</span><span>Adaptive Strategy</span><span>{last ? `Attempt ${last.attempt} of ${value.config.max_attempts}` : `Preparing attempt 1 of ${value.config.max_attempts}`}</span></div>
        <ol className="adaptive-workflow" aria-label="Closed-loop healing workflow">
          <li className="adaptive-step"><div className="adaptive-step-label"><Zap size={14} aria-hidden="true"/>TRIGGER</div><strong>{value.trigger === 'HARD_FAILURE' ? 'Hard Failure' : value.trigger === 'SOFT_DEGRADATION' ? 'Soft Degradation' : value.trigger === 'SERVICE_START' ? 'Service Start' : value.trigger.replaceAll('_',' ')}</strong><p className="adaptive-step-route">{value.trigger_link?.join(' ↔ ') || 'Active service'}</p>{value.trigger === 'HARD_FAILURE' && <span className="adaptive-trigger-down">DOWN at trigger</span>}<ArrowRight className="adaptive-step-arrow" size={16} aria-hidden="true"/></li>
          <li className="adaptive-step"><div className="adaptive-step-label"><Route size={14} aria-hidden="true"/>DECISION</div><strong>{selected ? value.trigger === 'SERVICE_START' && !retry ? 'Service path selected' : 'Alternate path selected' : 'Evaluating candidates'}</strong><p className="adaptive-step-route">{selected?.path.slice(1,-1).join(' → ') || 'Awaiting selection'}</p><span className="adaptive-step-note">Computed candidate</span><ArrowRight className="adaptive-step-arrow" size={16} aria-hidden="true"/></li>
          <li className="adaptive-step"><div className="adaptive-step-label"><Activity size={14} aria-hidden="true"/>RECOVERY</div><Status tone={tone(recovery)}>{recovery || 'PENDING'}</Status>{loss && <p>{loss} post-recovery loss</p>}{rtt && <p>{rtt} RTT</p>}{!loss && !rtt && <p className="adaptive-step-note">{recovery === 'VERIFYING' ? 'Observing bounded service evidence' : 'Measurements unavailable'}</p>}<ArrowRight className="adaptive-step-arrow" size={16} aria-hidden="true"/></li>
          <li className="adaptive-step"><div className="adaptive-step-label"><ShieldCheck size={14} aria-hidden="true"/>INTENT</div><Status tone={tone(intent)}>{intent || 'PENDING'}</Status><p>{intent === 'SATISFIED' ? `${profile || 'Selected'} requirements met` : intent === 'VIOLATED' ? 'Selected requirements not met' : intent === 'UNAVAILABLE' ? 'Evidence unavailable' : 'Awaiting evaluation'}</p></li>
        </ol>
        <div className={`adaptive-outcome adaptive-outcome-${tone(value.outcome)}`} role="status">{value.outcome === 'SATISFIED' && <Check size={17} aria-hidden="true"/>}<div><strong>{summaryTitle}</strong><p>{summary}</p></div></div>
        <section className="adaptive-path" aria-label="Recovery path provenance"><h3>RECOVERY PATH</h3><div className="adaptive-path-grid"><div><span className="adaptive-path-label">Installed</span><RouteChips path={value.installed_path}/></div><div className="adaptive-observed"><span className="adaptive-path-label">Observed dataplane path</span><strong>Unavailable</strong><p>Installed rules do not establish an observed dataplane path.</p></div></div></section>
        <details className="intent-technical-details"><summary>Decision and technical details</summary>
          <p>{value.reason}</p><p>{value.path_scope}</p><p>Cycle: {value.cycle_id} · Job: {value.job_id}</p>
          <p>{value.candidates.length} candidates considered. Candidates are computed eligible routes, not observed forwarding evidence.</p>
          <div className="intent-comparison-scroll"><table className="intent-comparison"><thead><tr><th>Candidate (computed)</th><th>Policy components / reason</th></tr></thead><tbody>{value.candidates.map(c => <tr key={c.candidate_id}><td>{c.path.join(' → ')}</td><td>{Object.entries(c.components).map(([key,n]) => <div key={key}>{key.replaceAll('_',' ')}: {n === null ? 'N/A' : Number(n.toFixed(2))}</div>)}<p>{c.reason}</p></td></tr>)}</tbody></table></div>
          <ol>{value.attempts.map(a => <li key={a.attempt}>Attempt {a.attempt}: {a.candidate.path.join(' → ')} — {a.status}; recovery {a.verification?.verification_status || 'N/A'}; intent {a.intent_evaluation?.evaluation_status || 'N/A'}</li>)}</ol>
          <p>Configured impairment risks and TC counters guide this project policy; they are not measured path RTT/loss, outage time or a guarantee of optimal service.</p>
        </details>
      </>}
    </div>
  </Panel>;
}
