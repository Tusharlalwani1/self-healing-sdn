import { ServiceIntentCard } from '../components/ServiceIntentCard';
import { intentCounts, intentNumber } from '../services/intent';
import { topologyLabel } from "../stores/topologySelectionStore";
import { RecoveryVerificationCard } from '../components/RecoveryVerificationCard';
import { PageHeader } from "../components/ui/Primitives";
import React, { useEffect, useMemo, useState } from "react";
import { controllerComparison, formatMetric } from "../services/metrics";
import {
  BarChart3,
  TrendingUp,
  ShieldAlert,
  Award,
  FileSpreadsheet,
} from "lucide-react";
import { useSDNStore } from "../stores/sdnStore";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export const AnalyticsView: React.FC = () => {
  const { experimentsHistory, fetchExperiments } = useSDNStore();
  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  const [topologyFilter, setTopologyFilter] = useState("all");
  // Aggregate only the explicitly selected topology subset.
  const comparisonData = useMemo(
    () =>
      controllerComparison(
        experimentsHistory.filter(
          (exp) =>
            topologyFilter === "all" ||
            (exp.summary?.topology_id || "unknown") === topologyFilter,
        ),
      ),
    [experimentsHistory, topologyFilter],
  );
  const intentSummary = intentCounts(experimentsHistory.filter(exp => topologyFilter === 'all' || (exp.summary?.topology_id || 'unknown') === topologyFilter));
  const baseline = comparisonData.find((row) => row.controller === "baseline");
  const reactive = comparisonData.find((row) => row.controller === "reactive");
  const ff = comparisonData.find((row) => row.controller === "fast_failover");

  return (
    <div className="page analytics-page">
      {/* Header */}
      <div>
        <PageHeader
          eyebrow="RESEARCH / EVIDENCE"
          title="Performance analytics"
          description="Historical completed experiments (loaded history only); unavailable measurements are excluded from averages."
        />
      </div>

      <label className="controller-picker">
        <span>Experiment topology filter</span>
        <select
          aria-label="Analytics topology"
          value={topologyFilter}
          onChange={(e) => setTopologyFilter(e.target.value)}
        >
          <option value="all">All topologies (mixed history)</option>
          {["diamond", "multipath_mesh"].map((id) => (
            <option key={id} value={id}>
              {topologyLabel(id)}
            </option>
          ))}
          <option value="unknown">Topology not recorded</option>
        </select>
      </label>
      <section className="panel"><div className="panel-heading"><h2>Service intent ? loaded experiment history</h2></div>
        <div className="panel-body"><p>Recorded evaluations: {intentSummary.total} ? Satisfied: {intentSummary.satisfied} ? Violated: {intentSummary.violated} ? Unavailable: {intentSummary.unavailable}</p>
          <p>Satisfied rate among evaluable records: {intentNumber(intentSummary.satisfiedRate, '%')}. Older records without intent evidence are excluded.</p>
          <p>Requirement failures: {Object.entries(intentSummary.reasons).map(([name,count]) => name + ': ' + count).join(', ') || 'None recorded'}</p>
        </div></section>
      <section className="panel"><div className="panel-heading"><h2>Recovery verification · loaded history</h2></div>
        <div className="panel-body">{experimentsHistory.filter(exp => topologyFilter === 'all' || (exp.summary?.topology_id || 'unknown') === topologyFilter).map(exp =>
          <details key={exp.id}><summary>{exp.id}: {exp.summary?.verification?.verification_status || 'Not recorded'}</summary>
            <RecoveryVerificationCard verification={exp.summary?.verification || null}/><ServiceIntentCard evaluation={exp.summary?.intent_evaluation || null} intent={exp.summary?.service_intent || null}/></details>)}
          {!experimentsHistory.length && <p>No recorded verification evidence.</p>}
        </div></section>
      {/* 3 Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="panel p-5 rounded-md border border-rose-500/30 space-y-2">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-xs font-bold uppercase tracking-wider">
              Baseline Controller
            </span>
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-slate-300 font-mono">
            {formatMetric(baseline?.packetLoss, "% loss", 2)}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            No automatic reroute. Packet loss mean: {baseline?.lossSamples ?? 0}{" "}
            measured samples.
          </p>
        </div>

        <div className="panel p-5 rounded-md border border-blue-500/30 space-y-2">
          <div className="flex items-center justify-between text-accent">
            <span className="text-xs font-bold uppercase tracking-wider">
              Reactive Controller
            </span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-accent font-mono">
            {formatMetric(reactive?.processingMs, " ms", 1)}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Controller processing mean: {reactive?.processingSamples ?? 0}{" "}
            measured samples; not network outage.
          </p>
        </div>

        <div className="panel p-5 rounded-md border border-emerald-500/30 space-y-2">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-xs font-bold uppercase tracking-wider">
              Fast Failover (FF)
            </span>
            <Award className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold text-slate-300 font-mono">
            {formatMetric(ff?.processingMs, " ms", 1)}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Controller recomputation mean: {ff?.processingSamples ?? 0} measured
            samples. Local FF switching time is not measured.
          </p>
        </div>
      </div>

      {/* Dual Charts Grid */}
      {!comparisonData.length && (
        <p className="text-xs text-slate-400">
          No completed experiment data available.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Packet Loss Comparison */}
        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            Packet Loss Rate Comparison (%)
          </h2>
          <div className="h-64 w-full pt-2">
            {comparisonData.some((row) => row.packetLoss !== null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e3db" />
                  <XAxis dataKey="name" stroke="#73766b" fontSize={11} />
                  <YAxis stroke="#73766b" fontSize={11} unit="%" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      borderColor: "#d6d7ce",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                  />
                  <Bar
                    dataKey="packetLoss"
                    fill="#9c6559"
                    radius={[6, 6, 0, 0]}
                    name="Packet Loss %"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-400">
                No measured packet-loss data.
              </p>
            )}
          </div>
        </div>

        {/* Recovery Duration Comparison */}
        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            Controller Processing / Recomputation (ms)
          </h2>
          <div className="h-64 w-full pt-2">
            {comparisonData.some((row) => row.processingMs !== null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e3db" />
                  <XAxis dataKey="name" stroke="#73766b" fontSize={11} />
                  <YAxis stroke="#73766b" fontSize={11} unit=" ms" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      borderColor: "#d6d7ce",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                  />
                  <Bar
                    dataKey="processingMs"
                    fill="#6b54a0"
                    radius={[6, 6, 0, 0]}
                    name="Controller Processing (ms)"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-400">
                Controller processing: N/A — no measured samples.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
