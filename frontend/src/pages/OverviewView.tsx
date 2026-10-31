import React, { useState } from 'react';
import {
  Activity,
  Cpu,
  Layers,
  Server,
  Network,
  ZapOff,
  Radio,
  Timer,
  CheckCircle2,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  Clock
} from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { TopologyCanvas } from '../components/topology/TopologyCanvas';
import { SwitchInspectorModal } from '../components/modals/SwitchInspectorModal';
import { LinkInspectorModal } from '../components/modals/LinkInspectorModal';
import { TopologyLink, TopologyNode } from '../types';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export const OverviewView: React.FC = () => {
  const {
    activeController,
    simulationState,
    topology,
    trafficStats,
    events,
    startSimulation,
    stopSimulation,
    restoreAllLinks,
    startTraffic,
    stopTraffic,
    setLinkStatus
  } = useSDNStore();

  const [inspectSwitch, setInspectSwitch] = useState<TopologyNode | null>(null);
  const [inspectLink, setInspectLink] = useState<TopologyLink | null>(null);

  const activeLinks = topology.links.filter((l) => l.status === 'UP').length;
  const failedLinks = topology.links.filter((l) => l.status === 'DOWN').length;

  const recoveryEvents = events.filter((e) => e.level === 'SUCCESS' && e.source === 'CONTROLLER');
  const latestRecovery = recoveryEvents[0];

  const recentRecoveryDuration = latestRecovery?.details?.duration_ms
    ? `${latestRecovery.details.duration_ms.toFixed(1)} ms`
    : 'N/A';

  // Quick failure inject on s1-s2
  const handleQuickFailure = async () => {
    const s1s2 = topology.links.find(
      (l) => (l.src === 's1' && l.dst === 's2') || (l.src === 's2' && l.dst === 's1')
    );
    if (s1s2?.status === 'DOWN') {
      await setLinkStatus('s1', 's2', 'up');
    } else {
      await setLinkStatus('s1', 's2', 'down');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* 10 NOC Operational Telemetry Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* 1. Active Controller */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Controller</span>
            <Cpu className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-sm font-bold text-white mt-1.5 truncate">
            {activeController ? activeController.toUpperCase() : 'None'}
          </div>
          <div className="text-[10px] text-blue-400 font-mono mt-0.5">OpenFlow 1.3</div>
        </div>

        {/* 2. Network Status */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Network</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className={`text-sm font-bold mt-1.5 ${simulationState === 'RUNNING' ? 'text-emerald-400' : 'text-slate-400'}`}>
            {simulationState}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">Mininet Diamond</div>
        </div>

        {/* 3. Active Switches */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Switches</span>
            <Network className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1 font-mono">
            {topology.switches.length || 4}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">s1, s2, s3, s4</div>
        </div>

        {/* 4. Connected Hosts */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Hosts</span>
            <Server className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-white mt-1 font-mono">
            {topology.hosts.length || 2}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">h1 (10.0.0.1), h2</div>
        </div>

        {/* 5. Active Links */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Active Links</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 mt-1 font-mono">
            {activeLinks}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">10 Mbps / 5ms</div>
        </div>

        {/* 6. Failed Links */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Failed Links</span>
            <ZapOff className={`w-4 h-4 ${failedLinks > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
          </div>
          <div className={`text-xl font-bold mt-1 font-mono ${failedLinks > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {failedLinks}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">Link Down Count</div>
        </div>

        {/* 7. Packet Loss */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Packet Loss</span>
            <Radio className="w-4 h-4 text-amber-400" />
          </div>
          <div className={`text-xl font-bold mt-1 font-mono ${trafficStats.loss_percent > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {trafficStats.loss_percent}%
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            {trafficStats.received}/{trafficStats.transmitted} pkts
          </div>
        </div>

        {/* 8. Average RTT */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Avg Latency</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-bold text-sky-400 mt-1 font-mono">
            {trafficStats.avg_rtt ? `${trafficStats.avg_rtt.toFixed(1)} ms` : 'N/A'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            Last: {trafficStats.last_rtt ? `${trafficStats.last_rtt}ms` : 'N/A'}
          </div>
        </div>

        {/* 9. Recovery Events */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Healed Events</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 mt-1 font-mono">
            {recoveryEvents.length}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">Reactive / FF</div>
        </div>

        {/* 10. Latest Recovery Duration */}
        <div className="glass-panel p-3.5 rounded-2xl border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider">Healing Time</span>
            <Timer className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-purple-400 mt-1 font-mono">
            {recentRecoveryDuration}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">Sub-second recovery</div>
        </div>
      </div>

      {/* Main Center Area: Topology Canvas + Side Control Column */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Interactive Topology Canvas */}
        <div className="lg:col-span-2 h-[520px] flex flex-col space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Network className="w-4 h-4 text-blue-400" />
              Live Diamond Network Topology
            </h2>
            <div className="text-xs text-slate-500">
              Click any node or link to inspect and control
            </div>
          </div>
          <div className="flex-1">
            <TopologyCanvas
              onSelectNode={(node) => setInspectSwitch(node)}
              onSelectLink={(link) => setInspectLink(link)}
            />
          </div>
        </div>

        {/* Right Col: Live Operations & Traffic chart */}
        <div className="space-y-4 flex flex-col justify-between">
          {/* Quick Operations Panel */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-400" />
              Interactive NOC Controls
            </h3>
            <p className="text-xs text-slate-400">
              Trigger real-time network actions directly in Mininet and Ryu with zero CLI:
            </p>

            <div className="space-y-2 pt-1">
              {/* Traffic toggle */}
              {trafficStats.active ? (
                <button
                  onClick={() => stopTraffic().catch(console.error)}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop ICMP Traffic (h1 → h2)</span>
                </button>
              ) : (
                <button
                  onClick={() => startTraffic({ src: 'h1', dst: 'h2', interval: 0.05, count: 200 }).catch(console.error)}
                  disabled={simulationState !== 'RUNNING'}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Traffic (200 pkts @ 50ms)</span>
                </button>
              )}

              {/* Inject Link Failure toggle */}
              <button
                onClick={() => handleQuickFailure().catch(console.error)}
                disabled={simulationState !== 'RUNNING'}
                className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 transition disabled:opacity-50"
              >
                <ZapOff className="w-3.5 h-3.5" />
                <span>Toggle Link s1 ↔ s2 Failure</span>
              </button>

              {/* Restore all */}
              <button
                onClick={() => restoreAllLinks().catch(console.error)}
                disabled={simulationState !== 'RUNNING'}
                className="w-full flex items-center justify-center space-x-2 py-2 px-4 rounded-xl text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>Restore All Network Links</span>
              </button>
            </div>
          </div>

          {/* Live RTT Chart Preview */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 flex-1 flex flex-col justify-between">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Live Ping RTT (ms)</span>
              <span className="text-[10px] font-mono text-cyan-400">
                {trafficStats.active ? 'STREAMING' : 'IDLE'}
              </span>
            </div>

            <div className="h-32 w-full pt-2">
              {trafficStats.history && trafficStats.history.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trafficStats.history}>
                    <XAxis dataKey="seq" stroke="#475569" fontSize={9} />
                    <YAxis stroke="#475569" fontSize={9} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 11 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rtt"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 text-xs italic">
                  Start traffic to view live latency stream
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span>Loss: {trafficStats.loss_percent}%</span>
              <span>Avg: {trafficStats.avg_rtt ? `${trafficStats.avg_rtt.toFixed(1)}ms` : '-'}</span>
              <span>Tx: {trafficStats.transmitted}</span>
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
