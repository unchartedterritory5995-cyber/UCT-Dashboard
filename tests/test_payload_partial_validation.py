import pytest
from unittest.mock import patch
from api.services import bars_fetch, bar_quarantine


@pytest.fixture
def fresh_q(tmp_path, monkeypatch):
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_quarantine.init_schema()


def test_payload_passes_when_majority_valid(fresh_q):
    """One bad bar in 199 valid bars should still allow the payload through."""
    bars = [{"t": 1715080800 + i*86400, "o": 100, "h": 101, "l": 99, "c": 100, "v": 1000} for i in range(199)]
    bars.append({"t": 1715080800 + 199*86400, "o": -1, "h": -1, "l": -1, "c": -1, "v": -1})  # 1 bad bar
    payload = {"bars": bars, "source": "massive"}
    # Should pass even with 1/200 bad
    assert bars_fetch._payload_passes_validation(payload) is True


def test_payload_fails_when_majority_invalid(fresh_q):
    """If >50% of bars fail, fall through to alt source."""
    bars = []
    for i in range(60):  # 60 bad
        bars.append({"t": 1715080800 + i*86400, "o": -1, "h": -1, "l": -1, "c": -1, "v": -1})
    for i in range(40):  # 40 good
        bars.append({"t": 1715080800 + (60+i)*86400, "o": 100, "h": 101, "l": 99, "c": 100, "v": 1000})
    payload = {"bars": bars, "source": "massive"}
    # 40/100 valid = 40% < 50%, should fail
    assert bars_fetch._payload_passes_validation(payload) is False


def test_payload_fails_when_empty():
    payload = {"bars": []}
    assert bars_fetch._payload_passes_validation(payload) is False


def test_payload_fails_when_none():
    assert bars_fetch._payload_passes_validation(None) is False


def test_existing_clean_payload_still_passes(fresh_q):
    """Regression: clean payload still passes."""
    bars = [{"t": 1715080800 + i*86400, "o": 100, "h": 101, "l": 99, "c": 100, "v": 1000} for i in range(50)]
    payload = {"bars": bars, "source": "massive"}
    assert bars_fetch._payload_passes_validation(payload) is True
