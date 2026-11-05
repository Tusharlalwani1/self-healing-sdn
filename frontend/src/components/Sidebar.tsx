import { Activity, Network, Cpu, Radio, ZapOff, FlaskConical, BarChart3, ScrollText, Settings, ArrowUpRight } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { Brand } from './Brand';
import { dashboardPath } from '../services/navigation';

const groups = [
  { name: 'Operate', items: [['overview', 'NOC Overview', Activity], ['topology', 'Network Topology', Network], ['controllers', 'Controllers', Cpu], ['traffic', 'Traffic Monitor', Radio], ['simulator', 'Failure Simulator', ZapOff]] },
  { name: 'Investigate', items: [['experiment', 'Experiment Lab', FlaskConical], ['analytics', 'Analytics', BarChart3]] },
  { name: 'Workspace', items: [['logs', 'Event Logs', ScrollText], ['settings', 'System & Config', Settings]] },
] as const;
export function Sidebar() {
  const { currentTab, setTab } = useSDNStore();
  return <aside className="sidebar"><a href="/" className="sidebar-brand" aria-label="Self-healing SDN home"><Brand compact/></a><nav aria-label="Control center pages">{groups.map(group => <div className="nav-group" key={group.name}><p>{group.name}</p>{group.items.map(([id, label, Icon]) => <a key={id} href={dashboardPath(id)} aria-current={currentTab === id ? 'page' : undefined} title={label} onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); setTab(id); } }}><Icon size={18} strokeWidth={1.6}/><span>{label}</span></a>)}</div>)}</nav><footer><span className="eyebrow">SDN RESEARCH WORKSPACE</span><p>OpenFlow 1.3<br/>Ryu / Mininet / Open vSwitch</p><a href="/">About the project <ArrowUpRight size={14}/></a></footer></aside>;
}
