"""Router-level tests for GET /api/j2/positions/attention (Portfolio/Position
Intelligence Convergence V1, Part B).

Standalone FastAPI app carrying just the journal_two router, a temp auth.db
(same pattern as tests/test_journal_two_compass_router.py), and an auth
dependency override (same pattern as tests/test_broker_router.py) so the
401-without-session case exercises the REAL get_current_user dependency
rather than a stub. `watchlist_intelligence.get_intelligence_for_symbols`
and `live_prices.get_live_prices` are stubbed per-test so these tests never
reach the network -- the intelligence function's own fact-resolution
behavior is covered by tests/test_watchlist_intelligence.py and is reused
here verbatim, never reimplemented.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _seed_account(user_id, name="Default"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.create_account(
        user_id, {"name": name, "color": "blue", "startingBalance": 100_000},
    )


def _seed_position(user_id, account_id, symbol, **overrides):
    from api.services.journal_two import positions as positions_service
    payload = {
        "accountId": account_id,
        "symbol": symbol,
        "side": "Long",
        "entryDate": "2026-06-01",
        "shares": 10,
        "entryPrice": 100,
        "stopPrice": 90,
    }
    payload.update(overrides)
    return positions_service.create_position(user_id, payload, {}, account_id=account_id)


def _stub_intel(monkeypatch, recorder=None, status="ok"):
    """Replaces get_intelligence_for_symbols with a deterministic stub and
    (optionally) records every call's (symbols, changes) for assertion."""
    def fake(symbols, changes=None):
        if recorder is not None:
            recorder.append({"symbols": list(symbols), "changes": changes})
        return {
            s: {"status": status, "notable": False, "facts": [],
                "context": {"composite_rating": None, "rs_rank": None}}
            for s in symbols
        }
    monkeypatch.setattr(
        "api.services.watchlist_intelligence.get_intelligence_for_symbols", fake,
    )
    return fake


def _stub_live_prices_empty(monkeypatch):
    monkeypatch.setattr("api.routers.live_prices.get_live_prices", lambda tickers: {})


def _stub_live_prices_raises(monkeypatch):
    def boom(tickers):
        raise RuntimeError("boom")
    monkeypatch.setattr("api.routers.live_prices.get_live_prices", boom)


# 1. Requires auth ────────────────────────────────────────────────────────────

def test_requires_auth_401_without_session(client):
    r = client.get("/api/j2/positions/attention")
    assert r.status_code == 401


# 2. Zero positions → {} ──────────────────────────────────────────────────────

def test_returns_empty_dict_for_zero_open_positions(app, client, monkeypatch):
    _login_as(app, "u_empty")
    _stub_live_prices_empty(monkeypatch)
    recorder = []
    _stub_intel(monkeypatch, recorder)
    r = client.get("/api/j2/positions/attention")
    assert r.status_code == 200
    assert r.json() == {}
    # The intelligence function must not even be called for an empty symbol set.
    assert recorder == []


# 3. Dedup + uppercase across accounts ────────────────────────────────────────

def test_dedupes_and_uppercases_symbols_across_accounts(app, client, monkeypatch):
    _login_as(app, "u_multi")
    acc1 = _seed_account("u_multi", "Acc1")
    acc2 = _seed_account("u_multi", "Acc2")
    _seed_position("u_multi", acc1["id"], "aapl")
    _seed_position("u_multi", acc2["id"], "AAPL")   # same symbol, different account
    _seed_position("u_multi", acc2["id"], "msft")
    _stub_live_prices_empty(monkeypatch)
    recorder = []
    _stub_intel(monkeypatch, recorder)

    r = client.get("/api/j2/positions/attention")
    assert r.status_code == 200
    assert set(r.json().keys()) == {"AAPL", "MSFT"}
    assert recorder[0]["symbols"] == sorted(recorder[0]["symbols"])  # dedupe check below
    assert sorted(recorder[0]["symbols"]) == ["AAPL", "MSFT"]


# 4. account_id filter narrows results ────────────────────────────────────────

def test_account_id_filters_to_that_accounts_symbols_only(app, client, monkeypatch):
    _login_as(app, "u_acct")
    acc1 = _seed_account("u_acct", "Acc1")
    acc2 = _seed_account("u_acct", "Acc2")
    _seed_position("u_acct", acc1["id"], "AAPL")
    _seed_position("u_acct", acc2["id"], "TSLA")
    _stub_live_prices_empty(monkeypatch)
    _stub_intel(monkeypatch)

    r_all = client.get("/api/j2/positions/attention")
    assert set(r_all.json().keys()) == {"AAPL", "TSLA"}

    r_scoped = client.get("/api/j2/positions/attention", params={"account_id": acc1["id"]})
    assert set(r_scoped.json().keys()) == {"AAPL"}


# 5. Degrades gracefully when the changes adapter fails ──────────────────────

def test_degrades_gracefully_when_live_price_lookup_fails(app, client, monkeypatch):
    _login_as(app, "u_degrade")
    acc = _seed_account("u_degrade")
    _seed_position("u_degrade", acc["id"], "NVDA")
    _stub_live_prices_raises(monkeypatch)
    recorder = []
    _stub_intel(monkeypatch, recorder)

    r = client.get("/api/j2/positions/attention")
    assert r.status_code == 200
    assert "NVDA" in r.json()
    # get_intelligence_for_symbols must still be called, with changes=None --
    # never crashes the whole endpoint over one failed price lookup.
    assert recorder == [{"symbols": ["NVDA"], "changes": None}]


def test_degrades_gracefully_when_live_prices_returns_a_non_dict_response(app, client, monkeypatch):
    # get_live_prices itself returns a JSONResponse (not a dict) on total
    # failure/empty result -- the endpoint must treat that as "no changes"
    # too, not just a raised exception.
    _login_as(app, "u_degrade2")
    acc = _seed_account("u_degrade2")
    _seed_position("u_degrade2", acc["id"], "NVDA")
    from fastapi.responses import JSONResponse
    monkeypatch.setattr(
        "api.routers.live_prices.get_live_prices",
        lambda tickers: JSONResponse(status_code=503, content={"error": "unavailable"}),
    )
    recorder = []
    _stub_intel(monkeypatch, recorder)

    r = client.get("/api/j2/positions/attention")
    assert r.status_code == 200
    assert recorder == [{"symbols": ["NVDA"], "changes": None}]


# 6. Never leaks another user's positions ─────────────────────────────────────

def test_never_leaks_another_users_positions(app, client, monkeypatch):
    acc_other = _seed_account("u_other")
    _seed_position("u_other", acc_other["id"], "GME")
    _login_as(app, "u_self")
    acc_self = _seed_account("u_self")
    _seed_position("u_self", acc_self["id"], "AAPL")
    _stub_live_prices_empty(monkeypatch)
    _stub_intel(monkeypatch)

    r = client.get("/api/j2/positions/attention")
    assert r.status_code == 200
    assert set(r.json().keys()) == {"AAPL"}
    assert "GME" not in r.json()


# 7. Passes through get_intelligence_for_symbols's real shape unmodified ─────

def test_passes_through_the_real_shape_unmodified(app, client, monkeypatch):
    _login_as(app, "u_shape")
    acc = _seed_account("u_shape")
    _seed_position("u_shape", acc["id"], "NVDA")
    _stub_live_prices_empty(monkeypatch)

    sentinel = {
        "NVDA": {
            "status": "ok",
            "notable": True,
            "facts": [{"kind": "price_move", "label": "Moving +5.0% today",
                       "as_of": "2026-09-05", "source": "live price", "freshness": "fresh"}],
            "context": {"composite_rating": 92, "rs_rank": 88},
        },
    }
    monkeypatch.setattr(
        "api.services.watchlist_intelligence.get_intelligence_for_symbols",
        lambda symbols, changes=None: sentinel,
    )

    r = client.get("/api/j2/positions/attention")
    assert r.status_code == 200
    body = r.json()
    assert body == sentinel
    assert set(body["NVDA"].keys()) == {"status", "notable", "facts", "context"}
