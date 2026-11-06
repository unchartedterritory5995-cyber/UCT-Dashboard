"""The two options-flow lanes keep their SDK retries, so a failed call may be up to three billed attempts.

Both wrote $0 for one, which left their $5 daily caps unreachable by a run of timeouts. A failure with no
usage now charges worst case x (retries + 1) on the lane's existing ledger; an HTTP error response stays
free. Retries and the calls themselves are unchanged. Every test here runs on mocks: nothing is sent.
"""
from __future__ import annotations

import inspect
from datetime import datetime
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.flow_explain as fe
from api import schwab_router
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import engine, market_narrative_swr, narrative_cost_guard
from api.services.cache import cache
from api.services.uct_agent import budget

REQUEST = httpx.Request("POST", "https://example.invalid/v1/messages")
ATTEMPTS = anthropic.DEFAULT_MAX_RETRIES + 1
HTTP_ERROR = anthropic.InternalServerError("x", response=httpx.Response(500, request=REQUEST), body=None)
TIMEOUT = anthropic.APITimeoutError(REQUEST)
DROPPED = anthropic.APIConnectionError(request=REQUEST)
NARRATIVE = "schwab_market_narrative"
MODEL = "claude-sonnet-4-6"


class FakeClient:
    def __init__(self, outcome):
        self.outcome, self.calls = outcome, []
        self.messages = SimpleNamespace(create=self.create)

    def with_options(self, **_kw):
        return self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@pytest.fixture
def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("FLOW_EXPLAIN_DB_PATH", str(tmp_path / "flow_explain.db"))
    monkeypatch.delenv("FLOW_EXPLAIN_DAILY_CAP_USD", raising=False)
    monkeypatch.delenv("FLOW_EXPLAIN_USER_DAILY_CAP", raising=False)
    monkeypatch.delenv("FLOW_EXPLAIN_MODEL", raising=False)
    monkeypatch.setattr(engine, "get_earnings", lambda: {"bmo": [], "amc": [], "amc_tonight": []})
    monkeypatch.setattr(fe, "get_cached_gex", lambda _t: None)
    for store in (fe._MEM_CACHE, fe._MEM_COSTS, fe._MEM_USER_COUNTS, fe._init_paths):
        store.clear()
    app = FastAPI()
    app.include_router(fe.router)
    paid = {"id": "u", "email": "t@example.com", "role": "user", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: dict(paid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
    http = TestClient(app)

    def ask(outcome, ticker="NVDA"):
        fake = FakeClient(outcome)
        monkeypatch.setattr(engine, "_get_anthropic_client", lambda: fake)
        body = {"ticker": ticker, "cp": "C", "strike": 190.0, "exp": "2026-08-21", "dte": 46, "premium": 525000.0,
                "volume": 3200, "oi": 1100, "side": "ASK", "spot": 178.4}
        response = http.post("/api/flow-explain", json=body)
        assert response.status_code == 200 and response.json()["model"] == fe._FALLBACK_MODEL_NAME
        return fake
    yield ask
    for store in (fe._MEM_CACHE, fe._MEM_COSTS, fe._MEM_USER_COUNTS):
        store.clear()


def _spent() -> float:
    return fe._spend_today(fe._today_et())


@pytest.mark.parametrize("failure", [TIMEOUT, DROPPED, RuntimeError("no response")],
                         ids=["timeout", "dropped", "other"])
def test_FLOW_a_failed_call_charges_the_worst_case_of_every_sdk_attempt(flow, failure):
    fake = flow(failure)
    assert len(fake.calls) == 1
    assert _spent() == pytest.approx(budget.worst_case_usd(fake.calls[0]) * ATTEMPTS)


def test_FLOW_an_http_error_response_stays_free(flow):
    flow(HTTP_ERROR)
    assert _spent() == 0


def test_FLOW_an_empty_reply_charges_what_it_reported(flow):
    flow(SimpleNamespace(content=[], usage=SimpleNamespace(input_tokens=1000, output_tokens=100)))
    assert _spent() == pytest.approx(fe._estimate_cost_usd(fe._model_name(), 1000, 100))


def test_FLOW_no_client_means_no_call_and_no_charge(flow, monkeypatch):
    def missing():
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    monkeypatch.setattr(fe, "_anthropic", missing)
    with pytest.raises(RuntimeError):
        fe._call_llm(None, {})
    assert _spent() == 0


def test_FLOW_timeouts_now_reach_the_daily_cap_and_stop_the_calls(flow, monkeypatch):
    """Before: endless timeouts recorded $0, so the cap never tripped. The cap value is unchanged."""
    monkeypatch.setenv("FLOW_EXPLAIN_DAILY_CAP_USD", "0.20")
    with_calls = []
    for i in range(10):
        with_calls.append(flow(TIMEOUT, ticker=f"T{i}"))
    made = sum(len(f.calls) for f in with_calls)
    one = budget.worst_case_usd(with_calls[0].calls[0]) * ATTEMPTS
    assert made == int(0.20 / one) + 1 and made < 10


def test_FLOW_the_charge_does_not_change_the_call(flow):
    src = inspect.getsource(fe._anthropic)
    assert "with_options(timeout=_LLM_TIMEOUT_SECS)" in src and "max_retries" not in src
    assert fe._MAX_TOKENS == 400 and fe._LLM_TIMEOUT_SECS == 30.0
    assert fe._daily_cap_usd() == 5.0 and fe._user_daily_cap() == 50
    kwargs = flow(TIMEOUT).calls[0]
    assert sorted(kwargs) == ["max_tokens", "messages", "model", "system"]


def _narrative_key():
    return market_narrative_swr.cache_key(datetime.now())


@pytest.fixture
def narrative(monkeypatch):
    narrative_cost_guard._reset_for_test(NARRATIVE)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    monkeypatch.delenv("SCHWAB_NARRATIVE_COST_CAP_DAILY", raising=False)
    cache.invalidate(_narrative_key())
    built = {}

    def run(outcome):
        fake = FakeClient(outcome)

        def build(**kw):
            built.update(kw)
            return fake
        monkeypatch.setattr(anthropic, "Anthropic", build)
        return fake, inspect.unwrap(schwab_router.market_narrative)(_auth={})
    run.built = built
    yield run
    narrative_cost_guard._reset_for_test(NARRATIVE)
    cache.invalidate(_narrative_key())


def _worst() -> float:
    n = schwab_router._NARRATIVE_SDK_ATTEMPTS
    return narrative_cost_guard.estimate_cost(
        MODEL, schwab_router._NARRATIVE_WORST_INPUT_TOKENS * n, schwab_router._NARRATIVE_MAX_TOKENS * n,
        schwab_router._NARRATIVE_WORST_SEARCHES * n)


@pytest.mark.parametrize("failure", [TIMEOUT, DROPPED], ids=["timeout", "dropped"])
def test_NARRATIVE_a_failed_call_charges_every_sdk_attempt(narrative, failure):
    fake, out = narrative(failure)
    assert out.status_code == 500 and len(fake.calls) == 1
    assert narrative_cost_guard.spend_today_usd(NARRATIVE) == pytest.approx(_worst())


def test_NARRATIVE_an_http_error_response_stays_free(narrative):
    _, out = narrative(HTTP_ERROR)
    assert out.status_code == 500
    assert narrative_cost_guard.spend_today_usd(NARRATIVE) == 0


def test_NARRATIVE_a_failure_after_the_reply_is_not_charged_twice(narrative):
    """`content=None` fails after the usage was recorded: one row at its usage, no worst case on top."""
    _, out = narrative(SimpleNamespace(content=None, usage=SimpleNamespace(input_tokens=1000, output_tokens=100)))
    assert out.status_code == 500
    assert narrative_cost_guard.calls_today_for_surface(NARRATIVE) == 1
    assert narrative_cost_guard.spend_today_usd(NARRATIVE) == pytest.approx(
        narrative_cost_guard.estimate_cost(MODEL, 1000, 100))


def test_NARRATIVE_a_success_is_still_charged_from_its_usage(narrative):
    reply = SimpleNamespace(content=[SimpleNamespace(text="Stocks closed higher.")],
                            usage=SimpleNamespace(input_tokens=1000, output_tokens=100))
    fake, out = narrative(reply)
    assert out == {"narrative": "Stocks closed higher."}
    assert fake.calls[0]["max_tokens"] == 250
    assert narrative_cost_guard.spend_today_usd(NARRATIVE) == pytest.approx(
        narrative_cost_guard.estimate_cost(MODEL, 1000, 100))


def test_NARRATIVE_keeps_its_sdk_retries_and_the_count_matches_the_charge(narrative):
    narrative(TIMEOUT)
    assert "max_retries" not in narrative.built
    assert schwab_router._NARRATIVE_SDK_ATTEMPTS == ATTEMPTS
    assert narrative_cost_guard.cap_usd() == narrative_cost_guard.DEFAULT_CAP_USD == 5.0
