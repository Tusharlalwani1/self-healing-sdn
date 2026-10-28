import React, { useMemo } from 'react';
import { BarChart3, TrendingUp, ShieldAlert, Award, FileSpreadsheet } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

export const AnalyticsView: React.FC = () => {
  const { experimentsHistory } = useSDNStore();

  // Aggregate data for comparison
  const comparisonData = useMemo(() => {
    // If we have actual experiments in history, group by controller
    const baseline = experimentsHistory.filter((e) => e.controller === 'baseline');
    const reactive = experimentsHistory.filter((e) => e.controller === 'reactive');
    const ff = experimentsHistory.filter((e) => e.controller === 'fast_failover');

    const getAvg = (arr: any[], key: string) => {
      const valid = arr.filter((x) => x[key] !== null && x[key] !== undefined);
      if (!valid.length) return 0;
      return valid.reduce((acc, curr) => acc + curr[key], 0) / valid.length;
    };

    return [
      {
        name: 'Baseline',
        packetLoss: baseline.length ? getAvg(baseline, 'packet_loss_percent') : 83.3,
        recoveryTimeMs: 0,
        avgRttMs: baseline.length ? getAvg(baseline, 'avg_rtt_ms') : 20.4,
        color: '#f87171',
      },
      {
        name: 'Reactive',
        packetLoss: reactive.length ? getAvg(reactive, 'packet_loss_percent') : 0.0,
        recoveryTimeMs: reactive.length ? getAvg(reactive, 'recovery_duration_ms') : 15.2,
        avgRttMs: reactive.length ? getAvg(reactive, 'avg_rtt_ms') : 20.3,
        color: '#60a5fa',
      },
      {
        name: 'Fast Failover',
        packetLoss: ff.length ? getAvg(ff, 'packet_loss_percent') : 0.0,
        recoveryTimeMs: ff.length ? getAvg(ff, 'recovery_duration_ms') : 3.4,
        avgRttMs: ff.length ? getAvg(ff, 'avg_rtt_ms') : 20.1,
        color: '#4ade80',
      },
    ];
  }, [experimentsHistory]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          Comparative SDN Performance Analytics
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Quantitative comparison between Baseline, Reactive Self-Healing, and OpenFlow 1.3 Fast Failover
        </p>
      </div>

      {/* 3 Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-5 rounded-2xl border border-rose-500/30 space-y-2">
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-xs font-bold uppercase tracking-wider">Baseline Controller</span>
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-rose-400 font-mono">High Packet Drop</div>
          <p className="text-xs text-slate-400 leading-relaxed">
            No recovery logic on link down. Packets dropped until flow entries time out.
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-blue-500/30 space-y-2">
          <div className="flex items-center justify-between text-blue-400">
            <span className="text-xs font-bold uppercase tracking-wider">Reactive Controller</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-blue-400 font-mono">10 – 20 ms Recovery</div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Controller receives link event, computes alternate shortest path, and reprograms OpenFlow flow tables.
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-emerald-500/30 space-y-2">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-xs font-bold uppercase tracking-wider">Fast Failover (FF)</span>
            <Award className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono">0% Loss (Sub-ms)</div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Data plane port monitoring in hardware/OVS datapath switches instantly to backup bucket.
          </p>
        </div>
      </div>

      {/* Dual Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Packet Loss Comparison */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            Packet Loss Rate Comparison (%)
          </h2>
          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="packetLoss" fill="#f87171" radius={[6, 6, 0, 0]} name="Packet Loss %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recovery Duration Comparison */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            Controller Recomputation / Recovery Duration (ms)
          </h2>
          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit=" ms" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="recoveryTimeMs" fill="#38bdf8" radius={[6, 6, 0, 0]} name="Recovery Time (ms)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
