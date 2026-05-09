import time
import pytest
from api.services import chart_health_alerts as cha


@pytest.fixture(autouse=True)
def reset():
    cha.clear()
    yield
    cha.clear()


def test_emit_returns_true_first_time():
    """First emit succeeds and gets queued."""
    assert cha.emit("test_key", "warning", "Test message") is True
    alerts = cha.list_recent()
    assert len(alerts) == 1
    assert alerts[0]["alert_key"] == "test_key"
    assert alerts[0]["severity"] == "warning"


def test_emit_throttled_within_window():
    """Second emit of same alert_key within 10min returns False."""
    assert cha.emit("test_key", "warning", "First") is True
    assert cha.emit("test_key", "warning", "Second") is False
    assert len(cha.list_recent()) == 1


def test_different_keys_emit_independently():
    cha.emit("key_a", "warning", "msg_a")
    cha.emit("key_b", "warning", "msg_b")
    assert len(cha.list_recent()) == 2


def test_metadata_preserved():
    cha.emit("test_key", "info", "msg", metadata={"sym": "QQQ", "count": 5})
    alerts = cha.list_recent()
    assert alerts[0]["metadata"]["sym"] == "QQQ"
    assert alerts[0]["metadata"]["count"] == 5


def test_emitted_at_is_recent():
    before = int(time.time())
    cha.emit("test_key", "warning", "msg")
    alerts = cha.list_recent()
    assert alerts[0]["emitted_at"] >= before


def test_list_recent_respects_limit():
    for i in range(10):
        cha.emit(f"key_{i}", "warning", f"msg_{i}")
    alerts = cha.list_recent(limit=5)
    assert len(alerts) == 5


def test_list_recent_returns_newest_first():
    cha.emit("key_1", "warning", "first")
    time.sleep(0.01)
    cha.emit("key_2", "warning", "second")
    alerts = cha.list_recent()
    assert alerts[0]["alert_key"] == "key_2"
    assert alerts[1]["alert_key"] == "key_1"


def test_clear_resets_throttle():
    cha.emit("test_key", "warning", "first")
    cha.clear()
    assert cha.emit("test_key", "warning", "second") is True


def test_alerts_capped_at_max():
    """Default maxlen=200 — adding 250 alerts keeps only the most recent 200."""
    for i in range(250):
        cha.emit(f"key_{i}", "warning", f"msg")
    alerts = cha.list_recent(limit=300)
    assert len(alerts) == 200
