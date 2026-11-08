import { ServiceIntentCard } from '../components/ServiceIntentCard';
import { NetworkHealthSummary } from '../components/LinkHealthCard';
import { useState } from 'react';
import { RecoveryVerificationCard } from '../components/RecoveryVerificationCard';
import { Play, Square, ZapOff, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { controllerTimingEvents, formatMetric, topologyCounts } from '../services/metrics';
import { TopologyCanvas } from '../components/topology/TopologyCanvas';
import { SwitchInspectorModal } from '../components/modals/SwitchInspectorModal';
import { LinkInspectorModal } from '../components/modals/LinkInspectorModal';
import type { TopologyLink, TopologyNode } from '../types';
import { PageHeader, Panel, Metric, Status, EmptyState } from '../components/ui/Primitives';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function OverviewView() {
  const { activeController, controllerStatus, simulationState, topology, trafficStats, events, restoreAllLinks, startTraffic, stopTraffic, setLinkStatus, setTab } = useSDNStore();
  const [inspectSwitch, setInspectSwitch] = useState<TopologyNode | null>(null);
  const [inspectLink, setInspectLink] = useState<TopologyLink | null>(null);
  const counts = topologyCounts(topology);
  const recoveryEvents = controllerTimingEvents(events);
  const targetLink = topology.links.find(l => [l.src,l.dst].includes('s1') && [l.src,l.dst].includes('s2'));
  const unavailable = simulationState !== 'RUNNING';
  return <div className="page overview-page"><PageHeader eyebrow="OPERATIONS / OVERVIEW" title="Network at a glance" description="Reported network state, traffic measurements, and the controls that matter."/>
    <section className={`network-summary ${counts.down ? 'summary-degraded' : ''}`}><div><span className="eyebrow">NETWORK STATE</span><h2>{simulationState !== 'RUNNING' ? 'Simulation is not running' : controllerStatus === 'FAILED' ? 'Controller needs attention' : counts.down ? `${counts.down} link${counts.down === 1 ? '' : 's'} reported down` : 'No reported link failures'}</h2><p>{counts.switches} switches · {counts.hosts} hosts · {counts.up} links UP · {counts.down} links DOWN</p></div><div><span className="eyebrow">SELECTED STRATEGY</span><strong className="strategy-name">{activeController?.replaceAll('_',' ') || 'No controller selected'}</strong><Status tone={controllerStatus === 'READY' ? 'good' : controllerStatus === 'FAILED' ? 'bad' : 'neutral'}>{controllerStatus}</Status></div></section>
    <div className="overview-network-grid"><Panel title="Network topology" aside={<button className="text-link" onClick={() => setTab('topology')}>Inspect network <ArrowUpRight size={14}/></button>}><div className="overview-canvas"><TopologyCanvas onSelectNode={setInspectSwitch} onSelectLink={setInspectLink}/></div></Panel><div className="overview-side"><Panel title="Quick operations"><div className="panel-body action-stack"><p className="muted">Actions operate on the current Mininet simulation.</p><button className={`button ${trafficStats.active ? 'button-danger' : 'button-primary'}`} disabled={!trafficStats.active && unavailable} onClick={() => (trafficStats.active ? stopTraffic() : startTraffic({src:'h1',dst:'h2',interval:0.05,count:200})).catch(console.error)}>{trafficStats.active ? <Square size={15}/> : <Play size={15}/>} {trafficStats.active ? 'Stop ICMP Traffic (h1 → h2)' : 'Start Traffic (200 pkts @ 50ms)'}</button><button className="button button-danger-outline" disabled={unavailable || !targetLink} onClick={() => setLinkStatus('s1','s2',targetLink?.status === 'DOWN' ? 'up' : 'down').catch(console.error)}><ZapOff size={15}/>{targetLink?.status === 'DOWN' ? 'Restore' : 'Disconnect'} s1 ↔ s2</button><button className="button button-quiet" disabled={unavailable} onClick={() => restoreAllLinks().catch(console.error)}><RefreshCw size={15}/>Restore All Network Links</button></div></Panel><Panel title="Controller processing"><div className="panel-body"><dl><Metric label="Latest loaded event" value={formatMetric(recoveryEvents[0]?.details?.duration_ms,' ms',1)} note={`${recoveryEvents.length} processing events in loaded history`}/></dl><p className="measurement-note">Historical controller processing; not network outage or local Fast Failover switching time.</p></div></Panel></div></div>
    <Panel title="Traffic job" aside={<Status tone={trafficStats.active && !unavailable ? 'good' : 'neutral'}>{trafficStats.active && !unavailable ? 'STREAMING' : 'IDLE / LAST JOB'}</Status>}><div className="traffic-summary"><dl className="metric-row"><Metric label="Tx / Rx" value={`${trafficStats.transmitted} / ${trafficStats.received}`} note="Actual attempts / successful replies"/><Metric label="Packet loss" value={trafficStats.transmitted > 0 ? formatMetric(trafficStats.loss_percent,'%') : 'N/A'} note="Unanswered / transmitted"/><Metric label="Average RTT" value={formatMetric(trafficStats.avg_rtt,' ms',1)} note={`Last: ${formatMetric(trafficStats.last_rtt,' ms')}`}/></dl><div className="overview-rtt">{trafficStats.history?.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={trafficStats.history}><XAxis dataKey="seq" stroke="#77796e" fontSize={11}/><YAxis stroke="#77796e" fontSize={11}/><Tooltip contentStyle={{background:'#fff',borderColor:'#d9d9cf',borderRadius:4}}/><Line type="linear" dataKey="rtt" name="RTT (ms)" stroke="#6b54a0" strokeWidth={2} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer> : <EmptyState title="No RTT samples">Start traffic to measure round-trip latency.</EmptyState>}</div></div></Panel>
    <NetworkHealthSummary/>
    <RecoveryVerificationCard />
      <ServiceIntentCard/>
    <SwitchInspectorModal node={inspectSwitch} onClose={() => setInspectSwitch(null)}/><LinkInspectorModal link={inspectLink} onClose={() => setInspectLink(null)}/>
  </div>;
}
