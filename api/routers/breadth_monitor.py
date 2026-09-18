"""api/routers/breadth_monitor.py

GET  /api/breadth-monitor         — history (bounded; see `days` below) — PAID
GET  /api/breadth-monitor/latest  — most recent row                    — PAID
POST /api/breadth-monitor/push    — store new snapshot        — PUSH_SECRET

🔴 EVERY READ WAS ANONYMOUS until 2026-08-09 — the 40+ metric breadth history,
the intraday row, the historical analogues, and `…/drill/{metric_key}`, which
names THE ACTUAL TICKERS behind a breadth cell. This is the firm's own daily
measurement of the market, collected at 4:15 ET every session for years; it is
the substance of the Breadth product, and its only consumers (`Breadth.jsx`,
`useLiveBreadth`, `liveDrill.js`) sit on paid pages. Reads are PAID now.

The MUTATIONS were already gated, by `_check_auth` (PUSH_SECRET bearer) rather
than a `Depends`, which is why a dependency-tree sweep reported them as bare —
worth knowing before "fixing" something that is not broken. Left as they are:
the collector is a machine, not a session.

⚠️ `days` IS NOW BOUNDED. It was `days: int = 90` with no ceiling, so
`?days=100000` answered 200 — the whole table, and a query the caller sizes.
`ge=1, le=3650` (ten years) is comfortably past the longest range any surface
requests (`BreadthCharts.jsx` asks for 365) while making the cost of one request
something the server decides. Out-of-range is a 422 from FastAPI rather than a
silent clamp: a caller that asked for 100,000 sessions should be told the answer
is not what it asked for, not handed 3,650 dressed as it.
"""

import hashlib
import hmac
import json
import math
import os
import time
import re
import threading

from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from api.services.cache import cache
from api.bars_auth import require_bars_access
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import breadth_monitor as svc
from api.services.breadth_analogues import find_analogues, invalidate_cache as invalidate_analogues_cache

router = APIRouter()

_PUSH_SECRET = os.environ.get("PUSH_SECRET", "")

_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _require_iso_date(value: str) -> str:
    """400 on a path date that is not YYYY-MM-DD.

    ⛔ ONE VALIDATOR, TWO ENDPOINTS. `session-path` has rejected a malformed
    date since it shipped; `score-components` took whatever it was handed and
    ran a full `get_history` fetch + derivation pass before answering
    `ok: false` — real work to answer a question the string could never match.
    Copying the regex into the second endpoint is how the two drift, so both
    call this. The rule is the one already shipped, verbatim, and
    `test_breadth_score_components.py` derives its expectation from the
    neighbour rather than retyping the message.
    """
    if not _ISO_DATE.fullmatch(value):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return value


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the breadth surface.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The breadth monitor requires a paid plan")
    return user


def require_push_secret(request: Request) -> None:
    """The WORKER's credential for this router — the `PUSH_SECRET` bearer.

    ⛔ THE FAILURE DIRECTION IS CLOSED: an unset or blank secret refuses
    everybody rather than letting `Authorization: Bearer ` (empty) match.

    ⭐ A NAMED `Depends`, NOT another inline body check. The auth census
    (`tests/test_exposed_routes_gated.py`) reads each route's DEPENDENCY TREE, so
    a bearer verified inside a handler is UNCLAIMABLE — 29 routes in this app sit
    outside that audit for exactly that reason, `_check_auth` below among them.
    A new route has no behaviour to preserve, so it is born claimable.

    `_check_auth` is deliberately left alone: converting the routes that already
    ship on it would change their responses (500 → 401 when the secret is unset)
    and that is an owner call, not a drive-by.
    """
    secret = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not secret or not token or not hmac.compare_digest(
            token.encode("utf-8", "ignore"), secret.encode("utf-8", "ignore")):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _check_auth(request: Request) -> None:
    if not _PUSH_SECRET:
        raise HTTPException(status_code=500, detail="PUSH_SECRET not configured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {_PUSH_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Init DB on import ──────────────────────────────────────────────────────────
try:
    svc.init_db()
except Exception as _e:
    print(f"[breadth_monitor] DB init warning: {_e}")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/breadth-monitor/ohlc/status")
def get_breadth_ohlc_status():
    """Coverage of the breadth candle-wick store + the deep-history inputs the
    Monitor now merges (reconstructed OHLC, imported sentiment, and the resulting
    navigator date bounds). No auth — read-only metadata."""
    from api.services import breadth_daily_ohlc
    out = breadth_daily_ohlc.stats()
    try:
        from api.services import breadth_sentiment_history
        out["sentiment"] = breadth_sentiment_history.stats()
    except Exception as e:
        out["sentiment"] = {"error": str(e)}
    try:
        out["monitor_bounds"] = svc.date_bounds()
    except Exception:
        pass
    return out


@router.get("/api/breadth-monitor/universe")
def get_breadth_universe():
    """The breadth reconstruction universe — the SAME population the live row
    measured (collector's latest universe_list). Read-only. Consumed by the WORKER
    pod's history backfill, which can't read the collector snapshot on the web
    volume; serving it here keeps pre-2024 reconstruction on ONE population (no
    seam vs the live/2024 rows)."""
    from api.services import breadth_live as bl
    tickers, d = bl.universe()
    return {"tickers": tickers, "date": d, "count": len(tickers)}


@router.get("/api/breadth-monitor/live-diag")
def breadth_live_diag(request: Request):
    """Anchor/coverage diagnostics for the live breadth read — the WHY behind an
    un-anchored (raw) intraday read, especially early in the session before bars.db
    prior-day coverage for the breadth universe is warm. Returns ONLY coverage/anchor
    STATE (no breadth metric values). PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_live as bl
    if not bl.enabled():
        return {"enabled": False}
    try:
        p = bl.compute_live() or {}
    except Exception as e:
        return {"enabled": True, "error": repr(e)}
    keys = ("ok", "reason", "session_live", "market_open", "session_date", "levels_as_of",
            "anchored", "anchored_to", "degraded", "bars_coverage", "counts_anchored",
            "anchor_withheld", "measured", "universe_size", "universe_date", "snapshot_size",
            "traded_share", "as_of")
    return {k: p.get(k) for k in keys}


@router.post("/api/breadth-monitor/history/pull-now")
def pull_breadth_ohlc_now(request: Request):
    """Force an immediate web-side pull + gap-fill merge of the latest breadth OHLC
    snapshot the WORKER shipped to R2, instead of waiting for the 10-min puller
    (BREADTH_OHLC_REMOTE). Returns the merged ts, or null if already current / R2
    unconfigured. Safe to call repeatedly (gap-fill never clobbers). PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_ohlc_sync
    return {"ok": True, "merged": breadth_ohlc_sync.sync_if_new()}


@router.post("/api/breadth-monitor/pit/calibrate")
def pit_calibrate(request: Request, target_days: int = Query(default=8, ge=1, le=40),
                  vol_window: int = Query(default=20, ge=5, le=60),
                  exchanges: str = Query(default="")):
    """Phase-2 MAKE-OR-BREAK gate: run the price/liquidity-proxy vs KNOWN-universe
    calibration in a BACKGROUND thread (whole-market grouped-daily pulls are heavy).
    `exchanges` = comma-sep primary_exchange allowlist (e.g. XNYS,XNAS,XASE,ARCX,BATS)
    to drop OTC; empty = no exchange filter. Poll GET .../pit/calibrate-result.
    PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_pit_calibrate as cal
    exch = [e.strip().upper() for e in exchanges.split(",") if e.strip()] or None
    cal.run_async(target_days=target_days, vol_window=vol_window, exchanges=exch)
    return {"ok": True, "started": True, "target_days": target_days,
            "vol_window": vol_window, "exchanges": exch}


@router.get("/api/breadth-monitor/pit/calibrate-result")
def pit_calibrate_result():
    """Poll the Phase-2 calibration run (public — proxy-vs-known-universe overlap
    metrics, no member lists / no secrets)."""
    from api.services import breadth_pit_calibrate as cal
    return cal._STATE


@router.post("/api/breadth-monitor/pit/validate")
def pit_validate(request: Request, target_days: int = Query(default=8, ge=1, le=40),
                 vol_window: int = Query(default=20, ge=5, le=60),
                 price_min: float = Query(default=3.0),
                 dollarvol_min: float = Query(default=5e6),
                 exchanges: str = Query(default="")):
    """Phase-2 DECISION test: does the proxy universe move the breadth VALUE vs the
    collector's ACTUAL universe (same method, so it isolates the universe effect)?
    Background thread; poll GET .../pit/validate-result. PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_pit_calibrate as cal
    exch = [e.strip().upper() for e in exchanges.split(",") if e.strip()] or None
    cal.run_value_async(target_days=target_days, vol_window=vol_window,
                        price_min=price_min, dollarvol_min=dollarvol_min, exchanges=exch)
    return {"ok": True, "started": True}


@router.get("/api/breadth-monitor/pit/validate-result")
def pit_validate_result():
    """Poll the Phase-2 value-impact validation (public — per-metric breadth-value
    deltas, no member lists)."""
    from api.services import breadth_pit_calibrate as cal
    return cal._VSTATE


@router.post("/api/breadth-monitor/wicks/validate")
def wicks_validate(request: Request, days: int = Query(default=3, ge=1, le=8),
                   bucket_min: int = Query(default=30, ge=5, le=60)):
    """Phase-3 gate: reconstruct the last `days` sessions' wicks from S3 minute flat
    files and compare to the store's REAL live-accumulator wicks. Background thread
    (whole-market minute pull is heavy). Poll GET .../wicks/validate-result.
    PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_wick_recon as wr
    wr.run_validate_async(days=days, bucket_min=bucket_min)
    return {"ok": True, "started": True, "days": days, "bucket_min": bucket_min}


@router.get("/api/breadth-monitor/wicks/validate-result")
def wicks_validate_result():
    """Poll the Phase-3 wick-reconstruction validation (public — recon-vs-live wick
    deltas, no member lists)."""
    from api.services import breadth_wick_recon as wr
    return wr._VWSTATE


@router.get("/api/breadth-monitor/wicks/probe")
def wicks_probe(request: Request, date: str = Query(default="")):
    """Phase-3 diagnostic: pinpoint why recon_day fails (levels build vs S3 access),
    for one day. PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_wick_recon as wr
    from api.services import breadth_live as bl, breadth_daily_ohlc as store
    D = date
    if not D:
        today = bl._iso(bl._ts_int(bl._now_et().date()))
        ds = sorted(d for d in store.history("pct_above_50sma") if d < today)
        D = ds[-1] if ds else today
    return wr.probe_day(D)


@router.post("/api/breadth-monitor/history/backfill-schedule")
def schedule_breadth_backfill(request: Request, floor: str = Query(default=""),
                              stop: bool = Query(default=False)):
    """Start/stop the restart-resilient scheduled deep-history backfill. Set `floor=YYYY-MM-DD`
    and the 12-min tick sweeps chunk-by-chunk down to it, resuming after any restart; `stop=1`
    clears it. Also kicks one tick immediately so it starts now. PUSH_SECRET-gated."""
    _check_auth(request)
    import threading
    from api.services import breadth_history_recon as r
    if stop:
        r.set_backfill_floor(None)
        return {"ok": True, "stopped": True}
    if not floor:
        return {"ok": False, "reason": "floor required (YYYY-MM-DD) or stop=1"}
    r.set_backfill_floor(floor)
    threading.Thread(target=r.backfill_tick, name="breadth-history-tick-kick", daemon=True).start()
    return {"ok": True, "floor": floor, "scheduled": "every 12 min until floor reached", "kicked": True}


@router.post("/api/breadth-monitor/history/backfill-chain")
def backfill_chain(request: Request, floor: str = Query(...), ceiling: str = Query(default="2023-12-31"),
                   limit: int = Query(default=0, ge=0, le=6000)):
    """Trigger the SELF-CHAINING deep backfill: sweeps 2-year chunks from `ceiling` back to
    `floor` sequentially, all server-side in one background thread. Fire ONCE — it then runs
    unattended (no repeated client calls). Poll GET .../history/sweep-status. PUSH_SECRET."""
    _check_auth(request)
    import threading
    from api.services import breadth_history_recon as r
    threading.Thread(target=r.run_backfill_chain, args=(floor, ceiling, 730, limit),
                     name="breadth-backfill-chain", daemon=True).start()
    return {"ok": True, "started": True, "floor": floor, "ceiling": ceiling}


@router.post("/api/breadth-monitor/history/sweep")
def sweep_breadth_history(request: Request, from_date: str = Query(...),
                          to_date: str = Query(default=""), limit: int = Query(default=0, ge=0, le=6000)):
    """Backfill close-basis breadth history for a date range into the chart store
    (source 'close_recon'). Loads the deep frame once, recomputes every session. Heavy →
    runs in a BACKGROUND THREAD; poll GET .../history/sweep-status. PUSH_SECRET-gated."""
    _check_auth(request)
    import threading
    from api.services import breadth_history_recon as r
    threading.Thread(target=r.run_sweep_async, args=(from_date, to_date or None, limit),
                     name="breadth-history-sweep", daemon=True).start()
    return {"ok": True, "started": True, "from": from_date, "to": to_date or "(latest)"}


@router.get("/api/breadth-monitor/history/sweep-status")
def sweep_breadth_history_status():
    """Poll the running/last close-basis history sweep (public — progress only)."""
    from api.services import breadth_history_recon as r
    return r._SWEEP_STATE


@router.post("/api/breadth-monitor/history/recompute-deep")
def recompute_deep_breadth(request: Request, date: str = Query(...),
                           limit: int = Query(default=0, ge=0, le=6000)):
    """Phase 1 proof: recompute breadth for a PAST date from the DEEP chart pipeline (not
    the shallow ohlcv tier). Runs in a BACKGROUND thread (deep Massive fetches are slow →
    would 524 inline); poll the result with GET. `limit` caps the universe (0 = full)."""
    _check_auth(request)
    import threading
    from api.services import breadth_history_recon as r
    threading.Thread(target=r.run_deep_async, args=(date, limit),
                     name=f"deep-recompute-{date}", daemon=True).start()
    return {"ok": True, "started": True, "date": date, "poll": "GET .../history/recompute-deep-result?date="}


@router.get("/api/breadth-monitor/history/recompute-deep-result")
def recompute_deep_result(date: str = Query(...)):
    """Poll a recompute-deep run (public — proof output, no secrets)."""
    from api.services import breadth_history_recon as r
    return r._DEEP_RESULTS.get(date) or {"status": "not_started"}


@router.post("/api/breadth-monitor/history/validate")
def validate_breadth_history_recon(request: Request, days: int = Query(default=10, ge=1, le=60)):
    """Phase 0: recompute the last `days` COLLECTED sessions from bars and diff each metric
    against the collector's stored value. Small diffs => the historical reconstruction is
    faithful and the backfill can be trusted. Read-only. PUSH_SECRET-gated (heavy-ish)."""
    _check_auth(request)
    from api.services import breadth_history_recon
    return breadth_history_recon.validate_recent(days)


@router.get("/api/breadth-monitor/history/adv-dec-coverage")
def adv_dec_coverage():
    """How many of the last `days` sessions carry BOTH advance/decline counts —
    i.e. the number the Event Ledger's Zweig refusal prints, computed by
    `scanEvents`' own arithmetic. Read-only metadata (counts, no tickers), same
    posture as `/ohlc/status`, so the owner can check the backfill landed
    without a bearer token."""
    from api.services import breadth_history_recon as r
    return r.adv_dec_status(90)


@router.post("/api/breadth-monitor/history/adv-dec-validate")
def validate_adv_dec(request: Request, days: int = Query(default=20, ge=1, le=90),
                     limit: int = Query(default=0, ge=0, le=90)):
    """⭐ RUN THIS BEFORE ANY adv/dec BACKFILL. Recomputes `advancing`/`declining`
    for stored sessions through the recon, over each row's OWN point-in-time
    universe, and reports how often `advancing - declining` reproduces the
    `adv_decline` the collector stored. `verdict: "pass"` (every session exact)
    is the only result that licenses `backfill_adv_dec_from_recon` to write.
    Read-only. PUSH_SECRET-gated — a full recompute per session is heavy, so
    keep `days` small on the prod pod."""
    _check_auth(request)
    from api.services import breadth_history_recon as r
    return r.validate_adv_dec_recon(days=days, limit=limit)


@router.post("/api/breadth-monitor/history/adv-dec-apply")
async def apply_adv_dec(request: Request, dry_run: bool = Query(default=True)):
    """Write `advancing`/`declining` onto stored rows that lack them.

    Body: `{"rows": {"2026-08-04": [1955, 737], ...}, "source": "collector_cache"}`
    (a `{"advancing":…, "declining":…}` object per date is accepted too).

    ⛔ The identity gate runs HERE, server-side, per row — a pair is written
    only if `advancing - declining` equals that row's stored `adv_decline`
    exactly, both counts are currently absent, and nothing else is touched. So
    the store's guarantee never depends on the client that posted the numbers.
    `dry_run` defaults to TRUE: it evaluates the whole gate, writes nothing, and
    returns the same report. PUSH_SECRET-gated."""
    _check_auth(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    rows = (body or {}).get("rows")
    if not isinstance(rows, dict):
        raise HTTPException(status_code=400, detail="body.rows must be an object keyed by date")
    for d in rows:
        _require_iso_date(str(d))
    from api.services import breadth_history_recon as r
    return r.apply_adv_dec_counts(rows, dry_run=bool(dry_run),
                                  source=str((body or {}).get("source") or "http"))


@router.post("/api/breadth-monitor/history/adv-dec-backfill-recon")
def backfill_adv_dec_recon(request: Request, days: int = Query(default=90, ge=1, le=365),
                           dry_run: bool = Query(default=True),
                           limit: int = Query(default=0, ge=0, le=90)):
    """Backfill the counts FROM THE RECON, through the same per-row gate. As
    measured (0 of 96 sessions reproduce `adv_decline` from bars.db), this is
    expected to refuse everything — the refusal is the point, and its report
    names every session and by how much it missed. PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_history_recon as r
    return r.backfill_adv_dec_from_recon(days=days, dry_run=bool(dry_run), limit=limit)


@router.post("/api/breadth-monitor/history/member-diff")
def diff_breadth_members(request: Request, date: str = Query(...), metric: str = Query(...)):
    """Phase 0 diagnostic: diff the recomputed member set for one day+metric against the
    collector's stored drill list, classifying each mismatch (not-in-universe / no-price /
    threshold-or-history) so we can tell fixable data gaps from inherent threshold noise."""
    _check_auth(request)
    from api.services import breadth_history_recon
    return breadth_history_recon.diff_members(date, metric)


@router.post("/api/breadth-monitor/ohlc/backfill-intraday")
def backfill_breadth_ohlc_intraday(request: Request, days: int = Query(default=8, ge=1, le=60)):
    """Aggregate the REAL intraday breadth samples (breadth_intraday, full-universe, ~7-day
    retention) into accurate daily OHLC wicks. Cheap (aggregates stored JSON, no recompute),
    so it runs inline. PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_daily_ohlc
    return breadth_daily_ohlc.backfill_from_intraday(days)


@router.post("/api/breadth-monitor/ohlc/purge-reconstructed")
def purge_breadth_ohlc_reconstructed(request: Request):
    """Delete the inaccurate daily-bar 'reconstruct' rows. (A breadth metric's true
    intraday high/low can't be derived from daily bars — those rows assumed every stock
    hits its extreme simultaneously and produced absurdly wide wicks.) PUSH_SECRET-gated."""
    _check_auth(request)
    from api.services import breadth_daily_ohlc
    n = breadth_daily_ohlc.purge_reconstructed()
    return {"ok": True, "purged": n}


@router.get("/api/breadth-symbols")
def get_breadth_symbols(_access: dict = Depends(require_bars_access)):
    """Catalog of the UCT breadth pseudo-tickers (UCTA50 etc.) so the chart UI can
    recognize them (daily-only, no live quote, breadth watermark) and group them.

    🔴 THIS SAID "No auth — the charts they power are free-tier, and this is
    only metadata", and BOTH HALVES had stopped being true. Charts have been paid
    since the 2026-07-19 free-tier decision (`AuthGuard.jsx`: only Morning Wire is
    free), and "only metadata" is what made it the ENUMERATION half of a two-step:
    an anonymous caller reads all 44 proprietary symbol names here, then reads
    their full history from `/api/bars/{sym}`. Naming the product's own breadth
    measures is not a lesser disclosure when the data behind them is what is sold.
    """
    from api.services import breadth_symbols as bs
    # ⭐ `library` IS ADDITIVE. The Breadth Library's richer view rides beside
    # `symbols`/`groups` so one fetch serves both, rather than a second endpoint the
    # client would have to join.
    #
    # ⛔⛔ AND `symbols` IS NOW THE PUBLISHED PROJECTION, WHICH IS THE POINT OF BL-013.
    # It used to be a hard-wired list of the 44 shipped UCT records, so publishing a
    # universe would have made `US:A50` chartable through `/api/bars` while leaving it
    # OUT of the payload the client builds its breadth family map from — and
    # `symbolFamily()` answers `'security'` for anything absent from that map, which
    # would have let `ohlcCapabilityOf` offer CANDLES over a synthetic close-to-close
    # body. `list_breadth_symbols()` is `published_symbol_rows()`, the one projection
    # every public surface derives from.
    #
    # ⚠️ WITH NO PUBLICATION FLAGS THIS IS BYTE-IDENTICAL to what it has always
    # returned: the same 44 rows, same order, same keys. `test_the_dark_payload_is_
    # byte_identical_to_the_legacy_projection` pins that.
    return {
        "symbols": bs.list_breadth_symbols(),
        "groups": [{"id": g, "label": bs.LIST_META[g]["label"],
                    "list_name": bs.LIST_META[g]["list_name"]} for g in bs.GROUP_ORDER],
        "library": bs.library_catalog(),
    }


@router.get("/api/breadth-monitor/library-health")
def get_library_health(_access: dict = Depends(require_bars_access)):
    """Is the Breadth Library healthy? — per universe: publication state, coverage,
    the last forward-seal attempt, and any sessions the calendar expects but the store
    does not hold.

    ⛔ AN EXPLICIT STATUS CALL, NEVER THE SERVE PATH. `library_health` runs a few
    bounded aggregate queries and memoises for a minute; `build_breadth_bars` does not
    touch it. Behind the same `require_bars_access` gate as the rest of this router.
    """
    from api.services import breadth_symbols as bs
    from api.services import breadth_history_recon as recon
    h = bs.library_health()
    return {**h, "sweep": dict(recon._SWEEP_STATE),
            "backfill_armed": recon.universe_backfill_enabled()}


#: The rendered body, cached beside the row cache. ⭐ MEASURED, NOT ASSUMED: the deep
#: read's rows cost **24,471,209 bytes** as live Python objects and **4,958,766** as
#: JSON, so caching the bytes is 4.9x SMALLER than caching the dicts — it buys the
#: encode saving and reduces the resident cost at the same time. Same TTL as the row
#: cache and the same `breadth_history_` prefix, so every existing invalidation
#: (`store_snapshot`, `patch_field`, `delete_snapshot`) already drops it.
_BODY_CACHE_TTL = 300


def _body_cache_key(days: int, end: str, anchor: str) -> str:
    return f"breadth_history_body_{days}_{end or 'latest'}_{anchor}"


def _render_json(payload: dict) -> bytes:
    """The bytes starlette's `JSONResponse.render` would have produced — by making
    the identical call, not by reproducing its output.

    ⛔ BYTE-IDENTITY HERE IS STRUCTURAL, AND THAT IS THE WHOLE POINT. These are the
    exact arguments `starlette.responses.JSONResponse.render` passes (read from the
    installed source, not remembered): `ensure_ascii=False, allow_nan=False,
    indent=None, separators=(",", ":")`. Matching the call means the body cannot
    drift on a value nobody thought to test — including the non-finite floats that
    `allow_nan=False` is there to REFUSE.

    ⚠️ `orjson` is 2.6x faster again and is already a declared dependency
    (requirements.txt:80), and it was measured byte-identical on all three spans —
    but it serialises NaN/Inf to `null` where this RAISES. That is a silent
    behaviour change on a data edge, so it is proposed to the owner, not taken here.
    """
    return json.dumps(payload, ensure_ascii=False, allow_nan=False,
                      indent=None, separators=(",", ":")).encode("utf-8")


@router.get("/api/breadth-monitor")
def get_breadth_history(days: int = Query(default=90, ge=1, le=8000),
                        end: str = Query(default=""),
                        anchor: str = Query(default="le"),
                        _user: dict = Depends(require_paid)):
    """History window, newest-first.

    `end`/`anchor` let the Monitor's Time Navigator teleport the window so its
    top row is a chosen date (`anchor=le`) or the start of a chosen year
    (`anchor=ge`); omit `end` for the latest window. The response carries the
    full data `min_date`/`max_date` (so the navigator can bound its calendar and
    year list) and `next_date` (the session after the top row — its ▶ step).
    """
    anchor = anchor if anchor in ("le", "ge") else "le"
    # ⛔ THIS FUNCTION IS ALSO CALLED DIRECTLY AS A PYTHON FUNCTION, NOT ONLY
    # THROUGH FASTAPI. `api/main.py`'s boot warm task calls
    # `get_breadth_history(days=90)`, which bypasses the request pipeline — so
    # any parameter left at its default holds a `Query(...)` SENTINEL OBJECT
    # rather than a value. `anchor` survived that because the line above
    # happens to reject anything outside ("le", "ge"); `end` did not, because
    # `end or None` sees a Query instance as TRUTHY and passes the sentinel
    # straight through to a `<` comparison against a date string:
    #   TypeError: '<' not supported between instances of 'Query' and 'str'
    # The warm task is wrapped in try/except, so this never broke a request —
    # it silently meant the breadth-history cache was NEVER pre-warmed, and the
    # first real request after every deploy paid full cold compute.
    # (Recorded as Seam 27. That entry blames `anchor`; the measurement says
    # `end` and `days`. Normalise both the same way `anchor` already is.)
    days = days if isinstance(days, int) else 90
    end = end if isinstance(end, str) else ""
    # Request-driven self-heal (cooldown-gated, background): any Monitor view
    # re-checks the newest days so a corrupt collection the scheduled passes missed
    # (or ran too early to fix) gets healed from bars promptly.
    try:
        from api.services import breadth_self_heal
        breadth_self_heal.maybe_auto_heal()
    except Exception:
        pass
    from api.services import breadth_timing
    breadth_timing.begin(span=days)
    try:
        from api.services.cache import cache as _cache
        bk = _body_cache_key(days, end, anchor)
        cached = _cache.get(bk)
        if cached is not None:
            # ⭐ THE WARM PATH, AND IT IS THE ONE MEMBERS ARE ON MOST. Measured before
            # this existed: a cache HIT still cost 573.9 ms at days=8000 and 77.2 ms at
            # days=365, because the cache held the row DICTS and FastAPI re-ran
            # `jsonable_encoder` + `json.dumps` over 376,240 scalar cells on every
            # single request. Nothing about that work depended on the request.
            body, nrows = cached
            breadth_timing.note(cache="hit", cache_tier="body", rows=nrows, body_cache="hit")
            breadth_timing.mark("route_return")
            return Response(content=body, media_type="application/json")

        _t0 = time.perf_counter()
        rows = svc.get_history_deep(days, end=end or None, anchor=anchor)
        breadth_timing.note(reader_ms=(time.perf_counter() - _t0) * 1000.0, rows=len(rows),
                            body_cache="miss")
        # ⭐ `date_bounds()` and `next_trading_day()` run AFTER reader_ms stops and
        # BEFORE the response exists, so they were hiding inside post_reader_ms with
        # no name. `route_tail` is that work, measured rather than attributed to the
        # encoder.
        with breadth_timing.phase("route_tail"):
            top = rows[0]["date"] if rows else None
            bounds = svc.date_bounds()
            _next = svc.next_trading_day(top) if end else None
        payload = {
            "rows": rows,
            "days": days,
            "top_date": top,
            "min_date": bounds.get("min"),
            "max_date": bounds.get("max"),
            # Only needed when the window is held back in time; at the latest
            # window there is nothing newer to step to.
            "next_date": _next,
        }
        with breadth_timing.phase("serialise"):
            body = _render_json(payload)
        _cache.set(bk, (body, len(rows)), ttl=_BODY_CACHE_TTL)
        breadth_timing.mark("route_return")
        return Response(content=body, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/api/breadth-monitor/heal")
def heal_breadth(request: Request, date: str = Query(default=""),
                 days: int = Query(default=10, ge=1, le=60),
                 force: bool = Query(default=False)):
    """Self-heal degraded/failed-collection breadth days by recomputing them from
    OUR bar data (the same reconstruction `validate_recent` uses). `date=YYYY-MM-DD`
    heals one day (with `force=1` even a good one); otherwise the last `days`
    collected sessions are scanned and any DEGRADED row is regenerated. PUSH_SECRET.
    """
    _check_auth(request)
    from api.services import breadth_self_heal
    if date:
        return breadth_self_heal.heal_date(date, force=force)
    return breadth_self_heal.heal_recent(days)


# ── B1 · the dark columnar series endpoint (D-035) ────────────────────────────

SERIES_FLAG = "BREADTH_SERIES_ENDPOINT_ENABLED"
_SERIES_MAX_KEYS = 8
#: Mirrors the monitor endpoint's own `le=8000` rather than inventing a second ceiling.
_SERIES_DAY_CEILING = 8000
#: The DEFAULT WINDOW size when `from` is omitted — a UX choice matching V1's own
#: default (D-052), NOT a safety bound. Deliberately decoupled from the cap below;
#: the two used to share one constant and that conflation is what "L-A: cap raise"
#: is untangling.
_SERIES_DEFAULT_SESSIONS = 365
#: The safety cap's fallback. Raised 2026-09-17 (L-A) from 365 once the reader work
#: had actually landed — see `series_max_sessions()`'s docstring. Sized to cover
#: V2-3's back-to-2008 "Max" preset (`MAX_HISTORY_FROM` in `BreadthChartsV2.jsx`) —
#: ~4,700 stored sessions from 2008-01-02 to 2026-09-17 (6,833 calendar days,
#: ~252 sessions/year less US market holidays) — with real margin, while staying
#: under `_SERIES_DAY_CEILING` at the ×1.6 conversion (4,700 × 1.6 = 7,520 days).
#: ⚠️ This is a FIXED session count against a FIXED start date, so the margin
#: shrinks by ~252 sessions/year as "today" advances; re-derive it, don't just bump
#: it, when `MAX_HISTORY_FROM` moves or this stops covering "Max".
_SERIES_MAX_SESSIONS_DEFAULT = 4700


def series_max_sessions() -> int:
    """The span cap, in STORED SESSIONS. `BREADTH_SERIES_MAX_SESSIONS`, default
    `_SERIES_MAX_SESSIONS_DEFAULT` (4,700).

    ⛔⛔ RAISED 2026-09-17 (L-A) — CORRECTING A STALE DOCSTRING, NOT LOOSENING A LIVE
    ONE. This previously read *"~55 s cold ... measured on production"* citing D-042 —
    the same defect the (now-closed) Breadth History Reader programme fixed. That
    number described the reader BEFORE its materialization fix
    (`api/services/breadth_monitor.py::get_history_deep`: *"used to assemble 174,187
    OHLC rows into 4,529 rows on every cold request; it is now one indexed read of
    pre-built rows"*), which had already landed, in this same session, before this
    docstring was ever written. True when written; the world had moved under it
    (Kind 3b).

    This endpoint calls that SAME reader (`svc.get_history_deep` — no second reader,
    see the router docstring), whose current, measured, per-deploy cost is in
    `docs/breadth-history-reader/FINAL.md` §14.1/§14.3: **p50 277.2-497.2 ms across
    six deploys, worst observed deploy max 3,752.1 ms** (n=54-77/deploy), against
    D-042's 54,923 ms cold baseline — 15x-141x depending on deploy. ⚠️ That table was
    measured against `/api/breadth-monitor`, a DIFFERENT ROUTE sharing this reader —
    its own post/derive/serialise phases do not transfer, only the reader cost does.

    This endpoint's OWN marginal cost (filter + project + encode, on top of the
    reader) IS measured directly, in `docs/breadth/api-series.md` (D-035,
    2026-09-14): the full 2008- span at 8 keys, 4,530 sessions, costs **30.3 ms
    cold p50 / 36.0 ms cold p95** — a stubbed full-size row set isolating what this
    endpoint adds, deliberately excluding `get_history_deep`'s own cost (measured
    separately, above) rather than a local `C:\\data\\breadth_monitor.db` read
    (12 KB, schema-only, which would have flattered the number).

    **Combined, a cold full-history 8-key request costs roughly the reader's
    277-497 ms typical (up to ~3.75 s worst observed deploy) plus this endpoint's
    own ~30-36 ms** — dominated by the reader, and nowhere near the retired 55 s
    figure.

    ⭐ **This is the condition the owner ruling itself named, not a override of it.**
    D-043 (`docs/breadth/DECISIONS.md`, 2026-09-14) is the ruling that set this cap:
    *"the reader gets its own programme... until that programme lands, the cost is
    made unreachable rather than tolerated"* — and states its own release condition
    verbatim: *"the cap is raised when the reader work lands, not to satisfy a wider
    view."* The reader programme (Breadth History Reader / SD-1.7) has since closed;
    its own `session6-report.md` §2.5, taken mid-programme before the fix had fully
    landed, additionally recommended no change YET, naming its own exception:
    *"a member-facing feature that actually requests > 365 sessions"* — which V2-3's
    back-to-2008 "Max" preset now is. Both conditions this cap was waiting on are
    met: the reader work landed, and a feature asked for more.
    """
    try:
        v = int(os.getenv("BREADTH_SERIES_MAX_SESSIONS", "") or _SERIES_MAX_SESSIONS_DEFAULT)
        return v if v > 0 else _SERIES_MAX_SESSIONS_DEFAULT
    except ValueError:
        return _SERIES_MAX_SESSIONS_DEFAULT


def series_max_calendar_days(max_sessions: int | None = None) -> int:
    """Calendar bound that admits `max_sessions` sessions and no deep read.

    ⛔ CHECKED BEFORE THE READ, NOT AFTER. Counting sessions requires reading them, and a
    post-read rejection has already paid the 55 s it exists to prevent — it would report
    the problem instead of preventing it.

    A year holds ~252 sessions in 365 calendar days (×1.448). ×1.6 is the conservative
    direction: a full `max_sessions` request is NEVER rejected for being a few holidays
    long, and the worst case admitted is ~1.1× the cap in sessions rather than the 4,703
    that cost 55 s.
    """
    return int((max_sessions or series_max_sessions()) * 1.6)
_SERIES_TTL = 300

#: DC-3 (D-056): dark, default OFF — an ENABLEMENT gate (unset = not running),
#: same polarity as BREADTH_DC_V2_2/3_ENABLED, not the hub's kill-switch polarity.
_SERIES_BOOT_WARM_FLAG = "BREADTH_SERIES_BOOT_WARM_ENABLED"


def series_boot_warm_enabled() -> bool:
    return os.getenv(_SERIES_BOOT_WARM_FLAG, "").strip().lower() in ("1", "true", "yes", "on")


def warm_series_deep() -> dict:
    """DC-3(b)/D-056 — touch the deep/reconstructed read path ONCE at boot so the
    OS page cache is warm before any member's first real `/series` request pays
    the cold cost.

    ⛔⛔ MEASURED, NOT INFERRED (DC-3a). The phase breakdown on a fresh boot's
    first `/series` request (Server-Timing, `docs/breadth/DECISIONS.md` D-056)
    showed the cost concentrated almost entirely in ONE phase — `adv_seed`, i.e.
    `_adv_decline_seed_before()` — which scans `breadth_daily_ohlc`/
    `breadth_snapshots` for every row before the window's oldest date to seed a
    cumulative A/D total. `io_read_bytes` climbing (real disk, not page-cache
    hits — see `breadth_timing.io_counters`'s own H1/page-cache discriminator)
    on the first request, and the SAME query pattern answering fast on every
    later request (including a much LARGER span asked immediately after),
    together are what make this a warmable OS-page-cache cost rather than the
    reader's own unfixable cold path.

    ⛔ WARMS THE WORST CASE ON PURPOSE. `_adv_decline_seed_before(oldest)`'s
    scan cost grows with how far back `oldest` reaches, so warming a shallow
    window (as the existing `_breadth()` dashboard-warm already does, `days=90`
    — well inside the collector floor, never touching this path at all) would
    warm nothing this function exists to fix. This reaches back to
    `MAX_HISTORY_FROM` (2008-01-02, `BreadthChartsV2.jsx`) — the same span
    V2-3's own "Max" preset asks for — so whichever member opens Data Charts
    first pays no more than the warm request already paid.

    ⛔ NEVER ON THE REQUEST PATH, NEVER BLOCKS `/api/health`. Called from
    `api/main.py`'s `_start_breadth_series_warm_background` — its OWN
    standalone delayed thread, DC-3(c)/D-056 addendum, deliberately NOT a
    step inside `_start_dashboard_warm_background`'s sequential chain (that
    placement left a measured 1-3 minute early-boot exposure window; see
    this function's caller for why). Wrapped in a try/except there — a
    failure here is logged and changes nothing else. Returns a summary dict
    rather than raising either way.
    """
    if not series_boot_warm_enabled():
        return {"ok": False, "reason": "flag off"}
    days = series_max_calendar_days(_SERIES_MAX_SESSIONS_DEFAULT)
    t0 = time.monotonic()
    rows = svc.get_history_deep(days, end=None, anchor="le")
    return {"ok": True, "days": days, "rows": len(rows),
            "elapsed_ms": round((time.monotonic() - t0) * 1000, 1)}


def require_series_flag() -> None:
    """404 unless the flag is on — for EVERY caller class.

    ⛔ THIS DEPENDENCY IS DECLARED BEFORE `require_paid` ON PURPOSE. FastAPI 0.115.6
    resolves a route's dependencies in DECLARATION ORDER
    (`fastapi/dependencies/utils.py:592`), so flag-first is what makes an unset flag a
    404 for anonymous, free and paid callers alike. Put `require_paid` first and an
    anonymous probe gets 401/402 instead — which ADVERTISES that a paid route exists
    here before it has shipped. Do not "tidy" the order; `tests/
    test_breadth_series_endpoint.py` asserts the positions, not just the status codes.
    """
    if os.getenv(SERIES_FLAG, "").strip().lower() not in ("1", "true", "yes", "on"):
        raise HTTPException(status_code=404, detail="Not Found")


def _finite_or_none(v):
    """Non-finite and absent both become null. ⛔ NEVER 0 — absence is not zero."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else None
    return None


def series_known_keys(rows: list) -> set:
    """The AUTHORITY for which keys exist: the row schema as served by
    `get_history_deep`.

    ⭐ Stated explicitly because D-035 allows either this or the chartMetrics registry.
    The registry is JavaScript and this is Python, so citing it would mean a hand-typed
    copy — the second-authority defect this programme spent R1 removing. The served row
    IS the set the endpoint can return, so it cannot drift from what is served.
    """
    out = set()
    for r in rows:
        for k, v in r.items():
            if k == "date" or k.startswith("_"):
                continue
            # ⛔ A SERIES IS NUMBERS. A key is a series key only if some row holds a
            # number for it — which excludes `*_list` ticker arrays by TYPE rather than
            # by a second stripper beside `get_history_deep`'s (that would be a second
            # authority over "what is served"). A key that never produces a number
            # cannot be a column, so it belongs in `missing[]`, not in `series`.
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out.add(k)
    return out


@router.get("/api/breadth-monitor/series")
def get_breadth_series(
    keys: str = Query(default=""),
    from_: str = Query(default="", alias="from"),
    to: str = Query(default=""),
    _flag: None = Depends(require_series_flag),
    _user: dict = Depends(require_paid),
):
    """Columnar breadth history for a few metrics over a long span (D-035).

    Columns carry each date ONCE instead of once per metric, which is the whole point
    against a bigger `days=` on the monitor route. Source of truth is
    `svc.get_history_deep` — there is no second history reader here, so reconstructed
    rows and rolling warm-up are whatever that function says they are.
    """
    t0 = time.monotonic()
    # ⛔⛔ DC-3 (2026-09-18): `get_history_deep`'s own `_bt.phase(...)` calls were
    # SILENTLY NO-OPPING here — phase()/mark() are no-ops without an open context,
    # and nothing on this path ever called `begin()`. Wired identically to the
    # monitor route below so the SAME reader phases (already computed inside
    # `get_history_deep` regardless of caller) become visible on THIS route's own
    # Server-Timing header and log line too. See `breadth_timing._ROUTES`.
    from api.services import breadth_timing
    breadth_timing.begin(span="series")
    requested = [k.strip() for k in (keys or "").split(",") if k.strip()]
    # Dedupe, order preserved — a repeated key must not consume the budget twice.
    seen = set()
    requested = [k for k in requested if not (k in seen or seen.add(k))]
    if len(requested) > _SERIES_MAX_KEYS:
        raise HTTPException(status_code=400,
                            detail=f"at most {_SERIES_MAX_KEYS} keys per request; got {len(requested)}")

    bounds = svc.date_bounds()
    to_date = (to or "").strip() or (bounds.get("max") or "")
    if not to_date:
        raise HTTPException(status_code=503, detail="no stored sessions")

    from_date = (from_ or "").strip()
    if not from_date:
        # Documented default: the 365 most recent STORED SESSIONS ending at `to`.
        seed = svc.get_history_deep(_SERIES_DEFAULT_SESSIONS, end=to_date, anchor="le")
        from_date = (seed[-1]["date"] if seed else to_date)
    if from_date > to_date:
        raise HTTPException(status_code=400, detail=f"from ({from_date}) is after to ({to_date})")

    try:
        span_days = (date.fromisoformat(to_date) - date.fromisoformat(from_date)).days + 1
    except ValueError:
        raise HTTPException(status_code=400, detail="from/to must be YYYY-MM-DD")
    max_sessions = series_max_sessions()
    max_days = series_max_calendar_days(max_sessions)
    if span_days > max_days:
        raise HTTPException(
            status_code=400,
            detail=(f"span {span_days} days exceeds the {max_sessions}-session cap "
                    f"({max_days} calendar days). Raised 2026-09-17 once the reader "
                    f"work behind D-042 actually landed; still capped so a span past "
                    f"what has been measured cannot reach an unmeasured reader depth."))
    if span_days > _SERIES_DAY_CEILING:                  # belt: the monitor route's own ceiling
        raise HTTPException(
            status_code=400,
            detail=f"span {span_days} days exceeds the {_SERIES_DAY_CEILING}-day ceiling")

    ck = "breadth_history_series_" + hashlib.sha1(
        ("|".join(sorted(requested)) + f"|{from_date}|{to_date}").encode()).hexdigest()[:16]
    hit = cache.get(ck)
    if hit is not None:
        _log_series(requested, span_days, None, True, t0)
        breadth_timing.note(cache="hit", cache_tier="series_body", rows=None)
        breadth_timing.mark("route_return")
        return Response(content=hit, media_type="application/json",
                        headers={"Cache-Control": "private, max-age=60"})

    # Over-fetch by CALENDAR days then filter: calendar days >= stored sessions, so the
    # window always covers the span, and `sessions` below is counted from what is stored.
    _rt0 = time.perf_counter()
    rows = [r for r in svc.get_history_deep(span_days, end=to_date, anchor="le")
            if r.get("date", "") >= from_date]
    breadth_timing.note(reader_ms=(time.perf_counter() - _rt0) * 1000.0, rows=len(rows),
                        cache="miss")
    with breadth_timing.phase("route_tail"):
        rows.sort(key=lambda r: r.get("date", ""))
        known = series_known_keys(rows)
        missing = [k for k in requested if k not in known]
        present = [k for k in requested if k in known]
        payload = {
            "from": from_date,
            "to": to_date,
            "sessions": len(rows),
            "dates": [r["date"] for r in rows],
            "series": {k: [_finite_or_none(r.get(k)) for r in rows] for k in present},
            "reconstructed": [r["date"] for r in rows if r.get("_reconstructed")],
            "missing": missing,
        }
    with breadth_timing.phase("serialise"):
        body = json.dumps(payload, separators=(",", ":"))
    # ⛔ Cached under the `breadth_history_` prefix DELIBERATELY: every snapshot write
    # already calls `cache.delete_prefix("breadth_history_")`, so this needs no new
    # invalidation path and none can be forgotten.
    cache.set(ck, body, ttl=_SERIES_TTL)
    _log_series(requested, span_days, len(rows), False, t0)
    breadth_timing.mark("route_return")
    return Response(content=body, media_type="application/json",
                    headers={"Cache-Control": "private, max-age=60"})


def _log_series(requested, span_days, sessions, cache_hit, t0) -> None:
    """One structured line. No member identifier — the scrubber has nothing to redact."""
    print(f"[breadth-series] keys={len(requested)} span_days={span_days} "
          f"sessions={sessions if sessions is not None else '-'} "
          f"cache={'hit' if cache_hit else 'miss'} ms={int((time.monotonic() - t0) * 1000)}",
          flush=True)


@router.get("/api/breadth-monitor/dates")
def get_breadth_dates(_user: dict = Depends(require_paid)):
    """The full merged session timeline (collector + reconstructed), NEWEST-FIRST.

    Tiny (~5k date strings) and cached — this is the index the Monitor's virtual
    scroller renders over, so a teleport is an instant scroll-to-index and only
    the visible rows fetch. `min`/`max` bound the navigator's calendar + year list.
    """
    try:
        asc = svc.merged_dates()           # oldest-first
        return {
            "dates": list(reversed(asc)),  # newest-first for the table
            "count": len(asc),
            "min": asc[0] if asc else None,
            "max": asc[-1] if asc else None,
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/breadth-monitor/analogues")
def get_breadth_analogues(top_n: int = Query(default=5, ge=3, le=10),
                          _user: dict = Depends(require_paid)):
    """Return the top_n historical dates most similar to the current breadth regime."""
    try:
        return find_analogues(top_n=top_n)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/breadth-monitor/score-components/{date}")
def get_breadth_score_components(date: str,
                                 # ⚰️ 3650 -> 8000, FOLLOWING THE SIBLING. `days` selects a
                                 # `get_history` cache entry and `/api/breadth-monitor` is what
                                 # WARMS it, so the two must accept the same range or the sharing
                                 # is accidental. `feat(breadth): infinitely-scrollable Monitor`
                                 # widened the sibling to 8000 and left this one behind, which is
                                 # exactly what `test_days_is_bounded_exactly_like_the_sibling_
                                 # endpoint` exists to catch — and did.
                                 days: int = Query(default=90, ge=1, le=8000),
                                 _user: dict = Depends(require_paid)):
    """Per-component attribution behind `breadth_score` for one session.

    The client MUST NOT re-derive these from `_SCORE_WEIGHTS`: the score
    renormalizes over present inputs, so the weights alone do not reproduce the
    points. Server-side is the only place the two can be guaranteed to agree.

    `days` is bounded exactly like `/api/breadth-monitor` above, and for the
    same reason: it selects a `get_history` cache entry, and the sibling
    endpoint is what warms it. The client passes the window it already loaded,
    so this shares that entry instead of opening a fourth one nothing warms.

    The path date is validated the way `session-path` validates its own —
    through `_require_iso_date`, the one authority — BEFORE the service runs.
    An unvalidated param bought a full history fetch and derivation pass on a
    single-process pod just to answer `ok: false` to a string that could never
    have matched a stored date.
    """
    _require_iso_date(date)
    try:
        return svc.score_components(date, days=days)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/api/breadth-monitor/live")
def get_breadth_live(force: bool = False,
                     _user: dict = Depends(require_paid)):
    """Breadth as of right now — provisional, never stored.

    Returns the live-computable metrics plus `carried`: the fields the daily
    row holds that cannot be derived intraday (sentiment surveys, the EOD
    put/call print, UCT exposure), taken verbatim from the newest stored row
    and stamped with that row's date. Keeping them in a separate bag is the
    point — a carried-forward number must never read as a live one.
    """
    from api.services import breadth_live as live

    try:
        payload = live.compute_live(force=force)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not payload.get("ok"):
        raise HTTPException(status_code=503, detail=payload.get("reason", "unavailable"))

    recent = svc.get_history(11)
    latest = recent[0] if recent else {}
    carried = {k: latest[k] for k in live.NOT_LIVE if latest.get(k) is not None}
    payload["carried"] = carried
    payload["carried_from"] = latest.get("date")

    # Once the collector has written today's row there is nothing provisional
    # left to say — the authoritative number replaces the estimate rather than
    # sitting beside it.
    payload["superseded"] = bool(latest.get("date")
                                 and latest["date"] >= payload["session_date"])

    # The row a surface renders: live metrics + carried fields, run through the
    # same derivation every stored row gets.
    payload["row"] = svc.derive_live_row({**carried, **payload["metrics"],
                                          "date": payload["session_date"]}, recent)

    # Record the session's shape HERE rather than inside compute_live, because
    # `breadth_score` and the rolling ratios only exist once the row has been
    # derived — recording the raw metrics would leave the headline number with
    # no path at all. Sitting outside the compute cache is fine: `record()`
    # enforces its own minimum interval, so a cache hit costs one cheap guard.
    #
    # Only a live, anchored, non-degraded, not-yet-superseded sample is kept. A
    # degraded reading measured a different population; one taken after the
    # collector has written describes a day that already has an authoritative
    # answer; and requiring `anchored` means every sample in a path shares one
    # basis, so the line cannot step when coverage drifts mid-session.
    try:
        from api.services import breadth_intraday
        if (payload.get("session_live") and payload.get("anchored")
                and not payload.get("degraded") and not payload["superseded"]):
            breadth_intraday.record(payload["session_date"], payload["row"])
            # Roll today's permanent per-metric OHLC (open/high/low/close) from this
            # sample — the data behind breadth-chart candle WICKS. Same gate as the
            # intraday path; best-effort (never breaks the live payload).
            try:
                from api.services import breadth_daily_ohlc
                breadth_daily_ohlc.update_intraday(payload["session_date"], payload["row"])
            except Exception:
                pass
        payload["path"] = breadth_intraday.session_path(payload["session_date"])
        payload["open"] = breadth_intraday.session_open(payload["session_date"])
        # A store that fails silently for a whole session is how you discover at
        # 4pm that no path was ever written. Publishing its health costs nothing
        # and makes that visible from the same payload the surfaces already read.
        payload["store"] = breadth_intraday.health()

        # Ratio-Bars FREEZE: the live-only internals (adv/dec, from-open, on-
        # volume) exist only in this read, so once the market is not in the
        # regular session the widget holds the last regular-session (<=16:00 ET)
        # sample of the most recent session with data — the day's close, kept on
        # screen until the next 9:30 open.
        fdate = breadth_intraday.latest_session()
        payload["internals_frozen"] = (
            breadth_intraday.session_last(fdate, keys=live.RATIO_INTERNAL_KEYS,
                                          before_et_minute=16 * 60)
            if fdate else {}
        )
        payload["internals_frozen_date"] = fdate
    except Exception as e:
        # A store that cannot write must still let the live read through.
        print(f"[breadth_monitor] intraday store unavailable: {e}")
        payload["path"], payload["open"] = {}, {}
        payload["store"] = {"ok": False, "last_error": f"{type(e).__name__}: {e}"}
        payload["internals_frozen"], payload["internals_frozen_date"] = {}, None

    return payload


@router.get("/api/breadth-monitor/session-path/{session_date}")
def get_breadth_session_path(session_date: str,
                             _user: dict = Depends(require_paid)):
    """A finished session's intraday shape, straight from the store.

    `/live` withholds everything once the collector writes the day — right for
    the provisional row, but the session's PATH is history, not an estimate,
    and the Daily Overview hero still wants it after the close. Retention is
    `breadth_intraday.RETENTION_DAYS`; an unrecorded day is `ok: False`, not an
    error, so the surface can fall back without treating it as an outage.
    """
    _require_iso_date(session_date)
    from api.services import breadth_intraday
    try:
        path = breadth_intraday.session_path(session_date)
        opens = breadth_intraday.session_open(session_date)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"ok": bool(path), "date": session_date, "path": path, "open": opens}


@router.get("/api/breadth-monitor/live/reconcile")
def reconcile_breadth_live(date: str, request: Request,
                           dividend_basis: int | None = None):
    """Replay the live path for a past session and diff it against the stored row.

    This is the gate: no live value goes on screen until it passes.

    `?dividend_basis=1|0` forces the price-basis arm instead of reading the
    `BREADTH_DIVIDEND_BASIS` flag, so both bases can be measured against the
    same stored rows in ONE deploy. Comparing arms across two deploys would
    mean comparing numbers produced by different processes, on a universe and
    a bars.db that both moved in between.
    """
    _check_auth(request)
    from api.services import breadth_live as live

    try:
        return live.reconcile(
            date, None if dividend_basis is None else bool(dividend_basis))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/breadth-monitor/live/dividends")
def breadth_dividends_status(_user: dict = Depends(require_paid)):
    """What the dividend store holds, and whether the last sweep truncated.

    `truncated` is the field that matters: a sweep that ran out of PAGES rather
    than out of data leaves only the recent tail, which does not fail — it
    quietly under-adjusts the oldest part of every 52-week window.
    """
    from api.services import breadth_dividends as bdiv
    from api.services import breadth_live as live

    h = bdiv.health()
    h["basis_enabled"] = live.dividend_basis_enabled()
    return h


@router.post("/api/breadth-monitor/live/dividends/refresh")
def breadth_dividends_refresh(request: Request, background: bool = True):
    """Sweep dividends. ~9 minutes for the full market, so it defaults to
    detached — a synchronous call would hold a request thread for the whole
    sweep on a single-process web pod."""
    _check_auth(request)
    from api.services import breadth_dividends as bdiv

    if not background:
        return bdiv.refresh()

    threading.Thread(target=bdiv.refresh, name="breadth-dividends-refresh",
                     daemon=True).start()
    return {"started": True, **bdiv.health()}


@router.get("/api/breadth-monitor/live/store")
def breadth_live_store(request: Request, selftest: bool = False):
    """What the intraday store holds, and whether it can actually write.

    `?selftest=1` writes a probe row, reads it back and removes it — so
    "can this pod persist an intraday sample?" is answerable the evening before
    a session rather than at 09:31 with everyone watching.
    """
    _check_auth(request)
    from api.services import breadth_intraday
    out = breadth_intraday.status()
    if selftest:
        out["self_test"] = breadth_intraday.self_test()
    return out


@router.get("/api/breadth-monitor/live/drill/{metric_key}")
def get_live_drill(metric_key: str,
                   _user: dict = Depends(require_paid)):
    """The names behind one cell of the intraday row.

    Declared BEFORE `/{date_str}/drill/{metric_key}` — that route matches "live"
    as a date perfectly well, so registered the other way round this one is
    unreachable and every live click 404s.

    Unavailable is `{ok: false, items: []}` with a reason rather than an error
    status: a click on a cold cache must not surface an error page.
    """
    from api.services import breadth_live as bl
    return bl.live_drill(metric_key)


@router.get("/api/breadth-monitor/latest")
def get_breadth_latest(_user: dict = Depends(require_paid)):
    row = svc.get_latest()
    if row is None:
        raise HTTPException(status_code=404, detail="No breadth data yet")
    return row


@router.post("/api/breadth-monitor/push")
async def push_breadth_snapshot(request: Request):
    _check_auth(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    date_str = body.get("date")
    metrics = body.get("metrics") or body  # accept flat payload too

    if not date_str:
        raise HTTPException(status_code=400, detail="'date' field required")

    # ⛔ COVERAGE GUARD: refuse a DEGRADED snapshot (a failed universe price pull —
    # Stage-2≈0, no 4%-movers, no new highs/lows against a real universe). A bad
    # collection must never overwrite a good/healed day. The self-heal recomputes
    # the day from bars instead. Overridable with ?force=1 for a deliberate re-push.
    force = request.query_params.get("force") in ("1", "true", "yes")
    if not force and svc.snapshot_looks_degraded(metrics):
        existing = svc.raw_row(date_str)
        # Kick a heal so the day still ends up accurate (from our bars), unless the
        # existing row is already good (then we just keep it).
        try:
            from api.services import breadth_self_heal
            if existing is None or svc.snapshot_looks_degraded(existing):
                import threading as _t
                _t.Thread(target=breadth_self_heal.heal_date, args=(date_str,),
                          daemon=True, name="breadth-heal-onpush").start()
        except Exception:
            pass
        raise HTTPException(
            status_code=422,
            detail=(f"Snapshot for {date_str} rejected: whole-market coverage "
                    f"collapsed (universe={metrics.get('universe_count')}, "
                    f"stage2={metrics.get('stage2_count')}, up4%={metrics.get('up_4pct_today')}). "
                    "A degraded run is not stored; the day is healed from bars instead. "
                    "Re-push with ?force=1 to override."))

    ok = svc.store_snapshot(date_str, metrics)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to store snapshot")

    invalidate_analogues_cache()

    # Warm bars for every ticker in every _list field of this snapshot so
    # Breadth drill charts load instantly for the new day's data.
    try:
        from api.routers.bars import warm_bars_async
        seen: set[str] = set()
        for k, v in metrics.items():
            if not k.endswith("_list") or not isinstance(v, list):
                continue
            for item in v:
                sym = item.get("t") if isinstance(item, dict) else None
                if sym:
                    seen.add(sym.upper())
        if seen:
            warm_bars_async(list(seen), tf="D", bars=8000)
    except Exception:
        pass

    return {"status": "ok", "date": date_str, "keys": len(metrics)}


@router.delete("/api/breadth-monitor/{date_str}")
async def delete_breadth_snapshot(date_str: str, request: Request):
    _check_auth(request)
    ok = svc.delete_snapshot(date_str)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No snapshot for {date_str}")
    return {"status": "deleted", "date": date_str}


@router.get("/api/breadth-monitor/{date_str}/drill/{metric_key}")
def get_drill_list(date_str: str, metric_key: str,
                   _user: dict = Depends(require_paid)):
    items = svc.get_drill_list(date_str, metric_key)
    if items is None:
        raise HTTPException(status_code=404, detail=f"No data for {date_str}/{metric_key}")
    # Fire-and-forget: warm Daily bars for the first 30 tickers in the list.
    # By the time the user navigates to any of them (usually >5 s away), the
    # Massive API call will have completed and the chart loads instantly.
    try:
        from api.routers.bars import warm_bars_async
        tickers = [i["t"] for i in items if isinstance(i, dict) and i.get("t")]
        if tickers:
            warm_bars_async(tickers, tf="D", bars=8000)
    except Exception:
        pass
    return {"date": date_str, "metric": metric_key, "items": items}


@router.get("/api/breadth-monitor/{date_str}/lists")
def get_breadth_lists(date_str: str,
                      keys: str = Query(default=""),
                      _worker: None = Depends(require_push_secret)):
    """Every `*_list` on one snapshot — the READ half of a maintenance rewrite.

    The drill GET above serves ONE list to a member. This serves ALL of them to
    the collector, which is the only caller that ever needs the whole set: to
    change a stored list it must first read the one it is about to write, and it
    has no member session to do that with.

    `keys` narrows it (comma-separated) so a patch touching two lists does not
    drag `universe_list`'s ~2,900 rows across the wire with them.

    ⛔ NOT `require_paid`. This is not a member surface — it is the machine door,
    and it admits no human account at all.
    """
    wanted = [k.strip() for k in keys.split(",") if k.strip()] or None
    iso = _require_iso_date(date_str)
    out = svc.get_snapshot_lists(iso, wanted)
    if out is None:
        raise HTTPException(status_code=404, detail=f"No snapshot for {date_str}")
    # The scalars ride along: a job that edits a list must be able to check the
    # count rendered beside it before rewriting it. Scalars only, so this adds
    # ~1KB next to lists that run to hundreds.
    return {"date": date_str, "lists": out, "counts": svc.get_snapshot_counts(iso) or {}}


@router.post("/api/breadth/industries")
async def breadth_industries(request: Request,
                             _user: dict = Depends(require_paid)):
    """Map a list of tickers → industry for the drill-down "group by" view.

    Backed by the universe-wide industry_map (Finviz-seeded, persisted) so the
    whole market is classified — not just the lazy catalyst cache. Non-blocking:
    returns the persisted map instantly; rare stragglers come back null and are
    warmed in the background. Read-only, same posture as the drill GET.

    Body: {"tickers": ["NVDA", ...]}
      →  {"industries": {...}, "sectors": {...}, "themes": {...}}
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    tickers = body.get("tickers") or []
    if not isinstance(tickers, list):
        raise HTTPException(status_code=400, detail="tickers must be a list")
    tickers = [str(t).upper() for t in tickers if t][:500]  # cap per call
    try:
        from api.services import industry_map
        groups = industry_map.get_groups(tickers)
        industries = {t: g.get("industry") for t, g in groups.items()}
        sectors = {t: g.get("sector") for t, g in groups.items()}
    except Exception as e:
        # Never break the drill modal over enrichment — degrade to ungrouped.
        import logging
        logging.getLogger(__name__).warning("[breadth] industries lookup failed: %s", e)
        industries = {t: None for t in tickers}
        sectors = {t: None for t in tickers}
    # Same posture as the industries lookup above: never break the drill over
    # enrichment. _primary_themes catches internally, and this catches the case
    # where it cannot even be called — an ungrouped drill beats no drill.
    try:
        themes = await _primary_themes(tickers)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("[breadth] theme enrichment unavailable: %s", e)
        themes = {t: None for t in tickers}
    # `industries` kept as the back-compat key; `sectors` and `themes` added for
    # the Sector ⇄ Industry ⇄ Theme dimension toggle.
    return {"industries": industries, "sectors": sectors, "themes": themes}


def _primary_themes_blocking(tickers: list) -> dict:
    """{TICKER: theme_name|None} using the EXISTING authority.

    ⛔ Does NOT re-implement the ranking. `groups.resolve_primary_theme` already
    owns "which of a ticker's themes is THE one" — owner memberships outrank
    engine ones, then tier, then smallest theme, with factor buckets excluded —
    and `ticker_meta` displays the same answer. A second ranking here would drift
    from the theme shown everywhere else in the app.
    """
    from api.services.groups import resolve_primary_theme
    out = {}
    for t in tickers:
        try:
            row = resolve_primary_theme(t)
            out[t] = (row or {}).get("theme_name") or None
        except Exception:
            # One unclassifiable ticker must not cost the whole map.
            out[t] = None
    return out


async def _primary_themes(tickers: list) -> dict:
    """Off the event loop: resolve_primary_theme is ONE SQLite query per ticker,
    and a 134-name drill would otherwise run 134 sequential queries on the single
    shared loop this pod serves every user from. Degrades to an all-null map
    rather than failing the request — an ungrouped drill beats no drill.
    """
    if not tickers:
        return {}
    try:
        import asyncio
        return await asyncio.to_thread(_primary_themes_blocking, tickers)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("[breadth] theme lookup failed: %s", e)
        return {t: None for t in tickers}


@router.get("/api/breadth/industries/status")
def breadth_industries_status(_user: dict = Depends(require_paid)):
    """Coverage diagnostics for the universe industry map."""
    try:
        from api.services import industry_map
        return industry_map.status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/breadth/industries/refresh")
def breadth_industries_refresh(request: Request):
    """Force a full Finviz bulk refresh of the industry map (admin)."""
    _check_auth(request)
    try:
        from api.services import industry_map
        n = industry_map.bulk_refresh_from_finviz()
        return {"refreshed": n}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/api/breadth-monitor/{date_str}/field")
async def patch_breadth_field(date_str: str, request: Request):
    _check_auth(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    key = body.get("key")
    value = body.get("value")
    if not key:
        raise HTTPException(status_code=400, detail="'key' required")
    ok = svc.patch_field(date_str, key, value)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No snapshot for {date_str}")
    return {"status": "ok", "date": date_str, "key": key, "value": value}
