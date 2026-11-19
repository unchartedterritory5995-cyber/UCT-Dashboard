"""Deep statement history — the series behind the six fundamentals panels.

What matters here is the JOIN and the ORDER: three statements from one provider
aligned onto one axis, oldest first. Both fail silently if wrong — a chart with
time running backwards looks perfectly normal, and a truncated join just draws
a shorter history.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def fh(monkeypatch):
    import api.services.research.financial_history as m
    importlib.reload(m)

    class _Cache:
        def __init__(self): self.d = {}
        def get(self, k): return self.d.get(k)
        def set(self, k, v, ttl=None): self.d[k] = v

    # ONE instance, not a factory: `lambda: _Cache()` builds a fresh cache on
    # every call, so nothing can ever hit and the caching test fails against a
    # service that is working correctly.
    cache = _Cache()
    monkeypatch.setattr(m, "_cache", lambda: cache)
    return m


def _income(dates):
    return [{"date": d, "period": "Q3", "revenue": i * 100,
             "operatingIncome": i * 10, "netIncome": i * 5, "eps": i * 0.1,
             "grossProfit": i * 50, "operatingExpenses": i * 40}
            for i, d in enumerate(dates, start=1)]


def _stub(fh, monkeypatch, income, balance=None, cash=None):
    def _fmp(path, sym, period, limit):
        if "income" in path:
            return income
        if "balance" in path:
            return balance
        return cash
    monkeypatch.setattr(fh, "_fmp", _fmp)


class TestOrderAndLabels:
    def test_periods_come_back_OLDEST_FIRST(self, fh, monkeypatch):
        # FMP returns newest-first. Plotted in that order a growing business
        # draws as a falling line, and nothing about the chart looks broken.
        _stub(fh, monkeypatch, _income(["2026-06-27", "2026-03-28", "2025-12-27"]))
        out = fh.get_history("AAPL")
        assert out["periods"] == ["Q3 2025", "Q3 2026", "Q3 2026"]
        assert out["count"] == 3

    def test_values_stay_aligned_to_their_period(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [
            {"date": "2026-06-27", "period": "Q3", "revenue": 300},
            {"date": "2025-06-27", "period": "Q3", "revenue": 100},
        ])
        out = fh.get_history("AAPL")
        # Sorting the rows must carry the values with them.
        assert out["series"]["revenue"] == [100, 300]

    def test_annual_labels_are_the_year_alone(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [{"date": "2025-09-27", "period": "FY", "revenue": 1}])
        out = fh.get_history("AAPL", period="annual")
        assert out["periods"] == ["2025"]


class TestTheJoin:
    def test_income_is_the_SPINE_and_a_short_cash_history_does_not_truncate(
            self, fh, monkeypatch):
        # Cash flow covers only the newest date. Joining on the intersection
        # would silently drop two thirds of the chart.
        inc = _income(["2024-01-01", "2025-01-01", "2026-01-01"])
        cash = [{"date": "2026-01-01", "freeCashFlow": 999}]
        _stub(fh, monkeypatch, inc, balance=[], cash=cash)
        out = fh.get_history("AAPL")
        assert out["count"] == 3
        assert out["series"]["free_cash_flow"] == [None, None, 999]

    def test_a_missing_statement_entirely_leaves_nulls_not_zeros(self, fh, monkeypatch):
        # A zero asset base is a claim about the company; a null is a gap.
        _stub(fh, monkeypatch, _income(["2026-01-01"]), balance=None, cash=None)
        out = fh.get_history("AAPL")
        assert out["series"]["total_assets"] == [None]
        assert out["series"]["free_cash_flow"] == [None]

    def test_balance_and_cash_join_on_the_income_date(self, fh, monkeypatch):
        inc = _income(["2026-01-01", "2026-04-01"])
        bal = [{"date": "2026-04-01", "totalAssets": 7, "totalLiabilities": 3}]
        _stub(fh, monkeypatch, inc, balance=bal, cash=[])
        out = fh.get_history("AAPL")
        assert out["series"]["total_assets"] == [None, 7]
        assert out["series"]["total_liabilities"] == [None, 3]


class TestDegradesQuietly:
    def test_no_income_statement_is_an_empty_result_not_an_error(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [])
        out = fh.get_history("ZZZZ")
        assert out["periods"] == [] and out["series"] == {}

    def test_a_raising_provider_does_not_escape(self, fh, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("provider down")
        monkeypatch.setattr(fh, "_fmp", boom)
        out = fh.get_history("AAPL")
        assert out["periods"] == []

    def test_a_row_with_no_date_cannot_enter_the_series(self, fh, monkeypatch):
        # Without a date it cannot be joined or ordered, so it is not a period.
        _stub(fh, monkeypatch, [{"period": "Q1", "revenue": 5},
                                {"date": "2026-01-01", "period": "Q1", "revenue": 9}])
        out = fh.get_history("AAPL")
        assert out["count"] == 1 and out["series"]["revenue"] == [9]

    def test_an_empty_symbol_is_not_a_lookup(self, fh):
        assert fh.get_history("")["periods"] == []

    def test_non_numeric_values_become_None_not_zero(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [{"date": "2026-01-01", "period": "Q1",
                                 "revenue": "n/a", "netIncome": None}])
        out = fh.get_history("AAPL")
        assert out["series"]["revenue"] == [None]
        assert out["series"]["net_income"] == [None]


class TestCaching:
    def test_a_second_call_does_not_refetch(self, fh, monkeypatch):
        calls = []

        def _fmp(path, sym, period, limit):
            calls.append(path)
            return _income(["2026-01-01"]) if "income" in path else []
        monkeypatch.setattr(fh, "_fmp", _fmp)

        fh.get_history("AAPL")
        n = len(calls)
        fh.get_history("AAPL")
        assert len(calls) == n, "re-fetched a symbol already cached"

    def test_quarter_and_annual_are_cached_SEPARATELY(self, fh, monkeypatch):
        # One key for both would serve annual rows to a quarterly chart.
        _stub(fh, monkeypatch, _income(["2026-01-01"]))
        q = fh.get_history("AAPL", period="quarter")
        a = fh.get_history("AAPL", period="annual")
        assert q["period"] == "quarter" and a["period"] == "annual"


class TestFiscalLabels:
    """R1: the label's year is FMP's fiscalYear, not the calendar year of date."""

    def test_AAPL_december_quarter_is_fiscal_Q1_of_the_NEXT_year(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [
            {"date": "2025-12-27", "period": "Q1", "fiscalYear": "2026", "revenue": 1},
            {"date": "2025-09-27", "period": "Q4", "fiscalYear": "2025", "revenue": 1},
        ])
        out = fh.get_history("AAPL")
        assert out["periods"] == ["Q4 2025", "Q1 2026"]

    def test_NVDA_columns_read_in_fiscal_order(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [
            {"date": "2025-01-26", "period": "Q4", "fiscalYear": "2025", "revenue": 1},
            {"date": "2025-04-27", "period": "Q1", "fiscalYear": "2026", "revenue": 1},
            {"date": "2025-07-27", "period": "Q2", "fiscalYear": "2026", "revenue": 1},
        ])
        out = fh.get_history("NVDA")
        assert out["periods"] == ["Q4 2025", "Q1 2026", "Q2 2026"]

    def test_annual_label_is_the_fiscal_year(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [{"date": "2025-01-26", "period": "FY",
                                 "fiscalYear": "2025", "revenue": 1}])
        assert fh.get_history("NVDA", period="annual")["periods"] == ["2025"]

    def test_without_fiscalYear_the_calendar_year_is_the_fallback(self, fh):
        assert fh._label("2026-06-27", "Q3", "quarter") == "Q3 2026"
        assert fh._label("2026-06-27", "Q3", "quarter", "") == "Q3 2026"
        assert fh._label("2026-06-27", "Q3", "quarter", 2027) == "Q3 2027"


class TestTransientFailuresAreNotCached:
    """R11: a failed read is not cached as "this company has no financials"."""

    def test_a_raising_income_leg_is_an_error_and_is_NOT_cached(self, fh, monkeypatch):
        calls = []

        def boom(path, sym, period, limit):
            calls.append(path)
            raise RuntimeError("timeout")
        monkeypatch.setattr(fh, "_fmp", boom)
        out = fh.get_history("AAPL")
        assert out["periods"] == [] and out["state"] == "error"
        n = len(calls)
        fh.get_history("AAPL")
        assert len(calls) > n, "a transient failure was served from cache"

    def test_a_genuinely_empty_statement_IS_cached_briefly(self, fh, monkeypatch):
        calls = []

        def nf(path, sym, period, limit):
            calls.append(path)
            raise fh.fmp_client.FMPNotFound("no statement", vendor="fmp")
        monkeypatch.setattr(fh, "_fmp", nf)
        out = fh.get_history("ZZZZ")
        assert out["periods"] == [] and "state" not in out
        n = len(calls)
        fh.get_history("ZZZZ")
        assert len(calls) == n

    def test_a_failed_cash_leg_is_served_but_marked_partial(self, fh, monkeypatch):
        ttls = []
        real_cache = fh._cache()
        orig_set = real_cache.set

        def spy(k, v, ttl=None):
            ttls.append(ttl)
            orig_set(k, v, ttl)
        monkeypatch.setattr(real_cache, "set", spy)

        def _fmp(path, sym, period, limit):
            if "income" in path:
                return _income(["2026-01-01"])
            if "cash" in path:
                raise RuntimeError("503")
            return []
        monkeypatch.setattr(fh, "_fmp", _fmp)
        out = fh.get_history("AAPL")
        assert out["count"] == 1 and out["partial"] == ["cash"]
        assert ttls == [fh._TTL_FAIL]


class TestReportedCurrency:
    """R13: the statement currency is passed through, never converted."""

    def test_currency_is_read_from_the_newest_row(self, fh, monkeypatch):
        _stub(fh, monkeypatch, [
            {"date": "2026-03-31", "period": "Q1", "revenue": 1, "reportedCurrency": "twd"},
            {"date": "2025-12-31", "period": "Q4", "revenue": 1, "reportedCurrency": "TWD"},
        ])
        assert fh.get_history("TSM")["currency"] == "TWD"

    def test_no_currency_field_is_None_not_USD(self, fh, monkeypatch):
        _stub(fh, monkeypatch, _income(["2026-01-01"]))
        assert fh.get_history("AAPL")["currency"] is None


class TestOneReadForConcurrentColdCallers:
    """A cold symbol costs three statement responses ONCE, however many callers
    ask at the same moment: FMP bills the account by the byte."""

    def _gated(self, fh, monkeypatch):
        """A reader stub that holds every leg until `gate` is set."""
        import threading
        calls, gate, started = [], threading.Event(), threading.Event()

        def _fmp(path, sym, period, limit):
            calls.append((path, sym, period))
            started.set()
            assert gate.wait(10), "the test never released the read"
            if "income" in path:
                return [dict(r, researchAndDevelopmentExpenses=7)
                        for r in _income(["2026-01-01", "2026-04-01"])]
            return []
        monkeypatch.setattr(fh, "_fmp", _fmp)
        return calls, gate, started

    def _wait_for_followers(self, key, n):
        import time
        from api.services import single_flight
        deadline = time.time() + 10
        while time.time() < deadline:
            with single_flight._lock:
                call = single_flight._inflight.get(key)
                if call is not None and call.followers >= n:
                    return
            time.sleep(0.01)
        raise AssertionError("the followers never joined the read in flight")

    def test_concurrent_cold_callers_share_ONE_read(self, fh, monkeypatch):
        import threading
        calls, gate, started = self._gated(fh, monkeypatch)
        out, errors = [None] * 5, []

        def ask(i):
            try:
                out[i] = fh.get_history("AAPL", full=(i % 2 == 0))
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=ask, args=(i,)) for i in range(5)]
        threads[0].start()
        assert started.wait(10)
        for t in threads[1:]:
            t.start()
        self._wait_for_followers("fin_hist::v2::AAPL::quarter", 4)
        gate.set()
        for t in threads:
            t.join(10)
        assert not errors, errors
        assert len(calls) == 3, "five callers paid for %d statement reads, not 3" % len(calls)
        assert all(o and o["periods"] == ["Q3 2026", "Q3 2026"] for o in out)
        # The view each caller asked for, whoever led the read.
        for i, o in enumerate(out):
            assert ("extra_series" in o) == (i % 2 == 0), i

    def test_the_flight_is_keyed_per_symbol_and_basis(self, fh, monkeypatch):
        from api.services import single_flight
        keys = []
        real = single_flight.run
        monkeypatch.setattr(single_flight, "run",
                            lambda key, fn, *a, **k: (keys.append(key), real(key, fn, *a, **k))[1])
        _stub(fh, monkeypatch, _income(["2026-01-01"]))
        fh.get_history("aapl")
        fh.get_history("AAPL", period="annual")
        fh.get_history("MSFT")
        assert keys == ["fin_hist::v2::AAPL::quarter", "fin_hist::v2::AAPL::annual",
                        "fin_hist::v2::MSFT::quarter"]

    def test_a_cache_hit_never_enters_the_flight(self, fh, monkeypatch):
        from api.services import single_flight
        _stub(fh, monkeypatch, _income(["2026-01-01"]))
        first = fh.get_history("AAPL")

        def boom(*a, **k):
            raise AssertionError("a cached symbol entered the flight")
        monkeypatch.setattr(single_flight, "run", boom)
        assert fh.get_history("AAPL") == first

    def test_a_caller_that_waited_too_long_gets_a_failed_read_not_an_exception(self, fh, monkeypatch):
        from api.services import single_flight

        def late(key, fn, *a, **k):
            raise single_flight.SingleFlightTimeout("waited 180s")
        monkeypatch.setattr(single_flight, "run", late)
        _stub(fh, monkeypatch, _income(["2026-01-01"]))
        out = fh.get_history("AAPL", period="annual", full=True)
        assert out == {"sym": "AAPL", "period": "annual", "periods": [], "series": {},
                       "state": "error"}
        assert fh._cache().d == {}, "a failed shared read was stored as an answer"

    def test_a_read_that_lost_the_race_to_the_cache_does_not_read_again(self, fh, monkeypatch):
        calls = []

        def _fmp(path, sym, period, limit):
            calls.append(path)
            return _income(["2026-01-01"]) if "income" in path else []
        monkeypatch.setattr(fh, "_fmp", _fmp)
        fh.get_history("AAPL")
        assert len(calls) == 3
        stored = fh._cache().d["fin_hist::v2::AAPL::quarter"]
        # The caller saw a miss, then the previous read stored its answer.
        assert fh._read_history("AAPL", "quarter", 24, "fin_hist::v2::AAPL::quarter") is stored
        assert len(calls) == 3, "read FMP again for a symbol stored a moment earlier"

    def test_the_stored_object_keeps_every_line_whichever_view_led(self, fh, monkeypatch):
        _stub(fh, monkeypatch, _income(["2026-01-01"]))
        lean = fh.get_history("AAPL")
        assert "extra_series" not in lean
        full = fh.get_history("AAPL", full=True)
        assert "extra_series" in full and full["periods"] == lean["periods"]
