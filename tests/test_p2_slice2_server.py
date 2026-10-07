"""SLICE 2 -- the conversational door answers, clarifies, refuses AND changes.

ASKED / CLAIMED / DID per case. NO PAID CALLS: the stubbed seam is the model
client, exactly as in ``test_p2_truth_server.py`` (whose fixtures this reuses), so
request building, the disposition check, the pre-flight and the spend ledger all
run for real.

The contract under test: every model turn DECLARES what it is
(``disposition``: change | answer | clarify | unsupported) and the server holds
the declaration and the payload consistent, so the client never infers mutation
from which optional fields happen to be present. An explicit request for another
symbol or timeframe is refused BEFORE any model call: zero calls, zero cost.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.test_p2_truth_server import (  # noqa: F401  (pytest fixtures by import)
    ENDPOINT, RSI_GT_70, conv, emits, env, http, model, out, view, call, CLOSE, num,
)

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "preflightCases.json"

EMA20 = call("ema", CLOSE, num(20))


def ema_view(revision=1):
    return view(revision, [out("value", EMA20, label="EMA 20", type_="line")], name="EMA 20")


# ═══ the turn outcomes ═════════════════════════════════════════════════════

def test_ANSWER_a_question_returns_a_reply_and_NOTHING_to_apply(conv, model, http):
    """ASKED: "What does this indicator do?" on EMA 20. CLAIMED: an answer turn.
    DID: 200, disposition answer, the reply verbatim, ops [] -- nothing to apply."""
    client = model([emits(env(1, [], disposition="answer",
                              reply="It is the 20-bar exponential average of the close."))])
    r = http.post(ENDPOINT, json={"message": "What does this indicator do?", "view": ema_view(1)})
    body = r.json()
    assert r.status_code == 200 and body["ok"] is True, body
    assert body["disposition"] == "answer"
    assert body["reply"] == "It is the 20-bar exponential average of the close."
    assert body["envelope"]["ops"] == [] and not body["envelope"].get("questions")
    assert len(client.calls) == 1


def test_HYPOTHETICAL_is_an_answer_not_a_change_and_the_prompt_says_so(conv, model, http):
    """ASKED: "Would 50 be slower?". CLAIMED: the prompt classes a hypothetical as a
    question; an answer carrying ops is refused, never passed through (EXACT)."""
    prompt = conv.system_prompt()
    assert "WHAT THE TURN IS" in prompt and "would 50 be slower?" in prompt
    assert "explain it and change NOTHING" in prompt
    # a model that answers AND sneaks an op in: refused, repaired once, then refused
    bad = env(1, [{"op": "set_slot", "slot": "value#0.1", "value": 50}],
              disposition="answer", reply="Yes, slower.")
    client = model([emits(bad), emits(bad)])
    r = http.post(ENDPOINT, json={"message": "Would 50 be slower?", "view": ema_view(1)})
    body = r.json()
    assert body["ok"] is False and body["gate"] == "envelope:disposition", body
    assert "envelope" not in body and len(client.calls) == 2


def test_CHANGE_carries_ops_and_a_reply(conv, model, http):
    """ASKED: "Make it 50". DID: disposition change, the op verbatim, the reply."""
    model([emits(env(1, [{"op": "set_slot", "slot": "value#0.1", "value": 50}],
                     disposition="change", reply="Changed the length to 50."))])
    body = http.post(ENDPOINT, json={"message": "Make it 50", "view": ema_view(1)}).json()
    assert body["ok"] is True and body["disposition"] == "change" and body["turn"] == "patch"
    assert body["envelope"]["ops"][0]["value"] == 50


def test_CLARIFY_is_questions_with_no_ops(conv, model, http):
    model([emits(env(1, [], questions=[{"id": "q1", "text": "Which average?",
                                        "choices": ["EMA", "SMA"]}]))])
    body = http.post(ENDPOINT, json={"message": "add an average", "view": ema_view(1)}).json()
    assert body["ok"] is True and body["disposition"] == "clarify" and body["envelope"]["ops"] == []


def test_UNSUPPORTED_from_the_model_is_a_reply_with_no_ops(conv, model, http):
    model([emits(env(1, [], disposition="unsupported",
                     reply="Tables are not something an indicator can draw yet."))])
    body = http.post(ENDPOINT, json={"message": "draw a table", "view": ema_view(1)}).json()
    assert body["ok"] is True and body["disposition"] == "unsupported" and body["envelope"]["ops"] == []


@pytest.mark.parametrize("envelope,why", [
    (env(1, [], disposition="change"), "change without ops"),
    (env(1, [], disposition="answer", reply="  "), "answer without a reply"),
    (env(1, [], disposition="clarify"), "clarify without questions"),
    ({"contract": "uct.authoring.patch/1", "baseRevision": 1, "ops": []}, "no disposition at all"),
])
def test_an_INCONSISTENT_or_MISSING_disposition_is_refused_never_guessed(conv, model, http, envelope, why):
    """CLAIMED: mutation is never inferred. DID: refused (schema or disposition gate),
    no envelope offered, after the one repair (REFUSAL)."""
    model([emits(envelope), emits(envelope)])
    body = http.post(ENDPOINT, json={"message": "hm", "view": ema_view(1)}).json()
    assert body["ok"] is False and body["gate"] in ("envelope:disposition", "envelope:schema"), (why, body)
    assert "envelope" not in body


def test_the_model_contract_REQUIRES_disposition_and_the_engine_file_does_not(conv):
    """The shared engine schema keeps it optional (older envelopes, engine tests); the
    model's tool schema requires it."""
    assert "disposition" in conv.composed_schema()["required"]
    assert "disposition" in conv.anthropic_tool()["input_schema"]["required"]
    assert "disposition" not in conv.patch_schema()["required"]


# ═══ the deterministic pre-flight ══════════════════════════════════════════

def test_PREFLIGHT_other_symbol_ZERO_calls_ZERO_cost_through_the_endpoint(conv, model, http):
    """ASKED: "compare AAPL with SPY" on an XRPN chart (P3: the imperative -- the question
    form now reaches the model; see test_p3_truth_talk). CLAIMED: refused before
    the model. DID: 200 ok:false, member-safe reason, attempts 0, cost 0, the model
    never called, the member's spend ledger unchanged (REFUSAL, EXACT)."""
    from api.services import definition_concierge as dc
    client = model([])                                   # an unarmed call would FAIL
    before = dc.spend_for("u1", dc._market_date())
    r = http.post(ENDPOINT, json={"message": "compare AAPL with SPY", "view": ema_view(1),
                                  "chart": {"sym": "XRPN", "tf": "D"}})
    body = r.json()
    assert r.status_code == 200 and body["ok"] is False, body
    assert body["gate"] == "unsupported:other-symbol" and body["disposition"] == "unsupported"
    assert body["preflight"] is True and body["attempts"] == 0 and body["cost_usd"] == 0
    assert body["tokens"] == {"input": 0, "output": 0}
    assert client.calls == []
    assert dc.spend_for("u1", dc._market_date()) == before
    # member-safe: no AST node names, no gate codes, no ids in the sentence
    assert "AAPL" in body["reason"] and "chart's own" in body["reason"]
    for leak in ("sym", "node", "unsupported:", "tree", "{"):
        assert leak not in body["reason"].replace("symbol", "")


def test_PREFLIGHT_other_timeframe_ZERO_calls(conv, model, http):
    client = model([])
    body = http.post(ENDPOINT, json={"message": "use weekly RSI while chart is daily",
                                     "view": ema_view(1), "chart": {"sym": "AAPL", "tf": "D"}}).json()
    assert body["gate"] == "unsupported:other-timeframe" and body["attempts"] == 0
    assert "weekly" in body["reason"] and "daily" in body["reason"] and client.calls == []


def test_PREFLIGHT_does_not_touch_an_AMBIGUOUS_request(conv, model, http):
    """ASKED: "Can this use another symbol?" (no ticker named). CLAIMED: not
    intercepted -- the model answers it. DID: exactly one model call."""
    client = model([emits(env(1, [], disposition="unsupported",
                              reply="Not yet: it reads this chart's own symbol."))])
    body = http.post(ENDPOINT, json={"message": "Can this use another symbol?", "view": ema_view(1),
                                     "chart": {"sym": "AAPL", "tf": "D"}}).json()
    assert body["ok"] is True and body["disposition"] == "unsupported" and len(client.calls) == 1


def test_PREFLIGHT_without_a_chart_never_guesses_a_lone_ticker(conv, model, http):
    client = model([emits(env(1, [], disposition="answer", reply="ok"))])
    body = http.post(ENDPOINT, json={"message": "use SPY", "view": ema_view(1)}).json()
    assert body["ok"] is True and len(client.calls) == 1


def test_the_router_bounds_the_chart_field(conv, model, http):
    """Only {sym, tf} strings ride along, each cut to 24 characters."""
    model([])
    body = http.post(ENDPOINT, json={"message": "use SPY", "view": ema_view(1),
                                     "chart": {"sym": "AAPL", "tf": "D", "secret": {"x": 1}}}).json()
    assert body["gate"] == "unsupported:other-symbol"


def test_the_SHARED_case_table(conv):
    """Every pinned case, the same verdict the browser's preflight.js gives."""
    from api.services import conversation_preflight as cp
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 30
    for c in cases:
        got = cp.check(c["message"], c["chart"])
        assert (got["gate"] if got else None) == c["gate"], c


def test_the_backend_gates_REMAIN_behind_the_preflight(conv, model, http):
    """ASKED: a request the preflight cannot see, answered with a sym tree. CLAIMED:
    the post-call gate still refuses it (the backend stays authoritative)."""
    from tests.test_p2_truth_server import SYM_TREE
    client = model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": SYM_TREE}],
                              disposition="change", reply="x"))])
    body = http.post(ENDPOINT, json={"message": "make it relative strength", "view": ema_view(1),
                                     "chart": {"sym": "AAPL", "tf": "D"}}).json()
    assert body["ok"] is False and body["gate"] == "unsupported:node" and len(client.calls) == 1
