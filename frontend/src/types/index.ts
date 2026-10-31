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
  bw: number;
  delay: string;
  last_changed?: number;
}

export interface TopologyResponse {
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
  job_id?: string;
  active: boolean;
  transmitted: number;
  received: number;
  loss_percent: number;
  min_rtt?: number;
  avg_rtt?: number;
  max_rtt?: number;
  last_rtt?: number;
  duration_sec: number;
  history?: {
    seq: number;
    rtt: number;
    success: boolean;
    t: number;
  }[];
}

export interface ExperimentRecord {
  id: string;
  controller: string;
  start_time: string;
  end_time?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  packets_transmitted: number;
  packets_received: number;
  packet_loss_percent: number;
  avg_rtt_ms?: number;
  min_rtt_ms?: number;
  max_rtt_ms?: number;
  failure_link: string;
  failure_timestamp?: number;
  recovery_event?: string;
  recovery_duration_ms?: number;
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
