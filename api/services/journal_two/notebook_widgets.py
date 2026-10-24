"""Notebook widgets: the server payload builder.

One shell, one builder per widget kind. `build()` dispatches through `_BUILDERS`
and calls `cap_payload` last, so every payload is bounded no matter which builder
produced it.

Rules every payload follows (the plan's Global Constraints):
  * `asOf` (ISO UTC) and `source` in {"broker", "manual", "mixed", "market"}.
  * An unknown figure is `None`, never 0, never absent.
  * At most `ROW_CAP` rows and `PAYLOAD_CAP_BYTES` bytes; what was cut is reported
    as `truncated: <n>`.

Consumed functions are imported lazily, inside the builder, so a test that
monkeypatches the source module reaches them (a module-level `from x import f`
would bind the original once, at import).
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, TimeoutError as _FutTimeout, wait
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any, Callable

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

PAYLOAD_CAP_BYTES = 16384
ROW_CAP = 40

#: TOTAL wall-clock budget for the implied-move reads of one request, and the pool size.
#: A vendor read is an unbounded external call on the single web pod's threadpool.
IMPLIED_MOVE_BUDGET_S = 6.0
IMPLIED_MOVE_WORKERS = 4

#: The generic phase 2 kind a widget built in the builder is stored as (wave 8). Its payload is built by
#: `widget_engine.payload.build_payload`, never by `build()`: it has no `_BUILDERS` row, and the phase 1 GET
#: route answers it as an unknown kind. Its KIND_WAVE / ACCOUNT_KINDS / KIND_TITLE rows landed with the client
#: row (Task 8.13), so the client/server/public-table rails compare one set on every side.
BUILT_KIND = "builtWidget"

#: Kind -> the release wave whose flag gates its menu entry and server read.
KIND_WAVE: dict[str, int] = {
    "myWatchlistToday": 1,
    "myNamesReporting": 1,
    "tickerCard": 1,
    "myPnlStats": 1,
    "myPositionsRisk": 1,
    "myRulesCheck": 2,
    "myMistakes": 2,
    "marketOnMyNames": 3,
    "tickerFlow": 3,
    "tradeRecap": 6,
    "myPnlCalendar": 6,
    "mySetupEdge": 6,
    "myScreenToday": 6,
    "roomBuzzOnMyNames": 6,
    "myEarningsReactions": 6,
    BUILT_KIND: 8,
}

#: Kinds that read the member's own account (never shown on a public page).
ACCOUNT_KINDS = frozenset({
    "myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes",
    "tradeRecap", "myPnlCalendar", "mySetupEdge", BUILT_KIND,
})


#: Kind -> its member-facing title, for the kinds the client lists (WIDGET_KINDS in
#: app/src/pages/journal-2-0/lib/notebookWidgets.js). ⛔ ONE FACT IN TWO FILES, railed by
#: tests/test_journal_styles_compose.py, which reads the client file. A starter style's failed
#: slot names the widget by this title (journal_styles._build_widget_slot).
KIND_TITLE: dict[str, str] = {
    "myWatchlistToday": "My watchlist today",
    "myNamesReporting": "My names reporting",
    "marketOnMyNames": "Market on my names",
    "tickerCard": "Ticker card",
    "tickerFlow": "Options flow on a ticker",
    "myPnlStats": "My P&L and stats",
    "myPositionsRisk": "My open positions and risk",
    "myRulesCheck": "My rules check",
    "myMistakes": "My recurring mistakes",
    "tradeRecap": "Trade recap",
    "myPnlCalendar": "My P&L calendar",
    "mySetupEdge": "My setup edge",
    "myScreenToday": "My screen today",
    "roomBuzzOnMyNames": "Room buzz on my names",
    "myEarningsReactions": "My earnings reactions",
    BUILT_KIND: "Widget",
}


class WidgetRequestError(ValueError):
    """An unknown kind, or params a builder cannot use. The router maps it to 400."""


class BoundedPool:
    """Final review I-4: a module-level thread pool with a NON-BLOCKING admission semaphore in front of it.

    `try_submit` answers a future, or None AT ONCE when every permit is held: nothing ever queues behind the
    pool. A permit is held from submit until the future is done (finished, failed or cancelled), so a
    straggler a request abandoned at its budget still counts against the ceiling until its own leaf
    timeout ends it. Pools are per process (a second web process doubles the ceiling)."""

    def __init__(self, workers: int, name: str, reserve: int = 0):
        if not 0 <= reserve < workers:
            raise ValueError(f"reserve must be in [0, {workers}), not {reserve!r}")
        self.workers = workers
        self._reserve = reserve
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=name)
        self._slots = threading.BoundedSemaphore(workers)
        # Task 8.7: pool work (phase 1 kinds) holds at most `workers - reserve` permits, so the
        # reserved ones are always there for inline admission (`admit_inline`).
        self._phase1 = threading.BoundedSemaphore(workers - reserve)

    def try_submit(self, fn: Callable, *args: Any) -> Future | None:
        phase1, slots = self._phase1, self._slots
        if not phase1.acquire(blocking=False):
            return None
        if not slots.acquire(blocking=False):
            phase1.release()
            return None
        try:
            fut = self._pool.submit(fn, *args)
        except RuntimeError:                        # the pool is shut down (interpreter exit)
            slots.release()
            phase1.release()
            return None

        def _done(_f: Future) -> None:
            slots.release()
            phase1.release()

        fut.add_done_callback(_done)
        return fut

    def admit_inline(self) -> bool:
        """Take one permit for work the CALLER runs on its own thread (a built-widget run, Task 8.7):
        True at once, or False at once when every permit is held. Never queues. Pair with
        `release_inline`. Inline work is bounded by `_slots` only, so it can use the reserve."""
        return self._slots.acquire(blocking=False)

    def release_inline(self) -> None:
        self._slots.release()

    def shutdown(self) -> None:
        """Stop taking work and cancel what has not started (a test's teardown; never on a live path)."""
        self._pool.shutdown(wait=False, cancel_futures=True)


#: ONE pool for every builder's vendor fan-out (implied moves, the flow page read, the earnings calendar
#: walk, the reaction figures). Looked up at call time, so a test can swap in a fresh one.
#: ⛔ journal_styles' slot builder keeps its OWN pool: a slot task waits on builder tasks, so sharing one
#: bounded pool could deadlock when it is full.
WIDGET_POOL_WORKERS = 8
#: Permits phase 1 kinds may never take: they are held for built-widget runs (Task 8.7), so phase 1
#: holds at most 6 and a builder run is never starved by a saturated fan-out.
WIDGET_POOL_RESERVE = 2
_POOL = BoundedPool(WIDGET_POOL_WORKERS, "nb-widget", reserve=WIDGET_POOL_RESERVE)


def _fan_out(fn: Callable, jobs: dict[str, tuple], *, per_request: int, budget_s: float) -> dict[str, Any]:
    """{key: fn(*args)} for each job, on the shared pool under ONE total budget, at most `per_request` in
    flight at once. A key missing from the answer did not finish: past the budget, raised, or never run
    because the pool was saturated by other requests (then the rest answer AT ONCE, never queued)."""
    results: dict[str, Any] = {}
    pending = list(jobs.items())
    inflight: dict[Future, str] = {}
    deadline = time.monotonic() + budget_s
    try:
        while pending or inflight:
            while pending and len(inflight) < per_request:
                fut = _POOL.try_submit(fn, *pending[0][1])
                if fut is None:
                    break
                inflight[fut] = pending.pop(0)[0]
            if not inflight:
                break                                # saturated: nothing of ours is running to wait for
            left = deadline - time.monotonic()
            if left <= 0:
                break
            done, _ = wait(list(inflight), timeout=left, return_when=FIRST_COMPLETED)
            for fut in done:
                key = inflight.pop(fut)
                try:
                    results[key] = fut.result()
                except Exception as e:  # noqa: BLE001 -- one miss is a null cell, not a dead widget
                    _log.info("widget fan-out: %s failed: %s", key, e)
    finally:
        for fut in inflight:
            fut.cancel()
    return results


def _one_bounded(fn: Callable, budget_s: float) -> tuple[bool, Any]:
    """(True, fn()) on the shared pool inside `budget_s`; (False, None) when it ran past the budget, raised,
    or the pool was saturated (answered at once). A straggler is abandoned, never waited for."""
    fut = _POOL.try_submit(fn)
    if fut is None:
        _log.info("widget read skipped: the widget pool is saturated")
        return False, None
    try:
        return True, fut.result(timeout=budget_s)
    except _FutTimeout:
        _log.info("widget read ran past %.1fs", budget_s)
        return False, None
    except Exception as e:  # noqa: BLE001
        _log.info("widget read failed: %s", e)
        return False, None


class _LeaderAborted(Exception):
    """What a run_here waiter receives when its leader was interrupted by a non-Exception BaseException."""


class SingleFlight:
    """Fix F1 (C-1, I-1): ONE shared walk per key on the module pool, however many requests miss at once.

    `run(key, fn, budget_s)` joins the walk already in flight for `key`, or starts `fn` on `_POOL` (looked
    up at call time). The caller waits at most `budget_s`; past it, or when the pool is saturated, it gets
    (False, None) and the walk carries on. ⛔ `fn` must store its own answer in the cache: the job that
    finishes after every request has answered still warms the next one.

    Waiting holds a REQUEST thread (the anyio pool), so at most `waiters` requests wait on walks at once;
    the rest answer their partial form AT ONCE, the way a saturated widget pool does. Per process."""

    def __init__(self, waiters: int, name: str = "widget walk"):
        self._lock = threading.Lock()
        self._inflight: dict[str, Future] = {}
        self._waiters = threading.BoundedSemaphore(waiters)
        self.name = name                                  # what the log lines call this table (review m6)

    def _forget(self, key: str, fut: Future) -> None:
        with self._lock:
            if self._inflight.get(key) is fut:
                del self._inflight[key]

    def inflight(self) -> int:
        with self._lock:
            return len(self._inflight)

    def run(self, key: str, fn: Callable[[], Any], budget_s: float) -> tuple[bool, Any]:
        started = False
        with self._lock:
            fut = self._inflight.get(key)
            if fut is None or fut.done():
                fut = _POOL.try_submit(fn)
                if fut is None:
                    _log.info("%s %s skipped: the widget pool is saturated", self.name, key)
                    return False, None
                self._inflight[key] = fut
                started = True
        if started:          # outside the lock: a job already done runs the callback in this thread
            fut.add_done_callback(lambda f, k=key: self._forget(k, f))
        return self._wait(key, fut, budget_s)

    def run_here(self, key: Any, fn: Callable[[], Any], budget_s: float) -> tuple[bool, Any]:
        """`run` with the leader computing `fn` on the CALLER's own thread, never the pool (fix F1b, review
        M-2): for work bound to its thread, such as a read through a sqlite connection the request opened.
        The first caller for `key` runs `fn` and returns (True, value), or raises what `fn` raised. A caller
        that arrives while it runs waits at most `budget_s` for that value; past it, when the leader raised,
        or when `waiters` callers already wait, it gets (False, None) and computes its own."""
        with self._lock:
            fut = self._inflight.get(key)
            lead = fut is None or fut.done()
            if lead:
                fut = Future()
                self._inflight[key] = fut
        if not lead:
            return self._wait(key, fut, budget_s)
        try:
            value = fn()
        except Exception as e:
            fut.set_exception(e)
            raise
        except BaseException:
            # Review m5: a KeyboardInterrupt / SystemExit belongs to the LEADER's thread and propagates there;
            # its waiters get an ordinary failure, so they take the miss path instead of re-raising it.
            fut.set_exception(_LeaderAborted(f"the leader for {key!r} was interrupted"))
            raise
        else:
            fut.set_result(value)
            return True, value
        finally:
            self._forget(key, fut)

    def _wait(self, key: Any, fut: Future, budget_s: float) -> tuple[bool, Any]:
        if not self._waiters.acquire(blocking=False):
            return False, None
        try:
            return True, fut.result(timeout=budget_s)
        except _FutTimeout:
            _log.info("%s %s ran past %.1fs", self.name, key, budget_s)
            return False, None
        except Exception as e:  # noqa: BLE001
            _log.info("%s %s failed: %s", self.name, key, e)
            return False, None
        finally:
            self._waiters.release()


#: How many requests may wait on a calendar walk at once (the rest answer partial at once).
WALK_WAITERS = 8
#: The calendar walks' single-flight table. Looked up at call time, so a test can swap in a fresh one.
_WALKS = SingleFlight(WALK_WAITERS)


def notebook_widgets_wave_on(wave: int) -> bool:
    """Is release wave `wave` on, read from the environment NOW (never at import)."""
    from api.services import notebook_flags
    return notebook_flags.flag_on(f"NOTEBOOK_WIDGETS_W{int(wave)}_ENABLED", False)


def _iso_utc(now: datetime) -> str:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _today_et(now: datetime) -> date:
    """The ET calendar date of `now`, so the earnings window agrees with `asOf`."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(ZoneInfo("America/New_York")).date()


def _num(v: Any) -> float | None:
    """A finite number or None. A missing figure must never render as 0."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


#: Kind -> the payload key holding its one trimmable list (fix F1, audit I-2). A kind not named here has
#: no list to trim: over the cap, it gets the too-large form.
LIST_KEY: dict[str, str] = {
    "myWatchlistToday": "rows", "myNamesReporting": "rows", "myPositionsRisk": "rows", "myMistakes": "rows",
    "marketOnMyNames": "rows", "mySetupEdge": "rows", "roomBuzzOnMyNames": "rows", "myEarningsReactions": "rows",
    "myRulesCheck": "rules", "myScreenToday": "hits", "myPnlCalendar": "days", "tickerFlow": "topPrints",
    "tradeRecap": "bars", "myPnlStats": "equity",
}
#: The list keys `cap_payload` looks for when it is not told the kind, in this order.
_ANY_LIST_KEYS = ("rows", "rules", "hits", "days", "topPrints", "bars", "equity")
#: Member text with no length limit where it is stored (`settings._validate_setup_rules` caps the count of
#: setup rules, not their labels; `trades._normalize_string_list` caps neither count nor length of tags).
RULE_LABEL_MAX = 120
MISTAKE_TAG_MAX = 60
MISTAKES_MAX = 20
TOO_LARGE_SENTENCE = "This widget's data was too large to save. Narrow it and try again."
#: Scalars the too-large form keeps so the frame still says which widget and when.
_TOO_LARGE_KEEP = ("asOf", "source", "sourceDetail", "symbol", "month", "range", "listLabel", "name")
#: What a too-large BUILT widget also keeps: what "See it now" needs to run again (its frozen copy and pin)
#: and what the frame shows. Each is bounded where it is made (`def` at 4,096 B, the labels by the plan's
#: 200-character text cap), so these get their own, larger per-key ceiling.
_BUILT_TOO_LARGE_KEEP = ("title", "view", "sourceKey", "defId", "defRev", "latestRev", "def", "defRef",
                         "scopeLabel", "rangeLabel", "accountId", "filter", "sample", "notice")
_BUILT_KEEP_MAX_BYTES = 4_400
#: What the too-large form always keeps, whatever its size guard drops.
_TOO_LARGE_FRAME = frozenset({"asOf", "source", "tooLarge", "empty"})


def _payload_size(p: dict) -> int:
    """Bytes of the compact JSON (ASCII-escaped, so never fewer than the UTF-8 the note stores)."""
    return len(json.dumps(p, separators=(",", ":")).encode("utf-8"))


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _clip_member_text(payload: dict) -> dict:
    """Step 1 of the cap: the known unbounded strings, clipped (rule labels, mistake tags), and a
    recap's mistake list held to MISTAKES_MAX (`mistakesTruncated` counts the rest)."""
    out = dict(payload)
    if isinstance(out.get("rules"), list):
        out["rules"] = [{**r, "rule": _clip(r["rule"], RULE_LABEL_MAX)}
                        if isinstance(r, dict) and isinstance(r.get("rule"), str) else r for r in out["rules"]]
    if isinstance(out.get("rows"), list):
        out["rows"] = [{**r, "mistake": _clip(r["mistake"], MISTAKE_TAG_MAX)}
                       if isinstance(r, dict) and isinstance(r.get("mistake"), str) else r for r in out["rows"]]
    if isinstance(out.get("mistakes"), list):
        tags = [_clip(m, MISTAKE_TAG_MAX) if isinstance(m, str) else m for m in out["mistakes"]]
        if len(tags) > MISTAKES_MAX:
            out["mistakesTruncated"] = len(tags) - MISTAKES_MAX
        out["mistakes"] = tags[:MISTAKES_MAX]
    return out


def _too_large(payload: dict, kind: str | None = None) -> dict:
    out: dict[str, Any] = {}
    for k in _TOO_LARGE_KEEP:
        v = payload.get(k)
        if v is not None and _payload_size({k: v}) <= 200:
            out[k] = v
    if kind == BUILT_KIND:
        for k in _BUILT_TOO_LARGE_KEEP:
            v = payload.get(k)
            if k not in out and v is not None and _payload_size({k: v}) <= _BUILT_KEEP_MAX_BYTES:
                out[k] = v
    out.setdefault("asOf", payload.get("asOf"))
    out.setdefault("source", payload.get("source"))
    out["tooLarge"] = True
    out["empty"] = TOO_LARGE_SENTENCE
    # 8.6 review Minor 1: each built key is bounded on its own, but together they could pass the cap.
    # Drop the largest optional key until the form fits; the frame keys are never dropped.
    while _payload_size(out) > PAYLOAD_CAP_BYTES:
        optional = [k for k in out if k not in _TOO_LARGE_FRAME]
        if not optional:
            break
        del out[max(optional, key=lambda k: _payload_size({k: out[k]}))]
    return out


def cap_payload(payload: dict, kind: str | None = None, list_key: str | None = None,
                trim_from: str = "end") -> dict:
    """Hold the compact JSON to `PAYLOAD_CAP_BYTES` across EVERY field (fix F1, audit I-2):

      1. clip the known unbounded member strings (`_clip_member_text`);
      2. drop items from one list and add what was dropped to `truncated` (a builder's boolean `truncated`
         stays True). The list is `list_key` when given (a built widget names it by view), else the kind's
         (`LIST_KEY`), else the first of `_ANY_LIST_KEYS` present when no kind is given. `trim_from="end"`
         drops the last items (a list sorted best first); `"start"` drops the first (a series ordered
         oldest first keeps its newest buckets);
      3. still over, or fitting only by dropping EVERY item: the too-large form, `tooLarge: true` and
         `TOO_LARGE_SENTENCE`. Never an oversized payload, and never every row gone without a sentence.

    A payload that fits after step 1 is returned as it is.

    How many items fit is found by bisection, not by dropping one at a time: the size grows strictly with
    each item kept, so the answer is the same (railed), and a 5,000-row list costs a dozen serialisations
    instead of thousands.

    Each probe carries the `truncated` count it would write (ruling R-18). The old loop measured the
    trimmed list without it, so a trim whose own count tipped it over the cap fell to the too-large form
    and the member lost every row."""
    if trim_from not in ("end", "start"):
        raise ValueError(f"trim_from must be 'end' or 'start', not {trim_from!r}")
    out = _clip_member_text(payload)
    if _payload_size(out) <= PAYLOAD_CAP_BYTES:
        return out
    if list_key is not None:
        key = list_key
    else:
        key = LIST_KEY.get(kind) if kind else next((k for k in _ANY_LIST_KEYS if isinstance(out.get(k), list)), None)
    items = out.get(key) if key else None
    if isinstance(items, list) and items:
        prior = out.get("truncated")
        n = len(items)

        def _trimmed(k: int) -> dict:
            kept = list(items[n - k:]) if trim_from == "start" else list(items[:k])
            t = {**out, key: kept}
            if n - k:
                t["truncated"] = True if isinstance(prior, bool) and prior else int(prior or 0) + (n - k)
            return t

        lo, hi = 0, n          # the largest count that fits lies in [lo, hi]; 0 always "fits" here
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if _payload_size(_trimmed(mid)) <= PAYLOAD_CAP_BYTES:
                lo = mid
            else:
                hi = mid - 1
        trimmed = _trimmed(max(lo, 1))
        if _payload_size(trimmed) <= PAYLOAD_CAP_BYTES:
            return trimmed
    return _too_large(out, kind)


# -- the earnings window (tickerCard, myWatchlistToday, myNamesReporting) ------

#: ONE wait, per request, on the shared earnings-calendar walk (fix F1, C-1).
EARNINGS_WINDOW_BUDGET_S = 6.0


def _earnings_window(now: datetime) -> tuple | None:
    """`earnings_prep._window(today)`'s answer, or None when it could not be read in time.

    A cached window answers at once on the request thread. A miss joins ONE shared walk on the module
    pool (`_WALKS`) and waits at most `EARNINGS_WINDOW_BUDGET_S`; the walk stores its own answer in the
    cache (inside `_window`), so a walk that outlives every request still warms the next one. Never
    the walk on a request thread: it is up to 8 day lookups, each two vendors with 10 s timeouts."""
    return earnings_window_for(_today_et(now))


def earnings_window_for(today: date) -> tuple | None:
    """`_earnings_window` for an ET calendar day the caller already holds. The Earnings prep route's
    GET /soon reads the window through here too (fix F1b, review I-1), so it never walks the calendar
    on its request thread either, and it shares the one walk (`_WALKS`) with every widget."""
    from api.services.journal_two import earnings_prep
    try:
        got = earnings_prep.cached_window(today)
    except Exception as e:  # noqa: BLE001 -- an unreadable cache is a miss
        _log.info("earnings window: cache read failed: %s", e)
        got = None
    if got is not None:
        return got
    ok, got = _WALKS.run(f"earnings_prep_window::{today.isoformat()}",
                         lambda: earnings_prep._window(today), EARNINGS_WINDOW_BUDGET_S)
    return got if ok and isinstance(got, tuple) and len(got) == 4 else None


# -- myWatchlistToday ----------------------------------------------------------

_LIST_LABELS = {"watchlist": "Watchlist", "flagged": "Flagged"}

#: The request keys a builder reads from `params` (R4). The router passes exactly these through, and a member
#: style's snapshot slot (Task 18) keeps exactly these as its settings. The client's SETTINGS_KEYS in
#: notebookSets.js is pinned to this tuple by test_journal_styles_compose.
SETTING_KEYS: tuple[str, ...] = ("symbol", "list", "from", "to", "month", "definitionId", "tradeId")
_SETTING_MAX_CHARS = 64


def settings_of(params: Any) -> dict:
    """The builder settings inside a widget's stored params (which hold the frozen PAYLOAD): each
    SETTING_KEYS entry that is non-empty text, and nothing else, so no figure, row or `share` switch
    survives. `list` is recovered from the payload's `listLabel` (which list is a setting), as the client's
    presetParams does. A date range is NOT recovered from the payload's `range`: when none was asked for,
    those dates were the day's default, and keeping them would freeze one week forever."""
    p = params if isinstance(params, dict) else {}
    out = {k: p[k] for k in SETTING_KEYS
           if isinstance(p.get(k), str) and p[k] and len(p[k]) <= _SETTING_MAX_CHARS}
    if "list" not in out:
        by_label = {label: key for key, label in _LIST_LABELS.items()}
        if p.get("listLabel") in by_label:
            out["list"] = by_label[p["listLabel"]]
    return out


def _my_watchlist_today(user_id: str, params: dict, now: datetime) -> dict:
    from api.services import calendar_personalization
    sets = calendar_personalization.get_user_ticker_sets(user_id) or {}
    chosen = (params or {}).get("list")
    if chosen is not None and chosen not in _LIST_LABELS:
        raise WidgetRequestError("list must be 'watchlist' or 'flagged'")
    if chosen is None:
        chosen = "watchlist" if sets.get("watchlist") else "flagged"
    symbols = sorted({str(s).upper() for s in (sets.get(chosen) or ()) if s})
    shown, cut = symbols[:ROW_CAP], max(0, len(symbols) - ROW_CAP)

    prices: dict = {}
    earnings: dict[str, str] = {}
    earnings_unknown = False
    if shown:
        try:
            from api.routers import live_prices
            got = live_prices.get_live_prices(tickers=",".join(shown))
            prices = got if isinstance(got, dict) else {}
        except Exception as e:  # noqa: BLE001 -- no price is "n/a", never a failed widget
            _log.info("watchlist today: live prices failed: %s", e)
        read = _earnings_window(now)
        earnings_unknown = read is None or bool(read[2])
        if read is not None:
            try:
                from api.services.journal_two import earnings_prep
                soon = earnings_prep.reporting_soon(user_id, today=_today_et(now), window_read=read)
                for it in (soon or {}).get("items") or []:
                    if it.get("symbol") and it.get("date"):
                        earnings[str(it["symbol"]).upper()] = str(it["date"])
            except Exception as e:  # noqa: BLE001
                _log.info("watchlist today: earnings window failed: %s", e)
                earnings_unknown = True

    rows = []
    for sym in shown:
        row = prices.get(sym) if isinstance(prices.get(sym), dict) else {}
        rows.append({
            "symbol": sym,
            "price": _num(row.get("price")),
            "changePct": _num(row.get("change_pct")),
            "earningsDay": earnings.get(sym),
        })
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "listLabel": _LIST_LABELS[chosen],
        "rows": rows,
        # True: the earnings calendar was not (fully) read, so a row's null earningsDay is unknown.
        # False: a null earningsDay means no report this week.
        "earningsUnknown": earnings_unknown,
    }
    if earnings_unknown and shown:
        out["partial"] = True
    if cut:
        out["truncated"] = cut
    return out


# -- myNamesReporting ----------------------------------------------------------

def _implied_move_pct(sym: str, day: str | None, timing: str | None) -> float | None:
    try:
        from api.services import earnings_enrichment
        got = earnings_enrichment.get_implied_move(sym, day, timing)
        return _num(got.get("pct")) if isinstance(got, dict) else None
    except Exception as e:  # noqa: BLE001 -- one vendor miss is a null cell, not a dead widget
        _log.info("names reporting: implied move failed for %s: %s", sym, e)
        return None


def _implied_moves(items: list[dict]) -> tuple[dict[str, float | None], bool]:
    """{SYM: pct or None} for `items`, run in a small pool under ONE total budget.

    A symbol not finished when the budget runs out is None and the second value is
    True (the payload is partial). Nothing blocks past the budget: unstarted futures
    are cancelled and the pool is released without waiting for a straggler.
    """
    if not items:
        return {}, False
    jobs = {}
    for it in items:
        sym = str(it.get("symbol") or "").upper()
        jobs[sym] = (sym, it.get("date"), it.get("timing"))
    got = _fan_out(_implied_move_pct, jobs, per_request=IMPLIED_MOVE_WORKERS, budget_s=IMPLIED_MOVE_BUDGET_S)
    return {sym: got.get(sym) for sym in jobs}, any(sym not in got for sym in jobs)


def _my_names_reporting(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import earnings_prep
    read = _earnings_window(now)
    if read is None:
        # The calendar could not be read in time: the partial form, never "none of your names report".
        return {"asOf": _iso_utc(now), "source": "market", "rows": [], "partial": True,
                "earningsUnknown": True}
    soon = earnings_prep.reporting_soon(user_id, today=_today_et(now), window_read=read) or {}
    items = list(soon.get("items") or [])
    shown, cut = items[:ROW_CAP], max(0, len(items) - ROW_CAP)
    moves, timed_out = _implied_moves(shown)
    rows = []
    for it in shown:
        sym = str(it.get("symbol") or "").upper()
        rows.append({
            "symbol": sym,
            "day": it.get("date"),
            "timing": it.get("timing"),
            "daysAway": it.get("daysAway"),
            "sources": list(it.get("sources") or []),
            "impliedMovePct": moves.get(sym),
        })
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "rows": rows,
        "partial": bool(soon.get("partial")) or timed_out,
        "earningsUnknown": bool(soon.get("partial")),
    }
    if cut:
        out["truncated"] = cut
    return out


# -- account kinds: shared helpers ---------------------------------------------------

EQUITY_POINTS_MAX = 60

#: The trade `source` value a broker import stamps (`trades.bulk_insert_trades(source="broker")`).
_BROKER_SOURCE = "broker"


def _origin(sources: list) -> str:
    """"broker" when every item is broker-imported, "manual" when none is, else "mixed"."""
    flags = [s == _BROKER_SOURCE for s in sources]
    if flags and all(flags):
        return "broker"
    if any(flags):
        return "mixed"
    return "manual"


#: Ruling R60: the earliest day a widget reads. A date outside EARLIEST_DAY .. today + 1 year is a 400
#: sentence, never a 500 (`0001-01-01` overflowed analytics' `date_from - 1 day`).
EARLIEST_DAY = date(1990, 1, 1)


def _latest_day(today: date) -> date:
    try:
        return today.replace(year=today.year + 1)
    except ValueError:                                   # 29 February
        return today.replace(year=today.year + 1, day=28)


def _iso_day(raw: Any, label: str, today: date) -> str:
    try:
        d = date.fromisoformat(str(raw))
    except (TypeError, ValueError):
        raise WidgetRequestError(f"{label} must be an ISO day (YYYY-MM-DD)") from None
    if not EARLIEST_DAY <= d <= _latest_day(today):
        raise WidgetRequestError(
            f"{label} must be between {EARLIEST_DAY.isoformat()} and {_latest_day(today).isoformat()}")
    return d.isoformat()


def _week_range(params: dict, now: datetime) -> tuple[str, str]:
    """(from, to) ISO days: `params` when given, else Monday of this ET week through today.
    The one spelling of the default range, shared by every account kind that takes one."""
    today = _today_et(now)
    day_to = _iso_day(params["to"], "to", today) if params.get("to") else today.isoformat()
    day_from = (
        _iso_day(params["from"], "from", today) if params.get("from")
        else (date.fromisoformat(day_to) - timedelta(days=date.fromisoformat(day_to).weekday())).isoformat()
    )
    if day_from > day_to:
        raise WidgetRequestError("from must not be after to")
    return day_from, day_to


def _pnl_figures(analytics: dict) -> dict:
    """Net P&L, win rate and average R, each read from the analytics section that already
    computes it (never re-derived here; a second authority over one value is a defect):

      * netPnl  <- performance.byDay, the per-day NET P&L the equity curve is built from
      * winRate <- edgeScore.components.winRate (Win / (Win + Loss) over the range)
      * avgR    <- risk.expectancyR (mean effective R; the risk section's own
                   coverage gate leaves it None under 10 decisive trades)

    A figure that is absent from the payload stays None, never 0.
    """
    a = analytics if isinstance(analytics, dict) else {}
    days = ((a.get("performance") or {}).get("byDay")) or []
    pnls = [_num(d.get("pnl")) for d in days if isinstance(d, dict)]
    pnls = [p for p in pnls if p is not None]
    net = round(sum(pnls), 2) if pnls else None
    components = (a.get("edgeScore") or {}).get("components") or {}
    return {
        "netPnl": net,
        "winRate": _num(components.get("winRate")),
        "avgR": _num((a.get("risk") or {}).get("expectancyR")),
        "tradeCount": int(a.get("tradeCount") or 0),
    }


def _equity_points(analytics: dict) -> list[list]:
    """The equity section's curve as [[day, value], ...], at most EQUITY_POINTS_MAX points
    picked by an even stride (first and last point always kept)."""
    curve = (((analytics or {}).get("equity") or {}).get("curve")) or []
    pts = [[c.get("date"), _num(c.get("equity"))] for c in curve if isinstance(c, dict)]
    n = len(pts)
    if n <= EQUITY_POINTS_MAX:
        return pts
    step = (n - 1) / (EQUITY_POINTS_MAX - 1)
    return [pts[round(i * step)] for i in range(EQUITY_POINTS_MAX)]


# -- myPnlStats ----------------------------------------------------------------------

def _my_pnl_stats(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import analytics, trades
    from api.services.journal_two.filters import FilterSpec
    day_from, day_to = _week_range(params, now)
    spec = FilterSpec(date_from=day_from, date_to=day_to)
    payload = analytics.get_analytics(user_id, spec=spec)
    got = trades.list_trades_for_user(user_id, spec=FilterSpec(date_from=day_from, date_to=day_to))
    rows = got[0] if isinstance(got, tuple) else got
    fig = _pnl_figures(payload)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": _origin([(t or {}).get("source") for t in rows]),
        "range": {"from": day_from, "to": day_to},
        "netPnl": fig["netPnl"],
        "winRate": fig["winRate"],
        "avgR": fig["avgR"],
        "tradeCount": fig["tradeCount"],
        "equity": _equity_points(payload),
    }
    if fig["tradeCount"] == 0:
        out.update(netPnl=None, winRate=None, avgR=None, equity=[])
        out["empty"] = "No closed trades in this range yet."
    return out


# -- myPositionsRisk -----------------------------------------------------------------

def _account_size(user_id: str) -> float | None:
    """The member's own account size, or None when they never set one.

    READ-ONLY by construction: `accounts.read_member_account_size`, one SELECT on `j2_accounts`
    (the Default account first, else the oldest) through the ONE predicate, so the migrated
    placeholder is None and a member-set size (marker read) is theirs whatever its value. Not
    `accounts.get_or_migrate_default_account`, which inserts a default account and reassigns the
    member's positions and trades on first call, and not `portfolio_heat`'s figure, which falls
    back to a default amount so its math always runs; a default must never print as the
    member's real account.
    """
    try:
        from api.services.journal_two import accounts as j2_accounts
        return j2_accounts.read_member_account_size(user_id)
    except Exception as e:  # noqa: BLE001 -- no account size is "n/a", never a failed widget
        _log.info("positions risk: account size read failed: %s", e)
        return None


_OPT_SINGLE_LEG = frozenset({"long_call", "long_put", "short_call", "short_put"})
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _js_number(v: Any) -> str:
    """A number the way the client's template literal prints it: 110 -> '110', 110.5 -> '110.5'."""
    f = _num(v)
    if f is None:
        return str(v)
    return str(int(f)) if f == int(f) else repr(f)


def _exp_short(exp: Any) -> str:
    """'2026-10-16' -> 'Oct 16' (the table's `toLocaleString` month and day), '' when unreadable."""
    try:
        d = date.fromisoformat(str(exp)[:10])
    except (TypeError, ValueError):
        return ""
    return f"{_MONTHS[d.month - 1]} {d.day}"


def _strategy_label(s: dict) -> str:
    """optionCalcs.js `buildStrategyLabel`, the multi-leg label the Open Positions table shows."""
    legs = [l for l in (s.get("legs") or []) if isinstance(l, dict)]
    underlying = str(s.get("underlying") or "")
    kind = str(s.get("strategyType") or "")
    exps = [str(l.get("expiration")) for l in legs if l.get("expiration")]
    exp_code = _exp_short(min(exps)) if exps else ""
    strikes = "/".join(_js_number(x) for x in sorted(_num(l.get("strike")) or 0.0 for l in legs))
    if len(legs) == 1:
        leg = legs[0]
        cp = "C" if leg.get("contractType") == "call" else "P"
        word = "Long" if leg.get("side") == "buy" else "Short"
        return f"{underlying} {_js_number(leg.get('strike'))}{cp} {word} {exp_code}".strip()
    if kind.startswith("vertical_"):
        cp = "Call" if kind.endswith("_call") else "Put"
        spread = "Debit Spread" if "debit" in kind else "Credit Spread"
        return f"{underlying} {strikes} {cp} {spread} {exp_code}".strip()
    if kind in ("iron_condor", "iron_butterfly"):
        name = "Iron Condor" if kind == "iron_condor" else "Iron Butterfly"
        return f"{underlying} {strikes} {name} {exp_code}".strip()
    pretty = re.sub(r"\b\w", lambda m: m.group(0).upper(), kind.replace("_", " "))
    return f"{underlying} {pretty} {exp_code}".strip()


def _option_row(s: dict, account: float | None) -> dict:
    """One OPEN option strategy as the Open Positions table shows it (OpenPositionsTab `optionToRow`): the
    compact "CRWV Oct 16 $110C" + "Long Call" for a single leg, `buildStrategyLabel` + Long/Short for a
    multi-leg one. Open P&L is the stored broker value less the net entry; size % is the value's share of
    the account. ⚠️ The table prefers a live option mark when its marks feed has one; this server read has
    only the stored broker value, so `priceBasis` counts every option row as a broker mark."""
    legs = [l for l in (s.get("legs") or []) if isinstance(l, dict)]
    leg = legs[0] if legs else {}
    kind = str(s.get("strategyType") or "")
    underlying = str(s.get("underlying") or "").upper()
    if kind in _OPT_SINGLE_LEG:
        is_long, is_call = kind.startswith("long_"), kind.endswith("call")
        side = f"{'Long' if is_long else 'Short'} {'Call' if is_call else 'Put'}"
        when = _exp_short(leg.get("expiration"))
        symbol = f"{underlying}{' ' + when if when else ''} ${_js_number(leg.get('strike'))}{'C' if is_call else 'P'}"
    else:
        net = _num(s.get("netEntry")) or 0.0
        side = "Short" if net < 0 else "Long"           # classifyDebitCredit: only a credit is short
        symbol = _strategy_label(s)
    value = _num(s.get("brokerCurrentValue"))
    net_entry = _num(s.get("netEntry"))
    return {
        "positionId": None,
        "symbol": symbol,
        "side": side,
        "kind": "option",
        "sizePct": round(abs(value) / account * 100, 2) if value is not None and account else None,
        "openPnl": round(value - net_entry, 2) if None not in (value, net_entry) else None,
        "stopPrice": None,
        "distToStopPct": None,
        "noStop": None,                                  # a stop does not apply to an option row
    }


def _open_strategies(user_id: str) -> list[dict]:
    """The member's OPEN option strategies through the Journal's own reader (the Open Positions tab's
    `GET /api/j2/option-strategies?status=open`). Read-only. A failed read is no rows, logged."""
    try:
        from api.services.journal_two import options as j2_options
        return [s for s in (j2_options.list_strategies(user_id, status="open") or []) if isinstance(s, dict)]
    except Exception as e:  # noqa: BLE001 -- one source failing never blanks the stock rows
        _log.info("positions risk: option strategies read failed: %s", e)
        return []


def _mark_clock(now: datetime) -> tuple[bool, str | None]:
    """(session closed, last closed session ET date): the two inputs `prefer_broker_marks` takes, read the
    way the client's `useMarkPreferenceContext` reads them. Closed = not a trading day, or outside
    04:00-20:00 ET (not open, not premarket, not extended hours). The session calendar is
    `flow_card_ops`' (NYSE holidays, 16:00 close); a failed read is "open", which keeps live prices."""
    try:
        from api.services import flow_card_ops
        ts = (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).timestamp()
        et = (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).astimezone(_ET)
        minutes = et.hour * 60 + et.minute
        closed = not flow_card_ops._is_session(et.date()) or not (4 * 60 <= minutes < 20 * 60)
        return closed, flow_card_ops.last_closed_session(ts).isoformat()
    except Exception as e:  # noqa: BLE001
        _log.info("positions risk: session clock failed: %s", e)
        return False, None


def _accounts_by_id(user_id: str) -> dict[str, dict]:
    """The member's accounts by id (a SELECT; never the migrating default-account read)."""
    try:
        from api.services.journal_two import accounts as j2_accounts
        return {a["id"]: a for a in (j2_accounts.list_accounts(user_id) or []) if isinstance(a, dict) and a.get("id")}
    except Exception as e:  # noqa: BLE001 -- no account means "prefer live", the intraday answer
        _log.info("positions risk: accounts read failed: %s", e)
        return {}


def _position_price(p: dict, live: float | None, prefer_broker: bool) -> tuple[float | None, str | None]:
    """(price, "live" | "broker" | None): `calculations.js` `currentPriceFor`, the Open Positions table's rule.
    After the close (`prefer_broker_marks`) the broker's own mark wins; otherwise the live price, with the
    broker mark only when there is no live one. Either way a preference, never a restriction."""
    broker = _num(p.get("brokerPrice"))
    if prefer_broker and broker is not None:
        return broker, "broker"
    if live is not None:
        return live, "live"
    return (broker, "broker") if broker is not None else (None, None)


def _price_basis(bases: list) -> str | None:
    """"live", "broker" or "mixed" over the rows that were priced; None when none was."""
    got = {b for b in bases if b}
    return None if not got else (got.pop() if len(got) == 1 else "mixed")


def _my_positions_risk(user_id: str, params: dict, now: datetime) -> dict:
    from api.services import portfolio_heat
    from api.services.journal_two import positions as j2_positions
    open_positions = list(j2_positions.list_open_positions(user_id) or [])
    # READ-ONLY: heat gets the size this widget already read (`_account_size`, one SELECT), never its
    # own default reader, which migrates a Default j2_accounts row for a member who has none.
    own_size = _account_size(user_id)   # already the member's own (the predicate ran there)
    heat = portfolio_heat.portfolio_heat(user_id, account_size_fn=lambda _u, _a: own_size) or {}
    # Fix F1 (audit I-5): open option strategies are rows too, as the Open Positions tab shows them.
    strategies = _open_strategies(user_id)
    shown, cut = open_positions[:ROW_CAP], max(0, len(open_positions) - ROW_CAP)
    opt_shown = strategies[:ROW_CAP - len(shown)]
    cut += len(strategies) - len(opt_shown)

    # Heat walks the same open positions in order, so rows are matched on symbol + side,
    # in order, which keeps two lots of one name apart.
    heat_rows: dict[tuple, list[dict]] = {}
    for h in heat.get("per_position") or []:
        key = (str(h.get("symbol") or "").upper(), str(h.get("side") or "").lower())
        heat_rows.setdefault(key, []).append(h)
    joined: list[dict | None] = []
    for p in open_positions:
        key = (str(p.get("symbol") or "").upper(), str(p.get("side") or "").lower())
        bucket = heat_rows.get(key) or []
        joined.append(bucket.pop(0) if bucket else None)

    # A size is the member's own only when `accounts.member_set_account_size` says so: the ONE
    # predicate heat and sizing also ask (the migrated Default row's placeholder is unset). Correct
    # on the second call too: the migrated row holds the constant, so it still reads "default".
    is_default = own_size is None or bool(heat.get("account_size_is_default"))
    from api.services.voice_position_sizing import UNSET_ACCOUNT_SIZE
    account = UNSET_ACCOUNT_SIZE if is_default else own_size   # the size heat computed on
    prices: dict = {}
    if shown:
        try:
            from api.routers import live_prices
            got = live_prices.get_live_prices(
                tickers=",".join(sorted({str(p.get("symbol") or "").upper() for p in shown})))
            prices = got if isinstance(got, dict) else {}
        except Exception as e:  # noqa: BLE001
            _log.info("positions risk: live prices failed: %s", e)

    # Fix F1 (audit I-6): after the close a broker position is valued at the broker's own mark, as the
    # Open Positions table does (`prefer_broker_marks`, per account); `priceBasis` says which was used.
    from api.services.journal_two.broker import composition
    closed, last_closed = _mark_clock(now)
    accounts_by_id = _accounts_by_id(user_id) if shown else {}
    rows, bases = [], []
    for p, h in zip(shown, joined):
        sym = str(p.get("symbol") or "").upper()
        quote = prices.get(sym) if isinstance(prices.get(sym), dict) else {}
        acc = accounts_by_id.get(p.get("accountId"))
        prefer = bool(acc) and composition.prefer_broker_marks(acc, closed, last_closed)
        price, basis = _position_price(p, _num(quote.get("price")), prefer)
        bases.append(basis)
        qty, entry = _num(p.get("shares")), _num(p.get("entryPrice"))
        sign = -1.0 if str(p.get("side") or "").lower() == "short" else 1.0
        open_pnl = (
            round((price - entry) * qty * sign, 2)
            if None not in (price, qty, entry) else None
        )
        size_pct = (
            round(qty * price / account * 100, 2)
            if account and None not in (price, qty) else None
        )
        # `placeholder_stop` is heat's own verdict; no heat row is an unknown, not a "no".
        no_stop = None if h is None else bool(h.get("placeholder_stop"))
        has_stop = h is not None and not no_stop
        rows.append({
            "positionId": p.get("id"),
            "symbol": sym,
            "side": p.get("side"),
            "kind": "stock",
            "sizePct": size_pct,
            "openPnl": open_pnl,
            "stopPrice": _num(h.get("stop_price")) if has_stop else None,
            "distToStopPct": _num(h.get("dist_to_stop_pct")) if has_stop else None,
            "noStop": no_stop,
        })
    rows += [_option_row(st, account) for st in opt_shown]
    # An option row's value is the stored broker mark (`_option_row`).
    bases += ["broker" for st in opt_shown if _num(st.get("brokerCurrentValue")) is not None]
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": _origin([p.get("source") for p in open_positions] + [st.get("source") for st in strategies]),
        "accountSize": account,
        "accountSizeSource": "default" if is_default else "member",
        "rows": rows,
        "priceBasis": _price_basis(bases),
    }
    if cut:
        out["truncated"] = cut
    if not open_positions and not strategies:
        out["empty"] = "No open positions."     # never while an option strategy is open
    return out


# -- tickerCard ----------------------------------------------------------------------

#: ⛔ Every request regex is used with `fullmatch` (ruling R60): `$` also matches before ONE trailing
#: newline, so `match("AAPL\n")` passed and the value was echoed back and cached under its own key.
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z.\-]{0,9}$")

#: Per-(member, symbol) cache of the ticker card's history figures. The card can be polled
#: and the analytics read is the heavy call on this path.
HISTORY_TTL_S = 300
_HISTORY_CACHE = TTLCache(max_size=500)


#: The most notes the card counts in one name; past it the card says "99+ notes" (the read is a LIMIT).
HISTORY_NOTES_CAP = 99


def _symbol_footprint(user_id: str, sym: str) -> dict:
    """The member's open positions and notes in this EXACT symbol (never a prefix: NVD is not NVDA).

    Fix F4 (O2, walk 2026-10-21): the card's "Your history" counted closed trades only, so a member with an
    open NVDA position and a note on NVDA read "No trades in NVDA yet." The spec's ticker card lists J2 trades
    AND notes; an open position is the member's open trade in that name.

    Own rows only, read-only, bounded: one COUNT on `j2_positions` (open = `closed_at IS NULL`), and one
    LIMITed id read over the notes' own symbol membership -- the note's `ticker` field, or a chart/widget embed
    or `$CASHTAG` mention of the symbol (`notes._symbol_note_ids_sql`, the one answer every symbol-scoped note
    read uses, a non-correlated set). Trash excluded. A read that fails is UNKNOWN (None), never 0."""
    out: dict[str, Any] = {"openPositions": None, "notes": None, "notesMore": False}
    try:
        from api.services import auth_db
        from api.services.journal_two.notes import _symbol_note_ids_sql
        from api.services.journal_two import sample_marker
        conn = auth_db.get_connection()
    except Exception as e:  # noqa: BLE001
        _log.info("ticker card: footprint read unavailable for %s: %s", sym, e)
        return out
    try:
        try:
            row = conn.execute(
                "SELECT COUNT(*) FROM j2_positions WHERE user_id = ? AND symbol = ? AND closed_at IS NULL",
                (user_id, sym)).fetchone()
            out["openPositions"] = int(row[0] or 0) if row else 0
        except Exception as e:  # noqa: BLE001
            _log.info("ticker card: open positions read failed for %s: %s", sym, e)
        try:
            ids_sql, ids_params = _symbol_note_ids_sql(user_id, [sym])
            rows = conn.execute(
                "SELECT n.id FROM j2_notes n WHERE n.user_id = ? AND n.deleted_at IS NULL"
                f" AND {sample_marker.not_sample_sql('n')}"
                f" AND (n.ticker = ? OR n.id IN ({ids_sql})) LIMIT ?",
                (user_id, sym, *ids_params, HISTORY_NOTES_CAP + 1)).fetchall()
            out["notes"] = min(len(rows), HISTORY_NOTES_CAP)
            out["notesMore"] = len(rows) > HISTORY_NOTES_CAP
        except Exception as e:  # noqa: BLE001
            _log.info("ticker card: notes read failed for %s: %s", sym, e)
    finally:
        conn.close()
    return out


def _symbol_history_figures(user_id: str, sym: str) -> dict:
    """Closed-trade figures (analytics, symbol_exact) plus the open positions and notes in the name, cached
    together per (member, symbol). The footprint is late-bound (a module lookup), so a test can stand it in."""
    key = f"{user_id}::{sym}"
    hit = _HISTORY_CACHE.get(key)
    if isinstance(hit, dict):
        return hit
    from api.services.journal_two import analytics
    from api.services.journal_two.filters import FilterSpec
    fig = _pnl_figures(analytics.get_analytics(user_id, spec=FilterSpec(symbol=sym, symbol_exact=True)))
    fig = {**fig, **_symbol_footprint(user_id, sym)}
    _HISTORY_CACHE.set(key, fig, HISTORY_TTL_S)
    return fig


def _simple_average(closes: list[float], n: int) -> float | None:
    return round(sum(closes[-n:]) / n, 4) if len(closes) >= n else None


def _ticker_card(user_id: str, params: dict, now: datetime) -> dict:
    sym = params.get("symbol")
    if not isinstance(sym, str) or not _SYMBOL_RE.fullmatch(sym):
        raise WidgetRequestError("symbol is required and must be an uppercase ticker")

    price = change_pct = None
    try:
        from api.routers import live_prices
        got = live_prices.get_live_prices(tickers=sym)
        quote = got.get(sym) if isinstance(got, dict) else None
        if isinstance(quote, dict):
            price, change_pct = _num(quote.get("price")), _num(quote.get("change_pct"))
    except Exception as e:  # noqa: BLE001
        _log.info("ticker card: live price failed for %s: %s", sym, e)

    ma10 = ma50 = None
    try:  # local bars cache: no network call
        from api.services import bars_sqlite
        closes = [c for c in (_num(b[4]) for b in bars_sqlite.get_bars(sym, "D", 50)) if c is not None]
        ma10, ma50 = _simple_average(closes, 10), _simple_average(closes, 50)
    except Exception as e:  # noqa: BLE001
        _log.info("ticker card: bars read failed for %s: %s", sym, e)

    earnings_day = implied = None
    read = _earnings_window(now)           # bounded and single-flighted (fix F1, C-1)
    earnings_unknown = read is None
    if read is not None:
        try:
            window, timing, window_partial, _as_of = read
            earnings_day = window.get(sym)
            earnings_unknown = bool(window_partial) and not earnings_day
            if earnings_day:
                moves, _late = _implied_moves(
                    [{"symbol": sym, "date": earnings_day, "timing": timing.get(sym)}])
                implied = moves.get(sym)
        except Exception as e:  # noqa: BLE001
            _log.info("ticker card: earnings window failed for %s: %s", sym, e)
            earnings_day, earnings_unknown = None, True

    fig = _symbol_history_figures(user_id, sym)
    # Null only when every count is KNOWN to be zero: an unread count keeps the row, which then says n/a.
    history = {
        "trades": fig["tradeCount"], "winRate": fig["winRate"], "netPnl": fig["netPnl"],
        "openPositions": fig.get("openPositions"), "notes": fig.get("notes"),
        "notesMore": bool(fig.get("notesMore")),
    }
    if not fig["tradeCount"] and history["openPositions"] == 0 and history["notes"] == 0:
        history = None
    out = {
        "asOf": _iso_utc(now),
        "source": "mixed",
        "symbol": sym,
        "price": price,
        "changePct": change_pct,
        "ma10": ma10,
        "ma50": ma50,
        "earningsDay": earnings_day,
        "impliedMovePct": implied,
        "history": history,
        # True: the calendar was not read, so a null earningsDay is unknown. False: no report this week.
        "earningsUnknown": earnings_unknown,
    }
    # ONE rule for `partial` (fix F1b, review M-1), as myWatchlistToday: set whenever earningsUnknown is
    # true, so a calendar day that failed to load reads "partial" on the card as it does on the watchlist.
    if earnings_unknown:
        out["partial"] = True
    return out


# -- myRulesCheck --------------------------------------------------------------------

#: The adherence store keys a journal ("before entry") rule's tick as `rule:<id>` (the one
#: spelling, app/src/pages/journal-2-0/lib/blocks/checklistItems.js RULE_PREFIX); a setup
#: checklist rule is ticked under its own id.
_JOURNAL_RULE_PREFIX = "rule:"

RULES_NONE_SENTENCE = "No rules set yet."
RULES_UNCHECKED_SENTENCE = "No trades checked against your rules in this range."


def _member_rules(user_id: str) -> dict:
    """The member's rules, where the names live: {"setup": {account_id: {setup: [{id, label}]}},
    "journal": [rule dicts, every status]}.

    Late-bound seam: a test patches this module attribute. Read-only: list_accounts and
    get_account_settings(account_id=...) are SELECTs (never get_or_migrate_default_account, which
    writes), and journal rules are listed with status=None so a dismissed rule's name still
    resolves for the ticks already recorded on it.
    """
    from api.services.journal_two import accounts, journal_rules
    setup: dict[str, dict] = {}
    for acc in accounts.list_accounts(user_id) or []:
        acc_id = (acc or {}).get("id")
        block = accounts.get_account_settings(user_id, acc_id) if acc_id else None
        rules = (block or {}).get("setupRules")
        if isinstance(rules, dict) and rules:
            setup[acc_id] = rules
    return {"setup": setup, "journal": list(journal_rules.list_rules(user_id, status=None) or [])}


def _my_rules_check(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import adherence_store, trades
    from api.services.journal_two.filters import FilterSpec
    from api.services.journal_two.trader_blocks import adherence_of_trade
    day_from, day_to = _week_range(params, now)
    got = trades.list_trades_for_user(user_id, spec=FilterSpec(date_from=day_from, date_to=day_to))
    rows = got[0] if isinstance(got, tuple) else got
    rules = _member_rules(user_id) or {}
    setup_rules = rules.get("setup") or {}
    journal = [r for r in (rules.get("journal") or []) if isinstance(r, dict)]

    # Names: setup checklist ids as they are, journal rules under their rule:<id> tick key.
    names: dict[str, str] = {}
    for per_setup in setup_rules.values():
        for items in (per_setup or {}).values():
            for it in items or []:
                if isinstance(it, dict) and it.get("id") and it.get("label"):
                    names[str(it["id"])] = str(it["label"])
    for r in journal:
        if r.get("id") and r.get("label"):
            names[_JOURNAL_RULE_PREFIX + str(r["id"])] = str(r["label"])
    active_journal = [r for r in journal if r.get("status", "active") == "active"]
    has_rules = bool(active_journal) or any(
        items for per_setup in setup_rules.values() for items in (per_setup or {}).values())

    adh = adherence_store.list_adherence_for_user(user_id) or {}
    tally: dict[str, list[int]] = {}      # label -> [kept, total]
    checked_trades = []
    head_kept = head_total = 0
    for t in rows:
        t = t or {}
        rec = adherence_of_trade(adh.get, t.get("tradeRef"), t.get("positionId"))
        if not isinstance(rec, dict):
            continue
        checked_trades.append(t)
        ticked = {str(i) for i in (rec.get("checkedRuleIds") or [])}
        # The headline is the Journal's own record: its ticks and its stored count, summed.
        head_kept += len(ticked)
        head_total += int(rec.get("totalRules") or 0)
        # Per rule. The record keeps ticks and a count, not the unticked ids, so the list is rebuilt
        # from rules that EXISTED when the ticks were stored (journal rules carry createdAt; a rule
        # made later is not counted). Setup checklist rules carry no createdAt, so an unticked one
        # counts only when the rebuilt list's size equals the stored count (the checklist is then
        # proven the one in force); otherwise only ticked rules count, which can never overstate.
        when = str(rec.get("updatedAt") or t.get("exitDate") or t.get("entryDate") or "")[:10]
        candidates: set[str] = set()
        setup_name = rec.get("setup") or t.get("setup")
        for it in (setup_rules.get(t.get("accountId")) or {}).get(setup_name) or []:
            if isinstance(it, dict) and it.get("id") and names.get(str(it["id"])):
                candidates.add(str(it["id"]))
        for r in active_journal:
            made = str(r.get("createdAt") or "")[:10]
            if r.get("beforeEntry") and r.get("accountId") in (None, t.get("accountId"))                     and not (when and made and made > when):
                candidates.add(_JOURNAL_RULE_PREFIX + str(r["id"]))
        proven = len(candidates | ticked) == int(rec.get("totalRules") or 0)
        on_list = (candidates | ticked) if proven else ticked
        for rid in on_list:
            label = names.get(rid)
            if label is None:
                continue                  # a rule since deleted: never printed as a raw id
            cell = tally.setdefault(label, [0, 0])
            cell[1] += 1
            cell[0] += 1 if rid in ticked else 0

    out_rules = [{"rule": k, "kept": v[0], "total": v[1]} for k, v in tally.items()]
    out_rules.sort(key=lambda r: (-r["total"], r["rule"]))
    cut = max(0, len(out_rules) - ROW_CAP)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": _origin([(t or {}).get("source") for t in (checked_trades or rows)]),
        "range": {"from": day_from, "to": day_to},
        "kept": head_kept if checked_trades else None,
        "total": head_total if checked_trades else None,
        "rules": out_rules[:ROW_CAP],
    }
    if cut:
        out["truncated"] = cut
    if not out_rules:
        out["empty"] = RULES_UNCHECKED_SENTENCE if has_rules else RULES_NONE_SENTENCE
    return out


# -- myMistakes ----------------------------------------------------------------------

MISTAKES_WINDOW_DAYS = 30
MISTAKES_EMPTY_SENTENCE = "No mistakes tagged in the last 60 days."

#: Per-(member, day) cache of the two analytics reads this widget makes. Both windows are heavy
#: and an embed can be refreshed; the answer only moves when a trade is tagged.
MISTAKES_TTL_S = 300
_MISTAKES_CACHE = TTLCache(max_size=500)


def _mistake_rows(analytics: dict) -> dict[str, dict]:
    """{mistake: {total, count}} from analytics' own psychology.costOfMistakes.byMistake
    (never re-derived here: the Journal's cost-of-mistakes card reads the same list)."""
    by = (((analytics or {}).get("psychology") or {}).get("costOfMistakes") or {}).get("byMistake") or []
    out: dict[str, dict] = {}
    for m in by:
        if isinstance(m, dict) and m.get("mistake"):
            out[str(m["mistake"])] = {"total": _num(m.get("total")), "count": int(m.get("count") or 0)}
    return out


def _mistake_windows(user_id: str, today: date) -> dict:
    key = f"{user_id}::{today.isoformat()}"
    hit = _MISTAKES_CACHE.get(key)
    if isinstance(hit, dict):
        return hit
    from api.services.journal_two import analytics, trades
    from api.services.journal_two.filters import FilterSpec
    span = MISTAKES_WINDOW_DAYS - 1
    now_from = today - timedelta(days=span)
    prior_to = now_from - timedelta(days=1)
    prior_from = prior_to - timedelta(days=span)
    now_rows = _mistake_rows(analytics.get_analytics(
        user_id, date_from=now_from.isoformat(), date_to=today.isoformat()))
    prior_rows = _mistake_rows(analytics.get_analytics(
        user_id, date_from=prior_from.isoformat(), date_to=prior_to.isoformat()))
    got = trades.list_trades_for_user(
        user_id, spec=FilterSpec(date_from=prior_from.isoformat(), date_to=today.isoformat()))
    rows = got[0] if isinstance(got, tuple) else got
    tagged = [(t or {}).get("source") for t in rows if (t or {}).get("mistakeTags")]
    out = {"now": now_rows, "prior": prior_rows, "source": _origin(tagged)}
    _MISTAKES_CACHE.set(key, out, MISTAKES_TTL_S)
    return out


def _my_mistakes(user_id: str, params: dict, now: datetime) -> dict:
    win = _mistake_windows(user_id, _today_et(now))
    now_rows, prior_rows = win["now"], win["prior"]
    rows = []
    for name in set(now_rows) | set(prior_rows):
        n, p = now_rows.get(name), prior_rows.get(name)
        count_now, count_prior = (n or {}).get("count", 0), (p or {}).get("count", 0)
        rows.append({
            "mistake": name,
            "cost30d": (n or {}).get("total"),
            "countNow": count_now,
            "countPrior": count_prior,
            "trend": "more" if count_now > count_prior else "less" if count_now < count_prior else "same",
        })
    # Biggest bleed first (the most negative total); a mistake with no figure this window last.
    rows.sort(key=lambda r: (r["cost30d"] is None, r["cost30d"] if r["cost30d"] is not None else 0.0, r["mistake"]))
    shown, cut = rows[:ROW_CAP], max(0, len(rows) - ROW_CAP)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": win["source"],
        "rows": shown,
    }
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = MISTAKES_EMPTY_SENTENCE
    return out


# -- marketOnMyNames (wave 3) --------------------------------------------------------

#: Daily bars a 5-day return needs: today's close and the close five sessions before it.
RET5D_BARS = 6
NAMES_EMPTY_SENTENCE = "No names in your positions, watchlist or flagged list."
#: How a row's sector figure was made. The theme taxonomy names a sector but carries no sector
#: return, so the figure is the mean 5-day return of the member's own names in that sector.
SECTOR_BASIS = "your names"


def _ret5d(sym: str) -> float | None:
    """The 5-day return in percent from the LOCAL daily bars cache (no network), or None when
    there are fewer than six bars or the read fails."""
    try:
        from api.services import bars_sqlite
        closes = [_num(b[4]) for b in bars_sqlite.get_bars(sym, "D", RET5D_BARS)]
    except Exception as e:  # noqa: BLE001 -- one name's bars are a null cell, not a dead widget
        _log.info("market on my names: bars read failed for %s: %s", sym, e)
        return None
    if len(closes) < RET5D_BARS or closes[-1] is None or not closes[-RET5D_BARS]:
        return None
    return round((closes[-1] / closes[-RET5D_BARS] - 1.0) * 100.0, 2)


def _sector_of(sym: str) -> str | None:
    """The sector of the name's primary theme in the theme taxonomy (owner memberships first, the
    resolver the chart watermark uses), or None. A cached DB read; never an RS compute."""
    try:
        from api.services import groups
        row = groups.resolve_primary_theme(sym)
    except Exception as e:  # noqa: BLE001
        _log.info("market on my names: theme read failed for %s: %s", sym, e)
        return None
    name = (row or {}).get("sector_name")
    return str(name) if name else None


def _market_on_my_names(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import earnings_prep
    names = sorted((earnings_prep._member_sets(user_id) or {}).keys())
    shown, cut = names[:ROW_CAP], max(0, len(names) - ROW_CAP)
    rows = [{"symbol": sym, "ret5d": _ret5d(sym), "sector": _sector_of(sym)} for sym in shown]

    # The sector figure is the mean of the member's names in that sector that HAVE a return. One
    # name alone is compared with nothing, so it gets no sector figure (null, never a 0 vs itself).
    by_sector: dict[str, list[float]] = {}
    for r in rows:
        if r["sector"] and r["ret5d"] is not None:
            by_sector.setdefault(r["sector"], []).append(r["ret5d"])
    for r in rows:
        vals = by_sector.get(r["sector"] or "") or []
        r["sectorRet5d"] = round(sum(vals) / len(vals), 2) if len(vals) >= 2 else None
        r["vsSector"] = (round(r["ret5d"] - r["sectorRet5d"], 2)
                         if r["ret5d"] is not None and r["sectorRet5d"] is not None else None)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "sectorBasis": SECTOR_BASIS,
        "rows": rows,
    }
    if cut:
        out["truncated"] = cut
    if not names:
        out["empty"] = NAMES_EMPTY_SENTENCE
    return out


# -- tickerFlow (wave 3) -------------------------------------------------------------

#: The one fetch of the page-derived flow product (flow-worker, through the proxy). A hard
#: wall-clock budget: the call runs on a pool future and is abandoned when the budget runs out.
TICKER_FLOW_TIMEOUT_S = 8.0
TOP_PRINTS_MAX = 10
_PRINT_KEYS = ("cp", "strike", "exp", "dte", "premium", "volume", "direction")


def _window_label(rung: Any) -> str | None:
    """The served rung as words: '1' -> 'Today', '5' -> 'Last 5 sessions', 'all' -> 'All sessions on record'."""
    r = str(rung or "").strip().lower()
    if r == "all":
        return "All sessions on record"
    try:
        n = int(float(r))
    except ValueError:
        return None
    return "Today" if n == 1 else f"Last {n} sessions"


def _flow_read(sym: str) -> dict | None:
    from api.services import flow_card_from_page
    from api.services.discord_render import symbols
    return flow_card_from_page.page_derived_payload(
        sym, "1", symbols.flow_source(sym), timeout_s=TICKER_FLOW_TIMEOUT_S,
        top_n=TOP_PRINTS_MAX, enrich=False)


#: UX audit I-5 (ruling R58): a read that did not happen is never "no flow".
FLOW_FAILED_SENTENCE = "Couldn't load options flow right now."


def _flow_bounded(sym: str) -> dict | None:
    """`_flow_read` under ONE wall-clock budget, the `_implied_moves` shape: a straggler past the
    budget is abandoned (never waited for) and the answer is None. A saturated pool answers None at once
    (final review I-4). None is a FAILED read (timeout, saturation, an error, or a product the reader
    could not derive); only a dict, even an empty one, is an answer."""
    ok, data = _one_bounded(lambda: _flow_read(sym), TICKER_FLOW_TIMEOUT_S)
    return data if ok and isinstance(data, dict) else None


def _ticker_flow(user_id: str, params: dict, now: datetime) -> dict:
    sym = params.get("symbol")
    if not isinstance(sym, str) or not _SYMBOL_RE.fullmatch(sym):
        raise WidgetRequestError("symbol is required and must be an uppercase ticker")
    data = _flow_bounded(sym)
    failed = data is None
    data = data if isinstance(data, dict) else {}
    contracts = list(data.get("contracts") or [])
    net = data.get("net") if isinstance(data.get("net"), dict) else {}
    # The reader climbs 1 -> 5 -> 20 -> all sessions when today is empty; the payload names the rung
    # it actually served (`days_requested` on a served rung), and the widget says that window.
    window = _window_label((data.get("window") or {}).get("days_requested")) if contracts else None
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": "market",
        "symbol": sym,
        # The page's own net figures, as it computed them; never re-summed here.
        "bullPremium": _num(net.get("bull")) if contracts else None,
        "bearPremium": _num(net.get("bear")) if contracts else None,
        "window": window,
        "topPrints": [{k: c.get(k) for k in _PRINT_KEYS} for c in contracts[:TOP_PRINTS_MAX]],
    }
    if failed:
        out["failed"] = True                           # timeout, saturated pool or read failure
        out["empty"] = FLOW_FAILED_SENTENCE
    elif not contracts:
        out["empty"] = f"No options flow on record for {sym} today."   # a read that found nothing
    return out


# -- wave 6: shared helpers ----------------------------------------------------------

_ET = ZoneInfo("America/New_York")


def _ymd(day: str) -> int:
    return int(str(day)[:10].replace("-", ""))


def _ymd_iso(ymd: Any) -> str:
    s = str(int(ymd))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def _et_day_of(raw: Any) -> str | None:
    """The trading day of a stored trade date, by the Journal's ONE rule (`timeutil.compute_trading_day_et`):
    a bare day as it is, a DATE-ONLY entry (stored at exact UTC midnight) as the day the member typed, and
    a real timestamp converted to its ET day.

    Fix F4 (D3, walk 2026-10-21): this converted every timestamp, so a manual trade entered 2026-10-13 and
    exited 2026-10-15 -- stored as `...T00:00:00Z`, which is 8 pm ET the evening BEFORE -- recapped as
    Oct 12 / Oct 14. A date-only value is a calendar date and is never shifted."""
    if not raw:
        return None
    from api.services.journal_two.timeutil import compute_trading_day_et
    return compute_trading_day_et(str(raw).strip())


def _even_stride(items: list, cap: int) -> list:
    """At most `cap` items by an even stride, first and last always kept (`_equity_points`' rule)."""
    n = len(items)
    if n <= cap:
        return items
    step = (n - 1) / (cap - 1)
    return [items[round(i * step)] for i in range(cap)]


# -- tradeRecap (wave 6) -------------------------------------------------------------

#: A j2_trades id: uuid4 for every writer (`trades.create_trade_manual`, `bulk_insert_trades`). The
#: shape check is permissive on purpose (word characters and hyphens); its job is to keep junk off the read.
_TRADE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$")
#: ONE sentence for a trade that does not exist, is not the member's, or is malformed, so an id cannot
#: be probed for whether it belongs to somebody else.
TRADE_NOT_FOUND = "Trade not found"
RECAP_BARS_MAX = 120
RECAP_PAD_SESSIONS = 20
#: Daily bars read for one recap, ending ~2 months after the exit (covers the 20-session pad).
_RECAP_BARS_READ = 600
_RECAP_TAIL_DAYS = 45


def _recap_bars(sym: str, entry_day: str | None, exit_day: str | None) -> list[dict]:
    """Daily bars from the LOCAL bars cache (no network): entry-20 to exit+20 sessions, at most
    `RECAP_BARS_MAX` (a longer hold is thinned by an even stride, entry and exit kept)."""
    if not (sym and entry_day and exit_day):
        return []
    try:
        from api.services import bars_sqlite
        to_key = int((date.fromisoformat(exit_day) + timedelta(days=_RECAP_TAIL_DAYS)).strftime("%Y%m%d"))
        bars = list(bars_sqlite.get_bars_before(sym, "D", _RECAP_BARS_READ, to_key) or [])
    except Exception as e:  # noqa: BLE001 -- no bars is an empty chart, never a failed widget
        _log.info("trade recap: bars read failed for %s: %s", sym, e)
        return []
    ent, ex = _ymd(entry_day), _ymd(exit_day)
    first = next((i for i, b in enumerate(bars) if int(b[0]) >= ent), None)
    last = next((i for i in range(len(bars) - 1, -1, -1) if int(bars[i][0]) <= ex), None)
    if first is None or last is None or last < first:
        return []
    window = bars[max(0, first - RECAP_PAD_SESSIONS):last + RECAP_PAD_SESSIONS + 1]
    return [{"t": _ymd_iso(b[0]), "o": _num(b[1]), "h": _num(b[2]), "l": _num(b[3]), "c": _num(b[4])}
            for b in _even_stride(window, RECAP_BARS_MAX)]


def _trade_recap(user_id: str, params: dict, now: datetime) -> dict:
    trade_id = params.get("tradeId")
    if not isinstance(trade_id, str) or not trade_id:
        raise WidgetRequestError("tradeId is required")
    if not _TRADE_ID_RE.fullmatch(trade_id):
        raise WidgetRequestError(TRADE_NOT_FOUND)
    from api.services.journal_two import trades
    detail = trades.get_trade_detail(user_id, trade_id)      # OWN-SCOPED: user_id AND id, read-only
    trade = (detail or {}).get("trade") if isinstance(detail, dict) else None
    if not isinstance(trade, dict):
        raise WidgetRequestError(TRADE_NOT_FOUND)
    # R is the trade's OWN stored R, by analytics' `_effective_r_map` rule: the stop-based r_multiple
    # when the trade carries one, else the stored excursion's true R. Never recomputed here.
    r = _num(trade.get("rMultiple"))
    if r is None:
        r = _num(((detail or {}).get("excursion") or {}).get("trueR"))
    sym = str(trade.get("symbol") or "").upper()
    entry_day, exit_day = _et_day_of(trade.get("entryDate")), _et_day_of(trade.get("exitDate"))
    hold = trade.get("holdDays")
    return {
        "asOf": _iso_utc(now),
        "source": _origin([trade.get("source")]),
        "symbol": sym,
        "side": trade.get("side"),
        "entryDate": entry_day,
        "exitDate": exit_day,
        "entryPrice": _num(trade.get("entryPrice")),
        "exitPrice": _num(trade.get("exitPrice")),
        "r": r,
        "pnl": _num(trade.get("pnlDollarNet")),
        "setup": trade.get("setup") or None,
        "holdDays": int(hold) if isinstance(hold, (int, float)) and not isinstance(hold, bool) else None,
        "mistakes": [str(m) for m in (trade.get("mistakeTags") or []) if m],
        "bars": _recap_bars(sym, entry_day, exit_day),
    }


# -- myPnlCalendar (wave 6) ----------------------------------------------------------

PNL_CALENDAR_EMPTY_SENTENCE = "No closed trades this month yet."
_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
#: Per-(member, month) cache of the calendar's analytics read: the heavy call, and the answer only
#: moves when a trade closes.
PNL_CALENDAR_TTL_S = 300
_PNL_CALENDAR_CACHE = TTLCache(max_size=500)


def _month_window(params: dict, now: datetime) -> tuple[str, str, str]:
    raw = params.get("month")
    if raw is None:
        today = _today_et(now)
        raw = f"{today.year:04d}-{today.month:02d}"
    m = _MONTH_RE.fullmatch(raw) if isinstance(raw, str) else None
    if not m:
        raise WidgetRequestError("month must be YYYY-MM")
    first = date(int(m.group(1)), int(m.group(2)), 1)
    latest = _latest_day(_today_et(now))
    if not EARLIEST_DAY <= first <= latest:                # R60: 9999-12 overflowed `date(10000, 1, 1)`
        raise WidgetRequestError(
            f"month must be between {EARLIEST_DAY.isoformat()[:7]} and {latest.isoformat()[:7]}")
    nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return raw, first.isoformat(), (nxt - timedelta(days=1)).isoformat()


def _pnl_calendar_read(user_id: str, month: str, day_from: str, day_to: str) -> dict:
    key = f"{user_id}::{month}"
    hit = _PNL_CALENDAR_CACHE.get(key)
    if isinstance(hit, dict):
        return hit
    from api.services.journal_two import analytics, trades
    from api.services.journal_two.filters import FilterSpec
    payload = analytics.get_analytics(user_id, date_from=day_from, date_to=day_to)
    got = trades.list_trades_for_user(user_id, spec=FilterSpec(date_from=day_from, date_to=day_to))
    rows = got[0] if isinstance(got, tuple) else got
    out = {"analytics": payload, "source": _origin([(t or {}).get("source") for t in rows])}
    _PNL_CALENDAR_CACHE.set(key, out, PNL_CALENDAR_TTL_S)
    return out


def _my_pnl_calendar(user_id: str, params: dict, now: datetime) -> dict:
    month, day_from, day_to = _month_window(params, now)
    read = _pnl_calendar_read(user_id, month, day_from, day_to)
    a = read["analytics"] if isinstance(read.get("analytics"), dict) else {}
    # Days, best and worst are analytics' own performance.byDay (the per-day NET P&L the equity curve
    # is built from), never re-derived.
    days = [{"day": str(d["date"]), "pnl": _num(d.get("pnl"))}
            for d in ((a.get("performance") or {}).get("byDay")) or []
            if isinstance(d, dict) and d.get("date")]
    priced = [d for d in days if d["pnl"] is not None]
    best = max(priced, key=lambda d: d["pnl"]) if priced else None
    worst = min(priced, key=lambda d: d["pnl"]) if priced else None
    out: dict[str, Any] = {
        "asOf": _iso_utc(now),
        "source": read.get("source") or "manual",
        "month": month,
        "days": days,
        "best": {"day": best["day"], "pnl": best["pnl"]} if best else None,
        "worst": {"day": worst["day"], "pnl": worst["pnl"]} if worst else None,
    }
    if not int(a.get("tradeCount") or 0) or not days:
        out.update(days=[], best=None, worst=None)
        out["empty"] = PNL_CALENDAR_EMPTY_SENTENCE
    return out


# -- mySetupEdge (wave 6) ------------------------------------------------------------

SETUP_EDGE_EMPTY_SENTENCE = "No setups with closed trades yet."
#: The most recent closed trades one edge read covers (a bound on a member with a long journal).
SETUP_EDGE_TRADES_MAX = 5000
#: Per-member cache of the edge read: the answer only moves when a trade closes.
SETUP_EDGE_TTL_S = 300
_SETUP_EDGE_CACHE = TTLCache(max_size=500)


def _scoped_closed_trades(user_id: str) -> list[dict]:
    """The member's most recent `SETUP_EDGE_TRADES_MAX` closed trades in the UNIFIED Compass scope
    (the Compass-enabled accounts), oldest first: `personal_edge.closed_trades`, the same bounded
    read-only reader the edge's default seam uses, so the widget and Compass see one history."""
    from api.services import personal_edge
    from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID
    return personal_edge.closed_trades(user_id, UNIFIED_ACCOUNT_ID, limit=SETUP_EDGE_TRADES_MAX)


def _setup_edge_read(user_id: str) -> dict:
    """{"edge": personal_edge's answer, "sources": [trade source, ...]} from ONE set of trades, so
    the figures and the `source` label describe the same accounts. Cached per member."""
    hit = _SETUP_EDGE_CACHE.get(user_id)
    if isinstance(hit, dict):
        return hit
    from api.services import personal_edge
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID
    trades = _scoped_closed_trades(user_id)
    edge = personal_edge.edge_for_setups(
        user_id, UNIFIED_ACCOUNT_ID,
        setup_perf_fn=lambda _u, _a: cct._breakdown_trades(trades, "setup")) or {}
    out = {"edge": edge, "sources": [t.get("source") for t in trades]}
    _SETUP_EDGE_CACHE.set(user_id, out, SETUP_EDGE_TTL_S)
    return out


def _my_setup_edge(user_id: str, params: dict, now: datetime) -> dict:
    from api.services import personal_edge
    read = _setup_edge_read(user_id)
    thin_below = personal_edge._MUTE_MIN_N
    rows = []
    for setup, e in (read.get("edge") or {}).items():
        e = e if isinstance(e, dict) else {}
        n = e.get("n")
        n = int(n) if isinstance(n, (int, float)) and not isinstance(n, bool) else 0
        rows.append({
            "setup": str(setup),
            "n": n,
            "expectancyR": _num(e.get("avg_r")),
            "winRate": _num(e.get("win_rate")),
            "thin": n < thin_below,
        })
    rows.sort(key=lambda r: (-r["n"], r["setup"]))
    shown, cut = rows[:ROW_CAP], max(0, len(rows) - ROW_CAP)
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": _origin(read.get("sources") or []), "rows": shown}
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = SETUP_EDGE_EMPTY_SENTENCE
    return out


# -- myScreenToday (wave 6) ----------------------------------------------------------

SCREEN_NOT_FOUND = "Screen not found"
SCREEN_NOT_READY = "This screen's results are not ready yet."
SCREEN_NOT_SCANNABLE = "This saved definition is not a screen."


def _own_definition(user_id: str, def_id: str) -> dict | None:
    """The member's OWN saved definition (`user_definitions.get` scopes by user_id), or None."""
    from api.services import user_definitions
    try:
        row = user_definitions.get(user_id, def_id)
    except ValueError:                 # not a user-namespace id: the same answer as not found
        return None
    return row if isinstance(row, dict) else None


def _screen_name(row: dict) -> str:
    """ScreensManager's `scanName`: the member's name for it, else its id, so a widget is never blank."""
    meta = ((row.get("definition") or {}).get("meta") or {}) if isinstance(row.get("definition"), dict) else {}
    name = meta.get("name").strip() if isinstance(meta.get("name"), str) else ""
    return name or str(row.get("def_id") or "") or "Untitled screen"


def _toolkit_user(user_id: str) -> dict:
    """The user dict `entitlements.limits_for` reads, built the way the request's is: `id`, plus
    `toolkit` ONLY when `users.toolkit` is set (`auth_service.validate_session` projects it that way).
    A missing column (an older database) or a failed read is "no toolkit assigned", the default."""
    user: dict[str, Any] = {"id": user_id}
    try:
        from api.services import auth_db
        conn = auth_db.get_connection()
        try:
            row = conn.execute("SELECT toolkit FROM users WHERE id = ?", (user_id,)).fetchone()
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 -- an unreadable column falls back like an unset one
        _log.info("screen today: toolkit read failed: %s", e)
        return user
    if row is not None and row[0] is not None:
        user["toolkit"] = row[0]
    return user


def _receipt_closes(r: dict) -> bool:
    """`scan_evaluator._assert_coverage_closes`' first identity, as a check (the route may not import
    the evaluator): every count a non-negative int and evaluated == answered + dropped + not_computable."""
    vals = [r.get(k) for k in ("evaluated", "answered", "dropped", "not_computable")]
    if not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in vals):
        return False
    return vals[0] == vals[1] + vals[2] + vals[3]


def _my_screen_today(user_id: str, params: dict, now: datetime) -> dict:
    def_id = params.get("definitionId")
    if not isinstance(def_id, str) or not def_id:
        raise WidgetRequestError("definitionId is required")
    from api.services import user_definitions
    # fullmatch (R60): `DEF_ID_RE.match` accepts a trailing newline; the same one sentence as not found.
    if not user_definitions.DEF_ID_RE.fullmatch(def_id):
        raise WidgetRequestError(SCREEN_NOT_FOUND)
    row = _own_definition(user_id, def_id)
    if row is None:
        raise WidgetRequestError(SCREEN_NOT_FOUND)
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": "market", "name": _screen_name(row),
                           "hits": [], "coverage": None}
    from api.services import entitlements, scan_definition
    from api.services.screener import scan_store
    try:
        def_hash = scan_definition.def_hash(row.get("definition"))
    except (scan_definition.ScanRefused, ValueError, TypeError):
        out["empty"] = SCREEN_NOT_SCANNABLE
        return out
    tf = scan_store.SCAN_JOIN_TF
    # The latest SWEPT session (a coverage row, never a hits row: a zero-hit night writes no hits).
    as_of = scan_store.latest_covered_as_of(def_hash, tf)
    receipt = scan_store.coverage(def_hash, tf, as_of) if as_of is not None else None
    if not isinstance(receipt, dict) or not _receipt_closes(receipt):
        out["empty"] = SCREEN_NOT_READY           # nobody looked, or the arithmetic does not close
        return out
    # The hit list exactly as `/api/scans/definition-results` reads it (its own join over screener_rows).
    from api.routers import scan_results
    tickers, cut = scan_results._hit_tickers(def_hash, tf, as_of, ROW_CAP)
    kept, withheld = entitlements.apply_symbol_cap(list(tickers), entitlements.limits_for(_toolkit_user(user_id)))
    prices: dict = {}
    if kept:
        try:
            from api.routers import live_prices
            got = live_prices.get_live_prices(tickers=",".join(kept))
            prices = got if isinstance(got, dict) else {}
        except Exception as e:  # noqa: BLE001
            _log.info("screen today: live prices failed: %s", e)
    for sym in kept:
        q = prices.get(sym) if isinstance(prices.get(sym), dict) else {}
        out["hits"].append({"symbol": sym, "price": _num(q.get("price")), "changePct": _num(q.get("change_pct"))})
    # The four counts straight from the receipt, never collapsed; `withheld` BESIDE them, accumulated
    # the way the route does it (the receipt's own, plus what this member's plan withheld here).
    out["coverage"] = {
        "evaluated": receipt["evaluated"],
        "answered": receipt["answered"],
        "dropped": receipt["dropped"],
        "notComputable": receipt["not_computable"],
        "withheld": int(receipt.get("withheld") or 0) + len(withheld),
    }
    out["session"] = _ymd_iso(as_of)
    if cut:
        # The route's own word (`scan_results.py` `truncated`): the page is short of the hits. A
        # boolean, because `_hit_tickers` knows THAT it cut, not how many; `answered` counts every
        # symbol that ran (hits and non-hits), so it cannot stand in for a count.
        out["truncated"] = True
    return out


# -- roomBuzzOnMyNames (wave 6) ------------------------------------------------------

BUZZ_EMPTY_SENTENCE = "The room hasn't mentioned your names today."
BUZZ_NOT_SET_UP = "Room buzz isn't set up yet."
#: Enough board rows that a member's names are not cut off by the room's busier ones.
BUZZ_BOARD_LIMIT = 10_000


def _buzz_channels() -> list[str] | None:
    """The configured channels, or None when `BUZZ_CHANNELS` is unset (read now, never at import).
    `buzz_ingest.channels()` falls back to a default channel; a widget says "not set up" instead."""
    import os
    if not os.environ.get("BUZZ_CHANNELS", "").strip():
        return None
    from api.services import buzz_ingest
    return buzz_ingest.channels() or None


def _buzz_window(now: datetime) -> tuple[int, int]:
    """Today's ET session open (09:30) to now; before the open, or on a weekend, the previous
    weekday's whole session (open to close). The open and close are buzz_boards' own constants."""
    from api.services import buzz_boards
    d = (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).astimezone(_ET)
    now_ts = int(d.timestamp())
    open_today = d.replace(hour=buzz_boards.OPEN_H, minute=buzz_boards.OPEN_M, second=0, microsecond=0)
    if d.weekday() < 5 and d >= open_today:
        return int(open_today.timestamp()), now_ts
    prev = d - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    start = prev.replace(hour=buzz_boards.OPEN_H, minute=buzz_boards.OPEN_M, second=0, microsecond=0)
    end = prev.replace(hour=buzz_boards.CLOSE_H, minute=buzz_boards.CLOSE_M, second=0, microsecond=0)
    return int(start.timestamp()), int(end.timestamp())


def _room_buzz_on_my_names(user_id: str, params: dict, now: datetime) -> dict:
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": "market", "rows": []}
    chans = _buzz_channels()
    if not chans:
        out["empty"] = BUZZ_NOT_SET_UP
        return out
    from api.services import buzz_store
    from api.services.journal_two import earnings_prep
    mine = set((earnings_prep._member_sets(user_id) or {}).keys())
    start, end = _buzz_window(now)
    board = buzz_store.board(start, end, chans, limit=BUZZ_BOARD_LIMIT) if mine else []
    # ⛔ COUNTS ONLY. The store holds no message text; the row is rebuilt from three named keys so
    # nothing else a board row ever grows can reach a widget.
    rows = [{"symbol": str(r.get("ticker") or "").upper(), "mentions": int(r.get("mentions") or 0),
             "people": int(r.get("people") or 0)}
            for r in board or [] if isinstance(r, dict) and str(r.get("ticker") or "").upper() in mine]
    out["rows"], cut = rows[:ROW_CAP], max(0, len(rows) - ROW_CAP)
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = BUZZ_EMPTY_SENTENCE
    return out


# -- myEarningsReactions (wave 6) ----------------------------------------------------

REACTIONS_WINDOW_DAYS = 7
REACTIONS_EMPTY_SENTENCE = "None of your names reported in the last 7 days."
#: Fix F1 (audit I-3): with no before-the-open / after-the-close answer, the reacting session is not
#: known, so the reaction is not shown (a BMO reporter read off the next session showed 0.91% for 10.0%).
TIMING_UNKNOWN_SENTENCE = "Report time unknown, so the reaction isn't shown."
#: ONE total wall-clock budget for the request's earnings reads, and the pool size (the
#: `_implied_moves` pattern): a cold `get_year_earnings` walks up to four providers.
REACTIONS_BUDGET_S = 6.0
REACTIONS_WORKERS = 4
#: The calendar walk is per DAY (cache, then Finnhub, then FMP); bounded and held an hour.
REACTIONS_WINDOW_BUDGET_S = 8.0
_REACTION_BARS = 15
#: A reaction session more than this many calendar days after the report is a hole in the bars,
#: not "the next session".
_REACTION_MAX_GAP_DAYS = 5


def _reported_window(today: date) -> tuple[dict[str, str], bool]:
    """({SYM: report day}, partial) for today-7 .. today, through the same day walk the earnings
    window (`earnings_prep._window`) uses, `calendar_alerts.collect_earnings_window`. Bounded by
    `REACTIONS_WINDOW_BUDGET_S` and held in the shared cache (an hour; five minutes when partial)."""
    from api.services.cache import cache
    ck = f"notebook_widgets_reported_window::{today.isoformat()}::{REACTIONS_WINDOW_DAYS}"
    hit = cache.get(ck)
    if isinstance(hit, dict):
        return dict(hit["window"]), bool(hit["partial"])

    def read():
        # Fix F1 (I-1): the job stores its OWN answer, so a walk past the request's budget still warms
        # the cache and the next request is fast (it used to be cached only on the request path).
        from api.services.calendar_alerts import collect_earnings_window
        window, partial = collect_earnings_window(today - timedelta(days=REACTIONS_WINDOW_DAYS),
                                                  REACTIONS_WINDOW_DAYS)
        hit = {"window": {str(s).upper(): str(d)[:10] for s, d in (window or {}).items()},
               "partial": bool(partial)}
        cache.set(ck, hit, ttl=300 if partial else 3600)
        return hit

    # ONE shared walk however many members miss at once; saturated: partial at once (final review I-4).
    ok, got = _WALKS.run(ck, read, REACTIONS_WINDOW_BUDGET_S)
    if not ok or not isinstance(got, dict):
        return {}, True
    return dict(got["window"]), bool(got["partial"])


_NO_FIGURES = {"epsActual": None, "epsEst": None, "revActual": None, "revEst": None}


def _quarter_figures(sym: str, day: str) -> dict:
    """EPS and revenue, actual and estimate, for the quarter reported on `day`: the row whose report
    date IS `day`, else the fiscal quarter that date maps to (`_fiscal_q_from_report`, the module's own)."""
    from api.services import earnings_estimates as ee
    try:
        fq, fy = ee._fiscal_q_from_report(day)
        rows = ee.get_year_earnings(sym, fy) or []
    except Exception as e:  # noqa: BLE001 -- one name's miss is null cells, not a dead widget
        _log.info("earnings reactions: earnings read failed for %s: %s", sym, e)
        return dict(_NO_FIGURES)
    rows = [r for r in rows if isinstance(r, dict)]
    row = next((r for r in rows if str(r.get("date") or "")[:10] == day), None)
    if row is None:
        row = next((r for r in rows if r.get("quarter") == fq and r.get("date")), None)
    if row is None:
        return dict(_NO_FIGURES)
    return {"epsActual": _num(row.get("eps_actual")), "epsEst": _num(row.get("eps_estimate")),
            "revActual": _num(row.get("revenue_actual")), "revEst": _num(row.get("revenue_estimate"))}


def _reaction_figures(items: list[tuple[str, str]]) -> tuple[dict[str, dict], bool]:
    """{SYM: figures} under ONE total budget in a small pool (`_implied_moves`' shape). A name not
    finished when the budget runs out gets null figures and the second value is True."""
    if not items:
        return {}, False
    jobs = {sym: (sym, day) for sym, day in items}
    got = _fan_out(_quarter_figures, jobs, per_request=REACTIONS_WORKERS, budget_s=REACTIONS_BUDGET_S)
    return ({sym: got[sym] if isinstance(got.get(sym), dict) else dict(_NO_FIGURES) for sym in jobs},
            any(sym not in got for sym in jobs))


def _next_day_pct(sym: str, day: str, timing: str | None, now: datetime) -> float | None:
    """The reaction from LOCAL daily bars: the close of the first session to trade on the report
    (the report day itself before the bell, else the session after it) against the close before it.
    None when that session has not closed yet, or the bars do not hold it, and None when `timing` is not
    'bmo' or 'amc': an unknown report time is never assumed to be after the close (fix F1, I-3)."""
    if timing not in ("bmo", "amc"):
        return None
    try:
        from api.services import bars_sqlite
        bars = [(int(b[0]), _num(b[4])) for b in bars_sqlite.get_bars(sym, "D", _REACTION_BARS) or []]
    except Exception as e:  # noqa: BLE001
        _log.info("earnings reactions: bars read failed for %s: %s", sym, e)
        return None
    rep = _ymd(day)
    after = [b for b in bars if (b[0] >= rep if timing == "bmo" else b[0] > rep)]
    if not after:
        return None
    react_ymd, react_close = after[0]
    react_day = date.fromisoformat(_ymd_iso(react_ymd))
    if (react_day - date.fromisoformat(day)).days > _REACTION_MAX_GAP_DAYS:
        return None
    d_et = (now if now.tzinfo else now.replace(tzinfo=timezone.utc)).astimezone(_ET)
    from api.services import buzz_boards
    closed_at = d_et.replace(hour=buzz_boards.CLOSE_H, minute=buzz_boards.CLOSE_M, second=0, microsecond=0)
    if react_day > d_et.date() or (react_day == d_et.date() and d_et < closed_at):
        return None                                   # that session is still trading (or to come)
    before = [b for b in bars if b[0] < react_ymd]
    base = before[-1][1] if before else None
    if not base or react_close is None:
        return None
    return round((react_close / base - 1.0) * 100.0, 2)


def _my_earnings_reactions(user_id: str, params: dict, now: datetime) -> dict:
    from api.services.journal_two import earnings_prep
    today = _today_et(now)
    mine = earnings_prep._member_sets(user_id) or {}
    window, partial = _reported_window(today)
    items = [(sym, window[sym]) for sym in mine if window.get(sym) and window[sym] <= today.isoformat()]
    items.sort(key=lambda it: it[0])                       # newest report first, then by symbol
    items.sort(key=lambda it: it[1], reverse=True)
    shown, cut = items[:ROW_CAP], max(0, len(items) - ROW_CAP)
    figures, late = _reaction_figures(shown)
    rows = []
    for sym, day in shown:
        timing = earnings_prep._timing_from_calendar_cache(sym, day)
        row = {"symbol": sym, "day": day, **(figures.get(sym) or dict(_NO_FIGURES)),
               "nextDayPct": _next_day_pct(sym, day, timing, now)}
        if timing not in ("bmo", "amc"):
            row["timingUnknown"] = True
            row["nextDayNote"] = TIMING_UNKNOWN_SENTENCE
        rows.append(row)
    out: dict[str, Any] = {"asOf": _iso_utc(now), "source": "market", "rows": rows,
                           "partial": bool(partial) or late}
    if cut:
        out["truncated"] = cut
    if not rows:
        out["empty"] = REACTIONS_EMPTY_SENTENCE
    return out


# -- sourceDetail (UX audit I-6 / I-7, ruling R58) ---------------------------------------------

#: Where a member's own rows came from, by the payload's `source` (`_origin`'s verdict over what was read).
_FILLS = {"broker": "Fills: your linked broker.", "manual": "Fills: your manual entries.",
          "mixed": "Fills: your linked broker and your manual entries."}
_POSITIONS = {"broker": "Positions: your linked broker.", "manual": "Positions: your manual entries.",
              "mixed": "Positions: your linked broker and your manual entries."}
#: How open P&L and size were priced, by `priceBasis` (`_position_price`'s per-row choice).
_MARKS = {"live": "Open P&L and size: live market data, delayed.",
          "broker": "Open P&L and size: your broker's marks.",
          "mixed": "Open P&L and size: live market data and your broker's marks."}
_LIVE_PRICES = "Prices: live market data, delayed."
_CALENDAR = "Earnings dates: UCT calendar."
_IMPLIED = "Expected move: options market."
#: Kind -> its fixed market sentence. The account kinds are composed from what was read (below).
_MARKET_DETAIL = {
    "myWatchlistToday": f"{_LIVE_PRICES} {_CALENDAR}",
    "myNamesReporting": f"{_CALENDAR} {_IMPLIED}",
    "tickerCard": (f"Price: live market data, delayed. Averages: daily bars. {_CALENDAR} {_IMPLIED} "
                   "History: your trades in the Journal."),
    "marketOnMyNames": "Returns: daily bars. Sectors: UCT theme map.",
    "tickerFlow": "Options flow: UCT options tape.",
    "myScreenToday": f"Hits: your saved screen's last nightly run. {_LIVE_PRICES}",
    "roomBuzzOnMyNames": "Mentions: the UCT Discord room.",
    "myEarningsReactions": "Report dates: UCT calendar. Results vs estimates: company reports. Move: daily bars.",
}
#: A built widget's sentence, by the data it looks at (`sourceKey`). Fixed: the builder reads the Journal only.
_BUILT_DETAIL = {
    "closed_trades": "Your closed trades in the Journal.",
    "open_positions": "Your open positions in the Journal.",
    "trading_days": "Your trading days in the Journal (day P&L incl. options).",
}
_JOURNAL_DETAIL = {
    "myPnlStats": "Your trades in the Journal.",
    "myPnlCalendar": "Your trades in the Journal.",
    "myRulesCheck": "Your trades and rule checks in the Journal.",
    "myMistakes": "Your tagged trades in the Journal.",
    "mySetupEdge": "Your closed trades in the Journal.",
    "tradeRecap": "Your trade in the Journal.",
}


def source_detail(kind: str, payload: dict) -> str | None:
    """One short plain sentence naming where this payload's data came from (ruling R58, UX I-6 / I-7),
    derived from what the builder actually read: the broker vs manual verdict in `source`, and for open
    positions the `priceBasis` the rows were priced at. None (no sentence) for an EMPTY positions widget:
    with nothing open, `source` is only `_origin([])`'s fallback, and naming a source for a list that holds
    nothing is a claim about nothing (fix F1b, review M-9)."""
    src = payload.get("source")
    if kind == BUILT_KIND:
        return _BUILT_DETAIL.get(payload.get("sourceKey"))
    if kind == "myPositionsRisk" and payload.get("empty"):
        return None
    if kind == "myPositionsRisk":
        parts = [_POSITIONS.get(src, "Positions: your Journal."), _MARKS.get(payload.get("priceBasis"), "")]
        return " ".join(p for p in parts if p)
    if kind in _JOURNAL_DETAIL:
        parts = [_JOURNAL_DETAIL[kind], _FILLS.get(src, "")]
        if kind == "tradeRecap":
            parts.append("Chart: daily bars.")
        return " ".join(p for p in parts if p)
    return _MARKET_DETAIL.get(kind, "")


# -- dispatch ------------------------------------------------------------------

#: Kind -> builder(user_id, params, now). Later tasks add their kinds here.
_BUILDERS: dict[str, Callable[[str, dict, datetime], dict]] = {
    "myWatchlistToday": _my_watchlist_today,
    "myNamesReporting": _my_names_reporting,
    "myPnlStats": _my_pnl_stats,
    "myPositionsRisk": _my_positions_risk,
    "myRulesCheck": _my_rules_check,
    "myMistakes": _my_mistakes,
    "tickerCard": _ticker_card,
    "marketOnMyNames": _market_on_my_names,
    "tickerFlow": _ticker_flow,
    "tradeRecap": _trade_recap,
    "myPnlCalendar": _my_pnl_calendar,
    "mySetupEdge": _my_setup_edge,
    "myScreenToday": _my_screen_today,
    "roomBuzzOnMyNames": _room_buzz_on_my_names,
    "myEarningsReactions": _my_earnings_reactions,
}


def build(kind: str, user_id: str, params: dict, *, now: datetime | None = None) -> dict:
    """Build the payload for `kind`. Raises `WidgetRequestError` for an unknown kind
    (or one with no builder yet) and for params its builder rejects."""
    if kind not in KIND_WAVE:
        raise WidgetRequestError(f"unknown widget kind: {kind!r}")
    builder = _BUILDERS.get(kind)
    if builder is None:
        raise WidgetRequestError(f"widget kind not available yet: {kind!r}")
    if params is not None and not isinstance(params, dict):
        raise WidgetRequestError("params must be an object")
    payload = builder(user_id, params or {}, now or datetime.now(timezone.utc))
    payload["sourceDetail"] = source_detail(kind, payload)
    return cap_payload(payload, kind)
