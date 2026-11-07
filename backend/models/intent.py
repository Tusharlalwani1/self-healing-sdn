"""Service policies are evaluation metadata, not dataplane QoS instructions."""
from typing import Literal, Optional, Any
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ServiceIntent(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    profile_id: Literal['standard', 'interactive', 'reliable', 'bulk', 'custom']
    name: str = Field(min_length=1, max_length=80, pattern=r'.*\S.*')
    priority: Literal['LOW', 'NORMAL', 'HIGH', 'CRITICAL']
    require_reachability: bool = Field(strict=True)
    max_loss_percent: Optional[float] = Field(..., ge=0, le=100, allow_inf_nan=False, strict=True)
    max_avg_rtt_ms: Optional[float] = Field(..., gt=0, le=60000, allow_inf_nan=False, strict=True)

    @model_validator(mode='after')
    def meaningful(self):
        if not self.require_reachability and self.max_loss_percent is None and self.max_avg_rtt_ms is None:
            raise ValueError('Configure at least one service requirement')
        return self


class IntentSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    profile_id: Literal['standard', 'interactive', 'reliable', 'bulk', 'custom']
    custom: Optional[ServiceIntent] = None

    @model_validator(mode='after')
    def custom_policy(self):
        if self.profile_id == 'custom':
            if self.custom is None or self.custom.profile_id != 'custom':
                raise ValueError('Custom profile requires a complete custom intent')
        elif self.custom is not None:
            raise ValueError('Built-in profiles cannot override demonstration defaults; use Custom')
        return self


class RequirementResult(BaseModel):
    target: Any
    actual: Any = None
    unit: str
    status: Literal['PASS', 'FAIL', 'UNAVAILABLE']


class IntentEvaluation(BaseModel):
    evaluation_id: str
    verification_id: str
    verification_status: str
    runtime_id: str
    runtime_revision: int
    topology_id: str
    controller_mode: Optional[str] = None
    controller_generation: Optional[str] = None
    experiment_id: Optional[str] = None
    job_id: Optional[str] = None
    traffic_sequence: Optional[int] = None
    source_host: Optional[str] = None
    destination_host: Optional[str] = None
    failed_link: list[str]
    failure_timestamp: float
    intent_snapshot: Optional[ServiceIntent] = None
    evaluation_status: Literal['NOT_EVALUATED', 'EVALUATING', 'SATISFIED', 'VIOLATED', 'UNAVAILABLE']
    requirements: dict[str, RequirementResult] = Field(default_factory=dict)
    reason_code: str
    reason: str
    created_at: float
    completed_at: Optional[float] = None
    measurement_source: str = 'Recovery Verification Engine measured post-failure evidence'
    evidence: dict = Field(default_factory=dict)
    persistence_error: Optional[str] = None
