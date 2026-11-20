"""Seasonality board: the four index funds and the eleven sector funds, month by month.

`SEAS` shows ONE stock's record by calendar month. This is the market's: for each fund, how each
calendar month has gone, close to close, from the daily bars this pod already holds. Every number
comes from `api.services.seasonality.compute` over the same daily read the single-stock route
makes (`api.routers.seasonality._daily_bars`), so the two can never disagree about a fund.

Honesty rules (the single-stock module's rules, plus the ones a board adds):
  * a fund without numbers is LISTED with its reason, never dropped and never a row of zeros.
    The reasons are `pending` (the full history is still being read), `not_held` (the bar store
    carries no bars for it) and `unavailable` (the read failed, with the serve's own reason);
  * a fund whose read is still partial is `pending`: a table from a shallow read would state a
    short record as THE record (the single-stock route refuses it for the same reason);
  * each fund carries its own covered window, so a fund listed in 2018 is never read as if it
    went back as far as one listed in 1998;
  * `this_month` and `next_month` are by the New York date, never the server's own clock.

Cost. Fifteen 8,000-bar reads are too heavy to repeat on every request, so ONE answer is held in
this module, keyed by the New York date:
  * a settled answer (no fund still pending or failed) is reused for the rest of that day;
  * an answer with a fund pending or failed is reused for INCOMPLETE_REUSE_S only, so it heals;
  * one build at a time: a second caller waits for the build in flight (at most BUILD_WAIT_S)
    and gets the same answer.
It is deliberately NOT in the shared `cache`: that is a 1,000-entry LRU a busy pod turns over in
minutes, so an answer parked there is gone before the next reader arrives (see the comment on
`_REUSE_MEM` in `api/services/scan_period.py`).

Never raises: a fund that throws is `unavailable` with the exception's class name.
"""
from __future__ import annotations

import threading
import time
from datetime import date, datetime

from api.services import seasonality as svc
from api.services import session_calendar
from api.services.sector_strength import SECTOR_ETFS

SOURCE = "UCT daily bar store, close to close"

# The index funds, in the order the board lists them. The sector funds are NOT typed here: they
# come from `sector_strength.SECTOR_ETFS`, the one list of them in this codebase.
INDEX_FUNDS = (("SPY", "S&P 500"), ("QQQ", "Nasdaq 100"), ("IWM", "Russell 2000"), ("DIA", "Dow 30"))

OK = "ok"
PENDING = "pending"
NOT_HELD = "not_held"
UNAVAILABLE = "unavailable"

# Two `unavailable` reasons this module words itself (the others are the serve's own, or the
# class name of whatever was thrown).
TOO_SHORT = "too_short"      # bars are held, but not one full calendar month of them
EMPTY_READ = "empty_read"    # the serve answered 200 with no bars and did not say "not carried"

# An answer with a fund pending or failed is reused this long, then rebuilt. A minute is long
# enough that a board on several screens costs one build, and short enough that a cold start
# (every fund pending) fills in while the member is still looking at it.
INCOMPLETE_REUSE_S = 60.0
# How long a second caller waits for the build in flight. Half the client's 30 second read
# deadline: a waiter that runs out is answered (with what is held, or every fund pending) well
# before its own request would be given up on.
BUILD_WAIT_S = 15.0

_MONTH_KEYS = ("month", "label", "n", "avg_pct", "median_pct", "pct_up", "thin")


# ── pure helpers (no bars, no clock) ─────────────────────────────────────────────────────────

def funds() -> list[dict]:
    """The board's rows, in order: the index funds, then the sector funds."""
    rows = [{"symbol": sym, "name": name, "kind": "index"} for sym, name in INDEX_FUNDS]
    rows += [{"symbol": sym, "name": name, "kind": "sector"} for name, sym in SECTOR_ETFS.items()]
    return rows


def month_fields(today: date) -> dict:
    """The calendar month of `today` and the one after it (December is followed by January)."""
    return {"this_month": today.month, "next_month": today.month % 12 + 1}


def fund_without(fund: dict, status: str, reason: str | None = None) -> dict:
    """A fund with no numbers: listed with why, and no months at all (never zeros)."""
    return {"symbol": fund["symbol"], "name": fund["name"], "kind": fund["kind"],
            "status": status, "reason": reason}


def fund_row(fund: dict, computed: dict) -> dict:
    """A fund from `seasonality.compute`'s answer: its twelve months and the window they cover.

    A read with not one full calendar month in it has nothing to show: it is `unavailable`
    (too_short), never twelve empty cells."""
    months = computed.get("months") if isinstance(computed, dict) else None
    full = int((computed or {}).get("full_months") or 0) if isinstance(computed, dict) else 0
    if not isinstance(months, list) or len(months) != 12 or full <= 0:
        return fund_without(fund, UNAVAILABLE, TOO_SHORT)
    return {"symbol": fund["symbol"], "name": fund["name"], "kind": fund["kind"], "status": OK,
            "months": [{k: m.get(k) for k in _MONTH_KEYS} for m in months],
            "covered_from": computed.get("covered_from"), "covered_to": computed.get("covered_to"),
            "full_months": full}


def heals(row: dict) -> bool:
    """True when asking again soon could give this fund numbers: its history is still being
    read, or the read failed. A fund the store does not carry, or holds too little of, does
    not change within the day."""
    status = row.get("status")
    if status == PENDING:
        return True
    return status == UNAVAILABLE and row.get("reason") != TOO_SHORT


def assemble(rows: list[dict], today: date, as_of: str) -> dict:
    """The board from its fund rows. `complete` is true only when every fund has numbers;
    `settled` is true when nothing in it is expected to change today (so nothing re-asks)."""
    through = [r["covered_to"] for r in rows if r.get("status") == OK and r.get("covered_to")]
    return {
        "funds": rows,
        **month_fields(today),
        "et_date": today.isoformat(),
        "min_years": svc.MIN_YEARS,
        "source": SOURCE,
        "as_of": as_of,
        "data_through": max(through) if through else None,
        "complete": bool(rows) and all(r.get("status") == OK for r in rows),
        "settled": not any(heals(r) for r in rows),
    }


def reusable(held: tuple | None, today: date, now: float) -> dict | None:
    """The held answer when it may still be served, else None. `held` is
    `(new_york_date, monotonic_seconds_when_built, answer)`."""
    if not held:
        return None
    day, built, answer = held
    if day != today:
        return None
    if answer.get("settled"):
        return answer
    return answer if 0 <= (now - built) < INCOMPLETE_REUSE_S else None


# ── the read ─────────────────────────────────────────────────────────────────────────────────

def _now_et() -> datetime:
    return datetime.now(session_calendar.ET)


def _clock() -> float:
    return time.monotonic()


def read_fund(fund: dict) -> dict:
    """One fund's row. Never raises: whatever goes wrong is that fund's stated reason."""
    try:
        # Imported here, not at the top: the router pulls in FastAPI and the auth middleware, and
        # this is its own `_daily_bars` (never a copy), so a test that stands in for it is seen.
        from api.routers import seasonality as route
        try:
            bars = route._daily_bars(fund["symbol"])
        except route.HistoryPending:
            return fund_without(fund, PENDING)
        except route.NoDailyHistory:
            return fund_without(fund, NOT_HELD)
        except route.BarsUnavailable as e:
            return fund_without(fund, UNAVAILABLE, str(e) or "BarsUnavailable")
        if not bars:
            return fund_without(fund, UNAVAILABLE, EMPTY_READ)
        return fund_row(fund, svc.compute(bars))
    except Exception as e:  # noqa: BLE001 -- one fund never stops the others, or the request
        return fund_without(fund, UNAVAILABLE, type(e).__name__)


def build(today: date | None = None) -> dict:
    """Read every fund now and return the board. Heavy (fifteen daily reads): the route calls
    `serve`, which holds the answer. Never raises."""
    now = _now_et()
    day = today or now.date()
    return assemble([read_fund(f) for f in funds()], day, now.isoformat(timespec="seconds"))


def placeholder(today: date) -> dict:
    """Every fund pending. What a caller gets when a build is still running after BUILD_WAIT_S
    and nothing is held for today: the truth (it is being read), and the panel asks again."""
    board = assemble([fund_without(f, PENDING) for f in funds()], today, _now_et().isoformat(timespec="seconds"))
    board["building"] = True
    return board


# ── the one held answer ──────────────────────────────────────────────────────────────────────

_held: tuple | None = None            # (new_york_date, monotonic_seconds_when_built, answer)
_build_lock = threading.Lock()


def reset() -> None:
    """Forget the held answer (tests)."""
    global _held
    _held = None


def serve(today: date | None = None) -> dict:
    """The board for the route: the held answer while it may be reused, else one build."""
    global _held
    day = today or _now_et().date()
    hit = reusable(_held, day, _clock())
    if hit is not None:
        return hit
    if not _build_lock.acquire(timeout=BUILD_WAIT_S):
        held = _held
        return held[2] if held and held[0] == day else placeholder(day)
    try:
        hit = reusable(_held, day, _clock())      # the build this caller waited for
        if hit is not None:
            return hit
        answer = build(day)
        _held = (day, _clock(), answer)
        return answer
    finally:
        _build_lock.release()
