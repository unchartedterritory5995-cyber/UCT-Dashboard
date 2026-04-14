"""Watchlist API — per-user watchlists with public sharing."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.middleware.auth_middleware import get_current_user
from api.services import watchlist_service
from api.services.watchlist_performance import get_batch_returns

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


class PerfRequest(BaseModel):
    tickers: list[str]


class FlaggedSync(BaseModel):
    symbols: list[str]


class FlaggedShare(BaseModel):
    is_public: bool


class FlaggedRename(BaseModel):
    name: str


# ── Flagged shadow watchlist (must be before /{wl_id} routes) ──

@router.get("/api/watchlists/flagged")
def get_flagged(user: dict = Depends(get_current_user)):
    return watchlist_service.get_or_create_flagged_list(user["id"])


@router.post("/api/watchlists/flagged/sync")
def sync_flagged(body: FlaggedSync, user: dict = Depends(get_current_user)):
    return watchlist_service.sync_flagged_items(user["id"], body.symbols)


@router.put("/api/watchlists/flagged/share")
def share_flagged(body: FlaggedShare, user: dict = Depends(get_current_user)):
    return watchlist_service.toggle_flagged_sharing(user["id"], body.is_public)


@router.put("/api/watchlists/flagged/rename")
def rename_flagged(body: FlaggedRename, user: dict = Depends(get_current_user)):
    result = watchlist_service.rename_flagged_list(user["id"], body.name.strip())
    if not result:
        raise HTTPException(status_code=404, detail="Flagged list not found")
    return result


# ── Performance data ──

@router.post("/api/watchlist-performance")
def watchlist_performance(body: PerfRequest, user: dict = Depends(get_current_user)):
    tickers = list(set(t.upper() for t in body.tickers[:100]))  # cap at 100
    return get_batch_returns(tickers)


# ── Regular watchlist endpoints ──

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


class ItemNotesUpdate(BaseModel):
    notes: str


class ReorderItems(BaseModel):
    item_ids: list[str]


class BulkAddItems(BaseModel):
    symbols: list[str]


@router.post("/api/watchlists/{wl_id}/items/bulk")
def bulk_add_items(wl_id: str, body: BulkAddItems, user: dict = Depends(get_current_user)):
    result = watchlist_service.bulk_add_items(user["id"], wl_id, body.symbols)
    if not result:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return result


@router.put("/api/watchlists/{wl_id}/reorder")
def reorder_items(wl_id: str, body: ReorderItems, user: dict = Depends(get_current_user)):
    if not watchlist_service.reorder_items(user["id"], wl_id, body.item_ids):
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return {"ok": True}


@router.put("/api/watchlists/{wl_id}/items/{item_id}/notes")
def update_item_notes(wl_id: str, item_id: str, body: ItemNotesUpdate, user: dict = Depends(get_current_user)):
    result = watchlist_service.update_item_notes(user["id"], wl_id, item_id, body.notes)
    if not result:
        raise HTTPException(status_code=404, detail="Item not found")
    return result


@router.delete("/api/watchlists/{wl_id}/items/{item_id}")
def remove_item(wl_id: str, item_id: str, user: dict = Depends(get_current_user)):
    if not watchlist_service.remove_item(user["id"], wl_id, item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}
