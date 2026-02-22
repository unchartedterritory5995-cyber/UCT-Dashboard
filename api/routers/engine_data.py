from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from api.services.engine import get_breadth, get_themes, get_leadership, get_rundown

router = APIRouter()


@router.get("/api/breadth")
def breadth():
    try:
        return get_breadth()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/themes")
def themes():
    try:
        return get_themes()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/leadership")
def leadership():
    try:
        return get_leadership()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/rundown")
def rundown(type: Optional[str] = Query(None)):
    try:
        if type == "post_market":
            return {"html": "", "date": ""}  # post-market not yet implemented
        return get_rundown()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
