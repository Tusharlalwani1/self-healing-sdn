import React from 'react';
import { ZapOff, CheckCircle2, AlertTriangle, RefreshCw, Activity, ArrowRightLeft } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';

export const FailureSimulatorView: React.FC = () => {
  const { topology, setLinkStatus, restoreAllLinks, simulationState, events } = useSDNStore();

  const allLinks = [
    { src: 's1', dst: 's2', label: 'Primary Path Link (s1 ↔ s2)', desc: 'Standard forwarding path for h1 → h2' },
    { src: 's2', dst: 's4', label: 'Primary Path Link (s2 ↔ s4)', desc: 'Lower segment of primary route' },
    { src: 's1', dst: 's3', label: 'Backup Path Link (s1 ↔ s3)', desc: 'Alternative route via switch s3' },
    { src: 's3', dst: 's4', label: 'Backup Path Link (s3 ↔ s4)', desc: 'Lower segment of alternative route' },
    { src: 'h1', dst: 's1', label: 'Edge Access Link (h1 ↔ s1)', desc: 'Host 1 edge connection' },
    { src: 'h2', dst: 's4', label: 'Edge Access Link (h2 ↔ s4)', desc: 'Host 2 edge connection' },
  ];

  const handleSimulateScenario = async (scenario: 'primary' | 'backup' | 'restore') => {
    if (scenario === 'primary') {
      await setLinkStatus('s1', 's2', 'down');
    } else if (scenario === 'backup') {
      await setLinkStatus('s1', 's3', 'down');
    } else {
      await restoreAllLinks();
    }
  };

  const recentFailures = events.filter((e) => e.message.includes('Link') || e.message.includes('HEALED'));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <ZapOff className="w-5 h-5 text-amber-400" />
          Network Failure Injection & Self-Healing Simulator
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Simulate arbitrary link outages and observe how Baseline, Reactive, and Fast Failover controllers respond
        </p>
      </div>

      {/* Scenario Presets Bar */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">Automated Failure Presets:</span>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => handleSimulateScenario('primary')}
            disabled={simulationState !== 'RUNNING'}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition disabled:opacity-50"
          >
            Fail Primary Link (s1 ↔ s2)
          </button>
          <button
            onClick={() => handleSimulateScenario('backup')}
            disabled={simulationState !== 'RUNNING'}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 transition disabled:opacity-50"
          >
            Fail Backup Link (s1 ↔ s3)
          </button>
          <button
            onClick={() => handleSimulateScenario('restore')}
            disabled={simulationState !== 'RUNNING'}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            <span>Restore All</span>
          </button>
        </div>
      </div>

      {/* Grid of Link Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {allLinks.map((item) => {
          const match = topology.links.find(
            (l) => (l.src === item.src && l.dst === item.dst) || (l.src === item.dst && l.dst === item.src)
          );
          const isUp = match ? match.status === 'UP' : true;

          return (
            <div
              key={`${item.src}-${item.dst}`}
              className={`glass-panel p-5 rounded-2xl border transition-all flex flex-col justify-between ${
                isUp ? 'border-slate-800/80 hover:border-slate-700' : 'border-rose-500/50 shadow-lg shadow-rose-500/10'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${
                    isUp ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30 animate-pulse'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isUp ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    {isUp ? 'LINK OPERATIONAL' : 'LINK DOWN'}
                  </span>
                  <span className="text-xs font-mono text-slate-500">10 Mbps / 5ms</span>
                </div>

                <div>
                  <h3 className="font-bold text-sm text-white uppercase tracking-wider">
                    {item.src} ↔ {item.dst}
                  </h3>
                  <p className="text-xs text-blue-400 font-medium mt-0.5">{item.label}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{item.desc}</p>
                </div>
              </div>

              <div className="pt-4 mt-3 border-t border-slate-800/80">
                {isUp ? (
                  <button
                    onClick={() => setLinkStatus(item.src, item.dst, 'down')}
                    disabled={simulationState !== 'RUNNING'}
                    className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-rose-600/20 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/30 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <ZapOff className="w-3.5 h-3.5" />
                    <span>Disconnect (Inject Failure)</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setLinkStatus(item.src, item.dst, 'up')}
                    disabled={simulationState !== 'RUNNING'}
                    className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/30 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Restore Link</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recovery Timeline / Real-time reactions */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-blue-400" />
          Recent Failure & Self-Healing Telemetry Events
        </h3>

        <div className="space-y-2">
          {recentFailures.slice(0, 5).map((ev, i) => (
            <div
              key={i}
              className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs font-mono"
            >
              <div className="flex items-center space-x-3">
                <span className={`w-2 h-2 rounded-full ${
                  ev.level === 'SUCCESS' ? 'bg-emerald-400' : ev.level === 'WARNING' ? 'bg-amber-400' : 'bg-blue-400'
                }`} />
                <span className="text-slate-300">{ev.message}</span>
              </div>
              <span className="text-slate-500 text-[10px]">
                {new Date(ev.timestamp * 1000).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {!recentFailures.length && (
            <div className="text-slate-500 text-xs italic text-center py-4">
              No recent link failure events recorded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
