"""Rails for the four partner-owned fixes acked on 2026-08-09.

Everything here asserts against **`api.main:app`**, never a locally-constructed
FastAPI. That is deliberate and it is the lesson from Finding 1 of the
auth-paywall sweep: `test_launch_hardening.py` built its own app, registered
`AdminGuardMiddleware` on it by hand, and passed for months while the real app
never registered the middleware at all. Both halves were correct; the *wire* was
cut, and no component test could see it. A gate is only real on the app that
ships.

What each rail fails on:

  1. `api/schwab_router.py` — `GET /api/schwab/market-narrative` was a BLOCKING
     `client.messages.create()` with no timeout inside an `async def` handler.
     Two independent defects in one line-and-a-half, and they need two
     independent rails:
       * no `timeout=` ⇒ the SDK's 600 s read default. The rail hangs a fake SDK
         and asserts the call is CUT — measured off the wall clock, never by
         reading the constant back.
       * `async def` ⇒ the blocking call runs ON the single shared event loop,
         so a hang stops the whole site rather than costing one of 64 workers.
         The rail fires a second request while the narrative is blocked and
         asserts it completes FIRST. Under an `async def` handler it cannot.
  2. Three routes that answered a stranger: `/api/schwab/chart-proxy` (an open
     proxy over the paid Finviz key), `/api/schwab/market-narrative` (anonymous
     LLM spend) and `/api/live/massive/thresholds` (the curated-alert
     thresholds — the alert IP itself). Each is checked BOTH ways: it refuses
     with no credential, and it still answers a legitimate one.
  3. `/api/schwab/snapshot-now` — destructive-shaped GET (it overwrites today's
     row in the contract OI/price history with whatever the market looks like at
     the moment it fires, and burns Schwab quota doing it). A crawler or a
     link-unfurl carries no admin credential; the rail proves that is enough.
  4. `GET /api/live/massive/curated` — a permanent 500. The shim called the
     `/recent` handler directly and omitted two parameters, so FastAPI never
     resolved them and the raw `Query(...)` objects flowed in: truthy, and not
     an int.

⛔ NO REAL CALL IS MADE to Schwab, Finviz or an LLM. The Anthropic SDK is
replaced wholesale for the narrative tests; the gated routes are only ever
probed in the direction that refuses, except where the handler is proven to stop
before any network work.
"""
from __future__ import annotations

import asyncio
import importlib
import sys
import threading
import time
import types

import httpx
import pytest
from fastapi.testclient import TestClient

from api import flow_proxy
from api import live_massive_router
from api import schwab_router
from api.services import narrative_cost_guard


NARRATIVE = "/api/schwab/market-narrative"
CHART_PROXY = "/api/schwab/chart-proxy?sym=AAPL"
SNAPSHOT_NOW = "/api/schwab/snapshot-now"
THRESHOLDS = "/api/live/massive/thresholds"
CURATED = "/api/live/massive/curated"
PROBE = "/api/health"

_SECRET = "rail-push-secret"

# How long the stand-in SDK pretends the upstream takes to answer. Only the
# event-loop rail depends on it, and only through a comparison — no assertion
# anywhere states a timeout VALUE.
_BLOCK_SECONDS = 1.0


@pytest.fixture(scope="module")
def app():
    """`api.main:app` itself. Imported lazily so collection of this file does
    not drag the whole app into unrelated runs."""
    return importlib.import_module("api.main").app


@pytest.fixture
def client(app):
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _no_proxy_and_a_service_token(monkeypatch):
    """A service token is a real, unstubbed credential through
    `require_flow_user` / `require_flow_admin`, so "a legitimate caller still
    succeeds" is proven against the actual dependency rather than a patched one.

    Also pins the flow read-proxy OFF. ⚠️ When `FLOW_READS_PROXY_ENABLED=1` (the
    production web pod) `/api/live/massive/*` is forwarded to the FLOW-WORKER,
    which runs its OWN copy of the router — so the gate below is enforced by a
    `railway up -s flow-worker`, not by a web deploy. This rail proves the code
    is right; it does not prove production is protected.
    """
    monkeypatch.setenv("PUSH_SECRET", _SECRET)
    monkeypatch.setattr(flow_proxy, "PROXY_ENABLED", False, raising=False)
    narrative_cost_guard._reset_for_test()


def _token_headers() -> dict:
    return {"Authorization": f"Bearer {_SECRET}"}


# ── the fake Anthropic SDK ───────────────────────────────────────────────────

class _FakeTimeout(Exception):
    pass


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


# Released in teardown so a hung stand-in can never outlive its test.
_RELEASE = threading.Event()

# ── the three upstreams a stand-in can model ─────────────────────────────────
# Each takes the constructed deadline and decides what the socket does.

def HANGS(deadline):
    """Never answers — blocks until the client's own read timeout fires."""
    if _RELEASE.wait(timeout=deadline):
        raise AssertionError("stand-in released early — it models a hang")
    raise _FakeTimeout(f"read timed out after {deadline}s")


def BLOCKS(_deadline):
    """Answers, after `_BLOCK_SECONDS` of blocking wall time."""
    time.sleep(_BLOCK_SECONDS)
    return _Answer()


def ANSWERS(_deadline):
    """Answers straight away."""
    return _Answer()


def REFUSES(_deadline):
    """Fails immediately — for rails that only care what the client was BUILT
    with, so they never pay the wall-clock cost of the deadline they assert on."""
    raise _FakeTimeout("upstream refused")


class _StandInClient:
    """Stands in for `anthropic.Anthropic`.

    It models the one behaviour under test: the constructed `timeout=` is what
    bounds a call. A client built WITHOUT `timeout=` inherits the SDK's 600 s
    read default, and this stand-in inherits it too — so the mutation "delete
    the keyword argument" reproduces the real defect here rather than quietly
    passing.
    """

    SDK_DEFAULT_READ_TIMEOUT = 600.0

    constructed: list["_StandInClient"] = []
    upstream = staticmethod(ANSWERS)

    def __init__(self, *_a, timeout=None, **_kw):
        self.deadline = (float(timeout) if timeout is not None
                         else self.SDK_DEFAULT_READ_TIMEOUT)
        self.messages = _StandInMessages(self)
        _StandInClient.constructed.append(self)


class _StandInMessages:
    def __init__(self, client):
        self._client = client

    def create(self, **_kw):
        return type(self._client).upstream(self._client.deadline)


@pytest.fixture
def fake_anthropic(monkeypatch):
    """Replace the `anthropic` module for the duration of one test. The handler
    imports it function-locally, so `sys.modules` is the only seam — and using
    it means the real SDK is never constructed and no key is ever read."""
    _StandInClient.constructed.clear()
    _RELEASE.clear()
    module = types.ModuleType("anthropic")
    module.Anthropic = _StandInClient
    monkeypatch.setitem(sys.modules, "anthropic", module)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")

    def _install(upstream):
        monkeypatch.setattr(_StandInClient, "upstream", staticmethod(upstream))

    _install(ANSWERS)
    yield _install
    _RELEASE.set()


@pytest.fixture(autouse=True)
def _bust_narrative_cache():
    """`/market-narrative` is 30-min cached by date. A rail that hit the cache
    would prove nothing at all — and would pass just as happily with the fix
    reverted."""
    from api.services.cache import cache
    from datetime import datetime

    def _clear():
        cache.invalidate(f"market_narrative_{datetime.now().strftime('%Y%m%d')}")

    _clear()
    yield
    _clear()


# ── 1. the timeout, proven by behaviour ──────────────────────────────────────

def test_a_hung_llm_call_is_cut_at_the_stated_bound(client, fake_anthropic,
                                                    monkeypatch):
    """The claim is "a hang is cut", not "the constant is 60".

    The bound itself is supplied through the surface's own env override, so the
    assertion never restates a number the source owns — it retunes the bound and
    then measures that the call actually obeyed it. Delete the `timeout=`
    keyword and the stand-in falls back to the SDK's 600 s default: the worker
    thread is still alive at the join, and this fails in ~8 s rather than
    hanging for ten minutes.
    """
    monkeypatch.setenv("SCHWAB_NARRATIVE_LLM_TIMEOUT_SECS", "0.5")
    fake_anthropic(HANGS)

    box: dict = {}

    def _call():
        started = time.monotonic()
        box["response"] = client.get(NARRATIVE, headers=_token_headers())
        box["elapsed"] = time.monotonic() - started

    worker = threading.Thread(target=_call, daemon=True)
    worker.start()
    worker.join(timeout=8.0)

    assert not worker.is_alive(), (
        "the hung LLM call was never cut. An `anthropic.Anthropic(...)` built "
        "with no `timeout=` inherits the SDK's 600s read default, and this "
        "handler blocks a thread for the whole of it."
    )
    assert box["elapsed"] < 8.0
    assert _StandInClient.constructed, "the stand-in SDK was never constructed"
    assert _StandInClient.constructed[0].deadline < (
        _StandInClient.SDK_DEFAULT_READ_TIMEOUT), (
        "the client was constructed with the SDK's unbounded default"
    )


def test_the_bound_is_retunable_without_a_deploy(client, fake_anthropic,
                                                 monkeypatch):
    """The env override is load-bearing: the Desk chapters pass was broken once
    by a shared value nobody could retune from Railway. Two different overrides
    must produce two different observed deadlines."""
    monkeypatch.setenv("SCHWAB_NARRATIVE_LLM_TIMEOUT_SECS", "0.25")
    fake_anthropic(REFUSES)
    client.get(NARRATIVE, headers=_token_headers())
    first = _StandInClient.constructed[-1].deadline

    monkeypatch.setenv("SCHWAB_NARRATIVE_LLM_TIMEOUT_SECS", "0.75")
    client.get(NARRATIVE, headers=_token_headers())
    second = _StandInClient.constructed[-1].deadline

    assert first < second, (
        "the surface's timeout is not reading its env override, so an operator "
        "cannot retune it without a deploy"
    )


def test_a_hostile_env_value_cannot_unbound_the_client(client, fake_anthropic,
                                                       monkeypatch):
    """`0` is the SDK's spelling of *no timeout*. A stray Railway variable must
    not be able to undo the fix."""
    monkeypatch.setenv("SCHWAB_NARRATIVE_LLM_TIMEOUT_SECS", "0")
    fake_anthropic(REFUSES)

    worker = threading.Thread(
        target=lambda: client.get(NARRATIVE, headers=_token_headers()),
        daemon=True)
    worker.start()
    worker.join(timeout=90.0)
    # A blank/zero/negative override falls back to the coded default, which is
    # bounded and far under the SDK's 600 s — assert the SHAPE, not the number.
    assert _StandInClient.constructed, "the stand-in SDK was never constructed"
    assert 0 < _StandInClient.constructed[0].deadline < (
        _StandInClient.SDK_DEFAULT_READ_TIMEOUT)
    _RELEASE.set()
    worker.join(timeout=5.0)


# ── 1b. off the event loop ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_blocking_narrative_does_not_stop_the_rest_of_the_site(
        app, fake_anthropic):
    """THE headline fix. A blocking call inside an `async def` runs ON the one
    shared event loop, so a slow upstream stops every other request in the pod —
    the 2026-07-01 HTTP 524 mechanism.

    Two requests are raced. The narrative blocks for a full second inside the
    SDK; the probe is a trivial route. With the handler dispatched to the
    threadpool the probe finishes FIRST. Revert `def` to `async def` and it
    cannot: the loop is pinned, the probe cannot even start, and the order
    inverts.
    """
    fake_anthropic(BLOCKS)
    finished: list[str] = []

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport,
                                 base_url="http://rail") as ac:
        async def _run(name, url, **kw):
            response = await ac.get(url, **kw)
            finished.append(name)
            return response

        narrative, probe = await asyncio.gather(
            _run("narrative", NARRATIVE, headers=_token_headers()),
            _run("probe", PROBE),
        )

    assert probe.status_code == 200, f"the probe route is not healthy: {PROBE}"
    assert narrative.status_code == 200
    assert finished[0] == "probe", (
        "a blocking LLM call held the event loop for the whole of its duration, "
        f"so {PROBE} could not be served until it finished. That is the 524 "
        "outage mechanism: one hung upstream stops the entire site, not one of "
        "64 workers."
    )


# ── 2. the gates: refuses a stranger, answers a legitimate caller ────────────

@pytest.mark.parametrize("url", [NARRATIVE, CHART_PROXY, SNAPSHOT_NOW, THRESHOLDS])
def test_a_gated_route_refuses_an_anonymous_caller(client, url):
    response = client.get(url)
    assert response.status_code in (401, 403), (
        f"{url} answered a caller with no credential of any kind "
        f"(status {response.status_code})"
    )


def test_the_thresholds_still_answer_a_legitimate_caller(client):
    """`OptionsFlow.jsx` fetches this on mount for EVERY member — its curated
    quality gate degrades to defaults without it. That is why the gate is
    `require_flow_user` and not `require_flow_admin`: the write side
    (`POST /thresholds`) is admin, the read is a member-facing dependency."""
    response = client.get(THRESHOLDS, headers=_token_headers())
    assert response.status_code == 200
    assert "thresholds" in response.json()


def test_the_narrative_still_answers_a_legitimate_caller(client, fake_anthropic):
    fake_anthropic(BLOCKS)
    response = client.get(NARRATIVE, headers=_token_headers())
    assert response.status_code == 200
    assert response.json()["narrative"] == "Stocks closed higher."


def test_the_chart_proxy_gate_runs_before_any_finviz_call(client, monkeypatch):
    """An open proxy over a paid key is only closed if the refusal happens
    BEFORE the upstream request. `httpx.AsyncClient` is replaced with a bomb —
    if the anonymous call reaches it, the test says so by name."""
    import httpx as _httpx

    class _Bomb:
        def __init__(self, *a, **kw):
            raise AssertionError(
                "an anonymous /chart-proxy request reached the network — the "
                "firm's paid Finviz key is still an open proxy"
            )

    monkeypatch.setattr(_httpx, "AsyncClient", _Bomb)
    monkeypatch.setenv("FINVIZ_API_KEY", "not-a-real-key")
    assert client.get(CHART_PROXY).status_code in (401, 403)


def test_snapshot_now_refuses_a_crawler_before_it_writes(client, monkeypatch):
    """The destructive-shaped GET. `store_daily_snapshot()` overwrites today's
    row in the contract history with whatever the tape looks like at the moment
    it fires, so a link-unfurl at 11am silently replaces the 4:30pm close
    snapshot the hover chart reads. A bomb proves the gate stops the request
    before any of that runs."""
    import api.daily_tracker as tracker

    async def _bomb():
        raise AssertionError(
            "an anonymous GET /snapshot-now reached store_daily_snapshot() — a "
            "crawler can still overwrite the day's contract history"
        )

    monkeypatch.setattr(tracker, "store_daily_snapshot", _bomb)
    assert client.get(SNAPSHOT_NOW).status_code in (401, 403)


def test_snapshot_now_is_admin_only_not_merely_logged_in(client, monkeypatch):
    """A member session must not reach an operator trigger. `require_flow_admin`
    accepts the service token but refuses a non-admin session; a plain
    `require_flow_user` here would pass the anonymous rail above and still leave
    every free account able to corrupt the day's snapshot."""
    from api import flow_admin_auth

    monkeypatch.setattr(flow_admin_auth, "validate_session",
                        lambda _t: {"id": "u1", "role": "member"})
    response = client.get(SNAPSHOT_NOW, cookies={"uct_session": "member-token"})
    assert response.status_code == 403


# ── 3. the cost bound ────────────────────────────────────────────────────────

def test_the_narrative_refuses_once_the_day_is_spent(client, fake_anthropic,
                                                     monkeypatch):
    """Gating alone bounds WHO spends, not HOW MUCH. With the cap consumed the
    route must refuse without constructing a client at all."""
    fake_anthropic(BLOCKS)
    monkeypatch.setenv("SCHWAB_NARRATIVE_COST_CAP_DAILY", "0.01")
    narrative_cost_guard.record("schwab_market_narrative", "claude-sonnet-4-6",
                                input_tokens=1_000_000, output_tokens=1_000_000)

    response = client.get(NARRATIVE, headers=_token_headers())

    assert response.status_code == 429
    assert not _StandInClient.constructed, (
        "an LLM client was constructed after the daily budget was exhausted"
    )


def test_a_served_narrative_is_charged_to_the_day(client, fake_anthropic):
    """A cap nothing writes to is a cap that never trips."""
    fake_anthropic(BLOCKS)
    before = narrative_cost_guard.spend_today_usd("schwab_market_narrative")

    assert client.get(NARRATIVE, headers=_token_headers()).status_code == 200

    after = narrative_cost_guard.spend_today_usd("schwab_market_narrative")
    assert after > before, (
        "the call was served but nothing was charged, so the daily cap can "
        "never be reached no matter how much is spent"
    )


def test_a_zero_cap_is_not_read_as_unlimited(monkeypatch):
    """`0` must mean "fall back to the coded default", never "no cap" — the same
    trap `llm_timeouts.seconds()` refuses for the same reason."""
    for hostile in ("0", "-1", "", "   ", "none"):
        monkeypatch.setenv("SCHWAB_NARRATIVE_COST_CAP_DAILY", hostile)
        assert narrative_cost_guard.cap_usd() == narrative_cost_guard.DEFAULT_CAP_USD


def test_an_unknown_model_is_not_priced_at_zero():
    """Pricing an unrecognised model at $0 is how a cap becomes silently
    un-enforceable the day somebody edits the model string."""
    cost = narrative_cost_guard.estimate_cost("claude-something-unreleased",
                                              1_000_000, 1_000_000)
    assert cost > 0


def test_the_ledger_survives_a_restart(monkeypatch):
    """Durable, not a module dict: a redeploy is the single most likely way to
    blow a daily cap, and an in-memory counter forgets across one."""
    narrative_cost_guard.record("rail_restart_surface", "claude-sonnet-4-6",
                                input_tokens=500_000, output_tokens=500_000)
    spent = narrative_cost_guard.spend_today_usd("rail_restart_surface")
    assert spent > 0

    # A redeploy: the process forgets, the volume does not.
    narrative_cost_guard._reset_for_test("rail_restart_surface", durable=False)
    assert narrative_cost_guard.spend_today_usd("rail_restart_surface") == spent


# ── 4. the 500 ───────────────────────────────────────────────────────────────

def test_the_curated_shim_is_not_a_permanent_500(client):
    """An internal caller of a FastAPI handler gets NO parameter resolution, so
    every omitted argument arrives as the raw `Query(...)` object — truthy, and
    not an int. `/curated` took the ticker-scoped branch on a `Query` "symbol"
    and then raised inside `int(lookback_days or 1)`, on every request, for
    every caller."""
    response = client.get(CURATED + "?limit=5")
    assert response.status_code == 200, response.text
    assert "alerts" in response.json()


def test_the_shim_passes_a_real_value_for_every_parameter_it_omits(client):
    """Named separately from the 200 above because a future parameter added to
    `/recent` re-opens exactly this hole. The shim must hand the handler a
    resolved value for every parameter it does not forward."""
    import inspect
    from fastapi import params as fastapi_params

    seen: dict = {}
    original = live_massive_router.recent_massive_alerts

    def _spy(**kwargs):
        bound = inspect.signature(original).bind_partial(**kwargs)
        bound.apply_defaults()
        seen.update(bound.arguments)
        return {"alerts": [], "status": {}}

    live_massive_router.recent_massive_alerts = _spy
    try:
        assert client.get(CURATED + "?limit=5").status_code == 200
    finally:
        live_massive_router.recent_massive_alerts = original

    unresolved = sorted(
        name for name, value in seen.items()
        if isinstance(value, fastapi_params.Param)
    )
    assert not unresolved, (
        "/curated reached the /recent handler with unresolved FastAPI Query "
        f"objects for {unresolved} — each one is a 500 waiting for the first "
        "line of code that treats it as a value"
    )
