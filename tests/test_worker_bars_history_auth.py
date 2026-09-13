"""🔴 THE THIRD CHART-DATA DOOR: the worker's deep-history origin.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
The 2026-09-13 bars security pass closed `api.main` and the bars-api tier and
looked complete. It was not. `api/worker_main.py` mounts

    GET /api/bars-history/{ticker}

behind `BARS_HISTORY_ORIGIN_ENABLED=1`, and per
`docs/superpowers/specs/2026-08-31-edge-deep-history.md` that route is the one
that actually holds the deep 20 GB bars.db the production history path is fed
from. It had no gate at all. The secure-CDN architecture review found it.

⛔ THE CREDENTIAL IS INFRASTRUCTURE IDENTITY, NOT USER IDENTITY, and that is a
design decision rather than a shortcut. This pod has no `auth.db`, so it cannot
answer "is this member paid?"; and it has no browser caller, so it is never
asked to. The member question is answered upstream on the pod that CAN answer it,
and the worker's only job is to refuse anybody who is not that pod. Same shape as
`bars_api_main`, same module (`api/bars_auth.py`), one mechanism.

⚠️ WHETHER RAILWAY PUBLISHES THIS SERVICE IS AN EXTERNAL FACT, and the code is
deliberately written not to depend on the answer. `bars-api` unexpectedly had a
public domain. If the worker does too, this gate is what stands between the
internet and the deep store; if it does not, it is defence in depth. Both are
worth having, which is why nothing here waited for the dashboard.

⛔ AND THIS FILE DOES NOT TOUCH THE EDGE. A Cloudflare HIT never reaches any
origin, so closing this door does not make edge delivery safe — that is the next
project. What it does is guarantee that when edge authorization arrives, there is
no direct origin bypass sitting behind it.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SECRET = "worker-proof-secret"


@pytest.fixture
def build_worker(monkeypatch):
    """Build the worker app with the deep-history origin mounted.

    ⚠️ TWO THINGS MUST HAPPEN BEFORE `_build_app()` RUNS, and both were learned
    the hard way in this file.

      1. THE FLAG. The route is mounted inside `if os.environ.get(...)` at BUILD
         time, not per request — a fixture that set it afterwards would build an
         app with no route and then "prove" a 404 was a refusal.
      2. ANY SUBSTITUTION OF `serve_bars_history`. The mount does
         `from api.routers.bars import serve_bars_history as _serve_hist`, which
         binds the function into the closure right there. A `monkeypatch.setattr`
         applied AFTER the build reaches nothing
         (`lesson_from_import_severs_a_module_from_its_guards`).

    ⚰️ AND (2) IS NOT THEORETICAL: the first version of the denied-before-data
    case patched afterwards, saw an empty spy, and PASSED — while asserting
    nothing at all, because the spy was never the function the route called. It
    would have stayed green with the gate deleted. Hence `assert_spy_reachable`.
    """
    def _build(serve=None):
        monkeypatch.setenv("BARS_HISTORY_ORIGIN_ENABLED", "1")
        monkeypatch.setenv("PUSH_SECRET", SECRET)
        if serve is not None:
            import api.routers.bars as bars_router
            monkeypatch.setattr(bars_router, "serve_bars_history", serve)
        from api.worker_main import _build_app
        return _build_app()
    return _build


@pytest.fixture
def worker_app(build_worker):
    return build_worker()


def _get(app, path, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return TestClient(app).get(path, headers=headers)


# ── the door ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("sym", ["AAPL", "QQQ", "UCTA50"])
def test_ANONYMOUS_gets_nothing_from_the_worker_deep_history(worker_app, sym):
    """⛔⛔ THE HEADLINE. No credential, no deep history — including the
    proprietary breadth series the whole security programme is about."""
    r = _get(worker_app, f"/api/bars-history/{sym}?tf=D&bars=10")
    assert r.status_code == 401, (
        f"the worker served {sym}'s deep history to an anonymous caller "
        f"({r.status_code}) — the third door is open again")


def test_a_WRONG_service_token_is_refused(worker_app):
    r = _get(worker_app, "/api/bars-history/AAPL?tf=D&bars=10", token="not-the-secret")
    assert r.status_code == 401


def test_an_EMPTY_bearer_is_refused(worker_app):
    """⚠️ The guard that makes an unset secret safe: `_push_secret_ok` checks
    `bool(secret)` FIRST and non-constant-time, so "no secret configured" can
    never compare equal to an empty bearer."""
    r = _get(worker_app, "/api/bars-history/AAPL?tf=D&bars=10", token="")
    assert r.status_code == 401


def test_the_CORRECT_service_token_is_served(worker_app):
    """…and the web pod can still reach it, or deep history silently becomes the
    web's shallow tail for everybody."""
    r = _get(worker_app, "/api/bars-history/AAPL?tf=D&bars=10", token=SECRET)
    assert r.status_code != 401, "the worker refused its own trusted caller"


def test_an_UNSET_secret_admits_NOBODY(worker_app, monkeypatch):
    """Fails closed, and the blast radius is bounded: the web proxy treats a
    401/403 from here as a reason to fall back to its own shallow history, so a
    misconfigured secret costs DEPTH and never a chart."""
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    assert _get(worker_app, "/api/bars-history/AAPL?tf=D&bars=10",
                token=SECRET).status_code == 401


# ── what must stay open ─────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/internal/health", "/api/health", "/api/ready"])
def test_the_worker_HEALTH_surface_stays_open(worker_app, path):
    """⛔ DELIBERATELY UNGATED. Railway's healthcheck presents no credential;
    gating these fails the deploy instead of securing anything, and they carry no
    symbols and no bars."""
    assert TestClient(worker_app).get(path).status_code == 200, f"{path} is gated"


# ── refused before the deep store ───────────────────────────────────────────

def test_a_REFUSED_caller_never_reaches_the_deep_history_READ(build_worker):
    """⭐⭐ AUTHORIZATION FIRST, THEN THE 20 GB STORE.

    ⛔ NOT TIDINESS. `serve_bars_history` is the door to the worker's deep
    bars.db; a gate that ran after it would let an anonymous caller drive disk
    reads against the largest store in the product by asking for symbols they can
    never receive.

    ⭐ AND THE SPY IS PROVEN REACHABLE FIRST. An empty call-list is also what a
    spy that was never wired up produces, so "nothing was called" is only evidence
    once the SAME spy has been seen recording an authorized call.
    """
    from starlette.responses import JSONResponse
    seen = []

    def _spy(*a, **k):
        seen.append(a)
        return JSONResponse(content={"ticker": "UCTA50", "tf": "D", "bars": []})

    app = build_worker(serve=_spy)

    # positive control — the spy IS the function this route calls
    assert _get(app, "/api/bars-history/UCTA50?tf=D&bars=10",
                token=SECRET).status_code == 200
    assert len(seen) == 1, "the spy is not wired to the route — this case measures nothing"

    seen.clear()
    assert _get(app, "/api/bars-history/UCTA50?tf=D&bars=10").status_code == 401
    assert _get(app, "/api/bars-history/UCTA50?tf=D&bars=10",
                token="wrong").status_code == 401
    assert seen == [], (
        "a refused caller reached the deep-history read — the gate is behind the "
        "data layer, not in front of it")


def test_an_AUTHORIZED_request_returns_the_same_bytes_as_before(build_worker):
    """⭐ THE GATE CHANGED WHO MAY ASK, NOT WHAT IS ANSWERED. The payload is
    whatever `serve_bars_history` produces, untouched — so Cloudflare caches the
    same object it always did and the CDN architecture is undisturbed by this
    pass."""
    from starlette.responses import JSONResponse
    sentinel = {"ticker": "AAPL", "tf": "D", "bars": [{"t": "2020-01-02", "c": 1.5}],
                "sealed": True, "last_sealed": "2020-01-02"}
    app = build_worker(serve=lambda *a, **k: JSONResponse(content=sentinel))
    r = _get(app, "/api/bars-history/AAPL?tf=D&bars=10", token=SECRET)
    assert r.status_code == 200
    assert r.json() == sentinel


# ── the web pod is still able to reach it ───────────────────────────────────

def test_the_WEB_PROXY_presents_the_service_credential(monkeypatch):
    """⭐⭐ THE OTHER HALF, AND WITHOUT IT THE GATE IS AN OUTAGE.

    ⚰️ The `/api/bars` tier proxy already learned this: gating an origin without
    teaching its caller to authenticate turns a security fix into a silent
    capability loss — here, every member's deep history quietly degrading to the
    web's shallow tail. Asserted on the REQUEST the proxy actually builds.
    """
    import asyncio
    import api.routers.bars as bars_router

    monkeypatch.setenv("PUSH_SECRET", SECRET)
    captured = {}

    class _Resp:
        status_code = 200
        content = b'{"bars": []}'
        headers = {"content-type": "application/json"}

    class _Client:
        async def get(self, url, params=None, headers=None):
            captured["url"] = url
            captured["headers"] = headers or {}
            return _Resp()

    monkeypatch.setattr(bars_router, "_bars_history_proxy_client", _Client())
    asyncio.run(bars_router._proxy_bars_history_to_worker(
        "AAPL", "D", 100, "", "", "http://worker.railway.internal:8080"))

    assert captured["headers"].get("Authorization") == f"Bearer {SECRET}", (
        "the web→worker history proxy sent no service credential — the worker "
        f"would refuse it: {captured['headers']!r}")


def test_the_proxy_treats_a_worker_REFUSAL_as_its_own_problem(monkeypatch):
    """⛔ A 401 FROM THE WORKER MUST NOT REACH THE MEMBER. It can only mean the
    secret is misconfigured; raising drops into the caller's existing
    fall-back-to-local path, so the member gets the shallow tail rather than an
    error. That is what makes the worker gate safe to deploy in either order."""
    import asyncio
    import api.routers.bars as bars_router

    class _Resp:
        status_code = 401
        content = b'{"detail": "Not authenticated"}'
        headers = {"content-type": "application/json"}

    class _Client:
        async def get(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(bars_router, "_bars_history_proxy_client", _Client())
    with pytest.raises(Exception):
        asyncio.run(bars_router._proxy_bars_history_to_worker(
            "AAPL", "D", 100, "", "", "http://worker.railway.internal:8080"))
