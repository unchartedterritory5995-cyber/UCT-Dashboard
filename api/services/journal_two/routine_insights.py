"""Notebook widgets wave 9 (Task 9.7): "vs P&L" comparisons and suggestions from the member's
own trades.

Two read-only comparisons and one read-time hint, all over the session member's rows only:

  * `routine_vs_pnl`: the average day net P&L (and win rate) on the routine's scheduled past
    sessions that had trades, split by whether the routine was done that day.
  * `tracker_vs_pnl`: the average day net P&L on past sessions with trades, split by the
    tracker's value range (`tracker_days.buckets`).
  * `suggestions`: per day, the opted-in items whose rule the day's trades satisfy. Computed at
    read time and NEVER written: nothing counts as done without the member's tick (W9-R5).

The facts each figure follows:
  * The day spine and the day net come from `widget_engine.sources.scan_days`, scanned with the
    trading-days cover plan (`run._cover_plan("trading_days")`), the same path a built widget
    reads, so a comparison and a widget agree. Day net is equity `pnl_dollar - fees` plus closed
    option strategies ("incl. options"); flagged trades are left out (`ANALYTICS_INCLUDED_SQL`).
  * A day counts only when it is FINISHED (before today ET; ruling W9-R13: as of yesterday, so a
    reading never moves while today's session is still open) and had at least one trade.
  * Routine history is read through `routines.history_for` (ruling W9-R15), bounded by
    `routine_days.MAX_HISTORY_SESSIONS`.
  * No zeros (ruling W9-R7): no days at all says `S_NO_DAYS`; fewer than `DEFAULT_MIN_N` days says
    `S_NOT_ENOUGH` with the count and shows no value; under `SMALL_SAMPLE_N` the group carries the
    "small" badge. Every sentence ends with `CAVEAT`.

Time is injected (`now=`) as a test seam only; the router never passes it.
"""
from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable

from api.services import placeholder_stop, session_calendar
from api.services.journal_two import accounts, revenge_detect, routine_days, routines
from api.services.journal_two import tracker_days, trackers, trading_days
from api.services.journal_two.filters import ANALYTICS_INCLUDED_SQL, _DAY
from api.services.journal_two.measures import DEFAULT_MIN_N, SMALL_SAMPLE_N
from api.services.journal_two.notebook_widgets import _num
from api.services.journal_two.timeutil import _is_date_only, _parse, compute_trading_day_et
from api.services.journal_two.widget_definitions import _read

CAVEAT = "A comparison, not proof."
S_NO_DAYS = "No days with trades yet."
S_NOT_ENOUGH = "Not enough days yet ({n})"
SUGGEST_LINE = "From your trades: looks done"

SUGGEST_RULES = ("stop_every_trade", "max_trades", "under_daily_loss_limit",
                 "no_trade_after_loss", "no_revenge")
MAX_TRADES_MIN, MAX_TRADES_MAX = 1, 20
AFTER_LOSS_DEFAULT_MIN = 10
AFTER_LOSS_MAX_MIN = 1000              # the store's own bound on a stored `n`

MINUS = "−"
_COUNTED_OTHER = ("not_done", "skipped")


# ── small helpers ──────────────────────────────────────────────────────────────────────────────

def _now(now: datetime | None) -> datetime:
    ts = now or datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def _half_up(v: float) -> int:
    return int(Decimal(repr(abs(v))).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def money(v: float) -> str:
    """Whole dollars: "+$95", "−$40" (U+2212), "$0". Thousands are grouped ("+$1,250")."""
    x = _num(v)
    if x is None:
        return "$0"
    whole = _half_up(x)
    if whole == 0:
        return "$0"
    return f"{'+' if x > 0 else MINUS}${whole:,}"


def _pct(v: float) -> str:
    return f"{_half_up(v * 100)}%"


def _sample(n: int) -> str:
    if n < DEFAULT_MIN_N:
        return "hide"
    if n < SMALL_SAMPLE_N:
        return "small"
    return ""


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


def _short(n: int) -> str | None:
    """The text that replaces a value shown on too few days, or None when the value may show."""
    if n == 0:
        return S_NO_DAYS
    if n < DEFAULT_MIN_N:
        return S_NOT_ENOUGH.format(n=n)
    return None


def _money_group(values: list[float]) -> dict:
    vals = [x for x in (_num(v) for v in values) if x is not None]
    n = len(vals)
    short = _short(n)
    avg = None if short else _num(math.fsum(vals) / n)
    return {"avg": avg, "n": n, "sample": _sample(n),
            "text": short or f"{money(avg)} average ({_days(n)})"}


def _rate_group(pairs: list[tuple[float, float]]) -> dict:
    """(wins, decisive) per day; days with no decisive trade are not counted (breakeven out)."""
    days = [(w, d) for w, d in pairs if d > 0]
    n = len(days)
    short = _short(n)
    avg = None if short else _num(sum(w for w, _ in days) / sum(d for _, d in days))
    return {"avg": avg, "n": n, "sample": _sample(n),
            "text": short or f"{_pct(avg)} win rate ({_days(n)})"}


def _value_text(g: dict) -> str:
    """A group's value as a sentence part: "−$40 (9 days)", or its replacement."""
    short = _short(g["n"])
    return short or f"{money(g['avg'])} ({_days(g['n'])})"


def _stop(part: str) -> str:
    """A sentence part ending in exactly one full stop (S_NO_DAYS already carries its own)."""
    return part if part.endswith(".") else part + "."


def _finished_day(today: date) -> date:
    """The last finished day as of `today` (W9-R13): yesterday."""
    return today - timedelta(days=1)


def _trading_rows(c: sqlite3.Connection, user_id: str, last: date, today: date,
                  split: dict | None = None) -> list[dict]:
    """The trading-days rows a built widget reads, every account, the member's first trade day to
    `last`, newest first; `split` (a routine or tracker ref) asks the scan for its ref columns."""
    from api.services.journal_two.widget_engine import plan as wplan
    from api.services.journal_two.widget_engine import run as wrun
    from api.services.journal_two.widget_engine import sources as wsources
    plan = dict(wrun._cover_plan("trading_days"))
    if split:
        plan["split"] = dict(split)
    rng = wplan.ResolvedRange(None, last.isoformat(), None, "all", "all")
    return wsources.scan_days(c, plan, {"accountId": None}, rng, user_id, today=today).rows


def _traded(rows: Iterable[dict]) -> dict[str, dict]:
    return {r["day"]: r for r in rows if (r.get("trade_count") or 0) > 0}


# ── routine vs P&L ─────────────────────────────────────────────────────────────────────────────

def routine_vs_pnl(user_id: str, rid: str, *, now: datetime | None = None,
                   conn: sqlite3.Connection | None = None) -> dict | None:
    """`{"done": Group, "other": Group, "winRate": {"done": Group, "other": Group}, "sentence"}`
    over the routine's scheduled finished sessions that had trades: "done" is a Done day,
    "other" a Not done or Skipped one. None for a foreign, unknown or deleted id."""
    today = trading_days.today_et(_now(now))
    last = _finished_day(today)
    with _read(conn) as c:
        hist = routines.history_for(c, user_id, rid, last, today).get(rid)
        if hist is None:
            return None
        states = {s.day: s.state for s in hist.states if s.day <= last.isoformat()}
        rows = _traded(_trading_rows(c, user_id, last, today)) if states else {}
    done = [rows[d] for d, st in states.items() if st == "done" and d in rows]
    other = [rows[d] for d, st in states.items() if st in _COUNTED_OTHER and d in rows]
    g_done = _money_group([r["net"] for r in done])
    g_other = _money_group([r["net"] for r in other])
    rate = {"done": _rate_group([(r["wins"], r["wins"] + r["losses"]) for r in done]),
            "other": _rate_group([(r["wins"], r["wins"] + r["losses"]) for r in other])}
    if g_done["n"] == 0 and g_other["n"] == 0:
        sentence = f"{S_NO_DAYS} {CAVEAT}"
    else:
        sentence = (f"On days you finished it: {_stop(g_done['text'])} "
                    f"Other days: {_stop(_value_text(g_other))} {CAVEAT}")
    return {"done": g_done, "other": g_other, "winRate": rate, "sentence": sentence}


# ── tracker vs P&L ─────────────────────────────────────────────────────────────────────────────

def _lower_first_word(label: str) -> str:
    head, sep, tail = label.partition(" ")
    return head.lower() + sep + tail


def _tracker_values(c: sqlite3.Connection, user_id: str, tid: str, lo: str,
                    hi: str) -> list[float]:
    """The values `_day_refs` buckets over for the same scan (so the bucket order agrees)."""
    if trackers.is_builtin(tid):
        from api.services.journal_two.widget_engine.sources import _checkins
        dim = "mood" if tid == "checkin:mood" else "focus"
        return [v[dim] for v in _checkins(c, user_id, lo, hi).values() if v.get(dim) is not None]
    return [x for (v,) in c.execute(
        "SELECT value FROM j2_tracker_values WHERE user_id = ? AND tracker_id = ?"
        " AND day BETWEEN ? AND ?", (user_id, tid, lo, hi)) if (x := _num(v)) is not None]


def tracker_vs_pnl(user_id: str, tid: str, *, now: datetime | None = None,
                   conn: sqlite3.Connection | None = None) -> dict | None:
    """`{"buckets": [{label, avg, n, sample, text}], "sentence"}`: the average day net P&L on the
    finished sessions with trades, by the tracker's value range on that day, in bucket order.
    None for a foreign, unknown or deleted id (the built-in check-ins are the member's own)."""
    today = trading_days.today_et(_now(now))
    last = _finished_day(today)
    with _read(conn) as c:
        meta = trackers.get(user_id, tid, conn=c)
        if meta is None:
            return None
        rows = _trading_rows(c, user_id, last, today,
                             split={"by": "tracker_bucket", "ref": tid})
        order: list[str] = []
        if rows:
            values = _tracker_values(c, user_id, tid, rows[-1]["day"], rows[0]["day"])
            order = [b.label for b in tracker_days.buckets(meta["kind"], values, meta["unit"])]
    by_label: dict[str, list[float]] = {}
    for r in _traded(rows).values():
        if r.get("tracker_bucket"):
            by_label.setdefault(r["tracker_bucket"], []).append(r["net"])
    order += [lb for lb in sorted(by_label) if lb not in order]
    out = []
    for label in order:
        g = _money_group(by_label.get(label, []))
        out.append({"label": label, **g})
    parts = []
    for b in (x for x in out if x["n"] > 0):
        value = _value_text(b)
        if not parts:
            lead = f"{meta['name']} {_lower_first_word(b['label'])}"
            parts.append(f"{lead}: {value}" if _short(b["n"]) else f"{lead}: avg day {value}")
        else:
            parts.append(f"{b['label']}: {value}")
    sentence = f"{_stop('; '.join(parts))} {CAVEAT}" if parts else f"{S_NO_DAYS} {CAVEAT}"
    return {"buckets": out, "sentence": sentence}


# ── suggestions ────────────────────────────────────────────────────────────────────────────────

def _int_n(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _rule_of(item: Any) -> tuple[str, int | None] | None:
    """(rule, n) of an opted-in item, or None. `max_trades` needs n in 1-20;
    `no_trade_after_loss` defaults n to 10 minutes."""
    suggest = getattr(item, "suggest", None) if not isinstance(item, dict) else item.get("suggest")
    if not isinstance(suggest, dict):
        return None
    rule = suggest.get("rule")
    if rule not in SUGGEST_RULES:
        return None
    n = _int_n(suggest.get("n"))
    if rule == "max_trades":
        if n is None or not MAX_TRADES_MIN <= n <= MAX_TRADES_MAX:
            return None
        return rule, n
    if rule == "no_trade_after_loss":
        if suggest.get("n") is None:
            return rule, AFTER_LOSS_DEFAULT_MIN
        if n is None or not 1 <= n <= AFTER_LOSS_MAX_MIN:
            return None
        return rule, n
    return rule, None


def opted_in(item: Any) -> bool:
    """Does this item ask for a suggestion from the member's trades?"""
    return _rule_of(item) is not None


def _eligible(day: date, now_dt: datetime) -> bool:
    """A past day, or today after its close (ET)."""
    today = trading_days.today_et(now_dt)
    if day < today:
        return True
    if day > today:
        return False
    close = session_calendar.close_time(day)
    return close is not None and now_dt >= close


def _timed(iso: Any) -> datetime | None:
    if not iso:
        return None
    dt = _parse(iso)
    if dt is None or _is_date_only(iso, dt):
        return None
    return dt


def day_facts(conn: sqlite3.Connection, user_id: str, days: Iterable[str], *,
              now: datetime) -> dict[str, dict | None]:
    """day -> the day's trades and loss limits, for each eligible day that had a trade; None for
    every other day. Two queries for all days (equity trades, option strategies) plus one for the
    member's accounts."""
    now_dt = _now(now)
    keep: list[str] = []
    for d in dict.fromkeys(days):
        try:
            dd = date.fromisoformat(str(d))
        except ValueError:
            continue
        if _eligible(dd, now_dt):
            keep.append(dd.isoformat())
    out: dict[str, dict | None] = {d: None for d in dict.fromkeys(str(x) for x in days)}
    if not keep:
        return out
    lo, hi = min(keep), max(keep)
    wanted = set(keep)
    trades: dict[str, list[dict]] = {}
    for tid, sym, entry, exit_, ep, stop, pnl, fees, acc, day in conn.execute(
            "SELECT id, symbol, entry_date, exit_date, entry_price, original_stop, pnl_dollar,"
            f" COALESCE(fees, 0), account_id, {_DAY} FROM j2_trades WHERE user_id = ?"
            f" {ANALYTICS_INCLUDED_SQL} AND {_DAY} BETWEEN ? AND ?", (user_id, lo, hi)):
        if day in wanted:
            trades.setdefault(day, []).append({
                "id": tid, "symbol": sym, "entry_date": entry, "exit_date": exit_,
                "entry_price": ep, "stop": stop, "account": acc,
                "net": float(pnl or 0) - float(fees or 0)})
    strategies: dict[str, int] = {}
    wide_lo = (date.fromisoformat(lo) - timedelta(days=1)).isoformat()
    wide_hi = (date.fromisoformat(hi) + timedelta(days=1)).isoformat() + "~"
    for tday, closed in conn.execute(
            "SELECT trading_day_et, closed_at FROM j2_option_strategies WHERE user_id = ?"
            " AND status != 'open' AND (trading_day_et BETWEEN ? AND ? OR closed_at BETWEEN ? AND ?)",
            (user_id, lo, hi, wide_lo, wide_hi)):
        day = tday or compute_trading_day_et(closed)
        if day in wanted:
            strategies[day] = strategies.get(day, 0) + 1
    accs = conn.execute("SELECT * FROM j2_accounts WHERE user_id = ?", (user_id,)).fetchall()
    limits: dict[str, float] = {}
    for a in accs:
        pct = _num(a["daily_loss_limit_pct"]) if "daily_loss_limit_pct" in a.keys() else None
        size = accounts.own_account_size(a)
        if pct is not None and pct > 0 and size is not None and size > 0:
            limits[a["id"]] = pct / 100.0 * size
    only = accs[0]["id"] if len(accs) == 1 else None
    for d in keep:
        eq = trades.get(d, [])
        n_opt = strategies.get(d, 0)
        if not eq and not n_opt:
            continue
        out[d] = {"trades": eq, "count": len(eq) + n_opt, "limits": limits, "only": only}
    return out


def _holds(rule: str, n: int | None, f: dict) -> bool:
    eq: list[dict] = f["trades"]
    if rule == "stop_every_trade":
        return bool(eq) and not any(placeholder_stop.is_placeholder_stop(t["stop"],
                                                                         t["entry_price"])
                                    for t in eq)
    if rule == "max_trades":
        return 1 <= f["count"] <= int(n)
    if rule == "under_daily_loss_limit":
        if not f["limits"]:
            return False                       # no account has a limit: no suggestion
        nets: dict[str, float] = {}
        for t in eq:
            acc = t["account"] or f["only"]
            nets[acc] = nets.get(acc, 0.0) + t["net"]
        return all(nets.get(acc, 0.0) > -limit for acc, limit in f["limits"].items())
    timed = [(t, _timed(t["entry_date"]), _timed(t["exit_date"])) for t in eq]
    if not eq or any(e is None or x is None for _, e, x in timed):
        return False                           # a date-only trade: the rule cannot be read
    if rule == "no_trade_after_loss":
        window = timedelta(minutes=int(n))
        for loss, _, lx in timed:
            if loss["net"] >= 0:
                continue
            for other, oe, _ in timed:
                if other is not loss and lx <= oe <= lx + window:
                    return False
        return True
    if rule == "no_revenge":
        found = revenge_detect.detect([{"id": t["id"], "symbol": t["symbol"],
                                        "entry_date": t["entry_date"],
                                        "exit_date": t["exit_date"],
                                        "pnlDollarNet": t["net"]} for t in eq])
        return not found["flags"]
    return False


def suggestions(conn: sqlite3.Connection, user_id: str, routine_items: list, days: list[str], *,
                now: datetime, facts: dict | None = None) -> dict[str, list[str]]:
    """day -> the ids of the opted-in items (valid that day) whose rule holds, for a day that is
    past (or today after its close) and had at least one trade; an empty list otherwise. Computed
    at read time and never written. `facts` (from `day_facts`) lets a caller read the day's
    trades once for many routines."""
    f_all = facts if facts is not None else day_facts(conn, user_id, days, now=now)
    out: dict[str, list[str]] = {}
    for d in dict.fromkeys(str(x) for x in days):
        f = f_all.get(d)
        out[d] = []
        if not f:
            continue
        day = date.fromisoformat(d)
        for it in routine_items or []:
            if isinstance(it, routine_days.Item):
                if not routine_days.items_on([it], day):
                    continue
                iid = it.id
            elif isinstance(it, dict) and isinstance(it.get("id"), str):
                iid = it["id"]
            else:
                continue
            rn = _rule_of(it)
            if rn is not None and _holds(rn[0], rn[1], f):
                out[d].append(iid)
    return out
