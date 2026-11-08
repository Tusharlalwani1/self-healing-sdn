"""Phase 5 policies are independent of recovery verification and service intents."""
from pydantic import BaseModel, ConfigDict, Field, model_validator


class HealthConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    healthy_additional_delay_ms: float = Field(10, ge=0, le=2000)
    critical_additional_delay_ms: float = Field(100, gt=0, le=2000)
    healthy_loss_percent: float = Field(1, ge=0, le=100)
    critical_loss_percent: float = Field(10, gt=0, le=100)
    observation_window_sec: float = Field(2, ge=1, le=30)
    min_packets: int = Field(10, ge=2, le=10000)

    @model_validator(mode='after')
    def ordered(self):
        if self.healthy_additional_delay_ms >= self.critical_additional_delay_ms or self.healthy_loss_percent >= self.critical_loss_percent:
            raise ValueError('Critical thresholds must exceed healthy thresholds')
        return self


class RuntimeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    runtime_id: str = Field(min_length=1, max_length=128)
    runtime_revision: int = Field(ge=0)


class QualityRequest(RuntimeRequest):
    src: str = Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,31}$')
    dst: str = Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,31}$')


class InjectionRequest(QualityRequest):
    additional_delay_ms: float = Field(0, ge=0, le=2000)
    loss_percent: float = Field(0, ge=0, le=100)

    @model_validator(mode='after')
    def impairment(self):
        if self.additional_delay_ms == 0 and self.loss_percent == 0:
            raise ValueError('Select nonzero delay or loss')
        return self
