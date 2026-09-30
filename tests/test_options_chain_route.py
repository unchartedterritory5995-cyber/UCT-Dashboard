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


def test_expirations_walk_past_the_first_page(monkeypatch):
    """Measured 2026-09-29: 1,000 SPY contracts covered only THREE expirations, so the member's
    picker offered Wed/Thu/Fri and nothing else. The list walks forward past the last date seen."""
    from api.services import polygon_options as po
    monkeypatch.setattr(po, "_CACHE", po.TTLCache())
    dates = [f"2026-10-{d:02d}" for d in range(1, 29)]           # 28 expirations
    calls = []

    def fake_get(url, params=None):
        calls.append(dict(params))
        after = params.get("expiration_date.gt")
        todo = [d for d in dates if not after or d > after]
        rows = [{"expiration_date": d} for d in todo[:3] for _ in range(334)][:1000]   # a full page = 3 dates
        return {"results": rows}

    monkeypatch.setattr(po, "_safe_get", fake_get)
    out = po.list_expirations("SPY")
    assert out["expirations"] == dates                            # every date, in order, no repeats
    assert out["count"] == 28
    assert calls[0].get("expiration_date.gte") and "expiration_date.gt" not in calls[0]
    assert calls[1]["expiration_date.gt"] == "2026-10-03"         # starts past the last date seen
    assert len(calls) <= po._EXP_QUERIES
