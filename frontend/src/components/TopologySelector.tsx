import { useSDNStore } from "../stores/sdnStore";
import {
  useTopologySelectionStore,
  topologyLabel,
} from "../stores/topologySelectionStore";
import type { TopologyId } from "../types";

export function TopologySelector() {
  const { simulationState, loading, experimentRunning } = useSDNStore();
  const { selectedTopologyId, selectTopology, options, error } =
    useTopologySelectionStore();
  return (
    <label className="controller-picker">
      <span>
        Topology{" "}
        {error && <small role="alert">Catalog unavailable: {error}</small>}
      </span>
      <select
        aria-label="Network topology"
        value={selectedTopologyId}
        disabled={
          loading ||
          experimentRunning ||
          simulationState === "RUNNING" ||
          simulationState === "STARTING" ||
          simulationState === "STOPPING" ||
          !options.length
        }
        onChange={(e) => selectTopology(e.target.value as TopologyId)}
      >
        {options.length ? (
          options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))
        ) : (
          <option value={selectedTopologyId}>
            {topologyLabel(selectedTopologyId)}
          </option>
        )}
      </select>
    </label>
  );
}
