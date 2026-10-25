"""A built-widget run on the ONE-process web pod (wave 8, Task 8.7): admission, deadline, cache, counters.

`run_plan` is the one door every builder run goes through (`/run`, `/drill`, `/preview`):

    validate -> clean + merge the viewer settings -> cache key -> SingleFlight.run_here
             -> admit (a permit from notebook_widgets._POOL, never a second pool) -> deadline (SQL)
             -> scan -> aggregate.evaluate -> payload.build_payload -> cache

`run_examples` (`/examples`, Task 8.10) is the same machinery for a batch of shelf examples: ONE
admission in the `example` lane, ONE scan per distinct source, every card cut from that row set.
A member with fewer than `SAMPLE_BELOW` closed trades gets both on the bundled sample book
(`sample_rows`, `wants_sample`), labelled `sample: True`.

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
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Literal

from api.services import auth_db, daily_counters, placeholder_stop
from api.services.cache import TTLCache
from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import trading_days
from api.services.journal_two.widget_engine import aggregate as waggregate
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import payload as wpayload
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import shelf as wshelf
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

#: Task 8.10: a member with fewer than this many closed trades sees examples on the sample book.
SAMPLE_BELOW = 5
#: Examples run in one batch at most this many.
MAX_EXAMPLES = 8
S_TOO_MANY_EXAMPLES = "Pick up to 8 examples."
S_UNKNOWN_EXAMPLE = "That example isn't available."

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
#: Lanes a sample-book run may use (Task 8.10 fix round 1, Minor 2).
_SAMPLE_LANES = frozenset({"preview", "example"})
#: Ruling W9-R5: routine and tracker history never read the sample book (a member with no trades
#: and ten ticked days sees their own ten days). A plan that names a routine or tracker (`ref`) is
#: read from the member's rows too: the sample book has no routines or trackers.
NO_SAMPLE_SOURCES = wplan.TOOL_SOURCES


def _never_sample(plan: dict) -> bool:
    return plan.get("source") in NO_SAMPLE_SOURCES or wplan.uses_tools(plan)


def tool_viewer(plan: dict, viewer: dict) -> dict:
    """Ruling W9-R19: routines and trackers cover all accounts, so a viewer's account is ignored
    for them (read as "all", never a refusal and never the dropped-account notice)."""
    if plan.get("source") in wplan.TOOL_SOURCES:
        viewer.pop("accountId", None)
    return viewer


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
        with wcompile.python_deadline(lambda: _cb() == 1):
            yield
    except wcompile.ScanTooLong as e:
        if why and why[0] == "superseded":
            raise Superseded() from e
        raise EngineTooLong() from e
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
# Wave 9 (Task 9.8): routines and trackers. Beyond the brief's COUNT / MAX(updated_at), each also
# sums what a same-second edit can change (a tick undone, a skip undone, a value rewritten, a
# schedule replaced on its own day, a routine edited).
_ROUTINE_TICKS_STAMP = ("SELECT COUNT(*), MAX(updated_at), TOTAL(ticked)"
                        " FROM j2_routine_ticks WHERE user_id = ?")
_ROUTINE_DAYS_STAMP = ("SELECT COUNT(*), MAX(updated_at), TOTAL(skipped)"
                       " FROM j2_routine_days WHERE user_id = ?")
_ROUTINES_STAMP = ("SELECT COUNT(*), MAX(updated_at), TOTAL(save_seq), COUNT(archived_at),"
                   " COUNT(deleted_at) FROM j2_routines WHERE user_id = ?")
_ROUTINE_SCHEDULES_STAMP = ("SELECT COUNT(*), MAX(effective_from), TOTAL(LENGTH(schedule_json))"
                            " FROM j2_routine_schedules WHERE user_id = ?")
_TRACKER_VALUES_STAMP = ("SELECT COUNT(*), MAX(updated_at), TOTAL(value)"
                         " FROM j2_tracker_values WHERE user_id = ?")
_TRACKERS_STAMP = ("SELECT COUNT(*), MAX(updated_at), TOTAL(save_seq), COUNT(deleted_at)"
                   " FROM j2_trackers WHERE user_id = ?")
_ROUTINE_STAMPS = (_ROUTINE_TICKS_STAMP, _ROUTINE_DAYS_STAMP, _ROUTINES_STAMP,
                   _ROUTINE_SCHEDULES_STAMP)
_TRACKER_STAMPS = (_TRACKER_VALUES_STAMP, _TRACKERS_STAMP)


def data_stamp(conn: sqlite3.Connection, user_id: str, source_key: str,
               plan: dict | None = None) -> str:
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

    Wave 9: routine history reads the routines, their schedules, ticks and skipped days (and the
    trades, positions and option strategies a "days you traded" schedule follows); tracker history
    the trackers, their values and the check-ins; trading days append both only when `plan` names a
    routine or a tracker (the check-ins are read once).
    """
    def many(qs) -> str:
        return "|".join(_one(conn, q, user_id) for q in qs)

    # I-3: the routine and tracker stamps are read only by the branches that use them.
    def routines() -> str:
        return "r|" + many(_ROUTINE_STAMPS)

    def trackers() -> str:
        return "k|" + many(_TRACKER_STAMPS)

    if source_key == "routine_history":
        return routines() + "|" + many((_TRADES_STAMP, _POSITIONS_STAMP, _STRATEGIES_STAMP))
    if source_key == "tracker_history":
        return trackers() + "|" + _one(conn, _CHECKINS_STAMP, user_id)
    trades = many((_TRADES_STAMP, _EXCURSIONS_STAMP, _ADHERENCE_STAMP, _ACCOUNTS_STAMP))
    if source_key == "open_positions":
        return "p|" + _one(conn, _POSITIONS_STAMP, user_id) + "|" + _one(conn, _ACCOUNTS_STAMP, user_id)
    if source_key == "trading_days":
        days = trades + "|d|" + many((_STRATEGIES_STAMP, _CHECKINS_STAMP, _DAY_NOTES_STAMP))
        if wplan.uses_tools(plan):
            days += "|" + routines() + "|" + trackers()
        return days
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


# -- the sample book (Task 8.10) ---------------------------------------------------------------------

SAMPLE_BOOK_PATH = Path(__file__).with_name("sample_book.json")
_BOOK_LOCK = threading.Lock()
_BOOK: dict[str, Any] = {}


def _book() -> dict:
    """The parsed sample book and its digest, read once per process (`tools/gen_widget_sample_book.py`
    writes it; it is synthetic and never a member's)."""
    with _BOOK_LOCK:
        if not _BOOK:
            # LF-normalised: a CRLF checkout of the same commit is the same book (and digest)
            blob = SAMPLE_BOOK_PATH.read_bytes().replace(b"\r\n", b"\n")
            _BOOK["data"] = json.loads(blob.decode("utf-8"))
            _BOOK["digest"] = hashlib.sha1(blob).hexdigest()
        return _BOOK


def sample_today() -> date:
    """The sample book's own "today": a sample run resolves its range against this session, so the
    book's nine months stay inside the widget's range whatever the real date."""
    return date.fromisoformat(_book()["data"]["anchor_day"])


def _sample_closed(book: dict) -> list[dict]:
    names = {a["id"]: a["name"] for a in book["accounts"]}
    recs = sorted(book["closed_trades"], key=lambda t: (t["day"], t["exit_at"], t["id"]), reverse=True)
    n = len(recs)
    out: list[dict] = []
    for i, t in enumerate(recs):
        gross, fees, r = nw._num(t["gross"]), nw._num(t["fees"]) or 0.0, nw._num(t["r"])
        pct = nw._num(t["pct_return"])
        shares, entry = nw._num(t["shares"]), nw._num(t["entry_price"])
        row = {
            "_tid": t["id"],
            "id": wsources._sort_key(t["exit_at"], n - i),
            "day": t["day"],
            "hour_et": nw._num(t["hour_et"]),
            "symbol": t["symbol"],
            "side": t["side"],
            "setup": t["setup"] or None,
            "result": t["result"],
            "net": None if gross is None else round(gross - fees, 6),
            "gross": gross,
            "fees": fees,
            "r": r,
            "risk_dollars": wsources._risk(t["entry_price"], t["stop"], t["shares"]),
            "pct_return": pct,
            "hold_days": nw._num(t["hold_days"]),
            "hold_minutes": wsources._minutes_held(t["entry_at"], t["exit_at"]),
            "shares": shares,
            "regime": t["regime"] or None,
            "mistake": list(t["mistake"]),
            "emotion": list(t["emotion"]),
            "origin": wsources._ROW_ORIGIN.get(t["origin"], "manual"),
            "account": t["account"],
            "account_name": names.get(t["account"]),
            "had_stop": not placeholder_stop.is_placeholder_stop(t["stop"], t["entry_price"]),
            "mfe_r": nw._num(t["mfe_r"]),
            "mae_r": nw._num(t["mae_r"]),
            "exit_efficiency": nw._num(t["exit_efficiency"]),
            "adherence_pct": nw._num(t["adherence_pct"]),
            "plan_linked": bool(t["plan_linked"]),
            "flagged": bool(t["flagged"]),
            "_size": None if shares is None or entry is None else abs(shares * entry),
            "label": t["symbol"],
            "label2": t["day"],
        }
        row["weekday"] = wsources._weekday(row["day"])
        row["month"] = str(row["day"])[:7] if row["day"] else None
        row["hold_bucket"] = wsources._hold_bucket(row["hold_days"])
        row["r_bucket"] = wsources._r_bucket(r)
        out.append(row)
    for row, q in zip(out, wsources._quartiles([r.pop("_size") for r in out])):
        row["size_quartile"] = q
    return out


def _sample_positions(book: dict, today: date) -> list[dict]:
    """The same derivation as `sources._position_rows`, over the book's positions."""
    names = {a["id"]: a["name"] for a in book["accounts"]}
    sizes = {a["id"]: nw._num(a["size"]) for a in book["accounts"]}
    recs = sorted(book["open_positions"], key=lambda p: (p["entry_at"], p["id"]), reverse=True)
    out = []
    for p in recs:
        est = bool(p["entry_estimated"])
        entry_day = trading_days.entry_day_et(p["entry_at"], estimated=est)
        days_open = float((today - date.fromisoformat(entry_day)).days) if entry_day else None
        entry, shares, mark = nw._num(p["entry_price"]), nw._num(p["shares"]), nw._num(p["mark"])
        unreal = None
        if mark is not None and entry is not None and shares is not None:
            unreal = round((mark - entry) * shares * (1 if p["side"] == "Long" else -1), 2)
        risk = wsources._risk(p["entry_price"], p["stop"], p["shares"])
        if risk is not None and entry is not None:
            stop = nw._num(p["stop"])
            if stop is not None and (stop >= entry if p["side"] == "Long" else stop <= entry):
                risk = 0.0
        price = mark if mark is not None else entry
        value = None if price is None or shares is None else abs(price * shares)
        size = sizes.get(p["account"])
        out.append({
            "_tid": p["id"],
            "symbol": p["symbol"],
            "side": p["side"],
            "setup": p["setup"] or None,
            "days_open": days_open,
            "unrealised": unreal,
            "risk_dollars": risk,
            "risk_pct_account": (None if risk is None or not size or size <= 0
                                 else round(risk / size * 100.0, 4)),
            "pct_account": (None if value is None or not size or size <= 0
                            else round(value / size * 100.0, 4)),
            "account": p["account"],
            "account_name": names.get(p["account"]),
            "had_stop": risk is not None,
            "entry_estimated": est,
            "origin": wsources._ROW_ORIGIN.get(p["origin"], "manual"),
            "flagged": False,
            "label": p["symbol"],
            "label2": entry_day or "Entry date estimated",
        })
    return out


def _sample_days(book: dict) -> list[dict]:
    """The same row shape as `sources.scan_days`: one row per session, newest first."""
    out = []
    for d in sorted(book["trading_days"], key=lambda r: r["day"], reverse=True):
        k, count = d["day"], int(d["trade_count"])
        decisive = int(d["winners"]) + int(d["losers"])
        net = round(float(d["net"]), 6)
        present = list(d["origins"])                       # broker / csv / manual, scan order
        row: dict[str, Any] = {}
        if present:
            row["origin"] = present[0] if len(present) == 1 else "mixed"
            if len(present) > 1:
                row["origins"] = present
        row.update({
            "day": k,
            "weekday": wsources._weekday(k),
            "day_net": net if count else None,
            "net": net,
            "trade_count": float(count),
            "day_win_rate": (int(d["winners"]) / decisive) if decisive else None,
            "wins": float(int(d["winners"])),
            "losses": float(int(d["losers"])),
            "best_trade": nw._num(d["best"]),
            "worst_trade": nw._num(d["worst"]),
            "mood": None if d["mood"] is None else float(d["mood"]),
            "focus": None if d["focus"] is None else float(d["focus"]),
            "had_day_note": bool(d["had_day_note"]),
            "flagged": False,
            "label": k,
            "label2": wsources._weekday(k),
        })
        out.append(row)
    return out


def sample_rows(source_key: str) -> list[dict]:
    """The sample book's rows for one source, newest first, shaped exactly like that source's scan
    rows (`sources.scan_closed` / `scan_positions` / `scan_days`, including the `origin` key).
    A fresh list every call: a caller may change it freely. Routine and tracker history have no
    sample rows (ruling W9-R5): asking for them is a `ValueError`."""
    if source_key in NO_SAMPLE_SOURCES:
        raise ValueError(f"{source_key!r} is never read from the sample book")
    book = _book()["data"]
    if source_key == "closed_trades":
        return _sample_closed(book)
    if source_key == "open_positions":
        return _sample_positions(book, sample_today())
    if source_key == "trading_days":
        return _sample_days(book)
    raise ValueError(f"unknown source {source_key!r}")


def wants_sample(conn: sqlite3.Connection, user_id: str) -> bool:
    """True when the member has fewer than `SAMPLE_BELOW` closed trades across all accounts."""
    n = conn.execute("SELECT COUNT(*) FROM j2_trades WHERE user_id = ?", (user_id,)).fetchone()[0]
    return int(n or 0) < SAMPLE_BELOW


# -- one row set, many cards ------------------------------------------------------------------------

def _in_range(day: Any, rng: wplan.ResolvedRange) -> bool:
    if not isinstance(day, str):
        return False
    d = day[:10]
    return d <= rng.to_day and (rng.from_day is None or d >= rng.from_day)


def _narrow(source_key: str, base: wsources.Scan, plan: dict, rng: wplan.ResolvedRange) -> wsources.Scan:
    """One card's `Scan` cut from a scan that covers it (`base`: a wider range, no filters, flagged
    trades included): the card's range, its "last N trades", and the flagged-trade rule of its view,
    as `sources.scan` would have read them for the card alone. Filters, splits and measures are then
    `aggregate.evaluate`'s, as for any scan."""
    rows = list(base.rows)
    if source_key == "open_positions":                      # what is open now: no range applies
        return wsources.Scan(source_key, rows, base.capped, None, len(rows), None)
    if source_key in NO_SAMPLE_SOURCES:                     # one row per day (or per entry)
        rows = [r for r in rows if _in_range(r.get("day"), rng)]
        capped = base.capped and (rng.from_day is None or base.earliest_day is None
                                  or rng.from_day <= base.earliest_day)
        return wsources.Scan(source_key, rows, capped, rows[-1]["day"] if rows else None,
                             len(rows), None, list(base.footnotes), list(base.notices))
    view = (plan.get("view") or {}).get("type")
    if source_key == "closed_trades":
        if view != "list":                                  # the scan's analytics-included rule
            rows = [r for r in rows if not r.get("flagged")]
        if rng.last_n is not None:
            rows = [r for r in rows if isinstance(r.get("day"), str) and r["day"][:10] <= rng.to_day]
            kept = waggregate.apply_filters(rows, plan, wsources.CLOSED)
            out, n = [], 0
            for r in kept:                                  # newest first: keep the newest N
                if n >= int(rng.last_n):
                    break
                out.append(r)
                if not r.get("flagged"):
                    n += 1
            rows, capped = out, base.capped and n < int(rng.last_n)
        else:
            rows = [r for r in rows if _in_range(r.get("day"), rng)]
            capped = base.capped and (rng.from_day is None or base.earliest_day is None
                                      or rng.from_day <= base.earliest_day)
        return wsources.Scan(source_key, rows, capped, rows[-1]["day"] if rows else None,
                             len(rows), None)
    # trading days: one row per session; an unbounded range starts at the first traded session
    lo = rng.from_day
    if rng.last_n is not None:                              # sessions back to the Nth newest trade
        seen, lo = 0, None
        for r in rows:
            if r["day"] > rng.to_day:
                continue
            lo = r["day"]
            seen += int(r.get("trade_count") or 0)
            if seen >= int(rng.last_n):
                break
    elif lo is None:
        traded = [r["day"] for r in rows if (r.get("trade_count") or 0) > 0]
        lo = min(traded) if traded else None
    if lo is None:
        return wsources.Scan(source_key, [], False, None, 0, None)
    cut = wplan.ResolvedRange(lo, rng.to_day, None, rng.label, rng.token)
    rows = [r for r in rows if _in_range(r.get("day"), cut)]
    whole = len(rows) == len(base.rows)
    capped = base.capped and (lo <= (base.earliest_day or lo))
    return wsources.Scan(source_key, rows, capped, rows[-1]["day"] if rows else None, len(rows),
                         None, list(base.footnotes) if whole else [], list(base.notices))


def _sample_scan(source_key: str) -> wsources.Scan:
    rows = sample_rows(source_key)
    earliest = rows[-1].get("day") if rows and source_key != "open_positions" else None
    return wsources.Scan(source_key, rows, False, earliest, len(rows), None)


def _card(plan: dict, base: wsources.Scan, today: date, now: datetime, *, sample: bool,
          settings: dict | None = None, notices: list[str] | None = None,
          def_id: Any = None, def_rev: Any = None, latest_rev: Any = None) -> dict:
    """Evaluate one validated plan over `base` (a covering scan) and build its payload."""
    rng = wplan.resolve_range(plan["range"], today)
    crng = _compare_range(plan, rng, today)
    scan = _narrow(plan["source"], base, plan, rng)
    result = waggregate.evaluate(scan.rows, plan, wsources.CATALOG)
    cresult = None
    if crng is not None:
        cscan = _narrow(plan["source"], base, plan, crng)
        cresult = waggregate.evaluate(cscan.rows, plan, wsources.CATALOG)
    return wpayload.build_payload(
        result=result, plan=plan, settings=settings or {}, def_id=def_id, def_rev=def_rev,
        latest_rev=latest_rev, rng=rng, scan=scan, sample=sample, now=now,
        compare_result=cresult, compare_label=crng.label if crng is not None else None,
        account_name=None, notices=notices or [])


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
    `DailyCapReached`; the router maps each to its state.

    `sample=True` (Task 8.10, the router decides it with `wants_sample`) reads the bundled sample book
    instead of the member's rows: no database is touched, the range resolves against the book's own
    day (`sample_today`), every account is the book's ("All my accounts"), and the payload says
    `sample: True`. It still takes the same admission and cache (keyed on the member AND the sample
    switch), so it is never served to another member, nor to this member once they are on real data."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a run needs the session member's id")
    if lane not in _LANES:
        raise ValueError(f"unknown lane {lane!r}")
    if sample and lane not in _SAMPLE_LANES:
        # Sample data is for example cards and the builder preview only: a saved widget's run or a
        # drill-down never reads it, and it never counts toward the daily cap (fix round 1, Minor 2).
        raise ValueError(f"sample runs are for the preview and example lanes, not {lane!r}")
    now = now or datetime.now(timezone.utc)
    today = nw._today_et(now)

    base = wplan.validate_plan(copy.deepcopy(plan), wsources.CATALOG)
    if sample and _never_sample(base):
        sample = False                                # W9-R5: the member's own routines and trackers
    viewer = tool_viewer(base, clean_settings(settings))
    if not any(f.get("overridable") for f in base["filters"]):
        viewer.pop("filter", None)                    # M5: nothing to override, nothing to echo or key
    superseded: Callable[[], bool] = lambda: False
    if lane in _SUPERSEDE_LANES:
        mine = preview_generation(user_id)
        superseded = lambda: _preview_gen_now(user_id) != mine          # noqa: E731

    if sample:
        return _run_sample(user_id, base, viewer, lane=lane, superseded=superseded, now=now,
                           def_id=def_id, def_rev=def_rev, latest_rev=latest_rev)

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
            stamp = data_stamp(conn, user_id, merged["source"], merged)
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


def _run_sample(user_id: str, base: dict, viewer: dict, *, lane: Lane,
                superseded: Callable[[], bool], now: datetime, def_id: Any, def_rev: Any,
                latest_rev: Any) -> dict:
    """`run_plan(sample=True)`: the plan over the sample book (no database read)."""
    today = sample_today()
    merged = wplan.validate_plan(_merge(base, viewer, None), wsources.CATALOG)
    echo = dict(viewer)
    if "accountId" in echo:
        echo["accountId"] = None                      # the book's accounts are never the member's
    key = _cache_key(user_id, merged, echo, "sample|" + _book()["digest"], today.isoformat(),
                     def_id, def_rev, latest_rev, ["sample"])
    hit = _CACHE.get(key)
    if hit is not None:
        return copy.deepcopy(hit)
    def _compute() -> dict:
        if superseded():
            raise Superseded()
        with admit(user_id, lane):
            book_scan = _sample_scan(merged["source"])
            out = _card(merged, book_scan, today, now, sample=True, settings=echo, def_id=def_id,
                        def_rev=def_rev, latest_rev=latest_rev)
        if superseded():
            raise Superseded()
        _CACHE.set(key, out, CACHE_TTL_S)
        return out

    ok, value = _FLIGHT.run_here(key, _compute, _WAIT_S)
    if not ok:
        value = _compute()
    return copy.deepcopy(value)


# -- examples (Task 8.10) ----------------------------------------------------------------------------

#: The measure a covering scan's plan names (any measure the source offers: only the rows are used).
_COVER_MEASURE = {"closed_trades": "trades", "open_positions": "open_positions",
                  "trading_days": "avg_day_pnl"}


def _cover_plan(source_key: str) -> dict:
    """The plan of the ONE scan a batch reads for a source: no filters, every account, and (for
    closed trades) the list view, so flagged trades are in the rows for the list cards that show them
    (`_narrow` drops them for every other view, as the per-card scan's SQL would)."""
    raw: dict[str, Any] = {"v": wplan.PLAN_VERSION, "source": source_key,
                           "measures": [{"key": _COVER_MEASURE[source_key]}],
                           "range": {"token": "all"}}
    if source_key == "closed_trades":
        raw["view"] = {"type": "list", "auto": False}
    return wplan.validate_plan(raw, wsources.CATALOG)


def _cover_range(ranges: list[wplan.ResolvedRange], today: date) -> wplan.ResolvedRange:
    """The smallest range covering every card's range (and comparison range)."""
    unbounded = any(r.from_day is None or r.last_n is not None for r in ranges)
    lo = None if unbounded or not ranges else min(r.from_day for r in ranges)
    hi = max([r.to_day for r in ranges] or [today.isoformat()])
    return wplan.ResolvedRange(lo, hi, None, "cover", None if lo else "all")


def _example_ids(ids: Any) -> list[str]:
    if not isinstance(ids, (list, tuple)) or not all(isinstance(i, str) for i in ids):
        raise PlanError(S_UNKNOWN_EXAMPLE)
    out = list(dict.fromkeys(ids))
    if len(out) > MAX_EXAMPLES:
        raise PlanError(S_TOO_MANY_EXAMPLES)
    return out


def run_examples(user_id: str, ids: list[str], *, now: datetime | None = None) -> dict:
    """Up to `MAX_EXAMPLES` shelf examples for the session member, in ONE batch:
    `{"sample": bool, "cards": {id: payload}}`.

    * Under `SAMPLE_BELOW` closed trades every card reads the sample book (`sample: True`), else the
      member's own rows.
    * ONE scan per distinct source (`sources.scan` over the widest range the cards need, no filters),
      every card then cut from that row set (`_narrow`) and evaluated on its own.
    * Counted as ONE preview: one admission in the `example` lane (a preview slot, no daily-cap run;
      ruling R-21, it neither bumps nor watches the preview generation), one deadline over the scans,
      one cache entry per member for `CACHE_TTL_S`, keyed on the ids, the sample switch and the
      member's data stamps, so the 5th closed trade turns the cards real at once.

    Raises `PlanError` (more than `MAX_EXAMPLES` ids, or an unknown id), `EngineBusy` or
    `EngineTooLong`."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a run needs the session member's id")
    wanted = _example_ids(ids)
    items = []
    for sid in wanted:
        ex = wshelf.example(sid)
        if ex is None:
            raise PlanError(S_UNKNOWN_EXAMPLE)
        items.append((sid, ex["plan"]))
    now = now or datetime.now(timezone.utc)
    srcs = list(dict.fromkeys(p["source"] for _sid, p in items))
    if not items:
        # Nothing to run: one count read, no permit, no scan, no cache entry (fix round 1, Minor 4).
        with _connection() as conn:
            with deadline(conn):
                return {"sample": wants_sample(conn, user_id), "cards": {}}

    # W9-R5: a card that reads routines or trackers is always the member's own rows, scanned for
    # that card alone (the sample book has none, and an item split changes the rows).
    own = {sid for sid, p in items if _never_sample(p)}
    real_today = nw._today_et(now)
    with _connection() as conn:
        with deadline(conn):
            sample = wants_sample(conn, user_id)
            tool_plan = {s: next((p for sid, p in items if p["source"] == s and sid in own), None)
                         for s in srcs}
            stamps = {s: data_stamp(conn, user_id, s, tool_plan[s]) for s in srcs
                      if not sample or tool_plan[s] is not None}
        today = sample_today() if sample else real_today
        blob = json.dumps([user_id, "examples", wanted, sample, stamps, today.isoformat(),
                           real_today.isoformat(), _book()["digest"] if sample else None],
                          sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        key = "widget_examples::" + hashlib.sha1(blob.encode("utf-8")).hexdigest()
        hit = _CACHE.get(key)
        if hit is not None:
            return copy.deepcopy(hit)

        def _compute() -> dict:
            per_src: dict[str, list[wplan.ResolvedRange]] = {}
            for sid, p in items:
                if sid in own:
                    continue
                rng = wplan.resolve_range(p["range"], today)
                per_src.setdefault(p["source"], []).append(rng)
                crng = _compare_range(p, rng, today)
                if crng is not None:
                    per_src[p["source"]].append(crng)
            with admit(user_id, "example"):
                covers: dict[str, wsources.Scan] = {}
                mine: dict[str, wsources.Scan] = {}
                if sample:
                    covers = {s: _sample_scan(s) for s in per_src}
                with deadline(conn):
                    if not sample:
                        for s in per_src:
                            covers[s] = wsources.scan(conn, _cover_plan(s), {"accountId": None},
                                                      _cover_range(per_src[s], today), user_id,
                                                      today=today)
                    for sid, p in items:
                        if sid not in own:
                            continue
                        rng = wplan.resolve_range(p["range"], real_today)
                        crng = _compare_range(p, rng, real_today)
                        mine[sid] = wsources.scan(
                            conn, p, {"accountId": None},
                            _cover_range([rng] + ([crng] if crng is not None else []), real_today),
                            user_id, today=real_today)
                cards = {sid: (_card(p, mine[sid], real_today, now, sample=False) if sid in own
                               else _card(p, covers[p["source"]], today, now, sample=sample))
                         for sid, p in items}
            out = {"sample": sample, "cards": cards}
            _CACHE.set(key, out, CACHE_TTL_S)
            return out

        ok, value = _FLIGHT.run_here(key, _compute, _WAIT_S)
        if not ok:
            value = _compute()
        return copy.deepcopy(value)
