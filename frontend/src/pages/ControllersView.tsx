import React from 'react';
import { Cpu, CheckCircle2, Terminal, Shield, ArrowRight, Zap, RefreshCw } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { ControllerType } from '../types';

export const ControllersView: React.FC = () => {
  const {
    controllers,
    activeController,
    selectController,
    controllerLogs,
    loading,
    experimentRunning
  } = useSDNStore();

  const handleSelect = async (id: ControllerType) => {
    try {
      await selectController(id);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Cpu className="w-5 h-5 text-blue-400" />
          SDN Controller Management
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Switch between OpenFlow 1.3 controllers with dynamic lifecycle orchestration
        </p>
      </div>

      {/* 3 Controller Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {controllers.map((ctrl) => {
          const isActive = ctrl.id === activeController;
          return (
            <div
              key={ctrl.id}
              className={`glass-panel rounded-2xl p-5 border flex flex-col justify-between transition-all ${
                isActive
                  ? 'border-blue-500 shadow-xl shadow-blue-500/10 ring-1 ring-blue-500/30'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="space-y-4">
                {/* Title & Status */}
                <div className="flex items-center justify-between">
                  <div className={`p-2.5 rounded-xl border ${
                    isActive ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-slate-900 text-slate-400 border-slate-800'
                  }`}>
                    <Shield className="w-5 h-5" />
                  </div>
                  {isActive ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      ACTIVE RUNNING
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono text-slate-500">STANDBY</span>
                  )}
                </div>

                <div>
                  <h3 className="font-bold text-base text-white">{ctrl.name}</h3>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{ctrl.description}</p>
                </div>

                {/* Features */}
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Features</div>
                  {ctrl.features.map((f, i) => (
                    <div key={i} className="flex items-center space-x-2 text-xs text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-5 mt-4 border-t border-slate-800/60">
                {isActive ? (
                  <div className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-center bg-blue-500/15 text-blue-400 border border-blue-500/30">
                    Currently Controlling Datapath
                  </div>
                ) : (
                  <button
                    onClick={() => handleSelect(ctrl.id as ControllerType)}
                    disabled={loading || experimentRunning}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-blue-600 text-white border border-slate-700 hover:border-blue-500 transition shadow-sm disabled:opacity-50"
                  >
                    <span>Activate {ctrl.name.split(' ')[0]}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Ryu Controller Log Stream */}
      <div className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-xs text-white uppercase tracking-wider">
              Live Controller Stdout / Stderr Stream
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">
              ({activeController ? activeController.toUpperCase() : 'NO CONTROLLER'})
            </span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 animate-pulse">STREAMING</span>
        </div>

        <div className="p-4 bg-slate-950/90 font-mono text-xs text-slate-300 h-64 overflow-y-auto space-y-1">
          {controllerLogs.length ? (
            controllerLogs.map((log, i) => (
              <div key={i} className="leading-relaxed hover:bg-slate-900/50 px-1 rounded">
                <span className="text-slate-600 select-none mr-2">{String(i + 1).padStart(3, '0')}</span>
                <span className={log.includes('LINK DOWN') ? 'text-amber-400' : log.includes('HEALED') || log.includes('ROUTES RECOMPUTED') ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                  {log}
                </span>
              </div>
            ))
          ) : (
            <div className="text-slate-600 italic py-8 text-center">
              Awaiting controller log output...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
