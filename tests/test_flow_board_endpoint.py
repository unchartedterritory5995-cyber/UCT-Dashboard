"""Packet L CP1 -- GET /api/live/massive/flow-board's first-ever test
coverage. Signed by the owner 2026-09-22 (fingerprint ddcad5b0c).

The route wraps `weekly_flow.board_data()`, which is never mocked away
entirely here -- these tests patch `load_directional_trades`/`aggregate`
(the two calls `board_data` makes) so no real flow.db is touched, mirroring
the minimal-app-per-router pattern in tests/test_flow_ticker_projection.py.
`require_flow_user` (any logged-in session, not paid, not admin) is the real
gate -- installed via tests/authclients.py's `sign_in_flow_caller`, which
patches the flow family's OWN identity check rather than `get_current_user`
(a `from`-imported name, so patching the wrong module reaches nothing).
"""
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.authclients import sign_in_flow_caller


@pytest.fixture(autouse=True)
def _clear_board_cache():
    # `board_data()` keys a 120s TTL cache on (days, cap, min_dte, frac, limit) --
    # several tests below share the default params, so without clearing this a
    # later test would silently read an earlier test's mocked response instead
    # of exercising its own patch.
    from api import weekly_flow as wf
    wf._BOARD_CACHE.clear()
    yield
    wf._BOARD_CACHE.clear()

FAKE_AGG = {
    "bulls": [
        {"sym": "NVDA", "bull": 500_000.0, "bear": 50_000.0, "net": 450_000.0,
         "bullPct": 0.91, "top": {"cp": "C", "K": 900, "exp": "2026-11-20"},
         "first": None, "first_spot": 0, "last_spot": 0},
    ],
    "bears": [
        {"sym": "TSLA", "bull": 20_000.0, "bear": 300_000.0, "net": -280_000.0,
         "bullPct": 0.06, "top": {"cp": "P", "K": 200, "exp": "2026-10-16"},
         "first": None, "first_spot": 0, "last_spot": 0},
    ],
    "n_names": 2, "open_contracts": 2,
}


def _client(monkeypatch):
    from api import live_massive_router as lmr
    sign_in_flow_caller(monkeypatch)
    app = FastAPI()
    app.include_router(lmr.router)
    return TestClient(app)


def test_an_unauthenticated_caller_is_refused():
    from api import live_massive_router as lmr
    app = FastAPI()
    app.include_router(lmr.router)
    resp = TestClient(app).get("/api/live/massive/flow-board")
    assert resp.status_code == 401


def test_a_real_board_response_shapes_rows_correctly(monkeypatch):
    client = _client(monkeypatch)
    with patch("api.weekly_flow.load_directional_trades", return_value=([], ["2026-09-01"])), \
         patch("api.weekly_flow.aggregate", return_value=FAKE_AGG):
        resp = client.get("/api/live/massive/flow-board")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    syms = {r["sym"] for r in body["rows"]}
    assert syms == {"NVDA", "TSLA"}
    nvda = next(r for r in body["rows"] if r["sym"] == "NVDA")
    assert nvda["net"] == 450_000.0
    assert nvda["cp"] == "C"
    assert nvda["strike"] == 900
    assert body["n_names"] == 2
    assert body["open_contracts"] == 2


def test_query_params_pass_through_to_board_data(monkeypatch):
    client = _client(monkeypatch)
    with patch("api.weekly_flow.load_directional_trades", return_value=([], [])) as load, \
         patch("api.weekly_flow.aggregate", return_value={"bulls": [], "bears": [], "n_names": 0, "open_contracts": 0}):
        resp = client.get("/api/live/massive/flow-board", params={"days": 30, "cap": "mega", "limit": 50})
    assert resp.status_code == 200
    assert resp.json()["days"] == 30
    assert resp.json()["cap"] == "mega"
    # min_dte/min_premium are board_data's own defaults, not request params --
    # confirming days/cap actually reached load_directional_trades.
    call_kwargs = load.call_args
    assert call_kwargs.args[0] == 30 or call_kwargs.kwargs.get("days") == 30


def test_an_internal_failure_degrades_honestly_never_a_500(monkeypatch):
    client = _client(monkeypatch)
    with patch("api.weekly_flow.load_directional_trades", side_effect=RuntimeError("boom")):
        resp = client.get("/api/live/massive/flow-board")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["rows"] == []


def test_rows_are_capped_at_the_limit_param(monkeypatch):
    many = {
        "bulls": [
            {"sym": f"T{i}", "bull": 100.0, "bear": 0.0, "net": float(100 - i),
             "bullPct": 1.0, "top": {}, "first": None, "first_spot": 0, "last_spot": 0}
            for i in range(10)
        ],
        "bears": [], "n_names": 10, "open_contracts": 10,
    }
    client = _client(monkeypatch)
    with patch("api.weekly_flow.load_directional_trades", return_value=([], [])), \
         patch("api.weekly_flow.aggregate", return_value=many):
        resp = client.get("/api/live/massive/flow-board", params={"limit": 3})
    assert len(resp.json()["rows"]) == 3
