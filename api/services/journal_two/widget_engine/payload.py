"""The built-widget payload (wave 8, Task 8.6): one evaluated `aggregate.Result` -> the snapshot a note stores.

`build_payload(...)` is pure (no I/O, no clock: `now` is passed in). Its keys are FIXED, whatever the view:
every key below is present on every payload, an unused list is `[]`, an unused value `None`. Result rows use
fixed keys (`v1..v3`, `n1..n3`, `s1..s3`), never measure names, because the public reducer passes one level
of dict items only (spec 5.6).

    asOf source sourceDetail sourceKey view title summary defId defRev latestRev def|defRef scopeLabel
    rangeLabel range accountId filter count capped sample notice truncated measures value compare
    compareLabel rows series points cells coverage footnotes empty

Rules it keeps:

* Trade ids never appear. Nothing here reads a scan row's `_tid`, and a group's `key` (a List row's scan
  position) is not copied out; the label, the day and the numbers are.
* Every number passes `notebook_widgets._num`: a NaN or an infinity becomes `None` ("no data").
* The frozen `def` is the plan while its compact JSON is at most `DEF_MAX_BYTES`; a larger plan leaves
  `def` out and stores `defRef: {id, rev}` (spec 5.6).
* The payload is held to the note's 16 KB cap by `notebook_widgets.cap_payload`, told which list to trim and
  from which end by the view (`TRIM_BY_VIEW`): rows lose their LAST items (sorted best first, after top N),
  a series, a scatter and a heat map lose their OLDEST (each is ordered oldest first).
* Over the scan cap the range label names the earliest day covered and `notice` says so; path-dependent
  measures (drawdown, streaks) carry a footnote that they are within the newest rows (spec 5.7).

Every read of `aggregate.Result` is in `_from_result`, so a change to that shape is one place.

Wave 10 (Task 10.5) adds keys ONLY when the plan uses them, so a wave 8 or 9 plan builds exactly the
payload it did (the public allowlist is unchanged, ruling W10-R7, so none of them reaches a shared page):
`display.cumulative` turns a line's `v1..v3` into running totals (`d1..d3` the day's own amounts, `dd1`
the drop from the running peak), computed BEFORE the cap trims; a max drawdown number carries
`drawdown` (wave 10 on); `display.targetGoal` carries `target` and `targetLabel`; `display.stopAfter`
carries `stop`; `display.quadrants` is echoed; a preview of a plan with formulas carries `probe`.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Iterable

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import aggregate as waggregate
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import measures as wmeasures
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import sources as wsources

#: The frozen plan a note may carry, in bytes of compact JSON (spec 5.6 / global constraints).
DEF_MAX_BYTES = 4_096
#: Group labels are clipped here (aggregate already does; this keeps the payload honest on its own).
LABEL_MAX = 60
#: Values per row: `v1..v3`, `n1..n3`, `s1..s3`.
SLOTS = 3

#: View -> (the list `cap_payload` trims, the end it trims from).
TRIM_BY_VIEW: dict[str, tuple[str, str]] = {
    "number": ("rows", "end"), "compare": ("rows", "end"), "progress": ("rows", "end"),
    "table": ("rows", "end"), "bar": ("rows", "end"), "list": ("rows", "end"),
    "line": ("series", "start"), "scatter": ("points", "start"), "heat": ("cells", "start"),
}

#: The spec 5.9 empty sentence for each source this wave builds.
S_EMPTY: dict[str, str] = {
    "closed_trades": "No closed trades in this range. Widen the range, or log a trade.",
    "open_positions": "No open positions.",
    "trading_days": "No sessions in this range.",
    # wave 9 (Task 9.8)
    "routine_history": "Start ticking your routine; history shows here from day one.",
    "tracker_history": "Log your first value; the chart starts with it.",
    # wave 10 (Task 10.4: the shared rows; the sources are Tasks 10.6 and 10.7)
    "options_strategies": "No options strategies in this range.",
    "notes": "No notes match.",
}
S_ALL_ACCOUNTS = "All my accounts"
S_ONE_ACCOUNT = "One account"
#: Over the scan cap (spec 5.7 / 5.10). Closed trades read the exact sentences; the other sources the
#: same sentence in their own unit.
S_CAPPED_NOTICE = "Based on your newest {n:,} {unit}. Narrow the range to include all {unit}."
S_CAPPED_NOTICE_NOW = "Based on your newest {n:,} {unit}."
S_CAPPED_RANGE = "From {day}, newest {n:,} {unit}"
S_CAPPED_RANGE_NO_DAY = "Newest {n:,} {unit}"
S_WITHIN_NEWEST = "{label}: within your newest {n:,} {unit}."
S_YOU_HAVE = "{label} (you have {n:,})"

#: Measures whose value depends on the ORDER of the rows read, so a capped scan changes their meaning.
PATH_DEPENDENT = frozenset({"max_drawdown", "max_win_streak", "max_loss_streak", "current_streak"})

#: How the client formats each builder measure's value. Every builder measure has a row (railed).
MEASURE_FMT: dict[str, str] = {
    # money
    "net_pnl": "money", "gross_pnl": "money", "fees": "money", "avg_win": "money", "avg_loss": "money",
    "expectancy": "money", "best_trade": "money", "worst_trade": "money", "max_drawdown": "money",
    "avg_day_pnl": "money", "unrealised_pnl": "money", "open_risk": "money",
    # a share, stored as a fraction (0.6 = 60%)
    "win_rate": "pct", "profitable_days_pct": "pct", "green_day_pct": "pct",
    # a ratio
    "payoff": "ratio",
    # profit factor (ruling R-29): its own format, so the client shows "5+" at its cap (measures.PF_CAP)
    "profit_factor": "pf",
    # R
    "expectancy_r": "r", "total_r": "r", "avg_true_r": "r",
    # counts
    "trades": "count", "wins": "count", "losses": "count", "days_traded": "count",
    "profitable_days": "count", "max_win_streak": "count", "max_loss_streak": "count",
    "open_positions": "count",
    # wave 10: options strategies, notes
    "strategies": "count", "notes": "count", "property_sum": "number",
    # a signed count (wins + / losses -)
    "current_streak": "signed_count",
    # days
    "avg_hold_days": "days", "avg_days_open": "days",
    # wave 9: routines (a rate is a fraction) and trackers (the tracker's own number)
    "routine_consistency": "pct", "routine_completion_pct": "pct",
    "routine_days_done": "count", "routine_best_run": "count",
    "tracker_avg": "number", "tracker_min": "number", "tracker_max": "number",
    "tracker_latest": "number", "tracker_entries": "count",
}

#: Wave 10: a formula's `format` -> the `MEASURE_FMT` vocabulary the client formats with.
FORMULA_FMT: dict[str, str] = {"number": "number", "money": "money", "percent": "pct", "r": "r"}

#: Wave 10 sentences (Task 10.5, verbatim). Days read as "Mar 4".
S_DD_SPAN = "From {peak} to {trough}; recovered {recovered}."
S_DD_OPEN = "From {peak} to {trough}; not recovered yet."
S_DD_NONE = "No drawdown in this range."
#: A fall that began at the range's start has no peak day: the sentence names the start
#: (ruling W10-R50: "From the start of this range to {trough}; ...").
S_DD_START = "the start of this range"
S_GOAL_LABEL = {"daily": "Daily goal", "weekly": "Weekly goal", "monthly": "Monthly goal",
                "yearly": "Yearly goal"}
S_GOAL_NONE = "Set a {period} goal in your account settings to see progress."
S_GOAL_SOME = "{n} {accounts} {have} no {period} goal and {are} not in the target."
S_STOP_UNDER = "{k} of your {n} losses in a row"
S_STOP_HIT = "{k} of your {n} losses in a row. Your rule says stop here."
S_STOP_NONE = "No losses in a row."

#: A scan row's result -> the scatter point's `r`.
_RESULT_CODE = {"Win": "win", "Loss": "loss", "BE": "be"}

#: The rows each source's scan cap holds (the cap the `capped` flag refers to).
_CAP_ROWS = {"closed_trades": wcompile.SCAN_ROWS, "open_positions": wcompile.SCAN_ROWS,
             "trading_days": wsources.MAX_SESSIONS, "routine_history": wcompile.SCAN_ROWS,
             "tracker_history": wcompile.SCAN_ROWS, "options_strategies": wcompile.SCAN_ROWS,
             "notes": wcompile.SCAN_ROWS}
_CAP_UNIT = {"closed_trades": "trades", "open_positions": "positions", "trading_days": "sessions",
             "routine_history": "days", "tracker_history": "entries",
             "options_strategies": "strategies", "notes": "notes"}


# -- small helpers ---------------------------------------------------------------------------------

def _int(v: Any) -> int | None:
    f = nw._num(v)
    return None if f is None else int(f)


def _label(text: Any) -> str:
    return nw._clip(str(text if text is not None else ""), LABEL_MAX)


def _upper_first(s: str) -> str:
    return s[:1].upper() + s[1:]


def _mon_d(iso: str) -> str | None:
    try:
        d = date.fromisoformat(str(iso)[:10])
    except ValueError:
        return None
    return f"{d.strftime('%b')} {d.day}"


def _values(gv: Any) -> dict:
    """One group's (or the total's) measured values on the fixed keys."""
    cells = list(gv.cells)
    out: dict[str, Any] = {}
    for i in range(SLOTS):
        c = cells[i] if i < len(cells) else None
        out[f"v{i + 1}"] = None if c is None else nw._num(c.value)
        out[f"n{i + 1}"] = None if c is None else _int(c.n)
        out[f"s{i + 1}"] = None if c is None else (c.sample or "")
    out["n"] = _int(gv.n)
    return out


def _row(g: Any) -> dict:
    return {"label": _label(g.label), "label2": None if g.label2 is None else _label(g.label2),
            **_values(g.values), "flagged": bool(g.flagged)}


# -- the one reader of aggregate.Result ------------------------------------------------------------

def _from_result(result: Any, view: str) -> dict:
    """Everything the payload takes from an evaluated `aggregate.Result`, for one view."""
    groups = list(result.groups)
    rows: list[dict] = []
    series: list[dict] = []
    points: list[dict] = []
    cells: list[dict] = []
    if view == "line":
        # one row per time bucket, oldest first (a day or month key sorts as ISO text)
        series = [_row(g) for g in sorted(groups, key=lambda g: g.key)]
    elif view == "scatter":
        # scan order is newest first: reverse, then a stable sort by day keeps same-day rows in order
        ordered = sorted(reversed(groups), key=lambda g: g.day or "")
        for g in ordered:
            cs = list(g.values.cells)
            points.append({
                "x": nw._num(cs[0].value) if len(cs) > 0 else None,
                "y": nw._num(cs[1].value) if len(cs) > 1 else None,
                "d": g.day,
                "r": _RESULT_CODE.get(g.result),
            })
    elif view == "heat":
        # one cell per day; every measure the plan has (the map shades the first, "Show as table" lists them all)
        for g in sorted(groups, key=lambda g: g.key):
            cs = list(g.values.cells)[:SLOTS] or [None]
            cell: dict[str, Any] = {"label": _label(g.label)}
            for i, c in enumerate(cs):
                cell[f"v{i + 1}"] = None if c is None else nw._num(c.value)
                cell[f"n{i + 1}"] = None if c is None else _int(c.n)
                cell[f"s{i + 1}"] = None if c is None else (c.sample or "")
            cells.append(cell)
    elif view in ("table", "bar", "list"):
        rows = [_row(g) for g in groups]          # already sorted and cut to top N by aggregate
    coverage = [{"have": _int(c.have) or 0, "total": _int(c.total) or 0, "hint": c.hint}
                for c in result.coverage]
    return {
        "value": _values(result.total),
        "rows": rows, "series": series, "points": points, "cells": cells,
        "coverage": coverage,
        "footnotes": [str(f) for f in (result.footnotes or [])],
        "count": _int(result.count) or 0,
    }


# -- wave 10 display options -----------------------------------------------------------------------

def _cumulative(series: list[dict]) -> None:
    """Running totals in day order (`series` is oldest first): each `vN` becomes the total so far,
    the day's own amount moves to `dN`, and `dd1` is `v1` less its running peak (floor 0). Runs on
    the full series, before `cap_payload` trims the oldest points, so a trimmed curve keeps true
    totals. A day with no value keeps the total it had (and has no day amount)."""
    totals: list[float | None] = [None] * SLOTS
    peak = 0.0
    for row in series:
        for i in range(SLOTS):
            k = f"v{i + 1}"
            day = row.get(k)
            row[f"d{i + 1}"] = day
            if day is not None:
                totals[i] = (totals[i] or 0.0) + day
            row[k] = None if totals[i] is None else nw._num(round(totals[i], 6))
        t = row["v1"]
        if t is None:
            row["dd1"] = None
        else:
            peak = max(peak, t)
            row["dd1"] = nw._num(round(t - peak, 6))


def _drawdown(span: Any) -> dict:
    """The max drawdown's days and the one line a number view shows under the value."""
    peak, trough, recovered = span.peak, span.trough, span.recovered
    if trough is None:
        line = S_DD_NONE
    else:
        p, t = _mon_d(peak) if peak else S_DD_START, _mon_d(trough)
        line = (S_DD_SPAN.format(peak=p, trough=t, recovered=_mon_d(recovered)) if recovered
                else S_DD_OPEN.format(peak=p, trough=t))
    return {"peak": peak, "trough": trough, "recovered": recovered, "line": line}


def _stop(after: int, streak: Any) -> dict:
    """The stop-after line from the current streak (signed: -k for k losses in a row). A win
    streak, a breakeven or no streak is "No losses in a row.", never "0 of your"."""
    v = nw._num(streak)
    k = int(-v) if v is not None and v < 0 else None
    if k is None:
        return {"after": after, "losses": None, "line": S_STOP_NONE}
    tmpl = S_STOP_HIT if k >= after else S_STOP_UNDER
    return {"after": after, "losses": k, "line": tmpl.format(k=k, n=after)}


def _goal(period: str, goal: Any) -> tuple[dict, list[str], list[str]]:
    """(keys, notices, footnotes) for `display.targetGoal`. `goal` is `run._goal_target`'s
    (target or None, accounts without that goal), or None when no goal was read at all (a
    sample-book run): then no target and no goal sentence, since the member may have one."""
    keys = {"target": None, "targetLabel": S_GOAL_LABEL[period]}
    if goal is None:
        # the sample book: no goal was read, so none is claimed missing (fix round 1, m-2)
        return keys, [], []
    target, missing = goal
    target = nw._num(target)
    keys["target"] = target
    if target is None:
        return keys, [S_GOAL_NONE.format(period=period)], []
    foot = []
    if missing:
        foot.append(S_GOAL_SOME.format(n=missing, accounts="account" if missing == 1 else "accounts",
                                       have="has" if missing == 1 else "have", period=period,
                                       are="is" if missing == 1 else "are"))
    return keys, [], foot


# -- labels ----------------------------------------------------------------------------------------

def _title(plan: dict, names: Any = None) -> str:
    display = plan.get("display") or {}
    t = (display.get("title") or "").strip()
    if t and not display.get("titleAuto", True):
        return t
    return wplan.default_name(plan, wsources.CATALOG, names)


def _scope_label(scan: Any, account_name: str | None) -> str:
    if scan.account_id is None:
        return S_ALL_ACCOUNTS
    if account_name:
        return account_name
    for r in scan.rows:
        if r.get("account") == scan.account_id and r.get("account_name"):
            return str(r["account_name"])
    return S_ONE_ACCOUNT


#: Sources whose capped scan states the rows it actually kept (fix round 1, m-1): an options
#: read is cut to the exact ET day after the SQL read, so it can hold fewer than the cap.
_CAP_COUNTS_KEPT = frozenset({"options_strategies", "notes"})
#: Sources whose path-dependent measures carry the "within your newest" footnote (m-3).
_PATH_FOOTNOTE_SOURCES = frozenset({"closed_trades", "options_strategies"})


def _cap_n(scan: Any, source_key: str) -> int:
    if source_key in _CAP_COUNTS_KEPT:
        return int(scan.count)
    return _CAP_ROWS[source_key]


def _range_label(plan: dict, rng: Any, scan: Any, source_key: str, count: int) -> str:
    """`plan.range_label_for` is the one authority for the range a widget shows ("Right now" for open
    positions, R-17); this only adds the over-the-cap and fewer-than-N wording on top of it."""
    base = wplan.range_label_for(plan, rng)
    if source_key in wplan.RIGHT_NOW_SOURCES:
        return base
    if scan.capped:
        n, unit = _cap_n(scan, source_key), _CAP_UNIT[source_key]
        day = _mon_d(scan.earliest_day) if scan.earliest_day else None
        if day:
            return S_CAPPED_RANGE.format(day=day, n=n, unit=unit)
        return S_CAPPED_RANGE_NO_DAY.format(n=n, unit=unit)
    label = _upper_first(base)
    if rng.last_n is not None and count < rng.last_n:
        return S_YOU_HAVE.format(label=label, n=count)
    return label


def _capped_notice(scan: Any, source_key: str) -> str | None:
    if not scan.capped:
        return None
    n, unit = _cap_n(scan, source_key), _CAP_UNIT[source_key]
    tmpl = S_CAPPED_NOTICE_NOW if source_key == "open_positions" else S_CAPPED_NOTICE
    return tmpl.format(n=n, unit=unit)


def _source(scan: Any) -> str:
    """broker | manual | mixed, with `notebook_widgets._origin`'s meaning, over the rows that carry an
    `origin` key (every closed-trade and open-position row; a trading-days row with trades on it). A
    row's own "mixed" counts as the origins it lists (`origins`), or as both broker and manual when it
    lists none -- so a CSV + hand-logged day with no broker trade reads "manual", not "mixed"."""
    origins: list[Any] = []
    for r in scan.rows:
        if "origin" not in r:
            continue
        o = r.get("origin")
        if o == "mixed":
            origins.extend(r.get("origins") or ("broker", "manual"))
        else:
            origins.append(o)
    return nw._origin(origins)


# -- private labels (the W10.7 walk fix) ------------------------------------------------------------

_FIELD_REF = re.compile(r"\[([^\[\]]+)\]")


def _field_kind(plan: dict, src: Any, name: Any) -> str | None:
    """The `labelKind` of a split on `name`: the field's `public_kind`; for one of the member's formulas, the
    first private field it reads (a stored expression names fields by KEY, ruling W10-R2), so a formula that
    hands back a folder or an account is numbered like the field itself. None: the labels are not private."""
    if not isinstance(name, str):
        return None
    if name.startswith(wplan.FORMULA_PREFIX):
        f = wplan.formula_of(plan, name[len(wplan.FORMULA_PREFIX):])
        for ref in _FIELD_REF.findall(str(f.get("expr") if isinstance(f, dict) else "")):
            ref = ref.strip()
            if ref.startswith(wplan.FORMULA_PREFIX):
                continue                            # never a formula through another one (and never a loop)
            kind = _field_kind(plan, src, ref)
            if kind is not None:
                return kind
        return None
    field = src.fields.get(name)
    return getattr(field, "public_kind", None) if field is not None else None


def label_kinds(plan: Any) -> tuple[str | None, str | None]:
    """(labelKind, label2Kind) for a plan: which of its group or list labels are the member's OWN NAMES, by the
    word key `public_note_payload.RELABEL_WORDS` numbers them with. THE ONE RULE: the payload marks its labels
    with it, and the public reducer re-derives it from the frozen plan a note carries (so a snapshot made before a
    field was marked is numbered too). A split reads its fields' `public_kind`; a List with no split reads the
    source's `list_public_kind` (a note's title, a routine's or a tracker's name). Never raises."""
    if not isinstance(plan, dict):
        return None, None
    src = wsources.SOURCES.get(plan.get("source"))
    if src is None:
        return None, None
    split = plan.get("split") if isinstance(plan.get("split"), dict) else None
    view = plan.get("view") if isinstance(plan.get("view"), dict) else {}
    if not split:
        return (src.list_public_kind if view.get("type") == "list" else None), None
    return _field_kind(plan, src, split.get("by")), _field_kind(plan, src, split.get("then"))


def hidden_publicly(plan: Any, source_key: Any = None) -> bool:
    """Ruling W10-R73 (spec section 2: routine and tracker day state never reaches a public page): a built widget
    that reads routines or trackers (`plan.uses_tools`: a Routine or Tracker history source, or a trading-days
    routine or tracker field) is served with NO data publicly, only `public_note_payload.HIDDEN_WIDGET_LINE`. A
    snapshot with no frozen plan (a `defRef`) is judged by its `sourceKey`. Never raises."""
    if isinstance(plan, dict):
        return wplan.uses_tools(plan)
    return wplan.uses_tools({"source": source_key}) if isinstance(source_key, str) else False


#: Ruling W10-R74: a property measure's label on a public page, numbered by first appearance ("Sum of Property 1").
PUBLIC_PROPERTY = "Property {n}"


def public_property_labels(plan: Any, measures: Any, title: Any) -> tuple[Any, Any]:
    """Ruling W10-R74: on a public page a property measure never names the member's property. Its label becomes the
    catalog's own words with the property numbered ("Sum of a property" -> "Sum of Property 1"; one property keeps
    one number), and the same words in the title are replaced. The measure is found by its slot in the frozen plan;
    with no plan (a `defRef`), by its label starting with the catalog's words. Formula names are left as they are.
    Never raises; anything it cannot read is returned unchanged."""
    if not isinstance(measures, list):
        return measures, title
    words = {k: m.label for k, m in wsources.CATALOG.measures.items() if k in wplan.PROP_MEASURES}
    plan_ms = plan.get("measures") if isinstance(plan, dict) and isinstance(plan.get("measures"), list) else None
    numbering: dict[Any, int] = {}
    out = list(measures)
    for i, item in enumerate(out):
        if not isinstance(item, dict) or not isinstance(item.get("label"), str):
            continue
        label = item["label"]
        if plan_ms is not None:
            m = plan_ms[i] if i < len(plan_ms) else None
            key = m.get("key") if isinstance(m, dict) else None
            if key not in words:
                continue
            ident = m.get("prop")
        else:
            key = next((k for k, w in words.items() if label == w or label.startswith(w + ": ")), None)
            if key is None:
                continue
            ident = label
        n = numbering.setdefault(ident, len(numbering) + 1)
        word = words[key]
        public = (word.replace("a property", PUBLIC_PROPERTY.format(n=n)) if "a property" in word
                  else f"{word} ({PUBLIC_PROPERTY.format(n=n)})")
        out[i] = {**item, "label": public}
        if isinstance(title, str) and label:
            title = title.replace(label, public)
    return out, title


# -- the payload -----------------------------------------------------------------------------------

def build_payload(*, result: Any, plan: dict, settings: dict | None, def_id: str | None,
                  def_rev: int | None, latest_rev: int | None, rng: Any, scan: Any, sample: bool,
                  now: datetime, compare_result: Any = None, compare_label: str | None = None,
                  account_name: str | None = None, notices: Iterable[str] = (),
                  w10: bool = False, goal: Any = None, probe: bool = False) -> dict:
    """The snapshot a note stores for one run of a validated `plan`.

    `result` is `aggregate.evaluate(scan.rows, plan, CATALOG)`; `rng` the resolved range the scan read;
    `settings` the merged viewer settings (`range`, `accountId`, `filter`), echoed so the client's refresh
    drops nothing. `compare_result` / `compare_label` are the comparison period's result and its label, when
    the view compares. `account_name` names the one account narrowed to, when the caller knows it.
    `notices` are the run's own sentences (a dropped account, a frozen copy), ahead of the cap notice.

    Wave 10: `w10` is the wave flag as the run read it (a max drawdown number's days appear only with
    it on); `goal` is `run._goal_target`'s answer for `display.targetGoal`; `probe` is True on the
    builder preview lane only (the formulas' `probe`, never stored in a note)."""
    settings = settings or {}
    source_key = plan["source"]
    src = wsources.CATALOG.sources[source_key]
    view = (plan.get("view") or {}).get("type") or "number"
    parts = _from_result(result, view)
    count = parts["count"]

    measures = []
    # W10.3 walk fix: a property sum names its property (the scan read the member's name for it)
    prop_names = getattr(scan, "prop_names", None) or {}
    footnotes = list(parts["footnotes"]) + [str(f) for f in (scan.footnotes or [])]
    compiled = getattr(result, "formulas", None) or {}
    for m in plan["measures"]:
        meta = waggregate.measure_of(plan, wsources.CATALOG, m, compiled)
        if "formula" in m:
            measures.append({"key": meta.key, "label": meta.label,
                             "unit": wmeasures.unit_for(meta, source_key),
                             "kind": meta.kind, "fmt": meta.fmt})
            continue
        prop_name = wplan.property_name(m, prop_names)
        measures.append({"label": f"{meta.label}: {prop_name}" if prop_name else meta.label,
                         "unit": wmeasures.unit_for(meta, source_key),
                         "kind": meta.kind,
                         "fmt": MEASURE_FMT.get(m["key"], "number")})
        if scan.capped and source_key in _PATH_FOOTNOTE_SOURCES and m["key"] in PATH_DEPENDENT:
            footnotes.append(S_WITHIN_NEWEST.format(label=meta.label, n=_cap_n(scan, source_key),
                                                    unit=_CAP_UNIT[source_key]))

    display = plan.get("display") or {}
    extra: dict[str, Any] = {}
    w10_notices: list[str] = []
    if display.get("cumulative") and view == "line":
        _cumulative(parts["series"])
    if w10 and view in waggregate.DRAWDOWN_VIEWS and getattr(result, "drawdown", None) is not None \
            and count:
        extra["drawdown"] = _drawdown(result.drawdown)
    if display.get("targetGoal"):
        keys, goal_notices, goal_foot = _goal(
            wplan.GOAL_TOKENS[(plan.get("range") or {}).get("token")], goal)
        extra.update(keys)
        w10_notices.extend(goal_notices)
        footnotes.extend(goal_foot)
    if display.get("stopAfter"):
        mi = next(i for i, m in enumerate(plan["measures"]) if m.get("key") == "current_streak")
        cells = list(result.total.cells)
        extra["stop"] = (_stop(int(display["stopAfter"]), cells[mi].value)
                         if count and mi < len(cells) else None)
    if display.get("quadrants"):
        extra["quadrants"] = display["quadrants"]
    if probe and compiled:
        extra["probe"] = [dict(p) for p in (getattr(result, "probe", None) or [])]

    acc = settings.get("accountId")
    payload: dict[str, Any] = {
        "asOf": nw._iso_utc(now),
        # W10.3 walk fix: only a source whose rows were logged (broker or manual) names where trades came from
        "source": _source(scan) if source_key in wsources.ORIGIN_SOURCES else None,
        "sourceKey": source_key,
        "view": view,
        "title": _title(plan, prop_names),
        "summary": wplan.summary(plan, wsources.CATALOG, count, src.unit, prop_names),
        "defId": def_id,
        "defRev": def_rev,
        "latestRev": latest_rev,
    }
    if nw._payload_size(plan) <= DEF_MAX_BYTES:
        payload["def"] = plan
    else:
        payload["defRef"] = {"id": def_id, "rev": def_rev}
    payload.update({
        "scopeLabel": _scope_label(scan, account_name),
        "rangeLabel": _range_label(plan, rng, scan, source_key, count),
        "range": settings.get("range"),
        # a foreign or dropped account id is never echoed: only the account the scan actually narrowed to
        "accountId": acc if acc is not None and acc == scan.account_id else None,
        "filter": settings.get("filter"),
        "count": count,
        "capped": bool(scan.capped),
        "sample": bool(sample),
        "notice": " ".join([str(n) for n in notices if n]
                           + [str(n) for n in (getattr(scan, "notices", None) or []) if n]
                           + w10_notices
                           + [n for n in (_capped_notice(scan, source_key),) if n]) or None,
        "truncated": 0,
        "measures": measures,
        "value": parts["value"],
        "compare": None if compare_result is None else _from_result(compare_result, "number")["value"],
        "compareLabel": compare_label if compare_result is not None else None,
        "rows": parts["rows"],
        "series": parts["series"],
        "points": parts["points"],
        "cells": parts["cells"],
        "coverage": parts["coverage"],
        "footnotes": footnotes,
        # no rows: the source's sentence; rows the result could not show (a split none of them has a
        # value for): the result's own sentence (Task 10.13 fix round 1, I-1)
        "empty": S_EMPTY.get(source_key) if count == 0 else getattr(result, "empty", None),
    })
    payload.update(extra)
    # Ruling R-25 / W10-R7, and the W10.7 walk fix: a label that is the member's OWN NAME is marked, so a public
    # page numbers it ("Account 1", "Note 1", "Folder 1") instead of publishing it. `label_kinds` is the one rule.
    kind1, kind2 = label_kinds(plan)
    if kind1 is not None:
        payload["labelKind"] = kind1
    if kind2 is not None:
        payload["label2Kind"] = kind2
    payload["sourceDetail"] = nw.source_detail(nw.BUILT_KIND, payload)
    list_key, trim_from = TRIM_BY_VIEW.get(view, ("rows", "end"))
    return nw.cap_payload(payload, nw.BUILT_KIND, list_key=list_key, trim_from=trim_from)
