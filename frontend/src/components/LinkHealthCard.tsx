import { useSDNStore } from '../stores/sdnStore';
import { healthAppearance, healthNumber, linkKey, type LinkHealth } from '../services/linkHealth';
import { Panel, Status } from './ui/Primitives';

export function useCurrentLinkHealth() {
  const state = useSDNStore();
  const value = state.linkHealth;
  return state.simulationState === 'RUNNING' && value?.runtime_id === state.runtimeId &&
    value.runtime_revision === state.runtimeRevision && value.topology_id === state.topology.topology_id &&
    value.controller_generation === state.controllerGeneration ? value : null;
}

export function LinkHealthCard({src, dst}: {src:string;dst:string}) {
  const snapshot = useCurrentLinkHealth();
  const { topology } = useSDNStore();
  const physical = topology.links.find(l => linkKey(l.src,l.dst) === linkKey(src,dst));
  const record: LinkHealth | undefined = snapshot?.links.find(l => l.link_id === linkKey(src,dst));
  const down = physical?.status === 'DOWN';
  const appearance = healthAppearance(down ? 'DOWN' : physical?.status || 'UP', record?.health_status);
  return <Panel title={`${src} ↔ ${dst} / Link quality`} aside={<Status tone={appearance.tone}>{appearance.label}</Status>}>
    <div className="panel-body link-health-card">
      <p>{down ? 'Operational link is DOWN; quality evidence is unavailable.' : record?.reason || 'No current inter-switch quality evidence is available.'}</p>
      <dl className="health-evidence-grid">
        <div><dt>Kernel-read additional delay</dt><dd>{healthNumber(record?.configured_additional_delay_ms,' ms')}</dd></div>
        <div><dt>Kernel-read configured loss</dt><dd>{healthNumber(record?.configured_loss_percent,'%')}</dd></div>
        <div><dt>Measured TC egress loss (worst direction)</dt><dd>{healthNumber(down ? null : record?.observed_loss_percent,'%')}</dd></div>
        <div><dt>Measured per-link RTT</dt><dd>N/A</dd></div>
      </dl>
      {record && <><p className="muted">Detected {new Date(record.detected_at*1000).toLocaleTimeString()} · {healthNumber(down ? null : record.sample_count)} egress attempts / {healthNumber(down ? null : record.observation_window_sec,' s')}</p>
        <details><summary>Technical details</summary><dl className="health-technical">
          <dt>Runtime / revision</dt><dd>{record.runtime_id} / {record.runtime_revision}</dd>
          <dt>Topology</dt><dd>{record.topology_id}</dd><dt>Controller generation</dt><dd>{record.controller_generation || 'N/A'}</dd>
          <dt>Reason</dt><dd>{down ? 'LINK_DOWN' : record.reason_code}</dd><dt>Source</dt><dd>{record.measurement_source}</dd>
          <dt>Scope</dt><dd>{record.evidence_scope}</dd>
        </dl></details></>}
    </div>
  </Panel>;
}

export function NetworkHealthSummary() {
  const snapshot = useCurrentLinkHealth();
  const { topology, simulationState, linkHealthError } = useSDNStore();
  const switches = new Set(topology.nodes.filter(n => n.type === 'switch').map(n=>n.name));
  const links = simulationState === 'RUNNING' ? topology.links.filter(l => switches.has(l.src) && switches.has(l.dst)) : [];
  const counts = {HEALTHY:0,DEGRADED:0,CRITICAL:0,UNKNOWN:0,DOWN:0};
  for (const link of links) {
    const health = snapshot?.links.find(l => l.link_id === linkKey(link.src,link.dst));
    counts[link.status === 'DOWN' ? 'DOWN' : health?.health_status || 'UNKNOWN']++;
  }
  return <Panel title="Network health / inter-switch links"><div className="panel-body">
    <dl className="health-counts">{Object.entries(counts).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    <p className="muted">Bounded TC egress evidence. UNKNOWN includes idle or unmeasured links; host links excluded.</p>
    {linkHealthError && <p role="alert">{linkHealthError}</p>}
  </div></Panel>;
}
