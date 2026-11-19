"""READINGS UCT HAS RULED (2026-11-19).

A correctness check of built answers (every standard indicator value-checked against a plain
calculation of its published formula; every bespoke rule read against the member's words) found
answers that were right arithmetic on the wrong meaning, each disclosed and each still not what was
asked: a band built from another deviation, a "first in 30 bars" nobody asked for, "more than" read
as "at least", a divergence that was not swing to swing, a silent window. Each got a ruling. This
file pins the rulings: as instructions the assistant is given, and as one house term with a value
test ("a new 52 week high").

No paid calls.
"""
from __future__ import annotations

import pytest

from api.services import chart_twins
from tests.test_house_indicators_values import _walk
from tests.test_p2_truth_server import conv, empty_view  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}


# ═══ 1. the instructions ═════════════════════════════════════════════════

RULED = [
    # (what must be said, what it rules)
    ("A BAND WITH A PUBLISHED CONSTRUCTION IS NEVER REPLACED BY ANOTHER DEVIATION", "VWAP bands / regression channel"),
    ("VWAP's bands are the volume-weighted deviation of price around VWAP since its anchor", "VWAP bands"),
    ("a regression channel's bands are the deviation of price around the regression line", "regression channel"),
    ("say so (unsupported) and offer the line itself", "the decline"),
    ("UCT's built-in Session VWAP in the Indicators list draws them (its Std dev bands setting)", "where the bands are"),
    ('"More than X" and "above X" are STRICT (>); "at least X" and "X or more" are >=', "the boundary"),
    ('"Volume above average" with no length named is volume above its 50-bar simple average', "the house average"),
    ("MARK EVERY BAR the condition is true on", "no unasked first-in-N"),
    ('ONLY when the member says first, new signal, once, or not on every bar', "when first applies"),
    ("A DIVERGENCE between price and an oscillator is read from swing to swing", "divergence"),
    ('Never substitute "price at an N-bar low while the oscillator is above its own"', "divergence substitute"),
    ("N tight closes within X% is every one of the last N closes within X% of the close before it", "tight closes"),
    ("With no percent named use 1.5%, the Screener's own tolerance, and say so", "tight closes default"),
    ("the EMA OF TRUE RANGE over the same length (Pine's ta.kc)", "Keltner wording"),
    ("A correlation between two symbols is of their closes over N bars", "correlation"),
    ('ASK "the highest close over how many bars, or since what date?"', "trailing stop"),
    ("Never pick a window silently", "trailing stop"),
]


@pytest.mark.parametrize("text,what", RULED)
def test_the_assistant_is_told_each_ruling(conv, text, what):
    assert text in conv.system_prompt(), what


def test_the_rulings_sit_in_one_paragraph_after_the_first_time_rule(conv):
    prompt = conv.system_prompt()
    start = prompt.index("READINGS UCT HAS RULED")
    block = prompt[start:prompt.index("\n", start)]
    for text, _ in RULED:
        assert text in block, text
    # the paragraph before it is the one that teaches "first time in N bars" when the member ASKS for it
    assert prompt[:start].rstrip().endswith("the mark repeats on every bar of a run.")


def test_tight_closes_follow_the_screeners_own_reader():
    """The ruling follows UCT's three-weeks-tight reader: each close against the close BEFORE it
    (`pairwise`), which is the measurement that gates there; the span is carried and does not."""
    from api.services.screener import base_catalog as bc
    import inspect
    src = inspect.getsource(bc.three_weeks_tight_qualifies)
    assert 'st["pairwise"] > TWT_MAX_PAIRWISE' in src
    state = inspect.getsource(bc.three_weeks_tight_state)
    assert "abs(closes[i] - closes[i - 1]) / closes[i - 1]" in state


# ═══ 2. the house term: a new 52 week high is every bar that makes one ═══

def evaluated(tree, bars):
    from api.services import ast_interpret
    return [v is True or v == 1 for v in ast_interpret.interpret(tree, bars, {})]


@pytest.mark.parametrize("seed,drift,side", [(3, 0.0012, "high"), (9, -0.0012, "low"), (7, 0.0, "both")])
def test_new_52_week_high_and_low_by_value(seed, drift, side):
    bars = _walk(seed, n=700, drift=drift)
    highs = evaluated(chart_twins.house_formula("new_52w_high"), bars)
    lows = evaluated(chart_twins.house_formula("new_52w_low"), bars)
    run = {"high": False, "low": False}
    for i in range(251, len(bars)):
        window = bars[i - 251:i + 1]                         # 252 bars, this one included
        want_high = bars[i]["h"] >= max(b["h"] for b in window)
        want_low = bars[i]["l"] <= min(b["l"] for b in window)
        assert highs[i] is want_high, (seed, i)
        assert lows[i] is want_low, (seed, i)
        run["high"] = run["high"] or (want_high and highs[i - 1])
        run["low"] = run["low"] or (want_low and lows[i - 1])
    if side != "both":
        marks = highs if side == "high" else lows
        # EVERY bar that makes one is marked: two in a row both are (no "first in N bars")
        assert run[side], "the walk has no two in a row, so 'every bar' is not shown"
        assert any(marks[251:]) and not all(marks[251:])


def test_the_new_high_term_is_the_screeners_own_column_rule():
    """The Screener has a `new_52w_high` column. Its rule is today's HIGH against the 52-week window's
    highest high (`screener/live_tier.py`; `screener/identities.py` says why the close is not used).
    The chart term carries the same name and the same rule, so a screen and a chart agree."""
    import inspect
    from api.services.screener import identities, live_tier
    assert 'put("new_52w_high", 1 if day_high >= h52 else 0)' in inspect.getsource(live_tier)
    assert "`new_52w_high` tests today's HIGH against the window maximum" in inspect.getsource(identities)
    from api.services import definition_concierge as dc
    stems, _cost = dc._stem_key(dc._form_tokens("new 52w high"))
    assert {r["key"] for r in dc.LEXICON["index"][stems]} == {"new_52w_high"}
    assert chart_twins.house_formula("new_52w_high") is chart_twins.PATTERNS["new_52w_high"]


def test_the_words_reach_the_house_term_and_say_what_it_is_about(conv):
    for words, entry in (("Mark new 52 week highs", "new_52w_high"), ("mark new 52 week lows", "new_52w_low"),
                         ("show new yearly highs", "new_52w_high")):
        u = conv.understand_turn(words, CHART)
        assert u["refusal"] is None, words
        term = next(t for t in u["notes"]["matched_terms"] if t["entry"] == entry)
        assert "highest(high, 252)" in term["chart_formula"] or "lowest(low, 252)" in term["chart_formula"], term
        assert "STOCK'S PRICE" in term["rule"] and "Mark every bar it is true on" in term["rule"]
        assert "If the member names another line" in term["rule"]
    # the distance column is still its own term, and the pattern did not take its phrase
    u = conv.understand_turn("percent from the 52 week high", CHART)
    assert [t["entry"] for t in u["notes"]["matched_terms"]] == ["dist_52w_high_pct"]
    # a term with no subject note is the sentence it always was
    u = conv.understand_turn("mark inside days", CHART)
    term = next(t for t in u["notes"]["matched_terms"] if t["entry"] == "inside_day")
    assert term["rule"].endswith("with the member's number")


def test_the_built_in_the_vwap_decline_points_at_has_that_setting():
    """The instruction names a built-in and one of its settings. Both are read from the chart's own
    registry file, so the sentence cannot outlive the control it points at."""
    import pathlib
    import re
    src = (pathlib.Path(__file__).resolve().parents[1] / "app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    at = src.index("name: 'Session VWAP'")
    block = src[at:src.index("name: 'Stochastic Oscillator'", at)]
    assert re.search(r"key: 'bands', type: 'enum', label: 'Std dev bands'", block)
    for plot in ("upper1", "lower1", "upper2", "lower2"):
        assert f"key: '{plot}'" in block, plot


def test_the_tight_closes_default_is_the_screeners_own_number():
    from api.services.screener import base_catalog as bc
    assert bc.TWT_MAX_PAIRWISE == 0.015


# ═══ 3. a name whose published form only a script holds ═════════════════════════════

def test_schaff_is_refused_by_name_with_the_way_forward(conv):
    from api.services import named_indicators as ni
    e = ni.entry("schaff_trend_cycle")
    assert e is not None and ni.needs_script(e) == "its published form has two stochastic stages"
    assert e not in ni.entries(), "a held name has no formula"
    for words in ("Add the Schaff Trend Cycle", "schaff trend cycle 23 50 10", "plot the schaff trend cycle indicator"):
        u = conv.understand_turn(words, CHART)
        assert u["refusal"] is not None, words
        assert u["refusal"]["gate"] == conv.NAMED_UNCHECKED_GATE, words
        assert u["refusal"]["reason"].startswith(
            "Schaff Trend Cycle needs the script builder: its published form has two stochastic stages."), words
        assert u["held"] == ["schaff_trend_cycle"]
    # ⛔ the WHOLE name only: a bare "schaff" is part of other names and is not this entry
    assert set(e["aliases"]) == {"schaff trend cycle", "schaff trend cycle indicator"}
    assert (conv.understand_turn("plot schaff", CHART).get("held") or []) == []
    # a held name that needs no script says what it always said
    assert "needs the script builder" not in ni.way_forward(ni.entry("ttm_squeeze"))
    assert ni.needs_script(ni.entry("ttm_squeeze")) is None and ni.needs_script(None) is None


def test_with_the_script_lane_open_the_name_goes_to_a_script_and_closed_it_does_not(conv, monkeypatch):
    """`_with_script_lane`: a refusal BY NAME of a `needs_script` entry is handed to the script turn
    when the lane is open. Every other by-name refusal, and every turn with the lane closed, is the
    formula turn's own answer."""
    from api.services import script_conversation as sc
    refused = {"ok": False, "gate": conv.NAMED_UNCHECKED_GATE, "reason": "by name"}
    scripted = {"ok": True, "disposition": "answer", "turn": "script"}
    made = []
    monkeypatch.setattr(sc, "script_turn", lambda *a, **k: (made.append(a[0]), scripted)[1])

    def run(held, lane=True, script_words=False):
        made.clear()
        monkeypatch.setattr(sc, "lane_open", lambda accepts, admin: lane)
        monkeypatch.setattr(sc, "wants_script", lambda words: script_words)
        trace = {}

        def formula_turn():
            trace["named_held"] = held
            return dict(refused)
        return conv._with_script_lane(formula_turn, "Add the Schaff Trend Cycle", user_id="u1", view=empty_view(0),
                                      authoring=None, snippets=None, chart=CHART, cap_usd=1.0, calls=[], trace=trace,
                                      admin=True, accepts=["script"], script_refusal=None, cancelled=None)

    assert run(["schaff_trend_cycle"]) == scripted and len(made) == 1
    assert run(["ttm_squeeze"]) == refused and made == []                  # held, and a formula's to describe
    assert run([]) == refused and made == []
    assert run(["schaff_trend_cycle"], lane=False) == refused and made == []
