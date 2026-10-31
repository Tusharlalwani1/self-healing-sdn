from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter, HTTPException
from backend.models.schemas import ExperimentRunRequest
from backend.services.experiment_runner import experiment_runner
from backend.database.db import get_experiments, get_experiment_by_id, delete_experiment_by_id

router = APIRouter(prefix="/api/experiments", tags=["Experiments"], route_class=RuntimeRoute)

@router.post("/run")
async def run_experiment(req: ExperimentRunRequest):
    return await experiment_runner.run_experiment(
        controller_type=req.controller,
        traffic_interval=req.traffic_interval,
        packet_count=req.packet_count,
        failure_delay_sec=req.failure_delay_sec,
        fail_src=req.fail_link_src,
        fail_dst=req.fail_link_dst,
        repetitions=req.repetitions
    )

@router.post("/cancel")
async def cancel_experiment():
    experiment_runner.cancel()
    return {"status": "ok", "message": "Cancellation requested"}

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
