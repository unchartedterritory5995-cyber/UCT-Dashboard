"""Perplexity is limited by a call count; this adds the dollars, per request type, and closes the count's race.

A timeout was priced from no usage, so it cost the $0.006 fee and the day's dollars read low exactly when the
provider was slowest. No dollar STOP exists here and none is added: the two call counts are the only stops.

Mocks only: `requests.post` is a stub, and nothing is sent.
"""
from __future__ import annotations

import asyncio
import threading

import httpx
import pytest
import requests

from api.services import narrative_cost_guard as guard
from api.services import perplexity_search as pplx

SURFACE = "dollartest"


class Reply:
    def __init__(self, payload):
        self.status_code, self.payload = 200, payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def answer(tokens_in=100, tokens_out=50):
    return Reply({"choices": [{"message": {"content": "an answer"}}],
                  "usage": {"prompt_tokens": tokens_in, "completion_tokens": tokens_out}})


@pytest.fixture
def ask(monkeypatch):
    monkeypatch.setenv("PERPLEXITY_API_KEY", "k")
    monkeypatch.setenv("PERPLEXITY_TEST_ENFORCE_BUDGET", "1")
    monkeypatch.setenv(pplx._SURFACE_LIMITS_ENV, "")
    monkeypatch.delenv("PPLX_REQUEST_FEE_USD", raising=False)
    monkeypatch.setattr(pplx.time, "sleep", lambda s: None)
    guard._reset_for_test()
    pplx._slots.clear()
    pplx._SEARCH_CACHE.clear()
    n = [0]

    def run(mode="fast", surface=SURFACE):
        n[0] += 1
        return pplx.web_search(query=f"q{n[0]}", mode=mode, cost_surface=surface)
    yield run
    guard._reset_for_test()
    pplx._slots.clear()


def test_a_timed_out_attempt_is_priced_at_its_worst_case_not_the_fee(ask, monkeypatch):
    monkeypatch.setattr(pplx, "_MAX_RETRIES", 0)
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: (_ for _ in ()).throw(requests.Timeout()))
    assert "timeout" in ask()["error"]
    max_tokens = pplx._effective_max_tokens("fast", 400)
    assert guard.spend_today_usd(f"pplx:{SURFACE}") >= 0.006 + max_tokens * 15.0 / 1e6


def test_every_timed_out_attempt_is_a_row_with_its_dollars(ask, monkeypatch):
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: (_ for _ in ()).throw(requests.Timeout()))
    ask()
    assert guard.calls_today(f"pplx:{SURFACE}") == pplx._MAX_RETRIES + 1
    one = guard.spend_today_usd(f"pplx:{SURFACE}") / (pplx._MAX_RETRIES + 1)
    assert one > 0.006


def test_a_call_that_reports_usage_is_still_priced_from_it(ask, monkeypatch):
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: answer(1000, 200))
    assert ask()["answer"]
    assert guard.spend_today_usd(f"pplx:{SURFACE}") == pytest.approx(1000 * 3.0 / 1e6 + 200 * 15.0 / 1e6 + 0.006)


def test_the_status_reports_the_days_dollars_per_request_type(ask, monkeypatch):
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: answer(1000, 200))
    ask("fast")
    ask("fast")
    ask("reasoning")
    st = pplx.get_daily_status()
    assert st["by_request_type"]["sonar-pro"]["calls"] == 2
    assert st["by_request_type"]["sonar-reasoning-pro"]["calls"] == 1
    assert st["dollars_today"] == pytest.approx(sum(t["usd"] for t in st["by_request_type"].values()))
    assert st["dollars_today"] > 0


def test_the_status_keeps_every_field_it_had(ask):
    st = pplx.get_daily_status()
    assert {"calls_today", "limit", "remaining", "pct", "surfaces"} <= set(st)
    assert st["dollars_today"] == 0 and st["by_request_type"] == {}


def test_a_ledger_read_failure_reports_nothing_rather_than_raising(ask, monkeypatch):
    monkeypatch.setattr(guard, "spend_by_model_today", lambda _p: (_ for _ in ()).throw(OSError("disk")))
    st = pplx.get_daily_status()
    assert st["dollars_today"] == 0 and st["by_request_type"] == {}


def test_no_dollar_stop_was_added(ask, monkeypatch):
    monkeypatch.setattr(pplx.requests, "post", lambda *a, **k: answer(10_000_000, 10_000_000))
    assert ask()["answer"]
    assert ask()["answer"]                     # hundreds of dollars on the ledger, and the count still decides


# ═══ check-then-call ═════════════════════════════════════════════════════════════════════════════
def test_racing_calls_cannot_all_pass_the_last_place(ask, monkeypatch):
    """Before: every thread read the same count, because a row only appears when its call returns."""
    monkeypatch.setenv(pplx._DAILY_LIMIT_ENV, "5")
    barrier, release, sent = threading.Barrier(20), threading.Event(), []

    def post(*a, **k):
        sent.append(1)
        assert release.wait(5)
        return answer()

    monkeypatch.setattr(pplx.requests, "post", post)
    results = []

    def one(i):
        barrier.wait()
        results.append(pplx.web_search(query=f"race{i}", cost_surface=SURFACE))

    threads = [threading.Thread(target=one, args=(i,)) for i in range(20)]
    [t.start() for t in threads]
    while sum(1 for t in threads if t.is_alive()) > 5:
        pass
    release.set()
    [t.join() for t in threads]
    assert len(sent) == 5 and sum(1 for r in results if r.get("budget_refused")) == 15
    assert not any(pplx._slots.values())


def test_the_per_surface_share_holds_under_the_same_race(ask, monkeypatch):
    monkeypatch.setenv(pplx._SURFACE_LIMITS_ENV, f"{SURFACE}=3")
    barrier, release, sent = threading.Barrier(10), threading.Event(), []

    def post(*a, **k):
        sent.append(1)
        assert release.wait(5)
        return answer()

    monkeypatch.setattr(pplx.requests, "post", post)

    def one(i):
        barrier.wait()
        pplx.web_search(query=f"share{i}", cost_surface=SURFACE)

    threads = [threading.Thread(target=one, args=(i,)) for i in range(10)]
    [t.start() for t in threads]
    while sum(1 for t in threads if t.is_alive()) > 3:
        pass
    release.set()
    [t.join() for t in threads]
    assert len(sent) == 3


@pytest.mark.parametrize("post", [lambda *a, **k: answer(), lambda *a, **k: (_ for _ in ()).throw(requests.Timeout())],
                         ids=["answered", "timed-out"])
def test_a_slot_is_given_back_on_every_exit(ask, monkeypatch, post):
    monkeypatch.setattr(pplx.requests, "post", post)
    ask()
    assert not any(pplx._slots.values())


def test_a_refused_call_holds_no_slot(ask, monkeypatch):
    monkeypatch.setenv(pplx._DAILY_LIMIT_ENV, "1")
    guard.record(f"pplx:{SURFACE}", "sonar-pro", cost_usd=0.01)
    assert ask()["budget_refused"] is True
    assert not any(pplx._slots.values())


def test_the_stream_gives_its_slot_back_when_abandoned(ask, monkeypatch):
    class Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("no network here")

    monkeypatch.setattr(httpx, "AsyncClient", Boom)          # the module itself: nothing can reach the network

    async def drain():
        return [e async for e in pplx.stream_search("q", cost_surface=SURFACE)]

    events = asyncio.run(drain())
    assert events[-1]["type"] == "error"
    assert not any(pplx._slots.values())


def test_a_nested_call_outside_web_search_never_holds_a_slot(ask, monkeypatch):
    """`_check_daily_budget` on its own (the budget tests call it directly) has nothing to release a slot."""
    assert pplx._check_daily_budget(SURFACE) is None
    assert not any(pplx._slots.values())
