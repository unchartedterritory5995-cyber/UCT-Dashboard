"""Screener + scanner surfaces — the full-market screen, the UCT scanner
candidates, and the pooled scanner universe.

⛔ EVERYTHING HERE IS PAID EXCEPT ONE DELIBERATE, TOKEN-AUTHENTICATED DOOR.
Owner ruling 2026-08-06, reaffirmed 08-07: *"everything is paid, almost nothing
is accessible for free"* — with a free trial granting paid access for a period,
which `is_paid_user` already honours (admin OR paid plan OR in-trial).

Measured 2026-08-08, before this file was gated:
  * `GET /api/candidates` answered an ANONYMOUS caller 200 with 32,610 bytes —
    the UCT scanner's candidate list, the firm's proprietary morning output.
  * `/api/screener` and `/api/scanner/universe` had no dependency at all.
  * `/api/screener/{meta,scan,snapshot-status,saved-screens}` were gated with
    `get_current_user` ONLY — "logged in" is not "paid", and a free member could
    run the whole 4,000-ticker precomputed screen.

⛔ `require_paid` IS DECLARED PER HANDLER, NOT ON THE ROUTER. `main.py` calls
`include_router(screener.router)` with no router-level dependency, so a route
that omits its own gate is reachable by anybody. The shape is copied from
`api/routers/signature.py:174`, which defines its OWN `require_paid` with its own
402 sentence and repeats it on every route — a shared dependency would change
four other routers' behaviour as a side effect of gating this one, and the
distinct sentence is what makes "which surface refused me" answerable.

⛔ AND THE COVERAGE TEST IS DERIVED FROM `router.routes` WITH THE COUNT ASSERTED —
`tests/test_scan_screener_auth.py`. Phase C Task 13 MEASURED the alternative: it
dropped `Depends(require_paid)` from `/confluence` and the shipped test stayed
GREEN because it hand-listed THREE paths while the router had FIVE.

✋ THE ONE ROUTE THAT STAYS OPEN, AND WHY.
`GET /api/screener/shared/{share_token}` is token-authenticated public sharing,
by design, not by omission:
  * `saved_screens.update` mints `share_token = secrets.token_urlsafe(8)` ONLY
    when the screen's owner sets `is_public`, and `get_public` re-checks
    `is_public=1` in the WHERE clause — so an un-shared screen is unreachable
    even with a guessed id;
  * the design doc lists it as such —
    `docs/superpowers/plans/2026-06-19-full-market-screener.md:1413`,
    "`GET /api/screener/shared/{share_token}` (public read)";
  * and it serves a saved FILTER SPEC, never scan output: no ticker rows, no
    prices, nothing the paid screen computes. A recipient still needs a paid
    plan to RUN it, because `/api/screener/scan` is gated below.
Gating it would break every share link already in the wild. It is named in
`tests/test_scan_screener_auth.py::PUBLIC_BY_DESIGN`, whose size is asserted, so
a SECOND open route cannot join it quietly.
"""
from fastapi import APIRouter, HTTPException, Body, Depends
from pydantic import BaseModel
from api.services.engine import get_screener, get_candidates
from api.services import breadth_monitor as bm_svc
from api.services.screener import (
    query as scr_query,
    filters as scr_filters,
    snapshot_db as scr_db,
    saved_screens as scr_saved,
)
from api.middleware.auth_middleware import (
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The screener requires a paid plan")
    return user


@router.get("/api/screener")
def screener(_user: dict = Depends(require_paid)):
    try:
        return get_screener()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/candidates")
def candidates(_user: dict = Depends(require_paid)):
    try:
        result = get_candidates()
        try:
            from api.routers.bars import warm_bars_async
            cands = result.get("candidates") or result
            tickers = []
            for group in cands.values():
                if isinstance(group, list):
                    for c in group:
                        sym = (c.get("sym") or c.get("ticker")) if isinstance(c, dict) else None
                        if sym:
                            tickers.append(sym.upper())
            if tickers:
                warm_bars_async(list(dict.fromkeys(tickers)), tf="D", bars=8000)
        except Exception:
            pass
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/scanner/universe")
def scanner_universe(_user: dict = Depends(require_paid)):
    """Pool all breadth list fields (52W highs, Stage 2, HVC, etc.) into a unified scanner universe."""
    try:
        return bm_svc.get_universe_stocks()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ─── Full-market screener (precomputed snapshot, server-side query) ───────────

class ScanSpec(BaseModel):
    filters: list[dict] = []
    sort: dict | None = None
    view: str = "overview"
    columns: list[str] | None = None
    page: int = 1
    page_size: int = 50


@router.get("/api/screener/meta")
def screener_meta(user=Depends(require_paid)):
    """Filter registry + result views + filter categories (frontend-ready)."""
    return scr_filters.meta(user_id=user["id"])


@router.post("/api/screener/scan")
def screener_scan(spec: ScanSpec, user=Depends(require_paid)):
    try:
        return scr_query.run_scan(spec.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/screener/snapshot-status")
def screener_snapshot_status(user=Depends(require_paid)):
    """Coverage + freshness of the precomputed snapshot.

    ⭐ READ `snapshot_date` — the MEDIAN row's date, i.e. how old this data
    actually is — beside `rows_on_snapshot_date` / `rows` and the `mixed` flag.
    ⛔ `latest_snapshot_date` is the MAX and answers only *"when was the newest
    single row built?"*. It is kept because that question is real and its name
    is honest, but it is NOT the snapshot's age: measured 2026-08-09, the MAX
    was carried by ONE row out of 3,589 while 3,583 were 28 days stale, and a
    gate reading it waved a month-old universe through (E-3 report §3).
    """
    return scr_db.status()


@router.post("/api/screener/refresh")
def screener_refresh(max_tickers: int = 800, user=Depends(require_admin)):
    """Admin: warm the snapshot now (background, capped) instead of waiting for
    the 03:00 ET nightly. Returns immediately.

    Stays `require_admin` — STRICTER than paid, not an exception to it. A paid
    member gets 403 here, and that is the point: this is the only route in the
    router that spends provider budget."""
    import threading
    from api.services.screener import snapshot_builder
    threading.Thread(
        target=lambda: snapshot_builder.run_build(max_tickers=max_tickers),
        daemon=True, name="screener-refresh").start()
    return {"started": True, "max_tickers": max_tickers}


@router.post("/api/screener/finviz-refresh")
def screener_finviz_refresh(user=Depends(require_admin)):
    """Admin: re-run the whole-market Finviz pull NOW and return its receipt
    SYNCHRONOUSLY, instead of waiting for the 02:45 ET job.

    ⭐ WHY THIS EXISTS (2026-08-23): the pull writes the artifact the 03:00
    build joins, so a code fix to `_C_IDS`/`_HEADERS` cannot reach members
    until the next nightly cycle — a header correction shipped at 10:45 sat
    dark for sixteen hours purely because nothing could re-run the pull. The
    snapshot side already had `POST /api/screener/refresh`; this is its
    missing upstream half, and the pair together turn "wait for tonight"
    into two calls.

    ⛔ SYNCHRONOUS ON PURPOSE, unlike the snapshot refresh: this is ONE
    outbound request and the whole point is to read `missing_headers` back —
    a fire-and-forget version would hand you `{"started": true}` and hide the
    exact fact you ran it for. It is `require_admin` (stricter than paid) and
    it spends provider budget, same posture as the snapshot refresh beside it.

    ⚠️ The pull's own guards still apply and are the safety net: a result
    under `_MIN_ROWS` is treated as a failed pull and the prior artifact is
    left completely alone, so the worst case of calling this is a wasted
    request, never a blanked artifact. Follow it with
    `POST /api/screener/refresh` to join the fresh columns into the rows.
    """
    from api.services.screener import finviz_universe
    return finviz_universe.run_pull()


@router.get("/api/screener/saved-screens")
def screener_saved_list(user=Depends(require_paid)):
    scr_saved.init()
    return {"saved": scr_saved.list_for(user["id"]), "starters": scr_saved.starters()}


@router.post("/api/screener/saved-screens")
def screener_saved_create(payload: dict = Body(...), user=Depends(require_paid)):
    scr_saved.init()
    if not payload.get("name") or payload.get("spec") is None:
        raise HTTPException(status_code=400, detail="name and spec required")
    return scr_saved.create(user["id"], payload["name"], payload["spec"],
                            bool(payload.get("is_public")))


@router.put("/api/screener/saved-screens/{sid}")
def screener_saved_update(sid: int, payload: dict = Body(...), user=Depends(require_paid)):
    rec = scr_saved.update(sid, user["id"], **payload)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec


@router.delete("/api/screener/saved-screens/{sid}")
def screener_saved_delete(sid: int, user=Depends(require_paid)):
    return {"deleted": scr_saved.delete(sid, user["id"])}


@router.get("/api/screener/shared/{share_token}")
def screener_shared(share_token: str):
    """✋ PUBLIC BY DESIGN — the token IS the credential. See the module docstring:
    the token only exists for a screen its owner marked public, `get_public`
    re-checks `is_public=1`, and the payload is a filter SPEC, not scan output.
    Do NOT add `Depends(require_paid)` here — it would break every share link
    already in the wild."""
    rec = scr_saved.get_public(share_token)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return rec
