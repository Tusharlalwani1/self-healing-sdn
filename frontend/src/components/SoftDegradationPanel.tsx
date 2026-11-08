import { useEffect, useState } from 'react';
import { useSDNStore } from '../stores/sdnStore';
import { linkKey } from '../services/linkHealth';
import { LinkHealthCard, useCurrentLinkHealth } from './LinkHealthCard';
import { Panel } from './ui/Primitives';

export function SoftDegradationPanel() {
  const state = useSDNStore();
  const health = useCurrentLinkHealth();
  const switches = new Set(state.topology.nodes.filter(n=>n.type==='switch').map(n=>n.name));
  const links = state.topology.links.filter(l=>switches.has(l.src)&&switches.has(l.dst));
  const {additionalDelayMs:delay,lossPercent:loss} = state.softDegradationDraft;
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const link = links.find(l=>linkKey(l.src,l.dst)===state.softDegradationLinkKey) || links[0];
  const selectedKey = link ? linkKey(link.src,link.dst) : null;
  useEffect(() => {
    // Empty inventories can occur during runtime hydration. Preserve the
    // operator's choice until a populated inventory can establish availability.
    if (selectedKey && selectedKey !== state.softDegradationLinkKey)
      state.selectSoftDegradationLink(selectedKey);
  }, [selectedKey, state.softDegradationLinkKey, state.selectSoftDegradationLink]);
  const disabled = busy || state.simulationState !== 'RUNNING' || state.experimentRunning;
  const invalid = delay.trim()==='' || loss.trim()==='' || !Number.isFinite(+delay) || !Number.isFinite(+loss) || +delay<0 || +delay>2000 || +loss<0 || +loss>100 || (+delay===0&&+loss===0);
  async function act(action:'inject'|'clear'|'clear-all') {
    setBusy(true);setError(null);
    try {await state.changeLinkQuality(action,link?.src,link?.dst,+delay,+loss);}
    catch(e) {setError(e instanceof Error ? e.message : 'Link quality operation failed');}
    finally {setBusy(false);}
  }
  return <Panel title="Soft degradation / link remains UP"><div className="panel-body soft-degradation">
    <p className="muted">Apply real additional delay or loss in both directions. Detection only: this does not request rerouting or start Recovery Verification.</p>
    <div className="health-controls">
      <label>Inter-switch link<select value={selectedKey || ''} onChange={e=>state.selectSoftDegradationLink(e.target.value)} disabled={disabled}>
        {!links.length&&<option value="">No runtime links</option>}{links.map(l=><option key={l.id} value={linkKey(l.src,l.dst)}>{l.src} ↔ {l.dst} ({l.status})</option>)}
      </select></label>
      <label>Additional delay (ms)<input type="number" min="0" max="2000" step="0.1" value={delay} onChange={e=>state.updateSoftDegradationDraft({additionalDelayMs:e.target.value})} disabled={disabled}/></label>
      <label>Configured packet loss (%)<input type="number" min="0" max="100" step="0.1" value={loss} onChange={e=>state.updateSoftDegradationDraft({lossPercent:e.target.value})} disabled={disabled}/></label>
    </div>
    <div className="health-actions">
      <button className="button button-primary" disabled={disabled||!link||link.status==='DOWN'||invalid} onClick={()=>void act('inject')}>{busy ? 'Applying…' : 'Inject Degradation'}</button>
      <button className="button button-quiet" disabled={disabled||!link||link.status==='DOWN'} onClick={()=>void act('clear')}>Restore Link Quality</button>
      <button className="button button-quiet" disabled={disabled||!links.length} onClick={()=>void act('clear-all')}>Restore All Degradations</button>
    </div>
    {(error||state.linkHealthError)&&<p role="alert">{error||state.linkHealthError}</p>}
    <p className="muted">Hard link restoration is separate. {health?.config ? `Project demonstration thresholds: additional delay >${health.config.healthy_additional_delay_ms} ms / critical ≥${health.config.critical_additional_delay_ms} ms; loss >${health.config.healthy_loss_percent}% / critical ≥${health.config.critical_loss_percent}% (configurable through API).` : 'Project threshold configuration is unavailable until current health loads.'} Measured loss is the worst adequately sampled TC egress direction, not end-to-end ICMP loss.</p>
    {link&&<LinkHealthCard src={link.src} dst={link.dst}/>}
  </div></Panel>;
}
