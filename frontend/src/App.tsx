import React, { useEffect, useState } from "react";
import { LandingPage } from "./pages/LandingPage";
import {
  dashboardPages,
  dashboardPath,
  tabFromPath,
} from "./services/navigation";
import { useSDNStore } from "./stores/sdnStore";
import { useTopologySelectionStore } from "./stores/topologySelectionStore";
import { wsService } from "./services/websocket";

import { Sidebar } from "./components/Sidebar";
import { TopNavbar } from "./components/TopNavbar";

import { OverviewView } from "./pages/OverviewView";
import { TopologyView } from "./pages/TopologyView";
import { ControllersView } from "./pages/ControllersView";
import { TrafficView } from "./pages/TrafficView";
import { FailureSimulatorView } from "./pages/FailureSimulatorView";
import { ExperimentLabView } from "./pages/ExperimentLabView";
import { AnalyticsView } from "./pages/AnalyticsView";
import { EventLogsView } from "./pages/EventLogsView";
import { SettingsView } from "./pages/SettingsView";

const Dashboard: React.FC = () => {
  const {
    currentTab,
    fetchControllers,
    fetchTopology,
    fetchEvents,
    fetchSystemStatus,
    fetchTrafficStats,
    simulationState,
    error,
  } = useSDNStore();

  useEffect(() => {
    // Connect live WebSocket stream
    wsService.connect();
    useTopologySelectionStore.getState().fetchOptions();

    // Initial data hydration
    fetchSystemStatus();
    fetchControllers();
    fetchTopology();
    fetchEvents();

    // Periodic telemetry polling fallback
    const interval = setInterval(() => {
      fetchControllers();
      fetchTopology();
      if (simulationState === "RUNNING") {
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
      case "overview":
        return <OverviewView />;
      case "topology":
        return <TopologyView />;
      case "controllers":
        return <ControllersView />;
      case "traffic":
        return <TrafficView />;
      case "simulator":
        return <FailureSimulatorView />;
      case "experiment":
        return <ExperimentLabView />;
      case "analytics":
        return <AnalyticsView />;
      case "logs":
        return <EventLogsView />;
      case "settings":
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <div className="dashboard-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      {/* Persistent Left Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="workspace">
        {/* Persistent Top Navigation Bar */}
        <TopNavbar />
        {error && (
          <div role="alert" className="global-error">
            {error}{" "}
            <button onClick={() => useSDNStore.setState({ error: null })}>
              Dismiss
            </button>
          </div>
        )}

        {/* Scrollable Page Body */}
        <main
          id="workspace-content"
          className="workspace-content"
          tabIndex={-1}
        >
          <div key={currentTab} className="page-transition">
            {renderActiveView()}
          </div>
        </main>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => {
      const pathname = window.location.pathname;
      const tab = tabFromPath(pathname);
      if (tab) useSDNStore.setState({ currentTab: tab });
      setPath(pathname);
    };
    sync();
    window.addEventListener("popstate", sync);
    const unsubscribe = useSDNStore.subscribe((state, previous) => {
      if (
        state.currentTab !== previous.currentTab &&
        tabFromPath(window.location.pathname)
      ) {
        const next = dashboardPath(state.currentTab);
        if (next !== window.location.pathname)
          window.history.pushState(null, "", next);
        setPath(next);
        document.title = `${dashboardPages[state.currentTab]} · Self-Healing SDN`;
        document.querySelector("main")?.scrollTo(0, 0);
      }
    });
    return () => {
      window.removeEventListener("popstate", sync);
      unsubscribe();
    };
  }, []);
  const tab = tabFromPath(path);
  useEffect(() => {
    document.title = tab
      ? `${dashboardPages[tab]} · Self-Healing SDN`
      : "Self-Healing SDN · Network resilience, made visible";
  }, [tab]);
  if (path === "/") return <LandingPage />;
  if (!tab)
    return (
      <div className="route-empty">
        <h1>Page not found</h1>
        <p>This workspace URL does not exist.</p>
        <a className="button button-primary" href="/dashboard">
          Open control center
        </a>
      </div>
    );
  return <Dashboard />;
};

export default App;
