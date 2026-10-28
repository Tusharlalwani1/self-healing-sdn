import React from 'react';
import {
  Activity,
  Network,
  Cpu,
  Radio,
  ZapOff,
  FlaskConical,
  BarChart3,
  ScrollText,
  Settings,
  ShieldCheck
} from 'lucide-react';
import { useSDNStore, NavigationTab } from '../stores/sdnStore';

interface NavItem {
  id: NavigationTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

export const Sidebar: React.FC = () => {
  const { currentTab, setTab, simulationState, activeController, experimentRunning } = useSDNStore();

  const navItems: NavItem[] = [
    { id: 'overview', label: 'NOC Overview', icon: Activity },
    { id: 'topology', label: 'Network Topology', icon: Network, badge: simulationState === 'RUNNING' ? 'LIVE' : undefined },
    { id: 'controllers', label: 'Controllers', icon: Cpu, badge: activeController ? activeController.slice(0, 4).toUpperCase() : undefined },
    { id: 'traffic', label: 'Traffic Monitor', icon: Radio },
    { id: 'simulator', label: 'Failure Simulator', icon: ZapOff },
    { id: 'experiment', label: 'Experiment Lab', icon: FlaskConical, badge: experimentRunning ? 'RUN' : undefined },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'logs', label: 'Event Logs', icon: ScrollText },
    { id: 'settings', label: 'System & Config', icon: Settings },
  ];

  return (
    <aside className="w-64 h-screen bg-slate-950 border-r border-slate-800/80 flex flex-col justify-between select-none z-30 shrink-0">
      <div>
        {/* Brand header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-wide text-white uppercase flex items-center gap-1.5">
              SDN Control Center
            </h1>
            <p className="text-[11px] text-blue-400 font-medium">Self-Healing NOC</p>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="p-3 space-y-1">
          <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
            Operations & Control
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon className={`w-4 h-4 ${active ? 'text-blue-400' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-semibold rounded ${
                      item.badge === 'LIVE'
                        ? 'bg-emerald-500/20 text-emerald-400 animate-pulse'
                        : item.badge === 'RUN'
                        ? 'bg-amber-500/20 text-amber-400 animate-pulse'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/30 text-[11px] text-slate-500 space-y-1">
        <div className="flex items-center justify-between">
          <span>Engine</span>
          <span className="text-slate-300 font-mono">OpenFlow 1.3</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Controller</span>
          <span className="text-blue-400 font-mono">Ryu 4.34</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Emulator</span>
          <span className="text-slate-300 font-mono">Mininet 2.3</span>
        </div>
      </div>
    </aside>
  );
};
