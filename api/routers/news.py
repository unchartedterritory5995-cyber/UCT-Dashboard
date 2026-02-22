from fastapi import APIRouter, HTTPException
from api.services.engine import get_news

router = APIRouter()


@router.get("/api/news")
def news():
    try:
        return get_news()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
