from unittest.mock import patch
from fastapi.testclient import TestClient


def _client_with_auth():
    from api.main import app
    from api.routers import expected_move as em_router
    app.dependency_overrides[em_router.get_current_user] = lambda: {"id": "u1", "email": "t@t"}
    return TestClient(app), app, em_router


def test_expected_move_endpoint_shape():
    client, app, em_router = _client_with_auth()
    live = {"pct": 6.8, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}
    hist = [{"sym": "TST", "report_date": "2026-05-06", "captured_at": "c",
             "pct": 4.0, "dollar": 7.0, "expiry": "2026-05-08"}]
    with patch.object(em_router.implied_move, "get_expected_move", return_value=live), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=hist):
        r = client.get("/api/research/expected-move/TST?report_date=2026-08-06")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    body = r.json()
    assert body["live"]["pct"] == 6.8 and body["history"][0]["report_date"] == "2026-05-06"


def test_expected_move_endpoint_requires_auth():
    from api.main import app
    client = TestClient(app)
    r = client.get("/api/research/expected-move/TST")
    assert r.status_code in (401, 403)
