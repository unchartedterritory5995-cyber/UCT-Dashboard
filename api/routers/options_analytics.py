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

from fastapi import APIRouter, Body, Depends, HTTPException, Query

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


# ── FT-039 option stance ───────────────────────────────────────────────────────

@router.get("/api/research/options/{sym}/stance",
            dependencies=[Depends(_switch("OPTIONS_STANCE_ENABLED"))])
def options_stance(sym: str, contract: str = Query(..., max_length=32),
                   direction: str = Query("bullish", pattern="^(bullish|bearish)$"),
                   _user: dict = Depends(require_paid)):
    """Plain `def`: the vendor chain, our log and the earnings file all block."""
    from api.services.options_analytics import stance
    try:
        return stance.stance(_sym(sym), contract, direction)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except stance.NotInChain as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Option chain unavailable: {e}") from e


# ── FT-072 / FT-073 strategy screens over COV-02's screen file ──────────────────
# Same prefix as COV-02's own router (/api/options-screener/*, lane/cov-02-03); separate paths.

@router.get("/api/options-screener/strategies",
            dependencies=[Depends(_switch("OPTIONS_STRATEGY_SCREENS_ENABLED"))])
def options_strategy_catalog(_user: dict = Depends(require_paid)):
    from api.services.options_analytics import strategy_screens as ss
    return {"strategies": [{"id": k, **v} for k, v in ss.STRATEGIES.items()],
            "data_basis": ss.DATA_BASIS, "fill": ss.FILL}


@router.get("/api/options-screener/strategy/{name}",
            dependencies=[Depends(_switch("OPTIONS_STRATEGY_SCREENS_ENABLED"))])
def options_strategy_screen(name: str, underlyings: str = Query("", max_length=600),
                            limit: int = Query(50, ge=1, le=100), _user: dict = Depends(require_paid)):
    """Plain `def`: SQLite over a mirrored, gzipped screen file."""
    from api.services.options_analytics import strategy_screens as ss
    syms = [s for s in (u.strip() for u in underlyings.split(",")) if s]
    if len(syms) > 50:
        raise HTTPException(status_code=422, detail="at most 50 underlyings per screen")
    syms = [_sym(s) for s in syms]
    try:
        return ss.run(name, underlyings=syms or None, limit=limit)
    except ss.BadQuery as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except ss.NoStore as e:
        raise HTTPException(status_code=503, detail=f"Strategy screens unavailable: {e}") from e
    except Exception as e:  # noqa: BLE001 -- surfaced by name, never an empty screen
        raise HTTPException(status_code=503,
                            detail=f"The screen file is unavailable: {type(e).__name__}") from e


# ── lane/o-options-remainders (Lane O): FT-001 / 012 / 014 / 015 / 018 / 049 / 056 / 057 / 072 /
#    073 / 075 (FT-011 rides on the backtester's own router, options_chain.py). Each surface behind
#    its OWN switch; the map is docs/terminal-research/reports/lane-o-options-remainders.md.

# FT-001 / FT-014 / FT-015 compute in the browser over the chain the tab holds; these routes are
# the switch plus the model's words (api/services/options_analytics/chain_models.py).

@router.get("/api/research/options/{sym}/payoff-model",
            dependencies=[Depends(_switch("OPTIONS_PAYOFF_TODAY_ENABLED"))])
def options_payoff_model(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import chain_models
    _sym(sym)
    return chain_models.PAYOFF_MODEL


@router.get("/api/research/options/{sym}/strategy-finder",
            dependencies=[Depends(_switch("OPTIONS_STRATEGY_FINDER_ENABLED"))])
def options_strategy_finder(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import chain_models
    _sym(sym)
    return chain_models.FINDER_MODEL


@router.get("/api/research/options/{sym}/chain-greeks",
            dependencies=[Depends(_switch("OPTIONS_CHAIN_FULL_GREEKS_ENABLED"))])
def options_chain_greeks(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import chain_models
    _sym(sym)
    return chain_models.GREEKS_MODEL


@router.get("/api/research/options/{sym}/edge",
            dependencies=[Depends(_switch("OPTIONS_EDGE_RANKING_ENABLED"))])
def options_edge(sym: str,
                 expiration: str = Query("", max_length=10, pattern=r"^(\d{4}-\d{2}-\d{2})?$"),
                 _user: dict = Depends(require_paid)):
    """FT-012. Plain `def`: the vendor chain, daily bars and our log all block."""
    from api.services.options_analytics import chain_models
    try:
        return chain_models.edge(_sym(sym), expiration)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Option chain unavailable: {e}") from e


# FT-018: plain `def` -- the vol surface's bounded vendor fetch blocks.

@router.get("/api/options/vol/{sym}/rr-bf", dependencies=[Depends(_switch("OPTIONS_VOL_RR_BF_ENABLED"))])
def vol_rr_bf(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol_skew
    return _blocking(vol_skew.rr_bf, _sym(sym))


@router.get("/api/options/vol/{sym}/surface-3d",
            dependencies=[Depends(_switch("OPTIONS_VOL_SURFACE_3D_ENABLED"))])
def vol_surface_3d(sym: str, _user: dict = Depends(require_paid)):
    from api.services.options_analytics import vol_skew
    return _blocking(vol_skew.surface_mesh, _sym(sym))


# FT-049: `async def`, awaiting the cached chain exactly like the gamma heatmap.

@router.get("/api/options/positioning/{sym}/delta-heatmap",
            dependencies=[Depends(_switch("OPTIONS_DELTA_PRESSURE_ENABLED"))])
async def positioning_delta_heatmap(sym: str, dte: str = Query("month", pattern=_DTE),
                                    _user: dict = Depends(require_paid)):
    from api.services.options_analytics import pressure
    return await _positioning(pressure.delta_heatmap, _sym(sym), dte)


@router.get("/api/options/positioning/{sym}/charm-heatmap",
            dependencies=[Depends(_switch("OPTIONS_CHARM_HEATMAP_ENABLED"))])
async def positioning_charm_heatmap(sym: str, dte: str = Query("month", pattern=_DTE),
                                    _user: dict = Depends(require_paid)):
    from api.services.options_analytics import pressure
    return await _positioning(pressure.charm_heatmap, _sym(sym), dte)


# FT-056 / FT-057: Market Tide's same cached tape read. Plain `def`: a cold build reads the tape.

def _tide_extras(scope: str) -> dict:
    from api.services.options_analytics import market_tide as mt
    try:
        return mt.extras(scope)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Market Tide unavailable: {e}") from e


@router.get("/api/options/market-tide/sectors",
            dependencies=[Depends(_switch("OPTIONS_SECTOR_TIDE_ENABLED"))])
def market_tide_sectors(scope: str = Query("all", pattern="^(all|stocks|etfs)$"),
                        _user: dict = Depends(require_paid)):
    from api.services.options_analytics import market_tide as mt
    ex = _tide_extras(scope)
    return {"session": ex["session"], "scope": scope, "label": "computed", "method": mt.METHOD,
            "filters": ex["filters"], "sectors": ex["sectors"], "partial": ex["partial"],
            "partial_reasons": ex["partial_reasons"], "stale": ex["stale"],
            "computed_at": ex["computed_at"],
            "note": "Sectors are the flow tape's own Sector field; a print with none is 'Unclassified'."}


@router.get("/api/options/market-tide/minute",
            dependencies=[Depends(_switch("OPTIONS_TIDE_CLICKTHROUGH_ENABLED"))])
def market_tide_minute(scope: str = Query("all", pattern="^(all|stocks|etfs)$"),
                       t: str = Query("", pattern=r"^(\d{2}:\d{2})?$"),
                       _user: dict = Depends(require_paid)):
    """No `t`: the minutes that hold prints (the panel's probe). With `t`: that minute's prints."""
    from api.services.options_analytics import tide_extras
    ex = _tide_extras(scope)
    base = {"session": ex["session"], "scope": scope, "filters": ex["filters"],
            "cap": tide_extras.MINUTE_CAP, "partial": ex["partial"], "partial_reasons": ex["partial_reasons"]}
    if not t:
        return {**base, "minutes": sorted(ex["minutes"])}
    m = ex["minutes"].get(t) or {"count": 0, "prints": []}
    return {**base, "t": t, "count": m["count"], "shown": len(m["prints"]), "prints": m["prints"],
            "note": (f"The {len(m['prints'])} largest of {m['count']} prints in this minute, by premium."
                     if m["count"] > len(m["prints"]) else None)}


# FT-072 Spread Book: plain `def` (SQLite).

@router.get("/api/options/spread-book", dependencies=[Depends(_switch("OPTIONS_SPREAD_BOOK_ENABLED"))])
def spread_book_list(user: dict = Depends(require_paid)):
    from api.services.options_analytics import spread_book as sb
    return sb.list_for(str(user["id"]))


@router.post("/api/options/spread-book", status_code=201,
             dependencies=[Depends(_switch("OPTIONS_SPREAD_BOOK_ENABLED"))])
def spread_book_save(body: dict = Body(...), user: dict = Depends(require_paid)):
    from api.services.options_analytics import spread_book as sb
    try:
        return sb.save(str(user["id"]), body)
    except sb.BadSpread as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except sb.Full as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.delete("/api/options/spread-book/{sid}",
               dependencies=[Depends(_switch("OPTIONS_SPREAD_BOOK_ENABLED"))])
def spread_book_delete(sid: str, user: dict = Depends(require_paid)):
    from api.services.options_analytics import spread_book as sb
    if not sb.delete(str(user["id"]), sid):
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": sid}


# FT-073 remainder: plain `def` (SQLite over the screen file; the tape read).

@router.get("/api/options-screener/more-strategies",
            dependencies=[Depends(_switch("OPTIONS_MORE_STRATEGY_SCREENS_ENABLED"))])
def options_more_strategy_catalog(_user: dict = Depends(require_paid)):
    from api.services.options_analytics import more_screens
    return more_screens.catalog()


@router.get("/api/options-screener/more/{name}",
            dependencies=[Depends(_switch("OPTIONS_MORE_STRATEGY_SCREENS_ENABLED"))])
def options_more_strategy_screen(name: str, underlyings: str = Query("", max_length=600),
                                 limit: int = Query(50, ge=1, le=100), _user: dict = Depends(require_paid)):
    from api.services.options_analytics import more_screens
    from api.services.options_analytics import strategy_screens as ss
    syms = [s for s in (u.strip() for u in underlyings.split(",")) if s]
    if len(syms) > 50:
        raise HTTPException(status_code=422, detail="at most 50 underlyings per screen")
    syms = [_sym(s) for s in syms]
    try:
        return more_screens.run(name, underlyings=syms or None, limit=limit)
    except ss.BadQuery as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except ss.NoStore as e:
        raise HTTPException(status_code=503, detail=f"Strategy screens unavailable: {e}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"The flow tape is unavailable: {e}") from e
    except Exception as e:  # noqa: BLE001 -- surfaced by name, never an empty screen
        raise HTTPException(status_code=503,
                            detail=f"The screen file is unavailable: {type(e).__name__}") from e


# FT-075 Sizzle (5-session window): plain `def` (gzip + R2 mirror reads).

@router.get("/api/options-screener/sizzle", dependencies=[Depends(_switch("OPTIONS_SIZZLE_ENABLED"))])
def options_sizzle(_user: dict = Depends(require_paid)):
    from api.services.options_analytics import sizzle
    try:
        return sizzle.get()
    except Exception as e:  # noqa: BLE001 -- surfaced by name, never as an empty ranking
        raise HTTPException(status_code=503,
                            detail=f"The options log is unavailable: {type(e).__name__}") from e
