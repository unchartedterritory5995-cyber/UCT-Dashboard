"""Notebook widgets wave 10 (Task 10.10): the ready-made discipline widgets, computed on the server.

Four builders, each `(user_id: str, params: dict, now: datetime) -> dict`:

  * `my_tilt_check` (`myTiltCheck`, "Tilt check"): trades entered within `TILT_WINDOW_MIN` minutes
    after ANY losing exit (any symbol, across midnight too) against every other timed trade.
  * `my_revenge_clean_days` (`myRevengeClean`, "Revenge trades"): of the last `WINDOW` finished
    sessions, how many had no revenge re-entry (`revenge_detect.detect`, ruling W10-R12).
  * `my_risk_left_today` (`myRiskLeftToday`, "Risk left today"): per account with a daily loss
    limit and an own size, the room left today (W10-R9) and the open risk to stops
    (`portfolio_heat`, the phase 1 positions authority), plus the positions not linked to any of
    the member's accounts (W10-R32, W10-R34) and the total.
  * `my_prop_firm` (`myPropFirm`, "Prop-firm rules"): a daily loss limit and a trailing max drawdown
    the member types, over the trading-days source scan's day nets (W10-R9).

Every payload carries `asOf`, `source` ("broker" / "manual" / "mixed") and `lines`, the member's
sentences in order. An unknown value is None, never 0, and no string shows `0`, `$0`, `0%`,
`"0 of"` or `"(0)"` where the honest answer is "none yet" (W9-R7): each empty state has its own
sentence below.

The facts each figure follows:
  * Only the session member's rows (`user_id = ?` on every read); an account id in the params that
    is not the member's reads as all their accounts, with `run.S_ACCOUNT_GONE`.
  * Days are ET days: `trading_day_et` when stamped, else the exit's calendar date (`filters._DAY`,
    the analytics rule); `trading_days.today_et(now)` is today. A day that is not a session is
    counted on the session before, the trading-days scan's own fold.
  * Flagged trades (ruling W10-R33): Tilt check and Revenge trades leave every flagged trade out.
    Room left today and Prop-firm rules are money: they count a trade the member excluded from
    analytics by hand (`analytics_excluded_reason` 'manual', or no reason recorded) and say so;
    only a trade flagged as a data error (any other reason, e.g. 'phantom_short') stays out.
  * A trade whose position carries an estimated entry date is never timed (its entry is a guess);
    neither is an option strategy whose close is the noon anchor of a date-only or expired close
    (`options.exit_is_date_only`).
  * Closed option strategies count (day net "incl. options", ruling W9-R22); an open one is not in
    any figure, and Risk left today says how many are not in the open risk. A closed strategy with
    no P&L recorded is "no result": never a breakeven, left out of the counts, and said so.
  * A broker placeholder stop (`stop_price == entry_price`, `placeholder_stop`) is never counted as
    zero risk: `portfolio_heat` leaves it out of the open risk and this module says how many.
  * The note tables are never read here, so sample notes cannot feed a number
    (`sample_marker`; nothing to filter).

Bounded work (W9-R17): every read is `LIMIT READ_LIMIT` (5001) on the indexed day order and keeps
5,000; an overflow is stated (Tilt check) or leaves the unread days "not checked" (Revenge trades),
never clean. At most `MAX_SESSIONS` sessions; every Python loop over rows asks `_check()` every
`CHECK_EVERY` rows, each revenge bucket asks it too and is capped at `MAX_BUCKET` rows; each builder
runs its SQL and loops under `run.deadline` (`run.EngineTooLong` past it).

Refusals are `ParamError`, a `tool_errors.ToolError` carrying status and code (ruling W9-R14). It lives
in `shelf_kinds` (Task 10.12) and is imported at the END of this file (see `shelf_kinds`' IMPORT ORDER note).

Names taken from other modules are their public names (Task 10.12): `filters.DAY_SQL`, `notebook_widgets.iso_utc`
/ `num` / `origin`, `widget_definitions.read_conn`, bound here under their old local names. One private reach is
left, railed as a countdown in `tests/test_shelf_widgets_router.py`: `widget_engine.run._cover_plan` (that module
was out of 10.12's scope). Read only: `widget_engine.sources.scan_days`, `owned_account_id`.
"""
from __future__ import annotations

import bisect
import math
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable

from api.services import session_calendar
from api.services.journal_two import accounts, options, revenge_detect, trading_days
from api.services.journal_two import widget_definitions
from api.services.journal_two.filters import DAY_SQL as _DAY
from api.services.journal_two.measures import DEFAULT_MIN_N, MEASURES, SMALL_SAMPLE_N
from api.services.journal_two.notebook_widgets import iso_utc as _iso_utc, num as _num, origin as _origin
from api.services.journal_two.routine_insights import money
from api.services.journal_two.timeutil import compute_trading_day_et
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.journal_two.widget_definitions import read_conn as _read
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import plan as wplan

# -- constants (Task 10.10 brief, verbatim) ---------------------------------------------------------

CAVEAT = "A comparison, not proof."
S_NOT_ENOUGH = "Not enough trades yet ({n})"
TILT_WINDOW_MIN = 30
WINDOW = 30
#: Rows in any one payload list.
ROW_CAP = 40
#: Every Python loop over rows asks the run's budget every this many rows.
CHECK_EVERY = 256
#: Under this many trades a group's win rate and average are not shown (the measures' own minimum).
MIN_N = DEFAULT_MIN_N
#: At most this many sessions are read (the trading-days source's own cap).
MAX_SESSIONS = 3700
#: Every read is bounded by this LIMIT; one row fewer is kept, the last one only says "there is
#: more" (read at call time, so a test can lower it).
READ_LIMIT = wcompile.SCAN_LIMIT
#: `revenge_detect.detect` is quadratic: a symbol-and-day bucket larger than this is not run and
#: its days are "not checked", said so.
MAX_BUCKET = 400
#: The revenge rule's own window (revenge_detect.detect's default), for the older-exit lookup.
REVENGE_WINDOW_MIN = 60
AMOUNT_MAX = 10_000_000.0

KIND_TILT = "myTiltCheck"
KIND_REVENGE = "myRevengeClean"
KIND_RISK_LEFT = "myRiskLeftToday"
KIND_PROP_FIRM = "myPropFirm"
TITLES = {
    KIND_TILT: "Tilt check",
    KIND_REVENGE: "Revenge trades",
    KIND_RISK_LEFT: "Risk left today",
    KIND_PROP_FIRM: "Prop-firm rules",
}
PARAMS = {
    KIND_TILT: ("from", "to"),
    KIND_REVENGE: (),
    KIND_RISK_LEFT: (),
    KIND_PROP_FIRM: ("dailyLoss", "maxDrawdown", "since", "accountId"),
}
#: Risk left today shows account names (an account kind; never on a public page).
ACCOUNT_KINDS = frozenset({KIND_RISK_LEFT, KIND_PROP_FIRM})

# -- member sentences -------------------------------------------------------------------------------

S_BAD_DATE = wplan.S_BAD_DATE                       # "Dates need to look like 2026-10-24."
S_AMOUNT_LOW = "Enter an amount above $0."
S_AMOUNT_HIGH = "An amount can be at most $10,000,000."
S_START_AFTER_END = wplan.S_START_AFTER_END         # "The start date is after the end date."

S_TILT_NO_TRADES = "No closed trades in this range."
S_TILT_NO_TIMES = "Tilt check needs entry and exit times; your trades have dates only."
S_TILT_ESTIMATED = "Tilt check needs real entry times; your entries are estimated."
S_TILT_AFTER = "Within 30 min after a loss"
S_TILT_OTHER = "Other trades"

S_REVENGE_NO_TRADES = "No trades in the last 30 trading days."
S_REVENGE_EVERY_DAY = "Revenge re-entries on every checked day in the last 30 trading days."
S_REVENGE_NONE_CHECKED = ("None of the last 30 trading days could be checked; "
                          "your trades have dates only.")

S_RISK_NO_LIMIT = "Set a daily loss limit in your account settings to see room left."
S_RISK_NO_SIZE = "Set your account size to turn your daily loss limit into dollars."
S_RISK_NO_POSITIONS = "No open positions."
S_RISK_NONE_HERE = "This account holds nothing open."
S_RISK_UNREAD = "Your open positions couldn't be read right now."
S_RISK_UNATTRIBUTED = "Some of today's trades have no account and are not counted."
UNLINKED_NAME = "Not linked to an account"

S_PROP_MISSING = "Enter your daily loss limit and max drawdown to see room left."
S_PAST_DAILY = "Past your daily loss limit by {x}."
S_PAST_DRAWDOWN = "Past your max drawdown by {x}."

MINUS = "−"
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
#: `filters._DAY` for the `t` alias (derived, never restated).
_DAY_T = _DAY.replace("trading_day_et", "t.trading_day_et").replace("exit_date", "t.exit_date")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
#: A flagged trade a money widget still counts (W10-R33): excluded by hand, or no reason recorded.
_COUNTED_FLAG = ("t.analytics_excluded = 1 AND (t.analytics_excluded_reason IS NULL"
                 " OR t.analytics_excluded_reason = 'manual')")


def _s_account_gone() -> str:
    """`run.S_ACCOUNT_GONE` (one authority; imported late: run.py imports the whole engine)."""
    from api.services.journal_two.widget_engine import run as wrun
    return wrun.S_ACCOUNT_GONE


def _s_unknown_kind() -> str:
    return widget_definitions.S_NOT_FOUND


# -- the budget -------------------------------------------------------------------------------------

def _check() -> None:
    """The run's budget: raises `ScanTooLong` past `run.deadline` (turned into `EngineTooLong`)."""
    wcompile.check_deadline()


def _counted(rows, every: int = CHECK_EVERY):
    """Iterate `rows`, asking the budget every `every` rows (the first row included)."""
    for i, r in enumerate(rows):
        if i % every == 0:
            _check()
        yield r


def _deadline(conn: sqlite3.Connection):
    """`run.deadline` on `conn` (imported late: run.py imports the whole widget engine)."""
    from api.services.journal_two.widget_engine import run as wrun
    return wrun.deadline(conn)


# -- small helpers ----------------------------------------------------------------------------------

def _utc(now: datetime | None) -> datetime:
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _whole(v: float) -> int:
    """Whole dollars, half up, of |v|."""
    return int(Decimal(repr(abs(v))).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _dollars(v: float) -> str:
    """An unsigned amount: "$300", "$1,250" (money words, `routine_insights.money`)."""
    return money(abs(v)).lstrip("+")


def _pct(v: float) -> str:
    return f"{int(Decimal(repr(v * 100)).quantize(Decimal(1), rounding=ROUND_HALF_UP))}%"


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _is_are(n: int) -> str:
    return "is" if n == 1 else "are"


def _day_label(d: date, today: date | None = None) -> str:
    s = f"{_MONTHS[d.month - 1]} {d.day}"
    return s if today is not None and d.year == today.year else f"{s}, {d.year}"


def _sample(n: int) -> str:
    if n < MIN_N:
        return "hide"
    if n < SMALL_SAMPLE_N:
        return "small"
    return ""


def _net_result(pnl: Any, result: Any) -> tuple[float, str]:
    net = _num(pnl) or 0.0
    if result in ("Win", "Loss", "BE"):
        return net, result
    return net, ("Win" if net > 0 else "Loss" if net < 0 else "BE")


def _marks(xs) -> str:
    return ",".join("?" for _ in xs)


def _session_of(day: str) -> str:
    """The session a day is counted on: itself, or the session before (the trading-days scan's
    fold, `sources.scan_days`), so a flag's day is always a counted day."""
    try:
        return trading_days.session_on_or_before(date.fromisoformat(day[:10])).isoformat()
    except ValueError:
        return day


# -- params -----------------------------------------------------------------------------------------

def _clean_day(v: Any) -> str | None:
    if v is None or v == "":
        return None
    if not isinstance(v, str) or not _DATE_RE.fullmatch(v):
        raise ParamError(S_BAD_DATE)
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ParamError(S_BAD_DATE) from None
    return v


def _clean_amount(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ParamError(S_AMOUNT_LOW)
    f = float(v)
    if f != f or f <= 0:
        raise ParamError(S_AMOUNT_LOW)
    if f > AMOUNT_MAX:
        raise ParamError(S_AMOUNT_HIGH)
    return f


def clean_params(kind: str, raw: Any) -> dict:
    """The params a widget of `kind` keeps (`PARAMS`), checked; unknown keys are dropped and an
    empty value is absent. Refusals are `ParamError` with a member sentence."""
    if kind not in PARAMS:
        raise ParamError(_s_unknown_kind())
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for key in PARAMS[kind]:
        v = src.get(key)
        if key in ("from", "to", "since"):
            v = _clean_day(v)
        elif key in ("dailyLoss", "maxDrawdown"):
            v = _clean_amount(v)
        elif key == "accountId":
            v = v if isinstance(v, str) and v and len(v) <= wplan.MAX_TEXT else None
        if v is not None:
            out[key] = v
    if "from" in out and "to" in out and out["from"] > out["to"]:
        raise ParamError(S_START_AFTER_END)
    return out


# -- reads ------------------------------------------------------------------------------------------

def _capped(rows: list) -> tuple[list, str | None]:
    """(the rows kept, the day the read was cut at): a read returns at most `READ_LIMIT` rows and
    keeps one fewer. On an overflow every day on or before the cut day is not fully read."""
    limit = READ_LIMIT
    if len(rows) < limit:
        return rows, None
    return rows[:limit - 1], rows[limit - 1]["day"]


def _equity_rows(c: sqlite3.Connection, user_id: str, lo: str, hi: str,
                 account: str | None = None) -> tuple[list[dict], str | None]:
    """The member's closed equity trades whose ET day is in [lo, hi], flagged ones left out, newest
    first, and the cut day of an overflowing read. `est` is the position's estimated-entry flag."""
    sql = ("SELECT t.id, t.symbol, t.entry_date, t.exit_date, t.pnl_dollar,"
           " COALESCE(t.fees, 0) AS fees, t.result, t.source, t.external_id, t.account_id,"
           f" COALESCE(p.entry_estimated, 0) AS est, {_DAY_T} AS day"
           " FROM j2_trades t LEFT JOIN j2_positions p"
           " ON p.id = t.position_id AND p.user_id = t.user_id"
           " WHERE t.user_id = ? AND (t.analytics_excluded IS NULL OR t.analytics_excluded = 0)"
           f" AND {_DAY_T} BETWEEN ? AND ?")
    params: list = [user_id, lo, hi]
    if account is not None:
        sql += " AND t.account_id = ?"
        params.append(account)
    sql += f" ORDER BY {_DAY_T} DESC, t.id DESC LIMIT {int(READ_LIMIT)}"
    return _capped([dict(r) for r in c.execute(sql, params).fetchall()])


def _strategy_rows(c: sqlite3.Connection, user_id: str, lo: str, hi: str) -> tuple[
        list[dict], str | None]:
    """The member's CLOSED option strategies whose ET close day is in [lo, hi], newest first, and
    the cut day of an overflowing read. Read over a day either side (a stored UTC instant can be
    the ET day before or after), then kept by their own ET day."""
    wide_lo = (date.fromisoformat(lo) - timedelta(days=1)).isoformat()
    wide_hi = (date.fromisoformat(hi) + timedelta(days=1)).isoformat()
    rows = c.execute(
        "SELECT id, underlying, entry_date, closed_at, status, pnl_dollar, result, source,"
        " account_id, trading_day_et, COALESCE(trading_day_et, substr(closed_at, 1, 10)) AS day"
        " FROM j2_option_strategies WHERE user_id = ? AND status != 'open'"
        " AND COALESCE(trading_day_et, substr(closed_at, 1, 10)) BETWEEN ? AND ?"
        f" ORDER BY day DESC, id DESC LIMIT {int(READ_LIMIT)}",
        (user_id, wide_lo, wide_hi)).fetchall()
    kept, cut = _capped([dict(r) for r in rows])
    out = []
    for d in _counted(kept):
        day = d["trading_day_et"] or compute_trading_day_et(d["closed_at"])
        if day and lo <= day <= hi:
            d["day"] = day
            out.append(d)
    return out, cut


def _event(r: dict, *, option: bool) -> dict:
    """One trade or closed strategy as the builders read it. `net` is None for a strategy with no
    P&L recorded ("no result")."""
    if option:
        pnl = _num(r.get("pnl_dollar"))
        net, result = _net_result(pnl, r.get("result")) if pnl is not None else (None, None)
        # A noon-anchored (date-only or expired) close is not an execution time.
        exit_iso = None if options.exit_is_date_only(r) else r.get("closed_at")
        return {"ref": f"opt:{r['id']}", "symbol": r.get("underlying"),
                "entry_date": r.get("entry_date"), "exit_date": exit_iso,
                "net": net, "result": result, "day": r["day"], "estimated": False,
                "source": r.get("source"), "account_id": r.get("account_id")}
    gross = _num(r.get("pnl_dollar")) or 0.0
    net, result = _net_result(gross - (_num(r.get("fees")) or 0.0), r.get("result"))
    return {"ref": trade_ref_for_row(r), "symbol": r.get("symbol"),
            "entry_date": r.get("entry_date"), "exit_date": r.get("exit_date"),
            "net": net, "result": result, "day": r["day"], "estimated": bool(r.get("est")),
            "source": r.get("source"), "account_id": r.get("account_id")}


def _events(c: sqlite3.Connection, user_id: str, lo: str, hi: str) -> tuple[list[dict], str | None]:
    """Trades and closed strategies in [lo, hi], and the latest cut day of the two reads (every day
    on or before it may be missing rows)."""
    eq, cut_e = _equity_rows(c, user_id, lo, hi)
    st, cut_s = _strategy_rows(c, user_id, lo, hi)
    rows = [_event(r, option=False) for r in _counted(eq)]
    rows += [_event(r, option=True) for r in _counted(st)]
    cuts = [x for x in (cut_e, cut_s) if x]
    return rows, (max(cuts) if cuts else None)


def _times(ev: dict):
    """(entry, exit) instants when BOTH are real execution times and the entry is not an
    estimate; else None (a date-only row)."""
    if ev["estimated"]:
        return None
    entry = revenge_detect.timed_instant(ev["entry_date"])
    exit_ = revenge_detect.timed_instant(ev["exit_date"])
    if entry is None or exit_ is None:
        return None
    return entry, exit_


def _no_result_line(n: int) -> str:
    return (f"{_plural(n, 'options trade', 'options trades')} with no result recorded "
            f"{_is_are(n)} not counted.")


# -- Tilt check -------------------------------------------------------------------------------------

def _group(rows: list[dict]) -> dict:
    """{n, winRate, avg, net, sample, text}: the shared measures (`win_rate`, `expectancy`,
    `net_pnl`), hidden under `MIN_N` trades, never a zero for "none"."""
    n = len(rows)
    if n == 0:
        return {"n": 0, "winRate": None, "avg": None, "net": None, "sample": "hide",
                "text": "no trades"}
    mrows = [{"net": r["net"], "result": r["result"], "day": r["day"], "id": r["ref"]}
             for r in rows]
    net = _num(MEASURES["net_pnl"].fn(mrows).value)
    if n < MIN_N:
        return {"n": n, "winRate": None, "avg": None, "net": net, "sample": "hide",
                "text": S_NOT_ENOUGH.format(n=n)}
    rate = _num(MEASURES["win_rate"].fn(mrows).value)
    avg = _num(MEASURES["expectancy"].fn(mrows).value)
    parts = [_plural(n, "trade", "trades")]
    if rate is None:
        parts.append("no decided trades")
    elif rate == 0:
        parts.append("no wins")
    else:
        parts.append(f"{_pct(rate)} win rate")
    if avg is not None:
        parts.append("about even on average" if _whole(avg) == 0 else f"{money(avg)} average")
    return {"n": n, "winRate": rate, "avg": avg, "net": net, "sample": _sample(n),
            "text": ", ".join(parts)}


def _public(g: dict) -> dict:
    return {k: g[k] for k in ("n", "winRate", "avg", "net", "sample", "text")}


def my_tilt_check(user_id: str, params: dict, now: datetime) -> dict:
    """Trades entered within `TILT_WINDOW_MIN` minutes after a losing exit, against the others."""
    now_dt = _utc(now)
    today = trading_days.today_et(now_dt)
    p = clean_params(KIND_TILT, params)
    default = wplan.resolve_range({"token": "last_90d"}, today)
    hi = p.get("to") or today.isoformat()
    lo = p.get("from") or default.from_day
    if lo > hi:
        raise ParamError(S_START_AFTER_END)
    # A loss closed the day before the range can still start a window inside it.
    read_lo = (date.fromisoformat(lo) - timedelta(days=1)).isoformat()
    with _read(None) as c, _deadline(c):
        events, cut = _events(c, user_id, read_lo, hi)
        in_range = [e for e in events if e["day"] >= lo]
        timed: list[tuple[dict, datetime]] = []
        loss_exits: list[datetime] = []
        dates_only = estimated = no_result = 0
        for e in _counted(events):
            if e["net"] is None:                 # no result: neither a loss nor a counted trade
                if e["day"] >= lo:
                    no_result += 1
                continue
            t = _times(e)
            if e["net"] < 0:
                x = revenge_detect.timed_instant(e["exit_date"])
                if x is not None:
                    loss_exits.append(x)
            if e["day"] < lo:
                continue
            if t is None:
                if e["estimated"]:
                    estimated += 1
                else:
                    dates_only += 1
                continue
            timed.append((e, t[0]))
        loss_exits.sort()
        window = timedelta(minutes=TILT_WINDOW_MIN)
        after: list[dict] = []
        other: list[dict] = []
        for e, entry in _counted(timed):
            # Any losing exit in [entry - window, entry] (the trade's own exit is after its entry).
            i = bisect.bisect_left(loss_exits, entry - window)
            hit = i < len(loss_exits) and loss_exits[i] <= entry
            (after if hit else other).append(e)
    g_after, g_other = _group(after), _group(other)
    lines: list[str] = []
    if cut is not None and in_range:
        oldest = date.fromisoformat(min(e["day"] for e in in_range))
        lines.append(f"Counting the newest {READ_LIMIT - 1:,} trades, from "
                     f"{_day_label(oldest, today)}.")
    counted_any = any(e["net"] is not None for e in in_range)
    if not counted_any:
        lines.append(S_TILT_NO_TRADES)
    elif not timed:
        lines.append(S_TILT_ESTIMATED if estimated and not dates_only else S_TILT_NO_TIMES)
    else:
        lines += [f"{S_TILT_AFTER}: {g_after['text']}.", f"{S_TILT_OTHER}: {g_other['text']}.",
                  CAVEAT]
        if dates_only:
            lines.append(f"{_plural(dates_only, 'trade', 'trades')} with dates only "
                         f"{_is_are(dates_only)} not counted.")
    if estimated and timed or (estimated and dates_only and not timed):
        lines.append(f"{_plural(estimated, 'trade', 'trades')} with an estimated entry time "
                     f"{_is_are(estimated)} not counted.")
    if no_result:
        lines.append(_no_result_line(no_result))
    out = {
        "asOf": _iso_utc(now_dt),
        "source": _origin([e.get("source") for e in in_range]),
        "from": lo, "to": hi, "windowMinutes": TILT_WINDOW_MIN,
        "after": _public(g_after), "other": _public(g_other),
        "datesOnly": dates_only, "estimated": estimated, "noResult": no_result,
        "lines": lines,
    }
    if cut is not None:
        out["capped"] = True
    return out


# -- Revenge trades ---------------------------------------------------------------------------------

def _dismissed_pairs(c: sqlite3.Connection, user_id: str) -> frozenset[str]:
    """The member's dismissed revenge pairs, read the way `analytics._psychology_section` reads
    them: that section is called with its default (no pairs), because dismissal persistence is not
    stored yet. One seam, so the day the pairs are stored both read them alike."""
    return frozenset()


def finished_sessions(now: datetime, n: int = WINDOW) -> list[date]:
    """The last `n` FINISHED sessions as of `now`, oldest first. Today counts once past
    `close_time(today)` (13:00 ET on a half-day)."""
    now_dt = _utc(now)
    today = trading_days.today_et(now_dt)
    close = session_calendar.close_time(today) if trading_days.is_session(today) else None
    last = today if close is not None and now_dt >= close else \
        trading_days.session_on_or_before(today - timedelta(days=1))
    days = [last]
    while len(days) < n:
        days.append(trading_days.session_on_or_before(days[-1] - timedelta(days=1)))
    return list(reversed(days))


def _older_exits(c: sqlite3.Connection, user_id: str,
                 need: dict[str, tuple[datetime, datetime]]) -> tuple[list[dict], bool]:
    """ONE bounded read of the exits (trades and closed option strategies) that could be the
    scene of a re-entry made before the window's read (`need`: symbol -> (earliest, latest) such
    entry): from the earliest entry less the revenge window, ASCENDING, so the rows nearest the
    entries come first; at most `READ_LIMIT` each. (rows, overflowed)."""
    if not need:
        return [], False
    first = min(a for a, _ in need.values()) - timedelta(minutes=REVENGE_WINDOW_MIN)
    last = max(b for _, b in need.values())
    lo = (first.astimezone(timezone.utc).date() - timedelta(days=1)).isoformat()
    hi = (last.astimezone(timezone.utc).date() + timedelta(days=1)).isoformat()
    syms = sorted(need)
    limit = int(READ_LIMIT)
    eq = c.execute(
        "SELECT t.id, t.symbol, t.entry_date, t.exit_date, t.pnl_dollar,"
        " COALESCE(t.fees, 0) AS fees, t.result, t.source, t.external_id, t.account_id,"
        f" COALESCE(p.entry_estimated, 0) AS est, {_DAY_T} AS day"
        " FROM j2_trades t LEFT JOIN j2_positions p"
        " ON p.id = t.position_id AND p.user_id = t.user_id"
        " WHERE t.user_id = ? AND (t.analytics_excluded IS NULL OR t.analytics_excluded = 0)"
        f" AND t.symbol IN ({_marks(syms)}) AND {_DAY_T} BETWEEN ? AND ?"
        f" ORDER BY {_DAY_T} ASC, t.id ASC LIMIT {limit}",
        (user_id, *syms, lo, hi)).fetchall()
    st = c.execute(
        "SELECT id, underlying, entry_date, closed_at, status, pnl_dollar, result, source,"
        " account_id, trading_day_et, COALESCE(trading_day_et, substr(closed_at, 1, 10)) AS day"
        " FROM j2_option_strategies WHERE user_id = ? AND status != 'open'"
        f" AND underlying IN ({_marks(syms)})"
        " AND COALESCE(trading_day_et, substr(closed_at, 1, 10)) BETWEEN ? AND ?"
        f" ORDER BY day ASC, id ASC LIMIT {limit}",
        (user_id, *syms, lo, hi)).fetchall()
    over = len(eq) >= limit or len(st) >= limit
    rows = [_event(dict(r), option=False) for r in _counted(eq[:limit - 1])]
    rows += [_event(dict(r), option=True) for r in _counted(st[:limit - 1])]
    return rows, over


def my_revenge_clean_days(user_id: str, params: dict, now: datetime) -> dict:
    """Of the last `WINDOW` finished sessions: clean (no trades, or timed trades and no revenge
    flag), flagged, or not checked (only date-only trades, W10-R12; or not fully read)."""
    now_dt = _utc(now)
    clean_params(KIND_REVENGE, params)
    window = finished_sessions(now_dt)
    keys = [d.isoformat() for d in window]
    lo, hi = keys[0], keys[-1]
    # The day before the window: a prior loss there can still be the scene of a re-entry.
    read_lo = trading_days.session_on_or_before(window[0] - timedelta(days=1)).isoformat()
    too_big: set[str] = set()
    too_old: set[str] = set()
    with _read(None) as c, _deadline(c):
        events, cut = _events(c, user_id, read_lo, hi)
        suppressed = _dismissed_pairs(c, user_id)
        by_day: dict[str, list[dict]] = {}
        #: (symbol, exit ET date) -> timed rows: the index of possible priors
        by_exit: dict[tuple[str, str], list[dict]] = {}
        #: (symbol, entry ET date) -> the timed rows counted in the window: the current rows
        current: dict[tuple[str, str], list[dict]] = {}
        need: dict[str, tuple[datetime, datetime]] = {}
        needy: set[str] = set()
        for e in _counted(events):
            e["session"] = _session_of(e["day"])
            if lo <= e["session"] <= hi:
                by_day.setdefault(e["session"], []).append(e)
            t = _times(e)
            if t is None or e["net"] is None:
                continue
            sym = str(e["symbol"] or "")
            by_exit.setdefault((sym, compute_trading_day_et(e["exit_date"])), []).append(e)
            if lo <= e["session"] <= hi:
                entry_day = compute_trading_day_et(e["entry_date"])
                current.setdefault((sym, entry_day), []).append(e)
                if entry_day <= read_lo:          # its prior exits can be older than the read
                    a, b = need.get(sym, (t[0], t[0]))
                    need[sym] = (min(a, t[0]), max(b, t[0]))
                    needy.add(e["session"])
        known = {e["ref"] for e in events}
        older, older_over = _older_exits(c, user_id, need)
        if older_over:
            too_old.update(needy)              # never counted clean: not every older exit was read
        for e in older:
            if e["ref"] in known or _times(e) is None or e["net"] is None:
                continue
            by_exit.setdefault((str(e["symbol"] or ""), compute_trading_day_et(e["exit_date"])),
                               []).append(e)
        flags: list[dict] = []
        for (sym, entry_day), rows in sorted(current.items()):
            _check()                                   # every bucket asks the budget
            prev_day = (date.fromisoformat(entry_day) - timedelta(days=1)).isoformat()
            own = {e["ref"] for e in rows}
            prior = [e for e in by_exit.get((sym, entry_day), []) + by_exit.get((sym, prev_day), [])
                     if e["ref"] not in own]
            if len(prior) + len(rows) > MAX_BUCKET:
                too_big.update(e["session"] for e in rows)
                continue
            got = revenge_detect.detect(
                [{"tradeRef": e["ref"], "symbol": sym, "entry_date": e["entry_date"],
                  "exit_date": e["exit_date"], "pnlDollarNet": e["net"]} for e in prior + rows],
                suppressed_pairs=suppressed)
            by_ref = {e["ref"]: e for e in rows}
            for f in got["flags"]:
                cur = by_ref.get(f["tradeRef"])
                if cur is not None:
                    # The flag's day is the re-entry's EXIT session (the day it is counted on).
                    flags.append({"day": cur["session"], "symbol": sym,
                                  "minutesApart": _num(f["minutesApart"])})
    flagged_days = {f["day"] for f in flags}
    clean = checked = not_checked = not_read = crowded = older_unread = 0
    for k in keys:
        rows = by_day.get(k) or []
        if cut is not None and k <= cut:
            not_read += 1                     # never counted clean: not every trade was read
        elif k in too_old:
            older_unread += 1
        elif k in too_big:
            crowded += 1                      # never counted clean: the detector was not run
        elif not rows:
            clean += 1
            checked += 1
        elif not any(_times(e) is not None for e in rows):
            not_checked += 1
        elif k in flagged_days:
            checked += 1
        else:
            clean += 1
            checked += 1
    flags.sort(key=lambda f: (f["day"], f["symbol"]), reverse=True)
    shown = flags[:ROW_CAP]
    traded = any(by_day.get(k) for k in keys) or not_read or crowded or older_unread
    if not traded:
        lines = [S_REVENGE_NO_TRADES]
    elif checked == 0:
        lines = [S_REVENGE_NONE_CHECKED] if not (not_read or crowded or older_unread) else []
    elif clean == 0:
        lines = [S_REVENGE_EVERY_DAY]
    else:
        line = f"{clean} of {checked} clean"
        if not_checked:
            line += (f" ({_plural(not_checked, 'day', 'days')} with dates only "
                     f"{'was' if not_checked == 1 else 'were'} not checked)")
        lines = [line]
    if not_read:
        lines.append(f"{_plural(not_read, 'day', 'days')} {'was' if not_read == 1 else 'were'} "
                     "not checked: this widget reads your newest "
                     f"{READ_LIMIT - 1:,} trades.")
    if crowded:
        lines.append(f"{_plural(crowded, 'day', 'days')} {'was' if crowded == 1 else 'were'} "
                     "not checked: too many trades in one symbol to check.")
    if older_unread:
        lines.append(f"{_plural(older_unread, 'day', 'days')} "
                     f"{'was' if older_unread == 1 else 'were'} not checked: too many older trades "
                     "to look back over.")
    out: dict[str, Any] = {
        "asOf": _iso_utc(now_dt),
        "source": _origin([e.get("source") for k in keys for e in by_day.get(k) or []]),
        "from": lo, "to": hi, "window": WINDOW,
        "clean": clean, "checked": checked, "notChecked": not_checked, "notRead": not_read,
        "tooMany": crowded, "olderNotRead": older_unread,
        "flagged": shown,
        "lines": lines,
    }
    if len(flags) > ROW_CAP:
        out["truncated"] = len(flags) - ROW_CAP
    return out


# -- money days (Room left today and Prop-firm rules) -----------------------------------------------

def _day_nets(c: sqlite3.Connection, user_id: str, acc: str | None, since: date,
              today: date):
    """The trading-days source scan from `since` to `today` (day net incl. options, the one
    authority), through the validated cover plan a built widget reads."""
    from api.services.journal_two.widget_engine import run as wrun
    from api.services.journal_two.widget_engine import sources as wsources
    plan = wrun._cover_plan("trading_days")
    rng = wplan.ResolvedRange(since.isoformat(), today.isoformat(), None, "since", None)
    return wsources.scan_days(c, plan, {"accountId": acc}, rng, user_id, today=today)


def _flagged_by_hand(c: sqlite3.Connection, user_id: str, lo: str, hi: str,
                     account: str | None = None) -> tuple[list[dict], bool]:
    """Trades the member excluded from analytics by hand (W10-R33), day in [lo, hi], newest first:
    a money widget counts them. At most `READ_LIMIT` read, one fewer kept; (rows, overflowed)."""
    sql = (f"SELECT t.id, t.pnl_dollar, COALESCE(t.fees, 0) AS fees, t.account_id, t.source,"
           f" {_DAY_T} AS day FROM j2_trades t WHERE t.user_id = ? AND {_COUNTED_FLAG}"
           f" AND {_DAY_T} BETWEEN ? AND ?")
    params: list = [user_id, lo, hi]
    if account is not None:
        sql += " AND t.account_id = ?"
        params.append(account)
    limit = int(READ_LIMIT)
    sql += f" ORDER BY {_DAY_T} DESC, t.id DESC LIMIT {limit}"
    got = c.execute(sql, params).fetchall()
    out = []
    for r in _counted(got[:limit - 1]):
        out.append({"day": r["day"], "account_id": r["account_id"], "source": r["source"],
                    "net": (_num(r["pnl_dollar"]) or 0.0) - (_num(r["fees"]) or 0.0)})
    return out, len(got) >= limit


def _no_result_closes(c: sqlite3.Connection, user_id: str, lo: str, hi: str,
                      account: str | None = None) -> int:
    """Closed strategies with no P&L recorded whose ET day is in [lo, hi]: no result, said so.
    Read a day either side and kept by their own ET day (the strategy read's rule)."""
    wide_lo = (date.fromisoformat(lo) - timedelta(days=1)).isoformat()
    wide_hi = (date.fromisoformat(hi) + timedelta(days=1)).isoformat()
    sql = ("SELECT trading_day_et, closed_at FROM j2_option_strategies WHERE user_id = ?"
           " AND status != 'open' AND pnl_dollar IS NULL"
           " AND COALESCE(trading_day_et, substr(closed_at, 1, 10)) BETWEEN ? AND ?")
    params: list = [user_id, wide_lo, wide_hi]
    if account is not None:
        sql += " AND account_id = ?"
        params.append(account)
    sql += f" LIMIT {int(READ_LIMIT)}"
    n = 0
    for r in _counted(c.execute(sql, params).fetchall()):
        day = r["trading_day_et"] or compute_trading_day_et(r["closed_at"])
        if day and lo <= day <= hi:
            n += 1
    return n


def _flagged_line(n: int) -> str:
    return f"Includes {_plural(n, 'trade', 'trades')} you excluded from analytics."


def _flagged_over_line() -> str:
    return (f"Only your newest {READ_LIMIT - 1:,} trades excluded from analytics are counted.")


# -- Risk left today --------------------------------------------------------------------------------

def _open_strategy_counts(c: sqlite3.Connection, user_id: str) -> dict[str | None, int]:
    out: dict[str | None, int] = {}
    for (acc, n) in c.execute(
            "SELECT account_id, COUNT(*) FROM j2_option_strategies"
            " WHERE user_id = ? AND status = 'open' GROUP BY account_id", (user_id,)):
        out[acc] = int(n)
    return out


def _heat(user_id: str, account_id: str | None, size: float, positions: list[dict]) -> dict:
    """`portfolio_heat` over positions already read (read once, grouped in memory), read-only: the
    size this widget read, no regime or brain read (neither feeds the open risk). The dollars to a
    stop need no size; a group with no size of its own is read with a stand-in that only feeds
    heat's percentages, which this module never reads."""
    from api.services import portfolio_heat
    return portfolio_heat.portfolio_heat(
        user_id, account_id, size, positions_fn=lambda _u, _a: positions, regime_fn=lambda: {},
        cap_fn=lambda: None, account_size_fn=lambda _u, _a: size) or {}


#: What a group with nothing in it reads as.
_NO_RISK = {"ok": True, "risk": None, "real": 0, "noStop": 0, "unread": 0}


def _risk_of(heat: dict, n_positions: int = 0) -> dict:
    """{ok, risk, real, noStop, unread}: `risk` is the dollars to the REAL stops, or None when no
    position has one -- a group of placeholder stops only has no KNOWN risk, never a made-up 0 --
    or when heat could not run (`ok` False). `unread` counts the positions heat skipped (a blank
    symbol, a non-numeric entry or share count): never silently out of the open risk."""
    if not heat.get("ok"):
        return {"ok": False, "risk": None, "real": 0, "noStop": 0, "unread": 0}
    per = heat.get("per_position") or []
    real = [p for p in per if not p.get("placeholder_stop")]
    risk = _num(math.fsum(_num(p.get("risk_dollars")) or 0.0 for p in real)) if real else None
    return {"ok": True, "risk": risk, "real": len(real),
            "noStop": len(heat.get("placeholder_stops") or []),
            "unread": max(0, int(n_positions) - len(per))}


def _unread_line(n: int) -> str:
    return (f"{_plural(n, 'position', 'positions')} couldn't be read and "
            f"{_is_are(n)} not in the open risk.")


#: The total line names at most this many blocks; the rest are "and N others".
TOTAL_NAMES = 3


def _known_sum(values) -> float | None:
    """The sum of the known parts, or None when every part is unknown (never a made-up 0)."""
    known = [v for v in values if v is not None]
    return _num(math.fsum(known)) if known else None


def _amount(v: float) -> str:
    return _dollars(v) if _whole(v) else "under $1"


def _room_line(left: float, limit: float) -> str:
    if left < 0 and _whole(left):
        return S_PAST_DAILY.format(x=_dollars(left))
    if _whole(left) == 0:
        return f"No room left today: your {_dollars(limit)} daily loss limit is used."
    return f"Room left today: {_dollars(left)} of {_dollars(limit)}."


def _risk_lines(info: dict, open_options: int, anything_open: bool,
                positions_ok: bool) -> list[str]:
    """The open-risk sentences one block shows (an account, or the unlinked positions). With the
    positions unread the widget says so once, at the top, and no block guesses."""
    if not positions_ok:
        return []
    lines: list[str] = []
    if not info["ok"]:
        lines.append(S_RISK_UNREAD)
    elif info["real"]:
        lines.append(f"Open risk to stops: {_amount(info['risk'])}.")
    elif not info["noStop"] and not open_options and not info.get("unread"):
        lines.append(S_RISK_NONE_HERE if anything_open else S_RISK_NO_POSITIONS)
    no_stop = info["noStop"]
    if no_stop:
        lines.append(f"{_plural(no_stop, 'position', 'positions')} "
                     f"{'has' if no_stop == 1 else 'have'} no stop set and "
                     f"{_is_are(no_stop)} not in the open risk.")
    if info.get("unread"):
        lines.append(_unread_line(info["unread"]))
    if open_options:
        lines.append(f"{_plural(open_options, 'open options trade', 'open options trades')} "
                     f"{_is_are(open_options)} not in the open risk.")
    return lines


def positions_capped_line() -> str:
    """Said when the open positions read overflowed (M8): the risk covers the first ones only."""
    return (f"Counting the first {READ_LIMIT - 1:,} of your open positions; you hold more, so the "
            "open risk is not complete.")


def read_open_positions(user_id: str, conn: sqlite3.Connection) -> tuple[list[dict], bool]:
    """(the member's open positions, on every account and on none, at most `READ_LIMIT` - 1; True
    when there were more). The ONE read both risk widgets use (fix 10.11 M8). Raises on an
    unreadable store: the caller says so, never "No open positions."."""
    from api.services.journal_two import positions as j2_positions
    rows = list(j2_positions.list_open_positions(user_id, conn, limit=READ_LIMIT) or [])  # W10-R45
    keep = READ_LIMIT - 1
    return rows[:keep], len(rows) > keep


def open_risk(user_id: str, positions: list[dict], *, conn: sqlite3.Connection | None = None,
              account_id: str | None = None, size: float | None = None, open_options: int = 0,
              anything_open: bool | None = None) -> dict:
    """THE open risk to stops of one group of positions already read: `{ok, risk, real, noStop,
    unread, lines}` (fix 10.11 I-3: the one authority Risk left today and the Pre-market game plan
    both ask). `risk` is the dollars to the REAL stops through `portfolio_heat`, None when no
    position has one or heat could not run (never a made-up 0); a placeholder stop is `noStop`; a
    position heat skipped is `unread`. `lines` are the group's sentences, the "under $1" wording
    included. `size` only feeds heat's percentages, which nothing here reads. `conn` is accepted
    for a caller that holds one; nothing is read here, the positions are already in hand."""
    group = list(positions or [])
    info = (_risk_of(_heat(user_id, account_id, size or 1.0, group), len(group)) if group
            else dict(_NO_RISK))
    if anything_open is None:
        anything_open = bool(group) or bool(open_options)
    return {**info, "lines": _risk_lines(info, open_options, anything_open, True)}


def _after_line(after: float, with_unlinked: bool) -> str:
    lead = ("If every stop is hit, including positions not linked to an account"
            if with_unlinked else "If every stop is hit")
    if after < 0 and _whole(after):
        return f"{lead}: {_dollars(after)} past your limit."
    if _whole(after) == 0:
        return f"{lead}: no room left."
    return f"{lead}: {_dollars(after)} left."


_AFTER_ANCHORS = ("Room left today", "No room left today", "Past your daily loss limit",
                  "Open risk to stops", S_RISK_NONE_HERE, S_RISK_NO_POSITIONS)


def _place_after(lines: list[str], line: str) -> None:
    """Put the "if every stop is hit" line after the room and the open-risk lines (and after
    "This account holds nothing open."), before the no-stop and options lines."""
    i = max((k for k, ln in enumerate(lines) if ln.startswith(_AFTER_ANCHORS)), default=-1)
    lines.insert(i + 1, line)


def _account_block(a: dict, net: float | None, info: dict, open_options: int,
                   anything_open: bool, positions_ok: bool, flagged: int = 0) -> dict:
    """One account: the room left today when it has a limit and an own size, the open risk to its
    stops either way (risk to a stop is dollars and needs no size)."""
    pct = _num(a.get("daily_loss_limit_pct"))
    limited = (pct or 0) > 0
    size = accounts.own_account_size(a)
    block: dict[str, Any] = {"accountId": a["id"], "name": a.get("name"),
                             "limitPct": pct if limited else None, "limit": None,
                             "net": _num(net) if limited else None, "used": None, "left": None,
                             "openRisk": info["risk"] if positions_ok else None,
                             "afterStops": None,
                             "noStop": info["noStop"] if positions_ok else None,
                             "openOptions": open_options, "lines": []}
    lines: list[str] = []
    left = None
    if limited and size is not None and size > 0:
        limit = pct / 100.0 * size
        used = max(0.0, -(net or 0.0))
        left = limit - used
        block.update(limit=_num(limit), used=_num(used), left=_num(left))
        lines.append(_room_line(left, limit))
    elif limited:
        lines.append(S_RISK_NO_SIZE)
    lines += list(info.get("lines") or []) if positions_ok else []
    if left is not None and positions_ok and info["risk"] is not None:
        after = left - info["risk"]
        block["afterStops"] = _num(after)
        _place_after(lines, _after_line(after, False))
    if flagged:
        lines.append(_flagged_line(flagged))      # W10-R33: counted, and said so
    block["lines"] = lines
    return block


def my_risk_left_today(user_id: str, params: dict, now: datetime) -> dict:
    """Per account with a daily loss limit and an own size: today's room (W10-R9); for EVERY
    account holding something, and for the positions linked to no account of the member's
    (W10-R32), the open risk to stops (`portfolio_heat`); and the total, always the true total
    (W10-R34)."""
    now_dt = _utc(now)
    clean_params(KIND_RISK_LEFT, params)
    today = trading_days.today_et(now_dt)
    session = trading_days.session_on_or_before(today)       # the session today is counted on
    lo, hi = session.isoformat(), today.isoformat()
    blocks: list[dict] = []
    sources: list = []
    unattributed = flagged_over = positions_capped = False
    no_result = 0
    rest: list[dict] = []
    with _read(None) as c, _deadline(c):
        accs = [dict(r) for r in c.execute(
            "SELECT * FROM j2_accounts WHERE user_id = ? ORDER BY created_at, id"
            f" LIMIT {int(READ_LIMIT)}", (user_id,)).fetchall()]
        ids = [a["id"] for a in accs]
        limited_ids = {a["id"] for a in accs if (_num(a.get("daily_loss_limit_pct")) or 0) > 0}
        positions_ok = True
        try:
            all_positions, positions_capped = read_open_positions(user_id, c)
        except Exception:  # noqa: BLE001 -- unread positions are said so, never a failed widget
            positions_ok, all_positions = False, []
        opens = _open_strategy_counts(c, user_id)
        anything_open = bool(all_positions) or any(opens.values())
        grouped: dict[str | None, list[dict]] = {}
        for pos in _counted(all_positions):
            key = pos.get("accountId") if pos.get("accountId") in ids else None
            grouped.setdefault(key, []).append(pos)
        sources += [pos.get("source") for pos in all_positions]
        sizes = {a["id"]: accounts.own_account_size(a) for a in accs}
        unlinked_opts = sum(n for k, n in opens.items() if k not in ids)
        # The open risk of EVERY group (accounts with no limit, with no size, past the cap, and the
        # unlinked positions) through the one authority, `open_risk` (fix 10.11 I-3).
        info: dict[str | None, dict] = {}
        for key, group in _counted(list(grouped.items())):
            info[key] = open_risk(user_id, group, account_id=key, size=sizes.get(key),
                                  open_options=unlinked_opts if key is None else opens.get(key, 0),
                                  anything_open=anything_open)
        block_accs = [a for a in accs
                      if a["id"] in limited_ids or grouped.get(a["id"]) or opens.get(a["id"])]
        shown, rest = block_accs[:ROW_CAP], block_accs[ROW_CAP:]
        shown_limited = [a for a in shown if a["id"] in limited_ids]
        per: dict[str, float] = {}
        flagged_by: dict[str, int] = {}
        if shown_limited:
            # Today's net from the trading-days scan (M3): every account at once, then per account.
            whole = _day_nets(c, user_id, None, session, today)
            row_all = next((r for r in whole.rows if r["day"] == lo), None)
            sources += _row_sources(row_all)
            if len(ids) == 1:
                per[ids[0]] = (row_all or {}).get("net") or 0.0
            else:
                for a in _counted(shown_limited):
                    r = next((x for x in _day_nets(c, user_id, a["id"], session, today).rows
                              if x["day"] == lo), None)
                    per[a["id"]] = (r or {}).get("net") or 0.0
                # Several accounts: a trade linked to none of them cannot be placed (one account
                # takes them all, above, as the scan over every account does).
                unattributed = _has_unlinked_trades(c, user_id, lo, hi, ids)
            flagged, flagged_over = _flagged_by_hand(c, user_id, lo, hi)
            only = ids[0] if len(ids) == 1 else None
            for f in flagged:
                acc = f["account_id"] if f["account_id"] in ids else only
                if acc in per:
                    per[acc] += f["net"]
                    flagged_by[acc] = flagged_by.get(acc, 0) + 1
                    sources.append(f["source"])
            no_result = _no_result_closes(c, user_id, lo, hi)
        for a in _counted(shown):
            a_info = info.get(a["id"]) or open_risk(
                user_id, [], open_options=opens.get(a["id"], 0), anything_open=anything_open)
            blocks.append(_account_block(a, per.get(a["id"], 0.0), a_info,
                                         opens.get(a["id"], 0), anything_open, positions_ok,
                                         flagged_by.get(a["id"], 0)))
        u_info = info.get(None) or open_risk(user_id, [], open_options=unlinked_opts,
                                             anything_open=anything_open)
        if grouped.get(None) or unlinked_opts:
            blocks.append({"accountId": None, "name": UNLINKED_NAME,
                           "openRisk": u_info["risk"] if positions_ok else None,
                           "noStop": u_info["noStop"] if positions_ok else None,
                           "openOptions": unlinked_opts,
                           "lines": list(u_info["lines"]) if positions_ok else []})
            own = blocks[0] if blocks and len(ids) == 1 and blocks[0]["accountId"] else None
            if own is not None and own.get("left") is not None and u_info["risk"] is not None:
                # W10-R34: one account -- its "if every stop is hit" includes the unlinked risk.
                after = own["left"] - (own["openRisk"] or 0.0) - u_info["risk"]
                own["afterStops"] = _num(after)
                own["lines"] = [ln for ln in own["lines"] if not ln.startswith(
                    "If every stop is hit")]
                _place_after(own["lines"], _after_line(after, True))
    # The true total: every group's known risk (I-2: unknown-only is None, never 0).
    # A group heat could not read makes the total unknown: never a silently smaller total.
    heat_ok = positions_ok and all(i["ok"] for i in info.values())
    total = _known_sum(i["risk"] for i in info.values()) if heat_ok else None
    rest_risk = _known_sum(info.get(a["id"], _NO_RISK)["risk"] for a in rest)
    unread_n = sum(i.get("unread", 0) for i in info.values())
    lines: list[str] = []
    if not heat_ok:
        lines.append(S_RISK_UNREAD)
    if positions_capped:
        lines.append(positions_capped_line())
    if unread_n:
        lines.append(_unread_line(unread_n))
    if not limited_ids:
        lines.append(S_RISK_NO_LIMIT)
    elif all(b.get("limit") is None for b in blocks if b.get("accountId") in limited_ids):
        lines.append(S_RISK_NO_SIZE)
    else:
        if unattributed:
            lines.append(S_RISK_UNATTRIBUTED)
        if flagged_over:
            lines.append(_flagged_over_line())
        if no_result:
            lines.append(_no_result_line(no_result))
    if rest:
        n = len(rest)
        if rest_risk is not None and positions_ok:
            lines.append(f"{_plural(n, 'more account', 'more accounts')}: {_amount(rest_risk)} "
                         "at risk.")
        else:
            lines.append(f"{_plural(n, 'more account', 'more accounts')} not shown; none has open "
                         "risk to a stop.")
    if total is not None:
        parts = [(b["name"], b["openRisk"]) for b in blocks if b.get("openRisk") is not None]
        if rest_risk is not None:
            parts.append((_plural(len(rest), "more account", "more accounts"), rest_risk))
        line = f"Open risk to stops in total: {_amount(total)}"
        if len(parts) > 1 or any(b["accountId"] is None and b.get("openRisk") is not None
                                 for b in blocks):
            named = parts
            if len(parts) > TOTAL_NAMES:
                # The largest few by risk; every block still carries its own number.
                named = sorted(parts, key=lambda p: -p[1])[:TOTAL_NAMES]
            text = ", ".join(f"{name} {_amount(v)}" for name, v in named)
            if len(parts) > len(named):
                text += f", and {_plural(len(parts) - len(named), 'other', 'others')}"
            line += " (" + text + ")"
        lines.append(line + ".")
    out: dict[str, Any] = {
        "asOf": _iso_utc(now_dt),
        "source": _origin(sources),
        "day": hi,
        "session": lo,
        "accounts": blocks,
        "openRisk": total,
        "flaggedCounted": sum(flagged_by.values()) if blocks else 0,
        "lines": lines,
    }
    if rest:
        out["truncated"] = len(rest)
    if positions_capped:
        out["positionsCapped"] = True
    return out


def _has_unlinked_trades(c: sqlite3.Connection, user_id: str, lo: str, hi: str,
                         ids: list[str]) -> bool:
    r = c.execute(
        f"SELECT 1 FROM j2_trades t WHERE t.user_id = ? AND {_DAY_T} BETWEEN ? AND ?"
        f" AND (t.account_id IS NULL OR t.account_id NOT IN ({_marks(ids)})) LIMIT 1",
        (user_id, lo, hi, *ids)).fetchone()
    s = c.execute(
        "SELECT 1 FROM j2_option_strategies WHERE user_id = ? AND status != 'open'"
        " AND COALESCE(trading_day_et, substr(closed_at, 1, 10)) BETWEEN ? AND ?"
        f" AND (account_id IS NULL OR account_id NOT IN ({_marks(ids)})) LIMIT 1",
        (user_id, lo, hi, *ids)).fetchone()
    return bool(r or s)


def _row_sources(r: dict | None) -> list:
    if not r:
        return []
    origin = r.get("origin")
    if origin == "mixed":
        return list(r.get("origins") or [])
    return [origin] if origin else []


# -- Prop-firm rules --------------------------------------------------------------------------------

def _default_since(today: date) -> date:
    """The first session of the current month (the month's first day when that is after today)."""
    first = today.replace(day=1)
    s = trading_days.session_on_or_after(first)
    return s if s <= today else first


def my_prop_firm(user_id: str, params: dict, now: datetime) -> dict:
    """A daily loss limit and a trailing max drawdown over the day nets from `since` (W10-R9)."""
    now_dt = _utc(now)
    today = trading_days.today_et(now_dt)
    p = clean_params(KIND_PROP_FIRM, params)
    since = date.fromisoformat(p["since"]) if "since" in p else _default_since(today)
    daily_limit, dd_limit = p.get("dailyLoss"), p.get("maxDrawdown")
    notices: list[str] = []
    from api.services.journal_two.widget_engine import sources as wsources
    flagged_n = no_result = 0
    flagged_over = False
    with _read(None) as c, _deadline(c):
        asked = p.get("accountId")
        acc = wsources.owned_account_id(c, user_id, asked)
        if asked and acc is None:
            notices.append(_s_account_gone())
        scan = _day_nets(c, user_id, acc, since, today) if since <= today else None
        rows = list(reversed(scan.rows)) if scan else []          # oldest first
        if scan:
            notices += [n for n in scan.notices if n not in notices]
        sources: list = []
        extra: dict[str, float] = {}
        if rows:
            keys = {r["day"] for r in rows}
            first = rows[0]["day"]
            flagged_rows, flagged_over = _flagged_by_hand(c, user_id, first, today.isoformat(), acc)
            for f in flagged_rows:
                d = _session_of(f["day"])
                d = d if d >= first else first
                if d in keys:
                    extra[d] = extra.get(d, 0.0) + f["net"]
                    flagged_n += 1
                    sources.append(f["source"])
            no_result = _no_result_closes(c, user_id, first, today.isoformat(), acc)
        cum = peak = 0.0
        traded = 0
        today_net = 0.0
        today_key = trading_days.session_on_or_before(today).isoformat()
        for r in _counted(rows):
            net = (_num(r.get("net")) or 0.0) + extra.get(r["day"], 0.0)
            cum += net
            peak = max(peak, cum)
            if (r.get("trade_count") or 0) > 0 or r["day"] in extra:
                traded += 1
                sources.extend(_row_sources(r))
            if r.get("day") == today_key:
                today_net = net
    counted_from = date.fromisoformat(rows[0]["day"]) if rows else since
    lines: list[str] = []
    if scan is not None and scan.capped and rows:
        lines.append(f"Counting from {_day_label(counted_from)}, the oldest day this widget reads.")
    drawdown = peak - cum
    daily = trailing = None
    if daily_limit is not None:
        used = max(0.0, -today_net)
        left = daily_limit - used
        daily = {"limit": daily_limit, "todayNet": _num(today_net), "used": _num(used),
                 "left": _num(left)}
    if dd_limit is not None:
        left_dd = dd_limit - drawdown
        trailing = {"limit": dd_limit, "peak": _num(peak), "current": _num(cum),
                    "drawdown": _num(drawdown), "left": _num(left_dd)}
    if not traded:
        lines.append(f"No trades since {_day_label(since, today)}.")
        if daily is None and trailing is None:
            lines.append(S_PROP_MISSING)
    elif daily is None and trailing is None:
        lines.append(S_PROP_MISSING)
    else:
        if daily is not None:
            lines.append(_daily_line(daily["used"], daily["left"], daily_limit))
        if trailing is not None:
            lines.append(_drawdown_line(drawdown, trailing["left"], dd_limit))
    if flagged_n:
        lines.append(_flagged_line(flagged_n))
    if flagged_over:
        lines.append(_flagged_over_line())
    if no_result:
        lines.append(_no_result_line(no_result))
    out: dict[str, Any] = {
        "asOf": _iso_utc(now_dt),
        "source": _origin(sources),
        "since": since.isoformat(),
        "countingFrom": counted_from.isoformat(),
        "accountId": acc,
        "daily": daily,
        "trailing": trailing,
        "flaggedCounted": flagged_n,
        "lines": lines,
        "notes": list(scan.footnotes) if scan else [],
    }
    if notices:
        out["notices"] = notices
    return out


def _daily_line(used: float, left: float, limit: float) -> str:
    if left < 0 and _whole(left):
        return S_PAST_DAILY.format(x=_dollars(left))
    if _whole(used) == 0:
        return f"Daily loss: none used today; {_dollars(limit)} left."
    tail = "none left" if _whole(left) == 0 else f"{_dollars(left)} left"
    return f"Daily loss: {_dollars(used)} of {_dollars(limit)} used; {tail}."


def _drawdown_line(drawdown: float, left: float, limit: float) -> str:
    if left < 0 and _whole(left):
        return S_PAST_DRAWDOWN.format(x=_dollars(left))
    if _whole(drawdown) == 0:
        return f"Max drawdown: at your peak; {_dollars(limit)} left."
    tail = "none left" if _whole(left) == 0 else f"{_dollars(left)} left"
    return f"Max drawdown: {_dollars(drawdown)} below your peak; {tail}."


#: kind -> builder (the dedicated router, Task 10.12, dispatches on this).
BUILDERS: dict[str, Callable[[str, dict, datetime], dict]] = {
    KIND_TILT: my_tilt_check,
    KIND_REVENGE: my_revenge_clean_days,
    KIND_RISK_LEFT: my_risk_left_today,
    KIND_PROP_FIRM: my_prop_firm,
}

# The one refusal class lives in `shelf_kinds` (Task 10.12). Imported LAST, because `shelf_kinds` reads this
# module's tables while it imports: see its IMPORT ORDER note before moving this line.
from api.services.journal_two.shelf_kinds import ParamError  # noqa: E402
