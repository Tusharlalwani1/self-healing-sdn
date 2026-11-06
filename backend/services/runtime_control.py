"""Serialize dashboard lifecycle actions; experiments use their existing owner.

The experiment endpoint refuses to start during a dashboard transition, while
dashboard endpoints refuse changes once an experiment has acquired the runner.
"""
import asyncio
from backend.services.operation_error import OperationError

runtime_transition_lock = asyncio.Lock()


def require_manual_control():
    from backend.services.experiment_runner import experiment_runner
    if experiment_runner.is_running:
        raise OperationError(409, "Runtime controls are owned by the active experiment")
