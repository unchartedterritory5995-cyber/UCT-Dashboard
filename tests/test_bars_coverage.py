"""Universe-warmth coverage metric (bars_sqlite.coverage_stats) — the ground-truth
measure behind "instant everything". SAMPLE-based (no 100M-row COUNT scan): probes
a random N of each list via the PK-indexed get_last_ts and reports % warm. Drives
the bars-api /api/coverage monitor. Read-only.
"""
from api.services import bars_sqlite as bs


def test_coverage_stats_probes_freshness_by_list():
    bs.init_db()
    bs._COVERAGE_CACHE["data"] = None  # bust the 5-min cache so our inserts count
    bs.put_bars("TCOVA", "D", [{"t": 20260902, "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 10}])
    bs.put_bars("TCOVB", "D", [{"t": 20260902, "o": 1, "h": 2, "l": 1, "c": 1.6, "v": 11}])

    st = bs.coverage_stats(
        sample=["TCOVA", "TCOVB", "TCOV_NOPE"],
        universe=["TCOVA", "TCOVB", "TCOV_NOPE", "TCOV_NOPE2"],
        fresh_within_days=3650,  # huge window → the two real bars count as fresh
    )
    # liquid ("cap") probe: 2 of 3 warm
    assert st["cap_n"] == 3
    assert st["cap_fresh_pct"] == round(100 * 2 / 3, 1)
    # full-universe ("univ") probe: 2 of 4 warm + extrapolated count
    assert st["univ_n"] == 4
    assert st["univ_fresh_pct"] == round(100 * 2 / 4, 1)
    assert st["univ_size"] == 4
    assert st["est_warm_tickers"] == 2  # 4 * 50%


def test_coverage_stats_is_cached():
    bs._COVERAGE_CACHE["data"] = {"cap_fresh_pct": 99.9, "at": 0}
    st = bs.coverage_stats(sample=["ANYTHING"])  # returns cached sentinel, no recompute
    assert st["cap_fresh_pct"] == 99.9
    bs._COVERAGE_CACHE["data"] = None  # reset for other tests
