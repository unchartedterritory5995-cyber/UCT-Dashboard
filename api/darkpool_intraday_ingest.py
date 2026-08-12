"""
darkpool_intraday_ingest.py — near-real-time (~2-5 min) dark-pool preview.

Companion to darkpool_massive_ingest.py (the authoritative nightly 19:20 ET
batch). This poller runs every few minutes during market hours and writes live
off-exchange prints into the EPHEMERAL darkpool_today table, so the Dark Pool
page can show "today so far" instead of waiting for the nightly run.

WHY A SEPARATE TABLE (the whole design): darkpool_aggregator caches every
historical window (1/5/20/60/90/all) keyed by a darkpool_trades signature
(row_count, max_id). ANY insert into darkpool_trades invalidates all of them and
forces a multi-million-row rebuild of each. Writing live prints there every few
minutes would be a rebuild storm. Instead we write to darkpool_today (isolated
table, isolated one-slot cache via get_today_aggregated) — the historical path is
never touched during the day. The nightly ingest remains the source of truth; it
writes the full session into darkpool_trades and then clear_today() rolls this.

REUSE: the off-exchange filter (exchange 4/9), the $4M notional floor, the
BBS-schema row builder, and the universe ranking are all imported from
darkpool_massive_ingest so the preview classifies IDENTICALLY to the nightly run.

INCREMENTAL: each poll fetches only [cursor, now] (cursor = last poll's high
water mark, minus a small overlap). Dedup on (date, timestamp, ticker, price,
notional, message) makes overlapping windows safe.

GATED OFF BY DEFAULT: set DARKPOOL_INTRADAY_ENABLED=1 to arm the scheduled job.
A deploy alone will not start polling. Runs on the WEB service (owns
/data/darkpool.db + serves /api/darkpool/*), same as the nightly ingest.
"""

import os
import time
import logging
import datetime
import threading
from typing import Optional, List

logger = logging.getLogger("darkpool_intraday")

# Reuse the nightly module's internals so the filter/classification is single-sourced.
from api.darkpool_massive_ingest import (
    ET,
    API_KEY,
    OFFEXCHANGE,
    MIN_NOTIONAL,
    PAGE_CAP,
    BASE,
    UA,
    _get,
    _print_to_row,
    _rows_to_csv,
    resolve_universe,
    BASE_UNIVERSE_CORE,
    _today_mdyyyy,
    _et_ns,
)

import urllib.parse

ENABLED = os.environ.get("DARKPOOL_INTRADAY_ENABLED", "0") == "1"

# Smaller universe than the nightly 150 — polled every few minutes, so keep the
# REST load bounded. Ranked by recent dark-pool notional (resolve_universe).
INTRADAY_TOP_N = int(os.environ.get("DARKPOOL_INTRADAY_TOP_N", "40"))
# Session start for the first poll of the day (captures pre-market off-exchange
# prints, matching the nightly 07:00 ET window start).
INTRADAY_WINDOW_START = os.environ.get("DARKPOOL_INTRADAY_WINDOW_START", "07:00:00")
# Re-fetch a small overlap before the cursor so a print landing exactly on the
# boundary is never missed (dedup absorbs the repeat). Seconds.
CURSOR_OVERLAP_SEC = int(os.environ.get("DARKPOOL_INTRADAY_OVERLAP_SEC", "10"))
# Per-cycle wall-clock budget — must stay well under the 3-min cadence so cycles
# never pile up. Bounds a slow REST day.
INTRADAY_TIME_BUDGET_SEC = float(os.environ.get("DARKPOOL_INTRADAY_TIME_BUDGET_SEC", "120"))
# Fewer pages per ticker than the nightly cap — each intraday window is a few
# minutes of tape, not a whole session.
INTRADAY_PAGE_CAP = int(os.environ.get("DARKPOOL_INTRADAY_PAGE_CAP", "20"))


def _now_ns() -> int:
    now = datetime.datetime.now(ET) if ET else datetime.datetime.now()
    return int(now.timestamp() * 1e9)


# ── incremental cursor / session state ───────────────────────────────────
# Module-level (single web process — same assumption the rest of the darkpool
# path makes). Tracks how far we've pulled so each poll only fetches the delta.
_cursor_lock = threading.Lock()
_session_date: Optional[str] = None   # M/D/YYYY of the active session
_cursor_ns: Optional[int] = None      # high-water mark of the last poll
_universe: List[str] = []             # resolved once per session


def _reset_session(date_mdyyyy: str) -> None:
    """Start a fresh session: clear any stale preview rows, reset the cursor to
    the session window start, and re-rank the universe. Called when the date
    rolls (or on the first poll after a restart)."""
    global _session_date, _cursor_ns, _universe
    try:
        from api.darkpool_db import clear_today
        from api.darkpool_aggregator import invalidate_today_cache
        clear_today()
        invalidate_today_cache()
    except Exception as e:
        logger.warning("[darkpool_intraday] session reset clear failed: %s", e)
    _session_date = date_mdyyyy
    _cursor_ns = _et_ns(date_mdyyyy, INTRADAY_WINDOW_START)
    try:
        _universe = resolve_universe(INTRADAY_TOP_N, base=BASE_UNIVERSE_CORE)
    except Exception as e:
        logger.warning("[darkpool_intraday] universe resolve failed: %s", e)
        _universe = []
    logger.info("[darkpool_intraday] session %s armed — universe=%d, cursor=%s",
                date_mdyyyy, len(_universe), INTRADAY_WINDOW_START)


def _fetch_window(ticker: str, lo_ns: int, hi_ns: int,
                  page_cap: int = INTRADAY_PAGE_CAP) -> List[dict]:
    """Off-exchange prints above the floor for one ticker in [lo_ns, hi_ns].

    Mirrors darkpool_massive_ingest.fetch_offexchange but over an explicit ns
    window instead of the fixed 07:00-19:00 session (same OFFEXCHANGE set + floor).
    """
    params = {
        "timestamp.gte": lo_ns, "timestamp.lte": hi_ns, "order": "asc",
        "sort": "timestamp", "limit": 50000, "apiKey": API_KEY,
    }
    url = f"{BASE}/v3/trades/{urllib.parse.quote(ticker)}?" + urllib.parse.urlencode(params)
    kept: List[dict] = []
    for _ in range(page_cap):
        data = _get(url)
        for t in (data.get("results") or []):
            if t.get("exchange") not in OFFEXCHANGE:
                continue
            px, sz = t.get("price"), t.get("size")
            if not px or not sz:
                continue
            if px * sz >= MIN_NOTIONAL:
                kept.append(t)
        nxt = data.get("next_url")
        if not nxt:
            break
        url = nxt + (("&" if "?" in nxt else "?") + "apiKey=" + urllib.parse.quote(API_KEY))
    return kept


# ── background run-state (mirrors darkpool_massive_ingest) ────────────────
_run_lock = threading.Lock()
_run_state: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "phase": None,
    "last_result": None,
    "last_error": None,
}


def get_run_state() -> dict:
    with _run_lock:
        return dict(_run_state)


def _set_phase(phase: str) -> None:
    with _run_lock:
        _run_state["phase"] = phase


def run_intraday(top_n: int = INTRADAY_TOP_N,
                 time_budget_sec: float = INTRADAY_TIME_BUDGET_SEC) -> dict:
    """One incremental poll cycle: pull [cursor, now] for the session universe,
    merge new off-exchange prints into darkpool_today, advance the cursor.

    Safe to re-run: darkpool_today dedups on
    (date, timestamp, ticker, price, notional, message)."""
    global _cursor_ns
    started = time.time()

    if not API_KEY:
        return {"ok": False, "error": "MASSIVE_API_KEY not set"}

    date_mdyyyy = _today_mdyyyy()
    with _cursor_lock:
        if _session_date != date_mdyyyy or _cursor_ns is None:
            _reset_session(date_mdyyyy)
        universe = list(_universe)
        lo_ns = max(0, (_cursor_ns or 0) - int(CURSOR_OVERLAP_SEC * 1e9))
    hi_ns = _now_ns()

    if not universe:
        return {"ok": False, "error": "empty universe — darkpool.db has no rows to rank"}
    if hi_ns <= lo_ns:
        return {"ok": True, "date": date_mdyyyy, "note": "no new window", "inserted": 0}

    rows: List[dict] = []
    stats = {"tickers_done": 0, "prints": 0, "failed": []}

    for idx, tk in enumerate(universe, 1):
        _set_phase("%s (%d/%d)" % (tk, idx, len(universe)))
        if time.time() - started > time_budget_sec:
            logger.warning("[darkpool_intraday] time budget %.0fs hit — %d/%d tickers this cycle",
                           time_budget_sec, stats["tickers_done"], len(universe))
            break
        try:
            prints = _fetch_window(tk, lo_ns, hi_ns)
        except Exception as e:
            stats["failed"].append(tk)
            logger.warning("[darkpool_intraday] %s fetch failed: %s", tk, e)
            continue
        stats["tickers_done"] += 1
        for t in prints:
            try:
                rows.append(_print_to_row(tk, date_mdyyyy, t))
            except Exception:
                continue
        stats["prints"] += len(prints)

    # Advance the cursor to the high-water mark we just scanned (only the tickers
    # we actually reached are covered by hi_ns; a budget-truncated cycle still
    # advances — the next cycle's overlap re-window + dedup backfills the rest).
    with _cursor_lock:
        if _session_date == date_mdyyyy:
            _cursor_ns = hi_ns

    out = {"ok": True, "date": date_mdyyyy, "universe": len(universe),
           "elapsed_sec": round(time.time() - started, 1), **stats}

    if not rows:
        out["inserted"] = 0
        return out

    try:
        from api.darkpool_db import insert_today_rows
        result = insert_today_rows(_rows_to_csv(rows))
        out.update(result)
    except Exception as e:
        logger.exception("[darkpool_intraday] insert failed")
        out["ok"] = False
        out["error"] = str(e)
        return out

    logger.info("[darkpool_intraday] %s: +%d new / %d prints from %d tickers in %.0fs",
                date_mdyyyy, result.get("inserted", 0), len(rows),
                stats["tickers_done"], out["elapsed_sec"])

    # Real-time record check against the live prints (self-gated on
    # DARKPOOL_RECORDS_ENABLED; fail-soft — never break the poll).
    try:
        from api.darkpool_records import refresh_from_today
        _rec = refresh_from_today()
        if _rec.get("ok") and _rec.get("alerts_sent"):
            logger.info("[darkpool_intraday] records: %s", _rec)
    except Exception as e:
        logger.warning("[darkpool_intraday] records refresh skipped: %s", e)
    return out


def run_intraday_background(**kwargs) -> dict:
    """Start a poll cycle in a daemon thread. Refuses to start a second
    concurrent cycle (the scheduler is max_instances=1, but a manual trigger
    could still overlap)."""
    with _run_lock:
        if _run_state["running"]:
            return {"started": False, "reason": "already running",
                    "state": dict(_run_state)}
        _run_state.update({
            "running": True,
            "started_at": datetime.datetime.now(ET).isoformat() if ET
                          else datetime.datetime.now().isoformat(),
            "finished_at": None, "phase": "starting",
            "last_result": None, "last_error": None,
        })

    def _worker():
        try:
            result = run_intraday(**kwargs)
            with _run_lock:
                _run_state["last_result"] = result
        except Exception as e:
            logger.exception("[darkpool_intraday] background cycle failed")
            with _run_lock:
                _run_state["last_error"] = str(e)
        finally:
            with _run_lock:
                _run_state["running"] = False
                _run_state["phase"] = None
                _run_state["finished_at"] = (
                    datetime.datetime.now(ET).isoformat() if ET
                    else datetime.datetime.now().isoformat())

    threading.Thread(target=_worker, daemon=True,
                     name="darkpool-intraday-ingest").start()
    return {"started": True, "poll": "GET /api/darkpool/intraday-ingest/status"}


def scheduled_run() -> None:
    """APScheduler entry point. No-op unless DARKPOOL_INTRADAY_ENABLED=1.

    Routes through run_intraday_background() so the scheduler worker frees
    immediately and the shared _run_state carries the last result/error to the
    status endpoint (same pattern the nightly ingest uses)."""
    if not ENABLED:
        logger.debug("[darkpool_intraday] disabled "
                     "(set DARKPOOL_INTRADAY_ENABLED=1 to arm)")
        return
    started = run_intraday_background()
    if not started.get("started"):
        # Only refused by the concurrency guard: the previous cycle is still
        # running (a slow REST cycle overrunning the cadence). Skipping is
        # correct — don't double the load — but must be visible.
        logger.warning("[darkpool_intraday] cycle SKIPPED — %s", started.get("reason"))


def roll_session() -> int:
    """Clear the preview table + reset the cursor. Called by the nightly ingest
    after it folds the authoritative session into darkpool_trades, so the live
    'today' strip disappears once the real day is queryable. Idempotent."""
    global _session_date, _cursor_ns
    try:
        from api.darkpool_db import clear_today
        from api.darkpool_aggregator import invalidate_today_cache
        n = clear_today()
        invalidate_today_cache()
    except Exception as e:
        logger.warning("[darkpool_intraday] roll_session clear failed: %s", e)
        n = 0
    with _cursor_lock:
        _session_date = None
        _cursor_ns = None
    return n
