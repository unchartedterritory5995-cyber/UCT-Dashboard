import time
import pytest
from api.services.cache import TTLCache

def test_set_and_get():
    c = TTLCache()
    c.set("key", {"v": 1}, ttl=10)
    assert c.get("key") == {"v": 1}

def test_expired_returns_none():
    c = TTLCache()
    c.set("key", {"v": 1}, ttl=0.01)
    time.sleep(0.02)
    assert c.get("key") is None

def test_missing_key_returns_none():
    c = TTLCache()
    assert c.get("nonexistent") is None

def test_overwrite_key():
    c = TTLCache()
    c.set("key", {"v": 1}, ttl=10)
    c.set("key", {"v": 2}, ttl=10)
    assert c.get("key") == {"v": 2}
