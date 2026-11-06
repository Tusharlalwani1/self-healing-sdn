from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter
from backend.models.schemas import LinkActionRequest
from backend.services.mininet_client import mininet_client
from backend.services.runtime_control import runtime_transition_lock, require_manual_control

router = APIRouter(prefix="/api/links", tags=["Links"], route_class=RuntimeRoute)

@router.post("/down")
async def link_down(req: LinkActionRequest):
    return await mininet_client.set_link_status(req.node1, req.node2, "down")

@router.post("/up")
async def link_up(req: LinkActionRequest):
    return await mininet_client.set_link_status(req.node1, req.node2, "up")

@router.post("/restore-all")
async def restore_all_links():
    async with runtime_transition_lock:
        require_manual_control()
        return await mininet_client.restore_all_links()
