"""Market-indicator series never build while a member waits once one exists (2026-10-10)."""
import time

from api.services.market_indicators import producers as p


def test_build_serves_persisted_then_stale_without_inline_rebuild(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_SERIES_PERSIST", "1")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    calls = []
    monkeypatch.setattr(p, "_build_uncached", lambda sid: calls.append(sid) or {"sid": sid, "n": len(calls)})
    kicked = []
    monkeypatch.setattr(p, "_kick_rebuild", lambda sid, key: kicked.append(sid))
    p._cache.clear()
    assert p.build("US:MCO") == {"sid": "US:MCO", "n": 1} and calls == ["US:MCO"]
    p._cache.clear()                                     # a deploy
    assert p.build("US:MCO") == {"sid": "US:MCO", "n": 1} and calls == ["US:MCO"]
    assert kicked == []                                  # persisted copy is current
    key = next(iter(p._cache))
    p._cache[key] = (time.time() - p._CACHE_TTL - 5, p._cache[key][1])   # expire
    assert p.build("US:MCO")["n"] == 1 and kicked == ["US:MCO"]          # stale served, kicked
    p._cache.clear()
