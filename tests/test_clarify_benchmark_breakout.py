"""CLARIFY AND LEARN, slice F: two more questions the door asks itself.

  benchmark         "Compared with which symbol?"  for relative strength, or a comparison with the
                    market, that names no symbol. Remembered as a default and SAID each time.
  breakout_window   "How many bars back should a breakout look?"  for a breakout or a new high or low
                    with no number and nothing named that it breaks out of. Asked each time, with
                    the member's last answer first.

Until now the first was asked by the assistant in its own words (a paid call, nothing remembered)
and the second was the assistant's guess. Measured before they were written, over the first
requests on file: of those that ask for relative strength most name the symbol, and of those that
ask for a breakout most give a number or a span, so each question is rare.

`tests/test_clarify_registry.py` holds every registry question to being asked when open, not asked
when settled, and settled by each of its own choices. Held HERE: what only these two do.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

import pytest

from api.services import indicator_memory as im
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    call, conv, emits, empty_view, env, model, num, op, out, view,
)
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name

CHART = {"sym": "NVDA", "tf": "D"}
DAY = dt.date(2026, 11, 18)
S = lambda n: {"type": "series", "name": n}  # noqa: E731
BENCH_Q = "Compared with which symbol?"
BREAK_Q = "How many bars back should a breakout look?"


@pytest.fixture
def account():
    return {}


def memory_of(account, user_id="u1"):
    return im.Memory(user_id, reader=lambda u: account.get(u),
                     writer=lambda u, text: account.pop(u, None) if text is None else account.__setitem__(u, text),
                     today=lambda: DAY)


def asked(question, words):
    return [{"role": "member", "text": words}, {"role": "assistant", "text": question}]


def versus(ticker):
    tree = op("/", S("close"), {"type": "sym", "value": ticker, "args": [S("close")]})
    return env(0, [{"op": "create", "name": f"Relative strength vs {ticker}", "placement": "pane",
                    "outputs": [{"key": "rs", "tree": tree}]}])


def breakout(n):
    tree = op(">", S("close"), {"type": "offset", "value": 1, "args": [call("highest", S("high"), num(n))]})
    return env(0, [{"op": "create", "name": f"Close above {n} bar high", "placement": "price",
                    "outputs": [{"key": "breakout", "tree": tree}]}])


def told(client, words):
    """Was the assistant sent these words as the member's request? (The request block is JSON inside
    the message, where an ampersand may be written as its escape.)"""
    sent = client.calls[0]["messages"][0]["content"]
    sent = sent if isinstance(sent, str) else json.dumps(sent)
    return any(form in sent for form in (words, words.replace("&", "\\u0026")))


def opens(conv, words, chart=CHART):
    return conv.open_questions(conv.understand_turn(words, chart))


# ═══ 1. when each is open ════════════════════════════════════════════════════

@pytest.mark.parametrize("words, want", [
    # the chart's OWN symbol is what is being measured, not what it is measured against
    ("relative strength of NVDA", ["benchmark"]),
    ("show NVDA's relative strength versus the market", ["benchmark"]),
    ("relative strength of NVDA versus AMD", []),
    # the oscillator whose name holds the words, and a comparison the choices cannot answer
    ("Add the Relative Strength Index", []),
    ("relative strength versus its sector", []),
    ("relative strength against its industry group", []),
    # both open: asked one at a time, the benchmark first (the registry's order)
    ("Plot the RS line and mark new highs", ["benchmark", "breakout_window"]),
    # "flag" the verb is not the chart pattern
    ("flag new lows", ["breakout_window"]),
    ("breakout from a bull flag", []),
    # a span said in words settles it as a number does
    ("mark new highs for the year", []),
    ("mark new all-time highs", []),
    ("new 52-week highs", []),
])
def test_when_each_is_open(conv, words, want):
    assert [q for q in opens(conv, words) if q in ("benchmark", "breakout_window")] == want


def test_a_question_from_the_member_is_not_met_with_one(conv, clean_env, model):
    """"Is it outperforming the market?" is a question: it is answered, never asked back."""
    understood = conv.understand_turn("Is it outperforming the market?", CHART)
    assert understood["advisory"] and conv.door_question(understood, empty_view(0)) is None


def test_every_benchmark_offered_is_a_symbol_a_formula_may_read(conv):
    """⭐ WHY THE HOUSE'S OWN BENCHMARK IS NOT THE FIRST CHOICE. UCT's RS Rating measures against the
    S&P 500 INDEX. A formula a member authors reads listed tickers only: the index's spelling is
    refused as ambiguous (`ambiguousBare`). So the first choice is the fund that tracks it, said as
    "S&P 500 (SPY)". If the formula language ever reads the index, this test is where to change it."""
    cc = conv.cross_context()
    question = conv.clarify_registry()["benchmark"]
    assert question["choices"][0] == "S&P 500 (SPY)" and question["remember"] == "default"
    assert list(question["values"]) == question["choices"] and list(question["said"]) == question["choices"]
    for label, value in question["values"].items():
        ticker = value.upper()
        assert re.fullmatch(cc["tickerPattern"], ticker) and ticker not in cc["ambiguousBare"], label
        assert f"({ticker})" in label and question["said"][label] == ticker
    assert "SPX" in cc["ambiguousBare"]


# ═══ 2. the benchmark: asked once, then used and SAID ════════════════════════

def test_the_benchmark_is_asked_once_then_used_and_said(conv, account, clean_env, model):
    mem = memory_of(account)
    # 1. the first time: asked, with no call, and nothing remembered yet
    client = model([])
    r = conv.converse("Show relative strength", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "clarify" and r["asked"] == "benchmark" and client.calls == [] and account == {}
    assert r["envelope"]["questions"][0] == {
        "id": "benchmark", "text": BENCH_Q,
        "choices": ["S&P 500 (SPY)", "Nasdaq 100 (QQQ)", "Russell 2000 (IWM)", "S&P 500 equal weight (RSP)"]}
    # 2. the tapped choice builds in one call, and is remembered
    client = model([emits(versus("SPY"))])
    r = conv.converse("S&P 500 (SPY)", user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=asked(BENCH_Q, "Show relative strength"), memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    assert told(client, "Show relative strength. S&P 500 (SPY)")           # the assistant is told the symbol, as words
    assert mem.choice("benchmark") == {"value": "spy", "label": "S&P 500 (SPY)", "times": 1, "last": "2026-11-18", "from": "answer"}
    # 3. next time it is open: NOT asked; built against it; and the member is told
    client = model([emits(versus("SPY"))])
    r = conv.converse("Plot the RS line", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    assert r["remembered"] == ["benchmark"]
    assert r["envelope"]["assumptions"][0] == {
        "text": "Comparing with SPY, as you chose before. Name another symbol to change it."}
    assert told(client, "Plot the RS line. S&P 500 (SPY)")
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))


def test_naming_a_symbol_is_never_overridden_by_the_memory(conv, account, clean_env, model):
    mem = memory_of(account)
    mem.remember("benchmark", "spy", "S&P 500 (SPY)")
    client = model([emits(versus("QQQ"))])
    r = conv.converse("Show relative strength versus QQQ", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["ok"] is True and "remembered" not in r
    assert "SPY" not in json.dumps(client.calls[0]["messages"][0]["content"])
    assert not any("as you chose before" in a.get("text", "") for a in r["envelope"].get("assumptions") or [])
    assert mem.choice("benchmark")["value"] == "spy"                          # a named symbol is not an ANSWER


def test_a_typed_symbol_settles_it_and_only_the_questions_own_are_remembered(conv, account, clean_env, model):
    """Any listed symbol answers the question. Only one of its own four is ever kept: what a member
    typed is never stored."""
    mem = memory_of(account)
    got = conv.pending_answer("XLK", asked(BENCH_Q, "Show relative strength"), CHART)
    assert got == {"question": "benchmark", "message": "Show relative strength. XLK", "answer": "XLK"}
    assert conv.answer_value("benchmark", got, CHART) is None
    model([emits(versus("XLK"))])
    r = conv.converse("XLK", user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=asked(BENCH_Q, "Show relative strength"), memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and account == {}
    # a plain word for a choice is that choice, and IS remembered
    for typed, want in (("spy", ("spy", "S&P 500 (SPY)")), ("the nasdaq", ("qqq", "Nasdaq 100 (QQQ)")),
                        ("russell", ("iwm", "Russell 2000 (IWM)")), ("equal weight", ("rsp", "S&P 500 equal weight (RSP)")),
                        ("Nasdaq 100 (QQQ)", ("qqq", "Nasdaq 100 (QQQ)"))):
        got = conv.pending_answer(typed, asked(BENCH_Q, "Show relative strength"), CHART)
        assert got is not None and conv.answer_value("benchmark", got, CHART) == want, typed
    # words that answer nothing are a new request, and nothing is asked twice
    assert conv.pending_answer("make it blue", asked(BENCH_Q, "Show relative strength"), CHART) is None


# ═══ 3. the breakout window: offered last-first, never applied ═══════════════

def test_the_breakout_window_is_offered_with_the_members_last_first_and_never_applied(conv, account, clean_env, model):
    mem = memory_of(account)
    client = model([])
    r = conv.converse("Mark breakouts", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "clarify" and r["asked"] == "breakout_window" and client.calls == []
    assert r["envelope"]["questions"][0] == {"id": "breakout_window", "text": BREAK_Q,
                                             "choices": ["20", "50", "100", "252 (about 52 weeks)"]}
    # the choice that says more than its number: read as 252 (not as 52), and kept under its own label
    client = model([emits(breakout(252))])
    r = conv.converse("252 (about 52 weeks)", user_id="u1", view=empty_view(0), chart=CHART,
                      snippets=asked(BREAK_Q, "Mark breakouts"), memory=mem)
    assert r["ok"] is True and r["disposition"] == "change" and len(client.calls) == 1, r
    assert "Mark breakouts. 252 (about 52 weeks)" in json.dumps(client.calls[0]["messages"][0]["content"])
    assert mem.choice("breakout_window") == {"value": 252, "label": "252 (about 52 weeks)", "times": 1,
                                             "last": "2026-11-18", "from": "answer"}
    # asked AGAIN next time (a window changes from one indicator to the next), theirs first, not listed twice
    client = model([])
    r = conv.converse("mark new highs", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["disposition"] == "clarify" and r["asked"] == "breakout_window" and client.calls == [] and "remembered" not in r
    assert r["envelope"]["questions"][0]["choices"] == ["252 (about 52 weeks) (your last)", "20", "50", "100"]
    assert conv.check_envelope(r["envelope"], 0, empty_view(0))
    # a number kept under its bare label (set before the choice said more) is shown as that choice too
    mem.remember("breakout_window", 252, "252")
    r = conv.converse("mark new highs", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["envelope"]["questions"][0]["choices"] == ["252 (about 52 weeks) (your last)", "20", "50", "100"]
    # tapping it back is that number again
    got = conv.pending_answer("252 (about 52 weeks) (your last)", asked(BREAK_Q, "mark new highs"), CHART)
    assert conv.answer_value("breakout_window", got, CHART) == (252, "252 (about 52 weeks)")
    # any whole number of bars is an answer; one that is no usual choice is shown as itself
    got = conv.pending_answer("30", asked(BREAK_Q, "Mark breakouts"), CHART)
    assert conv.answer_value("breakout_window", got, CHART) == (30, "30")
    mem.remember("breakout_window", 30, "30")
    r = conv.converse("Mark breakouts", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["envelope"]["questions"][0]["choices"] == ["30 (your last)", "20", "50", "100", "252 (about 52 weeks)"]
    # CONTROL: the average's length keeps its own memory; one is never offered for the other
    assert mem.choice("average_length") is None
    r = conv.converse("Add an EMA", user_id="u1", view=empty_view(0), chart=CHART, memory=mem)
    assert r["asked"] == "average_length" and r["envelope"]["questions"][0]["choices"] == ["10", "20", "50", "200"]


def test_a_window_outside_what_a_formula_can_reach_is_not_remembered(conv):
    far = conv.pending_answer("5000", asked(BREAK_Q, "Mark breakouts"), CHART)
    assert far is None or conv.answer_value("breakout_window", far, CHART) is None


# ═══ 4. Settings: both are visible, editable, forgettable ════════════════════

def test_settings_shows_both_and_takes_only_their_own_values(conv, account):
    mem = memory_of(account)
    view = conv.memory_view(mem)
    rows = {r["id"]: r for r in view["questions"]}
    assert rows["benchmark"]["title"] == "Benchmark for relative strength" and rows["benchmark"]["any_number"] is False
    assert rows["benchmark"]["use"] == "Used without asking, and said each time."
    assert rows["benchmark"]["choices"] == [{"label": "S&P 500 (SPY)", "value": "spy"}, {"label": "Nasdaq 100 (QQQ)", "value": "qqq"},
                                            {"label": "Russell 2000 (IWM)", "value": "iwm"},
                                            {"label": "S&P 500 equal weight (RSP)", "value": "rsp"}]
    assert rows["breakout_window"]["any_number"] is True and rows["breakout_window"]["use"] == "Asked each time, with yours listed first."
    assert rows["breakout_window"]["choices"] == [{"label": "20", "value": 20}, {"label": "50", "value": 50},
                                                  {"label": "100", "value": 100}, {"label": "252 (about 52 weeks)", "value": 252}]
    assert rows["average_length"]["any_number"] is True and rows["average_kind"]["any_number"] is False      # unchanged
    assert conv.set_memory(mem, "benchmark", "qqq") is True and mem.choice("benchmark")["label"] == "Nasdaq 100 (QQQ)"
    for bad in ("QQQ", "xlk", "Nasdaq 100 (QQQ)", 20, True, ""):
        assert conv.set_memory(mem, "benchmark", bad) is False, bad
    assert conv.set_memory(mem, "breakout_window", 252) is True and mem.choice("breakout_window")["label"] == "252 (about 52 weeks)"
    assert conv.set_memory(mem, "breakout_window", 30) is True and mem.choice("breakout_window")["label"] == "30"
    for bad in (0, 961, 20.5, "20", True):
        assert conv.set_memory(mem, "breakout_window", bad) is False, bad
    assert mem.forget("benchmark") and mem.choice("benchmark") is None


# ═══ 5. the eval: a reference that reads another symbol is matched by hash, never by emptiness ═══

def test_the_eval_never_passes_an_other_symbol_reference_on_two_empty_columns():
    """The eval's bars are the chart's own symbol's, so anything that reads SPY is unknown on every
    bar. Two different formulas would then be "equal on every bar". A reference that reads another
    symbol has its column withheld, so only the same formula (by hash) matches it."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
    import converse_eval as ce
    empty = [None] * 40
    assert ce.columns_equal(empty, empty) is True                            # the trap, as it stands
    withheld = {"hashes": {"o0": "sha256:aaa"}, "columns": {"o0": None}}
    same = {"hashes": {"rs": "sha256:aaa"}, "columns": {"rs": empty}}
    other = {"hashes": {"rs": "sha256:bbb"}, "columns": {"rs": empty}}
    assert ce.match_outputs(withheld, same) == (True, [{"reference": "o0", "match": "hash", "output": "rs"}])
    assert ce.match_outputs(withheld, other) == (False, [{"reference": "o0", "match": "FAIL", "output": None}])
    # CONTROL: with the column NOT withheld, the different formula would have passed by value
    valued = {"hashes": {"o0": "sha256:aaa"}, "columns": {"o0": empty}}
    assert ce.match_outputs(valued, other)[0] is True
    # and the tool withholds exactly the references that read another symbol
    spy = {"type": "op", "name": "/", "args": [S("close"), {"type": "sym", "value": "SPY", "args": [S("close")]}]}
    assert ce.sym_tickers(spy) == {"SPY"} and ce.sym_tickers(S("close")) == set()
