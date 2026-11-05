import { InspectorDrawer } from '../ui/InspectorDrawer';
import React, { useEffect, useRef, useState } from 'react';
import { formatMetric, ovsEntryCount } from '../../services/metrics';
import { X, Network, Layers, RefreshCw, Cpu, Activity } from 'lucide-react';
import { api } from '../../services/api';
import { TopologyNode } from '../../types';

interface SwitchInspectorModalProps {
  node: TopologyNode | null;
  onClose: () => void;
}

export const SwitchInspectorModal: React.FC<SwitchInspectorModalProps> = ({ node, onClose }) => {
  const [storedDetails, setDetails] = useState<{
    dpid: number;
    switch: string;
    flows: string[];
    groups: string[];
    ports: string[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'flows' | 'groups' | 'ports'>('flows');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const details = storedDetails?.switch === node?.name ? storedDetails : null;

  const fetchDetails = async () => {
    if (!node || node.type !== 'switch') return;
    const version = ++requestVersion.current;
    setDetails(null);
    setLoading(true);
    setError(null);
    try {
      const dpid = node.dpid || parseInt(node.name.replace('s', ''));
      const res = await api.getSwitchDetails(dpid);
      if (requestVersion.current === version) setDetails(res);
    } catch (e) {
      if (requestVersion.current === version) setError(e instanceof Error ? e.message : String(e));
      console.error('Failed to get switch info', e);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
    return () => { ++requestVersion.current; };
  }, [node]);

  if (!node) return null;
  if (node.type === 'host') return <InspectorDrawer title={`Host ${node.name}`} onClose={onClose}><header className="panel-heading"><h2>Host {node.name}</h2><button className="button button-quiet" onClick={onClose} aria-label="Close inspector"><X size={16}/></button></header><dl className="panel-body host-details"><dt>IP address</dt><dd>{node.ip ?? 'N/A'}</dd><dt>MAC address</dt><dd>{node.mac ?? 'N/A'}</dd><dt>Reported interfaces</dt><dd>{Object.keys(node.ports ?? {}).join(', ') || 'N/A'}</dd></dl></InspectorDrawer>;

  return (
    <InspectorDrawer title="Datapath inspector" onClose={onClose}>
      <div className="flex flex-col min-h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-md bg-blue-500/20 text-accent flex items-center justify-center border border-blue-500/30">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
                Switch {node.name.toUpperCase()} (DPID: {node.dpid})
              </h2>
              <p className="text-xs text-slate-400 font-mono">OpenFlow 1.3 Datapath Inspector</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchDetails}
              disabled={loading}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Refresh Switch Tables"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-accent' : ''}`} />
            </button>
            <button
              onClick={onClose}
            aria-label="Close inspector"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-6 pt-2">
          <button
            onClick={() => setActiveTab('flows')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'flows'
                ? 'border-blue-500 text-accent bg-blue-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Flow Table ({formatMetric(ovsEntryCount(details?.flows, 'flows'))})</span>
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'groups'
                ? 'border-cyan-500 text-accent bg-cyan-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Group Table ({formatMetric(ovsEntryCount(details?.groups, 'groups'))})</span>
          </button>
          <button
            onClick={() => setActiveTab('ports')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'ports'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Port Counters</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto font-mono text-xs text-slate-300 flex-1 bg-slate-950/40">
          {error ? <div role="alert" className="inspector-error">Unable to inspect this datapath: {error}. Use Refresh Switch Tables to retry.</div> : loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              <span>Querying Open vSwitch daemon...</span>
            </div>
          ) : activeTab === 'flows' ? (
            <div className="space-y-2">
              {details?.flows.length ? (
                details.flows.map((flow, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 break-all text-xs">
                    {flow}
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic py-6 text-center">No active OpenFlow rules installed yet.</div>
              )}
            </div>
          ) : activeTab === 'groups' ? (
            <div className="space-y-2">
              {details?.groups.length ? (
                details.groups.map((group, i) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-900 border border-cyan-500/30 text-accent break-all text-xs ">
                    {group}
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic py-6 text-center">
                  No Fast Failover groups on this switch. (Groups are active when Fast Failover Controller is running).
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {details?.ports.length ? (
                details.ports.map((port, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                    {port}
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic py-6 text-center">No port stats available.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </InspectorDrawer>
  );
};
