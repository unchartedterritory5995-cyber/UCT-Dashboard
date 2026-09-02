"""Universe-warmth coverage metric (bars_sqlite.coverage_stats) — the ground-truth
measure behind "instant everything": distinct ticker counts per timeframe + a
freshness sample. Read-only; drives the bars-api /api/coverage monitor endpoint.
"""
from api.services import bars_sqlite as bs


def test_coverage_stats_counts_distinct_tickers_and_samples_freshness():
    bs.init_db()
    bs._COVERAGE_CACHE["data"] = None  # bust the 5-min cache so our inserts count
    bs.put_bars("TCOVA", "D", [{"t": 20260902, "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 10}])
    bs.put_bars("TCOVB", "D", [{"t": 20260902, "o": 1, "h": 2, "l": 1, "c": 1.6, "v": 11}])
    bs.put_bars("TCOVA", "W", [{"t": 20260829, "o": 1, "h": 2, "l": 1, "c": 1.6, "v": 11}])

    st = bs.coverage_stats(sample=["TCOVA", "TCOVB", "TCOV_NOPE"], fresh_within_days=3650)
    # distinct-ticker counts (>= because the shared sandbox db may hold other rows)
    assert st["d_tickers"] >= 2
    assert st["w_tickers"] >= 1
    # the freshness sample is deterministic for our 3 explicit symbols
    assert st["sample_n"] == 3
    assert st["sample_have_daily"] == 2        # TCOVA, TCOVB have daily; TCOV_NOPE does not
    assert st["sample_fresh_daily"] == 2       # both within the (huge) window


def test_coverage_stats_is_cached():
    bs._COVERAGE_CACHE["data"] = {"d_tickers": 999, "at": 0}
    st = bs.coverage_stats()  # should return the cached sentinel, not recompute
    assert st["d_tickers"] == 999
    bs._COVERAGE_CACHE["data"] = None  # reset for other tests
