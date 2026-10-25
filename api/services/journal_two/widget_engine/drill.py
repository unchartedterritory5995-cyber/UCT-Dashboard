"""Drill-down (wave 8, Task 8.11, ruling R-23): the rows behind one cell of a built widget.

`drill(user_id, plan, settings, cell, *, snapshot_count=None) -> dict` reads the SAME scan the widget
read (`sources.scan`, the member's own rows, the viewer's range / account / overridable filter merged in
exactly as `run.run_plan` merges them), applies the plan's filters in Python (`aggregate.apply_filters`)
and keeps the rows the cell stands for:

* `{}`                 -- every row the widget read;
* `{label}`            -- the split's group whose label is `label` (`aggregate` labels a group
                          `_clip(str(key), 60)`, so a long or hostile member text is found by its clipped
                          label); with no split, the list label (the symbol, or the day).
                          Two keys whose first 59 characters agree clip to the same label, so they
                          share one bar AND one drill: the drill lists the rows of both;
* `{label, label2}`    -- a two-way split's cell (the `then` field's label too);
* `{d, x, y}`          -- a scatter point: the trade on day `d` whose two measures are `x` and `y`,
                          among the non-flagged trades only (the rows the plot drew).

Wave 10 (Task 10.6): a split or filter may name a row formula (`formula:<id>`) and a measure may be a
formula. The plan's formulas are written onto the rows first (`aggregate.plan_fields_on`, as
`evaluate` writes them), a split resolves its field through the plan's fields, and a scatter point's
two values are what `aggregate.evaluate` itself drew (`measure_of`, the one lookup), so a drill finds
exactly the rows its cell stands for. Options strategies drill to `_option_row`.

Rules it keeps:

* Ownership: `user_id` is the session member's. The scan is scoped to them in SQL, and every trade or
  position row is then re-checked against `j2_trades` / `j2_positions` `WHERE user_id = ?`: a row whose
  id is not one of the member's is dropped, so no other member's id can ever be answered.
* Flagged trades are LISTED and labelled `flagged: true` (the scan reads them the way a List view does),
  even though every aggregate leaves them out. They are not counted in `count` (what the snapshot's own
  count measured).
* At most `MAX_ROWS` rows, newest first, plus `more` (how many were left out).
* `live` is True when `snapshot_count` was given and the live count differs from it; `note` then says
  "Live data; the snapshot was taken on <Mon D>" (the day from `snapshot_at`, else the sentence without
  a day). A foreign or deleted `accountId` reads all accounts and `note` leads with
  `run.S_ACCOUNT_GONE`, as `/run` says it; both sentences are joined with a space.
* It runs under `run.admit(user_id, "drill")` and `run.deadline(conn)`: a full gate is `EngineBusy`, a
  slow read `EngineTooLong`. It is never cached and never counted against the daily run cap (the router
  counts it against the per-minute `notebook-widgets` scope).
"""
from __future__ import annotations

import copy
import math
import sqlite3
from datetime import date, datetime, timezone
from typing import Any

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import aggregate as waggregate
from api.services.journal_two.widget_engine import compile as wcompile
from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run as wrun
from api.services.journal_two.widget_engine import sources as wsources
from api.services.journal_two.widget_engine.plan import PlanError

MAX_ROWS = 40
LABEL_MAX = waggregate.LABEL_MAX

S_BAD_CELL = "That part of the widget can't be opened."
NOTE_LIVE = "Live data; the snapshot was taken on {day}"
NOTE_LIVE_NO_DAY = "Live data; the snapshot was taken earlier"

_CELL_KEYS = frozenset({"label", "label2", "d", "x", "y"})


# -- the cell ---------------------------------------------------------------------------------------

def clean_cell(cell: Any) -> dict:
    """`{}`, `{label}`, `{label, label2}` or `{d, x, y}`; anything else is refused with a sentence."""
    if cell is None:
        return {}
    if not isinstance(cell, dict) or not set(cell) <= _CELL_KEYS:
        raise PlanError(S_BAD_CELL)
    if not cell:
        return {}
    if "d" in cell or "x" in cell or "y" in cell:
        if set(cell) != {"d", "x", "y"} or not isinstance(cell["d"], str) or len(cell["d"]) > 40:
            raise PlanError(S_BAD_CELL)
        for k in ("x", "y"):
            v = cell[k]
            if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))
                                  or not math.isfinite(v)):
                raise PlanError(S_BAD_CELL)
        return {"d": cell["d"], "x": cell["x"], "y": cell["y"]}
    if "label" not in cell or not isinstance(cell["label"], str) or len(cell["label"]) > wplan.MAX_TEXT:
        raise PlanError(S_BAD_CELL)
    out = {"label": cell["label"]}
    if "label2" in cell:
        if not isinstance(cell["label2"], str) or len(cell["label2"]) > wplan.MAX_TEXT:
            raise PlanError(S_BAD_CELL)
        out["label2"] = cell["label2"]
    return out


def _labels(fld: Any, row: dict) -> set[str]:
    """Every label `aggregate` would file this row under for `fld` (a tag field: one per tag). A row
    with no value has the field's none label, or none at all (it is outside the split)."""
    out = set()
    for k in waggregate._keys_of(fld, row):
        if k is None:
            if fld.none_label is None:
                continue
            k = waggregate._NONE_KEY
        out.add(waggregate._label(fld, k, row))
    return out


def _close(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-6)


def _point_hits(rows: list[dict], plan: dict, cell: dict) -> list[dict]:
    """The rows of a scatter point: the non-flagged rows on day `d` whose two plotted values are
    `x` and `y`. The values are the ones `aggregate.evaluate` draws for each point (a catalog
    measure or a formula, through `measure_of`), read off ONE evaluation of the day's rows."""
    on_day = [r for r in rows if not r.get("flagged")                 # the plot drew no flagged row
              and str(r.get("day") or "")[:10] == cell["d"][:10]]
    if not on_day:
        return []
    res = waggregate.evaluate(on_day, {**plan, "sort": None, "split": None}, wsources.CATALOG)
    out = []
    for g in res.groups:                     # one group per counted row, `key` its position
        cells = g.values.cells
        x = nw._num(cells[0].value) if len(cells) > 0 else None
        y = nw._num(cells[1].value) if len(cells) > 1 else None
        if _close(x, cell["x"]) and _close(y, cell["y"]):
            out.append(on_day[int(g.key)])
    return out


def _matches(row: dict, plan: dict, src: Any, cell: dict, fields: dict) -> bool:
    if not cell:
        return True
    split = plan.get("split")
    if not split:
        label_key, _ = src.list_labels
        return nw._clip(str(row.get(label_key) or ""), LABEL_MAX) == cell["label"]
    if cell["label"] not in _labels(fields[split["by"]], row):
        return False
    if split.get("then") and "label2" in cell:
        return cell["label2"] in _labels(fields[split["then"]], row)
    return True


# -- ownership --------------------------------------------------------------------------------------

_OWN_TABLE = {"closed_trades": "j2_trades", "open_positions": "j2_positions",
              "options_strategies": "j2_option_strategies"}


def _owned_ids(conn: sqlite3.Connection, user_id: str, table: str, ids: list[str]) -> set[str]:
    out: set[str] = set()
    ids = list(dict.fromkeys(i for i in ids if isinstance(i, str)))
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        out.update(r[0] for r in conn.execute(
            f"SELECT id FROM {table} WHERE user_id = ? AND id IN ({','.join('?' * len(part))})",
            [user_id, *part]).fetchall())
    return out


# -- rows -------------------------------------------------------------------------------------------

def _trade_row(r: dict) -> dict:
    return {"id": r.get("_tid"), "symbol": r.get("symbol"), "side": r.get("side"),
            "day": r.get("day"), "net": nw._num(r.get("net")), "r": nw._num(r.get("r")),
            "setup": r.get("setup"), "flagged": bool(r.get("flagged"))}


def _day_row(r: dict) -> dict:
    return {"day": r.get("day"), "net": nw._num(r.get("day_net")),
            "trades": int(nw._num(r.get("trade_count")) or 0)}


def _position_row(r: dict) -> dict:
    return {"id": r.get("_tid"), "symbol": r.get("symbol"), "side": r.get("side"),
            "setup": r.get("setup"), "daysOpen": nw._num(r.get("days_open")),
            "unrealised": nw._num(r.get("unrealised")), "riskDollars": nw._num(r.get("risk_dollars")),
            "hasStop": bool(r.get("had_stop")), "flagged": False}


def _routine_row(r: dict) -> dict:
    """Wave 9: one scheduled day of a routine (`label2` is the item, when split by item)."""
    return {"day": r.get("day"), "label": r.get("routine_name"), "label2": r.get("item_text"),
            "state": r.get("state"), "stateLabel": wsources.state_label(r.get("state"))}


def _tracker_row(r: dict) -> dict:
    """Wave 9: one logged value (`text` as the member reads it: "7h 30m", "Yes")."""
    return {"day": r.get("day"), "label": r.get("tracker_name"), "value": nw._num(r.get("value")),
            "text": r.get("text")}


def _option_row(r: dict) -> dict:
    """Wave 10: one options strategy (the client opens it in the options drawer, R-30). `label` is
    the underlying, `label2` the strategy; an open strategy has no net, R or result yet."""
    return {"day": r.get("day"), "label": r.get("underlying"), "label2": r.get("label2"),
            "net": nw._num(r.get("net")), "r": nw._num(r.get("r")), "result": r.get("result"),
            "strategyId": r.get("_tid")}


_SHAPE = {"closed_trades": _trade_row, "trading_days": _day_row, "open_positions": _position_row,
          "routine_history": _routine_row, "tracker_history": _tracker_row,
          "options_strategies": _option_row}


def _mon_d(iso: Any) -> str | None:
    try:
        d = date.fromisoformat(str(iso)[:10])
    except (TypeError, ValueError):
        return None
    return f"{d.strftime('%b')} {d.day}"


# -- the drill --------------------------------------------------------------------------------------

def drill(user_id: str, plan: dict, settings: Any, cell: Any, *, snapshot_count: int | None = None,
          snapshot_at: str | None = None, now: datetime | None = None) -> dict:
    """The rows behind `cell` of `plan` for the session member `user_id` (see the module docstring).

    Raises `PlanError` (a member sentence), `run.EngineBusy` or `run.EngineTooLong`."""
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("a drill needs the session member's id")
    now = now or datetime.now(timezone.utc)
    today = nw._today_et(now)
    base = wplan.validate_plan(copy.deepcopy(plan), wsources.CATALOG)
    viewer = wrun.tool_viewer(base, wrun.clean_settings(settings))
    want = clean_cell(cell)
    src = wsources.SOURCES[base["source"]]

    with wrun._connection() as conn:
        with wrun.admit(user_id, "drill"):
            with wrun.deadline(conn):
                requested = viewer["accountId"] if "accountId" in viewer else (
                    base["accounts"]["id"] if isinstance(base["accounts"], dict) else None)
                acc = wsources.owned_account_id(conn, user_id, requested)
                merged = wplan.validate_plan(wrun._merge(base, viewer, acc), wsources.CATALOG)
                rng = wplan.resolve_range(merged["range"], today)
                scan_plan = copy.deepcopy(merged)
                if src.key == "closed_trades":
                    # read the way a List view reads: flagged trades are in the rows, labelled
                    scan_plan["view"] = {**(scan_plan.get("view") or {}), "type": "list"}
                sc = wsources.scan(conn, scan_plan, {"accountId": acc}, rng, user_id, today=today)
                # the plan's formula values on every row (once, under the run's deadline), and
                # the fields a filter or split may name
                fields = waggregate.plan_fields_on(sc.rows, merged, src,
                                                   check=wcompile.check_deadline)
                rows = waggregate.apply_filters(sc.rows, merged, src, fields=fields)
                table = _OWN_TABLE.get(src.key)
                if table is not None:
                    mine = _owned_ids(conn, user_id, table, [r.get("_tid") for r in rows])
                    rows = [r for r in rows if r.get("_tid") in mine]
                if "d" in want:
                    hits = _point_hits(rows, merged, want)
                else:
                    hits = [r for r in rows if _matches(r, merged, src, want, fields)]

    count = sum(1 for r in hits if not r.get("flagged"))
    shape = _SHAPE[src.key]
    out_rows = [shape(r) for r in hits[:MAX_ROWS]]
    live = isinstance(snapshot_count, int) and not isinstance(snapshot_count, bool) \
        and snapshot_count != count
    notes: list[str] = []
    if requested and not acc:
        notes.append(wrun.S_ACCOUNT_GONE)                  # as /run says it (fix round 1, M4)
    if live:
        day = _mon_d(snapshot_at) if snapshot_at else None
        notes.append(NOTE_LIVE.format(day=day) if day else NOTE_LIVE_NO_DAY)
    note = " ".join(notes) or None
    return {"rows": out_rows, "more": max(0, len(hits) - MAX_ROWS), "count": count,
            "live": live, "note": note}
