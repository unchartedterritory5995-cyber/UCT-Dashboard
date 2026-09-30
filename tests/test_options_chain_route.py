"""BRK-01 increment 1 — the member-facing option chain routes (api/routers/options_chain.py)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_chain as oc

PAID = {"id": "u1", "role": "member", "plan": "pro", "subscription_status": "active"}
FREE = {"id": "u2", "role": "member", "plan": "free", "subscription_status": None}
CHAIN = {"ticker": "SPY", "expiration": "2026-10-23", "spot": 764.2,
         "calls": [{"strike": 760, "iv": 0.145, "delta": 0.58, "type": "call"}],
         "puts": [{"strike": 760, "iv": 0.151, "delta": -0.42, "type": "put"}],
         "source": "polygon (Massive Advanced)"}


def _client(user, monkeypatch, chain=CHAIN, exps=None):
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.services import polygon_options
    monkeypatch.setattr(polygon_options, "get_chain", lambda s, expiration="", strikes_around_spot=6: dict(chain))
    monkeypatch.setattr(polygon_options, "list_expirations",
                        lambda s: exps or {"ticker": s, "count": 1, "expirations": ["2026-10-23"]})
    monkeypatch.setattr(oc, "is_paid_user", lambda u: u.get("plan") == "pro")
    app = FastAPI()
    app.include_router(oc.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


def test_dark_by_default(monkeypatch):
    monkeypatch.delenv(oc.ENABLED_ENV, raising=False)
    c = _client(PAID, monkeypatch)
    assert c.get("/api/research/options/SPY/chain").status_code == 404
    assert c.get("/api/research/options/SPY/expirations").status_code == 404


def test_armed_serves_paid_and_refuses_free(monkeypatch):
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    r = _client(PAID, monkeypatch).get("/api/research/options/SPY/chain?expiration=2026-10-23&strikes=10")
    assert r.status_code == 200
    b = r.json()
    assert b["spot"] == 764.2 and b["calls"][0]["delta"] == 0.58
    assert b["iv_rank"] is None and "IV history" in b["iv_rank_reason"]   # rank is never faked
    assert _client(FREE, monkeypatch).get("/api/research/options/SPY/chain").status_code == 402


def test_a_provider_failure_is_503_not_an_empty_chain(monkeypatch):
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    r = _client(PAID, monkeypatch, chain={"error": "polygon request failed: timeout", "ticker": "SPY"}) \
        .get("/api/research/options/SPY/chain")
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]


def test_a_malformed_expiration_is_refused(monkeypatch):
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    assert _client(PAID, monkeypatch).get("/api/research/options/SPY/chain?expiration=soon").status_code == 422


def test_the_auth_payload_carries_the_flag(monkeypatch):
    from api.routers import auth
    monkeypatch.delenv(oc.ENABLED_ENV, raising=False)
    assert auth._options_chain_enabled() is False
    monkeypatch.setenv(oc.ENABLED_ENV, "1")
    assert auth._options_chain_enabled() is True
