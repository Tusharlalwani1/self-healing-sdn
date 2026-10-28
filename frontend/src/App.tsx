import React, { useEffect } from 'react';
import { useSDNStore } from './stores/sdnStore';
import { wsService } from './services/websocket';

import { Sidebar } from './components/Sidebar';
import { TopNavbar } from './components/TopNavbar';

import { OverviewView } from './pages/OverviewView';
import { TopologyView } from './pages/TopologyView';
import { ControllersView } from './pages/ControllersView';
import { TrafficView } from './pages/TrafficView';
import { FailureSimulatorView } from './pages/FailureSimulatorView';
import { ExperimentLabView } from './pages/ExperimentLabView';
import { AnalyticsView } from './pages/AnalyticsView';
import { EventLogsView } from './pages/EventLogsView';
import { SettingsView } from './pages/SettingsView';

export const App: React.FC = () => {
  const {
    currentTab,
    fetchControllers,
    fetchTopology,
    fetchEvents,
    fetchSystemStatus,
    fetchTrafficStats,
    simulationState
  } = useSDNStore();

  useEffect(() => {
    // Connect live WebSocket stream
    wsService.connect();

    // Initial data hydration
    fetchSystemStatus();
    fetchControllers();
    fetchTopology();
    fetchEvents();

    // Periodic telemetry polling fallback
    const interval = setInterval(() => {
      fetchTopology();
      if (simulationState === 'RUNNING') {
        fetchTrafficStats();
      }
    }, 3000);

    return () => {
      clearInterval(interval);
      wsService.disconnect();
    };
  }, [simulationState]);

  const renderActiveView = () => {
    switch (currentTab) {
      case 'overview':
        return <OverviewView />;
      case 'topology':
        return <TopologyView />;
      case 'controllers':
        return <ControllersView />;
      case 'traffic':
        return <TrafficView />;
      case 'simulator':
        return <FailureSimulatorView />;
      case 'experiment':
        return <ExperimentLabView />;
      case 'analytics':
        return <AnalyticsView />;
      case 'logs':
        return <EventLogsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#030712] text-slate-100 overflow-hidden font-sans">
      {/* Persistent Left Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Persistent Top Navigation Bar */}
        <TopNavbar />

        {/* Scrollable Page Body */}
        <main className="flex-1 overflow-y-auto bg-gradient-to-b from-slate-950/40 to-slate-950">
          {renderActiveView()}
        </main>
      </div>
    </div>
  );
};

export default App;
