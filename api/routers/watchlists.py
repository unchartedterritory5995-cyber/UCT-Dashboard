"""Watchlist API — per-user watchlists with public sharing."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.middleware.auth_middleware import get_current_user
from api.services import watchlist_service
from api.services.watchlist_performance import get_batch_returns
from api.services.auth_db import get_connection
import json

router = APIRouter()


class WatchlistCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    is_public: Optional[bool] = False


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    is_prebuilt: Optional[bool] = None  # admin-only (enforced in the route)


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
    result = watchlist_service.get_or_create_flagged_list(user["id"])
    try:
        from api.routers.bars import warm_bars_async
        tickers = [i["sym"].upper() for i in (result.get("items") or []) if isinstance(i, dict) and i.get("sym")]
        if tickers:
            warm_bars_async(tickers, tf="D", bars=8000)
    except Exception:
        pass
    return result


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


# ── Themes for tickers (batch) ──

class ThemesBatchRequest(BaseModel):
    tickers: list[str]


@router.post("/api/watchlists/themes-batch")
def themes_batch(body: ThemesBatchRequest, user: dict = Depends(get_current_user)):
    """Primary theme name per ticker for a BATCH — powers the Watchlist's
    optional Theme column. Null-safe, never raises per-ticker."""
    from api.services.theme_db import get_themes_for_ticker
    syms = list(dict.fromkeys(
        (t or "").upper().strip() for t in (body.tickers or []) if t and t.strip()
    ))[:500]
    results: dict[str, Optional[str]] = {}
    for sym in syms:
        name = None
        try:
            themes = get_themes_for_ticker(sym)
            if themes:
                first = themes[0]
                name = (first.get("theme_name") if isinstance(first, dict) else None) or None
        except Exception:
            name = None
        results[sym] = name
    return {"results": results}


# ── Performance data ──

@router.post("/api/watchlist-performance")
def watchlist_performance(body: PerfRequest, user: dict = Depends(get_current_user)):
    tickers = list(set(t.upper() for t in body.tickers[:100]))  # cap at 100
    return get_batch_returns(tickers)


# ── Digest settings ──

class DigestSettings(BaseModel):
    frequency: str  # 'off', 'daily', 'weekly'


@router.get("/api/watchlists/digest-settings")
def get_digest_settings(user: dict = Depends(get_current_user)):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = 'watchlist_digest'",
            (user["id"],),
        ).fetchone()
        if row:
            return json.loads(row["pref_value"])
        return {"frequency": "off"}
    finally:
        conn.close()


@router.put("/api/watchlists/digest-settings")
def set_digest_settings(body: DigestSettings, user: dict = Depends(get_current_user)):
    if body.frequency not in ("off", "daily", "weekly"):
        raise HTTPException(status_code=400, detail="frequency must be 'off', 'daily', or 'weekly'")
    from api.services.auth_service import set_user_preference
    set_user_preference(user["id"], "watchlist_digest", json.dumps({"frequency": body.frequency}))
    return {"frequency": body.frequency}


# ── Regular watchlist endpoints ──

@router.get("/api/watchlists")
def list_watchlists(include_items: bool = True, user: dict = Depends(get_current_user)):
    """The user's lists. `?include_items=0` omits `items` (metadata + item_count only).

    Default True keeps every existing caller byte-identical. The app-shell surfaces
    that only draw list NAMES pass 0 — see the note in
    `watchlist_service.list_user_watchlists` for the 553 KB / 4,406-row page-load
    cost that motivated it.
    """
    return watchlist_service.list_user_watchlists(user["id"], include_items=include_items)


@router.get("/api/watchlists/public")
def list_public(user: dict = Depends(get_current_user)):
    return watchlist_service.list_public_watchlists()


@router.get("/api/watchlists/prebuilt")
def list_prebuilt(user: dict = Depends(get_current_user)):
    """Admin-curated UCT watchlists (the picker's Prebuilt tab). Any logged-in user.

    Each row is tagged with its `category` (the section it appears under in the picker),
    resolved from the committed prebuilt config."""
    rows = watchlist_service.list_prebuilt_watchlists(limit=1000)
    try:
        from api.services.watchlist_prebuilt import (
            category_map, sample_map, category_order, issue_date_map, alias_map,
            _DEFAULT_CATEGORY,
        )
        cats = category_map()
        samples = sample_map()
        order = category_order()
        dated = issue_date_map()
        aliases = alias_map()
        for r in rows:
            key = (r.get("name") or "").strip().lower()
            r["category"] = cats.get(key, _DEFAULT_CATEGORY)
            r["sample"] = samples.get(key, [])
            if dated.get(key):
                r["issue_date"] = dated[key]     # 'YYYY-MM-DD' — only the dated archive lists
            if aliases.get(key):
                # The newest issue also answers to a STABLE key (community:alias:<alias>)
                # so a widget can follow each new issue instead of pinning one date.
                r["alias"] = aliases[key]["alias"]
                r["alias_label"] = aliases[key]["label"]
        # Group rows by the config's section order (ETF → Index → Breadth → Community) so the
        # picker's first-seen grouping is deterministic, not dependent on each section's
        # alphabetically first list name. Within a section: DATED lists first, newest first
        # (the Sunday Scans archive — A→Z would scramble April < August < July; a negated
        # YYYYMMDD sorts every dated row ahead of the undated 0), then the rest by name
        # (the picker re-sorts those A→Z anyway).
        rows.sort(key=lambda r: (
            order.index(r["category"]) if r.get("category") in order else len(order),
            -int(str(r["issue_date"]).replace("-", "")) if r.get("issue_date") else 0,
            (r.get("name") or "").lower(),
        ))
    except Exception:
        pass
    return rows


@router.post("/api/watchlists")
def create_watchlist(body: WatchlistCreate, user: dict = Depends(get_current_user)):
    return watchlist_service.create_watchlist(user["id"], body.name, body.description, body.is_public)


@router.get("/api/watchlists/{wl_id}")
def get_watchlist(wl_id: str, user: dict = Depends(get_current_user)):
    wl = watchlist_service.get_watchlist(wl_id, user["id"])
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    try:
        from api.routers.bars import warm_bars_async
        tickers = [i["sym"].upper() for i in (wl.get("items") or []) if isinstance(i, dict) and i.get("sym")]
        if tickers:
            warm_bars_async(tickers, tf="D", bars=8000)
    except Exception:
        pass
    return wl


@router.put("/api/watchlists/{wl_id}")
def update_watchlist(wl_id: str, body: WatchlistUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    # Publishing to the Prebuilt tab is admin-only.
    if "is_prebuilt" in data and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required to publish a prebuilt watchlist")
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

