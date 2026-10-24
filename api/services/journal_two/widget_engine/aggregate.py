"""The aggregator (wave 8, Task 8.5): filter, split and measure one scan's rows.

`evaluate(rows, plan, catalog) -> Result` is pure. It:

1. applies every filter in Python (the exact twin of `compile`'s SQL, plus the Python-only fields),
   so rows that never touched SQL (the sample book) are filtered the same way;
2. leaves flagged trades out of every measure (a List view still shows them, `flagged=True`);
3. groups by the split field(s) in a `dict` keyed by Python strings, so member text such as
   `__proto__` is only ever a key; a group's label is `_clip(str(key), 60)`;
4. measures each group and the total through `widget_engine.measures` (the shared module);
5. sorts and keeps the top N after grouping;
6. says what it left out: rows with no value for a split (a date-only trade has no ET hour),
   trades with dates only for a hold-minutes filter, and the R coverage hint.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from api.services.journal_two.notebook_widgets import _clip, _num
from api.services.journal_two.widget_engine import measures as wmeasures

LABEL_MAX = 60
#: The Coverage hint for an R measure known on fewer than half the trades (spec 5.2).
HINT_ADD_STOPS = "Add stops to see R for more trades"
S_HOLD_MINUTES_NO_TIMES = ("Hold time in minutes needs entry and exit times; your trades have "
                           "dates only")
S_HOLD_MINUTES_SOME = "{n} {trades} {have} dates only and {are} not in the hold-time filter."
S_SPLIT_MISSING = "{n} {rows} {have} {missing} and {are} not in this split."
#: The same fact for a filter: rows with no value for the field cannot pass it (fix round 1).
S_FILTER_MISSING = "{n} {rows} {have} {missing} and {are} left out."

_NONE_KEY = "\x00none"
_SINGULAR = {"trades": "trade", "positions": "position", "days": "day", "entries": "entry"}


@dataclass(frozen=True)
class Coverage:
    have: int
    total: int
    hint: str | None = None


@dataclass(frozen=True)
class GroupValues:
    cells: list[wmeasures.Cell]
    n: int                     # rows in the group (the source's unit)


@dataclass(frozen=True)
class Group:
    key: str
    label: str
    values: GroupValues
    key2: str | None = None
    label2: str | None = None
    flagged: bool = False
    day: str | None = None     # a per-row group's day (List, Scatter)
    result: str | None = None  # a per-row group's result (Scatter)


@dataclass(frozen=True)
class Result:
    groups: list[Group]
    total: GroupValues
    coverage: list[Coverage]
    footnotes: list[str] = field(default_factory=list)
    count: int = 0             # rows the measures read (flagged trades are never among them)


# ── filters ────────────────────────────────────────────────────────────────────────────────────

def _ascii_upper(s: str) -> str:
    return "".join(chr(ord(c) - 32) if "a" <= c <= "z" else c for c in s)


def _ascii_lower(s: str) -> str:
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)


def _cmp_value(fld: Any, v: Any) -> Any:
    if fld.type == "day":
        return v if isinstance(v, str) else None
    return _num(v)


def matches(fld: Any, op: str, values: list, v: Any) -> bool:
    """Python twin of `compile.filter_fragment` for one row's value `v`."""
    if fld.type == "tag":
        tags = v if isinstance(v, list) else []
        return any(t in values for t in tags)
    if op == "is":
        return isinstance(v, bool) and v == values[0]
    if op == "in":
        if v is None:
            return False
        if getattr(fld, "ci", False) and isinstance(v, str):
            return _ascii_upper(v) in {_ascii_upper(x) for x in values if isinstance(x, str)}
        return v in values
    if op == "not_in":
        return v is None or v not in values
    if op == "contains":
        return (isinstance(v, str) and isinstance(values[0], str)
                and _ascii_lower(values[0]) in _ascii_lower(v))
    x = _cmp_value(fld, v)
    if x is None:
        return False
    vals = [_cmp_value(fld, y) for y in values]
    if any(y is None for y in vals):
        return False
    if op == "between":
        return vals[0] <= x <= vals[1]
    a = vals[0]
    return {"eq": x == a, "gt": x > a, "gte": x >= a, "lt": x < a, "lte": x <= a}.get(op, False)


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def _noun(unit: str, n: int) -> str:
    return _SINGULAR.get(unit, unit) if n == 1 else unit


def _apply_filters(rows: list[dict], plan: dict, src: Any, notes: list[str]) -> list[dict]:
    kept = rows
    for f in plan.get("filters") or []:
        fld = src.fields[f["field"]]
        values = f.get("values") or []
        if fld.needs_times:
            live = [r for r in kept if not r.get("flagged")]
            missing = sum(1 for r in live if r.get(fld.key) is None)
            if live and missing == len(live):
                notes.append(S_HOLD_MINUTES_NO_TIMES)
            elif missing:
                notes.append(S_HOLD_MINUTES_SOME.format(
                    n=missing, trades=_noun(src.unit, missing),
                    have=_plural(missing, "has", "have"), are=_plural(missing, "is", "are")))
        elif fld.missing:
            # A filter on a field some rows have no value for (a date-only trade has no ET
            # hour) leaves those rows out; say how many, as the split does.
            gone = sum(1 for r in kept if not r.get("flagged") and r.get(fld.key) is None
                       and not matches(fld, f["op"], values, None))
            if gone:
                notes.append(S_FILTER_MISSING.format(
                    n=gone, rows=_noun(src.unit, gone), have=_plural(gone, "has", "have"),
                    missing=fld.missing, are=_plural(gone, "is", "are")))
        kept = [r for r in kept if matches(fld, f["op"], values, r.get(fld.key))]
    return kept


def apply_filters(rows: list[dict], plan: dict, src: Any) -> list[dict]:
    """Every filter of `plan` over `rows`, in Python (no footnotes)."""
    return _apply_filters(rows, plan, src, [])


def _estimated_note(plan: dict, rows: list[dict]) -> str | None:
    """Open positions: how many of the rows that passed every filter have an estimated
    entry date, when the widget reads days open."""
    from api.services.journal_two.widget_engine import sources as wsources
    if not wsources._uses(plan, "days_open"):
        return None
    n = sum(1 for r in rows if r.get("entry_estimated"))
    if not n:
        return None
    return wsources.DAYS_OPEN_ESTIMATED.format(
        n=n, positions=_plural(n, "position", "positions"), have=_plural(n, "has", "have"),
        are=_plural(n, "is", "are"))


# ── grouping ───────────────────────────────────────────────────────────────────────────────────

def _keys_of(fld: Any, row: dict) -> list[str | None]:
    """A row's group keys for one field (a tag field gives one per tag)."""
    v = row.get(fld.key)
    if fld.type == "tag":
        tags = [t for t in (v if isinstance(v, list) else []) if isinstance(t, str)]
        return list(dict.fromkeys(tags)) or [None]
    if v is None:
        return [None]
    if isinstance(v, float) and v.is_integer():
        return [str(int(v))]
    return [str(v)]


def _label(fld: Any, key: str, row: dict) -> str:
    if key == _NONE_KEY:
        text = fld.none_label or ""
    elif fld.label_from and row.get(fld.label_from):
        text = str(row[fld.label_from])
    elif fld.fmt is not None:
        raw = row.get(fld.key)
        if fld.type in ("tag",) or isinstance(raw, (list, dict)):
            raw = key
        text = fld.fmt(raw)
    else:
        text = key
    return _clip(str(text), LABEL_MAX)


def _missing_note(fld: Any, unit: str, n: int) -> str:
    missing = fld.missing or f"no {fld.label[:1].lower() + fld.label[1:]}"
    return S_SPLIT_MISSING.format(n=n, rows=_noun(unit, n), have=_plural(n, "has", "have"),
                                  missing=missing, are=_plural(n, "is", "are"))


def _natural_key(fld: Any, key: str):
    if key == _NONE_KEY:
        return (2, 0, "")
    if fld.bucket:
        try:
            return (0, list(map(str, fld.bucket)).index(key), key)
        except ValueError:
            return (1, 0, key)
    if fld.type == "number":
        n = _num(key)
        return (0, n if n is not None else 0.0, key)
    return (0, 0, key)


def _ordered_naturally(fld: Any) -> bool:
    return bool(fld.bucket) or fld.type in ("day", "number") or fld.key == "month"


def _cells(plan: dict, catalog: Any, source_key: str, rows: list[dict]) -> list[wmeasures.Cell]:
    return [wmeasures.evaluate(catalog.measures[m["key"]], source_key, rows)
            for m in plan["measures"]]


def _empty_cells(plan: dict) -> list[wmeasures.Cell]:
    return [wmeasures.Cell(None, 0, None, "") for _ in plan["measures"]]


def _sort(groups: list[Group], plan: dict, fld: Any | None) -> list[Group]:
    sort = plan.get("sort")
    if sort:
        mi, desc = sort["measure"], sort["dir"] == "desc"
        have = [g for g in groups if g.values.cells[mi].value is not None]
        none = [g for g in groups if g.values.cells[mi].value is None]
        have.sort(key=lambda g: (g.values.cells[mi].value, g.label), reverse=desc)
        none.sort(key=lambda g: g.label)
        return (have + none)[:sort["top"]]
    if fld is None:
        return groups
    if _ordered_naturally(fld):
        return sorted(groups, key=lambda g: (_natural_key(fld, g.key), g.key2 or ""))
    # A category with no natural order: largest first measure first, then by label.
    return sorted(groups, key=lambda g: (
        g.key == _NONE_KEY,
        -(g.values.cells[0].value) if g.values.cells and g.values.cells[0].value is not None
        else float("inf"),
        g.label, g.label2 or ""))


# ── evaluate ───────────────────────────────────────────────────────────────────────────────────

def evaluate(rows: list[dict], plan: dict, catalog: Any) -> Result:
    """Filter, split and measure `rows` (one scan of `plan`'s source) for a validated `plan`."""
    src = catalog.sources[plan["source"]]
    source_key = src.key
    notes: list[str] = []
    view = (plan.get("view") or {}).get("type")

    kept = _apply_filters(rows, plan, src, notes)
    counted = [r for r in kept if not r.get("flagged")]
    if source_key == "open_positions":
        note = _estimated_note(plan, counted)
        if note:
            notes.append(note)

    groups: list[Group] = []
    split = plan.get("split")
    by = src.fields[split["by"]] if split else None
    then = src.fields[split["then"]] if split and split.get("then") else None

    if view in ("list", "scatter") and not split:
        label_key, label2_key = src.list_labels
        source_rows = kept if view == "list" else counted
        for i, r in enumerate(source_rows):
            flagged = bool(r.get("flagged"))
            cells = _empty_cells(plan) if flagged else _cells(plan, catalog, source_key, [r])
            groups.append(Group(
                key=str(i), label=_clip(str(r.get(label_key) or ""), LABEL_MAX),
                values=GroupValues(cells, 0 if flagged else 1),
                label2=_clip(str(r.get(label2_key) or ""), LABEL_MAX) or None,
                flagged=flagged, day=r.get("day"), result=r.get("result")))
        groups = _sort(groups, plan, None)
    elif by is not None:
        buckets: dict[tuple[str, str], list[dict]] = {}
        labels: dict[tuple[str, str], tuple[str, str | None]] = {}
        out_by = out_then = 0
        for r in counted:
            k1s = _keys_of(by, r)
            if k1s == [None] and by.none_label is None:
                out_by += 1
                continue
            k2s: list[str | None] = [""]
            if then is not None:
                k2s = _keys_of(then, r)
                if k2s == [None] and then.none_label is None:
                    out_then += 1
                    continue
            for k1 in k1s:
                k1 = _NONE_KEY if k1 is None else k1
                for k2 in k2s:
                    k2 = _NONE_KEY if k2 is None else k2
                    key = (k1, k2)
                    buckets.setdefault(key, []).append(r)
                    if key not in labels:
                        labels[key] = (_label(by, k1, r),
                                       _label(then, k2, r) if then is not None else None)
        if out_by:
            notes.append(_missing_note(by, src.unit, out_by))
        if out_then:
            notes.append(_missing_note(then, src.unit, out_then))
        for (k1, k2), grp in buckets.items():
            l1, l2 = labels[(k1, k2)]
            groups.append(Group(key=k1, label=l1, values=GroupValues(
                _cells(plan, catalog, source_key, grp), len(grp)),
                key2=(k2 if then is not None else None), label2=l2))
        groups = _sort(groups, plan, by)

    total_cells = _cells(plan, catalog, source_key, counted)
    total = GroupValues(total_cells, len(counted))
    measure_rows = len(wmeasures.measure_input(source_key, counted))
    coverage = []
    for m, cell in zip((catalog.measures[x["key"]] for x in plan["measures"]), total_cells):
        if m.needs:
            have = int(cell.have or 0)
            hint = (HINT_ADD_STOPS if "r" in m.needs and measure_rows
                    and have / measure_rows < 0.5 else None)
            coverage.append(Coverage(have, measure_rows, hint))
        else:
            coverage.append(Coverage(measure_rows, measure_rows, None))
    return Result(groups, total, coverage, notes, len(counted))
