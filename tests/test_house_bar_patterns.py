"""INSIDE DAY AND OUTSIDE DAY MEAN ONE THING EACH: what UCT's own readers say (coordinator's ruling
2026-11-18).

The defect: one phrase came back as different formulas on different turns (strictly inside, or a
touch allowed). Nothing told the assistant which, so it chose. The product already has readers for
both, so the word on a
chart is theirs:

  * INSIDE DAY / INSIDE BAR: the Screener's member-facing "Inside-Bar Run"
    (``screener/candles.py::multi_candle``). INCLUSIVE: the high at or under the high before and the
    low at or over the low before, on a bar that traded: a bar with no range, or with no volume,
    ends the run there and is not an inside bar. The formula is true on exactly the bars where
    that run is 1 or more.
  * OUTSIDE DAY / OUTSIDE BAR: the range test of UCT's outside-bar detector
    (``pattern_engine/detectors/classical/outside_bar.py``). STRICT: the high above the high before
    and the low under the low before. That detector goes on to ask for more (volume against the
    bar before, enough history); the WORD is its range test. So the proof here is one-way plus the
    ties: wherever the detector fires the formula is true, and a bar that only touches is not one.

⛔ ONE AUTHORITY EACH. The readers are imported and run; nothing here restates the inside rule.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import pytest

from api.services import ast_interpret
from api.services import chart_twins
from api.services.pattern_engine.detectors.classical import outside_bar
from api.services.pattern_engine.detectors.uct import uct_inside_day
from api.services.screener import candles
from tests.test_house_indicators_values import _walk
from tests.test_p2_truth_server import conv  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
INSIDE, OUTSIDE = chart_twins.PATTERNS["inside_day"], chart_twins.PATTERNS["outside_day"]


def fires(tree, bars):
    return [v is True or v == 1 for v in ast_interpret.interpret(tree, bars, {})]


def screener_inside(bars):
    """The Screener's own answer on every bar: is its inside-bar run 1 or more as of that bar?"""
    return [candles.multi_candle(bars[:t + 1])["inside_bar_run"] >= 1 for t in range(len(bars))]


def bar(o, h, l, c, v=1_000_000.0):
    return {"t": "d", "o": float(o), "h": float(h), "l": float(l), "c": float(c), "v": float(v)}


def after(first, second):
    """Two bars, as the newest two of a short history."""
    return [bar(10, 12, 8, 10), bar(10, 12, 8, 10), first, second]


WIDE = bar(10, 12, 8, 11)

INSIDE_CASES = {
    "strictly inside": (after(WIDE, bar(10, 11, 9, 10)), True),
    "the high equal to the high before": (after(WIDE, bar(10, 12, 9, 10)), True),
    "the low equal to the low before": (after(WIDE, bar(10, 11, 8, 10)), True),
    "both equal: the same bar again": (after(WIDE, bar(10, 12, 8, 10)), True),
    "the high one tick above": (after(WIDE, bar(10, 12.01, 9, 10)), False),
    "the low one tick under": (after(WIDE, bar(10, 11, 7.99, 10)), False),
    "a bar with no range, inside": (after(WIDE, bar(10, 10, 10, 10)), False),
    "a bar with no volume, inside": (after(WIDE, bar(10, 11, 9, 10, v=0)), False),
    "an outside bar": (after(WIDE, bar(10, 13, 7, 10)), False),
}

OUTSIDE_CASES = {
    "strictly outside": (after(WIDE, bar(10, 13, 7, 10)), True),
    "the high equal to the high before": (after(WIDE, bar(10, 12, 7, 10)), False),
    "the low equal to the low before": (after(WIDE, bar(10, 13, 8, 10)), False),
    "both equal": (after(WIDE, bar(10, 12, 8, 10)), False),
    "only a higher high": (after(WIDE, bar(10, 13, 9, 10)), False),
    "only a lower low": (after(WIDE, bar(10, 11, 7, 10)), False),
    "an inside bar": (after(WIDE, bar(10, 11, 9, 10)), False),
}


# ═══ 1. inside day: equal to the Screener's reader on every bar ══════════

@pytest.mark.parametrize("seed", [11, 29, 5, 77])
def test_inside_day_equals_the_screeners_inside_bar_run_on_every_bar_of_a_walk(seed):
    bars = _walk(seed, n=500)
    got, want = fires(INSIDE, bars), screener_inside(bars)
    assert [t for t in range(len(bars)) if got[t] != want[t]] == []
    assert sum(want) >= 10                                                # a walk the reader never fires on proves nothing


@pytest.mark.parametrize("name", sorted(INSIDE_CASES))
def test_inside_day_on_each_tie(name):
    bars, want = INSIDE_CASES[name]
    assert screener_inside(bars)[-1] is want, "the case is not what its name says"
    assert fires(INSIDE, bars)[-1] is want
    assert fires(INSIDE, bars) == screener_inside(bars)


def test_inside_day_is_the_inside_day_detectors_range_test_on_a_bar_that_traded():
    """The UCT Inside Day detector's own `_inside` is the same inclusive test; the Screener adds
    "a bar that traded". Where a bar has a range and volume, all three agree."""
    bars = _walk(29, n=500)
    got = fires(INSIDE, bars)
    for k in range(1, len(bars)):
        traded = bars[k]["h"] > bars[k]["l"] and bars[k]["v"] > 0
        assert got[k] == (uct_inside_day._inside(bars, k) and traded), k


def test_CONTROL_the_strict_reading_is_not_the_screeners():
    """The other formula the assistant wrote that day: strictly inside. It parts from the reader on
    a touch, which is why the word needed one meaning."""
    strict = chart_twins._op("&&", chart_twins._op("<", chart_twins._s("high"), chart_twins._ago(chart_twins._s("high"), 1)),
                             chart_twins._op(">", chart_twins._s("low"), chart_twins._ago(chart_twins._s("low"), 1)))
    bars, _want = INSIDE_CASES["the high equal to the high before"]
    assert fires(strict, bars)[-1] is False and screener_inside(bars)[-1] is True


@pytest.mark.parametrize("drop", range(4))
def test_CONTROL_every_condition_of_the_inside_formula_is_exercised(drop):
    """Four conditions joined by "and". With any one removed it disagrees with the Screener on
    some case of the set."""
    parts = _conjuncts(INSIDE)
    assert len(parts) == 4
    without = _all_of(parts[:drop] + parts[drop + 1:])
    assert any(fires(without, bars) != screener_inside(bars) for bars, _w in INSIDE_CASES.values()), drop


# ═══ 2. outside day: the detector's range test, with the ties ════════════

@pytest.mark.parametrize("name", sorted(OUTSIDE_CASES))
def test_outside_day_on_each_tie(name):
    bars, want = OUTSIDE_CASES[name]
    assert fires(OUTSIDE, bars)[-1] is want


@pytest.mark.parametrize("seed", [11, 29, 5])
def test_wherever_the_outside_bar_detector_fires_the_formula_is_true(seed):
    bars = _walk(seed, n=500)
    got = fires(OUTSIDE, bars)
    stamped = [{**b, "t": 1_700_000_000 + 86_400 * i} for i, b in enumerate(bars)]      # the detector reads a timestamp
    fired = [t for t in range(60, len(bars)) if outside_bar.detect_outside_bar(stamped[:t + 1], {})]
    assert fired, "the detector never fired on this walk: nothing was compared"
    assert [t for t in fired if not got[t]] == []
    # and the formula alone is exactly "higher high and lower low" on every bar
    for t in range(1, len(bars)):
        assert got[t] == (bars[t]["h"] > bars[t - 1]["h"] and bars[t]["l"] < bars[t - 1]["l"]), t


def _history_ending(high_over, low_under):
    """A real walk whose newest bar sits `high_over` above the high before and `low_under` under the
    low before, on three times the volume, stamped the way the detector reads bars."""
    bars = [{**x, "t": 1_700_000_000 + 86_400 * i} for i, x in enumerate(_walk(11, n=120))]
    prev = bars[-2]
    last = dict(bars[-1], h=prev["h"] + high_over, l=prev["l"] - low_under, v=prev["v"] * 3.0)
    last["c"] = last["h"] - (last["h"] - last["l"]) * 0.1
    last["o"] = last["l"] + (last["h"] - last["l"]) * 0.1
    return bars[:-1] + [last]


@pytest.mark.parametrize("high_over,low_under,want", [
    (0.5, 0.5, True),            # strictly outside: the detector fires
    (0.0, 0.5, False),           # the high only EQUAL to the high before: the detector does not
    (0.5, 0.0, False),           # the low only equal
    (0.0, 0.0, False),
])
def test_the_detector_itself_treats_a_touch_as_not_outside_and_so_does_the_formula(high_over, low_under, want):
    bars = _history_ending(high_over, low_under)
    assert bool(outside_bar.detect_outside_bar(bars, {})) is want, "the detector's own answer on this bar"
    assert fires(OUTSIDE, bars)[-1] is want


def test_a_pattern_phrase_never_takes_a_phrase_that_already_means_something(conv, monkeypatch):
    """ADDED, NEVER REPLACED: a pattern takes a bucket only when every row in it says "not
    available". Given a phrase that is already the RSI's own name, it does not displace it."""
    spoken = dict(chart_twins.PATTERN_SPOKEN)
    spoken["inside_day"] = spoken["inside_day"] + ("relative strength index",)
    stems, _cost = conv.dc._stem_key(conv.dc._form_tokens("relative strength index"))
    before = conv.CHART_LEXICON["index"][stems]
    assert not all(r["kind"] == conv.dc.EXCLUDED_ENTRY for r in before)
    monkeypatch.setattr(chart_twins, "PATTERN_SPOKEN", spoken)
    rebuilt = conv._chart_lexicon(conv.dc.LEXICON)
    assert rebuilt["index"][stems] == before                              # still the RSI
    inside, _cost = conv.dc._stem_key(conv.dc._form_tokens("inside day"))
    assert [r["key"] for r in rebuilt["index"][inside]] == ["inside_day"]   # and the pattern's own phrase still is


def test_an_inside_bar_is_never_an_outside_bar():
    bars = _walk(5, n=500)
    assert not any(a and b for a, b in zip(fires(INSIDE, bars), fires(OUTSIDE, bars)))


# ═══ 3. the door hands the assistant the house formula ═══════════════════

@pytest.mark.parametrize("words,key", [
    ("Mark inside days", "inside_day"), ("mark every inside bar", "inside_day"), ("highlight inside candles", "inside_day"),
    ("Mark inside days that come right after a new 20 day high", "inside_day"),
    ("Mark outside days", "outside_day"), ("mark outside bars that close in the top quarter of their range", "outside_day"),
])
def test_the_word_reaches_the_assistant_with_the_house_formula(conv, words, key):
    got = conv.understand_turn(words, CHART)
    assert got["refusal"] is None, words
    terms = {t["entry"]: t for t in got["notes"]["matched_terms"]}
    assert key in terms, (words, list(terms))
    assert terms[key]["chart_formula"] == conv.dc.formula_for(chart_twins.PATTERNS[key])
    assert terms[key]["rule"].startswith("the firm's meaning of this term on a chart: use this formula")


@pytest.mark.parametrize("words", ["Mark days inside the Bollinger Bands", "price outside the Keltner channel", "an inside joke"])
def test_other_uses_of_the_words_are_untouched(conv, words):
    got = conv.understand_turn(words, CHART)
    assert not ({"inside_day", "outside_day"} & {t.get("entry") for t in (got.get("notes") or {}).get("matched_terms") or []}), words


def test_the_patterns_use_only_names_of_the_closed_table():
    from api.services import ast_lint
    table = ast_lint.load_table()
    known = set(table.get("series") or {}) | set(table.get("functions") or {})

    def names(node):
        if isinstance(node, dict):
            if node.get("type") in ("series", "call"):
                yield node["name"]
            for a in node.get("args") or []:
                yield from names(a)
    for key, tree in chart_twins.PATTERNS.items():
        assert not (set(names(tree)) - known), key
    assert set(chart_twins.PATTERN_SPOKEN) == set(chart_twins.PATTERNS)
    assert not (set(chart_twins.PATTERNS) & set(chart_twins.TWINS))


def _conjuncts(tree):
    if isinstance(tree, dict) and tree.get("type") == "op" and tree.get("name") == "&&":
        return [c for arg in tree["args"] for c in _conjuncts(arg)]
    return [tree]


def _all_of(parts):
    tree = parts[0]
    for p in parts[1:]:
        tree = {"type": "op", "name": "&&", "args": [tree, p]}
    return tree
