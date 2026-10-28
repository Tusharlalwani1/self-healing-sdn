import React, { useEffect, useState } from 'react';
import { X, Network, Layers, RefreshCw, Cpu, Activity } from 'lucide-react';
import { api } from '../../services/api';
import { TopologyNode } from '../../types';

interface SwitchInspectorModalProps {
  node: TopologyNode | null;
  onClose: () => void;
}

export const SwitchInspectorModal: React.FC<SwitchInspectorModalProps> = ({ node, onClose }) => {
  const [details, setDetails] = useState<{
    dpid: number;
    switch: string;
    flows: string[];
    groups: string[];
    ports: string[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'flows' | 'groups' | 'ports'>('flows');
  const [loading, setLoading] = useState(false);

  const fetchDetails = async () => {
    if (!node || node.type !== 'switch') return;
    setLoading(true);
    try {
      const dpid = node.dpid || parseInt(node.name.replace('s', ''));
      const res = await api.getSwitchDetails(dpid);
      setDetails(res);
    } catch (e) {
      console.error('Failed to get switch info', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [node]);

  if (!node || node.type !== 'switch') return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
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
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
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
                ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Flow Table ({details?.flows.length || 0})</span>
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
              activeTab === 'groups'
                ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Group Table (FF) ({details?.groups.length || 0})</span>
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
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              <span>Querying Open vSwitch daemon...</span>
            </div>
          ) : activeTab === 'flows' ? (
            <div className="space-y-2">
              {details?.flows.length ? (
                details.flows.map((flow, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 break-all text-[11px]">
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
                  <div key={i} className="p-3 rounded-lg bg-slate-900 border border-cyan-500/30 text-cyan-300 break-all text-[11px] shadow-sm">
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
                  <div key={i} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
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
    </div>
  );
};
