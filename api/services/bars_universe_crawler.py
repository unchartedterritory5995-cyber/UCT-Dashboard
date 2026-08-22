"""Gentle universe 5m warm crawler — instant-origin Phase 2, v2.

WHY THIS EXISTS (the lesson from v1). The first attempt at universe-wide 5m warming
dumped ~3,200 shallow jobs into the worker's existing boot pass, which runs FOUR
concurrent warm threads. On 2026-08-19 that thrashed the worker's bars.db write-lock
(`database is locked`) and saturated the market-data provider, starving the web pod's
on-demand fetches — a self-inflicted post-close slowdown. Root cause: bulk + concurrent.

This crawler is built to be the OPPOSITE, by construction:
  • SINGLE in-flight fetch at a time (one thread) — so it can NEVER contend on the
    write-lock with itself the way 4 boot threads did.
  • RATE-LIMITED: it sleeps a fixed interval AFTER EACH ACTUAL fetch (not per
    iteration), so a cold universe fills over hours at a trickle the provider never
    notices, while an already-warm universe is swept for free (skips are instant).
  • DECOUPLED from the boot pass + refresh loop — it just cycles the universe forever,
    warming only the tickers whose 5m is MISSING or a whole SESSION stale, skipping the
    rest. Idempotent: re-passes over a warm universe cost ~nothing.

Net effect: every ticker ends up with a recent 5m tail in the store, so its first 5m
open is an instant local serve (the async-heal path tops it up non-blocking). The goal
the boot-bulk approach was reaching for, without the load spike.

Runs on the WORKER, gated by BARS_UNIVERSE_CRAWLER_ENABLED (default OFF). Supervised +
heartbeated like the prewarmer. Ship dark; enable + watch AFTER 8 PM ET.
"""
from __future__ import annotations

import json
import os
import threading
import time as _time

log_prefix = "[uni-crawler]"

# Liveness/telemetry for the worker health endpoint + a future watchdog.
_STATE_LOCK = threading.Lock()
_STATE: dict = {
    "enabled": None, "last_beat_ts": None, "warmed_total": 0, "skipped_total": 0,
    "empty_total": 0, "empty_parked": 0, "passes": 0, "cursor": 0, "universe": 0,
    "last_warm_sym": None, "last_error": None, "restarts": 0,
}


def _beat():
    with _STATE_LOCK:
        _STATE["last_beat_ts"] = _time.time()


def crawler_heartbeat() -> dict:
    """Snapshot for the worker health endpoint. `alive` = a unit of work within the
    last ~45 min (covers the idle sleep when the whole universe is already fresh)."""
    with _STATE_LOCK:
        s = dict(_STATE)
    beat = s.get("last_beat_ts")
    s["age_seconds"] = (_time.time() - beat) if beat else None
    s["alive"] = bool(beat and (_time.time() - beat) < 2700)
    return s


def _enabled() -> bool:
    return os.environ.get("BARS_UNIVERSE_CRAWLER_ENABLED", "0") == "1"


def load_universe() -> list[str]:
    """cap_universe.json tickers (upper-cased, de-duped, order-preserving)."""
    path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return []
    out, seen = [], set()
    for row in raw:
        t = row if isinstance(row, str) else (row.get("ticker") or row.get("symbol") if isinstance(row, dict) else None)
        if not t:
            continue
        u = t.upper()
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def crawl_pass(universe, cursor, *, is_stale, warm, pace, beat=lambda: None,
               on_warm=lambda sym: None, on_empty=lambda sym: None, budget=None):
    """ONE sweep of the universe starting at `cursor`, warming only stale/missing 5m.

    Pure control flow with every side-effect INJECTED, so the pacing + skip logic is
    unit-testable without a network, SQLite, or real sleeps:
      • is_stale(sym) -> bool : True when this ticker's 5m needs warming (missing or a
        whole session behind) AND is not in the no-data cooldown. Skipped tickers cost
        nothing (no pace()).
      • warm(sym) -> bool     : perform the single synchronous shallow 5m fetch+store;
        return True if rows were actually stored, False if the fetch came back EMPTY
        (thin/inactive ticker with no valid recent 5m — nothing to warm).
      • pace()               : the rate-limit — called after every ATTEMPT (fill OR
        empty), because both hit the provider. Skips never pace.
      • beat()               : liveness heartbeat, called each step.
      • on_warm(sym)/on_empty(sym): telemetry + the no-data cooldown hook.
      • budget (int|None)     : stop after this many ATTEMPTS this pass (None = full).

    Returns (new_cursor, filled, skipped, empty). new_cursor resumes where this pass
    stopped, so coverage rotates fairly across restarts.
    """
    n = len(universe)
    filled = skipped = empty = 0
    if n == 0:
        return cursor, 0, 0, 0
    i = cursor % n
    attempts = 0
    for _ in range(n):
        sym = universe[i]
        i = (i + 1) % n
        beat()
        try:
            if not is_stale(sym):
                skipped += 1
                continue
            ok = warm(sym)
            if ok:
                filled += 1
                on_warm(sym)
            else:
                empty += 1
                on_empty(sym)   # cooldown so we don't retry a no-data ticker every pass
            pace()
            attempts += 1
        except Exception:
            # A bad ticker never stops the sweep; it retries next pass.
            skipped += 1
        if budget is not None and attempts >= budget:
            break
    return i, filled, skipped, empty


# Tickers that came back EMPTY (no valid recent 5m — thin/inactive) are parked here
# until `expiry_ts` so the crawler doesn't burn a provider call retrying them every
# pass. This is what lets a run SETTLE: once the warmable tickers are warm and the
# unwarmable ones are parked, a sweep is all-skips → the daemon idles.
_NO_DATA_UNTIL: dict[str, float] = {}


def _empty_cooldown_secs() -> int:
    return int(os.environ.get("BARS_CRAWLER_EMPTY_COOLDOWN_SEC", "21600"))  # 6h


def _mark_empty(sym: str) -> None:
    _NO_DATA_UNTIL[sym] = _time.time() + _empty_cooldown_secs()
    with _STATE_LOCK:
        _STATE["empty_parked"] = len(_NO_DATA_UNTIL)


def _default_is_stale(sym: str) -> bool:
    """5m needs warming when it is MISSING entirely or missing >=1 whole session AND
    it isn't parked in the no-data cooldown. Same-session-fresh tickers (already warmed
    today) are skipped. Uses the serve path's own cold-stale predicate so the crawler
    and the chart agree."""
    exp = _NO_DATA_UNTIL.get(sym)
    if exp is not None:
        if _time.time() < exp:
            return False           # parked: known no-data, don't retry yet
        _NO_DATA_UNTIL.pop(sym, None)   # cooldown elapsed → allow one retry
    from api.services import bars_sqlite as _sqlite
    from api.services.bars_fetch import _is_cold_stale_intraday
    last_ts = _sqlite.get_last_ts(sym, "5")
    if last_ts is None:
        return True
    return _is_cold_stale_intraday("5", last_ts)


def _default_warm(sym: str, depth: int) -> bool:
    """The single synchronous shallow 5m warm. On the WORKER (async-heal flag off) this
    fetches + stores inline, so the crawler's pace() genuinely rate-limits the fetch.
    Returns True iff rows were actually stored (fill), False if the fetch was empty."""
    from api.routers.bars import _get_bars_inner
    from api.services import bars_sqlite as _sqlite
    before = _sqlite.get_last_ts(sym, "5")
    _get_bars_inner(sym, "5", depth)
    after = _sqlite.get_last_ts(sym, "5")
    # Filled if we now have rows we didn't before (new ticker), or the tail advanced.
    return after is not None and (before is None or after > before)


def run_universe_crawler_forever():
    """Blocks forever: gentle single-threaded rate-limited 5m warm of the whole
    universe. No-ops unless BARS_UNIVERSE_CRAWLER_ENABLED=1."""
    if not _enabled():
        with _STATE_LOCK:
            _STATE["enabled"] = False
        print(f"{log_prefix} disabled (set BARS_UNIVERSE_CRAWLER_ENABLED=1 to enable)")
        return
    universe = load_universe()
    with _STATE_LOCK:
        _STATE["enabled"] = True
        _STATE["universe"] = len(universe)
    if not universe:
        print(f"{log_prefix} no universe loaded — nothing to crawl")
        return

    interval = float(os.environ.get("BARS_CRAWLER_FETCH_INTERVAL_SEC", "3.0"))
    depth = int(os.environ.get("BARS_CRAWLER_5M_BARS", "780"))
    idle_sleep = int(os.environ.get("BARS_CRAWLER_IDLE_SLEEP_SEC", "600"))
    print(f"{log_prefix} started: {len(universe)} tickers, 1 fetch / {interval}s, "
          f"depth={depth} (single-threaded, skip-fresh)")

    cursor = 0
    while True:
        _beat()
        def _pace():
            _time.sleep(interval)
            _beat()

        def _on_warm(sym):
            with _STATE_LOCK:
                _STATE["warmed_total"] += 1
                _STATE["last_warm_sym"] = sym

        try:
            cursor, filled, skipped, empty = crawl_pass(
                universe, cursor,
                is_stale=_default_is_stale,
                warm=lambda s: _default_warm(s, depth),
                pace=_pace, beat=_beat, on_warm=_on_warm, on_empty=_mark_empty,
            )
            with _STATE_LOCK:
                _STATE["passes"] += 1
                _STATE["cursor"] = cursor
                _STATE["skipped_total"] += skipped
                _STATE["empty_total"] += empty
            print(f"{log_prefix} pass complete: {filled} filled, {empty} empty(parked), "
                  f"{skipped} skipped, {len(_NO_DATA_UNTIL)} parked total")
            if filled == 0 and empty == 0:
                # Whole universe already fresh/parked — idle instead of hot-looping skips.
                _time.sleep(idle_sleep)
        except Exception as e:  # pragma: no cover - defensive
            with _STATE_LOCK:
                _STATE["last_error"] = str(e)[:180]
            print(f"{log_prefix} pass crashed (non-fatal): {e}")
            _time.sleep(60)


def run_universe_crawler_supervised():
    """Restart the crawler (bounded backoff) if it ever exits/raises, so warming can't
    stop permanently from a single unhandled error."""
    backoff = 5
    while True:
        try:
            run_universe_crawler_forever()
            return  # returned normally = disabled; nothing to supervise
        except Exception as e:  # pragma: no cover
            with _STATE_LOCK:
                _STATE["restarts"] += 1
                _STATE["last_error"] = f"restart: {str(e)[:180]}"
            print(f"{log_prefix} crashed — restarting in {backoff}s: {e}")
            _time.sleep(backoff)
            backoff = min(backoff * 2, 300)
