from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter, HTTPException
from backend.services.controller_manager import controller_manager
from backend.services.mininet_client import mininet_client

router = APIRouter(prefix="/api/topology", tags=["Topology"], route_class=RuntimeRoute)

@router.get("")
async def get_topology():
    topo = await mininet_client.get_topology()
    return {
        "nodes": topo.get("nodes", []),
        "links": topo.get("links", []),
        "switches": topo.get("switches", []),
        "hosts": topo.get("hosts", []),
        "active_controller": controller_manager.active_controller,
        "simulation_state": mininet_client.simulation_state,
        "active_paths": controller_manager.active_paths,
        "backup_paths": [["s1", "s3", "s4"]] if ["s1", "s2", "s4"] in controller_manager.active_paths else [["s1", "s2", "s4"]]
    }

@router.get("/switch/{dpid}")
async def get_switch_details(dpid: int):
    return await mininet_client.get_switch_info(dpid)
