import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { TopologyCanvas } from '../components/topology/TopologyCanvas';
import { SwitchInspectorModal } from '../components/modals/SwitchInspectorModal';
import { LinkInspectorModal } from '../components/modals/LinkInspectorModal';
import { PageHeader, Panel, EmptyState, Status } from '../components/ui/Primitives';
import type { TopologyLink, TopologyNode } from '../types';

export function TopologyView() {
  const { topology, restoreAllLinks, simulationState } = useSDNStore();
  const [node, setNode] = useState<TopologyNode | null>(null);
  const [link, setLink] = useState<TopologyLink | null>(null);
  return <div className="page topology-page"><PageHeader eyebrow="OPERATIONS / TOPOLOGY" title="Network inspector" description="Explore reported nodes, links and forwarding paths. Select an element to inspect its details." actions={<button className="button button-quiet" disabled={simulationState !== 'RUNNING'} onClick={() => restoreAllLinks().catch(console.error)}><RefreshCw size={15}/>Restore All Links</button>}/>
    <div className="topology-workbench"><Panel><TopologyCanvas onSelectNode={setNode} onSelectLink={setLink}/></Panel><div className="topology-inventory"><Panel title={`Reported links / ${topology.links.length}`}><div className="inventory-list">{topology.links.map(l => <div className="inventory-row" key={l.id}><div><code>{l.src} ↔ {l.dst}</code><br/><Status tone={l.status === 'DOWN' ? 'bad' : l.status === 'UP' ? 'good' : 'neutral'}>{l.status}</Status></div><button className="text-link" onClick={() => setLink(l)}>Inspect</button></div>)}{!topology.links.length && <EmptyState title="No links reported">Start a simulation to discover the network.</EmptyState>}</div></Panel><Panel title="Node inventory"><div className="inventory-nodes">{topology.nodes.map(n => <button key={n.name} onClick={() => setNode(n)} aria-label={`Inspect ${n.type} ${n.name}`}>{n.name} <small>/{n.type}</small></button>)}{!topology.nodes.length && <p className="muted">No nodes reported.</p>}</div></Panel><Panel title="Controller-reported paths"><div className="panel-body">{topology.active_paths?.length ? topology.active_paths.map((p,i) => <p className="muted font-mono" key={i}>{p.join(' → ')}</p>) : <p className="muted">Awaiting flow establishment.</p>}<p className="measurement-note">A reported path describes controller state. End-to-end delivery is measured by traffic.</p></div></Panel></div></div>
    <SwitchInspectorModal node={node} onClose={() => setNode(null)}/><LinkInspectorModal link={link} onClose={() => setLink(null)}/>
  </div>;
}
