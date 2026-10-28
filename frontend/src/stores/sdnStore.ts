import { create } from 'zustand';
import {
  ControllerInfo,
  ControllerType,
  SimulationState,
  TopologyNode,
  TopologyLink,
  TopologyResponse,
  TrafficStats,
  EventLogEntry,
  SystemStatus,
  ExperimentRecord
} from '../types';
import { api } from '../services/api';

export type NavigationTab =
  | 'overview'
  | 'topology'
  | 'controllers'
  | 'traffic'
  | 'simulator'
  | 'experiment'
  | 'analytics'
  | 'logs'
  | 'settings';

interface SDNState {
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
  simulationState: SimulationState;
  uptime: number;

  // Topology
  topology: TopologyResponse;
  selectedNode: TopologyNode | null;
  selectedLink: TopologyLink | null;

  // Live Traffic & Telemetry
  trafficStats: TrafficStats;

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
  setLinkStatus: (node1: string, node2: string, status: 'up' | 'down') => Promise<void>;
  restoreAllLinks: () => Promise<void>;
  startTraffic: (params?: { src?: string; dst?: string; interval?: number; count?: number }) => Promise<void>;
  stopTraffic: () => Promise<void>;
  fetchTrafficStats: () => Promise<void>;
  fetchEvents: () => Promise<void>;
  fetchExperiments: () => Promise<void>;
  runExperiment: (params: any) => Promise<any>;
  cancelExperiment: () => Promise<void>;
  handleWebSocketMessage: (data: any) => void;
  setConnected: (connected: boolean) => void;
}

export const useSDNStore = create<SDNState>((set, get) => ({
  currentTab: 'overview',
  setTab: (tab) => set({ currentTab: tab }),

  connected: false,
  systemStatus: null,
  loading: false,
  error: null,

  controllers: [],
  activeController: null,
  simulationState: 'STOPPED',
  uptime: 0,

  topology: {
    nodes: [],
    links: [],
    switches: [],
    hosts: [],
    simulation_state: 'STOPPED',
    active_paths: [],
    backup_paths: [],
  },
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
      console.error('Failed to fetch system status', e);
    }
  },

  fetchControllers: async () => {
    try {
      const list = await api.getControllers();
      const active = list.find((c) => c.is_active)?.id || null;
      set({ controllers: list, activeController: active });
    } catch (e: any) {
      console.error('Failed to fetch controllers', e);
    }
  },

  selectController: async (ctrl) => {
    set({ loading: true, error: null });
    try {
      await api.selectController(ctrl);
      await get().fetchControllers();
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  startSimulation: async (ctrl) => {
    set({ loading: true, error: null });
    try {
      await api.startSimulation(ctrl);
      set({ simulationState: 'RUNNING' });
      await get().fetchTopology();
      await get().fetchControllers();
    } catch (e: any) {
      set({ error: e.message, simulationState: 'ERROR' });
      throw e;
    } finally {
      set({ loading: false });
    }
  },

  stopSimulation: async () => {
    set({ loading: true, error: null });
    try {
      await api.stopSimulation();
      set({ simulationState: 'STOPPED' });
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  resetSimulation: async () => {
    set({ loading: true, error: null });
    try {
      await api.resetSimulation();
      set({ simulationState: 'RUNNING' });
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  fetchTopology: async () => {
    try {
      const topo = await api.getTopology();
      set({
        topology: topo,
        simulationState: topo.simulation_state,
        activeController: topo.active_controller || get().activeController,
      });
    } catch (e: any) {
      console.error('Failed to fetch topology', e);
    }
  },

  selectNode: (node) => set({ selectedNode: node }),
  selectLink: (link) => set({ selectedLink: link }),

  setLinkStatus: async (node1, node2, status) => {
    try {
      if (status === 'down') {
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
    try {
      await api.restoreAllLinks();
      await get().fetchTopology();
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  startTraffic: async (params) => {
    try {
      await api.startTraffic(params || {});
      set((s) => ({ trafficStats: { ...s.trafficStats, active: true } }));
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  stopTraffic: async () => {
    try {
      await api.stopTraffic();
      set((s) => ({ trafficStats: { ...s.trafficStats, active: false } }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  fetchTrafficStats: async () => {
    try {
      const stats = await api.getTrafficStats();
      if (stats) set({ trafficStats: stats });
    } catch (e: any) {
      console.error('Failed to fetch traffic stats', e);
    }
  },

  fetchEvents: async () => {
    try {
      const logs = await api.getEventLogs(100);
      set({ events: logs });
    } catch (e: any) {
      console.error('Failed to fetch events', e);
    }
  },

  fetchExperiments: async () => {
    try {
      const history = await api.getExperimentHistory(50);
      set({ experimentsHistory: history });
    } catch (e: any) {
      console.error('Failed to fetch experiments', e);
    }
  },

  runExperiment: async (params) => {
    set({ experimentRunning: true, experimentProgress: { status: 'STARTING', progress_percent: 5 } });
    try {
      const res = await api.runExperiment(params);
      await get().fetchExperiments();
      set({ experimentRunning: false, experimentProgress: null });
      return res;
    } catch (e: any) {
      set({ experimentRunning: false, experimentProgress: null, error: e.message });
      throw e;
    }
  },

  cancelExperiment: async () => {
    try {
      await api.cancelExperiment();
    } catch (e: any) {
      console.error('Failed to cancel experiment', e);
    }
  },

  handleWebSocketMessage: (msg: any) => {
    const { event_type } = msg;
    if (!event_type) return;

    if (event_type === 'INITIAL_STATE') {
      if (msg.controller) set({ activeController: msg.controller });
      if (msg.simulation_state) set({ simulationState: msg.simulation_state });
    } else if (event_type === 'CONTROLLER_STATUS') {
      set({
        activeController: msg.controller,
      });
      get().fetchControllers();
    } else if (event_type === 'SIMULATION_STATUS') {
      set({ simulationState: msg.state });
      get().fetchTopology();
    } else if (event_type === 'TOPOLOGY_UPDATE') {
      if (msg.topology) {
        set({
          topology: msg.topology,
          simulationState: msg.topology.simulation_state,
        });
      } else {
        get().fetchTopology();
      }
    } else if (event_type === 'LINK_FAILURE' || event_type === 'LINK_RESTORED') {
      get().fetchTopology();
    } else if (event_type === 'PATH_ACTIVE') {
      set((s) => ({
        topology: {
          ...s.topology,
          active_paths: [msg.path],
        },
      }));
    } else if (event_type === 'HEALED') {
      set((s) => ({
        topology: {
          ...s.topology,
          active_paths: [msg.new_path],
        },
      }));
      get().fetchEvents();
    } else if (event_type === 'TRAFFIC_TICK') {
      if (msg.stats) {
        set({ trafficStats: msg.stats });
      }
    } else if (event_type === 'TRAFFIC_COMPLETED') {
      if (msg.stats) {
        set({ trafficStats: { ...msg.stats, active: false } });
      }
    } else if (event_type === 'EXPERIMENT_PROGRESS') {
      set({
        experimentRunning: true,
        experimentProgress: msg,
      });
    } else if (event_type === 'EXPERIMENT_FINISHED' || event_type === 'COMPARISON_FINISHED') {
      set({
        experimentRunning: false,
        experimentProgress: null,
      });
      get().fetchExperiments();
      get().fetchTopology();
    } else if (event_type === 'LOG_LINE') {
      set((s) => {
        const nextLogs = [...s.controllerLogs, msg.line];
        if (nextLogs.length > 250) nextLogs.shift();
        return { controllerLogs: nextLogs };
      });
    }
  },
}));
