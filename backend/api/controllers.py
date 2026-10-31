from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter, HTTPException
from backend.models.schemas import ControllerSelectRequest
from backend.services.controller_manager import controller_manager

router = APIRouter(prefix="/api/controllers", tags=["Controllers"], route_class=RuntimeRoute)

@router.get("")
async def list_controllers():
    return await controller_manager.get_controller_info()

@router.post("/select")
async def select_controller(req: ControllerSelectRequest):
    return await controller_manager.select_controller(req.controller_type)

@router.post("/stop")
async def stop_controller():
    await controller_manager.stop_controller()
    return {"status": "ok", "message": "Controller stopped"}

@router.get("/logs")
async def get_controller_logs():
    return {
        "controller": controller_manager.active_controller,
        "logs": controller_manager.recent_logs[-100:]
    }
