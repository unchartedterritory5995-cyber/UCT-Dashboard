"""COV-10 follow-up — the list SOURCES a /charts Watchlist widget can TRACK or FREEZE, beyond a
Scanner widget's preset scan.

  GET /api/charts/list-sources/screen/{screen_id}   → one of MY saved screens, run on the nightly snapshot
  GET /api/charts/list-sources/theme/{theme_id}     → a theme's holdings (owner + engine overlay, theme_db)

Both answer the SAME shape the scan endpoints answer, so the client's one reader
(``ListSubscription.jsx`` ``readSource``) needs no second parser::

    {"results": [{"sym": "NVDA"}, ...], "as_of": "...", "label": "...", "total": N}

⛔ NEVER A SILENT EMPTY LIST. A source that does not exist is a 404 with the reason, never
``{"results": []}``: ``theme_db.get_theme_holdings`` answers ``[]`` for an unknown theme id, so the
theme's existence is checked FIRST. An empty ``results`` therefore always means "the source exists
and holds nothing right now", which the widget says in words. A screen whose spec no longer runs
is a 400 with the scanner's own reason. A saved screen that matched more rows than one page carries
``total`` so the widget can say it shows the first ``len(results)`` of ``total``.

DARK behind ``CHARTS_LIST_SUBSCRIBE_ENABLED`` (read per call, the COV-10 flag): unset, both routes
answer 404 before the caller is identified. Owner-scoped: another member's screen is 404. A saved
screen is paid content (``/api/screener/saved-screens`` is ``require_paid``), so this is too (402).
Theme holdings are firm-curated and readable by any signed-in member (``/api/themes`` is).

Engine theme memberships are an owner-precedence OVERLAY: they are read ONLY through
``theme_db``'s read functions, never the raw tables.

Plain ``def`` routes: the stores are blocking SQLite (``tests/test_async_routes_do_not_block.py``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter(prefix="/api/charts/list-sources", tags=["charts-list-sources"])

#: One page of a saved screen, the scanner's own ceiling (``query._MAX_PAGE``).
SCREEN_PAGE = 500


def _armed() -> None:
    from api.routers.auth import charts_list_subscribe_enabled
    if not charts_list_subscribe_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _hyphen(sym: str) -> str:
    """App-canonical form (BRK.B -> BRK-B), the form every chart and list on the board uses."""
    return (sym or "").strip().upper().replace(".", "-")


def _dedup(syms) -> list[dict]:
    out, seen = [], set()
    for s in syms:
        h = _hyphen(s)
        if h and h not in seen:
            seen.add(h)
            out.append({"sym": h})
    return out


@router.get("/screen/{screen_id}", dependencies=[Depends(_armed)])
def screen_source(screen_id: int, user: dict = Depends(get_current_user_with_plan)):
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Saved screens require a paid plan")
    from api.services.screener import query as scr_query
    from api.services.screener import saved_screens
    saved_screens.init()
    rec = saved_screens.get(screen_id, user["id"])
    if rec is None:
        raise HTTPException(status_code=404, detail="That saved screen no longer exists.")
    spec = dict(rec.get("spec") or {})
    spec["page"] = 1
    spec["page_size"] = SCREEN_PAGE
    try:
        out = scr_query.run_scan(spec, user_id=user["id"], user=user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"The screen could not be run: {e}")
    rows = out.get("rows") or []
    results = _dedup(r.get("ticker") for r in rows if isinstance(r, dict))
    return {
        "source": "screen",
        "value": screen_id,
        "label": rec["name"],
        "as_of": out.get("snapshot_date"),
        "total": out.get("total") if isinstance(out.get("total"), int) else len(results),
        "results": results,
    }


@router.get("/theme/{theme_id}", dependencies=[Depends(_armed)])
def theme_source(theme_id: str, user: dict = Depends(get_current_user_with_plan)):
    from api.services import theme_db
    theme = theme_db.get_theme(theme_id)
    if theme is None:
        raise HTTPException(status_code=404, detail="That theme no longer exists.")
    holdings = theme_db.get_theme_holdings(theme_id)
    results = _dedup(h.get("sym") for h in holdings)
    return {
        "source": "theme",
        "value": theme_id,
        "label": theme.get("name") or theme_id,
        "as_of": None,
        "total": len(results),
        "results": results,
    }
