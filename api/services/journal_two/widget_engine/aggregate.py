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

Wave 10 (Task 10.5): member formulas ("your own fields", `widget_formula`). Each formula of the
plan is compiled ONCE per evaluation (`compile_formulas`); a row formula's value is written to
`row["formula:<id>"]` on every scanned row BEFORE filtering (rows are rewritten each evaluation,
so a value can never outlive the plan that wrote it), so a formula filter or split reads a plain
row key through a synthetic `Field` (`formula_field`). A formula measure is a `FormulaMeasure`
(`measure_of`, the ONE lookup the cells, the coverage loop and the payload use; its kind is
`plan.formula_measure_kind`'s answer). Every Python loop over the scanned rows calls the run's
`check()` every `widget_formula.CHECK_EVERY` rows, counted across groups (W9-R17).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable

from api.services.journal_two import measures as smeasures
from api.services.journal_two.notebook_widgets import _clip, _num
from api.services.journal_two.widget_engine import measures as wmeasures
from api.services.journal_two.widget_engine import plan as wplan

LABEL_MAX = 60
#: The Coverage hint for an R measure known on fewer than half the trades (spec 5.2).
HINT_ADD_STOPS = "Add stops to see R for more trades"
S_HOLD_MINUTES_NO_TIMES = ("Hold time in minutes needs entry and exit times; your trades have "
                           "dates only")
S_HOLD_MINUTES_SOME = "{n} {trades} {have} dates only and {are} not in the hold-time filter."
S_SPLIT_MISSING = "{n} {rows} {have} {missing} and {are} not in this split."
#: The same fact for a filter: rows with no value for the field cannot pass it (fix round 1).
S_FILTER_MISSING = "{n} {rows} {have} {missing} and {are} left out."
#: What a row with no value for a formula filter or split lacks (the synthetic field's `missing`).
FORMULA_MISSING = "no value for this field"
#: The views a max drawdown number carries its days on (spec 8 #9, W10-R11).
DRAWDOWN_VIEWS = frozenset({"number", "compare"})

_NONE_KEY = "\x00none"
_SINGULAR = {"trades": "trade", "positions": "position", "days": "day", "entries": "entry",
             "strategies": "strategy", "notes": "note"}


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
    order: Any = None          # the field's `order_from` value (a tracker bucket's position)


@dataclass(frozen=True)
class Result:
    groups: list[Group]
    total: GroupValues
    coverage: list[Coverage]
    footnotes: list[str] = field(default_factory=list)
    count: int = 0             # rows the measures read (flagged trades are never among them)
    #: wave 10: the plan's formulas as compiled for this evaluation ({id: widget_formula.Compiled})
    formulas: dict = field(default_factory=dict)
    #: wave 10: per formula {id, first, skipped, notice} (the builder preview's `probe`)
    probe: list = field(default_factory=list)
    #: wave 10: the max drawdown's days (`measures.DrawdownSpan`) on a number or compare view
    drawdown: Any = None


@dataclass(frozen=True)
class FormulaMeasure:
    """A formula measure, shaped like `measures.Measure` where the cells, the coverage loop,
    `measures.small_sample` and the payload read one."""
    key: str                   # "formula:<id>"
    label: str
    unit: str
    kind: str
    min_n: int
    needs: tuple[str, ...]
    fmt: str


class _Ticker:
    """`check()` every `CHECK_EVERY` rows walked, counted across every loop and group of one
    evaluation (W9-R17): a run of 5,000 one-row groups is checked as often as one big group."""

    def __init__(self, check: Callable[[], None] | None):
        self.check = check
        self.walked = 0
        self.every = _wf().CHECK_EVERY if check is not None else 0

    def tick(self, n: int = 1) -> None:
        if self.check is None or n <= 0:
            return
        before = self.walked // self.every
        self.walked += n
        if self.walked // self.every != before:
            self.check()


def _wf():
    """The formula dialect, imported at call time (it imports `plan`, which this module needs)."""
    from api.services.journal_two import widget_formula
    return widget_formula



# ── formulas ───────────────────────────────────────────────────────────────────────────────────

def _formula_entries(plan: dict) -> list[dict]:
    formulas = plan.get("formulas")
    return [f for f in formulas if isinstance(f, dict)] if isinstance(formulas, list) else []


def _formula_infos(src: Any) -> dict:
    return wplan.formula_field_infos(getattr(src, "fields", {}) or {})


def compile_formulas(plan: dict, src: Any) -> dict:
    """{id: widget_formula.Compiled} for every formula of a validated `plan`, compiled once against
    `src`'s fields (the conversion the validator ran, `plan.formula_field_infos`)."""
    entries = _formula_entries(plan)
    if not entries:
        return {}
    wf = _wf()
    infos = _formula_infos(src)
    return {f["id"]: wf.compile_formula(f["expr"], infos) for f in entries}


def _yes_no(v: Any) -> str:
    return "Yes" if v is True else "No"


def formula_field(f: dict, compiled: Any) -> Any:
    """The synthetic `sources.Field` a filter or split on `formula:<id>` reads: no SQL (a formula
    never reaches SQL), its result type's ops, split-capable for text and yes / no, the Bucket's
    labels as its order, "Yes" / "No" for a yes / no value, and the missing-value words."""
    from api.services.journal_two.widget_engine.sources import Field
    key = wplan.FORMULA_PREFIX + f["id"]
    ftype = compiled.type
    return Field(key=key, label=f.get("name") or key, type=ftype,
                 ops=wplan._FORMULA_OPS[ftype], split=ftype in ("text", "bool"), sql=None,
                 py=lambda r, _k=key: r.get(_k), bucket=compiled.bucket_labels,
                 fmt=_yes_no if ftype == "bool" else None, missing=FORMULA_MISSING)


def _plan_fields(plan: dict, src: Any, compiled: dict) -> dict:
    """The source's fields plus a synthetic field per row formula of the plan."""
    fields = dict(src.fields)
    for f in _formula_entries(plan):
        c = compiled.get(f["id"])
        if c is not None and c.kind == "row":
            fields[wplan.FORMULA_PREFIX + f["id"]] = formula_field(f, c)
    return fields


def _write_row_formulas(rows: list[dict], plan: dict, compiled: dict, ticker: "_Ticker") -> None:
    """Every row formula's value on every scanned row, under `formula:<id>`. A row with a
    referenced field empty gets no value (`widget_formula.empty_field_of`, the 10.2 ruling)."""
    row_formulas = [(wplan.FORMULA_PREFIX + fid, c) for fid, c in compiled.items()
                    if c.kind == "row"]
    if not row_formulas:
        return
    wf = _wf()
    empty_field_of, eval_row = wf.empty_field_of, wf.eval_row
    for r in rows:
        ticker.tick()
        for key, c in row_formulas:
            r[key] = None if empty_field_of(c, r) is not None else eval_row(c, r)


def measure_of(plan: dict, catalog: Any, m: dict, compiled: dict | None = None) -> Any:
    """The measure `m` of `plan` names: the catalog's `Measure`, or a `FormulaMeasure`. The ONE
    lookup the cells, the coverage loop and the payload use. `compiled` is the evaluation's
    compiled formulas (`Result.formulas`); without it the formula is compiled here. The kind is
    `plan.formula_measure_kind`'s (the validator's own rule, never restated)."""
    if "formula" not in m:
        if "prop" in m:                       # Task 10.7: a note property measure, bound to it
            return wmeasures.bind_prop(catalog.measures[m["key"]], m["prop"])
        return catalog.measures[m["key"]]
    fid = m["formula"]
    src = catalog.sources[plan["source"]]
    c = (compiled or {}).get(fid) or compile_formulas(plan, src)[fid]
    f = wplan.formula_of(plan, fid) or {}
    kind = wplan.formula_measure_kind(c, m.get("agg"))
    from api.services.journal_two.widget_engine import payload as wpayload
    # a count of rows is a count and a share a share, whatever the field's own format
    fmt = {"count": "count", "rate": "pct"}.get(
        kind, wpayload.FORMULA_FMT.get(f.get("format"), "number"))
    return FormulaMeasure(key=wplan.FORMULA_PREFIX + fid, label=f.get("name") or fid,
                          unit=src.unit, kind=kind, min_n=smeasures.DEFAULT_MIN_N,
                          needs=tuple(c.fields), fmt=fmt)


def _row_formula_value(agg: str, vals: list) -> Any:
    """A row formula's values (the rows where it has one) added up by the measure's `agg`."""
    if not vals:
        return None
    if agg == "count":
        return float(sum(1 for v in vals if v is True))
    if agg == "share":
        return sum(1 for v in vals if v is True) / len(vals)
    nums = [float(v) for v in vals]
    if agg == "sum":
        return sum(nums)
    if agg == "avg":
        return sum(nums) / len(nums)
    if agg == "min":
        return min(nums)
    return max(nums)


def _formula_cell(fm: FormulaMeasure, c: Any, agg: str | None, source_key: str,
                  rows: list[dict], ticker: "_Ticker") -> wmeasures.Cell:
    """One formula measure over one group. `have` counts the rows where the formula has a value
    (a row formula) or reads no empty field (an adding-up formula); the small-sample rule reads it."""
    inp = wmeasures.measure_input(source_key, rows)
    n = len(inp)
    ticker.tick(n)
    if c.kind == "row":
        vals = [v for v in (r.get(fm.key) for r in inp) if v is not None]
        have = len(vals)
        value = _row_formula_value(agg or "sum", vals)
    else:
        wf = _wf()
        ok = [r for r in inp if wf.empty_field_of(c, r) is None]
        have = len(ok)
        value = wf.eval_group(c, ok, check=ticker.check)
    value = _num(value)
    return wmeasures.Cell(value, n, have,
                          smeasures.small_sample(fm, smeasures.MeasureValue(value, n, have)))


def _labels_by_key(src: Any, infos: dict) -> dict[str, str]:
    """A referenced field's name as the member reads it inside the brackets. An hour is read
    through its day field (`Hour([day])`), so it is named by the day field (10.2 ruling)."""
    wf = _wf()
    out = {k: wf.display_name(fi, infos) for k, fi in infos.items()}
    for fi in infos.values():
        if fi.hour_key:
            out[fi.hour_key] = wf.display_name(fi, infos)
    return out


def _skip_sentences(src: Any, c: Any, key: str, rows: list[dict], ticker: "_Ticker",
                    labels: dict[str, str], times_keys: frozenset) -> tuple[list[str], int]:
    """The footnotes for the rows one formula skipped, and how many it skipped. A row missing a
    hold time says so as the hold-minutes field does; a row with another field empty names that
    field; a row with every field and still no value (a divide by zero) says the formula has none."""
    wf = _wf()
    empty: Counter = Counter()
    times = noval = 0
    for r in rows:
        ticker.tick()
        k = wf.empty_field_of(c, r)
        if k is not None:
            if k in times_keys:
                times += 1
            else:
                empty[k] += 1
        elif c.kind == "row" and r.get(key) is None:
            noval += 1
    one, many = _noun(src.unit, 1), _noun(src.unit, 2)
    out: list[str] = []
    if times:
        if times == len(rows):
            out.append(S_HOLD_MINUTES_NO_TIMES)
        else:
            out.append(S_HOLD_MINUTES_SOME.format(
                n=times, trades=_noun(src.unit, times), have=_plural(times, "has", "have"),
                are=_plural(times, "is", "are")))
    for k, n in empty.items():
        note = wf.skip_notice(n, labels.get(k, k), one, many)
        if note:
            out.append(note)
    note = wf.skip_notice(noval, None, one, many)
    if note:
        out.append(note)
    return out, times + sum(empty.values()) + noval


def _formula_notes(plan: dict, src: Any, compiled: dict, rows: list[dict],
                   ticker: "_Ticker", probe_on: bool = False) -> tuple[list[str], list[dict]]:
    """The skip footnotes of the formulas the plan's measures read (over the counted rows), and,
    only when `probe_on` (the builder preview lane), per formula the `probe`: its value on the
    newest counted row (an adding-up formula: its value over every counted row), how many rows it
    skipped and why. Off the preview lane no probe work is done (fix round 1, m-3)."""
    if not compiled:
        return [], []
    wf = _wf()
    infos = _formula_infos(src)
    labels = _labels_by_key(src, infos)
    times_keys = frozenset(k for k, fi in infos.items() if fi.needs_times)
    measured = {m["formula"] for m in plan["measures"] if "formula" in m}
    inp = wmeasures.measure_input(src.key, rows)
    notes: list[str] = []
    probe: list[dict] = []
    for f in _formula_entries(plan):
        fid = f["id"]
        if fid not in measured and not probe_on:
            continue
        c = compiled[fid]
        key = wplan.FORMULA_PREFIX + fid
        sentences, skipped = _skip_sentences(src, c, key, inp, ticker, labels, times_keys)
        if fid in measured:
            notes.extend(s for s in sentences if s not in notes)
        if not probe_on:
            continue
        if c.kind == "row":
            first = inp[0].get(key) if inp else None
        else:
            first = wf.eval_group(c, [r for r in inp if wf.empty_field_of(c, r) is None],
                                  check=ticker.check)
        if isinstance(first, (int, float)) and not isinstance(first, bool):
            first = _num(first)
        probe.append({"id": fid, "first": first, "skipped": skipped,
                      "notice": " ".join(sentences) or None})
    return notes, probe


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


def _quiet(fld: Any, row: dict) -> bool:
    """A row whose missing value for `fld` is not counted in a no-value footnote (`_quiet` holds
    field keys): a routine or tracker that did not resolve says so once, as a notice (W9-R18), and
    a session after today is not "no routine yet" (M-1)."""
    return fld.key in (row.get("_quiet") or ())


def bucket_order(fld: Any) -> tuple:
    """The field's bucket, read at call time (a callable bucket follows its source, M-3)."""
    b = getattr(fld, "bucket", None)
    return tuple(b() if callable(b) else b or ())


def _apply_filters(rows: list[dict], plan: dict, src: Any, notes: list[str],
                   fields: dict | None = None) -> list[dict]:
    fields = fields if fields is not None else src.fields
    kept = rows
    for f in plan.get("filters") or []:
        fld = fields[f["field"]]
        if getattr(fld, "scan_applied", False):
            # Task 10.7: applied by the scan's own authority (a note property, through
            # `note_properties.property_filter_sql`); never a second, Python predicate
            continue
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
                       and not matches(fld, f["op"], values, None) and not _quiet(fld, r))
            if gone:
                notes.append(S_FILTER_MISSING.format(
                    n=gone, rows=_noun(src.unit, gone), have=_plural(gone, "has", "have"),
                    missing=fld.missing, are=_plural(gone, "is", "are")))
        kept = [r for r in kept if matches(fld, f["op"], values, r.get(fld.key))]
    return kept


def apply_filters(rows: list[dict], plan: dict, src: Any, *,
                  check: Callable[[], None] | None = None,
                  fields: dict | None = None) -> list[dict]:
    """Every filter of `plan` over `rows`, in Python (no footnotes). A formula filter's values are
    written onto the rows first, as `evaluate` writes them, asking the run's `check` every
    `CHECK_EVERY` rows (W9-R17). `fields`: the caller already wrote them (`plan_fields_on`)."""
    if fields is None:
        if not any(str(f.get("field", "")).startswith(wplan.FORMULA_PREFIX)
                   for f in plan.get("filters") or []):
            return _apply_filters(rows, plan, src, [])
        fields = plan_fields_on(rows, plan, src, check)
    return _apply_filters(rows, plan, src, [], fields)


def plan_fields_on(rows: list[dict], plan: dict, src: Any,
                   check: Callable[[], None] | None = None) -> dict:
    """Task 10.6 (drill): every row formula's value written onto `rows` (as `evaluate` writes
    them), and the fields a filter or split of `plan` may name: the source's plus one per row
    formula. `check` is asked every `CHECK_EVERY` rows."""
    compiled = compile_formulas(plan, src)
    if not compiled:
        return dict(src.fields)
    _write_row_formulas(rows, plan, compiled, _Ticker(check))
    return _plan_fields(plan, src, compiled)


def _estimated_note(plan: dict, rows: list[dict], compiled: dict | None = None) -> str | None:
    """Open positions: how many of the rows that passed every filter have an estimated
    entry date, when the widget reads days open (a formula reading it too)."""
    from api.services.journal_two.widget_engine import sources as wsources
    if not (wsources._uses(plan, "days_open")
            or any("days_open" in c.fields for c in (compiled or {}).values())):
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
    order = bucket_order(fld)
    if order:
        try:
            return (0, list(map(str, order)).index(key), key)
        except ValueError:
            return (1, 0, key)
    if fld.type == "number":
        n = _num(key)
        return (0, n if n is not None else 0.0, key)
    return (0, 0, key)


def _ordered_naturally(fld: Any) -> bool:
    return bool(bucket_order(fld)) or fld.type in ("day", "number") or fld.key == "month"


def _cells(plan: dict, catalog: Any, source_key: str, rows: list[dict],
           compiled: dict | None = None, ticker: "_Ticker | None" = None) -> list[wmeasures.Cell]:
    out = []
    for m in plan["measures"]:
        if "formula" in m:
            fm = measure_of(plan, catalog, m, compiled)
            out.append(_formula_cell(fm, compiled[m["formula"]], m.get("agg"), source_key, rows,
                                     ticker or _Ticker(None)))
        else:
            out.append(wmeasures.evaluate(measure_of(plan, catalog, m), source_key, rows))
    return out


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
    if getattr(fld, "order_from", None):
        return sorted(groups, key=lambda g: (g.order is None, g.order if g.order is not None
                                             else 0, g.label, g.key2 or ""))
    if _ordered_naturally(fld):
        return sorted(groups, key=lambda g: (_natural_key(fld, g.key), g.key2 or ""))
    # A category with no natural order: largest first measure first, then by label.
    return sorted(groups, key=lambda g: (
        g.key == _NONE_KEY,
        -(g.values.cells[0].value) if g.values.cells and g.values.cells[0].value is not None
        else float("inf"),
        g.label, g.label2 or ""))


# ── evaluate ───────────────────────────────────────────────────────────────────────────────────

def evaluate(rows: list[dict], plan: dict, catalog: Any, *,
             check: Callable[[], None] | None = None, probe: bool = False) -> Result:
    """Filter, split and measure `rows` (one scan of `plan`'s source) for a validated `plan`.

    `check` is the run's budget (`run.Budget.check`): called every `CHECK_EVERY` rows walked,
    across every loop and group; it raises to stop a run past its deadline. `probe` (the builder
    preview lane only) fills `Result.probe`."""
    src = catalog.sources[plan["source"]]
    source_key = src.key
    notes: list[str] = []
    view = (plan.get("view") or {}).get("type")
    ticker = _Ticker(check)

    compiled = compile_formulas(plan, src)
    _write_row_formulas(rows, plan, compiled, ticker)
    fields = _plan_fields(plan, src, compiled) if compiled else src.fields

    kept = _apply_filters(rows, plan, src, notes, fields)
    counted = [r for r in kept if not r.get("flagged")]
    if source_key == "open_positions":
        note = _estimated_note(plan, counted, compiled)
        if note:
            notes.append(note)

    groups: list[Group] = []
    split = plan.get("split")
    by = fields[split["by"]] if split else None
    then = fields[split["then"]] if split and split.get("then") else None

    def cells(grp: list[dict]) -> list[wmeasures.Cell]:
        return _cells(plan, catalog, source_key, grp, compiled, ticker)

    if view in ("list", "scatter") and not split:
        label_key, label2_key = src.list_labels
        source_rows = kept if view == "list" else counted
        for i, r in enumerate(source_rows):
            ticker.tick()
            flagged = bool(r.get("flagged"))
            group_cells = _empty_cells(plan) if flagged else cells([r])
            groups.append(Group(
                key=str(i), label=_clip(str(r.get(label_key) or ""), LABEL_MAX),
                values=GroupValues(group_cells, 0 if flagged else 1),
                label2=_clip(str(r.get(label2_key) or ""), LABEL_MAX) or None,
                flagged=flagged, day=r.get("day"), result=r.get("result")))
        groups = _sort(groups, plan, None)
    elif by is not None:
        buckets: dict[tuple[str, str], list[dict]] = {}
        labels: dict[tuple[str, str], tuple[str, str | None]] = {}
        out_by = out_then = 0
        for r in counted:
            ticker.tick()
            k1s = _keys_of(by, r)
            if k1s == [None] and by.none_label is None:
                out_by += 0 if _quiet(by, r) else 1
                continue
            k2s: list[str | None] = [""]
            if then is not None:
                k2s = _keys_of(then, r)
                if k2s == [None] and then.none_label is None:
                    out_then += 0 if _quiet(then, r) else 1
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
        order_key = getattr(by, "order_from", None)
        for (k1, k2), grp in buckets.items():
            l1, l2 = labels[(k1, k2)]
            groups.append(Group(key=k1, label=l1, values=GroupValues(cells(grp), len(grp)),
                                key2=(k2 if then is not None else None), label2=l2,
                                order=grp[0].get(order_key) if order_key else None))
        groups = _sort(groups, plan, by)

    total_cells = cells(counted)
    total = GroupValues(total_cells, len(counted))
    coverage = []
    for m, cell in zip((measure_of(plan, catalog, x, compiled) for x in plan["measures"]),
                       total_cells):
        # the rows this measure read (an options "Strategies" count reads open ones too)
        measure_rows = len(wmeasures.rows_for(m, source_key, counted))
        if m.needs:
            have = int(cell.have or 0)
            hint = (HINT_ADD_STOPS if "r" in m.needs and measure_rows
                    and have / measure_rows < 0.5 else None)
            coverage.append(Coverage(have, measure_rows, hint))
        else:
            coverage.append(Coverage(measure_rows, measure_rows, None))
    formula_notes, probe_rows = _formula_notes(plan, src, compiled, counted, ticker, probe)
    notes.extend(n for n in formula_notes if n not in notes)
    drawdown = None
    if view in DRAWDOWN_VIEWS and any(m.get("key") == "max_drawdown" for m in plan["measures"]):
        # the rows `max_drawdown` itself read, so the days describe the number shown
        drawdown = smeasures.drawdown_span(wmeasures.measure_input(source_key, counted))
    return Result(groups, total, coverage, notes, len(counted), formulas=compiled, probe=probe_rows,
                  drawdown=drawdown)
