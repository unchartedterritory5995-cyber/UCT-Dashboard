"""UCT Agent — post-release regressions (owner production test 2026-10-13 00:11–00:18 ET, prod 0bd6621548).

Root cause, from the production logs: every model call (10 Agent turns + 1 formula-assistant call) was
refused by the model API with HTTP 400 "Your credit balance is too low to access the Anthropic API" —
an account condition, not a request-shape fault. Pinned here:
  · a provider failure reaches the member as ONE short sentence, never an exception class name;
  · "% of stocks BELOW a moving average" is the stored measure's exact complement (strict close > MA,
    same denominator, 0.1 rounding ⇒ share AT OR BELOW = 100 − above), labelled so — finalized and
    current — and refused (not guessed) for comparisons / ranges / non-MA measures;
  · the side never reaches Market Intelligence and the model's note carries names only;
  · the new follow-up wording counts as a breadth follow-up (no web research).
Synthetic values only; no model call, no network, no production data.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services.market_intel import breadth_reads
from api.services.uct_agent import breadth_now, breadth_present, turn
from tests.test_uct_agent import make_client  # noqa: F401 -- the turn route's own fixture
from tests.test_uct_agent_breadth_current import (  # noqa: F401 -- the shared synthetic worlds
    ADMIN, BASE, FIN, LIVE, LIVE_LEAKS, live, world,
)


def _exc(name: str, message: str = "", status: int | None = None) -> Exception:
    e = type(name, (Exception,), {})(message)
    e.message = message
    if status is not None:
        e.status_code = status
    return e


# ═══ 1 · a model-provider failure is a sentence, never a class name ═══════════════════════════════

CREDIT = ("Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': "
          "'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'}}")


@pytest.mark.parametrize("exc, kind, said", [
    (_exc("BadRequestError", CREDIT, 400), "account", rx.PROVIDER_DOWN),            # 2026-10-13 production
    (_exc("BadRequestError", "Your credit balance is too low to access the API.", 400), "account", rx.PROVIDER_DOWN),
    (_exc("AuthenticationError", "invalid x-api-key", 401), "account", rx.PROVIDER_DOWN),
    (_exc("PermissionDeniedError", "", 403), "account", rx.PROVIDER_DOWN),
    (_exc("RateLimitError", "", 429), "busy", rx.PROVIDER_BUSY),
    (_exc("OverloadedError", "", 529), "busy", rx.PROVIDER_BUSY),
    (_exc("InternalServerError", "", 500), "busy", rx.PROVIDER_BUSY),
    (_exc("APIConnectionError", "connection reset"), "network", rx.PROVIDER_DOWN),
    (_exc("APITimeoutError", "timed out"), "network", rx.PROVIDER_DOWN),
    (_exc("BadRequestError", "invalid schema", 400), "other", rx.PROVIDER_FAILED),   # a real request fault
    (ValueError("x"), "other", rx.PROVIDER_FAILED),
])
def test_PROVIDER_failure_kind_and_sentence(exc, kind, said):
    assert rx.provider_failure(exc) == (kind, said)


def test_PROVIDER_sentences_are_short_name_no_internals_and_say_nothing_changed():
    for s in (rx.PROVIDER_DOWN, rx.PROVIDER_BUSY, rx.PROVIDER_FAILED):
        assert len(s) <= 110 and "nothing was changed" in s
        assert not any(w in s for w in ("Error", "(", "model", "Anthropic", "credit", "400"))


def test_PROVIDER_the_turn_route_says_the_sentence_and_logs_the_class(make_client, monkeypatch, caplog):
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)

    def credit(**kw):
        raise _exc("BadRequestError", CREDIT, 400)
    monkeypatch.setattr(turn, "_default_caller", credit)
    with caplog.at_level("ERROR"):
        r = make_client(ADMIN).post("/api/agent/turn", json={"message": "color every inside candle white",
                                                             "context": {"surface": "charts", "charts": []}})
    assert r.status_code == 503 and r.json()["detail"] == rx.PROVIDER_DOWN
    assert "BadRequestError" not in r.text and "credit" not in r.text
    # the diagnostic channel keeps the class and kind (the server log), never the member's words
    rec = [x for x in caplog.records if "turn failed" in x.getMessage()]
    assert rec and "kind=account" in rec[0].getMessage() and "class=BadRequestError" in rec[0].getMessage()
    assert "inside candle" not in rec[0].getMessage()


# ═══ 2 · "% BELOW a moving average" — the measure's own complement ════════════════════════════════

@pytest.fixture
def client(world):
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[rx.require_admin_dark] = lambda: ADMIN
    return TestClient(app)


def ask(client, **kw):
    return client.post("/api/agent/breadth", json={**BASE, "mode": "value", "metrics": ["pct_above_50sma"], "side": None, **kw}).json()


def _pct(s: str) -> float:
    return float(s.rstrip("%"))


def test_BELOW_finalized_is_100_minus_above_labelled_at_or_below(client, monkeypatch):
    monkeypatch.delenv("AGENT_BREADTH_CURRENT", raising=False)
    above, below = ask(client), ask(client, side="below")
    assert above["present"]["label"] == "US · % of Stocks Above 50-Day MA"
    assert below["present"]["label"] == "US · % of Stocks At or Below 50-Day MA"
    assert round(_pct(above["present"]["value"]) + _pct(below["present"]["value"]), 1) == 100.0
    assert below["present"]["note"].startswith(f"As of {FIN} close")
    assert "At or Below" in below["text"] and "Above 50-Day" not in below["text"]


def test_BELOW_current_reading_is_complemented_with_its_own_time_label(client, live):
    above, below = ask(client), ask(client, side="below")
    assert above["present"]["value"] == "61.2%"
    assert below["present"] == {"kind": "value", "value": "38.8%", "label": "US · % of Stocks At or Below 50-Day MA",
                                "note": "Intraday · 11:51 AM ET"}
    assert round(_pct(above["present"]["value"]) + _pct(below["present"]["value"]), 1) == 100.0


@pytest.mark.parametrize("extra", [
    {"mode": "compare", "compare_date": "2026-10-01"},
    {"mode": "series", "start": "2026-09-01"},
    {"metrics": ["net_new_high_low"]},
    {"metrics": ["pct_above_50sma", "adv_decline"]},
    {"metrics": []},
])
def test_BELOW_is_refused_where_a_complement_is_not_exact(client, extra):
    b = ask(client, side="below", **extra)
    assert b["status"] == "refused" and b["present"] == {"kind": "error", "text": breadth_present.BELOW_REFUSAL}
    assert b["table"] is None


def test_BELOW_never_reaches_market_intelligence(client, monkeypatch):
    seen = []
    real = breadth_reads.read
    monkeypatch.setattr(breadth_reads, "read", lambda req: (seen.append(dict(req)), real(req))[1])
    ask(client, side="below")
    ask(client)
    assert seen and all("side" not in r for r in seen)


def test_BELOW_complement_helpers_are_exact_and_leave_other_measures_alone():
    res = {"metrics": [{"metric": "pct_above_200sma", "label": "% of Stocks Above 200-Day MA", "status": "ok",
                        "value": 40.0, "prior_value": 26.2},
                       {"metric": "pct_above_50sma", "label": "% of Stocks Above 50-Day MA", "status": "no_data"}]}
    out = breadth_present.complement(res)
    assert out["metrics"][0] == {"metric": "pct_above_200sma", "label": "% of Stocks At or Below 200-Day MA",
                                 "status": "ok", "value": 60.0, "prior_value": 73.8}
    assert out["metrics"][1]["label"] == "% of Stocks At or Below 50-Day MA" and "value" not in out["metrics"][1]
    assert res["metrics"][0]["value"] == 40.0                                  # MI's result is never mutated
    rd = breadth_present.complement_reading(lambda u, m: {"ok": True, "value": 26.2, "label": "x"})
    assert rd("us", "pct_above_50sma")["value"] == 73.8
    raw = breadth_present.complement_reading(lambda u, m: {"ok": True, "value": LIVE, "label": "x"})
    assert raw("us", "pct_above_50sma")["value"] == 38.8                    # 0.1, like the stored measure
    assert rd("us", "net_new_high_low")["value"] == 26.2
    assert breadth_present.complement_reading(None) is None


def test_BELOW_the_models_note_says_the_side_by_name_only(client, live):
    req = {**BASE, "mode": "value", "metrics": ["pct_above_50sma"], "side": "below"}
    note = turn._local_requests({"requests": [req]})
    assert "pct_above_50sma — share at or below" in note and "the current reading" in note
    assert not any(s in note for s in LIVE_LEAKS + ("38.8",))


# ═══ 3 · the new follow-up wording is a breadth follow-up (never web research) ════════════════════

@pytest.mark.parametrize("msg", [
    "what about the nasdaq", "how about NYSE stocks", "how long was it below 10%",
    "how long did it stay below 10%?", "And how many are below it?",
    "When was the last time fewer than 10% were above?",
])
def test_FOLLOWUP_wording_is_recognised(msg):
    assert turn._HISTORY_FOLLOWUP.search(msg)


@pytest.mark.parametrize("msg", ["what about NVDA", "how long is the earnings call", "how many shares are outstanding"])
def test_FOLLOWUP_wording_is_not_over_broad(msg):
    assert not turn._HISTORY_FOLLOWUP.search(msg)
