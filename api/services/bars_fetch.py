"""OHLCV bar fetch/cache helpers — shared by the bars router and the worker service.

All actual fetch/cache/dedup logic lives here so the upcoming worker service
(api/worker_main.py) can import it without dragging in FastAPI router decorators.

8 timeframes: 1min, 5min, 15min, 30min, 60min, Daily, Weekly, Monthly
Intraday: Massive API primary → FMP fallback → yfinance fallback
Daily/Weekly: Massive API via get_agg_bars()
Monthly: Massive daily bars resampled to monthly

Cache hierarchy:
  1. In-memory TTLCache     (<1 ms  — hot path)
  2. SQLite bar store       (<5 ms  — persistent across redeploys, delta-updated)
  3. Disk cache             (<20 ms — legacy fallback during SQLite cold-start)
  4. Massive API delta      (<1 s   — only new bars since last stored ts)
  5. Massive API full       (4-8 s  — first-ever fetch for a ticker)

Request deduplication: if N concurrent requests arrive for the same
(ticker, tf, bars) while a Massive call is in-flight, all waiters
share the result of a single API call instead of stampeding.
"""
import json as _json
import os as _os
import threading as _threading
import time as _time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo as _ZI
from fastapi import HTTPException, Request
# ORJSONResponse serializes ~7-8x faster than the stdlib JSONResponse (measured:
# 4.9ms->0.6ms at 5000 bars, 18.9ms->2.6ms at 20000) on the SINGLE shared web
# event loop, and produces ~14% smaller bytes. It also emits `null` for any
# NaN/Inf, whereas stdlib json emits the INVALID `NaN`/`Infinity` tokens that
# crash the browser's JSON.parse and blank the whole chart — so a non-finite
# OHLC degrades to a droppable null bar instead of a fatal parse error (a
# correctness bonus on top of the speed). Aliased as JSONResponse so every
# existing bars-serving call site upgrades with no other change; the constructor
# signature (content/status_code/headers) is identical.
from fastapi.responses import ORJSONResponse as JSONResponse
from api.services.nyse_calendar import (
    NYSE_HOLIDAYS_YYYYMMDD as _NYSE_HOLIDAYS_YYYYMMDD_LEAF,
)
from api.services.cache import cache
from api.services import bars_disk_cache as disk_cache
from api.services import bars_sqlite as _sqlite
from api.services.massive import _get_client, _REST_BASE, to_polygon_symbol
# ⛔ SECURITY (2026-11-10): every service that imports this module (bars-api,
# worker, flow-worker, web) talks to Massive with `apiKey=` in the query string;
# httpx logs request URLs at INFO and HTTPStatusError text carries the URL. Install
# the process-wide record redactor on import (idempotent) so no importer can leak
# the key by forgetting to; the explicit `_redact_log` calls cover print()/text.
from api.services.log_redaction import install as _install_log_redaction, redact as _redact_log
_install_log_redaction()

# ── Serve-layer diagnostics (Server-Timing) ──────────────────────────────────
# Which cache tier served the request, so a slow bars response is diagnosable in
# prod (cold upstream fetch vs inflight-wait vs a warm hit that got unlucky) — the
# cold path was previously UNMEASURED (all prod latency samples were warm
# megacaps). The router reads this per-request and emits it on a Server-Timing
# header. Thread-local: each request runs on one anyio thread; reset at entry.
_serve_diag = _threading.local()


def _mark_serve(layer: str) -> None:
    _serve_diag.layer = layer


def get_serve_layer() -> str:
    return getattr(_serve_diag, "layer", "unknown")


# ── Fine-grained serve-phase timing (Server-Timing sub-metrics) ───────────────
# BEHAVIOR-NEUTRAL diagnostic: records elapsed-ms checkpoints inside the serve
# path so a slow first-view (the "obscure long tail takes 2-5s" report) can be
# localised to the exact phase — SQLite read vs synchronous provider fetch vs
# format vs bg-spawn — instead of guessed at. Thread-local, reset at inner entry,
# emitted by the router on the Server-Timing header. No control-flow effect.
def _time_reset() -> None:
    _serve_diag.t0 = _time.perf_counter()
    _serve_diag.marks = []


def _time_ck(label: str) -> None:
    t0 = getattr(_serve_diag, "t0", None)
    if t0 is None:
        return
    try:
        _serve_diag.marks.append((label, (_time.perf_counter() - t0) * 1000.0))
    except Exception:
        pass


def get_serve_marks() -> list:
    return list(getattr(_serve_diag, "marks", []))


# ── Stored price precision ────────────────────────────────────────────────────
# 🔴 EVERY STORED PRICE WAS ROUNDED TO 2 DECIMALS, AT SEVEN PROVIDER BOUNDARIES,
# AND ON A SUB-DOLLAR NAME THAT IS THE DOMINANT ERROR. Confirmed in the artifact
# 2026-08-09: 0 of 17,144,361 daily bars carried more than 2 places. Against
# Yahoo on the same sessions:
#     CAN  2026-06-16   ours 0.34  vendor 0.345   1.449%
#     DEFT 2026-06-26   ours 0.49  vendor 0.485   1.031%
#     GETY 2026-06-18   ours 0.61  vendor 0.605   0.826%
# A half-cent is ~1.7% of a $0.29 stock, and it propagates into `chg_pct_1d`,
# `gap_pct`, `adr_pct` and every MA-distance column — including the screener's
# `adr_pct < 4% ⇒ LOW_ADR` HARD GATE, which is applied to exactly these names. So
# the rounding was not cosmetic: it changed which stocks a member is shown.
#
# ⭐ WHY 4 AND NOT "NONE", AND WHY IT IS A CONSTANT. Rounding at all exists so a
# refetch of the same bar is byte-stable — providers round-trip through float32
# (~4e-8 relative), and without a fixed precision every delta would rewrite rows
# that did not change. 4 is not a new taste: `bars_sanitize.scale_bar` has always
# written split-adjusted prices at 4 places, so a HEALED bar and a FETCHED bar now
# land on the same digits instead of differing by a rounding step — which is the
# same split-brain, one decimal down. US equities quote sub-dollar names in
# $0.0001 increments, so 4 is the tape's own grain.
#
# ⛔ ONE NAME, SEVEN SITES, AND THE RAIL COUNTS THEM. A precision applied at six
# of seven boundaries is worse than 2dp everywhere: it makes the store's grain
# depend on WHICH provider answered. `tests/test_bar_price_precision.py` derives
# the site list from this module's AST and fails on a literal `round(x, 2)`
# reappearing anywhere in it.
PRICE_DP = 4


def _px(value) -> float:
    """One price, at the store's declared precision."""
    return round(float(value), PRICE_DP)


def _safe_volume(value) -> int:
    """A provider volume as a non-negative int. None / NaN / junk → 0, never a raise.

    ⛔ ONE NULL VOLUME USED TO DROP A WHOLE DELTA. `int(b.get("v", 0))` only defaults
    on a MISSING key; a present `None` raised TypeError (and a NaN ValueError) inside a
    list comprehension, so the whole fetched window — every bar of it — was lost to the
    caller's `except`, and the tail stayed stale until the next poll hit the same bar."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0
    if f != f or f < 0 or f == float("inf"):
        return 0
    return int(f)


def _massive_bar_row(bar) -> dict | None:
    """One raw Massive agg (`t` in ms) → a store row, or None for an unusable bar.

    Per-bar, so a single malformed agg (null price, missing key) is skipped instead of
    raising out of the loop and discarding every other bar in the delta."""
    try:
        return {
            "t": int(bar["t"] / 1000),
            "o": _px(bar["o"]), "h": _px(bar["h"]),
            "l": _px(bar["l"]), "c": _px(bar["c"]),
            "v": _safe_volume(bar.get("v")),
        }
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


# ── In-flight deduplication ───────────────────────────────────────────────────
# Prevents N concurrent requests for the same key from each making a separate
# Massive API call.  The first thread that arrives becomes the "fetcher" and
# sets the result into cache; all others wait on an Event and read from cache.
_inflight: dict[str, _threading.Event] = {}
_inflight_lock = _threading.Lock()

# Bounded concurrency for the SWR background delta-fetch threads ("bars-bg").
# Root cause of the 2026-06-10 thread burst: each stale chart request spawned
# an UNBOUNDED daemon thread. The per-key _inflight guard only stops duplicates
# for the SAME (ticker,tf); under market-hours load there are hundreds of
# distinct keys, so threads piled up to 900+ → "can't start new thread" → the
# pod (and the catalyst morning runs) thrashed. This semaphore caps how many
# bars-bg threads run at once; when full, the request just serves the stale
# payload it already returns and the browser's SWR retries on its next poll.
# Lowered 24 -> 6 (2026-07-14): the watchdog stack-capture proved these bg
# threads were the event-loop-stall culprit. Each ends in a put_bars
# (executemany under _WRITE_LOCK) + a get_bars(...).fetchall() of thousands of
# rows; SQLite's C calls hold the GIL, so ~24 running at once saturated the GIL
# and starved the single async loop for seconds (all live streams froze at
# once). 6 keeps background throughput reasonable while leaving the loop GIL
# time. Tune via BARS_BG_DELTA_MAX.
_BG_DELTA_MAX = max(2, int(_os.environ.get("BARS_BG_DELTA_MAX", "6")))
_bg_delta_sem = _threading.Semaphore(_BG_DELTA_MAX)

# ── INTERACTIVE TAIL-HEAL RESERVE (2026-09-28) ───────────────────────────────
# ⛔⛔ THE CLICK LOST TO THE LIST. Measured on production 2026-09-28 11:35 ET: a
# member's list pre-warm (886 daily + 516 5m `warm=1` requests in ten minutes)
# and the D/W/M stale-while-revalidate top-ups held every `_bg_delta_sem` slot, so
# the chart the member actually OPENED (AVGO 5m) had its tail repair shed in under
# a millisecond on every request for minutes — Friday's bars served on Monday.
# ⭐ PRIORITY ISOLATION, NOT MORE THROUGHPUT. A small pool only an INTERACTIVE
# intraday tail repair may draw on (a non-`warm` request, marked per request by
# the router via `set_request_interactive`). Background work — warm=1, prewarm,
# D/W/M top-ups, deep fills — can never touch it, so it cannot be starved by them.
# Bounded: the total ceiling rises by exactly this many slots, all of them
# reserved for member demand. Tune via BARS_INTERACTIVE_HEAL_MAX (0 disables).
_INTERACTIVE_HEAL_MAX = max(0, int(_os.environ.get("BARS_INTERACTIVE_HEAL_MAX", "2")))
_interactive_heal_sem = _threading.Semaphore(_INTERACTIVE_HEAL_MAX)
_req_ctx = _threading.local()


def set_request_interactive(flag: bool) -> None:
    """Mark the CURRENT request thread as member-interactive (True) or not. The router
    sets it at entry and clears it on exit; every background thread inherits the
    default False, so a warm/prewarm path can never claim the interactive reserve."""
    _req_ctx.interactive = bool(flag)


def _request_is_interactive() -> bool:
    return bool(getattr(_req_ctx, "interactive", False))


def set_background_caller(flag: bool) -> None:
    """Mark the CURRENT thread as an in-process BACKGROUND bars caller (bars_prewarm
    workers, `warm_bars_async`). Such a caller is not behind the edge (no request
    budget) yet is not member demand either, so the D/W/M delta pool counts it against
    the warm share (`_date_delta_warm_sem`) instead of the interactive/in-process
    branch (review #1034 N1). In-process callers that answer a member (seasonality,
    data_exports, discord...) never set it and keep their blocking semantics."""
    _req_ctx.background = bool(flag)


def _is_background_caller() -> bool:
    return bool(getattr(_req_ctx, "background", False))


# ── REQUEST WAIT BUDGET (2026-11-10) ─────────────────────────────────────────
# ⛔⛔ THE EDGE ABORTS THE TIER AT 8 s (edge/bars-edge-router/worker.js
# BARS_TIMEOUT_MS) AND RE-ASKS WEB_ORIGIN — a different bars.db with a different
# verified_through. Every wait on the request path therefore draws on ONE per-request
# budget, measured from the router's entry, and no single wait may outlive it. The
# individual ceilings (`_REQUEST_DEADLINE_SECONDS`, `_DEEP_DEADLINE_SECONDS`, the
# inflight-waiter ceilings) stay as they were; this caps their SUM, so a request that
# waits on a tail repair AND a deep fetch AND an in-flight peer still answers with
# margin. A wait that runs out serves what the store holds — marked unverified with a
# Retry-After by the router — and the background job still lands for the re-poll.
_REQUEST_BUDGET_SECONDS = float(_os.environ.get("BARS_REQUEST_BUDGET_SECONDS", "6.5"))
_EDGE_ABORT_SECONDS = 8.0
#: The budget can never be configured past the edge abort minus this margin.
_EDGE_MARGIN_SECONDS = 1.0


def start_request_budget() -> None:
    """HTTP entry (behind the edge): start this request thread's wait budget.

    ⚠️ ONLY the HTTP routes start it (`serve_bars(edge_budget=True)`). In-process
    callers (seasonality, cot_prewarm, data_exports, discord...) are not behind the
    edge's 8 s abort, so they keep each wait's own ceiling and the D/W/M deltas stay
    blocking for them (review F3)."""
    _req_ctx.budget_t0 = _time.monotonic()


def end_request_budget() -> None:
    """Router exit: clear it (the anyio worker thread is reused)."""
    _req_ctx.budget_t0 = None


def _budget_cap() -> float:
    return max(0.0, min(_REQUEST_BUDGET_SECONDS, _EDGE_ABORT_SECONDS - _EDGE_MARGIN_SECONDS))


def _budget_active() -> bool:
    return getattr(_req_ctx, "budget_t0", None) is not None


def _budget_left() -> float:
    t0 = getattr(_req_ctx, "budget_t0", None)
    cap = _budget_cap()
    if t0 is None:
        return cap
    return max(0.0, cap - (_time.monotonic() - t0))


def _bounded_wait(seconds: float) -> float:
    """The timeout a request-path wait may actually use: its own ceiling, never more
    than what is left of this request's budget. Outside an edge-budgeted HTTP request
    the wait keeps its own ceiling."""
    if not _budget_active():
        return max(0.0, float(seconds))
    return max(0.0, min(float(seconds), _budget_left()))


def _acquire_heal_slot(interactive: bool):
    """Take a tail-heal slot without blocking. Returns the semaphore to release, or
    None when no slot is available. Interactive callers try their RESERVE first so the
    shared pool stays available to background work, then fall back to the shared pool."""
    if interactive and _INTERACTIVE_HEAL_MAX > 0 and _interactive_heal_sem.acquire(blocking=False):
        return _interactive_heal_sem
    if _bg_delta_sem.acquire(blocking=False):
        return _bg_delta_sem
    return None

# On-demand deep gap-fill (2026-07-14). The delta gap-fill (_DELTA_GAPFILL_DAYS)
# only reaches ~2 weeks back; when a user PANS deeper (months) an interior hole
# there won't self-heal. This closes that: any intraday chart view kicks a
# bounded, throttled BACKGROUND job that fetches the viewed depth from Massive,
# diffs against stored, and INSERTs only the MISSING bars — so whatever range you
# look at, at any depth, completes itself. Massive is authoritative → can only
# ADD real bars, never fabricate. Same GIL/write-lock caution as _bg_delta above,
# so kept DELIBERATELY small (2) AND throttled per (ticker,tf,depth-tier) to at
# most once per _DEEPFILL_TTL — it fires rarely (only the FIRST view of a depth
# in a 6h window), unlike the per-poll bg-delta. daemon threads, never the
# request threadpool. Kill-switch: BARS_DEEPFILL_ENABLED=0.
_DEEPFILL_ENABLED = _os.environ.get("BARS_DEEPFILL_ENABLED", "1") == "1"
_DEEPFILL_TTL = int(_os.environ.get("BARS_DEEPFILL_TTL_SECONDS", str(6 * 3600)))
# Replay Mode cold intraday: cap the pre-cutoff window fetched from the provider. A replay
# chart requests fullBarsFor(tf) (5m=30000 → ~239 days of 5-min = minutes-slow + a huge
# payload — the "5m replay takes minutes + flickers" bug). A replay VIEW needs only a few
# weeks of context; the store keys by ts, so these capped rows still satisfy the full
# bars=30000 request from SQLite on the real chart fetch.
_REPLAY_INTRADAY_COLD_BARS = int(_os.environ.get("REPLAY_INTRADAY_COLD_BARS", "4000"))
# Global cap on CONCURRENT replay cold fetches so warming (5 TFs at once) + other users'
# replays can't saturate the single-process web pod's threadpool → the 524-outage class.
# Warm requests are best-effort (skip when no slot); real chart requests wait for one.
_REPLAY_COLD_CONCURRENCY = int(_os.environ.get("REPLAY_COLD_CONCURRENCY", "2"))
_replay_cold_sem = _threading.Semaphore(_REPLAY_COLD_CONCURRENCY)
_DEEPFILL_MAX = max(1, int(_os.environ.get("BARS_DEEPFILL_MAX", "2")))
_deepfill_sem = _threading.Semaphore(_DEEPFILL_MAX)

# 🔴 Global cap on CONCURRENT truly-cold Layer-4 provider fetches (a first-ever
# ticker/tf with NO stored rows). Obscure/long-tail names take 15-22s to fetch;
# left unbounded, a fresh browser with no local cache hits the server for EVERY
# chart, and a user scanning cold tickers holds a threadpool worker per fetch for
# ~20s → the anyio pool exhausts and every OTHER request (even instant warm charts)
# queues behind them. Measured 2026-08-19 from a real member HAR: 15 cold tickers
# dragged 664 warm charts to 5-20s and a /api/watchlists call to 18s — the exact
# 524-outage class _replay_cold_sem above already guards for replay. When the cap
# is full a cold request SHEDS (serves a fast 503+Retry-After so the client re-polls
# in ~3s) instead of adding another 20s hold; the ticker warms on a retry once a slot
# frees, or via the prewarmer/crawler. Tune via BARS_COLD_FETCH_CONCURRENCY.
_COLD_FETCH_CONCURRENCY = max(1, int(_os.environ.get("BARS_COLD_FETCH_CONCURRENCY", "3")))
_cold_fetch_sem = _threading.Semaphore(_COLD_FETCH_CONCURRENCY)

# 🟡 Global cap on CONCURRENT best-effort WARM serves (background prefetch: opening a
# theme/watchlist warms ~20 holdings at once, across MANY browsers = a lot of concurrent
# warm=1 requests). Each warm serve holds an anyio-pool worker while it reads+formats from
# SQLite; unbounded, they queue AHEAD of the chart the user actually CLICKED (which is NOT
# a warm request) and drag it to seconds — the theme-flood symptom. When the cap is full a
# warm request SHEDS instantly (fast 503 → the client re-warms on its next poll, or the
# real click fetches it), so the shared threadpool stays available for real chart requests.
# The click's own request never sheds. Tune via BARS_WARM_SERVE_MAX.
_WARM_SERVE_MAX = max(1, int(_os.environ.get("BARS_WARM_SERVE_MAX", "6")))
_warm_serve_sem = _threading.Semaphore(_WARM_SERVE_MAX)


def _depth_tier(bars: int) -> int:
    """Coarse depth bucket for the deep-fill throttle marker, so a shallow view
    doesn't throttle a later deep pan (each tier verifies independently)."""
    for cap in (400, 1200, 2500, 5000):
        if bars <= cap:
            return cap
    return 99999


def _deepfill_once(ticker: str, tf: str, bars: int) -> int:
    """Fetch the viewed depth from Massive, diff vs stored, INSERT only the
    MISSING bars; bust the mem cache if any were filled. Returns the count
    filled. Synchronous + testable — the background wrapper adds throttle +
    concurrency bound + the daemon thread. Massive is authoritative, so a bar it
    omits (real no-trade) is never fabricated."""
    ticker_up = ticker.upper()
    raw = _fetch_intraday(ticker_up, tf, bars)
    fetched = [b for b in (raw or []) if isinstance(b.get("t"), (int, float))]
    if not fetched or _is_intraday_stale(raw):
        return 0
    oldest = min(int(b["t"]) for b in fetched)
    stored_ts = {int(r[0]) for r in _sqlite.get_bars_since(ticker_up, tf, oldest - 1)}
    missing = [b for b in fetched if int(b["t"]) not in stored_ts]
    if missing:
        _sqlite.put_bars(ticker_up, tf, missing, date_tf=False)
        cache.delete_prefix(f"bars_{ticker_up}_{tf}_")  # bust stale gappy payloads
    return len(missing)


def _maybe_kick_deepfill(ticker: str, tf: str, bars: int) -> None:
    """Kick a bounded, throttled, background deep gap-fill of the VIEWED range.
    See the _DEEPFILL_* block. No-op for non-intraday, when disabled, verified
    recently (per depth-tier), or at the concurrency cap. Never blocks.

    🔴 AND A NO-OP UNDER PYTEST, WHICH IS NOT TIDINESS — IT IS THE WRITER THAT
    PUT 16,500 FIXTURE BARS INTO THE OWNER'S LIVE STORE. `C:\\data\\bars.db`
    carries 16,500 MSTR tf=5 rows reading `o=10.00 h=10.50 l=9.50 c=10.20 v=100`
    across weekends — 56.8% of MSTR's 5-minute bars, and the NEWEST rows
    `get_bars` returns, against a real price near $97.80. The values come from
    `tests/test_deep_backfill_sync.py`'s mocked `_fetch_intraday`; the WRITER is
    this function's daemon thread, which OUTLIVES the test. `monkeypatch` then
    restores `bars_sqlite._DB_PATH` to its import-time value and the fixture's
    own `bump_db_epoch()` teardown forces the in-flight thread to RECONNECT —
    against the restored path. Teardown actively redirected the write onto the
    real store. The row counts prove the attribution: 4400 = 5000 fetched − 600
    seeded and 700 = 1000 − 300, and `fetched − stored` is computed in exactly
    one function, `_deepfill_once`.
    ⛔ THE REPO-ROOT `conftest.py` REDIRECT IS THE RIGHT CONTROL AND IT IS NOT
    ENOUGH: it is a FILE IN THE TREE, and 50 of 54 worktrees on this box do not
    have it — 40 of them ship the test. A guard that travels with the tests
    cannot protect a checkout that predates the guard; this one travels with the
    CODE. Note also that the tripwire could not have reported it: `_run`'s own
    `except Exception` swallows the `SharedDataRootWrite` as a routine deepfill
    failure, so it never even reaches `threading.excepthook`.
    """
    if _os.environ.get("PYTEST_CURRENT_TEST"):
        return
    if not _DEEPFILL_ENABLED or tf not in ("1", "5", "15", "30", "60"):
        return
    ticker_up = ticker.upper()
    marker = f"deepfill_{ticker_up}_{tf}_{_depth_tier(bars)}"
    if cache.get(marker) is not None:
        return
    if not _deepfill_sem.acquire(blocking=False):
        return
    # Stamp the marker BEFORE spawning so a burst of concurrent views spawns once
    # (and a failed run still throttles retries for the TTL, not every request).
    cache.set(marker, 1, ttl=_DEEPFILL_TTL)

    def _run(_t=ticker_up, _tf=tf, _b=bars):
        import logging as _log
        _lg = _log.getLogger(__name__)
        try:
            n = _deepfill_once(_t, _tf, _b)
            if n:
                _lg.info("[deepfill] %s tf=%s depth=%d filled %d missing bars", _t, _tf, _b, n)
        except Exception as e:  # noqa: BLE001
            _lg.warning("[deepfill] %s tf=%s failed: %s", _t, _tf, e)
        finally:
            _deepfill_sem.release()

    _threading.Thread(target=_run, daemon=True, name=f"deepfill-{ticker_up}-{tf}").start()

# ── Usage-driven intraday hot-set ─────────────────────────────────────────────
# The prewarmer only refreshes intraday for a static ticker_list[:200].
# Anything outside that 200 was frozen until a user happened to view it
# twice — the universe-freeze bug. We record every ticker whose intraday
# bars are actually requested so the prewarmer can keep THOSE warm on its
# 5-min cadence (the charts the user is actually flipping through), no
# matter where they fall in the universe ordering.
_recent_intraday: dict[str, float] = {}          # TICKER -> last requested epoch
_recent_intraday_lock = _threading.Lock()
_RECENT_INTRADAY_MAX = 800


def _record_intraday_request(ticker: str, tf: str) -> None:
    """Note that (ticker) had an intraday request. O(1) common path;
    prunes oldest entries when over capacity. Never raises."""
    if tf not in ("1", "5", "15", "30", "60"):
        return
    try:
        key = ticker.upper()
        with _recent_intraday_lock:
            _recent_intraday[key] = _time.time()
            if len(_recent_intraday) > _RECENT_INTRADAY_MAX:
                # Drop the oldest ~20% so this prune is amortized, not per-call.
                cut = sorted(_recent_intraday.items(), key=lambda kv: kv[1])
                for k, _ in cut[: max(1, len(cut) // 5)]:
                    _recent_intraday.pop(k, None)
    except Exception:
        pass


def get_hot_intraday_tickers(max_n: int = 500) -> list[str]:
    """Most-recently-requested intraday tickers, newest first. Consumed by
    the prewarmer to keep user-viewed charts fresh regardless of the
    static universe-ordering cap."""
    with _recent_intraday_lock:
        items = sorted(_recent_intraday.items(), key=lambda kv: kv[1], reverse=True)
    return [k for k, _ in items[:max_n]]


# NYSE full-day closures. WITHOUT this, every market holiday looks like a
# missed trading session to the cold-stale / freshness predicates: cache
# carries Friday's last bar, code expects a "Monday" session, so every
# intraday chart open fires a synchronous Massive delta fetch returning
# nothing — and the prewarmer keeps retrying the same empty fetch every
# cycle, saturating the shared API key. Memorial Day 2026 (this set's
# trigger) reproduced exactly that. Keep this list ahead of `today` by at
# least one calendar year; refresh annually from nyse.com/markets/hours-calendars.
#: ⚰️ THE LITERAL MOVED TO ``api/services/nyse_calendar.py`` (2026-09-09), a
#: dependency-free leaf, and is RE-EXPORTED here so every existing reader that
#: names ``bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`` is untouched. It moved because
#: reaching it used to mean importing this module -- fastapi, the Massive
#: client, the cache and a thread pool -- just to read thirty dates.
#: ⛔ STILL ONE AUTHORITY. This name and the leaf are the same object.
_NYSE_HOLIDAYS_YYYYMMDD = _NYSE_HOLIDAYS_YYYYMMDD_LEAF


def _is_nyse_holiday(yyyymmdd: int) -> bool:
    """True if the given ET calendar date (YYYYMMDD int) is a NYSE full
    closure. Half-day closes (1pm ET early closes) intentionally NOT
    included — those are still trading sessions and produce intraday
    bars normally."""
    return yyyymmdd in _NYSE_HOLIDAYS_YYYYMMDD


def _is_market_open() -> bool:
    now = datetime.now(_ZI("America/New_York"))
    if now.weekday() >= 5:
        return False
    if _is_nyse_holiday(int(now.strftime("%Y%m%d"))):
        return False
    # ⛔ A HALF-DAY CLOSES AT 13:00 ET (nyse_calendar's early closes, read through
    # `_session_close_minutes` — the same authority the completeness rail uses). This
    # said `< 1600` on every weekday, so on Black Friday / Christmas Eve the store
    # treated 13:00-16:00 as live RTH and kept re-fetching a settled session.
    minutes = now.hour * 60 + now.minute
    return 570 <= minutes < _session_close_minutes(int(now.strftime("%Y%m%d")))


def _prior_session_iso(now=None) -> str:
    """ISO date (YYYY-MM-DD) of the trading session BEFORE today's ET date — skips
    weekends and NYSE full closures (half-days are sessions). Pure calendar walk."""
    now = now or datetime.now(_ZI("America/New_York"))
    d = now.date() - timedelta(days=1)
    for _ in range(14):
        if d.weekday() < 5 and not _is_nyse_holiday(int(d.strftime("%Y%m%d"))):
            break
        d -= timedelta(days=1)
    return d.isoformat()


def _week_key_yyyymmdd(ymd: int) -> int:
    """The weekly bar key (the calendar FRIDAY of the ISO week) of a YYYYMMDD date. The same
    key `_resample_weekly_iso` stamps, so a stored weekly bar and this compare exactly."""
    s = str(int(ymd))
    y, w, _ = datetime(int(s[:4]), int(s[4:6]), int(s[6:])).isocalendar()
    return int(datetime.fromisocalendar(y, w, 5).strftime("%Y%m%d"))


def _last_weekday_yyyymmdd() -> int:
    """Return the most recent NYSE trading day as YYYYMMDD (rolls Sat → Fri,
    Sun → Fri, AND walks back past any NYSE-closed holiday). Drives
    `_needs_fresh` for D/W/M: if last_ts equals this date, the bar is
    considered fresh — so on a holiday, Friday's cache no longer triggers
    a useless empty refresh fetch."""
    d = datetime.utcnow()
    wd = d.weekday()  # 0=Mon … 5=Sat, 6=Sun
    if wd == 5:
        d -= timedelta(days=1)
    elif wd == 6:
        d -= timedelta(days=2)
    # Walk back through holidays (and any weekend the holiday rolls onto).
    # Capped at 14 days as a safety belt — NYSE never has a 2-week closure.
    for _ in range(14):
        ymd = int(d.strftime("%Y%m%d"))
        if not _is_nyse_holiday(ymd) and d.weekday() < 5:
            return ymd
        d -= timedelta(days=1)
    return int(d.strftime("%Y%m%d"))


_INTRADAY_FRESHNESS_THRESHOLDS = {"1": 90, "5": 300, "15": 900, "30": 1800, "60": 3600}


# ── Session COMPLETENESS — "does this tail reach the end of its session?" ─────
# ⛔⛔ A DATE MATCH IS NOT FRESHNESS, AND OFF-MARKET THAT FROZE TRUNCATED TAILS.
# `_is_cold_stale_intraday` compares ET DATES, and `_needs_fresh`'s off-market branch
# trusts it completely ("if the cache covers the most-recent trading session, the
# entry is fresh enough off-market regardless of wall-clock age"). So a tail that
# stopped mid-session still bears the right date and is served, unrefreshed, until
# the market reopens.
#
# ⚰️ MEASURED, production, Sunday 2026-09-20, against Friday 2026-09-18 (whose
# post-market ran to 19:55): PLTR 5m ended 15:15 · AEHR 5m 13:20 · CELH 5m 10:10 ·
# BATRK 5m 09:50 and 60m 10:00. Five of nine sampled symbols served a truncated
# session 55 hours later — every one of them reporting `newest_bar_is_forming:
# false`, i.e. the server asserting those cut-short tails were settled.
#
# ⭐ ONE CALENDAR, NOT A SECOND ONE. Early closes and holidays come from
# `nyse_calendar`, the set the router's clock already reads.
#
# ⭐ AND THE RULE IS THE CLIENT'S OWN. `marketSession.isIntradayTailStale` already
# encodes exactly this test (`tailMin < 960 - tfMin`) behind
# `INTRADAY_COMPLETENESS_PCT`, shipped at 0. Restating it here rather than importing
# the idea would put two authorities on "is this session complete"; this is
# deliberately the same comparison so origin and chart cannot disagree.
_RTH_CLOSE_MINUTES = 960          # 16:00 ET
_RTH_EARLY_CLOSE_MINUTES = 780    # 13:00 ET on a half day


def _session_close_minutes(ymd: int) -> int:
    """ET minutes-from-midnight when the REGULAR session for `ymd` closes."""
    try:
        from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
        if int(ymd) in NYSE_EARLY_CLOSES_YYYYMMDD:
            return _RTH_EARLY_CLOSE_MINUTES
    except Exception:                      # noqa: BLE001 — unreadable calendar → full day
        pass
    return _RTH_CLOSE_MINUTES


def intraday_session_complete(tf: str, last_ts: int | None) -> bool:
    """True when an intraday tail reaches the FINAL bucket of its own session.

    A post-market tail is complete by construction (it is past the close). A tail
    that stops before the last regular bucket is an artifact of when we last
    fetched, not of trading — which is the distinction the date compare cannot make.

    ⚠️ ABSTAINS RATHER THAN GUESSING: an unparseable instant answers True, so a
    shape surprise can never turn into a universe-wide refetch.
    """
    if tf not in ("1", "5", "15", "30", "60") or last_ts is None:
        return True
    try:
        et = _ZI("America/New_York")
        dt = datetime.fromtimestamp(int(last_ts), et)
        tail_minutes = dt.hour * 60 + dt.minute
        close_minutes = _session_close_minutes(int(dt.strftime("%Y%m%d")))
        return tail_minutes >= close_minutes - int(tf)
    except Exception:                      # noqa: BLE001
        return True


# ── EXTENDED-HOURS TAIL (2026-11-11) ─────────────────────────────────────────
# ⛔⛔ THE SERVED SERIES CARRIES EXTENDED HOURS (04:00-20:00 ET), BUT EVERY
# "IS THIS TAIL DONE?" RULE MEASURED IT AGAINST THE 16:00 CLOSE. Measured on
# production 2026-11-11 01:22Z (20:22 ET): AAPL / TSLA / SOFI tf=1 first answers
# ended at 16:53 ET — three hours of post-market missing — served `sqlite` with
# `tail_status: current` and no Retry-After, because (a) after 20:00 ET
# `_needs_fresh` only asks "does the tail reach the REGULAR close?" (16:53 >= 15:59:
# yes) and (b) `intraday_tail_status` judged it against the final RTH bucket. So the
# store was never re-asked and the client was told it was current.
# The extended session ends four hours after the regular close (20:00, or 17:00 on
# an early-close day) and opens at 04:00.
_EXT_OPEN_MINUTES_SERVER = 4 * 60
_EXT_AFTER_CLOSE_MINUTES = 4 * 60


def _ext_close_minutes(ymd: int) -> int:
    """ET minutes-from-midnight when the EXTENDED session for `ymd` ends."""
    return _session_close_minutes(ymd) + _EXT_AFTER_CLOSE_MINUTES


def _is_trading_day_ymd(d) -> bool:
    return d.weekday() < 5 and not _is_nyse_holiday(int(d.strftime("%Y%m%d")))


def _ext_bucket_start(tf: str, t: int) -> int:
    if tf == "60":
        return bucket_60_et_unix_seconds(int(t))
    step = int(tf) * 60
    return int(t) // step * step


def expected_completed_ext_bucket(tf: str, now: float | None = None):
    """Start (unix s) of the latest EXTENDED-session bucket (04:00-20:00 ET, early-close
    aware) that has CLOSED — on today's session once its first bucket has closed, else
    the FINAL bucket of the previous trading session. None only for a non-intraday tf
    or an unreadable clock. During RTH this equals `expected_completed_bucket`."""
    if tf not in ("1", "5", "15", "30", "60"):
        return None
    try:
        et = _ZI("America/New_York")
        now_ts = float(now if now is not None else _time.time())
        now_dt = datetime.fromtimestamp(now_ts, et)
        day = now_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        if _is_trading_day_ymd(now_dt):
            ymd = int(now_dt.strftime("%Y%m%d"))
            ext_open = int(day.timestamp()) + _EXT_OPEN_MINUTES_SERVER * 60
            ext_close = int(day.timestamp()) + _ext_close_minutes(ymd) * 60
            if now_ts >= ext_close:
                return _ext_bucket_start(tf, ext_close - 1)
            cur = _ext_bucket_start(tf, int(now_ts))
            prev = _ext_bucket_start(tf, cur - 1)
            if prev >= ext_open:
                return prev
        d = day - timedelta(days=1)
        for _ in range(14):
            if _is_trading_day_ymd(d):
                ymd = int(d.strftime("%Y%m%d"))
                midnight = int(datetime(d.year, d.month, d.day, tzinfo=et).timestamp())
                return _ext_bucket_start(tf, midnight + _ext_close_minutes(ymd) * 60 - 1)
            d -= timedelta(days=1)
        return None
    except Exception:                      # noqa: BLE001 — abstain, never guess
        return None


def intraday_ext_session_complete(tf: str, last_ts) -> bool:
    """True when an intraday tail reaches the FINAL bucket of its EXTENDED session."""
    if tf not in ("1", "5", "15", "30", "60") or last_ts is None:
        return True
    try:
        et = _ZI("America/New_York")
        dt = datetime.fromtimestamp(int(last_ts), et)
        ymd = int(dt.strftime("%Y%m%d"))
        midnight = int(datetime(dt.year, dt.month, dt.day, tzinfo=et).timestamp())
        final = _ext_bucket_start(tf, midnight + _ext_close_minutes(ymd) * 60 - 1)
        # same one-bucket tolerance as the RTH rule (`close - tf`)
        return int(last_ts) >= _ext_bucket_start(tf, final - 1)
    except Exception:                      # noqa: BLE001
        return True


def _ext_session_end_ts(last_ts) -> int | None:
    try:
        et = _ZI("America/New_York")
        dt = datetime.fromtimestamp(int(last_ts), et)
        ymd = int(dt.strftime("%Y%m%d"))
        midnight = int(datetime(dt.year, dt.month, dt.day, tzinfo=et).timestamp())
        return midnight + _ext_close_minutes(ymd) * 60
    except Exception:                      # noqa: BLE001
        return None


# ── TAIL CURRENTNESS: OBSERVED vs VERIFIED (2026-09-28) ──────────────────────
# ⛔⛔ "THE STORE HOLDS ROWS" IS NOT "THE CHART IS CURRENT". On 2026-09-28 the server
# KNEW AVGO 5m was a whole session stale (`_needs_fresh` and
# `_is_cold_stale_intraday` both True), shed the repair for capacity, and answered
# with Friday's rows as an ordinary 200. Nothing on the wire said "I did not check".
#
# Two separate facts, never merged:
#   OBSERVED — the served tail is within ONE bucket of the RTH frontier (the latest
#              bucket that has closed). One bucket absorbs an illiquid name that did
#              not print in the newest interval, and nothing more.
#   VERIFIED — the PROVIDER was asked at instant X, answered, and its rows were
#              persisted. `verified_through = X`. Beyond the one-bucket tolerance,
#              only this may call a tail current ("no newer bar exists as of X").
#
# ⛔ `verified_through` IS NEVER DERIVED FROM THE STORED TAIL. It is written in exactly
# one place (`_mark_tail_verified`), after a provider answer that did not raise AND
# whose rows reached SQLite — so a failed write ("database is locked") verifies
# nothing. It is per-process and in memory on purpose: a restart forgets it and the
# next request re-verifies; it can never become a durable claim.
_TAIL_VERIFIED_MAX_KEYS = 50000
_tail_verified: dict = {}
_tail_verified_lock = _threading.Lock()


def _mark_tail_verified(ticker: str, tf: str, checked_at: float) -> None:
    key = (ticker.upper(), tf)
    with _tail_verified_lock:
        if len(_tail_verified) >= _TAIL_VERIFIED_MAX_KEYS and key not in _tail_verified:
            _tail_verified.clear()          # bounded; a cleared map costs one re-verify
        prev = _tail_verified.get(key)
        if prev is None or checked_at > prev:
            _tail_verified[key] = checked_at


def tail_verified_through(ticker: str, tf: str):
    with _tail_verified_lock:
        vt = _tail_verified.get((ticker.upper(), tf))
    # ⭐ A 5m series the universe live stream covers is VERIFIED by the stream itself
    # through its newest delivered minute (review #1051 F1): a thin covered name never
    # takes the provider-heal path that writes `_tail_verified`, so without this its
    # off-hours tail would read `unverified` forever.
    if tf == "5":
        try:
            from api.services import bars_live_store as _bls
            lv = _bls.proven_through_s(ticker)
            if lv is not None and (vt is None or lv > vt):
                vt = lv
        except Exception:                  # noqa: BLE001
            pass
    return vt


def _heal_intraday_tail(ticker_up: str, tf: str, last_ts: int, tail_only: bool = False) -> list:
    """The ONE intraday tail repair: provider delta → persist → record verification.

    ⚠️ The check instant is taken BEFORE the provider call, so a bar that closes while
    the call is in flight is never claimed. A raise anywhere (provider, or the SQLite
    write) propagates to the caller and verifies nothing.

    `tail_only` (request path): fetch ONLY the missing tail window — see
    `_delta_intraday`. The interior gap-fill scan runs afterwards in the background.

    ⭐ LOCAL FIRST for a DERIVED tf (30m / 60m, see `_local_tail_repair`): on the
    request path the missing buckets are rebuilt from the stored finer series and the
    provider is asked only when that series does not reach the frontier."""
    if tail_only and last_ts and tf in _DERIVED_TFS:
        _lt = _local_tail_repair(ticker_up, tf, int(last_ts))
        if _lt is not None:
            if _lt[1]:
                return _lt[2]             # the finer store covered the gap: no provider
            last_ts = _lt[0]              # provider fetches only what is still missing
    checked_at = _time.time()
    status: dict = {}
    new = _delta_intraday(ticker_up, tf, last_ts, status=status, tail_only=tail_only)
    if new and not _is_intraday_stale(new):
        _sqlite.put_bars(ticker_up, tf, new, date_tf=False)
    if status.get("ok"):
        _mark_tail_verified(ticker_up, tf, checked_at)
    return new


# ── DERIVED TIMEFRAMES: ONE DERIVATION PATH FROM THE STORED BASE (2026-11-11) ──
# ⛔⛔ ROOT CAUSE. tf=30 (since #1037) and tf=60 are resamples of 15m, but their tail
# repair treated them as provider series of their own: it asked the provider for
# whole ET days of 15m, resampled in memory, stored only the 30m/60m result and
# threw the 15m away. Two consequences, both measured on production 2026-11-11
# 09:42 ET: (1) SPY tf=30 bars=1120 first answer ended at the previous evening's
# 19:30 bar (`delta-deadline`, unverified; a retry 3 s later the same) while SPY
# tf=15 — the very rows the 30m is built from — was current in the same store; the
# provider tail outlived the 2.5 s ceiling at the open. (2) every 30m/60m repair
# re-fetched base rows the store already held.
# ⭐ INVARIANT: a derived tf's stored bucket is ALWAYS `_resample_derived` of the
# STORED base (`_DERIVED_BASE_TF` = 15m) rows in that bucket. Every tail writer goes
# through `_derive_from_stored_base`:
#   * the provider delta (`_delta_intraday` tf 30/60) persists the 15m it fetched to
#     the 15m store FIRST, then derives from the store;
#   * the request-path repair (`_local_tail_repair`, run before any provider slot is
#     taken) derives from the store and asks the provider only when the rebuilt tail
#     is still not current — and then only from that rebuilt tail onward.
# Guards: the base must OVERLAP the target's newest stored bucket (it provably runs
# from where the target stops — a base that only began today cannot fabricate a
# contiguous tail), and a stored bucket is never replaced by a thinner one (lower
# volume = the base is missing rows there; the base's own gap-fill heals it first).
# The ETH-grid 60m (`session=eth`) is served straight from the 15m serve
# (`routers/bars._serve_eth_hourly`): the same base, no store of its own.
# Kill switch for the request-path rebuild only: BARS_LOCAL_DERIVE_TAIL=0.
_DERIVED_BASE_TF = "15"
_DERIVED_TFS = ("30", "60")
_LOCAL_DERIVE_ENABLED = _os.environ.get("BARS_LOCAL_DERIVE_TAIL", "1") == "1"


def _derived_bucket_start(tf: str, t: int) -> int:
    if tf == "60":
        return bucket_60_et_unix_seconds(int(t))
    step = int(tf) * 60
    return int(t) // step * step


def _resample_derived(tf: str, base_rows: list[dict]) -> list[dict]:
    """THE derivation of a derived tf from its base rows (60 = TradingView session
    grid `SIXTY_MIN_GRID`, 30 = ET clock floor, which is TradingView's 30m grid)."""
    return _session_resample_hourly(base_rows) if tf == "60" else _resample_minutes(base_rows, 30)


def _derive_from_stored_base(ticker_up: str, tf: str, from_bucket: int) -> list[dict]:
    """Derived `tf` buckets from `from_bucket` onward, built from the STORED base."""
    rows = [{"t": int(ts), "o": o, "h": h, "l": l, "c": c, "v": v}
            for ts, o, h, l, c, v in _sqlite.get_bars_since(ticker_up, _DERIVED_BASE_TF,
                                                            int(from_bucket) - 1)
            if o is not None and h is not None and l is not None and c is not None]
    return [b for b in _resample_derived(tf, rows) if b["t"] >= int(from_bucket)]


def _local_derived_tail(ticker_up: str, tf: str, last_ts: int):
    """READ-ONLY: the target `tf` buckets from `last_ts`'s bucket onward, derived from
    the stored base. Returns {"rows", "src"} or None when the base cannot extend the
    target (see the block above)."""
    if tf not in _DERIVED_TFS or not last_ts or not _LOCAL_DERIVE_ENABLED:
        return None
    base_last = _sqlite.get_last_ts(ticker_up, _DERIVED_BASE_TF)
    if base_last is None or int(base_last) <= int(last_ts):
        return None                       # the base holds nothing newer than the target
    b0 = _derived_bucket_start(tf, last_ts)
    derived = _derive_from_stored_base(ticker_up, tf, b0)
    if not derived or derived[0]["t"] != b0:
        return None                       # no overlap with the target's newest bucket
    # ⛔ COMPLETE BUCKETS ONLY (review #1090 F4). A derived bucket is built only when
    # EVERY base slot it spans (in the extended session, early-close aware, up to now)
    # is stored; derivation stops at the first missing base slot and the provider is
    # asked from there. A hole in the base can never become a "current" derived bar.
    missing = _first_missing_base_slot(
        ticker_up, b0, int(_time.time()))
    if missing is not None:
        step = int(tf) * 60 if tf != "60" else 3600
        derived = [b for b in derived if _bucket_end(tf, b["t"], step) <= missing]
    stored_v = {int(r[0]): int(r[5] or 0) for r in _sqlite.get_bars_since(ticker_up, tf, b0 - 1)}
    keep = [b for b in derived
            if b["t"] > int(last_ts)
            or (b["t"] in stored_v and int(b.get("v") or 0) >= stored_v[b["t"]])]
    if not keep or keep[-1]["t"] <= int(last_ts):
        return None                       # nothing newer: leave it to the provider
    return {"rows": keep, "src": _DERIVED_BASE_TF, "complete": missing is None}


def _base_contiguous_window(ticker_up: str, from_date: str) -> tuple[str, bool]:
    """(from_date, persist_base) for a derived tf's provider fetch of its base (F3):
    start no later than the stored base's tail session so the write is contiguous;
    when that is beyond the 15m gap-fill reach, do not write the base at all."""
    try:
        base_last = _sqlite.get_last_ts(ticker_up, _DERIVED_BASE_TF)
    except Exception:                      # noqa: BLE001 — unreadable: do not write it
        return from_date, False
    if base_last is None:
        return from_date, True            # no base yet: this fetch STARTS it (no hole)
    base_day = datetime.fromtimestamp(int(base_last), _ZI("America/New_York")).strftime("%Y-%m-%d")
    if base_day >= from_date:
        return from_date, True
    span = (datetime.strptime(from_date, "%Y-%m-%d") - datetime.strptime(base_day, "%Y-%m-%d")).days
    if span <= _GAPFILL_CAP_BY_TF.get(_DERIVED_BASE_TF, 14):
        return base_day, True
    return from_date, False


def _base_slot_in_session(s: int) -> bool:
    """A 15m base slot starting at `s` lies inside its day's extended session."""
    try:
        d = datetime.fromtimestamp(int(s), _ZI("America/New_York"))
        if not _is_trading_day_ymd(d):
            return False
        m = d.hour * 60 + d.minute
        return _EXT_OPEN_MINUTES_SERVER <= m < _ext_close_minutes(int(d.strftime("%Y%m%d")))
    except Exception:                      # noqa: BLE001 — unknown = expected (strict)
        return True


def _first_missing_base_slot(ticker_up: str, lo: int, now: int):
    """First CLOSED in-session 15m slot at/after `lo` with no stored base row, else None.

    * Only CLOSED slots are required (slot end <= now): the still-forming slot may not
      have printed or landed yet — requiring it would block every rebuild at the open
      and at each 15m boundary (review #1090 N3).
    * A slot the provider has already ANSWERED for (`tail_verified_through` of the base
      at/after the slot's end) and that is still absent is a legitimate no-trade slot,
      not a hole — so thin names rebuild locally too."""
    step = int(_DERIVED_BASE_TF) * 60
    have = {int(r[0]) for r in _sqlite.get_bars_since(ticker_up, _DERIVED_BASE_TF, int(lo) - 1)}
    vt = tail_verified_through(ticker_up, _DERIVED_BASE_TF)
    s = int(lo) // step * step
    while s + step <= int(now):
        if (s not in have and _base_slot_in_session(s)
                and not (vt is not None and float(vt) >= s + step)):
            return s
        s += step
    return None


def _local_tail_repair(ticker_up: str, tf: str, last_ts: int):
    """Rebuild + PERSIST a derived tf's tail from its stored base (no provider).

    Returns None when nothing could be rebuilt, else (new_last_ts, current, rows):
    `current` = the rebuilt tail needs no provider top-up (`_needs_fresh` False and not
    `unverified`). The target inherits the source's `verified_through` — derived rows
    are exactly as proven as the rows they were built from — and only after the write
    reached SQLite (a failed write verifies nothing)."""
    try:
        d = _local_derived_tail(ticker_up, tf, last_ts)
        if not d:
            return None
        if not _sqlite.put_bars(ticker_up, tf, d["rows"], date_tf=False):
            return None
        # Inherit the base's proof only when the derivation ran to the base tail with no
        # missing slot — a truncated derivation proves nothing about what lies beyond.
        vt = tail_verified_through(ticker_up, d["src"]) if d.get("complete") else None
        if vt is not None:
            _mark_tail_verified(ticker_up, tf, vt)
        new_last = max(int(b["t"]) for b in d["rows"])
        current = (not _needs_fresh(new_last, tf)
                   and intraday_tail_status(ticker_up, tf, new_last)["tail_status"] != "unverified")
        return new_last, current, d["rows"]
    except Exception as _e:               # noqa: BLE001 — fall back to the provider path
        import logging as _log_ld
        _log_ld.getLogger(__name__).warning(
            "[bars] local derive %s tf=%s: %s", ticker_up, tf, type(_e).__name__)
        return None


def expected_completed_bucket(tf: str, now: float | None = None):
    """Start (unix seconds) of the latest REGULAR-session bucket that has CLOSED, or
    None when no bucket of today's session is expected (weekend, holiday, before the
    first bucket closes). The server twin of the client's
    `marketSession.expectedLatestCompletedBar(tf, now, {session:'rth'})` — same
    bucket-start convention, same irregular 09:30 opening hour on tf=60, same early
    closes (`_session_close_minutes`)."""
    if tf not in ("1", "5", "15", "30", "60"):
        return None
    try:
        et = _ZI("America/New_York")
        now_ts = float(now if now is not None else _time.time())
        now_dt = datetime.fromtimestamp(now_ts, et)
        ymd = int(now_dt.strftime("%Y%m%d"))
        if now_dt.weekday() >= 5 or _is_nyse_holiday(ymd):
            return None
        midnight = now_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        open_ts = int(midnight.timestamp()) + _RTH_OPEN_MINUTES_SERVER * 60
        close_ts = int(midnight.timestamp()) + _session_close_minutes(ymd) * 60
        if now_ts < open_ts:
            return None

        def _bstart(t: int) -> int:
            if tf == "60":
                return bucket_60_et_unix_seconds(int(t))
            step = int(tf) * 60
            return int(t) // step * step

        if now_ts >= close_ts:
            return _bstart(close_ts - 1)
        cur = _bstart(int(now_ts))
        prev = _bstart(cur - 1)
        if prev < open_ts:
            return None
        return prev
    except Exception:                      # noqa: BLE001 — abstain, never guess
        return None


def expected_completed_rth_bucket(tf: str, now: float | None = None):
    """Start (unix s) of the latest REGULAR-session bucket that has CLOSED: today's once
    its first RTH bucket has closed, else the FINAL RTH bucket of the previous trading
    session (half-day aware). The RTH twin of `expected_completed_ext_bucket` and the
    frontier an RTH-only chart (`session=rth`) is judged against (review #1051 F2: a
    thin name with no post-market prints is complete at its close for a chart that
    never shows post-market). None for a non-intraday tf or an unreadable clock."""
    if tf not in ("1", "5", "15", "30", "60"):
        return None
    today = expected_completed_bucket(tf, now)
    if today is not None:
        return today
    try:
        et = _ZI("America/New_York")
        now_ts = float(now if now is not None else _time.time())
        d = datetime.fromtimestamp(now_ts, et).replace(hour=0, minute=0, second=0, microsecond=0)
        d -= timedelta(days=1)
        for _ in range(14):
            if _is_trading_day_ymd(d):
                ymd = int(d.strftime("%Y%m%d"))
                midnight = int(datetime(d.year, d.month, d.day, tzinfo=et).timestamp())
                return _ext_bucket_start(tf, midnight + _session_close_minutes(ymd) * 60 - 1)
            d -= timedelta(days=1)
        return None
    except Exception:                      # noqa: BLE001 — abstain, never guess
        return None


def normalize_session(session) -> str | None:
    """The `/api/bars` `session` param: 'rth' | 'eth', else None (= the pre-param
    behaviour: RTH 60m grid, tails judged against the extended frontier)."""
    s = str(session or "").strip().lower()
    if s in ("rth", "regular"):
        return "rth"
    if s in ("eth", "ext", "extended"):
        return "eth"
    return None


def intraday_tail_status(ticker: str, tf: str, tail_ts, now: float | None = None,
                         session: str | None = None) -> dict:
    """Machine-readable currentness for an intraday response.

    Returns {"tail_status": "current" | "verified" | "unverified",
             "verified_through": <unix seconds> | None}
      current    — the served tail is within one bucket of the RTH frontier (or, with no
                   frontier today, it carries the last session through its close).
      verified   — outside that tolerance, but the provider was asked AFTER the expected
                   bucket closed and had nothing newer (`verified_through` says when).
      unverified — outside the tolerance and nobody has proven there is nothing newer:
                   the repair was shed, failed, or is still running. NOT current."""
    vt = tail_verified_through(ticker, tf)
    out = {"tail_status": "unverified", "verified_through": vt}
    try:
        tail = int(tail_ts) if tail_ts is not None else None
    except (TypeError, ValueError):
        tail = None
    step = int(tf) * 60 if tf in ("1", "5", "15", "30") else 3600
    # ⭐ EXTENDED FRONTIER FIRST (2026-11-11): the served series carries 04:00-20:00
    # ET, so its tail is judged against the latest closed EXTENDED bucket — during
    # RTH that is the same bucket as before; pre-market, post-market and after 20:00
    # it is the bucket the RTH-only rule could not see (a 16:53 tail at 20:22 was
    # `current`). Same one-bucket tolerance; beyond it only provider proof counts.
    # ⭐ THE CHART'S OWN SESSION (2026-11-10, review #1051 F2): an RTH-only chart
    # (`session=rth`) never shows post/pre-market, so its tail is judged against the
    # REGULAR frontier — a thin name with no after-hours prints is current at its
    # close, not `unverified` + fast polls all evening. Absent/eth = extended frontier.
    if normalize_session(session) == "rth":
        ext_frontier = expected_completed_rth_bucket(tf, now)
    else:
        ext_frontier = expected_completed_ext_bucket(tf, now)
    if ext_frontier is not None:
        tolerance_floor = _ext_bucket_start(tf, ext_frontier - 1)
        if tail is not None and tail >= tolerance_floor:
            out["tail_status"] = "current"
        elif vt is not None and tail is not None and vt >= _bucket_end(tf, ext_frontier, step):
            out["tail_status"] = "verified"
        return out
    # The extended frontier exists for every intraday tf at every instant (it falls
    # back to the previous session's final bucket), so the old RTH-frontier and
    # "no bucket of today is expected" branches are unreachable and were removed
    # (review #1051 F4). Reaching here means the clock or calendar was unreadable:
    # abstain as `unverified` — never claim currentness we could not compute.
    return out


_RTH_OPEN_MINUTES_SERVER = 9 * 60 + 30


def _bucket_end(tf: str, start: int, step: int) -> int:
    """End instant of the bucket starting at `start`. ⚠️ On 1h the grid is not
    uniform (TradingView: the 09:00 pre-market stub and the 15:30 half bar are
    THIRTY minutes), so `start + 3600` would demand a provider check that cannot
    happen until the NEXT bucket has closed. Read off the shared bucket helper."""
    if tf == "60":
        try:
            from api.services.bar_rollup import tv_bucket_bounds
            session = _GRID_TO_SESSION.get(SIXTY_MIN_GRID, "rth")
            return tv_bucket_bounds(int(start) * 1000, "60", session)[1] // 1000
        except Exception:                  # noqa: BLE001
            pass
    return int(start) + step


# One heal attempt per truncated tail per cooldown. ⛔ WITHOUT THIS THE PREDICATE
# ABOVE IS A SATURATION BUG: a genuinely thin symbol that simply stopped trading at
# 13:20 is indistinguishable from a truncated fetch, so it would report "needs
# fresh" on every prewarm cycle forever and re-fire a delta that returns nothing.
# That is the Memorial-Day-2026 pattern the off-market shortcut was written to stop
# (14k+ refresh calls per cycle against the shared Massive key). Keyed on the tail
# INSTANT, so a tail that actually advances is a new key and heals immediately,
# while one the provider cannot extend is asked again at most once per window.
_COMPLETENESS_COOLDOWN = int(
    _os.environ.get("BARS_COMPLETENESS_COOLDOWN_SECONDS", str(6 * 3600)))
_COMPLETENESS_MAX_KEYS = 20000
_completeness_attempt: dict[str, float] = {}
_completeness_lock = _threading.Lock()


def _completeness_heal_allowed(ticker: str, tf: str, last_ts: int) -> bool:
    """True at most once per (ticker, tf, tail instant) per cooldown."""
    key = f"{ticker}_{tf}_{int(last_ts)}"
    now = _time.time()
    with _completeness_lock:
        prev = _completeness_attempt.get(key)
        if prev is not None and (now - prev) < _COMPLETENESS_COOLDOWN:
            return False
        if len(_completeness_attempt) >= _COMPLETENESS_MAX_KEYS:
            _completeness_attempt.clear()   # bounded; a cleared window costs one retry
        _completeness_attempt[key] = now
    return True


_EXT_COMPLETENESS_COOLDOWN = float(
    _os.environ.get("BARS_EXT_COMPLETENESS_COOLDOWN_SECONDS", "120"))
_ext_completeness_attempt: dict[str, float] = {}


def _ext_completeness_heal_allowed(ticker: str, tf: str, last_ts: int) -> bool:
    """At most once per (ticker, tf, tail instant) per `_EXT_COMPLETENESS_COOLDOWN`."""
    key = f"{ticker}_{tf}_{int(last_ts)}"
    now = _time.time()
    with _completeness_lock:
        prev = _ext_completeness_attempt.get(key)
        if prev is not None and (now - prev) < _EXT_COMPLETENESS_COOLDOWN:
            return False
        if len(_ext_completeness_attempt) >= _COMPLETENESS_MAX_KEYS:
            _ext_completeness_attempt.clear()
        _ext_completeness_attempt[key] = now
    return True


def _ext_session_verified(ticker: str, tf: str, last_ts) -> bool:
    """The provider was asked after the tail's EXTENDED session ended (nothing newer)."""
    vt = tail_verified_through(ticker, tf)
    end = _ext_session_end_ts(last_ts)
    return vt is not None and end is not None and vt >= end


#: Seconds after a 5m boundary during which the live stream's proof may trail the new
#: frontier by its final minute without a request-path provider heal (#1051 note).
_LIVE_PROOF_BOUNDARY_GRACE_S = 60


def _live_proof_in_boundary_grace(ticker: str, tf: str, now: float | None = None) -> bool:
    """True when a covered 5m series' stream proof trails the newest closed bucket ONLY
    by that bucket's final minute, and that minute closed less than
    `_LIVE_PROOF_BOUNDARY_GRACE_S` ago.

    ⭐ WHY THIS IS SAFE. `proven_through_s` is the end of the newest minute the alive
    stream has delivered for the WHOLE market. Its minute aggregates land 2-5 s after
    the minute closes, so for those seconds after every 5m boundary the proof reads one
    minute short of the new bucket's end and a thin covered name fell through to a
    provider heal on the request path — hundreds of them at once, every 5 minutes.
    In that window everything up to the final minute IS proven, and the final minute is
    the one the stream is delivering right now (the provider, asked at the same instant,
    has no newer data for it). After the grace, a proof that still trails means the
    stream really is lagging, and the fall-through repairs as before. This only skips
    the heal: the wire still reports `unverified` (no currentness is claimed), so the
    client's catch-up poll re-asks and reads the minute the stream has by then written."""
    if tf != "5":
        return False
    try:
        from api.services import bars_live_store as _bls
        proven = _bls.proven_through_s(ticker)
        if proven is None:
            return False
        now_ts = float(now if now is not None else _time.time())
        frontier = expected_completed_ext_bucket(tf, now_ts)
        if frontier is None:
            return False
        end = int(frontier) + 300
        return proven >= end - 60 and now_ts < end + _LIVE_PROOF_BOUNDARY_GRACE_S
    except Exception:                      # noqa: BLE001 — abstain: the normal rules run
        return False


def _needs_fresh(last_ts: int | None, tf: str, ticker: str | None = None) -> bool:
    """True if SQLite data is stale enough to warrant a delta fetch.

    `ticker` is OPTIONAL and enables the off-market session-completeness
    escalation below. Callers that omit it keep byte-identical behaviour, so the
    freshness alerting and any other reader is untouched by this change.
    """
    if last_ts is None:
        return True
    # A series the universe live feed keeps current (bars_live_store, bars-api only,
    # BARS_LIVE_COVERAGE_ENABLED) is fresh by construction: the stream or the
    # whole-market snapshot has already written its newest bar. False everywhere the
    # flag is off or the feed is not alive, so this is a no-op until armed.
    if ticker and tf in ("5", "D"):
        try:
            from api.services import bars_live_store as _bls
            if _bls.covered(ticker, tf):
                # ⛔ 5m: "covered" is not proof by itself (review #1051 F1). Fresh only
                # while the stream's proof makes the tail current/verified; otherwise
                # fall through so the normal rules (incl. the extended re-ask, which
                # marks verified) can repair it — e.g. a new epoch with no minute yet.
                if tf == "D" or intraday_tail_status(ticker, tf, last_ts)["tail_status"] != "unverified":
                    return False
                if _live_proof_in_boundary_grace(ticker, tf):
                    return False
        except Exception:
            pass
    if tf == "W":
        # ⛔⛔ A WEEKLY BAR IS KEYED BY ITS WEEK'S FRIDAY, WHICH IS AHEAD OF THE LATEST SESSION
        # FROM MONDAY TO THURSDAY. The D/W/M rule below (`last_ts <= latest session`) therefore
        # read the developing week's bar as FRESH all week and never refreshed it: it froze at
        # whatever was stored first. Measured 2026-09-25 (Friday night) on production: AMD's
        # week bar closed 615.52 with a high of 616.69 while its daily bars closed 630.63 and
        # peaked at 639.00; MSFT/TSLA/AAPL likewise held one early-week session. Compare against
        # the KEY of the latest session's week instead, which is the daily rule said correctly:
        # refresh if the stored bar is from an earlier period OR it IS the current one.
        return last_ts <= _week_key_yyyymmdd(_last_weekday_yyyymmdd())
    if tf in ("D", "W", "M"):
        # Refresh if cached bar is from before today's session, OR if it IS
        # today's bar (which keeps evolving — open is fixed at 9:30 ET but
        # high/low/close drift throughout the session and into extended
        # hours). Strict `<` would freeze today's daily/weekly/monthly bar
        # at whatever values were first cached (typically just-after-open
        # values when the first request hit). Combined with the in-memory
        # cache's 5-minute TTL, this triggers at most one fetch per 5min
        # per ticker per tf — fine for Polygon rate limits, and ensures
        # today's evolving close updates instead of freezing.
        return last_ts <= _last_weekday_yyyymmdd()

    threshold = _INTRADAY_FRESHNESS_THRESHOLDS.get(tf, 300)
    age = _time.time() - last_ts

    # A new bar bucket has begun since last_ts (the clock rolled into a new bar
    # interval), so the stored newest bar is the PREVIOUS bucket and the current
    # in-progress bucket is absent. Force a fetch so the first paint carries the
    # current PARTIAL bar (its true open + the range elapsed so far) instead of
    # letting the frontend seed a flat bar at the current price ("current hour
    # candle starts flat"). Uses the exact bucketing the resample/WS-rollup use
    # (tf=60 anchors at the 9:30 ET session open, not the clock hour).
    new_bucket = False
    try:
        from api.services.bar_rollup import bucket_start
        new_bucket = last_ts < (bucket_start(int(_time.time() * 1000), tf) // 1000)
    except Exception:
        new_bucket = False

    if _is_market_open():
        return age > threshold or new_bucket

    # Off-market refinements (the bug being fixed here):
    # The prior code returned `age > 30h` for ALL off-market times, which
    # meant a chart opened at 17:00 ET on a trading day where the cache
    # only had data through 12:00 ET would NOT trigger a top-up — the 5h
    # diff is well under 30h, so the user saw a chart pinned at noon even
    # though Polygon had the full RTH session available. New rule:
    #
    # - Weekday extended-hours window (4 AM – 8 PM ET): use the standard
    #   tf threshold so post-market and pre-market top-ups happen normally.
    #   Polygon delivers RTH-close prints + after-hours moves + early-bird
    #   pre-market in that window; we should pick them up.
    # - Overnight (8 PM – 4 AM ET) and weekends: nothing new arrives, so
    #   the conservative 30h "is the data ancient?" gate still applies.
    try:
        et = _ZI("America/New_York")
        now_dt = datetime.now(et)
        hour_min = now_dt.hour * 60 + now_dt.minute
        # 4:00 AM ET (240) through 8:00 PM ET (1200) on a TRADING weekday
        # is the window where extended-hours and RTH coexist. NYSE holidays
        # produce no bars at any hour, so the aggressive 'needs fresh'
        # threshold must NOT apply — otherwise prewarmer + on-demand both
        # refetch empty all day and saturate the shared Massive API key
        # (the Memorial-Day-2026 incident).
        is_holiday = _is_nyse_holiday(int(now_dt.strftime("%Y%m%d")))
        in_extended_today = (
            now_dt.weekday() < 5 and not is_holiday and 240 <= hour_min < 1200
        )
    except Exception:
        # If zoneinfo fails for any reason, fall back to the old conservative
        # behavior — better to under-fetch than over-fetch on an edge case.
        in_extended_today = False

    if in_extended_today:
        return age > threshold or new_bucket
    # Off-market (overnight/weekend/holiday). The original 30h gate was a
    # blunt "is the data ancient?" guard, but on weekends and especially
    # 3-day holiday weekends it false-positives: Friday-close data is ~64h
    # old by Sunday and ~88h by Tuesday-after-Memorial-Day, both > 30h, so
    # the prewarmer would fire 14k+ refresh calls per cycle that return
    # nothing — contending for the shared Massive API key against any
    # cold user fetch happening at the same time (the 12s AEHR symptom).
    # Cold-stale is the authoritative "are we missing a trading session?"
    # predicate, and it's already holiday-aware. Reuse it: if the cache
    # covers the most-recent trading session, the entry is fresh enough
    # off-market regardless of wall-clock age. If a session IS missing,
    # the 30h gate still kicks in to make sure we don't sit on truly
    # ancient data.
    if tf in ("1", "5", "15", "30", "60") and not _is_cold_stale_intraday(tf, last_ts):
        # The date matches the latest session — but a date is not a session. A tail
        # that stops before its own close is TRUNCATED, and off-market nothing else
        # will ever notice (see `intraday_session_complete`). Escalate once per
        # truncated tail per cooldown, and only when the caller named the symbol.
        if (ticker
                and _os.environ.get("BARS_SESSION_COMPLETENESS", "1") == "1"
                and not intraday_session_complete(tf, last_ts)
                and _completeness_heal_allowed(ticker, tf, last_ts)):
            return True
        # ⭐ EXTENDED completeness (2026-11-11): a tail that reaches the 16:00 close but
        # not the 20:00 extended close is missing the post-market the series carries
        # (AAPL 1m at 20:22 ET ended 16:53). Re-ask for it — but only for a member's
        # INTERACTIVE request (never the prewarm/crawler universe sweep: thousands of
        # names print nothing after 16:00 and would each cost a provider call), only
        # while nobody has verified the session through its extended close, and at
        # most once per tail instant per `_EXT_COMPLETENESS_COOLDOWN` (short, so a
        # failed attempt is retried on the client's catch-up poll, not hours later).
        if (ticker and _request_is_interactive()
                and not intraday_ext_session_complete(tf, last_ts)
                and not _ext_session_verified(ticker, tf, last_ts)
                and _ext_completeness_heal_allowed(ticker, tf, last_ts)):
            return True
        return False
    return age > 30 * 3600


# ── Deep-history request handling ────────────────────────────────────────────
# The frontend paints a shallow window first (FIRST_PAINT_BARS = 600) for an
# instant chart, then — when the user pans toward the oldest loaded bar —
# re-requests the full depth (fullBarsFor, thousands of bars). We treat any
# request above this threshold as a "give me everything available" backfill:
#   • D/W/M → pull the yfinance pre-2003 IPO tail (Massive/Polygon's daily floor
#     is 2003-09-10), merged under Massive's recent history (deep=True path).
#   • intraday → the per-TF lookback ceiling already widens with max_bars.
# 600 first-paint < 1200 < any backfill target, so this cleanly separates the
# two request classes.
_DEEP_REQUEST_THRESHOLD = 1200


def _is_deep_request(bars: int) -> bool:
    return bars >= _DEEP_REQUEST_THRESHOLD


# ~252 sessions in a 365-day year — the conversion from "calendar days back to
# my floor date" to "daily bars I must ask for". Sized here, ONCE, because two
# callers need the same answer and a restated constant is how the two drift.
_SESSIONS_PER_CALENDAR_DAY = 252 / 365
# Holidays, a stale last bar over a long weekend, and the fact that a fetch
# returns the most recent N — a floor date must land comfortably INSIDE the
# window, not on its edge.
_DEPTH_MARGIN_BARS = 20


def daily_bars_needed_since(lo_iso: str, *, today=None) -> int:
    """Daily-bar count that reaches back to `lo_iso`, always UNDER the deep
    threshold.

    A caller that wants "this year's bars" was asking for 5000 — ~20 years — to
    keep ~160 of them. 5000 is above `_DEEP_REQUEST_THRESHOLD`, so it took the
    synchronous full-history backfill path: measured 4-31s per symbol against
    production (and one HTTP 502), versus 0.4-1.0s for the same symbols under
    the threshold. Callers that only need a recent window must size the ask to
    the window.

    Clamped below the threshold on purpose: a far-past floor is answered with
    the deepest NON-deep window rather than silently re-entering that path. A
    caller that genuinely wants full history should say so by passing a large
    count to `_get_bars_inner` directly.
    """
    from datetime import date as _date
    today = today or _date.today()
    try:
        y, m, d = (int(p) for p in str(lo_iso)[:10].split("-"))
        lo = _date(y, m, d)
    except Exception:
        # Unparseable floor → a full calendar year, the common intent.
        lo = _date(today.year, 1, 1)
    elapsed = max((today - lo).days, 0)
    need = int(elapsed * _SESSIONS_PER_CALENDAR_DAY) + _DEPTH_MARGIN_BARS
    return max(30, min(need, _DEEP_REQUEST_THRESHOLD - 1))


def _mark_history_complete(ticker: str, tf: str) -> None:
    """Record that a full-history (deep) fetch has populated SQLite for this
    (ticker, tf). Without this, a deep backfill whose requested count exceeds
    the stock's actual available bar count (e.g. asking 20000 daily bars for a
    name with only 6800 to its IPO) would fail the ``len >= bars*0.9`` cache
    gate on EVERY poll and re-trigger a full yfinance/Massive fetch forever.
    The marker says "this is all there is — serve it, only delta from here."
    6h TTL so a long-open chart refreshes the full pull at most once per 6h.

    ⛔ NEVER ON A FALLBACK INTRADAY ANSWER. yfinance serves 7 days of 1m and FMP a
    shallow RTH-only window; marking either "complete" told the cache gate "this is
    all there is" and locked the truncated depth in for 6h, so the deep Massive pull
    never re-ran even after Massive recovered."""
    if tf in ("1", "5", "15", "30", "60") and _last_intraday_fetch_was_fallback():
        import logging as _log_hc
        _log_hc.getLogger(__name__).info(
            "[bars] %s tf=%s: fallback (%s) answer NOT marked history-complete",
            ticker, tf, last_intraday_source())
        return
    try:
        cache.set(f"histfull_{ticker}_{tf}", True, ttl=21600)
    except Exception:
        pass


def _history_complete(ticker: str, tf: str) -> bool:
    try:
        return cache.get(f"histfull_{ticker}_{tf}") is True
    except Exception:
        return False


def _expected_latest_session_yyyymmdd(now=None) -> int:
    """ET date (YYYYMMDD int) of the most recent trading session that
    should have intraday bars available.

    Weekends roll to Friday; weekday pre-open (before ~09:35 ET) rolls to
    the prior trading day; NYSE-closed holidays also roll back (added
    2026-05-25 after Memorial-Day saturation: previously ALL intraday
    cache entries fired cold-stale on holidays because the prior weekday's
    cache looked "older than today's expected session," sending every chart
    open down the synchronous Massive-fetch path while the prewarmer
    hammered the same empty-result loop).

    False positives still cost only ~1s of latency once; false negatives
    are the universe-freeze bug, so we keep biasing toward fetching for
    everything OTHER than the well-known holiday set.
    """
    et = _ZI("America/New_York")
    now = now or datetime.now(et)
    wd = now.weekday()  # 0=Mon … 5=Sat, 6=Sun
    if wd == 5:
        d = now - timedelta(days=1)
    elif wd == 6:
        d = now - timedelta(days=2)
    else:
        if now.hour * 100 + now.minute < 935:
            d = now - timedelta(days=1)
            if d.weekday() == 5:
                d -= timedelta(days=1)
            elif d.weekday() == 6:
                d -= timedelta(days=2)
        else:
            d = now
    # Walk back past any NYSE holiday (and any weekend the holiday rolls
    # onto) so a closed Monday correctly resolves to Friday's session, not
    # to itself. 14-day cap is a safety belt — NYSE never has a 2-week run.
    for _ in range(14):
        ymd = int(d.strftime("%Y%m%d"))
        if d.weekday() < 5 and not _is_nyse_holiday(ymd):
            return ymd
        d -= timedelta(days=1)
    return int(d.strftime("%Y%m%d"))


def _is_cold_stale_intraday(tf: str, last_ts: int | None, now=None) -> bool:
    """True when the newest cached intraday bar predates the most recent
    session that should have data — i.e. the cache is missing >=1 whole
    trading session, not merely a same-session top-up.

    Cold-stale entries MUST be fetched synchronously so the FIRST chart
    paint is correct, instead of being served stale-while-revalidate (the
    root cause of the universe-wide May-8 freeze: charts fetch once per
    mount, so they never picked up the background heal). Same-session
    staleness still uses the fast SWR path — that's a legit "serve
    instantly, top up the developing bar in the background" case.
    """
    if tf not in ("1", "5", "15", "30", "60") or last_ts is None:
        return False
    try:
        et = _ZI("America/New_York")
        last_date = int(datetime.fromtimestamp(last_ts, et).strftime("%Y%m%d"))
    except Exception:
        return False
    return last_date < _expected_latest_session_yyyymmdd(now)


def _is_cold_stale_daily(tf: str, last_ts: int | None, now=None) -> bool:
    """Daily twin of `_is_cold_stale_intraday`: True when the newest stored
    DAILY bar predates the most recent session that should have data — i.e.
    the cache is missing >=1 whole completed trading session.

    Cold-stale daily entries MUST be fetched SYNCHRONOUSLY so the FIRST chart
    paint already carries today's bar, instead of being served stale-while-
    revalidate. SWR pins the prior-session bar on the first mount (charts
    fetch once per mount), and the live-price overlay then fuses today's
    price onto that frozen bar — the "Frankenstein last candle" /
    "daily not recognizing today" symptom (reproduced 2026-06-15: PAYO
    daily stuck on Fri 6/12 with the 7.03 live price painted onto it while
    the real 6/15 session was already complete). Massive's daily AGGREGATE
    endpoint lags the long tail by several sessions, so without a synchronous
    path the user keeps seeing yesterday until the background heal lands.

    Daily `last_ts` is a YYYYMMDD int (NOT unix seconds like intraday — see
    `_needs_fresh`/`_last_weekday_yyyymmdd`), so this is a direct date compare
    against the holiday/weekend/pre-open-aware expected session.

    Scoped to tf == "D" only. Weekly/monthly bars key on a representative
    period date that legitimately trails today WITHIN the current period, so
    the same `<` compare would false-positive on every mid-week / mid-month
    load; W/M evolve slowly and keep the fast SWR path (their yfinance
    tail-fill still heals in the background via `_delta_weekly`/`_delta_monthly`).
    """
    if tf != "D" or last_ts is None:
        return False
    try:
        return int(last_ts) < _expected_latest_session_yyyymmdd(now)
    except (TypeError, ValueError):
        return False


def _is_cold_stale_weekly(tf: str, last_ts, now=None) -> bool:
    """Weekly twin of `_is_cold_stale_daily`: True when the newest stored WEEKLY bar is
    from an EARLIER week than the one the latest expected session belongs to — i.e. the
    whole current week is missing, not merely its week-to-date values.

    ⛔ MEASURED 2026-09-28 (Monday 11:37 ET): AVGO/AAPL/NVDA/MSFT `tf=W` served LAST
    week's bar (key 2026-09-25) via stale-while-revalidate as the newest weekly candle.
    UCT's weekly contract is a forming week-to-date candle (`_delta_weekly`: "the
    in-progress weekly bar keeps updating"; `_needs_fresh`'s W rule, 2026-09-25), and
    SWR pins the first mount's answer — the same "fetch once per mount" trap the daily
    rule exists for. Weekly keys are the ISO week's FRIDAY, so compare week KEYS; before
    Monday's first session is expected (weekend, pre-09:35) the latest session is still
    last week and this is False."""
    if tf != "W" or last_ts is None:
        return False
    try:
        return int(last_ts) < _week_key_yyyymmdd(_expected_latest_session_yyyymmdd(now))
    except (TypeError, ValueError):
        return False


def _last_closed_session_yyyymmdd(now=None) -> int:
    """ET date (YYYYMMDD int) of the most recent CLOSED daily session: today only
    once today's regular session has closed (>= 16:00 ET on a trading weekday),
    else the prior trading day. Weekend/holiday aware. Mirrors the CLIENT's
    marketSession close-threshold, so origin and chart agree on 'is a daily ending
    here missing only today's still-forming bar?' (vs an earlier closed session)."""
    et = _ZI("America/New_York")
    now = now or datetime.now(et)
    wd = now.weekday()
    if wd == 5:
        d = now - timedelta(days=1)
    elif wd == 6:
        d = now - timedelta(days=2)
    else:
        if now.hour * 100 + now.minute < 1600:   # before 4pm ET → today's session not closed yet
            d = now - timedelta(days=1)
            if d.weekday() == 5:
                d -= timedelta(days=1)
            elif d.weekday() == 6:
                d -= timedelta(days=2)
        else:
            d = now
    for _ in range(14):
        ymd = int(d.strftime("%Y%m%d"))
        if d.weekday() < 5 and not _is_nyse_holiday(ymd):
            return ymd
        d -= timedelta(days=1)
    return int(d.strftime("%Y%m%d"))


def _daily_deblockable(tf, last_ts) -> bool:
    """PHASE 1 (flag: BARS_DAILY_ASYNC_HEAL): a cold-stale DAILY is safe to serve
    stale-then-heal (non-blocking) — instead of a synchronous provider fetch — ONLY
    when it already carries the last CLOSED session and is 'stale' merely because
    today's still-forming bar is absent. The client paints that instantly (2026-08-18
    close-threshold gate + Writer-E new-session guard), the live feed adds today's
    candle, and the bg _delta_daily heal lands on the next poll. A daily missing an
    EARLIER closed session is NOT deblockable — serving it would pin stale data for
    the 300s daily SWR window (the 'fetch once per mount' trap), so it stays
    synchronous. Default OFF; flip the env to roll out, unset to roll back."""
    if tf != "D" or last_ts is None:
        return False
    if _os.environ.get("BARS_DAILY_ASYNC_HEAL", "0") != "1":
        return False
    try:
        return int(last_ts) >= _last_closed_session_yyyymmdd()
    except (TypeError, ValueError):
        return False


def _intraday_deblockable(tf, last_ts) -> bool:
    """PHASE 1 (flag: BARS_INTRADAY_ASYNC_HEAL): the intraday twin of
    `_daily_deblockable`. A cold-stale INTRADAY tail is safe to serve stale-then-heal
    (non-blocking) — instead of a synchronous provider fetch — ONLY when it already
    carries the last CLOSED session and is 'cold-stale' merely because today's forming
    intraday bars are absent. The client paints that prior-session tail INSTANTLY
    (`marketSession.isIntradayTailStale` treats a tail == the last closed session as
    fresh) and the `since=` delta fills today's bars on top (the exact model the
    intraday pack already relies on); the bg `_delta_intraday` heal lands on the next
    poll. An intraday tail missing an EARLIER full session is NOT deblockable — serving
    it would pin a GAPPED first paint that the once-per-mount fetch never re-heals (the
    May-8 universe-freeze class), so it stays synchronous. `last_ts` here is UNIX
    SECONDS (intraday), so map it to its ET session date before the closed-session
    compare. Default OFF; flip the env to roll out, unset to roll back."""
    if tf not in ("1", "5", "15", "30", "60") or last_ts is None:
        return False
    if _os.environ.get("BARS_INTRADAY_ASYNC_HEAL", "0") != "1":
        return False
    try:
        et = _ZI("America/New_York")
        last_date = int(datetime.fromtimestamp(int(last_ts), et).strftime("%Y%m%d"))
        return last_date >= _last_closed_session_yyyymmdd()
    except Exception:
        return False


def _since_async_heal() -> bool:
    """PHASE 1.4 (flag: BARS_SINCE_ASYNC_HEAL): the browser's 30s `since=` SWR poll
    is the HIGHEST-QPS bars entrypoint. On a stale tail it does a SYNCHRONOUS provider
    delta, tying up a shared anyio-pool thread on every stale-tail poll across every
    open chart × every user — the congestion that drags WARM charts to multi-second
    loads under load. Unlike first paint, this poll only RECONCILES closed bars: the
    live developing candle is owned by the WS push / Finnhub feed, NOT this response,
    and the chart is ALREADY painted. So serving the local delta immediately and
    healing the tail in the background (bounded, deduped — the same `_bg_delta_sem` +
    `_inflight` machinery the first-paint stale-serve uses) is invisible to the user
    and removes the last high-frequency provider-blocking site. NO cold-stale predicate
    is needed here (a one-cycle reconcile lag can't blank an already-painted chart or
    pin a first paint). Default OFF; flip the env to roll out, unset to roll back."""
    return _os.environ.get("BARS_SINCE_ASYNC_HEAL", "0") == "1"


def _enqueue_since_bg_heal(cache_key: str, ticker: str, tf: str, last_ts: int, date_tf: bool) -> None:
    """Bounded, deduped background delta heal for the `since=` path (Phase 1.4).
    Mirrors the first-paint `_bg_delta` spawn: acquire a bars-bg slot non-blocking
    (skip if the pool is full — the stale local delta was already served and the next
    poll retries), dedup on `cache_key` so it never races the first-paint heal, run a
    delta-only fetch, persist, and invalidate the full cache. Intraday-stale results
    are NOT persisted (same guard as `_bg_delta` — a yfinance hours-old fallback must
    not be stored as fresh)."""
    with _inflight_lock:
        if cache_key in _inflight or not _bg_delta_sem.acquire(blocking=False):
            return
        _ev = _threading.Event()
        _inflight[cache_key] = _ev

    def _run():
        try:
            if not date_tf:
                if _heal_intraday_tail(ticker, tf, last_ts):   # persists + verifies
                    cache.invalidate(cache_key)
            else:
                if tf == "D":
                    new = _delta_daily(ticker, last_ts)
                elif tf == "W":
                    new = _delta_weekly(ticker, last_ts)
                else:
                    new = _delta_monthly(ticker, last_ts)
                if new:
                    _sqlite.put_bars(ticker, tf, new, date_tf=date_tf)
                    cache.invalidate(cache_key)  # next non-delta request rebuilds fresh
        except Exception as _e:
            import logging as _log_sh
            _log_sh.getLogger(__name__).error(
                f"[bars] since bg heal {ticker} tf={tf}: {type(_e).__name__}: {_e}"
            )
        finally:
            with _inflight_lock:
                _inflight.pop(cache_key, None)
            _ev.set()
            _bg_delta_sem.release()

    try:
        _threading.Thread(target=_run, daemon=True, name=f"bars-sincebg-{ticker}-{tf}").start()
    except Exception:
        with _inflight_lock:
            _inflight.pop(cache_key, None)
        _bg_delta_sem.release()


def _reconcile_developing_week(ticker: str, weekly: list[dict]) -> list[dict]:
    """The developing week's candle, rebuilt from the STORED DAILY bars when they are further
    along than the stored weekly bar. Read-only (no write on the serve path), no provider call.

    ⭐ WHY. A chart is ONE fetch: the Discord renderer screenshots the first paint, and a member's
    weekly chart paints once per mount. The weekly bar is refreshed stale-while-revalidate, so
    the first paint after it went stale showed the stale week (NVDA's W chart read $224.58 at
    21:21 ET on 9/25 while its own daily read $225.07). The daily store is refreshed far more
    often (every daily chart, the universe prewarm), and the developing week IS the sum of those
    daily bars, so deriving it here makes W agree with D on the first paint.

    ⛔ ONLY WHEN THE DAILY SIDE IS FURTHER ALONG. A weekly delta pulls fresh dailies from the
    provider and writes only the W row, so the W bar can be AHEAD of the D store. Cumulative
    volume only grows inside a period, so the side with more volume is the fresher one; equal or
    less volume keeps the stored bar (newest wins, never regress). Sealed weeks are never touched.
    A daily week NEWER than the last weekly key (a Monday before the W store has this week) is
    appended under its Friday key, the key `_resample_weekly_iso` would stamp."""
    try:
        drows = _sqlite.get_bars(ticker, "D", 8)
    except Exception:
        return weekly
    if not drows:
        return weekly
    daily = []
    for ts, o, h, l, c, v in drows:
        if None in (o, h, l, c) or min(o, h, l, c) <= 0:
            continue
        s = str(ts)
        daily.append({"t": f"{s[:4]}-{s[4:6]}-{s[6:]}", "o": o, "h": h, "l": l, "c": c, "v": v or 0})
    derived = _resample_weekly_iso(daily)
    if not derived:
        return weekly
    last_key = weekly[-1]["t"]
    out = list(weekly)
    for wk in derived:
        if wk["t"] == last_key:
            if (wk.get("v") or 0) > (out[-1].get("v") or 0):
                out[-1] = wk
        elif wk["t"] > last_key:
            out.append(wk)
    return out


def _fmt_sqlite_bars(rows: list[tuple], tf: str, ticker: str | None = None) -> list[dict]:
    """Convert SQLite (ts, o, h, l, c, v) tuples to LightweightCharts format.

    When `ticker` is supplied and tf is D/W/M, the assembled bars are passed
    through `bars_sanitize.sanitize_daily_bars` — a serve-time, source-agnostic
    normalization that drops recycled-ticker pre-listing history, self-heals
    provider split-adjustment gaps, and clamps lone bad-print wicks. It is
    best-effort (never raises) and reads corporate-action metadata from cache
    only (no blocking network on the serve path). Callers that don't pass a
    ticker (e.g. the bg warm loop / tests) get the raw formatted bars.

    Serve-time defense-in-depth (2026-06-13): drop garbage bars — any with a
    null OHLC field or a non-positive price — so a chart NEVER receives one no
    matter how it entered SQLite. The universe sweep found ~1 stray null-OHLC
    placeholder bar per ticker on 30m/60m (overnight UTC buckets, v=0); this is
    the single chokepoint every cached response flows through. Zero volume is
    legitimate (illiquid / extended-hours) and is kept. Filtering here does not
    perturb delta/partial-cache logic — those read raw SQLite rows, not this.

    Weekly guard (2026-07-02): drop weekly rows whose date is not the Friday
    of its ISO week. Valid weekly keys are ALWAYS calendar Fridays
    (_resample_weekly_iso); a non-Friday key is a stale Monday-keyed leftover
    that duplicates the week's candle. bars_sqlite.purge_mis_keyed_weekly_rows
    cleans the store at boot; this keeps charts clean even against a
    just-restored stale snapshot between purges."""
    date_tf = tf in ("D", "W", "M")
    weekly = tf == "W"
    # Key guard (W: 2026-07-02, D: 2026-11-11): a stored row whose date key breaks the
    # `date_bar_keys` rule (a W not on its Friday; a D on a non-trading day — prod's
    # Saturday 2026-11-07 bar) never renders, even before the background purge lands.
    key_guard = None
    if tf in ("D", "W"):
        from api.services import date_bar_keys as _dk
        if tf == "W" or _dk.calendar_applies(ticker):
            key_guard = _dk.key_ok
    out = []
    for ts, o, h, l, c, v in rows:
        if o is None or h is None or l is None or c is None:
            continue
        if o <= 0 or h <= 0 or l <= 0 or c <= 0:
            continue
        if date_tf:
            s = str(ts)
            if key_guard is not None and not key_guard(tf, ts):
                continue
            t_val = f"{s[:4]}-{s[4:6]}-{s[6:]}"
        else:
            t_val = ts
        out.append({"t": t_val, "o": o, "h": h, "l": l, "c": c, "v": v})
    if not date_tf and out:
        # ⛔ Grid guard (2026-11-10): an intraday row is keyed on its bucket START. A
        # stored off-grid row (the yfinance live row stamped at a trade time, e.g. SPY
        # 5m 16:35:50 beside 16:35:00) drew as an extra candle. Drop it beside its
        # bucket row (or snap it when the bucket has no row) and queue a repair of the
        # stored pair — `intraday_grid` module doc. No-op (no copy) on a clean series.
        try:
            from api.services import intraday_grid as _grid
            out = _grid.fold_for_serve(tf, out, ticker)
        except Exception:
            pass  # best-effort: never let the guard blank a chart
    if ticker and weekly and out:
        out = _reconcile_developing_week(ticker, out)
    if ticker and date_tf and out:
        try:
            from api.services.bars_sanitize import sanitize_daily_bars
            out = sanitize_daily_bars(ticker, out, tf)
        except Exception:
            pass  # best-effort: never let normalization blank a chart
    if ticker and not date_tf and len(out) > 1:
        # Intraday split cliff → bounded background DETECT + LOG, no writes (cache reads only here).
        try:
            from api.services import intraday_split_heal as _ish
            _ish.note_served(ticker, tf, out)
        except Exception:
            pass
    return out


# yfinance period/interval config — Yahoo limits: 1m=7d, 5m=60d, 15m=60d, 30m=60d, 60m=730d
_YF_CONFIG = {
    '1':  {'period': '7d',   'interval': '1m'},
    '5':  {'period': '60d',  'interval': '5m'},
    '15': {'period': '60d',  'interval': '15m'},
    '30': {'period': '60d',  'interval': '30m'},
    '60': {'period': '730d', 'interval': '60m'},
}

# Ticker overrides for yfinance
_YF_TICKERS = {'VIX': '^VIX', 'BTC': 'BTC-USD'}

# Symbols that don't exist in Massive's equities API and must come from
# yfinance — true market indices (Nasdaq Composite, S&P 500, Dow, Russell).
# Used by the Model Book index-comparison pane (^IXIC). Daily/weekly/monthly
# come from yfinance period='max'; intraday reuses _fetch_intraday_yfinance.
# Any caret-prefixed ticker is treated as a yf-only index as well.
_YF_ONLY = {'^IXIC': '^IXIC', 'IXIC': '^IXIC', '^GSPC': '^GSPC', '^DJI': '^DJI', '^RUT': '^RUT'}


def _is_yf_only_symbol(ticker_up: str) -> bool:
    """True for market-index symbols that bypass Massive and use yfinance."""
    return ticker_up in _YF_ONLY or ticker_up.startswith('^')

# In-memory cache TTLs by timeframe (seconds)
# Intraday kept very short so charts stay current during market hours
_CACHE_TTL = {'1': 5, '5': 10, '15': 10, '30': 10, '60': 10, 'D': 300, 'W': 900, 'M': 900}


def _resample_weekly(daily_bars: list[dict]) -> list[dict]:
    """Resample daily bars to weekly (ISO week grouping)."""
    if not daily_bars:
        return []
    weeks = {}
    for bar in daily_bars:
        # bar["t"] is unix ms from Massive
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        key = dt.isocalendar()[:2]  # (year, week)
        if key not in weeks:
            # Date by the week's CLOSE (Friday of the ISO week) — see
            # _resample_weekly_iso for the stable-key rationale.
            friday = datetime.fromisocalendar(key[0], key[1], 5)
            weeks[key] = {
                "dt": friday, "o": bar["o"], "h": bar["h"],
                "l": bar["l"], "c": bar["c"], "v": _bar_volume(bar),
            }
        else:
            w = weeks[key]
            w["h"] = max(w["h"], bar["h"])
            w["l"] = min(w["l"], bar["l"])
            w["c"] = bar["c"]
            w["v"] = w["v"] + _bar_volume(bar)
    result = []
    for w in sorted(weeks.values(), key=lambda x: x["dt"]):
        result.append({
            "t": w["dt"].strftime("%Y-%m-%d"),
            "o": w["o"], "h": w["h"], "l": w["l"], "c": w["c"], "v": w["v"],
        })
    return result


def _fetch_intraday_massive(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from Massive API agg endpoint with pagination.

    Massive (Polygon) silently truncates large single-page responses — verified
    empirically that asking for >1000 bars in one call returns data that ends
    weeks or months before today (e.g. src=5000 → last bar 5 months stale).
    The endpoint paginates via a `next_url` field; we follow it until either
    the response stops returning a next_url or we hit the safety page cap.
    """
    multiplier = int(tf)  # 1, 5, 15, 30, 60
    # Lookback scales with max_bars. 16hr/day to account for extended hours.
    # Massive/Polygon retains deep intraday (verified: 1-min back to >=2010,
    # all TFs back as far as we ask). These are SAFETY CEILINGS only — the real
    # depth knob is the requested `max_bars` (frontend fullBarsFor), bounded
    # here so a runaway request can't pull a decade of 1-min in one shot.
    # Per-TF ceilings (calendar days): 1m ~2mo, 5m ~1yr, 15m ~2.7yr,
    # 30m/60m ~8.7yr (60m resamples from the 30m fetch, so 30's ceiling feeds it).
    # Raised 30/60 to 3200d so the frontend's deeper hourly target (fullBarsFor 60
    # → ~8yr) isn't clipped — the provider has the history; these are only ceilings.
    bars_per_day = (16 * 60) // multiplier
    # 15m is the SOURCE of the 30m and 60m resamples (src = 2x / 4x bars), so its
    # ceiling must reach their depth; a plain 15m chart (fullBarsFor 15 ≈ 700 days)
    # never asks for that much, so the raise only changes the resample paths.
    max_lookback = {1: 60, 5: 365, 15: 3200, 30: 3200, 60: 3200}.get(multiplier, 2200)
    lookback_days = min(max_lookback, max(10, int(max_bars / max(bars_per_day, 1) * 1.5) + 5))
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/{multiplier}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        all_results: list[dict] = []
        # Safety cap: 20 pages × 50000 bars = 1M bars — way more than we'd ever
        # use, but bounds the worst case if Polygon changes pagination behavior.
        for _page in range(20):
            data = client._get(url)
            page_results = data.get("results") or []
            all_results.extend(page_results)
            next_url = data.get("next_url")
            if not next_url:
                break
            # next_url comes back without the apiKey — append it.
            sep = "&" if "?" in next_url else "?"
            url = f"{next_url}{sep}apiKey={client._api_key}"

        if not all_results:
            return []
        bars = []
        for bar in all_results:
            bars.append({
                "t": int(bar["t"] / 1000),  # ms → unix seconds for LW Charts UTCTimestamp
                "o": _px(bar["o"]),
                "h": _px(bar["h"]),
                "l": _px(bar["l"]),
                "c": _px(bar["c"]),
                "v": int(_bar_volume(bar)),
            })
        # Return ALL paginated bars (the entire lookback window), not just
        # max_bars. The caller stores them in SQLite — limiting here means a
        # small `bars=10` call would store 10 rows, then a later `bars=200`
        # request reads those 10 rows from SQLite and never fetches more
        # history. The caller is responsible for slicing the response.
        return bars
    except Exception as _e:
        _note_provider_fault(_e)
        import logging as _log
        _log.getLogger(__name__).error(
            f"[bars] _fetch_intraday_massive {ticker} tf={tf} failed: {type(_e).__name__}: {_redact_log(str(_e))}"
        )
        return []


def _fetch_intraday_range(ticker: str, tf: str, from_ymd: str, to_ymd: str,
                          raise_errors: bool = False) -> list[dict]:
    """Deep intraday OHLCV for an EXPLICIT date range [from_ymd, to_ymd] (YYYY-MM-DD),
    split-ADJUSTED, next_url-paginated. Unlike `_fetch_intraday_massive` there is NO per-TF
    lookback ceiling — the date range IS the bound — so Replay Mode can reach the provider's
    intraday floor (~2003-09-10). `adjusted=true` means 2008 AAPL comes back at its ~$7
    split-adjusted level (matching the daily charts). tf='60' is resampled from 15-min via the
    canonical session-anchored bucketer (TradingView 9:30, 10:30 … grid), exactly like the live path —
    a direct /range/60/minute call would clock-hour-align and mismatch the rest of the app.
    Returns [] on error; the caller persists to SQLite + serves. Note: bars are adjusted AS OF
    FETCH TIME — a future split on the ticker would make cached pre-split intraday stale until
    re-fetched (same class the daily reconciliation worker handles for D/W/M)."""
    if tf == "60":
        src = _fetch_intraday_range(ticker, "15", from_ymd, to_ymd, raise_errors)   # 15m base, session-anchored
        return _resample_derived("60", src) if src else []
    if tf == "30":
        src = _fetch_intraday_range(ticker, "15", from_ymd, to_ymd, raise_errors)   # 15m base (native 30m is sparse)
        return _resample_derived("30", src) if src else []
    multiplier = int(tf)
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/{multiplier}/minute"
            f"/{from_ymd}/{to_ymd}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        all_results: list[dict] = []
        # 60 pages × 50000 = 3M bars — a decade of 1-min (~1M) fits with headroom; the
        # caller's date range + `bars` bound keep real requests far below this.
        for _page in range(60):
            data = client._get(url)
            all_results.extend(data.get("results") or [])
            next_url = data.get("next_url")
            if not next_url:
                break
            sep = "&" if "?" in next_url else "?"
            url = f"{next_url}{sep}apiKey={client._api_key}"
        if not all_results:
            return []
        return [
            {"t": int(bar["t"] / 1000), "o": _px(bar["o"]), "h": _px(bar["h"]),
             "l": _px(bar["l"]), "c": _px(bar["c"]), "v": int(_bar_volume(bar))}
            for bar in all_results
        ]
    except Exception as _e:
        if raise_errors:
            raise
        import logging as _log
        from api.services.log_redaction import redact as _redact
        _log.getLogger(__name__).error(
            f"[bars] _fetch_intraday_range {ticker} tf={tf} {from_ymd}..{to_ymd} "
            f"failed: {type(_e).__name__}: {_redact(str(_e))}"
        )
        return []


def _paginate_massive_aggs(client, url: str) -> list[dict]:
    """Follow Massive/Polygon ``next_url`` pagination, returning ALL raw
    result dicts across pages.

    Single-page responses silently truncate large windows (documented in
    _fetch_intraday_massive). The delta path needs the SAME loop or
    multi-day / multi-month gaps never fully backfill — the asymmetry
    that let cold-stale intraday entries appear "stuck" weeks back.
    """
    out: list[dict] = []
    for _page in range(20):  # 20 × 50000 safety cap, same as full-fetch
        data = client._get(url)
        out.extend(data.get("results") or [])
        nxt = data.get("next_url")
        if not nxt:
            break
        sep = "&" if "?" in nxt else "?"
        url = f"{nxt}{sep}apiKey={client._api_key}"
    return out


def _fetch_intraday_fmp(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from FMP (paid tier). Reliable, no rate limits."""
    import os, urllib.request
    fmp_key = os.environ.get("FMP_API_KEY", "")
    if not fmp_key:
        return []
    interval_map = {'1': '1min', '5': '5min', '15': '15min', '30': '30min', '60': '1hour'}
    interval = interval_map.get(tf)
    if not interval:
        return []
    try:
        url = f"https://financialmodelingprep.com/stable/historical-chart/{interval}?symbol={ticker.upper()}&apikey={fmp_key}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            import json as _json
            data = _json.loads(resp.read().decode("utf-8"))
        if not isinstance(data, list) or not data:
            return []
        # CRITICAL: FMP's `date` field is Eastern Time text ("2026-05-22 15:30:00"
        # = 3:30 PM ET), NOT UTC. The prior code did a naive strptime + .timestamp(),
        # which on a UTC-clock container (Railway default) interprets the wall-clock
        # as UTC and shifts every bar by the full ET-UTC offset (4h EDT / 5h EST).
        # Net effect when FMP fired as a fallback: the entire RTH session landed
        # in the wrong hourly buckets, the afternoon (13-16 ET) ended up labelled
        # as morning (09-12 ET), and the real afternoon timestamps held either
        # nothing or stale data — chart visibly "cut off at noon" on most stocks.
        # Anchor to ET explicitly so `.timestamp()` produces the correct UTC unix.
        _ET_FMP = _ZI("America/New_York")
        bars = []
        for bar in reversed(data):  # FMP returns newest first
            try:
                dt = datetime.strptime(bar["date"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=_ET_FMP)
                bars.append({
                    "t": int(dt.timestamp()),
                    "o": _px(bar["open"]),
                    "h": _px(bar["high"]),
                    "l": _px(bar["low"]),
                    "c": _px(bar["close"]),
                    # ⛔ `int(bar.get("volume", 0))` raised TypeError on a present-but-null
                    # volume — not caught below, so ONE null bar emptied the whole payload.
                    "v": _safe_volume(bar.get("volume")),
                })
            except (KeyError, ValueError, TypeError):
                continue
        from api.services import intraday_grid as _grid
        return _grid.normalize(tf, bars)[-max_bars:]
    except Exception as _e:
        _note_provider_fault(_e)
        import logging as _log
        _log.getLogger(__name__).warning(
            f"[bars] _fetch_intraday_fmp {ticker} tf={tf} failed: {type(_e).__name__}: {_e}"
        )
        return []


def _fetch_intraday_yfinance(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars from yfinance (fallback). Includes premarket + after-hours."""
    from api.services.yfinance_pool import fetch_history as _yf_fetch
    from concurrent.futures import TimeoutError as _YfTimeout
    config = _YF_CONFIG.get(tf)
    if not config:
        return []
    yf_sym = _YF_TICKERS.get(ticker.upper(), ticker.upper())
    try:
        # Bounded pool + hard timeout. A hung yfinance call would otherwise
        # hold the calling thread for minutes; the pool caps damage at
        # YFINANCE_POOL_WORKERS leaked threads max, and the timeout makes
        # this fetch_intraday_yfinance call return promptly so the caller's
        # fallback chain (Massive → FMP → yfinance) stays responsive.
        df = _yf_fetch(
            yf_sym,
            period=config["period"], interval=config["interval"],
            prepost=True,  # Include premarket (4-9:30 AM) + after-hours (4-8 PM)
            # ⛔ SAME BASIS AS MASSIVE (`adjusted=true` = SPLIT-only). yfinance's
            # default `auto_adjust=True` also back-adjusts DIVIDENDS, so a fallback
            # answer landed on a different price scale than the Massive rows around
            # it — a small cliff at every seam. Yahoo's raw OHLC is split-adjusted.
            auto_adjust=False,
        )
        if df is None or df.empty:
            return []
        # Do NOT strip the timezone — it's the same trap that bit FMP.
        # A naive Timestamp.timestamp() interprets wall-clock in the host's
        # local TZ; on Railway (UTC) that shifts every bar by the full ET
        # offset. For tz-aware Timestamps, .timestamp() returns the proper
        # UTC unix-seconds regardless of host TZ. If yfinance ever returns
        # naive data (some edge tickers), assume ET — that matches Yahoo's
        # documented intraday convention for US equities.
        _ET_YF = _ZI("America/New_York")
        bars = []
        for ts, row in df.iterrows():
            if getattr(ts, "tzinfo", None) is None:
                # pandas Timestamp lacks `.replace`; use tz_localize on the value
                ts = ts.tz_localize(_ET_YF)
            try:
                o, h, l, c = (float(row["Open"]), float(row["High"]),
                              float(row["Low"]), float(row["Close"]))
            except (KeyError, TypeError, ValueError):
                continue
            if any(x != x for x in (o, h, l, c)):   # NaN row (Yahoo pads gaps): skip, never crash
                continue
            bars.append({
                "t": int(ts.timestamp()),  # unix seconds (UTC), tz-correct
                "o": _px(o),
                "h": _px(h),
                "l": _px(l),
                "c": _px(c),
                # ⛔ `int(row.get("Volume", 0))` raised ValueError on a NaN volume and the
                # outer except emptied the WHOLE payload over one padded row.
                "v": _safe_volume(row.get("Volume")),
            })
        # ⛔ YAHOO'S LIVE ROW IS STAMPED AT THE LAST TRADE, NOT THE BUCKET START. While an
        # interval is forming Yahoo returns it as a separate last row (e.g. 16:35:50 on 5m);
        # yfinance folds it in only when the bucket already has a row, which thin
        # post-market buckets often lack. Persisted add-only, it sat next to the Massive
        # 16:35:00 row as an extra candle (prod 2026-11-10). Fold it onto the grid here.
        from api.services import intraday_grid as _grid
        bars = _grid.normalize(tf, bars)
        return bars[-max_bars:]
    except Exception as _e:
        _note_provider_fault(_e)
        import logging as _log
        _log.getLogger(__name__).warning(
            f"[bars] _fetch_intraday_yfinance {ticker} tf={tf} failed: {type(_e).__name__}: {_e}"
        )
        return []


def _is_intraday_stale(bars: list[dict], max_age_days: int = 5) -> bool:
    """Check if intraday bars are stale (last bar older than max_age_days).

    A FRESHNESS FLOOR, not a split detector: it catches a series that STOPPED
    (e.g. a renamed/relisted symbol whose Massive history ends months ago). A
    split inside a fresh payload never trips it, adjusted or not -- measured in
    tests/test_intraday_split_is_not_staleness.py (TERM-055). Split detection is
    `bars_sanitize.unadjusted_splits` (D/W/M), asked of an intraday series' per-session
    closes by `bars_sanitize.intraday_unadjusted_splits` (TERM-055) -- which DETECTS an
    intraday cliff for the adjustment-basis label; nothing heals one on the serve path.
    5-day window handles 3-day holiday weekends (Thu close → Mon = ~4 days).
    """
    if not bars:
        return True
    last_ts = bars[-1]["t"]  # unix seconds
    age_days = (datetime.utcnow().timestamp() - last_ts) / 86400
    return age_days > max_age_days


# ── Which provider answered the last intraday fetch ON THIS THREAD ────────────
# `fetch_with_validation` returns a bare bar list, and every persist site runs on the
# same thread right after the fetch — so a thread-local is the narrowest way to let
# the store tell a Massive answer from a fallback one without changing the return
# shape every caller (and test double) relies on.
_intraday_src = _threading.local()

#: Sources whose intraday answer is a FALLBACK: shallower (yfinance 1m = 7 days) and/or
#: a different session coverage (FMP RTH-only). Never "the whole history".
_FALLBACK_INTRADAY_SOURCES = frozenset({"fmp", "yfinance"})


def _set_intraday_source(source) -> None:
    _intraday_src.name = source


def last_intraday_source():
    """'massive' | 'fmp' | 'yfinance' | None for the latest `fetch_with_validation`
    on the CALLING thread (None = nothing chosen / no fetch yet)."""
    return getattr(_intraday_src, "name", None)


def _last_intraday_fetch_was_fallback() -> bool:
    return last_intraday_source() in _FALLBACK_INTRADAY_SOURCES


def _payload_has_extended_hours(payload) -> bool:
    """True when ANY bar starts outside 09:30-16:00 ET (pre- or post-market).

    A multi-session Massive / yfinance(prepost) answer for any traded name carries
    04:00-20:00 bars; an FMP answer with none is the RTH-only series."""
    et = _ZI("America/New_York")
    if isinstance(payload, dict):
        payload = payload.get("bars")
    if not isinstance(payload, (list, tuple)):
        return True               # unknown shape: abstain (never demote on a guess)
    for b in payload:
        try:
            dt = datetime.fromtimestamp(int(b["t"]), et)
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            return True           # unreadable bar: abstain
        m = dt.hour * 60 + dt.minute
        if m < 570 or m >= 960:
            return True
    return False


def _put_fetched_intraday(ticker: str, tf: str, bars: list) -> int:
    """Persist a FULL intraday fetch. A fallback answer is ADD-ONLY: it may fill rows
    the store lacks but never overwrites a Massive row (different volume basis, and an
    RTH-only FMP series would otherwise replace good bars with its own)."""
    if _last_intraday_fetch_was_fallback():
        return _sqlite.put_bars(ticker, tf, bars, date_tf=False, on_conflict="ignore")
    return _sqlite.put_bars(ticker, tf, bars, date_tf=False)


def _payload_last_session_yyyymmdd(payload) -> int:
    """ET date (YYYYMMDD int) of the last bar in an intraday payload, or 0.

    Used to decide whether a validated payload is fresh enough (reaches the
    expected latest session) or merely valid-but-lagging — the signal that
    drives fetch_with_validation's staleness escalation."""
    if not payload:
        return 0
    try:
        dt = datetime.fromtimestamp(payload[-1]["t"], tz=_ZI("America/New_York"))
        return int(dt.strftime("%Y%m%d"))
    except Exception:
        return 0


def _last_known_close(ticker: str, tf: str) -> float | None:
    """Return the most recent close stored in SQLite for (ticker, tf), or None.

    Used as the seeding ``prior_close`` for ``fetch_with_validation`` so the
    very first bar of a fresh fetch can be sanity-checked against history.
    Defensive: any failure (table missing, locked DB, etc.) returns None.
    """
    try:
        rows = _sqlite.get_bars(ticker.upper(), tf, 1)
        if rows:
            # rows = [(ts, o, h, l, c, v)] — index 4 is close.
            return float(rows[0][4])
    except Exception:
        pass
    return None


def _fetch_intraday(ticker: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch intraday bars — routes the Massive → FMP → yfinance source chain
    through ``fetch_with_validation`` so corrupt primary payloads automatically
    fall through to the next source instead of being persisted.

    tf='60' is special: internally uses 15-min bars resampled to the
    ``SIXTY_MIN_GRID`` (TradingView: 9:30-10:30 ... 15:30-16:00) so the chart
    matches TradingView in RTH mode. tf='30' is likewise resampled from 15-min. We still resample
    here, but the underlying 30-min fetch goes through fetch_with_validation
    (which itself iterates Massive → FMP → yfinance with per-bar validation).
    """
    import logging as _log
    _logger = _log.getLogger(__name__)
    _set_intraday_source(None)    # never inherit a previous fetch's source on this thread
    prior_close = _last_known_close(ticker, tf)
    # Latest session that should have bars — drives staleness escalation so a
    # valid-but-lagging Massive payload yields to a fresher FMP/yfinance one.
    expected_session = _expected_latest_session_yyyymmdd()

    if tf == "60":
        # Resample hourly from 15-MINUTE bars, NOT 30-minute. Massive's native
        # 30-min aggregate is intermittently sparse for even the most liquid names
        # — it drops individual half-hour bars that the 5m/15m feeds carry in full
        # (verified 2026-07-14: QQQ 07-08 14:00/15:00, 07-14 12:00/14:00/15:00,
        # etc.). Because the hourly bar is a resample of those, a single dropped
        # 30m half-hour silently deletes the ENTIRE hourly candle. 15m is complete
        # across those windows AND deep enough (1000-day lookback ceiling vs 5m's
        # 365d) so there is no hourly-history regression. The lookback formula in
        # _fetch_intraday scales bars_per_day with the TF, so src=max_bars*4 of
        # 15m spans the identical calendar window that max_bars*2 of 30m did. 60m
        # is reconciliation-EXEMPT (session-anchored ≠ Polygon clock-hour), so
        # rebuilding it from a finer feed never fights the heal worker.
        src = max_bars * 4
        # fetch_with_validation handles the Massive → FMP → yfinance chain for the
        # 15-min source, applying per-bar validation at each hop.
        bars_src = fetch_with_validation(ticker, "15", src, prior_close=prior_close, expected_session=expected_session)
        if bars_src and not _is_intraday_stale(bars_src):
            out = _resample_derived("60", bars_src)[-max_bars:]
            _logger.warning(
                f"[bars-resample] {ticker} tf=60 src={src} validated_15m={len(bars_src)} resampled_to={len(out)}"
            )
            return out
        # Validation pipeline returned None or stale data. Do NOT fall back
        # to raw Massive — that would re-admit the exact corrupt payload
        # Plan 1's validation gate was built to reject (e.g. QQQ 6.55
        # phantom bars). Staleness checks last-bar age, not OHLC validity,
        # so corrupt-but-recent bars would silently get persisted to SQLite
        # and the in-memory cache. Return empty instead.
        _logger.warning(
            "[bars] %s 15m(for 60m): all sources failed validation, returning empty", ticker
        )
        return []

    if tf == "30":
        # Resampled from 15-MINUTE bars for the same reason as tf=60 above:
        # Massive's native 30-min aggregate is intermittently sparse (it drops
        # half-hour bars the 15m feed carries). 30 divides the 09:30 open, so the
        # clock floor IS TradingView's 30m grid on both session views.
        bars_src = fetch_with_validation(ticker, "15", max_bars * 2, prior_close=prior_close, expected_session=expected_session)
        if bars_src and not _is_intraday_stale(bars_src):
            return _resample_derived("30", bars_src)[-max_bars:]
        _logger.warning(
            "[bars] %s 15m(for 30m): all sources failed validation, returning empty", ticker
        )
        return []

    # 1/5/15-min: validating fetch chain
    validated = fetch_with_validation(ticker, tf, max_bars, prior_close=prior_close, expected_session=expected_session)
    if validated and not _is_intraday_stale(validated):
        return validated

    # All clean sources rejected — do NOT fall back to raw Massive. That
    # would re-admit the exact corrupt payload Plan 1's validation gate was
    # built to reject (e.g. QQQ 6.55 phantom bars). Staleness checks
    # last-bar age, not OHLC validity, so a corrupt-but-recent payload
    # would silently get persisted to SQLite and the in-memory cache.
    # Return empty so the cache is not poisoned.
    _logger.warning(
        "[bars] %s tf=%s: all sources failed validation, returning empty", ticker, tf
    )
    return []


# ── Delta-fetch helpers (tiny payloads — only new bars since last stored ts) ──

def _massive_raw_to_iso(raw, ticker: str | None = None) -> list[dict]:
    """Convert raw Massive aggs (t = unix ms) to our normalized daily
    format (t = ISO date string).

    ⛔ Only NYSE sessions (2026-11-11). The provider's daily aggregate carries its own
    date, and on 2026-11-07 it carried a SATURDAY for a handful of names; copied
    through verbatim it was stored, drawn as an extra candle and summed into the week.
    The key rule has one owner: `date_bar_keys`."""
    from api.services.date_bar_keys import session_daily
    out = []
    for bar in raw:
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        out.append({
            "t": dt.strftime("%Y-%m-%d"),
            "o": _px(bar["o"]), "h": _px(bar["h"]),
            "l": _px(bar["l"]), "c": _px(bar["c"]),
            "v": int(_bar_volume(bar)),
        })
    return session_daily(out, ticker)


# Hard deadline for the REQUEST-path yfinance daily tail-fill. 3.5s bounds a cold
# chart open (Massive-time + this) instead of the 20s a slow Yahoo call could
# take; the tail heals on the next poll / nightly warm. Env-tunable.
_REQUEST_YF_DAILY_TIMEOUT = float(_os.environ.get("BARS_REQUEST_YF_TIMEOUT", "3.5"))


def _fill_daily_tail_with_yf(ticker: str, massive_iso: list[dict]) -> list[dict]:
    """Fill the lagging recent tail of a Massive daily series from yfinance.

    Massive's daily aggregates lag several sessions for thin / long-tail
    names (recent SPACs, small caps — FJET froze 4 sessions back). When the
    newest Massive bar is behind the expected latest trading session, pull
    yfinance and merge: Massive wins any overlapping date (its re-fetched
    evolving bar stays authoritative), yfinance only supplies sessions
    Massive lacks. yfinance is consulted ONLY when stale, so fresh tickers
    pay ZERO latency — this is the single chokepoint that keeps every D/W/M
    path (daily/weekly/monthly · delta + cold full-fetch) accurate.

    ``massive_iso`` is normalized daily bars (t = ISO date). Returns the
    merged, date-sorted list (bounded by the Massive window's oldest bar so
    it stays a recent-tail fill, not a full-history replacement). Callers
    slice/filter as needed.
    """
    massive_max = max((int(b["t"].replace("-", "")) for b in massive_iso), default=0)
    if massive_iso and massive_max >= _expected_latest_session_yyyymmdd():
        return massive_iso  # fresh — no fallback, no yfinance call
    try:
        # REQUEST PATH: cap the Yahoo call hard. A Massive-lagging thin ticker
        # (recent SPAC / illiquid small-cap) otherwise blocked a cold chart open
        # up to 20s on this synchronous tail-fill. With the cap, a slow Yahoo call
        # simply yields Massive-only bars for the first paint (fresh minus the few
        # sessions Massive lags); the missing tail heals on a subsequent poll (the
        # delta path re-runs this) or the nightly deep warm. Live price still
        # overlays the current bar. The nightly warm / index paths keep the 20s
        # default by calling _fetch_daily_yf directly.
        yf_daily = _fetch_daily_yf(ticker, timeout=_REQUEST_YF_DAILY_TIMEOUT)
    except Exception:
        yf_daily = []
    if not yf_daily:
        return massive_iso
    lower = min((int(b["t"].replace("-", "")) for b in massive_iso), default=0)
    by_date = {
        b["t"]: b for b in yf_daily
        if int(b["t"].replace("-", "")) >= lower
    }
    for b in massive_iso:
        by_date[b["t"]] = b  # Massive wins overlap
    return [by_date[k] for k in sorted(by_date)]


def _recent_daily_iso(ticker: str, days: int) -> list[dict]:
    """Recent daily bars (t = ISO) over the last ``days`` calendar days from
    Massive, with a yfinance tail-fill when Massive lags. Shared by the
    daily/weekly/monthly delta paths."""
    from api.services.massive import get_agg_bars
    from_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")
    massive_iso = _massive_raw_to_iso(get_agg_bars(ticker, from_date, to_date), ticker)
    return _fill_daily_tail_with_yf(ticker, massive_iso)


def _delta_daily(ticker: str, last_ts: int) -> list[dict]:
    """Recent daily bars at-or-newer than ``last_ts`` (YYYYMMDD int).

    Uses ``>=`` so today's still-evolving bar (whose close + high/low keep
    updating intraday) gets re-fetched and INSERT OR REPLACE-d on every
    call. (Earlier `>` left today's bar frozen at the OPEN print — wrong
    closes on D/W/M; the 5-min SWR TTL handles flicker, commit 8517729.)
    Massive-stale thin tickers are healed via the yfinance tail-fill inside
    ``_recent_daily_iso`` (FJET fix, 2026-06-12)."""
    daily = _recent_daily_iso(ticker, 10)
    return [b for b in daily if int(b["t"].replace("-", "")) >= last_ts]


def _delta_weekly(ticker: str, last_ts: int) -> list[dict]:
    """Recent daily bars resampled to weekly, at-or-newer than ``last_ts``
    (>=). The in-progress weekly bar (week-to-date OHLC) keeps updating;
    without >= the cached W bar freezes at first-fetch. Massive-stale thin
    tickers are healed via the yfinance tail-fill in ``_recent_daily_iso``."""
    daily = _recent_daily_iso(ticker, 14)
    return [b for b in _resample_weekly_iso(daily) if int(b["t"].replace("-", "")) >= last_ts]


def _delta_monthly(ticker: str, last_ts: int) -> list[dict]:
    """Recent daily bars resampled to monthly, at-or-newer than ``last_ts``
    (>=). Current month's bar keeps evolving; without >= it freezes at
    first-fetch. Massive-stale thin tickers are healed via the yfinance
    tail-fill in ``_recent_daily_iso``."""
    daily = _recent_daily_iso(ticker, 60)
    return [b for b in _resample_monthly_iso(daily) if int(b["t"].replace("-", "")) >= last_ts]


#: ⭐ THE 60-MINUTE GRID POLICY — the one server-side switch (client twin:
#: ``app/src/components/chart/barTime.js`` ``SIXTY_MIN_GRID_BY_SESSION``).
#: TradingView builds intraday bars from the SESSION START (vendor captures:
#: ``tests/fixtures/vendor/harness/vw-time-session-spy-60-{rth,ext}-2026-09-28.json``):
#:   "rth" — RTH anchors at the 09:30 open: 09:30, 10:30 … 15:30 (a 30-min last
#:           bar; 12:30 on a 13:00 half-day). Pre-market is clock hours with the
#:           09:00 bar cut at 09:30; post-market is clock hours. RTH-only view ==
#:           TradingView RTH, bar for bar. (Client name: 'session'.)
#:   "eth" — plain ET clock hours 04:00 … 19:00 == TradingView's 04:00-20:00
#:           extended-hours chart (the 09:00 bar spans the open). (Client: 'clock'.)
#: The bucket rule itself lives in ``bar_rollup.tv_bucket_bounds`` — the live
#: stream's helper — so REST and stream are one function. The stored tf=60
#: series is ONE grid (this one); ``_session_resample_hourly(.., grid="eth")``
#: builds the other from the same 15m source on demand.
SIXTY_MIN_GRID = "rth"
_GRID_TO_SESSION = {"rth": "rth", "eth": "eth", "session": "rth", "clock": "eth"}


def bucket_60_et_unix_seconds(t_utc: int, grid: str | None = None) -> int:
    """Canonical ET-anchored 60-min bucket function. Returns the unix-seconds
    timestamp of the hourly bucket that contains ``t_utc``.

    Public + top-level on purpose: the REST resample/delta/heal paths here, the
    WebSocket rollup (``bar_rollup``), the reconciliation companion heal, the
    alert bar-close lane and the gap audit all call it, so none can drift and
    plant duplicate candles at neighbouring ``ts`` (``INSERT OR REPLACE`` can't
    heal that). It DELEGATES to ``bar_rollup.tv_bucket_start`` — the live
    stream's TradingView helper — with ``grid`` (default ``SIXTY_MIN_GRID``):
      rth — 09:30 <= t < close: 09:30 + whole hours (last bar 15:30-16:00, or
            12:30-13:00 on a half-day); before 09:30 the clock hour (09:00-09:29
            ends at the open); from the close, clock hours.
      eth — the ET clock hour.
    DST-safe: the zone is resolved per instant (``ZoneInfo``)."""
    from api.services.bar_rollup import tv_bucket_start
    session = _GRID_TO_SESSION.get(grid or SIXTY_MIN_GRID, "rth")
    return tv_bucket_start(int(t_utc) * 1000, "60", session) // 1000


def _resample_minutes(bars_src: list[dict], minutes: int) -> list[dict]:
    """Aggregate finer bars into ``minutes``-wide buckets floored on the ET clock
    (whole-hour ET offsets make the UTC floor the ET floor; 30 divides the
    09:30 open, so this IS the TradingView 30m grid on every session view)."""
    step = int(minutes) * 60
    return _aggregate_buckets(bars_src, lambda t: int(t) // step * step)


def _aggregate_buckets(bars_src: list[dict], bucket) -> list[dict]:
    groups: dict[int, list[dict]] = {}
    for bar in bars_src:
        groups.setdefault(bucket(bar["t"]), []).append(bar)
    result = []
    for bkt_t in sorted(groups):
        grp = sorted(groups[bkt_t], key=lambda b: b["t"])
        result.append({
            "t": bkt_t,
            "o": grp[0]["o"],
            "h": max(b["h"] for b in grp),
            "l": min(b["l"] for b in grp),
            "c": grp[-1]["c"],
            "v": sum(int(b.get("v") or 0) for b in grp),
        })
    return result


def _session_resample_hourly(bars_src: list[dict], grid: str | None = None) -> list[dict]:
    """Resample sub-hourly bars (5/15/30-min) to 60-min bars on ``grid``
    (default ``SIXTY_MIN_GRID`` — see ``bucket_60_et_unix_seconds``).

    Source-granularity-agnostic: every bar is placed by
    ``bucket_60_et_unix_seconds(bar["t"])``, so feeding 15-min bars yields the
    SAME hourly candles as feeding 30-min bars — but without the gaps Massive's
    native 30-min aggregate intermittently leaves (see the tf=="60" fetch path).
    Bars must be ascending; unordered input still works (each bucket re-sorts).

    "rth" grid, regular day: 04:00 … 08:00, 09:00 (30 min), 09:30, 10:30 …
    15:30 (30 min), 16:00 … 19:00. A null source volume counts as 0.
    """
    return _aggregate_buckets(bars_src, lambda t: bucket_60_et_unix_seconds(t, grid))


def rebuild_sixty_min_grid(ticker: str) -> dict:
    """Re-derive ``ticker``'s stored 60m series on the TradingView grid from its OWN
    stored 15m / 30m rows — in process, NO provider call (2026-11-10 grid move).

    Per ET day that the old 60m series covered, the finer source with more coverage
    wins (15m, else 30m: native 30m is :00/:30-aligned, so pairing it onto the
    09:30/10:30 grid is exact; a half-hour it dropped thins that hour, never deletes
    it). A day neither source covers is dropped from 60m — it is the wrong grid and
    cannot be split — and is refilled by the ordinary partial-depth fetch the next
    time a chart asks for that depth (lazy, per viewed ticker, never a herd).
    Atomic: readers see the old set or the rebuilt one."""
    tkr = ticker.upper()
    et = _ZI("America/New_York")
    rows60 = _sqlite.get_bars_since(tkr, "60", -(1 << 62))
    if not rows60:
        return {"days": 0, "rebuilt": 0, "dropped_days": 0}

    def _day(ts: int) -> int:
        d = datetime.fromtimestamp(int(ts), et)
        return d.year * 10000 + d.month * 100 + d.day

    days = {_day(r[0]) for r in rows60}
    lo = int(rows60[0][0]) - 86400

    def _by_day(tf: str) -> dict:
        out: dict[int, list[dict]] = {}
        for ts, o, h, l, c, v in _sqlite.get_bars_since(tkr, tf, lo):
            if o is None or h is None or l is None or c is None:
                continue
            dd = _day(ts)
            if dd in days:
                out.setdefault(dd, []).append({"t": int(ts), "o": o, "h": h, "l": l, "c": c, "v": v})
        return out

    src15, src30 = _by_day("15"), _by_day("30")
    rebuilt: list[dict] = []
    dropped = 0
    for dd in sorted(days):
        a, b = src15.get(dd, []), src30.get(dd, [])
        src = a if len(a) * 15 >= len(b) * 30 and a else b
        if not src:
            dropped += 1
            continue
        rebuilt.extend(_session_resample_hourly(src))
    _sqlite.replace_ticker_tf_rows(tkr, "60", rebuilt)
    _sqlite._invalidate_60m_caches(tkr)
    return {"days": len(days), "rebuilt": len(rebuilt), "dropped_days": dropped}


# Trailing re-aggregation window for intraday delta fetches (seconds). The old
# `>= last_ts` filter only ever corrected the NEWEST bar — an interior bar
# stored mid-formation (partial volume / wrong close) froze forever once a newer
# bar landed on top, because last_ts (= MAX(ts)) advanced past it and it was
# never re-requested. Re-emitting a trailing window instead heals those buried
# partials: put_bars is INSERT OR REPLACE, the full gap_days window is already
# fetched, and closed bars carry authoritative Massive values (WS still owns the
# live-tick display), so re-writing the recent window is always safe. 8h covers
# a full RTH session + buffer; deeper/cross-session poison is handled by the
# reconciliation worker + one-time heal. Env-tunable.
_DELTA_HEAL_WINDOW_SECONDS = int(_os.environ.get("BARS_DELTA_HEAL_WINDOW_SECONDS", str(8 * 3600)))

# Gap-fill lookback (days). The trailing heal window above only RE-WRITES recent
# bars; it never restores an interior bar that was NEVER stored (first fetched
# mid-session, or dropped) once that hole ages past the heal window — such holes
# froze permanently (verified 2026-07-14: QQQ 30m 07-08 14:30 present at Massive
# but absent from SQLite; the delta re-fetched it but the `>= heal_floor` filter
# discarded it). Gap-fill diffs the freshly-fetched window against what's stored
# and emits, IN ADDITION to the trailing window, any bar Massive returns that we
# don't have. It CANNOT fabricate: a bar Massive omits (e.g. a no-trade minute)
# is simply never added, so there are no false positives. Surgical — on already-
# complete data nothing extra is written, so it cannot worsen write-lock
# contention. Per-TF caps bound the extra fetch span (1m is heavy + rarely viewed
# deep; coarse TFs are cheap to scan a fortnight of). Env-tunable.
_DELTA_GAPFILL_DAYS = int(_os.environ.get("BARS_DELTA_GAPFILL_DAYS", "14"))
# Per-TF fetch-span cap. The coarse TFs (15/30/60) are where Massive's aggregate
# dropped bars AND are cheap to re-scan a fortnight of (≤~900 bars); the fine TFs
# (1/5) were already ~99% complete and are expensive to re-scan every poll, so
# keep their gap-fill window short (they still heal via the trailing window +
# their own coarse-TF companions). 60m fetches 15m, so it tracks the 15m span.
_GAPFILL_CAP_BY_TF = {"1": 2, "5": 5, "15": 14, "30": 14, "60": 14}


def _delta_keep_bar(ts: int, heal_floor: int, stored_ts: "set | None") -> bool:
    """A re-fetched intraday bar is kept if it's inside the trailing re-aggregation
    window (heal recent partials) OR it is missing from storage (restore a hole).
    `stored_ts is None` disables gap-fill (kill-switch) → exact pre-2026-07-14
    trailing-only behaviour. Pure + module-level so it's unit-testable."""
    if stored_ts is None:
        return ts >= heal_floor
    return ts >= heal_floor or ts not in stored_ts


def _delta_intraday(ticker: str, tf: str, last_ts: int, status: "dict | None" = None,
                    tail_only: bool = False) -> list[dict]:
    """Fetch intraday bars within a trailing heal window of last_ts (unix sec),
    PLUS gap-fill any interior bar missing from storage.

    NOT a strict delta: re-aggregates the last _DELTA_HEAL_WINDOW_SECONDS so
    interior partial bars get corrected (INSERT OR REPLACE), not just the newest
    one, AND restores holes anywhere in the (bounded) gap-fill window that were
    never stored. See _DELTA_HEAL_WINDOW_SECONDS / _DELTA_GAPFILL_DAYS."""
    # 🔴 A COLD TICKER MUST NOT ASK FOR EVERYTHING SINCE 1969. `last_ts == 0`
    # means "nothing stored for this (ticker, tf)", and feeding that straight into
    # the subtraction below yields ~20,600 days — a `from_date` of 1969-12-30 that
    # Massive rejects with a flat 400. The caller retries, so it becomes a HOT LOOP:
    # measured 2026-08-10 at 139 rejected requests in a single log window across
    # five semiconductor names a member had open, burning vendor quota and — worse —
    # flooding the log that an operator reads during an incident. That flooding is
    # not cosmetic: it is what made this morning's real outage hard to see.
    # ⛔ The `last_ts` guard exists ONE LINE BELOW for `gapfill_on`, so the cold case
    # was known — it just was not applied to the window that gets FETCHED.
    _COLD_INTRADAY_DAYS = 5
    if not last_ts:
        gap_days = _COLD_INTRADAY_DAYS
    else:
        gap_days = max(2, int((_time.time() - last_ts) / 86400) + 2)
    gapfill_on = _DELTA_GAPFILL_DAYS > 0 and last_ts  # cold (last_ts==0) never gap-fills
    if tail_only and last_ts:
        # ⭐⭐ TAIL-FIRST (2026-11-10): the request path asks for ONLY the missing tail
        # — from the ET session date of the newest stored bar through today — and no
        # interior gap-fill scan. The full window (+2 day buffer, widened to the
        # per-TF gap-fill reach: 2d of 1m, 5d of 5m, 14d of 15/30/60) is what made a
        # first paint wait out the 2.5 s deadline and serve a tail hours or a session
        # behind (`sd-deadline` / `delta-deadline`). The gap-fill still runs, in the
        # background, right after the tail lands (`_kick_tail_gapfill`).
        # `from_date = utcnow - gap_days` lands exactly ON that ET date, so the whole
        # session of the stored tail is re-read (the 60m resample needs it) and
        # nothing between the tail and now can be skipped.
        try:
            _last_et_day = datetime.fromtimestamp(int(last_ts), _ZI("America/New_York")).date()
            gap_days = max(0, (datetime.utcnow().date() - _last_et_day).days)
        except Exception:                 # noqa: BLE001 — fall back to the full window
            pass
        else:
            gapfill_on = False
    if gapfill_on:
        # Widen the fetched window to the gap-fill reach so interior holes older
        # than the trailing heal window still get restored (bounded per-TF).
        gap_days = max(gap_days, min(_DELTA_GAPFILL_DAYS, _GAPFILL_CAP_BY_TF.get(tf, 14)))
    # Floor below which we don't bother re-emitting (already-final history).
    # last_ts==0 (cold) → floor 0 → return everything fetched (full populate).
    heal_floor = max(0, last_ts - _DELTA_HEAL_WINDOW_SECONDS) if last_ts else 0
    from_date = (datetime.utcnow() - timedelta(days=gap_days)).strftime("%Y-%m-%d")
    # ⛔ "2 CALENDAR DAYS" IS NOT "TODAY AND YESTERDAY'S SESSION". On a Monday (or the
    # day after a holiday) the 1m cap of 2 days reached back to Saturday, so a hole in
    # FRIDAY's 1m session was outside every heal window and froze. Always reach the
    # PRIOR TRADING SESSION, whatever the calendar says.
    if gapfill_on:
        from_date = min(from_date, _prior_session_iso())
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")

    # Timestamps already stored in (roughly) the fetched window. A re-fetched bar
    # NOT in this set is a genuine hole to restore. One indexed, lock-free read.
    # None = gap-fill disabled (kill-switch or cold) → trailing-only behaviour.
    stored_ts: "set | None" = None
    if gapfill_on:
        _window_start = min(int(_time.time()) - gap_days * 86400 - 86400,
                            int(datetime.strptime(from_date, "%Y-%m-%d").timestamp()) - 86400)
        try:
            stored_ts = {int(r[0]) for r in _sqlite.get_bars_since(ticker, tf, _window_start)}
        except Exception:  # noqa: BLE001 — a read failure just disables gap-fill this cycle
            stored_ts = None

    # 60-min: fetch 15-min delta and resample to session-aligned hourly. 15m (not
    # 30m) because Massive's native 30-min aggregate intermittently drops interior
    # half-hour bars, which silently deletes whole hourly candles on resample; 15m
    # carries them. Mirrors the cold-fetch tf=="60" path above — keep both in sync.
    if tf in ("30", "60"):
        try:
            # ⛔ THE BASE MUST STAY CONTIGUOUS (review #1090 F3). The window above is the
            # TARGET's; writing it into a 15m store whose tail is OLDER than the window
            # start would advance the 15m tail over a never-fetched stretch — an
            # interior hole the 15m tail repair can no longer see. So the fetch starts
            # at the stored base's own tail session when that is older (bounded by the
            # 15m gap-fill reach); a base further behind is not written here (its own
            # repair owns it) and the target is derived from this fetch alone.
            from_date, persist_base = _base_contiguous_window(ticker, from_date)
            client = _get_client()
            url = (
                f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/15/minute"
                f"/{from_date}/{to_date}"
                f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
            )
            # ⛔ Per-bar parse: `int(b.get("v", 0))` raised on a null volume and lost
            # the WHOLE 60m delta (see `_safe_volume`).
            bars_src = [r for r in map(_massive_bar_row, _paginate_massive_aggs(client, url))
                        if r is not None]
            # ⭐ ONE DERIVATION PATH (2026-11-11): the fetched 15m IS the base series —
            # persist it to the 15m store, then derive the target from the STORED base
            # with the same function the local-first repair uses
            # (`_derive_from_stored_base`). The derived store can therefore never hold
            # a bucket its own base does not explain, and the next 30m/60m repair finds
            # the base already current instead of re-asking the provider.
            resampled = []
            if bars_src and persist_base and not _is_intraday_stale(bars_src):
                _sqlite.put_bars(ticker, _DERIVED_BASE_TF, bars_src, date_tf=False)
                resampled = _derive_from_stored_base(
                    ticker, tf, _derived_bucket_start(tf, bars_src[0]["t"]))
            elif bars_src:
                resampled = _resample_derived(tf, bars_src)
            # Filter shifted from strict > to >= on 2026-05-23. Original concern
            # was REST stepping on the WS-painted live bar; that's now mooted by
            # Phase 4's bar_broadcaster owning the developing-bar timeline AND
            # the canonical ET-anchored bucket function shared between REST +
            # WS (Step 3 / commit 595edc2). With >=, the boundary hourly bucket
            # gets RE-AGGREGATED and overwritten on every delta — heals the
            # "stored partial in-progress bar" bug where a chart loaded mid-hour
            # froze the bucket at half-bar values that the prior > filter could
            # never update (Step 4).
            out = [b for b in resampled
                   if _delta_keep_bar(b["t"], heal_floor, stored_ts)]
            if status is not None:
                status["ok"] = True   # the provider ANSWERED (an empty answer included)
            return out
        except Exception as _e:
            import logging as _log
            _log.getLogger(__name__).error(
                f"[bars] _delta_intraday({tf}-min from 15m) {ticker} failed: {type(_e).__name__}: {_redact_log(str(_e))}"
            )
            return []

    multiplier = int(tf)
    # Scale lookback to cover the full gap since last stored bar + 2-day buffer.
    # A fixed 2-day window misses bars when a user hasn't opened the app in days.
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{to_polygon_symbol(ticker)}/range/{multiplier}/minute"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=50000&apiKey={client._api_key}"
        )
        new = []
        for bar in _paginate_massive_aggs(client, url):
            row = _massive_bar_row(bar)
            if row is None:
                continue          # one malformed agg must not drop the whole delta
            ts = row["t"]
            # `>=` (was strict `>`) so the most recent stored bar gets
            # re-fetched and updated with Massive's authoritative values.
            # This heals the "partial in-progress bar got stored, then
            # strict-> filter prevented updates" bug for 1/5/15/30 min too.
            # WS still wins on display via the per-minute AM broadcaster;
            # REST's update only changes the persisted SQLite row, which
            # bar_broadcaster doesn't compete on for in-progress data.
            # `_delta_keep_bar` also restores interior holes (missing from
            # stored_ts) anywhere in the fetched window, not just the tail.
            if _delta_keep_bar(ts, heal_floor, stored_ts):
                new.append(row)
        if status is not None:
            status["ok"] = True   # the provider ANSWERED (an empty answer included)
        return new
    except Exception as _e:
        import logging as _log
        _log.getLogger(__name__).error(
            f"[bars] _delta_intraday {ticker} tf={tf} failed: {type(_e).__name__}: {_redact_log(str(_e))}"
        )
        return []


# ── yfinance daily negative-lookup cache ────────────────────────────────────
# When Yahoo rate-limits the pod's IP, EVERY _fetch_daily_yf returns empty
# ("possibly delisted; no timezone found") -- including live tickers. The worker's
# full-universe warm re-runs every 5 min with no positive freshness gate to stop
# it, so the same ~3,685 doomed calls fire every cycle and keep the IP throttled.
# Record a per-ticker failure and skip yfinance for an exponentially-growing
# backoff window (genuinely-delisted tickers stretch toward the cap; a throttle
# clears on its own once the window lapses). A later success clears the entry.
_YF_DAILY_FAIL: dict[str, tuple[float, int]] = {}
_YF_DAILY_FAIL_LOCK = _threading.Lock()
_YF_FAIL_BASE_SECS = 1800        # 30 min after the 1st failure
_YF_FAIL_MAX_SECS = 6 * 3600     # capped at 6h


def _yf_daily_in_backoff(ticker_up: str) -> bool:
    with _YF_DAILY_FAIL_LOCK:
        rec = _YF_DAILY_FAIL.get(ticker_up)
        if not rec:
            return False
        last, n = rec
        wait = min(_YF_FAIL_BASE_SECS * (2 ** max(0, n - 1)), _YF_FAIL_MAX_SECS)
        return (_time.monotonic() - last) < wait


def _yf_daily_record_fail(ticker_up: str) -> None:
    with _YF_DAILY_FAIL_LOCK:
        _, n = _YF_DAILY_FAIL.get(ticker_up, (0.0, 0))
        _YF_DAILY_FAIL[ticker_up] = (_time.monotonic(), n + 1)


def _yf_daily_record_ok(ticker_up: str) -> None:
    with _YF_DAILY_FAIL_LOCK:
        _YF_DAILY_FAIL.pop(ticker_up, None)


def _fetch_daily_yf(ticker: str, timeout: float = 20.0) -> list[dict]:
    """Fetch daily bars from yfinance period='max' for deep history.
    Returns bars in our normalized format (t = ISO date string).
    Used during nightly warm to get pre-2006 history that Massive lacks.

    ``timeout`` is the hard caller-side deadline (yfinance_pool enforces it via
    Future.result). Defaults to 20s for the nightly warm / index (yf-only) paths
    where the deeper data is worth the wait; the REQUEST-path tail-fill passes a
    tight cap (see _REQUEST_YF_DAILY_TIMEOUT) so a cold chart open never blocks
    on a slow Yahoo call.
    """
    ticker_up = ticker.upper()
    # Skip tickers in a recent-failure backoff window (Yahoo IP throttle / delisted).
    if _yf_daily_in_backoff(ticker_up):
        return []
    try:
        from api.services.yfinance_pool import fetch_history as _yf_fetch
        # period='max' on a wide universe is a known yfinance slow-path
        # (multi-second on cold tickers). The caller chooses the deadline.
        df = _yf_fetch(
            ticker_up,
            timeout=timeout,
            period='max', interval='1d',
            auto_adjust=False, raise_errors=False,
        )
        if df is None or df.empty:
            _yf_daily_record_fail(ticker_up)
            return []
        out = []
        for ts, row in df.iterrows():
            try:
                dt_str = ts.strftime("%Y-%m-%d") if hasattr(ts, 'strftime') else str(ts)[:10]
                out.append({
                    "t": dt_str,
                    "o": _px(row["Open"]),
                    "h": _px(row["High"]),
                    "l": _px(row["Low"]),
                    "c": _px(row["Close"]),
                    "v": int(row.get("Volume", 0) or 0),
                })
            except Exception:
                continue
        if out:
            _yf_daily_record_ok(ticker_up)
        else:
            _yf_daily_record_fail(ticker_up)
        return out
    except Exception as e:
        _note_provider_fault(e)
        _yf_daily_record_fail(ticker_up)
        print(f"[bars] yfinance daily fetch failed for {ticker}: {_redact_log(str(e))}")
        return []


def _fetch_yf_only(ticker_up: str, tf: str, max_bars: int) -> list[dict]:
    """Fetch bars for a yf-only index symbol (e.g. ^IXIC) straight from
    yfinance — Massive has no index data. Daily uses period='max'; weekly /
    monthly resample that; intraday reuses the yfinance intraday path.
    """
    if tf in ("1", "5", "15", "30", "60"):
        return _fetch_intraday_yfinance(ticker_up, tf, max_bars)
    yf_sym = _YF_ONLY.get(ticker_up, ticker_up)
    daily = _fetch_daily_yf(yf_sym)
    if not daily:
        return []
    if tf == "W":
        return _resample_weekly_iso(daily)[-max_bars:]
    if tf == "M":
        return _resample_monthly_iso(daily)[-max_bars:]
    return daily[-max_bars:]


def _yf_only_bars_response(ticker_up: str, tf: str, bars: int):
    """Build the /api/bars JSON response for a yf-only index symbol.

    Bypasses the SQLite/Massive/delta machinery entirely (indices only update
    once per session) and uses a short in-memory TTL cache so repeat chart
    loads don't re-hit yfinance.
    """
    cache_key = f"bars_{ticker_up}_{tf}_{bars}"
    cached = cache.get(cache_key)
    if cached is not None:
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )
    out = _fetch_yf_only(ticker_up, tf, bars)
    payload = {"ticker": ticker_up, "tf": tf, "bars": out}
    if out:
        cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
    )


def _merge_daily_bars(yf_bars: list[dict], massive_bars: list[dict]) -> list[dict]:
    """Merge yfinance (deep history) + Massive (recent, more accurate).
    Massive wins for any overlapping date range. yfinance fills the older
    pre-Massive history.
    """
    if not yf_bars:
        return massive_bars
    if not massive_bars:
        return yf_bars
    cutoff = massive_bars[0]["t"]  # ISO date string sorts lexically
    older_yf = [b for b in yf_bars if b["t"] < cutoff]
    return older_yf + massive_bars


def _fetch_daily(ticker: str, max_bars: int, deep: bool = False) -> list[dict]:
    """Fetch daily bars from Massive API. If deep=True, also pull yfinance
    period='max' and merge for full pre-2006 history. The deep path is only
    invoked by the nightly universe warmer — live user requests never call
    yfinance, ensuring zero latency impact.
    """
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    # ~1.5 calendar days per trading day, capped at 30 years to avoid strftime crash
    lookback = min(int(max_bars * 1.5) + 30, 10950)
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    raw = get_agg_bars(ticker.upper(), from_date, to_date)
    massive_bars = _massive_raw_to_iso(raw, ticker)

    if deep:
        # Only nightly warmer asks for deep history — pulls yfinance and merges.
        yf_bars = _fetch_daily_yf(ticker)
        merged = _merge_daily_bars(yf_bars, massive_bars)
        return merged[-max_bars:]

    # Cold full-fetch: heal a lagging Massive tail from yfinance for thin
    # tickers so the FIRST paint is accurate (not just the delta self-heal).
    return _fill_daily_tail_with_yf(ticker, massive_bars)[-max_bars:]


def _fetch_weekly(ticker: str, max_bars: int, deep: bool = False) -> list[dict]:
    """Fetch weekly bars — daily from Massive (+ yfinance if deep), resampled."""
    if deep:
        # Build deep daily series first, then resample. Need enough daily bars
        # to cover max_bars weeks: ~5 trading days/week + buffer.
        daily = _fetch_daily(ticker, max_bars * 7, deep=True)
        weekly = _resample_weekly_iso(daily)
        return weekly[-max_bars:]
    # Fast path: Massive recent + yfinance tail-fill when stale, resampled.
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    lookback = min(max_bars * 8, 10950)
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    daily = _fill_daily_tail_with_yf(ticker, _massive_raw_to_iso(get_agg_bars(ticker.upper(), from_date, to_date), ticker))
    return _resample_weekly_iso(daily)[-max_bars:]


def _resample_monthly(daily_bars: list[dict]) -> list[dict]:
    """Resample daily bars to monthly (year-month grouping)."""
    if not daily_bars:
        return []
    months = {}
    for bar in daily_bars:
        dt = datetime.utcfromtimestamp(bar["t"] / 1000)
        key = (dt.year, dt.month)
        if key not in months:
            months[key] = {
                "dt": dt.replace(day=1), "o": bar["o"], "h": bar["h"],
                "l": bar["l"], "c": bar["c"], "v": _bar_volume(bar),
            }
        else:
            m = months[key]
            m["h"] = max(m["h"], bar["h"])
            m["l"] = min(m["l"], bar["l"])
            m["c"] = bar["c"]
            m["v"] = m["v"] + _bar_volume(bar)
    result = []
    for m in sorted(months.values(), key=lambda x: x["dt"]):
        result.append({
            "t": m["dt"].strftime("%Y-%m-%d"),
            "o": m["o"], "h": m["h"], "l": m["l"], "c": m["c"], "v": m["v"],
        })
    return result


def _fetch_monthly(ticker: str, max_bars: int, deep: bool = False) -> list[dict]:
    """Fetch monthly bars — daily from Massive (+ yfinance if deep), resampled."""
    if deep:
        daily = _fetch_daily(ticker, max_bars * 25, deep=True)  # ~21 trading days/month
        monthly = _resample_monthly_iso(daily)
        return monthly[-max_bars:]
    # Fast path: Massive recent + yfinance tail-fill when stale, resampled.
    from api.services.massive import get_agg_bars
    to_date = datetime.utcnow().strftime("%Y-%m-%d")
    lookback = min(max_bars * 35, 10950)  # ~35 calendar days per month
    from_date = (datetime.utcnow() - timedelta(days=lookback)).strftime("%Y-%m-%d")
    daily = _fill_daily_tail_with_yf(ticker, _massive_raw_to_iso(get_agg_bars(ticker.upper(), from_date, to_date), ticker))
    return _resample_monthly_iso(daily)[-max_bars:]


def _bar_volume(bar: dict) -> float:
    """A bar's volume as a number, treating a MISSING or NULL volume as zero.

    ⚰⚰ `bar.get("v", 0)` LOOKED LIKE THIS AND WAS NOT. A default fires only when
    the KEY IS ABSENT; the bars store legally holds rows whose `v` is present and
    `None`, and those returned `None` straight into `w["v"] += …`. The result was
    a bare `TypeError` — not a `TableRefusal`, so a `tf(close, 'W')` scan over any
    symbol with one null-volume day crashed the sweep row instead of refusing it,
    intermittently and only on real data.

    ⚠️ ZERO, NOT NaN, AND THE CHOICE IS NARROW. This resampler feeds the CHART
    pipeline as well as the engine, and a NaN volume would blank a whole weekly
    candle over one missing day. A null volume means "no volume recorded for this
    session", which sums as nothing; the PRICE fields are untouched, so a week
    whose prices are known still answers about its prices.
    """
    v = bar.get("v")
    return 0 if v is None else v


def _resample_weekly_iso(daily_bars: list[dict], ticker: str | None = None) -> list[dict]:
    """Resample our normalized daily bars (t = ISO date string) to weekly.
    Non-session daily rows are excluded (`date_bar_keys`) — a week is its sessions."""
    if not daily_bars:
        return []
    from api.services.date_bar_keys import session_daily
    weeks = {}
    for bar in session_daily(daily_bars, ticker):
        try:
            dt = datetime.strptime(bar["t"], "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        key = dt.isocalendar()[:2]
        if key not in weeks:
            # Date the weekly candle by the week's CLOSE (Friday of the ISO
            # week), not its first trading day. Friday is a STABLE per-week
            # key — an in-progress week keeps one fixed timestamp as Mon..Fri
            # bars land, so daily updates REPLACE the candle instead of
            # minting a new key and duplicating it. (Holiday weeks still key
            # to the calendar Friday; it's a label, not a traded session.)
            friday = datetime.fromisocalendar(key[0], key[1], 5)
            weeks[key] = {
                "dt": friday, "o": bar["o"], "h": bar["h"],
                "l": bar["l"], "c": bar["c"], "v": _bar_volume(bar),
            }
        else:
            w = weeks[key]
            w["h"] = max(w["h"], bar["h"])
            w["l"] = min(w["l"], bar["l"])
            w["c"] = bar["c"]
            w["v"] += _bar_volume(bar)
    return [
        {
            "t": w["dt"].strftime("%Y-%m-%d"),
            "o": w["o"], "h": w["h"], "l": w["l"], "c": w["c"], "v": w["v"],
        }
        for w in sorted(weeks.values(), key=lambda x: x["dt"])
    ]


def _resample_monthly_iso(daily_bars: list[dict], ticker: str | None = None) -> list[dict]:
    """Resample our normalized daily bars (t = ISO date string) to monthly.
    Non-session daily rows are excluded (`date_bar_keys`) — a month is its sessions."""
    if not daily_bars:
        return []
    from api.services.date_bar_keys import session_daily
    months = {}
    for bar in session_daily(daily_bars, ticker):
        try:
            dt = datetime.strptime(bar["t"], "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        key = (dt.year, dt.month)
        if key not in months:
            months[key] = {
                "dt": dt.replace(day=1), "o": bar["o"], "h": bar["h"],
                "l": bar["l"], "c": bar["c"], "v": _bar_volume(bar),
            }
        else:
            m = months[key]
            m["h"] = max(m["h"], bar["h"])
            m["l"] = min(m["l"], bar["l"])
            m["c"] = bar["c"]
            m["v"] += _bar_volume(bar)
    return [
        {
            "t": m["dt"].strftime("%Y-%m-%d"),
            "o": m["o"], "h": m["h"], "l": m["l"], "c": m["c"], "v": m["v"],
        }
        for m in sorted(months.values(), key=lambda x: x["dt"])
    ]


def _normalize_since_param(since_str: str, date_tf: bool):
    """Parse the `?since=` query value into a comparable threshold.

    Handles three input shapes:
      - ISO date string (`"2024-01-15"`) for daily/weekly/monthly timeframes:
        passed through unchanged for string comparison
      - Unix seconds integer (`"1714579200"`) for intraday: parsed as int
      - Unix MILLISECONDS integer (`"1714579200000"`) for intraday: detected
        by magnitude and downscaled to seconds

    The millisecond case fires from the Phase 4 chart's gap-backfill
    (StockChart.jsx onRealtimeReconnect) which tracks the last live bar
    time in milliseconds (the WebSocket emit shape) and forwards that
    value verbatim as `since=${sinceMs}`. Without the auto-downscale,
    `b["t"] > since_val` is e.g. ``1714579200 > 1714579200000`` — always
    False — so EVERY WebSocket reconnect returns zero bars for the
    disconnect window, leaving a permanent gap on the chart. Across
    multiple reconnects per session this accumulates into the "gaps and
    weird construction" symptom the user reported.

    Returns the parsed threshold. Returns 0 (or "" for date_tf) on parse
    failure to match the historical default-empty behavior.
    """
    try:
        if date_tf:
            return since_str  # ISO date string comparison
        v = int(since_str)
        # Stored bar `t` values are unix seconds (~1.7e9 in 2024-2030).
        # Anything >= 1e11 is unambiguously milliseconds (year 5138+ in
        # seconds). Downscale to bring it back into the seconds domain
        # so the `>` comparison against bar["t"] is meaningful.
        if v >= 100_000_000_000:
            v //= 1000
        return v
    except (ValueError, TypeError):
        return "" if date_tf else 0


def _get_delisted_bars_response(record: dict, tf: str, bars: int, serve_as: str | None = None) -> JSONResponse:
    """Serve a DELISTED entity's FROZEN historical bars.

    A dead company's data never changes, so this is a deliberately simple fetch-once /
    store-forever path — no live updates, no freshness, no deltas, no yfinance tail-fill.
    It is fully ISOLATED from the live `_get_bars_inner` path (which assumes a tradeable
    ticker), so it can't regress live charts.

    ⭐ TICKER-REUSE SAFETY (the whole reason this exists): it fetches the PROVIDER symbol
    (record['provider_symbol'], e.g. bare 'BSC') DATE-CLAMPED to [first_date, last_date]
    (this entity's trading life), but caches / stores under the entity KEY
    (record['ticker'], e.g. 'BSC-OLD'). So Bear Stearns is fetched as BSC[2003..2008] and
    lives under 'BSC-OLD', while the live BSC ETN keeps its own separate cache — the two
    eras of a reused symbol can NEVER combine into one chart, because the date clamp means
    the provider physically can't return the other era's bars."""
    key = str(record.get("ticker") or "").upper()
    provider = str(record.get("provider_symbol") or key)
    # `serve_as` = the symbol the CLIENT requested (e.g. bare "BSC" aliased to this entity).
    # We fetch the provider clamped + cache/respond under serve_as so the frontend's cache
    # key stays consistent with what it asked for, while still getting the clean clamped data.
    serve_key = str(serve_as or key).upper()
    last_date = record.get("last_date") or record.get("delisted_date") or datetime.utcnow().strftime("%Y-%m-%d")
    first_date = record.get("first_date") or "1990-01-01"
    date_tf = tf in ("D", "W", "M")
    cache_key = f"delisted_bars_{serve_key}_{tf}_{bars}"

    hit = cache.get(cache_key)
    if hit is not None:
        return JSONResponse(content=hit, headers={"Cache-Control": "no-store"})

    # A dead company has no intraday feed worth serving from decades-old daily aggs —
    # only D/W/M are meaningful. Intraday TFs return empty (the chart defaults to D).
    if not date_tf:
        return JSONResponse(content={"ticker": serve_key, "tf": tf, "bars": []},
                            headers={"Cache-Control": "no-store"})

    # Frozen store: once SQLite holds this entity's bars (under serve_key), serve them — the
    # data is immutable, so a stored series is authoritative and never re-fetched.
    try:
        stored = _sqlite.get_bars(serve_key, tf, bars)
    except Exception:
        stored = []
    if stored:
        payload = {"ticker": serve_key, "tf": tf, "bars": _fmt_sqlite_bars(stored, tf, serve_key)}
        cache.set(cache_key, payload, ttl=604800)
        return JSONResponse(content=payload, headers={"Cache-Control": "no-store"})

    # Cold: fetch the PROVIDER symbol, date-CLAMPED to this entity's life, then resample.
    try:
        from api.services.massive import get_agg_bars
        raw = get_agg_bars(provider, first_date, last_date)
    except Exception:
        raw = []
    daily = _massive_raw_to_iso(raw)
    if tf == "W":
        series = _resample_weekly_iso(daily)
    elif tf == "M":
        series = _resample_monthly_iso(daily)
    else:
        series = daily
    series = series[-bars:] if (bars and series) else series
    if series:
        try:
            _sqlite.put_bars(serve_key, tf, series, date_tf=True)   # store under serve_key, frozen
        except Exception:
            pass
    payload = {"ticker": serve_key, "tf": tf, "bars": series}
    # Cache a real series long (immutable); cache an empty result briefly (transient miss).
    cache.set(cache_key, payload, ttl=(604800 if series else 300))
    return JSONResponse(content=payload, headers={"Cache-Control": "no-store"})


# Symbol continuity for replay: a few symbols were RENAMED and the provider stores each era's
# history under the symbol of that era. Map (ticker, cutoff-date) → the symbol that actually
# holds the requested era, so a replay to e.g. QQQ in 2010 serves the QQQQ-era history instead
# of stopping dead at the 2004 symbol change. ISO 'YYYY-MM-DD' compares correctly as strings.
# Scoped to the replay pre-cutoff path only (normal/live charts untouched) — the small, targeted
# slice of the broader symbol-continuity work. Extend as more cases surface.
_REPLAY_SYMBOL_ERAS = {
    "QQQ": [("2004-12-01", "2011-03-22", "QQQQ")],   # QQQ → QQQQ (Nasdaq listing) → back to QQQ
}


def _replay_effective_symbol(ticker: str, to_str: str) -> str:
    for lo, hi, alias in _REPLAY_SYMBOL_ERAS.get(ticker, ()):
        if lo <= str(to_str) <= hi:
            return alias
    return ticker


def _replay_warming_response(resp_ticker: str, tf: str) -> JSONResponse:
    """The deliberate warming 503 for a replay window still landing (edge passes it)."""
    _mark_serve("replay-warming")
    r = JSONResponse(
        status_code=503,
        content={"ticker": resp_ticker, "tf": tf, "bars": [], "error": "warming"},
    )
    r.headers["Retry-After"] = "3"
    r.headers["X-Bars-Shed"] = "warming"
    return r


def _bounded_job(key: str, fn, deadline: float, sem=None, slot_wait: float = 0.0) -> bool:
    """Run `fn` once per `key` (deduped via `_inflight`) on a daemon thread and wait for
    it at most `deadline`, capped by the request budget. True when it finished in time.
    The job is never cancelled: a shed job still persists for the re-poll.

    `sem` (review F4): a concurrency cap the job must hold while it runs — taken with
    at most `slot_wait` (budget-capped); no slot → nothing starts, returns False."""
    with _inflight_lock:
        ev = _inflight.get(key)
        mine = ev is None
        if mine:
            ev = _threading.Event()
            _inflight[key] = ev
    if mine:
        if sem is not None and not (sem.acquire(timeout=_bounded_wait(slot_wait)) if slot_wait > 0
                                    else sem.acquire(blocking=False)):
            with _inflight_lock:
                _inflight.pop(key, None)
            ev.set()
            return False

        def _run():
            try:
                fn()
            except Exception:             # noqa: BLE001 — background
                pass
            finally:
                if sem is not None:
                    sem.release()
                with _inflight_lock:
                    _inflight.pop(key, None)
                ev.set()
        try:
            _threading.Thread(target=_run, daemon=True, name=f"bars-job-{key[:40]}").start()
        except Exception:                 # noqa: BLE001
            if sem is not None:
                sem.release()
            with _inflight_lock:
                _inflight.pop(key, None)
            ev.set()
            return False
    return ev.wait(timeout=_bounded_wait(deadline))


def _get_bars_to_response(ticker: str, tf: str, bars: int, to_str: str, warm: bool = False) -> JSONResponse:
    """Serve up to `bars` bars ENDING AT `to_str` (YYYY-MM-DD) from SQLite — the
    replay-mode PRE-CUTOFF window. This history is static, so there's NO freshness check
    and NO provider call: a fast index-seek read (the fix for replay charts on old tickers
    doing a slow full 'ending today' fetch and painting nothing). Falls through to the
    normal path only when SQLite has nothing for this ticker (cold) so that path can
    populate it — the client filters post-cutoff bars either way."""
    ticker_up = ticker.upper()
    if _is_yf_only_symbol(ticker_up):
        return _get_bars_inner(ticker, tf, bars)
    date_tf = tf in ("D", "W", "M")
    try:
        if date_tf:
            to_key = int(str(to_str).replace("-", ""))
        else:
            _d = datetime.strptime(str(to_str), "%Y-%m-%d")
            to_key = int(datetime(_d.year, _d.month, _d.day, 23, 59, 59,
                                  tzinfo=_ZI("America/New_York")).timestamp())
    except Exception:
        return _get_bars_inner(ticker, tf, bars)
    # Symbol continuity: a replay cutoff in an era when this ticker traded under a DIFFERENT
    # symbol must read/fetch that era's data (QQQ was "QQQQ" 2004-12→2011, so a 2010 QQQ replay
    # would otherwise stop at the Nov-2004 change). Data ops below use `ticker_up` (rebound to the
    # era symbol); the response is still labeled with what the client requested (resp_ticker).
    resp_ticker = ticker_up
    ticker_up = _replay_effective_symbol(ticker_up, to_str)
    try:
        rows = _sqlite.get_bars_before(ticker_up, tf, bars, to_key)
    except Exception:
        rows = []
    if not rows and date_tf:
        # SQLite has nothing at/before the cutoff (e.g. a 2008 replay on a name whose deep
        # history never reached this pod — the sort read it from grouped-daily, not bars.db).
        # Falling to _get_bars_inner here would delta-fetch nothing and return recent-only
        # bars → EMPTY after the client's cutoff filter → "Failed to load chart". Instead do
        # the FULL daily history fetch ONCE (deep: Massive + yfinance), persist it, then serve
        # ≤ cutoff from SQLite. Slow the first time, then permanently cached + fast.
        # ⛔ (2026-11-10) Was INLINE and unbounded (a full deep D/W/M pull, yfinance
        # included, can run well past the edge's 8 s abort). Same fetch + persist, now
        # on a deduped daemon job the request waits on for at most its budget; a
        # replay that is still landing answers the deliberate warming 503.
        def _replay_deep_job():
            deep = (_fetch_daily(ticker_up, max(bars, 12500), deep=True) if tf == "D"
                    else _fetch_weekly(ticker_up, bars, deep=True) if tf == "W"
                    else _fetch_monthly(ticker_up, bars, deep=True))
            if deep:
                try:
                    _sqlite.put_bars(ticker_up, tf, deep, date_tf=True)
                except Exception:
                    pass
        try:
            _done = _bounded_job(f"replayto-deep::{ticker_up}::{tf}", _replay_deep_job,
                                 _DEEP_DEADLINE_SECONDS, sem=_replay_cold_sem,
                                 slot_wait=0.0 if warm else 1.0)
            rows = _sqlite.get_bars_before(ticker_up, tf, bars, to_key)
            if not rows and not _done:
                return _replay_warming_response(resp_ticker, tf)
        except Exception:
            rows = rows or []
    # Cold/PARTIAL INTRADAY replay: fetch the requested window when the store doesn't COVER it —
    # "covered" = the newest stored bar ≤ cutoff is within ~7 days of the cutoff. Otherwise only
    # some OTHER (older) window is stored (e.g. replayed 2012 earlier, now asking for 2015: the
    # 2012 rows are ≤ the 2015 key but are the WRONG window and would serve stale). Empty = fetch.
    _intraday_window_missing = False
    if not date_tf:
        try:
            _intraday_window_missing = (not rows) or (to_key - int(rows[-1][0]) > 7 * 86400)
        except Exception:
            _intraday_window_missing = not rows
    if _intraday_window_missing:
        # Cold INTRADAY replay (e.g. AAPL 5-min at a 2008 cutoff — deep intraday this pod has
        # never fetched). The daily branch above is date_tf-only; without this an old intraday
        # cutoff falls to _get_bars_inner (recent-window) → EMPTY after the client's cutoff
        # filter → "Failed to load chart". Fetch the pre-cutoff window ONCE from Massive
        # (split-adjusted, NO lookback ceiling), persist to SQLite, then serve ≤ cutoff. Slow
        # the first time (~1-3s for a 2008 window), permanently cached + fast after. Bounded by
        # `bars`: ~bars/bars_per_day*1.5 calendar days ENDING at the cutoff (not 2003→cutoff).
        # WINDOW IS CAPPED (_REPLAY_INTRADAY_COLD_BARS) so the cold fetch is fast + small.
        # DEDUPED via _inflight so the burst from warming all intraday TFs on replay-start
        # (or a poll during the fetch) doesn't stampede the provider for the same window.
        try:
            mult = int(tf)
            bars_per_day = (16 * 60) // max(mult, 1)
            eff_bars = min(int(bars), _REPLAY_INTRADAY_COLD_BARS)
            lookback_days = min(400, max(10, int(eff_bars / max(bars_per_day, 1) * 1.5) + 5))
            _to_d = datetime.strptime(str(to_str), "%Y-%m-%d")
            from_ymd = (_to_d - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
            cold_key = f"replayto::{ticker_up}::{tf}::{to_str}"
            with _inflight_lock:
                ev = _inflight.get(cold_key)
                do_fetch = ev is None
                if do_fetch:
                    ev = _threading.Event()
                    _inflight[cold_key] = ev
            if do_fetch:
                # Global concurrency cap (_replay_cold_sem): a WARM request skips the fetch when
                # no slot is free (the on-demand chart request will fetch it later) so warming 5
                # TFs can't saturate the pod; a real CHART request waits briefly for a slot.
                # ⛔ (2026-11-10) The slot wait was 20 s and the fetch then ran INLINE with no
                # ceiling, and a peer waited 30 s — every one past the edge's 8 s abort. The
                # fetch now runs on a daemon thread (still persists when the request has
                # stopped waiting) and the request waits at most the request budget.
                got_slot = (_replay_cold_sem.acquire(blocking=False) if warm
                            else _replay_cold_sem.acquire(timeout=_bounded_wait(1.0)))
                if got_slot:
                    def _replay_job(_ev=ev, _key=cold_key):
                        try:
                            deep = [b for b in _fetch_intraday_range(ticker_up, tf, from_ymd, str(to_str))
                                    if int(b.get("t", 0)) <= to_key]
                            if deep:
                                try:
                                    _sqlite.put_bars(ticker_up, tf, deep, date_tf=False)
                                except Exception:
                                    pass
                        except Exception:     # noqa: BLE001 — background
                            pass
                        finally:
                            _replay_cold_sem.release()
                            with _inflight_lock:
                                _inflight.pop(_key, None)
                            _ev.set()
                    try:
                        _threading.Thread(target=_replay_job, daemon=True,
                                          name=f"bars-replaycold-{ticker_up}-{tf}").start()
                    except Exception:         # noqa: BLE001
                        _replay_cold_sem.release()
                        with _inflight_lock:
                            _inflight.pop(cold_key, None)
                        ev.set()
                    ev.wait(timeout=_bounded_wait(_DEEP_DEADLINE_SECONDS))
                else:
                    with _inflight_lock:
                        _inflight.pop(cold_key, None)
                    ev.set()
            else:
                # another request is fetching this exact window — wait (bounded), then read
                ev.wait(timeout=_bounded_wait(_DEEP_DEADLINE_SECONDS + 0.5))
            rows = _sqlite.get_bars_before(ticker_up, tf, bars, to_key)
            # ⛔ RE-CHECK COVERAGE, not just emptiness (review F1): a store holding an
            # OLDER era (2012 rows for a 2015 cutoff) is non-empty but still does not
            # cover the window — serving it as a 1 h-cacheable answer paints the wrong
            # era. While the window fetch is still running, shed as warming.
            try:
                _intraday_window_missing = (not rows) or (to_key - int(rows[-1][0]) > 7 * 86400)
            except Exception:
                _intraday_window_missing = not rows
            if _intraday_window_missing and not warm:
                with _inflight_lock:
                    _replay_running = cold_key in _inflight
                if _replay_running:
                    # Shed, clearly marked: the window is still landing — re-poll the tier.
                    return _replay_warming_response(resp_ticker, tf)
        except Exception:
            rows = rows or []
    if not rows:
        return _get_bars_inner(ticker, tf, bars)   # last resort — client filters
    _mark_serve("sqlite")
    payload = {"ticker": resp_ticker, "tf": tf, "bars": _fmt_sqlite_bars(rows, tf, ticker_up)}
    # A window that is STILL not covered (the fetch finished without reaching it) is
    # an honest best effort, not static history: never pin it for an hour.
    _replay_ttl = 30 if (not date_tf and _intraday_window_missing) else 3600
    return JSONResponse(content=payload, headers={"Cache-Control": f"public, max-age={_replay_ttl}"})


# Timeframes the snapshot warm serves. Custom intraday tfs (2/45/240/…) are
# deliberately absent: StockChart drops `to=` for them and the registry marks
# them non-reconstructable, so warming would bank history nothing re-reads.
_SNAPWARM_TFS = ("1", "5", "15", "30", "60", "D", "W", "M")


def kick_snapshot_warm(ticker: str, tf: str, need_before_ymd: int | None = None) -> bool:
    """Capture-time warm for a journal snapshot: make sure the (ticker, tf)
    history behind a freshly-captured embed lands in the forever-store.
    Fire-and-forget and BOUNDED (review finding — the first cut spawned an
    unguarded full-history thread per call, reachable by any authed user):
    - pytest NO-OP, same reason as _maybe_kick_deepfill's (its docstring
      carries the 16,500-fixture-bars incident);
    - whitelisted tfs only; one dispatch per (ticker, tf) per _DEEPFILL_TTL;
    - intraday rides the deep-fill rail's own semaphore/throttle;
    - D/W/M runs warm_ticker_daily_deep on a daemon thread gated by the same
      deep-fill semaphore, with the caller's cutoff day so an already-deep
      store short-circuits instead of re-fetching 30 years.
    Returns whether a warm was dispatched."""
    if _os.environ.get("PYTEST_CURRENT_TEST"):
        return False
    tu = (ticker or "").strip().upper()
    if not tu or tf not in _SNAPWARM_TFS:
        return False
    marker = f"snapwarm_{tu}_{tf}"
    if cache.get(marker) is not None:
        return False
    cache.set(marker, 1, ttl=_DEEPFILL_TTL)
    if tf in ("1", "5", "15", "30", "60"):
        _maybe_kick_deepfill(tu, tf, 5000)
        return True

    def _run(_t=tu, _need=need_before_ymd):
        if not _deepfill_sem.acquire(blocking=False):
            return
        try:
            warm_ticker_daily_deep(_t, need_before_ymd=_need)
        except Exception:  # noqa: BLE001
            pass
        finally:
            _deepfill_sem.release()

    _threading.Thread(target=_run, daemon=True, name=f"snapwarm-{tu}").start()
    return True


def warm_ticker_daily_deep(ticker: str, need_before_ymd: int | None = None) -> bool:
    """Fetch + persist a ticker's FULL daily history (deep: Massive + yfinance) into SQLite so
    replay / old-cutoff charts serve it INSTANTLY. Skips when SQLite already holds a bar at or
    before `need_before_ymd` (the sort's start — already deep enough for that window). Used by
    the Custom-Period Sort server warm; best-effort, returns True on success/skip."""
    tu = ticker.upper()
    if need_before_ymd:
        try:
            if _sqlite.get_bars_before(tu, "D", 1, int(need_before_ymd)):
                return True   # already has pre-window history — nothing to warm
        except Exception:
            pass
    try:
        data = _fetch_daily(tu, 12500, deep=True)
        if not data:
            return False
        try:
            _sqlite.put_bars(tu, "D", data, date_tf=True)
        except Exception:
            pass
        return True
    except Exception:
        return False


def warm_ticker_deep(ticker: str, tf: str) -> int:
    """Fetch + persist a ticker's FULL D/W/M history (deep: Massive + the yfinance
    pre-2003 graft) into SQLite, SYNCHRONOUSLY. Returns the row count written, 0 on
    failure. The generalization of `warm_ticker_daily_deep` to W/M.

    ⭐ WHY THE WARMER MUST NOT GO THROUGH THE SERVE PATH. `deep_history_warm` used to
    call `_get_bars_inner(sym, tf, _DEEP_TARGET[tf])` and count the RETURN as "warmed".
    That is only true for a COLD symbol. For one that already holds shallow rows —
    which, after the 2026-09-09 skip-test fix, is nearly every symbol the sweep now
    visits — `_get_bars_inner` serves the stale rows immediately and does the actual
    deep fetch on a background thread gated by `_bg_delta_sem` (BARS_BG_DELTA_MAX, 3 in
    prod). Two warmer threads issuing thousands of jobs would have had almost all of
    that work DROPPED at the semaphore, and reported every drop as a success.

    Synchronous by design: the warmer's own 2-thread pool is the concurrency limit, and
    the provider client's rate limiter is the politeness limit. Nothing accumulates in
    memory — one (ticker, tf) at a time, straight to SQLite.
    """
    tu = ticker.upper()
    tfu = (tf or "D").upper()
    if tfu not in ("D", "W", "M"):
        return 0
    try:
        if tfu == "W":
            data = _fetch_weekly(tu, 4000, deep=True)
        elif tfu == "M":
            data = _fetch_monthly(tu, 1200, deep=True)
        else:
            data = _fetch_daily(tu, 12500, deep=True)
        if not data:
            return 0
        _sqlite.put_bars(tu, tfu, data, date_tf=True)
        return len(data)
    except Exception:
        return 0


def _get_bars_since_response(ticker: str, tf: str, bars: int, since_str: str) -> JSONResponse:
    """Return only bars newer than `since_str` for the browser's delta sync.

    Triggers a delta fetch from Massive if SQLite data is stale, then returns
    only the new rows — typically 0-5 bars, so payload is ~500 bytes vs 50 KB.
    """
    _mark_serve("delta")
    ticker_up = ticker.upper()
    # Indices have no delta/SQLite path — return the full yfinance set (the
    # caller fetches index bars without `since`, so this is a safety net).
    if _is_yf_only_symbol(ticker_up):
        return _yf_only_bars_response(ticker_up, tf, bars)
    _record_intraday_request(ticker_up, tf)
    cache_key = f"bars_{ticker_up}_{tf}_{bars}"
    date_tf = tf in ("D", "W", "M")

    # Parse the since threshold (auto-detects ms vs seconds for intraday)
    since_val = _normalize_since_param(since_str, date_tf)

    # Refresh SQLite if stale (same logic as _get_bars_inner)
    last_ts = _sqlite.get_last_ts(ticker_up, tf)
    if _needs_fresh(last_ts, tf, ticker_up):
        if _since_async_heal():
            # PHASE 1.4 — DON'T block this high-QPS poll on a provider. Heal the tail
            # in the background (bounded, deduped) and serve whatever local delta
            # exists NOW. The live candle is on the WS/Finnhub feed, so the just-
            # closed bar simply arrives on the next 30s poll instead of this one.
            _mark_serve("delta-async-heal")
            _enqueue_since_bg_heal(cache_key, ticker_up, tf, last_ts or 0, date_tf)
        else:
            try:
                # ⛔ THE THIRD UNBOUNDED PROVIDER CALL ON A REQUEST THREAD, and the
                # highest-QPS one — this is the browser's tail poll, every open chart
                # × every member. Bounded for the same reason as the other two
                # (`_bounded_delta`): a slow provider must never push the tier past
                # the edge's 8 s abort. ⭐ It matters MORE here, not less: this is the
                # request that carries today's completed bars, so when it is shed the
                # client's bounded catch-up poll re-asks in 1.5 s and the just-landed
                # rows are read straight from SQLite.
                # ⛔⛔ INTRADAY ONLY — D/W/M keep the blocking call. Daily polls at 300 s
                # and has no catch-up, so shedding a daily tail would hold it stale for
                # five minutes. Same rule as Layer 4.
                if date_tf:
                    # Correct-first with a ceiling (`_bounded_date_delta`).
                    if _bounded_date_delta(ticker_up, tf, last_ts or 0):
                        last_ts = _sqlite.get_last_ts(ticker_up, tf)
                    else:
                        _mark_serve("delta-deadline")
                else:
                    if _bounded_delta(ticker_up, tf, last_ts or 0, False):
                        last_ts = _sqlite.get_last_ts(ticker_up, tf)
                    else:
                        _mark_serve("delta-deadline")
            except Exception:
                pass

    # Read ONLY the new rows via an index range scan (WHERE ts > since), instead
    # of reading up to `bars` (5000) rows + formatting all of them + Python-
    # filtering to the 1-5 that are actually new. This is the browser's 30s SWR
    # revalidation path — the single highest-QPS bars entrypoint during RTH — so
    # the old full-window read was pure wasted CPU + SQLite page-cache churn on
    # the shared event loop, multiplied across every open chart × every user.
    #
    # SQLite stores date-TF ts as a YYYYMMDD int, but `since_val` for date TFs is
    # an ISO date string ("2026-07-03"); convert it to the int key for the SQL
    # `ts > ?` compare. Intraday `since_val` is already unix seconds.
    if date_tf:
        try:
            since_ts_sql = int(str(since_val).replace("-", "")) if since_val else 0
        except (ValueError, TypeError):
            since_ts_sql = 0
    else:
        try:
            since_ts_sql = int(since_val) if since_val else 0
        except (ValueError, TypeError):
            since_ts_sql = 0

    if since_ts_sql > 0:
        new_rows = _sqlite.get_bars_since(ticker_up, tf, since_ts_sql)
    else:
        # Degenerate since (parse failure / 0): preserve the old bounded window
        # rather than returning the entire history unbounded.
        new_rows = _sqlite.get_bars(ticker_up, tf, bars)
    delta = _fmt_sqlite_bars(new_rows, tf, ticker_up) if new_rows else []

    # Invalidate the full cache so the next non-delta request picks up fresh data
    cache.invalidate(cache_key)

    return JSONResponse(
        content={"ticker": ticker_up, "tf": tf, "bars": delta, "delta": True},
        headers={"Cache-Control": "public, max-age=5"},
    )


# Background cache warmer — used by other routers to pre-populate /api/bars
# cache before the client requests it (e.g. when a breadth drill list is
# fetched, warm the top tickers' Daily bars so chart loads are instant).
from concurrent.futures import ThreadPoolExecutor as _BarsWarmExecutor
_bars_warm_pool = _BarsWarmExecutor(max_workers=4, thread_name_prefix="bars-warm")

# ── Never-block cold fetch (instant-charts Phase 4) ──────────────────────────
# A truly-cold symbol's provider fetch can take ~15-22s; holding a REQUEST thread
# that long is the pool-exhaustion / HAR-outage class. So a cold miss kicks a
# bounded, deduped BACKGROUND fetch that warms bars.db and the request returns a
# fast "warming" 503 (below) — the client re-polls in ~3s and reads the SQLite
# layer the moment the bg fetch lands. No request thread is ever held on a provider.
_cold_bg_pool = _BarsWarmExecutor(max_workers=_COLD_FETCH_CONCURRENCY,
                                  thread_name_prefix="bars-cold-bg")
_cold_bg_inflight: set[str] = set()
_cold_bg_lock = _threading.Lock()
_COLD_BG_QUEUE_MAX = _COLD_FETCH_CONCURRENCY * 4   # running + a small queue; drop beyond


from api.services.provider_fault_scope import note as _note_provider_fault  # noqa: E402
from api.services import provider_fault_scope as _provider_fault_scope   # noqa: E402

# ── Cold NEGATIVE cache: "every provider was asked and none has this" ─────────
# ⛔⛔ MEASURED ON PRODUCTION 2026-10-08/09: `/api/bars/ZZQXV?tf=D` (a made-up
# ticker) answered 503 `{"error":"warming"}` on EVERY request, for as long as
# anyone asked. The warming 503 is a promise — "a fetch is running, re-poll" — and
# for a symbol no provider has, the fetch lands nothing, the next request finds
# SQLite still empty, kicks ANOTHER cold fetch and makes the same promise. The
# chart spun until the frontend gave up, and `symbol_presence` could never call a
# real typo a typo, because /api/bars never stopped saying "ask me again".
#
# ⭐ SO A COMPLETED cold fetch that came back empty from EVERY provider, with NO
# provider fault (error / timeout / breaker skip / rejected payload — see
# `provider_fault_scope`), is remembered for a bounded TTL. The router turns the
# next warming 503 for that (ticker, tf) into its honest 200 `no_data` with
# `reason: "no_provider_data"`, and `_kick_cold_fetch` stops re-asking.
#
# ⚠️ WHAT IT CAN NEVER DO:
#   • fire on a transient failure — any fault in the scope and nothing is cached,
#     so today's retry behaviour stands (the SQ/XYZ breaker-open case included);
#   • hide real bars — it is consulted only on the cold branch, i.e. when SQLite
#     holds NOTHING for the key; the moment any path writes rows, it is never read;
#   • outlive its TTL or grow without bound (in-process, oldest evicted first).
_COLD_NEGATIVE_TTL_S = float(_os.environ.get("BARS_COLD_NEGATIVE_TTL_S", "1800"))
_COLD_NEGATIVE_MAX = 5000
_cold_negative: dict[str, float] = {}     # key -> monotonic expiry
_cold_negative_lock = _threading.Lock()


def _cold_neg_key(ticker: str, tf: str) -> str:
    return f"{(ticker or '').strip().upper()}_{tf}"


def _record_cold_negative(ticker: str, tf: str) -> None:
    import time as _t
    with _cold_negative_lock:
        _cold_negative[_cold_neg_key(ticker, tf)] = _t.monotonic() + _COLD_NEGATIVE_TTL_S
        if len(_cold_negative) > _COLD_NEGATIVE_MAX:
            for k, _ in sorted(_cold_negative.items(), key=lambda kv: kv[1])[
                    : len(_cold_negative) - _COLD_NEGATIVE_MAX]:
                _cold_negative.pop(k, None)


def cold_negative(ticker: str, tf: str) -> bool:
    """True while a completed, fault-free cold fetch for (ticker, tf) found nothing."""
    import time as _t
    key = _cold_neg_key(ticker, tf)
    with _cold_negative_lock:
        exp = _cold_negative.get(key)
        if exp is None:
            return False
        if _t.monotonic() >= exp:
            _cold_negative.pop(key, None)
            return False
        return True


def _do_cold_fetch(ticker_up: str, tf: str, bars: int, date_tf: bool) -> None:
    """The cold provider fetch, run OFF the request thread → warms bars.db so the
    client's next poll is a SQLite hit. Same fetch + persist as the old inline path.

    When the fetch returns nothing AND no provider faulted, the (ticker, tf) is
    negative-cached (see `_cold_negative` above)."""
    import logging as _log
    _lg = _log.getLogger(__name__)
    try:
        _deep = _is_deep_request(bars)
        with _provider_fault_scope.scope() as _faults:
            if tf in ("1", "5", "15", "30", "60"):
                raw = _fetch_intraday(ticker_up, tf, bars)
            elif tf == "W":
                raw = _fetch_weekly(ticker_up, bars, deep=_deep)
            elif tf == "M":
                raw = _fetch_monthly(ticker_up, bars, deep=_deep)
            else:
                raw = _fetch_daily(ticker_up, bars, deep=_deep)
        if raw and (date_tf or not _is_intraday_stale(raw)):
            if date_tf:
                _sqlite.put_bars(ticker_up, tf, raw, date_tf=date_tf)
            else:
                _put_fetched_intraday(ticker_up, tf, raw)   # fallback = add-only
            if _deep:
                _mark_history_complete(ticker_up, tf)
        elif not raw and _faults.clean:
            _record_cold_negative(ticker_up, tf)
            _lg.info("[bars] cold bg fetch %s tf=%s: no provider has data — "
                     "negative-cached %.0fs", ticker_up, tf, _COLD_NEGATIVE_TTL_S)
    except Exception as e:
        _lg.warning("[bars] cold bg fetch failed %s tf=%s: %s", ticker_up, tf, e)


def _kick_cold_fetch(ticker_up: str, tf: str, bars: int, date_tf: bool) -> None:
    """Submit a deduped cold fetch to the bounded bg pool (drop past the queue cap so a
    fresh-browser scan of obscure tickers can't pile up unbounded work). A key every
    provider already answered "nothing" for is not re-asked until its TTL lapses."""
    if cold_negative(ticker_up, tf):
        return
    key = f"{ticker_up}_{tf}"
    with _cold_bg_lock:
        if key in _cold_bg_inflight or len(_cold_bg_inflight) >= _COLD_BG_QUEUE_MAX:
            return
        _cold_bg_inflight.add(key)

    def _job():
        try:
            _do_cold_fetch(ticker_up, tf, bars, date_tf)
        finally:
            with _cold_bg_lock:
                _cold_bg_inflight.discard(key)
    try:
        _cold_bg_pool.submit(_job)
    except Exception:
        with _cold_bg_lock:
            _cold_bg_inflight.discard(key)


# ── The one place a REQUEST thread may wait on a provider ────────────────────
# ⛔⛔ A BARE BLOCKING PROVIDER CALL ON THE REQUEST PATH IS THE 16-SECOND CLASS.
# Measured on production 2026-09-20: `UTMD tf=5` answered in 16,102 ms and then
# 503; `BATRK tf=1` in 16,331 ms. Neither number is a provider latency — it is TWO
# 8-second timeouts in series. The Cloudflare Worker `bars-edge-router` aborts
# `BARS_ORIGIN` at `BARS_TIMEOUT_MS = 8000` and retries against `WEB_ORIGIN`; the
# web pod then re-proxies to THIS SAME TIER with its own 8 s `httpx` timeout before
# finally serving locally. The Worker's fallback is meant to be a different path and
# it is not, so a slow tier is paid for twice.
#
# ⭐ SO THE FIX IS A CEILING HERE, NOT A BIGGER TIMEOUT THERE. Keep the tier under
# the edge's budget and the second hop never happens — the double path stops being
# reachable instead of being made faster.
#
# ⭐⭐ THE JOB IS NEVER CANCELLED. On timeout it keeps running and its SQLite write
# lands for the next poll, so a slow provider costs the caller a deadline and never a
# lost fetch. That is what makes this strictly better than the blocking call in every
# case: a fast provider behaves identically (correct first paint), and a slow one
# degrades to "serve the local store now, heal shortly" instead of holding an anyio
# worker for 8-20 s.
#
# ⚠️ CAPACITY IS THE EXISTING BOUND, NOT A NEW ONE. `_bg_delta_sem` already bounds
# background delta work (`BARS_BG_DELTA_MAX`, 3 on the bars tier); a request-path
# delta is the same kind of work, so it draws on the same budget. No free slot means
# the local store is served immediately — precise shedding under a scan storm rather
# than an unbounded pile-up.
_REQUEST_DEADLINE_SECONDS = float(
    _os.environ.get("BARS_REQUEST_DEADLINE_SECONDS", "2.5")
)
# The local 30m/60m rebuild (`_local_tail_repair`) is two indexed reads and one small
# write; this ceiling only matters under a held SQLite write lock.
_LOCAL_DERIVE_DEADLINE_SECONDS = float(
    _os.environ.get("BARS_LOCAL_DERIVE_DEADLINE_SECONDS", "0.75"))


def _bounded_delta(ticker_up: str, tf: str, last_ts: int, date_tf: bool,
                   deadline: float | None = None) -> bool:
    """Run the (ticker, tf) provider delta with a HARD wait ceiling.

    Returns True when the delta finished inside the deadline (the caller should
    re-read SQLite), False when it was shed for capacity or is still running (the
    caller serves what the local store already holds).
    """
    if deadline is None:
        deadline = _REQUEST_DEADLINE_SECONDS
    done = _start_bounded_delta(ticker_up, tf, last_ts, date_tf)
    if done is None:
        return False                      # no capacity → serve the local store now
    return done.wait(timeout=_bounded_wait(deadline))


def _start_bounded_delta(ticker_up: str, tf: str, last_ts: int, date_tf: bool):
    """Start the `_bounded_delta` job WITHOUT waiting. Returns its done-Event, or None
    when no slot was free / the thread could not start (lets the deep branch run the
    tail repair and the depth fetch in parallel)."""
    # ⭐ LOCAL FIRST (30m / 60m): rebuild the tail from the stored finer series BEFORE
    # taking a provider slot — so neither a full heal pool nor a slow provider can
    # keep a tail the store already holds off the first answer. Its own small thread
    # (the write never runs on the request thread), deduped, waited on briefly.
    if (not date_tf) and last_ts and tf in _DERIVED_TFS and _LOCAL_DERIVE_ENABLED:
        _bounded_job(f"lderive_{ticker_up}_{tf}",
                     lambda: _local_tail_repair(ticker_up, tf, int(last_ts)),
                     _LOCAL_DERIVE_DEADLINE_SECONDS)
        try:
            _lt_now = _sqlite.get_last_ts(ticker_up, tf)
        except Exception:                 # noqa: BLE001
            _lt_now = None
        if _lt_now and int(_lt_now) > int(last_ts):
            if (not _needs_fresh(int(_lt_now), tf)
                    and intraday_tail_status(ticker_up, tf, _lt_now)["tail_status"] != "unverified"):
                _mark_serve("derived-local")
                _kick_tail_gapfill(ticker_up, tf)   # interior holes: provider, background
                done_now = _threading.Event()
                done_now.set()
                return done_now
            last_ts = int(_lt_now)        # the provider fetches only what is still missing
    # ⭐ An interactive INTRADAY repair may draw on the reserved pool (see
    # `_interactive_heal_sem`); everything else competes for the shared one only.
    _slot = _acquire_heal_slot(interactive=(not date_tf) and _request_is_interactive())
    if _slot is None:
        return None
    done = _threading.Event()

    def _job():
        _tail_ok = False
        try:
            if not date_tf:
                # Persists (never an hours-old yfinance fallback — `_needs_fresh` reads
                # last_ts age, not data age) AND records the provider verification.
                # ⭐ TAIL-FIRST: only the missing tail on the request path; the interior
                # gap-fill scan follows in the background once the tail has landed.
                _heal_intraday_tail(ticker_up, tf, last_ts, tail_only=True)
                _tail_ok = True
            else:
                if tf == "D":
                    new = _delta_daily(ticker_up, last_ts)
                elif tf == "W":
                    new = _delta_weekly(ticker_up, last_ts)
                else:
                    new = _delta_monthly(ticker_up, last_ts)
                if new:
                    _sqlite.put_bars(ticker_up, tf, new, date_tf=date_tf)
        except Exception as _e:           # noqa: BLE001 — never raise into a serve
            import logging as _log_bd
            _log_bd.getLogger(__name__).warning(
                "[bars] bounded delta %s tf=%s: %s: %s",
                ticker_up, tf, type(_e).__name__, _e)
        finally:
            _slot.release()
            done.set()
        if _tail_ok:
            _kick_tail_gapfill(ticker_up, tf)

    try:
        _threading.Thread(target=_job, daemon=True,
                          name=f"bars-reqdelta-{ticker_up}-{tf}").start()
    except Exception:                     # noqa: BLE001 — thread exhaustion → serve local
        _slot.release()
        return None
    return done


# ── D/W/M request-path delta: still CORRECT-FIRST, now with a ceiling ────────
# ⛔⛔ D/W/M deliberately keep a blocking first-paint delta (see Layer 4: daily has
# no catch-up poll, so a shed daily would sit stale for 300 s). But "blocking" was
# UNBOUNDED: the Massive client's read timeout is 25 s, so one slow daily delta held
# the request far past the edge's 8 s abort and the edge re-asked WEB_ORIGIN.
# Same job, same persistence, run on its own small pool (NOT the intraday heal
# pools, so a busy intraday tier can never shed a daily) and waited on for at most
# `_DATE_DELTA_DEADLINE_SECONDS` of the request budget. A delta that outlives it
# still lands for the next poll; the request serves the store and is marked
# `delta-deadline` with a short TTL + Retry-After.
_DATE_DELTA_DEADLINE_SECONDS = float(
    _os.environ.get("BARS_DATE_DELTA_DEADLINE_SECONDS", "6.0"))
_DATE_DELTA_MAX = max(1, int(_os.environ.get("BARS_DATE_DELTA_MAX", "8")))
_date_delta_sem = _threading.Semaphore(_DATE_DELTA_MAX)
# ⭐ Warm (`warm=1`) traffic may hold at most this many of the slots, so a list
# pre-warm can never starve the chart a member clicked (review F3).
_DATE_DELTA_WARM_MAX = max(1, min(_DATE_DELTA_MAX - 2, int(
    _os.environ.get("BARS_DATE_DELTA_WARM_MAX", str(max(1, _DATE_DELTA_MAX - 2))))))
_date_delta_warm_sem = _threading.Semaphore(_DATE_DELTA_WARM_MAX)
#: How long an INTERACTIVE request may wait for a free slot (from its budget).
_DATE_DELTA_SLOT_WAIT_S = 1.0
#: In-process (non-edge) callers keep the original blocking semantics, with a
#: generous safety ceiling instead of none.
_DATE_DELTA_INPROC_CEILING_S = 60.0
#: How long an in-process BACKGROUND caller may wait for its warm-share slot.
_DATE_DELTA_BG_SLOT_WAIT_S = 10.0


def _bounded_date_delta(ticker_up: str, tf: str, last_ts, deadline: float | None = None) -> bool:
    """D/W/M delta + persist with a hard wait ceiling. True when it finished in time."""
    if deadline is None:
        deadline = (_DATE_DELTA_DEADLINE_SECONDS if _budget_active()
                    else _DATE_DELTA_INPROC_CEILING_S)
    warm_slot = None
    if _is_background_caller() and not _budget_active():
        # in-process BACKGROUND (prewarm / warm_bars_async): counts against the warm
        # share like warm=1, so it can never hold the slots a click needs (N1). It is
        # not on a member's clock, so it may wait for its share rather than shed.
        if not _date_delta_warm_sem.acquire(timeout=_DATE_DELTA_BG_SLOT_WAIT_S):
            return False
        warm_slot = _date_delta_warm_sem
        got = _date_delta_sem.acquire(timeout=_DATE_DELTA_BG_SLOT_WAIT_S)
    elif _budget_active() and not _request_is_interactive():
        # warm=1 over HTTP: never more than the warm share, never waits for a slot
        if not _date_delta_warm_sem.acquire(blocking=False):
            return False
        warm_slot = _date_delta_warm_sem
        got = _date_delta_sem.acquire(blocking=False)
    else:
        # interactive (or in-process): wait briefly for a slot rather than shed at once
        got = _date_delta_sem.acquire(timeout=_bounded_wait(_DATE_DELTA_SLOT_WAIT_S))
    if not got:
        if warm_slot is not None:
            warm_slot.release()
        return False
    done = _threading.Event()

    def _job():
        try:
            if tf == "D":
                new = _delta_daily(ticker_up, last_ts)
            elif tf == "W":
                new = _delta_weekly(ticker_up, last_ts)
            else:
                new = _delta_monthly(ticker_up, last_ts)
            if new:
                _sqlite.put_bars(ticker_up, tf, new, date_tf=True)
        except Exception as _e:           # noqa: BLE001 — never raise into a serve
            import logging as _log_dd
            _log_dd.getLogger(__name__).warning(
                "[bars] bounded date delta %s tf=%s: %s", ticker_up, tf, type(_e).__name__)
        finally:
            _date_delta_sem.release()
            if warm_slot is not None:
                warm_slot.release()
            done.set()

    try:
        _threading.Thread(target=_job, daemon=True,
                          name=f"bars-datedelta-{ticker_up}-{tf}").start()
    except Exception:                     # noqa: BLE001
        _date_delta_sem.release()
        if warm_slot is not None:
            warm_slot.release()
        return False
    return done.wait(timeout=_bounded_wait(deadline))


# ── Background gap-fill after a tail-first repair (2026-11-10) ───────────────
# The request-path repair is TAIL-ONLY (`_delta_intraday(tail_only=True)`), so the
# interior-hole scan it used to carry (`_DELTA_GAPFILL_DAYS`) runs here instead:
# AFTER the tail has landed and the request has been answered, on its OWN small
# pool (review F2: never `_bg_delta_sem`, which the deep fetch and the SWR depth
# kick need at that same moment, and never the interactive reserve).
# ⭐ NOT DROPPED, NOT LOCKED OUT: a key that finds the pool full is QUEUED (bounded)
# and drained by the next runner to finish; a FAILED pass may retry after
# `_TAIL_GAPFILL_RETRY_S`; only a SUCCESSFUL pass (the provider answered, which
# advances `verified_through`) earns the full cooldown. So a key with holes from the
# prior session heals within seconds of its first open, not "once the pool is idle".
_TAIL_GAPFILL_COOLDOWN_S = float(_os.environ.get("BARS_TAIL_GAPFILL_COOLDOWN_S", "900"))
_TAIL_GAPFILL_RETRY_S = float(_os.environ.get("BARS_TAIL_GAPFILL_RETRY_S", "60"))
_TAIL_GAPFILL_MAX = max(1, int(_os.environ.get("BARS_TAIL_GAPFILL_MAX", "2")))
_TAIL_GAPFILL_QUEUE_MAX = 500
_TAIL_GAPFILL_MAX_KEYS = 20000
_tail_gapfill_sem = _threading.Semaphore(_TAIL_GAPFILL_MAX)
_tail_gapfill_at: dict = {}          # key -> monotonic instant before which no new pass
_tail_gapfill_pending: dict = {}     # insertion-ordered queue of keys waiting for a slot
_tail_gapfill_lock = _threading.Lock()


def _gapfill_disabled_in_tests() -> bool:
    return bool(_os.environ.get("PYTEST_CURRENT_TEST"))


def _kick_tail_gapfill(ticker_up: str, tf: str) -> bool:
    """Schedule the full-window gap-fill pass for (ticker, tf). True when started now."""
    if _DELTA_GAPFILL_DAYS <= 0 or tf not in ("1", "5", "15", "30", "60"):
        return False
    # pytest NO-OP (same reason as `_maybe_kick_deepfill`): a background thread that
    # outlives a test's monkeypatches would reach the real provider / store.
    if _gapfill_disabled_in_tests():
        return False
    key = (ticker_up, tf)
    now = _time.monotonic()
    with _tail_gapfill_lock:
        until = _tail_gapfill_at.get(key)
        if until is not None and now < until:
            return False
        if not _tail_gapfill_sem.acquire(blocking=False):
            if key not in _tail_gapfill_pending and len(_tail_gapfill_pending) < _TAIL_GAPFILL_QUEUE_MAX:
                _tail_gapfill_pending[key] = True
            return False
        if len(_tail_gapfill_at) >= _TAIL_GAPFILL_MAX_KEYS:
            _tail_gapfill_at.clear()        # bounded; a cleared map costs one extra scan
        _tail_gapfill_at[key] = now + _TAIL_GAPFILL_RETRY_S     # in flight / failed
        _tail_gapfill_pending.pop(key, None)
    return _start_tail_gapfill(key)


def _start_tail_gapfill(key) -> bool:
    """Run one pass on an ALREADY-ACQUIRED `_tail_gapfill_sem` slot; on finish, hand the
    slot to the oldest queued key (if any) instead of releasing it."""
    def _run(k=key):
        while k is not None:
            t_up, t_tf = k
            started = _time.time()
            try:
                lt = _sqlite.get_last_ts(t_up, t_tf)
                if lt:
                    _heal_intraday_tail(t_up, t_tf, int(lt))
                vt = tail_verified_through(t_up, t_tf)
                if vt is not None and vt >= started:          # the provider answered
                    with _tail_gapfill_lock:
                        _tail_gapfill_at[k] = _time.monotonic() + _TAIL_GAPFILL_COOLDOWN_S
            except Exception as _e:           # noqa: BLE001 — background, never raises
                import logging as _log_gf
                _log_gf.getLogger(__name__).warning(
                    "[bars] tail gap-fill %s tf=%s: %s", t_up, t_tf, type(_e).__name__)
            k = None
            with _tail_gapfill_lock:
                now = _time.monotonic()
                while _tail_gapfill_pending:
                    nk = next(iter(_tail_gapfill_pending))
                    _tail_gapfill_pending.pop(nk, None)
                    until = _tail_gapfill_at.get(nk)
                    if until is None or now >= until:
                        _tail_gapfill_at[nk] = now + _TAIL_GAPFILL_RETRY_S
                        k = nk
                        break
                if k is None:
                    # ⛔ RELEASE UNDER THE LOCK (review #1034 N2). Released after the
                    # lock, a kick landing in between saw the pool still full, queued
                    # its key, and this runner then exited without draining it — the
                    # key waited for some unrelated future kick. `_kick_tail_gapfill`
                    # acquires under this same lock, so it now sees either a runner
                    # that will drain its queued key or a free slot.
                    _tail_gapfill_sem.release()

    try:
        _threading.Thread(target=_run, daemon=True,
                          name=f"bars-gapfill-{key[0]}-{key[1]}").start()
    except Exception:                     # noqa: BLE001
        _tail_gapfill_sem.release()
        return False
    return True


# The deep-pan / large-window fetch has its own, LONGER ceiling. ⛔ It must still
# have one: `_is_deep_request(bars)` is True for any request ≥ 1200 bars, and that
# includes the FIRST PAINT of every custom timeframe — `_customBaseBars` is a flat
# 5000, so a 2m chart's initial load is classified as a deep backfill and took this
# synchronous branch. On a cold symbol that is the 16-second path again, by a
# different door.
#
# ⭐ LONGER, NOT EQUAL, BECAUSE A PAN IS AN EXPLICIT ASK. A user who drags into
# history has asked for a 3-20 s fetch and the old behaviour (block, then paint the
# deep window) is right for them. 6 s keeps that intent while staying under the
# edge's 8 s abort, so the double-origin path stays unreachable either way.
_DEEP_DEADLINE_SECONDS = float(
    _os.environ.get("BARS_DEEP_DEADLINE_SECONDS", "6.0")
)


def _bounded_fetch_intraday(ticker_up: str, tf: str, bars: int,
                            deadline: float | None = None) -> bool:
    """Run the deep intraday fetch with a hard wait ceiling.

    Same contract as `_bounded_delta`: True when it finished inside the deadline,
    and the job is never cancelled — a shed fetch still persists for the next poll.
    """
    if deadline is None:
        deadline = _DEEP_DEADLINE_SECONDS
    done = _start_bounded_fetch_intraday(ticker_up, tf, bars)
    if done is None:
        return False
    return done.wait(timeout=_bounded_wait(deadline))


def _start_bounded_fetch_intraday(ticker_up: str, tf: str, bars: int):
    """Start the deep fetch job WITHOUT waiting; its done-Event, or None (no slot)."""
    if not _bg_delta_sem.acquire(blocking=False):
        return None
    done = _threading.Event()

    def _job():
        try:
            raw = _fetch_intraday(ticker_up, tf, bars)
            if raw and not _is_intraday_stale(raw):
                _put_fetched_intraday(ticker_up, tf, raw)   # fallback = add-only
                _mark_history_complete(ticker_up, tf)       # refuses a fallback answer
        except Exception as _e:           # noqa: BLE001
            import logging as _log_bf
            _log_bf.getLogger(__name__).warning(
                "[bars] bounded deep fetch %s tf=%s: %s: %s",
                ticker_up, tf, type(_e).__name__, _e)
        finally:
            _bg_delta_sem.release()
            done.set()

    try:
        _threading.Thread(target=_job, daemon=True,
                          name=f"bars-deepfetch-{ticker_up}-{tf}").start()
    except Exception:                     # noqa: BLE001
        _bg_delta_sem.release()
        return None
    return done


def warm_bars_async(tickers: list[str], tf: str = "D", bars: int = 8000) -> None:
    """Fire-and-forget cache warmer. Submits one task per ticker to a bounded
    thread pool and returns immediately. Errors are silenced (best-effort).

    Caller should pass a SHORT list (≤30) to avoid swamping the upstream API.
    """
    if not tickers:
        return

    def _warm_one(t: str) -> None:
        set_background_caller(True)       # warm share of the D/W/M pool (N1)
        try:
            _get_bars_inner(t, tf, bars)
        except Exception:
            pass  # warming is best-effort; don't poison the executor
        finally:
            set_background_caller(False)

    seen: set[str] = set()
    for t in tickers:
        if not t or t in seen:
            continue
        seen.add(t)
        try:
            _bars_warm_pool.submit(_warm_one, t)
        except RuntimeError:
            # Executor shut down (app stopping) — drop silently
            return


# ─── Universe warm: scheduled bulk pre-cache ──────────────────────────────────
# State for the long-running universe warm. Tracked in module globals so the
# admin endpoint can return live progress and prevent overlapping runs.
_warm_state = {
    "running": False,
    "started_at": None,
    "total": 0,
    "done": 0,
    "skipped": 0,
    "errors": 0,
    "tf": None,
    "started_iso": None,
    "completed_iso": None,
}
_warm_state_lock = _threading.Lock()


def _build_universe_ticker_list() -> list[str]:
    """Build the combined ticker list to warm: priority + breadth-list + cap-universe."""
    PRIORITY = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'NVDA', 'MSFT', 'TSLA',
                'AMZN', 'META', 'GOOGL', 'AMD', 'AVGO', 'SMCI', 'PLTR', 'ARM',
                'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM', 'ORCL', 'UBER']
    seen: set[str] = set()
    out: list[str] = []
    for t in PRIORITY:
        if t not in seen:
            seen.add(t)
            out.append(t)

    # Breadth-list tickers next (most-likely to be drilled today)
    try:
        from api.services import breadth_monitor as _bm
        latest = _bm.get_latest()
        if latest:
            for k, v in latest.items():
                if not k.endswith('_list') or not isinstance(v, list):
                    continue
                for item in v:
                    if isinstance(item, dict):
                        sym = item.get('t')
                        if sym and sym.upper() not in seen:
                            seen.add(sym.upper())
                            out.append(sym.upper())
    except Exception:
        pass

    # Full $300M+ cap universe last
    try:
        cap_path = _os.path.join(
            _os.path.dirname(_os.path.dirname(__file__)),
            "data", "cap_universe.json",
        )
        if _os.path.exists(cap_path):
            with open(cap_path) as f:
                cap_tickers = _json.load(f)
            for t in cap_tickers:
                if t and t.upper() not in seen:
                    seen.add(t.upper())
                    out.append(t.upper())
    except Exception:
        pass

    return out


def _run_universe_warm(tickers: list[str], tf: str, bars_count: int) -> None:
    """Warm the disk cache for `tickers`. Runs in a daemon thread; updates
    _warm_state as it progresses so /api/admin/warm-universe-status can report.

    Already-cached tickers are skipped (no Massive call). Cold tickers are
    submitted to the bars-warm pool (4 workers) so live API requests aren't
    blocked. This typically completes in 1-3 hours for ~3,700 tickers.
    """
    from concurrent.futures import as_completed
    with _warm_state_lock:
        _warm_state.update({
            "running": True,
            "started_at": _time.time(),
            "started_iso": datetime.utcnow().isoformat() + "Z",
            "completed_iso": None,
            "total": len(tickers),
            "done": 0,
            "skipped": 0,
            "errors": 0,
            "tf": tf,
        })

    futures = []
    for sym in tickers:
        # Quick path: skip if disk cache already has it.
        try:
            if disk_cache.get(sym, tf, bars_count) is not None:
                with _warm_state_lock:
                    _warm_state["skipped"] += 1
                    _warm_state["done"] += 1
                continue
        except Exception:
            pass

        def _task(s=sym):
            try:
                _get_bars_inner(s, tf, bars_count)
                return True
            except Exception:
                return False

        try:
            futures.append(_bars_warm_pool.submit(_task))
        except RuntimeError:
            break  # pool shutting down

    for fut in as_completed(futures):
        try:
            ok = fut.result()
        except Exception:
            ok = False
        with _warm_state_lock:
            _warm_state["done"] += 1
            if not ok:
                _warm_state["errors"] += 1

    with _warm_state_lock:
        _warm_state["running"] = False
        _warm_state["completed_iso"] = datetime.utcnow().isoformat() + "Z"


def _check_admin_auth(request: Request) -> None:
    secret = _os.environ.get("PUSH_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="PUSH_SECRET not configured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def _run_universe_warm_multi_tf(tickers: list[str], tfs: list[str], bars_count: int) -> None:
    """Run _run_universe_warm sequentially across multiple TFs.

    TFs are processed in priority order (Daily first, then Weekly, then
    intraday) so the most-viewed TF is hot earliest. Aggregate progress is
    reported in _warm_state.
    """
    from concurrent.futures import as_completed
    total_jobs = len(tickers) * len(tfs)
    with _warm_state_lock:
        _warm_state.update({
            "running": True,
            "started_at": _time.time(),
            "started_iso": datetime.utcnow().isoformat() + "Z",
            "completed_iso": None,
            "total": total_jobs,
            "done": 0,
            "skipped": 0,
            "errors": 0,
            "tf": ",".join(tfs),
        })

    for tf in tfs:
        futures = []
        is_deep_tf = tf in ("D", "W", "M")
        for sym in tickers:
            # For D/W/M we always re-warm because users may have already
            # populated the cache with Massive-only data via a normal /api/bars
            # request. Skipping would leave us with shallow history forever.
            if not is_deep_tf:
                try:
                    if disk_cache.get(sym, tf, bars_count) is not None:
                        with _warm_state_lock:
                            _warm_state["skipped"] += 1
                            _warm_state["done"] += 1
                        continue
                except Exception:
                    pass

            def _task(s=sym, t=tf, deep=is_deep_tf):
                try:
                    if deep:
                        # Deep warm: Massive + yfinance merged for full history.
                        # MUST write to SQLite (the audit's source of truth and
                        # _get_bars_inner's Layer 2). Earlier revisions wrote
                        # only to disk_cache + memory; that left SQLite empty
                        # for any ticker that hadn't been organically browsed,
                        # so audits showed bars_compared:0 and SWR delta-fetches
                        # had no last_ts to delta from. Persist to SQLite first
                        # then write the disk + memory layers as serving caches.
                        if t == 'D':
                            data = _fetch_daily(s, bars_count, deep=True)
                        elif t == 'W':
                            data = _fetch_weekly(s, bars_count, deep=True)
                        elif t == 'M':
                            data = _fetch_monthly(s, bars_count, deep=True)
                        else:
                            data = []
                        if data:
                            ticker_up = s.upper()
                            try:
                                _sqlite.put_bars(ticker_up, t, data, date_tf=True)
                            except Exception as _e:
                                # Persistence is the load-bearing write; if it
                                # fails the warm hasn't actually happened. Mark
                                # this ticker as failed instead of pretending
                                # success on the back of the disk_cache write.
                                import logging as _log_w
                                _log_w.getLogger(__name__).error(
                                    f"[warm] sqlite put_bars failed {ticker_up} tf={t}: "
                                    f"{type(_e).__name__}: {_e}"
                                )
                                return False
                            payload = {"ticker": ticker_up, "tf": t, "bars": data}
                            try:
                                disk_cache.put(ticker_up, t, bars_count, payload)
                                cache.set(f"bars_{ticker_up}_{t}_{bars_count}", payload, ttl=_CACHE_TTL.get(t, 300))
                            except Exception:
                                pass
                            return True
                        return False
                    # Intraday: standard cache fill via _get_bars_inner
                    _get_bars_inner(s, t, bars_count)
                    return True
                except Exception:
                    return False

            try:
                futures.append(_bars_warm_pool.submit(_task))
            except RuntimeError:
                break

        for fut in as_completed(futures):
            try:
                ok = fut.result()
            except Exception:
                ok = False
            with _warm_state_lock:
                _warm_state["done"] += 1
                if not ok:
                    _warm_state["errors"] += 1

    with _warm_state_lock:
        _warm_state["running"] = False
        _warm_state["completed_iso"] = datetime.utcnow().isoformat() + "Z"


# Default warm set: Daily first (dominant scan TF), then Weekly/Monthly for
# context, then intraday in descending order. Caller can override with ?tfs=.
_DEFAULT_WARM_TFS = ["D", "W", "M", "60", "30", "15", "5", "1"]


def serve_warm_from_cache(ticker: str, tf: str, bars: int):
    """A `warm=1` prefetch served from the CHEAP tiers ONLY (mem → SQLite), never the
    provider. Returns a JSONResponse on a cache hit, or None when nothing usable is
    cached (the caller then sheds a 503).

    ⭐ WHY (market-open HAR, 2026-09-01). The warm-serve semaphore sheds ALL warm
    prefetches under load. But a warm that's already in bars.db costs the pool almost
    nothing to serve, and shedding it defeats list pre-warming at the single MOST
    IMPORTANT moment — the open — when the pool is busiest AND the bars are already
    warm (the instant-symbol universe). So serve a cache hit even when every warm slot
    is full; reserve the shed for a warm that would need an expensive cold provider
    fetch. Freshness is the VISIBLE chart's own (non-warm) fetch's job — this only
    seeds the browser's cache so the click paints instantly, then refreshes.

    Never touches provider/index/breadth/delisted paths — pure cheap probe. Never
    raises (returns None on any error → the caller sheds cleanly).
    """
    try:
        ticker_up = ticker.upper()
        cache_key = f"bars_{ticker_up}_{tf}_{bars}"
        cached = cache.get(cache_key)
        if cached is not None:
            _mark_serve("warm-mem")
            return JSONResponse(
                content=cached,
                headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
            )
        last_ts = _sqlite.get_last_ts(ticker_up, tf)
        if last_ts is None:
            return None
        stored_rows = _sqlite.get_bars(ticker_up, tf, bars)
        # Require a COMPLETE-enough set (mirror the serve path's guard) so a warm never
        # seeds the browser a truncated series that the chart would then have to refill.
        if not stored_rows or not (
            len(stored_rows) >= bars * 0.9 or _history_complete(ticker_up, tf)
        ):
            return None
        payload = {"ticker": ticker_up, "tf": tf, "bars": _fmt_sqlite_bars(stored_rows, tf, ticker_up)}
        # ⛔⛔ CACHE MAY PROVIDE HISTORY; IT MAY NOT CREATE CURRENTNESS (2026-09-28).
        # `cache_key` is the SAME Layer-1 entry the member's own chart request reads.
        # Writing unchecked rows into it here meant a warm prefetch of a stale tail
        # answered the next interactive request from memory — skipping the repair for
        # the whole TTL (900 s on W). Only a store the serve path itself would call
        # fresh may be published there; otherwise the warm is served, not cached.
        if not _needs_fresh(last_ts, tf):
            cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
        _mark_serve("warm-sqlite")
        return JSONResponse(
            content=payload,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )
    except Exception:
        return None


def _get_bars_inner(ticker: str, tf: str, bars: int):  # noqa: C901
    _mark_serve("miss")  # default; each serve path below overwrites it
    _time_reset()        # behavior-neutral phase timing (Server-Timing sub-metrics)
    ticker_up = ticker.upper()
    # Market indices (^IXIC etc.) live only in yfinance — short-circuit the
    # whole Massive/SQLite path. Used by the Model Book index-comparison pane.
    if _is_yf_only_symbol(ticker_up):
        _mark_serve("yf-only")
        return _yf_only_bars_response(ticker_up, tf, bars)
    _record_intraday_request(ticker_up, tf)
    # On-demand deep gap-fill of the viewed range (background, throttled, bounded;
    # fills interior holes at ANY history depth the user pans to). Never blocks.
    _maybe_kick_deepfill(ticker_up, tf, bars)
    cache_key = f"bars_{ticker_up}_{tf}_{bars}"
    date_tf   = tf in ("D", "W", "M")

    # ── Layer 1: In-memory TTL cache (<1 ms) ─────────────────────────────────
    cached = cache.get(cache_key)
    if cached is not None:
        _mark_serve("mem")
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
        )

    # ── Layer 2: SQLite persistent store (<5 ms) ──────────────────────────────
    _time_ck("pre_sqlite")
    last_ts     = _sqlite.get_last_ts(ticker_up, tf)
    _time_ck("last_ts")
    stored_rows = _sqlite.get_bars(ticker_up, tf, bars) if last_ts is not None else []
    _time_ck("get_bars")
    # 60m grid migration, serve-time half (the bounded boot sweep is the other):
    # rows in the pre-2026-11-10 clock-hour layout are never served. The ticker's
    # 60m is REBUILT locally from its stored 15m/30m (no provider call) and re-read;
    # depth the finer stores lack is refilled by the normal partial-depth path.
    if tf == "60" and stored_rows and any(_sqlite.is_old_grid_60m_ts(r[0]) for r in stored_rows):
        try:
            rebuild_sixty_min_grid(ticker_up)
            last_ts = _sqlite.get_last_ts(ticker_up, tf)
            stored_rows = _sqlite.get_bars(ticker_up, tf, bars) if last_ts is not None else []
        except Exception:  # noqa: BLE001 — never serve the old grid: go cold instead
            last_ts, stored_rows = None, []

    # SQLite has fresh data AND enough rows for this request count.
    # The "len(stored_rows) >= bars * 0.9" check catches the case where SQLite
    # was previously populated with fewer bars than the user is now asking for
    # (e.g., a small bars=10 admin call populated SQLite with 10 rows, then a
    # chart asks for bars=300 — without this check the endpoint would happily
    # serve 10 rows because they're "fresh", leaving a huge gap on the chart).
    # Fall through to the stale-while-revalidate path when we have data but
    # less than requested — bg fetch will populate the missing depth.
    try:
        from api.services import bars_live_store as _bls
        _live = _bls.covered(ticker_up, tf)
    except Exception:
        _bls, _live = None, False
    _time_ck("live_cov")
    _fresh_needed = _needs_fresh(last_ts, tf, ticker_up) if stored_rows else True
    if stored_rows and not _fresh_needed and (
        len(stored_rows) >= bars * 0.9 or _history_complete(ticker_up, tf)
        or (_live and bars <= _bls.LIVE_HISTORY_MAX_BARS and _bls.history_complete(ticker_up, tf))
    ):
        # SQLite has enough fresh data (or holds the full available history,
        # which is < bars for stocks shorter-lived than the request) — serve
        # immediately, no API call.
        _mark_serve("sqlite")
        _time_ck("fresh_ck")
        payload = {"ticker": ticker_up, "tf": tf, "bars": _fmt_sqlite_bars(stored_rows, tf, ticker_up)}
        _time_ck("fmt")
        # A live-fed series changes every few seconds: never pin it in memory for the
        # normal 300 s daily TTL, or the developing candle would freeze for minutes.
        _ttl = _bls.covered_cache_ttl(tf, _CACHE_TTL.get(tf, 300)) if _live else _CACHE_TTL.get(tf, 300)
        cache.set(cache_key, payload, ttl=_ttl)
        return JSONResponse(
            content=payload,
            headers={"Cache-Control": f"public, max-age={_ttl}"},
        )

    # Cold-stale intraday (missing >=1 whole session) must NOT be served
    # stale-while-revalidate — charts fetch once per mount, so they'd pin
    # the frozen first paint and never pick up the bg heal (the May-8
    # universe-freeze bug). Fall through to Layer 4's synchronous,
    # de-duplicated delta fetch so the FIRST paint is already correct.
    # Same-session staleness still uses fast SWR below (serve instantly,
    # top up the developing bar in the background).
    # Cold-stale DAILY (missing >=1 completed session) gets the same
    # synchronous-first-paint treatment as cold-stale intraday — see
    # `_is_cold_stale_daily`. Without this, a daily cache stuck on the prior
    # session is served stale-while-revalidate and the live overlay fuses
    # today's price onto the frozen bar ("daily not recognizing today",
    # 2026-06-15). Same-session evolving dailies (last_ts == today) are NOT
    # cold-stale, so they keep the fast SWR developing-bar top-up.
    if (
        stored_rows and last_ts
        and (not _is_cold_stale_intraday(tf, last_ts) or _intraday_deblockable(tf, last_ts))
        and (not _is_cold_stale_daily(tf, last_ts) or _daily_deblockable(tf, last_ts))
        and not _is_cold_stale_weekly(tf, last_ts)
    ):
        # Partial cache: SQLite has SOME rows but fewer than the chart asked
        # for. The block above ("len(stored_rows) >= bars * 0.9") falls
        # through here on purpose so the bg path can populate the missing
        # historical depth — but a delta-only refresh fetches AFTER last_ts,
        # which is "today," so it returns nothing and the chart is stuck at
        # the truncated row count forever. Promote partial-cache bg fetches
        # to a full fetch so put_bars (INSERT OR REPLACE) actually fills the
        # gap. Symptom this fixes: warm-universe completed but NVDA/AAPL
        # only had 6 of 200 bars cached and never recovered.
        # ...unless we've already pulled the full available history (the deep
        # backfill of a stock with fewer bars than requested) — then it's NOT
        # partial; only a delta is needed. Without this guard such a chart would
        # re-run the full yfinance/Massive pull on every poll forever.
        is_partial = len(stored_rows) < bars * 0.9 and not _history_complete(ticker_up, tf)

        # Deep INTRADAY pan-backfill is served SYNCHRONOUSLY (2026-07-02).
        # A deep request (bars >= _DEEP_REQUEST_THRESHOLD) on an intraday TF
        # only fires when the user pans into history they don't have — the
        # old stale+bg path answered that explicit ask with the same shallow
        # window (the client treats a non-delta response as authoritative and
        # won't re-poll for up to 30s; a TF switch resets depth), so panning
        # visibly loaded nothing: "intraday won't load more than 1 day."
        # Mirrors the cold-stale synchronous precedent; the inflight dedup in
        # Layer 4 prevents a stampede and _mark_history_complete prevents
        # refetch loops, so each (ticker, tf) pays the ~3-8s fetch once.
        # D/W/M deliberately KEEP the background path — their 2.5s dwell-warm
        # fires on every chart open and must never block a request thread.
        if is_partial and _is_deep_request(bars) and tf in ("1", "5", "15", "30", "60"):
            with _inflight_lock:
                if cache_key in _inflight:
                    deep_waiter, i_fetch_deep = _inflight[cache_key], False
                else:
                    deep_waiter = _threading.Event()
                    _inflight[cache_key] = deep_waiter
                    i_fetch_deep = True
            if i_fetch_deep:
                try:
                    # ⭐⭐ TAIL FIRST (2026-11-10). The deep branch used to run ONLY the
                    # full-depth fetch; when that was shed, slow, or came back without
                    # today (validation fallback), the stale tail was served AND pinned
                    # for the full TTL — measured 2026-11-10 RTH: UPST 60m bars=2000
                    # served a tail 4h behind while bars=600 of the same key was current.
                    # The bounded tail-only repair runs first so the answer reaches the
                    # live bucket even when the depth has to wait for the re-poll.
                    # ⭐ Both jobs start NOW and run IN PARALLEL (review F5): the tail
                    # waits its own short ceiling, the depth fetch the rest of the
                    # request budget — never their sum.
                    _tail_ev = (_start_bounded_delta(ticker_up, tf, last_ts, False)
                                if _fresh_needed else None)
                    # ⛔ BOUNDED (was a bare `_fetch_intraday` on the request thread).
                    # A shed fetch still persists, so the next poll paints the deep
                    # window; what it can no longer do is hold the request past the
                    # edge's 8 s abort. See `_bounded_fetch_intraday`.
                    _deep_ev = _start_bounded_fetch_intraday(ticker_up, tf, bars)
                    _deep_tail_ok = (not _fresh_needed) or (
                        _tail_ev is not None
                        and _tail_ev.wait(timeout=_bounded_wait(_REQUEST_DEADLINE_SECONDS)))
                    _deep_ok = _deep_ev is not None and _deep_ev.wait(
                        timeout=_bounded_wait(_DEEP_DEADLINE_SECONDS))
                    if not _deep_ok:
                        _mark_serve("deep-deadline")
                    if not _deep_tail_ok:
                        _mark_serve("delta-deadline")
                    fresh_rows = _sqlite.get_bars(ticker_up, tf, bars)
                    payload = {
                        "ticker": ticker_up, "tf": tf,
                        "bars": _fmt_sqlite_bars(fresh_rows or stored_rows, tf, ticker_up),
                    }
                    if payload["bars"]:
                        # A shed tail or depth must not pin the partial answer for a
                        # full TTL — same rule as the same-session branch below.
                        cache.set(cache_key, payload,
                                  ttl=_CACHE_TTL.get(tf, 300) if (_deep_ok and _deep_tail_ok) else 5)
                    return JSONResponse(
                        content=payload,
                        headers={"Cache-Control": "public, max-age=5"},
                    )
                except Exception as _deep_e:
                    import logging as _log_deep
                    _log_deep.getLogger(__name__).error(
                        f"[bars] deep intraday sync fetch failed {ticker_up} tf={tf}: "
                        f"{type(_deep_e).__name__}: {_deep_e}"
                    )
                    # Fall through to the stale-serve below — same UX as before.
                finally:
                    with _inflight_lock:
                        _inflight.pop(cache_key, None)
                    deep_waiter.set()
            else:
                # Another request is already deep-fetching this key — wait
                # briefly, then serve whatever is freshest.
                # ⛔ Was 12 s — past the edge's 8 s abort. Now the fetcher's own ceiling
                # (+0.5 s so the waiter loses the race), capped by the request budget.
                deep_waiter.wait(timeout=_bounded_wait(_DEEP_DEADLINE_SECONDS + 0.5))
                hit = cache.get(cache_key)
                if hit is not None:
                    return JSONResponse(
                        content=hit,
                        headers={"Cache-Control": "public, max-age=5"},
                    )

        # SAME-SESSION STALE intraday on the FIRST PAINT (no `since`): serve it
        # SYNCHRONOUSLY, not stale-while-revalidate. `_is_cold_stale_intraday` only
        # catches SESSION-scale staleness, so a cache that's a few bars behind "now"
        # (e.g. prewarmed 15 min ago) fell through to the async bg heal below — the
        # missing recent bars then showed as a blank GAP behind the live developing
        # candle until the next 30s poll ("first flip to intraday is missing candles").
        # The browser's `since=` delta path already fetches synchronously; give the
        # first paint the same. Only first paints reach this function (repeat polls
        # carry `since`), so this adds NO latency to steady-state polling. Bounded: a
        # small trailing delta, _inflight-deduped, intraday only, and only when the
        # cache has enough rows (partial/deep depth is handled by the branches above).
        # PHASE 1 (BARS_INTRADAY_ASYNC_HEAL): when the tail is a DEBLOCKABLE cold-stale
        # (carries the last closed session, missing only today's forming bars), skip
        # this synchronous delta and let the stale-serve + bg heal below run — the
        # client paints the prior-session tail instantly and `since=` fills today, so
        # blocking the first paint on a provider call buys nothing.
        # ⭐⭐ PARTIAL DEPTH NO LONGER SKIPS THE TAIL (2026-11-10). This branch used to
        # require `not is_partial`, so a key whose stored depth was short of the ask
        # (the per-process `histfull_` marker is lost on every restart, so this is
        # common) fell straight to stale-while-revalidate with a FULL-depth bg fetch —
        # measured 2026-11-10 RTH: ONON 15m first answer 4 h stale (`stale-swr`). Now
        # the tail is repaired synchronously (tail-only, bounded) for partial keys
        # too, and the partial key then falls through to the SWR block below, which
        # serves the repaired rows and still kicks the bg depth fetch.
        _sd_partial = is_partial
        _sd_ran_partial = False
        if (
            tf in ("1", "5", "15", "30", "60")
            and (not is_partial or _fresh_needed)
            and not _intraday_deblockable(tf, last_ts)
        ):
            with _inflight_lock:
                if cache_key in _inflight:
                    _sd_wait, _sd_do = _inflight[cache_key], False
                else:
                    _sd_wait = _threading.Event()
                    _inflight[cache_key] = _sd_wait
                    _sd_do = True
            if _sd_do:
                try:
                    # ⛔ BOUNDED (2026-09-28). This was a bare `_delta_intraday` + `put_bars`
                    # on the request thread — the last unbounded one. Under a held SQLite
                    # write lock the put waited out its 30 s busy_timeout, the edge aborted
                    # at 8 s and fell back to the WEB pod (a different store). Same ceiling
                    # and same capacity pools as Layer 4: a shed repair serves the store now
                    # and the response is marked unverified by the router.
                    _sd_done = _bounded_delta(ticker_up, tf, last_ts, False)
                    if not _sd_done:
                        _mark_serve("sd-deadline")
                    _sd_rows = _sqlite.get_bars(ticker_up, tf, bars) if _sd_done else stored_rows
                    if _sd_partial:
                        # Depth is still short: hand the (now tail-repaired) rows to the
                        # stale-while-revalidate block below, which serves them and kicks
                        # the bg depth fetch. `finally` frees the inflight key first.
                        stored_rows = _sd_rows or stored_rows
                        _sd_ran_partial = True
                        if _sd_done:
                            _mark_serve("sd-partial")
                    else:
                        payload = {
                            "ticker": ticker_up, "tf": tf,
                            "bars": _fmt_sqlite_bars(_sd_rows or stored_rows, tf, ticker_up),
                        }
                        if payload["bars"]:
                            # A shed repair must not pin the unrepaired rows for a full TTL.
                            cache.set(cache_key, payload,
                                      ttl=_CACHE_TTL.get(tf, 300) if _sd_done else 5)
                        return JSONResponse(
                            content=payload,
                            headers={"Cache-Control": "public, max-age=5"},
                        )
                except Exception as _sd_e:
                    import logging as _log_sd
                    _log_sd.getLogger(__name__).error(
                        f"[bars] sync intraday delta failed {ticker_up} tf={tf}: "
                        f"{type(_sd_e).__name__}: {_sd_e}"
                    )
                    # Fall through to the stale-serve below — same UX as before.
                finally:
                    with _inflight_lock:
                        _inflight.pop(cache_key, None)
                    _sd_wait.set()
            else:
                # ⛔ Was 8 s — AT the edge abort. The fetcher's own ceiling (+0.5 s so
                # the waiter loses the race), capped by the request budget.
                _sd_wait.wait(timeout=_bounded_wait(_REQUEST_DEADLINE_SECONDS + 0.5))
                hit = cache.get(cache_key)
                if hit is not None:
                    return JSONResponse(
                        content=hit,
                        headers={"Cache-Control": "public, max-age=5"},
                    )

        # Stale-while-revalidate: SQLite has data but it needs updating.
        # Serve the stale data immediately (no spinner) and refresh in the background.
        # The browser's SWR will revalidate after a short TTL and pick up fresh data.
        stale_payload = {"ticker": ticker_up, "tf": tf, "bars": _fmt_sqlite_bars(stored_rows, tf, ticker_up)}
        cache.set(cache_key, stale_payload, ttl=12)  # short TTL so next poll gets fresh

        with _inflight_lock:
            # Only spawn a bg refresh if this key isn't already in flight AND we
            # have a free bars-bg slot. When the semaphore is full we skip the
            # spawn entirely — the stale payload is still served below and SWR
            # retries shortly, so freshness lags at most one poll instead of
            # the pod melting down under an unbounded thread pile-up.
            if cache_key not in _inflight and _bg_delta_sem.acquire(blocking=False):
                _bg_ev = _threading.Event()
                _inflight[cache_key] = _bg_ev

                def _bg_delta(
                    _key=cache_key, _sym=ticker_up, _tf=tf, _bars=bars,
                    _last_ts=last_ts, _stored=stored_rows, _ev=_bg_ev, _dtf=date_tf,
                    _partial=is_partial,
                ):
                    try:
                        if _partial:
                            # Full fetch — cache is missing historical depth.
                            # put_bars uses INSERT OR REPLACE so this merges
                            # with any existing rows instead of duplicating.
                            # A deep backfill (bars above the first-paint window)
                            # pulls the yfinance pre-2003 IPO tail for D/W/M.
                            _deep = _is_deep_request(_bars)
                            if _tf in ("1", "5", "15", "30", "60"):
                                new = _fetch_intraday(_sym, _tf, _bars)
                            elif _tf == "W":
                                new = _fetch_weekly(_sym, _bars, deep=_deep)
                            elif _tf == "M":
                                new = _fetch_monthly(_sym, _bars, deep=_deep)
                            else:
                                new = _fetch_daily(_sym, _bars, deep=_deep)
                            # Mirror cold-fetch guard: don't persist stale
                            # intraday fallback (yfinance returning hours-old
                            # data) since it'd be served as fresh next time.
                            if new and (_dtf or not _is_intraday_stale(new)):
                                if _dtf:
                                    _sqlite.put_bars(_sym, _tf, new, date_tf=_dtf)
                                else:
                                    _put_fetched_intraday(_sym, _tf, new)   # fallback = add-only
                                # Mark full history loaded so a request larger
                                # than the stock's lifetime doesn't re-fetch every
                                # poll (the len>=bars*0.9 gate would never pass).
                                if _deep:
                                    _mark_history_complete(_sym, _tf)
                        else:
                            if _tf == "D":
                                new = _delta_daily(_sym, _last_ts)
                            elif _tf == "W":
                                new = _delta_weekly(_sym, _last_ts)
                            elif _tf == "M":
                                new = _delta_monthly(_sym, _last_ts)
                            else:
                                # Persists + records provider verification.
                                new = _heal_intraday_tail(_sym, _tf, _last_ts)
                            if new and _dtf:
                                _sqlite.put_bars(_sym, _tf, new, date_tf=_dtf)
                        # Re-read only when the delta actually advanced the store. When
                        # `new` is empty the SQLite rows are unchanged, so reuse the rows
                        # the serve already read — this skips a redundant multi-thousand-row
                        # get_bars().fetchall() (SQLite-C holds the GIL) on every idle poll,
                        # which is the dominant bg-delta contention under a warm flood.
                        fresh_rows = _sqlite.get_bars(_sym, _tf, _bars) if new else _stored
                        fresh_payload = {
                            "ticker": _sym, "tf": _tf,
                            "bars": _fmt_sqlite_bars(fresh_rows or _stored, _tf, _sym),
                        }
                        # Only cache with the full TF TTL when the bg fetch
                        # actually advanced the data. When `new` is empty, the
                        # delta-fetch either silently failed (httpx pool
                        # exhaustion, network blip, Polygon hiccup) or returned
                        # no new bars. Caching the unchanged stale payload
                        # with a 5-minute TTL traps the chart in stale state
                        # for that whole window — every subsequent request
                        # within 5min hits Layer 1 cache and skips the SWR
                        # path that would otherwise retry the bg fetch.
                        # Use a short retry TTL so we re-attempt soon.
                        if new:
                            cache.set(_key, fresh_payload, ttl=_CACHE_TTL.get(_tf, 300))
                        else:
                            cache.set(_key, fresh_payload, ttl=15)
                    except Exception as _bg_e:
                        import logging as _log_bg
                        _log_bg.getLogger(__name__).error(
                            f"[bars] bg_delta {_sym} tf={_tf} partial={_partial}: "
                            f"{type(_bg_e).__name__}: {_bg_e}"
                        )
                    finally:
                        with _inflight_lock:
                            _inflight.pop(_key, None)
                        _ev.set()
                        _bg_delta_sem.release()  # free the bars-bg slot

                try:
                    _threading.Thread(
                        target=_bg_delta, daemon=True,
                        name=f"bars-bg-{ticker_up}-{tf}{'-partial' if is_partial else ''}",
                    ).start()
                except Exception:
                    # Thread couldn't start (e.g. process at its thread ceiling).
                    # Undo the slot + inflight reservation so we don't leak them;
                    # the stale payload is still served below.
                    _bg_delta_sem.release()
                    _inflight.pop(cache_key, None)

        if not _sd_ran_partial:           # keep `sd-partial` / `sd-deadline` visible
            _mark_serve("stale-swr")
        _time_ck("stale_return")
        return JSONResponse(
            content=stale_payload,
            headers={"Cache-Control": "public, max-age=5"},
        )

    # ── Layer 3: Legacy disk cache fallback (transition period) ──────────────
    # Serves existing warm disk-cache entries during the SQLite cold-start.
    # Once SQLite is populated for a ticker, this branch is never reached.
    if not stored_rows:
        disk_cached = disk_cache.get(ticker_up, tf, bars)
        if disk_cached and disk_cached.get("bars"):
            payload = disk_cached
            cache.set(cache_key, payload, ttl=_CACHE_TTL.get(tf, 300))
            return JSONResponse(
                content=payload,
                headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
            )

    # ── Layer 4: API fetch (delta or full) — with deduplication ──────────────
    # Prevent a stampede: only one thread fetches per cache_key; the rest wait.
    with _inflight_lock:
        if cache_key in _inflight:
            waiter_ev  = _inflight[cache_key]
            i_am_fetcher = False
        else:
            waiter_ev  = _threading.Event()
            _inflight[cache_key] = waiter_ev
            i_am_fetcher = True

    if not i_am_fetcher:
        # ⛔ Bounded by the SAME budget as the fetcher (`_bounded_delta`). This was
        # 12 s, which outlived the fetcher's own ceiling and re-introduced exactly
        # the long request hold that ceiling exists to remove — a second viewer of a
        # cold symbol would wait 12 s to be handed the same stale rows the fetcher
        # already served. +0.5 s so the waiter loses the race, never the fetcher.
        _mark_serve("inflight-wait")
        waiter_ev.wait(timeout=_bounded_wait(
            (_DATE_DELTA_DEADLINE_SECONDS if date_tf else _REQUEST_DEADLINE_SECONDS) + 0.5))
        hit = cache.get(cache_key)
        if hit is not None:
            return JSONResponse(
                content=hit,
                headers={"Cache-Control": f"public, max-age={_CACHE_TTL.get(tf, 300)}"},
            )
        # Fetcher may have failed — return stale SQLite data or empty
        stale = _fmt_sqlite_bars(stored_rows, tf, ticker_up) if stored_rows else []
        return JSONResponse(
            content={"ticker": ticker_up, "tf": tf, "bars": stale},
            headers={"Cache-Control": "public, max-age=5"},
        )

    # We are the designated fetcher for this key.
    _mark_serve("fetch")
    import logging as _log
    _logger = _log.getLogger(__name__)
    result_bars: list[dict] = []
    ttl = _CACHE_TTL.get(tf, 300)
    # Pre-initialise payload so finally block always has something to cache
    payload: dict = {"ticker": ticker_up, "tf": tf, "bars": []}
    _cold_shed = False   # set True when a truly-cold fetch is shed for pool protection
    _delta_shed = False  # set True when the request-path delta outlived its ceiling

    try:
        if stored_rows and last_ts:
            # ── Delta fetch: only new bars since last stored ts ──────────────
            # ⛔ BOUNDED. This call USED to be a bare `_delta_intraday(...)` on the
            # request thread, and that is the measured 16-second path (see
            # `_bounded_delta`): this branch is reached exactly when the tail is
            # cold-stale and not deblockable, which is the common case for any
            # symbol outside the prewarm tier. The delta still runs — and still
            # persists — but the REQUEST stops waiting at the deadline and answers
            # from the local store, so the edge can never reach its 8 s abort.
            try:
                # ⛔⛔ INTRADAY ONLY. D/W/M keep the ORIGINAL blocking delta, on purpose:
                # the 16-second class was measured on 5m and 1m, daily was already
                # instant (edge-cached history + `_augment_daily_with_today` +
                # BARS_DAILY_ASYNC_HEAL), and — decisively — the client's bounded
                # catch-up poll that makes a shed payload safe is intraday-only
                # (`refreshInterval` is 300 s on D/W/M). Shedding a daily here would
                # trade a correct-but-slow first paint for a stale one held for five
                # minutes. That is a daily regression, which this project may not make.
                if date_tf:
                    # Still correct-first (waits for the delta), now with a ceiling.
                    _completed = _bounded_date_delta(ticker_up, tf, last_ts)
                else:
                    _completed = _bounded_delta(ticker_up, tf, last_ts, date_tf)
                if _completed:
                    # Read fresh rows from SQLite (includes the new bars)
                    fresh_rows = _sqlite.get_bars(ticker_up, tf, bars)
                    result_bars = _fmt_sqlite_bars(fresh_rows or stored_rows, tf, ticker_up)
                else:
                    # Deadline expired or no capacity. Serve what we hold; the job
                    # (when one started) lands its write for the next poll.
                    _mark_serve("delta-deadline")
                    _delta_shed = True
                    result_bars = _fmt_sqlite_bars(stored_rows, tf, ticker_up)
            except Exception as e:
                _logger.warning(f"[bars] delta failed {ticker_up} tf={tf}: {e}")
                result_bars = _fmt_sqlite_bars(stored_rows, tf, ticker_up)

        else:
            # ── Full fetch: first time we see this ticker/tf ──────────────────
            # 🔴 NEVER BLOCK THE REQUEST ON A COLD PROVIDER FETCH (instant-charts
            # Phase 4). A truly-cold provider fetch can hold this worker thread ~20s;
            # that is the pool-exhaustion / HAR-outage class (a fresh browser scanning
            # obscure tickers drags every warm chart to 5-20s). So instead of fetching
            # inline, kick a BOUNDED, DEDUPED background fetch that warms bars.db, and
            # return the fast "warming" 503+Retry-After below (via _cold_shed) — the
            # client re-polls in ~3s and reads the fresh SQLite rows the moment the bg
            # fetch lands. After the Phase-3 universe warm, cold misses are rare (a
            # brand-new listing); this keeps even those off the request thread entirely.
            _mark_serve("cold-bg")
            _kick_cold_fetch(ticker_up, tf, bars, date_tf)
            _cold_shed = True   # reuse the warming-503 return path below
            raw = None

            try:
                if raw:
                    # Don't persist stale intraday fallback data to SQLite — it would
                    # be served as fresh on subsequent requests since _needs_fresh
                    # checks last_ts age, not data age.
                    if date_tf or not _is_intraday_stale(raw):
                        _sqlite.put_bars(ticker_up, tf, raw, date_tf=date_tf)
                        if _deep:
                            _mark_history_complete(ticker_up, tf)
                # Slice to the requested count for the response. We stored ALL
                # fetched bars in SQLite above (so future larger requests don't
                # have to refetch), but the caller only needs `bars` count back.
                result_bars = raw[-bars:] if raw else []
                # First-fetch path serves `raw` directly (not via _fmt_sqlite_bars),
                # so normalize D/W/M here too — this is the deep-history load where
                # recycled-ticker / split-gap issues first surface.
                if date_tf and result_bars:
                    try:
                        from api.services.bars_sanitize import sanitize_daily_bars
                        result_bars = sanitize_daily_bars(ticker_up, result_bars, tf)
                    except Exception:
                        pass

            except Exception as e:
                import traceback as _tb
                _logger.error(
                    f"[bars] full fetch failed {ticker_up} tf={tf}: {e}\n{_tb.format_exc()}"
                )
                result_bars = []

        # Build payload and write to cache BEFORE releasing waiters, so that
        # concurrent waiters that wake in the finally block read fresh data.
        payload = {"ticker": ticker_up, "tf": tf, "bars": result_bars}
        # Don't cache empty results — let the next request retry immediately.
        # Caching empty for 5s creates a "poisoned" window where every concurrent
        # client gets bars=[] even if the upstream API would now succeed.
        if result_bars:
            # If the served intraday result is STILL cold-stale (the delta fetch
            # returned nothing — thin ticker, transient upstream failure — so we're
            # serving yesterday's `stored_rows`), cache it with a SHORT retry TTL,
            # not the full 5-min TTL. Otherwise the stale payload pins Layer 1 for
            # 300s and every 30s SWR poll re-serves it — the chart shows only the
            # prior session until an unrelated event (ticker switch) evicts it (the
            # SPCX "only fixes if I click another ticker" report). Mirrors the bg
            # path's `else: ttl=15`. Fresh (current-session) results keep full TTL.
            _serve_ttl = ttl
            if _delta_shed:
                _serve_ttl = 15          # a shed delta must not pin the unrepaired rows
            if tf in ("1", "5", "15", "30", "60"):
                try:
                    if _is_cold_stale_intraday(tf, int(result_bars[-1].get("t"))):
                        _serve_ttl = 15
                except (TypeError, ValueError, AttributeError):
                    pass
            cache.set(cache_key, payload, ttl=_serve_ttl)

    finally:
        # Always release waiters — cache is already populated above.
        with _inflight_lock:
            _inflight.pop(cache_key, None)
        waiter_ev.set()

    # Pool-shed guard: this cold fetch was SKIPPED (the cold-fetch cap was full) to
    # protect the threadpool. Return 503 + a short Retry-After (ANY tf) so the client
    # re-polls in ~3s — once a fetch slot frees it warms — instead of rendering bars:[]
    # and waiting the full 300s daily SWR. Keeps any prior on-screen state.
    if _cold_shed and not result_bars:
        r = JSONResponse(
            status_code=503,
            content={"ticker": ticker_up, "tf": tf, "bars": [], "error": "warming"},
        )
        r.headers["Retry-After"] = "3"
        # Names this 503 as a DELIBERATE shed so the edge passes it to the browser
        # (re-poll the tier) instead of re-asking WEB_ORIGIN (edge worker.js).
        r.headers["X-Bars-Shed"] = "warming"
        return r

    # No-blank guard: a COLD intraday ticker (no stored rows, no disk fallback)
    # whose fetch came back empty because the primary source is circuit-broken
    # (transient: recent errors/corruption tripped the breaker) would otherwise
    # paint a blank chart that only self-heals on the next 30s SWR poll. Return
    # 503 + Retry-After so the frontend's error-retry kicks in within ~5s and
    # keeps any prior on-screen state, instead of rendering bars:[]. A genuinely
    # empty ticker (healthy sources, no trades / delisted) still returns 200+[]
    # so the frontend can show "no data" rather than retry forever.
    if not result_bars and not date_tf and not stored_rows:
        try:
            from api.services import source_circuit_breaker as _scb
            if not _scb.is_ok("massive"):
                r = JSONResponse(
                    status_code=503,
                    content={"ticker": ticker_up, "tf": tf, "bars": [], "error": "transient"},
                )
                r.headers["Retry-After"] = "5"
                return r
        except Exception:
            pass  # breaker unavailable → fall through to the normal empty 200

    _time_ck("layer4_return")
    if _delta_shed:
        # Clearly marked: short cache + re-poll hint (the router adds tail_status on
        # intraday; D/W/M carry the Retry-After alone).
        return JSONResponse(
            content=payload,
            headers={"Cache-Control": "public, max-age=5", "Retry-After": "3"},
        )
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": f"public, max-age={ttl}"},
    )


# ── Multi-source retry on validation failure ────────────────────────────────
# Public wrapper that fetches from the configured intraday source chain
# (Massive → FMP → yfinance) and retries the next source whenever the
# returned payload fails bar-level validation.  Existing callers continue to
# use _fetch_intraday() directly; routes that opt in to this stricter path
# (Plan 3) call fetch_with_validation() instead.
from api.services import bar_validation as _bar_validation


def _extract_bars(result):
    """Normalize a fetch result into an iterable of bar dicts.

    The internal _fetch_intraday_* helpers return ``list[dict]``. Test
    doubles and future call sites may return a payload-shaped dict
    ``{"bars": [...], "source": "..."}``. Accept both.
    """
    if not result:
        return None
    if isinstance(result, dict):
        return result.get("bars")
    if isinstance(result, list):
        return result
    return None


_PARTIAL_VALIDATION_THRESHOLD = 0.5  # accept payload if ≥50% of bars validate


def _payload_passes_validation(result, prior_close=None) -> bool:
    """Return True if the payload exists and at least 50% of its bars validate.

    Per-bar validation + quarantine still happens at cache write — the bad
    bars are filtered there. This function only decides whether to fall
    through to an alternate source. A few invalid bars (earnings gaps,
    splits, halts) shouldn't force a 5s+ alt-source fetch.

    ``prior_close`` seeds the first bar's chained-context check; on subsequent
    bars, ``pc`` only advances when the bar validates so a corrupt bar can't
    drag the reference close (matches what bars_disk_cache.put() does).
    Non-dict elements are skipped (defensive against sentinels in legacy
    payloads).
    """
    bars = _extract_bars(result)
    if not bars:
        return False
    pc = prior_close
    valid = 0
    total = 0
    for bar in bars:
        if not isinstance(bar, dict):
            continue  # skip sentinels
        total += 1
        ok, _ = _bar_validation.validate_bar(bar, prior_close=pc)
        if ok:
            valid += 1
            pc = bar.get("c", pc)
    if total == 0:
        return False
    return (valid / total) >= _PARTIAL_VALIDATION_THRESHOLD


def fetch_with_validation(
    ticker: str,
    tf: str,
    bars: int,
    prior_close: float | None = None,
    expected_session: int | None = None,
):
    """Fetch from primary; if it fails validation, fall back through alternates.

    Order: Massive → FMP (intraday only) → yfinance.  Returns the first
    payload whose every bar passes validation, or ``None`` if every source
    yielded corrupt or empty data.  The return shape mirrors whatever the
    underlying fetch helper returned (typically ``list[dict]``).

    Per-source circuit breaker (Plan 3 Task 3): each source is gated on its
    rolling 1-hour pass-rate.  When a source has been silently producing
    corrupt or empty payloads, it gets marked ``degraded`` and skipped here
    so the next source in the chain takes over.  Auto-recovers when the
    rolling window shows 95%+ pass rate again.

    Staleness escalation (2026-06-13): when ``expected_session`` (a YYYYMMDD
    int, the latest session that should have bars) is supplied, a source that
    is VALID but LAGGING — its last bar predates the expected session — no
    longer short-circuits the chain. We keep escalating to the next source
    looking for one that's both valid AND fresh, falling back to the freshest
    valid-but-stale payload only if none reach the expected session. This is
    the intraday twin of the daily Massive-lag fix: Massive's intraday aggs
    can lag a few sessions for thin tickers (under the 5-day _is_intraday_stale
    floor), and without this the chart would freeze on stale-but-valid Massive
    data while FMP/yfinance had the fresh session. Validation still gates every
    candidate — a stale source never licenses admitting a corrupt one.
    """
    from api.services import source_circuit_breaker as _scb

    best_stale = None  # (last_session_yyyymmdd, payload, source) — freshest valid fallback
    _set_intraday_source(None)
    # ⛔ An FMP payload with NO extended-hours bar is RTH-only; Massive (and yfinance
    # with prepost) carry 04:00-20:00. Accepting it first would persist a series whose
    # pre/post sessions are silently empty. Held back until yfinance has been asked.
    fmp_rth = None

    def _accept(payload, source="massive"):
        """Return payload if it's fresh enough to short-circuit; else stash it
        as a stale fallback candidate and return None to keep escalating."""
        nonlocal best_stale
        if expected_session is None:
            _set_intraday_source(source)
            return payload  # legacy: first valid wins
        if not payload:
            return None
        sess = _payload_last_session_yyyymmdd(payload)
        if sess >= expected_session:
            _set_intraday_source(source)
            return payload  # valid AND fresh — best case
        if best_stale is None or sess > best_stale[0]:
            best_stale = (sess, payload, source)
        return None

    # Primary: Massive
    if _scb.is_ok("massive"):
        try:
            payload = _fetch_intraday_massive(ticker, tf, bars)
            valid = _payload_passes_validation(payload, prior_close)
            _scb.record_attempt("massive", success=valid)
            if valid:
                chosen = _accept(payload)
                if chosen is not None:
                    return chosen
            elif payload:
                _note_provider_fault()   # it HAD bars; we refused them — not "nothing"
        except Exception as _e:
            _note_provider_fault(_e)
            _scb.record_attempt("massive", success=False)
    else:
        _note_provider_fault()       # breaker open: the source was never asked

    # FMP — intraday timeframes only
    if tf in ("1", "5", "15", "30", "60") and _scb.is_ok("fmp"):
        try:
            payload = _fetch_intraday_fmp(ticker, tf, bars)
            valid = _payload_passes_validation(payload, prior_close)
            _scb.record_attempt("fmp", success=valid)
            if valid and not _payload_has_extended_hours(payload):
                fmp_rth = payload          # RTH-only: yfinance first, this only if it fails
            elif valid:
                chosen = _accept(payload, "fmp")
                if chosen is not None:
                    return chosen
            elif payload:
                _note_provider_fault()   # it HAD bars; we refused them — not "nothing"
        except Exception as _e:
            _note_provider_fault(_e)
            _scb.record_attempt("fmp", success=False)
    elif tf in ("1", "5", "15", "30", "60"):
        _note_provider_fault()       # breaker open: the source was never asked

    # yfinance fallback (split-adjusted, includes premarket)
    if _scb.is_ok("yfinance"):
        try:
            payload = _fetch_intraday_yfinance(ticker, tf, bars)
            valid = _payload_passes_validation(payload, prior_close)
            _scb.record_attempt("yfinance", success=valid)
            if valid:
                chosen = _accept(payload, "yfinance")
                if chosen is not None:
                    return chosen
            elif payload:
                _note_provider_fault()   # it HAD bars; we refused them — not "nothing"
        except Exception as _e:
            _note_provider_fault(_e)
            _scb.record_attempt("yfinance", success=False)
    else:
        _note_provider_fault()       # breaker open: the source was never asked

    if fmp_rth is not None:
        chosen = _accept(fmp_rth, "fmp")
        if chosen is not None:
            return chosen

    # No source reached the expected session — return the freshest valid
    # payload we saw (better a few sessions behind than a blank chart). The
    # caller's _is_intraday_stale guard still rejects absurdly old (>5d) data.
    if best_stale:
        _set_intraday_source(best_stale[2])
        return best_stale[1]
    return None


def fetch_minute_snapshot(ticker: str, minute_ts: int) -> dict | None:
    """Fetch the 1m bar for the given minute timestamp from Massive (primary).

    Used by candle_reconcile at minute boundaries to compare WS-built bars
    against an authoritative REST snapshot.

    Returns the bar dict or None if unavailable.
    """
    try:
        # Fetch a small window around the target minute (5 bars covers ~5 min)
        bars = _fetch_intraday_massive(ticker, "1", 5)
        if not bars:
            return None
        for b in bars:
            if isinstance(b, dict) and b.get("t") == minute_ts:
                return b
    except Exception:
        return None
    return None


# Public API for router + worker consumers.
__all__ = [
    "_get_bars_inner",
    "_get_bars_since_response",
    "_fmt_sqlite_bars",
    "_needs_fresh",
    "_run_universe_warm",
    "_run_universe_warm_multi_tf",
    "_warm_state",
    "_warm_state_lock",
    "_CACHE_TTL",
    "_inflight",
    "_inflight_lock",
    "warm_bars_async",
    "_check_admin_auth",
    "_build_universe_ticker_list",
    "_DEFAULT_WARM_TFS",
    "_bars_warm_pool",
    "_BarsWarmExecutor",
    "fetch_with_validation",
    "fetch_minute_snapshot",
]
