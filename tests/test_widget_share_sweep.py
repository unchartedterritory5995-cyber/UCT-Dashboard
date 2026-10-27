"""Task 11.4 fix round 1: the GLOBAL fail-closed rail.

Hand-picked canary fixtures plant the canary only where their author thought to look, and that is
how an unknown block id (C1) and a display option copied by default (I1) got past round 0. This
sweep does not pick: it walks a MAXIMAL widget, routine, tracker and template input recursively and,
one at a time, plants the canary string (two shapes) and the canary number in EVERY JSON leaf, and
adds an unknown canary key to EVERY object. With empty edits and keep, each reducer must either
refuse (a `ShareError`) or return a payload in which neither travels. Any other exception is a
failure too: a reducer is total over hostile input.
"""
from __future__ import annotations

import copy
import json
from typing import Any, Callable, Iterator

import pytest

from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as S

CAT = S.CATALOG
CANARY_STRINGS = ("zzq-canary-7f3a", "zzq_canary_7f3a")
CANARY_NUMBER = 987654.321
FORBIDDEN = ("zzq", "canary-7f3a", "canary_7f3a", "987654", "987,654", "9.87654321")

UUID_A = "0a1b2c3d-1111-4222-8333-000000000001"
UUID_B = "0a1b2c3d-1111-4222-8333-000000000002"
UUID_D = "0a1b2c3d-1111-4222-8333-000000000004"
PROP = "c" * 32


@pytest.fixture(autouse=True)
def _kinds_offered(monkeypatch):
    monkeypatch.setitem(S._GATED_FIELDS, ("notes", "kind"), lambda: True)


@pytest.fixture(autouse=True)
def _template_tools(monkeypatch):
    """Task 11.6's template tables (not landed in this checkout): a stand-in module."""
    import sys
    import types
    mod = types.ModuleType(share.TEMPLATE_TOOLS_MODULE)
    mod.ROUTINE_TEMPLATES = {"premarket": {}}
    mod.TRACKER_TEMPLATES = {"sleep": {}}
    monkeypatch.setitem(sys.modules, share.TEMPLATE_TOOLS_MODULE, mod)


def maximal_plans() -> list[dict]:
    """Valid plans that between them use every part of the plan grammar the reducer reads."""
    return [
        {"v": 3, "source": "closed_trades", "accounts": {"id": "acc-1"},
         "range": {"from": "2026-01-01", "to": "2026-03-31"},
         "filters": [
             {"field": "setup", "op": "in", "values": ["Flag", "Base"], "overridable": True},
             {"field": "symbol", "op": "in", "values": ["AAPL"]},
             {"field": "mistake", "op": "has_any", "values": ["fomo"]},
             {"field": "account", "op": "in", "values": ["acc-2"]},
             {"field": "net", "op": "between", "values": [100, 500]},
             {"field": "side", "op": "in", "values": ["Long"]},
             {"field": "day", "op": "between", "values": ["2026-01-02", "2026-02-03"]},
             {"field": "formula:f1", "op": "gte", "values": [1.5]}],
         "measures": [{"formula": "f1", "agg": "avg"}, {"key": "net_pnl"}],
         "formulas": [{"id": "f1", "name": "Edge", "format": "number",
                       "expr": 'If([side] = "Long", [r] * 2 - -(3), Round([r], 2))'}],
         "split": {"by": "setup"}, "view": {"type": "table"},
         "sort": {"measure": 1, "dir": "asc", "top": 12},
         "compare": {"mode": "range", "from": "2025-01-01", "to": "2025-03-31"},
         "display": {"title": "Mine", "subtitle": "Sub", "titleAuto": False, "accent": "blue",
                     "showN": False, "target": 250}},
        {"v": 3, "source": "notes", "range": {"token": "ytd"},
         "filters": [{"field": "folder", "op": "in", "values": ["fold-1"]},
                     {"field": "tag", "op": "has_any", "values": ["ideas"]},
                     {"field": "kind", "op": "in", "values": ["kind-1"]},
                     {"field": "property", "prop": PROP, "op": "eq", "values": [7]},
                     {"field": "ticker", "op": "contains", "values": ["NV"]},
                     {"field": "month", "op": "in", "values": ["2026-01"]}],
         "measures": [{"key": "property_sum", "prop": PROP}], "split": {"by": "folder"}},
        {"v": 2, "source": "trading_days", "accounts": {"id": "acc-1"},
         "filters": [{"field": "routine_done", "op": "in", "values": ["done"], "ref": UUID_A},
                     {"field": "tracker_value", "op": "gte", "values": [3], "ref": UUID_B},
                     {"field": "mood", "op": "lte", "values": [4]}],
         "measures": [{"key": "avg_day_pnl"}], "split": {"by": "routine_done", "ref": UUID_A},
         "view": {"type": "bar"}, "compare": {"mode": "previous"}},
        {"v": 2, "source": "routine_history",
         "filters": [{"field": "routine", "op": "in", "values": [UUID_A]},
                     {"field": "consistency", "op": "between", "values": [10, 90]}],
         "measures": [{"key": "routine_completion_pct"}]},
        {"v": 2, "source": "tracker_history",
         "filters": [{"field": "tracker", "op": "in", "values": [UUID_B]}],
         "measures": [{"key": "tracker_avg"}]},
        {"v": 3, "source": "closed_trades", "range": {"token": "this_month"},
         "measures": [{"key": "net_pnl"}], "view": {"type": "progress"},
         "display": {"targetGoal": True}},
        {"v": 3, "source": "closed_trades", "measures": [{"key": "net_pnl"}],
         "split": {"by": "day"}, "view": {"type": "line"}, "display": {"cumulative": True}},
        {"v": 3, "source": "closed_trades", "measures": [{"key": "current_streak"}],
         "display": {"stopAfter": 3}},
        {"v": 3, "source": "closed_trades", "view": {"type": "scatter"},
         "measures": [{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "avg"}],
         "formulas": [{"id": "f1", "name": "MAE", "expr": "Abs([mae_r])", "format": "r"},
                      {"id": "f2", "name": "MFE", "expr": "[mfe_r]", "format": "r"}],
         "display": {"quadrants": "excursion"}},
    ]


def maximal_routine() -> dict:
    return {"id": UUID_A, "name": "Morning", "archived": False, "etag": 4, "createdDay": "2026-01-02",
            "items": [{"id": "i1", "text": "Read", "negative": False,
                       "suggest": {"rule": "max_trades", "n": 3}},
                      {"id": "i2", "text": "Plan", "negative": True, "suggest": None}],
            "schedule": {"kind": "weekdays", "days": [0, 2]},
            "settings": {"done_share": 0.75, "strict": True,
                         "reminder": {"on": True, "time_et": "08:05"}},
            "sourceTemplateKey": None}


def maximal_tracker() -> dict:
    return {"id": UUID_B, "name": "Sleep", "kind": "duration", "unit": "h",
            "settings": {"days": "any"}, "value": 7.5, "createdDay": "2026-01-02", "etag": 2}


def maximal_template() -> dict:
    return {
        "style": {"id": "style-1", "name": "Mine", "kindId": "trade_plan", "properties": {PROP: "x"},
                  "blocks": [
                      {"block": "built_a", "enabled": True,
                       "settings": {"ref": "def:" + UUID_D, "defRev": 3, "range": {"token": "ytd"}}},
                      {"block": "built_b", "enabled": True,
                       "settings": {"ref": "shelf:win-rate", "defRev": 1}},
                      {"block": "routine_1", "enabled": True,
                       "settings": {"ref": "routine:" + UUID_A, "bind": "week", "display": "items"}},
                      {"block": "routine_2", "enabled": False,
                       "settings": {"template": "premarket", "bind": "note-day", "display": "pnl"}},
                      {"block": "tracker_1", "enabled": True,
                       "settings": {"ref": "tracker:" + UUID_B, "bind": "note-day", "display": "chart"}},
                      {"block": "tracker_2", "enabled": True, "settings": {"ref": "checkin:mood"}},
                      {"block": "chart", "enabled": True, "settings": {"tf": "W"}}]},
        "definitions": {"def:" + UUID_D: {"id": UUID_D, "name": "Mine", "plan": maximal_plans()[0]}},
        "routines": {"routine:" + UUID_A: maximal_routine()},
        "trackers": {"tracker:" + UUID_B: maximal_tracker()},
    }


# -- the sweep ----------------------------------------------------------------------------------------

def _paths(obj: Any, here: tuple = ()) -> Iterator[tuple[tuple, Any]]:
    """Every node of a JSON structure with its path (objects, lists and leaves)."""
    yield here, obj
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _paths(v, here + (k,))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _paths(v, here + (i,))


def _set(obj: Any, path: tuple, value: Any) -> Any:
    out = copy.deepcopy(obj)
    if not path:
        return value
    node = out
    for k in path[:-1]:
        node = node[k]
    node[path[-1]] = value
    return out


def mutations(base: Any) -> Iterator[tuple[str, Any]]:
    """The canary planted in every leaf (each shape), and as an unknown key of every object."""
    for path, node in list(_paths(base)):
        if isinstance(node, dict):
            grown = copy.deepcopy(node)
            grown[CANARY_STRINGS[1]] = CANARY_STRINGS[0]
            yield f"{path}+key", _set(base, path, grown)
        elif not isinstance(node, list) and path:
            for planted in (*CANARY_STRINGS, CANARY_NUMBER):
                yield f"{path}={planted!r}", _set(base, path, planted)


def _leaks(result: share.Shared) -> str | None:
    whole = {"payload": result.payload, "slots": result.slots, "kept": result.kept,
             "not_shared": result.not_shared}
    for blob in (json.dumps(whole), json.dumps(whole, ensure_ascii=False)):
        low = blob.lower()
        for bad in FORBIDDEN:
            if bad in low:
                return bad
    return None


def sweep(base: Any, reduce: Callable[[Any], share.Shared]) -> tuple[list[str], int, int]:
    """(failures, mutations tried, mutations that shared). A refusal is a pass."""
    failures, tried, shared = [], 0, 0
    for where, planted in mutations(base):
        tried += 1
        try:
            result = reduce(planted)
        except share.ShareError:
            continue
        except Exception as e:                       # noqa: BLE001 -- a crash is a finding too
            failures.append(f"{where}: crashed {type(e).__name__}: {e}")
            continue
        shared += 1
        bad = _leaks(result)
        if bad:
            failures.append(f"{where}: {bad!r} travelled")
    return failures, tried, shared


ROUTINE_EDITS = {"items": ["Check the plan", "Wire"]}
TEMPLATE_EDITS = {"blocks": {"routine_1": ROUTINE_EDITS}}


def reduce_widget(p):
    return share.share_plan(p, catalog=CAT)


def reduce_routine(r):
    return share.share_routine(r, edits=ROUTINE_EDITS)


def reduce_tracker(t):
    return share.share_tracker(t)


def reduce_template(t):
    return share.share_template(t["style"], definitions=t["definitions"], routines=t["routines"],
                                trackers=t["trackers"], edits=TEMPLATE_EDITS, catalog=CAT)


@pytest.mark.parametrize("i", range(len(maximal_plans())))
def test_sweep_widget(i):
    base = maximal_plans()[i]
    reduce_widget(base)                              # the unmutated base shares (a valid fixture)
    failures, tried, _shared = sweep(base, reduce_widget)
    assert failures == []
    assert tried >= 10


def test_sweep_widget_shares_most_member_values():
    """Non-vacuity: a plan whose every leaf is structure refuses every canary (correct), so the
    sweep's power is in the plans with member values; across all of them (49 measured) most share."""
    total = sum(sweep(p, reduce_widget)[2] for p in maximal_plans())
    assert total >= 40


def test_sweep_routine():
    failures, tried, shared = sweep(maximal_routine(), reduce_routine)
    assert failures == [] and tried >= 40 and shared >= 20


def test_sweep_tracker():
    failures, tried, shared = sweep(maximal_tracker(), reduce_tracker)
    assert failures == [] and tried >= 20 and shared >= 10


def test_sweep_template():
    base = maximal_template()
    whole = reduce_template(base).payload
    assert len(whole["blocks"]) == 7 and whole["definitions"] and whole["routines"] and whole["trackers"]
    failures, tried, shared = sweep(base, reduce_template)
    assert failures == []
    assert tried >= 300 and shared >= 100


# -- the sweep has teeth: round 0's two leaks, re-planted, go red ---------------------------------

def test_sweep_catches_an_unknown_block_copied(monkeypatch):
    """C1 re-planted: every block id answers as one this server can place."""
    monkeypatch.setattr(share, "_known_block", lambda bid: True)
    failures, _tried, _shared = sweep(maximal_template(), reduce_template)
    assert any("'block'" in f and "travelled" in f for f in failures)


def test_sweep_catches_a_display_copied_by_default(monkeypatch):
    """I1 re-planted: the display copied as stored."""
    monkeypatch.setattr(share, "_display", lambda d, keep, kept, sentences: dict(d))
    failures, _tried, _shared = sweep(maximal_plans()[0], reduce_widget)
    assert any("'display'" in f for f in failures)
