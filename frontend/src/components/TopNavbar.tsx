import { Play, Square, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useSDNStore } from "../stores/sdnStore";
import type { ControllerType } from "../types";
import { Status } from "./ui/Primitives";
import { TopologySelector } from "./TopologySelector";

export function TopNavbar() {
  const {
    connected,
    simulationState,
    activeController,
    controllerStatus,
    controllers,
    selectController,
    startSimulation,
    stopSimulation,
    restoreAllLinks,
    loading,
    experimentRunning,
    experimentProgress,
  } = useSDNStore();
  const failed = simulationState === "RUNNING" && controllerStatus === "FAILED";
  const status = failed
    ? "MININET RUNNING / CONTROLLER FAILED"
    : simulationState === "RUNNING"
      ? "SIMULATION RUNNING"
      : simulationState === "STARTING"
        ? "STARTING MININET..."
        : simulationState === "STOPPING"
          ? "STOPPING MININET..."
          : simulationState === "ERROR"
            ? "SIMULATION ERROR"
            : "SIMULATION STOPPED";
  return (
    <header className="runtime-bar">
      <div className="runtime-status">
        <span className="eyebrow">RUNTIME</span>
        <Status
          tone={
            failed || simulationState === "ERROR"
              ? "bad"
              : simulationState === "RUNNING"
                ? "good"
                : simulationState === "STARTING"
                  ? "warning"
                  : "neutral"
          }
        >
          {status}
        </Status>
      </div>
      <TopologySelector />
      <label className="controller-picker">
        <span key={controllerStatus} className="state-label">
          Controller <small>({controllerStatus})</small>
        </span>
        <select
          aria-label="Active controller"
          value={activeController || ""}
          disabled={loading || experimentRunning}
          onChange={(e) => {
            if (e.target.value)
              selectController(e.target.value as ControllerType).catch(
                console.error,
              );
          }}
        >
          <option value="" disabled>
            Select Controller
          </option>
          {controllers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {experimentRunning && (
        <div className="runtime-experiment" role="status">
          {experimentProgress?.status || "Experiment Running..."}
          {experimentProgress?.progress_percent !== undefined && (
            <small>Stage {experimentProgress.progress_percent}%</small>
          )}
        </div>
      )}
      <div className="runtime-actions">
        {simulationState === "RUNNING" && (
          <button
            className="button button-quiet"
            onClick={() => restoreAllLinks().catch(console.error)}
            title="Restore all physical links to UP"
          >
            <RefreshCw size={15} />
            Restore All Links
          </button>
        )}
        <button
          className={`button ${simulationState === "RUNNING" ? "button-danger" : "button-primary"}`}
          disabled={loading || experimentRunning}
          onClick={() =>
            (simulationState === "RUNNING"
              ? stopSimulation()
              : startSimulation()
            ).catch(console.error)
          }
        >
          {simulationState === "RUNNING" ? (
            <Square size={14} />
          ) : (
            <Play size={14} />
          )}{" "}
          {simulationState === "RUNNING"
            ? "Stop Simulation"
            : "Start Simulation"}
        </button>
      </div>
      <div
        key={String(connected)}
        className="socket-status state-label"
        title={
          connected
            ? "WebSocket connected; measurements may be historical or unavailable"
            : "WebSocket disconnected; retrying"
        }
      >
        {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
        <span>{connected ? "WS CONNECTED" : "OFFLINE"}</span>
      </div>
    </header>
  );
}
