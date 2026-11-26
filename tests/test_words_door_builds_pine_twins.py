"""The words door builds TradingView's calculation wherever the engine has a Pine-parity twin (2026-11-26).

The fifty-set probe (live, admin measurement only): "the 5 bar ATR divided by the 50 bar ATR" was built with the house
`atr` (Wilder's original, true range from bar 1), 4.35% below TradingView's `ta.atr(14)` at its first value. Coordinator's
ruling: the words door builds the twin (`atrPine`, `stochPine`, `mfiPine`); the native indicators, ThinkScript and the
pattern levels keep the house calculation. Held here: the twin list is derived from the table; every call in every tree
of a built patch is the twin (states included); the door's ATR equals TradingView's own published values on a capture;
a library indicator built through the door is still recognised; the house functions still exist and still differ in
warm-up (the native ATR is untouched). No paid calls.
"""
from __future__ import annotations

import json
from pathlib import Path

from api.services import ast_interpret, ast_table, named_indicators
from tests.test_p2_truth_server import conv, empty_view, emits, env, model  # noqa: F401 -- fixtures by name

ROOT = Path(__file__).resolve().parent.parent
KELTNER = ROOT / "tests" / "fixtures" / "vendor" / "harness" / "keltner-channels-bands-rddt-1d-2026-09-27.json"
THE_REQUEST = "In a pane below, plot the 5 bar ATR divided by the 50 bar ATR, with a line at 0.5."
HLC = [{"type": "series", "name": n} for n in ("high", "low", "close")]
VOL = {"type": "series", "name": "volume"}


def num(v):
    return {"type": "num", "value": v}


def call(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def names_in(tree):
    out, stack = [], [tree]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "call":
                out.append(n["name"])
            stack.extend(n.get("args") or [])
    return out


def test_the_twins_are_derived_from_the_table_and_take_the_same_arguments():
    functions = ast_table.TABLE[ast_table.FUNCTIONS_SECTION]
    assert dict(ast_table.PINE_TWINS) == {"atr": "atrPine", "mfi": "mfiPine", "stoch": "stochPine"}
    for house, twin in ast_table.PINE_TWINS.items():
        assert functions[house]["args"] == functions[twin]["args"], house      # so a rename is the whole change
    planted = {ast_table.FUNCTIONS_SECTION: {"foo": {}, "fooPine": {}, "barPine": {}}}
    assert dict(ast_table.pine_twins(planted)) == {"foo": "fooPine"}           # a twin needs its house function


def test_every_call_in_every_tree_becomes_the_twin_and_nothing_else_moves(conv):
    atr14 = call("atr", *HLC, num(14))
    e = env(0, [{"op": "create", "name": "x", "outputs": [
                    {"key": "a", "tree": {"type": "op", "name": "/", "args": [call("atr", *HLC, num(5)), call("atr", *HLC, num(50))]}},
                    {"key": "s", "tree": call("sma", call("stoch", *HLC, num(14)), num(3))},
                    {"key": "m", "tree": call("mfi", *HLC, VOL, num(14))}]},
                {"op": "set_color_states", "channel": "bgcolor", "otherwise": "#00000000",
                 "states": [{"when": {"type": "op", "name": ">", "args": [atr14, num(1)]}, "color": "#08998140"}]}])
    before = json.dumps(e, sort_keys=True)
    got = conv.with_pine_twins(e)
    assert json.dumps(e, sort_keys=True) == before                              # a NEW envelope; the input is untouched
    trees = [t for _w, t in conv._trees_of(got)]
    assert [sorted(names_in(t)) for t in trees] == [["atrPine", "atrPine"], ["sma", "stochPine"], ["mfiPine"], ["atrPine"]]
    assert all(not ({"atr", "stoch", "mfi"} & set(names_in(t))) for t in trees)
    plain = env(0, [{"op": "create", "name": "y", "outputs": [{"key": "a", "tree": call("ema", HLC[2], num(20))}]}])
    assert conv.with_pine_twins(plain) == plain                                 # CONTROL: no twin, no change
    assert conv.pine_twin_tree(call("atr", *HLC, num(14))) == call("atrPine", *HLC, num(14))


def test_the_request_found_live_is_answered_with_tradingviews_atr(conv, model):
    ratio = {"type": "op", "name": "/", "args": [call("atr", *HLC, num(5)), call("atr", *HLC, num(50))]}
    e = env(0, [{"op": "create", "name": "ATR 5 / ATR 50", "outputs": [{"key": "ratio", "tree": ratio}]}],
            reply="The 5 bar ATR over the 50 bar ATR in a pane below.")
    client = model([emits(e)])
    r = conv.converse(THE_REQUEST, user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["turn"] == "patch", r
    assert len(client.calls) == 1
    built = r["envelope"]["ops"][0]["outputs"][0]["tree"]
    assert names_in(built) == ["atrPine", "atrPine"]


def test_the_doors_atr_is_tradingviews_on_its_own_capture_from_the_first_bar():
    d = json.loads(KELTNER.read_text(encoding="utf-8"))
    rows = d["bars"]["rows"]
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]
    index = {r[0]: i for i, r in enumerate(rows)}
    vendor = {index[p[0]]: p[2] - p[1] for p in d["plotValues"]["rows"]}         # upper band - basis = 1 x atr(10)
    ours = ast_interpret.interpret(call(ast_table.PINE_TWINS["atr"], *HLC, num(10)), bars, {})
    house = ast_interpret.interpret(call("atr", *HLC, num(10)), bars, {})
    assert len(vendor) == 612
    for i, v in vendor.items():
        assert ours[i] is not None and abs(ours[i] - v) <= max(1e-9, 1e-12 * abs(v)), (i, ours[i], v)
    # ⛔ CONTROL, AND WHY THE RULING MATTERS: the house ATR (the native indicator's) is untouched and still differs
    # from TradingView at the left edge -- it starts a bar later and reads differently on the early bars.
    first = min(vendor)
    assert house[first] is None or abs(house[first] - vendor[first]) > 1e-6
    assert sum(1 for i, v in vendor.items() if house[i] is None or abs(house[i] - v) > 1e-6) > 10


def test_a_library_indicator_built_through_the_door_is_still_recognised(conv):
    u = conv.understand_turn("Chandelier Exit with an ATR multiplier of 2.5", {"sym": "NVDA", "tf": "D"})
    entry = named_indicators.entry("chandelier_exit")
    trees = [named_indicators.tree_at(o, named_indicators.defaults(entry)) for o in entry["outputs"]]
    assert all("atr" in names_in(t) for t in trees)                             # the checked formula keeps the house name
    built = [conv.pine_twin_tree(t) for t in trees]
    assert all("atrPine" in names_in(t) and "atr" not in names_in(t) for t in built)

    def patch(ts):
        return env(0, [{"op": "create", "name": "Chandelier Exit",
                        "outputs": [{"key": o["key"], "tree": t} for o, t in zip(entry["outputs"], ts)]}])

    conv.check_named(patch(built), empty_view(0), u["named"])                  # the twin IS the checked formula
    assert conv.named_built(patch(built), empty_view(0), u["named"]) == ["chandelier_exit"]
    assert conv.house_tree(built[0]) == trees[0]                                # the read-back is exact
    wrong = [json.loads(json.dumps(t).replace('"atrPine"', '"rsi"')) for t in built]
    assert conv.named_built(patch(wrong), empty_view(0), u["named"]) == []      # CONTROL: another function is not
