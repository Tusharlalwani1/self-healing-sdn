import React, { useEffect } from 'react';
import { Settings, CheckCircle2, XCircle, RefreshCw, Terminal, Wrench, Shield } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { api } from '../services/api';

export const SettingsView: React.FC = () => {
  const { systemStatus, fetchSystemStatus, resetSimulation } = useSDNStore();

  useEffect(() => {
    fetchSystemStatus();
  }, []);

  const handleCleanMininet = async () => {
    if (confirm('Clean all Mininet interfaces and stale Open vSwitch bridges?')) {
      try {
        await resetSimulation();
        await fetchSystemStatus();
        alert('Mininet environment cleaned successfully.');
      } catch (e: any) {
        alert(`Error: ${e.message}`);
      }
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            System Diagnostics & Environment Configuration
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Verify WSL2 environment, Open vSwitch service, Ryu framework, and Mininet kernel capabilities
          </p>
        </div>

        <button
          onClick={() => fetchSystemStatus()}
          className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition"
        >
          <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Re-check Environment</span>
        </button>
      </div>

      {/* Diagnostics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Host OS & WSL</span>
            <Shield className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-lg font-bold text-white font-mono">{systemStatus?.os || 'Linux / WSL2'}</div>
          <p className="text-xs text-slate-400">Windows Subsystem for Linux (WSL2 Ubuntu 22.04 LTS)</p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Python Runtime</span>
            <Terminal className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-lg font-bold text-cyan-400 font-mono">{systemStatus?.python_version || '3.10.12'}</div>
          <p className="text-xs text-slate-400">sdn-env virtualenv (Ryu 4.34 + NetworkX)</p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">OpenFlow 1.3 Port</span>
            <div className={`w-2.5 h-2.5 rounded-full ${systemStatus?.openflow_port_active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          </div>
          <div className="text-lg font-bold text-white font-mono">Port {systemStatus?.controller_port || 6653}</div>
          <p className="text-xs text-slate-400">
            {systemStatus?.openflow_port_active ? 'Active Ryu listener connected' : 'Port available'}
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mininet Emulator</span>
            {systemStatus?.mininet_available ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {systemStatus?.mininet_available ? 'INSTALLED (/usr/bin/mn)' : 'NOT DETECTED'}
          </div>
          <p className="text-xs text-slate-400">Network namespaces and virtual ethernet switches</p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Open vSwitch (OVS)</span>
            {systemStatus?.ovs_service_running ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {systemStatus?.ovs_service_running ? 'SERVICE RUNNING' : 'STOPPED'}
          </div>
          <p className="text-xs text-slate-400">ovs-vswitchd & ovsdb-server datapath</p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Maintenance Actions</span>
            <Wrench className="w-4 h-4 text-amber-400" />
          </div>
          <button
            onClick={handleCleanMininet}
            className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 transition flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Clean Mininet State (mn -c)</span>
          </button>
          <p className="text-[11px] text-slate-500">Purge stale bridges, veth pairs, and locks</p>
        </div>
      </div>
    </div>
  );
};
