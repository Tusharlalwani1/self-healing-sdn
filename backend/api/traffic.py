from fastapi import APIRouter, HTTPException
from backend.models.schemas import TrafficStartRequest
from backend.services.traffic_service import traffic_service

router = APIRouter(prefix="/api/traffic", tags=["Traffic"])

@router.post("/start")
async def start_traffic(req: TrafficStartRequest):
    try:
        return await traffic_service.start(
            src=req.src,
            dst=req.dst,
            interval=req.interval,
            count=req.count,
            job_id=req.job_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stop")
async def stop_traffic():
    try:
        return await traffic_service.stop()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_traffic_stats():
    return await traffic_service.get_stats()
