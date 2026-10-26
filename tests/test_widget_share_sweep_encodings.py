"""Task 11.4 fix round 2 (m2): the re-review's INDEPENDENT every-leaf sweep, ported as a standing rail.

Written by the reviewer apart from `test_widget_share_sweep.py`, over its own maximal inputs, with
its own allow list read from the code (not from `share.CANARY_SAFE_KEYS`). Mutation kinds, each
applied one at a time:

  leaf    every non-container leaf replaced by each canary encoding (6 strings + a 32-hex id + 3 numbers)
  key+    an unknown canary key (canary value) added to every object, in each string encoding
  rename  every existing object key renamed to the canary (its value kept)
  swap    every container (object / list) replaced by a canary string
  push    a canary string appended to every list
  all     every distinct string (keys and embedded refs too) replaced EVERYWHERE at once

The encodings: hyphenated, snake (block- and key-shaped), camel, full-width, Cyrillic homoglyphs with
a zero-width joiner, a uuid4 row id, and a 32-hex property id. Each reduction must refuse
(`ShareError`) or return a result in which no canary travels (json.dumps with AND without
ensure_ascii), and every output key path must be on the allow list. Counts are EXACT: the mutation
count is derived from the input itself (so 100% of leaves, objects, keys and lists are reached), and
the number of reductions that share is pinned (a reducer that starts refusing more, or sharing more,
must say so here).
"""
from __future__ import annotations

import copy
import json
import sys
import types
from typing import Any, Callable, Iterator

import pytest

from api.services.journal_two.widget_engine import share
from api.services.journal_two.widget_engine import sources as S

CAT = S.CATALOG

ENC = {
    "hyphen": "zzq-canary-7f3a",
    "snake": "zzq_canary_7f3a",
    "camel": "Zzqcanary7f3a",
    "fullwidth": "ｚｚｑｃａｎａｒｙ７ｆ３ａ",
    "homoglyph_zwj": "zzq‍саnаrу7f3a",
    "uuid4": "7f3a7f3a-7f3a-4f3a-8f3a-7f3a7f3a7f3a",
}
HEX32 = "7f3a" * 8
NUMS = (987654.321, 987654, -987654.5)
STRINGS = tuple(ENC.values()) + (HEX32,)
NEEDLES_STR = ("zzq", "7f3a", "canary", "ｚｚｑ", "\\uff5a", "‍", "\\u200d",
               "саn", "\\u0441")
NEEDLES_NUM = ("987654", "987,654", "9.87654")

UA = "0a1b2c3d-1111-4222-8333-000000000001"
UB = "0a1b2c3d-1111-4222-8333-000000000002"
UD = "0a1b2c3d-1111-4222-8333-000000000004"
UE = "0a1b2c3d-1111-4222-8333-000000000005"
PROP = "c" * 32


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setitem(S._GATED_FIELDS, ("notes", "kind"), lambda: True)
    mod = types.ModuleType(share.TEMPLATE_TOOLS_MODULE)
    mod.ROUTINE_TEMPLATES = {"premarket": {}}
    mod.TRACKER_TEMPLATES = {"sleep": {}}
    monkeypatch.setitem(sys.modules, share.TEMPLATE_TOOLS_MODULE, mod)


def plans() -> list[dict]:
    return [
        {"v": 3, "source": "closed_trades", "accounts": {"id": "acc-9"},
         "range": {"from": "2026-02-01", "to": "2026-04-30"},
         "filters": [
             {"field": "setup", "op": "in", "values": ["Breakout"], "overridable": False},
             {"field": "symbol", "op": "in", "values": ["TSLA", "NVDA"]},
             {"field": "regime", "op": "in", "values": ["amber"]},
             {"field": "had_stop", "op": "is", "values": [True]},
             {"field": "r", "op": "gte", "values": [0.5]},
             {"field": "hold_minutes", "op": "between", "values": [5, 90]},
             {"field": "formula:f1", "op": "gte", "values": [2]},
             {"field": "formula:f2", "op": "is", "values": [True]}],
         "measures": [{"formula": "f1", "agg": "sum"}, {"key": "win_rate"}, {"key": "net_pnl"}],
         "formulas": [
             {"id": "f1", "name": "Score", "format": "number",
              "expr": 'If([side] = "Short", -[r] * 1.25, Round([r] - - 0.5, 3)) + -(7) * 0.0'},
             {"id": "f2", "name": "Clean", "format": "number",
              "expr": 'And([had_stop], Weekday([day]) = "Friday", [side] = "Long")'},
             {"id": "f3", "name": "Size", "format": "number",
              "expr": 'Bucket([net], 10, 20.5)'}],
         "split": {"by": "setup", "then": "side"}, "view": {"type": "table", "auto": False},
         "sort": {"measure": 0, "dir": "desc", "top": 7},
         "compare": {"mode": "range", "from": "2025-02-01", "to": "2025-04-30"},
         "display": {"title": "Secret", "subtitle": "Sub", "titleAuto": False, "accent": "teal",
                     "showN": True, "target": 1234}},
        {"v": 3, "source": "options_strategies", "accounts": {"id": "acc-9"},
         "range": {"token": "last_90d"},
         "filters": [{"field": "underlying", "op": "in", "values": ["SPY"]},
                     {"field": "direction", "op": "in", "values": ["bullish"]},
                     {"field": "dte_entry", "op": "lte", "values": [30]}],
         "measures": [{"key": "strategies"}], "split": {"by": "strategy"}},
        {"v": 3, "source": "open_positions",
         "filters": [{"field": "symbol", "op": "in", "values": ["AMD"]},
                     {"field": "risk_pct_account", "op": "gte", "values": [1.5]}],
         "measures": [{"key": "open_risk"}], "split": {"by": "symbol"}},
        {"v": 3, "source": "notes", "range": {"token": "all"},
         "filters": [{"field": "property", "prop": PROP, "op": "between", "values": [3, 8]},
                     {"field": "property", "prop": "d" * 32, "op": "is", "values": [True]},
                     {"field": "tag", "op": "has_any", "values": ["swing", "earnings"]},
                     {"field": "folder", "op": "in", "values": ["f-22"]},
                     {"field": "kind", "op": "in", "values": ["k-3"]},
                     {"field": "ticker", "op": "contains", "values": ["AA"]}],
         "measures": [{"key": "property_sum", "prop": PROP}, {"key": "notes"}],
         "split": {"by": "tag"}},
        {"v": 2, "source": "trading_days",
         "filters": [{"field": "routine_done", "op": "in", "values": ["done"], "ref": UA},
                     {"field": "tracker_bucket", "op": "in", "values": ["x"], "ref": UB},
                     {"field": "tracker_value", "op": "gte", "values": [6], "ref": UB},
                     {"field": "focus", "op": "gte", "values": [2]}],
         "measures": [{"key": "avg_day_pnl"}],
         "split": {"by": "routine_done", "ref": UA, "then": "tracker_bucket", "ref2": UB},
         "compare": {"mode": "all"}},
        {"v": 2, "source": "routine_history",
         "filters": [{"field": "routine", "op": "in", "values": [UA]}],
         "measures": [{"key": "routine_best_run"}], "split": {"by": "item"}},
        {"v": 2, "source": "tracker_history",
         "filters": [{"field": "tracker", "op": "in", "values": [UB]},
                     {"field": "value", "op": "between", "values": [1, 9]}],
         "measures": [{"key": "tracker_max"}]},
        {"v": 3, "source": "closed_trades", "range": {"token": "this_month"},
         "measures": [{"key": "net_pnl"}], "view": {"type": "progress"},
         "display": {"targetGoal": True}},
        {"v": 3, "source": "closed_trades", "measures": [{"key": "current_streak"}],
         "display": {"stopAfter": 4, "title": "Mine"}},
        {"v": 3, "source": "closed_trades", "measures": [{"key": "net_pnl"}],
         "split": {"by": "day"}, "view": {"type": "line"}, "display": {"cumulative": True}},
        {"v": 3, "source": "closed_trades", "view": {"type": "scatter"},
         "measures": [{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "avg"}],
         "formulas": [{"id": "f1", "name": "MAE", "expr": "Abs([mae_r])", "format": "r"},
                      {"id": "f2", "name": "MFE", "expr": "[mfe_r]", "format": "r"}],
         "display": {"quadrants": "excursion"}},
    ]


def routine() -> dict:
    return {"id": UA, "name": "Secret routine", "archived": False, "etag": 9,
            "items": [{"id": "i1", "text": "Private 1", "negative": True,
                       "suggest": {"rule": "no_revenge", "n": 2}},
                      {"id": "i2", "text": "Private 2", "suggest": {"rule": "max_trades", "n": 4}},
                      {"id": "i3", "text": "Private 3"}],
            "schedule": {"kind": "weekdays", "days": [1, 3, 4]},
            "settings": {"done_share": 0.5, "reminder": {"on": True, "time_et": "07:55"}},
            "history": [{"day": "2026-03-01", "ticks": ["i1"]}]}


def tracker() -> dict:
    return {"id": UB, "name": "Secret tracker", "kind": "scale", "unit": "pts",
            "settings": {"days": "trading", "goal": 4}, "values": [{"day": "2026-03-01", "v": 3}]}


def template() -> dict:
    return {
        "style": {"id": "s-1", "name": "Secret style", "kindId": "trade_plan",
                  "properties": {PROP: "y"},
                  "blocks": [
                      {"block": "chart", "enabled": True, "settings": {"tf": "60"}},
                      {"block": "preEntryChecklist", "enabled": True, "settings": {"items": ["mine"]}},
                      {"block": "myWatchlistToday", "enabled": True, "settings": {"n": 5}},
                      {"block": "myRiskLeftToday", "enabled": True, "settings": {}},
                      {"block": "built_a", "enabled": True,
                       "settings": {"ref": "def:" + UD, "defRev": 2, "range": {"token": "ytd"}}},
                      {"block": "built_b", "enabled": True,
                       "settings": {"ref": "def:" + UE, "defRev": 1}},
                      {"block": "built_c", "enabled": True, "settings": {"ref": "def:" + UD, "defRev": 2}},
                      {"block": "built_d", "enabled": True,
                       "settings": {"ref": "shelf:equity-curve", "defRev": 1, "range": {"token": "all"}}},
                      {"block": "routine_1", "enabled": True,
                       "settings": {"ref": "routine:" + UA, "bind": "week", "display": "pnl"}},
                      {"block": "routine_2", "enabled": True,
                       "settings": {"template": "premarket", "bind": "note-day", "display": "items"}},
                      {"block": "tracker_1", "enabled": True,
                       "settings": {"ref": "tracker:" + UB, "bind": "next-trading-day", "display": "pnl"}},
                      {"block": "tracker_2", "enabled": True,
                       "settings": {"template": "sleep", "bind": "note-day", "display": "chart"}},
                      {"block": "tracker_3", "enabled": True, "settings": {"ref": "checkin:focus"}}]},
        "definitions": {"def:" + UD: {"id": UD, "name": "Secret def", "plan": plans()[0]},
                        UE: {"id": UE, "name": "Secret def 2", "plan": plans()[4]}},
        "routines": {"routine:" + UA: routine()},
        "trackers": {UB: tracker()},
    }


R_EDITS = {"items": ["Mine A", {"text": "Mine B", "negative": False}]}
T_EDITS = {"blocks": {"routine_1": R_EDITS}}


def red_widget(p, edits=None, keep=()):
    return share.share_plan(p, catalog=CAT, edits=edits, keep=keep)


def red_routine(r, edits=R_EDITS, keep=()):
    return share.share_routine(r, edits=edits, keep=keep)


def red_tracker(t, edits=None, keep=()):
    return share.share_tracker(t, edits=edits)


def red_template(t, edits=T_EDITS, keep=()):
    t = t if isinstance(t, dict) else {}       # the harness wrapper is not member input
    return share.share_template(t.get("style"), definitions=t.get("definitions"),
                                routines=t.get("routines"), trackers=t.get("trackers"),
                                edits=edits, keep=keep, catalog=CAT)


# -- mutations ---------------------------------------------------------------------------------------

def nodes(obj, here=()):
    yield here, obj
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from nodes(v, here + (k,))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from nodes(v, here + (i,))


def at(obj, path):
    for k in path:
        obj = obj[k]
    return obj


def put(base, path, value):
    if not path:
        return value
    out = copy.deepcopy(base)
    at(out, path[:-1])[path[-1]] = value
    return out


def rename(base, path, key):
    out = copy.deepcopy(base)
    d = at(out, path)
    new = {(STRINGS[1] if k == key else k): v for k, v in d.items()}
    if path:
        at(out, path[:-1])[path[-1]] = new
        return out
    return new


def mutations(base, numbers=True) -> Iterator[tuple[str, tuple, Any]]:
    """(kind, path, mutated input) for every mutation of `base`."""
    for path, node in list(nodes(base)):
        if isinstance(node, dict):
            for s in STRINGS:
                g = copy.deepcopy(node)
                g[s] = s
                yield "key+", path, put(base, path, g)
            for k in list(node):
                yield "rename", path + (k,), rename(base, path, k)
            if path:
                yield "swap", path, put(base, path, STRINGS[0])
        elif isinstance(node, list):
            for s in STRINGS:
                yield "push", path, put(base, path, [*copy.deepcopy(node), s])
            yield "swap", path, put(base, path, STRINGS[1])
        elif path:
            for s in STRINGS:
                yield "leaf", path, put(base, path, s)
            if numbers:
                for n in NUMS:
                    yield "leaf", path, put(base, path, n)


def expected_mutations(base, numbers=True) -> int:
    """The mutation count derived from the input's own shape: every leaf, object, key and list."""
    n = 0
    for path, node in nodes(base):
        if isinstance(node, dict):
            n += len(STRINGS) + len(node) + (1 if path else 0)
        elif isinstance(node, list):
            n += len(STRINGS) + 1
        elif path:
            n += len(STRINGS) + (len(NUMS) if numbers else 0)
    return n


def leak(result, numbers=True):
    whole = {"payload": result.payload, "slots": list(result.slots), "kept": list(result.kept),
             "not_shared": list(result.not_shared)}
    for blob in (json.dumps(whole), json.dumps(whole, ensure_ascii=False)):
        low = blob.lower()
        for n in NEEDLES_STR + (NEEDLES_NUM if numbers else ()):
            if n.lower() in low:
                return n
    return None


def keypaths(obj, here="", kind=""):
    out = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{here}.{k}"
            out.add(f"{kind}:{p}")
            out |= keypaths(v, p, kind)
    elif isinstance(obj, list):
        for v in obj:
            out |= keypaths(v, here + "[]", kind)
    return out


def sweep(base, reduce, numbers=True, **kw):
    """(failures, tried, shared, leaves planted, output key paths)."""
    fails, tried, shared, planted, paths = [], 0, 0, set(), set()
    for kind, path, mutated in mutations(base, numbers=numbers):
        tried += 1
        if kind == "leaf":
            planted.add(path)
        try:
            res = reduce(mutated, **kw)
        except share.ShareError:
            continue
        except Exception as e:  # noqa: BLE001 -- a crash is a finding too
            fails.append(f"{kind} {path}: CRASH {type(e).__name__}: {e}")
            continue
        shared += 1
        bad = leak(res, numbers=numbers)
        if bad:
            fails.append(f"{kind} {path}: {bad!r} travelled")
        paths |= keypaths(res.payload, kind=reduce.__name__)
    return fails, tried, shared, planted, paths


def leaves(base) -> set[tuple]:
    return {p for p, n in nodes(base) if p and not isinstance(n, (dict, list))}


# -- the allow list, written by the reviewer from reading share.py ----------------------------------
PLAN = {
    ".v", ".source", ".accounts", ".accounts.pick", ".range", ".range.token",
    ".filters", ".filters[].field", ".filters[].op", ".filters[].overridable", ".filters[].ref",
    ".filters[].ref.pick", ".filters[].prop", ".filters[].prop.pick", ".filters[].values",
    ".filters[].values[].pick",
    ".measures", ".measures[].formula", ".measures[].agg", ".measures[].key", ".measures[].prop",
    ".measures[].prop.pick",
    ".split", ".split.by", ".split.then", ".split.ref", ".split.ref.pick", ".split.ref2",
    ".split.ref2.pick", ".view", ".view.type", ".view.auto", ".sort", ".sort.measure", ".sort.dir",
    ".sort.top", ".compare", ".compare.mode",
    ".display", ".display.title", ".display.titleAuto", ".display.subtitle", ".display.accent",
    ".display.showN", ".display.target", ".display.cumulative", ".display.targetGoal",
    ".display.quadrants", ".display.stopAfter",
    ".formulas", ".formulas[].id", ".formulas[].name", ".formulas[].expr", ".formulas[].format",
}
SLOT = {"[].id", "[].type", "[].label", "[].any", "[].source", "[].field"}
ROUT = {".name", ".items", ".items[].text", ".items[].negative", ".items[].suggest",
        ".items[].suggest.rule", ".items[].suggest.n", ".schedule", ".schedule.kind",
        ".schedule.days", ".settings", ".settings.done_share"}
TRK = {".name", ".kind", ".unit", ".days"}
ALLOW = (
    {f"red_widget:{p}" for p in {".name", ".description", ".slots", ".plan"} | {".plan" + q for q in PLAN}
     | {".slots" + s for s in SLOT}}
    | {f"red_routine:{p}" for p in ROUT}
    | {f"red_tracker:{p}" for p in TRK}
    | {f"red_template:{p}" for p in
       {".format", ".name", ".description", ".blocks", ".blocks[].block", ".blocks[].enabled",
        ".blocks[].settings", ".blocks[].settings.ref", ".blocks[].settings.defRev",
        ".blocks[].settings.range", ".blocks[].settings.range.token", ".blocks[].settings.inline",
        ".blocks[].settings.bind", ".blocks[].settings.display", ".blocks[].settings.template",
        ".definitions", ".definitions[].key", ".definitions[].name", ".definitions[].description",
        ".definitions[].plan", ".routines", ".routines[].key", ".trackers", ".trackers[].key",
        ".slots"} | {".definitions[].plan" + q for q in PLAN} | {".slots" + s for s in SLOT}
       | {".routines[]" + q for q in ROUT} | {".trackers[]" + q for q in TRK}}
)

INPUTS: dict[str, tuple[Callable[[], Any], Callable]] = {
    **{f"plan{i}": ((lambda i=i: plans()[i]), red_widget) for i in range(len(plans()))},
    "routine": (routine, red_routine),
    "tracker": (tracker, red_tracker),
    "template": (template, red_template),
}
#: How many of each input's mutations share (the rest refuse), measured on the round 2 reducer.
#: Pinned exactly: a reducer change that refuses or shares more says so here. plan7 (a goal progress
#: bar) and plan9 (a running total) hold only structure, so every canary is refused: 0 is correct.
EXPECTED_SHARED: dict[str, int] = {
    "plan0": 100, "plan1": 38, "plan2": 17, "plan3": 65, "plan4": 20, "plan5": 14, "plan6": 17,
    "plan7": 0, "plan8": 7, "plan9": 0, "plan10": 12,
    "routine": 380, "tracker": 110, "template": 1584,
}


# -- tests -------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", list(INPUTS))
def test_every_mutation_shares_nothing_and_reaches_every_leaf(name):
    make, reduce = INPUTS[name]
    base = make()
    reduce(base)                                     # the unmutated input shares (a valid fixture)
    fails, tried, shared, planted, paths = sweep(base, reduce)
    assert fails == [], fails[:10]
    assert tried == expected_mutations(base)         # every leaf, object, key and list: 100% reach
    assert planted == leaves(base)
    assert sorted(paths - ALLOW) == []
    assert shared == EXPECTED_SHARED[name], shared


def test_widget_with_keep_everything_strings_never_travel():
    """Keep every path the reducer knows: numbers may travel (the author's choice), text never."""
    keep = [f"filters/{i}/values/{j}" for i in range(20) for j in range(5)]
    keep += [f"formulas/f{k}/{o}" for k in range(1, 6) for o in range(200)]
    keep += ["display/target", "display/stopAfter", "display/title", "display", "name",
             "formulas/f1/name", "filters/0", "measures/0/prop"]
    for p in plans():
        fails, tried, _shared, _planted, _paths = sweep(p, red_widget, numbers=False, keep=keep)
        assert fails == [], fails[:10]
        assert tried == expected_mutations(p, numbers=False)


def test_widget_hostile_edits():
    """Hostile edits: unknown keys carry nothing; known keys carry only the author's typed text."""
    hostile = {s: s for s in STRINGS}
    hostile["formulas"] = {"f9": STRINGS[0], STRINGS[1]: STRINGS[2]}
    hostile["plan"] = {"display": {"title": STRINGS[0]}}
    assert leak(red_widget(plans()[0], edits=hostile)) is None


def test_routine_keep_everything():
    keep = [f"items/{i}/suggest" for i in range(5)] + ["items/0/text", "name"]
    fails, tried, _shared, _p, _k = sweep(routine(), red_routine, numbers=False, keep=keep)
    assert fails == [] and tried == expected_mutations(routine(), numbers=False)


def test_template_keep_everything():
    keep = [f"{b}/{p}" for b in ("built_a", "built_b", "built_c", "routine_1")
            for p in ["display/target", "display/stopAfter"]
            + [f"filters/{i}/values/{j}" for i in range(15) for j in range(4)]
            + [f"formulas/f{k}/{o}" for k in range(1, 4) for o in range(120)]
            + [f"items/{i}/suggest" for i in range(4)]]
    fails, tried, _shared, _p, _k = sweep(template(), red_template, numbers=False, keep=keep)
    assert fails == [] and tried == expected_mutations(template(), numbers=False)


def _replace_value(obj, old, new):
    if isinstance(obj, dict):
        return {(new if k == old else k): _replace_value(v, old, new) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_replace_value(v, old, new) for v in obj]
    if isinstance(obj, str) and obj != old and old in obj and len(old) >= 6:
        return obj.replace(old, new)               # embedded: "def:<uuid>", "routine:<uuid>"
    return new if obj == old else obj


def coordinated(base):
    """Every distinct string value replaced EVERYWHERE at once (keys, embedded refs too), so a
    renamed id stays consistent across the references that would otherwise make validation refuse."""
    vals = sorted({v for _p, v in nodes(base) if isinstance(v, str)} |
                  {k for _p, v in nodes(base) if isinstance(v, dict) for k in v})
    for old in vals:
        for s in STRINGS:
            yield f"all[{old!r}]->{s[:8]}", _replace_value(base, old, s)


@pytest.mark.parametrize("name", list(INPUTS))
def test_coordinated_rename(name):
    make, reduce = INPUTS[name]
    fails = []
    for where, planted in coordinated(make()):
        try:
            res = reduce(planted)
        except share.ShareError:
            continue
        except Exception as e:  # noqa: BLE001
            fails.append(f"{where}: CRASH {type(e).__name__}: {e}")
            continue
        bad = leak(res)
        if bad:
            fails.append(f"{where}: {bad!r} travelled")
    assert fails == [], fails[:10]


# -- teeth: a reducer that copies ONE unknown key goes red --------------------------------------------

def _copy_unknown_keys(real, known):
    """A routine / tracker reducer that also copies every key of the stored row it does not know."""
    def leaky(row, **kw):
        got = real(row, **kw)
        extra = {k: v for k, v in row.items() if k not in known} if isinstance(row, dict) else {}
        return share.Shared({**got.payload, **extra}, got.slots, got.kept, got.not_shared)
    return leaky


@pytest.mark.parametrize("name,attr,known", [
    ("routine", "share_routine", set(routine())),
    ("tracker", "share_tracker", set(tracker())),
])
def test_a_reducer_copying_one_unknown_key_goes_red(monkeypatch, name, attr, known):
    monkeypatch.setattr(share, attr, _copy_unknown_keys(getattr(share, attr), known))
    make, _reduce = INPUTS[name]
    reduce = red_routine if name == "routine" else red_tracker
    fails, _tried, _shared, _planted, paths = sweep(make(), reduce)
    assert any("key+" in f and "travelled" in f for f in fails)
    assert paths - ALLOW                              # and the allow list sees the new key
