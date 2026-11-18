"""THE NAMED-INDICATOR LIBRARY, slice 3 (2026-11-18): twelve classics asked for by name.

They were chosen by measurement: of 140 well-known indicator names put to the door, these were
refused by name or left to the assistant's own recollection although their definitions are
published and their arithmetic is within the engine. Each entry's values are proved in
`tests/test_named_indicators_values.py`; this file holds what is particular to the slice:

* each name now reaches its entry at the door, with no model call spent on finding out;
* what the published pages do NOT state is settled by a check here, never assumed (which of two
  equal highs Aroon counts; that a running total has no parameter and says so truthfully);
* one spelling, one indicator: "triple exponential average" is TRIX's formal name and no longer
  reaches the Triple Exponential Moving Average;
* no reference calculation accepts another output's formula (the value checks can tell them apart).
"""
from __future__ import annotations

import math

import pytest

from api.services import ast_interpret, call_expansions
from api.services import named_indicators as ni
from tests import test_named_indicators_values as values
from tests.test_house_indicators_values import _walk
from tests.test_named_indicators import create
from tests.test_p2_truth_server import conv, emits, empty_view, env, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
SLICE3 = ("aroon", "directional_movement_index", "on_balance_volume", "accumulation_distribution_line",
          "price_volume_trend", "percentage_price_oscillator", "know_sure_thing", "mass_index", "force_index",
          "ease_of_movement", "negative_volume_index", "ulcer_index")
RUNNING_TOTALS = ("on_balance_volume", "accumulation_distribution_line", "price_volume_trend")
ENTRIES = {e["id"]: e for e in ni.entries()}


def engine(tree, bars):
    return ast_interpret.interpret(call_expansions.expand_calls(tree), bars)


# ═══ 1. the entries ══════════════════════════════════════════════════════════

def test_the_slice_is_in_the_library_checked_and_cited():
    for entry_id in SLICE3:
        e = ENTRIES[entry_id]
        assert ni.passes(e), entry_id
        published = e["evidence"]["published"]
        assert published["by"] and published["says"] and published["read"] == "2026-11-18", entry_id
        assert all(s["url"].startswith(("https://chartschool.stockcharts.com/", "https://www.tradingview.com/support/"))
                   for s in published["sources"]), entry_id
        assert e["evidence"]["capture"] is None, entry_id        # no claim about any vendor's chart until one is graded
        assert e["placement"] == "pane", entry_id


@pytest.mark.parametrize("entry_id", SLICE3)
def test_each_name_reaches_its_entry_at_the_door_with_no_call(conv, entry_id):
    e = ENTRIES[entry_id]
    for words in (f"Add the {e['name']}", f"add the {e['name'].lower()} in a lower pane"):
        r = conv.understand_turn(words, CHART)
        assert r["refusal"] is None, (words, r["refusal"])
        assert [n["id"] for n in r["named"]] == [entry_id], words


def test_the_aroon_oscillator_is_an_output_of_aroon_and_enough_by_itself(conv, clean_env, model):
    r = conv.understand_turn("Add the Aroon Oscillator", CHART)
    assert [n["id"] for n in r["named"]] == ["aroon"]
    client = model([emits(env(0, [create("aroon", only=["oscillator"])]))])
    r = conv.converse("Add the Aroon Oscillator", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1
    said = r["envelope"]["assumptions"][0]["text"]
    assert said == ni.member_sentence(ENTRIES["aroon"], {"length": 25.0}) and "Tushar Chande" in said


def test_a_running_total_is_built_in_one_call_and_its_sentence_has_no_empty_brackets(conv, clean_env, model):
    for entry_id in RUNNING_TOTALS:
        e = ENTRIES[entry_id]
        assert e["params"] == [] and all(not o["sites"] for o in e["outputs"]), entry_id
        client = model([emits(env(0, [create(entry_id)]))])
        r = conv.converse(f"Add the {e['name']}", user_id="u1", view=empty_view(0), chart=CHART)
        assert r["ok"] is True and r["attempts"] == 1 and len(client.calls) == 1, (entry_id, r.get("gate"))
        said = r["envelope"]["assumptions"][0]["text"]
        assert said == ni.member_sentence(e, {}) and "()" not in said and said.startswith(
            f"Built to UCT's checked formula for {e['name']}: "), said


def test_something_near_a_running_total_is_not_it(conv, clean_env, model):
    """On Balance Volume adds the whole volume; a patch that adds half of it is refused twice and
    ends in a refusal, never in something near it."""
    half = create("on_balance_volume")
    tree = half["outputs"][0]["tree"]
    text = repr(tree)
    assert "'cum'" in text
    wrong = {"op": "create", "name": "On Balance Volume", "placement": "pane",
             "outputs": [{"key": "obv", "tree": {"type": "call", "name": "cum", "args": [
                 {"type": "op", "name": "*", "args": [tree["args"][0], {"type": "num", "value": 0.5}]}]}}]}
    client = model([emits(env(0, [wrong])), emits(env(0, [wrong]))])
    r = conv.converse("Add the On Balance Volume", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "named:formula" and len(client.calls) == 2


# ═══ 2. what the pages do not state, settled by a check ══════════════════════

def test_aroon_counts_the_MOST_RECENT_of_two_equal_extremes():
    """The published formula does not say. Two bars are given the same highest high, and two the
    same lowest low, inside one 26-bar window; the entry's own trees answer for the later bar."""
    bars = _walk(11, n=60)
    top = max(b["h"] for b in bars[30:60]) + 5
    low = min(b["l"] for b in bars[30:60]) - 5
    for i in (50, 56):
        bars[i]["h"] = top
    for i in (52, 57):
        bars[i]["l"] = low
    up, down, oscillator = (engine(o["tree"], bars) for o in ENTRIES["aroon"]["outputs"])
    assert up[59] == (25 - 3) / 25 * 100 != (25 - 9) / 25 * 100          # bar 56, not bar 50
    assert down[59] == (25 - 2) / 25 * 100 != (25 - 7) / 25 * 100        # bar 57, not bar 52
    assert oscillator[59] == up[59] - down[59]
    # and the independent calculation says the same of these bars
    assert values.aroon_up(bars)[59] == up[59] and values.aroon_down(bars)[59] == down[59]


def test_aroons_window_is_this_bar_and_the_n_before_it():
    """N + 1 bars: a high set exactly N bars ago still counts, and reads 0."""
    bars = _walk(29, n=60)
    top = max(b["h"] for b in bars) + 5
    bars[59 - 25]["h"] = top
    up = engine(ENTRIES["aroon"]["outputs"][0]["tree"], bars)
    assert up[59] == 0.0
    bars[59 - 25]["h"] = bars[59 - 25]["l"]                               # take it away: no longer the high
    assert engine(ENTRIES["aroon"]["outputs"][0]["tree"], bars)[59] > 0.0


def test_a_running_total_starts_at_the_first_bar_of_the_history_it_is_given():
    """So its LEVEL depends on where the loaded history starts, as the published page says of On
    Balance Volume; its bar-to-bar CHANGES do not."""
    bars = _walk(11, n=400)
    for entry_id in RUNNING_TOTALS + ("negative_volume_index",):
        tree = ENTRIES[entry_id]["outputs"][0]["tree"]
        whole, later = engine(tree, bars), engine(tree, bars[100:])
        steps_whole = [whole[i] - whole[i - 1] for i in range(250, 400)]
        steps_later = [later[i - 100] - later[i - 101] for i in range(250, 400)]
        assert all(math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-6) for a, b in zip(steps_whole, steps_later)), entry_id
        assert not math.isclose(whole[399], later[299], rel_tol=1e-6), entry_id       # the level did move
    assert engine(ENTRIES["negative_volume_index"]["outputs"][0]["tree"], bars)[0] == 1000.0


def test_the_equal_cases_each_page_leaves_open_or_states_in_passing():
    """Random bars never repeat a close, a volume or a price range, so these rules are put to the
    engine on bars made to: an unchanged close, a bar with no range, unchanged volume, no volume."""
    bars = _walk(11, n=140)
    bars[80]["c"] = bars[79]["c"]                                         # an unchanged close
    bars[90]["h"] = bars[90]["l"] = bars[90]["c"] = bars[90]["o"]         # a bar with no range
    bars[100]["v"] = bars[99]["v"]                                        # unchanged volume
    bars[110]["v"] = 0.0                                                  # no volume

    def line(entry_id, key=None):
        o = next(o for o in ENTRIES[entry_id]["outputs"] if key is None or o["key"] == key)
        return engine(o["tree"], bars), values.REFERENCES[entry_id][o["key"]](bars)

    got, want = line("on_balance_volume")
    assert got[80] - got[79] == 0.0                                       # unchanged close: OBV unchanged (the page says so)
    got_adl, want_adl = line("accumulation_distribution_line")
    assert got_adl[90] - got_adl[89] == 0.0                               # no range: counted as 0
    got_nvi, want_nvi = line("negative_volume_index", "nvi")
    assert got_nvi[100] - got_nvi[99] == 0.0                              # volume not LOWER: unchanged
    got_emv, want_emv = line("ease_of_movement")
    for (g, w, name) in ((got, want, "obv"), (got_adl, want_adl, "adl"), (got_nvi, want_nvi, "nvi"), (got_emv, want_emv, "emv")):
        for i in range(60, 140):
            assert values.ok(g[i]) and values.ok(w[i]), (name, i)          # a value on every bar, the odd ones included
            assert math.isclose(g[i], w[i], rel_tol=1e-9, abs_tol=1e-6), (name, i, g[i], w[i])
    # Ease of Movement's two odd bars count as 0 inside the average: without them the average differs
    plain = _walk(11, n=140)
    assert not math.isclose(got_emv[95], engine(ENTRIES["ease_of_movement"]["outputs"][0]["tree"], plain)[95], rel_tol=1e-6)


# ═══ 3. one spelling, one indicator ══════════════════════════════════════════

def test_triple_exponential_average_is_no_longer_a_spelling_of_tema(conv):
    tema = ENTRIES["triple_exponential_moving_average"]
    assert "triple exponential average" not in tema["aliases"]
    assert all("triple exponential average" != alias for alias, _ in ni.phrases())
    r = conv.understand_turn("Add the triple exponential moving average", CHART)
    assert [n["id"] for n in r["named"]] == ["triple_exponential_moving_average"]
    r = conv.understand_turn("add the triple exponential average", CHART)
    assert r["refusal"] is not None or not r.get("named")


def test_the_build_tool_and_the_browser_test_have_a_probe_number_for_every_setting():
    """Each derives an output's parameter sites by parsing it again with a different number per
    setting, from a fixed pool. Know Sure Thing has nine settings; a pool shorter than an entry's
    settings stops the build."""
    import pathlib
    import re
    root = pathlib.Path(__file__).resolve().parents[1]
    most = max(sum(1 for p in e["params"] if p.get("integer")) for e in ni.entries())
    tool = (root / "tools" / "named_indicators_build.py").read_text(encoding="utf-8")
    browser = (root / "app/src/components/chart/engine/ast/namedIndicators.test.js").read_text(encoding="utf-8")
    for text, pattern in ((tool, r"^INT_PROBES = \(([^)]*)\)"), (browser, r"^const INT_PROBES = \[([^\]]*)\]")):
        (pool,) = re.findall(pattern, text, flags=re.M)
        numbers = [n for n in pool.split(",") if n.strip()]
        assert len(numbers) >= most == 9 and len(set(numbers)) == len(numbers)


def test_no_alias_in_the_library_is_another_entrys_or_a_bare_short_acronym():
    seen = {}
    for alias, entry_id in ni.phrases():
        assert alias not in seen or seen[alias] == entry_id, (alias, entry_id, seen[alias])
        seen[alias] = entry_id
        assert not (len(alias) <= 3 and " " not in alias), alias


# ═══ 4. the value checks can tell the outputs apart ═════════════════════════

def test_CONTROL_no_reference_accepts_another_outputs_formula():
    """Every output's tree is evaluated once and held against EVERY reference. Only its own may
    agree. (One reference written loosely enough to accept a neighbour's formula would let a wrong
    library entry pass its value check.)"""
    bars = values._bars(11)
    trees = {(e["id"], o["key"]): engine(o["tree"], bars) for e in ni.entries() for o in e["outputs"]}
    wants = {(entry_id, key): fn(bars) for entry_id, outs in values.REFERENCES.items() for key, fn in outs.items()}
    assert set(trees) == set(wants)
    tail = range(len(bars) - values.SETTLED, len(bars))

    def agree(got, want):
        for i in tail:
            g, w = got[i], want[i]
            if not values.ok(g) or not values.ok(w):
                return False
            g = 1.0 if g is True else 0.0 if g is False else float(g)
            if not math.isclose(g, w, rel_tol=1e-9, abs_tol=1e-9):
                return False
        return True

    for mine, want in wants.items():
        assert agree(trees[mine], want), mine
        accepted = [other for other, got in trees.items() if other != mine and agree(got, want)]
        assert accepted == [], (mine, accepted)
