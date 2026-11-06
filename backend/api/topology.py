from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter, HTTPException
from backend.services.controller_manager import controller_manager
from backend.services.mininet_client import mininet_client
from backend.services.topology_catalog import topology_options

router = APIRouter(prefix="/api/topology", tags=["Topology"], route_class=RuntimeRoute)

@router.get("/options")
async def get_topology_options():
    return topology_options()

@router.get("")
async def get_topology():
    topo = await mininet_client.get_topology()
    return {
        **mininet_client.runtime_context(),
        "nodes": topo.get("nodes", []),
        "links": topo.get("links", []),
        "switches": topo.get("switches", []),
        "hosts": topo.get("hosts", []),
        "active_controller": controller_manager.active_controller,
        "simulation_state": mininet_client.simulation_state,
        # No dataplane path verification is currently collected. PacketIn path
        # calculations and recovery logs must not masquerade as active routes.
        "active_paths": [],
        # No verified backup-route telemetry is currently collected.
        "backup_paths": []
    }

@router.get("/switch/{dpid}")
async def get_switch_details(dpid: int):
    return await mininet_client.get_switch_info(dpid)
