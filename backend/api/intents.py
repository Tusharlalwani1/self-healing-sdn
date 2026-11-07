from backend.api.intent_route import IntentRoute
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from backend.models.intent import IntentSelection, IntentEvaluation, ServiceIntent
from backend.services.service_intent import PROFILES, resolve_intent
from backend.services.recovery_verification import verification_engine
from backend.database.db import get_intent_evaluation, get_intent_evaluations

router = APIRouter(prefix='/api/intents', tags=['Service Intent'], route_class=IntentRoute)


@router.get('/profiles', response_model=list[ServiceIntent])
async def profiles():
    return PROFILES


@router.post('/validate', response_model=ServiceIntent)
async def validate(selection: IntentSelection):
    return resolve_intent(selection)


@router.get('/evaluation/current', response_model=Optional[IntentEvaluation])
async def current():
    return verification_engine.intent_engine.current()


@router.get('/evaluation/history', response_model=list[IntentEvaluation])
async def history(limit: int = Query(50, ge=1, le=500)):
    return get_intent_evaluations(limit)


@router.get('/evaluation/{evaluation_id}', response_model=IntentEvaluation)
async def by_id(evaluation_id: str):
    record = get_intent_evaluation(evaluation_id)
    if record is None:
        raise HTTPException(404, 'Intent evaluation not found')
    return record
