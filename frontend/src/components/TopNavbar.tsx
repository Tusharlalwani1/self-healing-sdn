import React from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Cpu,
  Wifi,
  WifiOff,
  Radio,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { ControllerType } from '../types';

export const TopNavbar: React.FC = () => {
  const {
    connected,
    simulationState,
    activeController,
    controllers,
    selectController,
    startSimulation,
    stopSimulation,
    restoreAllLinks,
    loading,
    experimentRunning,
    experimentProgress
  } = useSDNStore();

  const handleControllerChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as ControllerType;
    if (val) {
      await selectController(val);
    }
  };

  const getSimBadge = () => {
    switch (simulationState) {
      case 'RUNNING':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            SIMULATION RUNNING
          </span>
        );
      case 'STARTING':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
            STARTING MININET...
          </span>
        );
      case 'ERROR':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3.5 h-3.5" />
            SIMULATION ERROR
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            SIMULATION STOPPED
          </span>
        );
    }
  };

  return (
    <header className="h-16 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-6 flex items-center justify-between z-20 shrink-0">
      {/* Left: Active Controller & Simulation Status */}
      <div className="flex items-center space-x-4">
        {getSimBadge()}

        {/* Controller Dropdown */}
        <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
          <Cpu className="w-4 h-4 text-blue-400" />
          <span className="text-xs text-slate-400 font-medium">Controller:</span>
          <select
            value={activeController || ''}
            onChange={handleControllerChange}
            disabled={loading || experimentRunning}
            className="bg-transparent text-xs font-semibold text-slate-200 outline-none cursor-pointer disabled:opacity-50"
          >
            <option value="" disabled className="bg-slate-900 text-slate-400">Select Controller</option>
            {controllers.map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-900 text-slate-200">
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Experiment status if running */}
        {experimentRunning && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-blue-900/30 border border-blue-500/40 text-blue-300 text-xs">
            <Radio className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span>{experimentProgress?.status || 'Experiment Running...'}</span>
            {experimentProgress?.progress_percent !== undefined && (
              <span className="font-mono font-bold text-white">{experimentProgress.progress_percent}%</span>
            )}
          </div>
        )}
      </div>

      {/* Right: Quick Action Buttons & WebSocket indicator */}
      <div className="flex items-center space-x-3">
        {/* Restore All Links */}
        {simulationState === 'RUNNING' && (
          <button
            onClick={() => restoreAllLinks()}
            title="Restore all physical links to UP"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Restore All Links</span>
          </button>
        )}

        {/* Start / Stop Simulation */}
        {simulationState !== 'RUNNING' ? (
          <button
            onClick={() => startSimulation()}
            disabled={loading || experimentRunning}
            className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start Simulation</span>
          </button>
        ) : (
          <button
            onClick={() => stopSimulation()}
            disabled={loading || experimentRunning}
            className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition disabled:opacity-50"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop Simulation</span>
          </button>
        )}

        {/* WebSocket Connection Indicator */}
        <div
          title={connected ? 'WebSocket: Real-time Telemetry Live' : 'WebSocket: Disconnected (Retrying...)'}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium"
        >
          {connected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 text-[11px]">LIVE</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span className="text-rose-400 text-[11px]">OFFLINE</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
