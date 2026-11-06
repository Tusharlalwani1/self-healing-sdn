from backend.api.runtime_route import RuntimeRoute
import time
from fastapi import APIRouter, HTTPException
from backend.models.schemas import SimulationStartRequest
from backend.services.controller_manager import controller_manager
from backend.services.mininet_client import mininet_client
from backend.config import CONTROLLER_IP, CONTROLLER_PORT
from backend.services.runtime_control import runtime_transition_lock, require_manual_control

router = APIRouter(prefix="/api/simulation", tags=["Simulation"], route_class=RuntimeRoute)

@router.post("/start")
async def start_simulation(req: SimulationStartRequest = SimulationStartRequest()):
    async with runtime_transition_lock:
        require_manual_control()
        return await _start_runtime(req)


async def _start_runtime(req):
    ctrl_type = req.controller_type or controller_manager.active_controller or "reactive"
    topology_id = req.topology_id or mininet_client.topology_id
    # A new network must never reuse host/port/group memory from the old one.
    await controller_manager.stop_controller()
    await mininet_client.stop_simulation()
    await controller_manager.select_controller(ctrl_type, force_restart=True)
    return await mininet_client.start_simulation(CONTROLLER_IP, CONTROLLER_PORT, topology_id=topology_id)

@router.post("/stop")
async def stop_simulation():
    async with runtime_transition_lock:
        require_manual_control()
        await controller_manager.stop_controller()
        return await mininet_client.stop_simulation()

@router.get("/status")
async def get_simulation_status():
    await controller_manager.reconcile_health()
    return {
        **mininet_client.runtime_context(),
        "state": mininet_client.simulation_state,
        "active_controller": controller_manager.active_controller,
        "controller_status": controller_manager.status,
        **controller_manager.health_details(),
        "uptime": time.time() - controller_manager.started_at if controller_manager.started_at else 0.0
    }

@router.post("/reset")
async def reset_simulation():
    async with runtime_transition_lock:
        require_manual_control()
        request = SimulationStartRequest(controller_type=controller_manager.active_controller,
                                         topology_id=mininet_client.topology_id)
        return await _start_runtime(request)
