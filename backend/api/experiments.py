from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter, HTTPException
from backend.models.schemas import ExperimentRunRequest
from backend.services.experiment_runner import experiment_runner
from backend.database.db import get_experiments, get_experiment_by_id, delete_experiment_by_id
from backend.services.runtime_control import runtime_transition_lock
from backend.services.operation_error import OperationError

router = APIRouter(prefix="/api/experiments", tags=["Experiments"], route_class=RuntimeRoute)

@router.post("/run")
async def run_experiment(req: ExperimentRunRequest):
    if runtime_transition_lock.locked():
        raise OperationError(409, "Wait for the current runtime transition before starting an experiment")
    return await experiment_runner.run_experiment(
        topology_id=req.topology_id,
        controller_type=req.controller,
        traffic_interval=req.traffic_interval,
        packet_count=req.packet_count,
        failure_delay_sec=req.failure_delay_sec,
        fail_src=req.fail_link_src,
        fail_dst=req.fail_link_dst,
        repetitions=req.repetitions, run_id=req.run_id
    )

@router.post("/cancel")
async def cancel_experiment(run_id: str = None):
    result = await experiment_runner.cancel_and_wait(run_id)
    return {"status": result["status"], "message": "Experiment finalized", "experiment": result}

@router.get("/history")
async def get_history(limit: int = 50):
    return get_experiments(limit)

@router.get("/{exp_id}")
async def get_experiment(exp_id: str):
    res = get_experiment_by_id(exp_id)
    if not res:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return res

@router.delete("/{exp_id}")
async def delete_experiment(exp_id: str):
    success = delete_experiment_by_id(exp_id)
    if not success:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {"status": "ok", "deleted": exp_id}
