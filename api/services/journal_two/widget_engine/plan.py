"""The widget plan: the ONE stored shape of a member-built widget (wave 8, Task 8.4).

Pure. No I/O, no SQL, no clock: `today` is always an argument. The catalog of
sources, fields, measures and accents is a PARAMETER (`Catalog`, declared below
and provided by Task 8.5's `sources.CATALOG`), so this module imports nothing
that touches a database and its tests pass a small stub.

Every `PlanError` carries a sentence a member reads verbatim. Member copy never
says "plan", "source", "scope" or "definition" (Global Constraints, member
words); `test_member_copy_avoids_internal_words` sweeps every `S_*` constant.

`summary()` and `default_name()` are the ONE authority on how a widget describes
itself: the client shows what the server sent and never re-words it.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Mapping, Protocol

from api.services.journal_two.json_depth import _json_depth_exceeds

PLAN_VERSION = 1

RANGE_TOKENS = (
    "today", "this_week", "last_week", "last_7d", "last_30d", "last_90d",
    "this_month", "last_month", "this_quarter", "last_quarter", "ytd", "last_12m",
    "all", "last_20_trades", "last_50_trades", "last_100_trades",
)
VIEWS = ("number", "compare", "table", "bar", "line", "scatter", "heat", "list", "progress")
SOURCES = ("closed_trades", "open_positions", "trading_days")
# Used when a field does not declare its own `ops`.
DEFAULT_OPS = ("eq", "gt", "gte", "lt", "lte", "between", "in", "not_in", "has_any",
               "contains", "is")
_COMPARE_OPS = frozenset({"eq", "gt", "gte", "lt", "lte"})
_LIST_OPS = frozenset({"in", "not_in", "has_any"})
FIELD_TYPES = ("number", "text", "tag", "enum", "bool", "day")
SORT_DIRS = ("asc", "desc")
COMPARE_MODES = ("previous", "all", "range")

DEFAULT_RANGE_TOKEN = "last_90d"
DEFAULT_SORT_TOP = 10
MAX_MEASURES = 3
MAX_FILTERS = 8
MAX_FILTER_VALUES = 50
MAX_OVERRIDABLE = 1
TOP_MIN, TOP_MAX = 1, 40
MAX_TEXT = 200
MAX_PLAN_BYTES = 16_384
MAX_PLAN_DEPTH = 16

# -- member sentences ---------------------------------------------------------
# Given by the spec / brief verbatim:
S_TOO_NEW = "This widget was made with a newer version of the app. Reload to use it."
S_TOO_MANY_MEASURES = "Pick up to 3 measures."
S_ONE_OVERRIDABLE = "Only one filter can be changed from the note."
S_TOP_RANGE = "Top N must be between 1 and 40."
S_START_AFTER_END = "The start date is after the end date."
# Written for this module, in the same voice:
S_NO_VERSION = "This widget couldn't be read. Build it again to use it."
S_UNREADABLE = "This widget's settings couldn't be read."
S_TOO_LARGE = "This widget is too large to save."
S_UNKNOWN_SOURCE = "That data isn't available for a widget."
S_UNKNOWN_FIELD = "That field isn't available here."
S_UNKNOWN_OP = "That filter comparison isn't supported."
S_UNKNOWN_MEASURE = "That measure isn't available."
S_MEASURE_WRONG_DATA = "That measure doesn't apply to what this widget looks at."
S_NO_MEASURE = "Pick at least one measure."
S_UNKNOWN_VIEW = "That view isn't available."
S_UNKNOWN_RANGE = "That date range isn't available."
S_UNKNOWN_ACCENT = "That color isn't available."
S_UNKNOWN_COMPARE = "That comparison isn't available."
S_THEN_TABLE_ONLY = "A second split only works in a table."
S_TOO_MANY_FILTERS = "Use up to 8 filters."
S_TOO_MANY_VALUES = "A filter can hold up to 50 values."
S_TEXT_TOO_LONG = "Text can be at most 200 characters."
S_BAD_DATE = "Dates need to look like 2026-10-24."
S_SORT_MEASURE = "Sort by one of the measures you picked."
S_SORT_DIR = "Sort must be lowest first or highest first."
S_ACCOUNTS = "Pick all your accounts or one account."
S_NO_EARLIER = ("Comparing with the period before needs a date range, "
                "not all time or a number of trades.")
S_FILTER_LOW_HIGH_COUNT = "This filter needs a low value and a high value."
S_FILTER_LOW_ABOVE_HIGH = "The low value is above the high value."
S_FILTER_NEEDS_VALUE = "Pick at least one value for this filter."
S_FILTER_ONE_VALUE = "This filter takes exactly one value."
S_FILTER_VALUE_TYPE = "That value doesn't fit this field."
S_TARGET = "The target must be a number."


class PlanError(ValueError):
    """A refusal whose message is a member sentence (`.sentence`)."""

    def __init__(self, sentence: str):
        super().__init__(sentence)
        self.sentence = sentence


class PlanTooNew(PlanError):
    def __init__(self, sentence: str = S_TOO_NEW):
        super().__init__(sentence)


class Catalog(Protocol):
    """What the validator needs to know. Task 8.5 provides `sources.CATALOG`.

    `sources[key].fields[name]` is field-like (`.label`, optional `.ops`);
    `measures[key]` is measure-like (`.label`, `.sources: frozenset`, `.unit`);
    `accents` lists the accent names; `view_allowed(plan)` returns None or the
    one-line reason the plan's view is disabled.
    """

    sources: Mapping[str, Any]
    measures: Mapping[str, Any]
    accents: tuple[str, ...]

    def view_allowed(self, plan: dict) -> str | None: ...


@dataclass(frozen=True)
class ResolvedRange:
    from_day: str | None
    to_day: str
    last_n: int | None
    label: str
    token: str | None = None  # the range token, or None for a fixed range


# -- small helpers --------------------------------------------------------------

def _is_int(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def _is_number(x: Any) -> bool:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return False
    return math.isfinite(x)


def _need(cond: bool, sentence: str = S_UNREADABLE) -> None:
    if not cond:
        raise PlanError(sentence)


def _only_keys(d: Any, allowed: set[str]) -> dict:
    _need(isinstance(d, dict) and set(d) <= allowed)
    return d


_DAY_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _parse_day(s: Any) -> date:
    if not isinstance(s, str) or not _DAY_RE.fullmatch(s):
        raise PlanError(S_BAD_DATE)
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise PlanError(S_BAD_DATE) from None


def _check_span(frm: Any, to: Any) -> tuple[date, date]:
    a, b = _parse_day(frm), _parse_day(to)
    if a > b:
        raise PlanError(S_START_AFTER_END)
    return a, b


def _walk_strings_too_long(x: Any) -> bool:
    stack = [x]
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            if len(v) > MAX_TEXT:
                return True
        elif isinstance(v, dict):
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
    return False


def _label(obj: Any, fallback: str) -> str:
    lab = getattr(obj, "label", None)
    return lab if isinstance(lab, str) and lab else fallback.replace("_", " ")


def _lower_first(s: str) -> str:
    """'Setup' -> 'setup', 'Closed trades' -> 'closed trades'; 'ET hour' stays."""
    if len(s) >= 2 and s[0].isupper() and not s[1].isupper():
        return s[0].lower() + s[1:]
    return s


def _join_and(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


# -- upgrade + size -------------------------------------------------------------

def upgrade_plan(raw: dict) -> dict:
    """Bring a stored plan to PLAN_VERSION in memory. Identity for v1."""
    if not isinstance(raw, dict) or "v" not in raw:
        raise PlanError(S_NO_VERSION)
    v = raw["v"]
    if not _is_int(v) or v < 1:
        raise PlanError(S_NO_VERSION)
    if v > PLAN_VERSION:
        raise PlanTooNew()
    return raw


def plan_size_ok(raw: Any) -> bool:
    """Compact JSON at most 16,384 bytes and JSON depth at most 16."""
    try:
        blob = json.dumps(raw, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return False
    if len(blob.encode("utf-8")) > MAX_PLAN_BYTES:
        return False
    return not _json_depth_exceeds(raw, MAX_PLAN_DEPTH)


# -- validate -------------------------------------------------------------------

def _valid_day(s: str) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def _fits(ftype: str | None, v: Any) -> bool:
    """Does one filter value match the field's declared type? (None = untyped.)"""
    if ftype == "number":
        return _is_number(v)
    if ftype in ("text", "tag", "enum"):
        return isinstance(v, str)
    if ftype == "bool":
        return isinstance(v, bool)
    if ftype == "day":
        return isinstance(v, str) and bool(_DAY_RE.fullmatch(v)) and _valid_day(v)
    return True


def _check_filter_values(op: str, ftype: str | None, values: list) -> None:
    """Per-op value counts first, then value types against the field's type."""
    if op == "between":
        if len(values) != 2:
            raise PlanError(S_FILTER_LOW_HIGH_COUNT)
    elif op in _LIST_OPS:
        if not values:
            raise PlanError(S_FILTER_NEEDS_VALUE)
    elif len(values) != 1:  # contains, is, eq, gt, gte, lt, lte
        raise PlanError(S_FILTER_ONE_VALUE)
    if op == "contains":
        ok = ftype in (None, "text", "tag", "enum") and isinstance(values[0], str)
    elif op == "is":
        ok = ftype in (None, "bool") and isinstance(values[0], bool)
    elif op == "between" or op in _COMPARE_OPS:
        if ftype == "day":
            ok = all(_fits("day", v) for v in values)
        else:
            ok = ftype in (None, "number") and all(_is_number(v) for v in values)
    else:
        ok = all(_fits(ftype, v) for v in values)
    if not ok:
        raise PlanError(S_FILTER_VALUE_TYPE)
    if op == "between" and values[0] > values[1]:
        raise PlanError(S_FILTER_LOW_ABOVE_HIGH)


_TOP_KEYS = {"v", "source", "accounts", "range", "filters", "measures", "split",
             "view", "sort", "compare", "display"}


def _norm_range(rng: Any) -> dict:
    _need(isinstance(rng, dict))
    if "token" in rng:
        _only_keys(rng, {"token"})
        if rng["token"] not in RANGE_TOKENS:
            raise PlanError(S_UNKNOWN_RANGE)
        return {"token": rng["token"]}
    _need(set(rng) == {"from", "to"})
    _check_span(rng["from"], rng["to"])
    return {"from": rng["from"], "to": rng["to"]}


def validate_plan(raw: dict, catalog: Catalog) -> dict:
    """Upgrade, refuse with a member sentence, return the plan with defaults filled."""
    _need(isinstance(raw, dict))
    upgrade_plan(raw)
    if not plan_size_ok(raw):
        raise PlanError(S_TOO_LARGE)
    _need(set(raw) <= _TOP_KEYS)
    if _walk_strings_too_long(raw):
        raise PlanError(S_TEXT_TOO_LONG)

    source = raw.get("source")
    if not isinstance(source, str) or source not in SOURCES or source not in catalog.sources:
        raise PlanError(S_UNKNOWN_SOURCE)
    fields = getattr(catalog.sources[source], "fields", {}) or {}

    # accounts
    acc = raw.get("accounts", "all")
    if acc == "all":
        accounts: Any = "all"
    else:
        if not (isinstance(acc, dict) and set(acc) == {"id"}
                and isinstance(acc["id"], str) and acc["id"]):
            raise PlanError(S_ACCOUNTS)
        accounts = {"id": acc["id"]}

    rng = _norm_range(raw.get("range", {"token": DEFAULT_RANGE_TOKEN}))

    # filters
    raw_filters = raw.get("filters", [])
    _need(isinstance(raw_filters, list))
    if len(raw_filters) > MAX_FILTERS:
        raise PlanError(S_TOO_MANY_FILTERS)
    filters = []
    for f in raw_filters:
        _only_keys(f, {"field", "op", "values", "overridable"})
        name = f.get("field")
        if not isinstance(name, str) or name not in fields:
            raise PlanError(S_UNKNOWN_FIELD)
        ops = getattr(fields[name], "ops", None) or DEFAULT_OPS
        op = f.get("op")
        # A non-string op is refused BEFORE the membership test: `ops` may be a
        # set, and `["x"] in frozenset()` raises TypeError instead of answering.
        if not isinstance(op, str) or op not in ops:
            raise PlanError(S_UNKNOWN_OP)
        values = f.get("values", [])
        _need(isinstance(values, list))
        if len(values) > MAX_FILTER_VALUES:
            raise PlanError(S_TOO_MANY_VALUES)
        _need(all(isinstance(x, (str, bool)) or _is_number(x) for x in values))
        _check_filter_values(op, getattr(fields[name], "type", None), values)
        over = f.get("overridable", False)
        _need(isinstance(over, bool))
        filters.append({"field": name, "op": f["op"], "values": list(values),
                        "overridable": over})
    if sum(1 for f in filters if f["overridable"]) > MAX_OVERRIDABLE:
        raise PlanError(S_ONE_OVERRIDABLE)

    # measures
    raw_measures = raw.get("measures", [])
    _need(isinstance(raw_measures, list))
    if not raw_measures:
        raise PlanError(S_NO_MEASURE)
    if len(raw_measures) > MAX_MEASURES:
        raise PlanError(S_TOO_MANY_MEASURES)
    measures = []
    for m in raw_measures:
        _only_keys(m, {"key"})
        key = m.get("key")
        if not isinstance(key, str) or key not in catalog.measures:
            raise PlanError(S_UNKNOWN_MEASURE)
        if source not in (getattr(catalog.measures[key], "sources", None) or ()):
            raise PlanError(S_MEASURE_WRONG_DATA)
        measures.append({"key": key})

    # split
    raw_split = raw.get("split")
    split = None
    if raw_split is not None:
        _only_keys(raw_split, {"by", "then"})
        by, then = raw_split.get("by"), raw_split.get("then")
        if not isinstance(by, str) or by not in fields:
            raise PlanError(S_UNKNOWN_FIELD)
        if then is not None and (not isinstance(then, str) or then not in fields):
            raise PlanError(S_UNKNOWN_FIELD)
        split = {"by": by, "then": then}

    # view
    if "view" in raw:
        rv = _only_keys(raw["view"], {"type", "auto"})
        vtype = rv.get("type")
        if vtype not in VIEWS:
            raise PlanError(S_UNKNOWN_VIEW)
        auto = rv.get("auto", True)
        _need(isinstance(auto, bool))
    else:
        vtype = "number" if split is None else ("table" if split["then"] else "bar")
        auto = True
    view = {"type": vtype, "auto": auto}
    if split and split["then"] is not None and vtype != "table":
        raise PlanError(S_THEN_TABLE_ONLY)

    # sort
    raw_sort = raw.get("sort")
    sort = None
    if raw_sort is not None:
        _only_keys(raw_sort, {"measure", "dir", "top"})
        mi = raw_sort.get("measure", 0)
        d = raw_sort.get("dir", "desc")
        top = raw_sort.get("top", DEFAULT_SORT_TOP)
        _need(_is_int(mi) and _is_int(top) and isinstance(d, str))
        if not 0 <= mi < len(measures):
            raise PlanError(S_SORT_MEASURE)
        if d not in SORT_DIRS:
            raise PlanError(S_SORT_DIR)
        if not TOP_MIN <= top <= TOP_MAX:
            raise PlanError(S_TOP_RANGE)
        sort = {"measure": mi, "dir": d, "top": top}

    # compare
    raw_cmp = raw.get("compare")
    compare = None
    if raw_cmp is not None:
        _need(isinstance(raw_cmp, dict))
        mode = raw_cmp.get("mode")
        if mode not in COMPARE_MODES:
            raise PlanError(S_UNKNOWN_COMPARE)
        if mode == "range":
            _need(set(raw_cmp) == {"mode", "from", "to"})
            _check_span(raw_cmp["from"], raw_cmp["to"])
            compare = {"mode": "range", "from": raw_cmp["from"], "to": raw_cmp["to"]}
        else:
            _need(set(raw_cmp) == {"mode"})
            if mode == "previous" and rng.get("token") in _UNBOUNDED_TOKENS:
                raise PlanError(S_NO_EARLIER)
            compare = {"mode": mode}

    # display
    rd = _only_keys(raw.get("display", {}),
                    {"title", "titleAuto", "subtitle", "accent", "showN", "target"})
    accents = tuple(getattr(catalog, "accents", ()) or ())
    display = {
        "title": rd.get("title", ""),
        "titleAuto": rd.get("titleAuto", True),
        "subtitle": rd.get("subtitle", ""),
        "accent": rd.get("accent", accents[0] if accents else ""),
        "showN": rd.get("showN", True),
        "target": rd.get("target"),
    }
    _need(isinstance(display["title"], str) and isinstance(display["subtitle"], str)
          and isinstance(display["titleAuto"], bool) and isinstance(display["showN"], bool))
    if display["accent"] not in accents:
        raise PlanError(S_UNKNOWN_ACCENT)
    if display["target"] is not None and not _is_number(display["target"]):
        raise PlanError(S_TARGET)

    plan = {
        "v": raw["v"], "source": source, "accounts": accounts, "range": rng,
        "filters": filters, "measures": measures, "split": split, "view": view,
        "sort": sort, "compare": compare, "display": display,
    }
    # Defaults add bytes: a raw plan just under the cap can grow past it.
    if not plan_size_ok(plan):
        raise PlanError(S_TOO_LARGE)
    reason = catalog.view_allowed(plan)
    if reason:
        raise PlanError(reason)
    return plan


# -- ranges ---------------------------------------------------------------------

_LAST_N_TRADES = {"last_20_trades": 20, "last_50_trades": 50, "last_100_trades": 100}
_UNBOUNDED_TOKENS = frozenset({"all", *_LAST_N_TRADES})
_TRAILING_DAYS = {"last_7d": 7, "last_30d": 30, "last_90d": 90}
_TOKEN_LABELS = {
    "today": "today", "this_week": "this week", "last_week": "last week",
    "last_7d": "last 7 days", "last_30d": "last 30 days", "last_90d": "last 90 days",
    "this_month": "this month", "last_month": "last month",
    "this_quarter": "this quarter", "last_quarter": "last quarter",
    "ytd": "year to date", "last_12m": "last 12 months", "all": "all time",
    "last_20_trades": "last 20 trades", "last_50_trades": "last 50 trades",
    "last_100_trades": "last 100 trades",
}


def _fmt_day(d: date, with_year: bool) -> str:
    s = f"{d.strftime('%b')} {d.day}"
    return f"{s}, {d.year}" if with_year else s


def _fmt_span(a: date, b: date) -> str:
    if a == b:
        return _fmt_day(a, True)
    if a.year == b.year:
        return f"{_fmt_day(a, False)} to {_fmt_day(b, True)}"
    return f"{_fmt_day(a, True)} to {_fmt_day(b, True)}"


def _quarter_start(d: date) -> date:
    return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)


def _one_year_before(d: date) -> date:
    try:
        return d.replace(year=d.year - 1)
    except ValueError:  # Feb 29
        return d.replace(year=d.year - 1, day=28)


def resolve_range(rng: dict, today: date) -> ResolvedRange:
    """A plan range on `today`. Weeks start Monday; 'all' has no lower bound."""
    norm = _norm_range(rng)
    t = today
    if "from" in norm:
        a, b = _check_span(norm["from"], norm["to"])
        return ResolvedRange(a.isoformat(), b.isoformat(), None, _fmt_span(a, b))
    tok = norm["token"]
    label = _TOKEN_LABELS[tok]
    if tok in _LAST_N_TRADES:
        return ResolvedRange(None, t.isoformat(), _LAST_N_TRADES[tok], label, tok)
    if tok == "all":
        return ResolvedRange(None, t.isoformat(), None, label, tok)
    if tok == "today":
        a, b = t, t
    elif tok == "this_week":
        a, b = t - timedelta(days=t.weekday()), t
    elif tok == "last_week":
        b = t - timedelta(days=t.weekday() + 1)
        a = b - timedelta(days=6)
    elif tok in _TRAILING_DAYS:
        a, b = t - timedelta(days=_TRAILING_DAYS[tok] - 1), t
    elif tok == "this_month":
        a, b = t.replace(day=1), t
    elif tok == "last_month":
        b = t.replace(day=1) - timedelta(days=1)
        a = b.replace(day=1)
    elif tok == "this_quarter":
        a, b = _quarter_start(t), t
    elif tok == "last_quarter":
        b = _quarter_start(t) - timedelta(days=1)
        a = _quarter_start(b)
    elif tok == "ytd":
        a, b = date(t.year, 1, 1), t
    else:  # last_12m
        a, b = _one_year_before(t) + timedelta(days=1), t
    return ResolvedRange(a.isoformat(), b.isoformat(), None, label, tok)


def _last_day_of_month(y: int, m: int) -> int:
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return (nxt - timedelta(days=1)).day


def _add_months(d: date, months: int) -> date:
    """`d` moved by whole months, the day clamped to the target month's last day."""
    y, m0 = divmod(d.year * 12 + (d.month - 1) + months, 12)
    m = m0 + 1
    return date(y, m, min(d.day, _last_day_of_month(y, m)))


def _span_label(a: date, b: date) -> str:
    """'August 2026' for a whole month, 'Q2 2026' for a whole quarter, else the span."""
    if a.day == 1 and b == _add_months(a, 1) - timedelta(days=1):
        return f"{a.strftime('%B')} {a.year}"
    if a == _quarter_start(a) and b == _add_months(a, 3) - timedelta(days=1):
        return f"Q{(a.month - 1) // 3 + 1} {a.year}"
    return _fmt_span(a, b)


def previous_range(r: ResolvedRange) -> ResolvedRange:
    """The period before `r`, aligned to the calendar its token names (R-11).

    today -> the previous trading session; this/last week, month and quarter ->
    the same stretch of the period before; ytd -> the same span a year earlier;
    last_12m -> the 12 months before; trailing days and fixed ranges -> the same
    number of days ending the day before `r` starts. `all` and last-N-trades
    have no earlier period.
    """
    if r.from_day is None or r.last_n is not None:
        raise PlanError(S_NO_EARLIER)
    a, b = date.fromisoformat(r.from_day), date.fromisoformat(r.to_day)
    tok = r.token

    def out(na: date, nb: date, label: str) -> ResolvedRange:
        return ResolvedRange(na.isoformat(), nb.isoformat(), None, label, None)

    if tok == "today":
        from api.services.journal_two import trading_days
        d = trading_days.session_on_or_before(a - timedelta(days=1))
        return out(d, d, _fmt_day(d, True))
    if tok in ("this_week", "last_week"):
        na, nb = a - timedelta(days=7), b - timedelta(days=7)
        return out(na, nb, f"the week of {_fmt_day(na, False)}")
    if tok in ("this_month", "last_month", "this_quarter", "last_quarter"):
        step = 1 if tok.endswith("month") else 3
        na = _add_months(a, -step)
        if tok.startswith("last_"):   # a whole period: through its last day
            nb = _add_months(na, step) - timedelta(days=1)
        else:                          # period to date: the same day of it
            nb = _add_months(b, -step)
        return out(na, nb, _span_label(na, nb))
    if tok == "ytd":
        na, nb = date(a.year - 1, 1, 1), _one_year_before(b)
        return out(na, nb, _fmt_span(na, nb))
    if tok == "last_12m":
        nb = a - timedelta(days=1)
        na = _one_year_before(nb) + timedelta(days=1)
        return out(na, nb, _fmt_span(na, nb))
    length = (b - a).days
    nb = a - timedelta(days=1)
    na = nb - timedelta(days=length)
    return out(na, nb, _span_label(na, nb))


# -- summary + name + hash ------------------------------------------------------

def _range_label(rng: dict) -> str:
    if "token" in rng:
        return _TOKEN_LABELS[rng["token"]]
    a, b = _check_span(rng["from"], rng["to"])
    return _fmt_span(a, b)


def _range_phrase(rng: dict) -> str:
    label = _range_label(rng)
    tok = rng.get("token")
    if tok is None:
        return f"from {label}"
    if tok in _TRAILING_DAYS or tok == "last_12m" or tok in _LAST_N_TRADES:
        return f"in the {label}"
    if tok == "ytd":
        return "so far this year"
    if tok == "all":
        return "over all time"
    return label


def _measure_labels(plan: dict, catalog: Catalog) -> str:
    return _join_and([_label(catalog.measures.get(m["key"]), m["key"])
                      for m in plan["measures"]])


def _field_label(plan: dict, catalog: Catalog, name: str) -> str:
    fields = getattr(catalog.sources.get(plan["source"]), "fields", {}) or {}
    return _lower_first(_label(fields.get(name), name))


def summary(plan: dict, catalog: Catalog, count: int | None, unit: str) -> str:
    """The one plain-language sentence describing a widget (and its row count)."""
    parts = []
    split = plan.get("split")
    if split:
        s = f"split by {_field_label(plan, catalog, split['by'])}"
        if split.get("then"):
            s += f" then {_field_label(plan, catalog, split['then'])}"
        parts.append(s)
    filt = list(dict.fromkeys(f["field"] for f in plan.get("filters") or []))
    if filt:
        parts.append("filtered by " + _join_and([_field_label(plan, catalog, f) for f in filt]))
    src = _lower_first(_label(catalog.sources.get(plan["source"]), plan["source"]))
    for_clause = f"for {src} {_range_phrase(plan['range'])}"
    head = _measure_labels(plan, catalog)
    head = ", ".join([head, *parts, for_clause]) if parts else f"{head} {for_clause}"
    tail = []
    cmp = plan.get("compare")
    if cmp:
        if cmp["mode"] == "previous":
            tail.append("compared with the period before")
        elif cmp["mode"] == "all":
            tail.append("compared with all time")
        else:
            a, b = _check_span(cmp["from"], cmp["to"])
            tail.append(f"compared with {_fmt_span(a, b)}")
    tail.append("all accounts" if plan.get("accounts", "all") == "all" else "one account")
    text = ", ".join([head, *tail]) + "."
    if count is not None:
        u = unit[:-1] if count == 1 and unit.endswith("s") else unit
        text += f" {count:,} {u}."
    return text


def default_name(plan: dict, catalog: Catalog) -> str:
    """The automatic title, e.g. 'Net P&L by setup, last 90 days'."""
    name = _measure_labels(plan, catalog)
    split = plan.get("split")
    if split:
        by = [_field_label(plan, catalog, split["by"])]
        if split.get("then"):
            by.append(_field_label(plan, catalog, split["then"]))
        name += " by " + " and ".join(by)
    name += ", " + _range_label(plan["range"])
    return name[:MAX_TEXT]


def plan_hash(plan: dict) -> str:
    """sha1 of the canonical compact JSON (sorted keys)."""
    blob = json.dumps(plan, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()
