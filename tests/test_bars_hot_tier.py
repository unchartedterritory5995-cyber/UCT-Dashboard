import pytest
from api.services import bars_hot_tier as ht


@pytest.fixture(autouse=True)
def reset():
    ht._reset()
    yield
    ht._reset()


def test_set_and_get():
    ht.set("QQQ", "30", 100, {"bars": [{"t": 1, "c": 100}]})
    payload = ht.get("QQQ", "30", 100)
    assert payload is not None
    assert payload["bars"][0]["c"] == 100


def test_get_returns_none_for_miss():
    assert ht.get("ZZZ", "1", 100) is None


def test_lru_evicts_oldest_when_capacity_exceeded():
    """Capacity is 500. Adding 501 entries evicts the LRU one."""
    for i in range(501):
        ht.set(f"T{i}", "30", 100, {"bars": []})
    assert ht.get("T0", "30", 100) is None
    assert ht.get("T500", "30", 100) is not None


def test_get_promotes_on_access():
    """Accessing a key moves it to most-recently-used position."""
    for i in range(500):
        ht.set(f"T{i}", "30", 100, {"bars": []})
    ht.get("T0", "30", 100)  # promote
    ht.set("T500", "30", 100, {"bars": []})
    assert ht.get("T0", "30", 100) is not None
    assert ht.get("T1", "30", 100) is None  # T1 was evicted instead


def test_clear():
    ht.set("QQQ", "30", 100, {"bars": []})
    ht.clear()
    assert ht.get("QQQ", "30", 100) is None


def test_size_reflects_entry_count():
    ht.set("QQQ", "30", 100, {"bars": []})
    ht.set("SPY", "30", 100, {"bars": []})
    assert ht.size() == 2


def test_set_existing_key_promotes():
    """Re-setting an existing key promotes it to MRU."""
    for i in range(500):
        ht.set(f"T{i}", "30", 100, {"bars": []})
    # Re-set T0 — should promote
    ht.set("T0", "30", 100, {"bars": [{"t": 1}]})
    # Add T500 — should evict T1, NOT T0
    ht.set("T500", "30", 100, {"bars": []})
    assert ht.get("T0", "30", 100) is not None
    assert ht.get("T1", "30", 100) is None


def test_keys_returns_list():
    ht.set("QQQ", "30", 100, {"bars": []})
    ht.set("SPY", "30", 100, {"bars": []})
    keys = ht.keys()
    assert ("QQQ", "30", 100) in keys
    assert ("SPY", "30", 100) in keys


def test_ticker_uppercase_normalization():
    ht.set("qqq", "30", 100, {"bars": []})
    assert ht.get("QQQ", "30", 100) is not None
