"""P3 slice "talk" -- TALK continuity and truth on the conversational door.

ASKED / CLAIMED / DID per case, classified. NO PAID CALLS: the stubbed seam is the
model client (``test_p2_truth_server``'s fixtures), so the pre-flight, the planner,
the advisory routing, the disposition check, the backstops and the ledger all run
for real.

The contract under test:
  * an ADVISORY message (a question, or "explain / tell me / compare ...") reaches
    the model even when it names something UCT cannot build ("Swing Trader",
    "Relative Strength Index"); those phrases go to the model as DATA it may
    discuss and never author with. An AUTHORING message keeps the planner's
    McGinley refusal (zero calls), and ``/propose``'s ``plan()`` is unchanged;
  * the pre-flight never intercepts a QUESTION (another symbol included), never
    reads "CAN SLIM" as ticker CAN, and DOES catch possessive / adjacent other-
    symbol authoring ("SPY's RSI", "SPY RSI above 50") with zero calls;
  * BACKSTOP: a change is refused (terminal, member-safe, never applied) when the
    member named another symbol or the advisory routing bypassed a refusal;
  * recent-turn snippets may be 1200 characters (a reply may be 1200);
  * the per-turn usage record names the repair gate CODE, never content.
"""
from __future__ import annotations

import json
import logging

import pytest

from tests.test_p2_truth_server import (  # noqa: F401  (pytest fixtures by import)
    ENDPOINT, CLOSE, RSI_GT_70, _block, call, conv, emits, env, http, model, num, op, out, view,
)

CHART = {"sym": "AAPL", "tf": "D"}
EMA20 = call("ema", CLOSE, num(20))


def ema_view(revision=1):
    return view(revision, [out("value", EMA20, label="EMA 20", type_="line")], name="EMA 20")


def _sent(client, tag):
    return _block(client.calls[0]["messages"][0]["content"], tag)


SET50 = [{"op": "set_slot", "slot": "value#0.1", "value": 50}]


# ═══ 1. the five audit probes: what happens BEFORE the model ═════════════════

@pytest.mark.parametrize("message,disposition", [
    ("What period would you recommend for a swing trader?", "answer"),
    ("What period would you recommend for a Swing Trader?", "answer"),
    ("What would you include in an earnings table for CAN SLIM characteristics?", "answer"),
    ("What's the difference between above 70 and crossing above 70?", "answer"),
    ("Why might that be better?", "answer"),
    ("Make it faster.", "clarify"),
])
def test_AUDIT_PROBES_reach_the_model_exactly_once(conv, model, http, message, disposition):
    """ASKED: each audit probe, on an AAPL daily chart. BEFORE: "Swing Trader" died in
    the planner (Title-Case refusal, no call); the CAN SLIM question died in the
    pre-flight as ticker CAN. CLAIMED: every probe reaches the model. DID: one call,
    the model's disposition passed through (VALUE)."""
    e = (env(1, [], questions=[{"id": "q1", "text": "Faster how?",
                                "choices": ["Shorter length", "Switch to EMA"]}])
         if disposition == "clarify" else
         env(1, [], disposition="answer", reply="A considered answer."))
    client = model([emits(e)])
    body = http.post(ENDPOINT, json={"message": message, "view": ema_view(1),
                                     "chart": CHART}).json()
    assert body["ok"] is True and body["disposition"] == disposition, body
    assert len(client.calls) == 1
    assert body["not_understood"] == []


def test_the_Title_Case_question_goes_WHOLE_with_a_discuss_never_author_note(conv, model):
    """ASKED: "What period would you recommend for a Swing Trader?". CLAIMED: the full
    question is the request; "Swing Trader" rides as DATA, labelled discuss-only."""
    client = model([emits(env(1, [], disposition="answer", reply="For swing trading..."))])
    m = "What period would you recommend for a Swing Trader?"
    r = conv.converse(m, user_id="u1", view=ema_view(1), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "answer"
    assert _sent(client, "uct_member_request") == m
    notes = _sent(client, "uct_language_notes")
    assert notes["not_understood"] == []
    assert [n["phrase"] for n in notes["not_in_vocabulary"]] == ["Swing Trader"]
    assert "never author" in notes["not_in_vocabulary"][0]["rule"]


@pytest.mark.parametrize("message", [
    "Explain the Relative Strength Index",
    "What does the Moving Average do?",
    "Is the Relative Strength line better than RSI?",
    "What are the Can Slim rules?",
    "Tell me about the McGinley Dynamic",
    "Compare the Relative Strength Index with the Moving Average",
])
def test_ADVISORY_messages_naming_unknown_phrases_reach_the_model(conv, model, message):
    client = model([emits(env(1, [], disposition="answer", reply="An answer."))])
    r = conv.converse(message, user_id="u1", view=ema_view(1), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1, r


@pytest.mark.parametrize("message", [
    "Use the McGinley Dynamic instead",
    "Add the McGinley Dynamic",
    "Add the McGinley Dynamic. What do you think?",
    "Can you add the McGinley Dynamic?",
    "I want the McGinley Dynamic",
])
def test_AUTHORING_messages_keep_the_McGinley_refusal_ZERO_calls(conv, model, message):
    """ASKED: build with an unknown named indicator (however politely, even with a
    question tacked on). CLAIMED: still refused by name before any model call, so no
    model can substitute an EMA (REFUSAL)."""
    client = model([])
    r = conv.converse(message, user_id="u1", view=ema_view(1), chart=CHART)
    assert r["ok"] is False and r["gate"] == "concept:ungrounded", r
    assert client.calls == []
    assert r["not_understood"][0]["phrase"] == "McGinley Dynamic"


def test_PROPOSE_plan_is_UNCHANGED_for_the_same_question():
    """The bypass is /converse-only: the shared planner still excises the phrase."""
    from api.services import definition_concierge as dc
    u = dc.plan("What period would you recommend for a Swing Trader?", dc.INDICATOR_KIND)
    assert u["understood"] == "" and u["not_understood"][0]["gate"] == "concept:ungrounded"


def test_BACKSTOP_an_advisory_turn_that_bypassed_a_refusal_never_returns_a_change(conv, model):
    """ASKED: "Tell me about the McGinley Dynamic". The model (wrongly) returns a
    change. CLAIMED: refused, terminal, nothing to apply. DID: concept:ungrounded with
    the planner's own member sentence, no envelope, one call (REFUSAL)."""
    client = model([emits(env(1, SET50, disposition="change", reply="Done."))])
    r = conv.converse("Tell me about the McGinley Dynamic", user_id="u1",
                      view=ema_view(1), chart=CHART)
    assert r["ok"] is False and r["gate"] == "concept:ungrounded" and r["backstop"] is True
    assert r["disposition"] == "unsupported" and "envelope" not in r
    assert "McGinley Dynamic" in r["reason"] and len(client.calls) == 1


# ═══ 2. the pre-flight (shared case table is asserted by slice2 + preflight.js) ═

@pytest.mark.parametrize("message", [
    "What would you include in an earnings table for CAN SLIM characteristics?",
    "Build an earnings check for CAN SLIM stocks",
    "Add a CAN-SLIM style filter on RSI",
])
def test_CAN_SLIM_is_never_ticker_CAN(message):
    from api.services import conversation_preflight as cp
    assert cp.check(message, CHART) is None
    assert cp.other_symbol(message, CHART) is None


@pytest.mark.parametrize("message,ticker", [
    ("Only when SPY's RSI is above 50", "SPY"),
    ("SPY RSI above 50", "SPY"),
    ("use QQQ's close", "QQQ"),
    ("Add a condition: QQQ close above its 50 EMA", "QQQ"),
    ("Can you use SPY's close instead?", "SPY"),
])
def test_POSSESSIVE_and_ADJACENT_other_symbol_authoring_is_caught_ZERO_calls(
        conv, model, http, message, ticker):
    """ASKED: authoring that reads another symbol possessively / adjacently. BEFORE
    (P3R): the real model substituted the chart's own symbol and disclosed it in
    prose. ⭐ PHASE 5: another symbol is AUTHORABLE, so these reach the model -- and
    the SUBSTITUTION is still refused: a change that does not read {ticker} is the
    backstop's `unsupported:other-symbol` naming it; a change that reads it through
    `sym` is handed on (REFUSAL / EXACT)."""
    own = op(">", call("rsi", CLOSE, num(14)), num(50))
    client = model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": own}]))])
    body = http.post(ENDPOINT, json={"message": message, "view": ema_view(1),
                                     "chart": CHART}).json()
    assert body["ok"] is False and body["gate"] == "unsupported:other-symbol", body
    assert body["backstop"] is True and len(client.calls) == 1
    assert ticker in body["reason"]
    theirs = op(">", {"type": "sym", "value": ticker, "args": [call("rsi", CLOSE, num(14))]}, num(50))
    client = model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": theirs}]))])
    body = http.post(ENDPOINT, json={"message": message, "view": ema_view(1),
                                     "chart": CHART}).json()
    assert body["ok"] is True and body["disposition"] == "change", body
    assert len(client.calls) == 1


@pytest.mark.parametrize("message", [
    "Only when AAPL's RSI is above 50",       # the chart's own symbol
    "AAPL RSI above 50",
])
def test_the_charts_OWN_symbol_is_never_another_symbol(message):
    from api.services import conversation_preflight as cp
    assert cp.check(message, CHART) is None


def test_without_a_chart_symbol_adjacent_is_never_guessed():
    from api.services import conversation_preflight as cp
    assert cp.check("SPY RSI above 50", None) is None


def _shared_cases():
    from pathlib import Path
    path = (Path(__file__).resolve().parents[1] / "app" / "src" / "components" / "chart"
            / "builder" / "authoring" / "preflightCases.json")
    return json.loads(path.read_text(encoding="utf-8"))


def test_the_QUESTION_detector_SHARED_table():
    """The `shapes` table in preflightCases.json -- the browser asserts the same
    verdicts (p3.talk.truth.test.js)."""
    from api.services import conversation_preflight as cp
    shapes = _shared_cases()["shapes"]
    assert len(shapes) >= 25
    for s in shapes:
        assert cp.shape(s["message"]) == s["shape"], s


def test_the_SHARED_case_table_includes_the_P3_cases():
    from api.services import conversation_preflight as cp
    cases = _shared_cases()["cases"]
    p3 = [c for c in cases if c.get("p3")]
    assert len(p3) >= 30
    for c in cases:
        got = cp.check(c["message"], c["chart"])
        assert (got["gate"] if got else None) == c["gate"], c


@pytest.mark.parametrize("message,chart", [
    ("What does RSI on SPY look like?", CHART),
    ("Would this work better on QQQ?", CHART),
    ("Can it compare AAPL with SPY?", {"sym": "XRPN", "tf": "D"}),
    ("Tell me which period suits weekly bars", CHART),
    ("Should I use the weekly timeframe instead?", CHART),
])
def test_QUESTIONS_about_other_symbols_and_timeframes_reach_the_model(conv, model, message, chart):
    client = model([emits(env(1, [], disposition="answer", reply="An honest answer."))])
    r = conv.converse(message, user_id="u1", view=ema_view(1), chart=chart)
    assert r["ok"] is True and r["disposition"] == "answer" and len(client.calls) == 1, r


def test_a_question_naming_another_symbol_tells_the_model_so(conv, model):
    client = model([emits(env(1, [], disposition="answer", reply="It reads AAPL only."))])
    conv.converse("What does RSI on SPY look like?", user_id="u1", view=ema_view(1), chart=CHART)
    notes = _sent(client, "uct_language_notes")
    assert notes["other_symbols"][0]["symbol"] == "SPY"


# ═══ 3. the model-substitution backstop ══════════════════════════════════════

def test_BACKSTOP_a_question_naming_another_symbol_never_comes_back_as_a_change(conv, model, http):
    """ASKED: "Would this work better on QQQ?" (a question -- not pre-flighted). The
    model substitutes: a change on the chart's own symbol, disclosed only in prose.
    CLAIMED: refused, terminal, never applied. DID: unsupported:other-symbol, the
    member-safe sentence naming QQQ, no envelope, one call, no repair (REFUSAL)."""
    client = model([emits(env(1, SET50, disposition="change",
                              reply="I used this chart's symbol instead of QQQ."))])
    body = http.post(ENDPOINT, json={"message": "Would this work better on QQQ?",
                                     "view": ema_view(1), "chart": CHART}).json()
    assert body["ok"] is False and body["gate"] == "unsupported:other-symbol", body
    assert body["disposition"] == "unsupported" and body["backstop"] is True
    assert "envelope" not in body and len(client.calls) == 1
    assert "QQQ" in body["reason"] and "unsupported:" not in body["reason"]
    assert body["usage"]["repair_gate"] is None


def test_BACKSTOP_leaves_an_ANSWER_about_another_symbol_alone(conv, model):
    model([emits(env(1, [], disposition="unsupported",
                     reply="Indicators made here read this chart's own symbol only."))])
    r = conv.converse("Would this work better on QQQ?", user_id="u1", view=ema_view(1), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "unsupported"


def test_a_plain_change_with_no_other_symbol_is_untouched(conv, model):
    model([emits(env(1, SET50, disposition="change", reply="Length is now 50."))])
    r = conv.converse("Make it 50", user_id="u1", view=ema_view(1), chart=CHART)
    assert r["ok"] is True and r["disposition"] == "change" and r["envelope"]["ops"] == SET50


# ═══ 4. the prompt (a constant) carries the three new rules ══════════════════

def test_PROMPT_rules_other_symbol_directional_clarify_and_advisory_answers(conv):
    p = conv.system_prompt()
    assert "ANOTHER SYMBOL" in p and "that is a substitution" in p
    assert "A DIRECTION WITH NO VALUE" in p and "make it smoother" in p
    assert "Never pick the number yourself" in p
    assert "ADVISORY questions are answers too" in p and "trading-literate" in p
    assert "never say or imply that you changed" in p
    assert "not_in_vocabulary" in p and "other_symbols" in p
    assert conv.system_prompt() == p        # still a constant


# ═══ 5. follow-up context bounds ═════════════════════════════════════════════

def test_SNIPPETS_may_be_1200_characters_and_six_of_them(conv, model):
    assert conv.MAX_SNIPPET_CHARS == 1200 and conv.MAX_SNIPPETS == 6
    long = "x" * 1200
    client = model([emits(env(1, [], disposition="answer", reply="ok"))])
    r = conv.converse("Why might that be better?", user_id="u1", view=ema_view(1), chart=CHART,
                      snippets=[{"role": "assistant", "text": long}] * 6)
    assert r["ok"] is True and _sent(client, "uct_recent_turns")[0]["text"] == long
    model([])
    r = conv.converse("Why?", user_id="u1", view=ema_view(1),
                      snippets=[{"role": "assistant", "text": long + "x"}])
    assert r["ok"] is False and r["gate"] == "converse:too-large"
    r = conv.converse("Why?", user_id="u1", view=ema_view(1),
                      snippets=[{"role": "member", "text": "a"}] * 7)
    assert r["ok"] is False and r["gate"] == "converse:too-large"


def test_the_client_mirror_of_the_snippet_bounds_agrees():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "app" / "src" / "components" / "chart"
           / "builder" / "authoring" / "converseClient.js").read_text(encoding="utf-8")
    assert "maxSnippets: 6, maxSnippetChars: 1200" in src


# ═══ 6. cost diagnosis: the repair gate, as a CODE ═══════════════════════════

def test_REPAIR_GATE_is_logged_at_INFO_and_in_usage_as_a_code_only(conv, model, caplog):
    """ASKED: why did this turn need a repair? CLAIMED: INFO log + usage carry the gate
    code and the attempt number -- never the member's words or the model's output."""
    marker = "ZZ-P3-SECRET-4417"
    stale = env(0, SET50, disposition="change", reply=marker)      # wrong baseRevision
    good = env(1, SET50, disposition="change", reply="Length is now 50.")
    model([emits(stale), emits(good)])
    with caplog.at_level(logging.INFO, logger="api.services.definition_conversation"):
        r = conv.converse(f"Make it 50 {marker}", user_id="u1", view=ema_view(1), chart=CHART)
    assert r["ok"] is True and r["attempts"] == 2
    assert r["usage"]["repair_gate"] == "envelope:revision"
    lines = [rec.getMessage() for rec in caplog.records if rec.levelno >= logging.INFO]
    assert "[converse] repair after attempt=1 gate=envelope:revision" in lines
    for line in lines:
        assert marker not in line
    usage_line = next(l for l in lines if l.startswith("[converse] usage "))
    assert json.loads(usage_line.split("[converse] usage ", 1)[1])["repair_gate"] == "envelope:revision"


def test_no_repair_means_repair_gate_None(conv, model):
    model([emits(env(1, SET50, disposition="change", reply="ok"))])
    r = conv.converse("Make it 50", user_id="u1", view=ema_view(1), chart=CHART)
    assert r["usage"]["repair_gate"] is None
