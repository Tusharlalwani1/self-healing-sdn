from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class RecoveryVerification(BaseModel):
    service_intent: Optional[dict] = None
    traffic_sequence: Optional[int] = None
    verification_id: str
    incident_id: Optional[str] = None
    runtime_id: str
    runtime_revision: int
    topology_id: str
    controller_mode: Optional[str] = None
    controller_generation: Optional[str] = None
    experiment_id: Optional[str] = None
    job_id: Optional[str] = None
    source_host: Optional[str] = None
    destination_host: Optional[str] = None
    failed_link: List[str]
    failure_timestamp: float
    verification_started_at: Optional[float] = None
    verification_completed_at: Optional[float] = None
    verification_duration_sec: Optional[float] = None
    verification_status: Literal['NOT_STARTED', 'VERIFYING', 'VERIFIED', 'DEGRADED', 'FAILED']
    post_recovery_tx: Optional[int] = None
    post_recovery_rx: Optional[int] = None
    post_recovery_loss_percent: Optional[float] = None
    post_recovery_avg_rtt_ms: Optional[float] = None
    post_recovery_min_rtt_ms: Optional[float] = None
    post_recovery_max_rtt_ms: Optional[float] = None
    reachability_restored: Optional[bool] = None
    stability_passed: Optional[bool] = None
    path_verification_status: Literal['UNAVAILABLE'] = 'UNAVAILABLE'
    path_verification_reason: str = 'Computed path != installed path != observed dataplane path; no path-level verification is collected.'
    reason_code: str
    reason: str
    config: Dict[str, Any] = Field(default_factory=dict)
    before: Optional[Dict[str, Any]] = None
    during: Dict[str, Any] = Field(default_factory=dict)
    evidence: Dict[str, Any] = Field(default_factory=dict)
    evidence_scope: str = 'Post-failure counter-bounded service observation; not exact outage or local FF switching time.'
    persistence_error: Optional[str] = None
