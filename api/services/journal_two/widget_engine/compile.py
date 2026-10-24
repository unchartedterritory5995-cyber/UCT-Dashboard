"""The whitelist SQL compiler (wave 8, Task 8.5): one bounded, descending scan per widget run.

Every SQL identifier comes from a STATIC fragment written in `sources.py` (`Field.sql`) or in this
file; the plan only ever chooses a key that names one of them. Every value the plan carries,
and every value the session supplies, is a `?` parameter. Nothing else is interpolated: the
row limit is an int this module computes from a whitelisted range token, never plan text.

The scan:

    SELECT <static columns> FROM j2_trades t
     WHERE t.user_id = ? <analytics-included> [AND <account narrows>] <filter fragments>
       AND <ET day spine> BETWEEN ? AND ?
     ORDER BY <ET day spine> DESC, t.id DESC LIMIT 5001

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

from typing import Any

from api.services.journal_two.filters import _DAY, analytics_included_sql
from api.services.journal_two.widget_engine.plan import PlanError, S_UNKNOWN_FIELD, S_UNKNOWN_OP

#: Rows aggregated at most; the scan reads one more to know it was capped.
SCAN_ROWS = 5000
SCAN_LIMIT = SCAN_ROWS + 1
#: The largest "last N trades" range (plan.RANGE_TOKENS).
LAST_N_MAX = 100

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

#: Per ET day: equity net (pnl_dollar - fees), count, wins, losses, best and worst trade.
DAY_COLUMNS = (
    _DAY + " AS day, "
    "TOTAL(t.pnl_dollar - COALESCE(t.fees, 0)) AS net, COUNT(*) AS n, "
    "SUM(CASE WHEN t.result = 'Win' THEN 1 ELSE 0 END) AS wins, "
    "SUM(CASE WHEN t.result = 'Loss' THEN 1 ELSE 0 END) AS losses, "
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


def filter_fragment(fld: Any, op: str, values: list) -> tuple[str, list] | None:
    """One filter's ` AND ...` fragment, or None when the field is filtered after the scan."""
    expr = getattr(fld, "sql", None)
    if not expr:
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


def scan_limit(rng: Any) -> int:
    if rng.last_n is not None:
        return max(1, min(int(rng.last_n), LAST_N_MAX))
    return SCAN_LIMIT


def compile_scan(source: Any, plan: dict, settings: dict | None, rng: Any,
                 user_id: str) -> tuple[str, list]:
    """The one bounded scan for `source`, as (sql, params). `user_id` is the session member's."""
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
        sql += a_sql + f_sql + r_sql + f" ORDER BY {_DAY} DESC, t.id DESC LIMIT {scan_limit(rng)}"
        return sql, params + a_params + f_params + r_params
    if key == "open_positions":
        sql = (f"SELECT {POSITION_COLUMNS} FROM j2_positions p"
               " WHERE p.user_id = ? AND p.closed_at IS NULL")
        a_sql, a_params = _account_fragment("p.account_id", acc, user_id)
        f_sql, f_params = _filters(source, plan)
        sql += a_sql + f_sql + f" ORDER BY p.entry_date DESC, p.id DESC LIMIT {SCAN_LIMIT}"
        return sql, [user_id] + a_params + f_params
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
