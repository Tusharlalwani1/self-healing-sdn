from backend.api.runtime_route import RuntimeRoute
import time
from fastapi import APIRouter, HTTPException
from backend.models.schemas import SimulationStartRequest
from backend.services.controller_manager import controller_manager
from backend.services.mininet_client import mininet_client
from backend.config import CONTROLLER_IP, CONTROLLER_PORT

router = APIRouter(prefix="/api/simulation", tags=["Simulation"], route_class=RuntimeRoute)

@router.post("/start")
async def start_simulation(req: SimulationStartRequest = SimulationStartRequest()):
    # 1. Start controller first if not already running
    ctrl_type = req.controller_type or controller_manager.active_controller or "reactive"
    # Shared lifecycle revalidates the managed process/listener even when a
    # stored READY value predates an exit. Healthy same-mode selection is a no-op.
    await controller_manager.select_controller(ctrl_type)

    # 2. Start Mininet simulation connected to the controller
    res = await mininet_client.start_simulation(CONTROLLER_IP, CONTROLLER_PORT)
    return res

@router.post("/stop")
async def stop_simulation():
    return await mininet_client.stop_simulation()

@router.get("/status")
async def get_simulation_status():
    await controller_manager.reconcile_health()
    return {
        "state": mininet_client.simulation_state,
        "active_controller": controller_manager.active_controller,
        "controller_status": controller_manager.status,
        **controller_manager.health_details(),
        "uptime": time.time() - controller_manager.started_at if controller_manager.started_at else 0.0
    }

@router.post("/reset")
async def reset_simulation():
    await mininet_client.stop_simulation()
    return await mininet_client.start_simulation(CONTROLLER_IP, CONTROLLER_PORT)
