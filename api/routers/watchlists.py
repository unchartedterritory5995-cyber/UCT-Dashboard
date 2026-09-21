"""Watchlist API — per-user watchlists with public sharing."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from typing import Optional

from api.middleware.auth_middleware import get_current_user
from api.services import watchlist_service
from api.services.watchlist_performance import get_batch_returns
from api.services.auth_db import get_connection
import hashlib
import json

router = APIRouter()

# ⛔ HOW MANY SYMBOLS A LIST-OPEN MAY WARM. `warm_bars_async`'s own docstring says
# "Caller should pass a SHORT list (≤30)" and its pool is max_workers=4 — but both
# call sites below passed the WHOLE list. That was survivable only because nothing
# routed a large list through them; the moment the picker fetches membership from
# `GET /api/watchlists/{wl_id}`, opening Russell 2000 becomes 1,872 symbols × 8,000
# daily bars queued on the web pod. See the OOM and write-lock incidents this repo
# has already paid for. A member's own list (a few dozen names) is warmed exactly as
# before; an index list warms its head and no more.
#
# This is a CEILING, not a prefetch strategy. Warming the first 30 of a $-volume-
# sorted index list is merely harmless; warming what the member is about to click
# is Phase 3's job, and belongs on the navigation path, not on list-open.
_WARM_MAX = 30


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
            warm_bars_async(tickers[:_WARM_MAX], tf="D", bars=8000)
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


# ── Watchlist Intelligence V1 (owner authorization) ──

class IntelRequest(BaseModel):
    tickers: list[str]
    changes: Optional[dict[str, float]] = None
    # Seam 8 (2026-09-07): optional, additive per-symbol vendor observation
    # epoch (seconds) alongside `changes` -- a caller that omits it (every
    # caller before Seam 8) gets byte-identical behavior to before.
    price_observed_at: Optional[dict[str, float]] = None


@router.post("/api/watchlists/intelligence")
def watchlist_intelligence(body: IntelRequest, user: dict = Depends(get_current_user)):
    from api.services.watchlist_intelligence import get_intelligence_for_symbols
    tickers = list(set(t.upper() for t in body.tickers[:100]))  # cap at 100, mirrors watchlist-performance
    return get_intelligence_for_symbols(tickers, body.changes, body.price_observed_at)


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
def list_watchlists(
    include_items: bool = True,
    include_prebuilt: bool = True,
    user: dict = Depends(get_current_user),
):
    """The user's lists. `?include_items=0` omits `items` (metadata + item_count only);
    `?include_prebuilt=0` drops the admin-curated index lists.

    Both default True so every existing caller stays byte-identical. The app-shell
    surfaces that only draw list NAMES pass `include_items=0`; the ones asking what
    the member is actually watching pass `include_prebuilt=0` — see the note in
    `watchlist_service.list_user_watchlists` for the 592 KB / 4,726-row / 28 s
    page-load cost that motivated each.

    ⛔ Both flags must be FORWARDED, not merely accepted. A slim mode the endpoint
    never passes on is built, green and unreachable — that is exactly how the first
    `include_items` pass shipped, surviving all nine service tests.
    """
    return watchlist_service.list_user_watchlists(
        user["id"], include_items=include_items, include_prebuilt=include_prebuilt
    )


@router.get("/api/watchlists/public")
def list_public(user: dict = Depends(get_current_user)):
    return watchlist_service.list_public_watchlists()


@router.get("/api/watchlists/prebuilt")
def list_prebuilt(
    request: Request,
    include_items: bool = True,
    user: dict = Depends(get_current_user),
):
    """Admin-curated UCT watchlists (the picker's Prebuilt tab). Any logged-in user.

    Each row is tagged with its `category` (the section it appears under in the picker),
    resolved from the committed prebuilt config.

    `?include_items=0` omits every list's members and returns metadata + `item_count`
    only — what the picker actually draws. See `list_prebuilt_watchlists` for the
    measured 607 KB / 4,704-row cost the full mode pays to render 33 names, and
    `_WARM_MAX` above for the landmine that moving membership off this route arms.

    Caching: the catalogue is derived from files that change MONTHLY (the refresh
    cron) and weekly (Sunday Scans), so it carries an ETag over the exact bytes and
    a short `private` max-age. `private` is mandatory, never `public` — the response
    is cookie-authenticated and `owner_name` is per-row identity."""
    rows = watchlist_service.list_prebuilt_watchlists(limit=1000, include_items=include_items)
    try:
        from api.services.watchlist_prebuilt import (
            category_map, category_order, issue_date_map, alias_map,
            _DEFAULT_CATEGORY,
        )
        cats = category_map()
        order = category_order()
        dated = issue_date_map()
        aliases = alias_map()
        for r in rows:
            key = (r.get("name") or "").strip().lower()
            r["category"] = cats.get(key, _DEFAULT_CATEGORY)
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

    body = json.dumps(rows, separators=(",", ":"), default=str).encode()
    etag = '"wlpb-%s"' % hashlib.md5(body).hexdigest()
    headers = {"Cache-Control": "private, max-age=300", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


@router.post("/api/watchlists")
def create_watchlist(body: WatchlistCreate, user: dict = Depends(get_current_user)):
    return watchlist_service.create_watchlist(user["id"], body.name, body.description, body.is_public)


@router.get("/api/watchlists/{wl_id}")
def get_watchlist(
    request: Request,
    wl_id: str,
    slim: bool = False,
    user: dict = Depends(get_current_user),
):
    """One list and its members. This is the MEMBERSHIP endpoint the picker now calls
    on selection, once the directory stopped carrying every list's members.

    `?slim=1` trims each item to `{id, sym, notes}` — dropping `watchlist_id`
    (repeated once per row: 1,872 times for Russell 2000), `added_at` and
    `sort_order`, none of which any client reads. `id` stays because it is the row's
    React key and the handle for note/delete on a list the member owns; `notes` stays
    because the row renders it. Ordering is unchanged — `sort_order` still drives the
    SQL, it just no longer rides the wire. Russell 2000: ~253 KB → ~85 KB.

    Membership is deliberately NOT enriched here. A member gets "this list contains
    these symbols" without waiting on a quote, a logo, or a fundamental."""
    wl = watchlist_service.get_watchlist(wl_id, user["id"])
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    try:
        from api.routers.bars import warm_bars_async
        tickers = [i["sym"].upper() for i in (wl.get("items") or []) if isinstance(i, dict) and i.get("sym")]
        if tickers:
            # ⛔ BOUNDED. See _WARM_MAX — this line used to pass the whole list, and
            # this route is now how a 1,872-symbol index list is opened.
            warm_bars_async(tickers[:_WARM_MAX], tf="D", bars=8000)
    except Exception:
        pass
    if slim:
        wl = {**wl, "items": [
            {"id": i.get("id"), "sym": i.get("sym"), "notes": i.get("notes") or ""}
            for i in (wl.get("items") or []) if isinstance(i, dict)
        ]}
    body = json.dumps(wl, separators=(",", ":"), default=str).encode()
    etag = '"wlm-%s"' % hashlib.md5(body).hexdigest()
    # Membership changes when an admin re-ranks an index (monthly) or the member edits
    # their own list. A short private max-age plus the ETag makes a re-open free
    # without ever pinning stale membership.
    headers = {"Cache-Control": "private, max-age=60", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


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

