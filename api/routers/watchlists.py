"""Watchlist API — per-user watchlists with public sharing."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.middleware.auth_middleware import get_current_user
from api.services import watchlist_service

router = APIRouter()


class WatchlistCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    is_public: Optional[bool] = False


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None


class WatchlistItem(BaseModel):
    sym: str
    notes: Optional[str] = ""


@router.get("/api/watchlists")
def list_watchlists(user: dict = Depends(get_current_user)):
    return watchlist_service.list_user_watchlists(user["id"])


@router.get("/api/watchlists/public")
def list_public(user: dict = Depends(get_current_user)):
    return watchlist_service.list_public_watchlists()


@router.post("/api/watchlists")
def create_watchlist(body: WatchlistCreate, user: dict = Depends(get_current_user)):
    return watchlist_service.create_watchlist(user["id"], body.name, body.description, body.is_public)


@router.get("/api/watchlists/{wl_id}")
def get_watchlist(wl_id: str, user: dict = Depends(get_current_user)):
    wl = watchlist_service.get_watchlist(wl_id, user["id"])
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return wl


@router.put("/api/watchlists/{wl_id}")
def update_watchlist(wl_id: str, body: WatchlistUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = watchlist_service.update_watchlist(user["id"], wl_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return result


@router.delete("/api/watchlists/{wl_id}")
def delete_watchlist(wl_id: str, user: dict = Depends(get_current_user)):
    if not watchlist_service.delete_watchlist(user["id"], wl_id):
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return {"ok": True}


@router.post("/api/watchlists/{wl_id}/items")
def add_item(wl_id: str, body: WatchlistItem, user: dict = Depends(get_current_user)):
    result = watchlist_service.add_item(user["id"], wl_id, body.sym, body.notes)
    if not result:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return result


@router.delete("/api/watchlists/{wl_id}/items/{item_id}")
def remove_item(wl_id: str, item_id: str, user: dict = Depends(get_current_user)):
    if not watchlist_service.remove_item(user["id"], wl_id, item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}
