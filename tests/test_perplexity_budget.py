"""2026-09-09 cost-spike hardening — the daily request budget, the widened
retry/backoff, and the PerplexityClient(ticker, prompt) convenience.

Born from a real incident: ~$42 spent on Perplexity in one day (vs. a
~$1-2/day baseline) with no single call site responsible — several features
each individually gated by an on/off flag or their own small $ cap (or
nothing), never by a shared total, and some of those per-feature guards were
plain in-process counters that reset on every redeploy. This file exercises
the new cross-surface, durable, request-COUNT backstop added to
web_search()/stream_search() in perplexity_search.py, which every existing
call site inherits automatically (no other file changed).

Budget enforcement is normally SKIPPED under pytest (see
pplx._check_daily_budget's docstring) — every test below that exercises the
gate itself sets PERPLEXITY_TEST_ENFORCE_BUDGET=1 to opt back in, and mocks
narrative_cost_guard.calls_today() directly rather than hitting a real DB, so
these tests are fast, deterministic, and can never accumulate rows that
would affect a later, unrelated test in the same pytest session.
"""
import asyncio

import pytest
import requests

import api.services.narrative_cost_guard as guard
import api.services.perplexity_search as pplx


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    pplx._SEARCH_CACHE.clear() if hasattr(pplx._SEARCH_CACHE, "clear") else None
    yield
    pplx._SEARCH_CACHE.clear() if hasattr(pplx._SEARCH_CACHE, "clear") else None


class _FakeResp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            err = requests.HTTPError(f"{self.status_code} error")
            err.response = self
            raise err

    def json(self):
        return self._payload


_OK = {"choices": [{"message": {"content": "answer text"}}], "citations": []}


def _enforce(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_TEST_ENFORCE_BUDGET", "1")


# ── the pytest-skip guard itself ────────────────────────────────────────────
def test_budget_enforcement_is_off_by_default_under_pytest(monkeypatch):
    """Without opting in, a mocked way-over-limit ledger must NOT refuse —
    otherwise hundreds of unrelated Perplexity-calling tests sharing one
    pytest session would eventually start failing each other."""
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 10_000)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "1")
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, _OK))
    out = pplx.web_search("budget skip probe", cache_salt="budget-skip-1")
    assert out.get("answer") == "answer text"


# ── refuse / allow / warn ───────────────────────────────────────────────────
def test_budget_refuses_at_the_limit(monkeypatch):
    _enforce(monkeypatch)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "10")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 10)
    calls = {"n": 0}

    def _post(*a, **k):
        calls["n"] += 1
        return _FakeResp(200, _OK)

    monkeypatch.setattr(pplx.requests, "post", _post)
    out = pplx.web_search("budget refuse probe", cache_salt="budget-refuse-1")
    assert out.get("error") and "budget" in out["error"].lower()
    assert not out.get("answer")
    assert calls["n"] == 0, "a refused call must never reach the network"


def test_budget_refuses_over_the_limit(monkeypatch):
    _enforce(monkeypatch)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "10")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 11)
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, _OK))
    out = pplx.web_search("budget over probe", cache_salt="budget-over-1")
    assert out.get("error") and "budget" in out["error"].lower()


def test_budget_allows_calls_under_the_limit(monkeypatch):
    _enforce(monkeypatch)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "500")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 5)
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, _OK))
    out = pplx.web_search("budget allow probe", cache_salt="budget-allow-1")
    assert out.get("answer") == "answer text"


def test_budget_warns_but_still_allows_at_80_percent(monkeypatch, caplog):
    _enforce(monkeypatch)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "10")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 8)  # exactly 80%
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, _OK))
    with caplog.at_level("WARNING"):
        out = pplx.web_search("budget warn probe", cache_salt="budget-warn-1")
    assert out.get("answer") == "answer text"
    assert any("80%" in r.message or "budget at" in r.message for r in caplog.records)


def test_budget_check_fails_open_on_a_broken_ledger(monkeypatch):
    """A telemetry read failure must never itself become an outage."""
    _enforce(monkeypatch)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "1")

    def _boom(prefix):
        raise RuntimeError("ledger unavailable")

    monkeypatch.setattr(guard, "calls_today", _boom)
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, _OK))
    out = pplx.web_search("budget fail-open probe", cache_salt="budget-failopen-1")
    assert out.get("answer") == "answer text"


def test_cache_hit_bypasses_the_budget_check_entirely(monkeypatch):
    """A cache hit costs nothing — it must never be refused, even if the
    (mocked) ledger says today's budget is fully spent."""
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, _OK))
    warm = pplx.web_search("cache warm probe", cache_salt="budget-cache-1")
    assert warm.get("answer") == "answer text" and not warm.get("cached")

    _enforce(monkeypatch)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "1")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 999)

    def _should_not_be_called(*a, **k):
        raise AssertionError("cache hit must not reach the network")

    monkeypatch.setattr(pplx.requests, "post", _should_not_be_called)
    hit = pplx.web_search("cache warm probe", cache_salt="budget-cache-1")
    assert hit.get("answer") == "answer text" and hit.get("cached") is True


# ── stream_search() gets the same gate ──────────────────────────────────────
def test_stream_search_is_also_budget_gated(monkeypatch):
    _enforce(monkeypatch)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "1")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 1)

    async def go():
        return [ev async for ev in pplx.stream_search(
            "stream budget probe", cache_salt="budget-stream-1")]

    events = asyncio.run(go())
    assert len(events) == 1 and events[0]["type"] == "error"
    assert "budget" in events[0]["error"].lower()


# ── limit resolution ─────────────────────────────────────────────────────────
def test_default_daily_limit_is_500(monkeypatch):
    monkeypatch.delenv("PERPLEXITY_DAILY_LIMIT", raising=False)
    assert pplx._daily_limit() == 500


def test_daily_limit_env_override(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "42")
    assert pplx._daily_limit() == 42


def test_daily_limit_ignores_junk_and_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "not-a-number")
    assert pplx._daily_limit() == 500
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "0")
    assert pplx._daily_limit() == 500


def test_get_daily_status_shape(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "100")
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 25)
    status = pplx.get_daily_status()
    assert status == {"calls_today": 25, "limit": 100, "remaining": 75, "pct": 25.0}


# ── retry: widened to 3 retries (4 attempts), exponential backoff ──────────
def test_retries_up_to_three_times_before_giving_up(monkeypatch):
    calls = {"n": 0}

    def _dead(*a, **k):
        calls["n"] += 1
        return _FakeResp(503)

    monkeypatch.setattr(pplx.requests, "post", _dead)
    out = pplx.web_search("retry exhaustion probe", cache_salt="retry-exhaust-1")
    assert calls["n"] == 4, calls  # 1 initial + 3 retries
    assert out.get("error")


def test_succeeds_on_the_fourth_attempt(monkeypatch):
    calls = {"n": 0}

    def _flaky(*a, **k):
        calls["n"] += 1
        return _FakeResp(503) if calls["n"] < 4 else _FakeResp(200, _OK)

    monkeypatch.setattr(pplx.requests, "post", _flaky)
    out = pplx.web_search("retry fourth-attempt probe", cache_salt="retry-4th-1")
    assert out.get("answer") == "answer text"
    assert calls["n"] == 4


def test_backoff_is_exponential(monkeypatch):
    sleeps = []
    monkeypatch.setattr(pplx.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(503))
    pplx.web_search("backoff shape probe", cache_salt="retry-backoff-1")
    assert sleeps == [0.5, 1.0, 2.0], sleeps


def test_4xx_still_never_retries_with_the_wider_budget(monkeypatch):
    calls = {"n": 0}

    def _dead(*a, **k):
        calls["n"] += 1
        return _FakeResp(400)

    monkeypatch.setattr(pplx.requests, "post", _dead)
    out = pplx.web_search("4xx no-retry probe", cache_salt="retry-4xx-1")
    assert calls["n"] == 1
    assert out["error"] == "request failed (400)"


# ── PerplexityClient ─────────────────────────────────────────────────────────
def test_client_ask_returns_an_answer(monkeypatch):
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: _FakeResp(200, _OK))
    client = pplx.PerplexityClient(cost_surface="test_feature")
    out = client.ask("what moved NVDA today", ticker="NVDA")
    assert out["answer"] == "answer text"


def test_client_ask_caches_by_ticker_and_prompt_for_60_minutes(monkeypatch):
    calls = {"n": 0}

    def _post(*a, **k):
        calls["n"] += 1
        return _FakeResp(200, _OK)

    monkeypatch.setattr(pplx.requests, "post", _post)
    client = pplx.PerplexityClient(cost_surface="test_feature")
    client.ask("what's the catalyst", ticker="AAPL")
    client.ask("what's the catalyst", ticker="AAPL")   # same (ticker, prompt) -> cache hit
    assert calls["n"] == 1

    # web_search() also writes the last-known-good SHADOW entry
    # (_save_shadow, TTL=86400) right after the primary cache write, so
    # capture every .set() call rather than just the last one — the primary
    # write (this test's concern) must use the 60-min override; the shadow
    # write is unrelated and expected to keep its own 24h TTL.
    ttls_used = []
    orig_set = pplx._SEARCH_CACHE.set

    def _spy_set(key, value, ttl):
        ttls_used.append(ttl)
        return orig_set(key, value, ttl)

    monkeypatch.setattr(pplx._SEARCH_CACHE, "set", _spy_set)
    client.ask("a brand new question", ticker="AAPL")
    assert pplx.PerplexityClient.DEFAULT_TTL_SECONDS == 3600
    assert 3600 in ttls_used, ttls_used


def test_client_ask_does_not_collide_across_different_tickers(monkeypatch):
    calls = {"n": 0}

    def _post(*a, **k):
        calls["n"] += 1
        return _FakeResp(200, _OK)

    monkeypatch.setattr(pplx.requests, "post", _post)
    client = pplx.PerplexityClient(cost_surface="test_feature")
    client.ask("what's the catalyst today", ticker="AAPL")
    client.ask("what's the catalyst today", ticker="MSFT")
    assert calls["n"] == 2, "different tickers must not share a cache entry"


def test_client_daily_status_matches_module_function(monkeypatch):
    monkeypatch.setattr(guard, "calls_today", lambda prefix: 3)
    monkeypatch.setenv("PERPLEXITY_DAILY_LIMIT", "50")
    assert pplx.PerplexityClient.daily_status() == pplx.get_daily_status()
