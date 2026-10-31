import {
  ControllerInfo,
  ControllerType,
  TopologyResponse,
  TrafficStats,
  ExperimentRecord,
  EventLogEntry,
  SystemStatus
} from '../types';

const BASE_URL = '';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => null);
  // Also reject legacy operation-error envelopes during a backend rollout.
  if (!res.ok || data?.status === 'error' || data?.status === 'FAILED' || data?.success === false) {
    const detail = data?.detail;
    const message = typeof detail === 'string' ? detail
      : typeof detail?.message === 'string' ? detail.message
      : typeof data?.message === 'string' ? data.message
      : Array.isArray(detail) ? detail.map((item) => item.msg).filter(Boolean).join('; ')
      : `HTTP Error ${res.status}: ${res.statusText}`;
    throw new Error(message);
  }
  if (data === null) throw new Error('Invalid JSON response from backend');
  return data;
}

export const api = {
  // System
  getHealth: () => fetchJson<{ status: string }>('/api/system/health'),
  getSystemStatus: () => fetchJson<SystemStatus>('/api/system/status'),

  // Controllers
  getControllers: () => fetchJson<ControllerInfo[]>('/api/controllers'),
  selectController: (controller_type: ControllerType) =>
    fetchJson<{ status: string; controller: string; state: string }>('/api/controllers/select', {
      method: 'POST',
      body: JSON.stringify({ controller_type }),
    }),
  stopController: () => fetchJson<{ status: string }>('/api/controllers/stop', { method: 'POST' }),
  getControllerLogs: () => fetchJson<{ controller: string; logs: string[] }>('/api/controllers/logs'),

  // Simulation
  startSimulation: (controller_type?: ControllerType) =>
    fetchJson<{ status: string; message: string }>('/api/simulation/start', {
      method: 'POST',
      body: JSON.stringify({ controller_type }),
    }),
  stopSimulation: () => fetchJson<{ status: string; message: string }>('/api/simulation/stop', { method: 'POST' }),
  getSimulationStatus: () =>
    fetchJson<{ state: string; active_controller?: string; controller_status?: string; uptime: number }>(
      '/api/simulation/status'
    ),
  resetSimulation: () => fetchJson<{ status: string }>('/api/simulation/reset', { method: 'POST' }),

  // Topology
  getTopology: () => fetchJson<TopologyResponse>('/api/topology'),
  getSwitchDetails: (dpid: number) =>
    fetchJson<{ dpid: number; switch: string; flows: string[]; groups: string[]; ports: string[] }>(
      `/api/topology/switch/${dpid}`
    ),

  // Links
  setLinkDown: (node1: string, node2: string) =>
    fetchJson<{ status: string; node1: string; node2: string; link_status: string }>('/api/links/down', {
      method: 'POST',
      body: JSON.stringify({ node1, node2 }),
    }),
  setLinkUp: (node1: string, node2: string) =>
    fetchJson<{ status: string; node1: string; node2: string; link_status: string }>('/api/links/up', {
      method: 'POST',
      body: JSON.stringify({ node1, node2 }),
    }),
  restoreAllLinks: () => fetchJson<{ status: string; message: string }>('/api/links/restore-all', { method: 'POST' }),

  // Traffic
  startTraffic: (params: { src?: string; dst?: string; interval?: number; count?: number; job_id?: string }) =>
    fetchJson<{ status: string; job_id: string; active: boolean }>('/api/traffic/start', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  stopTraffic: () => fetchJson<{ status: string }>('/api/traffic/stop', { method: 'POST' }),
  getTrafficStats: () => fetchJson<TrafficStats>('/api/traffic/stats'),

  // Experiments
  runExperiment: (params: {
    controller: string;
    traffic_interval?: number;
    packet_count?: number;
    failure_delay_sec?: number;
    fail_link_src?: string;
    fail_link_dst?: string;
    repetitions?: number;
  }) =>
    fetchJson<ExperimentRecord | { id: string; type: string; results: ExperimentRecord[] }>('/api/experiments/run', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  cancelExperiment: () => fetchJson<{ status: string; message: string }>('/api/experiments/cancel', { method: 'POST' }),
  getExperimentHistory: (limit = 50) => fetchJson<ExperimentRecord[]>(`/api/experiments/history?limit=${limit}`),
  getExperiment: (id: string) => fetchJson<ExperimentRecord>(`/api/experiments/${id}`),
  deleteExperiment: (id: string) => fetchJson<{ status: string; deleted: string }>(`/api/experiments/${id}`, { method: 'DELETE' }),

  // Reports
  getExportUrl: (id: string, format: 'json' | 'csv' | 'html') => `/api/reports/${id}/export?format=${format}`,

  // Logs
  getEventLogs: (limit = 100) => fetchJson<EventLogEntry[]>(`/api/events/logs?limit=${limit}`),
};
