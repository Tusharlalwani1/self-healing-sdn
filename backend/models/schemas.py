from typing import List, Optional, Dict, Any, Union, Literal
from pydantic import BaseModel, Field

class ControllerInfo(BaseModel):
    id: str
    name: str
    description: str
    status: str
    features: List[str]
    is_active: bool = False

class ControllerSelectRequest(BaseModel):
    controller_type: Literal["baseline", "reactive", "fast_failover"]

class SimulationStartRequest(BaseModel):
    controller_type: Optional[Literal["baseline", "reactive", "fast_failover"]] = None

class NodeInfo(BaseModel):
    id: str
    name: str
    type: str  # 'switch' | 'host'
    dpid: Optional[int] = None
    ip: Optional[str] = None
    mac: Optional[str] = None
    ports: Dict[str, Any] = {}

class LinkInfo(BaseModel):
    id: str
    src: str
    dst: str
    src_intf: str
    dst_intf: str
    src_port: Optional[int] = None
    dst_port: Optional[int] = None
    status: str  # 'UP' | 'DOWN'
    bw: Optional[float] = 10.0
    delay: Optional[str] = "5ms"
    last_changed: Optional[float] = None

class TopologyResponse(BaseModel):
    nodes: List[NodeInfo]
    links: List[LinkInfo]
    switches: List[str]
    hosts: List[str]
    active_controller: Optional[str] = None
    simulation_state: str = "STOPPED"
    active_paths: List[List[str]] = []
    backup_paths: List[List[str]] = []

class LinkActionRequest(BaseModel):
    node1: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    node2: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")

class TrafficStartRequest(BaseModel):
    src: str = Field("h1", pattern=r"^[A-Za-z0-9_-]{1,32}$")
    dst: str = Field("h2", pattern=r"^[A-Za-z0-9_-]{1,32}$")
    interval: float = Field(0.05, gt=0, allow_inf_nan=False)
    count: int = Field(200, gt=0)
    job_id: Optional[str] = None

class TrafficStats(BaseModel):
    job_id: str
    active: bool
    transmitted: int = 0
    received: int = 0
    loss_percent: float = 0.0
    min_rtt: Optional[float] = None
    avg_rtt: Optional[float] = None
    max_rtt: Optional[float] = None
    last_rtt: Optional[float] = None
    duration_sec: float = 0.0
    history: List[Dict[str, Any]] = []

class ExperimentRunRequest(BaseModel):
    controller: Literal["baseline", "reactive", "fast_failover", "comparison"] = "reactive"
    traffic_interval: float = Field(0.02, gt=0, allow_inf_nan=False)
    packet_count: int = Field(300, gt=0)
    failure_delay_sec: float = Field(2.0, ge=0, allow_inf_nan=False)
    fail_link_src: str = "s1"
    fail_link_dst: str = "s2"
    repetitions: int = Field(1, ge=1)

class ExperimentRecord(BaseModel):
    id: str
    controller: str
    start_time: str
    end_time: Optional[str] = None
    status: str  # 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    packets_transmitted: int = 0
    packets_received: int = 0
    packet_loss_percent: float = 0.0
    avg_rtt_ms: Optional[float] = None
    min_rtt_ms: Optional[float] = None
    max_rtt_ms: Optional[float] = None
    failure_link: str = "s1-s2"
    failure_timestamp: Optional[float] = None
    recovery_event: Optional[str] = None
    recovery_duration_ms: Optional[float] = None
    summary: Dict[str, Any] = {}
