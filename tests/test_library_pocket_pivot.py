"""POCKET PIVOT FOLLOWS UCT'S OWN READER: the proof (coordinator's ruling 2026-11-18).

The product has ONE Pocket Pivot: the Screener's base structure,
``api/services/screener/base_catalog.py::_detect_pocket_pivot``. The library's entry is the chart
formula of that detector, and this file is what makes the claim true: on the same bars the
formula is true on exactly the bars the detector fires on, and on no other.

  * over random daily walks (several seeds, every bar, from the first);
  * over a set of hand-built cases, one or more for each of the detector's tests, with the ties
    (the close exactly at mid-range, volume exactly equal to the largest down-day volume, the low
    exactly on the 10-day average, the close exactly where it was 105 bars ago, a down day exactly
    on the edge of the window, no down day at all);
  * and the set is PROVED to exercise every test: the formula with any ONE of its conditions
    removed disagrees with the detector somewhere in it.

⛔ ONE AUTHORITY. Nothing here restates the rule: the detector is imported and run. If its code or
its numbers change, this file runs against the changed detector and any bar of disagreement fails.

The same comparison over real SPY and RDDT daily bars is run privately (the bars are a vendor's and
are not committed); its result is in docs/indicators/evidence/2026-11-18-named-library/EVIDENCE.md.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import importlib
import types

import pytest

from api.services import ast_interpret, call_expansions
from api.services import named_indicators as ni
from api.services.screener import base_catalog as bc
from tests.test_house_indicators_values import _walk
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    conv, emits, empty_view, env, model,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
ENTRY = ni.entry("pocket_pivot")
(OUTPUT,) = ENTRY["outputs"]
TREE = OUTPUT["tree"]
N = 260


# ── the two sides ────────────────────────────────────────────────────────

def formula_fires(bars, tree=None):
    """True on the bars the chart formula is true on (no value yet reads as not true)."""
    col = ast_interpret.interpret(call_expansions.expand_calls(TREE if tree is None else tree), bars)
    return [v is True or v == 1 for v in col]


def detector_fires(bars):
    """The Screener's detector, asked on every bar as the newest bar of the history up to it."""
    return [bool(bc._detect_pocket_pivot(types.SimpleNamespace(bars=bars[:t + 1]))) for t in range(len(bars))]


def disagreements(bars, tree=None):
    return [t for t, (a, b) in enumerate(zip(formula_fires(bars, tree), detector_fires(bars))) if a != b]


# ── hand-built cases ─────────────────────────────────────────────────────

def bars_of(closes, last=None, volumes=None):
    """Daily bars from a list of closes: each bar's range is one point either side of its close,
    volume 1,000,000. `last` overrides fields of the newest bar; `volumes` is {index: volume}."""
    out = []
    for i, c in enumerate(closes):
        out.append({"t": f"d{i}", "o": float(c), "h": float(c) + 1.0, "l": float(c) - 1.0, "c": float(c), "v": 1_000_000.0})
    for i, v in (volumes or {}).items():
        out[i]["v"] = float(v)
    out[-1].update(last or {})
    return out


def rising(n=N, down_at=(-4,)):
    """Whole-number closes rising one point a bar, with a one-bar dip at each index of `down_at`
    (a down day, and the bar after it an up day), and the newest bar up two points."""
    closes = [100 + i for i in range(n)]
    for k in down_at:
        closes[k] -= 2                                   # below the bar before it: a down day
    closes[-1] += 1                                      # the newest bar: up two on the bar before
    return closes


T = N - 1
DOWN = N - 4                                             # the index of the base case's one down day
BASE_LAST = {"h": 361.0, "l": 350.0, "v": 3_000_000.0}   # close 360 at the top of an 11-point bar


def base(**over):
    last = dict(BASE_LAST, **over.pop("last", {}))
    volumes = {DOWN: 2_000_000.0}
    volumes.update(over.pop("volumes", {}))
    return bars_of(over.pop("closes", rising()), last, volumes)


def plateau_then_drop():
    """Above the 50-day and above where it was 105 bars ago, but BELOW the 200-day: a long plateau
    at 200, a fall to 100, then a slow rise."""
    closes = [200.0 + (i % 2) for i in range(100)] + [200.0 - 5 * i for i in range(1, 21)]
    closes += [100.0 + 0.1 * i for i in range(1, N - len(closes) + 1)]
    closes[-4] -= 1.0
    closes[-1] += 1.0
    return closes


def fall_from_a_rise():
    """Above the 200-day and above where it was 105 bars ago, but BELOW the 50-day: a long rise,
    then twenty bars of falling, the newest bar up."""
    closes = [100.0 + 0.5 * i for i in range(N - 20)]
    peak = closes[-1]
    closes += [peak - float(i) for i in range(1, 20)] + [peak - 18.7]
    return closes


def spike_105_ago():
    """Above both averages, but NOT above where it was 105 bars ago: a spike that bar, since undone."""
    closes = [100.0 + (i % 2) for i in range(150)] + [130.0] * 7 + [100.0 + 0.2 * i for i in range(1, N - 157 + 1)]
    closes[-4] -= 1.0
    closes[-1] += 1.0
    return closes


def _c(bars):
    return bars[-1]["c"]


def cases():
    out = {}
    out["a pocket pivot"] = (base(), True)
    # 1. an up day
    flat = rising(); flat[-1] = flat[-2]
    out["not an up day: the close equals the day before"] = (base(closes=flat, last={"h": flat[-1] + 1, "l": flat[-1] - 10}), False)
    down = rising(); down[-1] = down[-2] - 1
    out["a down day"] = (base(closes=down, last={"h": down[-1] + 1, "l": down[-1] - 10}), False)
    # 2. the close in the top half of the bar
    c = _c(base())
    out["the close exactly at mid-range"] = (base(last={"h": c + 10.0, "l": c - 10.0}), True)
    out["the close just under mid-range"] = (base(last={"h": c + 10.5, "l": c - 10.0}), False)
    out["a bar with no range"] = (base(last={"h": c, "l": c}), False)
    # 3. at least one down day in the ten sessions before, and volume above the largest of them
    out["no down day in the window"] = (base(closes=rising(down_at=()), volumes={DOWN: 1_000_000.0}), False)
    out["the only down day is eleven sessions back"] = (base(closes=rising(down_at=(-12,)), volumes={DOWN: 1_000_000.0, T - 11: 2_000_000.0}), False)
    out["the only down day is ten sessions back, the window's edge"] = (
        base(closes=rising(down_at=(-11,)), volumes={DOWN: 1_000_000.0, T - 10: 2_000_000.0}), True)
    out["a down day on NO volume counts as a down day"] = (base(volumes={DOWN: 0.0}), True)
    out["volume exactly equal to the largest down-day volume"] = (base(last={"v": 2_000_000.0}), False)
    out["volume one share above it"] = (base(last={"v": 2_000_001.0}), True)
    out["a larger down day elsewhere in the window"] = (base(closes=rising(down_at=(-4, -8)), volumes={T - 7: 3_500_000.0}), False)
    out["a larger UP day in the window does not count"] = (base(volumes={T - 6: 9_000_000.0}), True)
    out["the newest bar's own volume is not in the window"] = (base(last={"v": 2_000_001.0}, volumes={T - 1: 1_500_000.0}), True)
    flat_day = rising(); flat_day[T - 6] = flat_day[T - 7]
    out["a flat day on heavy volume is not a down day"] = (base(closes=flat_day, volumes={T - 6: 9_000_000.0}), True)
    only_flat = rising(down_at=()); only_flat[T - 3] = only_flat[T - 4]
    out["a flat day is the only day that did not rise"] = (
        base(closes=only_flat, volumes={DOWN: 1_000_000.0, T - 3: 2_000_000.0}), False)
    # 4. at or above the 50- and 200-day averages
    b = bars_of(fall_from_a_rise(), {"v": 3_000_000.0}); b[-1]["h"], b[-1]["l"] = b[-1]["c"] + 1, b[-1]["c"] - 10
    out["below the 50-day, above the 200-day"] = (b, False)
    b = bars_of(plateau_then_drop(), {"v": 3_000_000.0}); b[-1]["h"], b[-1]["l"] = b[-1]["c"] + 1, b[-1]["c"] - 10
    out["below the 200-day, above the 50-day"] = (b, False)
    # 5. not stretched: the low not above the 10-day average
    ten = sum(x["c"] for x in base()[-10:]) / 10
    out["the low exactly on the 10-day average"] = (base(last={"h": c + 1.0, "l": ten}), True)
    out["the low above the 10-day average"] = (base(last={"h": c + 1.0, "l": ten + 0.25}), False)
    # 6. not in a long downtrend: above where it closed 105 bars ago
    b = bars_of(spike_105_ago(), {"v": 3_000_000.0}); b[-1]["h"], b[-1]["l"] = b[-1]["c"] + 1, b[-1]["c"] - 10
    out["at or under where it closed 105 bars ago"] = (b, False)
    tie = rising(); tie[T - bc.PP_DOWNTREND_BARS] = tie[-1]
    out["exactly where it closed 105 bars ago"] = (base(closes=tie), False)
    # not enough history for the 200-day
    out["one bar short of 200"] = (base()[-199:], False)
    return out


CASES = cases()


# ═══ 1. the entry ════════════════════════════════════════════════════════

def test_the_entry_follows_the_house_and_claims_nothing_else():
    assert ENTRY["params"] == [] and OUTPUT["type"] == "condition" and OUTPUT["sites"] == {}
    ev = ENTRY["evidence"]
    assert ev["published"] is None and ev["capture"] is None
    house = ni.follows_house(ENTRY)
    assert house is ev["house"] and set(house) == {"reader", "proof", "whose", "what", "note"}
    assert ni.tiers(ENTRY) == (True, False, False) and ni.passes(ENTRY)
    said = ni.member_sentence(ENTRY, {})
    assert said == ("Built to UCT's checked formula for Pocket Pivot: it follows UCT's own Pocket Pivot, the one the "
                    "Screener's base structures use (Morales and Kacher's volume rule with their stated conditions), and "
                    "is equal to it bar for bar.")
    assert len(said) <= ni.SENTENCE_MAX
    # ⛔ never a word about a vendor, and never "published by": no page read states this rule whole
    assert "TradingView" not in said and "published" not in said
    assert "pocket_pivot" not in {h["id"] for h in ni.held_names()}


def test_the_reader_and_the_proof_it_names_are_real_and_its_numbers_are_the_detectors():
    """What ties the entry to the detector: the reader it names IS the function run here, the proof
    it names IS this file, and the three numbers the detector declares are the formula's."""
    house = ni.follows_house(ENTRY)
    path, _, name = house["reader"].partition("::")
    module = importlib.import_module(path[:-len(".py")].replace("/", "."))
    assert getattr(module, name) is bc._detect_pocket_pivot
    assert house["proof"] == "tests/test_library_pocket_pivot.py" and __file__.replace("\\", "/").endswith(house["proof"])
    formula = OUTPUT["formula"]
    assert f"highest(close < close[1] ? volume : 0, {bc.PP_WINDOW})[1]" in formula
    assert f"highest(close < close[1] ? 1 : 0, {bc.PP_WINDOW})[1] > 0" in formula
    assert f"(close - low) / (high - low) >= {bc.PP_TOP_HALF}" in formula
    assert f"close > close[{bc.PP_DOWNTREND_BARS}]" in formula
    assert "{" not in formula                                # its numbers are the detector's: none is a setting


def test_only_an_entry_with_a_whole_house_record_passes_on_it():
    bare = copy.deepcopy(ENTRY)
    for missing in ("reader", "proof", "whose", "what"):
        e = copy.deepcopy(ENTRY)
        del e["evidence"]["house"][missing]
        assert ni.follows_house(e) is None and not ni.passes(e), missing
    bare["evidence"]["house"] = None
    assert not ni.passes(bare)
    # and it never replaces the value check
    unchecked = copy.deepcopy(ENTRY)
    unchecked["evidence"]["value_check"] = None
    assert not ni.passes(unchecked)
    # an entry with a published definition does not need one
    assert ni.follows_house(ni.entry("mcginley_dynamic")) is None and ni.passes(ni.entry("mcginley_dynamic"))


# ═══ 2. the proof ════════════════════════════════════════════════════════

@pytest.mark.parametrize("seed", [11, 29, 5, 77, 123, 9])
def test_equal_to_the_detector_on_every_bar_of_a_random_walk(seed):
    bars = _walk(seed, n=900)
    assert disagreements(bars) == []


def test_the_walks_are_not_silent():
    """A proof over bars the detector never fires on would prove nothing."""
    fired = sum(sum(detector_fires(_walk(seed, n=900))) for seed in (11, 29, 5))
    assert fired >= 20, fired


@pytest.mark.parametrize("name", sorted(CASES))
def test_equal_to_the_detector_on_a_hand_built_case(name):
    bars, want = CASES[name]
    assert bc._detect_pocket_pivot(types.SimpleNamespace(bars=bars)) is want, "the case is not what its name says"
    assert formula_fires(bars)[-1] is want
    assert disagreements(bars) == []


def conjuncts(tree):
    if isinstance(tree, dict) and tree.get("type") == "op" and tree.get("name") == "&&":
        return [c for arg in tree["args"] for c in conjuncts(arg)]
    return [tree]


def all_of(parts):
    tree = parts[0]
    for p in parts[1:]:
        tree = {"type": "op", "name": "&&", "args": [tree, p]}
    return tree


def test_CONTROL_the_cases_exercise_every_condition_of_the_formula():
    """The formula is eight conditions joined by "and" (the detector's six tests: the volume test
    and the two averages are two each). With ANY ONE removed it must disagree with the detector
    somewhere in the hand-built set, or that condition was never tested."""
    parts = conjuncts(TREE)
    assert len(parts) == 8
    assert all(disagreements(bars, all_of(parts)) == [] for bars, _want in CASES.values())      # the control's control
    for i in range(len(parts)):
        without = all_of(parts[:i] + parts[i + 1:])
        caught = [name for name, (bars, _want) in CASES.items() if disagreements(bars, without)]
        assert caught, f"condition {i} of the formula is exercised by no case"


@pytest.mark.parametrize("name,value", [("PP_WINDOW", 9), ("PP_TOP_HALF", 0.6), ("PP_DOWNTREND_BARS", 100)])
def test_CONTROL_a_change_to_the_detector_fails_the_proof(monkeypatch, name, value):
    """The other direction: move one of the DETECTOR'S numbers and the proof finds the bars."""
    monkeypatch.setattr(bc, name, value)
    walk = _walk(11, n=900)
    assert any(disagreements(bars) for bars in [walk] + [b for b, _w in CASES.values()])


# ═══ 3. at the door ══════════════════════════════════════════════════════

def library_patch():
    return env(0, [{"op": "create", "name": "Pocket Pivot", "placement": "price",
                    "outputs": [{"key": OUTPUT["key"], "label": OUTPUT["label"], "tree": TREE}]}])


@pytest.mark.parametrize("words", ["Add the Pocket Pivot", "show pocket pivots", "POCKET PIVOT", "mark every pocket pivot buy point"])
def test_the_name_is_the_librarys_now_and_is_no_longer_refused(conv, words):
    got = conv.understand_turn(words, CHART)
    assert got["refusal"] is None and [e["id"] for e in got["named"]] == ["pocket_pivot"], words
    assert got["own_words"] == []


def test_it_is_built_to_the_checked_formula_and_says_whose_it_is(conv, clean_env, model):
    client = model([emits(library_patch())])
    r = conv.converse("Add the Pocket Pivot", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 1, r
    (note,) = r["envelope"]["assumptions"]
    assert note["text"] == ni.member_sentence(ENTRY, {})


def test_another_formula_under_the_name_is_refused(conv, clean_env, model):
    """The volume half alone is not UCT's Pocket Pivot: an answer that is not the checked formula
    does not go out under the name."""
    volume_only = {"type": "op", "name": ">", "args": [{"type": "series", "name": "volume"}, {"type": "offset", "value": 1, "args": [
        {"type": "call", "name": "highest", "args": [{"type": "series", "name": "volume"}, {"type": "num", "value": 10}]}]}]}
    wrong = env(0, [{"op": "create", "name": "Pocket Pivot", "placement": "price", "outputs": [{"key": "pp", "tree": volume_only}]}])
    model([emits(wrong), emits(wrong)])
    r = conv.converse("Add the Pocket Pivot", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and "envelope" not in r, r
    assert str(r.get("gate", "")).startswith("named"), r.get("gate")
