"""PACKET-S CP2 tested a 300s FRED cache TTL here. SUPERSEDED 2026-09-28: FRED is
retired as a source (Economic Data Phase 0/1, owner ruling #10), and
`api/services/fred_economic.py` no longer has a cache, an HTTP client or a key
read at all -- the strongest form of the CP2 fix. The rails now live in
tests/econ/test_fred_retired.py; this file keeps the CP2 intent as one check."""
from api.services import fred_economic


def test_no_fred_cache_exists_at_all():
    assert not hasattr(fred_economic, "_CACHE")
    assert not hasattr(fred_economic, "_CACHE_TTL")
    assert fred_economic.get_series("cpi", periods=2)["error"].startswith("FRED retired")
