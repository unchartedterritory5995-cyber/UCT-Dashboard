"""S10 (terminal backend fixes, 2026-10-05): both IV-history caches are bounded and evict
their least-recently-used entry, rather than clearing wholesale (rows) or growing without
limit (prints)."""
from api.services.research import iv_history as svc


def test_the_lru_drops_the_coldest_entry_not_everything():
    c = svc._LRU(3)
    for k in "abc":
        c.store(k, k.upper())
    assert c.lookup("a") == "A"          # 'a' is now the warmest
    c.store("d", "D")
    assert list(c) == ["c", "a", "d"]
    assert c.lookup("b") is None and c.lookup("a") == "A" and len(c) == 3


def test_a_cached_none_row_is_a_hit_not_a_miss():
    c = svc._LRU(2)
    c.store("k", None)
    assert c.lookup("k", svc._MISS) is None


def test_the_prints_cache_is_bounded(monkeypatch):
    svc._PRINTS_CACHE.clear()
    import api.services.engine as engine
    monkeypatch.setattr(engine, "_fetch_quarterly_history", lambda sym: [{"reportedDate": "2026-01-01"}])
    monkeypatch.setattr(svc, "with_report_times", lambda sym, q: q)
    for i in range(svc._PRINTS_CACHE_MAX + 50):
        svc._default_prints(f"S{i}")
    assert len(svc._PRINTS_CACHE) == svc._PRINTS_CACHE_MAX
    svc._PRINTS_CACHE.clear()


def test_the_row_cache_is_an_lru_at_its_cap():
    assert isinstance(svc._ROW_CACHE, svc._LRU) and svc._ROW_CACHE.cap == svc._ROW_CACHE_MAX
