"""Licensed-first pass 1 (2026-11-28): licensed or public-domain sources before Yahoo.

* SEC EDGAR statements (`edgar_statements`, public domain) before the Yahoo
  statements in financial_statements, research/financials and annual_financials.
* Massive's daily aggregates read directly before the Yahoo history in the
  earnings run-up / past moves and the ratings price leg.

No network: SEC, Massive, FMP and Yahoo are stood in at each module's seams.
conftest's `_licensed_fallbacks_cannot_answer` makes both new reads answer
"nothing" for every other test; this file puts the real ones back where it
drives them.
"""
from __future__ import annotations

import datetime as _dt
import threading
import time
from datetime import date

import pytest

import api.services.earnings_reaction as er
import api.services.edgar_statements as es
from api.services.fundamentals_pit.facts import Fact

REAL_SNAPSHOT = es.snapshot
REAL_MASSIVE_BARS = er.massive_daily_bars


def F(concept, val, end, start=None, form="10-Q", filed="2025-01-01", unit="USD"):
    return Fact(taxonomy="us-gaap", concept=concept, unit=unit,
                start=date.fromisoformat(start) if start else None, end=date.fromisoformat(end),
                val=float(val), accn="0000000000-25-000001", form=form,
                filed=date.fromisoformat(filed), fy=None, fp=None, frame=None)


# A December filer: Q1-Q3 reported as 3-month figures, Q4 only through the 10-K.
FACTS = [
    F("Revenues", 100, "2024-03-31", "2024-01-01"),
    F("Revenues", 110, "2024-06-30", "2024-04-01"),
    F("Revenues", 120, "2024-09-30", "2024-07-01"),
    F("Revenues", 330, "2024-09-30", "2024-01-01"),               # 9M YTD
    F("Revenues", 460, "2024-12-31", "2024-01-01", form="10-K", filed="2025-02-01"),
    # a lower-priority tag for the same periods never wins over Revenues
    F("SalesRevenueNet", 999, "2024-12-31", "2024-01-01", form="10-K"),
    # a restatement of FY2024 net income in a later 10-K wins over the original
    F("NetIncomeLoss", 40, "2024-12-31", "2024-01-01", form="10-K", filed="2025-02-01"),
    F("NetIncomeLoss", 42, "2024-12-31", "2024-01-01", form="10-K", filed="2026-02-01"),
    F("EarningsPerShareDiluted", 0.25, "2024-03-31", "2024-01-01", unit="USD/shares"),
    # three filed quarters + the year: a flow would get Q4 = FY - (Q1+Q2+Q3); EPS must not
    F("EarningsPerShareDiluted", 0.27, "2024-06-30", "2024-04-01", unit="USD/shares"),
    F("EarningsPerShareDiluted", 0.28, "2024-09-30", "2024-07-01", unit="USD/shares"),
    F("EarningsPerShareDiluted", 1.10, "2024-12-31", "2024-01-01", form="10-K", unit="USD/shares"),
    F("PaymentsToAcquirePropertyPlantAndEquipment", 30, "2024-12-31", "2024-01-01", form="10-K"),
    F("Assets", 5000, "2024-12-31", form="10-K"),
    F("Assets", 4800, "2024-09-30"),
    # a non-periodic form is never read
    F("Revenues", 7, "2024-06-30", "2024-04-01", form="8-K", filed="2030-01-01"),
]


class TestEdgarStatementsBuild:
    def test_annual_quarterly_and_balance_from_filed_figures(self):
        built = es.build_statements(FACTS)
        a = built["annual"]["income"][date(2024, 12, 31)]
        assert a["revenue"] == 460                     # Revenues wins over SalesRevenueNet
        assert a["net_income"] == 42                   # the latest filing wins (restatement)
        assert a["eps_diluted"] == 1.10
        q = built["quarterly"]["income"]
        assert q[date(2024, 6, 30)]["revenue"] == 110  # the 8-K's 7 is never read
        assert q[date(2024, 12, 31)]["revenue"] == 130  # Q4 = FY - 9M
        # per-share figures are never derived: Q4 has no EPS
        assert "eps_diluted" not in q[date(2024, 12, 31)]
        assert q[date(2024, 3, 31)]["eps_diluted"] == 0.25
        assert built["annual"]["cashflow"][date(2024, 12, 31)]["capex"] == -30   # cash out is negative
        assert built["annual"]["balance"][date(2024, 12, 31)]["total_assets"] == 5000
        assert built["quarterly"]["balance"][date(2024, 9, 30)]["total_assets"] == 4800

    def test_rows_are_newest_first_and_an_unreported_line_is_none(self):
        rows = es.rows_of(es.build_statements(FACTS), "quarterly", "income")
        assert [r["period_end"] for r in rows] == ["2024-12-31", "2024-09-30", "2024-06-30", "2024-03-31"]
        assert rows[0]["values"]["gross_profit"] is None
        assert set(rows[0]["values"]) == {k for k, *_ in es.INCOME}

    def test_no_usgaap_usd_facts_is_none(self):
        doc = {"facts": {"ifrs-full": {"Revenue": {"units": {"EUR": [
            {"start": "2024-01-01", "end": "2024-12-31", "val": 1, "accn": "a", "form": "20-F",
             "filed": "2025-03-01"}]}}}}}
        assert es._answer_from_doc(doc, 1)["state"] == "none"


class TestEdgarReadAndSnapshot:
    @pytest.fixture(autouse=True)
    def _real(self, monkeypatch):
        monkeypatch.setattr(es, "snapshot", REAL_SNAPSHOT)
        es.reset_for_tests()
        yield
        es.reset_for_tests()

    def test_a_miss_answers_pending_and_reads_once_off_the_caller_thread(self, monkeypatch):
        gate = threading.Event()
        seen = []

        def read(sym):
            seen.append(threading.current_thread().name)
            gate.wait(2)
            return {"state": "ok", "annual": {}, "quarterly": {}}

        monkeypatch.setattr(es, "read_company", read)
        assert es.snapshot("abc")["state"] == "pending"
        assert es.snapshot("ABC")["state"] == "pending"     # the same read, not a second one
        gate.set()
        for _ in range(100):
            if es.snapshot("ABC")["state"] == "ok":
                break
            time.sleep(0.02)
        assert es.snapshot("ABC")["state"] == "ok"
        assert len(seen) == 1 and seen[0].startswith("edgar-stmts")

    def test_a_caller_may_wait_for_its_read(self, monkeypatch):
        monkeypatch.setattr(es, "read_company", lambda sym: {"state": "none", "reason": "x"})
        assert es.snapshot("XYZ", wait_s=2.0)["state"] == "none"

    def test_a_failed_refresh_keeps_the_last_good_statements(self, monkeypatch):
        es._remember("ABC", {"state": "ok", "annual": {}, "quarterly": {}})
        es._remember("ABC", {"state": "unavailable"})
        assert es.snapshot("ABC")["state"] == "ok"

    def test_read_company_states(self, monkeypatch):
        from api.services.fundamentals_pit.sec_client import SecError
        monkeypatch.setattr(es, "_resolve_cik", lambda sym: None)
        assert es.read_company("ABC")["state"] == "none"
        monkeypatch.setattr(es, "_resolve_cik", lambda sym: 123)

        def nf(cik):
            raise SecError("u", 404, "not found")
        monkeypatch.setattr(es, "_companyfacts", nf)
        assert es.read_company("ABC")["state"] == "none"

        def down(cik):
            raise SecError("u", 503, "gave up")
        monkeypatch.setattr(es, "_companyfacts", down)
        assert es.read_company("ABC")["state"] == "unavailable"


def _edgar_ok():
    built = es.build_statements(FACTS)
    return {"state": "ok", "cik": 1, "source": es.SOURCE, "currency": "USD", "fetched_at": 1.0,
            **{b: {s: es.rows_of(built, b, s) for s in es.STATEMENTS} for b in ("annual", "quarterly")}}


class TestFinancialStatementsChain:
    @pytest.fixture
    def fs(self, monkeypatch):
        import api.services.financial_statements as fs
        monkeypatch.setattr(fs, "_build_licensed", lambda sym: (None, "empty"))
        self.yahoo = []

        def yahoo(sym):
            self.yahoo.append(sym)
            return {"ticker": sym, "income": {"annual": [], "quarterly": []}, "meta": {"source": "Yahoo Finance"}}
        monkeypatch.setattr(fs, "_build", yahoo)
        return fs

    def test_edgar_comes_before_yahoo(self, fs, monkeypatch):
        monkeypatch.setattr(fs, "_edgar_snapshot", lambda sym: _edgar_ok())
        out, hold = fs._build_first("ABC")
        assert self.yahoo == []
        assert out["meta"]["source"] == "SEC EDGAR" and hold == "keep"
        assert out["income"]["annual"][0]["period"] == "2024-12-31"
        assert out["income"]["annual"][0]["values"]["revenue"] == 460
        assert out["income"]["quarterly"][0]["values"]["revenue"] == 130
        assert out["income"]["ttm"]["revenue"] == 460          # four filed quarters
        assert out["cashflow"]["annual"][0]["values"]["capex"] == -30

    @pytest.mark.parametrize("state,hold", [("pending", "brief"), ("unavailable", "brief"), ("none", "keep")])
    def test_yahoo_stands_in_only_when_edgar_cannot(self, fs, monkeypatch, state, hold):
        monkeypatch.setattr(fs, "_edgar_snapshot", lambda sym: {"state": state})
        out, got = fs._build_first("ABC")
        assert self.yahoo == ["ABC"]
        assert got == hold
        assert out["meta"]["sources_tried"] == ["FMP", "SEC EDGAR", "Yahoo Finance"]
        assert out["meta"]["edgar_state"] == state

    def test_a_failed_fmp_read_never_reaches_either_fallback(self, fs, monkeypatch):
        monkeypatch.setattr(fs, "_build_licensed", lambda sym: (None, "error"))
        monkeypatch.setattr(fs, "_edgar_snapshot", lambda sym: pytest.fail("EDGAR read on a failed FMP read"))
        out, hold = fs._build_first("ABC")
        assert hold == "retry" and self.yahoo == []

    def test_callers_name_edgar(self):
        import api.services.earnings_intel as ei
        from api.services.uct_agent.marketdata import statements as st
        assert ei._statement_source({"meta": {"source": "SEC EDGAR"}}) == "sec-edgar-statement"
        assert st._source_of({"source": "SEC EDGAR"}) == "sec-edgar"
        assert st._source_of({"source": "Yahoo Finance"}) == "yahoo-finance"
        assert st._source_of({"source": "FMP"}) == "fmp"


class TestResearchFinancialsChain:
    @pytest.fixture
    def rig(self, monkeypatch):
        from tests.test_research_financials_fmp_first import _Rig
        r = _Rig(monkeypatch)
        r.fmp = {"quarter": "empty", "annual": "empty"}
        return r

    def test_edgar_grids_before_yahoo(self, rig, monkeypatch):
        monkeypatch.setattr(rig.m, "_edgar_snapshot", lambda sym: _edgar_ok())
        out = rig.build()
        assert rig.yahoo_calls == []
        assert out["sources"]["statements"] == "SEC EDGAR"
        assert out["annual"][0]["period"] == "2024" and out["annual"][0]["revenue"] == 460
        assert out["quarterly"][0]["period"] == "Q4 2024" and out["quarterly"][0]["revenue"] == 130
        assert out["currency"] == "USD"
        assert rig.ttl() == rig.m._FMP_TTL

    def test_pending_edgar_serves_yahoo_on_the_short_ttl(self, rig, monkeypatch):
        monkeypatch.setattr(rig.m, "_edgar_snapshot", lambda sym: {"state": "pending"})
        out = rig.build()
        assert out["sources"]["statements"] == "Yahoo Finance"
        assert rig.ttl() == rig.m._FAIL_TTL

    def test_edgar_with_nothing_keeps_the_yahoo_answer_as_before(self, rig, monkeypatch):
        monkeypatch.setattr(rig.m, "_edgar_snapshot", lambda sym: {"state": "none"})
        out = rig.build()
        assert out["sources"]["statements"] == "Yahoo Finance"
        assert rig.ttl() == rig.m._CACHE_TTL


class TestAnnualActualsChain:
    def test_edgar_fills_before_yahoo_and_yahoo_only_what_is_left(self, monkeypatch, tmp_path):
        from tests.test_annual_financials import _mod
        af, _ = _mod(monkeypatch, tmp_path)
        rows = [{"period_end": f"{y}-12-31", "values": {"revenue": 100.0 + y, "eps_diluted": None, "eps_basic": 1.0}}
                for y in range(2018, 2026)]
        monkeypatch.setattr(es, "snapshot", lambda t, wait_s=0.0: {"state": "ok", "annual": {"income": rows}})
        monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
        yahoo = []
        monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: yahoo.append(t) or {})
        monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
        now = _dt.datetime(2026, 6, 1, tzinfo=_dt.timezone.utc).timestamp()
        out = af.get_annual_financials("ABC", years_back=8, now=now)
        assert [r["year"] for r in out] == list(range(2018, 2026))
        assert out[-1]["sales"] == 2125.0 and out[-1]["eps"] == 1.0      # basic, since no diluted is filed
        assert {r["_source"] for r in out} == {"sec_edgar"}
        assert yahoo == [], "EDGAR covered every year: Yahoo is not read"

    def test_yahoo_still_tops_up_what_edgar_left(self, monkeypatch, tmp_path):
        from tests.test_annual_financials import _mod
        af, _ = _mod(monkeypatch, tmp_path)
        monkeypatch.setattr(es, "snapshot", lambda t, wait_s=0.0: {"state": "pending"})
        monkeypatch.setattr(af, "_annual_actuals_from_fmp", lambda t: {})
        monkeypatch.setattr(af, "_annual_actuals_from_yf", lambda t: {2025: {"eps": 2.0, "sales": 9.0}})
        monkeypatch.setattr(af, "_forward_estimates", lambda t, now, last_actual_year=None: [])
        monkeypatch.setattr(af, "_annual_rollup_from_quarters", lambda t, years: {})
        now = _dt.datetime(2026, 6, 1, tzinfo=_dt.timezone.utc).timestamp()
        out = af.get_annual_financials("ABC", years_back=8, now=now)
        assert out and out[0]["_source"] == "yfinance"


def _bars(n, start="2025-06-02", c0=100.0):
    d = date.fromisoformat(start)
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append({"t": d.isoformat(), "o": c0 + len(out), "h": 0, "l": 0, "c": c0 + len(out), "v": 1000})
        d += _dt.timedelta(days=1)
    return out


class TestMassiveBarsBeforeYahoo:
    def test_massive_daily_bars_dates_each_session(self, monkeypatch):
        import api.services.massive as massive
        monkeypatch.setattr(er, "massive_daily_bars", REAL_MASSIVE_BARS)
        ms = int(_dt.datetime(2026, 11, 27, 5, 0, tzinfo=_dt.timezone.utc).timestamp() * 1000)
        monkeypatch.setattr(massive, "get_agg_bars", lambda s, a, b: [
            {"t": ms + 86_400_000 * 4, "o": 2, "c": 2, "v": 1}, {"t": ms, "o": 1, "c": 1, "v": 1}, {"o": 3}])
        out = er.massive_daily_bars("ABC", "2026-11-01", "2026-12-31")
        assert [b["t"] for b in out] == ["2026-11-27", "2026-12-01"]

        def boom(*a):
            raise RuntimeError("down")
        monkeypatch.setattr(massive, "get_agg_bars", boom)
        assert er.massive_daily_bars("ABC", "2026-11-01") == []

    @pytest.fixture
    def ee(self, monkeypatch):
        import api.services.earnings_enrichment as ee
        monkeypatch.setattr(ee, "_own_frame", lambda sym, since: None)
        monkeypatch.setattr(ee, "_frame_is_current", lambda d: True)
        self.yahoo = []

        def yahoo(fn, default, **k):
            self.yahoo.append(1)
            return None
        monkeypatch.setattr(ee.yf_util, "bounded_call", yahoo)
        return ee

    def test_run_up_reads_massive_before_yahoo(self, ee, monkeypatch):
        monkeypatch.setattr(er, "massive_daily_bars", lambda s, since, to=None: _bars(60))
        out = ee.get_pre_earnings_context("ABC")
        assert out is not None and out["ret_5d_pct"] is not None
        assert self.yahoo == []

    def test_a_short_or_stale_massive_frame_goes_on_to_yahoo(self, ee, monkeypatch):
        monkeypatch.setattr(er, "massive_daily_bars", lambda s, since, to=None: _bars(10))
        ee.get_pre_earnings_context("ABC")
        assert self.yahoo == [1]
        self.yahoo.clear()
        monkeypatch.setattr(er, "massive_daily_bars", lambda s, since, to=None: _bars(60))
        monkeypatch.setattr(ee, "_frame_is_current", lambda d: False)
        ee.get_pre_earnings_context("ABC")
        assert self.yahoo == [1]

    def test_past_moves_read_massive_before_yahoo(self, ee, monkeypatch):
        monkeypatch.setattr(er, "massive_daily_bars", lambda s, since, to=None: _bars(300, start="2024-06-03"))
        quarters = [{"reportedDate": "2025-07-15"}, {"reportedDate": "2025-04-15"}]
        out = ee.get_historical_earnings_moves("ABC", quarters)
        assert self.yahoo == []
        assert out is not None

    def test_ratings_price_leg_reads_massive_first(self, monkeypatch):
        from api.services.research import ratings as rt
        monkeypatch.setattr(er, "massive_daily_bars", lambda s, since, to=None: _bars(250))
        monkeypatch.setattr(rt, "fetch_history", lambda *a, **k: pytest.fail("Yahoo read with Massive bars"))
        closes, vols, as_of = rt._massive_history("ABC")
        assert len(closes) == 250 and vols[0] == 1000.0 and as_of == _bars(250)[-1]["t"]
        monkeypatch.setattr(er, "massive_daily_bars", lambda s, since, to=None: _bars(150))
        assert rt._massive_history("ABC") is None
        bad = _bars(250)
        bad[5]["c"] = 0
        monkeypatch.setattr(er, "massive_daily_bars", lambda s, since, to=None: bad)
        assert rt._massive_history("ABC") is None


class TestEarningsNewsMassiveFirst:
    @pytest.fixture
    def eng(self, monkeypatch):
        import api.services.engine as eng
        import api.services.earnings_estimates as ee
        self.fh = []
        monkeypatch.setattr(ee, "_fh_get", lambda path, params, timeout=None: self.fh.append(path) or [
            {"headline": "fh", "source": "Finnhub src", "url": "u", "datetime": 0}])
        return eng

    def _items(self, days_ago):
        now = _dt.datetime.now(_dt.timezone.utc)
        return [{"title": f"t{d}", "publisher": "Benzinga", "article_url": f"u{d}",
                 "published_utc": (now - _dt.timedelta(days=d)).isoformat().replace("+00:00", "Z")}
                for d in days_ago]

    def test_massive_news_first_and_finnhub_is_not_asked(self, eng, monkeypatch):
        from api.services import polygon_news
        monkeypatch.setattr(polygon_news, "get_news", lambda sym, limit=10: {"items": self._items([0, 1, 2, 9])})
        out = eng._earnings_news_items("ABC")
        assert [i["headline"] for i in out] == ["t0", "t1", "t2"]     # older than 3 days is left out
        assert out[0]["source"] == "Benzinga" and out[0]["url"] == "u0"
        assert self.fh == []

    def test_massive_answering_with_nothing_new_is_an_answer(self, eng, monkeypatch):
        from api.services import polygon_news
        monkeypatch.setattr(polygon_news, "get_news", lambda sym, limit=10: {"items": self._items([10])})
        assert eng._earnings_news_items("ABC") == []
        assert self.fh == []

    def test_finnhub_only_when_massive_did_not_answer(self, eng, monkeypatch):
        from api.services import polygon_news
        monkeypatch.setattr(polygon_news, "get_news", lambda sym, limit=10: {"error": "x", "items": []})
        out = eng._earnings_news_items("ABC")
        assert self.fh == ["/company-news"]
        assert out[0]["headline"] == "fh"

        self.fh.clear()

        def boom(sym, limit=10):
            raise RuntimeError("down")
        monkeypatch.setattr(polygon_news, "get_news", boom)
        assert eng._earnings_news_items("ABC")[0]["headline"] == "fh"
        assert self.fh == ["/company-news"]

    def test_the_two_ai_paths_read_the_shared_helper(self):
        import inspect
        import api.services.engine as eng
        src = inspect.getsource(eng)
        assert src.count("news_items = _earnings_news_items(sym") == 2
        assert src.count('"/company-news"') == 1, "one Finnhub news read, inside the last-source helper"


class TestDeadFinnhubCallsAreGone:
    """The Finnhub endpoints that 403 on this plan (price target, upgrades/downgrades,
    transcripts; licensing register T-52) are no longer called anywhere."""

    @pytest.mark.parametrize("path", ['"/stock/price-target"', '"/stock/upgrade-downgrade"',
                                      '"/stock/transcripts/list"', '"/stock/transcripts"'])
    def test_no_production_caller(self, path):
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent / "api"
        hits = [str(p) for p in root.rglob("*.py") if path in p.read_text(encoding="utf-8", errors="replace")]
        assert hits == [], hits
