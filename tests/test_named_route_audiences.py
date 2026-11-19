"""Who each of these routes answers, and that the answer itself did not change.

Three small surfaces, each driven with the callers it has to tell apart:

  * the options-flow page's POST routes: a signed-in member for the batch read,
    an admin or the service token for the two that operate the daily tracker;
  * the breadth population read: the worker's service token and nobody else;
  * the live-flow admin reads: an admin or the service token.

Each router is mounted on its own small app, so nothing here builds the whole
product; the SERVED app's rows are claimed in `tests/test_exposed_routes_gated.py`
(which is the owner of "is this route gated, and as what"). What this file adds
is the half that census does not hold: the refusals by caller, and the response
a legitimate caller receives, byte for byte what the route returned before.

The identity is substituted one level under the gate (`tests/authclients.py`),
never the gate itself. No request here reaches a provider or a real store.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.authclients import (  # noqa: E402
    ADMIN,
    FREE_MEMBER,
    PAID_MEMBER,
    sign_in_flow_caller,
)

SECRET = "named-audience-test-secret"
BEARER = {"Authorization": f"Bearer {SECRET}"}


def _app(router) -> TestClient:
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    app.include_router(router)
    return TestClient(app)


def _signed_in(client: TestClient) -> TestClient:
    client.cookies.set("uct_session", "test-session")
    return client


@pytest.fixture(autouse=True)
def _no_ambient_secret(monkeypatch):
    """Each test names its own credential; none inherits one from the box."""
    monkeypatch.delenv("PUSH_SECRET", raising=False)


# ── the options-flow page's POST routes ──────────────────────────────────────

@pytest.fixture
def flow_posts(monkeypatch):
    """The router, with the three handlers' own work replaced by recorders."""
    import api.daily_tracker as dt
    import api.schwab_router as sr
    calls = {"earnings": [], "register": [], "backfill": []}

    def fake_fetch(sym):
        calls["earnings"].append(sym)
        return {"date": "12/4", "daysUntil": 16, "confirmed": True, "timing": ""}

    def fake_register(contracts):
        calls["register"].append(contracts)
        return len(contracts)

    async def fake_backfill(days_back=60):
        calls["backfill"].append(days_back)
        return {"status": "ok", "contracts": 0, "days_back": days_back}

    monkeypatch.setattr(sr, "_fetch_earnings_yf", fake_fetch)
    monkeypatch.setattr(sr, "_earnings_cache", {})
    monkeypatch.setattr(dt, "register_contracts", fake_register)
    monkeypatch.setattr(dt, "backfill_all_registered", fake_backfill)
    client = _app(sr.router)
    client.calls = calls
    return client


CONTRACTS = [{"sym": "NVDA", "cp": "C", "K": 150, "exp": "12/19", "grade": "A",
              "dir": "BULL", "hits": 3, "prem": 1_200_000}]


def test_the_batch_earnings_read_needs_a_session(flow_posts, monkeypatch):
    r = flow_posts.post("/api/schwab/earnings", json={"symbols": ["NVDA"]})
    assert r.status_code == 401
    assert flow_posts.calls["earnings"] == [], "a refused request must not fetch"

    sign_in_flow_caller(monkeypatch, PAID_MEMBER)
    r = _signed_in(flow_posts).post("/api/schwab/earnings", json={"symbols": ["nvda"]})
    assert r.status_code == 200
    assert r.json() == {"earnings": {"NVDA": {"date": "12/4", "daysUntil": 16,
                                              "confirmed": True, "timing": ""}}}
    assert flow_posts.calls["earnings"] == ["NVDA"]


def test_the_batch_earnings_read_takes_the_service_token(flow_posts, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    r = flow_posts.post("/api/schwab/earnings", json={"symbols": []}, headers=BEARER)
    assert r.status_code == 200 and r.json() == {"earnings": {}}


@pytest.mark.parametrize("path,body,bucket", [
    ("/api/schwab/track-contracts", CONTRACTS, "register"),
    ("/api/schwab/backfill-all", None, "backfill"),
])
def test_the_tracker_operating_routes_refuse_everyone_but_an_admin(
        flow_posts, monkeypatch, path, body, bucket):
    kwargs = {"json": body} if body is not None else {}
    assert flow_posts.post(path, **kwargs).status_code == 403          # no session
    for member in (FREE_MEMBER, PAID_MEMBER):
        sign_in_flow_caller(monkeypatch, member)
        assert _signed_in(flow_posts).post(path, **kwargs).status_code == 403, member["plan"]
    assert flow_posts.calls[bucket] == [], "a refused request must not run the job"


def test_an_admin_registers_contracts_and_gets_the_same_answer(flow_posts, monkeypatch):
    sign_in_flow_caller(monkeypatch, ADMIN)
    r = _signed_in(flow_posts).post("/api/schwab/track-contracts", json=CONTRACTS)
    assert r.status_code == 200 and r.json() == {"status": "ok", "registered": 1}
    assert flow_posts.calls["register"] == [CONTRACTS]


def test_an_admin_or_the_service_token_runs_the_backfill(flow_posts, monkeypatch):
    sign_in_flow_caller(monkeypatch, ADMIN)
    r = _signed_in(flow_posts).post("/api/schwab/backfill-all?days_back=30")
    assert r.status_code == 200 and r.json() == {"status": "ok", "contracts": 0, "days_back": 30}

    flow_posts.cookies.clear()
    import api.flow_admin_auth as fa
    monkeypatch.setattr(fa, "validate_session", lambda _c: None)
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    r = flow_posts.post("/api/schwab/backfill-all", headers=BEARER)
    assert r.status_code == 200 and r.json()["days_back"] == 60
    assert flow_posts.calls["backfill"] == [30, 60]


# ── the breadth population read ──────────────────────────────────────────────

@pytest.fixture
def universe(monkeypatch):
    from api.routers import breadth_monitor as bm
    from api.services import breadth_live as bl
    read = []
    monkeypatch.setattr(bl, "universe", lambda: (read.append(1) or (["AAPL", "NVDA"], "2026-11-17")))
    client = _app(bm.router)
    client.read = read
    return client


PATH_UNIVERSE = "/api/breadth-monitor/universe"


def test_the_population_read_refuses_every_caller_without_the_service_token(universe, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    assert universe.get(PATH_UNIVERSE).status_code == 401
    assert universe.get(PATH_UNIVERSE, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert _signed_in(universe).get(PATH_UNIVERSE).status_code == 401      # a session is not the token
    assert universe.read == [], "a refused request must not read the population"


def test_an_unset_secret_opens_nothing(universe, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "")
    assert universe.get(PATH_UNIVERSE, headers={"Authorization": "Bearer "}).status_code == 401
    assert universe.read == []


def test_the_worker_reads_the_population_in_the_same_shape(universe, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    r = universe.get(PATH_UNIVERSE, headers=BEARER)
    assert r.status_code == 200
    assert r.json() == {"tickers": ["AAPL", "NVDA"], "date": "2026-11-17", "count": 2}


def test_the_workers_own_request_carries_the_token_this_route_asks_for(monkeypatch):
    """The one caller of this route (`breadth_history_recon._resolve_universe`)
    builds its request with the same bearer the gate checks. Read off the
    request it actually builds, with the network replaced."""
    import json
    import urllib.request
    from api.services import breadth_history_recon as recon
    from api.services import breadth_live as bl
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    monkeypatch.setenv("DASHBOARD_URL", "https://dashboard.example.test")
    monkeypatch.setattr(bl, "universe", lambda: ([], None))      # the worker pod: no local snapshot
    sent = {}

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps({"tickers": ["nvda", "AAPL"], "date": "2026-11-17"}).encode()

    def fake_urlopen(req, timeout=None):
        sent["url"] = req.full_url
        sent["auth"] = req.get_header("Authorization")
        return _Resp()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assert recon._resolve_universe() == (["AAPL", "NVDA"], "2026-11-17")
    assert sent == {"url": "https://dashboard.example.test" + PATH_UNIVERSE,
                    "auth": f"Bearer {SECRET}"}


# ── the live-flow admin reads: gated by the route, not only by the middleware ─

def test_the_live_admin_reads_carry_the_admin_gate_themselves():
    """On a bare app with NO admin middleware installed, each still refuses an
    anonymous caller and a signed-in member: the route names its own audience."""
    import api.liveflow_router as lf
    client = _app(lf.router)
    paths = ("/api/live/admin/baselines/summary",
             "/api/live/admin/baselines/NVDA",
             "/api/live/admin/debug-retag?ticker=NVDA&premium=500000&dte=30")
    for path in paths:
        assert client.get(path).status_code == 403, path


def test_a_member_is_refused_and_an_admin_is_served_the_baseline_summary(monkeypatch):
    import api.baselines as baselines
    import api.liveflow_router as lf
    monkeypatch.setattr(baselines, "baseline_summary", lambda: {"ok": True, "tickers": 0})
    client = _signed_in(_app(lf.router))
    sign_in_flow_caller(monkeypatch, PAID_MEMBER)
    assert client.get("/api/live/admin/baselines/summary").status_code == 403
    sign_in_flow_caller(monkeypatch, ADMIN)
    r = client.get("/api/live/admin/baselines/summary")
    assert r.status_code == 200 and r.json() == {"ok": True, "tickers": 0}
