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

#: Ruling W9-R3: a plan is stored with `v = needed_version(plan)`, so every wave 8 plan stays v1
#: byte-for-byte and only a plan that reads a routine or a tracker is v2 (refused as too new by a
#: server still on wave 8). Ruling W10-R3: a plan with a formula, an options or notes source, or a
#: wave 10 display option is v3 (refused as too new by a server still on wave 9).
PLAN_VERSION = 3

RANGE_TOKENS = (
    "today", "this_week", "last_week", "last_7d", "last_30d", "last_90d",
    "this_month", "last_month", "this_quarter", "last_quarter", "ytd", "last_12m",
    "all", "last_20_trades", "last_50_trades", "last_100_trades",
)
VIEWS = ("number", "compare", "table", "bar", "line", "scatter", "heat", "list", "progress")
SOURCES = ("closed_trades", "open_positions", "trading_days", "routine_history", "tracker_history",
           "options_strategies", "notes")
#: Wave 9: the routine and tracker history sources (dark behind `notebook_widgets_wave_on(9)`).
TOOL_SOURCES = frozenset({"routine_history", "tracker_history"})
#: Wave 10: options strategies and notes (dark behind `notebook_widgets_wave_on(10)`). The sources
#: themselves are Tasks 10.6 and 10.7: until the catalog lists them they are refused as unknown.
WAVE10_SOURCES = frozenset({"options_strategies", "notes"})
#: Wave 10 (Task 10.4): member formulas ("your own fields") and the display options.
FORMULA_FORMATS = ("number", "money", "percent", "r")
#: How a row formula is added up into a measure: a number one, and a yes / no one.
ROW_AGGS = ("sum", "avg", "min", "max")
BOOL_AGGS = ("count", "share")
#: The range tokens a goal target follows, and the account goal each one reads.
GOAL_TOKENS = {"today": "daily", "this_week": "weekly", "this_month": "monthly", "ytd": "yearly"}
STOP_AFTER_MAX = 20
#: The data an account goal follows (a goal target reads the accounts' goals against these).
GOAL_SOURCES = ("closed_trades", "trading_days")
QUADRANTS = ("excursion",)
#: Measures that add up one of the member's note properties (`prop`, a uuid4).
PROP_MEASURES = frozenset({"property_sum"})
#: The filter field that names one note property (`prop`); it may appear more than once.
PROPERTY_FIELD = "property"
#: A filter or split on a row formula names it `formula:<id>`.
FORMULA_PREFIX = "formula:"
#: The display keys wave 10 adds. Each is written only when set.
WAVE10_DISPLAY = ("cumulative", "targetGoal", "stopAfter", "quadrants")
#: Formula ids, f1 to f5 (`widget_formula.MAX_FORMULAS`).
_FORMULA_ID_RE = re.compile(r"f[1-5]")
#: The aggregation of a formula measure, in the words `summary()` uses.
AGG_WORDS = {"sum": "total", "avg": "average", "min": "lowest", "max": "highest",
             "count": "how many", "share": "share"}
#: A field's `ref_kind`: the member's own routine or tracker a filter or split on it names.
REF_KINDS = ("routine", "tracker")
#: The built-in trackers (the member's check-ins), a valid `tracker` ref beside a uuid4.
BUILTIN_TRACKER_REFS = frozenset({"checkin:mood", "checkin:focus"})
# Used when a field does not declare its own `ops`.
#: Filter ops by field type. `sources` takes these three from here; formula filters use them too.
OPS_ENUM = ("in", "not_in")
OPS_NUMBER = ("eq", "gt", "gte", "lt", "lte", "between")
OPS_BOOL = ("is",)
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
S_BAD_CHARACTER = "This widget has a character that can't be saved. Remove it and try again."
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
# Wave 9 (Task 9.8): routine and tracker history, and the trading-days fields that name one.
S_ONE_REF = "A widget can look at one routine and one tracker."
S_TOOL_ACCOUNTS = "Routines and trackers cover all your accounts."
S_BAD_REF = "Pick a routine or tracker for this field."
S_NOT_A_FILTER = "That field can't be used to filter a widget."
# Wave 10 (Task 10.4): formulas, note properties and the display options (given verbatim).
S_TOO_MANY_FORMULAS = "Use up to 5 formula fields."
S_FORMULA_NAME = "Give the field a name."
S_FORMULA_NAME_LONG = "A field name can be at most 60 characters."
S_FORMULA_NAME_TAKEN = "That name is already used."
S_FORMULA_UNKNOWN = "That formula field isn't in this widget."
S_FORMULA_FORMAT = "That format isn't available."
S_FORMULA_AGG = "Pick how to add up this field: total, average, lowest or highest."
S_FORMULA_BOOL_AGG = "Pick how to count this field: how many, or what share."
S_FORMULA_TEXT_MEASURE = "A text field can split a widget but can't be measured."
S_FORMULA_AGG_SPLIT = "A field that adds up rows can't split or filter a widget."
S_FORMULA_SPLIT_NUMBER = "Use Bucket to split by a number."
S_PROP_REQUIRED = "Pick a property for this filter."
S_PROP_MEASURE = "Pick a number property to add up."
S_CUMULATIVE = "A running total works on a line of totals, like Net P&L or Total R."
S_GOAL_RANGE = "A goal target needs today, this week, this month or year to date."
S_GOAL_MEASURE = "A goal target works with Net P&L."
S_GOAL_AND_TARGET = "Pick a number target or your goal, not both."
# Fix round 1 (M2): Net P&L picked on data a goal does not follow (options strategies once 10.6
# widens net_pnl) names the data, never the measure the member got right.
S_GOAL_SOURCE = "A goal target works on closed trades or trading days."
S_STOP_AFTER = "Stop after works with the current streak."
S_STOP_AFTER_RANGE = "Stop after must be 1 to 20 losses."
S_QUADRANTS = "Quadrant labels need a scatter plot."


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


_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _check_ref(kind: str | None, ref: Any) -> str | None:
    """The `ref` a filter or split carries for a field whose `ref_kind` is `kind`: required there,
    refused anywhere else. A routine ref is a uuid4 string; a tracker ref is one, or a built-in."""
    if kind is None:
        if ref is not None:
            raise PlanError(S_UNREADABLE)
        return None
    if not isinstance(ref, str):
        raise PlanError(S_BAD_REF)
    if not (_UUID_RE.fullmatch(ref) or (kind == "tracker" and ref in BUILTIN_TRACKER_REFS)):
        raise PlanError(S_BAD_REF)
    return ref


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
    """Bring a stored plan to PLAN_VERSION in memory. Identity for v1, v2 and v3: v2 only adds the
    routine and tracker sources and `ref`, v3 only adds formulas, two sources, `prop` and four
    display options, so an older plan is already a valid plan of every later format."""
    if not isinstance(raw, dict) or "v" not in raw:
        raise PlanError(S_NO_VERSION)
    v = raw["v"]
    if not _is_int(v) or v < 1:
        raise PlanError(S_NO_VERSION)
    if v > PLAN_VERSION:
        raise PlanTooNew()
    return raw


def plan_size_ok(raw: Any) -> bool:
    """Compact JSON at most 16,384 bytes and JSON depth at most 16.

    Raises `PlanError(S_BAD_CHARACTER)` when the plan holds text that has no UTF-8 form (a lone
    surrogate such as U+D800 reaching us through JSON): every later encode -- the size here,
    `plan_hash`, the stored row -- would otherwise fail as a server error."""
    try:
        blob = json.dumps(raw, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return False
    try:
        size = len(blob.encode("utf-8"))
    except UnicodeEncodeError:
        raise PlanError(S_BAD_CHARACTER) from None
    if size > MAX_PLAN_BYTES:
        return False
    return not _json_depth_exceeds(raw, MAX_PLAN_DEPTH)


# -- version and refs (wave 9) ----------------------------------------------------

def _ref_entries(plan: Any) -> list[tuple[Any, Any]]:
    """(field key, ref) for every `ref` in a plan's filters and split; any shape gets an answer."""
    out: list[tuple[Any, Any]] = []
    if not isinstance(plan, dict):
        return out
    filters = plan.get("filters")
    for f in filters if isinstance(filters, list) else []:
        if isinstance(f, dict) and f.get("ref") is not None:
            out.append((f.get("field"), f["ref"]))
    split = plan.get("split")
    if isinstance(split, dict):
        if split.get("ref") is not None:
            out.append((split.get("by"), split["ref"]))
        if split.get("ref2") is not None:
            out.append((split.get("then"), split["ref2"]))
    return out


def _source_in(plan: dict, keys: frozenset) -> bool:
    src = plan.get("source")
    return isinstance(src, str) and src in keys


def _uses_wave10(plan: Any) -> bool:
    if not isinstance(plan, dict):
        return False
    if _source_in(plan, WAVE10_SOURCES):
        return True
    formulas = plan.get("formulas")
    if isinstance(formulas, list) and formulas:
        return True
    display = plan.get("display")
    return isinstance(display, dict) and any(k in display for k in WAVE10_DISPLAY)


def needed_version(plan: dict) -> int:
    """3 when the plan has a formula, reads options strategies or notes, or sets a wave 10 display
    option (ruling W10-R3); else 2 when it reads a routine or tracker source or any filter or split
    names one (`ref`); else 1 (ruling W9-R3). Total: any value gets an answer."""
    if not isinstance(plan, dict):
        return 1
    if _uses_wave10(plan):
        return 3
    if uses_tools(plan):
        return 2
    return 1


def uses_tools(plan: Any) -> bool:
    """Does the plan read routines or trackers (wave 9)? The router's wave gate, the sample-book
    rule and the trading-days stamp ask this. It is the wave 9 answer on its own, never "the
    version is at least 2": a formula over closed trades reads no routine. Total."""
    if not isinstance(plan, dict):
        return False
    return _source_in(plan, TOOL_SOURCES) or bool(_ref_entries(plan))


def uses_wave10(plan: Any) -> bool:
    """Does the plan need wave 10 (`needed_version(plan) >= 3`)? Total: any value gets an answer."""
    return _uses_wave10(plan)


def formula_of(plan: Any, fid: Any) -> dict | None:
    """The plan's formula entry with id `fid`, or None. Total: any value gets an answer."""
    if not isinstance(plan, dict) or not isinstance(fid, str):
        return None
    formulas = plan.get("formulas")
    for f in formulas if isinstance(formulas, list) else []:
        if isinstance(f, dict) and f.get("id") == fid:
            return f
    return None


# -- formulas (wave 10) ---------------------------------------------------------------------------

#: A field's type as the formula dialect reads it: an enum is text (W10 ruling), a tag stays a tag
#: so the dialect refuses it by name.
_FORMULA_TYPES = {"number": "number", "text": "text", "enum": "text", "bool": "bool", "day": "day",
                  "tag": "tag"}
_ASCII_FOLD = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def _fold(s: str) -> str:
    """ASCII case-insensitive, like the dialect: only A-Z fold."""
    return s.translate(_ASCII_FOLD)


def formula_field_infos(fields: Mapping[str, Any]) -> dict:
    """{key: widget_formula.FieldInfo} for every field a formula may name: filterable, of a type
    the dialect knows, and not one that needs a routine or tracker (`ref_kind`: a formula carries
    no ref) nor the note-property field (it needs `prop`). `sources.formula_fields(source)` is this
    over a real source; the validator runs it over the catalog it is handed. Pure."""
    from api.services.journal_two.widget_formula import FieldInfo   # widget_formula imports us

    out = {}
    for key, fld in fields.items():
        ftype = _FORMULA_TYPES.get(getattr(fld, "type", None))
        if (ftype is None or getattr(fld, "filterable", True) is False
                or getattr(fld, "ref_kind", None) is not None or key == PROPERTY_FIELD):
            continue
        out[key] = FieldInfo(key, _label(fld, key), ftype,
                             hour_key=getattr(fld, "hour_key", None),
                             needs_times=bool(getattr(fld, "needs_times", False)))
    return out


def formula_measure_kind(compiled: Any, agg: str | None) -> str:
    """A formula measure's kind (Task 10.5's `measure_of` reads the same answer): a row formula's
    `agg` decides it; an aggregate formula is `count` when it is exactly one CountIf, `sum` when
    exactly one SumIf, `rate` when exactly one Share, else `average`."""
    if agg is not None:
        return {"sum": "sum", "avg": "average", "min": "extreme", "max": "extreme",
                "count": "count", "share": "rate"}[agg]
    tree = getattr(getattr(compiled, "ast", None), "tree", None)
    if isinstance(tree, tuple) and len(tree) >= 3 and tree[0] == "call":
        if tree[2] == "CountIf":
            return "count"
        if tree[2] == "SumIf":
            return "sum"
        if tree[2] == "Share":
            return "rate"
    return "average"


def _compile_formulas(raw: dict, catalog: Catalog) -> tuple[list[dict], dict]:
    """Validate and compile `raw["formulas"]` against the source's fields. Returns the stored
    entries (expressions CANONICAL, ruling W10-R2) and {id: Compiled}. A `FormulaError` carries
    the formula's id. Runs BEFORE the size check, so a formula error keeps its code and position."""
    from api.services.journal_two import widget_formula as wf   # widget_formula imports us

    source = raw.get("source")
    if not isinstance(source, str) or source not in SOURCES or source not in catalog.sources:
        raise PlanError(S_UNKNOWN_SOURCE)
    fields = getattr(catalog.sources[source], "fields", {}) or {}
    raw_formulas = raw.get("formulas")
    _need(isinstance(raw_formulas, list))
    if len(raw_formulas) > wf.MAX_FORMULAS:
        raise PlanError(S_TOO_MANY_FORMULAS)
    infos = formula_field_infos(fields)
    # an hour is read through a day field's `hour_key`: a derived field, never unknown
    readable = set(infos) | {fi.hour_key for fi in infos.values() if fi.hour_key}
    taken = {_fold(_label(f, k)) for k, f in fields.items()}
    entries: list[dict] = []
    compiled: dict = {}
    for f in raw_formulas:
        _only_keys(f, {"id", "name", "expr", "format"})
        fid = f.get("id")
        if not isinstance(fid, str) or not _FORMULA_ID_RE.fullmatch(fid) or fid in compiled:
            raise PlanError(S_UNREADABLE)
        name = f.get("name")
        # The widget name's trim (`str.strip`: NBSP, U+3000 and the line ends too), then no
        # character the member cannot see: one zero-width or format character would defeat the
        # unique-name and not-a-label rules (fix round 1, M3; the twin needs the same rule).
        name = name.strip() if isinstance(name, str) else ""
        if not name:
            raise PlanError(S_FORMULA_NAME)
        if any(wf._invisible(ch) for ch in name):
            raise PlanError(S_BAD_CHARACTER)
        if len(name) > wf.NAME_MAX:
            raise PlanError(S_FORMULA_NAME_LONG)
        if _fold(name) in taken:
            raise PlanError(S_FORMULA_NAME_TAKEN)
        taken.add(_fold(name))
        fmt = f.get("format", "number")
        if not isinstance(fmt, str) or fmt not in FORMULA_FORMATS:
            raise PlanError(S_FORMULA_FORMAT)
        try:
            c = wf.compile_formula(f.get("expr"), infos)
        except wf.FormulaError as e:
            e.formula_id = fid
            raise
        if not set(c.fields) <= readable:      # defence: a formula reads only its source's fields
            raise PlanError(S_UNKNOWN_FIELD)
        # The STORED form is measured too (fix round 1, I-2): canonicalising writes keys, and a key
        # can be longer than its label (`[Risk $]` -> `[risk_dollars]`), so a formula typed under
        # the limit could be stored over it and refused on every later load.
        if len(c.canonical) > wf.MAX_LENGTH:
            raise wf.FormulaError("too_long", wf.ERRORS["too_long"], wf.MAX_LENGTH, fid)
        compiled[fid] = c
        entries.append({"id": fid, "name": name, "expr": c.canonical, "format": fmt})
    return entries, compiled


def _formula_ref(name: Any, compiled: dict) -> Any:
    """The Compiled of a `formula:<id>` field name, or None when `name` is not one; refuses an id
    the plan does not define."""
    if not isinstance(name, str) or not name.startswith(FORMULA_PREFIX):
        return None
    c = compiled.get(name[len(FORMULA_PREFIX):])
    if c is None:
        raise PlanError(S_FORMULA_UNKNOWN)
    return c


#: The filter ops of a row formula, by its result type: the same tuples `sources` gives its fields
#: (fix round 1, M4: one authority, here, because plan cannot import sources).
_FORMULA_OPS = {"number": OPS_NUMBER, "text": OPS_ENUM, "bool": OPS_BOOL}


def _check_prop(prop: Any, sentence: str) -> str:
    if not isinstance(prop, str) or not _UUID_RE.fullmatch(prop):
        raise PlanError(sentence)
    return prop


def plan_refs(plan: dict, fields: Mapping[str, Any]) -> dict[str, str | None]:
    """{"routine": ref | None, "tracker": ref | None} of a validated plan (one ref per kind)."""
    out: dict[str, str | None] = {k: None for k in REF_KINDS}
    for key, ref in _ref_entries(plan):
        kind = getattr(fields.get(key), "ref_kind", None) if isinstance(key, str) else None
        if kind in out and isinstance(ref, str):
            out[kind] = ref
    return out


def _one_ref_per_kind(plan: dict, fields: Mapping[str, Any]) -> None:
    seen: dict[str, Any] = {}
    for key, ref in _ref_entries(plan):
        kind = getattr(fields.get(key), "ref_kind", None) if isinstance(key, str) else None
        if kind is None:
            continue
        if kind in seen and seen[kind] != ref:
            raise PlanError(S_ONE_REF)
        seen[kind] = ref


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
             "view", "sort", "compare", "display", "formulas"}


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


def _without_exprs(raw: dict) -> dict:
    """`raw` with each formula's expression left out: a formula may be `widget_formula.MAX_LENGTH`
    characters (the dialect refuses past it), every other string at most `MAX_TEXT`."""
    formulas = raw.get("formulas")
    if not isinstance(formulas, list):
        return raw
    return dict(raw, formulas=[{k: v for k, v in f.items() if k != "expr"}
                               if isinstance(f, dict) else f for f in formulas])


def _measure_kind(m: dict, catalog: Catalog, compiled: dict) -> str | None:
    if "formula" in m:
        return formula_measure_kind(compiled[m["formula"]], m.get("agg"))
    return getattr(catalog.measures.get(m["key"]), "kind", None)


def _check_measure(m: Any, source: str, catalog: Catalog, compiled: dict) -> dict:
    _need(isinstance(m, dict))
    if "formula" in m:
        _only_keys(m, {"formula", "agg"})
        fid = m.get("formula")
        c = compiled.get(fid) if isinstance(fid, str) else None
        if c is None:
            raise PlanError(S_FORMULA_UNKNOWN)
        if c.kind == "aggregate":
            _need("agg" not in m)
            return {"formula": fid}
        agg = m.get("agg")
        if c.type == "text":
            raise PlanError(S_FORMULA_TEXT_MEASURE)
        if c.type == "bool":
            if not isinstance(agg, str) or agg not in BOOL_AGGS:
                raise PlanError(S_FORMULA_BOOL_AGG)
        elif not isinstance(agg, str) or agg not in ROW_AGGS:
            raise PlanError(S_FORMULA_AGG)
        return {"formula": fid, "agg": agg}
    _only_keys(m, {"key", "prop"})
    key = m.get("key")
    if not isinstance(key, str) or key not in catalog.measures:
        raise PlanError(S_UNKNOWN_MEASURE)
    if source not in (getattr(catalog.measures[key], "sources", None) or ()):
        raise PlanError(S_MEASURE_WRONG_DATA)
    if key in PROP_MEASURES:
        return {"key": key, "prop": _check_prop(m.get("prop"), S_PROP_MEASURE)}
    _need("prop" not in m)
    return {"key": key}


def _check_display_w10(rd: dict, display: dict, plan: dict, catalog: Catalog,
                       compiled: dict) -> None:
    """Ruling W10-R3: the four wave 10 display keys, each written only when set."""
    vtype = plan["view"]["type"]
    measures = plan["measures"]
    if "cumulative" in rd:
        _need(rd["cumulative"] is True)
        if vtype != "line" or any(_measure_kind(m, catalog, compiled) != "sum" for m in measures):
            raise PlanError(S_CUMULATIVE)
        display["cumulative"] = True
    if "targetGoal" in rd:
        _need(rd["targetGoal"] is True)
        if display["target"] is not None:
            raise PlanError(S_GOAL_AND_TARGET)
        if measures != [{"key": "net_pnl"}]:
            raise PlanError(S_GOAL_MEASURE)
        if plan["source"] not in GOAL_SOURCES:
            raise PlanError(S_GOAL_SOURCE)
        if plan["range"].get("token") not in GOAL_TOKENS:
            raise PlanError(S_GOAL_RANGE)
        _need(vtype == "progress")
        display["targetGoal"] = True
    if "stopAfter" in rd:
        n = rd["stopAfter"]
        if not _is_int(n) or not 1 <= n <= STOP_AFTER_MAX:
            raise PlanError(S_STOP_AFTER_RANGE)
        if not any(m.get("key") == "current_streak" for m in measures):
            raise PlanError(S_STOP_AFTER)
        display["stopAfter"] = n
    if "quadrants" in rd:
        q = rd["quadrants"]
        _need(isinstance(q, str) and q in QUADRANTS)
        if vtype != "scatter":
            raise PlanError(S_QUADRANTS)
        display["quadrants"] = q


def validate_plan(raw: dict, catalog: Catalog) -> dict:
    """Upgrade, refuse with a member sentence, return the plan with defaults filled."""
    _need(isinstance(raw, dict))
    upgrade_plan(raw)
    # Formulas compile FIRST: a formula error keeps its code, position and id (a lone surrogate in
    # an expression is that formula's bad_char, not the plan-level S_BAD_CHARACTER).
    formulas, compiled = _compile_formulas(raw, catalog) if "formulas" in raw else ([], {})
    if not plan_size_ok(raw):
        raise PlanError(S_TOO_LARGE)
    _need(set(raw) <= _TOP_KEYS)
    if _walk_strings_too_long(_without_exprs(raw)):
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
    if source in TOOL_SOURCES:
        if accounts != "all":
            raise PlanError(S_TOOL_ACCOUNTS)
        if rng.get("token") in _LAST_N_TRADES:
            raise PlanError(S_UNKNOWN_RANGE)
    if source in WAVE10_SOURCES and rng.get("token") in _LAST_N_TRADES:
        raise PlanError(S_UNKNOWN_RANGE)

    # filters
    raw_filters = raw.get("filters", [])
    _need(isinstance(raw_filters, list))
    if len(raw_filters) > MAX_FILTERS:
        raise PlanError(S_TOO_MANY_FILTERS)
    filters = []
    for f in raw_filters:
        _only_keys(f, {"field", "op", "values", "overridable", "ref", "prop"})
        name = f.get("field")
        c = _formula_ref(name, compiled)
        if c is not None:
            if c.kind == "aggregate":
                raise PlanError(S_FORMULA_AGG_SPLIT)
            _need(f.get("ref") is None and f.get("prop") is None)
            ref, prop, ftype, ops = None, None, c.type, _FORMULA_OPS[c.type]
        else:
            if not isinstance(name, str) or name not in fields:
                raise PlanError(S_UNKNOWN_FIELD)
            if getattr(fields[name], "filterable", True) is False:
                raise PlanError(S_NOT_A_FILTER)
            ref = _check_ref(getattr(fields[name], "ref_kind", None), f.get("ref"))
            if name == PROPERTY_FIELD:
                prop = _check_prop(f.get("prop"), S_PROP_REQUIRED)
            else:
                _need(f.get("prop") is None)
                prop = None
            ftype = getattr(fields[name], "type", None)
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
        _check_filter_values(op, ftype, values)
        # W9-R21: a field with fixed codes (a routine day's state) stores the CODE, never a label.
        if c is None and getattr(fields[name], "strict_choices", False):
            choices = fields[name].choices
            allowed = {v for v, _label in (choices() if callable(choices) else choices or ())}
            if any(v not in allowed for v in values):
                raise PlanError(S_FILTER_VALUE_TYPE)
        over = f.get("overridable", False)
        _need(isinstance(over, bool))
        clean = {"field": name, "op": f["op"], "values": list(values), "overridable": over}
        if ref is not None:
            clean["ref"] = ref
        if prop is not None:
            clean["prop"] = prop
        filters.append(clean)
    if sum(1 for f in filters if f["overridable"]) > MAX_OVERRIDABLE:
        raise PlanError(S_ONE_OVERRIDABLE)

    # measures
    raw_measures = raw.get("measures", [])
    _need(isinstance(raw_measures, list))
    if not raw_measures:
        raise PlanError(S_NO_MEASURE)
    if len(raw_measures) > MAX_MEASURES:
        raise PlanError(S_TOO_MANY_MEASURES)
    measures = [_check_measure(m, source, catalog, compiled) for m in raw_measures]

    # split
    raw_split = raw.get("split")
    split = None
    if raw_split is not None:
        _only_keys(raw_split, {"by", "then", "ref", "ref2"})
        by, then = raw_split.get("by"), raw_split.get("then")
        kinds: list = []
        for key, optional in ((by, False), (then, True)):
            c = _formula_ref(key, compiled)
            if c is not None:
                if c.kind == "aggregate":
                    raise PlanError(S_FORMULA_AGG_SPLIT)
                if c.type == "number":
                    raise PlanError(S_FORMULA_SPLIT_NUMBER)
                kinds.append(None)
            elif optional and key is None:
                kinds.append(None)
            elif not isinstance(key, str) or key not in fields:
                raise PlanError(S_UNKNOWN_FIELD)
            else:
                kinds.append(getattr(fields[key], "ref_kind", None))
        split = {"by": by, "then": then}
        # `ref` names the routine or tracker of `by`, `ref2` the one of `then`.
        ref = _check_ref(kinds[0], raw_split.get("ref"))
        ref2 = _check_ref(kinds[1], raw_split.get("ref2"))
        if ref is not None:
            split["ref"] = ref
        if ref2 is not None:
            split["ref2"] = ref2

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
                    {"title", "titleAuto", "subtitle", "accent", "showN", "target",
                     *WAVE10_DISPLAY})
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
    _check_display_w10(rd, display, plan, catalog, compiled)
    # W10-R3: `formulas` is written only when the plan has one.
    if formulas:
        plan["formulas"] = formulas
    _one_ref_per_kind(plan, fields)
    # Ruling W9-R3 / W10-R3: the version is what the plan needs, never what the sender wrote: a
    # plain plan is v1 whoever built it, a routine or tracker plan v2, a wave 10 plan v3.
    plan["v"] = needed_version(plan)
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


#: Ruling R-17: open positions are always what is open now; the stored range is ignored for them.
RIGHT_NOW_SOURCES = frozenset({"open_positions"})
RIGHT_NOW = "right now"


def range_label_for(plan: dict, rng: "ResolvedRange") -> str:
    """The range a widget shows: 'Right now' for open positions (never a date span), else
    the resolved range's own label. Task 8.6's payload reads its `rangeLabel` from here."""
    if plan.get("source") in RIGHT_NOW_SOURCES:
        return RIGHT_NOW[:1].upper() + RIGHT_NOW[1:]
    return rng.label


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


def _formula_name(plan: dict, fid: Any) -> str:
    f = formula_of(plan, fid)
    return f["name"] if f is not None and isinstance(f.get("name"), str) else str(fid)


def _measure_label(plan: dict, catalog: Catalog, m: dict) -> str:
    """A measure's words. A formula measure is named by its own name, a row formula with the
    aggregation in words ("Exit efficiency (average)")."""
    if "formula" in m:
        name = _formula_name(plan, m["formula"])
        agg = m.get("agg")
        return f"{name} ({AGG_WORDS[agg]})" if agg in AGG_WORDS else name
    return _label(catalog.measures.get(m["key"]), m["key"])


def _measure_labels(plan: dict, catalog: Catalog) -> str:
    return _join_and([_measure_label(plan, catalog, m) for m in plan["measures"]])


def _field_label(plan: dict, catalog: Catalog, name: str) -> str:
    if isinstance(name, str) and name.startswith(FORMULA_PREFIX):
        return _formula_name(plan, name[len(FORMULA_PREFIX):])    # the member's own words, as typed
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
    when = RIGHT_NOW if plan.get("source") in RIGHT_NOW_SOURCES else _range_phrase(plan["range"])
    for_clause = f"for {src} {when}"
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
        if count == 0 and plan.get("source") in TOOL_SOURCES:
            # a new routine or tracker has nothing yet; "0 days" reads as a failure
            text += f" No {unit} yet."
        else:
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
    name += ", " + (RIGHT_NOW if plan.get("source") in RIGHT_NOW_SOURCES
                    else _range_label(plan["range"]))
    return name[:MAX_TEXT]


def plan_hash(plan: dict) -> str:
    """sha1 of the canonical compact JSON (sorted keys)."""
    blob = json.dumps(plan, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()
