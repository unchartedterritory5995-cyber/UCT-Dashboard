"""GET /api/analyst-actions says WHICH morning wire its list came from.

The list is served unchanged until the next wire is pushed, and it carried no date, so a reader
(the Terminal's UPDG panel, an agent) could not tell this morning's actions from last Friday's.
`wire_date` is the wire's own date; `wire_status` is `wire_freshness` of it, worked out on every
call and never cached (the verdict depends on today's date, the date does not).
"""
from api.services import engine


class _Cache:
    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ttl=None):
        self.store[key] = value


WIRE = {
    "date": "2026-11-16",
    "analyst_actions": [
        {"ticker": "AAA", "action": "Upgrade", "firm": "Firm One", "from_rating": "Hold", "to_rating": "Buy", "price_target": "50"},
        {"ticker": "BBB", "action": "Downgrade", "firm": "Firm Two", "from_rating": "Buy", "to_rating": "Hold", "price_target": "20"},
        {"ticker": "CCC", "action": "Raises PT", "firm": "Firm Three", "from_rating": "", "to_rating": "", "price_target": "75"},
    ],
}


def _setup(monkeypatch, wire):
    cache = _Cache()
    monkeypatch.setattr(engine, "cache", cache)
    monkeypatch.setattr(engine, "_load_wire_data", lambda: wire)
    return cache


def test_the_list_carries_the_date_of_its_wire(monkeypatch):
    _setup(monkeypatch, WIRE)
    out = engine.get_analyst_actions()
    assert out["wire_date"] == "2026-11-16"
    assert out["summary"] == {"upgrades": 1, "downgrades": 1, "pt_changes": 1}
    assert out["wire_status"] in {"fresh", "stale"}


def test_no_wire_is_an_unknown_date_never_a_fresh_empty_list(monkeypatch):
    _setup(monkeypatch, None)
    out = engine.get_analyst_actions()
    assert out["wire_date"] is None
    assert out["wire_status"] == "unknown"
    assert out["upgrades"] == [] and out["downgrades"] == [] and out["pt_changes"] == []


def test_a_wire_without_a_date_is_unknown(monkeypatch):
    _setup(monkeypatch, {"analyst_actions": WIRE["analyst_actions"]})
    out = engine.get_analyst_actions()
    assert out["wire_date"] is None
    assert out["wire_status"] == "unknown"
    assert out["summary"]["upgrades"] == 1


def test_the_date_is_cached_and_the_verdict_is_not(monkeypatch):
    cache = _setup(monkeypatch, WIRE)
    verdicts = iter(["fresh", "stale"])
    seen = []

    def fake_freshness(date):
        seen.append(date)
        return next(verdicts)

    monkeypatch.setattr(engine, "wire_freshness", fake_freshness)
    first = engine.get_analyst_actions()
    second = engine.get_analyst_actions()   # answered from the cache
    assert first["wire_status"] == "fresh"
    assert second["wire_status"] == "stale"
    assert seen == ["2026-11-16", "2026-11-16"]
    cached = cache.store["analyst_actions"]
    assert cached["wire_date"] == "2026-11-16"
    assert "wire_status" not in cached
