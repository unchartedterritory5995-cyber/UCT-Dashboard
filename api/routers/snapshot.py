from fastapi import APIRouter, HTTPException
from api.services.massive import get_snapshot

router = APIRouter()


@router.get("/api/snapshot")
def snapshot():
    try:
        return get_snapshot()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
