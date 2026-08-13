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
    BASE_UNIVERSE,
    _today_mdyyyy,
    _et_ns,
)

import urllib.parse

ENABLED = os.environ.get("DARKPOOL_INTRADAY_ENABLED", "0") == "1"

# ── Tiered cadence + snapshot fast-lane (2026-08-13) ──────────────────────────
# The 3-min hot poll above covers a small universe. This flag arms TWO more
# streams (both gated so a deploy alone does nothing): a slower WARM poll over
# the full ~288 base, and a SNAPSHOT FAST-LANE that answers "how do we know
# about a ticker we're not polling?" — it reads the whole-market snapshot (one
# call) each cycle, finds an off-radar name whose volume just spiked, and
# deep-pulls its dark prints immediately. Requires DARKPOOL_INTRADAY_ENABLED too.
TIERED_ENABLED = os.environ.get("DARKPOOL_INTRADAY_TIERED_ENABLED", "0") == "1"
# Warm poll: the full base + a wider self-ranked slice, on a slow cadence.
WARM_TOP_N = int(os.environ.get("DARKPOOL_INTRADAY_WARM_TOP_N", "80"))
WARM_TIME_BUDGET_SEC = float(os.environ.get("DARKPOOL_INTRADAY_WARM_TIME_BUDGET_SEC", "600"))
# Fast-lane: an off-universe name is a candidate when today's volume is a large
# multiple of yesterday's (a spike) AND it's doing real dollar-volume. Each
# candidate is deep-pulled from the SESSION START (to catch a block that printed
# before the spike showed), and only PROMOTED to ongoing warm coverage if the
# pull actually found dark prints (so we don't keep polling dead names).
SCAN_SPIKE_MULT = float(os.environ.get("DARKPOOL_SCAN_SPIKE_MULT", "2.5"))
SCAN_MIN_DOLLAR_VOL = float(os.environ.get("DARKPOOL_SCAN_MIN_DOLLAR_VOL", "75e6"))
# Min share price — cuts the micro-cap volume pumps ($2 names doubling volume is
# noise, not an institutional dark block); a real $4M+ dark print lives on liquid,
# real-priced names. Set 0 to disable.
SCAN_MIN_PRICE = float(os.environ.get("DARKPOOL_SCAN_MIN_PRICE", "5.0"))
SCAN_MAX_CANDIDATES = int(os.environ.get("DARKPOOL_SCAN_MAX_CANDIDATES", "60"))
SCAN_TIME_BUDGET_SEC = float(os.environ.get("DARKPOOL_SCAN_TIME_BUDGET_SEC", "150"))
SCAN_PROMOTED_MAX = int(os.environ.get("DARKPOOL_SCAN_PROMOTED_MAX", "300"))
# Deep-pull only the last N minutes for a candidate, NOT the whole session — a
# block big enough to spike volume just printed, so a recent window catches it in
# ~2-3s instead of ~40s of full-day pagination. Once promoted, warm covers it
# incrementally. (Bounded by max(session_start, now - window).)
SCAN_RECENT_WINDOW_MIN = int(os.environ.get("DARKPOOL_SCAN_RECENT_WINDOW_MIN", "30"))

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
_cursor_ns: Optional[int] = None      # high-water mark of the last poll (HOT)
_universe: List[str] = []             # HOT universe, resolved once per session
# WARM tier + fast-lane state (own cursor so it advances on its own cadence).
_warm_cursor_ns: Optional[int] = None
_warm_universe: List[str] = []        # WARM universe (base minus hot), per session
_promoted: set = set()                # fast-lane names with CONFIRMED dark prints


def _reset_session(date_mdyyyy: str) -> None:
    """Start a fresh session: clear any stale preview rows, reset the cursor to
    the session window start, and re-rank the universe. Called when the date
    rolls (or on the first poll after a restart)."""
    global _session_date, _cursor_ns, _universe, _warm_cursor_ns, _warm_universe
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
    # WARM = the full base + a wider self-ranked slice, MINUS the hot set (so the
    # two tiers don't double-poll the same names). Its own cursor, same start.
    _warm_cursor_ns = _cursor_ns
    try:
        _hot = set(_universe)
        _warm_universe = [t for t in resolve_universe(WARM_TOP_N, base=BASE_UNIVERSE)
                          if t not in _hot]
    except Exception as e:
        logger.warning("[darkpool_intraday] warm universe resolve failed: %s", e)
        _warm_universe = []
    _promoted.clear()
    logger.info("[darkpool_intraday] session %s armed — hot=%d warm=%d, cursor=%s",
                date_mdyyyy, len(_universe), len(_warm_universe), INTRADAY_WINDOW_START)


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


# Separate run-states for the WARM + SCANNER streams so they never block the hot
# poll (or each other) on the shared concurrency guard — each gets its own lock.
_warm_run: dict = {"running": False, "started_at": None, "finished_at": None,
                   "phase": None, "last_result": None, "last_error": None}
_warm_run_lock = threading.Lock()
_scan_run: dict = {"running": False, "started_at": None, "finished_at": None,
                   "phase": None, "last_result": None, "last_error": None}
_scan_run_lock = threading.Lock()


def get_run_state() -> dict:
    with _run_lock:
        st = dict(_run_state)
    with _warm_run_lock:
        st["warm"] = dict(_warm_run)
    with _scan_run_lock:
        st["scanner"] = dict(_scan_run)
    st["tiered_enabled"] = TIERED_ENABLED
    return st


def _set_phase(phase: str) -> None:
    with _run_lock:
        _run_state["phase"] = phase


def _set_warm_phase(p: str) -> None:
    with _warm_run_lock:
        _warm_run["phase"] = p


def _set_scan_phase(p: str) -> None:
    with _scan_run_lock:
        _scan_run["phase"] = p


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


# ── WARM tier + snapshot FAST-LANE (2026-08-13) ──────────────────────────────

def _scan_tickers(tickers, date_mdyyyy, lo_ns, hi_ns, time_budget, set_phase, started):
    """Poll a ticker set over [lo_ns, hi_ns], return (rows, stats). Pure — no
    insert. Mirrors the hot loop; reuses _fetch_window + _print_to_row."""
    rows: List[dict] = []
    stats = {"tickers_done": 0, "prints": 0, "failed": []}
    n = len(tickers)
    for idx, tk in enumerate(tickers, 1):
        if set_phase:
            set_phase("%s (%d/%d)" % (tk, idx, n))
        if time.time() - started > time_budget:
            logger.warning("[darkpool_intraday] time budget %.0fs hit at %d/%d",
                           time_budget, stats["tickers_done"], n)
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
    return rows, stats


def _commit_today(rows) -> dict:
    """Insert rows into darkpool_today + run the real-time records check
    (fail-soft). Returns the insert result ({'inserted': 0} when empty)."""
    if not rows:
        return {"inserted": 0}
    from api.darkpool_db import insert_today_rows
    result = insert_today_rows(_rows_to_csv(rows))
    try:
        from api.darkpool_records import refresh_from_today
        refresh_from_today()
    except Exception as e:
        logger.warning("[darkpool_intraday] records refresh skipped: %s", e)
    return result


def run_intraday_warm(time_budget_sec: float = WARM_TIME_BUDGET_SEC) -> dict:
    """Slow poll over the full base (minus hot) + fast-lane-promoted names, from
    [warm_cursor, now]. Same incremental + dedup model as the hot poll."""
    global _warm_cursor_ns
    started = time.time()
    if not API_KEY:
        return {"ok": False, "error": "MASSIVE_API_KEY not set"}
    date_mdyyyy = _today_mdyyyy()
    with _cursor_lock:
        if _session_date != date_mdyyyy or _warm_cursor_ns is None:
            _reset_session(date_mdyyyy)
        hot = set(_universe)
        tickers = list(_warm_universe) + [t for t in _promoted if t not in hot]
        lo_ns = max(0, (_warm_cursor_ns or 0) - int(CURSOR_OVERLAP_SEC * 1e9))
    hi_ns = _now_ns()
    if not tickers:
        return {"ok": True, "tier": "warm", "date": date_mdyyyy, "note": "empty", "inserted": 0}
    if hi_ns <= lo_ns:
        return {"ok": True, "tier": "warm", "date": date_mdyyyy, "note": "no new window", "inserted": 0}
    rows, stats = _scan_tickers(tickers, date_mdyyyy, lo_ns, hi_ns,
                                time_budget_sec, _set_warm_phase, started)
    with _cursor_lock:
        if _session_date == date_mdyyyy:
            _warm_cursor_ns = hi_ns
    res = _commit_today(rows)
    out = {"ok": True, "tier": "warm", "date": date_mdyyyy, "universe": len(tickers),
           "promoted": len(_promoted), "elapsed_sec": round(time.time() - started, 1),
           **stats, **res}
    logger.info("[darkpool_intraday] WARM %s: +%d / %d prints, %d tickers, %.0fs",
                date_mdyyyy, res.get("inserted", 0), len(rows),
                stats["tickers_done"], out["elapsed_sec"])
    return out


def run_scanner(time_budget_sec: float = SCAN_TIME_BUDGET_SEC) -> dict:
    """The FAST-LANE — the answer to 'how do we know about a ticker we aren't
    polling?'. Read the whole-market snapshot (one call), find off-watched names
    whose volume just SPIKED (today_vol >= prev_vol * SCAN_SPIKE_MULT) on real
    dollar-volume, and deep-pull each from the SESSION START (to catch a block
    that printed before the spike showed). Names whose pull actually found dark
    prints are PROMOTED to ongoing warm coverage; the rest are dropped."""
    started = time.time()
    if not API_KEY:
        return {"ok": False, "error": "MASSIVE_API_KEY not set"}
    date_mdyyyy = _today_mdyyyy()
    with _cursor_lock:
        if _session_date != date_mdyyyy or _cursor_ns is None:
            _reset_session(date_mdyyyy)
        watched = set(_universe) | set(_warm_universe) | set(_promoted)
        session_start_ns = _et_ns(date_mdyyyy, INTRADAY_WINDOW_START)
    try:
        from api.services.massive import _get_client
        snap = _get_client().get_full_market_snapshot()
    except Exception as e:
        return {"ok": False, "tier": "scanner", "error": "snapshot failed: %s" % e}
    if not snap:
        return {"ok": True, "tier": "scanner", "date": date_mdyyyy, "note": "empty snapshot"}
    # candidate = off-watched volume spike with real dollar-volume
    cands = []
    for tk, s in snap.items():
        if tk in watched:
            continue
        pv = s.get("prev_vol") or 0
        tv = s.get("today_vol") or 0
        px = s.get("last_price") or 0
        if pv <= 0 or tv <= 0 or px < SCAN_MIN_PRICE:
            continue
        if tv >= pv * SCAN_SPIKE_MULT and tv * px >= SCAN_MIN_DOLLAR_VOL:
            cands.append((tk, tv * px, tv / pv))
    cands.sort(key=lambda c: (c[2], c[1]), reverse=True)   # spike ratio, then $-vol
    cand_syms = [c[0] for c in cands[:SCAN_MAX_CANDIDATES]]
    hi_ns = _now_ns()
    # Bounded recent window (not the whole session) so each pull is fast.
    win_lo = max(session_start_ns, hi_ns - int(SCAN_RECENT_WINDOW_MIN * 60 * 1e9))
    rows_all: List[dict] = []
    confirmed: List[str] = []
    done = 0
    for tk in cand_syms:
        if time.time() - started > time_budget_sec:
            break
        _set_scan_phase("deep-pull %s (%d/%d)" % (tk, done + 1, len(cand_syms)))
        try:
            prints = _fetch_window(tk, win_lo, hi_ns)
        except Exception as e:
            logger.warning("[darkpool_intraday] scanner %s pull failed: %s", tk, e)
            continue
        done += 1
        r = []
        for t in prints:
            try:
                r.append(_print_to_row(tk, date_mdyyyy, t))
            except Exception:
                continue
        if r:
            rows_all.extend(r)
            confirmed.append(tk)
    if confirmed:
        with _cursor_lock:
            for tk in confirmed:
                _promoted.add(tk)
            while len(_promoted) > SCAN_PROMOTED_MAX:
                _promoted.pop()
    res = _commit_today(rows_all)
    out = {"ok": True, "tier": "scanner", "date": date_mdyyyy,
           "snapshot_names": len(snap), "candidates": len(cand_syms),
           "deep_pulled": done, "confirmed_dark": len(confirmed),
           "confirmed": confirmed[:25], "prints": len(rows_all),
           "elapsed_sec": round(time.time() - started, 1), **res}
    logger.info("[darkpool_intraday] SCANNER %s: %d cand -> %d confirmed dark -> +%d / %d prints, %.0fs",
                date_mdyyyy, len(cand_syms), len(confirmed), res.get("inserted", 0),
                len(rows_all), out["elapsed_sec"])
    return out


def _bg(lock, state, fn, name) -> dict:
    """Generic fire-and-forget for the warm/scanner streams (own state each)."""
    with lock:
        if state["running"]:
            return {"started": False, "reason": "already running"}
        state.update({"running": True, "phase": "starting", "last_result": None,
                      "last_error": None, "finished_at": None,
                      "started_at": datetime.datetime.now(ET).isoformat() if ET
                                    else datetime.datetime.now().isoformat()})

    def _worker():
        try:
            r = fn()
            with lock:
                state["last_result"] = r
        except Exception as e:
            logger.exception("[darkpool_intraday] %s failed", name)
            with lock:
                state["last_error"] = str(e)
        finally:
            with lock:
                state["running"] = False
                state["phase"] = None
                state["finished_at"] = (datetime.datetime.now(ET).isoformat() if ET
                                        else datetime.datetime.now().isoformat())

    threading.Thread(target=_worker, daemon=True, name=name).start()
    return {"started": True}


def run_intraday_warm_background() -> dict:
    return _bg(_warm_run_lock, _warm_run, run_intraday_warm, "darkpool-intraday-warm")


def run_scanner_background() -> dict:
    return _bg(_scan_run_lock, _scan_run, run_scanner, "darkpool-intraday-scanner")


def scheduled_warm() -> None:
    """APScheduler entry — slow warm poll. No-op unless BOTH gates are on."""
    if not (ENABLED and TIERED_ENABLED):
        return
    r = run_intraday_warm_background()
    if not r.get("started"):
        logger.warning("[darkpool_intraday] warm SKIPPED — %s", r.get("reason"))


def scheduled_scanner() -> None:
    """APScheduler entry — snapshot fast-lane. No-op unless BOTH gates are on."""
    if not (ENABLED and TIERED_ENABLED):
        return
    r = run_scanner_background()
    if not r.get("started"):
        logger.warning("[darkpool_intraday] scanner SKIPPED — %s", r.get("reason"))


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
    global _session_date, _cursor_ns, _warm_cursor_ns
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
        _warm_cursor_ns = None
        _promoted.clear()
    return n
