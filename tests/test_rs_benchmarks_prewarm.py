"""Every benchmark the UCT Relative Strength resolver can hand back has a seat
in the bars prewarm priority set (plan §4 row "cap_universe.json", §17 item 7).

The RS lane reads benchmark bars from bars.db only (`_fetch_bars_for_tf` →
`bars_sqlite.get_bars`, no on-demand fetch), so a benchmark the warm never
touched draws nothing. cap_universe.json is an equity screen and lacks RSP and
four sector ETFs, which is why membership is pinned here. Both sides are
IMPORTED, never re-typed: if `rs_benchmarks` grows a benchmark, this test is
what notices the warm did not follow.
"""
from api.services import bars_prewarm, rs_benchmarks


def _warmed() -> set:
    return {t.upper() for t in bars_prewarm.PRIORITY_TICKERS}


def test_every_literal_benchmark_is_in_the_priority_warm_set():
    missing = [t for t in rs_benchmarks.LITERAL_BENCHMARKS if t.upper() not in _warmed()]
    assert missing == [], f"literal benchmarks not prewarmed: {missing}"


def test_every_sector_etf_is_in_the_priority_warm_set():
    missing = [etf for etf in rs_benchmarks.SECTOR_ETF.values() if etf.upper() not in _warmed()]
    assert missing == [], f"sector ETFs not prewarmed: {missing}"


def test_default_benchmark_is_in_the_priority_warm_set():
    assert rs_benchmarks.DEFAULT_BENCHMARK.upper() in _warmed()


def test_rs_benchmark_tickers_are_derived_from_the_resolver_module():
    expected = {t.upper() for t in rs_benchmarks.LITERAL_BENCHMARKS} | {
        t.upper() for t in rs_benchmarks.SECTOR_ETF.values()}
    assert set(bars_prewarm.RS_BENCHMARK_TICKERS) == expected
    assert len(bars_prewarm.RS_BENCHMARK_TICKERS) == len(set(bars_prewarm.RS_BENCHMARK_TICKERS)), "duplicates"


def test_priority_list_has_no_duplicates():
    assert len(bars_prewarm.PRIORITY_TICKERS) == len(set(bars_prewarm.PRIORITY_TICKERS))


def test_control_a_made_up_ticker_is_not_in_the_priority_warm_set():
    assert "ZZZNOTABENCHMARK" not in _warmed()
