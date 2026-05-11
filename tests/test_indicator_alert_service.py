import pytest

from api.services import indicator_alert_service as ias


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()
    return db_path


def test_create_and_list(tmp_db):
    alert_id = ias.create(
        user_id="user-abc", sym="AAPL", indicator="rsi",
        condition="above", threshold=70, tf="D",
    )
    assert alert_id > 0
    alerts = ias.list_for_user("user-abc")
    assert len(alerts) == 1
    assert alerts[0]["indicator"] == "rsi"


def test_active_only_filter(tmp_db):
    a1 = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D")
    a2 = ias.create(user_id="user-abc", sym="MSFT", indicator="rsi",
                    condition="below", threshold=30, tf="D")
    ias.set_active(a2, False)
    active = ias.list_active()
    assert len(active) == 1
    assert active[0]["id"] == a1


def test_delete(tmp_db):
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.delete(a)
    assert ias.get(a) is None


def test_record_trigger(tmp_db):
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.record_trigger(a, last_value=72.5)
    row = ias.get(a)
    assert row["trigger_count"] == 1
    assert row["last_value"] == 72.5
    assert row["triggered_at"] is not None


def test_record_evaluation_no_trigger(tmp_db):
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.record_evaluation(a, last_value=55.0)
    row = ias.get(a)
    assert row["trigger_count"] == 0
    assert row["last_value"] == 55.0
    assert row["last_evaluated_at"] is not None
    assert row["triggered_at"] is None


def test_list_for_user_filters_correctly(tmp_db):
    """Alerts for one user should not appear in another user's list."""
    a1 = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D")
    a2 = ias.create(user_id="user-xyz", sym="MSFT", indicator="rsi",
                    condition="below", threshold=30, tf="D")
    a3 = ias.create(user_id="user-abc", sym="NVDA", indicator="macd",
                    condition="cross_zero", threshold=None, tf="60")

    user1_alerts = ias.list_for_user("user-abc")
    user2_alerts = ias.list_for_user("user-xyz")

    assert len(user1_alerts) == 2
    assert {a["id"] for a in user1_alerts} == {a1, a3}

    assert len(user2_alerts) == 1
    assert user2_alerts[0]["id"] == a2


def test_set_active_persists(tmp_db):
    """Toggling active should persist across re-reads."""
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    # Newly created → active
    assert ias.get(a)["active"] is True

    ias.set_active(a, False)
    assert ias.get(a)["active"] is False

    ias.set_active(a, True)
    assert ias.get(a)["active"] is True


# ─── Router tests ───────────────────────────────────────────────────────────


@pytest.fixture
def client(tmp_db):
    """FastAPI TestClient with auth dependency overridden + the alert service
    DB redirected to a tmp file. The router imports the service module, which
    we monkeypatched in tmp_db, so writes from the route hit the tmp DB."""
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user

    def _fake_user():
        return {"id": "user-abc", "email": "abc@test", "role": "member"}

    app.dependency_overrides[get_current_user] = _fake_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_route_create_and_list(client):
    r = client.post(
        "/api/indicator-alerts",
        json={
            "sym": "aapl", "indicator": "rsi", "condition": "above",
            "threshold": 70, "tf": "D",
        },
    )
    assert r.status_code == 200, r.text
    alert_id = r.json()["id"]
    assert alert_id > 0

    r2 = client.get("/api/indicator-alerts")
    assert r2.status_code == 200
    alerts = r2.json()["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["sym"] == "AAPL"  # uppercased by route
    assert alerts[0]["user_id"] == "user-abc"


def test_route_delete(client):
    # Create as the override user
    r = client.post(
        "/api/indicator-alerts",
        json={"sym": "AAPL", "indicator": "rsi", "condition": "above",
              "threshold": 70, "tf": "D"},
    )
    alert_id = r.json()["id"]

    # A different user creates their own alert directly via service
    other_id = ias.create(
        user_id="someone-else", sym="MSFT", indicator="rsi",
        condition="below", threshold=30, tf="D",
    )

    # The override user cannot delete the other user's alert → 404
    r404 = client.delete(f"/api/indicator-alerts/{other_id}")
    assert r404.status_code == 404

    # But can delete their own
    rok = client.delete(f"/api/indicator-alerts/{alert_id}")
    assert rok.status_code == 200
    assert ias.get(alert_id) is None
    # Other user's alert untouched
    assert ias.get(other_id) is not None


def test_route_toggle(client):
    r = client.post(
        "/api/indicator-alerts",
        json={"sym": "AAPL", "indicator": "rsi", "condition": "above",
              "threshold": 70, "tf": "D"},
    )
    alert_id = r.json()["id"]
    assert ias.get(alert_id)["active"] is True

    r2 = client.post(f"/api/indicator-alerts/{alert_id}/toggle")
    assert r2.status_code == 200
    assert r2.json()["active"] is False
    assert ias.get(alert_id)["active"] is False

    r3 = client.post(f"/api/indicator-alerts/{alert_id}/toggle")
    assert r3.status_code == 200
    assert r3.json()["active"] is True
    assert ias.get(alert_id)["active"] is True
