"""THE NAMED-INDICATOR LIBRARY: a named indicator means ONE checked formula. Lookup, not recall.

`api/data/named_indicators.json` + `api/services/named_indicators.py`. Three things are held here:

  1. THE FILE. Every entry's derived halves agree with its text (sites sit on the parameters'
     numbers, the fingerprint is the newest version's), its evidence is complete, its aliases
     are safe, and no id lives in two stores of maths.
  2. `output_in`: does a tree HOLD an entry's formula? Equal in shape and in every number but a
     declared parameter's. Nothing near it counts.
  3. THE DOOR. A known name reaches the assistant WITH its formula; the change is accepted only
     if the patch holds it; the member is told what was built and how it was checked; a name not
     checked yet is refused by name; an unknown Title-Case name is refused as before.

The values themselves (evidence tier a) are `tests/test_named_indicators_values.py`.
No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import copy
import json
import pathlib
import shutil
import subprocess
import sys

import pytest

from api.services import chart_twins
from api.services import named_indicators as ni
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENTRIES = {e["id"]: e for e in ni.entries()}
S = lambda n: {"type": "series", "name": n}  # noqa: E731
EMA14 = call("ema", S("close"), num(14))
GATE = "named:formula"
needs_node = pytest.mark.skipif(shutil.which("node") is None or not (ROOT / "app/node_modules/esbuild").exists(),
                                reason="node and app/node_modules are needed to run the shipped parser")


def tree_of(entry_id, key=None, **values):
    e = ENTRIES[entry_id]
    o = next(o for o in e["outputs"] if key is None or o["key"] == key)
    return ni.tree_at(o, values)


def create(entry_id, values=None, name=None, only=None):
    e = ENTRIES[entry_id]
    return {"op": "create", "name": name or e["name"], "placement": "pane" if e["placement"] == "pane" else "price",
            "outputs": [{"key": o["key"], "tree": ni.tree_at(o, values or {})} for o in e["outputs"]
                        if only is None or o["key"] in only]}


def node_at(tree, path):
    for i in path:
        tree = tree["args"][i]
    return tree


# ═══ 1. the file ═════════════════════════════════════════════════════════════

def test_the_library_is_not_empty_and_every_entry_passes_the_planner():
    assert len(ENTRIES) >= 13
    for e in ni.entries():
        assert ni.passes(e), e["id"]                       # nothing ships that the assistant may not build
        # value-checked, and EITHER a published definition read OR proved equal to UCT's own reader
        checked, published, _captured = ni.tiers(e)
        assert checked and (published or ni.follows_house(e) is not None), e["id"]
    assert [e["id"] for e in ni.entries() if not ni.tiers(e)[1]] == ["pocket_pivot"]


def test_ids_names_and_aliases_are_safe():
    seen_alias = {}
    assert len(ENTRIES) == len(ni.entries())               # ids are unique
    for e in ni.entries():
        assert e["id"] == e["id"].lower() and " " not in e["id"]
        assert e["aliases"] and len(set(e["aliases"])) == len(e["aliases"]), e["id"]
        assert e["name"].lower() in e["aliases"], f"{e['id']}: its own name is not one of its aliases"
        for alias in e["aliases"]:
            assert alias == alias.lower().strip(), alias
            # ⛔ never a bare two- or three-letter acronym: RS, EMA, MA, GAP and PEG are real tickers
            words = alias.replace("-", " ").replace("'", " ").split()
            assert any(len(w) >= 4 for w in words), f"{alias!r} is only short words"
            assert seen_alias.setdefault(alias, e["id"]) == e["id"], f"{alias!r} names two entries"
        assert e["placement"] in ("overlay", "pane")
        assert [o["type"] for o in e["outputs"]] and all(o["type"] in ("value", "condition") for o in e["outputs"])
        assert len({o["key"] for o in e["outputs"]}) == len(e["outputs"])


def test_every_parameter_has_a_range_its_default_sits_in_and_sites_that_hold_that_default():
    for e in ni.entries():
        keys = [p["key"] for p in e["params"]]
        assert len(set(keys)) == len(keys), e["id"]
        used = set()
        for p in e["params"]:
            assert p["min"] <= p["default"] <= p["max"], (e["id"], p["key"])
            assert isinstance(p["integer"], bool) and (not p["integer"] or float(p["default"]).is_integer())
        for o in e["outputs"]:
            assert set(o["sites"]) <= set(keys), (e["id"], o["key"])
            for key, paths in o["sites"].items():
                default = next(p["default"] for p in e["params"] if p["key"] == key)
                assert paths and len({tuple(p) for p in paths}) == len(paths)
                for path in paths:
                    node = node_at(o["tree"], path)
                    assert node["type"] in ("num", "offset"), (e["id"], key, path, node["type"])
                    assert node["value"] == default, (e["id"], key, path, node["value"])
                used.add(key)
        assert used == set(keys), f"{e['id']}: a parameter sits in no formula"


def test_an_entrys_maths_never_changes_under_the_same_version():
    """THE VERSION RULE, the house set's own: the fingerprint of what the file holds today is its
    newest version's; a version is a CHANGE; an earlier entry is never rewritten."""
    for e in ni.entries():
        history = e["versions"]
        assert [h["version"] for h in history] == list(range(1, len(history) + 1)), e["id"]
        assert len({h["maths"] for h in history}) == len(history), e["id"]
        assert all(h["maths"].startswith("sha256:") and h["since"] and h["why"] for h in history), e["id"]
        assert ni.fingerprint(e) == history[-1]["maths"], (
            f"{e['id']}: its maths moved and its version did not. Add an entry to its `versions` and run "
            "tools/named_indicators_build.py.")
        assert ni.version(e) == len(history)


def test_the_fingerprint_reads_the_maths_and_nothing_else():
    e = copy.deepcopy(ENTRIES["awesome_oscillator"])
    before = ni.fingerprint(e)
    e["aliases"].append("another name")
    e["evidence"]["published"]["says"] = "other words"
    assert ni.fingerprint(e) == before
    e["outputs"][0]["tree"]["args"][0]["args"][1]["value"] = 6
    assert ni.fingerprint(e) != before


def test_the_evidence_says_what_was_read_and_where():
    for e in ni.entries():
        ev = e["evidence"]
        assert ev["value_check"] == f"tests/test_named_indicators_values.py::{e['id']}"
        pub = ev["published"]
        if pub is None:
            # ⭐ no page states this rule whole: the entry follows UCT's own reader instead, and says
            # which function that is and which test proves the two equal
            house = ni.follows_house(e)
            assert house is not None and ev["capture"] is None, e["id"]
            reader, _, name = house["reader"].partition("::")
            assert (ROOT / reader).is_file() and f"def {name}(" in (ROOT / reader).read_text(encoding="utf-8"), e["id"]
            assert (ROOT / house["proof"]).is_file() and house["note"], e["id"]
            continue
        assert "house" not in ev, e["id"]
        assert pub["by"] and pub["says"] and pub["read"] and pub["sources"], e["id"]
        assert pub["url"] == pub["sources"][0]["url"]
        for s in pub["sources"]:
            assert s["url"].startswith("https://") and s["title"] and s["kind"] in ("originator", "vendor documentation", "reference")
        assert ev["capture"] is None or ({"id", "against", "charts", "grade", "detail"} <= set(ev["capture"])
                                         and all(ev["capture"].values()))


def test_what_the_library_claims_about_tradingview_is_what_was_graded():
    """Thirty-one entries are TradingView built-ins and were graded against them in four batches
    (2026-11-18; the method and grades are in docs/indicators/evidence/2026-11-18-named-library/).
    Twenty-six are equal on every bar; three are equal after their first bars. Two claim NOTHING
    about TradingView, each for a stated reason: the McGinley Dynamic (UCT's 300-bar restart of the
    same formula is not bar-equal) and the Directional Movement Index (one floating-point tie on
    one bar of 8,509). Four are not TradingView built-ins and have no capture (the Laguerre pair
    among them: TradingView ran OUR equations for those, which is not a grade against its own).
    One IS a built-in and waits for its capture: the Stochastic Oscillator, on two tiers until then.
    One follows UCT'S OWN reader and has nothing to do with TradingView: Pocket Pivot."""
    grade = {e["id"]: (e["evidence"]["capture"] or {}).get("grade") for e in ni.entries()}
    assert sorted(i for i, g in grade.items() if g == "EQUAL") == sorted([
        "awesome_oscillator", "chaikin_money_flow", "choppiness_index", "coppock_curve", "elder_ray",
        "true_strength_index", "ultimate_oscillator", "vortex_indicator",
        # the second batch, slice 2's four entries: equal on every bar of both charts
        "double_exponential_moving_average", "triple_exponential_moving_average", "chande_momentum_oscillator",
        "stochastic_rsi",
        # the third batch, library slice 3: ten of its twelve entries
        "aroon", "on_balance_volume", "accumulation_distribution_line", "price_volume_trend",
        "percentage_price_oscillator", "know_sure_thing", "mass_index", "force_index", "ease_of_movement", "ulcer_index",
        # after the rulings of 2026-11-18: the Negative Volume Index in its compounding form (version 2), and TRIX
        "negative_volume_index", "trix",
        # the fourth batch: the Positive Volume Index, both lines on every bar
        "positive_volume_index",
        # the Detrended Price Oscillator in TradingView's default (not centred) form, at lengths 21 and 20
        "detrended_price_oscillator"])
    # the Fisher Transform is recomputed from 300 bars back on every bar: equal on every bar it has a
    # value for, at two lengths, with no value on the first 300 bars of a chart's history
    assert sorted(i for i, g in grade.items() if g == "EQUAL AFTER WARM-UP") == ["chandelier_exit", "connors_rsi", "fisher_transform"]
    assert grade["mcginley_dynamic"] == "FORMULA EQUAL, RESTART DIFFERS"
    assert grade["directional_movement_index"] == "FORMULA EQUAL, ONE ROUNDING TIE DIFFERS"
    for silent in ("mcginley_dynamic", "directional_movement_index"):
        assert not ni.tiers(ENTRIES[silent])[2], silent
        assert "TradingView" not in ni.member_sentence(ENTRIES[silent], ni.defaults(ENTRIES[silent])), silent
    assert set(grade.values()) <= {None, "EQUAL", "EQUAL AFTER WARM-UP", "FORMULA EQUAL, RESTART DIFFERS",
                                   "FORMULA EQUAL, ONE ROUNDING TIE DIFFERS"}
    assert grade["kaufman_adaptive_moving_average"] is None and grade["squeeze_momentum"] is None
    assert grade["laguerre_filter"] is None and grade["laguerre_rsi"] is None
    assert grade["stochastic_oscillator"] is None and not ni.tiers(ENTRIES["stochastic_oscillator"])[2]
    assert "TradingView" not in ni.member_sentence(ENTRIES["stochastic_oscillator"], ni.defaults(ENTRIES["stochastic_oscillator"]))
    assert grade["pocket_pivot"] is None and ni.follows_house(ENTRIES["pocket_pivot"]) is not None
    assert "TradingView" not in ni.member_sentence(ENTRIES["pocket_pivot"], {})
    assert sum(1 for g in grade.values() if g is None) == 6 and len(grade) == 37
    assert not ni.tiers(ENTRIES["mcginley_dynamic"])[2] and "TradingView" not in ni.member_sentence(ENTRIES["mcginley_dynamic"], {})
    assert ni.tiers(ENTRIES["connors_rsi"])[2] and ni.tiers(ENTRIES["vortex_indicator"])[2]


def test_the_tiers_and_what_the_member_is_told():
    e = copy.deepcopy(ENTRIES["chandelier_exit"])
    e["evidence"]["capture"] = None
    assert ni.tiers(e) == (True, True, False) and ni.passes(e)
    said = ni.member_sentence(e, {"length": 22.0, "atr_length": 22.0, "multiplier": 2.5})
    assert said == ("Built to UCT's checked formula for Chandelier Exit (length 22, atr length 22, atr multiplier 2.5): "
                    "checked against an independent calculation and the definition published by Charles Le Beau.")
    # a parameter one of the member's own settings drives is theirs to read off the setting
    assert "(length 22, atr length 22)" in ni.member_sentence(e, {"length": 22.0, "atr_length": 22.0, "multiplier": None})
    e["evidence"]["capture"] = {"id": "cap-1", "grade": "EQUAL"}
    assert ni.tiers(e)[2] is True and ni.member_sentence(e, {}).endswith("and equal to TradingView's own on captured charts.")
    e["evidence"]["capture"] = {"id": "cap-1", "grade": "EQUAL AFTER WARM-UP"}
    assert ni.tiers(e)[2] is True and "after the first bars of captured charts" in ni.member_sentence(e, {})
    # a difference that is explained and not gone, or a divergence, claims nothing about TradingView
    for grade in ("FORMULA EQUAL, RESTART DIFFERS", "DIVERGE", ""):
        e["evidence"]["capture"] = {"id": "cap-1", "grade": grade}
        assert ni.tiers(e)[2] is False and "TradingView" not in ni.member_sentence(e, {}), grade
    e["evidence"]["capture"] = {"id": "", "grade": "EQUAL"}
    assert ni.tiers(e)[2] is False
    # below (a)+(b): not the assistant's to build
    for strip in ("value_check", "published"):
        lower = copy.deepcopy(ENTRIES["chandelier_exit"])
        lower["evidence"][strip] = None
        assert not ni.passes(lower), strip
    nameless = copy.deepcopy(ENTRIES["chandelier_exit"])
    nameless["evidence"]["published"]["url"] = ""
    assert not ni.passes(nameless)


def test_no_sentence_is_longer_than_an_assumption_may_be(conv):
    limit = json.loads(conv._raw_schema_text())["x-uct-limits"]["maxTextLength"]
    for e in ni.entries():
        captured = copy.deepcopy(e)
        captured["evidence"]["capture"] = {"id": "x", "grade": "EQUAL AFTER WARM-UP"}
        widest = {p["key"]: float(p["max"]) - (0.25 if not p["integer"] else 0) for p in e["params"]}
        for variant in (e, captured):
            assert len(ni.member_sentence(variant, widest)) <= limit, (e["id"], len(ni.member_sentence(variant, widest)))
    assert ni.SENTENCE_MAX == limit
    # when the numbers would not fit, the evidence is what stays
    long = copy.deepcopy(ENTRIES["squeeze_momentum"])
    long["evidence"]["published"]["by"] = "a very long attribution " * 6
    said = ni.member_sentence(long, {p["key"]: float(p["default"]) for p in long["params"]})
    assert "(bb length" not in said and "checked against an independent calculation" in said


def test_ONE_authority_no_id_and_no_formula_lives_in_two_stores():
    """The Screener's columns (`chart_twins`), UCT's house indicators and this library are three
    stores with three authorities. One id never appears in two, and no library formula is a
    Screener twin restated."""
    house = json.loads((ROOT / "app/src/components/chart/house/houseIndicators.json").read_text(encoding="utf-8"))
    items = house if isinstance(house, list) else house.get("indicators") or house.get("items")
    slugs = {i.get("slug") or i.get("id") for i in items}
    assert slugs and not (set(ENTRIES) & slugs)
    assert not (set(ENTRIES) & set(chart_twins.TWINS))
    twins = [json.dumps(t, sort_keys=True) for t in chart_twins.TWINS.values()]
    for e in ni.entries():
        for o in e["outputs"]:
            assert json.dumps(o["tree"], sort_keys=True) not in twins, (e["id"], o["key"])


def test_formula_text_helpers():
    assert ni.number_text(14) == "14" and ni.number_text(14.0) == "14" and ni.number_text(1.5) == "1.5"
    assert ni.formula_at("sma(close, {n}) * {k}", {"n": 20, "k": 2.0}) == "sma(close, 20) * 2"
    with pytest.raises(ValueError):
        ni.formula_at("sma(close, {n}) * {k}", {"n": 20})
    assert ni.entry("mcginley_dynamic")["name"] == "McGinley Dynamic" and ni.entry("nope") is None
    assert ("mcginley dynamic", "mcginley_dynamic") in ni.phrases()


@needs_node
def test_the_shipped_parser_makes_exactly_these_trees_and_sites_from_the_text():
    """The build tool, asked to change nothing: every tree and site in the file is what the shipped
    parser makes of the text today."""
    proc = subprocess.run([sys.executable, str(ROOT / "tools/named_indicators_build.py"), "--check"],
                          capture_output=True, text=True, cwd=str(ROOT))
    assert proc.returncode == 0, proc.stdout[-1500:] + proc.stderr[-1500:]
    assert "nothing stale" in proc.stdout


@needs_node
def test_the_build_tool_refuses_a_text_change_under_the_same_version_and_a_folded_parameter():
    sys.path.insert(0, str(ROOT / "tools"))
    import named_indicators_build as build
    doc = json.loads(ni.PATH.read_text(encoding="utf-8"))
    moved = copy.deepcopy(doc)
    ao = next(e for e in moved["indicators"] if e["id"] == "awesome_oscillator")
    ao["outputs"][0]["formula"] = ao["outputs"][0]["formula"].replace("(high + low) / 2", "(high + low + close) / 3")
    _built, problems = build.derive(moved)
    assert any("awesome_oscillator" in p and "its maths moved and its version did not" in p for p in problems), problems
    # a NEW version with an empty fingerprint is how a change is made: the tool fills it
    ao["versions"].append({"version": 2, "maths": "", "since": "2026-11-19", "why": "a test"})
    built, problems = build.derive(moved)
    assert problems == []
    assert next(e for e in built["indicators"] if e["id"] == "awesome_oscillator")["versions"][-1]["maths"].startswith("sha256:")
    # a parameter the formula never uses is a problem, by name
    unused = copy.deepcopy(doc)
    next(e for e in unused["indicators"] if e["id"] == "elder_ray")["params"].append(
        {"key": "ghost", "label": "Ghost", "default": 3, "min": 1, "max": 9, "integer": True})
    _built, problems = build.derive(unused)
    assert any("elder_ray" in p and "ghost" in p for p in problems), problems
    # and the file itself is clean
    assert build.derive(doc)[1] == []


# ═══ 2. does a tree hold it? ═════════════════════════════════════════════════

MCG = ENTRIES["mcginley_dynamic"]
MCG_OUT = MCG["outputs"][0]


def test_the_formula_itself_is_held_and_its_numbers_come_back():
    assert ni.output_in(MCG_OUT["tree"], MCG, MCG_OUT) == {"length": 14.0}
    assert ni.output_in(tree_of("mcginley_dynamic", length=20), MCG, MCG_OUT) == {"length": 20.0}
    # anywhere inside a larger formula
    above = op(">", S("close"), tree_of("mcginley_dynamic", length=9))
    assert ni.output_in(above, MCG, MCG_OUT) == {"length": 9.0}
    assert ni.held([EMA14, above], MCG) == [(1, "mcginley", {"length": 9.0})]


@pytest.mark.parametrize("change, why", [
    (lambda t: EMA14, "another indicator altogether"),
    (lambda t: t["args"][1]["args"][1]["args"][1]["args"][1]["args"].__setitem__(1, num(3)) or t, "a number that is no parameter (the 4th power)"),
    (lambda t: t["args"].__setitem__(2, num(200)) or t, "a number that is no parameter (the window)"),
    (lambda t: t["args"].__setitem__(0, S("open")) or t, "another seed"),
    (lambda t: t["args"][1]["args"].reverse() or t, "the same terms in another order"),
    (lambda t: t.__setitem__("name", "accum2") or t, "another function"),
])
def test_nothing_near_it_counts(change, why):
    tree = copy.deepcopy(MCG_OUT["tree"])
    assert ni.output_in(change(tree), MCG, MCG_OUT) is None, why


@pytest.mark.parametrize("value, why", [
    (1, "under the parameter's minimum"), (5001, "over its maximum"), (14.5, "not a whole number"),
    (True, "not a number"), ("14", "text"), (None, "nothing"),
])
def test_a_parameters_number_must_be_one_it_can_take(value, why):
    assert ni.output_in(tree_of("mcginley_dynamic", length=value), MCG, MCG_OUT) is None, why


def test_one_parameter_is_one_number_at_every_site():
    kama = ENTRIES["kaufman_adaptive_moving_average"]
    o = kama["outputs"][0]
    assert len(o["sites"]["er_length"]) == 2 and len(o["sites"]["slow"]) == 2
    assert ni.output_in(ni.tree_at(o, {"er_length": 14, "slow": 20}), kama, o) == {"er_length": 14.0, "fast": 2.0, "slow": 20.0}
    split = ni.tree_at(o, {})
    node_at(split, o["sites"]["er_length"][0])["value"] = 14               # one site moved, the other left at 10
    assert ni.output_in(split, kama, o) is None
    # one of er_length's sites is a bar offset: a whole number of bars, never a setting
    kinds = sorted(node_at(o["tree"], p)["type"] for p in o["sites"]["er_length"])
    assert kinds == ["num", "offset"]


def test_a_members_own_setting_may_drive_a_parameter_and_only_a_declared_one():
    site = MCG_OUT["sites"]["length"][0]
    by_setting = copy.deepcopy(MCG_OUT["tree"])
    parent = node_at(by_setting, site[:-1])
    parent["args"][site[-1]] = S("length")
    assert ni.output_in(by_setting, MCG, MCG_OUT, inputs=["length"]) == {"length": None}
    assert ni.output_in(by_setting, MCG, MCG_OUT) is None                  # an undeclared name is not a setting
    assert ni.output_in(by_setting, MCG, MCG_OUT, inputs=["period"]) is None
    # a setting may not stand where the formula has no parameter
    elsewhere = copy.deepcopy(MCG_OUT["tree"])
    elsewhere["args"][2] = S("length")
    assert ni.output_in(elsewhere, MCG, MCG_OUT, inputs=["length"]) is None


def test_every_entry_holds_itself_and_no_other_entry():
    for e in ni.entries():
        trees = [o["tree"] for o in e["outputs"]]
        found = ni.held(trees, e)
        assert {k for _i, k, _v in found} == {o["key"] for o in e["outputs"]}, e["id"]
        # each tree holds its OWN output (one line's formula may also sit inside another's: Stochastic RSI's K in its D)
        assert all((i, o["key"]) in {(i_, k) for i_, k, _v in found} for i, o in enumerate(e["outputs"])), e["id"]
        for other in ni.entries():
            if other["id"] != e["id"]:
                assert ni.held(trees, other) == [], (e["id"], other["id"])


# ═══ 3. the door ═════════════════════════════════════════════════════════════

CHART = {"symbol": "NVDA", "timeframe": "D"}


def test_every_alias_reaches_its_entry_however_it_is_capitalised(conv):
    built = {e["id"] for e in ni.entries()}                      # (held names: tests/test_named_indicators_held.py)
    for phrase, entry_id in ni.phrases():
        if entry_id not in built:
            continue
        for words in (phrase, phrase.title(), phrase.upper()):
            got = conv.understand_turn(f"add the {words}", CHART)
            assert got["refusal"] is None, (words, got["refusal"])
            assert [e["id"] for e in got["named"]] == [entry_id], words


def test_an_unknown_title_case_name_is_refused_before_any_call_as_before(conv, clean_env, model):
    client = model([])
    r = conv.converse("Add the Gann Fan", user_id="u1", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == "concept:ungrounded" and client.calls == []
    assert r["not_understood"][0]["phrase"] == "Gann Fan"


def test_every_entry_passes_the_door_as_the_assistant_would_write_it(conv):
    for e in ni.entries():
        assert conv.check_envelope(env(0, [create(e["id"])]), 0, empty_view(0)), e["id"]


def test_the_assistant_is_handed_the_formula_as_data(conv):
    got = conv.understand_turn("Add the McGinley Dynamic", CHART)
    (term,) = got["notes"]["matched_terms"]
    assert term["wrote"] == "McGinley Dynamic" and term["named_indicator"] == "McGinley Dynamic"
    assert term["placement"] == "overlay" and term["rule"] == conv.NAMED_RULE
    (o,) = term["outputs"]
    assert o["tree"] == MCG_OUT["tree"] and o["label"] == "McGinley Dynamic" and o["type"] == "value"
    assert o["formula"] == "accum(close, self + (close - self) / (14 * pow(close / self, 4)), 300)"
    assert term["numbers"] == [{"name": "Length", "in_the_formula": "14", "min": 2, "max": 5000, "whole_number": True}]
    # the whole turn stays well inside what one turn may carry, for the largest entry too
    biggest = conv.understand_turn("Add the Squeeze Momentum Indicator", CHART)
    assert len(json.dumps(biggest["notes"])) < conv.MAX_INPUT_CHARS // 4


def test_the_named_indicator_is_built_in_one_call_and_the_door_says_what_it_built(conv, clean_env, model):
    client = model([emits(env(0, [create("mcginley_dynamic")], reply="Added the McGinley Dynamic."))])
    r = conv.converse("Add the McGinley Dynamic", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1
    first, second = r["envelope"]["assumptions"]
    assert first == {"output": "mcginley", "text": ni.member_sentence(MCG, {"length": 14.0})}
    assert "published by John R. McGinley" in first["text"] and "(length 14)" in first["text"]
    assert "TradingView" not in first["text"]                              # its restart is not bar-equal: no claim
    assert "bars back on every bar" in second["text"]                      # the running value's own note, after it
    sent = client.calls[0]["messages"][0]["content"]
    assert '"named_indicator": "McGinley Dynamic"' in json.dumps(sent) or "named_indicator" in str(sent)
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))            # what the door returns still passes the door


def test_the_members_own_number_is_built_and_said(conv, clean_env, model):
    model([emits(env(0, [create("chandelier_exit", {"multiplier": 2.5})]))])
    r = conv.converse("Chandelier Exit with an ATR multiplier of 2.5", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 1
    said = {a["output"]: a["text"] for a in r["envelope"]["assumptions"]}
    # said ONCE for the indicator (on its first output), not once per output
    assert set(said) == {"long"} and "atr multiplier 2.5" in said["long"]


def test_NEVER_APPROXIMATED_a_substitute_is_refused_twice_and_nothing_is_built(conv, clean_env, model):
    """The failure the unknown-name rule was written for, found live: asked for the McGinley
    Dynamic, a model returned an exponential average and reported success."""
    wrong = env(0, [{"op": "create", "name": "McGinley Dynamic", "placement": "price", "outputs": [{"key": "md", "tree": EMA14}]}],
                reply="Added the McGinley Dynamic.")
    client = model([emits(wrong), emits(wrong)])
    r = conv.converse("Add the McGinley Dynamic", user_id="u1", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == GATE and "envelope" not in r and len(client.calls) == 2
    assert "McGinley Dynamic" in r["reason"] and "checked formula" in r["reason"]
    assert "accum" not in r["reason"] and "tree" not in r["reason"]        # a member's words
    told = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert "[named:formula]" in told and "ONE checked formula" in told
    assert "mcginley = accum(close, self + (close - self) / (14 * pow(close / self, 4)), 300)" in told
    assert "Length 14 (2 to 5000)" in told


def test_a_substitute_then_the_formula_is_one_repair(conv, clean_env, model):
    wrong = env(0, [{"op": "create", "name": "KAMA", "placement": "price", "outputs": [{"key": "kama", "tree": EMA14}]}])
    model([emits(wrong), emits(env(0, [create("kaufman_adaptive_moving_average")]))])
    r = conv.converse("add the kaufman adaptive moving average", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["attempts"] == 2 and r["usage"]["repair_gate"] == GATE
    assert any("Kaufman Adaptive Moving Average" in a["text"] for a in r["envelope"]["assumptions"])


@pytest.mark.parametrize("values, why", [({"length": 1}, "under its minimum"), ({"length": 5001}, "over its maximum")])
def test_a_number_the_parameter_cannot_take_is_not_the_formula(conv, clean_env, model, values, why):
    bad = env(0, [create("mcginley_dynamic", values)])
    model([emits(bad), emits(bad)])
    r = conv.converse("Add the McGinley Dynamic", user_id="u1", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == GATE, why


def test_one_of_its_outputs_is_enough_and_each_built_one_is_said(conv, clean_env, model):
    model([emits(env(0, [create("elder_ray", only=["bull"])]))])
    r = conv.converse("show the Elder Ray bull power", user_id="u1", view=empty_view(0))
    assert r["ok"] is True
    assert [a["output"] for a in r["envelope"]["assumptions"] if "Elder Ray" in a["text"]] == ["bull"]


def test_a_later_turn_beside_the_named_indicator_is_not_held_to_it(conv, clean_env, model):
    """The indicator on the chart already holds the checked formula; a turn that names it while
    adding something else is not a substitution."""
    built = view(1, [out("mcginley", MCG_OUT["tree"], type_="value")], name="McGinley Dynamic")
    add = env(1, [{"op": "add_output", "key": "avg", "tree": call("sma", S("close"), num(50))}])
    model([emits(add)])
    r = conv.converse("add a 50 day average beside the McGinley Dynamic", user_id="u1", view=built)
    assert r["ok"] is True and r["attempts"] == 1
    assert not any("McGinley" in a.get("text", "") for a in r["envelope"].get("assumptions") or [])
    # the same patch on a chart that does NOT hold it is the substitution
    bare = view(1, [out("value", call("rsi", S("close"), num(14)), type_="value")])
    model([emits(add), emits(add)])
    r = conv.converse("add the McGinley Dynamic", user_id="u2", view=bare)
    assert r["ok"] is False and r["gate"] == GATE


def test_a_turn_that_brings_no_formula_is_not_held_to_it(conv, clean_env, model):
    built = view(1, [out("mcginley", MCG_OUT["tree"], type_="value")], name="McGinley Dynamic")
    model([emits(env(1, [{"op": "rename_definition", "name": "My McGinley"}]))])
    r = conv.converse("rename the McGinley Dynamic to My McGinley", user_id="u1", view=built)
    assert r.get("gate") != GATE


def test_a_question_about_a_named_indicator_is_answered(conv, clean_env, model):
    client = model([emits(env(0, [], disposition="answer", reply="It speeds up when price moves fast."))])
    r = conv.converse("What is the McGinley Dynamic?", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1


def test_check_named_and_named_notes_directly(conv):
    patch = env(0, [create("vortex_indicator", {"length": 21})])
    vortex = ENTRIES["vortex_indicator"]
    conv.check_named(patch, empty_view(0), [vortex])                       # holds it: no refusal
    conv.check_named(patch, empty_view(0), [])                             # nothing named: nothing to hold
    with pytest.raises(conv._Refused) as exc:
        conv.check_named(patch, empty_view(0), [MCG])
    assert exc.value.gate == GATE
    notes = conv.named_notes(patch, empty_view(0), [vortex])
    # ONE sentence for the indicator, on its first output (it was one per output: the same words twice)
    assert [n["output"] for n in notes] == ["plus"] and "(length 21)" in notes[0]["text"]
    # ... and two when the two outputs were built with different numbers, because the sentences differ
    uneven = env(0, [create("vortex_indicator", {"length": 21})])
    plus, minus = uneven["ops"][0]["outputs"]
    minus["tree"] = create("vortex_indicator", {"length": 9})["outputs"][1]["tree"]
    two = conv.named_notes(uneven, empty_view(0), [vortex])
    assert [n["output"] for n in two] == ["plus", "minus"] and "(length 21)" in two[0]["text"] and "(length 9)" in two[1]["text"]
    assert conv.named_notes(patch, empty_view(0), []) == [] and conv.named_notes(patch, empty_view(0), [MCG]) == []
    # the door's notes come first, are not repeated, and respect the contract's limit
    merged = conv._with_door_notes({**patch, "assumptions": [{"text": "mine"}]}, notes)
    # (each of the door's own notes is marked as the door's: `tests/test_note_by.py`)
    assert merged["assumptions"] == [{**n, "by": "uct"} for n in notes] + [{"text": "mine"}] and len(notes) == 1
    assert conv._with_door_notes(merged, notes)["assumptions"] == merged["assumptions"]
    full = {**patch, "assumptions": [{"text": f"a{i}"} for i in range(conv.MAX_ASSUMPTIONS)]}
    assert len(conv._with_door_notes(full, notes)["assumptions"]) == conv.MAX_ASSUMPTIONS
    assert conv._with_door_notes(patch, []) is patch


# ── a name whose formula is not checked yet ──────────────────────────────────

@pytest.fixture
def with_an_unchecked_entry(conv, monkeypatch):
    """The library plus one entry that has a published definition and NO value check."""
    doc = copy.deepcopy(ni.library())
    raw = copy.deepcopy(ENTRIES["awesome_oscillator"])
    raw.update(id="zeta_wave", name="Zeta Wave", aliases=["zeta wave", "zeta wave oscillator"])
    raw["evidence"]["value_check"] = None
    doc["indicators"].append(raw)
    monkeypatch.setattr(ni, "library", lambda: doc)
    monkeypatch.setattr(conv, "CHART_LEXICON", conv._chart_lexicon(conv.dc.LEXICON))
    return raw


def test_a_name_not_checked_yet_is_refused_by_name_before_any_call(conv, clean_env, model, with_an_unchecked_entry):
    client = model([])
    r = conv.converse("Add the Zeta Wave", user_id="u1", view=empty_view(0))
    assert r["ok"] is False and r["gate"] == "named:unchecked" and client.calls == []
    assert r["reason"].startswith("Zeta Wave isn't in UCT's checked library yet.") and "in your own words" in r["reason"]
    client = model([])
    assert conv.converse("add the zeta wave oscillator in a pane", user_id="u2", view=empty_view(0))["gate"] == "named:unchecked"
    assert client.calls == []
    # the checked ones beside it are untouched
    model([emits(env(0, [create("awesome_oscillator")]))])
    assert conv.converse("Add the Awesome Oscillator", user_id="u3", view=empty_view(0))["ok"] is True


def test_a_question_about_it_is_discussed_and_can_never_come_back_as_a_change(conv, clean_env, model, with_an_unchecked_entry):
    client = model([emits(env(0, [], disposition="answer", reply="It is not checked yet."))])
    r = conv.converse("What is the Zeta Wave?", user_id="u1", view=empty_view(0))
    assert r["ok"] is True and len(client.calls) == 1
    sent = json.dumps(client.calls[0]["messages"][0]["content"])
    assert "NOT CHECKED YET" in sent and "sma" not in sent.split("Zeta Wave")[-1][:400]   # the rule, and no formula
    model([emits(env(0, [create("awesome_oscillator")], disposition="change", reply="Done."))])
    r = conv.converse("What is the Zeta Wave?", user_id="u2", view=empty_view(0))
    assert r["ok"] is False and r.get("backstop") is True and "envelope" not in r


def test_CONTROL_the_same_words_without_the_entry_are_the_unknown_name_rule(conv, clean_env, model):
    client = model([])
    r = conv.converse("Add the Zeta Wave", user_id="u1", view=empty_view(0))
    assert r["gate"] == "concept:ungrounded" and client.calls == []


# ── a parameter's range is what the MATHS allows, not a round cap (ruling 2026-11-18) ──

def test_a_parameters_range_is_its_validity_range_and_nothing_tighter():
    """The formula is what is checked, not each value: any value the maths can take is still UCT's
    checked formula. A count of bars may be as long as the chart's own history window (a longer
    one can never have a value); the Bollinger multiplier keeps TradingView's own input limits; a
    multiplier TradingView leaves unlimited needs only to be positive."""
    from api.services.bars_window import HISTORY_WINDOW_BARS
    assert HISTORY_WINDOW_BARS == 5000
    floats = {}
    for e in ni.entries():
        for p in e["params"]:
            if p["integer"] and p["key"] != "divisor":
                assert p["max"] == HISTORY_WINDOW_BARS and 1 <= p["min"] <= 3, (e["id"], p["key"])
            elif p["integer"]:
                assert (e["id"], p["key"], p["min"]) == ("ease_of_movement", "divisor", 1)
            else:
                floats[(e["id"], p["key"])] = (p["min"], p["max"])
    # (the Laguerre pair's gamma is a share each stage keeps: above 0, and at most the largest
    # gamma whose filter settles within the bars a chart formula may reach)
    assert floats == {("squeeze_momentum", "bb_mult"): (0.001, 50), ("squeeze_momentum", "kc_mult"): (0.001, 1000),
                      ("chandelier_exit", "multiplier"): (0.001, 1000),
                      ("laguerre_filter", "gamma"): (0.01, 0.95), ("laguerre_rsi", "gamma"): (0.01, 0.95)}
    # so a long length is still the checked indicator (it was refused over 400)
    kama = ENTRIES["kaufman_adaptive_moving_average"]
    tree = create("kaufman_adaptive_moving_average", {"slow": 1200})["outputs"][0]["tree"]
    assert ni.output_in(tree, kama, kama["outputs"][0])["slow"] == 1200.0


def test_every_output_says_what_it_is_in_one_phrase():
    """The read-back of a library indicator says this phrase, not the formula in words."""
    seen = set()
    for e in ni.entries():
        for o in e["outputs"]:
            says = o.get("says")
            assert isinstance(says, str) and 20 <= len(says) <= 120, (e["id"], o["key"], says)
            assert says == says.strip() and not says.endswith(".") and len(says.splitlines()) == 1, (e["id"], o["key"])
            assert says not in seen, ("two outputs say the same thing", says)
            seen.add(says)
    assert ENTRIES["on_balance_volume"]["outputs"][0]["says"] == (
        "a running total of volume, added on up closes and subtracted on down closes")
