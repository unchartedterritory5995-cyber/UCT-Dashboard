"""A built-widget run on the ONE-process web pod (wave 8, Task 8.7): admission, deadline, cache, counters.

`run_plan` is the one door every builder run goes through (`/run`, `/drill`, `/preview`, `/examples`):

    validate -> clean + merge the viewer settings -> cache key -> SingleFlight.run_here
             -> admit (a permit from notebook_widgets._POOL, never a second pool) -> deadline (SQL)
             -> scan -> aggregate.evaluate -> payload.build_payload -> cache

Rules it keeps (global constraints, "One web process" / "Rates"):

* The work runs INLINE on the request thread. It takes one permit from the phase 1 pool's own
  semaphore (`BoundedPool.admit_inline`), so phase 1 fan-out and builder runs share ONE ceiling, and
  phase 1 can never take the two reserved permits. Builder runs hold at most `BUILDER_MAX`, previews
  and examples at most `PREVIEW_MAX` of those, one member at most `MEMBER_MAX`. A full gate answers
  `EngineBusy` AT ONCE; nothing queues.
* Every SQL read of a run sits under a progress-handler deadline (`DEADLINE_S`). An interrupt is
  `EngineTooLong` ("Took too long"), never a 500. A newer preview from the same member interrupts an
  older one (`Superseded`).
* Results are cached for `CACHE_TTL_S`, at most `CACHE_MAX` entries, keyed on (member, plan hash,
  viewer settings, data stamp, ET day, widget ids). The member's id is in the key, so one member's
  result is never another's, whatever the plan.
* Saved-widget runs (lane `run`) are counted per member in memory and flushed to
  `daily_usage_counters` at most once a minute per member; `DAILY_RUN_CAP` a day. A cache hit is not
  counted. ⚠️ Per process: an unflushed count (under a minute of runs) is lost on a restart, and a
  second web process would keep its own pending counts (the durable part is shared).
"""
from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, Literal

from api.services import auth_db, daily_counters
from api.services.cache import TTLCache
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import aggregate as waggregate
from api.services.journal_two.widget_engine import payload as wpayload
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import sources as wsources
from api.services.journal_two.widget_engine.plan import PlanError

# -- constants (Task 8.7 brief, verbatim) ------------------------------------------------------------

BUILDER_MAX = 4
PREVIEW_MAX = 2
MEMBER_MAX = 2
DEADLINE_S = 1.5
CACHE_TTL_S = 300
CACHE_MAX = 2000
DAILY_RUN_CAP = 1000
FLUSH_EVERY_S = 60

BUSY = "Busy right now. Try again in a moment."
TOO_LONG = "This is a lot of data to add up. Try a shorter range or fewer splits."
S_ACCOUNT_GONE = "That account is no longer in your Journal; showing all accounts."

#: The `daily_usage_counters` scope for saved-widget runs (subject = the member's id).
RUNS_SCOPE = "notebook_widget_runs"
#: How long a SingleFlight waiter waits for the leader's answer before computing its own.
_WAIT_S = DEADLINE_S + 1.0
#: The SQLite progress handler fires every this many virtual-machine instructions.
_PROGRESS_STEPS = 1000

Lane = Literal["run", "drill", "preview", "example"]
_LANES = ("run", "drill", "preview", "example")
#: Lanes that hold one of the `PREVIEW_MAX` preview slots.
_PREVIEW_LANES = frozenset({"preview", "example"})
#: Ruling R-21: only the builder preview supersedes (one preview in flight per member). Examples are
#: fetched in concurrent batches by the gallery, so they neither bump nor watch the counter.
_SUPERSEDE_LANES = frozenset({"preview"})


class EngineBusy(Exception):
    def __init__(self, sentence: str = BUSY):
        super().__init__(sentence)
        self.sentence = sentence


class EngineTooLong(Exception):
    def __init__(self, sentence: str = TOO_LONG):
        super().__init__(sentence)
        self.sentence = sentence


class DailyCapReached(Exception):
    """The member has run saved widgets `DAILY_RUN_CAP` times today (the router owns the sentence)."""


class Superseded(Exception):
    """A newer preview from the same member replaced this one."""


# -- module state (looked up at call time, so a test can reset it) ------------------------------------

class _Gates:
    def __init__(self) -> None:
        self.builder = threading.BoundedSemaphore(BUILDER_MAX)
        self.preview = threading.BoundedSemaphore(PREVIEW_MAX)
        self.lock = threading.Lock()
        self.member: dict[str, int] = {}


class _Counter:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        #: user_id -> {"day": ET day, "pending": unflushed runs, "last": clock of the last flush}
        self.by_user: dict[str, dict[str, Any]] = {}


_GATES = _Gates()
_COUNTER = _Counter()
_CACHE = TTLCache(max_size=CACHE_MAX)
_FLIGHT = nw.SingleFlight(waiters=8, name="widget run")
_PREVIEW_LOCK = threading.Lock()
_PREVIEW_GEN: dict[str, int] = {}


def _clock() -> float:
    return time.monotonic()


def _reset_state() -> None:
    """Fresh gates, cache, single-flight table and counters (tests only)."""
    global _GATES, _COUNTER, _CACHE, _FLIGHT
    _GATES, _COUNTER = _Gates(), _Counter()
    _CACHE = TTLCache(max_size=CACHE_MAX)
    _FLIGHT = nw.SingleFlight(waiters=8, name="widget run")
    with _PREVIEW_LOCK:
        _PREVIEW_GEN.clear()


# -- admission -------------------------------------------------------------------------------------

@contextmanager
def admit(user_id: str, lane: Lane) -> Iterator[None]:
    """Hold one pool permit, one builder slot, a preview slot (preview and example lanes) and one of the
    member's `MEMBER_MAX`, or raise `EngineBusy` AT ONCE when any is full. Released in `finally`."""
    if lane not in _LANES:
        raise ValueError(f"unknown lane {lane!r}")
    gates, pool = _GATES, nw._POOL
    held: list[Callable[[], None]] = []
    try:
        if not pool.admit_inline():
            raise EngineBusy()
        held.append(pool.release_inline)
        if not gates.builder.acquire(blocking=False):
            raise EngineBusy()
        held.append(gates.builder.release)
        if lane in _PREVIEW_LANES:
            if not gates.preview.acquire(blocking=False):
                raise EngineBusy()
            held.append(gates.preview.release)
        with gates.lock:
            n = gates.member.get(user_id, 0)
            if n >= MEMBER_MAX:
                raise EngineBusy()
            gates.member[user_id] = n + 1

        def _leave() -> None:
            with gates.lock:
                left = gates.member.get(user_id, 1) - 1
                if left > 0:
                    gates.member[user_id] = left
                else:
                    gates.member.pop(user_id, None)

        held.append(_leave)
        yield
    finally:
        for release in reversed(held):
            release()


# -- deadline --------------------------------------------------------------------------------------

@contextmanager
def deadline(conn: sqlite3.Connection, seconds: float = DEADLINE_S, *,
             superseded: Callable[[], bool] = lambda: False) -> Iterator[None]:
    """Interrupt `conn`'s SQL past `seconds`, or as soon as `superseded()` is true. The interrupt
    becomes `EngineTooLong` / `Superseded`; any other database error passes through unchanged. The
    handler is cleared on exit, whatever happened (auth_db also clears it on reuse; this does not
    rely on that)."""
    end = time.monotonic() + seconds
    why: list[str] = []

    def _cb() -> int:
        if superseded():
            why.append("superseded")
            return 1
        if time.monotonic() > end:
            why.append("late")
            return 1
        return 0

    conn.set_progress_handler(_cb, _PROGRESS_STEPS)
    try:
        yield
    except sqlite3.OperationalError as e:
        if why and "interrupt" in str(e).lower():
            if why[0] == "superseded":
                raise Superseded() from e
            raise EngineTooLong() from e
        raise
    finally:
        conn.set_progress_handler(None, 0)


# -- data stamp --------------------------------------------------------------------------------------

def _one(conn: sqlite3.Connection, sql: str, user_id: str) -> str:
    row = conn.execute(sql, (user_id,)).fetchone()
    return ",".join("" if v is None else str(v) for v in (tuple(row) if row is not None else ()))


_TRADES_STAMP = (
    "SELECT COUNT(*), MAX(rowid), TOTAL(pnl_dollar), TOTAL(fees), "
    "TOTAL(COALESCE(analytics_excluded, 0)), "
    "TOTAL(LENGTH(COALESCE(setup, '')) + LENGTH(COALESCE(mistake_tags, '')) "
    "+ LENGTH(COALESCE(emotion_tags, ''))), "
    # beyond the brief's list, cheap and on the same rows: a stop added (R), a result or symbol edit
    "TOTAL(COALESCE(original_stop, 0)), TOTAL(COALESCE(r_multiple, 0)), "
    "TOTAL(LENGTH(COALESCE(symbol, '')) + LENGTH(COALESCE(result, '')) "
    "+ LENGTH(COALESCE(account_id, ''))), "
    # fix round 1 M3: a date moved (entry or exit) or a side flipped
    "TOTAL(COALESCE(julianday(exit_date), 0)), TOTAL(COALESCE(julianday(entry_date), 0)), "
    "SUM(CASE WHEN side = 'Long' THEN 1 ELSE 0 END)"
    " FROM j2_trades WHERE user_id = ?")
_EXCURSIONS_STAMP = "SELECT MAX(computed_at) FROM j2_trade_excursions WHERE user_id = ?"
_ADHERENCE_STAMP = "SELECT MAX(updated_at) FROM j2_trade_adherence WHERE user_id = ?"
_ACCOUNTS_STAMP = "SELECT COUNT(*), MAX(updated_at) FROM j2_accounts WHERE user_id = ?"
_POSITIONS_STAMP = (
    "SELECT COUNT(*), MAX(updated_at), COUNT(closed_at), TOTAL(COALESCE(broker_price, 0)), "
    "TOTAL(COALESCE(stop_price, 0)), TOTAL(LENGTH(COALESCE(setup, '')))"
    " FROM j2_positions WHERE user_id = ?")
_STRATEGIES_STAMP = "SELECT MAX(updated_at), COUNT(*) FROM j2_option_strategies WHERE user_id = ?"
_CHECKINS_STAMP = "SELECT COUNT(*), MAX(created_at) FROM j2_note_checkins WHERE user_id = ?"
_DAY_NOTES_STAMP = "SELECT COUNT(*) FROM j2_day_notes WHERE user_id = ?"


def data_stamp(conn: sqlite3.Connection, user_id: str, source_key: str) -> str:
    """A string that changes when the member's rows a source reads change.

    `j2_trades` has no `updated_at`, so the closed-trades stamp is a fingerprint of the member's rows:
    the count, the newest rowid, the P&L, fee and flagged totals, the summed lengths of setup /
    mistake / emotion tags, and (beyond the brief) the stop, R and symbol / result / account totals,
    the summed entry and exit julian days and the count of long trades;
    plus the newest excursion `computed_at`, the newest adherence `updated_at`, and the member's
    accounts (count, newest `updated_at`). Open positions use the positions' count and newest
    `updated_at` (and their closes, marks, stops and setups). Trading days use the trades stamp plus
    option strategies, check-ins and day notes.

    Known blind spot: the stamp is a set of sums, so any edit that leaves every summed quantity
    unchanged does not move it: a same-length relabel (setup "Flag" -> "Base", a tag swapped for one
    of equal length), two edits that cancel (one trade's P&L up by what another's goes down, or two
    trades' dates swapped), and any column the stamp does not read at all (shares, prices, notes,
    hour). Such an edit shows after the 300 s TTL at worst.
    """
    trades = "|".join(_one(conn, q, user_id) for q in
                      (_TRADES_STAMP, _EXCURSIONS_STAMP, _ADHERENCE_STAMP, _ACCOUNTS_STAMP))
    if source_key == "open_positions":
        return "p|" + _one(conn, _POSITIONS_STAMP, user_id) + "|" + _one(conn, _ACCOUNTS_STAMP, user_id)
    if source_key == "trading_days":
        return trades + "|d|" + "|".join(_one(conn, q, user_id) for q in
                                         (_STRATEGIES_STAMP, _CHECKINS_STAMP, _DAY_NOTES_STAMP))
    return trades


# -- the daily counter -----------------------------------------------------------------------------

def _et_day(now: datetime | None = None) -> str:
    return nw._today_et(now or datetime.now(timezone.utc)).isoformat()


def _snapshot(entry: dict[str, Any]) -> tuple[str, int]:
    """Under `_COUNTER.lock`: take the entry's pending count for a flush and reset it."""
    n = int(entry["pending"])
    entry["pending"] = 0
    entry["last"] = _clock()
    return entry["day"], n


def _take(user_id: str, day: str, n: int) -> None:
    """Flush `n` runs for `day` OUTSIDE the counter lock (a slow database never holds up another
    member's count or cap check). A failed take puts the count back, so it is flushed next time."""
    if n <= 0:
        return
    try:
        ok = daily_counters.take(day, [daily_counters.Charge(RUNS_SCOPE, user_id, n, None)]) is None
    except Exception:  # noqa: BLE001 -- take fails open; this is belt and braces
        ok = False
    if ok:
        return
    with _COUNTER.lock:
        entry = _COUNTER.by_user.get(user_id)
        if entry is not None and entry["day"] == day:
            entry["pending"] += n


def count_run(user_id: str) -> None:
    """Count one saved-widget run; flush the member's pending count when `FLUSH_EVERY_S` have passed
    since their last flush (or on their first run, or when the ET day changed)."""
    day = _et_day()
    flushes: list[tuple[str, int]] = []
    with _COUNTER.lock:
        entry = _COUNTER.by_user.get(user_id)
        if entry is not None and entry["day"] != day:
            flushes.append(_snapshot(entry))         # the old day's runs go to the old day
            entry = None
        if entry is None:
            entry = {"day": day, "pending": 0, "last": None}
            _COUNTER.by_user[user_id] = entry
        entry["pending"] += 1
        if entry["last"] is None or _clock() - entry["last"] >= FLUSH_EVERY_S:
            flushes.append(_snapshot(entry))
    for d, n in flushes:
        _take(user_id, d, n)


def _pending(user_id: str) -> int:
    day = _et_day()
    with _COUNTER.lock:
        entry = _COUNTER.by_user.get(user_id)
        return int(entry["pending"]) if entry and entry["day"] == day else 0


def daily_cap_reached(user_id: str) -> bool:
    """True when the member's runs today (durable + pending) reach `DAILY_RUN_CAP`.

    Check-then-act: a run is counted after it finishes, so concurrent runs that all pass this check
    can overshoot the cap by about the member's concurrency (`MEMBER_MAX`, plus waiters that compute
    their own), and a count in flight to the database is briefly in neither number. The cap is a
    cost valve, not an exact quota."""
    day = _et_day()
    return daily_counters.value(day, RUNS_SCOPE, user_id) + _pending(user_id) >= DAILY_RUN_CAP


# -- previews --------------------------------------------------------------------------------------

def preview_generation(user_id: str) -> int:
    """A new preview from `user_id`: the member's preview number, one higher than the last."""
    with _PREVIEW_LOCK:
        n = _PREVIEW_GEN.get(user_id, 0) + 1
        _PREVIEW_GEN[user_id] = n
        return n


def _preview_gen_now(user_id: str) -> int:
    with _PREVIEW_LOCK:
        return _PREVIEW_GEN.get(user_id, 0)


# -- settings --------------------------------------------------------------------------------------

def _scalar_ok(v: Any) -> bool:
    if isinstance(v, bool) or isinstance(v, str):
        return True
    return isinstance(v, (int, float)) and v == v and v not in (float("inf"), float("-inf"))


def clean_settings(settings: Any) -> dict:
    """The viewer settings a run may use, bounded (8.6 review Minor 1): `range` (a plan range),
    `accountId` (a string of at most 200 characters, or None) and `filter` (the overridable filter's
    values: at most 50, each string at most 200 characters; also accepted as `{"values": [...]}`).
    Unknown keys are dropped. A bad value is refused with a member sentence (`PlanError`)."""
    if settings is None:
        return {}
    if not isinstance(settings, dict):
        raise PlanError(wplan.S_UNREADABLE)
    out: dict[str, Any] = {}
    if settings.get("range") is not None:
        out["range"] = wplan._norm_range(settings["range"])
    if "accountId" in settings:
        acc = settings["accountId"]
        if acc is not None and (not isinstance(acc, str) or len(acc) > wplan.MAX_TEXT):
            raise PlanError(wplan.S_ACCOUNTS)
        out["accountId"] = acc or None
    if settings.get("filter") is not None:
        vals = settings["filter"]
        if isinstance(vals, dict):
            vals = vals.get("values")
        if not isinstance(vals, list):
            raise PlanError(wplan.S_UNREADABLE)
        if len(vals) > wplan.MAX_FILTER_VALUES:
            raise PlanError(wplan.S_TOO_MANY_VALUES)
        for v in vals:
            if not _scalar_ok(v):
                raise PlanError(wplan.S_UNREADABLE)
            if isinstance(v, str) and len(v) > wplan.MAX_TEXT:
                raise PlanError(wplan.S_TEXT_TOO_LONG)
        if vals:
            out["filter"] = list(vals)
    return out


def _merge(plan: dict, viewer: dict, acc: str | None) -> dict:
    """The plan the run reads: the viewer's range and overridable-filter values over the widget's
    own, narrowed to `acc` (an account the member owns) or all accounts."""
    merged = copy.deepcopy(plan)
    if "range" in viewer:
        merged["range"] = viewer["range"]
    if "filter" in viewer:
        for f in merged["filters"]:
            if f.get("overridable"):
                f["values"] = list(viewer["filter"])
                break
    merged["accounts"] = {"id": acc} if acc else "all"
    return merged


def _compare_range(plan: dict, rng: wplan.ResolvedRange, today) -> wplan.ResolvedRange | None:
    cmp = plan.get("compare")
    if not cmp or plan["source"] in wplan.RIGHT_NOW_SOURCES:     # R-17: right now has no earlier
        return None
    mode = cmp.get("mode")
    if mode == "previous":
        return wplan.previous_range(rng)
    if mode == "range":
        return wplan.resolve_range({"from": cmp["from"], "to": cmp["to"]}, today)
    if mode == "all":
        return wplan.resolve_range({"token": "all"}, today)
    return None


# -- the run ---------------------------------------------------------------------------------------

@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    conn = auth_db.get_connection()
    try:
        yield conn
    finally:
        try:
            conn.set_progress_handler(None, 0)
        finally:
            conn.close()


def _cache_key(user_id: str, plan: dict, viewer: dict, stamp: str, today: str,
               def_id: Any, def_rev: Any, latest_rev: Any, notices: list[str]) -> str:
    # The notices are in the key (fix round 1 I-1): "a foreign account was asked for" and "all
    # accounts" read the same rows but answer different payloads.
    blob = json.dumps([user_id, wplan.plan_hash(plan), viewer, stamp, today, def_id, def_rev,
                       latest_rev, notices], sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      default=str)
    return "widget_run::" + hashlib.sha1(blob.encode("utf-8")).hexdigest()


def run_plan(user_id: str, plan: dict, settings: dict, *, lane: Lane, def_id: str | None = None,
             def_rev: int | None = None, latest_rev: int | None = None,
             now: datetime | None = None, sample: bool = False) -> dict:
    """Run `plan` for the session member `user_id` and answer the built-widget payload.

    Precondition (the router's, Task 8.11): `def_id` / `def_rev` / `latest_rev` are passed only for a
    definition `widget_definitions.resolve_for_run` found for THIS member; a foreign or deleted
    `defId` is treated as absent before this is called. This function echoes them, never checks them.

    Raises `PlanError` (a member sentence), `EngineBusy`, `EngineTooLong`, `Superseded` or
    `DailyCapReached`; the router maps each to its state. `sample=True` (the bundled sample book)
    lands in Task 8.10."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a run needs the session member's id")
    if lane not in _LANES:
        raise ValueError(f"unknown lane {lane!r}")
    if sample:
        raise NotImplementedError("sample runs read sources.sample_rows (Task 8.10)")
    now = now or datetime.now(timezone.utc)
    today = nw._today_et(now)

    base = wplan.validate_plan(copy.deepcopy(plan), wsources.CATALOG)
    viewer = clean_settings(settings)
    if not any(f.get("overridable") for f in base["filters"]):
        viewer.pop("filter", None)                    # M5: nothing to override, nothing to echo or key
    superseded: Callable[[], bool] = lambda: False
    if lane in _SUPERSEDE_LANES:
        mine = preview_generation(user_id)
        superseded = lambda: _preview_gen_now(user_id) != mine          # noqa: E731

    with _connection() as conn:
        with deadline(conn, superseded=superseded):
            requested = viewer["accountId"] if "accountId" in viewer else (
                base["accounts"]["id"] if isinstance(base["accounts"], dict) else None)
            acc = wsources.owned_account_id(conn, user_id, requested)
            account_name = None
            if acc:
                name = wsources._account_names(conn, user_id).get(acc)
                account_name = nw._clip(name, wplan.MAX_TEXT) if isinstance(name, str) else None
            merged = wplan.validate_plan(_merge(base, viewer, acc), wsources.CATALOG)
            stamp = data_stamp(conn, user_id, merged["source"])
        notices = [S_ACCOUNT_GONE] if requested and not acc else []
        echo = dict(viewer)
        if "accountId" in echo and echo["accountId"] != acc:
            echo["accountId"] = None                  # a foreign id is treated as absent, never echoed
        key = _cache_key(user_id, merged, echo, stamp, today.isoformat(), def_id, def_rev, latest_rev,
                         notices)

        hit = _CACHE.get(key)
        if hit is not None:
            return copy.deepcopy(hit)
        if lane == "run" and daily_cap_reached(user_id):
            raise DailyCapReached()

        def _compute() -> dict:
            if superseded():
                raise Superseded()
            rng = wplan.resolve_range(merged["range"], today)
            crng = _compare_range(merged, rng, today)
            scan_settings = {"accountId": acc}
            with admit(user_id, lane):
                with deadline(conn, superseded=superseded):
                    scan = wsources.scan(conn, merged, scan_settings, rng, user_id, today=today)
                    cscan = (wsources.scan(conn, merged, scan_settings, crng, user_id, today=today)
                             if crng is not None else None)
                if superseded():
                    raise Superseded()
                result = waggregate.evaluate(scan.rows, merged, wsources.CATALOG)
                cresult = (waggregate.evaluate(cscan.rows, merged, wsources.CATALOG)
                           if cscan is not None else None)
            out = wpayload.build_payload(
                result=result, plan=merged, settings=echo, def_id=def_id, def_rev=def_rev,
                latest_rev=latest_rev, rng=rng, scan=scan, sample=False, now=now,
                compare_result=cresult, compare_label=crng.label if crng is not None else None,
                account_name=account_name, notices=notices)
            _CACHE.set(key, out, CACHE_TTL_S)
            if lane == "run":
                count_run(user_id)
            return out

        ok, value = _FLIGHT.run_here(key, _compute, _WAIT_S)
        if not ok:                                    # waited past the leader, or it failed: our own
            value = _compute()
        return copy.deepcopy(value)
