from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter
from backend.models.schemas import LinkActionRequest
from backend.services.mininet_client import mininet_client
from backend.services.runtime_control import runtime_transition_lock, require_manual_control
from backend.services.recovery_verification import verification_engine
from backend.services.traffic_service import traffic_service
import time

router = APIRouter(prefix="/api/links", tags=["Links"], route_class=RuntimeRoute)

@router.post("/down")
async def link_down(req: LinkActionRequest):
    before = traffic_service.snapshot()
    failure_context = {**mininet_client.runtime_context(), **mininet_client.controller_context()}
    failure_requested_at = time.time()
    result = await mininet_client.set_link_status(req.node1, req.node2, "down", expected_runtime=failure_context['runtime_id'])
    # A successful injection triggers observation, never a recovery claim.
    await verification_engine.begin(mininet_client,
        before.get('job_id') if before.get('active') and before.get('runtime_id') == mininet_client.runtime_id else None,
        [req.node1, req.node2], failure_requested_at, before=before if before.get('job_id') else None,
        failure_context=failure_context)
    return result

@router.post("/up")
async def link_up(req: LinkActionRequest):
    return await mininet_client.set_link_status(req.node1, req.node2, "up")

@router.post("/restore-all")
async def restore_all_links():
    async with runtime_transition_lock:
        require_manual_control()
        return await mininet_client.restore_all_links()
