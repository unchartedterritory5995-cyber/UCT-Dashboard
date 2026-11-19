"""ERNS, the Terminal's earnings season screen: one day's reporters in one answer.

For one day: who reports (before the open, after the close, time not confirmed), biggest
companies first, and for each one
  * the move options priced before the report (percent and dollars),
  * how the stock moved on its last few reports,
  * the result once it lands (earnings and revenue against what was expected) and the stock's move.

THE COST RULE. A busy night has 100+ reporters, so nothing here reads one stock at a time from a
provider, and NOTHING is built on a member's request:
  * who reports      the Calendar's own week (`api/routers/calendar.py`): this week's is kept warm
                     by the Calendar's re-warm loop; the week before and the week after come through
                     the Calendar's own single-flighted reader. Read on THIS module's background
                     thread, never on the request;
  * priced move      `implied_store.get_implied_rows_for_date`: what UCT's weekday capture stored
                     before the report, from UCT's own Massive option chain (rows are
                     `massive-chain` or `massive-backfill`; any other source is left out and
                     counted). ONE local SQLite read for the whole day. The Calendar's enrichment
                     batch is NOT read: its expected move comes from a yfinance option chain unless
                     a flag is set, and its past moves from yfinance prices;
  * past reports     `earnings_intel.get_earnings_held`: the close-to-close move of each past
                     report from UCT daily bars, as the Research Earnings tab and EXMV show it.
                     Only what UCT already HOLDS (memory, then the snapshot store the scheduled
                     panel prewarm fills). Never a build: a stock nobody has warmed has no past
                     moves here, and the answer counts how many do not;
  * the result       the calendar entry's own reported and expected figures; beat / miss / mixed
                     by the engine's one rule (`engine._build_earnings_entry`);
  * the move         a past day: the Calendar's own reactions answer, ONLY if the server already
                     holds it (working one out is one bars request per reporter). Today: the
                     regular-session change so far for the reports that came before the open, from
                     the answer the reactions route already holds, else ONE batch snapshot for all
                     of them (the same client call that route makes). A report after the close has
                     no move until the next close, by the Calendar's own rule, so none is given.

ONE BUILD PER DAY, OFF THE REQUEST (the house pattern, `api/services/scan_period.py`): a request
returns the held answer at once; with none it starts ONE background build, waits a few seconds
for it (a warm assembly is well under a second) and otherwise answers `computing`, and the panel
asks again. A finished answer is held in THIS module, never only in the shared 1,000-entry cache.
The last good answer is served, marked `refreshing`, while its replacement is built.

Reused by the Terminal panel (app/src/pages/terminal/panels/earningsSeasonModel.js); pure enough
for an Agent kind to call `get_day` and read the same answer.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

_log = logging.getLogger(__name__)

#: the calendar's session buckets, in the order the panel shows them
SESSIONS = ("bmo", "amc", "tbd")
#: how many calendar weeks either side of the one the Calendar shows this screen reaches
WEEKS_AROUND = 1
#: the chains a stored priced move may come from (UCT's own Massive option chain)
LICENSED_PRICED_SOURCES = ("massive-chain", "massive-backfill")
#: the most past reports listed per stock, newest first (earnings_reaction.DEFAULT_LIMIT)
PAST_MOVES_SHOWN = 8
#: a measured report this close to the day shown is taken to be that day's own report, not a past one
PAST_REPORT_MIN_GAP_DAYS = 20
#: how far ahead the bare command looks for a day with a reporter
DEFAULT_LOOKAHEAD_DAYS = 10
#: today's reports before the open get the session's change so far (one batch snapshot per build)
LIVE_MOVES_TODAY = True

FRESH_TODAY_S = 60.0          # today's answer: results land and the move is live
FRESH_OTHER_S = 300.0         # another day's answer
FAILED_S = 15.0               # a failed build is said briefly, then tried again
STALE_EXTRA_S = 900.0         # the last good answer may be served this long past its freshness
WAIT_S = 4.0                  # the longest a request waits on the build it started
KEEP = 12                     # days held
NEXT_KEY = "next"             # the bare command: the next day with a reporter

_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_lock = threading.Lock()
_done: dict[str, tuple[float, dict]] = {}       # key -> (fresh until, answer)
_old: dict[str, tuple[float, dict]] = {}        # key -> (servable until, last GOOD answer)
_inflight: dict[str, threading.Event] = {}      # key -> set when its build finishes

_EVENTS_HELD_S = 1800.0       # a stock's measured past reports change once a quarter
_EVENTS_MISS_S = 300.0        # a stock with none held is looked at again sooner (the prewarm may reach it)
_EVENTS_KEEP = 2000
_events_memo: dict[str, tuple[float, Optional[list], str]] = {}
_events_lock = threading.Lock()


# ── the readers (each one small, so a test can stand in for it) ──────────────────────────────

def today_et() -> date:
    from api.routers import calendar as route
    return route._today_et()


def week_window(today: date) -> tuple[date, date]:
    """(first, last) day this screen reaches: the Calendar's current week and WEEKS_AROUND either side."""
    from api.routers import calendar as route
    cur = route._current_week_monday(today)
    return cur - timedelta(days=7 * WEEKS_AROUND), cur + timedelta(days=7 * WEEKS_AROUND + 4)


def read_week(monday: date) -> Optional[dict]:
    """The calendar week that starts on `monday`, through the Calendar's own readers (fresh, else
    the last good week, else its single-flighted build). BACKGROUND THREAD ONLY."""
    from api.routers import calendar as route
    if monday == route._week_dates()[0]:
        return route._get_calendar_payload(None)
    return route._get_or_build_range_week(monday)


def read_priced(ds: str) -> dict[str, dict]:
    """{store symbol: capture row} for every priced move stored for `ds`. One local read. Raises on a bad store."""
    from api.services import implied_store
    return {str(r.get("sym") or ""): r for r in implied_store.get_implied_rows_for_date(ds)}


def priced_key(sym: str) -> str:
    from api.services import implied_store
    return implied_store.canonical_symbol(sym)


def read_held_intel(sym: str) -> Optional[dict]:
    """The earnings model UCT already holds for a stock, or None. Never a build, never a provider call."""
    from api.services import earnings_intel
    return earnings_intel.get_earnings_held(sym)


def read_held_moves(ds: str) -> Optional[dict]:
    """The reactions answer the Calendar route already holds for `ds`, or None. Never worked out here."""
    from api.routers import calendar as route
    hit = route.cache.get(f"calendar_reactions_{ds}")
    return hit if isinstance(hit, dict) else None


def read_live_moves(ds: str, syms: list[str]) -> dict:
    """Today's regular-session change so far for `syms`: the reactions route's own held answer when
    it has one, else ONE batch snapshot (the client call that route makes). Raises when it fails."""
    held = read_held_moves(ds)
    if held:
        return held
    from api.services.massive import _get_client
    return _get_client().get_batch_snapshots(list(syms)) or {}


def capture_time() -> dict:
    from api.services import implied_store
    return {"hour_et": implied_store.CAPTURE_HOUR_ET, "minute_et": implied_store.CAPTURE_MINUTE_ET}


# ── pure helpers ─────────────────────────────────────────────────────────────────────────────

def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _iso(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    if not _ISO_DAY.match(s):
        return None
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def _next_weekday(d: date) -> date:
    d = d + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def settled(report_day: str, today: str) -> bool:
    """Has the session AFTER a report day closed? Only then is its measured move the reaction
    (the EXMV panel's own rule, expectedMoveModel.js `settled`)."""
    day = _iso(report_day)
    if not day or not _iso(today):
        return False
    return _next_weekday(date.fromisoformat(day)).isoformat() < today


def verdict_of(entry: dict) -> Optional[str]:
    """'beat' | 'miss' | 'mixed', by the engine's one rule, or None (no result, or no estimate to
    set it against). Never restated here: the rule is `engine._build_earnings_entry`."""
    if _num(entry.get("eps_act")) is None or _num(entry.get("eps_est")) is None:
        return None
    try:
        from api.services.engine import _build_earnings_entry
        word = _build_earnings_entry({
            "symbol": entry.get("sym"),
            "eps_actual": _num(entry.get("eps_act")), "eps_estimate": _num(entry.get("eps_est")),
            "rev_actual": _num(entry.get("rev_act")), "rev_estimate": _num(entry.get("rev_est")),
        }).get("verdict")
    except Exception:  # noqa: BLE001 -- no verdict is honest; a guessed one is not
        return None
    return {"Beat": "beat", "Miss": "miss", "Mixed": "mixed"}.get(str(word))


def measured_events(intel: Any) -> tuple[Optional[list], str]:
    """(every measured past report as {date, pct}, newest first; state) from a held earnings model.
    state: 'ok' | 'not_held' (UCT holds no model for the stock) | 'not_measured' (a model is held
    and it carries no measured reports: fewer than four of the last eight could be measured)."""
    if not isinstance(intel, dict):
        return None, "not_held"
    reaction = intel.get("reaction")
    events = reaction.get("events") if isinstance(reaction, dict) else None
    if not isinstance(events, list):
        return None, "not_measured"
    seen: set[str] = set()
    out = []
    for e in events:
        if not isinstance(e, dict):
            continue
        day = _iso(e.get("report_date"))
        pct = _num(e.get("reaction_pct"))
        if not day or pct is None or day in seen:
            continue
        seen.add(day)
        out.append({"date": day, "pct": round(pct, 2)})
    if not out:
        return None, "not_measured"
    out.sort(key=lambda m: m["date"], reverse=True)
    return out, "ok"


def past_reports(events: Optional[list], state: str, ds: str, today: str) -> tuple[Optional[dict], str]:
    """The reports BEFORE the one on `ds`: ({moves, avg_abs, n}, 'ok'), or (None, why).
    A report within PAST_REPORT_MIN_GAP_DAYS of `ds` is that day's own; one whose next session has
    not closed is too recent to be a reaction. `avg_abs` is the average size of the moves listed."""
    if state != "ok" or not events:
        return None, state if state != "ok" else "not_measured"
    cutoff = (date.fromisoformat(ds) - timedelta(days=PAST_REPORT_MIN_GAP_DAYS)).isoformat()
    moves = [m for m in events if m["date"] <= cutoff and settled(m["date"], today)][:PAST_MOVES_SHOWN]
    if not moves:
        return None, "not_measured"
    avg = sum(abs(m["pct"]) for m in moves) / len(moves)
    return {"moves": moves, "avg_abs": round(avg, 2), "n": len(moves)}, "ok"


def _held_events(sym: str) -> tuple[Optional[list], str]:
    """`measured_events` of what UCT holds for `sym`, remembered a while so a day that is rebuilt
    every minute does not re-read a hundred stored models each time."""
    now = time.time()
    with _events_lock:
        hit = _events_memo.get(sym)
        if hit is not None and hit[0] > now:
            return hit[1], hit[2]
    try:
        events, state = measured_events(read_held_intel(sym))
    except Exception:  # noqa: BLE001 -- one unreadable stock is "not held", never a failed day
        events, state = None, "not_held"
    with _events_lock:
        if len(_events_memo) >= _EVENTS_KEEP:
            _events_memo.clear()
        _events_memo[sym] = (now + (_EVENTS_HELD_S if state == "ok" else _EVENTS_MISS_S), events, state)
    return events, state


def _priced_of(row: Optional[dict]) -> tuple[Optional[dict], bool]:
    """(the priced move to show, a row was withheld). A row from a chain this screen does not show,
    or without a positive percent, is withheld: never shown, never zero."""
    if not isinstance(row, dict):
        return None, False
    pct = _num(row.get("pct"))
    if row.get("source") not in LICENSED_PRICED_SOURCES or pct is None or pct <= 0:
        return None, True
    dollar = _num(row.get("dollar"))
    return {
        "pct": round(pct, 2),
        "dollar": round(dollar, 2) if dollar is not None and dollar > 0 else None,
        "captured_at": str(row.get("captured_at") or "") or None,
        "expiry": _iso(row.get("expiry")),
    }, False


def assemble_day(ds: str, today: str, day: dict, *, priced: Optional[dict], held_events,
                 moves: Optional[dict], moves_state: Optional[str], calendar_as_of: Optional[str] = None,
                 built_at: Optional[str] = None) -> dict:
    """Pure: one day's answer from what was read.
      day          the calendar's day dict ({bmo: [entry], amc: [...], tbd: [...]})
      priced       {store symbol: capture row}, or None when the store could not be read
      held_events  sym -> (measured past reports newest first | None, state)
      moves        {SYM: percent} or None; moves_state says what it is:
                   'live' (today, the session's change so far) | 'held' (a past day, the Calendar's
                   settled answer) | 'not_held' | 'failed' | None (nothing to measure yet)
    """
    day_kind = "today" if ds == today else "past" if ds < today else "future"
    by_sym = {str(k).strip().upper(): _num(v) for k, v in (moves or {}).items()}
    sessions: dict[str, list] = {s: [] for s in SESSIONS}
    seen: set[str] = set()
    counts = {"scheduled": 0, "reported": 0, "priced": 0, "priced_withheld": 0, "with_past": 0,
              "past_not_held": 0, "moved": 0}
    for session in SESSIONS:
        for e in day.get(session) or []:
            if not isinstance(e, dict):
                continue
            sym = str(e.get("sym") or "").strip().upper()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            counts["scheduled"] += 1
            reported = _num(e.get("eps_act")) is not None
            shown, withheld = _priced_of(priced.get(priced_key(sym)) if priced is not None else None)
            events, ev_state = held_events(sym)
            past, past_state = past_reports(events, ev_state, ds, today)
            move = None
            move_state = None
            if reported:
                counts["reported"] += 1
                if day_kind == "today" and session == "amc":
                    move_state = "next_close"          # measured at the next close, by the Calendar's rule
                elif moves_state in ("live", "held"):
                    move = by_sym.get(sym)
                    move_state = ("live" if moves_state == "live" else "settled") if move is not None else "none"
                else:
                    move_state = moves_state or "none"  # 'not_held' | 'failed' | nothing came back
            if shown:
                counts["priced"] += 1
            if withheld:
                counts["priced_withheld"] += 1
            if past:
                counts["with_past"] += 1
            if past_state == "not_held":
                counts["past_not_held"] += 1
            if move is not None:
                counts["moved"] += 1
            sessions[session].append({
                "sym": sym,
                "name": str(e.get("name") or "").strip() or None,
                "session": session,
                "mc_b": _num(e.get("mc_b")),
                "ew": _num(e.get("ew")),
                "eps_est": _num(e.get("eps_est")), "eps_act": _num(e.get("eps_act")),
                "rev_est": _num(e.get("rev_est")), "rev_act": _num(e.get("rev_act")),
                "reported": reported,
                "verdict": verdict_of(e) if reported else None,
                "priced": shown,
                "past": past, "past_state": past_state,
                "move": round(move, 2) if move is not None else None,
                "move_state": move_state,
            })
    for rows in sessions.values():
        # biggest company first (the Calendar's own first-paint order: market cap, then its
        # anticipation rank, then the symbol); a company with no market cap on file goes last
        rows.sort(key=lambda r: (r["mc_b"] is None, -(r["mc_b"] or 0.0), -(r["ew"] or 0.0), r["sym"]))
        for r in rows:
            r.pop("ew", None)
    return {
        "status": "ok",
        "date": ds,
        "today": today,
        "day_kind": day_kind,
        "sessions": sessions,
        "counts": counts,
        "priced_state": "read" if priced is not None else "failed",
        "moves_state": moves_state if counts["reported"] else None,
        "calendar_as_of": calendar_as_of,
        "built_at": built_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "capture": capture_time(),
    }


# ── the build (background thread only) ───────────────────────────────────────────────────────

def _day_of(week: Any, ds: str) -> tuple[Optional[dict], str]:
    """(the day dict, state): 'ok' | 'no_day' (the week was read and has no such day) |
    'unavailable' (the week could not be read: never the same as nobody reporting)."""
    # "empty" (this week) and "range_error..." (another week) are a failed provider read, which the
    # Calendar itself never keeps as a good week; "range_empty" is a week that really has nobody.
    source = str(week.get("source") or "") if isinstance(week, dict) else "error"
    if source in ("error", "out_of_range", "empty") or source.startswith("range_error"):
        return None, "unavailable"
    days = week.get("days")
    if not isinstance(days, dict) or not days:
        return None, "unavailable"
    day = days.get(ds)
    return (day, "ok") if isinstance(day, dict) else (None, "no_day")


def _has_reporter(day: Optional[dict]) -> bool:
    return bool(day) and any(day.get(s) for s in SESSIONS)


def build_day(date_str: Optional[str]) -> dict:
    """One day's answer, read from everything named in the module docstring. With no date: the
    first day from today on that has a reporter (`default: true`); none within reach is today."""
    from api.routers import calendar as route
    today_d = today_et()
    today = today_d.isoformat()
    first, last = week_window(today_d)
    span = {"from": first.isoformat(), "to": last.isoformat()}
    weeks: dict[date, Any] = {}

    def week_of(d: date):
        monday = route._monday_of(d)
        if monday not in weeks:
            try:
                weeks[monday] = read_week(monday)
            except Exception as exc:  # noqa: BLE001 -- an unreadable week is said, never "nobody reports"
                _log.warning("[earnings-season] calendar week %s could not be read: %s", monday, type(exc).__name__)
                weeks[monday] = None
        return weeks[monday]

    is_default = date_str is None
    if is_default:
        ds = None
        for i in range(DEFAULT_LOOKAHEAD_DAYS + 1):
            d = today_d + timedelta(days=i)
            if d.weekday() >= 5 or d > last:
                continue
            day, state = _day_of(week_of(d), d.isoformat())
            if state == "unavailable":
                return {"status": "unavailable", "reason": "calendar", "date": None, "today": today,
                        "default": True, "range": span}
            if _has_reporter(day):
                ds = d.isoformat()
                break
        if ds is None:
            ds = today
    else:
        ds = date_str
    d = date.fromisoformat(ds)
    base = {"date": ds, "today": today, "default": is_default, "range": span}
    if d.weekday() >= 5:
        # no company reports on a weekend, so no calendar week is read (or built) to say so
        return {"status": "no_day", "weekend": True, **base}
    week = week_of(d)
    day, state = _day_of(week, ds)
    if state == "unavailable":
        return {"status": "unavailable", "reason": "calendar", **base}
    if state == "no_day":
        return {"status": "no_day", "weekend": False, **base}

    try:
        priced: Optional[dict] = read_priced(ds)
    except Exception as exc:  # noqa: BLE001 -- said as "could not be read", never as "none priced"
        _log.warning("[earnings-season] priced moves for %s could not be read: %s", ds, type(exc).__name__)
        priced = None

    moves: Optional[dict] = None
    moves_state: Optional[str] = None
    if ds < today:
        try:
            moves = read_held_moves(ds)
            moves_state = "held" if moves is not None else "not_held"
        except Exception:  # noqa: BLE001
            moves, moves_state = None, "failed"
    elif ds == today and LIVE_MOVES_TODAY:
        live = [str(e.get("sym") or "").strip().upper() for s in ("bmo", "tbd") for e in (day.get(s) or [])
                if isinstance(e, dict) and e.get("sym") and _num(e.get("eps_act")) is not None]
        if live:
            try:
                moves, moves_state = read_live_moves(ds, live), "live"
            except Exception as exc:  # noqa: BLE001
                _log.warning("[earnings-season] today's moves could not be read: %s", type(exc).__name__)
                moves, moves_state = None, "failed"

    out = assemble_day(ds, today, day, priced=priced, held_events=_held_events, moves=moves,
                       moves_state=moves_state,
                       calendar_as_of=str(week.get("as_of")) if isinstance(week, dict) and week.get("as_of") else None)
    return {**out, "default": is_default, "range": span}


# ── one build per day, off the request ───────────────────────────────────────────────────────

def _remember(key: str, out: dict, ttl: float) -> None:
    now = time.time()
    with _lock:
        _done[key] = (now + ttl, out)
        for k in [k for k, (exp, _o) in _done.items() if exp <= now]:
            _done.pop(k, None)
        while len(_done) > KEEP:
            _done.pop(min(_done, key=lambda k: _done[k][0]), None)
        if out.get("status") == "ok":
            _old[key] = (now + ttl + STALE_EXTRA_S, out)
            for k in [k for k, (until, _o) in _old.items() if until <= now]:
                _old.pop(k, None)
            while len(_old) > KEEP:
                _old.pop(min(_old, key=lambda k: _old[k][0]), None)


def _answer(key: str) -> Optional[dict]:
    with _lock:
        hit = _done.get(key)
        if hit is None:
            return None
        if hit[0] <= time.time():
            _done.pop(key, None)
            return None
        return hit[1]


def _old_answer(key: str) -> Optional[dict]:
    with _lock:
        hit = _old.get(key)
        if hit is None:
            return None
        if hit[0] <= time.time():
            _old.pop(key, None)
            return None
        return {**hit[1], "refreshing": True}


def _build_bg(key: str, date_str: Optional[str], done: threading.Event) -> None:
    started = time.time()
    outcome = "running"
    try:
        out = build_day(date_str)
        ok = out.get("status") == "ok"
        ttl = (FRESH_TODAY_S if out.get("day_kind") == "today" else FRESH_OTHER_S) if ok else FAILED_S
        if out.get("status") == "no_day":
            ttl = FRESH_OTHER_S
        _remember(key, out, ttl)
        if key == NEXT_KEY and ok and out.get("date"):
            # the same day asked for by its date is the same answer, without the "default" mark
            _remember(str(out["date"]), {**out, "default": False}, ttl)
        outcome = str(out.get("status"))
    except Exception as exc:  # noqa: BLE001 -- a failed build is said, never left as "computing" for ever
        outcome = f"failed: {type(exc).__name__}"
        _remember(key, {"status": "unavailable", "reason": "build", "date": date_str, "default": date_str is None}, FAILED_S)
    finally:
        _log.info("[earnings-season] build of %s: %s in %.2fs", key, outcome, time.time() - started)
        with _lock:
            _inflight.pop(key, None)
        done.set()


def held_day(date_str: Optional[str] = None) -> tuple[Optional[dict], str]:
    """READ ONLY: what this module already HOLDS for one day (or for the next day with a reporter
    when none is given), as `(answer, how)`. It NEVER starts the background build and never waits
    on one, so a caller that must not cause work (the Agent's `earnings.season` kind, inside a
    turn) reads through here and never through `get_day`.

      (answer, 'fresh')       the held answer, inside its freshness: an `ok` day, or what a build
                              stored in its place (`no_day`, or `unavailable` for a few seconds)
      (answer, 'last_good')   the last good answer, past its freshness and still servable. It is
                              NOT marked `refreshing`: this read starts no build to replace it
      (None, 'not_held')      nothing is held for the day
      (answer, 'refused')     `bad_date` or `out_of_range`, by the same checks as `get_day`
    """
    if date_str is not None:
        ds = _iso(date_str) if isinstance(date_str, str) and _ISO_DAY.match(date_str) else None
        if ds is None:
            return {"status": "bad_date", "date": None}, "refused"
        today_d = today_et()
        first, last = week_window(today_d)
        if not first <= date.fromisoformat(ds) <= last:
            return {"status": "out_of_range", "date": ds, "today": today_d.isoformat(),
                    "range": {"from": first.isoformat(), "to": last.isoformat()}}, "refused"
        date_str = ds
    key = date_str or NEXT_KEY
    held = _answer(key)
    if held is not None and held.get("status") == "ok":
        return held, "fresh"
    with _lock:
        old = _old.get(key)
        if old is not None and old[0] <= time.time():
            _old.pop(key, None)
            old = None
    if old is not None:
        # a failed rebuild is held for a few seconds; the last good answer is worth more
        return old[1], "last_good"
    if held is not None:
        return held, "fresh"
    return None, "not_held"


def get_day(date_str: Optional[str] = None, *, wait_s: Optional[float] = None) -> dict:
    """The answer for one day (`YYYY-MM-DD`), or for the next day with a reporter when none is
    given. NEVER builds on the caller's thread: the held answer, else the last good one marked
    `refreshing`, else a short wait on the one background build, else `{"status": "computing"}`.

    status: 'ok' | 'computing' | 'no_day' (a weekend, or a day the calendar week does not carry) |
            'unavailable' (the calendar could not be read: not the same as nobody reporting) |
            'out_of_range' | 'bad_date'
    """
    if date_str is not None:
        ds = _iso(date_str) if isinstance(date_str, str) and _ISO_DAY.match(date_str) else None
        if ds is None:
            return {"status": "bad_date", "date": None}
        today_d = today_et()
        first, last = week_window(today_d)
        if not first <= date.fromisoformat(ds) <= last:
            return {"status": "out_of_range", "date": ds, "today": today_d.isoformat(),
                    "range": {"from": first.isoformat(), "to": last.isoformat()}}
        date_str = ds
    key = date_str or NEXT_KEY
    held = _answer(key)
    if held is not None and held.get("status") == "ok":
        return held
    old = _old_answer(key)
    if held is not None:
        # a failed rebuild is held for a few seconds; the last good answer is worth more
        return old if old is not None else held
    with _lock:
        done = _inflight.get(key)
        if done is None:
            done = _inflight[key] = threading.Event()
            threading.Thread(target=_build_bg, args=(key, date_str, done), daemon=True,
                             name="earnings-season-build").start()
    if old is not None:
        return old                                   # at once; the build replaces it for the next read
    done.wait(WAIT_S if wait_s is None else wait_s)
    held = _answer(key)
    if held is not None:
        return held
    return {"status": "computing", "date": date_str, "default": date_str is None}

