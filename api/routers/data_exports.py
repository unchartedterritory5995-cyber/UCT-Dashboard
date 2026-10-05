"""Member data exports (FT-041/042/043) -- see `api/services/data_exports.py`.

⛔ EVERY ROUTE HERE IS: dark (404 unless `DATA_EXPORTS_ENABLED=1`), paid
(`require_paid`, 402), burst-limited per member (`EXPORT_BURST` per minute,
429) and metered per member per ET day (`EXPORT_DAILY_CAP`, 429). A source
route's own extra gate rides on top: the option-chain export is also 404 while
`OPTIONS_CHAIN_ENABLED` is off, exactly like the chain page.

Plain `def` throughout: every builder blocks on SQLite or a provider.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import data_exports as svc

router = APIRouter()

EXPORT_BURST = "6/minute"
BURST_SENTENCE = "Too many exports at once. Wait a minute and try again."


def _armed() -> None:
    if not svc.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Data export requires a paid plan")
    return user


def _burst(user_id) -> None:
    from api.limiter import limiter
    if not limiter.enabled:
        return
    from limits import parse
    if not limiter.limiter.hit(parse(EXPORT_BURST), "data-export", f"data-export:user:{user_id}"):
        raise HTTPException(status_code=429, detail=BURST_SENTENCE)


def _fmt(fmt: str) -> str:
    f = (fmt or "csv").lower()
    if f not in svc.FORMATS:
        raise HTTPException(status_code=422, detail="format must be csv or xlsx")
    return f


def _export(user: dict, fmt: str, build):
    """Burst check, meter, build, file. A refused export charges nothing; a
    build that fails gives its charge back and says why in a sentence."""
    fmt = _fmt(fmt)
    uid = (user or {}).get("id")
    _burst(uid)
    if not svc.take(uid):
        raise HTTPException(status_code=429,
                            detail=svc.CAP_SENTENCE.format(cap=svc.daily_cap()))
    try:
        built = build()
    except HTTPException:
        svc.give_back(uid)
        raise
    except ValueError as e:
        svc.give_back(uid)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence, not a 500
        svc.give_back(uid)
        raise HTTPException(status_code=503, detail=str(e) or "Export unavailable")
    if built is None:
        svc.give_back(uid)
        raise HTTPException(status_code=404, detail="Not found")
    columns, rows, stem = built
    body = svc.render(fmt, columns, rows, sheet=stem)
    name = svc.filename(stem, fmt)
    return Response(content=body, media_type=svc.MEDIA[fmt], headers={
        "Content-Disposition": f'attachment; filename="{name}"',
        "Cache-Control": "no-store",
        "X-Export-Rows": str(len(rows)),
    })


@router.get("/api/exports/quota", dependencies=[Depends(_armed)])
def export_quota(user: dict = Depends(require_paid)):
    return svc.quota(user.get("id"))


@router.post("/api/exports/screener", dependencies=[Depends(_armed)])
def export_screener(spec: dict = Body(...), format: str = Query("csv"),
                    user: dict = Depends(require_paid)):
    # ⛔ user_id from the dependency, never the body (a `list` filter resolves
    # the CALLER's own watchlists -- same rule as /api/screener/scan).
    return _export(user, format, lambda: svc.screener_rows(spec, user.get("id"), user))


@router.get("/api/exports/watchlists/{wl_id}", dependencies=[Depends(_armed)])
def export_watchlist(wl_id: str, format: str = Query("csv"),
                     user: dict = Depends(require_paid)):
    return _export(user, format, lambda: svc.watchlist_rows(wl_id, user.get("id")))


def _chain_armed() -> None:
    from api.routers.options_chain import is_enabled as chain_enabled
    if not chain_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/exports/options/{sym}/chain",
            dependencies=[Depends(_armed), Depends(_chain_armed)])
def export_option_chain(sym: str,
                        expiration: str = Query("", max_length=10, pattern=r"^(\d{4}-\d{2}-\d{2})?$"),
                        strikes: int = Query(10, ge=2, le=20),
                        format: str = Query("csv"),
                        user: dict = Depends(require_paid)):
    return _export(user, format, lambda: svc.chain_rows(sym, expiration, strikes))


@router.get("/api/exports/news", dependencies=[Depends(_armed)])
def export_news(format: str = Query("csv"), user: dict = Depends(require_paid)):
    return _export(user, format, svc.news_rows)


@router.get("/api/exports/bars/{ticker}", dependencies=[Depends(_armed)])
def export_bars(ticker: str,
                tf: str = Query("D", pattern=r"^(1|5|15|30|60|D|W|M)$"),
                bars: int = Query(2000, ge=1, le=svc.BARS_MAX),
                format: str = Query("csv"),
                user: dict = Depends(require_paid)):
    return _export(user, format, lambda: svc.bars_rows(ticker, tf, bars))
