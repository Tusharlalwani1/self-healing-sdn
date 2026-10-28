import React, { useState, useEffect } from 'react';
import { ScrollText, Filter, RefreshCw, Search } from 'lucide-react';
import { useSDNStore } from '../stores/sdnStore';

export const EventLogsView: React.FC = () => {
  const { events, fetchEvents } = useSDNStore();
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    fetchEvents();
  }, []);

  const filtered = events.filter((ev) => {
    if (levelFilter !== 'ALL' && ev.level !== levelFilter) return false;
    if (search && !ev.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-blue-400" />
            Centralized NOC Event Logs
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Audit trail of controller events, Mininet operations, failure injections, and self-healing transitions
          </p>
        </div>

        <button
          onClick={() => fetchEvents()}
          className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition"
        >
          <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Refresh Logs</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Level Filter:</span>
          {['ALL', 'INFO', 'WARNING', 'SUCCESS', 'ERROR'].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                levelFilter === lvl
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 w-64">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search event messages..."
            className="bg-transparent text-xs text-white placeholder-slate-500 outline-none w-full"
          />
        </div>
      </div>

      {/* Log Feed Table */}
      <div className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[11px] uppercase">
              <tr>
                <th className="py-3 px-4 w-32">Timestamp</th>
                <th className="py-3 px-4 w-24">Level</th>
                <th className="py-3 px-4 w-28">Source</th>
                <th className="py-3 px-4">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filtered.map((ev, i) => (
                <tr key={ev.id || i} className="hover:bg-slate-900/40 transition">
                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                    {new Date(ev.timestamp * 1000).toLocaleTimeString()}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      ev.level === 'SUCCESS'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : ev.level === 'WARNING'
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : ev.level === 'ERROR'
                        ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    }`}>
                      {ev.level}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-400">{ev.source}</td>
                  <td className="py-3 px-4 text-slate-200 break-all">{ev.message}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-slate-500 italic">
                    No matching event logs found.
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
