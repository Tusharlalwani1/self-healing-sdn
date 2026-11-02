import React, { useEffect, useMemo } from 'react';
import { controllerComparison, formatMetric } from '../services/metrics';
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
  const { experimentsHistory, fetchExperiments } = useSDNStore();
  useEffect(() => { fetchExperiments(); }, [fetchExperiments]);

  // Aggregate data for comparison
  const comparisonData = useMemo(() => controllerComparison(experimentsHistory), [experimentsHistory]);
  const baseline = comparisonData.find(row => row.controller === 'baseline');
  const reactive = comparisonData.find(row => row.controller === 'reactive');
  const ff = comparisonData.find(row => row.controller === 'fast_failover');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          Comparative SDN Performance Analytics
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Historical completed experiments (loaded history only); null measurements are excluded from averages.
        </p>
      </div>

      {/* 3 Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-5 rounded-2xl border border-rose-500/30 space-y-2">
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-xs font-bold uppercase tracking-wider">Baseline Controller</span>
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-rose-400 font-mono">{formatMetric(baseline?.packetLoss, '% loss', 2)}</div>
          <p className="text-xs text-slate-400 leading-relaxed">
            No automatic reroute. Packet loss mean: {baseline?.lossSamples ?? 0} measured samples.
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-blue-500/30 space-y-2">
          <div className="flex items-center justify-between text-blue-400">
            <span className="text-xs font-bold uppercase tracking-wider">Reactive Controller</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-blue-400 font-mono">{formatMetric(reactive?.processingMs, ' ms', 1)}</div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Controller processing mean: {reactive?.processingSamples ?? 0} measured samples; not network outage.
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-emerald-500/30 space-y-2">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-xs font-bold uppercase tracking-wider">Fast Failover (FF)</span>
            <Award className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono">{formatMetric(ff?.processingMs, ' ms', 1)}</div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Controller recomputation mean: {ff?.processingSamples ?? 0} measured samples. Local FF switching time is not measured.
          </p>
        </div>
      </div>

      {/* Dual Charts Grid */}
      {!comparisonData.length && <p className="text-xs text-slate-400">No completed experiment data available.</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Packet Loss Comparison */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            Packet Loss Rate Comparison (%)
          </h2>
          <div className="h-64 w-full pt-2">
            {comparisonData.some(row => row.packetLoss !== null) ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="packetLoss" fill="#f87171" radius={[6, 6, 0, 0]} name="Packet Loss %" />
              </BarChart>
            </ResponsiveContainer> : <p className="text-xs text-slate-400">No measured packet-loss data.</p>}
          </div>
        </div>

        {/* Recovery Duration Comparison */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            Controller Processing / Recomputation (ms)
          </h2>
          <div className="h-64 w-full pt-2">
            {comparisonData.some(row => row.processingMs !== null) ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit=" ms" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="processingMs" fill="#38bdf8" radius={[6, 6, 0, 0]} name="Controller Processing (ms)" />
              </BarChart>
            </ResponsiveContainer> : <p className="text-xs text-slate-400">Controller processing: N/A — no measured samples.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
