import { useEffect } from 'react';
import { useIntentConfigurationStore, type IntentWorkflow } from '../stores/intentConfigurationStore';
import { customIntentError, intentNumber, type ServiceIntent } from '../services/intent';

export function ServiceIntentEditor({workflow, disabled = false}: {workflow: IntentWorkflow; disabled?: boolean}) {
  const store = useIntentConfigurationStore();
  const draft = store[workflow];
  useEffect(() => { void store.loadProfiles(); }, [store.loadProfiles]);
  const custom = draft.profile_id === 'custom';
  const intent = custom ? draft.custom : store.profiles.find(p => p.profile_id === draft.profile_id);
  const update = (changes: Partial<ServiceIntent>) => store.update(workflow, {custom:{...draft.custom,...changes}});
  return <fieldset disabled={disabled} className="space-y-3 text-xs">
    <legend>Service intent</legend>
    <p>Changes apply to the next job. Results use the intent captured when that job started.</p>
    <label>Profile <select aria-label="Service intent profile" value={draft.profile_id}
      onChange={e => store.update(workflow, {profile_id:e.target.value as ServiceIntent['profile_id']})}>
      {!store.profiles.length && <option value="standard">Standard (server defaults)</option>}
      {store.profiles.map(p => <option key={p.profile_id} value={p.profile_id}>{p.name}</option>)}
      <option value="custom">Custom</option>
    </select></label>
    <p className="measurement-note">Project demonstration defaults, not universal SLA standards. Priority is metadata; it does not enforce QoS.</p>
    {store.error && <p role="alert">Intent profiles API error: {store.error}</p>}
    {custom ? <>
      <label>Name <input aria-label="Intent name" maxLength={80} value={draft.custom.name} onChange={e => update({name:e.target.value})}/></label>
      <label>Priority <select aria-label="Intent priority" value={draft.custom.priority} onChange={e => update({priority:e.target.value as ServiceIntent['priority']})}>
        {['LOW','NORMAL','HIGH','CRITICAL'].map(p => <option key={p}>{p}</option>)}
      </select></label>
      <label><input type="checkbox" checked={draft.custom.require_reachability} onChange={e => update({require_reachability:e.target.checked})}/> Require reachability</label>
      <label>Maximum packet loss (%) <input aria-label="Intent maximum loss" type="number" min="0" max="100" step="any" value={draft.custom.max_loss_percent ?? ''}
        onChange={e => update({max_loss_percent:e.target.value === '' ? null : Number(e.target.value)})}/></label>
      <label>Maximum average RTT (ms) <input aria-label="Intent maximum RTT" type="number" min="0.001" max="60000" step="any" value={draft.custom.max_avg_rtt_ms ?? ''}
        onChange={e => update({max_avg_rtt_ms:e.target.value === '' ? null : Number(e.target.value)})}/></label>
      <p>Leave a numeric threshold empty to omit that requirement.</p>
      {customIntentError(draft.custom) && <p role="alert">{customIntentError(draft.custom)}</p>}
    </> : intent && <p>Priority: {intent.priority} · Reachability: {intent.require_reachability ? 'Required' : 'Optional'} · Maximum loss: {intentNumber(intent.max_loss_percent, '%')} · Maximum average RTT: {intentNumber(intent.max_avg_rtt_ms, ' ms')}</p>}
  </fieldset>;
}
