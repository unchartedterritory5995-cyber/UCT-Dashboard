"""Rail: split/IPO metadata lives in its own cache, sized for the universe (2026-11-12).
In the shared 1,000-entry app LRU a 7-day entry was evicted within minutes and re-fetched
from FMP all day."""
from api.services import bars_sanitize as san
from api.services.cache import cache as shared


def test_meta_cache_is_not_the_shared_lru():
    assert san._META_CACHE is not shared
    assert san._META_CACHE.max_size >= 10000


def test_shared_cache_churn_does_not_evict_metadata():
    key = san._META_KEY.format("ZZMETAKEEP")
    san._META_CACHE.set(key, {"ipo": None, "splits": [("2020-01-02", 2.0)]}, ttl=3600)
    try:
        for i in range(shared.max_size + 200):              # the rest of the app filling the LRU
            shared.set(f"zz_churn_{i}", i, ttl=60)
        assert san._meta_cached("ZZMETAKEEP") == {"ipo": None, "splits": [("2020-01-02", 2.0)]}
    finally:
        san._META_CACHE.invalidate(key)
        for i in range(shared.max_size + 200):
            shared.invalidate(f"zz_churn_{i}")
