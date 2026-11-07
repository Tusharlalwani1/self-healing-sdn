from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from backend.models.verification import RecoveryVerification
from backend.services.recovery_verification import verification_engine
from backend.services.verification_config import VERIFICATION_CONFIG
from backend.database.db import get_verification, get_verifications

router = APIRouter(prefix='/api/verification', tags=['Recovery Verification'])


@router.get('/current', response_model=Optional[RecoveryVerification])
async def current():
    return verification_engine.current()


@router.get('/config')
async def config():
    return VERIFICATION_CONFIG.as_dict()


@router.get('/history', response_model=List[RecoveryVerification])
async def history(limit: int = Query(50, ge=1, le=500)):
    return get_verifications(limit)


@router.get('/{verification_id}', response_model=RecoveryVerification)
async def by_id(verification_id: str):
    result = get_verification(verification_id)
    if not result:
        raise HTTPException(404, 'Verification not found')
    return result
