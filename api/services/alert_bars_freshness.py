"""Keep the ARMED alert groups' bars fresh, so the alert lane owns its own data.

⭐ THE DEFECT THIS EXISTS FOR (measured on the production pod, 2026-08-07 09:56
ET — 26 minutes after the open, with the market open and 31 alerts armed):

    GROUP SPY/5  alerts=31  newest_bar_ET=2026-08-07 09:15  stale=41.1 min

The newest SPY/5 bar in the web pod's store was a PRE-MARKET bar. Every one of
those 31 alerts was being decided against a bar from before the session started.

WHY. `indicator_alert_evaluator._fetch_bars_for_alert` reads `bars_sqlite`
DIRECTLY — deliberately, per its own docstring, "to avoid a round-trip and keep
the loop isolated from web-layer concerns". That isolation is correct for the
READ. What it also did, silently, was inherit NONE of `/api/bars`' freshness
logic: `_needs_fresh`, `_is_cold_stale_intraday`, the synchronous first-paint
delta. The store is freshened by exactly two things — an on-demand chart view,
and the worker's R2 snapshot merge. With the site in COMING SOON mode almost
nobody opens a chart, `/data/.bars_last_sync` does not exist, and so **the alert
lane depended on somebody else's chart traffic to have data from this hour.**

For an alerts product that is the wrong dependency direction. This module turns
it around: the armed set PULLS its own bars, on its own schedule, through the
SAME fetch path `/api/bars` uses.

─── WHAT IT IS NOT ──────────────────────────────────────────────────────────

⛔ NOT A SECOND FETCHER. Every byte still comes through `bars_fetch`'s delta
functions (`_delta_intraday` / `_delta_daily` / `_delta_weekly` /
`_delta_monthly`) and is written by `bars_sqlite.put_bars`. Massive → yfinance
fallback, ET bucketing, the 60-min 15-min-resample, the trailing heal window,
interior gap-fill and the newest-wins upsert on (ticker, tf, ts) are all
inherited, not re-implemented. A second fetcher would be a second vocabulary
and this repo already pays for one.

⛔ NOT A UNIVERSE SWEEP. The input is `indicator_alert_service.list_active()`,
deduped to (sym, tf). Today that is ONE group. It is capped at `MAX_GROUPS`
anyway, so the size of `cap_universe` (3,685 tickers) can never become the size
of this job. `test_refresh_never_reaches_beyond_the_armed_set` and
`test_max_groups_caps_the_sweep` are the rails.

⛔ NEVER ON THE REQUEST PATH. The web pod is ONE uvicorn process with one event
loop and a 64-slot anyio threadpool shared by every user; exhausting it is the
2026-07-01 outage. This module spends ZERO anyio slots: it runs from
APScheduler's `BackgroundScheduler` (its own 10-worker pool, `max_instances=1`)
and/or from the evaluator's own daemon thread, and it REFUSES to run at all if
it finds a running event loop in the calling thread
(`test_refuses_to_run_on_the_event_loop`).

─── HOW IT IS BOUNDED ───────────────────────────────────────────────────────

  · `MAX_GROUPS`      — at most N groups touched per sweep, stalest first.
                        Anything over the cap waits for the next sweep.
  · `MAX_WORKERS`     — at most N fetches in flight, in a pool this module
                        creates and shuts down itself.
  · `MIN_GAP_SECONDS` — fetch STARTS are serialised at least this far apart, so
                        a sweep is a trickle and never a burst. An unpaced
                        739-symbol sweep once 429'd on its FIRST call, engaged a
                        20-second shared cooldown, then raced through the rest
                        reading empty — and reported success.
  · `DEADLINE_SECONDS`— hard wall clock for the whole sweep. Past it, remaining
                        groups are left for the next sweep rather than run long.
  · `MIN_REFRESH_INTERVAL_SECONDS`
                      — a (sym, tf) refreshed successfully less than this ago is
                        skipped WITHOUT a network call. This is what lets the
                        scheduler job and the evaluator call site coexist
                        without doubling the budget.

Worst case at the defaults, with the cap full: 24 requests spread over ≥8.4 s,
never more than 2 in flight, inside a 20 s ceiling, once a minute. Today, with
one armed group, it is ONE request a minute.

─── THE TWO RULES THAT ARE NOT NEGOTIABLE ───────────────────────────────────

1. ⛔ AN EMPTY FETCH IS NOT A VALUE AND IS NOT A SUCCESS. An empty read during
   an upstream cooldown is indistinguishable from "no data". So an empty result
   writes NOTHING, does NOT stamp the group's success clock, and is counted in
   its own `empty` bucket — never in `refreshed`. The next sweep therefore
   retries the same group, which is how this retries THROUGH a cooldown instead
   of racing past one. `refreshed` counts only groups where `put_bars` actually
   wrote rows, so a sweep that did nothing can never report that it did
   something. See [[lesson_seeded_default_becomes_recorded_fact]] and
   [[lesson_bulk_job_starves_a_shared_rate_budget]].

2. ⛔ THE FAILURE DIRECTION IS "KEEP EVALUATING ON WHAT WE HAVE". If the
   upstream is down this module writes nothing, raises nothing, and DELETES
   nothing — so `_fetch_bars_for_alert` still returns the stale series it
   returned before, and the alert lane keeps deciding on stale bars rather than
   crashing or, far worse, deciding on an empty series.
   `test_upstream_down_leaves_the_store_intact_and_alerts_still_evaluate` is
   the rail, and it asserts through the REAL `_fetch_bars_for_alert`.

Kill switch: ``ALERT_BARS_REFRESH_ENABLED=0``. Default is ON — a flag that
defaults off would not have fixed anything, and setting a Railway variable
auto-redeploys, which is not a thing to need mid-session.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

# Timeframes `bars_sqlite` keys with unix SECONDS. Everything else (D/W/M) is
# keyed with a YYYYMMDD int — `bars_sqlite`'s own module docstring is the
# contract, and `put_bars(date_tf=...)` is how it is honoured.
INTRADAY_TFS = ("1", "5", "15", "30", "60")
DATE_TFS = ("D", "W", "M")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


# ─── the budget ──────────────────────────────────────────────────────────────
# Read at import so a sweep never re-parses env per group; overridable per call
# for tests and for a one-off wider catch-up.

MAX_GROUPS = _env_int("ALERT_BARS_REFRESH_MAX_GROUPS", 24)
MAX_WORKERS = _env_int("ALERT_BARS_REFRESH_MAX_WORKERS", 2)
DEADLINE_SECONDS = _env_float("ALERT_BARS_REFRESH_DEADLINE_SECONDS", 20.0)
MIN_GAP_SECONDS = _env_float("ALERT_BARS_REFRESH_MIN_GAP_SECONDS", 0.35)
MIN_REFRESH_INTERVAL_SECONDS = _env_float(
    "ALERT_BARS_REFRESH_MIN_INTERVAL_SECONDS", 25.0)
ATTEMPTS = _env_int("ALERT_BARS_REFRESH_ATTEMPTS", 2)
RETRY_BACKOFF_SECONDS = _env_float("ALERT_BARS_REFRESH_RETRY_BACKOFF_SECONDS", 1.0)


def is_enabled() -> bool:
    """Read at CALL time, not import time, so the kill switch works on a live
    process (a REPL `os.environ[...] = "0"` stops the next sweep)."""
    return os.environ.get("ALERT_BARS_REFRESH_ENABLED", "1") != "0"


# ─── per-(sym, tf) success clock ─────────────────────────────────────────────
# In-process is the RIGHT scope: the web pod is one uvicorn process, and both
# call sites (the scheduler job and the evaluator thread) live inside it.
#
# ⛔ STAMPED ONLY BY A WRITE THAT HAPPENED. Stamping on an empty or failed fetch
# would convert "the upstream is in a cooldown" into "this group is up to date"
# for the length of the interval — the exact shape of the bug that reported
# success over a 20-second cooldown.
_LAST_OK: dict[tuple[str, str], float] = {}
_STATE_LOCK = threading.Lock()


def _mark_ok(key: tuple[str, str]) -> None:
    with _STATE_LOCK:
        _LAST_OK[key] = time.monotonic()


def _seconds_since_ok(key: tuple[str, str]) -> Optional[float]:
    with _STATE_LOCK:
        at = _LAST_OK.get(key)
    return None if at is None else (time.monotonic() - at)


def reset_state() -> None:
    """Forget every group's success clock. Tests only — module-level state
    shared across tests is how one test passes because of another."""
    with _STATE_LOCK:
        _LAST_OK.clear()


# ─── the armed set ───────────────────────────────────────────────────────────

def armed_groups() -> list[tuple[str, str]]:
    """The deduped (SYM, tf) groups that have at least one ACTIVE alert.

    ⛔ `list_active()` is the ONLY input. Not `cap_universe`, not the hot-ticker
    list, not `get_all_tickers()`. "Refresh only what is armed" is the whole
    reason this job is affordable: today it is one group.

    Order is deterministic (sorted) so a capped sweep is reproducible before the
    staleness sort reorders it.
    """
    try:
        from api.services import indicator_alert_service as _ias
        alerts = _ias.list_active()
    except Exception:
        _logger.exception("[alert-bars] failed to list active alerts")
        return []
    seen: set[tuple[str, str]] = set()
    for a in alerts or []:
        try:
            sym = str(a["sym"]).strip().upper()
            tf = str(a["tf"]).strip()
        except Exception:
            continue
        if sym and tf:
            seen.add((sym, tf))
    return sorted(seen)


# ─── the measurement ─────────────────────────────────────────────────────────

def _et_midnight_epoch(yyyymmdd: int) -> Optional[float]:
    try:
        s = str(int(yyyymmdd))
        return datetime(int(s[0:4]), int(s[4:6]), int(s[6:8]),
                        tzinfo=_ET).timestamp()
    except Exception:
        return None


def measure_staleness(groups: Optional[Iterable[tuple[str, str]]] = None,
                      now: Optional[float] = None) -> list[dict]:
    """Newest STORED bar vs now, per group — the instrument, not a proxy.

    This is deliberately a first-class, exported function rather than something
    inlined into the refresh: the defect was invisible for as long as nobody
    measured it, and a fix whose only evidence is its own new behaviour proves
    nothing about the defect. The before/after in every sweep's summary comes
    from here, and so does the `__main__` table.

    Each record:
      sym, tf, date_tf, last_ts, last_bar_et, stale_seconds, needs_fresh,
      cold_stale, has_rows

    `stale_seconds` for a D/W/M row is measured from ET midnight of the stored
    calendar date, because its `last_ts` is a YYYYMMDD int and not an instant.
    `date_tf` says which unit you are looking at so the two are never confused.
    """
    from api.services import bars_fetch as _bf
    from api.services import bars_sqlite as _sqlite

    at = time.time() if now is None else float(now)
    out: list[dict] = []
    for sym, tf in (groups if groups is not None else armed_groups()):
        sym_up = str(sym).upper()
        try:
            last_ts = _sqlite.get_last_ts(sym_up, tf)
        except Exception:
            _logger.exception("[alert-bars] get_last_ts failed for %s/%s", sym_up, tf)
            last_ts = None
        date_tf = tf in DATE_TFS
        stale: Optional[float] = None
        last_et: Optional[str] = None
        if last_ts is not None:
            if date_tf:
                mid = _et_midnight_epoch(last_ts)
                stale = None if mid is None else max(0.0, at - mid)
                last_et = str(last_ts)
            else:
                stale = at - float(last_ts)
                try:
                    last_et = datetime.fromtimestamp(last_ts, _ET).strftime(
                        "%Y-%m-%d %H:%M")
                except Exception:
                    last_et = None
        try:
            needs = bool(_bf._needs_fresh(last_ts, tf))
        except Exception:
            needs = True
        try:
            cold = bool(_bf._is_cold_stale_intraday(tf, last_ts))
        except Exception:
            cold = False
        out.append({
            "sym": sym_up, "tf": tf, "date_tf": date_tf,
            "has_rows": last_ts is not None,
            "last_ts": last_ts, "last_bar_et": last_et,
            "stale_seconds": None if stale is None else round(stale, 1),
            "needs_fresh": needs, "cold_stale": cold,
        })
    return out


def _sort_priority(rec: dict) -> float:
    """Sort key for `sorted(..., reverse=True)`: bigger = served first.

    A group with NO rows at all is the most starved there is — it is not "0
    seconds stale", it has never had data, and an alert on it is currently
    evaluating on an empty series. It sorts ahead of everything.
    """
    if not rec.get("has_rows"):
        return float("inf")
    s = rec.get("stale_seconds")
    return float("inf") if s is None else float(s)


# ─── the fetch (borrowed whole from bars_fetch) ──────────────────────────────

def _delta_for(sym: str, tf: str, last_ts: int) -> list[dict]:
    """Dispatch to `bars_fetch`'s OWN delta function for this timeframe.

    ⚠️ Resolved with getattr AT CALL TIME, not bound at import. Two reasons, and
    both are load-bearing: a test that monkeypatches `bars_fetch._delta_intraday`
    must actually be patching what this calls (otherwise the test drives a stale
    reference and passes vacuously), and importing `bars_fetch` lazily keeps this
    module importable without dragging in FastAPI.
    """
    from api.services import bars_fetch as _bf
    if tf in INTRADAY_TFS:
        return _bf._delta_intraday(sym, tf, int(last_ts))
    if tf == "D":
        return _bf._delta_daily(sym, int(last_ts))
    if tf == "W":
        return _bf._delta_weekly(sym, int(last_ts))
    if tf == "M":
        return _bf._delta_monthly(sym, int(last_ts))
    raise ValueError(f"unsupported timeframe for alert bar refresh: {tf!r}")


class _Pacer:
    """Serialises fetch STARTS at least `min_gap` apart, across worker threads.

    Not a rate limiter with a bucket — a floor on how fast this job is allowed
    to ask. The shared budget belongs to the whole pod (charts, the wire, the
    scanner); a sweep that empties it in one burst starves them all and then
    reads empty itself.
    """

    def __init__(self, min_gap: float) -> None:
        self._min_gap = max(0.0, float(min_gap))
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self, deadline: Optional[float] = None) -> bool:
        """Block until this caller's turn. False if the deadline passed first."""
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            self._next = start + self._min_gap
            delay = start - now
        if deadline is not None and (time.monotonic() + delay) > deadline:
            return False
        if delay > 0:
            time.sleep(delay)
        return True


def refresh_one(sym: str, tf: str, *,
                min_interval: Optional[float] = None,
                attempts: Optional[int] = None,
                backoff: Optional[float] = None,
                force: bool = False) -> dict:
    """Bring ONE (sym, tf) up to date. Never raises.

    Returns a result dict whose ``status`` is exactly one of:

      refreshed      — rows were fetched AND written. The only success.
      already-fresh  — `bars_fetch._needs_fresh` says the store is current.
                       ⭐ THE SAME PREDICATE `/api/bars` USES. Inheriting it,
                       rather than inventing a staleness rule here, is the
                       point: the alert lane and the chart lane now disagree
                       about freshness in exactly zero cases.
      skipped-recent — a successful refresh happened < `min_interval` ago.
      empty          — the fetch returned nothing. NOT a success, NOT written,
                       NOT stamped; the next sweep retries this group.
      error          — the fetch or the write raised. Same treatment as empty.
    """
    from api.services import bars_fetch as _bf
    from api.services import bars_sqlite as _sqlite

    key = (str(sym).upper(), str(tf))
    sym_up, tf = key
    n_attempts = ATTEMPTS if attempts is None else int(attempts)
    wait_s = RETRY_BACKOFF_SECONDS if backoff is None else float(backoff)
    gate = (MIN_REFRESH_INTERVAL_SECONDS if min_interval is None
            else float(min_interval))

    if not force:
        since = _seconds_since_ok(key)
        if since is not None and since < gate:
            return {"sym": sym_up, "tf": tf, "status": "skipped-recent",
                    "rows": 0, "seconds_since_ok": round(since, 1)}

    try:
        last_ts = _sqlite.get_last_ts(sym_up, tf)
    except Exception as e:
        _logger.exception("[alert-bars] get_last_ts failed %s/%s", sym_up, tf)
        return {"sym": sym_up, "tf": tf, "status": "error", "rows": 0,
                "error": f"{type(e).__name__}: {e}"}

    if not force and not _bf._needs_fresh(last_ts, tf):
        return {"sym": sym_up, "tf": tf, "status": "already-fresh", "rows": 0,
                "last_ts": last_ts}

    new: list[dict] = []
    last_err: Optional[str] = None
    for i in range(max(1, n_attempts)):
        try:
            new = _delta_for(sym_up, tf, last_ts or 0) or []
        except Exception as e:  # noqa: BLE001 — a fetch failure is a data event
            last_err = f"{type(e).__name__}: {e}"
            _logger.warning("[alert-bars] delta fetch raised %s/%s: %s",
                            sym_up, tf, last_err)
            new = []
        if new:
            break
        if i + 1 < max(1, n_attempts) and wait_s > 0:
            time.sleep(wait_s)

    if not new:
        # ⛔ NOTHING IS WRITTEN AND THE CLOCK IS NOT STAMPED. An empty read
        # during an upstream cooldown looks exactly like "no data"; treating it
        # as either a value or a success is how a sweep races through a cooldown
        # and reports that everything is fine.
        status = "error" if last_err else "empty"
        return {"sym": sym_up, "tf": tf, "status": status, "rows": 0,
                "last_ts": last_ts, **({"error": last_err} if last_err else {})}

    try:
        # ⛔ `put_bars` IS THE WRITE. It is the subsystem's one upsert, keyed on
        # (ticker, tf, ts), so the newest fetch of a bar wins and nothing is
        # ever deleted. This module issues no SQL of its own.
        rows = _sqlite.put_bars(sym_up, tf, new, date_tf=(tf in DATE_TFS))
    except Exception as e:
        _logger.exception("[alert-bars] put_bars failed %s/%s", sym_up, tf)
        return {"sym": sym_up, "tf": tf, "status": "error", "rows": 0,
                "error": f"{type(e).__name__}: {e}"}

    if not rows:
        return {"sym": sym_up, "tf": tf, "status": "empty", "rows": 0,
                "last_ts": last_ts}

    _mark_ok(key)
    try:
        new_last = _sqlite.get_last_ts(sym_up, tf)
    except Exception:
        new_last = None
    return {"sym": sym_up, "tf": tf, "status": "refreshed", "rows": int(rows),
            "last_ts": last_ts, "new_last_ts": new_last}


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def refresh_armed_groups(groups: Optional[Iterable[tuple[str, str]]] = None, *,
                         max_groups: Optional[int] = None,
                         max_workers: Optional[int] = None,
                         deadline_seconds: Optional[float] = None,
                         min_gap: Optional[float] = None,
                         min_interval: Optional[float] = None,
                         attempts: Optional[int] = None,
                         backoff: Optional[float] = None) -> dict:
    """One bounded sweep over the armed groups. Never raises.

    `groups` defaults to `armed_groups()`. The evaluator passes the groups it is
    about to read, which is the same set arrived at from the same function — it
    passes them so the thing that refreshes and the thing that reads can never
    be looking at two different lists.

    The summary carries `before` and `after` staleness measurements. That is the
    receipt: "the store is fresher than it was" is a claim about two numbers, and
    both of them are in the return value.
    """
    started = time.monotonic()
    summary: dict[str, Any] = {
        "status": "ok", "groups_armed": 0, "groups_selected": 0,
        "groups_capped": 0, "refreshed": 0, "rows_written": 0,
        "already_fresh": 0, "skipped_recent": 0, "empty": 0, "errors": 0,
        "deadline_hit": 0, "elapsed_s": 0.0,
        "results": [], "before": [], "after": [],
    }

    if not is_enabled():
        summary["status"] = "disabled"
        return summary

    # ⛔ NEVER INLINE ON THE REQUEST PATH. If there is a running event loop in
    # this thread we are on the loop (or in an async endpoint) and every blocking
    # second here is a second the whole pod is not serving. Refuse, loudly, and
    # do zero work — a wrong call site should cost nothing but a log line.
    if _on_event_loop():
        _logger.error(
            "[alert-bars] refresh_armed_groups called from a thread with a "
            "running event loop — refusing. This job belongs on the "
            "BackgroundScheduler or the evaluator thread, never on a request.")
        summary["status"] = "refused-event-loop"
        return summary

    cap = MAX_GROUPS if max_groups is None else int(max_groups)
    workers = MAX_WORKERS if max_workers is None else int(max_workers)
    budget = DEADLINE_SECONDS if deadline_seconds is None else float(deadline_seconds)
    gap = MIN_GAP_SECONDS if min_gap is None else float(min_gap)

    wanted = list(groups) if groups is not None else armed_groups()
    seen: set[tuple[str, str]] = set()
    normalised: list[tuple[str, str]] = []
    for g in wanted:
        try:
            k = (str(g[0]).strip().upper(), str(g[1]).strip())
        except Exception:
            continue
        if k[0] and k[1] and k not in seen:
            seen.add(k)
            normalised.append(k)

    summary["groups_armed"] = len(normalised)
    if not normalised:
        summary["status"] = "no-armed-groups"
        summary["elapsed_s"] = round(time.monotonic() - started, 3)
        return summary

    before = measure_staleness(normalised)
    summary["before"] = before

    # Stalest first, then hard cap. A group pushed past the cap is not dropped —
    # it is the stalest thing left next sweep, so it moves to the front.
    ordered = sorted(before, key=_sort_priority, reverse=True)
    selected = [(r["sym"], r["tf"]) for r in ordered[:max(0, cap)]]
    summary["groups_selected"] = len(selected)
    summary["groups_capped"] = len(normalised) - len(selected)
    if summary["groups_capped"]:
        _logger.warning(
            "[alert-bars] %d armed group(s) over the per-sweep cap of %d — "
            "deferred to the next sweep", summary["groups_capped"], cap)

    deadline = started + max(0.0, budget)
    pacer = _Pacer(gap)

    def _task(key: tuple[str, str]) -> dict:
        sym, tf = key
        if time.monotonic() >= deadline:
            return {"sym": sym, "tf": tf, "status": "deadline", "rows": 0}
        if not pacer.wait(deadline=deadline):
            return {"sym": sym, "tf": tf, "status": "deadline", "rows": 0}
        if time.monotonic() >= deadline:
            return {"sym": sym, "tf": tf, "status": "deadline", "rows": 0}
        try:
            return refresh_one(sym, tf, min_interval=min_interval,
                               attempts=attempts, backoff=backoff)
        except Exception as e:  # belt: refresh_one already swallows
            _logger.exception("[alert-bars] refresh_one escaped for %s/%s", sym, tf)
            return {"sym": sym, "tf": tf, "status": "error", "rows": 0,
                    "error": f"{type(e).__name__}: {e}"}

    results: list[dict] = []
    if selected:
        pool = ThreadPoolExecutor(max_workers=max(1, min(workers, len(selected))),
                                  thread_name_prefix="alert-bars-refresh")
        try:
            results = list(pool.map(_task, selected))
        finally:
            pool.shutdown(wait=True)

    summary["results"] = results
    for r in results:
        st = r.get("status")
        if st == "refreshed":
            summary["refreshed"] += 1
            summary["rows_written"] += int(r.get("rows") or 0)
        elif st == "already-fresh":
            summary["already_fresh"] += 1
        elif st == "skipped-recent":
            summary["skipped_recent"] += 1
        elif st == "empty":
            summary["empty"] += 1
        elif st == "deadline":
            summary["deadline_hit"] += 1
        else:
            summary["errors"] += 1

    summary["after"] = measure_staleness(normalised)
    summary["elapsed_s"] = round(time.monotonic() - started, 3)

    if summary["refreshed"] or summary["empty"] or summary["errors"]:
        worst_before = max((r["stale_seconds"] or 0) for r in summary["before"]) \
            if summary["before"] else 0
        worst_after = max((r["stale_seconds"] or 0) for r in summary["after"]) \
            if summary["after"] else 0
        _logger.info(
            "[alert-bars] sweep armed=%d selected=%d refreshed=%d rows=%d "
            "fresh=%d recent=%d empty=%d err=%d deadline=%d in %.2fs "
            "| worst stale %.1f min -> %.1f min",
            summary["groups_armed"], summary["groups_selected"],
            summary["refreshed"], summary["rows_written"],
            summary["already_fresh"], summary["skipped_recent"],
            summary["empty"], summary["errors"], summary["deadline_hit"],
            summary["elapsed_s"], worst_before / 60.0, worst_after / 60.0)
    return summary


def run_scheduled_sweep() -> dict:
    """APScheduler entry point. Own name so the job id reads as what it is."""
    try:
        return refresh_armed_groups()
    except Exception:
        _logger.exception("[alert-bars] scheduled sweep failed")
        return {"status": "error"}


# ─── the table, for a pod REPL ───────────────────────────────────────────────

def _print_table(rows: list[dict], label: str) -> None:
    print(f"-- {label} --")
    if not rows:
        print("   (no armed groups)")
        return
    for r in rows:
        s = r["stale_seconds"]
        stale = "no rows" if s is None else f"{s / 60.0:6.1f} min"
        print(f"   {r['sym']:<6} {r['tf']:<3} newest={r['last_bar_et'] or '-':<17} "
              f"stale={stale}  needs_fresh={r['needs_fresh']}")


if __name__ == "__main__":  # pragma: no cover - operator tool
    import sys
    print("armed groups:", armed_groups())
    _print_table(measure_staleness(), "BEFORE")
    if "--refresh" in sys.argv:
        out = refresh_armed_groups()
        print("summary:", {k: v for k, v in out.items()
                           if k not in ("before", "after", "results")})
        for r in out["results"]:
            print("   result:", r)
        _print_table(out["after"], "AFTER")
