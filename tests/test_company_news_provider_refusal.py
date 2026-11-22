"""The company-news poll when its provider refuses it.

WHY THIS FILE EXISTS (2026-11-14). On 2026-11-13 the provider cut the account off for
bandwidth, and every request came back 429. The poll's reaction made things worse in three
ways, none of which a test covered:

1. The probe that decides between the two-request global path and the 40-request
   per-symbol fallback read the refusal as "the global path does not exist" and CACHED
   that for the life of the process. So once access came back, the process went on
   spending 40 requests a cycle instead of two to four, until the next restart.
2. Having decided that, it answered a rate limit by sending the fallback's requests.
3. The fallback swallows a refusal per symbol, so a cycle in which EVERY request was
   refused was recorded as a healthy poll, and the feed read as fresh.

These drive `run_fmp_cycle` with `_get` replaced, and `_get` itself with a fake client.
"""
from __future__ import annotations

import contextlib
import os
import tempfile

import httpx
import pytest

from api.services.news import ingest, store
from api.services.news.adapters import fmp_news

LATEST = {fmp_news.STOCK_LATEST, fmp_news.PR_LATEST}
BY_SYMBOL = {fmp_news.STOCK_BY_SYMBOL, fmp_news.PR_BY_SYMBOL}
ROW = {"title": "Something happened", "url": "https://example.com/a"}


@pytest.fixture()
def calls(tmp_path, monkeypatch):
    store.set_db_path(str(tmp_path / "news.db"))
    fmp_news.reset_latest_cache()
    monkeypatch.setattr(ingest, "_active_universe", lambda limit, **k: ["A", "AA", "AAL"])
    seen: list = []
    yield seen
    fmp_news.reset_latest_cache()
    store.set_db_path(os.path.join(tempfile.gettempdir(), "unused_news.db"))


def _health() -> tuple:
    with contextlib.closing(store._connect()) as c:
        row = c.execute("SELECT state, last_ok, last_error FROM news_source_health WHERE source='fmp'").fetchone()
    return tuple(row) if row else ("", "", "")


def _refusing(seen):
    def get(path, params, budget=None):
        seen.append(path)
        raise fmp_news.FmpUnavailable(f"FMP {path} failed: 429", transient=True)
    return get


def test_a_refused_probe_skips_the_cycle_and_is_not_remembered(calls, monkeypatch):
    monkeypatch.setattr(fmp_news, "_get", _refusing(calls))
    out = ingest.run_fmp_cycle()
    assert out["mode"] == "skipped-provider-refusing" and out["items"] == 0 and "429" in out["error"]
    assert not [p for p in calls if p in BY_SYMBOL], "a rate limit was answered with the fallback's requests"
    assert len(calls) == 1, "one refused call is the answer; asking for the other lane only adds a second"
    state, last_ok, error = _health()
    assert state == "error" and not last_ok and "429" in error

    # The provider answers again. The refusal was never a fact about the global path, so the
    # very next cycle is back on it.
    def answering(path, params, budget=None):
        calls.append(path)
        return [ROW] if params.get("limit") == 5 else []
    monkeypatch.setattr(fmp_news, "_get", answering)
    calls.clear()
    out = ingest.run_fmp_cycle()
    assert out["mode"] == "global-latest" and calls and all(p in LATEST for p in calls)
    assert _health()[0] == "ok"


def test_a_definite_no_still_selects_the_fallback_and_is_remembered(calls, monkeypatch):
    """Control for the row above. "Not on your plan" IS a fact about the global path: the
    fallback is what it is for, and the answer is cached so it is not asked every cycle."""
    def not_on_plan(path, params, budget=None):
        calls.append(path)
        if path in LATEST:
            raise fmp_news.FmpUnavailable("FMP 403: plan or key issue")
        return []
    monkeypatch.setattr(fmp_news, "_get", not_on_plan)
    out = ingest.run_fmp_cycle()
    assert out["mode"] == "per-symbol-fallback"
    assert len([p for p in calls if p in LATEST]) == 2 and [p for p in calls if p in BY_SYMBOL]
    assert _health()[0] == "ok", "a fallback cycle that simply found nothing new is a healthy poll"
    calls.clear()
    ingest.run_fmp_cycle()
    assert not [p for p in calls if p in LATEST], "a definite answer is not asked again every cycle"


def test_a_fallback_cycle_that_was_refused_is_not_recorded_as_healthy(calls, monkeypatch):
    def fallback_refused(path, params, budget=None):
        calls.append(path)
        if path in LATEST:
            raise fmp_news.FmpUnavailable("FMP 403: plan or key issue")
        raise fmp_news.FmpUnavailable(f"FMP {path} failed: 429", transient=True)
    monkeypatch.setattr(fmp_news, "_get", fallback_refused)
    out = ingest.run_fmp_cycle()
    assert out["mode"] == "per-symbol-fallback" and out["items"] == 0 and "429" in out.get("error", "")
    state, last_ok, error = _health()
    assert state == "error" and not last_ok and "429" in error, "a cycle of refusals was recorded as a healthy poll"


class _FakeHttp:
    def __init__(self, steps):
        self.steps, self.calls = list(steps), 0

    def get(self, url, params=None):
        self.calls += 1
        step = self.steps.pop(0) if self.steps else 200
        if isinstance(step, Exception):
            raise step
        return httpx.Response(step, json=[ROW], request=httpx.Request("GET", url))


@pytest.mark.parametrize("steps, transient", [
    ([429, 429, 429], True),                                   # rate limited, or the bandwidth cut-off
    ([503, 503, 503], True),                                   # the provider is down
    ([httpx.ConnectError("reset")] * 3, True),                 # the network
    ([403], False),                                            # plan or key: asking again changes nothing
    ([402], False),                                            # not on the plan
    ([404], False),
])
def test_a_refusal_says_whether_it_can_clear(steps, transient, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "k")
    monkeypatch.setattr(fmp_news.time, "sleep", lambda s: None)
    fake = _FakeHttp(steps)
    monkeypatch.setattr(fmp_news, "_http", lambda: fake)
    with pytest.raises(fmp_news.FmpUnavailable) as e:
        fmp_news._get("/stable/news/stock-latest", {"limit": 5})
    assert e.value.transient is transient


def test_no_key_is_not_a_passing_condition(monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    with pytest.raises(fmp_news.FmpUnavailable) as e:
        fmp_news._get("/stable/news/stock-latest", {"limit": 5})
    assert e.value.transient is False
