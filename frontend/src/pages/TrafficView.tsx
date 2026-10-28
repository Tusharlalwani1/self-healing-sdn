import React, { useState } from 'react';
import { Radio, Play, Square, Gauge, Activity, Clock, BarChart2 } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';
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

  const [src, setSrc] = useState('h1');
  const [dst, setDst] = useState('h2');
  const [interval, setIntervalVal] = useState(0.05);
  const [count, setCount] = useState(300);

  const handleStart = async () => {
    try {
      await startTraffic({ src, dst, interval, count });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-400" />
          Real-Time Traffic Generation & Telemetry
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Generate ICMP traffic streams inside Mininet host namespaces and monitor real packet delivery
        </p>
      </div>

      {/* Top: Controls + Live Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Card */}
        <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-4">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            Traffic Stream Configuration
          </h2>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Source Host</label>
                <select
                  value={src}
                  onChange={(e) => setSrc(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                >
                  <option value="h1">h1 (10.0.0.1)</option>
                  <option value="h2">h2 (10.0.0.2)</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Destination Host</label>
                <select
                  value={dst}
                  onChange={(e) => setDst(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                >
                  <option value="h2">h2 (10.0.0.2)</option>
                  <option value="h1">h1 (10.0.0.1)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Interval (sec)</label>
                <select
                  value={interval}
                  onChange={(e) => setIntervalVal(parseFloat(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none font-mono"
                >
                  <option value={0.01}>10 ms (0.01s - High)</option>
                  <option value={0.05}>50 ms (0.05s - Std)</option>
                  <option value={0.1}>100 ms (0.1s)</option>
                  <option value={0.5}>500 ms (0.5s)</option>
                  <option value={1.0}>1.0 sec</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Packet Count</label>
                <select
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none font-mono"
                >
                  <option value={100}>100 Packets</option>
                  <option value={300}>300 Packets</option>
                  <option value={500}>500 Packets</option>
                  <option value={1000}>1,000 Packets</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-2">
            {trafficStats.active ? (
              <button
                onClick={() => stopTraffic()}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop Traffic Generator</span>
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={simulationState !== 'RUNNING'}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Start Traffic Stream</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Gauges & Stat Cards (2 Cols) */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Transmitted</span>
            <div className="text-2xl font-bold text-white font-mono mt-2">{trafficStats.transmitted}</div>
            <span className="text-[10px] text-slate-500">packets sent</span>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Received</span>
            <div className="text-2xl font-bold text-emerald-400 font-mono mt-2">{trafficStats.received}</div>
            <span className="text-[10px] text-slate-500">packets acked</span>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Packet Loss</span>
            <div className={`text-2xl font-bold font-mono mt-2 ${trafficStats.loss_percent > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {trafficStats.loss_percent}%
            </div>
            <span className="text-[10px] text-slate-500">drop ratio</span>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Average RTT</span>
            <div className="text-2xl font-bold text-sky-400 font-mono mt-2">
              {trafficStats.avg_rtt ? `${trafficStats.avg_rtt.toFixed(1)}ms` : 'N/A'}
            </div>
            <span className="text-[10px] text-slate-500">round-trip delay</span>
          </div>

          <div className="col-span-2 sm:col-span-4 glass-panel p-4 rounded-2xl border border-slate-800/80 flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-slate-500 mr-2">Min RTT:</span>
              <span className="text-slate-200 font-bold">{trafficStats.min_rtt ? `${trafficStats.min_rtt}ms` : 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-2">Max RTT:</span>
              <span className="text-slate-200 font-bold">{trafficStats.max_rtt ? `${trafficStats.max_rtt}ms` : 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-2">Last Sequence:</span>
              <span className="text-cyan-400 font-bold">#{trafficStats.history?.length ? trafficStats.history[trafficStats.history.length - 1].seq : 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main RTT Latency Chart */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-blue-400" />
            Live Packet Round-Trip Latency (ms)
          </h2>
          <span className="text-xs text-slate-400 font-mono">
            {trafficStats.active ? '● LIVE TELEMETRY' : 'IDLE'}
          </span>
        </div>

        <div className="h-72 w-full pt-2">
          {trafficStats.history && trafficStats.history.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trafficStats.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="seq" stroke="#475569" fontSize={10} label={{ value: 'ICMP Sequence', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 10 }} />
                <YAxis stroke="#475569" fontSize={10} domain={['auto', 'auto']} label={{ value: 'RTT (ms)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 11 }}
                />
                <Line
                  type="monotone"
                  dataKey="rtt"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={{ r: 2, fill: '#38bdf8' }}
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
