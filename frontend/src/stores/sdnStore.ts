import { create } from "zustand";
import { createRequestId } from "../services/requestId";
import {
  ControllerInfo,
  ControllerType,
  ControllerStatus,
  SimulationState,
  TopologyNode,
  TopologyLink,
  TopologyResponse,
  TrafficStats,
  EventLogEntry,
  SystemStatus,
  ExperimentRecord,
  RecoveryVerification,
} from "../types";
import { api } from "../services/api";
import { emptyTraffic, acceptTraffic } from "../services/telemetry";
import {
  emptyTopology,
  mergeTopology,
  mergeTopologySnapshot,
} from "../services/topology";
import { useTopologySelectionStore } from "./topologySelectionStore";
import { isVerification } from '../services/verification';
import { isIntentEvaluation, type IntentEvaluation, type IntentSelection } from '../services/intent';

export type NavigationTab =
  | "overview"
  | "topology"
  | "controllers"
  | "traffic"
  | "simulator"
  | "experiment"
  | "analytics"
  | "logs"
  | "settings";

interface SDNState {
  intentEvaluation: IntentEvaluation | null;
  intentError: string | null;
  fetchIntentEvaluation: () => Promise<void>;
  verification: RecoveryVerification | null;
  verificationError: string | null;
  controllerGeneration: string | null;
  fetchVerification: () => Promise<void>;
  currentTab: NavigationTab;
  setTab: (tab: NavigationTab) => void;

  // System & Connection
  connected: boolean;
  systemStatus: SystemStatus | null;
  loading: boolean;
  error: string | null;

  // Controller & Simulation
  controllers: ControllerInfo[];
  activeController: ControllerType | null;
  controllerStatus: ControllerStatus;
  simulationState: SimulationState;
  uptime: number;

  // Topology
  topology: TopologyResponse;
  selectedNode: TopologyNode | null;
  selectedLink: TopologyLink | null;

  // Live Traffic & Telemetry
  trafficStats: TrafficStats;
  runtimeId: string | null;
  runtimeRevision: number;
  experimentRunId: string | null;

  // Events & Logs
  events: EventLogEntry[];
  controllerLogs: string[];

  // Active Experiment
  experimentRunning: boolean;
  experimentProgress: {
    status?: string;
    progress_percent?: number;
    message?: string;
    experiment_id?: string;
    stage?: string;
  } | null;
  experimentsHistory: ExperimentRecord[];

  // Actions
  fetchSystemStatus: () => Promise<void>;
  fetchControllers: () => Promise<void>;
  selectController: (ctrl: ControllerType) => Promise<void>;
  startSimulation: (ctrl?: ControllerType) => Promise<void>;
  stopSimulation: () => Promise<void>;
  resetSimulation: () => Promise<void>;
  fetchTopology: () => Promise<void>;
  selectNode: (node: TopologyNode | null) => void;
  selectLink: (link: TopologyLink | null) => void;
  setLinkStatus: (
    node1: string,
    node2: string,
    status: "up" | "down",
  ) => Promise<void>;
  restoreAllLinks: () => Promise<void>;
  startTraffic: (params?: {
    src?: string;
    dst?: string;
    interval?: number;
    count?: number;
    service_intent?: IntentSelection;
  }) => Promise<void>;
  stopTraffic: () => Promise<void>;
  fetchTrafficStats: () => Promise<void>;
  fetchEvents: () => Promise<void>;
  fetchExperiments: () => Promise<void>;
  runExperiment: (params: any) => Promise<any>;
  cancelExperiment: () => Promise<void>;
  handleWebSocketMessage: (data: any) => void;
  setConnected: (connected: boolean) => void;
}

// Preserve one lifecycle/controller value in the existing topology and UI fields.
function topologyState(topology: TopologyResponse) {
  useTopologySelectionStore
    .getState()
    .followRuntime(
      topology.topology_id,
      topology.simulation_state === "RUNNING",
    );
  return {
    topology,
    simulationState: topology.simulation_state,
    activeController: topology.active_controller ?? null,
  };
}

let trafficVersion = 0;
let trafficRequestId = 0;
const finishedExperimentRuns = new Set<string>();

function runtimePatch(state: SDNState, payload: any): Partial<SDNState> | null {
  if (!payload.runtime_id) return {};
  if (payload.runtime_revision < state.runtimeRevision) return null;
  if (state.runtimeId !== payload.runtime_id) {
    ++trafficVersion;
    return {
      runtimeId: payload.runtime_id,
      runtimeRevision: payload.runtime_revision,
      ...topologyState(
        mergeTopology(emptyTopology(), {
          simulation_state: state.simulationState,
          active_controller: state.activeController,
          topology_id: payload.topology_id,
          topology_label: payload.topology_label,
          active_topology_id: payload.active_topology_id,
        }),
      ),
      selectedNode: null,
      selectedLink: null,
      trafficStats: emptyTraffic(),
      verification: null, intentEvaluation: null,
      controllerGeneration: null,
    };
  }
  return {
    runtimeRevision: Math.max(
      state.runtimeRevision,
      payload.runtime_revision || 0,
    ),
  };
}

let topologyRequestId = 0;
let controllerStatusVersion = 0;
let controllerRequestId = 0;
let intentVersion = 0;
let intentRequestId = 0;
let verificationVersion = 0;
let verificationRequestId = 0;

function ownsVerification(state: SDNState, value: Pick<RecoveryVerification, 'runtime_id' | 'runtime_revision' | 'controller_mode' | 'controller_generation'>) {
  return state.simulationState === 'RUNNING' && state.controllerStatus === 'READY' && value.runtime_id === state.runtimeId &&
    value.runtime_revision === state.runtimeRevision &&
    value.controller_mode === state.activeController &&
    (!state.controllerGeneration || value.controller_generation === state.controllerGeneration);
}

function intentReplacedByTraffic(state: SDNState, stats: TrafficStats) {
  const value = state.intentEvaluation;
  return !!(stats.job_id && value?.job_id && (
    (value.traffic_sequence != null && (stats.traffic_sequence || 0) > value.traffic_sequence) ||
    (!value.experiment_id && value.job_id !== stats.job_id)));
}

function ownsIntent(state: SDNState, value: IntentEvaluation) {
  if (!ownsVerification(state, value) || !state.controllerGeneration || value.controller_generation !== state.controllerGeneration) return false;
  if (value.traffic_sequence != null && (state.trafficStats.traffic_sequence || 0) > value.traffic_sequence) return false;
  if (value.job_id && !value.experiment_id && state.trafficStats.job_id && value.job_id !== state.trafficStats.job_id) return false;
  if (value.experiment_id && state.experimentProgress?.experiment_id && value.experiment_id !== state.experimentProgress.experiment_id) return false;
  if (state.verification && state.verification.failure_timestamp > value.failure_timestamp) return false;
  const previous = state.intentEvaluation;
  if (previous && previous.failure_timestamp > value.failure_timestamp) return false;
  return !(previous?.evaluation_id === value.evaluation_id && previous.evaluation_status !== 'EVALUATING' && value.evaluation_status === 'EVALUATING');
}

export const useSDNStore = create<SDNState>((set, get) => ({
  intentEvaluation: null,
  intentError: null,
  fetchIntentEvaluation: async () => {
    const version = intentVersion, request = ++intentRequestId, runtime = get().runtimeId;
    try {
      const value = await api.getIntentEvaluation();
      if (version !== intentVersion || request !== intentRequestId || runtime !== get().runtimeId) return;
      if (value && !isIntentEvaluation(value)) throw new Error('Invalid service intent response');
      if (value && !ownsIntent(get(), value)) return;
      set({intentEvaluation:value, intentError:null});
    } catch (e: any) {
      if (version === intentVersion && request === intentRequestId && runtime === get().runtimeId) set({intentError:e.message});
    }
  },
  verification: null,
  verificationError: null,
  controllerGeneration: null,
  fetchVerification: async () => {
    const version = verificationVersion;
    const requestId = ++verificationRequestId;
    const runtime = get().runtimeId;
    try {
      const value = await api.getVerification();
      if (runtime !== get().runtimeId || version !== verificationVersion || requestId !== verificationRequestId) return;
      if (value && !isVerification(value)) throw new Error('Invalid recovery verification response');
      if (value && !ownsVerification(get(), value)) return;
      set({ verification: value, verificationError: null,
        ...(value ? {controllerGeneration: value.controller_generation} : {}) });
    } catch (e: any) {
      if (runtime === get().runtimeId && version === verificationVersion && requestId === verificationRequestId)
        set({ verificationError: e.message });
    }
  },
  runtimeId: null,
  runtimeRevision: 0,
  experimentRunId: null,
  currentTab: "overview",
  setTab: (tab) => set({ currentTab: tab }),

  connected: false,
  systemStatus: null,
  loading: false,
  error: null,

  controllers: [],
  activeController: null,
  controllerStatus: "NOT_SELECTED",
  simulationState: "STOPPED",
  uptime: 0,

  topology: emptyTopology(),
  selectedNode: null,
  selectedLink: null,

  trafficStats: {
    active: false,
    transmitted: 0,
    received: 0,
    loss_percent: 0.0,
    duration_sec: 0,
    history: [],
  },

  events: [],
  controllerLogs: [],

  experimentRunning: false,
  experimentProgress: null,
  experimentsHistory: [],

  setConnected: (connected) => set({ connected }),

  fetchSystemStatus: async () => {
    try {
      const status = await api.getSystemStatus();
      set({ systemStatus: status });
    } catch (e: any) {
      console.error("Failed to fetch system status", e);
    }
  },

  fetchControllers: async () => {
    const requestedController = get().activeController;
    const requestedVersion = controllerStatusVersion;
    const requestId = ++controllerRequestId;
    try {
      const list = await api.getControllers();
      if (
        requestedVersion !== controllerStatusVersion ||
        requestId !== controllerRequestId
      )
        return;
      const active = list.find((c) => c.is_active)?.id || null;
      set((s) => ({
        controllers: list,
        controllerStatus:
          list.find((c) => c.is_active)?.status || "NOT_SELECTED",
        ...(s.activeController === requestedController
          ? topologyState(
              mergeTopology(s.topology, { active_controller: active }),
            )
          : {}),
      }));
    } catch (e: any) {
      console.error("Failed to fetch controllers", e);
    }
  },

  selectController: async (ctrl) => {
    ++verificationVersion; ++intentVersion;
    set({ verification: null, intentEvaluation: null, controllerGeneration: null });
    set({ loading: true, error: null });
    try {
      await api.selectController(ctrl);
      await get().fetchControllers();
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
      await get().fetchControllers();
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  startSimulation: async (ctrl) => {
    const topologyId = useTopologySelectionStore.getState().selectedTopologyId;
    set({ loading: true, error: null });
    try {
      const result = await api.startSimulation(
        ctrl ?? get().activeController ?? undefined,
        topologyId,
      );
      if (topologyId === "multipath_mesh" && result.topology_id !== topologyId)
        throw new Error("Backend did not confirm the requested mesh topology");
      const patch = runtimePatch(get(), result);
      if (patch === null) return;
      set(patch);
      set((s) =>
        topologyState(
          mergeTopology(s.topology, { ...result, simulation_state: "RUNNING" }),
        ),
      );
      await get().fetchTopology();
      await get().fetchControllers();
    } catch (e: any) {
      set((s) => ({
        error: e.message,
        ...topologyState(
          mergeTopology(s.topology, { simulation_state: "ERROR" }),
        ),
      }));
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  stopSimulation: async () => {
    ++verificationVersion; ++intentVersion;
    set({ verification: null, intentEvaluation: null });
    const runtime = get().runtimeId;
    set({ loading: true, error: null });
    try {
      await api.stopSimulation();
      if (get().runtimeId !== runtime) return;
      ++trafficVersion;
      set((s) => ({
        ...topologyState(
          mergeTopology(s.topology, { simulation_state: "STOPPED" }),
        ),
        trafficStats: { ...s.trafficStats, active: false },
      }));
      await get().fetchTrafficStats();
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  resetSimulation: async () => {
    set({ loading: true, error: null });
    try {
      const result = await api.resetSimulation();
      const patch = runtimePatch(get(), result);
      if (patch === null) return;
      set(patch);
      set((s) =>
        topologyState(
          mergeTopology(s.topology, { simulation_state: "RUNNING" }),
        ),
      );
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  fetchTopology: async () => {
    const requestId = ++topologyRequestId;
    const requestedTopology = get().topology;
    try {
      const topo = await api.getTopology();
      if (requestId !== topologyRequestId) return;
      const patch = runtimePatch(get(), topo);
      if (patch === null) return;
      set((s) => ({
        ...patch,
        ...topologyState(
          mergeTopologySnapshot(
            patch.topology || s.topology,
            patch.topology || requestedTopology,
            topo,
          ),
        ),
        ...(topo.simulation_state === "STOPPED"
          ? {
              trafficStats: {
                ...(patch.trafficStats || s.trafficStats),
                active: false,
              },
            }
          : {}),
      }));
    } catch (e: any) {
      console.error("Failed to fetch topology", e);
    }
  },

  selectNode: (node) => set({ selectedNode: node }),
  selectLink: (link) => set({ selectedLink: link }),

  setLinkStatus: async (node1, node2, status) => {
    set({ error: null });
    try {
      if (status === "down") {
        await api.setLinkDown(node1, node2);
      } else {
        await api.setLinkUp(node1, node2);
      }
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  restoreAllLinks: async () => {
    set({ error: null });
    try {
      await api.restoreAllLinks();
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
      await get().fetchTopology();
      throw e;
    }
  },

  startTraffic: async (params) => {
    const action = ++trafficVersion;
    const runtime = get().runtimeId;
    set({ error: null });
    try {
      const result = await api.startTraffic(params || {});
      if (get().runtimeId !== runtime || action !== trafficVersion) return;
      ++intentVersion;
      set({intentEvaluation:null});
      if (get().trafficStats.job_id === result.job_id) return;
      set({
        trafficStats: {
          ...result,
          job_id: result.job_id,
          active: true,
          transmitted: 0,
          received: 0,
          loss_percent: 0,
          duration_sec: 0,
          history: [],
          min_rtt: null,
          avg_rtt: null,
          max_rtt: null,
          last_rtt: null,
          accounting_complete: false,
        },
      });
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  stopTraffic: async () => {
    const job = get().trafficStats.job_id;
    const runtime = get().runtimeId;
    try {
      const result = await api.stopTraffic();
      if (get().trafficStats.job_id !== job || get().runtimeId !== runtime)
        return;
      ++trafficVersion;
      set((s) => ({
        trafficStats: { ...s.trafficStats, ...result, active: false },
      }));
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  fetchTrafficStats: async () => {
    const version = trafficVersion;
    const request = ++trafficRequestId;
    const runtime = get().runtimeId;
    try {
      const stats = await api.getTrafficStats();
      if (
        version !== trafficVersion ||
        runtime !== get().runtimeId ||
        request !== trafficRequestId
      )
        return;
      if (!get().runtimeId && stats.runtime_id)
        set(runtimePatch(get(), stats) || {});
      if (
        stats &&
        acceptTraffic(
          get().trafficStats,
          stats,
          get().runtimeId,
          get().simulationState === "RUNNING",
          true,
        )
      ) {
        if (intentReplacedByTraffic(get(), stats)) {
          ++intentVersion;
          set({intentEvaluation:null});
        }
        set({ trafficStats: stats });
      }
    } catch (e: any) {
      console.error("Failed to fetch traffic stats", e);
    }
  },

  fetchEvents: async () => {
    try {
      const logs = await api.getEventLogs(100);
      set({ events: logs });
    } catch (e: any) {
      console.error("Failed to fetch events", e);
    }
  },

  fetchExperiments: async () => {
    try {
      const history = await api.getExperimentHistory(50);
      set({ experimentsHistory: history });
    } catch (e: any) {
      console.error("Failed to fetch experiments", e);
    }
  },

  runExperiment: async (params) => {
    if (get().experimentRunning)
      throw new Error("An experiment is already in progress");
    const runId = createRequestId();
    set({
      experimentRunId: runId,
      experimentRunning: true,
      experimentProgress: { status: "STARTING", progress_percent: 5 },
    });
    try {
      const res = await api.runExperiment({
        ...params,
        topology_id:
          params.topology_id ||
          useTopologySelectionStore.getState().selectedTopologyId,
        run_id: runId,
      });
      await get().fetchExperiments();
      const alreadyFinal = finishedExperimentRuns.has(runId);
      finishedExperimentRuns.add(runId);
      if (get().experimentRunId === runId && !alreadyFinal)
        set({
          experimentRunning: false,
          experimentProgress: {
            status: res.status || "COMPLETED",
            progress_percent: 100,
          },
        });
      return res;
    } catch (e: any) {
      const alreadyFinal = finishedExperimentRuns.has(runId);
      finishedExperimentRuns.add(runId);
      if (get().experimentRunId === runId && !alreadyFinal)
        set({
          experimentRunning: false,
          experimentProgress: { status: "FAILED" },
          error: e.message,
        });
      throw e;
    }
  },

  cancelExperiment: async () => {
    const runId = get().experimentRunId;
    if (!runId) throw new Error("No active experiment");
    set({
      experimentProgress: {
        ...get().experimentProgress,
        status: "CANCELLING",
        message: "Waiting for experiment cleanup...",
      },
    });
    try {
      const res = await api.cancelExperiment(runId);
      finishedExperimentRuns.add(runId);
      if (get().experimentRunId === runId)
        set({
          experimentRunning: false,
          experimentProgress: { status: res.status, progress_percent: 100 },
        });
      await get().fetchExperiments();
    } catch (e: any) {
      if (get().experimentRunId === runId)
        set({
          error: e.message,
          experimentProgress: finishedExperimentRuns.has(runId)
            ? get().experimentProgress
            : { status: "RUNNING", message: e.message },
        });
      throw e;
    }
  },

  handleWebSocketMessage: (msg: any) => {
    const { event_type } = msg;
    if (!event_type) return;
    if (event_type === 'INTENT_EVALUATION') {
      const value = msg.evaluation;
      if (!isIntentEvaluation(value) || !ownsIntent(get(), value)) return;
      ++intentVersion;
      set({intentEvaluation:value, intentError:null});
      return;
    }
    if (event_type === 'RECOVERY_VERIFICATION') {
      const value = msg.verification as RecoveryVerification | undefined;
      if (!isVerification(value) || !ownsVerification(get(), value) ||
          !get().controllerGeneration || value.controller_generation !== get().controllerGeneration) return;
      const previous = get().verification;
      if (previous && previous.verification_id === value.verification_id &&
          previous.verification_status !== 'VERIFYING' && value.verification_status === 'VERIFYING') return;
      if (previous && previous.failure_timestamp > value.failure_timestamp) return;
      ++verificationVersion; ++intentVersion;
      set({ verification: value, verificationError: null });
      return;
    }
    if (event_type === 'CONTROLLER_STATUS') {
      ++verificationVersion; ++intentVersion;
      set({ verification: null, intentEvaluation: null, controllerGeneration: msg.controller_generation ?? null });
    }
    if (
      ["INITIAL_STATE", "SIMULATION_STATUS", "TOPOLOGY_UPDATE"].includes(
        event_type,
      )
    ) {
      const patch = runtimePatch(
        get(),
        event_type === "TOPOLOGY_UPDATE" ? msg.topology || {} : msg,
      );
      if (patch === null) return;
      set(patch);
      if (event_type === 'SIMULATION_STATUS' && msg.state !== 'RUNNING') {
        ++verificationVersion; ++intentVersion;
        set({ verification: null, intentEvaluation: null });
      }
    }

    if (event_type === "INITIAL_STATE") {
      ++verificationVersion; ++intentVersion;
      set({ controllerGeneration: msg.controller_generation ?? null, verification: null, intentEvaluation: null });
      if (
        "experiment_run_id" in msg &&
        (!get().experimentRunning ||
          get().experimentRunId === msg.experiment_run_id)
      ) {
        set({
          experimentRunId: msg.experiment_run_id || null,
          experimentRunning: !!msg.experiment_run_id,
          ...(!msg.experiment_run_id ? { experimentProgress: null } : {}),
        });
      }
      if (
        msg.traffic &&
        acceptTraffic(
          get().trafficStats,
          msg.traffic,
          get().runtimeId,
          msg.simulation_state === "RUNNING",
          true,
        )
      ) {
        set({
          trafficStats: {
            ...msg.traffic,
            active: msg.simulation_state === "RUNNING" && msg.traffic.active,
          },
        });
      }
      if (msg.controller_status) {
        ++controllerStatusVersion;
        set((s) => ({
          controllerStatus: msg.controller_status,
          controllers: s.controllers.map((controller) => ({
            ...controller,
            status:
              controller.id === msg.controller
                ? msg.controller_status
                : "STOPPED",
          })),
          ...(msg.controller_status === "FAILED"
            ? { error: msg.failure_reason || "Controller failed" }
            : {}),
        }));
      }
      // Adopt only after lifecycle and runtime hydration below; a follow-up
      // REST request is also guarded against newer WebSocket transitions.
      set((s) =>
        topologyState(
          mergeTopology(s.topology, {
            topology_id: msg.topology_id,
            topology_label: msg.topology_label,
            active_topology_id: msg.active_topology_id,
            active_controller: msg.controller,
            simulation_state: msg.simulation_state,
            active_paths: msg.active_paths,
          }),
        ),
      );
      if (isVerification(msg.verification) && ownsVerification(get(), msg.verification))
        set({ verification: msg.verification });
      if (isIntentEvaluation(msg.intent_evaluation) && ownsIntent(get(), msg.intent_evaluation))
        set({intentEvaluation:msg.intent_evaluation, intentError:null});
    } else if (event_type === "CONTROLLER_STATUS") {
      ++controllerStatusVersion;
      set((s) => ({
        controllerStatus: msg.status || s.controllerStatus,
        controllers: s.controllers.map((controller) => ({
          ...controller,
          status: controller.id === msg.controller ? msg.status : "STOPPED",
          ...(controller.id === msg.controller
            ? {
                pid: msg.pid,
                exit_code: msg.exit_code,
                failure_reason: msg.failure_reason || msg.error,
              }
            : {}),
        })),
        ...(msg.status === "FAILED"
          ? { error: msg.error || "Controller switch failed" }
          : {}),
      }));
      set((s) =>
        topologyState(
          mergeTopology(s.topology, { active_controller: msg.controller }),
        ),
      );
      get().fetchControllers();
    } else if (event_type === "SIMULATION_STATUS") {
      if (msg.state === "STOPPED") {
        ++trafficVersion;
        set((s) => ({ trafficStats: { ...s.trafficStats, active: false } }));
      }
      set((s) =>
        topologyState(
          mergeTopology(s.topology, {
            simulation_state: msg.state,
            topology_id: msg.topology_id,
            topology_label: msg.topology_label,
            active_topology_id: msg.active_topology_id,
            ...(msg.state === "STOPPED"
              ? {
                  nodes: [],
                  links: [],
                  switches: [],
                  hosts: [],
                  active_paths: [],
                }
              : {}),
          }),
        ),
      );
      get().fetchTopology();
    } else if (event_type === "TOPOLOGY_UPDATE") {
      if (msg.topology) {
        set((s) => topologyState(mergeTopology(s.topology, msg.topology)));
      } else {
        get().fetchTopology();
      }
    } else if (
      event_type === "LINK_FAILURE" ||
      event_type === "LINK_RESTORED"
    ) {
      get().fetchTopology();
    } else if (event_type === "PATH_ACTIVE") {
      // Legacy controller-log messages never verified dataplane forwarding.
      set((s) =>
        topologyState(mergeTopology(s.topology, { active_paths: [] })),
      );
    } else if (event_type === "HEALED") {
      // Controller reconfiguration timing remains valid; delivery is unverified.
      set((s) =>
        topologyState(mergeTopology(s.topology, { active_paths: [] })),
      );
      get().fetchEvents();
    } else if (
      ["TRAFFIC_STARTED", "TRAFFIC_TICK", "TRAFFIC_COMPLETED"].includes(
        event_type,
      )
    ) {
      const stats =
        event_type === "TRAFFIC_COMPLETED"
          ? { ...msg.stats, active: false }
          : msg.stats;
      if (!get().runtimeId && stats?.runtime_id)
        set(runtimePatch(get(), stats) || {});
      if (
        stats &&
        acceptTraffic(
          get().trafficStats,
          stats,
          get().runtimeId,
          get().simulationState === "RUNNING",
          event_type === "TRAFFIC_STARTED" || !get().runtimeId,
        )
      ) {
        if (event_type === "TRAFFIC_STARTED") ++trafficVersion;
        if (intentReplacedByTraffic(get(), stats)) {
          ++intentVersion;
          set({intentEvaluation:null});
        }
        set({ trafficStats: stats });
      }
    } else if (event_type === "EXPERIMENT_PROGRESS") {
      if (
        get().experimentProgress?.status === "CANCELLING" &&
        msg.run_id === get().experimentRunId
      )
        return;
      if (msg.run_id) {
        if (finishedExperimentRuns.has(msg.run_id)) return;
        if (
          get().experimentRunId &&
          get().experimentRunId !== msg.run_id &&
          get().experimentRunning
        )
          return;
        if (
          !get().experimentRunning &&
          msg.status !== "PREPARING" &&
          !msg.comparison_id
        )
          return;
        set({ experimentRunId: msg.run_id });
      }
      set({
        experimentRunning: true,
        experimentProgress: msg,
      });
    } else if (
      event_type === "EXPERIMENT_FINISHED" ||
      event_type === "COMPARISON_FINISHED"
    ) {
      if (msg.run_id && finishedExperimentRuns.has(msg.run_id)) return;
      if (msg.run_id && msg.run_id !== get().experimentRunId) {
        finishedExperimentRuns.add(msg.run_id);
        return;
      }
      if (msg.run_id) finishedExperimentRuns.add(msg.run_id);
      set({
        experimentRunning: false,
        experimentProgress: {
          status:
            msg.experiment?.status ||
            msg.comparison?.status ||
            (msg.error ? "FAILED" : "COMPLETED"),
          progress_percent: 100,
        },
      });
      if (msg.error) set({ error: msg.error });
      get().fetchExperiments();
      get().fetchTopology();
    } else if (event_type === "LOG_LINE") {
      set((s) => {
        const nextLogs = [...s.controllerLogs, msg.line];
        if (nextLogs.length > 250) nextLogs.shift();
        return { controllerLogs: nextLogs };
      });
    }
  },
}));
