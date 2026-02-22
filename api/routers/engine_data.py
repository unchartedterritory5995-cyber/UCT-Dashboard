from fastapi import APIRouter, HTTPException
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
def rundown():
    try:
        return get_rundown()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
