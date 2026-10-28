import React, { useState } from 'react';
import { Network, ZapOff, RefreshCw, Layers } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { TopologyCanvas } from '../components/topology/TopologyCanvas';
import { SwitchInspectorModal } from '../components/modals/SwitchInspectorModal';
import { LinkInspectorModal } from '../components/modals/LinkInspectorModal';
import { TopologyLink, TopologyNode } from '../types';

export const TopologyView: React.FC = () => {
  const { topology, setLinkStatus, restoreAllLinks } = useSDNStore();
  const [inspectSwitch, setInspectSwitch] = useState<TopologyNode | null>(null);
  const [inspectLink, setInspectLink] = useState<TopologyLink | null>(null);

  const diamondLinks = [
    { src: 's1', dst: 's2', label: 'Primary Path Branch A' },
    { src: 's2', dst: 's4', label: 'Primary Path Branch B' },
    { src: 's1', dst: 's3', label: 'Backup Path Branch A' },
    { src: 's3', dst: 's4', label: 'Backup Path Branch B' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto flex flex-col h-[calc(100vh-4rem)]">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Network className="w-5 h-5 text-blue-400" />
            Interactive Network Topology & Datapath
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time visualization of OpenFlow 1.3 switches, forwarding routes, and failure states
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => restoreAllLinks()}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Restore All Links</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Topology Canvas + Quick Link Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Canvas (3 Cols) */}
        <div className="lg:col-span-3 h-full min-h-[450px]">
          <TopologyCanvas
            onSelectNode={(node) => setInspectSwitch(node)}
            onSelectLink={(link) => setInspectLink(link)}
          />
        </div>

        {/* Link Matrix & Inspector Sidebar (1 Col) */}
        <div className="space-y-4 overflow-y-auto">
          <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <ZapOff className="w-4 h-4 text-amber-400" />
              Core Diamond Links
            </h3>
            <p className="text-[11px] text-slate-400">
              Toggle link status directly in Mininet kernel space:
            </p>

            <div className="space-y-2 pt-1">
              {diamondLinks.map((d) => {
                const link = topology.links.find(
                  (l) => (l.src === d.src && l.dst === d.dst) || (l.src === d.dst && l.dst === d.src)
                );
                const isUp = link ? link.status === 'UP' : true;
                return (
                  <div
                    key={`${d.src}-${d.dst}`}
                    className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-200 uppercase">
                        {d.src} ↔ {d.dst}
                      </div>
                      <div className="text-[10px] text-slate-400">{d.label}</div>
                    </div>
                    <button
                      onClick={() => setLinkStatus(d.src, d.dst, isUp ? 'down' : 'up')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                        isUp
                          ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
                      }`}
                    >
                      {isUp ? 'Disconnect' : 'Restore'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Paths summary */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 space-y-2 text-xs">
            <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              Controller Route Status
            </h4>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="text-slate-400">Active Path:</div>
              <div className="p-2 rounded-lg bg-slate-900 text-cyan-300 border border-cyan-500/20 font-bold">
                {topology.active_paths.length ? topology.active_paths[0].join(' → ') : 'Awaiting flow establishment'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <SwitchInspectorModal node={inspectSwitch} onClose={() => setInspectSwitch(null)} />
      <LinkInspectorModal link={inspectLink} onClose={() => setInspectLink(null)} />
    </div>
  );
};
