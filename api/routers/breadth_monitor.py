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

import os
import threading

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import breadth_monitor as svc
from api.services.breadth_analogues import find_analogues, invalidate_cache as invalidate_analogues_cache

router = APIRouter()

_PUSH_SECRET = os.environ.get("PUSH_SECRET", "")


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
    """Coverage of the breadth candle-wick store (no auth — read-only metadata)."""
    from api.services import breadth_daily_ohlc
    return breadth_daily_ohlc.stats()


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
def get_breadth_symbols():
    """Public catalog of the UCT breadth pseudo-tickers (UCTA50 etc.) so the chart
    UI can recognize them (daily-only, no live quote, breadth watermark) and group
    them. No auth — the charts they power are free-tier, and this is only metadata."""
    from api.services import breadth_symbols as bs
    return {
        "symbols": bs.list_breadth_symbols(),
        "groups": [{"id": g, "label": bs.LIST_META[g]["label"],
                    "list_name": bs.LIST_META[g]["list_name"]} for g in bs.GROUP_ORDER],
    }


@router.get("/api/breadth-monitor")
def get_breadth_history(days: int = Query(default=90, ge=1, le=3650),
                        _user: dict = Depends(require_paid)):
    try:
        return {"rows": svc.get_history(days), "days": days}
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
                                 days: int = Query(default=90, ge=1, le=3650),
                                 _user: dict = Depends(require_paid)):
    """Per-component attribution behind `breadth_score` for one session.

    The client MUST NOT re-derive these from `_SCORE_WEIGHTS`: the score
    renormalizes over present inputs, so the weights alone do not reproduce the
    points. Server-side is the only place the two can be guaranteed to agree.

    `days` is bounded exactly like `/api/breadth-monitor` above, and for the
    same reason: it selects a `get_history` cache entry, and the sibling
    endpoint is what warms it. The client passes the window it already loaded,
    so this shares that entry instead of opening a fourth one nothing warms.
    """
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
    import re
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", session_date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
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


@router.post("/api/breadth/industries")
async def breadth_industries(request: Request,
                             _user: dict = Depends(require_paid)):
    """Map a list of tickers → industry for the drill-down "group by" view.

    Backed by the universe-wide industry_map (Finviz-seeded, persisted) so the
    whole market is classified — not just the lazy catalyst cache. Non-blocking:
    returns the persisted map instantly; rare stragglers come back null and are
    warmed in the background. Read-only, same posture as the drill GET.

    Body: {"tickers": ["NVDA", ...]}  →  {"industries": {"NVDA": "Semiconductors", ...}}
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
    # `industries` kept as the back-compat key; `sectors` added for the
    # Sector ⇄ Industry dimension toggle.
    return {"industries": industries, "sectors": sectors}


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
