"""A catalyst-ledger call that raised is charged, never recorded as $0.

A timeout reports no usage, so these lanes used to record nothing and the daily caps
never saw the call. Models are mocked; nothing here spends.
"""
from __future__ import annotations

import os
import tempfile
import time
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import anthropic
import httpx
import pytest

from api.services.catalyst import cost_guard, curator, hunter, rule_learner, store, synthesize

DAY = "2026-11-05"
REQUEST = httpx.Request("POST", "https://example.invalid/v1/messages")
TIMEOUT = anthropic.APITimeoutError(REQUEST)
HTTP_ERROR = anthropic.InternalServerError("overloaded", response=httpx.Response(529, request=REQUEST), body=None)
BODY = {"system": "s", "messages": [{"role": "user", "content": "p" * 100}], "max_tokens": 8000}


@pytest.fixture
def ledger(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield


def _spent(day=DAY):
    return sum(float(usd or 0.0) for _, usd in store.spend_by_ticker(day))


def _candidate():
    return {"ticker": "PL", "name": "Planet", "tweets": [], "rss": [], "tag": "GAPPER"}


def test_the_charge_is_the_worst_case_of_the_request(ledger):
    cost = cost_guard.charge_unreported_call(DAY, "PL", "claude-haiku-4-5", BODY, TIMEOUT)
    assert cost >= 8000 * 5.0 / 1_000_000            # every output token at the Haiku rate
    assert _spent() == pytest.approx(cost)


def test_an_http_error_is_free(ledger):
    assert cost_guard.charge_unreported_call(DAY, "PL", "claude-haiku-4-5", BODY, HTTP_ERROR) == 0.0
    assert _spent() == 0.0


def test_an_error_after_a_stream_began_is_charged(ledger):
    error = anthropic.APIStatusError("overloaded", response=httpx.Response(200, request=REQUEST), body=None)
    assert cost_guard.charge_unreported_call(DAY, "PL", "claude-haiku-4-5", BODY, error) > 0


def test_no_api_key_means_nothing_was_sent(ledger, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert cost_guard.charge_unreported_call(DAY, "PL", "claude-haiku-4-5", BODY, RuntimeError("no key")) == 0.0


def test_a_ledger_failure_does_not_raise(ledger, monkeypatch):
    def boom(**_kw):
        raise OSError("disk")
    monkeypatch.setattr(store, "log_cost", boom)
    assert cost_guard.charge_unreported_call(DAY, "PL", "claude-haiku-4-5", BODY, TIMEOUT) == 0.0


def test_a_synthesis_timeout_on_both_models_charges_both(ledger):
    with patch("api.services.catalyst.synthesize._call_anthropic", side_effect=TIMEOUT):
        out = synthesize.synthesize_ticker(_candidate(), DAY)
    assert out["thesis_status"] == "failed"
    rows = dict(store.spend_by_ticker(DAY))
    assert rows["PL"] >= (synthesize.SYNTH_MAX_TOKENS * 5.0 / 1_000_000) * 2   # at least two Haiku worst cases


def test_a_synthesis_http_error_stays_free(ledger):
    with patch("api.services.catalyst.synthesize._call_anthropic", side_effect=HTTP_ERROR):
        synthesize.synthesize_ticker(_candidate(), DAY)
    assert _spent() == 0.0


def test_charging_a_failure_makes_the_cap_reachable(ledger, monkeypatch):
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "1.00")
    monkeypatch.setenv("INTERACTIVE_AI_RESERVE_USD", "0.00")
    with patch("api.services.catalyst.synthesize._call_anthropic", side_effect=TIMEOUT) as call:
        for _ in range(100):
            synthesize.synthesize_ticker(_candidate(), DAY)
    assert cost_guard.may_synthesize(DAY) is False
    assert call.call_count < 200                     # the cap stopped it, not the loop


def test_the_no_sources_retry_timeout_is_charged_on_top(ledger):
    good = '{"thesis": "A write-up.", "tag": "GAPPER", "grade": "C", "catalyst_type": "None", "source_urls": []}'
    msg = SimpleNamespace(content=[SimpleNamespace(text=good)], stop_reason="end_turn")
    with patch("api.services.catalyst.synthesize._call_anthropic", side_effect=[(msg, 10, 10), TIMEOUT]):
        out = synthesize.synthesize_ticker(_candidate(), DAY)
    assert "No clear catalyst" in out["thesis_text"]
    assert _spent() > (10 + synthesize.SYNTH_MAX_TOKENS) * 1.0 / 1_000_000


def test_a_curator_timeout_is_charged_and_still_falls_back(ledger):
    pool = [{"ticker": f"T{i}", "score": 1.0} for i in range(8)]
    with patch.object(curator, "_call", side_effect=TIMEOUT), \
            patch.object(curator, "_build_prompt", return_value="prompt"), \
            patch.object(curator, "_enabled", return_value=True), \
            patch.object(curator.selection, "select_top_12", return_value=["mechanical"]):
        assert curator.curate(pool, market_date=DAY) == ["mechanical"]
    assert curator.last_fallback_reason(DAY).startswith("exception")
    assert dict(store.spend_by_ticker(DAY)).get("_CURATOR", 0) > 0


def test_a_rule_learner_timeout_is_charged(ledger, monkeypatch):
    client = MagicMock()
    client.messages.create.side_effect = TIMEOUT
    monkeypatch.setattr("api.services.engine._get_anthropic_client", lambda: client)
    assert rule_learner._call_llm("notes") is None
    day = time.strftime("%Y-%m-%d", time.gmtime())
    assert dict(store.spend_by_ticker(day)).get("_RULE_LEARNER", 0) > 0


def test_a_rule_learner_with_no_client_charges_nothing(ledger, monkeypatch):
    def no_client():
        raise OSError("no client")
    monkeypatch.setattr("api.services.engine._get_anthropic_client", no_client)
    assert rule_learner._call_llm("notes") is None
    assert _spent(time.strftime("%Y-%m-%d", time.gmtime())) == 0.0


def test_a_hunter_timeout_keeps_earlier_rounds_and_charges_the_last(ledger, monkeypatch):
    first = MagicMock(stop_reason="pause_turn", content=[])
    first.usage = MagicMock(input_tokens=1000, output_tokens=1000, cache_read_input_tokens=0,
                            cache_creation_input_tokens=0, server_tool_use=None)
    client = MagicMock()
    client.messages.create.side_effect = [first, TIMEOUT]
    monkeypatch.setattr("api.services.engine._get_anthropic_client", lambda: client)
    monkeypatch.setenv("CATALYST_HUNTER_ENABLED", "1")
    day = datetime.now(hunter._ET).date().isoformat()
    assert hunter.run_hunt("deep") == []
    rows = store.spend_by_ticker(day)
    assert client.messages.create.call_count == 2
    assert sum(float(u or 0) for t, u in rows if t == "__hunter__") > 8000 * 5.0 / 1_000_000
