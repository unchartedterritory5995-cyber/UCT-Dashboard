"""Options analytics routes built by lane/gaps-options (the FT-0xx options rows).

Every route here is DARK behind its OWN switch (`api/services/options_analytics/flags.py`), read
per request: unset, the route answers FastAPI's 404 body BEFORE any identity is read (the switch
dependency is listed first). Set, it is PAID, with this router's own 402 sentence.

⛔ Read-only. Nothing here places, stages or sends a trade.
⛔ Values are labelled: `vendor` for numbers Massive sent, `computed` for ours (with the method).
⛔ A handler that blocks (HTTP reads, SQLite, gzip) is a plain `def` (FastAPI's threadpool); an
   `async def` here awaits something real (tests/test_async_routes_do_not_block.py).

Map (row -> route -> switch) lives in docs/terminal-research/reports/gap-sweep-options.md.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.options_analytics import flags

router = APIRouter(tags=["options-analytics"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the options analytics surfaces. Defined HERE: each router owns its own
    402 sentence (tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Options analytics require a paid plan")
    return user


def _switch(name: str):
    def armed() -> None:
        if not flags.is_on(name):
            raise HTTPException(status_code=404, detail="Not Found")
    armed.__name__ = f"armed_{name.lower()}"
    return armed


# ── FT-056 Market Tide ──────────────────────────────────────────────────────────

@router.get("/api/options/market-tide",
            dependencies=[Depends(_switch("OPTIONS_MARKET_TIDE_ENABLED"))])
def market_tide(scope: str = Query("all", pattern="^(all|stocks|etfs)$"),
                _user: dict = Depends(require_paid)):
    """Market-wide net call / net put premium by minute, from our flow tape (computed).
    Plain `def`: the tape read blocks; the answer is cached and refreshed off the request."""
    from api.services.options_analytics import market_tide as mt
    try:
        return mt.get(scope)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Market Tide unavailable: {e}") from e


# ── BRK-08 positioning: FT-047 / 049 / 050 / 052 / 055 ──────────────────────────
# `async def` and they await the chain (gex_service's fetch, cached); bars, the vendor chain and
# the dealer-table read run in `asyncio.to_thread` inside the service.

_DTE = "^(0dte|1dte|week|month|all)$"


def _sym(sym: str) -> str:
    from api.services.research.iv_history import normalize_symbol
    s = normalize_symbol(sym)
    if not s:
        raise HTTPException(status_code=422, detail="not a ticker symbol")
    return s


async def _positioning(fn, *args):
    try:
        return await fn(*args)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Positioning unavailable: {e}") from e


@router.get("/api/options/positioning/vocabulary",
            dependencies=[Depends(_switch("OPTIONS_POSITIONING_VOCAB_ENABLED"))])
def positioning_vocabulary(_user: dict = Depends(require_paid)):
    """FT-047: the closed, versioned dealer-positioning vocabulary (served verbatim)."""
    from api.services.options_analytics.positioning_vocab import vocabulary
    return vocabulary()


@router.get("/api/options/positioning/{sym}/levels",
            dependencies=[Depends(_switch("OPTIONS_POSITIONING_VOCAB_ENABLED"))])
async def positioning_levels(sym: str, dte: str = Query("month", pattern=_DTE),
                             _user: dict = Depends(require_paid)):
    from api.services.options_analytics import positioning
    return await _positioning(positioning.levels, _sym(sym), dte)


@router.get("/api/options/positioning/{sym}/heatmap",
            dependencies=[Depends(_switch("OPTIONS_GEX_HEATMAP_ENABLED"))])
async def positioning_heatmap(sym: str, dte: str = Query("month", pattern=_DTE),
                              _user: dict = Depends(require_paid)):
    from api.services.options_analytics import positioning
    return await _positioning(positioning.heatmap, _sym(sym), dte)


@router.get("/api/options/positioning/{sym}/max-pain",
            dependencies=[Depends(_switch("OPTIONS_MAX_PAIN_ENABLED"))])
async def positioning_max_pain(sym: str, dte: str = Query("month", pattern=_DTE),
                               _user: dict = Depends(require_paid)):
    from api.services.options_analytics import positioning
    return await _positioning(positioning.max_pain, _sym(sym), dte)


@router.get("/api/options/positioning/{sym}/nope",
            dependencies=[Depends(_switch("OPTIONS_NOPE_ENABLED"))])
async def positioning_nope(sym: str, dte: str = Query("all", pattern=_DTE),
                           _user: dict = Depends(require_paid)):
    from api.services.options_analytics import positioning
    return await _positioning(positioning.nope, _sym(sym), dte)


@router.get("/api/options/positioning/{sym}/impact",
            dependencies=[Depends(_switch("OPTIONS_IMPACT_ENABLED"))])
async def positioning_impact(sym: str, dte: str = Query("month", pattern=_DTE),
                             _user: dict = Depends(require_paid)):
    from api.services.options_analytics import positioning
    return await _positioning(positioning.impact, _sym(sym), dte)


@router.get("/api/options/positioning/{sym}/dealer-short",
            dependencies=[Depends(_switch("OPTIONS_DEALER_SHORT_ENABLED"))])
async def positioning_dealer_short(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import positioning
    return await _positioning(positioning.dealer_short, _sym(sym))


# ── FT-006 IV rank · FT-020 volatility endpoints · FT-019 option monitor ────────
# Plain `def`: bars, the vendor chain and our options log (R2 / gzip) all block.

def _blocking(fn, *args, **kw) -> dict:
    """A provider or store that cannot be read is a 503 in words, never an empty answer."""
    try:
        return fn(*args, **kw)
    except Exception as e:  # noqa: BLE001 -- surfaced by name
        detail = str(e) if isinstance(e, RuntimeError) else type(e).__name__
        raise HTTPException(status_code=503, detail=f"Volatility data unavailable: {detail}") from e


@router.get("/api/options/vol/{sym}/iv-rank", dependencies=[Depends(_switch("OPTIONS_IV_RANK_ENABLED"))])
def vol_iv_rank(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol
    return _blocking(vol.iv_rank, _sym(sym))


@router.get("/api/options/vol/{sym}/term-structure",
            dependencies=[Depends(_switch("OPTIONS_VOL_ENDPOINTS_ENABLED"))])
def vol_term_structure(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol
    return _blocking(vol.term_structure, _sym(sym))


@router.get("/api/options/vol/{sym}/interpolated-iv",
            dependencies=[Depends(_switch("OPTIONS_VOL_ENDPOINTS_ENABLED"))])
def vol_interpolated_iv(sym: str, days: int = Query(30, ge=1, le=730),
                        _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol
    return _blocking(vol.interpolated_iv, _sym(sym), days)


@router.get("/api/options/vol/{sym}/realized",
            dependencies=[Depends(_switch("OPTIONS_VOL_ENDPOINTS_ENABLED"))])
def vol_realized(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol
    return _blocking(vol.realized, _sym(sym))


@router.get("/api/options/vol/{sym}/vrp", dependencies=[Depends(_switch("OPTIONS_VOL_ENDPOINTS_ENABLED"))])
def vol_vrp(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol
    return _blocking(vol.vrp, _sym(sym))


@router.get("/api/research/options/{sym}/monitor",
            dependencies=[Depends(_switch("OPTIONS_MONITOR_ENABLED"))])
def option_monitor(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol
    return _blocking(vol.monitor, _sym(sym))


# ── FT-009 straddle history · FT-007 daily implied vs actual · FT-010 IV crush ──
# Our options log only. Plain `def`: the store mirrors R2 and reads gzip.

def _log(fn, sym: str) -> dict:
    try:
        return fn(_sym(sym))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 -- surfaced by name, never as an empty history
        raise HTTPException(status_code=503,
                            detail=f"The options log is unavailable: {type(e).__name__}") from e


@router.get("/api/research/options-history/{sym}/straddle",
            dependencies=[Depends(_switch("OPTIONS_STRADDLE_HISTORY_ENABLED"))])
def options_history_straddle(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import log_history
    return _log(log_history.straddle_history, sym)


@router.get("/api/research/options-history/{sym}/daily-move",
            dependencies=[Depends(_switch("OPTIONS_DAILY_MOVE_ENABLED"))])
def options_history_daily_move(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import log_history
    return _log(log_history.daily_move, sym)


@router.get("/api/research/options-history/{sym}/iv-crush",
            dependencies=[Depends(_switch("OPTIONS_IV_CRUSH_ENABLED"))])
def options_history_iv_crush(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import log_history
    return _log(log_history.iv_crush, sym)


# ── FT-003 probability · FT-016 contract drill · FT-002 multi-leg builder ──────
# Plain `def`: the vendor chain and contract aggregates block.

@router.get("/api/research/options/{sym}/probability",
            dependencies=[Depends(_switch("OPTIONS_PROBABILITY_ENABLED"))])
def options_probability(sym: str,
                        expiration: str = Query("", max_length=10, pattern=r"^(\d{4}-\d{2}-\d{2})?$"),
                        probability: float = Query(0.6827, ge=0.5, le=0.999),
                        _user: dict = Depends(require_paid)):
    from api.services.options_analytics import chain_tools
    try:
        return chain_tools.probability(_sym(sym), expiration, probability)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Option chain unavailable: {e}") from e


@router.get("/api/research/options/{sym}/contract/{occ}",
            dependencies=[Depends(_switch("OPTIONS_PRICER_ENABLED"))])
def options_contract(sym: str, occ: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import chain_tools
    try:
        return chain_tools.contract_history(_sym(sym), occ)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("/api/research/options/{sym}/builder",
            dependencies=[Depends(_switch("OPTIONS_MULTI_LEG_ENABLED"))])
def options_builder(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import chain_tools
    _sym(sym)
    return chain_tools.builder_config()
