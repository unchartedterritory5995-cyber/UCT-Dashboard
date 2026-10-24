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
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import compile as wcompile
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
    # a ratio (profit factor shows "5+" at its cap)
    "payoff": "ratio", "profit_factor": "ratio",
    # R
    "expectancy_r": "r", "total_r": "r", "avg_true_r": "r",
    # counts
    "trades": "count", "wins": "count", "losses": "count", "days_traded": "count",
    "profitable_days": "count", "max_win_streak": "count", "max_loss_streak": "count",
    "open_positions": "count",
    # a signed count (wins + / losses -)
    "current_streak": "signed_count",
    # days
    "avg_hold_days": "days", "avg_days_open": "days",
}

#: A scan row's result -> the scatter point's `r`.
_RESULT_CODE = {"Win": "win", "Loss": "loss", "BE": "be"}

#: The rows each source's scan cap holds (the cap the `capped` flag refers to).
_CAP_ROWS = {"closed_trades": wcompile.SCAN_ROWS, "open_positions": wcompile.SCAN_ROWS,
             "trading_days": wsources.MAX_SESSIONS}
_CAP_UNIT = {"closed_trades": "trades", "open_positions": "positions", "trading_days": "sessions"}


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
        for g in sorted(groups, key=lambda g: g.key):
            c = g.values.cells[0] if g.values.cells else None
            cells.append({"label": _label(g.label),
                          "v1": None if c is None else nw._num(c.value),
                          "n1": None if c is None else _int(c.n),
                          "s1": None if c is None else (c.sample or "")})
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


# -- labels ----------------------------------------------------------------------------------------

def _title(plan: dict) -> str:
    display = plan.get("display") or {}
    t = (display.get("title") or "").strip()
    if t and not display.get("titleAuto", True):
        return t
    return wplan.default_name(plan, wsources.CATALOG)


def _scope_label(scan: Any, account_name: str | None) -> str:
    if scan.account_id is None:
        return S_ALL_ACCOUNTS
    if account_name:
        return account_name
    for r in scan.rows:
        if r.get("account") == scan.account_id and r.get("account_name"):
            return str(r["account_name"])
    return S_ONE_ACCOUNT


def _range_label(plan: dict, rng: Any, scan: Any, source_key: str, count: int) -> str:
    """`plan.range_label_for` is the one authority for the range a widget shows ("Right now" for open
    positions, R-17); this only adds the over-the-cap and fewer-than-N wording on top of it."""
    base = wplan.range_label_for(plan, rng)
    if source_key in wplan.RIGHT_NOW_SOURCES:
        return base
    if scan.capped:
        n, unit = _CAP_ROWS[source_key], _CAP_UNIT[source_key]
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
    n, unit = _CAP_ROWS[source_key], _CAP_UNIT[source_key]
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


# -- the payload -----------------------------------------------------------------------------------

def build_payload(*, result: Any, plan: dict, settings: dict | None, def_id: str | None,
                  def_rev: int | None, latest_rev: int | None, rng: Any, scan: Any, sample: bool,
                  now: datetime, compare_result: Any = None, compare_label: str | None = None,
                  account_name: str | None = None, notices: Iterable[str] = ()) -> dict:
    """The snapshot a note stores for one run of a validated `plan`.

    `result` is `aggregate.evaluate(scan.rows, plan, CATALOG)`; `rng` the resolved range the scan read;
    `settings` the merged viewer settings (`range`, `accountId`, `filter`), echoed so the client's refresh
    drops nothing. `compare_result` / `compare_label` are the comparison period's result and its label, when
    the view compares. `account_name` names the one account narrowed to, when the caller knows it.
    `notices` are the run's own sentences (a dropped account, a frozen copy), ahead of the cap notice."""
    settings = settings or {}
    source_key = plan["source"]
    src = wsources.CATALOG.sources[source_key]
    view = (plan.get("view") or {}).get("type") or "number"
    parts = _from_result(result, view)
    count = parts["count"]

    measures = []
    footnotes = list(parts["footnotes"]) + [str(f) for f in (scan.footnotes or [])]
    for m in plan["measures"]:
        meta = wsources.CATALOG.measures[m["key"]]
        measures.append({"label": meta.label, "unit": meta.unit, "kind": meta.kind,
                         "fmt": MEASURE_FMT.get(m["key"], "number")})
        if scan.capped and source_key == "closed_trades" and m["key"] in PATH_DEPENDENT:
            footnotes.append(S_WITHIN_NEWEST.format(label=meta.label, n=_CAP_ROWS[source_key],
                                                    unit=_CAP_UNIT[source_key]))

    acc = settings.get("accountId")
    payload: dict[str, Any] = {
        "asOf": nw._iso_utc(now),
        "source": _source(scan),
        "sourceKey": source_key,
        "view": view,
        "title": _title(plan),
        "summary": wplan.summary(plan, wsources.CATALOG, count, src.unit),
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
        "empty": S_EMPTY.get(source_key) if count == 0 else None,
    })
    payload["sourceDetail"] = nw.source_detail(nw.BUILT_KIND, payload)
    list_key, trim_from = TRIM_BY_VIEW.get(view, ("rows", "end"))
    return nw.cap_payload(payload, nw.BUILT_KIND, list_key=list_key, trim_from=trim_from)
