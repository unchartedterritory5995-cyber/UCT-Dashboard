"""Notebook widgets wave 10 (Task 10.10): the ready-made discipline widgets, computed on the server.

Four builders, each `(user_id: str, params: dict, now: datetime) -> dict`:

  * `my_tilt_check` (`myTiltCheck`, "Tilt check"): trades entered within `TILT_WINDOW_MIN` minutes
    after ANY losing exit (any symbol, across midnight too) against every other timed trade.
  * `my_revenge_clean_days` (`myRevengeClean`, "Revenge trades"): of the last `WINDOW` finished
    sessions, how many had no revenge re-entry (`revenge_detect.detect`, ruling W10-R12).
  * `my_risk_left_today` (`myRiskLeftToday`, "Risk left today"): per account with a daily loss
    limit and an own size, the room left today (W10-R9) and the open risk to stops
    (`portfolio_heat`, the phase 1 positions authority).
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
    the analytics rule); `trading_days.today_et(now)` is today.
  * Flagged trades are left out (`analytics_excluded`); a trade whose position carries an estimated
    entry date is never timed (its entry instant is a guess).
  * Closed option strategies count (day net "incl. options", ruling W9-R22); an open one is not in
    any figure, and Risk left today says how many are not in the open risk.
  * A broker placeholder stop (`stop_price == entry_price`, `placeholder_stop`) is never counted as
    zero risk: `portfolio_heat` leaves it out of the open risk and this module says how many.
  * The note tables are never read here, so sample notes cannot feed a number
    (`sample_marker`; nothing to filter).

Bounded work (W9-R17): every read is `LIMIT 5001` (`wcompile.SCAN_LIMIT`) on the indexed day order,
at most `MAX_SESSIONS` sessions, every Python loop over rows asks `_check()` every `CHECK_EVERY` rows,
and each builder runs its SQL and loops under `run.deadline` (`run.EngineTooLong` past it).

Refusals are `ParamError`, a `tool_errors.ToolError` carrying status and code (ruling W9-R14).
⚠️ Task 10.12 creates `shelf_kinds.py`, where `ParamError` is to live; it is defined here until then
and 10.12 re-homes it (re-exporting the name here keeps every import working).
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
from api.services.journal_two import accounts, revenge_detect, tool_errors, trading_days
from api.services.journal_two.filters import _DAY
from api.services.journal_two.measures import DEFAULT_MIN_N, MEASURES, SMALL_SAMPLE_N
from api.services.journal_two.notebook_widgets import _iso_utc, _num, _origin
from api.services.journal_two.routine_insights import money
from api.services.journal_two.timeutil import compute_trading_day_et
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.journal_two.widget_definitions import _read
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
#: Every read is bounded by this LIMIT (one past the 5,000 rows a builder reads).
READ_LIMIT = wcompile.SCAN_LIMIT
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
S_UNKNOWN_KIND = "That widget isn't available."
S_ACCOUNT_GONE = "That account is no longer in your Journal; showing all accounts."

S_TILT_NO_TRADES = "No closed trades in this range."
S_TILT_NO_TIMES = "Tilt check needs entry and exit times; your trades have dates only."
S_TILT_AFTER = "Within 30 min after a loss"
S_TILT_OTHER = "Other trades"

S_REVENGE_NO_TRADES = "No trades in the last 30 trading days."
S_REVENGE_EVERY_DAY = "Revenge re-entries on every checked day in the last 30 trading days."
S_REVENGE_NONE_CHECKED = ("None of the last 30 trading days could be checked; "
                          "your trades have dates only.")

S_RISK_NO_LIMIT = "Set a daily loss limit in your account settings to see room left."
S_RISK_NO_SIZE = "Set your account size to turn your daily loss limit into dollars."
S_RISK_NO_POSITIONS = "No open positions."
S_RISK_UNREAD = "Your open positions couldn't be read right now."
S_RISK_UNATTRIBUTED = "Some of today's trades have no account and are not counted."

S_PROP_MISSING = "Enter your daily loss limit and max drawdown to see room left."
S_PAST_DAILY = "Past your daily loss limit by {x}."
S_PAST_DRAWDOWN = "Past your max drawdown by {x}."

MINUS = "−"
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
#: `filters._DAY` for the `t` alias (derived, never restated).
_DAY_T = _DAY.replace("trading_day_et", "t.trading_day_et").replace("exit_date", "t.exit_date")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


class ParamError(tool_errors.ToolError):
    """A refused widget setting. Its message is a member sentence (`.sentence`); the router answers
    `{"detail": {"code": e.code, "message": e.sentence}}` with `e.status` and never matches the
    words (W9-R14). To be re-homed in `shelf_kinds.py` by Task 10.12."""
    status = 400
    code = "invalid"


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
        raise ParamError(S_UNKNOWN_KIND)
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

def _equity_rows(c: sqlite3.Connection, user_id: str, lo: str, hi: str,
                 account: str | None = None) -> list[dict]:
    """The member's closed equity trades whose ET day is in [lo, hi], flagged ones left out, newest
    first, at most `READ_LIMIT`. `est` is the position's estimated-entry flag."""
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
    sql += f" ORDER BY {_DAY_T} DESC, t.id DESC LIMIT {READ_LIMIT}"
    return [dict(r) for r in c.execute(sql, params).fetchall()]


def _strategy_rows(c: sqlite3.Connection, user_id: str, lo: str, hi: str) -> list[dict]:
    """The member's CLOSED option strategies whose ET close day is in [lo, hi], newest first, at most
    `READ_LIMIT`. Read over a day either side (a stored UTC instant can be the ET day before or
    after), then kept by their own ET day."""
    wide_lo = (date.fromisoformat(lo) - timedelta(days=1)).isoformat()
    wide_hi = (date.fromisoformat(hi) + timedelta(days=1)).isoformat()
    rows = c.execute(
        "SELECT id, underlying, entry_date, closed_at, pnl_dollar, result, source, account_id,"
        " trading_day_et FROM j2_option_strategies WHERE user_id = ? AND status != 'open'"
        " AND COALESCE(trading_day_et, substr(closed_at, 1, 10)) BETWEEN ? AND ?"
        f" ORDER BY closed_at DESC, id DESC LIMIT {READ_LIMIT}",
        (user_id, wide_lo, wide_hi)).fetchall()
    out = []
    for r in _counted(rows):
        day = r["trading_day_et"] or compute_trading_day_et(r["closed_at"])
        if day and lo <= day <= hi:
            d = dict(r)
            d["day"] = day
            out.append(d)
    return out


def _event(r: dict, *, option: bool) -> dict:
    """One trade or closed strategy as the builders read it."""
    if option:
        net, result = _net_result(r.get("pnl_dollar"), r.get("result"))
        return {"ref": f"opt:{r['id']}", "symbol": r.get("underlying"),
                "entry_date": r.get("entry_date"), "exit_date": r.get("closed_at"),
                "net": net, "result": result, "day": r["day"], "estimated": False,
                "source": r.get("source"), "account_id": r.get("account_id")}
    gross = _num(r.get("pnl_dollar")) or 0.0
    net, result = _net_result(gross - (_num(r.get("fees")) or 0.0), r.get("result"))
    return {"ref": trade_ref_for_row(r), "symbol": r.get("symbol"),
            "entry_date": r.get("entry_date"), "exit_date": r.get("exit_date"),
            "net": net, "result": result, "day": r["day"], "estimated": bool(r.get("est")),
            "source": r.get("source"), "account_id": r.get("account_id")}


def _events(c: sqlite3.Connection, user_id: str, lo: str, hi: str) -> list[dict]:
    rows = [_event(r, option=False) for r in _counted(_equity_rows(c, user_id, lo, hi))]
    rows += [_event(r, option=True) for r in _counted(_strategy_rows(c, user_id, lo, hi))]
    return rows


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
        events = _events(c, user_id, read_lo, hi)
        in_range = [e for e in events if e["day"] >= lo]
        timed: list[tuple[dict, datetime]] = []
        loss_exits: list[datetime] = []
        dates_only = estimated = 0
        for e in _counted(events):
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
    if not in_range:
        lines = [S_TILT_NO_TRADES]
    elif not timed:
        lines = [S_TILT_NO_TIMES]
    else:
        lines = [f"{S_TILT_AFTER}: {g_after['text']}.", f"{S_TILT_OTHER}: {g_other['text']}.",
                 CAVEAT]
        if dates_only:
            lines.append(f"{_plural(dates_only, 'trade', 'trades')} with dates only "
                         f"{'is' if dates_only == 1 else 'are'} not counted.")
    if estimated and in_range:
        lines.append(f"{_plural(estimated, 'trade', 'trades')} with an estimated entry time "
                     f"{'is' if estimated == 1 else 'are'} not counted.")
    return {
        "asOf": _iso_utc(now_dt),
        "source": _origin([e.get("source") for e in in_range]),
        "from": lo, "to": hi, "windowMinutes": TILT_WINDOW_MIN,
        "after": _public(g_after), "other": _public(g_other),
        "datesOnly": dates_only, "estimated": estimated,
        "lines": lines,
    }


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


def my_revenge_clean_days(user_id: str, params: dict, now: datetime) -> dict:
    """Of the last `WINDOW` finished sessions: clean (no trades, or timed trades and no revenge
    flag), flagged, or not checked (only date-only trades, W10-R12)."""
    now_dt = _utc(now)
    clean_params(KIND_REVENGE, params)
    window = finished_sessions(now_dt)
    keys = [d.isoformat() for d in window]
    lo, hi = keys[0], keys[-1]
    # The day before the window: a prior loss there can still be the scene of a re-entry.
    read_lo = trading_days.session_on_or_before(window[0] - timedelta(days=1)).isoformat()
    with _read(None) as c, _deadline(c):
        events = _events(c, user_id, read_lo, hi)
        suppressed = _dismissed_pairs(c, user_id)
        by_day: dict[str, list[dict]] = {}
        timed_by_key: dict[tuple[str, str], list[dict]] = {}
        for e in _counted(events):
            if lo <= e["day"] <= hi:
                by_day.setdefault(e["day"], []).append(e)
            if _times(e) is not None:
                timed_by_key.setdefault((str(e["symbol"] or ""), e["day"]), []).append(e)
        flags: list[dict] = []
        for (sym, day), rows in _counted(sorted(timed_by_key.items())):
            if not (lo <= day <= hi):
                continue
            # The same symbol's timed rows on the session before ride along as priors only.
            prev = trading_days.session_on_or_before(
                date.fromisoformat(day) - timedelta(days=1)).isoformat()
            prior = timed_by_key.get((sym, prev), [])
            got = revenge_detect.detect(
                [{"tradeRef": e["ref"], "symbol": sym, "entry_date": e["entry_date"],
                  "exit_date": e["exit_date"], "pnlDollarNet": e["net"]} for e in prior + rows],
                suppressed_pairs=suppressed)
            own = {e["ref"] for e in rows}
            for f in got["flags"]:
                if f["tradeRef"] in own:
                    flags.append({"day": day, "symbol": sym,
                                  "minutesApart": _num(f["minutesApart"])})
    flagged_days = {f["day"] for f in flags}
    clean = checked = not_checked = 0
    for k in keys:
        rows = by_day.get(k) or []
        if not rows:
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
    traded = any(by_day.get(k) for k in keys)
    if not traded:
        lines = [S_REVENGE_NO_TRADES]
    elif checked == 0:
        lines = [S_REVENGE_NONE_CHECKED]
    elif clean == 0:
        lines = [S_REVENGE_EVERY_DAY]
    else:
        line = f"{clean} of {checked} clean"
        if not_checked:
            line += (f" ({_plural(not_checked, 'day', 'days')} with dates only "
                     f"{'was' if not_checked == 1 else 'were'} not checked)")
        lines = [line]
    out: dict[str, Any] = {
        "asOf": _iso_utc(now_dt),
        "source": _origin([e.get("source") for k in keys for e in by_day.get(k) or []]),
        "from": lo, "to": hi, "window": WINDOW,
        "clean": clean, "checked": checked, "notChecked": not_checked,
        "flagged": shown,
        "lines": lines,
    }
    if len(flags) > ROW_CAP:
        out["truncated"] = len(flags) - ROW_CAP
    return out


# -- Risk left today --------------------------------------------------------------------------------

def _today_nets(c: sqlite3.Connection, user_id: str, day: str, ids: list[str]) -> tuple[
        dict[str, float], bool, list]:
    """(net per account today, any of today's net has no nameable account, sources): equity after
    fees plus closed strategies (W9-R22). A trade without an account belongs to the only account
    when the member has exactly one."""
    only = ids[0] if len(ids) == 1 else None
    nets: dict[str, float] = {}
    unattributed = False
    sources: list = []
    events = [_event(r, option=False) for r in _counted(_equity_rows(c, user_id, day, day))]
    events += [_event(r, option=True) for r in _counted(_strategy_rows(c, user_id, day, day))]
    for e in _counted(events):
        acc = e.get("account_id") or only
        sources.append(e.get("source"))
        if acc is None or acc not in ids:
            unattributed = True
            continue
        nets[acc] = nets.get(acc, 0.0) + e["net"]
    return nets, unattributed, sources


def _open_strategy_counts(c: sqlite3.Connection, user_id: str) -> dict[str | None, int]:
    out: dict[str | None, int] = {}
    for (acc, n) in c.execute(
            "SELECT account_id, COUNT(*) FROM j2_option_strategies"
            " WHERE user_id = ? AND status = 'open' GROUP BY account_id", (user_id,)):
        out[acc] = int(n)
    return out


def _heat(user_id: str, account_id: str, size: float, c: sqlite3.Connection) -> dict:
    """`portfolio_heat` for one account, read-only: the size this widget read, the positions on this
    connection, no regime or brain read (neither feeds the open risk)."""
    from api.services import portfolio_heat
    from api.services.journal_two import positions as j2_positions

    def _positions(uid, acc):
        return j2_positions.list_open_positions(uid, c, account_id=acc) or []

    return portfolio_heat.portfolio_heat(
        user_id, account_id, size, positions_fn=_positions, regime_fn=lambda: {},
        cap_fn=lambda: None, account_size_fn=lambda _u, _a: size) or {}


def _room_line(left: float, limit: float) -> str:
    if left < 0 and _whole(left):
        return S_PAST_DAILY.format(x=_dollars(left))
    if _whole(left) == 0:
        return f"No room left today: your {_dollars(limit)} daily loss limit is used."
    return f"Room left today: {_dollars(left)} of {_dollars(limit)}."


def _account_block(c: sqlite3.Connection, user_id: str, a: dict, net: float,
                   open_options: int) -> dict:
    pct = _num(a.get("daily_loss_limit_pct"))
    size = accounts.own_account_size(a)
    block: dict[str, Any] = {"accountId": a["id"], "name": a.get("name"),
                             "limitPct": pct, "limit": None, "net": _num(net), "used": None,
                             "left": None, "openRisk": None, "afterStops": None, "noStop": None,
                             "openOptions": open_options, "lines": []}
    if size is None or size <= 0:
        block["lines"] = [S_RISK_NO_SIZE]
        return block
    limit = pct / 100.0 * size
    used = max(0.0, -net)
    left = limit - used
    block.update(limit=_num(limit), used=_num(used), left=_num(left))
    lines = [_room_line(left, limit)]
    heat = _heat(user_id, a["id"], size, c)
    if not heat.get("ok"):
        lines.append(S_RISK_UNREAD)
    else:
        per = heat.get("per_position") or []
        real = [p for p in per if not p.get("placeholder_stop")]
        no_stop = len(heat.get("placeholder_stops") or [])
        block["noStop"] = no_stop
        if real:
            risk = math.fsum(_num(p.get("risk_dollars")) or 0.0 for p in real)
            after = left - risk
            block.update(openRisk=_num(risk), afterStops=_num(after))
            if _whole(risk):
                lines.append(f"Open risk to stops: {_dollars(risk)}.")
            else:
                lines.append("Open risk to stops: under $1.")
            if after < 0 and _whole(after):
                lines.append(f"If every stop is hit: {_dollars(after)} past your limit.")
            elif _whole(after) == 0:
                lines.append("If every stop is hit: no room left.")
            else:
                lines.append(f"If every stop is hit: {_dollars(after)} left.")
        elif not no_stop:
            lines.append(S_RISK_NO_POSITIONS)
        if no_stop:
            lines.append(f"{_plural(no_stop, 'position', 'positions')} "
                         f"{'has' if no_stop == 1 else 'have'} no stop set and "
                         f"{'is' if no_stop == 1 else 'are'} not in the open risk.")
    if open_options:
        lines.append(f"{_plural(open_options, 'open options trade', 'open options trades')} "
                     f"{'is' if open_options == 1 else 'are'} not in the open risk.")
    block["lines"] = lines
    return block


def my_risk_left_today(user_id: str, params: dict, now: datetime) -> dict:
    """Per account with a daily loss limit and an own size: today's room (W10-R9) and the open risk
    to stops (`portfolio_heat`)."""
    now_dt = _utc(now)
    clean_params(KIND_RISK_LEFT, params)
    today = trading_days.today_et(now_dt).isoformat()
    with _read(None) as c, _deadline(c):
        accs = [dict(r) for r in c.execute(
            "SELECT * FROM j2_accounts WHERE user_id = ? ORDER BY created_at, id"
            f" LIMIT {READ_LIMIT}", (user_id,)).fetchall()]
        ids = [a["id"] for a in accs]
        limited = [a for a in accs if (_num(a.get("daily_loss_limit_pct")) or 0) > 0]
        blocks: list[dict] = []
        unattributed = False
        sources: list = []
        if limited:
            nets, unattributed, sources = _today_nets(c, user_id, today, ids)
            opens = _open_strategy_counts(c, user_id)
            if len(ids) == 1 and None in opens:
                opens[ids[0]] = opens.get(ids[0], 0) + opens.pop(None)
            for a in _counted(limited[:ROW_CAP]):
                blocks.append(_account_block(c, user_id, a, nets.get(a["id"], 0.0),
                                             opens.get(a["id"], 0)))
    if not limited:
        lines = [S_RISK_NO_LIMIT]
    elif all(b["limit"] is None for b in blocks):
        lines = [S_RISK_NO_SIZE]
    else:
        lines = []
        if unattributed:
            lines.append(S_RISK_UNATTRIBUTED)
    out: dict[str, Any] = {
        "asOf": _iso_utc(now_dt),
        "source": _origin(sources),
        "day": today,
        "accounts": blocks,
        "lines": lines,
    }
    if len(limited) > ROW_CAP:
        out["truncated"] = len(limited) - ROW_CAP
    return out


# -- Prop-firm rules --------------------------------------------------------------------------------

def _default_since(today: date) -> date:
    """The first session of the current month (the month's first day when that is after today)."""
    first = today.replace(day=1)
    s = trading_days.session_on_or_after(first)
    return s if s <= today else first


def _day_nets(c: sqlite3.Connection, user_id: str, acc: str | None, since: date,
              today: date):
    """The trading-days source scan from `since` to `today` (day net incl. options, the one
    authority), through the validated cover plan a built widget reads."""
    from api.services.journal_two.widget_engine import run as wrun
    from api.services.journal_two.widget_engine import sources as wsources
    plan = wrun._cover_plan("trading_days")
    rng = wplan.ResolvedRange(since.isoformat(), today.isoformat(), None, "since", None)
    return wsources.scan_days(c, plan, {"accountId": acc}, rng, user_id, today=today)


def _row_source(r: dict) -> list:
    origin = r.get("origin")
    if origin == "mixed":
        return ["broker" if o == "broker" else o for o in (r.get("origins") or [])]
    return [origin] if origin else []


def my_prop_firm(user_id: str, params: dict, now: datetime) -> dict:
    """A daily loss limit and a trailing max drawdown over the day nets from `since` (W10-R9)."""
    now_dt = _utc(now)
    today = trading_days.today_et(now_dt)
    p = clean_params(KIND_PROP_FIRM, params)
    since = date.fromisoformat(p["since"]) if "since" in p else _default_since(today)
    daily_limit, dd_limit = p.get("dailyLoss"), p.get("maxDrawdown")
    notices: list[str] = []
    from api.services.journal_two.widget_engine import sources as wsources
    with _read(None) as c, _deadline(c):
        asked = p.get("accountId")
        acc = wsources.owned_account_id(c, user_id, asked)
        if asked and acc is None:
            notices.append(S_ACCOUNT_GONE)
        scan = _day_nets(c, user_id, acc, since, today) if since <= today else None
        rows = list(reversed(scan.rows)) if scan else []          # oldest first
        cum = peak = 0.0
        traded = 0
        today_net = 0.0
        sources: list = []
        for r in _counted(rows):
            net = _num(r.get("net")) or 0.0
            cum += net
            peak = max(peak, cum)
            if (r.get("trade_count") or 0) > 0:
                traded += 1
                sources.extend(_row_source(r))
            if r.get("day") == today.isoformat():
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
    out: dict[str, Any] = {
        "asOf": _iso_utc(now_dt),
        "source": _origin(sources),
        "since": since.isoformat(),
        "countingFrom": counted_from.isoformat(),
        "accountId": acc,
        "daily": daily,
        "trailing": trailing,
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
