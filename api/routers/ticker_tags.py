"""Ticker tags API — per-user color tags for tickers."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services import ticker_tag_service

router = APIRouter()


class TagSet(BaseModel):
    sym: str
    color: str


class TagBatch(BaseModel):
    symbols: list[str]


@router.get("/api/ticker-tags")
def list_tags(user: dict = Depends(get_current_user)):
    return ticker_tag_service.get_user_tags(user["id"])


@router.post("/api/ticker-tags")
def set_tag(body: TagSet, user: dict = Depends(get_current_user)):
    return ticker_tag_service.set_tag(user["id"], body.sym, body.color)


@router.delete("/api/ticker-tags/{sym}")
def remove_tag(sym: str, user: dict = Depends(get_current_user)):
    ticker_tag_service.remove_tag(user["id"], sym)
    return {"ok": True}


@router.post("/api/ticker-tags/batch")
def batch_tags(body: TagBatch, user: dict = Depends(get_current_user)):
    return ticker_tag_service.get_tags_for_symbols(user["id"], body.symbols)


class ShareColors(BaseModel):
    colors: list[str]


@router.get("/api/ticker-tags/shared")
def get_shared(user: dict = Depends(get_current_user)):
    return ticker_tag_service.get_shared_tag_colors(user["id"])


@router.put("/api/ticker-tags/shared")
def set_shared(body: ShareColors, user: dict = Depends(get_current_user)):
    return ticker_tag_service.set_shared_tag_colors(user["id"], body.colors)


@router.get("/api/ticker-tags/public")
def public_tags(user: dict = Depends(get_current_user)):
    return ticker_tag_service.get_public_tag_lists()
