export type ControllerType = 'baseline' | 'reactive' | 'fast_failover';
export type SimulationState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR';
export type ControllerStatus = 'NOT_SELECTED' | 'STARTING' | 'READY' | 'FAILED' | 'STOPPED';

export interface ControllerInfo {
  id: ControllerType;
  name: string;
  description: string;
  status: ControllerStatus;
  features: string[];
  is_active: boolean;
  pid?: number | null;
  exit_code?: number | null;
  failure_reason?: string | null;
}

export interface NodePort {
  port_no?: number;
  up: boolean;
  ip?: string;
  mac?: string;
}

export interface TopologyNode {
  id: string;
  name: string;
  type: 'switch' | 'host';
  dpid?: number;
  ip?: string;
  mac?: string;
  ports: Record<string, NodePort>;
}

export interface TopologyLink {
  id: string;
  src: string;
  dst: string;
  src_intf: string;
  dst_intf: string;
  src_port?: number;
  dst_port?: number;
  status: 'UP' | 'DOWN';
  bw?: number | null;
  delay?: string | null;
  last_changed?: number;
}

export interface TopologyResponse {
  runtime_id?: string;
  runtime_revision?: number;
  nodes: TopologyNode[];
  links: TopologyLink[];
  switches: string[];
  hosts: string[];
  active_controller?: ControllerType | null;
  simulation_state: SimulationState;
  active_paths: string[][];
  backup_paths: string[][];
}

export interface TrafficStats {
  runtime_id?: string;
  runtime_revision?: number;
  traffic_sequence?: number;
  controller?: string | null;
  controller_generation?: string | null;
  controller_changed?: boolean;
  experiment_id?: string | null;
  accounting_complete?: boolean;
  job_id?: string | null;
  active: boolean;
  transmitted: number;
  received: number;
  loss_percent: number;
  min_rtt?: number | null;
  avg_rtt?: number | null;
  max_rtt?: number | null;
  last_rtt?: number | null;
  duration_sec: number;
  history?: {
    seq: number;
    rtt: number;
    success: boolean;
    t: number;
  }[];
}

export interface ExperimentRecord {
  run_id?: string;
  id: string;
  controller: string;
  start_time: string;
  end_time?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  packets_transmitted: number | null;
  packets_received: number | null;
  packet_loss_percent: number | null;
  avg_rtt_ms?: number | null;
  min_rtt_ms?: number | null;
  max_rtt_ms?: number | null;
  failure_link: string;
  failure_timestamp?: number;
  recovery_event?: string;
  recovery_duration_ms?: number | null;
  summary: Record<string, any>;
}

export interface EventLogEntry {
  id?: number;
  timestamp: number;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS';
  source: 'CONTROLLER' | 'MININET' | 'EXPERIMENT' | 'SYSTEM' | 'TRAFFIC';
  message: string;
  details?: Record<string, any>;
}

export interface SystemStatus {
  os: string;
  python_version: string;
  venv_python: string;
  mininet_available: boolean;
  ovs_service_running: boolean;
  openflow_port_active: boolean;
  controller_port: number;
}
