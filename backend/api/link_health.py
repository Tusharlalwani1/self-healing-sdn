from fastapi import APIRouter, Query
from backend.api.intent_route import IntentRoute
from backend.models.link_health import HealthConfig, InjectionRequest, QualityRequest, RuntimeRequest
from backend.services.link_health import link_health
from backend.services.operation_error import OperationError
from backend.services.runtime_control import runtime_transition_lock, require_manual_control
from backend.database.db import get_degradation_incidents

router = APIRouter(prefix='/api', tags=['Link Health'], route_class=IntentRoute)


@router.get('/link-health')
async def all_health():
    if link_health.client.simulation_state != 'RUNNING':
        return link_health.current()
    return await link_health.sample()


@router.get('/link-health/{src}/{dst}')
async def one_health(src: str, dst: str):
    snapshot = await link_health.sample()
    for record in snapshot['links']:
        if {record['src'], record['dst']} == {src, dst}:
            return record
    raise OperationError(404, 'Inter-switch link not found in active runtime')


async def mutate(command, request):
    async with runtime_transition_lock:
        require_manual_control()
        return await link_health.mutate(command, request.model_dump())


@router.post('/degradation/inject')
async def inject(request: InjectionRequest):
    return await mutate('inject_degradation', request)


@router.post('/degradation/clear')
async def clear(request: QualityRequest):
    return await mutate('clear_degradation', request)


@router.post('/degradation/clear-all')
async def clear_all(request: RuntimeRequest):
    return await mutate('clear_all_degradations', request)


@router.get('/degradation/incidents')
async def incidents(limit: int = Query(50, ge=1, le=500)):
    return get_degradation_incidents(limit)


@router.get('/degradation/config')
async def config():
    return {'label': 'Project demonstration thresholds', **link_health.config.model_dump()}


@router.put('/degradation/config')
async def set_config(request: HealthConfig):
    async with runtime_transition_lock:
        require_manual_control()
        return await link_health.update_config(request)
