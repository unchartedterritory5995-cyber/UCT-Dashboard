from unittest.mock import patch
from fastapi.testclient import TestClient


PAID = {"id": "u1", "email": "t@t", "role": "member", "plan": "pro"}
FREE = {"id": "u2", "email": "f@t", "role": "member", "plan": "free"}


def _client_with_auth(user=None):
    """⚠️ REPAIRED 2026-08-09 — `/api/research/expected-move/{sym}` became
    `require_paid` (its `history` and `grade` are the firm's, not the market's).
    This overrode `get_current_user` and asserted 200, which proved only that a
    SESSION got the data — and signup is open and free.

    ⛔ The override is on `get_current_user_with_plan`, the gate's INPUT, never
    on `require_paid` (`lesson_injected_dependency_hides_the_fetch`)."""
    from api.main import app
    from api.routers import expected_move as em_router
    from api.middleware.auth_middleware import (
        get_current_user, get_current_user_with_plan,
    )
    who = dict(user or PAID)
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app), app, em_router


def test_a_logged_in_FREE_member_is_refused():
    """🔴 THE ASSERTION THAT WAS MISSING."""
    client, app, _ = _client_with_auth(FREE)
    try:
        assert client.get("/api/research/expected-move/NVDA").status_code == 402
    finally:
        app.dependency_overrides.clear()


def test_expected_move_endpoint_shape():
    client, app, em_router = _client_with_auth()
    live = {"pct": 6.8, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}
    hist = [{"sym": "TST", "report_date": "2026-05-06", "captured_at": "c",
             "pct": 4.0, "dollar": 7.0, "expiry": "2026-05-08"}]
    with patch.object(em_router.implied_move, "get_expected_move", return_value=live), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=hist), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value="2026-05-06"), \
         patch.object(em_router.setup_grade, "get_setup_grade", return_value=None):
        r = client.get("/api/research/expected-move/TST?report_date=2026-08-06")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    body = r.json()
    assert body["live"]["pct"] == 6.8 and body["history"][0]["report_date"] == "2026-05-06"
    assert body["history_since"] == "2026-05-06"


def test_expected_move_endpoint_requires_auth():
    from api.main import app
    client = TestClient(app)
    r = client.get("/api/research/expected-move/TST")
    assert r.status_code in (401, 403)


def test_expected_move_endpoint_degrades_when_store_unreadable():
    client, app, em_router = _client_with_auth()
    live = {"pct": 6.8, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}
    import sqlite3
    with patch.object(em_router.implied_move, "get_expected_move", return_value=live), \
         patch.object(em_router.implied_store, "get_implied_history",
                      side_effect=sqlite3.OperationalError("db locked")), \
         patch.object(em_router.setup_grade, "get_setup_grade", return_value=None):
        r = client.get("/api/research/expected-move/TST")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    body = r.json()
    assert body["live"]["pct"] == 6.8 and body["history"] == [] and body["history_since"] is None


def test_expected_move_endpoint_degrades_when_live_read_raises():
    """I3: a raising live read (e.g. a bad-json parse from the options chain)
    must degrade to live=None, not 500 the endpoint — history still serves."""
    client, app, em_router = _client_with_auth()
    hist = [{"sym": "TST", "report_date": "2026-05-06", "captured_at": "c",
             "pct": 4.0, "dollar": 7.0, "expiry": "2026-05-08"}]
    with patch.object(em_router.implied_move, "get_expected_move",
                      side_effect=ValueError("bad json")), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=hist), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value="2026-05-06"), \
         patch.object(em_router.setup_grade, "get_setup_grade", return_value=None):
        r = client.get("/api/research/expected-move/TST")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    body = r.json()
    assert body["live"] is None
    assert body["history"] == hist


def test_expected_move_payload_carries_the_setup_grade():
    client, app, em_router = _client_with_auth()
    live = {"pct": 6.8, "dollar": 12.5, "expiry": "2026-08-07", "strike": 185.0,
            "spot": 184.0, "call_mid": 6.3, "put_mid": 6.2, "iv_atm": 0.6,
            "horizon": "through 2026-08-07", "asof": "x", "source": "massive-chain"}
    grade = {"letter": "B+", "score": 71.2, "basis": "3 of 4 inputs",
             "inputs_present": 3, "inputs_total": 4, "inputs": [], "asof": "x"}
    with patch.object(em_router.implied_move, "get_expected_move", return_value=live), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
         patch.object(em_router.setup_grade, "get_setup_grade", return_value=grade) as gs:
        r = client.get("/api/research/expected-move/TST?report_date=2026-08-06")
    app.dependency_overrides.clear()
    assert r.json()["grade"]["letter"] == "B+"
    # handed the live move the endpoint already computed — never a second chain read
    assert gs.call_args.kwargs["live_move"] == live


def test_expected_move_grade_failure_degrades_to_null_not_500():
    client, app, em_router = _client_with_auth()
    with patch.object(em_router.implied_move, "get_expected_move", return_value=None), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
         patch.object(em_router.setup_grade, "get_setup_grade",
                      side_effect=RuntimeError("boom")):
        r = client.get("/api/research/expected-move/TST")
    app.dependency_overrides.clear()
    assert r.status_code == 200 and r.json()["grade"] is None


def test_expected_move_grade_can_be_opted_out():
    client, app, em_router = _client_with_auth()
    with patch.object(em_router.implied_move, "get_expected_move", return_value=None), \
         patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
         patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
         patch.object(em_router.setup_grade, "get_setup_grade") as gs:
        r = client.get("/api/research/expected-move/TST?grade=0")
    app.dependency_overrides.clear()
    assert r.json()["grade"] is None
    gs.assert_not_called()
