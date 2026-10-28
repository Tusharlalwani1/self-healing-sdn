import time
from fastapi import APIRouter, HTTPException
from backend.models.schemas import SimulationStartRequest
from backend.services.controller_manager import controller_manager
from backend.services.mininet_client import mininet_client
from backend.config import CONTROLLER_IP, CONTROLLER_PORT

router = APIRouter(prefix="/api/simulation", tags=["Simulation"])

@router.post("/start")
async def start_simulation(req: SimulationStartRequest = SimulationStartRequest()):
    try:
        # 1. Start controller first if not already running
        ctrl_type = req.controller_type or controller_manager.active_controller or "reactive"
        if controller_manager.active_controller != ctrl_type or controller_manager.status != "READY":
            await controller_manager.select_controller(ctrl_type)

        # 2. Start Mininet simulation connected to the controller
        res = await mininet_client.start_simulation(CONTROLLER_IP, CONTROLLER_PORT)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stop")
async def stop_simulation():
    try:
        return await mininet_client.stop_simulation()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def get_simulation_status():
    return {
        "state": mininet_client.simulation_state,
        "active_controller": controller_manager.active_controller,
        "controller_status": controller_manager.status,
        "uptime": time.time() - controller_manager.started_at if controller_manager.started_at else 0.0
    }

@router.post("/reset")
async def reset_simulation():
    await mininet_client.stop_simulation()
    return await mininet_client.start_simulation(CONTROLLER_IP, CONTROLLER_PORT)
