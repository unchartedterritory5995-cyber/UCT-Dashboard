from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from api.services.engine import get_breadth, get_themes, get_leadership, get_rundown, get_uct20_portfolio_data, get_analyst_actions

router = APIRouter()


@router.get("/api/breadth")
def breadth():
    try:
        return get_breadth()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/themes")
def themes(period: str = Query("1W")):
    try:
        return get_themes(period)
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


@router.get("/api/uct20/portfolio")
def uct20_portfolio():
    try:
        return get_uct20_portfolio_data()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/analyst-actions")
def analyst_actions():
    try:
        return get_analyst_actions()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
