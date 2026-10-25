"""What a widget can look at (wave 8, Task 8.5): the three sources, their fields, and `CATALOG`.

A source is a label, a one-line description, the unit it counts in, its fields, and a `scan`
that reads the session member's rows in ONE bounded query (`compile.compile_scan`) and turns them
into plain dicts, one value per field key. `aggregate.evaluate` filters, splits and measures them.

A field is a typed, whitelisted column: its `sql` is a STATIC fragment written in this file (the
plan only picks its key) and its `py` computes the same value from the scanned row, so the
aggregator can filter rows that never touched SQL with identical results. Fields with no `sql`
are computed in Python only and filtered after the scan.

Ownership. `user_id` is always the caller's (the session member's). Every child table
(`j2_trade_excursions`, `j2_trade_adherence`, `j2_trade_plan_links`, `j2_note_checkins` joined to
`j2_notes`, `j2_day_notes`, `j2_option_strategies`, `j2_accounts`, and for the notes source
`j2_note_folders`, `j2_note_kinds` and the note property definitions) is read with `user_id = ?`. An
account id only narrows, and one that is not the member's reads as "all my accounts".

The facts each field follows (Global Constraints):
* net P&L is `pnl_dollar - fees`; the ET day is `filters._DAY`; the ET hour is the stored
  `hour_et`, NULL for a date-only trade (never derived from the UTC `exit_date`);
* effective R is `r_multiple`, else the excursion's `true_r` (`analytics._effective_r_map`);
* a placeholder stop (`placeholder_stop.is_placeholder_stop`) is "No stop set": no risk, no
  distance, never a 0;
* account size is read only through `accounts` (`read_member_account_size`, which asks
  `own_account_size`);
* a position whose entry time is estimated has no days open, and is counted in a footnote;
* a check-in in a sample note, or in a trashed note, is no check-in (`sample_marker`).
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable, Iterable

from api.services import placeholder_stop
from api.services.journal_two import accounts as j2_accounts
from api.services.journal_two import note_kinds as j2_note_kinds
from api.services.journal_two import note_properties
from api.services.journal_two import routine_days, sample_marker, timeutil, tracker_days, trading_days
from api.services.journal_two import routines as j2_routines
from api.services.journal_two import trackers as j2_trackers
from api.services.journal_two import calendar as j2_calendar
from api.services.journal_two.filters import _DAY, analytics_included_sql
from api.services.journal_two.notebook_widgets import _num
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import measures as wmeasures
from api.services.journal_two.widget_engine.plan import (
    FORMULA_PREFIX, OPS_BOOL, OPS_ENUM, OPS_NUMBER, PROP_MEASURES, PROPERTY_FIELD, RANGE_TOKENS,
    RIGHT_NOW_SOURCES, S_NO_EARLIER, S_UNKNOWN_FIELD, VIEWS, ResolvedRange, _UNBOUNDED_TOKENS,
    formula_field_infos,
    formula_of, plan_refs,
)

# ── field vocabulary ───────────────────────────────────────────────────────────────────────────

# OPS_ENUM, OPS_NUMBER and OPS_BOOL are plan's (one authority: formula filters use them too).
OPS_TEXT = ("in", "contains")
OPS_DAY = OPS_NUMBER
OPS_TAG = ("has_any",)
_OPS_BY_TYPE = {"enum": OPS_ENUM, "text": OPS_TEXT, "number": OPS_NUMBER, "day": OPS_DAY,
                "bool": OPS_BOOL, "tag": OPS_TAG}

#: Sessions a trading-days widget reads at most (ruling R-8).
MAX_SESSIONS = 3700
#: Calendar days searched for those sessions: 3,700 sessions is about 14.7 years.
_SESSION_SPAN_DAYS = 5500

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

#: Wave 9, ruling W9-R21: a routine day's state as stored in a plan's filter values and in a row;
#: the label is only how a group reads.
STATE_CODES = ("done", "not_done", "skipped", "off", "open")
#: The states a routine-history row can have (an off day is never a row).
HISTORY_STATES = ("done", "not_done", "skipped", "open")
#: One authority (M-2): the routine store's own words, with today's unticked day as "Not yet"
#: (ruling W9-R26; the code stays `open`).
STATE_LABELS = {**routine_days.STATE_LABELS, "open": "Not yet"}


def state_label(code: Any) -> str:
    return STATE_LABELS.get(code, str(code))


def _state_choices() -> tuple[tuple[str, str], ...]:
    """W9-R23: `routine_done`'s codes with their labels, derived (read when served)."""
    return tuple((c, STATE_LABELS[c]) for c in STATE_CODES)


def _state_order() -> tuple[str, ...]:
    """`routine_done`'s group order, read at call time (M-3)."""
    return STATE_CODES


def _history_order() -> tuple[str, ...]:
    """Routine history's `state` group order, read at call time (M-3)."""
    return HISTORY_STATES


def _history_choices() -> tuple[tuple[str, str], ...]:
    """W9-R23: routine history's `state` codes with their labels, derived (read when served)."""
    return tuple((c, STATE_LABELS[c]) for c in HISTORY_STATES)


@dataclass(frozen=True)
class Field:
    """One whitelisted field. `sql` is a static fragment (None: Python only); `py(row)` computes
    the field's value from the scanned row. `bucket` lists the values in display order for a
    bucketed field: a tuple, or a callable returning one, read at call time. `needs_times` marks a
    field only trades with entry AND exit times have."""
    key: str
    label: str
    type: str
    ops: tuple[str, ...]
    split: bool = False
    sql: str | None = None
    py: Callable[[dict], Any] | None = None
    #: the group order: a tuple, or a callable returning one (read at call time, M-3)
    bucket: tuple | Callable[[], tuple] | None = None
    needs_times: bool = False
    #: case-insensitive text (`UPPER(...)` in SQL, ASCII-only like SQLite's UPPER, in Python)
    ci: bool = False
    #: value -> the label a group shows (else `str(value)`)
    fmt: Callable[[Any], str] | None = None
    #: rows with no value form a group with this label; None: they leave the split, counted
    none_label: str | None = None
    #: what such a row lacks, for the split footnote ("no time" -> "3 trades have no time ...")
    missing: str | None = None
    #: a row key holding the group label (an account's name)
    label_from: str | None = None
    #: wave 9: "routine" | "tracker" when a filter or split on this field names one (`ref`)
    ref_kind: str | None = None
    #: False for a split-only field (a filter on it is refused)
    filterable: bool = True
    #: the closed set of values a member picks from for a filter, each with its label, as
    #: `((value, label), ...)` or a callable returning that (read when the vocabulary is served; the
    #: I-8 shape). A field may carry both: `bucket` orders its groups, `choices` lists its values.
    choices: Any = None
    #: W9-R21/R23: a filter on it may hold only the values of `choices` (codes, never labels)
    strict_choices: bool = False
    #: a row key holding a group's sort position (tracker buckets read low to high)
    order_from: str | None = None
    #: wave 10: a day field whose row also carries its ET hour under this key (the formula
    #: dialect's `Hour([day])` reads it; None: the day has no time of day)
    hour_key: str | None = None
    #: wave 10 (Task 10.7): the scan applies a filter on it through its own authority (a note
    #: property: `note_properties.property_filter_sql`); `aggregate` adds no Python twin
    scan_applied: bool = False


def _f(key, label, ftype, *, sql=None, py=None, split=False, **kw) -> Field:
    return Field(key, label, ftype, _OPS_BY_TYPE[ftype], split, sql,
                 py if py is not None else (lambda r, _k=key: r.get(_k)), **kw)


@dataclass(frozen=True)
class Scan:
    """One source's scanned rows (newest first) and what the scan knows about them."""
    source: str
    rows: list[dict]
    capped: bool
    earliest_day: str | None
    count: int
    account_id: str | None             # the account actually narrowed to (None: all accounts)
    footnotes: list[str] = field(default_factory=list)
    #: wave 9: sentences the widget leads with (a routine or tracker that is not available)
    notices: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Source:
    key: str
    label: str
    description: str
    unit: str
    fields: dict[str, Field]
    scan: Callable[..., Scan]
    #: (row key for a list row's label, row key for its second label)
    list_labels: tuple[str, str] = ("label", "label2")


# ── shared helpers ─────────────────────────────────────────────────────────────────────────────

def _dicts(cur: sqlite3.Cursor) -> list[dict]:
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def owned_account_id(conn: sqlite3.Connection, user_id: str, acc: str | None) -> str | None:
    """`acc` when it is one of `user_id`'s accounts, else None (absent, never another member's)."""
    if not acc:
        return None
    row = conn.execute("SELECT id FROM j2_accounts WHERE id = ? AND user_id = ?",
                       (acc, user_id)).fetchone()
    return acc if row else None


def _account_names(conn: sqlite3.Connection, user_id: str) -> dict[str, str]:
    return {r[0]: r[1] for r in conn.execute(
        "SELECT id, name FROM j2_accounts WHERE user_id = ?", (user_id,)).fetchall()}


_CHUNK = 500


def _in_chunks(conn: sqlite3.Connection, sql_head: str, user_id: str,
               keys: Iterable[str]) -> list[dict]:
    """`sql_head` ends in `trade_ref IN`; run it per chunk of keys, always scoped to the member."""
    keys = list(dict.fromkeys(keys))
    out: list[dict] = []
    for i in range(0, len(keys), _CHUNK):
        part = keys[i:i + _CHUNK]
        cur = conn.execute(f"{sql_head} ({','.join('?' * len(part))})", [user_id, *part])
        out.extend(_dicts(cur))
    return out


def _tags(raw: Any) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return []
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return [t for t in v if isinstance(t, str)]
    return []


def _weekday(day: Any) -> str | None:
    try:
        return WEEKDAYS[date.fromisoformat(str(day)[:10]).weekday()]
    except (TypeError, ValueError):
        return None


def _sort_key(iso: Any, seq: int) -> str:
    """An exit-time ordering key for the streak measures (`measures._ordered` sorts day then id):
    the UTC instant, then the scan position. Never the trade id."""
    dt = timeutil._parse(iso) if iso else None
    ts = dt.timestamp() if dt is not None else 0.0
    return f"{ts:017.3f}|{seq:07d}"


def _minutes_held(entry_iso: Any, exit_iso: Any) -> float | None:
    """Minutes from entry to exit, only when both carry a time of day."""
    if not entry_iso or not exit_iso:
        return None
    a, b = timeutil._parse(entry_iso), timeutil._parse(exit_iso)
    if a is None or b is None:
        return None
    if timeutil._is_date_only(entry_iso, a) or timeutil._is_date_only(exit_iso, b):
        return None
    mins = (b - a).total_seconds() / 60.0
    return round(mins, 1) if mins >= 0 else None


def _hold_bucket(days: Any) -> str | None:
    d = _num(days)
    if d is None:
        return None
    if d < 1:
        return "Same day"
    if d < 2:
        return "1 day"
    if d <= 5:
        return "2-5 days"
    if d <= 20:
        return "6-20 days"
    return "21+ days"


HOLD_BUCKETS = ("Same day", "1 day", "2-5 days", "6-20 days", "21+ days")

R_BUCKETS = ("-2R or worse", "-2R to -1R", "-1R to 0R", "0R to 1R", "1R to 2R", "2R to 3R",
             "Over 3R")


def _r_bucket(r: Any) -> str | None:
    v = _num(r)
    if v is None:
        return None
    if v <= -2:
        return R_BUCKETS[0]
    if v <= -1:
        return R_BUCKETS[1]
    if v < 0:
        return R_BUCKETS[2]
    if v < 1:
        return R_BUCKETS[3]
    if v < 2:
        return R_BUCKETS[4]
    if v <= 3:
        return R_BUCKETS[5]
    return R_BUCKETS[6]


QUARTILES = ("Q1 (smallest)", "Q2", "Q3", "Q4 (largest)")


def _quartiles(sizes: list[float | None]) -> list[str | None]:
    """Quartile of each size by rank among the sizes present (Q1 smallest)."""
    idx = sorted((i for i, s in enumerate(sizes) if s is not None), key=lambda i: sizes[i])
    out: list[str | None] = [None] * len(sizes)
    n = len(idx)
    for rank, i in enumerate(idx):
        out[i] = QUARTILES[min(3, rank * 4 // n)]
    return out


def _risk(entry: Any, stop: Any, shares: Any) -> float | None:
    """|entry - stop| x shares, or None for a placeholder stop ("No stop set", never a 0)."""
    if placeholder_stop.is_placeholder_stop(stop, entry):
        return None
    e, s, q = _num(entry), _num(stop), _num(shares)
    if e is None or s is None or q is None:
        return None
    return round(abs(e - s) * abs(q), 2)


def _yes_no(yes: str, no: str) -> Callable[[Any], str]:
    return lambda v: yes if v else no


_RESULT_LABELS = {"Win": "Win", "Loss": "Loss", "BE": "Breakeven"}
#: A row's `source` column -> its origin key (anything else was entered by hand).
_ROW_ORIGIN = {"broker": "broker", "csv": "csv"}
_ORIGIN_LABELS = {"manual": "Manual", "csv": "CSV import", "broker": "Broker"}


def _hour_label(h: Any) -> str:
    try:
        return f"{int(float(h))}:00 ET"
    except (TypeError, ValueError):
        return str(h)


def _bounded_range(rng: ResolvedRange, lo: date | None) -> ResolvedRange:
    return ResolvedRange(lo.isoformat() if lo else None, rng.to_day, rng.last_n, rng.label,
                         rng.token)


# ── closed trades ──────────────────────────────────────────────────────────────────────────────

_T_WEEKDAY = ("CASE strftime('%w', " + _DAY + ") WHEN '1' THEN 'Monday' WHEN '2' THEN 'Tuesday'"
              " WHEN '3' THEN 'Wednesday' WHEN '4' THEN 'Thursday' WHEN '5' THEN 'Friday'"
              " WHEN '6' THEN 'Saturday' WHEN '0' THEN 'Sunday' END")
_T_ORIGIN = ("CASE WHEN t.source = 'broker' THEN 'broker' WHEN t.source = 'csv' THEN 'csv'"
             " ELSE 'manual' END")

#: What `j2_trades.side` / `j2_positions.side` hold (csv_import refuses anything else).
SIDE_CHOICES = (("Long", "Long"), ("Short", "Short"))


def _regime_choices() -> list[tuple[str, str]]:
    """The regime ids `j2_trades.regime` stores, with the member's word for each (regime.regime_words,
    the one authority: "amber" reads "Yellow"). Read lazily, when the vocabulary is served."""
    from api.services.journal_two.regime import regime_words
    return list(regime_words().items())


CLOSED_FIELDS: dict[str, Field] = {f.key: f for f in [
    _f("day", "Day", "day", sql=_DAY, split=True, hour_key="hour_et"),
    _f("hour_et", "ET hour", "number", sql="t.hour_et", split=True, fmt=_hour_label,
       missing="no time"),
    _f("weekday", "Weekday", "enum", sql=_T_WEEKDAY, py=lambda r: _weekday(r.get("day")),
       split=True, bucket=WEEKDAYS),
    _f("month", "Month", "enum", sql="substr(" + _DAY + ", 1, 7)",
       py=lambda r: (str(r["day"])[:7] if r.get("day") else None), split=True),
    _f("symbol", "Symbol", "text", sql="t.symbol", split=True, ci=True),
    _f("side", "Side", "enum", sql="t.side", split=True, choices=SIDE_CHOICES),
    _f("setup", "Setup", "enum", sql="t.setup", split=True, none_label="No setup"),
    _f("result", "Result", "enum", sql="t.result", split=True,
       fmt=lambda v: _RESULT_LABELS.get(v, str(v)), bucket=("Win", "Loss", "BE")),
    _f("net", "Net P&L", "number", sql="(t.pnl_dollar - COALESCE(t.fees, 0))"),
    _f("gross", "Gross P&L", "number", sql="t.pnl_dollar"),
    _f("fees", "Fees", "number", sql="COALESCE(t.fees, 0)"),
    _f("r", "R", "number"),
    _f("risk_dollars", "Risk $", "number"),
    _f("pct_return", "% return", "number", sql="(t.pnl_percent * 100)"),
    _f("hold_days", "Hold days", "number", sql="t.hold_days"),
    _f("hold_bucket", "Hold time", "enum", split=True, bucket=HOLD_BUCKETS),
    _f("hold_minutes", "Hold minutes", "number", needs_times=True),
    _f("shares", "Shares", "number", sql="t.shares"),
    _f("size_quartile", "Size quartile", "enum", split=True, bucket=QUARTILES),
    _f("regime", "Regime at entry", "enum", sql="t.regime", split=True,
       none_label="No regime recorded", choices=_regime_choices),
    _f("mistake", "Mistake", "tag", sql="t.mistake_tags", py=lambda r: r.get("mistake"),
       split=True, none_label="No mistake tagged"),
    _f("emotion", "Emotion", "tag", sql="t.emotion_tags", py=lambda r: r.get("emotion"),
       split=True, none_label="No emotion tagged"),
    _f("origin", "How it was logged", "enum", sql=_T_ORIGIN, split=True,
       fmt=lambda v: _ORIGIN_LABELS.get(v, str(v)), bucket=("manual", "csv", "broker")),
    _f("account", "Account", "enum", sql="t.account_id", split=True, label_from="account_name",
       none_label="No account"),
    _f("had_stop", "Had a stop", "bool", split=True, fmt=_yes_no("Had a stop", "No stop set")),
    _f("mfe_r", "MFE R", "number"),
    _f("mae_r", "MAE R", "number"),
    _f("exit_efficiency", "Exit efficiency", "number"),
    _f("adherence_pct", "Followed my trading plan %", "number"),
    _f("plan_linked", "Linked to a trading plan note", "bool", split=True,
       fmt=_yes_no("Linked to a trading plan", "No trading plan linked")),
    _f("r_bucket", "R bucket", "enum", split=True, bucket=R_BUCKETS, missing="no R"),
]}


def _closed_rows(conn: sqlite3.Connection, user_id: str, raw: list[dict]) -> list[dict]:
    refs = [trade_ref_for_row(r) for r in raw]
    exc = {r["trade_ref"]: r for r in _in_chunks(
        conn, "SELECT trade_ref, true_r, mfe_r, mae_r, exit_efficiency FROM j2_trade_excursions"
              " WHERE user_id = ? AND trade_ref IN", user_id, refs)}
    adh = {r["trade_ref"]: r for r in _in_chunks(
        conn, "SELECT trade_ref, adherence_pct, total_rules FROM j2_trade_adherence"
              " WHERE user_id = ? AND trade_ref IN", user_id, refs)}
    linked = {r["trade_ref"] for r in _in_chunks(
        conn, "SELECT trade_ref FROM j2_trade_plan_links WHERE user_id = ? AND trade_ref IN",
        user_id, refs)}
    names = _account_names(conn, user_id)
    n = len(raw)
    out: list[dict] = []
    for i, (r, ref) in enumerate(zip(raw, refs)):
        gross = _num(r.get("pnl_dollar"))
        fees = _num(r.get("fees")) or 0.0
        e = exc.get(ref) or {}
        a = adh.get(ref) or {}
        r_eff = _num(r.get("r_multiple"))
        if r_eff is None:
            r_eff = _num(e.get("true_r"))
        adherence = _num(a.get("adherence_pct")) if (a.get("total_rules") or 0) > 0 else None
        pct = _num(r.get("pnl_percent"))
        base = {
            "_tid": r["id"],
            # the streak order: exit instant, then newest-first scan position reversed
            "id": _sort_key(r.get("exit_date"), n - i),
            "day": r.get("day"),
            "hour_et": _num(r.get("hour_et")),
            "symbol": r.get("symbol"),
            "side": r.get("side"),
            "setup": r.get("setup") or None,
            "result": r.get("result"),
            "net": None if gross is None else round(gross - fees, 6),
            "gross": gross,
            "fees": fees,
            "r": r_eff,
            "risk_dollars": _risk(r.get("entry_price"), r.get("original_stop"), r.get("shares")),
            "pct_return": None if pct is None else pct * 100.0,
            "hold_days": _num(r.get("hold_days")),
            "hold_minutes": _minutes_held(r.get("entry_date"), r.get("exit_date")),
            "shares": _num(r.get("shares")),
            "regime": r.get("regime") or None,
            "mistake": _tags(r.get("mistake_tags")),
            "emotion": _tags(r.get("emotion_tags")),
            "origin": _ROW_ORIGIN.get(r.get("source"), "manual"),
            "account": r.get("account_id") or None,
            "account_name": names.get(r.get("account_id")),
            "had_stop": not placeholder_stop.is_placeholder_stop(
                r.get("original_stop"), r.get("entry_price")),
            "mfe_r": _num(e.get("mfe_r")),
            "mae_r": _num(e.get("mae_r")),
            "exit_efficiency": _num(e.get("exit_efficiency")),
            "adherence_pct": None if adherence is None else adherence * 100.0,
            "plan_linked": ref in linked,
            "flagged": bool(r.get("analytics_excluded")),
            "_size": (None if _num(r.get("shares")) is None or _num(r.get("entry_price")) is None
                      else abs(_num(r["shares"]) * _num(r["entry_price"]))),
            "label": r.get("symbol"),
            "label2": r.get("day"),
        }
        base["weekday"] = _weekday(base["day"])
        base["month"] = str(base["day"])[:7] if base["day"] else None
        base["hold_bucket"] = _hold_bucket(base["hold_days"])
        base["r_bucket"] = _r_bucket(r_eff)
        out.append(base)
    for row, q in zip(out, _quartiles([r.pop("_size") for r in out])):
        row["size_quartile"] = q
    return out


def scan_closed(conn: sqlite3.Connection, plan: dict, settings: dict | None,
                rng: ResolvedRange, user_id: str, *, today: date | None = None) -> Scan:
    acc = owned_account_id(conn, user_id, wcompile.account_param(plan, settings))
    sql, params = wcompile.compile_scan(CLOSED, plan, settings, rng, user_id)
    raw = _dicts(conn.execute(sql, params))
    over = len(raw) > wcompile.SCAN_ROWS
    raw = raw[:wcompile.SCAN_ROWS]
    rows = _closed_rows(conn, user_id, raw)
    capped = rng.last_n is None and over
    if wcompile.last_n_after_filters(CLOSED, plan, rng):
        # Keep the newest N rows that pass every filter; a flagged row (list view) is shown
        # but does not use up one of the N.
        from api.services.journal_two.widget_engine import aggregate
        kept = aggregate.apply_filters(rows, plan, CLOSED, check=wcompile.check_deadline)
        out, n = [], 0
        for r in kept:
            if n >= int(rng.last_n):
                break
            out.append(r)
            if not r.get("flagged"):
                n += 1
        rows = out
        capped = over and n < int(rng.last_n)
    return Scan("closed_trades", rows, capped, rows[-1]["day"] if rows else None, len(rows), acc)


# ── open positions ─────────────────────────────────────────────────────────────────────────────

POSITION_FIELDS: dict[str, Field] = {f.key: f for f in [
    _f("symbol", "Symbol", "text", sql="p.symbol", split=True, ci=True),
    _f("side", "Side", "enum", sql="p.side", split=True, choices=SIDE_CHOICES),
    _f("setup", "Setup", "enum", sql="p.setup", split=True, none_label="No setup"),
    _f("days_open", "Days open", "number"),
    _f("unrealised", "Unrealised P&L", "number"),
    _f("risk_dollars", "Risk to stop $", "number"),
    _f("risk_pct_account", "Risk to stop, % of account", "number"),
    _f("pct_account", "% of account", "number"),
    _f("account", "Account", "enum", sql="p.account_id", split=True, label_from="account_name",
       none_label="No account"),
    _f("had_stop", "Has a stop", "bool", split=True, fmt=_yes_no("Has a stop", "No stop set")),
]}

DAYS_OPEN_ESTIMATED = ("{n} {positions} {have} an estimated entry date and {are} not counted in "
                       "days open.")


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def _position_rows(conn: sqlite3.Connection, user_id: str, raw: list[dict],
                   today: date) -> tuple[list[dict], int]:
    names = _account_names(conn, user_id)
    sizes: dict[str | None, float | None] = {}
    estimated = 0
    out = []
    for r in raw:
        acc = r.get("account_id") or None
        if acc not in sizes:
            sizes[acc] = j2_accounts.read_member_account_size(user_id, conn, account_id=acc)
        size = sizes[acc]
        est = bool(r.get("entry_estimated"))
        entry_day = trading_days.entry_day_et(r.get("entry_date"), estimated=est)
        if est:
            estimated += 1
        days_open = None
        if entry_day:
            try:
                days_open = float((today - date.fromisoformat(entry_day)).days)
            except ValueError:
                days_open = None
        entry, shares, mark = _num(r.get("entry_price")), _num(r.get("shares")), _num(
            r.get("broker_price"))
        unreal = None
        if mark is not None and entry is not None and shares is not None:
            unreal = round((mark - entry) * shares * (1 if r.get("side") == "Long" else -1), 2)
        risk = _risk(r.get("entry_price"), r.get("stop_price"), r.get("shares"))
        if risk is not None and entry is not None:
            stop = _num(r.get("stop_price"))
            # Risk is only the LOSS-side distance: a stop on the profit side risks nothing.
            if stop is not None and (stop >= entry if r.get("side") == "Long" else stop <= entry):
                risk = 0.0
        price = mark if mark is not None else entry
        value = None if price is None or shares is None else abs(price * shares)
        out.append({
            "_tid": r["id"],
            "symbol": r.get("symbol"),
            "side": r.get("side"),
            "setup": r.get("setup") or None,
            "days_open": days_open,
            "unrealised": unreal,
            "risk_dollars": risk,
            "risk_pct_account": (None if risk is None or not size or size <= 0
                                 else round(risk / size * 100.0, 4)),
            "pct_account": (None if value is None or not size or size <= 0
                            else round(value / size * 100.0, 4)),
            "account": acc,
            "account_name": names.get(acc),
            "had_stop": risk is not None,
            "entry_estimated": est,
            # 8.6 C-3: the same broker / CSV / manual meaning as a closed trade's origin
            "origin": _ROW_ORIGIN.get(r.get("source"), "manual"),
            "flagged": False,
            "label": r.get("symbol"),
            "label2": entry_day or "Entry date estimated",
        })
    return out, estimated


def scan_positions(conn: sqlite3.Connection, plan: dict, settings: dict | None,
                   rng: ResolvedRange, user_id: str, *, today: date | None = None) -> Scan:
    """Open positions now; a date range does not apply to what is open."""
    today = today or trading_days.today_et()
    acc = owned_account_id(conn, user_id, wcompile.account_param(plan, settings))
    sql, params = wcompile.compile_scan(POSITIONS, plan, settings, rng, user_id)
    raw = _dicts(conn.execute(sql, params))
    capped = len(raw) > wcompile.SCAN_ROWS
    rows, _estimated = _position_rows(conn, user_id, raw[:wcompile.SCAN_ROWS], today)
    # The estimated-entry footnote is the aggregator's: it counts only the positions that
    # survive every filter (fix round 1, Minor 1).
    return Scan("open_positions", rows, capped, None, len(rows), acc)


def _uses(plan: dict, key: str) -> bool:
    """Does the plan read `key` (a filter, a split, or a measure that needs it)?"""
    if any(f.get("field") == key for f in plan.get("filters") or []):
        return True
    split = plan.get("split") or {}
    if key in (split.get("by"), split.get("then")):
        return True
    ms = wmeasures.builder_measures()
    return any(key in getattr(ms.get(m.get("key")), "needs", ()) for m in plan.get("measures") or [])


# ── trading days ───────────────────────────────────────────────────────────────────────────────

DAY_FIELDS: dict[str, Field] = {f.key: f for f in [
    _f("day", "Day", "day", split=True),
    _f("weekday", "Weekday", "enum", split=True, bucket=WEEKDAYS),
    _f("day_net", "Day net P&L (incl. options)", "number"),
    _f("trade_count", "Trades that day", "number"),
    _f("day_win_rate", "Win rate that day", "number"),
    _f("best_trade", "Best trade that day", "number"),
    _f("worst_trade", "Worst trade that day", "number"),
    _f("mood", "Check-in mood", "number", split=True, missing="no check-in mood"),
    _f("focus", "Check-in focus", "number", split=True, missing="no check-in focus"),
    _f("had_day_note", "Had a day note", "bool", split=True,
       fmt=_yes_no("Had a day note", "No day note")),
    # Wave 9: the day as one of the member's routines or trackers saw it (the field's `ref`).
    # W9-R21: codes stored, labels shown; an off day is its own group, a day before the routine
    # existed is left out of the split (and counted).
    _f("routine_done", "Routine done", "enum", split=True, ref_kind="routine",
       bucket=_state_order, choices=_state_choices, strict_choices=True, fmt=state_label,
       missing="no routine yet"),
    _f("tracker_value", "Tracker value", "number", ref_kind="tracker",
       missing="no value for this tracker"),
    _f("tracker_bucket", "Tracker value range", "enum", split=True, ref_kind="tracker",
       missing="no value for this tracker", order_from="tracker_bucket_order"),
]}


OFF_SESSION_FOLDED = "{n} {trades} dated on a weekend or holiday {is_} counted on the session before."


def _first_day(conn: sqlite3.Connection, user_id: str, acc: str | None) -> date | None:
    """The member's first trade or closed option day: where an "all" range starts (R-8)."""
    sql = f"SELECT MIN({_DAY}) FROM j2_trades t WHERE t.user_id = ? " + analytics_included_sql("t")
    params: list = [user_id]
    if acc:
        sql += " AND t.account_id = ?"
        params.append(acc)
    days = [conn.execute(sql, params).fetchone()[0]]
    ssql = ("SELECT MIN(COALESCE(trading_day_et, substr(closed_at, 1, 10)))"
            " FROM j2_option_strategies WHERE user_id = ? AND status != 'open'")
    sparams: list = [user_id]
    if acc:
        ssql += " AND account_id = ?"
        sparams.append(acc)
    days.append(conn.execute(ssql, sparams).fetchone()[0])
    found = [d for d in days if d]
    if not found:
        return None
    try:
        return date.fromisoformat(min(found)[:10])
    except ValueError:
        return None


def _nth_newest_trade_day(conn: sqlite3.Connection, user_id: str, acc: str | None,
                          n: int) -> date | None:
    sql = f"SELECT {_DAY} FROM j2_trades t WHERE t.user_id = ? " + analytics_included_sql("t")
    params: list = [user_id]
    if acc:
        sql += " AND t.account_id = ?"
        params.append(acc)
    sql += f" ORDER BY {_DAY} DESC, t.id DESC LIMIT {max(1, min(int(n), wcompile.LAST_N_MAX))}"
    days = [r[0] for r in conn.execute(sql, params).fetchall() if r[0]]
    if not days:
        return None
    try:
        return date.fromisoformat(min(days)[:10])
    except ValueError:
        return None


def _checkins(conn: sqlite3.Connection, user_id: str, lo: str, hi: str) -> dict[str, dict]:
    """day -> {mood, focus}: per dimension, the value from the check-in whose NOTE was updated
    last (a trashed note's check-in is gone; a sample note's is never the member's)."""
    sql = ("SELECT c.day, c.mood, c.focus FROM j2_note_checkins c"
           " JOIN j2_notes n ON n.id = c.note_id"
           " WHERE c.user_id = ? AND n.user_id = ? AND n.deleted_at IS NULL"
           " AND " + sample_marker.not_sample_sql("n") +
           " AND c.day BETWEEN ? AND ?"
           " ORDER BY n.updated_at ASC, c.note_id ASC, c.embed_id ASC")
    out: dict[str, dict] = {}
    for r in conn.execute(sql, (user_id, user_id, lo, hi)).fetchall():
        d = out.setdefault(r[0], {"mood": None, "focus": None})
        for i, dim in ((1, "mood"), (2, "focus")):
            v = r[i]
            if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 5:
                d[dim] = float(v)
    return out


def scan_days(conn: sqlite3.Connection, plan: dict, settings: dict | None,
              rng: ResolvedRange, user_id: str, *, today: date | None = None) -> Scan:
    """One row per session in the range, including sessions with no trades."""
    acc = owned_account_id(conn, user_id, wcompile.account_param(plan, settings))
    hi = date.fromisoformat(rng.to_day)
    if rng.last_n is not None:
        lo = _nth_newest_trade_day(conn, user_id, acc, rng.last_n)
    elif rng.from_day:
        lo = date.fromisoformat(rng.from_day)
    else:
        lo = _first_day(conn, user_id, acc)
    if lo is None or lo > hi:
        return Scan("trading_days", [], False, None, 0, acc)
    floor = hi - timedelta(days=_SESSION_SPAN_DAYS)
    capped = lo < floor
    sr = trading_days.sessions(max(lo, floor), hi)
    days = sr.days
    truncated = len(days) > MAX_SESSIONS
    if truncated:
        days, capped = days[-MAX_SESSIONS:], True
    if not days:
        return Scan("trading_days", [], capped, None, 0, acc)
    lo_s, hi_s = days[0].isoformat(), days[-1].isoformat()
    # Trades and closes are read over the CALENDAR span, so one stamped on a weekend or a
    # holiday inside the range is counted (on the session before) and the range's total
    # still equals the calendar's.
    span_lo = lo_s if truncated else max(lo, floor).isoformat()
    span_hi = hi.isoformat()
    session_keys = {d.isoformat() for d in days}
    folded = 0

    def _session_of(d: str) -> str | None:
        if d in session_keys:
            return d
        try:
            prev = trading_days.session_on_or_before(date.fromisoformat(d[:10])).isoformat()
        except ValueError:
            return None
        return prev if prev >= lo_s else lo_s      # before the first session: the first one

    bounded = ResolvedRange(span_lo, span_hi, None, rng.label, rng.token)
    sql, params = wcompile.compile_scan(DAYS, plan, {"accountId": acc}, bounded, user_id)
    equity = [r for r in _dicts(conn.execute(sql, params)) if r.get("day")]

    # Closed option strategies, the calendar's own fetch, folded the way the calendar folds them.
    sql_lo = (date.fromisoformat(span_lo) - timedelta(days=1)).isoformat() + "T00:00:00Z"
    sql_hi = (hi + timedelta(days=1)).isoformat() + "T23:59:59Z"
    strategies = j2_calendar._fetch_strategies_in_window(
        user_id, sql_lo, sql_hi, conn, account_id=acc, et_lo=span_lo, et_hi=span_hi)
    bucket: dict[str, dict[str, Any]] = {}
    extremes: dict[str, list[float]] = {}
    #: session -> [broker-imported, CSV-imported, all] equity trades (8.6 C-3: the row's origin)
    by_origin: dict[str, list[int]] = {}
    for e in equity:
        d = _session_of(e["day"])
        if d is None:
            continue
        o = by_origin.setdefault(d, [0, 0, 0])
        o[0] += int(e.get("broker_n") or 0)
        o[1] += int(e.get("csv_n") or 0)
        o[2] += int(e.get("n") or 0)
        if d != e["day"]:
            folded += int(e.get("n") or 0)
        b = bucket.setdefault(d, j2_calendar._empty_bucket(d))
        b["pnlDollar"] += float(e.get("net") or 0.0)
        b["tradeCount"] += int(e.get("n") or 0)
        b["winners"] += int(e.get("wins") or 0)
        b["losers"] += int(e.get("losses") or 0)
        extremes.setdefault(d, []).extend(
            v for v in (_num(e.get("best")), _num(e.get("worst"))) if v is not None)
    for st in strategies:
        raw_day = strategy_close_day(st)              # W10-R52: the one ET-day authority
        if not raw_day or not (span_lo <= raw_day <= span_hi):
            continue
        d = _session_of(raw_day)
        if d is None:
            continue
        if d != raw_day:
            folded += 1
        b = bucket.setdefault(d, j2_calendar._empty_bucket(d))
        b["pnlDollar"] += float(st["pnl_dollar"] or 0)
        b["tradeCount"] += 1
        if st["result"] == "Win":
            b["winners"] += 1
        elif st["result"] == "Loss":
            b["losers"] += 1
        v = _num(st["pnl_dollar"])
        if v is not None:
            extremes.setdefault(d, []).append(v)

    checkins = _checkins(conn, user_id, lo_s, hi_s)
    noted = {r[0] for r in conn.execute(
        "SELECT date FROM j2_day_notes WHERE user_id = ? AND date BETWEEN ? AND ?",
        (user_id, lo_s, hi_s)).fetchall()}

    rows = []
    for d in reversed(days):                      # newest first, like every scan
        k = d.isoformat()
        b = bucket.get(k)
        count = int(b["tradeCount"]) if b else 0
        decisive = (int(b["winners"]) + int(b["losers"])) if b else 0
        ex = extremes.get(k) or []
        net = round(float(b["pnlDollar"]), 6) if b else 0.0
        c = checkins.get(k) or {}
        row_origin: dict[str, str] = {}
        broker_n, csv_n, equity_n = by_origin.get(k, (0, 0, 0))
        if equity_n:
            # A day of equity trades, with a closed trade's origin values (broker / csv / manual):
            # the one present, or "mixed" when the day has more than one. Option strategies carry
            # no origin here and do not set it.
            present = [o for o, c in (("broker", broker_n), ("csv", csv_n),
                                      ("manual", equity_n - broker_n - csv_n)) if c > 0]
            row_origin["origin"] = present[0] if len(present) == 1 else "mixed"
            if len(present) > 1:
                # which ones: a CSV + hand-logged day is "mixed" here but has no broker trade
                row_origin["origins"] = present
        rows.append({
            **row_origin,
            "day": k,
            "weekday": _weekday(k),
            "day_net": net if count else None,
            "net": net,                              # what the day measures read
            "trade_count": float(count),
            "day_win_rate": (int(b["winners"]) / decisive) if decisive else None,
            # decisive counts, so a win rate pooled over many days excludes breakeven trades
            "wins": float(int(b["winners"])) if b else 0.0,
            "losses": float(int(b["losers"])) if b else 0.0,
            "best_trade": max(ex) if ex else None,
            "worst_trade": min(ex) if ex else None,
            "mood": c.get("mood"),
            "focus": c.get("focus"),
            "had_day_note": k in noted,
            "flagged": False,
            "label": k,
            "label2": _weekday(k),
        })
    notes = []
    if folded:
        notes.append(OFF_SESSION_FOLDED.format(
            n=folded, trades=_plural(folded, "trade", "trades"),
            is_=_plural(folded, "is", "are")))
    if sr.beyond_from is not None:
        notes.append(trading_days.beyond_note(sr.beyond_from))
    ref_notes, notices = _day_refs(conn, user_id, plan, rows, checkins, lo_s, hi_s,
                                   today or trading_days.today_et())
    notes.extend(ref_notes)
    return Scan("trading_days", rows, capped, rows[-1]["day"], len(rows), acc, notes, notices)


# ── routine and tracker history (wave 9, Task 9.8) ─────────────────────────────────────────────
#
# Both read only the session member's rows, never the sample book (`run.NO_SAMPLE_SOURCES`), newest
# first, at most `wcompile.SCAN_ROWS` rows (`capped` past it). Routines are read ONLY through the
# routine store's public `routines.history_for` (ruling W9-R15). A routine's rows are its SCHEDULED
# days (an off day never appears, nor a day before it existed or after it was archived, W9-R20);
# today, not yet done, reads Not yet (W9-R26; the code is `open`).
#
# Bounds (ruling W9-R17): each routine's history starts at its own floor, the later of its created
# day and its 20th counted day before the range (`routine_days.window_floor`, W9-R25), so its
# rolling consistency equals the routine's own read and one sparse routine widens nothing else;
# a routine with no scheduled day in the window is not read at all (W9-R36); a first window reads
# only the newest sessions that can hold the cap, and when a schedule-only upper bound on the whole
# range's rows is within the cap, the whole range is read once (W9-R39); at most `MAX_ROUTINES`
# routines (the most recently used) are read; the item expansion stops at the newest
# `SCAN_ROWS + 1` rows; the Python loops ask `wcompile.check_deadline()`.

#: At most this many routines are read for one routine-history widget (W9-R17).
MAX_ROUTINES = 60
S_MORE_ROUTINES = "Showing your {n} most recently used routines."
#: Ruling W9-R18: a routine or tracker a field names that is not the member's (foreign or deleted:
#: the two read the same) is ONE notice, and no off-day or no-value footnote.
S_ROUTINE_GONE = "That routine isn't available."
S_TRACKER_GONE = "That tracker isn't available."
#: Spec 16.4 (the 9.4 carry): a traded schedule leaves an estimated (broker placeholder) entry date
#: out of the days you traded; how many is said, never hidden.
ESTIMATED_ENTRIES = ("{n} {positions} with an estimated entry date {is_} not counted as a day "
                     "you traded.")
_COUNTED = ("done", "not_done", "skipped")
_CHECK_EVERY = 256


def _month_of(day: Any) -> str | None:
    return str(day)[:7] if day else None


def _splits_by(plan: dict, key: str) -> bool:
    split = plan.get("split") or {}
    return key in (split.get("by"), split.get("then"))


def _wanted_routines(plan: dict) -> tuple[set[str] | None, set[str]]:
    """(only these ids, or None for all; never these ids) from the plan's `routine` filters."""
    only: set[str] | None = None
    never: set[str] = set()
    for f in plan.get("filters") or []:
        if f.get("field") != "routine":
            continue
        vals = {v for v in f.get("values") or [] if isinstance(v, str)}
        if f.get("op") == "in":
            only = vals if only is None else only & vals
        elif f.get("op") == "not_in":
            never |= vals
    return only, never


def _scan_routine_ids(conn: sqlite3.Connection, user_id: str,
                      plan: dict) -> tuple[list[str], int]:
    """The member's routine ids a scan reads (not deleted; archived ones keep their history), the
    most recently used first (a routine's newest ticked day or edit), at most `MAX_ROUTINES`; and how
    many there were in all."""
    only, never = _wanted_routines(plan)
    rows = conn.execute(
        "SELECT r.id FROM j2_routines r WHERE r.user_id = ? AND r.deleted_at IS NULL"
        # the newest ticked DAY is an index seek on the ticks' primary key (user, routine, day)
        " ORDER BY MAX(substr(r.updated_at, 1, 10), COALESCE((SELECT MAX(t.day)"
        " FROM j2_routine_ticks t WHERE t.user_id = r.user_id AND t.routine_id = r.id), ''))"
        " DESC, r.updated_at DESC, r.id",
        (user_id,)).fetchall()
    ids = [r[0] for r in rows if (only is None or r[0] in only) and r[0] not in never]
    return ids[:MAX_ROUTINES], len(ids)


def _estimated_entries(conn: sqlite3.Connection, user_id: str, lo: str, hi: str) -> int:
    """Positions of the member's with an estimated entry date whose ET entry day is in [lo, hi]:
    the days `routines.traded_days` leaves out of a traded schedule."""
    if not lo or not hi or lo > hi:
        return 0
    wide = ((date.fromisoformat(lo) - timedelta(days=1)).isoformat(),
            (date.fromisoformat(hi) + timedelta(days=1)).isoformat() + "~")
    n = 0
    for (entry,) in conn.execute(
            "SELECT entry_date FROM j2_positions WHERE user_id = ?"
            " AND COALESCE(entry_estimated, 0) = 1 AND entry_date BETWEEN ? AND ?",
            (user_id, *wide)):
        d = timeutil.compute_trading_day_et(entry)
        if d and lo <= d[:10] <= hi:
            n += 1
    return n


def _estimated_note(conn: sqlite3.Connection, user_id: str, lo: str, hi: str) -> str | None:
    n = _estimated_entries(conn, user_id, lo, hi)
    if not n:
        return None
    return ESTIMATED_ENTRIES.format(n=n, positions=_plural(n, "position", "positions"),
                                    is_=_plural(n, "is", "are"))


ROUTINE_FIELDS: dict[str, Field] = {f.key: f for f in [
    _f("day", "Day", "day", split=True),
    _f("weekday", "Weekday", "enum", split=True, bucket=WEEKDAYS),
    _f("month", "Month", "enum", split=True),
    _f("routine", "Routine", "enum", split=True, label_from="routine_name"),
    _f("item", "Item", "enum", split=True, label_from="item_text", filterable=False),
    # W9-R21: the stored values are the codes; "Done" is only how a group reads
    _f("state", "State", "enum", split=True, bucket=_history_order, choices=_history_choices,
       strict_choices=True,
       fmt=state_label),
    _f("consistency", "Consistency", "number"),
]}

TRACKER_FIELDS: dict[str, Field] = {f.key: f for f in [
    _f("day", "Day", "day", split=True),
    _f("weekday", "Weekday", "enum", split=True, bucket=WEEKDAYS),
    _f("month", "Month", "enum", split=True),
    _f("tracker", "Tracker", "enum", split=True, label_from="tracker_name"),
    _f("value", "Value", "number"),
]}


def _newest_first(rows: list[dict], name_key: str, id_key: str) -> list[dict]:
    rows.sort(key=lambda r: (str(r.get(name_key) or ""), str(r.get(id_key) or "")))
    rows.sort(key=lambda r: str(r.get("day") or ""), reverse=True)
    return rows


def _routine_rows(conn: sqlite3.Connection, user_id: str, ids: list[str], cut: date,
                  today: date, today_s: str, lo: str | None, to_day: str, by_item: bool,
                  traded: list[str]) -> list[dict]:
    """`scan_routines`' rows, newest first, from `lo` (None: whole history) to `to_day`, at most
    the newest `SCAN_ROWS + 1` (W9-R17). Appends each traded-schedule routine's first day to
    `traded` (a routine with no row still says its traded days leave estimated entries out).
    History is read through `routines.history_for` only (W9-R15); a routine with no scheduled day
    from `lo` to `cut` has no row, so none of it is read or built (W9-R36)."""
    start = date.fromisoformat(lo) if lo else None
    hists = (j2_routines.history_for(conn, user_id, ids, cut, today, since=start,
                                     scheduled_from=start or j2_routines.DAY_MIN)
             if ids else {})
    days: list[dict] = []
    for rid in ids:
        h = hists.get(rid)
        if h is None:
            continue
        if h.uses_traded:
            traded.append(max(h.created, j2_routines.DAY_MIN).isoformat())
        counted: list = []
        for i, st in enumerate(h.states):
            if i % _CHECK_EVERY == 0:
                wcompile.check_deadline()
            if st.state in _COUNTED:
                counted.append(st)
            elif not (st.state == "open" and st.day == today_s):
                continue                                    # off days and later days never appear
            if (lo and st.day < lo) or st.day > to_day:
                continue
            rate = routine_days.consistency_rate(
                routine_days.consistency(counted[-routine_days.CONSISTENCY_WINDOW:],
                                         strict=h.strict), strict=h.strict)
            days.append({
                "routine": rid, "routine_name": h.name, "day": st.day,
                "weekday": _weekday(st.day), "month": _month_of(st.day), "state": st.state,
                "ticked": float(st.ticked), "of": float(st.of), "strict": h.strict,
                "consistency": _num(rate), "item": None, "item_text": None,
                "flagged": False, "label": h.name, "label2": None, "_h": h,
            })
    _newest_first(days, "routine_name", "routine")
    out: list[dict] = []
    for i, base in enumerate(days):
        if len(out) > wcompile.SCAN_ROWS:
            break                                           # the newest SCAN_ROWS + 1 are enough
        if i % _CHECK_EVERY == 0:
            wcompile.check_deadline()
        h = base.pop("_h")
        if not by_item:
            out.append(base)
            continue
        ticks = h.ticks.get(base["day"]) or {}
        for it in routine_days.items_on(h.items, date.fromisoformat(base["day"])):
            if base["state"] == "skipped":
                code = "skipped"
            elif ticks.get(it.id) is True:
                code = "done"
            else:
                code = "open" if base["state"] == "open" else "not_done"
            out.append({**base, "item": it.id, "item_text": it.text, "label2": it.text,
                        "state": code})
    for r in out:
        r.pop("_h", None)
    return out


def scan_routines(conn: sqlite3.Connection, plan: dict, settings: dict | None,
                  rng: ResolvedRange, user_id: str, *, today: date | None = None) -> Scan:
    """One row per scheduled day of each of the member's routines in the range (or, when the plan
    splits by item, one row per valid item per scheduled day: done when ticked, not done when not,
    skipped on a skipped day, open today). `consistency` is the rolling `CONSISTENCY_WINDOW` rate
    as of that day (strict mode counts a skip)."""
    today = today or trading_days.today_et()
    today_s = today.isoformat()
    hi = date.fromisoformat(rng.to_day)
    cut = min(hi, today)
    lo = rng.from_day
    by_item = _splits_by(plan, "item")
    ids, total = _scan_routine_ids(conn, user_id, plan)
    traded: list[str] = []

    def rows_from(win: str | None) -> list[dict]:
        """The rows from `win` (None: the routines' whole history) to the range's end."""
        traded.clear()
        return _routine_rows(conn, user_id, ids, cut, today, today_s, win, rng.to_day, by_item,
                             traded)

    # W9-R17: read only the newest sessions that can hold the cap, widening the window (doubling)
    # until it does or it reaches the range's start or the oldest routine: older days are never
    # built. A window that already covers everything is the last one. W9-R39 (replacing W9-R38's
    # density projection, which a quiet recent window fooled): when a sound upper bound on the rows
    # the whole range can hold, from the schedules alone (`routines.row_capacity`), is within the
    # cap, the next build is the whole range, once; otherwise the window keeps doubling. The rows
    # are the same either way; only the work differs.
    out: list[dict] = []
    if ids:
        oldest = conn.execute(
            "SELECT MIN(created_at) FROM j2_routines WHERE user_id = ? AND id IN"
            f" ({','.join('?' * len(ids))})", (user_id, *ids)).fetchone()[0]
        oldest_day = (timeutil.compute_trading_day_et(oldest) or "")[:10]
        k = -(-(wcompile.SCAN_ROWS + 1) // len(ids))
        bound: int | None = None
        project_whole = False
        while True:
            t = trading_days.nth_session_before(cut + timedelta(days=1), k).isoformat()
            whole = project_whole or (lo is not None and t <= lo) or t <= oldest_day \
                or k >= routine_days.MAX_HISTORY_SESSIONS
            out = rows_from(lo if whole else t)
            if whole or len(out) > wcompile.SCAN_ROWS:
                break
            if bound is None:                               # once, and only when needed
                bound = j2_routines.row_capacity(
                    conn, user_id, ids, date.fromisoformat(lo) if lo else j2_routines.DAY_MIN,
                    cut, today, per_item=by_item, limit=wcompile.SCAN_ROWS)
            project_whole = bound <= wcompile.SCAN_ROWS
            k = min(2 * k, routine_days.MAX_HISTORY_SESSIONS)
    traded_lo = min(traded) if traded else None
    capped = len(out) > wcompile.SCAN_ROWS
    out = out[:wcompile.SCAN_ROWS]
    notes = []
    if total > len(ids):
        notes.append(S_MORE_ROUTINES.format(n=len(ids)))
    if traded_lo is not None:
        note = _estimated_note(conn, user_id, max(lo or traded_lo, traded_lo), cut.isoformat())
        if note:
            notes.append(note)
    return Scan("routine_history", out, capped, out[-1]["day"] if out else None, len(out), None,
                notes)


def _tracker_row(tid: str, name: Any, kind: str, unit: Any, day: str, value: Any) -> dict:
    v = _num(value)
    return {"tracker": tid, "tracker_name": name, "kind": kind, "unit": unit, "day": day,
            "weekday": _weekday(day), "month": _month_of(day), "value": v,
            "text": tracker_days.format_value(kind, v, unit) or None,
            "flagged": False, "label": name, "label2": None}


def scan_trackers(conn: sqlite3.Connection, plan: dict, settings: dict | None,
                  rng: ResolvedRange, user_id: str, *, today: date | None = None) -> Scan:
    """One row per logged value of each of the member's trackers in the range (archived ones kept,
    deleted ones gone), plus the two built-ins: the member's check-in mood and focus, by the one
    check-in rule (`_checkins`). Values on or before the range's last day only (ruling W9-R13)."""
    hi, lo = rng.to_day, rng.from_day
    sql = ("SELECT v.tracker_id, v.day, v.value, t.name, t.kind, t.unit FROM j2_tracker_values v"
           " JOIN j2_trackers t ON t.id = v.tracker_id AND t.user_id = v.user_id"
           " WHERE v.user_id = ? AND t.deleted_at IS NULL AND v.day <= ?")
    params: list = [user_id, hi]
    if lo:
        sql += " AND v.day >= ?"
        params.append(lo)
    sql += f" ORDER BY v.day DESC, v.tracker_id ASC LIMIT {wcompile.SCAN_LIMIT}"
    rows = [_tracker_row(r[0], r[3], r[4], r[5], r[1], r[2]) for r in conn.execute(sql, params)]
    capped = len(rows) > wcompile.SCAN_ROWS
    for day, v in _checkins(conn, user_id, lo or j2_trackers.DAY_MIN.isoformat(), hi).items():
        for tid, dim in (("checkin:mood", "mood"), ("checkin:focus", "focus")):
            if v.get(dim) is not None:
                b = j2_trackers.BUILTIN[tid]
                rows.append(_tracker_row(tid, b["name"], b["kind"], None, day, v[dim]))
    _newest_first(rows, "tracker_name", "tracker")
    capped = capped or len(rows) > wcompile.SCAN_ROWS
    rows = rows[:wcompile.SCAN_ROWS]
    return Scan("tracker_history", rows, capped, rows[-1]["day"] if rows else None, len(rows), None)


def _day_refs(conn: sqlite3.Connection, user_id: str, plan: dict, rows: list[dict],
              checkins: dict[str, dict], lo_s: str, hi_s: str,
              today: date) -> tuple[list[str], list[str]]:
    """Write `routine_done`, `tracker_value` and `tracker_bucket` (with `tracker_bucket_order`) on
    each trading-days row for the plan's routine and tracker refs, resolved for the session member
    only. Answers (footnotes, notices). A ref that does not resolve leaves every value None and is
    ONE notice (W9-R18); the rows say so (`_quiet`), so no off-day or no-value footnote is
    added for it. A plan with no ref writes nothing (the rows keep the sample book's shape)."""
    refs = plan_refs(plan, DAY_FIELDS)
    notes: list[str] = []
    notices: list[str] = []
    rid, tid = refs.get("routine"), refs.get("tracker")
    if not rid and not tid:
        return notes, notices
    unresolved: set[str] = set()
    for r in rows:
        r["routine_done"] = r["tracker_value"] = r["tracker_bucket"] = None
        r["tracker_bucket_order"] = None
    if rid:
        hi_d = date.fromisoformat(hi_s)
        # a day's state needs no consistency window: the floor is the range's start (M-2)
        h = j2_routines.history_for(conn, user_id, rid, hi_d, today,
                                    since=date.fromisoformat(lo_s), window=False).get(rid)
        if h is None:
            unresolved.add("routine")
            notices.append(S_ROUTINE_GONE)
        else:
            today_s = today.isoformat()
            codes = {s.day: s.state for s in h.states
                     if s.state != "open" or s.day == today_s}
            arch = h.archived_at.isoformat() if h.archived_at else None
            for r in rows:
                code = codes.get(r["day"])
                if code is None and arch and r["day"] > arch:
                    code = "off"                            # archived: it no longer runs
                r["routine_done"] = code
                if code is None and r["day"] > today_s:
                    # M-1: a session still to come is not "no routine yet"; it leaves quietly
                    r["_quiet"] = r.get("_quiet", frozenset()) | {"routine_done"}
            if h.uses_traded:
                note = _estimated_note(conn, user_id, max(lo_s, h.created.isoformat()),
                                       min(hi_d, today).isoformat())
                if note:
                    notes.append(note)
    if tid:
        values: dict[str, float] | None = None
        kind, unit = "scale", None
        if tid in j2_trackers.BUILTIN:
            dim = "mood" if tid == "checkin:mood" else "focus"
            values = {d: c[dim] for d, c in checkins.items() if c.get(dim) is not None}
        else:
            row = conn.execute("SELECT kind, unit FROM j2_trackers WHERE id = ? AND user_id = ?"
                               " AND deleted_at IS NULL", (tid, user_id)).fetchone()
            if row is not None:
                kind, unit = row[0], row[1]
                values = {d: _num(v) for d, v in conn.execute(
                    "SELECT day, value FROM j2_tracker_values WHERE user_id = ? AND tracker_id = ?"
                    " AND day BETWEEN ? AND ?", (user_id, tid, lo_s, hi_s))}
        if values is None:
            unresolved.add("tracker")
            notices.append(S_TRACKER_GONE)
        else:
            bs = tracker_days.buckets(kind, [v for v in values.values() if v is not None], unit)
            order = {b.label: i for i, b in enumerate(bs)}
            today_s = today.isoformat()
            for r in rows:
                v = values.get(r["day"])
                r["tracker_value"] = v
                r["tracker_bucket"] = label = tracker_days.bucket_of(bs, v)
                r["tracker_bucket_order"] = order.get(label)
                if v is None and r["day"] > today_s:
                    # a session still to come has no value yet; it is not "no value" (M-1)
                    r["_quiet"] = r.get("_quiet", frozenset()) | {"tracker_value",
                                                                  "tracker_bucket"}
    if unresolved:
        keys = frozenset(f.key for f in DAY_FIELDS.values() if f.ref_kind in unresolved)
        for r in rows:
            r["_quiet"] = r.get("_quiet", frozenset()) | keys
    return notes, notices


# ── options strategies (wave 10, Task 10.6) ────────────────────────────────────────────────────
#
# One row per options strategy of the member's (`j2_option_strategies`, `user_id = ?`), newest
# first by its ET day, at most `SCAN_ROWS`. The ET day is the day the strategy CLOSED
# (`trading_day_et`, else `timeutil.compute_trading_day_et(closed_at)`) and, for an open one, its
# entry ET day; the SQL only pre-filters a range widened by one day each side, and the day is
# decided here, never read from a UTC date. Ruling W10-R6: an open strategy is listed, filtered
# and counted by "Strategies", but never measured (`measures.measure_input` leaves it out); its
# net and R are None whatever is stored. A stored result other than Win / Loss / BE (the close
# path writes only those, `options.close_strategy`) is shown as stored and is never decisive: the
# shared measures count only "Win" and "Loss". The legs carry no `user_id`, so they are read only
# for the strategy ids this scan returned, in chunks of 500, joined back to the member's own
# strategies (`_leg_expiry`).

#: The labels `prettyStrategyType` (`lib/optionCalcs.js`) shows for each stored strategy type.
STRATEGY_LABELS = {
    "long_call": "Long Call", "long_put": "Long Put", "short_call": "Short Call",
    "short_put": "Short Put", "vertical_debit_call": "Call Debit Spread",
    "vertical_credit_call": "Call Credit Spread", "vertical_debit_put": "Put Debit Spread",
    "vertical_credit_put": "Put Credit Spread", "calendar": "Calendar", "diagonal": "Diagonal",
    "straddle": "Straddle", "strangle": "Strangle", "iron_condor": "Iron Condor",
    "iron_butterfly": "Iron Butterfly", "call_butterfly": "Call Butterfly",
    "put_butterfly": "Put Butterfly", "custom": "Custom",
}
DIRECTIONS = ("bullish", "bearish", "neutral")
OPTION_STATUSES = ("open", "closed", "expired", "assigned", "rolled")
_DIRECTION_LABELS = {"bullish": "Bullish", "bearish": "Bearish", "neutral": "Neutral"}


def _strategy_label(v: Any) -> str:
    return STRATEGY_LABELS.get(v, str(v))


def _title(v: Any) -> str:
    return str(v)[:1].upper() + str(v)[1:] if v else str(v)


OPTION_FIELDS: dict[str, Field] = {f.key: f for f in [
    _f("day", "Day", "day", split=True),
    _f("weekday", "Weekday", "enum", split=True, bucket=WEEKDAYS),
    _f("month", "Month", "enum", split=True),
    _f("underlying", "Underlying", "text", sql="o.underlying", split=True, ci=True),
    _f("strategy", "Strategy", "enum", sql="o.strategy_type", split=True, fmt=_strategy_label),
    _f("direction", "Direction", "enum", sql="o.direction", split=True, bucket=DIRECTIONS,
       fmt=lambda v: _DIRECTION_LABELS.get(v, str(v))),
    _f("status", "Status", "enum", sql="o.status", split=True, bucket=OPTION_STATUSES,
       fmt=_title),
    _f("dte_entry", "Days to expiry at entry", "number"),
    # Net and R are None on an open row (`scan_options`). A SQL number filter may keep an open
    # row with a stored figure, never drop one Python keeps: every number op is False on None,
    # and `aggregate` re-applies each filter in Python.
    _f("net", "Net P&L", "number", sql="o.pnl_dollar"),
    _f("r", "R", "number", sql="o.r_multiple"),
    _f("result", "Result", "enum", sql="o.result", split=True,
       fmt=lambda v: _RESULT_LABELS.get(v, str(v)), bucket=("Win", "Loss", "BE")),
    _f("setup", "Setup", "enum", sql="o.setup", split=True, none_label="No setup"),
    _f("account", "Account", "enum", sql="o.account_id", split=True, label_from="account_name",
       none_label="No account"),
]}


def _get(r: Any, key: str) -> Any:
    """A column of a dict or a `sqlite3.Row` (absent: None)."""
    try:
        return r[key]
    except (KeyError, IndexError):
        return None


def strategy_close_day(r: Any) -> str | None:
    """Ruling W10-R52: the ET day a CLOSED strategy belongs to -- its stamped `trading_day_et`,
    else `timeutil.compute_trading_day_et(closed_at)`, the one ET-day authority (the close path
    stamps with it). Both widget sources read it: the options source and the trading-days fold.
    Never `calendar.to_et_date`, which moves a UTC-midnight or bare-date close a day back."""
    stamped = _get(r, "trading_day_et")
    if stamped:
        return str(stamped)[:10]
    closed = _get(r, "closed_at")
    return timeutil.compute_trading_day_et(closed) if closed else None


def _option_day(r: dict) -> str | None:
    """The ET day a strategy belongs to: its close (`strategy_close_day`), or, while open, its
    entry. A closed strategy with no close day falls back to its entry ET day, the order of the
    SQL `COALESCE` (`compile.OPTION_DAY`), so it is listed, never dropped (fix round 1, m-4).
    Always `compute_trading_day_et`, never the UTC date."""
    if r.get("status") == "open":
        return timeutil.compute_trading_day_et(r.get("entry_date"))
    return strategy_close_day(r) or timeutil.compute_trading_day_et(r.get("entry_date"))


def _sql_day(r: dict) -> str:
    """The day the SQL ordered a row by (`compile.OPTION_DAY`): stamped, else the UTC dates."""
    return str(r.get("trading_day_et") or r.get("closed_at") or r.get("entry_date") or "")[:10]


def _leg_expiry(conn: sqlite3.Connection, user_id: str, ids: list[str]) -> dict[str, str]:
    """strategy id -> its earliest leg expiration (ISO day), for `ids` only (the member's own
    scanned strategy ids), in chunks of 500, each joined back to `user_id`'s strategies."""
    out: dict[str, str] = {}
    rows = _in_chunks(
        conn, "SELECT l.strategy_id AS sid, l.expiration AS exp FROM j2_option_legs l"
              " JOIN j2_option_strategies s ON s.id = l.strategy_id"
              " WHERE s.user_id = ? AND l.strategy_id IN", user_id, ids)
    for i, r in enumerate(rows):
        if i % _CHECK_EVERY == 0:
            wcompile.check_deadline()
        exp = str(r.get("exp") or "")[:10]
        try:
            date.fromisoformat(exp)
        except ValueError:
            continue
        if r["sid"] not in out or exp < out[r["sid"]]:
            out[r["sid"]] = exp
    return out


def _dte(expiry: str | None, entry_day: str | None) -> float | None:
    if not expiry or not entry_day:
        return None
    try:
        return float((date.fromisoformat(expiry) - date.fromisoformat(entry_day[:10])).days)
    except ValueError:
        return None


def scan_options(conn: sqlite3.Connection, plan: dict, settings: dict | None,
                 rng: ResolvedRange, user_id: str, *, today: date | None = None) -> Scan:
    """The member's options strategies in the range, newest first, at most `SCAN_ROWS`."""
    acc = owned_account_id(conn, user_id, wcompile.account_param(plan, settings))
    sql, params = wcompile.compile_scan(OPTIONS, plan, settings, rng, user_id)
    raw = _dicts(conn.execute(sql, params))
    over = len(raw) > wcompile.SCAN_ROWS
    kept: list[tuple[str, dict]] = []
    for i, r in enumerate(raw):
        if i % _CHECK_EVERY == 0:
            wcompile.check_deadline()
        d = _option_day(r)
        if d is None or d > rng.to_day or (rng.from_day is not None and d < rng.from_day):
            continue
        kept.append((d, r))
    kept.sort(key=lambda p: (p[0], str(p[1].get("id") or "")), reverse=True)
    capped = False
    if over:
        # Rows past the LIMIT have a SQL day no later than the last row read, and an ET day the
        # same or one earlier. They can be in range only when that day is; then the honest
        # "newest" set stops at that day (fix round 1, m-1).
        last = _sql_day(raw[-1])
        if rng.from_day is None or last >= rng.from_day:
            capped = True
            kept = [p for p in kept if p[0] >= last]
    if len(kept) > wcompile.SCAN_ROWS:
        capped = True
        kept = kept[:wcompile.SCAN_ROWS]
    expiry = _leg_expiry(conn, user_id, [r["id"] for _d, r in kept])
    names = _account_names(conn, user_id)
    n = len(kept)
    rows: list[dict] = []
    for i, (d, r) in enumerate(kept):
        if i % _CHECK_EVERY == 0:
            wcompile.check_deadline()
        is_open = r.get("status") == "open"
        acc_id = r.get("account_id") or None
        rows.append({
            "_tid": r["id"],
            # the streak order: close instant, then newest-first scan position reversed
            "id": _sort_key(r.get("closed_at") or r.get("entry_date"), n - i),
            "day": d,
            "weekday": _weekday(d),
            "month": d[:7],
            "underlying": r.get("underlying"),
            "strategy": r.get("strategy_type"),
            "direction": r.get("direction"),
            "status": r.get("status"),
            "open": is_open,
            "dte_entry": _dte(expiry.get(r["id"]),
                              timeutil.compute_trading_day_et(r.get("entry_date"))),
            "net": None if is_open else _num(r.get("pnl_dollar")),
            "r": None if is_open else _num(r.get("r_multiple")),
            "result": r.get("result") or None,
            "setup": r.get("setup") or None,
            "account": acc_id,
            "account_name": names.get(acc_id),
            "origin": _ROW_ORIGIN.get(r.get("source"), "manual"),
            "flagged": False,
            "label": r.get("underlying"),
            "label2": _strategy_label(r.get("strategy_type")),
        })
    return Scan("options_strategies", rows, capped, rows[-1]["day"] if rows else None,
                len(rows), acc)


# ── notes (wave 10, Task 10.7) ─────────────────────────────────────────────────────────────────
#
# One row per note of the member's (`j2_notes`, `user_id = ?`), newest first by when it was
# written, at most `SCAN_ROWS`. Trashed notes and the sample notebook are never read (the scan's
# SQL, `compile.compile_scan`, with `sample_marker.not_sample_sql`); an archived note is still a
# note the member wrote, and is read. A note's `created` / `updated` day is its ET CALENDAR date,
# through the one ET-day authority (`timeutil.compute_trading_day_et`, W10-R52: it converts any
# timestamp to its America/New_York date and never moves a weekend or an evening onto a session);
# its hours through `timeutil.compute_hour_et`. The SQL only pre-filters `created_at` (a UTC
# instant) over the range widened by a day each side; the day is decided here.
#
# ⛔ No body, plain text or title column is selected for measuring (`compile.NOTE_COLUMNS`); a list
# reads the titles apart, by id, for the rows it shows (`note_titles`), and so does a drill.
#
# Note properties (wave E's `j2_note_properties`): a filter goes ONLY through
# `note_properties.property_filter_sql`, the one property filter authority, which the scan ANDs
# into its SQL (`compile_scan(extra=)`); `aggregate` never re-applies it (`Field.scan_applied`).
# A property that is not one of the member's own (deleted or another member's: they read the same,
# W9-R18) drops that filter or that sum and is ONE notice; it never narrows. Folders and kinds are
# read `WHERE user_id = ?`; a note naming a folder or kind that is not the member's reads as none.

S_PROP_GONE = "That property isn't available; it is not used in this widget."
S_PROP_NOT_NUMBER = "That property isn't a number you can add up."
#: A filter whose value no longer fits its property (the member retyped it): dropped, never a 400.
S_PROP_FILTER_UNFIT = "That filter can't be used with this property; it is not used in this widget."

#: The one ET-day and ET-hour authority (W10-R52); never a second conversion.
_note_day = timeutil.compute_trading_day_et
_note_hour = timeutil.compute_hour_et

#: The plan's ops a property filter may use, each mapped onto `note_properties._VALID_OPS` by
#: `property_conditions` ("between" is two conditions, "is" an equality on a checkbox). `in`,
#: `not_in` and `has_any` are not offered: the authority ANDs its conditions, it has no OR.
PROPERTY_OPS = ("eq", "gt", "gte", "lt", "lte", "between", "contains", "is")
_PROPERTY_OP = {"eq": "eq", "gt": "gt", "gte": "gte", "lt": "lt", "lte": "lte",
                "contains": "contains", "is": "eq"}


def property_conditions(prop: str, op: str, values: list,
                        prop_type: str | None = None) -> list[dict]:
    """One plan property filter as `note_properties.property_filter_sql` conditions. On a
    multi-select, "is" one option (`eq`) asks whether the list holds it (`contains`)."""
    if op == "eq" and prop_type == "multi_select":
        return [{"propertyId": prop, "op": "contains", "value": values[0]}]
    if op == "between":
        return [{"propertyId": prop, "op": "gte", "value": values[0]},
                {"propertyId": prop, "op": "lte", "value": values[1]}]
    return [{"propertyId": prop, "op": _PROPERTY_OP[op], "value": values[0]}]


def member_property(conn: sqlite3.Connection, user_id: str, prop: Any) -> dict | None:
    """The member's own definition of `prop`, or None (deleted, another member's, a built-in, or a
    calculated one: none of them is a value this widget can read)."""
    if not isinstance(prop, str) or note_properties.is_builtin_property_id(prop):
        return None
    d = note_properties.get_property_def(user_id, prop, conn=conn)
    if d is None or d.get("source") != "user_set" or d.get("computed"):
        return None
    return d


def _notice(notices: list[str], sentence: str) -> None:
    if sentence not in notices:
        notices.append(sentence)


def _property_filters(conn: sqlite3.Connection, user_id: str, plan: dict,
                      notices: list[str]) -> tuple[str, list]:
    """The plan's property filters as ONE SQL fragment, each built by the one authority."""
    frags: list[str] = []
    params: list = []
    for f in plan.get("filters") or []:
        if f.get("field") != PROPERTY_FIELD:
            continue
        d = member_property(conn, user_id, f.get("prop"))
        if d is None:
            _notice(notices, S_PROP_GONE)
            continue
        try:
            sql, ps = note_properties.property_filter_sql(
                user_id, property_conditions(f["prop"], f["op"], f.get("values") or [],
                                             d.get("type")), conn, strict=False)
        except note_properties.PropertyValidationError:
            _notice(notices, S_PROP_FILTER_UNFIT)
            continue
        frags.append(sql)
        params.extend(ps)
    return "".join(frags), params


def _kind_filters(conn: sqlite3.Connection, user_id: str, plan: dict) -> tuple[str, list]:
    """W10-R60: a kind filter naming ONE kind narrows in SQL through the one property filter
    authority (`builtin:note_kind` equals it). Any other kind filter (several kinds, "is not")
    is applied by its Python twin over the same value (`row["kind"]`), which also re-checks this
    one. A kind that is not one of the member's is refused by the authority: no SQL, and the twin
    leaves no row (an honest empty answer)."""
    frags: list[str] = []
    params: list = []
    for f in plan.get("filters") or []:
        vals = f.get("values") or []
        if f.get("field") != "kind" or f.get("op") != "in" or len(vals) != 1:
            continue
        try:
            sql, ps = note_properties.property_filter_sql(
                user_id, [{"propertyId": j2_note_kinds.NOTE_KIND_PROPERTY, "op": "eq",
                           "value": vals[0]}], conn, strict=False)
        except note_properties.PropertyValidationError:
            continue
        frags.append(sql)
        params.extend(ps)
    return "".join(frags), params


def note_kinds_offered() -> bool:
    """W10-R62: is "Kind of note" offered right now? The one reader is `note_kinds.offered` (the
    journal styles switch, read per call); this asks it about the kind property itself and never
    restates the switch."""
    nk = j2_note_kinds.NOTE_KIND_PROPERTY
    return any(d.get("id") == nk for d in j2_note_kinds.offered([{"id": nk}]))


#: Fields a source offers only while their own switch says so (W10-R62): (source, field) -> reader.
#: Out of the catalog, out of the member-values door, and refused in a plan while it says no.
_GATED_FIELDS: dict[tuple[str, str], Callable[[], bool]] = {("notes", "kind"): note_kinds_offered}


def field_offered(source_key: Any, field_key: Any) -> bool:
    """Is `field_key` of `source_key` offered right now? (Every field without a gate is.)"""
    gate = _GATED_FIELDS.get((source_key, field_key))
    return gate is None or bool(gate())


def _unoffered_field_in(plan: dict, src: "Source") -> bool:
    """Does `plan` filter or split by, or a formula of it read, a field not offered right now?"""
    gated = [k for (s, k) in _GATED_FIELDS if s == src.key and not field_offered(s, k)]
    if not gated:
        return False
    split = plan.get("split") or {}
    named = [f.get("field") for f in plan.get("filters") or []] + [split.get("by"),
                                                                     split.get("then")]
    if any(k in gated for k in named):
        return True
    if plan.get("formulas"):
        from api.services.journal_two import widget_formula as wf      # widget_formula imports plan
        infos = formula_fields(src.key)
        for f in plan["formulas"]:
            try:
                reads = wf.compile_formula(f.get("expr") or "", infos).fields
            except wf.FormulaError:
                continue                                    # the validator has refused it already
            if any(k in gated for k in reads):
                return True
    return False


def _summed_properties(conn: sqlite3.Connection, user_id: str, plan: dict,
                       notices: list[str]) -> list[str]:
    """The props of the plan's property sums that are the member's own NUMBER properties."""
    out: list[str] = []
    for m in plan.get("measures") or []:
        if m.get("key") not in PROP_MEASURES:
            continue
        d = member_property(conn, user_id, m.get("prop"))
        if d is None:
            _notice(notices, S_PROP_GONE)
        elif d.get("type") != "number":
            _notice(notices, S_PROP_NOT_NUMBER)
        elif m["prop"] not in out:
            out.append(m["prop"])
    return out


def _folder_names(conn: sqlite3.Connection, user_id: str) -> dict[str, str]:
    return {r[0]: r[1] for r in conn.execute(
        "SELECT id, name FROM j2_note_folders WHERE user_id = ?", (user_id,)).fetchall()}


def _kind_names(conn: sqlite3.Connection, user_id: str) -> dict[str, str]:
    out = {k["id"]: k["name"] for k in j2_note_kinds.BUILTIN_NOTE_KINDS}
    out.update({r[0]: r[1] for r in conn.execute(
        "SELECT id, name FROM j2_note_kinds WHERE user_id = ?", (user_id,)).fetchall()})
    return out


def note_titles(conn: sqlite3.Connection, user_id: str, ids: Iterable[str]) -> dict[str, str]:
    """note id -> title, for the member's own notes among `ids` (a list's rows, a drill's rows:
    ids the notes scan returned, so never trashed and never the sample). The ONE place a widget
    reads a note's title."""
    return {r["id"]: r["title"] for r in _in_chunks(
        conn, "SELECT id, title FROM j2_notes WHERE user_id = ? AND id IN", user_id, ids)}


def _prop_number(props: dict, prop: str) -> float | None:
    v = props.get(prop)
    return None if isinstance(v, bool) else _num(v)


NOTE_FIELDS: dict[str, Field] = {f.key: f for f in [
    _f("created", "Created", "day", split=True, hour_key="created_hour"),
    _f("updated", "Updated", "day", split=True, hour_key="updated_hour"),
    _f("weekday", "Weekday", "enum", split=True, bucket=WEEKDAYS),
    _f("month", "Month", "enum", split=True),
    _f("folder", "Folder", "enum", sql="n.folder_id", split=True, label_from="folder_name",
       none_label="No folder"),
    _f("tag", "Tag", "tag", sql="n.tags", split=True, none_label="No tags"),
    _f("ticker", "Ticker", "text", sql="n.ticker", split=True, ci=True, none_label="No ticker"),
    # W10-R60: the note's CURRENT kind (the `builtin:note_kind` property), never the creation-time
    # `kind_id`; a one-value filter narrows in SQL through `property_filter_sql` (`_kind_filters`)
    _f("kind", "Note kind", "enum", split=True, label_from="kind_name", none_label="No kind"),
    # filter only, and only with `prop`; its type is the named property's (the authority checks it)
    Field(PROPERTY_FIELD, "Property", None, PROPERTY_OPS, False, None, lambda r: None,
          scan_applied=True),
]}


def scan_notes(conn: sqlite3.Connection, plan: dict, settings: dict | None,
               rng: ResolvedRange, user_id: str, *, today: date | None = None) -> Scan:
    """The member's notes written in the range, newest first, at most `SCAN_ROWS`."""
    acc = owned_account_id(conn, user_id, wcompile.account_param(plan, settings))
    notices: list[str] = []
    p_sql, p_params = _property_filters(conn, user_id, plan, notices)
    k_sql, k_params = _kind_filters(conn, user_id, plan)
    extra = (p_sql + k_sql, p_params + k_params)
    summed = _summed_properties(conn, user_id, plan, notices)
    sql, params = wcompile.compile_scan(NOTES, plan, settings, rng, user_id, extra=extra)
    raw = _dicts(conn.execute(sql, params))
    over = len(raw) > wcompile.SCAN_ROWS
    kept: list[tuple[str, dict]] = []
    for i, r in enumerate(raw):
        if i % _CHECK_EVERY == 0:
            wcompile.check_deadline()
        d = _note_day(r.get("created_at"))
        if d is None or d > rng.to_day or (rng.from_day is not None and d < rng.from_day):
            continue
        kept.append((d, r))
    kept.sort(key=lambda p: (p[0], str(p[1].get("created_at") or ""), str(p[1].get("id") or "")),
              reverse=True)
    capped = False
    if over:
        # Rows past the LIMIT were written no later than the last row read, so their ET day is no
        # later than its: they can be in range only when that day is (the options rule, m-1).
        last = _note_day(raw[-1].get("created_at")) or ""
        if rng.from_day is None or last >= rng.from_day:
            capped = True
            kept = [p for p in kept if p[0] >= last]
    if len(kept) > wcompile.SCAN_ROWS:
        capped = True
        kept = kept[:wcompile.SCAN_ROWS]
    folders = _folder_names(conn, user_id)
    kinds = _kind_names(conn, user_id)
    titles = (note_titles(conn, user_id, [r["id"] for _d, r in kept])
              if (plan.get("view") or {}).get("type") == "list" else None)
    n = len(kept)
    rows: list[dict] = []
    for i, (d, r) in enumerate(kept):
        if i % _CHECK_EVERY == 0:
            wcompile.check_deadline()
        fid = r.get("folder_id") or None
        props = note_properties._parse_properties_json(r.get("properties_json"))
        kid = props.get(j2_note_kinds.NOTE_KIND_PROPERTY) or None
        kid = kid if isinstance(kid, str) else None
        hour_c, hour_u = _note_hour(r.get("created_at")), _note_hour(r.get("updated_at"))
        row = {
            "_tid": r["id"],
            "id": _sort_key(r.get("created_at"), n - i),
            "day": d,
            "created": d,
            "created_hour": None if hour_c is None else float(hour_c),
            "updated": _note_day(r.get("updated_at")),
            "updated_hour": None if hour_u is None else float(hour_u),
            "weekday": _weekday(d),
            "month": d[:7],
            "folder": fid if fid in folders else None,
            "folder_name": folders.get(fid) if fid else None,
            "tag": _tags(r.get("tags")),
            "ticker": r.get("ticker") or None,
            "kind": kid if kid in kinds else None,
            "kind_name": kinds.get(kid) if kid else None,
            "flagged": False,
        }
        if summed:
            for prop in summed:
                row[wmeasures.prop_key(prop)] = _prop_number(props, prop)
        if titles is not None:
            row["title"] = titles.get(r["id"], "")
        rows.append(row)
    return Scan("notes", rows, capped, rows[-1]["day"] if rows else None, len(rows), acc, [],
                notices)


# ── the sources and the catalog ────────────────────────────────────────────────────────────────

CLOSED = Source("closed_trades", "Closed trades", "Every trade you have closed.", "trades",
                CLOSED_FIELDS, scan_closed)
POSITIONS = Source("open_positions", "Open positions", "What you hold right now.", "positions",
                   POSITION_FIELDS, scan_positions)
DAYS = Source("trading_days", "Trading days",
              "One row per market session, with your day P&L (incl. options) and check-ins.",
              "days", DAY_FIELDS, scan_days)
ROUTINE_HISTORY = Source("routine_history", "Routine history",
                         "Every scheduled day of your routines: done, not done or skipped.", "days",
                         ROUTINE_FIELDS, scan_routines, list_labels=("label", "day"))
TRACKER_HISTORY = Source("tracker_history", "Tracker history", "Every value you have logged.",
                         "entries", TRACKER_FIELDS, scan_trackers, list_labels=("label", "day"))
OPTIONS = Source("options_strategies", "Options strategies",
                 "Every options strategy you have logged.", "strategies", OPTION_FIELDS,
                 scan_options)
#: W10-R7: a list row's label is the note's title, relabelled "Note <n>" publicly (`labelKind`).
NOTES = Source("notes", "Notes", "Every note you have written.", "notes", NOTE_FIELDS, scan_notes,
               list_labels=("title", "created"))

SOURCES: dict[str, Source] = {s.key: s for s in (CLOSED, POSITIONS, DAYS, ROUTINE_HISTORY,
                                                 TRACKER_HISTORY, OPTIONS, NOTES)}

ACCENTS = ("gold", "green", "red", "blue", "purple", "teal", "orange")

#: Fields a Line view can run along, and the one a calendar heat map needs.
TIME_FIELDS = frozenset({"day", "month"})

S_VIEW_ONE_NUMBER = "This view shows one number. Remove the split to use it."
S_VIEW_BAR = "A bar chart needs a split."
S_VIEW_LINE = "A line needs a split by day or month."
S_VIEW_HEAT = "A calendar heat map needs a split by day."
S_VIEW_SCATTER = "A scatter plot needs two measures and no split."
S_VIEW_SCATTER_TRADES = "A scatter plot works for closed trades only."
S_VIEW_LIST = "A list shows each row. Remove the split to use it."
S_VIEW_PROGRESS = "A progress bar needs a target."
S_SPLIT_FIELD = "That field can't be used to split a widget."
#: Ruling R-17: open positions are always what is open now.
S_POSITIONS_NO_COMPARE = ("Open positions are a snapshot of right now, so there is no earlier "
                          "period to compare.")


# Task 8.15 fix 1, ruling R-35: the view rules are DATA, and this is their one authority. `view_allowed`
# evaluates them; the vocabulary sends them (`viewRules`) and the builder evaluates the same list to grey a view
# out with the same sentence. A check applies to the views it names (None: every view) and fails when its `test`
# is false. Adding a test name means adding it to BOTH interpreters: `view_check_passes` here and
# `CHECK_TESTS` in the client's widgetBuilder/builderCatalog.js (rail: the builder's server-catalog fixture).
# Wave 10 (Tasks 10.6/10.7, carried into the data at the be->impl merge): a progress bar's target may be a goal
# (`display.targetGoal`), and a line or a heat map may run along ANY day field of the source (`types`: the notes
# source's "Written" and "Updated"), not only the trades' `day`/`month`.
VIEW_REASONS = {
    "positions_no_compare": S_POSITIONS_NO_COMPARE, "view_one_number": S_VIEW_ONE_NUMBER,
    "no_earlier": S_NO_EARLIER, "view_progress": S_VIEW_PROGRESS, "view_bar": S_VIEW_BAR,
    "view_line": S_VIEW_LINE, "view_heat": S_VIEW_HEAT, "view_scatter_trades": S_VIEW_SCATTER_TRADES,
    "view_scatter": S_VIEW_SCATTER, "view_list": S_VIEW_LIST,
}
VIEW_CHECKS: tuple[dict, ...] = (
    {"views": None, "test": "not_right_now_compare", "sources": sorted(RIGHT_NOW_SOURCES),
     "reason": "positions_no_compare"},
    {"views": ("number", "compare", "progress"), "test": "no_split", "reason": "view_one_number"},
    {"views": ("compare",), "test": "has_earlier", "tokens": sorted(_UNBOUNDED_TOKENS), "reason": "no_earlier"},
    {"views": ("progress",), "test": "has_target", "reason": "view_progress"},
    {"views": ("bar",), "test": "split", "reason": "view_bar"},
    {"views": ("line",), "test": "split_in", "fields": sorted(TIME_FIELDS), "types": ["day"],
     "reason": "view_line"},
    {"views": ("heat",), "test": "split_in", "fields": ["day"], "types": ["day"], "reason": "view_heat"},
    {"views": ("scatter",), "test": "source_in", "sources": ["closed_trades"], "reason": "view_scatter_trades"},
    {"views": ("scatter",), "test": "no_split_measures", "measures": 2, "reason": "view_scatter"},
    {"views": ("list",), "test": "no_split", "reason": "view_list"},
)
#: The suggested view for a shape: no split -> number (compare when the plan compares); a second split -> table;
#: a split along time (a time field, or any field of a `time_types` type) -> line; any other split -> bar.
AUTO_VIEW = {"no_split": "number", "compare": "compare", "then": "table", "time_fields": sorted(TIME_FIELDS),
             "time_types": ["day"], "time": "line", "split": "bar"}


def _field_type_of(plan: dict):
    """The plan's source's field types, as a lookup: key -> type (None: no such field or source)."""
    src = SOURCES.get(plan.get("source"))
    return lambda key: getattr(src.fields.get(key), "type", None) if src is not None else None


def view_check_passes(check: dict, plan: dict, source_key: str, vtype: str | None) -> bool:
    t = check["test"]
    split = plan.get("split") or None
    if t == "not_right_now_compare":
        return not (source_key in check["sources"] and (vtype == "compare" or plan.get("compare")))
    if t == "no_split":
        return not split
    if t == "has_earlier":
        cmp = plan.get("compare") or {"mode": "previous"}
        tok = (plan.get("range") or {}).get("token")
        return not (cmp.get("mode") == "previous" and tok in check["tokens"])
    if t == "has_target":                       # a goal target is a target (plan.py checks it)
        display = plan.get("display") or {}
        return display.get("target") is not None or bool(display.get("targetGoal"))
    if t == "split":
        return bool(split)
    if t == "split_in":
        if not split:
            return False
        by = split.get("by")
        return by in check["fields"] or (bool(check.get("types")) and _field_type_of(plan)(by) in check["types"])
    if t == "source_in":
        return source_key in check["sources"]
    if t == "no_split_measures":
        return not split and len(plan.get("measures") or []) == check["measures"]
    raise ValueError(f"unknown view check {t!r}")


def auto_view_from(rules: dict, plan: dict, field_type=None) -> str:
    """`field_type(key)`: the type of a field of the plan's source (None: no lookup, the field list only)."""
    split = plan.get("split")
    if not split:
        return rules["compare"] if plan.get("compare") else rules["no_split"]
    if split.get("then"):
        return rules["then"]
    by = split.get("by")
    timed = by in rules["time_fields"] or (
        field_type is not None and field_type(by) in (rules.get("time_types") or ()))
    return rules["time"] if timed else rules["split"]


class WidgetCatalog:
    """The concrete `plan.Catalog`: sources, the measures each may pick, accents, views, ranges."""

    def __init__(self) -> None:
        self.sources = SOURCES
        self.measures = wmeasures.builder_measures()
        self.accents = ACCENTS
        self.views = VIEWS
        self.range_tokens = RANGE_TOKENS

    def measures_for(self, source_key: str) -> dict:
        return wmeasures.measures_for(source_key)

    def auto_view(self, plan: dict) -> str:
        """The view the builder suggests for a plan's shape (`AUTO_VIEW`, the data the builder reads)."""
        return auto_view_from(AUTO_VIEW, plan, _field_type_of(plan))

    def view_allowed(self, plan: dict) -> str | None:
        """None, or the one line saying why the plan's view (or split) cannot be used. The split-field test is
        structural; every view rule is the DATA in `VIEW_CHECKS`, which the builder evaluates the same way."""
        src = self.sources.get(plan.get("source"))
        if src is None:
            return None
        if _unoffered_field_in(plan, src):
            return S_UNKNOWN_FIELD              # W10-R62: a field not offered right now
        split = plan.get("split")
        if split:
            for k in (split.get("by"), split.get("then")):
                if k is not None and not _splittable(plan, src, k):
                    return S_SPLIT_FIELD
        vtype = (plan.get("view") or {}).get("type")
        for check in VIEW_CHECKS:
            if check["views"] is not None and vtype not in check["views"]:
                continue
            if not view_check_passes(check, plan, src.key, vtype):
                return VIEW_REASONS[check["reason"]]
        return None


def _splittable(plan: dict, src: Source, key: Any) -> bool:
    """A source field that can split, or (Task 10.6) a row formula the plan declares: `plan.py`
    has already refused an adding-up formula and a number one (Bucket it) as a split."""
    if isinstance(key, str) and key.startswith(FORMULA_PREFIX):
        return formula_of(plan, key[len(FORMULA_PREFIX):]) is not None
    return bool(getattr(src.fields.get(key), "split", False))


CATALOG = WidgetCatalog()


def formula_fields(source: str) -> dict:
    """{key: widget_formula.FieldInfo} a member formula over `source` may name (Task 10.4): every
    filterable field, an enum typed `text` and a tag typed `tag` (so the dialect refuses it by
    name). One conversion, `plan.formula_field_infos`, which the plan validator runs too."""
    return formula_field_infos(SOURCES[source].fields)


def scan(conn: sqlite3.Connection, plan: dict, settings: dict | None, rng: ResolvedRange,
         user_id: str, *, today: date | None = None) -> Scan:
    """Scan the plan's source for the session member."""
    return SOURCES[plan["source"]].scan(conn, plan, settings, rng, user_id, today=today)
