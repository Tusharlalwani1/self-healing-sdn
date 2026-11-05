import { PageHeader } from '../components/ui/Primitives';
import React, { useEffect } from 'react';
import { Settings, CheckCircle2, XCircle, RefreshCw, Terminal, Wrench, Shield } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { api } from '../services/api';

export const SettingsView: React.FC = () => {
  const { systemStatus, fetchSystemStatus, resetSimulation, connected } = useSDNStore();

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
    <div className="page settings-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <PageHeader eyebrow="WORKSPACE / SYSTEM" title="System & configuration" description="Inspect reported runtime information, component probes and maintenance controls."/>
        </div>

        <button
          onClick={() => fetchSystemStatus()}
          className="flex items-center space-x-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition"
        >
          <RefreshCw className="w-3.5 h-3.5 text-accent" />
          <span>Re-check Environment</span>
        </button>
      </div>

      {/* Diagnostics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="panel p-5 space-y-3"><span className="text-xs text-slate-400">LIVE TRANSPORT</span><div className="text-lg font-medium">{connected ? 'WebSocket connected' : 'WebSocket disconnected'}</div><p className="text-xs text-slate-400">Transport status does not imply that every measurement is current or available.</p></div>
        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Host OS & WSL</span>
            <Shield className="w-4 h-4 text-accent" />
          </div>
          <div className="text-lg font-bold text-white font-mono">{systemStatus?.os ?? 'N/A'}</div>
          <p className="text-xs text-slate-400">Backend-reported host operating system</p>
        </div>

        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Python Runtime</span>
            <Terminal className="w-4 h-4 text-accent" />
          </div>
          <div className="text-lg font-bold text-accent font-mono">{systemStatus?.python_version ?? 'N/A'}</div>
          <p className="text-xs text-slate-400">Backend-reported interpreter version. Component versions are not probed here.</p>
        </div>

        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">OpenFlow 1.3 Port</span>
            <div className={`w-2.5 h-2.5 rounded-full ${systemStatus?.openflow_port_active ? 'bg-emerald-400 ' : 'bg-slate-600'}`} />
          </div>
          <div className="text-lg font-bold text-white font-mono">Port {systemStatus?.controller_port ?? 'N/A'}</div>
          <p className="text-xs text-slate-400">
            {!systemStatus ? 'Not checked' : systemStatus.openflow_port_active ? 'TCP listener detected; identity not verified here' : 'No TCP listener detected'}
          </p>
        </div>

        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mininet Emulator</span>
            {systemStatus?.mininet_available ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {!systemStatus ? 'N/A' : systemStatus.mininet_available ? 'mn COMMAND AVAILABLE' : 'NOT DETECTED'}
          </div>
          <p className="text-xs text-slate-400">Network namespaces and virtual ethernet switches</p>
        </div>

        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Open vSwitch (OVS)</span>
            {systemStatus?.ovs_service_running ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {!systemStatus ? 'N/A' : systemStatus.ovs_service_running ? 'OVSDB REACHABLE' : 'OVSDB CHECK FAILED'}
          </div>
          <p className="text-xs text-slate-400">ovs-vswitchd & ovsdb-server datapath</p>
        </div>

        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Maintenance Actions</span>
            <Wrench className="w-4 h-4 text-amber-400" />
          </div>
          <button
            onClick={handleCleanMininet}
            className="w-full py-2.5 px-3 rounded-md text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 transition flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Clean Mininet State (mn -c)</span>
          </button>
          <p className="text-xs text-slate-500">Purge stale bridges, veth pairs, and locks</p>
        </div>
      </div>
    </div>
  );
};
