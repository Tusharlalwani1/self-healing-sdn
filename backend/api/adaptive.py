from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from backend.api.intent_route import IntentRoute
from backend.services.adaptive_healing import adaptive_healing
from backend.database.db import get_adaptive_cycles

router = APIRouter(prefix='/api/adaptive', tags=['Adaptive healing'], route_class=IntentRoute)


class AdaptiveConfig(BaseModel):
    enabled: bool = True
    max_attempts: int = Field(3, ge=1, le=3)
    cooldown_sec: float = Field(2, ge=1, le=30, allow_inf_nan=False)
    candidate_limit: int = Field(24, ge=1, le=24)


@router.get('/current')
async def current():
    return adaptive_healing.current()


@router.get('/history')
async def history(limit: int = Query(50, ge=1, le=200)):
    return get_adaptive_cycles(limit)


@router.get('/config')
async def config():
    return adaptive_healing.config


@router.put('/config')
async def update_config(value: AdaptiveConfig):
    if adaptive_healing.cycle_task and not adaptive_healing.cycle_task.done():
        raise HTTPException(409, 'Cannot change policy bounds during an active cycle')
    adaptive_healing.config = value.model_dump()
    return adaptive_healing.config


@router.post('/cancel')
async def cancel():
    async with adaptive_healing.trigger_lock:
        adaptive_healing.pending = None
        await adaptive_healing.cancel()
    return adaptive_healing.current()


@router.get('/cycles/{cycle_id}')
async def detail(cycle_id: str):
    rows = get_adaptive_cycles(cycle_id=cycle_id)
    if not rows:
        raise HTTPException(404, 'Adaptive cycle not found')
    return rows[0]


@router.get('/cycles/{cycle_id}/candidates')
async def candidate_detail(cycle_id: str):
    return (await detail(cycle_id))['candidates']


@router.get('/cycles/{cycle_id}/attempts')
async def attempt_detail(cycle_id: str):
    return (await detail(cycle_id))['attempts']
