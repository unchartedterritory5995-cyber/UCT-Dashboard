"""Study -- the picture card for a computed question (scripts/study/calc_visuals.py, VISUALS_PLAN.md step 3).

The card rides in prompt_json, which a member receives BEFORE answering, so the rails here are about what it may hold:
the question's inputs only (never the result), each one stated in the question's own words (never only in a choice),
and a shape drawn only when its roles are certain.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from scripts.study import calc_visuals as cv
from scripts.study import courses_lib

REPO = pathlib.Path(__file__).resolve().parents[1]


def _q(text, calc, story="", choices=None, fmt="mcq"):
    q = {"key": "q01", "format": fmt, "q": text, "calc": calc}
    if story:
        q["story"] = story
    if choices:
        q["choices"] = choices
    return q


def _numbers(obj):
    """Every number anywhere in a card."""
    if isinstance(obj, bool):
        return []
    if isinstance(obj, (int, float)):
        return [float(obj)]
    if isinstance(obj, dict):
        return [n for v in obj.values() for n in _numbers(v)]
    if isinstance(obj, list):
        return [n for v in obj for n in _numbers(v)]
    return []


def test_an_r_level_is_a_ladder_with_its_entry_and_stop_and_never_the_level():
    q = _q("Entry $50, stop $47.50. Where is the 3R price?",
           {"fn": "arith", "args": {"expr": "entry + 3 * (entry - stop)", "entry": 50, "stop": 47.5}})
    card = cv.visual_for(q)
    assert card["kind"] == "ladder" and card["side"] == "long"
    assert {lv["key"]: lv["price"] for lv in card["levels"]} == {"stop": 47.5, "entry": 50.0}
    assert card["find"] == {"label": "3R", "as": "price"}
    assert card["r"] == {"entry": 50.0, "stop": 47.5}
    assert 57.5 not in _numbers(card)                     # the answer is filled in after scoring, never before


def test_the_same_shape_with_bare_letters_is_still_certain():
    q = _q("Bought the hold at 147.30 with the stop at 145.05. Where is 3R?",
           {"fn": "arith", "args": {"expr": "a + 3 * (a - b)", "a": 147.3, "b": 145.05}})
    card = cv.visual_for(q)
    assert [lv["label"] for lv in card["levels"]] == ["Stop", "Entry"]


def test_an_r_level_the_words_do_not_name_gets_no_card():
    # a + 3 x (a - b) is an R level only when the words ask for one; a measured move of the same shape is not
    q = _q("The pole runs from 40.00 to 50.00. Add three poles to the top.",
           {"fn": "arith", "args": {"expr": "a + 3 * (a - b)", "a": 50, "b": 40}})
    assert cv.visual_for(q) is None


def test_a_number_the_words_do_not_state_drops_the_card():
    # the stop sits three cents under the low: 47.42 is never written, so no card shows it
    q = _q("Fill 48.60. The low is 47.45 and the stop sits three cents under it. Stop distance, in percent?",
           {"fn": "arith", "args": {"expr": "(a - b) / a * 100", "a": 48.6, "b": 47.42}})
    assert cv.visual_for(q) is None


def test_a_number_stated_only_in_a_choice_drops_the_card():
    # the choices hold the answer, so a number that appears only there was never given
    q = _q("Your account peaked. It's now $42,500. What's your drawdown?",
           {"fn": "drawdown_pct", "args": {"peak": 50000, "trough": 42500}},
           choices=["15% from $50,000", "8%", "20%", "12%"])
    assert cv.visual_for(q) is None


def test_the_story_counts_as_the_question_s_words():
    q = _q("What R goes in your log?", {"fn": "arith", "args": {"expr": "(entry - exit) / (entry - stop)",
                                                                 "entry": 20, "exit": 18, "stop": 19}},
           story="You bought at $20 with a stop at $19. It slid, and you sold at $18.")
    card = cv.visual_for(q)
    assert card["kind"] == "ladder" and card["find"]["as"] == "r_loss"
    assert [lv["price"] for lv in card["levels"]] == [19.0, 20.0, 18.0]


def test_numbers_written_in_millions_are_stated():
    q = _q("A stock trades 2 million shares a day. We own at most 1% of average daily volume. Our ceiling?",
           {"fn": "arith", "args": {"expr": "a * 0.01", "a": 2000000}})
    card = cv.visual_for(q)
    assert card["kind"] == "share" and card["pct"] == 1.0 and card["whole"]["value"] == 2000000.0


def test_an_unknown_shape_gets_no_card():
    q = _q("Yesterday's high was $56, the low $48 and the close $55. Today's pivot?",
           {"fn": "arith", "args": {"expr": "(high + low + close) / 3", "high": 56, "low": 48, "close": 55}})
    assert cv.visual_for(q) is None


def test_a_chart_question_gets_no_card():
    q = _q("Where is 3R?", {"fn": "arith", "args": {"expr": "a + 3 * (a - b)", "a": 50, "b": 48}})
    q["chart"] = {"sym": "X", "asof": "2024-01-02"}
    assert cv.visual_for(q) is None


def test_a_percent_change_names_no_roles_but_a_fall_names_its_peak():
    up = cv.visual_for(_q("The 9 EMA is 50.00 and the fill 55.40. How far above it, in percent?",
                          {"fn": "pct_change", "args": {"start": 50, "end": 55.4}}))
    assert up["kind"] == "move" and up["from"] == {"label": "", "value": 50.0} and up["to"]["value"] == 55.4
    down = cv.visual_for(_q("The index peaked at 4,800 and closes at 4,080. How far below the record?",
                            {"fn": "drawdown_pct", "args": {"peak": 4800, "trough": 4080}}))
    assert (down["from"]["label"], down["to"]["label"]) == ("Peak", "Low")


def test_a_spread_as_a_percent_of_the_ask_is_a_quote():
    card = cv.visual_for(_q("Quoted 0.10 bid, 0.20 ask. The spread as a percent of the ask?",
                            {"fn": "arith", "args": {"expr": "(ask - bid) / ask * 100", "ask": 0.2, "bid": 0.1}}))
    assert card == {"kind": "quote", "bid": 0.1, "ask": 0.2, "find": {"label": "The spread, % of the ask", "as": "pct"}}


def test_a_value_inside_a_range_is_not_called_a_close():
    card = cv.visual_for(_q("Over the past year IV ranged from 20% to 60%. Today it's 50%. Where does today sit?",
                            {"fn": "arith", "args": {"expr": "(today - low) / (high - low) * 100", "today": 50, "low": 20, "high": 60}}))
    assert card["value_label"] == "Today" and card["find"]["label"] == "Where it sits in its range"
    bar = cv.visual_for(_q("The day ran 30.00 to 32.00 and closed at 31.40. Where in its range did it close, 0 to 1?",
                           {"fn": "arith", "args": {"expr": "(c - l) / (h - l)", "c": 31.4, "l": 30, "h": 32}}))
    assert bar["value_label"] == "Close" and bar["find"]["as"] == "frac"


def test_a_part_of_a_whole_names_both_and_asks_the_percent():
    card = cv.visual_for(_q("You closed 40 trades. 18 of them made money. What's your win rate?",
                            {"fn": "arith", "args": {"expr": "wins / trades * 100", "wins": 18, "trades": 40}}))
    assert card["kind"] == "share" and card["part"] == {"label": "Winners", "value": 18.0, "fmt": "count"}
    assert card["whole"]["value"] == 40.0 and card["find"]["as"] == "pct" and "pct" not in card


def test_numbers_the_words_scale_print_plain():
    # "12 million share float": the calc holds 12, so the card must not say "12 shares"
    float_card = cv.visual_for(_q("A stock has a 12 million share float and 3 million shares sold short. What percent?",
                                  {"fn": "arith", "args": {"expr": "short_shares / float_shares * 100", "short_shares": 3, "float_shares": 12}}))
    assert float_card["whole"]["fmt"] == "count"
    rev = cv.visual_for(_q("NVIDIA: revenue $57,006 million, operating income $36,010 million. The operating margin?",
                           {"fn": "arith", "args": {"expr": "operating_income / revenue * 100", "operating_income": 36010, "revenue": 57006}}))
    assert rev["whole"]["fmt"] == "count"


def test_a_volume_multiple_measures_the_day_against_the_average():
    card = cv.visual_for(_q("The 50-day average volume is 4 million shares. The gap day trades 13 million. What is the multiple?",
                            {"fn": "arith", "args": {"expr": "a / b", "a": 13, "b": 4}}))
    assert (card["from"]["label"], card["from"]["value"], card["to"]["value"]) == ("Average", 4.0, 13.0)
    assert card["find"]["as"] == "times"
    # the same bare ratio without the volume words is something else (a range ratio): no card
    assert cv.visual_for(_q("The last 5 sessions averaged a 2.10 range; the 10 before averaged 3.00. The last 5 over the 10?",
                            {"fn": "arith", "args": {"expr": "a / b", "a": 2.1, "b": 3}})) is None


def test_a_level_a_stated_percent_under_a_peak():
    card = cv.visual_for(_q("The S&P 500's record close was 6,144.15. At what close would it be down exactly 20%?",
                            {"fn": "arith", "args": {"expr": "peak * (100 - drop) / 100", "peak": 6144.15, "drop": 20}}))
    assert card["levels"] == [{"key": "level", "label": "Peak", "price": 6144.15}] and card["find"]["label"] == "20% under"
    # a percent the words do not state is the rule being tested: no card gives it away
    assert cv.visual_for(_q("You started the month at $60,000. Where does our monthly loss limit stop new trades?",
                            {"fn": "arith", "args": {"expr": "start * (100 - limit) / 100", "start": 60000, "limit": 6}})) is None


def test_the_dollars_between_two_named_prices_carry_the_share_count():
    card = cv.visual_for(_q("You hold 500 shares. Your sell stop at $38.00 fills at $37.70 in a fast drop. Slippage cost?",
                            {"fn": "arith", "args": {"expr": "(stop - fill) * shares", "stop": 38, "fill": 37.7, "shares": 500}}))
    assert [lv["label"] for lv in card["levels"]] == ["Stop", "Fill"] and card["shares"] == 500.0
    assert card["find"] == {"label": "Slippage", "as": "dollars"}
    spread = cv.visual_for(_q("Bid $9.80, ask $10.20. You buy 500 shares at the ask and sell at the bid. The spread's cost?",
                              {"fn": "arith", "args": {"expr": "(ask - bid) * shares", "ask": 10.2, "bid": 9.8, "shares": 500}}))
    assert spread["kind"] == "quote" and spread["shares"] == 500.0


def test_a_midpoint_and_an_r_loss_the_names_fix():
    mid = cv.visual_for(_q("Qualcomm guided EPS to $2.15 to $2.35. What is the midpoint of that range?",
                           {"fn": "arith", "args": {"expr": "(low + high) / 2", "low": 2.15, "high": 2.35}}))
    assert [lv["label"] for lv in mid["levels"]] == ["Low", "High"] and mid["find"]["label"] == "Midpoint"
    loss = cv.visual_for(_q("Entry $50, sell stop $48. It gaps open at $44 and the stop sells there. How many times your planned loss?",
                            {"fn": "arith", "args": {"expr": "(entry - fill) / (entry - stop)", "entry": 50, "fill": 44, "stop": 48}}))
    assert loss["find"]["as"] == "r_loss" and loss["r"] == {"entry": 50.0, "stop": 48.0}


ATR_Q = "The highest high of the last 11 sessions is 120.00, ATR is 3.00 and the hold session's low is 117.60. How deep, in ATRs?"
ATR_CALC = {"fn": "arith", "args": {"expr": "(a - b) / c", "a": 120, "b": 117.6, "c": 3}}


def _written(levels, **extra):
    v = {"kind": "ladder", "side": "long", "title": "The pullback", "find": {"label": "Depth", "as": "num", "unit": "ATRs"},
         "levels": levels}
    v.update(extra)
    return v


def test_a_written_card_holds_to_the_built_cards_contract():
    good = _q(ATR_Q, ATR_CALC)
    good["visual"] = _written([{"key": "high", "label": "11-session high", "price": 120}, {"key": "low", "label": "Hold low", "price": 117.6}])
    assert cv.written_problems(good) == [] and cv.visual_for(good)["title"] == "The pullback"
    # a number the words do not state, a label's own number, the answer on the card: each refused, and nothing drawn
    bad = dict(good, visual=_written([{"key": "high", "label": "High", "price": 121}]))
    assert any("do not state" in p for p in cv.written_problems(bad)) and cv.visual_for(bad) is None
    label = dict(good, visual=_written([{"key": "high", "label": "12-session high", "price": 120}]))
    assert any("do not state" in p for p in cv.written_problems(label))
    leak = dict(good, visual=_written([{"key": "high", "label": "High", "price": 120}, {"key": "x", "label": "Depth", "price": 0.8}]))
    assert any("do not state" in p or "answer" in p for p in cv.written_problems(leak))
    assert cv.written_problems(dict(good, chart={"sym": "X", "asof": "2024-01-02"}))
    assert cv.written_problems(dict(good, visual={"kind": "hologram"}))
    assert cv.written_problems(dict(good, visual=_written([{"key": "high", "label": "High", "price": 120}], find={"label": "x", "as": "magic"})))


def test_the_validator_refuses_a_bad_written_card_and_a_checker_can_drop_one():
    doc = json.loads((REPO / "docs/study/courses/SET/SET.14.json").read_bytes().decode("utf-8"))
    q = next(x for x in doc["questions"] if x["key"] == "q25")
    assert q["calc"]["args"]["expr"].replace(" ", "") == "(a-b)/c"
    q["visual"] = _written([{"key": "high", "label": "High", "price": 999}])
    assert any(p.startswith("q25: visual shows numbers") for p in courses_lib.unit_problems(doc))
    from scripts.study import apply_upgrade
    apply_upgrade.apply(doc, {}, "t", checks={"q25": {"status": "fix", "notes": "misread", "fix": {"visual": None}}})
    assert "visual" not in q


@pytest.mark.parametrize("calc,text", [
    ({"fn": "shares_from_risk", "args": {"account": 40000, "risk_pct": 0.5, "entry": 30, "stop": 31.5}},
     "Account $40,000, risking 0.5%. You short at $30.00 with a buy stop at $31.50. How many shares?"),
    ({"fn": "option_breakeven", "args": {"kind": "call", "strike": 40, "premium": 6}},
     "The stock is at 45. You buy the 40 call for 6.00. What price at expiry gets you back to even?"),
    ({"fn": "expectancy_r", "args": {"win_rate_pct": 30, "avg_win_r": 3, "avg_loss_r": 1}},
     "Your system wins 30% of its trades. Winners average +3R and losers -1R. Expectancy per trade?"),
    ({"fn": "gain_to_recover", "args": {"loss_pct": 78}}, "An index falls 78%. What gain gets it back?"),
])
def test_every_named_card_holds_its_inputs_only(calc, text):
    card = cv.visual_for(_q(text, calc))
    assert card is not None
    result = courses_lib.calc_value(calc)
    assert result not in _numbers(card)


def _live_questions():
    for path in sorted((REPO / "docs/study/courses").glob("*/*.json")):
        d = json.loads(path.read_bytes().decode("utf-8"))
        live = {k for k, v in (d.get("verify") or {}).items() if (v or {}).get("status") == "pass"}
        for q in d.get("questions") or []:
            if q["key"] in live:
                yield d, q


def test_the_live_bank_cards_hold_only_stated_inputs():
    """Over every live computed question: a card's numbers are each stated in the words, and none is the result
    unless the words state that same number as an input (a card cannot leak what the question does not give)."""
    n = 0
    for d, q in _live_questions():
        card = cv.visual_for(q)
        if not card:
            continue
        n += 1
        stated = cv.numbers_stated(cv.stated_text(q))
        for x in cv._given_values(card):
            v = abs(x) if card["kind"] == "payoff" else x
            assert any(abs(v - s) <= 1e-9 * max(1.0, abs(v)) for s in stated), (d["unit"], q["key"], x)
        result = courses_lib.calc_value(q["calc"])
        if result in _numbers(card):
            assert any(abs(result - s) <= 1e-9 * max(1.0, abs(result)) for s in stated), (d["unit"], q["key"], result)
    assert n >= 200, n                                    # 242 on 2026-11-15; a collapse means a broken matcher


def test_the_bank_carries_the_card_in_the_prompt():
    doc = json.loads((REPO / "docs/study/courses/F10/F10.05.json").read_bytes().decode("utf-8"))
    items = {it["_key"]: it for it in courses_lib.build_items(doc)}
    it = items["q29"]
    assert it["prompt_json"]["visual"]["kind"] == "ladder"
    assert it["reveal_json"]["facts"]["calc"]["result"] == 57.5   # the reveal fills it in after scoring
