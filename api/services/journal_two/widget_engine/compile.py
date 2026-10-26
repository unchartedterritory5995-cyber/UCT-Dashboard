"""The whitelist SQL compiler (wave 8, Task 8.5): one bounded, descending scan per widget run.

Every SQL identifier comes from a STATIC fragment written in `sources.py` (`Field.sql`) or in this
file; the plan only ever chooses a key that names one of them. Every value the plan carries,
and every value the session supplies, is a `?` parameter. Nothing else is interpolated: the
row limit is an int this module computes from a whitelisted range token, never plan text.

The scan:

    SELECT <static columns> FROM j2_trades t
     WHERE t.user_id = ? <analytics-included> [AND <account narrows>] <filter fragments>
       AND <ET day spine> BETWEEN ? AND ?
     ORDER BY <ET day spine> DESC, julianday(t.exit_date) DESC, t.id DESC LIMIT 5001

* Newest first is the ET day, then the trade's own close instant, then the id: the id is a
  random uuid, so as the second key it shuffled one day's trades (F-SORT-1). The instant is
  compared through `julianday`, never as text: manual and CSV writers store UTC, but a broker
  import keeps the broker's own offset (`snaptrade_adapter.normalize_date`), so `-04:00`, `Z`
  and fractional stamps share one day and text order is not time order. An unreadable stamp is
  NULL and sorts last. `CLOSED_ORDER` / `OPTION_ORDER` are the
  one statement of each order; `sources.scan_options` re-sorts in Python by the same keys.
* Flagged trades (`analytics_excluded`) are left out by `filters.analytics_included_sql` for every
  view except `list`, which shows them (the spec is "flag, never hide") and marks each one.
* An account id only NARROWS. One that is not the session member's behaves as absent: the
  fragment keeps every row when no account of that id belongs to this member, so a foreign id
  reads exactly like "all my accounts" and can never select another member's rows.
* Tag filters are `EXISTS (SELECT 1 FROM json_each(...) WHERE value IN (?,...))`; a malformed
  stored tag list reads as empty rather than failing the scan. `contains` is `LIKE ? ESCAPE '\\'`
  with `\\`, `%` and `_` escaped in the parameter.
* Fields with no `sql` (effective R, size quartile, hold minutes, the excursion and adherence
  joins...) are filtered after the scan by `aggregate.evaluate`, which also re-applies every SQL
  filter with an exact Python twin, so a row set that never touched SQL (the sample book) is
  filtered the same way.
"""
from __future__ import annotations

import contextvars
from contextlib import contextmanager
from datetime import date, timedelta
from typing import Any, Callable, Iterator

from api.services.journal_two import sample_marker
from api.services.journal_two.filters import _DAY, analytics_included_sql
from api.services.journal_two.widget_engine.plan import (
    FORMULA_PREFIX, PlanError, S_UNKNOWN_FIELD, S_UNKNOWN_OP,
)

#: Rows aggregated at most; the scan reads one more to know it was capped.
SCAN_ROWS = 5000
SCAN_LIMIT = SCAN_ROWS + 1
#: The largest "last N trades" range (plan.RANGE_TOKENS).
LAST_N_MAX = 100


# -- the deadline for work done in Python (W9-R17) -------------------------------------------------
# `run.deadline` interrupts SQL through a progress handler; a scan that loops in Python (routine
# history) asks `check_deadline()` as it goes, and the same `run.deadline` turns `ScanTooLong` into
# `EngineTooLong` (or `Superseded`).

class ScanTooLong(Exception):
    """A Python-side scan ran past its run's deadline (or the run was superseded)."""


_DEADLINE: contextvars.ContextVar[Callable[[], bool] | None] = contextvars.ContextVar(
    "widget_scan_deadline", default=None)


@contextmanager
def python_deadline(expired: Callable[[], bool]) -> Iterator[None]:
    token = _DEADLINE.set(expired)
    try:
        yield
    finally:
        _DEADLINE.reset(token)


def check_deadline() -> None:
    """Raise `ScanTooLong` when the enclosing `run.deadline` has expired; a no-op outside one."""
    expired = _DEADLINE.get()
    if expired is not None and expired():
        raise ScanTooLong()

LIKE_ESCAPE = "\\"

CLOSED_COLUMNS = (
    "t.id, t.symbol, t.side, t.shares, t.entry_price, t.entry_date, t.exit_price, t.exit_date, "
    "t.original_stop, t.setup, t.pnl_dollar, t.pnl_percent, t.r_multiple, t.hold_days, t.result, "
    "COALESCE(t.fees, 0) AS fees, t.regime, t.mistake_tags, t.emotion_tags, t.source, "
    "t.external_id, t.account_id, t.hour_et, t.analytics_excluded, " + _DAY + " AS day"
)

POSITION_COLUMNS = (
    "p.id, p.symbol, p.side, p.entry_date, p.shares, p.entry_price, p.stop_price, p.setup, "
    "p.account_id, p.source, p.entry_estimated, p.broker_price"
)

#: Task 10.6: one options strategy. The legs (earliest expiration) are read apart, for the
#: scanned ids only (`sources._leg_expiry`).
OPTION_COLUMNS = (
    "o.id, o.account_id, o.underlying, o.strategy_type, o.direction, o.entry_date, o.setup, "
    "o.status, o.closed_at, o.pnl_dollar, o.r_multiple, o.result, o.trading_day_et, o.source"
)
#: The day a strategy's row is ORDERED and PRE-FILTERED by: the stamped ET close day, else the
#: UTC date of the close, else of the entry. It is within a day of the ET day either way, so the
#: pre-filter widens the range by one day each side and Python decides the exact ET day
#: (`sources._option_day`), never a day read from UTC.
OPTION_DAY = ("COALESCE(o.trading_day_et, substr(o.closed_at, 1, 10), "
              "substr(o.entry_date, 1, 10))")

#: Newest first (F-SORT-1): the ET day, then the row's own instant (a closed trade's close, a
#: strategy's close or, while open, its entry: the instant `sources._sort_key` orders streaks by),
#: then the id as the last, stable tie-break. Never the id second: it is a random uuid. The
#: instant is `julianday` of the stamp, not its text: stamps carry mixed offsets (broker imports
#: keep theirs), and `sources._instant` is the same reading in Python.
CLOSED_ORDER = f"{_DAY} DESC, julianday(t.exit_date) DESC, t.id DESC"
OPTION_ORDER = (f"{OPTION_DAY} DESC, julianday(COALESCE(o.closed_at, o.entry_date)) DESC,"
                " o.id DESC")

#: Task 10.7: one note, for measuring. ⛔ No body, plain text or title column (railed by a trace):
#: a list or a drill reads the titles apart, by id (`sources.note_titles`).
NOTE_COLUMNS = (
    "n.id, n.created_at, n.updated_at, n.folder_id, n.tags, n.ticker, n.properties_json"
)

#: Per ET day: equity net (pnl_dollar - fees), count, wins, losses, best and worst trade.
DAY_COLUMNS = (
    _DAY + " AS day, "
    "TOTAL(t.pnl_dollar - COALESCE(t.fees, 0)) AS net, COUNT(*) AS n, "
    "SUM(CASE WHEN t.result = 'Win' THEN 1 ELSE 0 END) AS wins, "
    "SUM(CASE WHEN t.result = 'Loss' THEN 1 ELSE 0 END) AS losses, "
    "SUM(CASE WHEN t.source = 'broker' THEN 1 ELSE 0 END) AS broker_n, "
    "SUM(CASE WHEN t.source = 'csv' THEN 1 ELSE 0 END) AS csv_n, "
    "MAX(t.pnl_dollar - COALESCE(t.fees, 0)) AS best, "
    "MIN(t.pnl_dollar - COALESCE(t.fees, 0)) AS worst"
)


def account_param(plan: dict, settings: dict | None) -> str | None:
    """The account the run asks for: the viewer setting when given, else the widget's own."""
    acc: Any = None
    if isinstance(settings, dict) and "accountId" in settings:
        acc = settings.get("accountId")
    else:
        pa = plan.get("accounts")
        if isinstance(pa, dict):
            acc = pa.get("id")
    return acc if isinstance(acc, str) and acc else None


def _account_fragment(col: str, acc: str | None, user_id: str) -> tuple[str, list]:
    if acc is None:
        return "", []
    # Narrows to `acc` when it is this member's account; keeps every row when it is not.
    return (f" AND ({col} = ? OR NOT EXISTS (SELECT 1 FROM j2_accounts a"
            f" WHERE a.id = ? AND a.user_id = ?))", [acc, acc, user_id])


def escape_like(s: str) -> str:
    return (s.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
             .replace("%", LIKE_ESCAPE + "%").replace("_", LIKE_ESCAPE + "_"))


def _marks(n: int) -> str:
    return ",".join("?" * n)


def sql_filterable(fld: Any) -> bool:
    """Is a filter on `fld` applied in SQL? Not when the field has no SQL fragment, and not
    when some rows have no value for it (`Field.missing`, e.g. a date-only trade's ET hour):
    those rows are filtered in Python so the aggregator can say how many it left out."""
    return bool(getattr(fld, "sql", None)) and not getattr(fld, "missing", None)


def filter_fragment(fld: Any, op: str, values: list) -> tuple[str, list] | None:
    """One filter's ` AND ...` fragment, or None when the field is filtered after the scan."""
    expr = getattr(fld, "sql", None)
    if not sql_filterable(fld):
        return None
    if op not in (getattr(fld, "ops", None) or ()):
        raise PlanError(S_UNKNOWN_OP)
    vals = list(values)
    ci = bool(getattr(fld, "ci", False))
    if fld.type == "tag":
        if op != "has_any":
            raise PlanError(S_UNKNOWN_OP)
        return (f" AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid({expr})"
                f" THEN {expr} ELSE '[]' END) WHERE value IN ({_marks(len(vals))}))", vals)
    if op == "in":
        if ci:
            return (f" AND UPPER({expr}) IN ({','.join(['UPPER(?)'] * len(vals))})", vals)
        return f" AND {expr} IN ({_marks(len(vals))})", vals
    if op == "not_in":
        return f" AND ({expr} IS NULL OR {expr} NOT IN ({_marks(len(vals))}))", vals
    if op == "contains":
        return f" AND {expr} LIKE ? ESCAPE '{LIKE_ESCAPE}'", ["%" + escape_like(vals[0]) + "%"]
    if op == "between":
        return f" AND {expr} BETWEEN ? AND ?", vals[:2]
    sym = {"eq": "=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "is": "="}.get(op)
    if sym is None:
        raise PlanError(S_UNKNOWN_OP)
    return f" AND {expr} {sym} ?", vals[:1]


def _filters(source: Any, plan: dict) -> tuple[str, list]:
    frag, params = [], []
    fields = source.fields
    for f in plan.get("filters") or []:
        if str(f.get("field") or "").startswith(FORMULA_PREFIX):
            # Task 10.6: a formula filter is evaluated in Python after the bounded scan
            # (`aggregate.apply_filters`); no part of it ever reaches SQL (spec 5.5).
            continue
        fld = fields.get(f.get("field"))
        if fld is None:
            raise PlanError(S_UNKNOWN_FIELD)
        out = filter_fragment(fld, f["op"], f.get("values") or [])
        if out:
            frag.append(out[0])
            params.extend(out[1])
    return "".join(frag), params


def _range(rng: Any) -> tuple[str, list]:
    if rng.from_day:
        return f" AND {_DAY} BETWEEN ? AND ?", [rng.from_day, rng.to_day]
    return f" AND {_DAY} <= ?", [rng.to_day]


def _shift(day: str, n: int) -> str:
    return (date.fromisoformat(day[:10]) + timedelta(days=n)).isoformat()


def _option_range(rng: Any) -> tuple[str, list]:
    """The options pre-filter: the range widened by one day each side (Python cuts it)."""
    if rng.from_day:
        return (f" AND {OPTION_DAY} BETWEEN ? AND ?",
                [_shift(rng.from_day, -1), _shift(rng.to_day, 1)])
    return f" AND {OPTION_DAY} <= ?", [_shift(rng.to_day, 1)]


def note_membership_sql(user_id: str) -> tuple[str, list]:
    """` WHERE ...` and its params for the notes a notes widget reads: the notes list's own
    everyday question (`notes._notes_filter_sql`: not trashed, not archived) with the sample
    notebook left out (`exclude_sample=True`, `sample_marker.not_sample_sql`). Derived, never
    restated, so the widget and the list cannot disagree about which notes exist."""
    from api.services.journal_two import notes as j2_notes        # notes imports the engine
    sql, params = j2_notes._notes_filter_sql(user_id, exclude_sample=True)
    if sample_marker.not_sample_sql() not in sql:
        raise RuntimeError("the notes predicate lost the sample marker")
    return sql, list(params)


def _note_range(rng: Any) -> tuple[str, list]:
    """The notes pre-filter on `created_at` (a UTC instant): the range widened by one day each side
    (an ET day's notes are stamped on that UTC date or the next); Python cuts it to the ET day."""
    hi = _shift(rng.to_day, 2)
    if rng.from_day:
        return " AND n.created_at >= ? AND n.created_at < ?", [_shift(rng.from_day, -1), hi]
    return " AND n.created_at < ?", [hi]


def last_n_after_filters(source: Any, plan: dict, rng: Any) -> bool:
    """Ruling (fix round 1, Minor 8): "last N trades" means the newest N that pass every
    filter. When a filter runs only in Python, or the view is a list (whose flagged rows must
    not use up N), the scan reads normally and the N are kept after filtering."""
    if rng.last_n is None:
        return False
    if ((plan.get("view") or {}).get("type")) == "list":
        return True
    fields = getattr(source, "fields", {}) or {}
    return any(not sql_filterable(fields.get(f.get("field")))
               for f in plan.get("filters") or [])


def scan_limit(rng: Any, *, after_filters: bool = False) -> int:
    if rng.last_n is not None and not after_filters:
        return max(1, min(int(rng.last_n), LAST_N_MAX))
    return SCAN_LIMIT


def compile_scan(source: Any, plan: dict, settings: dict | None, rng: Any,
                 user_id: str, *, extra: tuple[str, list] = ("", [])) -> tuple[str, list]:
    """The one bounded scan for `source`, as (sql, params). `user_id` is the session member's.
    `extra` (notes only): the note-property fragment `note_properties.property_filter_sql` built
    for the member (`sources.scan_notes`), the one property filter authority."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a scan needs the session member's id")
    acc = account_param(plan, settings)
    key = source.key
    view = ((plan.get("view") or {}).get("type"))
    if key == "closed_trades":
        sql = f"SELECT {CLOSED_COLUMNS} FROM j2_trades t WHERE t.user_id = ?"
        params: list = [user_id]
        if view != "list":
            sql += " " + analytics_included_sql("t")
        a_sql, a_params = _account_fragment("t.account_id", acc, user_id)
        f_sql, f_params = _filters(source, plan)
        r_sql, r_params = _range(rng)
        limit = scan_limit(rng, after_filters=last_n_after_filters(source, plan, rng))
        sql += a_sql + f_sql + r_sql + f" ORDER BY {CLOSED_ORDER} LIMIT {limit}"
        return sql, params + a_params + f_params + r_params
    if key == "open_positions":
        sql = (f"SELECT {POSITION_COLUMNS} FROM j2_positions p"
               " WHERE p.user_id = ? AND p.closed_at IS NULL")
        a_sql, a_params = _account_fragment("p.account_id", acc, user_id)
        f_sql, f_params = _filters(source, plan)
        sql += a_sql + f_sql + f" ORDER BY p.entry_date DESC, p.id DESC LIMIT {SCAN_LIMIT}"
        return sql, [user_id] + a_params + f_params
    if key == "options_strategies":
        sql = f"SELECT {OPTION_COLUMNS} FROM j2_option_strategies o WHERE o.user_id = ?"
        a_sql, a_params = _account_fragment("o.account_id", acc, user_id)
        f_sql, f_params = _filters(source, plan)
        r_sql, r_params = _option_range(rng)
        sql += (a_sql + f_sql + r_sql
                + f" ORDER BY {OPTION_ORDER} LIMIT {SCAN_LIMIT}")
        return sql, [user_id] + a_params + f_params + r_params
    if key == "notes":
        # W10-R59: the notes the member's notes list holds -- not trashed, not archived -- by the
        # list's OWN predicate (`notes._notes_filter_sql`, never restated), and never the sample
        # notebook. Every property filter is `extra`.
        n_sql, n_params = note_membership_sql(user_id)
        sql = f"SELECT {NOTE_COLUMNS} FROM j2_notes n" + n_sql
        a_sql, a_params = _account_fragment("n.account_id", acc, user_id)
        f_sql, f_params = _filters(source, plan)
        x_sql, x_params = extra
        r_sql, r_params = _note_range(rng)
        sql += (a_sql + f_sql + x_sql + r_sql
                + f" ORDER BY n.created_at DESC, n.id DESC LIMIT {SCAN_LIMIT}")
        return sql, n_params + a_params + f_params + list(x_params) + r_params
    if key == "trading_days":
        if not rng.from_day:
            raise ValueError("the trading-days scan needs a bounded range")
        # Every trading-days field is a per-day figure, filtered after aggregation.
        _filters(source, plan)
        sql = (f"SELECT {DAY_COLUMNS} FROM j2_trades t WHERE t.user_id = ? "
               + analytics_included_sql("t"))
        a_sql, a_params = _account_fragment("t.account_id", acc, user_id)
        sql += a_sql + f" AND {_DAY} BETWEEN ? AND ? GROUP BY 1 ORDER BY 1 DESC"
        return sql, [user_id] + a_params + [rng.from_day, rng.to_day]
    raise PlanError("That data isn't available for a widget.")
