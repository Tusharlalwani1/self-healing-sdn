"""Generic Phase 3 quality defaults, not application SLA standards."""
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class VerificationConfig:
    timeout_sec: float = 8.0
    observation_sec: float = 2.0
    reply_grace_sec: float = 1.0
    poll_sec: float = 0.25
    min_attempted: int = 20
    min_received: int = 5
    max_loss_percent: float = 5.0
    max_avg_rtt_ms: float = 100.0
    require_rtt: bool = False

    def __post_init__(self):
        import math
        if (any(not math.isfinite(v) or v <= 0 for v in
                (self.timeout_sec, self.observation_sec, self.reply_grace_sec, self.poll_sec, self.max_avg_rtt_ms)) or
            self.timeout_sec <= self.observation_sec + self.reply_grace_sec or
            self.min_attempted < 2 or self.min_received < 2 or
            not 0 <= self.max_loss_percent <= 100):
            raise ValueError('Invalid recovery verification configuration')

    def as_dict(self):
        return asdict(self)


VERIFICATION_CONFIG = VerificationConfig()
