import { PageHeader } from '../components/ui/Primitives';
import React from 'react';
import { ServiceIntentEditor } from '../components/ServiceIntentEditor';
import { ServiceIntentCard } from '../components/ServiceIntentCard';
import { RecoveryVerificationCard } from '../components/RecoveryVerificationCard';
import { useIntentConfigurationStore } from '../stores/intentConfigurationStore';
import { Radio, Play, Square, Gauge, Activity, Clock, BarChart2 } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
import { useTrafficConfigurationStore } from '../stores/trafficConfigurationStore';
import { formatMetric } from '../services/metrics';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

export const TrafficView: React.FC = () => {
  const { trafficStats, startTraffic, stopTraffic, simulationState } = useSDNStore();

  const { configuration, setConfiguration } = useTrafficConfigurationStore();
  const { src, dst, interval, count } = configuration;

  const handleStart = async () => {
    try {
      await startTraffic({ src, dst, interval, count, service_intent:useIntentConfigurationStore.getState().selection('traffic') });
    } catch (e) {
      useSDNStore.setState({error:e instanceof Error ? e.message : 'Unable to start traffic'});
      console.error(e);
    }
  };

  return (
    <div className="page traffic-page">
      {/* Header */}
      <div>
        <PageHeader eyebrow="OPERATIONS / TRAFFIC" title="Traffic monitor" description="Generate ICMP traffic in Mininet and follow actual packet delivery and round-trip latency."/>
      </div>

      {/* Top: Controls + Live Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Card */}
        <div className="panel p-5 rounded-md border border-slate-800/80 space-y-4">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            Traffic Stream Configuration
          </h2>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1 font-medium" htmlFor="trafficview-field-0">Source Host</label>
<select id="trafficview-field-0"
                  value={src}
                  onChange={(e) => setConfiguration({ src: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none"
                >
                  <option value="h1">h1 (10.0.0.1)</option>
                  <option value="h2">h2 (10.0.0.2)</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1 font-medium" htmlFor="trafficview-field-1">Destination Host</label>
<select id="trafficview-field-1"
                  value={dst}
                  onChange={(e) => setConfiguration({ dst: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none"
                >
                  <option value="h2">h2 (10.0.0.2)</option>
                  <option value="h1">h1 (10.0.0.1)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1 font-medium" htmlFor="trafficview-field-2">Interval (sec)</label>
<select id="trafficview-field-2"
                  value={interval}
                  onChange={(e) => setConfiguration({ interval: parseFloat(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none font-mono"
                >
                  <option value={0.01}>10 ms (0.01s - High)</option>
                  <option value={0.05}>50 ms (0.05s - Std)</option>
                  <option value={0.1}>100 ms (0.1s)</option>
                  <option value={0.5}>500 ms (0.5s)</option>
                  <option value={1.0}>1.0 sec</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1 font-medium" htmlFor="trafficview-field-3">Packet Count</label>
<select id="trafficview-field-3"
                  value={count}
                  onChange={(e) => setConfiguration({ count: parseInt(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-white outline-none font-mono"
                >
                  <option value={100}>100 Packets</option>
                  <option value={300}>300 Packets</option>
                  <option value={500}>500 Packets</option>
                  <option value={1000}>1,000 Packets</option>
                </select>
              </div>
            </div>
          </div>

          <ServiceIntentEditor workflow="traffic"/>
          <div className="pt-2">
            {trafficStats.active ? (
              <button
                onClick={() => stopTraffic().catch(console.error)}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white   transition"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop Traffic Generator</span>
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={simulationState !== 'RUNNING'}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-md text-xs font-semibold bg-accent hover:bg-accent-strong text-white   transition disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Start Traffic Stream</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Gauges & Stat Cards (2 Cols) */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="panel p-4 rounded-md border border-slate-800/80 flex flex-col justify-between">
            <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Transmitted</span>
            <div className="text-2xl font-bold text-white font-mono mt-2">{trafficStats.transmitted}</div>
            <span className="text-xs text-slate-500">packets sent</span>
          </div>

          <div className="panel p-4 rounded-md border border-slate-800/80 flex flex-col justify-between">
            <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Received</span>
            <div className="text-2xl font-bold text-emerald-400 font-mono mt-2">{trafficStats.received}</div>
            <span className="text-xs text-slate-500">packets acked</span>
          </div>

          <div className="panel p-4 rounded-md border border-slate-800/80 flex flex-col justify-between">
            <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Packet Loss</span>
            <div className={`text-2xl font-bold font-mono mt-2 ${trafficStats.loss_percent > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {trafficStats.transmitted > 0 ? formatMetric(trafficStats.loss_percent, '%') : 'N/A'}
            </div>
            <span className="text-xs text-slate-500">unanswered / sent</span>
          </div>

          <div className="panel p-4 rounded-md border border-slate-800/80 flex flex-col justify-between">
            <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Overall Job Avg RTT</span>
            <div className="text-2xl font-bold text-accent font-mono mt-2">
              {trafficStats.avg_rtt != null ? `${trafficStats.avg_rtt.toFixed(1)}ms` : 'N/A'}
            </div>
            <span className="text-xs text-slate-500">round-trip delay</span>
          </div>

          <div className="col-span-2 sm:col-span-4 panel p-4 rounded-md border border-slate-800/80 flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-slate-500 mr-2">Min RTT:</span>
              <span className="text-slate-200 font-bold">{trafficStats.min_rtt != null ? `${trafficStats.min_rtt}ms` : 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-2">Max RTT:</span>
              <span className="text-slate-200 font-bold">{trafficStats.max_rtt != null ? `${trafficStats.max_rtt}ms` : 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-2">Last Timed Reply Sequence:</span>
              <span className="text-accent font-bold">{trafficStats.history?.length ? `#${trafficStats.history[trafficStats.history.length - 1].seq}` : 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>

      <RecoveryVerificationCard/>
      <ServiceIntentCard/>
      {/* Main RTT Latency Chart */}
      <div className="panel p-5 rounded-md border border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-accent" />
            Traffic Job Round-Trip Latency (ms)
          </h2>
          <span className="text-xs text-slate-400 font-mono">
            {trafficStats.active && simulationState === 'RUNNING' ? '● LIVE TELEMETRY' : !trafficStats.job_id ? 'NO ACTIVE TRAFFIC' : trafficStats.accounting_complete === false ? 'FINAL COUNTERS UNCONFIRMED' : 'FINAL / IDLE'}
            {trafficStats.controller && ` · ${trafficStats.controller}${trafficStats.controller_changed ? ' (controller changed since start)' : ''}`}
          </span>
        </div>

        <div className="h-72 w-full pt-2">
          {trafficStats.history && trafficStats.history.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trafficStats.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e3db" />
                <XAxis dataKey="seq" stroke="#73766b" fontSize={10} label={{ value: 'ICMP Sequence', position: 'insideBottom', offset: -5, fill: '#73766b', fontSize: 10 }} />
                <YAxis stroke="#73766b" fontSize={10} domain={['auto', 'auto']} label={{ value: 'RTT (ms)', angle: -90, position: 'insideLeft', fill: '#73766b', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#d6d7ce', borderRadius: 8, fontSize: 11 }}
                />
                <Line
                  type="monotone"
                  dataKey="rtt"
                  stroke="#6b54a0"
                  strokeWidth={2}
                  dot={{ r: 2, fill: '#6b54a0' }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs italic">
              No traffic currently running. Click "Start Traffic Stream" above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
