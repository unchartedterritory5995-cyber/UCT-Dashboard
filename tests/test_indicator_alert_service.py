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
        user_id=1, sym="AAPL", indicator="rsi",
        condition="above", threshold=70, tf="D",
    )
    assert alert_id > 0
    alerts = ias.list_for_user(1)
    assert len(alerts) == 1
    assert alerts[0]["indicator"] == "rsi"


def test_active_only_filter(tmp_db):
    a1 = ias.create(user_id=1, sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D")
    a2 = ias.create(user_id=1, sym="MSFT", indicator="rsi",
                    condition="below", threshold=30, tf="D")
    ias.set_active(a2, False)
    active = ias.list_active()
    assert len(active) == 1
    assert active[0]["id"] == a1


def test_delete(tmp_db):
    a = ias.create(user_id=1, sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.delete(a)
    assert ias.get(a) is None


def test_record_trigger(tmp_db):
    a = ias.create(user_id=1, sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.record_trigger(a, last_value=72.5)
    row = ias.get(a)
    assert row["trigger_count"] == 1
    assert row["last_value"] == 72.5
    assert row["triggered_at"] is not None


def test_record_evaluation_no_trigger(tmp_db):
    a = ias.create(user_id=1, sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.record_evaluation(a, last_value=55.0)
    row = ias.get(a)
    assert row["trigger_count"] == 0
    assert row["last_value"] == 55.0
    assert row["last_evaluated_at"] is not None
    assert row["triggered_at"] is None


def test_list_for_user_filters_correctly(tmp_db):
    """Alerts for one user should not appear in another user's list."""
    a1 = ias.create(user_id=1, sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D")
    a2 = ias.create(user_id=2, sym="MSFT", indicator="rsi",
                    condition="below", threshold=30, tf="D")
    a3 = ias.create(user_id=1, sym="NVDA", indicator="macd",
                    condition="cross_zero", threshold=None, tf="60")

    user1_alerts = ias.list_for_user(1)
    user2_alerts = ias.list_for_user(2)

    assert len(user1_alerts) == 2
    assert {a["id"] for a in user1_alerts} == {a1, a3}

    assert len(user2_alerts) == 1
    assert user2_alerts[0]["id"] == a2


def test_set_active_persists(tmp_db):
    """Toggling active should persist across re-reads."""
    a = ias.create(user_id=1, sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    # Newly created → active
    assert ias.get(a)["active"] is True

    ias.set_active(a, False)
    assert ias.get(a)["active"] is False

    ias.set_active(a, True)
    assert ias.get(a)["active"] is True
