import { ExecutionTimeline } from "../components/experiments/ExecutionTimeline";
import { PageHeader } from "../components/ui/Primitives";
import React, { useState, useEffect } from "react";
import {
  FlaskConical,
  Play,
  XCircle,
  Download,
  Trash2,
  CheckCircle2,
  Radio,
  FileText,
  BarChart2,
} from "lucide-react";
import { useSDNStore } from "../stores/sdnStore";
import { api } from "../services/api";
import { formatMetric } from "../services/metrics";
import {
  useTopologySelectionStore,
  topologyLabel,
} from "../stores/topologySelectionStore";
import { experimentLinks } from "../services/experimentLinks";

export const ExperimentLabView: React.FC = () => {
  const {
    experimentRunning,
    experimentProgress,
    runExperiment,
    cancelExperiment,
    experimentsHistory,
    fetchExperiments,
    simulationState,
    topology,
  } = useSDNStore();

  const [controller, setController] = useState<string>("reactive");
  const [packetCount, setPacketCount] = useState<number>(300);
  const [trafficInterval, setTrafficInterval] = useState<number>(0.02);
  const [failureDelay, setFailureDelay] = useState<number>(2.0);
  const [failLink, setFailLink] = useState<string>("s1-s2");
  const { selectedTopologyId, options } = useTopologySelectionStore();
  const links = experimentLinks(topology, options, selectedTopologyId);
  const targetLink = links.find((link) => link.id === failLink);
  useEffect(() => {
    if (
      !experimentRunning &&
      links.length &&
      !links.some((link) => link.id === failLink)
    )
      setFailLink(links[0].id);
  }, [
    topology.links,
    topology.simulation_state,
    options,
    selectedTopologyId,
    experimentRunning,
    failLink,
  ]);

  useEffect(() => {
    fetchExperiments();
  }, []);

  const handleStartExperiment = async () => {
    if (!targetLink) {
      useSDNStore.setState({
        error: "Choose a valid failure link for this topology",
      });
      return;
    }
    const { src, dst } = targetLink;
    try {
      await runExperiment({
        controller,
        topology_id: selectedTopologyId,
        packet_count: packetCount,
        traffic_interval: trafficInterval,
        failure_delay_sec: failureDelay,
        fail_link_src: src,
        fail_link_dst: dst,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm(`Delete experiment record ${id}?`)) {
      await api.deleteExperiment(id);
      await fetchExperiments();
    }
  };

  return (
    <div className="page experimentlab-page">
      {/* Header */}
      <div>
        <PageHeader
          eyebrow="RESEARCH / EXPERIMENTS"
          title="Experiment lab"
          description="Control the traffic and failure conditions. Compare the measurements collected by each strategy."
        />
      </div>

      {/* Main Form & Active Execution Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Experiment Configuration Form */}
        <div className="lg:col-span-2 panel p-5 rounded-md border border-slate-800/80 space-y-4">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-accent" />
            Experiment Parameters
          </h2>

          <p className="muted">
            Topology: {topologyLabel(selectedTopologyId)}.{" "}
            {simulationState === "RUNNING"
              ? "Links from current runtime."
              : "Configured links; the experiment will start this topology."}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label
                className="text-slate-400 block mb-1 font-medium"
                htmlFor="experimentlabview-field-0"
              >
                Controller Mode
              </label>
              <select
                id="experimentlabview-field-0"
                value={controller}
                onChange={(e) => setController(e.target.value)}
                disabled={experimentRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none"
              >
                <option value="reactive">
                  Reactive Self-Healing (Ryu Reroute)
                </option>
                <option value="fast_failover">
                  Fast Failover (OpenFlow 1.3 FF Group)
                </option>
                <option value="baseline">
                  Baseline (No Automatic Recovery)
                </option>
                <option value="comparison">★ Compare All 3 Controllers</option>
              </select>
            </div>

            <div>
              <label
                className="text-slate-400 block mb-1 font-medium"
                htmlFor="experimentlabview-field-1"
              >
                Failure Injection Link
              </label>
              <select
                id="experimentlabview-field-1"
                value={failLink}
                onChange={(e) => setFailLink(e.target.value)}
                disabled={experimentRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none font-mono"
              >
                {!links.length && <option value="">No links available</option>}
                {links.map((link) => (
                  <option
                    key={link.id}
                    value={link.id}
                    disabled={link.status === "DOWN"}
                  >
                    {link.src} ↔ {link.dst} (
                    {link.status === "CONFIGURED"
                      ? "configured; not running"
                      : link.status}
                    )
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="text-slate-400 block mb-1 font-medium"
                htmlFor="experimentlabview-field-2"
              >
                Traffic Packet Count
              </label>
              <select
                id="experimentlabview-field-2"
                value={packetCount}
                onChange={(e) => setPacketCount(parseInt(e.target.value))}
                disabled={experimentRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none font-mono"
              >
                <option value={100}>100 Packets</option>
                <option value={200}>200 Packets</option>
                <option value={300}>300 Packets (Recommended)</option>
                <option value={500}>500 Packets</option>
                <option value={1000}>1,000 Packets</option>
              </select>
            </div>

            <div>
              <label
                className="text-slate-400 block mb-1 font-medium"
                htmlFor="experimentlabview-field-3"
              >
                Ping Interval & Failure Timing
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  id="experimentlabview-field-3"
                  value={trafficInterval}
                  onChange={(e) =>
                    setTrafficInterval(parseFloat(e.target.value))
                  }
                  disabled={experimentRunning}
                  className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none font-mono text-xs"
                >
                  <option value={0.01}>10ms (0.01s)</option>
                  <option value={0.02}>20ms (0.02s)</option>
                  <option value={0.05}>50ms (0.05s)</option>
                  <option value={0.1}>100ms (0.1s)</option>
                </select>

                <select
                  aria-label="Failure delay (seconds)"
                  value={failureDelay}
                  onChange={(e) => setFailureDelay(parseFloat(e.target.value))}
                  disabled={experimentRunning}
                  className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none font-mono text-xs"
                >
                  <option value={1.0}>Fail @ 1.0s</option>
                  <option value={2.0}>Fail @ 2.0s</option>
                  <option value={3.0}>Fail @ 3.0s</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Zero manual terminal entry needed. Automatically starts Ryu,
              prepares Mininet, generates traffic, injects failure, and compiles
              metrics.
            </div>

            {experimentRunning ? (
              <button
                onClick={() => cancelExperiment().catch(console.error)}
                disabled={experimentProgress?.status === "CANCELLING"}
                className="flex items-center space-x-2 py-2.5 px-5 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white   transition"
              >
                <XCircle className="w-4 h-4" />
                <span>
                  {experimentProgress?.status === "CANCELLING"
                    ? "Cleaning up..."
                    : "Cancel Experiment"}
                </span>
              </button>
            ) : (
              <button
                onClick={handleStartExperiment}
                disabled={!targetLink || targetLink.status === "DOWN"}
                className="flex items-center space-x-2 py-2.5 px-6 rounded-md text-xs font-semibold      text-white   transition"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {controller === "comparison"
                    ? "Run 3-Way Comparison"
                    : "Run Automated Experiment"}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Right Col: Active Execution Progress Card */}
        <div className="panel p-5 rounded-md border border-slate-800/80 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Execution Status
              </span>
              {experimentRunning ? (
                <span className="text-xs font-mono font-bold text-accent flex items-center gap-1.5 ">
                  <Radio className="w-3 h-3" />
                  IN PROGRESS
                </span>
              ) : (
                <span className="text-xs font-mono text-slate-500">
                  {experimentProgress?.status || "READY"}
                </span>
              )}
            </div>

            {experimentRunning ? (
              <div className="space-y-4 pt-2">
                <ExecutionTimeline status={experimentProgress?.status} />
                <div>
                  <div className="flex justify-between text-xs font-mono text-slate-300 mb-1.5">
                    <span>{experimentProgress?.status || "RUNNING"}</span>
                    <span className="font-bold text-accent">
                      Stage {experimentProgress?.progress_percent ?? 0}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                    <div
                      className="   h-2.5 rounded-full transition-all duration-300"
                      title="Workflow milestone; not elapsed-time or packet completion percentage"
                      style={{
                        width: `${experimentProgress?.progress_percent ?? 0}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="p-3 rounded-md bg-slate-950/60 border border-slate-800 text-xs text-slate-300 font-mono">
                  {experimentProgress?.message ||
                    "Coordinating network simulation..."}
                </div>
              </div>
            ) : experimentProgress ? (
              <div
                className="py-8 text-xs text-slate-400 space-y-3"
                role="status"
              >
                <strong>{experimentProgress.status}</strong>
                <p>
                  {experimentProgress.message ||
                    "The backend has reported a terminal workflow state. Review the stored result below."}
                </p>
                <p>
                  Unavailable measurements remain N/A. Failed or cancelled runs
                  are not successful benchmark samples.
                </p>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500 space-y-2">
                <FlaskConical className="w-8 h-8 text-slate-700 mx-auto" />
                <p>
                  Click "Run Automated Experiment" to initiate a controlled
                  failure benchmark.
                </p>
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500 font-mono pt-3 border-t border-slate-800 flex justify-between">
            <span>Stored in SQLite</span>
            <span>Export stored results</span>
          </div>
        </div>
      </div>

      {/* Historical Experiments Table */}
      <div className="panel rounded-md border border-slate-800/80 overflow-hidden ">
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-accent" />
            <h3 className="font-bold text-xs text-white uppercase tracking-wider">
              Experiment History & Benchmarks ({experimentsHistory.length})
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-xs uppercase">
              <tr>
                <th className="py-3 px-4">Experiment ID</th>
                <th className="py-3 px-4">Controller</th>
                <th className="py-3 px-4">Topology</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Tx / Rx</th>
                <th className="py-3 px-4">Packet Loss</th>
                <th className="py-3 px-4">Controller Processing</th>
                <th className="py-3 px-4">Avg RTT</th>
                <th className="py-3 px-4 text-right">Reports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {experimentsHistory.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-900/40 transition">
                  <td className="py-3 px-4 font-bold text-white text-xs">
                    {exp.id}
                  </td>
                  <td className="py-3 px-4 font-semibold text-accent uppercase">
                    {exp.controller}
                  </td>
                  <td className="py-3 px-4">
                    {topologyLabel(exp.summary?.topology_id)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold ${
                        exp.status === "COMPLETED"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {exp.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {formatMetric(exp.packets_transmitted)} /{" "}
                    {formatMetric(exp.packets_received)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`font-bold ${(exp.packet_loss_percent ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"}`}
                    >
                      {formatMetric(exp.packet_loss_percent, "%")}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-accent font-bold">
                    {formatMetric(exp.recovery_duration_ms, " ms", 1)}
                  </td>
                  <td className="py-3 px-4 text-accent">
                    {formatMetric(exp.avg_rtt_ms, " ms", 2)}
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <a
                      href={api.getExportUrl(exp.id, "html")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition"
                    >
                      <Download className="w-3 h-3 text-accent" />
                      <span>HTML</span>
                    </a>
                    <a
                      href={api.getExportUrl(exp.id, "json")}
                      download
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition"
                    >
                      <span>JSON</span>
                    </a>
                    <button
                      onClick={() =>
                        handleDelete(exp.id).catch((e) =>
                          useSDNStore.setState({
                            error: e instanceof Error ? e.message : String(e),
                          }),
                        )
                      }
                      className="p-1 rounded hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition"
                      title="Delete record"
                      aria-label={`Delete experiment ${exp.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!experimentsHistory.length && (
                <tr>
                  <td
                    colSpan={9}
                    className="text-center py-8 text-slate-500 italic"
                  >
                    No experiments logged yet. Run an experiment above to
                    populate benchmarks.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
