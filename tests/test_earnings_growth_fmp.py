"""FMP earnings-growth backfill: right statistic, honest refusals.

The point of this module is to fill `earnings_growth_pct` where yfinance left
it blank -- 8 of 40 liquid names sampled 2026-08-06, and EPS is 25% of the UCT
Composite. The two ways it could go wrong are both worse than the blank:
computing a DIFFERENT statistic (the percentile would rank unlike things), or
manufacturing a number from a non-positive base.
"""
import pytest

from api.services import earnings_estimates as ee
from api.services import earnings_growth_fmp as eg
from api.services.cache import cache


def _rows(*net_incomes):
    return [{"netIncome": v} for v in net_incomes]


class TestTheStatisticMatchesYfinance:
    """It must be MOST RECENT QUARTER vs the YEAR-AGO QUARTER.

    TTM-over-TTM is the intuitive choice and was measured to be wrong against
    `info["earningsGrowth"]`: it halves NVDA (107.9 vs 214.5 actual) and nearly
    quadruples LLY (93.5 vs 26.2). If the backfilled 20% carried that
    definition while the other 80% carried yfinance's, the composite's EPS
    PERCENTILE would silently compare unlike things.
    """

    def test_compares_the_year_ago_quarter_not_the_previous_one(self):
        # Q0=200, Q-1=150, Q-2=120, Q-3=110, Q-4(year ago)=100.
        # Year-ago comparison => +100%. Previous-quarter would be +33%.
        assert eg._growth_from_rows(_rows(200, 150, 120, 110, 100)) == 100.0

    def test_is_not_ttm_over_ttm(self):
        """Same rows, the two methods disagree — so this pins WHICH one."""
        rows = _rows(400, 100, 100, 100, 100, 100, 100, 100)
        assert eg._growth_from_rows(rows) == 300.0        # quarter YoY: 400 vs 100
        ttm = (400 + 100 + 100 + 100) - (100 * 4)
        assert eg._growth_from_rows(rows) != round(ttm / 400 * 100, 1)

    def test_a_decline_is_negative(self):
        assert eg._growth_from_rows(_rows(50, 60, 70, 80, 100)) == -50.0

    def test_a_swing_to_a_loss_is_reported(self):
        """PANW/COIN shape: year-ago positive, latest negative. This IS
        defined and IS informative — it must not be refused."""
        assert eg._growth_from_rows(_rows(-50, 10, 10, 10, 100)) == -150.0


class TestItRefusesRatherThanInventing:
    """A percentage from a non-positive base is undefined, not merely large.

    5 of the 8 gaps (JAZZ, CRWD, SNOW, ZS, TEAM) are this case. JAZZ went
    -$405M -> +$941M: a loss-to-profit turnaround where the SIGN FLIP is the
    information and any percentage is arithmetic theatre.
    """

    @pytest.mark.parametrize("year_ago", [-100, -0.01, 0])
    def test_a_non_positive_year_ago_base_yields_None(self, year_ago):
        assert eg._growth_from_rows(_rows(941, 10, 10, 10, year_ago)) is None

    def test_not_enough_history_yields_None(self):
        # Only 4 rows — there is no year-ago quarter to compare against.
        assert eg._growth_from_rows(_rows(100, 90, 80, 70)) is None

    @pytest.mark.parametrize("bad", [None, {}, "nope", [], [{"netIncome": None}] * 6])
    def test_a_malformed_or_empty_response_yields_None(self, bad):
        assert eg._growth_from_rows(bad) is None

    def test_a_missing_netIncome_never_shifts_the_year_ago_index(self):
        """If a blank row were dropped, position 4 would stop being four
        QUARTERS back and this would compare the wrong two periods —
        confidently, and with no way to notice."""
        rows = _rows(200, None, 120, 110, 100)
        # Position 4 is still 100 → +100%, NOT 200-vs-110 (the shifted answer).
        assert eg._growth_from_rows(rows) == 100.0

    def test_a_blank_year_ago_row_is_refused_not_guessed(self):
        assert eg._growth_from_rows(_rows(200, 150, 120, 110, None, 100)) is None


class TestTheFetchLayer:
    @pytest.fixture(autouse=True)
    def _clear(self):
        cache.invalidate("fmp_eg::TEST")
        cache.invalidate("fmp_eg::MISS")
        yield

    def test_it_asks_fmp_for_quarterly_income_and_returns_the_growth(self, monkeypatch):
        seen = {}

        def stub(path, params, timeout=10):
            seen.update(path=path, params=params)
            return _rows(200, 150, 120, 110, 100)

        monkeypatch.setattr(ee, "_fmp_get", stub)
        assert eg.earnings_growth_pct("test") == 100.0
        assert seen["path"] == "/stable/income-statement"
        assert seen["params"]["period"] == "quarter"
        assert seen["params"]["symbol"] == "TEST"      # upper-cased

    def test_a_provider_exception_never_escapes(self, monkeypatch):
        def boom(path, params, timeout=10):
            raise RuntimeError("provider exploded")

        monkeypatch.setattr(ee, "_fmp_get", boom)
        assert eg.earnings_growth_pct("TEST") is None

    def test_a_miss_is_not_cached_as_a_durable_value(self, monkeypatch):
        """`lesson_market_cap_cache_poison`: never cache a failed fetch as if
        it were an answer. A blank gets the SHORT ttl so a provider blip does
        not pin an empty rating for six hours."""
        calls = {"n": 0}
        ttls = []

        def stub(path, params, timeout=10):
            calls["n"] += 1
            return None

        real_set = cache.set
        monkeypatch.setattr(cache, "set", lambda k, v, ttl=None, **kw: (ttls.append(ttl), real_set(k, v, ttl, **kw))[1])
        monkeypatch.setattr(ee, "_fmp_get", stub)
        assert eg.earnings_growth_pct("MISS") is None
        assert ttls and ttls[-1] == eg._MISS_TTL
        assert eg._MISS_TTL < eg._CACHE_TTL

    def test_a_cached_None_is_not_refetched(self, monkeypatch):
        """The sentinel exists so 'asked, no answer' is distinguishable from a
        cache miss — otherwise every blank re-hits the provider every time."""
        calls = {"n": 0}

        def stub(path, params, timeout=10):
            calls["n"] += 1
            return None

        monkeypatch.setattr(ee, "_fmp_get", stub)
        assert eg.earnings_growth_pct("MISS") is None
        assert eg.earnings_growth_pct("MISS") is None
        assert calls["n"] == 1, "a cached blank was refetched"

    def test_an_empty_ticker_never_hits_the_provider(self, monkeypatch):
        def fail(*a, **k):
            raise AssertionError("provider called for an empty ticker")

        monkeypatch.setattr(ee, "_fmp_get", fail)
        assert eg.earnings_growth_pct("") is None

    def test_no_module_level_binding_of_the_provider_call(self):
        """Same rail as earnings_history_fmp: a bound `_fmp_get` copy escapes
        the owning module's cooldown/rate guards AND every test stub."""
        assert not hasattr(eg, "_fmp_get")


class TestTheBackfillIsWiredIntoFundamentals:
    def test_it_only_fires_when_yfinance_left_the_field_blank(self, monkeypatch):
        """yfinance stays authoritative where it HAS a value — otherwise this
        would silently re-baseline the 80% that were already fine, and pay an
        extra request on the common path."""
        from api.services import fundamentals as f

        called = {"n": 0}
        monkeypatch.setattr("api.services.earnings_growth_fmp.earnings_growth_pct",
                            lambda s: (called.__setitem__("n", called["n"] + 1), -167.5)[1])

        info = {"symbol": "PANW", "earningsGrowth": 0.25}
        monkeypatch.setattr(f, "_CACHE", f.TTLCache())
        monkeypatch.setattr("api.services.yf_util.bounded_call", lambda fn, d: info)
        out = f.get_fundamentals("PANW")
        assert out["earnings_growth_pct"] == 25.0
        assert called["n"] == 0
        assert "earnings_growth_source" not in out

    def test_it_fills_the_gap_and_records_the_source(self, monkeypatch):
        from api.services import fundamentals as f

        monkeypatch.setattr("api.services.earnings_growth_fmp.earnings_growth_pct",
                            lambda s: -167.5)
        info = {"symbol": "PANW"}                 # no earningsGrowth at all
        monkeypatch.setattr(f, "_CACHE", f.TTLCache())
        monkeypatch.setattr("api.services.yf_util.bounded_call", lambda fn, d: info)
        out = f.get_fundamentals("PANW")
        assert out["earnings_growth_pct"] == -167.5
        assert out["earnings_growth_source"] == "fmp"

    def test_a_refusal_leaves_the_field_blank_rather_than_stamping_a_source(self, monkeypatch):
        """JAZZ shape. The composite's coverage note explains the gap; a
        source tag with no value would imply we answered when we did not."""
        from api.services import fundamentals as f

        monkeypatch.setattr("api.services.earnings_growth_fmp.earnings_growth_pct",
                            lambda s: None)
        monkeypatch.setattr(f, "_CACHE", f.TTLCache())
        monkeypatch.setattr("api.services.yf_util.bounded_call", lambda fn, d: {"symbol": "JAZZ"})
        out = f.get_fundamentals("JAZZ")
        assert out["earnings_growth_pct"] is None
        assert "earnings_growth_source" not in out

    def test_a_backfill_failure_never_breaks_the_primary_payload(self, monkeypatch):
        from api.services import fundamentals as f

        def boom(s):
            raise RuntimeError("fmp down")

        monkeypatch.setattr("api.services.earnings_growth_fmp.earnings_growth_pct", boom)
        monkeypatch.setattr(f, "_CACHE", f.TTLCache())
        monkeypatch.setattr("api.services.yf_util.bounded_call",
                            lambda fn, d: {"symbol": "PANW", "revenueGrowth": 0.31})
        out = f.get_fundamentals("PANW")
        assert out["revenue_growth_pct"] == 31.0        # payload survived
        assert out["earnings_growth_pct"] is None
