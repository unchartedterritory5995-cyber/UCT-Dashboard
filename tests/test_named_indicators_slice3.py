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
        assert all(s["url"].startswith(("https://chartschool.stockcharts.com/", "https://www.tradingview.com/support/",
                                        "https://en.wikipedia.org/wiki/", "https://ta-lib.org/"))
                   for s in published["sources"]), entry_id
        assert e["evidence"]["capture"]["id"] == "builtin3-2026-11-18", entry_id      # each was graded (third batch)
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
    for entry_id in RUNNING_TOTALS:
        tree = ENTRIES[entry_id]["outputs"][0]["tree"]
        whole, later = engine(tree, bars), engine(tree, bars[100:])
        steps_whole = [whole[i] - whole[i - 1] for i in range(250, 400)]
        steps_later = [later[i - 100] - later[i - 101] for i in range(250, 400)]
        assert all(math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-6) for a, b in zip(steps_whole, steps_later)), entry_id
        assert not math.isclose(whole[399], later[299], rel_tol=1e-6), entry_id       # the level did move
    # the Negative Volume Index COMPOUNDS from 1000 on the first loaded bar: its level moves with
    # that bar, and its bar-to-bar RATIOS do not
    tree = ENTRIES["negative_volume_index"]["outputs"][0]["tree"]
    whole, later = engine(tree, bars), engine(tree, bars[100:])
    assert whole[0] == 1000.0 and later[0] == 1000.0
    assert all(math.isclose(whole[i] / whole[i - 1], later[i - 100] / later[i - 101], rel_tol=1e-9) for i in range(250, 400))
    assert not math.isclose(whole[399], later[299], rel_tol=1e-6)


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


def test_ease_of_movements_divisor_is_a_setting_and_its_first_version_keeps_its_fingerprint(conv, clean_env, model):
    """Version 1 held ChartSchool's 100,000,000 as a fixed number. The divisor only sets the size of
    the values; TradingView's setting defaults to 10,000, and at that number the entry is equal to
    TradingView's own on every captured bar. So it is a setting, and the default is TradingView's."""
    e = ENTRIES["ease_of_movement"]
    assert [p["key"] for p in e["params"]] == ["length", "divisor"] and ni.defaults(e) == {"length": 14, "divisor": 10000}
    assert [v["version"] for v in e["versions"]] == [1, 2] and e["versions"][0]["maths"] != e["versions"][1]["maths"]
    assert e["versions"][0]["maths"] == "sha256:d7955d5bcf6dcd462a5d5265d0d7e7682e633a2d5554e9ddf90aadb37bf0daea"
    assert "10,000" in e["versions"][1]["why"] and ni.fingerprint(e) == e["versions"][1]["maths"]
    # the same shape at any divisor: 100,000,000 gives exactly 10,000 times the default's values
    bars = _walk(11, n=120)
    o = e["outputs"][0]
    small, big = engine(o["tree"], bars), engine(ni.tree_at(o, {"divisor": 100000000}), bars)
    assert all(math.isclose(b, s * 10000, rel_tol=1e-9, abs_tol=1e-9) for s, b in zip(small[40:], big[40:]))
    # a member's own divisor is built and said
    client = model([emits(env(0, [create("ease_of_movement", {"divisor": 100000000})]))])
    r = conv.converse("Add the Ease of Movement with a divisor of 100000000", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 1
    assert "divisor 100000000" in r["envelope"]["assumptions"][0]["text"]


# ═══ 2b. the rulings of 2026-11-18: two names with two definitions each ══════

def test_the_negative_volume_index_compounds_and_its_first_version_keeps_its_fingerprint():
    e = ENTRIES["negative_volume_index"]
    assert [v["version"] for v in e["versions"]] == [1, 2]
    assert e["versions"][0]["maths"] == "sha256:c01e1334aefef55b9918d791f833678b196d08b3ae5aa47c2f533705c26a59b5"
    assert ni.fingerprint(e) == e["versions"][1]["maths"] != e["versions"][0]["maths"]
    assert "compounds" in e["versions"][1]["why"] and "additive form" in e["evidence"]["published"]["note"]
    # one lower-volume day: prior x (1 + change), not prior + percent
    bars = _walk(11, n=60)
    nvi = engine(e["outputs"][0]["tree"], bars)
    i = next(i for i in range(30, 60) if bars[i]["v"] < bars[i - 1]["v"])
    change = (bars[i]["c"] - bars[i - 1]["c"]) / bars[i - 1]["c"]
    assert math.isclose(nvi[i], nvi[i - 1] * (1 + change), rel_tol=1e-12)
    assert not math.isclose(nvi[i], nvi[i - 1] + 100 * change, rel_tol=1e-9)
    assert ni.tiers(e) == (True, True, True)                                # graded equal on every bar


def test_trix_follows_tradingviews_own_and_the_member_is_told_so_plainly(conv, clean_env, model):
    """Two definitions under one name. The pages read describe a percent change of price;
    TradingView's built-in is 10,000 x the change of a triple EMA of the LOG of price, about a
    hundred times the size. The entry follows what was captured, and says whose form it is."""
    e = ENTRIES["trix"]
    assert ni.follows_a_capture(e) == e["evidence"]["follows"] and e["evidence"]["capture"]["grade"] == "EQUAL"
    said = ni.member_sentence(e, ni.defaults(e))
    assert said == ("Built to UCT's checked formula for TRIX (length 18): it follows TradingView's own TRIX, 10,000 x the "
                    "one-bar change of a triple EMA of the log of price, and is equal to it on captured charts. Some "
                    "references describe a percent change of price, about a hundredth of this size.")
    assert len(said) <= ni.SENTENCE_MAX and "published by" not in said
    client = model([emits(env(0, [create("trix", {"length": 15})]))])
    r = conv.converse("Add TRIX with a length of 15", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is True and len(client.calls) == 1
    assert r["envelope"]["assumptions"][0]["text"] == ni.member_sentence(e, {"length": 15.0})
    # its formal name is ITS spelling now (it was the Triple Exponential Moving Average's by mistake)
    r = conv.understand_turn("add the triple exponential average", CHART)
    assert [n["id"] for n in r["named"]] == ["trix"]
    # the values: about a hundred times a percent change of the triple EMA of price
    bars = _walk(11, n=200)
    got = engine(e["outputs"][0]["tree"], bars)
    c = [b["c"] for b in bars]
    e3 = values.ema(values.ema(values.ema(c, 18), 18), 18)
    percent = 100 * (e3[199] - e3[198]) / e3[198]
    assert 90 < got[199] / percent < 110


def test_only_an_entry_graded_equal_may_say_it_follows_a_capture():
    import copy
    e = copy.deepcopy(ENTRIES["trix"])
    e["evidence"]["capture"]["grade"] = "EQUAL AFTER WARM-UP"
    assert ni.follows_a_capture(e) is None and "published by Jack Hutson" in ni.member_sentence(e, ni.defaults(e))
    e = copy.deepcopy(ENTRIES["trix"])
    e["evidence"]["follows"]["what"] = ""
    assert ni.follows_a_capture(e) is None
    e = copy.deepcopy(ENTRIES["trix"])
    e["evidence"]["capture"] = None
    assert ni.follows_a_capture(e) is None
    # and only one other entry claims it: the Detrended Price Oscillator, whose page describes the
    # centred form while the entry is TradingView's default one (equal on every bar at two lengths)
    assert [x["id"] for x in ni.entries() if ni.follows_a_capture(x)] == ["trix", "detrended_price_oscillator"]
    dpo = ENTRIES["detrended_price_oscillator"]
    said = ni.member_sentence(dpo, ni.defaults(dpo))
    assert "(length 21)" in said and "it follows TradingView's default form" in said and len(said) <= ni.SENTENCE_MAX
    assert "published by" not in said


# ═══ 3. one spelling, one indicator ══════════════════════════════════════════

def test_triple_exponential_average_is_no_longer_a_spelling_of_tema(conv):
    tema = ENTRIES["triple_exponential_moving_average"]
    assert "triple exponential average" not in tema["aliases"]
    assert [entry_id for alias, entry_id in ni.phrases() if alias == "triple exponential average"] == ["trix"]
    r = conv.understand_turn("Add the triple exponential moving average", CHART)
    assert [n["id"] for n in r["named"]] == ["triple_exponential_moving_average"]
    r = conv.understand_turn("add the triple exponential average", CHART)
    assert "triple_exponential_moving_average" not in [n["id"] for n in r.get("named") or []]


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


def test_no_spelling_in_the_library_is_another_entrys_and_no_ALIAS_is_a_bare_short_acronym():
    seen = {}
    for spelling, entry_id in ni.phrases():
        assert spelling not in seen or seen[spelling] == entry_id, (spelling, entry_id, seen[spelling])
        seen[spelling] = entry_id
    # the alias rule is untouched: an acronym is admitted only through an entry's own `acronyms`
    # (tests/test_named_acronyms.py holds each of those to its four conditions)
    for e in ni.entries() + ni.held_names():
        for alias in e["aliases"]:
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
