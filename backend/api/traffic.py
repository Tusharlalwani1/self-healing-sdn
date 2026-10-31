from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter, HTTPException
from backend.models.schemas import TrafficStartRequest
from backend.services.traffic_service import traffic_service

router = APIRouter(prefix="/api/traffic", tags=["Traffic"], route_class=RuntimeRoute)

@router.post("/start")
async def start_traffic(req: TrafficStartRequest):
    return await traffic_service.start(
        src=req.src,
        dst=req.dst,
        interval=req.interval,
        count=req.count,
        job_id=req.job_id
    )

@router.post("/stop")
async def stop_traffic():
    return await traffic_service.stop()

@router.get("/stats")
async def get_traffic_stats():
    return await traffic_service.get_stats()
