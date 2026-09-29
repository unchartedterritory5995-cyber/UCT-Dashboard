"""Rails for TERM-070: `/api/schwab/market-narrative` serves its last good
answer while one refresh runs behind the member.

Two layers:

  * UNIT — `serve_last_good` wraps a fake handler that behaves like the
    partner's (checks the TTL cache, writes it only on a usable answer, returns
    a placeholder / a JSONResponse on failure). The dates and the failure clock
    are injected; the background refresh is gated on an Event, so "the member
    did not wait" is proven by ORDER, never by a wall-clock threshold.
  * WIRED — the real `api.main:app` route, with the Anthropic SDK replaced
    wholesale. Proves the decorator is on the route that ships and that a warm
    request never constructs an LLM client.

⛔ NO REAL CALL IS MADE to an LLM or any provider.
"""
from __future__ import annotations

import importlib
import json
import sys
import threading
import time
import types
from datetime import datetime

import pytest
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from api.services import market_narrative_swr as swr
from api.services import narrative_cost_guard
from api.services.cache import cache

DAY = datetime(2026, 9, 29, 10, 0)
NEXT_DAY = datetime(2026, 9, 30, 10, 0)
PLACEHOLDER = "Market summary unavailable."
_WAIT = 5.0


# ── helpers ──────────────────────────────────────────────────────────────────

def _body(resp) -> dict:
    return json.loads(bytes(resp.body))


def _tier(resp) -> str:
    timing = resp.headers.get("server-timing", "")
    assert timing.startswith("market-narrative;desc="), timing
    return timing.split('desc="', 1)[1].split('"', 1)[0]


def _stale_age_ms(resp) -> float:
    timing = resp.headers["server-timing"]
    return float(timing.split("stale-age;dur=", 1)[1])


def _wait_for_refresh_to_settle():
    deadline = time.monotonic() + _WAIT
    while time.monotonic() < deadline:
        with swr._STALE._lock:
            if not swr._STALE._refreshing:
                return
        time.sleep(0.01)
    raise AssertionError("the background refresh never finished")


class FakeHandler:
    """Behaves like the partner's handler in every way this module relies on:
    it reads the TTL cache first, writes it ONLY when it has usable text, and
    otherwise returns its placeholder or an error JSONResponse uncached."""

    def __init__(self):
        self.calls = 0
        self.mode = "ok"
        self.gate: threading.Event | None = None
        self.started = threading.Event()
        self._lock = threading.Lock()

    def __call__(self, _auth: dict | None = None):
        with self._lock:
            self.calls += 1
            n = self.calls
        self.started.set()
        if self.gate is not None:
            assert self.gate.wait(_WAIT), "fake upstream was never released"
        key = swr.cache_key(swr._now())
        cached = cache.get(key)
        if cached is not None:
            return {"narrative": cached}
        if self.mode == "ok":
            text = f"Stocks closed higher (build {n})."
            cache.set(key, text, ttl=1800)
            return {"narrative": text}
        if self.mode == "empty":
            return {"narrative": PLACEHOLDER}
        return JSONResponse(status_code=500, content={"error": "upstream down"})


@pytest.fixture
def today(monkeypatch):
    box = {"now": DAY}
    monkeypatch.setattr(swr, "_now", lambda: box["now"])
    return box


@pytest.fixture
def handler(today):
    h = FakeHandler()
    yield h
    if h.gate is not None:
        h.gate.set()
    _wait_for_refresh_to_settle()


@pytest.fixture
def route(handler):
    return swr.serve_last_good(handler)


def _lapse_ttl(day: datetime = DAY) -> None:
    """The handler's 30-minute TTL running out, without waiting 30 minutes."""
    cache.invalidate(swr.cache_key(day))


# ── cold start is unchanged ──────────────────────────────────────────────────

def test_cold_start_runs_the_handler_once_and_returns_its_answer(route, handler):
    resp = route(_auth={})

    assert handler.calls == 1
    assert resp.status_code == 200
    assert _body(resp) == {"narrative": "Stocks closed higher (build 1)."}
    assert _tier(resp) == "fetch"


def test_a_cold_failure_is_returned_exactly_as_the_handler_returned_it(route, handler):
    handler.mode = "error"
    resp = route(_auth={})
    assert resp.status_code == 500
    assert _body(resp) == {"error": "upstream down"}


# ── the slow dependency is not on a warm request ─────────────────────────────

def test_a_warm_request_never_calls_the_handler(route, handler):
    route(_auth={})
    handler.mode = "error"                      # would show if it were called

    resp = route(_auth={})

    assert handler.calls == 1, "a warm request re-ran the model call"
    assert _body(resp) == {"narrative": "Stocks closed higher (build 1)."}
    assert _tier(resp) == "mem"


def test_a_lapsed_ttl_is_answered_before_the_refresh_finishes(route, handler):
    """The member gets the last good narrative while the refresh is still
    BLOCKED upstream — proven by order, not by timing."""
    route(_auth={})
    _lapse_ttl()
    handler.gate = threading.Event()
    handler.started.clear()

    resp = route(_auth={})

    assert handler.started.wait(_WAIT), "no refresh was started behind the member"
    assert not handler.gate.is_set()            # the upstream is still blocked
    assert _body(resp) == {"narrative": "Stocks closed higher (build 1)."}
    assert _tier(resp) == "stale-swr"
    assert "stale-age;dur=" in resp.headers["server-timing"]

    handler.gate.set()
    _wait_for_refresh_to_settle()
    after = route(_auth={})
    assert _body(after) == {"narrative": "Stocks closed higher (build 2)."}
    assert _tier(after) == "mem"


# ── single-flight under concurrency ──────────────────────────────────────────

def _herd(route, n=8):
    """Start `n` concurrent callers; returns (threads, results, entered) where
    `entered` fills as each caller reaches the route."""
    out: list = [None] * n
    entered: list = []

    def _one(i):
        entered.append(i)
        out[i] = route(_auth={})

    threads = [threading.Thread(target=_one, args=(i,), daemon=True) for i in range(n)]
    for t in threads:
        t.start()
    return threads, out, entered


def test_a_cold_herd_collapses_onto_one_build(route, handler):
    handler.gate = threading.Event()
    threads, out, entered = _herd(route)
    assert handler.started.wait(_WAIT)
    time.sleep(0.2)                             # let the herd queue on the lock
    # Non-vacuity: every caller was inside the route while the one build was
    # still blocked upstream. Without that, "one call" could just mean the
    # callers arrived after it finished and hit the cache.
    assert len(entered) == 8 and not handler.gate.is_set()
    handler.gate.set()
    for t in threads:
        t.join(_WAIT)

    assert handler.calls == 1, f"{handler.calls} model calls for one cold herd"
    assert {json.dumps(_body(r)) for r in out} == {
        json.dumps({"narrative": "Stocks closed higher (build 1)."})}
    assert sorted(_tier(r) for r in out).count("fetch") == 1


def test_a_herd_behind_a_failed_cold_build_does_not_rerun_it(route, handler):
    """Single-flight alone SERIALISES waiters after a failure: each one takes
    the lock, finds nothing, and re-runs a call that can take the full
    request-path timeout. The negative memo hands them the failure instead."""
    handler.mode = "error"
    handler.gate = threading.Event()
    threads, out, entered = _herd(route, n=5)
    assert handler.started.wait(_WAIT)
    time.sleep(0.2)
    assert len(entered) == 5 and not handler.gate.is_set()
    handler.gate.set()
    for t in threads:
        t.join(_WAIT)

    assert handler.calls == 1, f"{handler.calls} model calls behind one failure"
    assert {r.status_code for r in out} == {500}


# ── a failing refresh keeps last-good, marked stale ──────────────────────────

@pytest.mark.parametrize("failure", ["error", "empty"])
def test_a_failing_refresh_keeps_last_good_marked_stale(route, handler, failure):
    route(_auth={})
    _lapse_ttl()
    handler.mode = failure

    first = route(_auth={})
    _wait_for_refresh_to_settle()
    assert handler.calls == 2, "the lapse did not start a refresh"

    second = route(_auth={})
    _wait_for_refresh_to_settle()

    for resp in (first, second):
        assert resp.status_code == 200
        assert _body(resp) == {"narrative": "Stocks closed higher (build 1)."}, (
            f"a {failure!r} refresh replaced the last good narrative")
        assert _tier(resp) == "stale-swr"
    value, _age = swr._STALE.peek(swr.cache_key(DAY))
    assert value == {"narrative": "Stocks closed higher (build 1)."}
    assert cache.get(swr.cache_key(DAY)) is None, "a failure became fresh"


def test_a_failed_build_answers_only_for_its_window(route, handler, monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(swr, "_clock", lambda: clock["t"])
    handler.mode = "error"

    route(_auth={})
    route(_auth={})
    assert handler.calls == 1, "a failure inside its window re-ran the model call"

    clock["t"] += swr.NEGATIVE_TTL_SECONDS + 1
    handler.mode = "ok"
    resp = route(_auth={})
    assert handler.calls == 2
    assert _body(resp) == {"narrative": "Stocks closed higher (build 2)."}


def test_a_failing_refresh_is_throttled_to_one_attempt_per_window(route, handler,
                                                                 monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(swr, "_clock", lambda: clock["t"])
    route(_auth={})
    _lapse_ttl()
    handler.mode = "error"

    for _ in range(4):
        route(_auth={})
        _wait_for_refresh_to_settle()

    assert handler.calls == 2, (
        "every stale read during an outage fired its own refresh")


# ── keyed by date ────────────────────────────────────────────────────────────

def test_yesterdays_narrative_is_never_served_today(route, handler, today):
    route(_auth={})
    today["now"] = NEXT_DAY

    resp = route(_auth={})

    assert handler.calls == 2
    assert _tier(resp) == "fetch"
    assert _body(resp) == {"narrative": "Stocks closed higher (build 2)."}


# ── last-good survives a deploy, with its ORIGINAL age ───────────────────────

def _simulate_deploy():
    """A new pod: every in-process slot is empty; the shared cache comes back
    from `cache_snapshot` with each entry's absolute expiry."""
    swr._STALE._slots.clear()
    with swr._FAILED_LOCK:
        swr._FAILED.clear()


def test_a_deploy_does_not_turn_the_next_lapse_into_a_cold_build(route, handler):
    route(_auth={})
    key = swr.cache_key(DAY)
    carried = cache.get(swr._carry_key(key))
    cache.set(swr._carry_key(key), dict(carried, built_at=time.time() - 1000),
              swr.STALE_MAX_AGE)
    _simulate_deploy()
    _lapse_ttl()
    handler.gate = threading.Event()
    handler.started.clear()

    resp = route(_auth={})

    assert _tier(resp) == "stale-swr", "the new pod made the member wait"
    assert _body(resp) == {"narrative": "Stocks closed higher (build 1)."}
    assert _stale_age_ms(resp) >= 999_000, (
        "the restored narrative's age restarted at the deploy, so a deploy "
        "extends how long it can be served")


def test_a_carried_narrative_past_the_bound_is_not_served(route, handler):
    route(_auth={})
    key = swr.cache_key(DAY)
    carried = cache.get(swr._carry_key(key))
    cache.set(swr._carry_key(key),
              dict(carried, built_at=time.time() - swr.STALE_MAX_AGE - 5),
              swr.STALE_MAX_AGE)
    _simulate_deploy()
    _lapse_ttl()

    resp = route(_auth={})

    assert _tier(resp) == "fetch"
    assert handler.calls == 2


# ── WIRED: the real route on the real app ────────────────────────────────────

_SECRET = "term-070-rail-secret"
_UPSTREAM_GATE = threading.Event()


class _Answer:
    class _Block:
        text = "Stocks closed higher."

    class _Usage:
        input_tokens = 1200
        output_tokens = 200

        class server_tool_use:
            web_search_requests = 1

    content = [_Block()]
    usage = _Usage()


class _StandInClient:
    constructed: list = []
    gated = False
    started = threading.Event()

    def __init__(self, *_a, **_kw):
        _StandInClient.constructed.append(self)
        self.messages = self

    def create(self, **_kw):
        _StandInClient.started.set()
        if _StandInClient.gated:
            assert _UPSTREAM_GATE.wait(_WAIT)
        return _Answer()


@pytest.fixture
def wired(monkeypatch):
    app = importlib.import_module("api.main").app
    module = types.ModuleType("anthropic")
    module.Anthropic = _StandInClient
    monkeypatch.setitem(sys.modules, "anthropic", module)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    monkeypatch.setenv("PUSH_SECRET", _SECRET)
    narrative_cost_guard._reset_for_test()
    _StandInClient.constructed.clear()
    _StandInClient.gated = False
    _StandInClient.started.clear()
    _UPSTREAM_GATE.clear()
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    _UPSTREAM_GATE.set()
    _wait_for_refresh_to_settle()


def _get(client):
    return client.get("/api/schwab/market-narrative",
                      headers={"Authorization": f"Bearer {_SECRET}"})


def test_wired_a_warm_request_constructs_no_llm_client(wired):
    cold = _get(wired)
    assert cold.status_code == 200
    assert cold.json() == {"narrative": "Stocks closed higher."}
    assert len(_StandInClient.constructed) == 1

    warm = _get(wired)

    assert warm.json() == {"narrative": "Stocks closed higher."}
    assert len(_StandInClient.constructed) == 1, "a warm request called the model"
    assert 'market-narrative;desc="mem"' in warm.headers["server-timing"]


def test_wired_a_lapsed_ttl_does_not_hold_the_member(wired):
    _get(wired)
    cache.invalidate(swr.cache_key(datetime.now()))
    _StandInClient.gated = True

    resp = _get(wired)

    assert _StandInClient.started.wait(_WAIT), "no refresh behind the member"
    assert not _UPSTREAM_GATE.is_set()
    assert resp.status_code == 200
    assert resp.json() == {"narrative": "Stocks closed higher."}
    assert 'desc="stale-swr"' in resp.headers["server-timing"]


def test_the_stale_bound_outlives_the_ttl_the_handler_really_writes(wired):
    """`STALE_MAX_AGE` counts from the build, so a bound at or under the
    handler's TTL would never serve anything. Derived from the handler's own
    cache write, never from a restated 1800."""
    before = time.time()
    _get(wired)
    key = swr.cache_key(datetime.now())
    expiries = [exp for k, _v, exp in cache.items_with_expiry() if k == key]
    assert expiries, "the handler did not cache under the shared key"
    ttl = expiries[0] - before
    assert swr.STALE_MAX_AGE > ttl + 60, (swr.STALE_MAX_AGE, ttl)
