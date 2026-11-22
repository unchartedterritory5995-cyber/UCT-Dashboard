"""Tests for the research ownership service + router."""
from api.services.research import ownership as own
from api.services.cache import cache
from api.services import provider_errors as pe
from api.services import short_data


def _result(value, *, degraded=None, freshness="end_of_day"):
    return pe.ProviderResult(
        value=value,
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test", source_observed_at=None),
        licensing_class="R",
        freshness=freshness,
        degraded=degraded,
    )


def _held_answer(**over):
    """A short interest answer as `short_data.build_stock` shapes it (two reports, a float)."""
    answer = {
        "status": "ok", "sym": "TEST",
        "interest": {"state": "ok", "http_status": 200, "reason": None, "count": 2, "cut": False,
                     "first_date": "2026-10-15",
                     "reports": [
                         {"settlement_date": "2026-10-30", "short_interest": 50_000_000,
                          "avg_daily_volume": 27_000_000, "days_to_cover": 1.85,
                          "change_shares": 2_000_000, "change_pct": 4.17},
                         {"settlement_date": "2026-10-15", "short_interest": 48_000_000,
                          "avg_daily_volume": 25_000_000, "days_to_cover": 1.92,
                          "change_shares": None, "change_pct": None},
                     ]},
        "volume": {"state": "none", "http_status": 200, "reason": None},
        "float": {"shares": 6_800_000_000, "pct_float": 0.74, "withheld": False, "state": "ok",
                  "source": short_data.FLOAT_SOURCE},
        "settlement_date": "2026-10-30", "published": None, "publication_estimate": "2026-11-10",
        "read_at": "2026-11-18T14:00:00+00:00", "source": short_data.SOURCE,
    }
    answer.update(over)
    return answer


class TestHeldShort:
    """The short block is the newest FINRA report the short interest service HOLDS. Nothing is
    built or fetched for it here: with nothing held it says `not_held`, never a zero."""

    def test_a_held_report_gives_its_figures_and_its_settlement_date(self, monkeypatch):
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (_held_answer(), "fresh"))
        s = own._held_short("TEST")
        assert s["state"] == "ok"
        assert s["shares_short"] == 50_000_000
        assert s["days_to_cover"] == 1.85
        assert s["settlement_date"] == "2026-10-30"
        assert s["prior_short"] == 48_000_000 and s["prior_settlement_date"] == "2026-10-15"
        assert s["change_shares"] == 2_000_000 and s["change_pct"] == 4.17
        assert s["publication_estimate"] == "2026-11-10"
        assert s["source"] == short_data.SOURCE == "FINRA, through Massive"

    def test_percent_of_float_is_the_services_own_figure(self, monkeypatch):
        """Decided the way SHINT decides it: short interest over the screener export's float, the
        service's number, never recomputed here against another float."""
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (_held_answer(), "fresh"))
        s = own._held_short("TEST")
        assert s["short_pct_float"] == 0.74
        assert s["float_shares"] == 6_800_000_000
        assert s["float_source"] == short_data.FLOAT_SOURCE
        assert s["pct_float_withheld"] is False

    def test_a_withheld_percent_stays_withheld(self, monkeypatch):
        flt = {"shares": 1_000_000, "pct_float": None, "withheld": True, "state": "ok",
               "source": short_data.FLOAT_SOURCE}
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (_held_answer(float=flt), "fresh"))
        s = own._held_short("TEST")
        assert s["state"] == "ok" and s["short_pct_float"] is None and s["pct_float_withheld"] is True

    def test_nothing_held_is_not_held_and_every_figure_is_none(self, monkeypatch):
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        s = own._held_short("TEST")
        assert s["state"] == "not_held"
        for key in ("shares_short", "short_pct_float", "days_to_cover", "settlement_date", "prior_short"):
            assert s[key] is None, key
        assert s["source"] == short_data.SOURCE

    def test_the_last_good_answer_is_used(self, monkeypatch):
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (_held_answer(), "last_good"))
        assert own._held_short("TEST")["state"] == "ok"

    def test_a_refused_data_plan_is_unavailable_with_its_reason(self, monkeypatch):
        refused = {"status": "unavailable", "sym": "TEST",
                   "interest": {"state": "unavailable", "http_status": 403, "reason": "refused"},
                   "volume": {"state": "unavailable", "http_status": 403, "reason": "refused"}}
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (refused, "fresh"))
        s = own._held_short("TEST")
        assert s["state"] == "unavailable" and s["reason"] == "refused" and s["http_status"] == 403
        assert s["shares_short"] is None

    def test_no_rows_at_the_vendor_is_none_not_zero(self, monkeypatch):
        none = _held_answer(interest={"state": "none", "http_status": 200, "reason": None})
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (none, "fresh"))
        s = own._held_short("TEST")
        assert s["state"] == "none" and s["shares_short"] is None

    def test_a_failed_or_unreadable_answer_is_not_held(self, monkeypatch):
        for answer in ({"status": "failed", "sym": "TEST"}, {"status": "bad_symbol", "sym": None},
                       _held_answer(interest={"state": "failed", "http_status": 200, "reason": "shape"}),
                       _held_answer(interest={"state": "ok", "reports": [{"settlement_date": None}]}),
                       "nonsense"):
            monkeypatch.setattr(short_data, "held_stock", lambda sym, a=answer: (a, "fresh"))
            assert own._held_short("TEST")["state"] == "not_held", answer

    def test_a_raising_reader_is_not_held_never_an_error(self, monkeypatch):
        def boom(sym):
            raise RuntimeError("no")
        monkeypatch.setattr(short_data, "held_stock", boom)
        assert own._held_short("TEST")["state"] == "not_held"

    def test_with_no_history_held_the_stocks_row_of_the_market_list_answers(self, monkeypatch):
        """Nobody has opened this stock's short interest panel, but the service keeps the whole
        market's newest report built: the stock's row of it fills the card, and says so."""
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        row = {"sym": "TEST", "short_interest": 9_000_000, "avg_daily_volume": 3_000_000, "days_to_cover": 3.0,
               "prev_short_interest": 6_000_000, "change_shares": 3_000_000, "change_pct": 50.0,
               "float_shares": 90_000_000, "pct_float": 10.0, "settlement_date": "2026-10-30",
               "previous_settlement_date": "2026-10-15", "publication_estimate": "2026-11-10",
               "read_at": "2026-11-18T14:00:00+00:00", "source": short_data.SOURCE,
               "float_source": short_data.FLOAT_SOURCE}
        asked = []

        def held_row(sym):
            asked.append(sym)
            return dict(row), "held"

        monkeypatch.setattr(short_data, "held_market_row", held_row)
        s = own._held_short("TEST")
        assert asked == ["TEST"]
        assert s["state"] == "ok" and s["basis"] == "market_list"
        assert s["shares_short"] == 9_000_000 and s["days_to_cover"] == 3.0 and s["short_pct_float"] == 10.0
        assert s["settlement_date"] == "2026-10-30" and s["prior_short"] == 6_000_000
        assert s["prior_settlement_date"] == "2026-10-15" and s["change_pct"] == 50.0
        assert s["float_shares"] == 90_000_000 and s["pct_float_withheld"] is False
        assert s["float_source"] == short_data.FLOAT_SOURCE and s["source"] == short_data.SOURCE

    def test_the_stocks_own_history_wins_over_the_market_list(self, monkeypatch):
        def never(sym):
            raise AssertionError("the market list was asked although the stock's own history is held")

        monkeypatch.setattr(short_data, "held_stock", lambda sym: (_held_answer(), "fresh"))
        monkeypatch.setattr(short_data, "held_market_row", never)
        s = own._held_short("TEST")
        assert s["state"] == "ok" and s["basis"] == "stock_history" and s["shares_short"] == 50_000_000

    def test_a_market_row_with_a_float_and_no_percent_is_withheld_and_a_missing_number_stays_none(self, monkeypatch):
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        row = {"sym": "TEST", "short_interest": 200_000_000, "avg_daily_volume": None, "days_to_cover": None,
               "prev_short_interest": None, "change_shares": None, "change_pct": None,
               "float_shares": 90_000_000, "pct_float": None, "settlement_date": "2026-10-30",
               "previous_settlement_date": "2026-10-15"}
        monkeypatch.setattr(short_data, "held_market_row", lambda sym: (dict(row), "held"))
        s = own._held_short("TEST")
        assert s["state"] == "ok" and s["short_pct_float"] is None and s["pct_float_withheld"] is True
        assert s["days_to_cover"] is None and s["prior_short"] is None and s["prior_settlement_date"] is None

    def test_a_covered_stock_missing_from_the_report_is_none_and_an_uncovered_symbol_stays_not_held(self, monkeypatch):
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        monkeypatch.setattr(short_data, "held_market_row", lambda sym: (None, "not_in_list"))
        monkeypatch.setattr(short_data, "universe", lambda: frozenset({"TEST"}))
        assert own._held_short("TEST")["state"] == "none"
        assert own._held_short("SPY")["state"] == "not_held"
        assert own._held_short("SPY")["shares_short"] is None

    def test_a_refused_market_list_is_unavailable_with_its_reason(self, monkeypatch):
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        refused = {"status": "unavailable", "reason": "refused", "http_status": 403, "source": short_data.SOURCE}
        monkeypatch.setattr(short_data, "held_market_row", lambda sym: (dict(refused), "not_held"))
        s = own._held_short("TEST")
        assert s["state"] == "unavailable" and s["reason"] == "refused" and s["http_status"] == 403
        assert s["shares_short"] is None

    def test_a_market_list_that_cannot_be_read_is_not_held(self, monkeypatch):
        def boom(sym):
            raise RuntimeError("disk")

        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        monkeypatch.setattr(short_data, "held_market_row", boom)
        assert own._held_short("TEST")["state"] == "not_held"

    def test_it_never_starts_a_build(self, monkeypatch):
        """THE rail: this path reads what is held and asks nobody. `get_stock` (which starts a
        background vendor read) and the vendor readers must not be reached from here."""
        started = []          # recorded, not raised: `_held_short` swallows what its reader raises

        def spy(name):
            def _f(*a, **k):
                started.append(name)
                return {"status": "computing", "sym": "ZZNEVER"}
            return _f
        short_data.reset_for_tests()
        for name in ("get_stock", "build_stock", "_stock_bg", "_vendor_page", "_vendor_rows", "get_market",
                     "build_market", "_market_bg", "_start_market_job", "warm_market"):
            monkeypatch.setattr(short_data, name, spy(name))
        assert own._held_short("ZZNEVER")["state"] == "not_held"
        assert started == []
        assert not short_data._stock_inflight

    def test_the_whole_record_is_read_without_starting_a_build(self, monkeypatch):
        started = []
        short_data.reset_for_tests()
        for name in ("get_stock", "build_stock", "_stock_bg", "_vendor_page", "_vendor_rows", "get_market"):
            monkeypatch.setattr(short_data, name, lambda *a, _n=name, **k: started.append(_n))
        monkeypatch.setattr(own, "_thirteen_f", lambda sym: None)
        monkeypatch.setattr(own, "_fmp_share_counts", lambda sym: ({}, None))
        monkeypatch.setattr(own, "get_insider_activity", lambda sym: [])
        cache.invalidate("research_own::ZZNEVER")
        out = own.get_ownership("zznever")
        cache.invalidate("research_own::ZZNEVER")
        assert out["short"]["state"] == "not_held"
        assert started == [] and not short_data._stock_inflight


class TestReconcileShareCounts:
    """The float/shares-outstanding consistency guard over FMP's answer (the one source)."""

    def test_fmp_counts_used_directly(self):
        fs, so = own._reconcile_share_counts({"float_shares": 6.8e9, "shares_outstanding": 1.5e10})
        assert fs == 6.8e9 and so == 1.5e10

    def test_nothing_from_fmp_is_none_not_another_source(self):
        assert own._reconcile_share_counts(None) == (None, None)
        assert own._reconcile_share_counts({}) == (None, None)

    def test_impossible_pair_suppressed(self):
        fs, so = own._reconcile_share_counts({"float_shares": 40_337_603.0, "shares_outstanding": 10_900_000.0})
        assert fs is None and so is None

    def test_a_zero_count_is_not_reported(self):
        fs, so = own._reconcile_share_counts({"float_shares": 0, "shares_outstanding": 1.07e9})
        assert fs is None and so == 1.07e9


class TestInstitutional:
    """The institutional percent is the Form 13F summary's."""

    def test_pct_held_is_the_13f_summary_percent(self):
        tf = {"quarter": "2026Q3", "summary": {"ownership_pct": 63.4605}, "holders": []}
        out = own._institutional(tf)
        assert out == {"state": "ok", "pct_held": 63.4605, "quarter": "2026Q3",
                       "source": "Form 13F filings, through FMP"}

    def test_no_13f_is_none_and_a_failed_read_is_failed(self):
        assert own._institutional(None)["state"] == "none"
        assert own._institutional(None)["pct_held"] is None
        assert own._institutional(None, failed=True)["state"] == "failed"
        assert "holders" not in own._institutional(None)

    def test_a_summary_without_the_percent_is_ok_with_no_percent(self):
        out = own._institutional({"quarter": "2026Q3", "summary": {"investors_holding": 8}})
        assert out["state"] == "ok" and out["pct_held"] is None


class TestGetOwnership:
    def setup_method(self):
        cache.invalidate("research_own::TEST")

    def _tf(self):
        return {"quarter": "2026Q3", "summary": {"ownership_pct": 60.0, "investors_holding": 10},
                "holders": [{"name": "Vanguard", "shares": 1.3e9, "ownership": 8.5}], "_meta": None}

    def _wire(self, monkeypatch, *, thirteen_f=None, insider=lambda sym: [], held=(None, "not_held")):
        monkeypatch.setattr(own, "_thirteen_f", thirteen_f or (lambda sym: self._tf()))
        monkeypatch.setattr(own, "_fmp_share_counts", lambda sym: ({"float_shares": 9.0, "shares_outstanding": 10.0}, None))
        monkeypatch.setattr(own, "get_insider_activity", insider)
        monkeypatch.setattr(short_data, "held_stock", lambda sym: held)

    def test_shape_and_cache(self, monkeypatch):
        self._wire(monkeypatch, insider=lambda sym: [
            {"name": "CEO", "title": "CEO", "type": "buy", "shares": 1000, "amount": 250000, "date": "2026-05-01"},
        ], held=(_held_answer(), "fresh"))
        out = own.get_ownership("test")
        assert out["sym"] == "TEST"
        assert out["institutional"]["pct_held"] == 60.0
        assert out["institutional"]["source"] == "Form 13F filings, through FMP"
        assert out["short"]["state"] == "ok" and out["short"]["short_pct_float"] == 0.74
        assert out["insider"][0]["type"] == "buy"
        # 2026-09-03 D1 pass: canonical-identity + share-counts fields always
        # present in the shape, even when Entity Master/FMP have nothing.
        assert "entity" in out and out["entity"]["status"] in ("resolved", "not_found", "ambiguous")
        assert set(out["share_counts"].keys()) == {"float_shares", "shares_outstanding", "_meta"}
        assert cache.get("research_own::TEST") is not None

    def test_the_short_block_is_never_cached_so_a_later_held_report_appears_at_once(self, monkeypatch):
        """A member opens OWN (nothing held), opens SHINT (the service now holds the report), and
        comes back: the 12h ownership record must not pin "not available"."""
        held = {"now": (None, "not_held")}
        self._wire(monkeypatch)
        monkeypatch.setattr(short_data, "held_stock", lambda sym: held["now"])
        first = own.get_ownership("test")
        assert first["short"]["state"] == "not_held"
        assert "short" not in cache.get("research_own::TEST")

        def never(sym):
            raise AssertionError("rebuilt despite a cache hit")
        monkeypatch.setattr(own, "_build_ownership", never)
        held["now"] = (_held_answer(), "fresh")
        second = own.get_ownership("test")
        assert second["short"]["state"] == "ok" and second["short"]["settlement_date"] == "2026-10-30"
        assert first["short"]["state"] == "not_held"          # the earlier answer was not mutated

    def test_the_short_read_is_asked_for_the_route_symbol(self, monkeypatch):
        seen = []
        self._wire(monkeypatch)
        monkeypatch.setattr(short_data, "held_stock", lambda sym: seen.append(sym) or (None, "not_held"))
        own.get_ownership("test")
        assert seen == ["TEST"]

    def _captured_ttl(self, monkeypatch, **wire):
        seen = {}
        real_set = cache.set

        def spy(key, value, ttl=None):
            if key == "research_own::TEST":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        self._wire(monkeypatch, **wire)
        monkeypatch.setattr(cache, "set", spy)
        out = own.get_ownership("test")
        return out, seen.get("ttl")

    def test_a_complete_fetch_is_cached_for_the_full_12h_ttl(self, monkeypatch):
        out, ttl = self._captured_ttl(monkeypatch)
        assert out["institutional"]["pct_held"] == 60.0
        assert ttl == own._CACHE_TTL
        assert out["legs_failed"] == []          # tq-panels: nothing to flag

    def test_insider_activity_failure_also_shortens_the_ttl(self, monkeypatch):
        def _boom(s):
            raise RuntimeError("finnhub down")
        out, ttl = self._captured_ttl(monkeypatch, insider=_boom)
        assert out["institutional"]["pct_held"] == 60.0   # good leg still served
        assert out["insider"] == []
        assert ttl == own._FAIL_TTL
        assert out["legs_failed"] == ["insider activity"]

    def test_a_ticker_with_genuinely_no_13f_filing_is_not_a_failure(self, monkeypatch):
        """13F absence is normal for most non-mega-caps -- must still get the
        full 12h TTL, not be treated the same as a provider failure."""
        out, ttl = self._captured_ttl(monkeypatch, thirteen_f=lambda s: None)
        assert out["thirteen_f"] is None
        assert out["institutional"] == {"state": "none", "pct_held": None, "quarter": None,
                                        "source": "Form 13F filings, through FMP"}
        assert ttl == own._CACHE_TTL
        assert out["legs_failed"] == []

    def test_nothing_held_for_the_short_card_does_not_shorten_the_ttl(self, monkeypatch):
        """`not_held` is not a failed leg: the record is complete, and the short block is read
        again on every request anyway."""
        out, ttl = self._captured_ttl(monkeypatch, held=(None, "not_held"))
        assert out["short"]["state"] == "not_held"
        assert ttl == own._CACHE_TTL and out["legs_failed"] == []


class TestAFailedProviderReadIsNotNothingOnFile:
    """13F is now the only holders source, so a 13F read that FAILED must not be pinned for 12h
    as "no 13F on file". The vendor answering "nothing" (NotFound) is still not a failure."""

    def setup_method(self):
        cache.invalidate("research_own::TEST")

    def _run(self, monkeypatch, *, summary, holders=None, share_float=None):
        seen = {}
        real_set = cache.set

        def spy(key, value, ttl=None):
            if key == "research_own::TEST":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        monkeypatch.setattr(cache, "set", spy)
        monkeypatch.setattr(own, "resolve_entity", lambda sym, vendor=None: ({"status": "resolved"}, sym))
        monkeypatch.setattr(own, "get_insider_activity", lambda sym: [])
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        monkeypatch.setattr(own.fmp_client, "get_institutional_ownership_summary", summary)
        monkeypatch.setattr(own.fmp_client, "get_institutional_ownership_holders",
                            holders or (lambda ticker, *, year, quarter, limit=12: _result([])))
        monkeypatch.setattr(own.fmp_client, "get_shares_float",
                            share_float or (lambda ticker: _result([{"floatShares": 9.0, "outstandingShares": 10.0}])))
        cache.invalidate(own._TF_QUARTER_HINT_KEY)
        out = own.get_ownership("test")
        return out, seen.get("ttl")

    def test_a_13f_read_that_raised_is_failed_named_and_cached_briefly(self, monkeypatch):
        def boom(ticker, *, year, quarter):
            raise pe.ProviderTransient("timeout", vendor="fmp")
        out, ttl = self._run(monkeypatch, summary=boom)
        assert out["thirteen_f"] is None
        assert out["institutional"]["state"] == "failed"
        assert out["legs_failed"] == ["institutional holders (Form 13F)"]
        assert ttl == own._FAIL_TTL

    def test_the_vendor_answering_nothing_is_none_and_cached_in_full(self, monkeypatch):
        def nothing(ticker, *, year, quarter):
            raise own.fmp_client.FMPNotFound("empty", vendor="fmp")
        out, ttl = self._run(monkeypatch, summary=nothing)
        assert out["institutional"]["state"] == "none"
        assert out["legs_failed"] == [] and ttl == own._CACHE_TTL

    def test_a_degraded_answer_is_a_failed_read(self, monkeypatch):
        out, ttl = self._run(monkeypatch,
                             summary=lambda ticker, *, year, quarter: _result([], degraded="circuit_open"))
        assert out["institutional"]["state"] == "failed" and ttl == own._FAIL_TTL

    def test_a_failed_holders_read_under_a_good_summary_is_named(self, monkeypatch):
        def boom(ticker, *, year, quarter, limit=12):
            raise pe.ProviderTransient("timeout", vendor="fmp")
        out, ttl = self._run(monkeypatch,
                             summary=lambda ticker, *, year, quarter: _result([{"ownershipPercent": 61.0}]),
                             holders=boom)
        assert out["institutional"]["pct_held"] == 61.0      # what answered is still served
        assert out["thirteen_f"]["holders"] == []
        assert out["legs_failed"] == ["institutional holders (Form 13F)"]
        assert ttl == own._FAIL_TTL

    def test_a_failed_share_count_read_is_named_and_cached_briefly(self, monkeypatch):
        def boom(ticker):
            raise pe.ProviderTransient("timeout", vendor="fmp")
        out, ttl = self._run(monkeypatch,
                             summary=lambda ticker, *, year, quarter: _result([{"ownershipPercent": 61.0}]),
                             share_float=boom)
        assert out["share_counts"]["float_shares"] is None
        assert out["legs_failed"] == ["float and shares outstanding"]
        assert ttl == own._FAIL_TTL

    def test_no_share_count_on_file_is_not_a_failure(self, monkeypatch):
        def nothing(ticker):
            raise own.fmp_client.FMPNotFound("empty", vendor="fmp")
        out, ttl = self._run(monkeypatch,
                             summary=lambda ticker, *, year, quarter: _result([{"ownershipPercent": 61.0}]),
                             share_float=nothing)
        assert out["share_counts"]["float_shares"] is None
        assert out["legs_failed"] == [] and ttl == own._CACHE_TTL


class TestEntityResolutionAndD1:
    """2026-09-03 A6/A7 pass: canonical-entity resolution now runs before
    every provider fetch, and the FMP-vendor-effective symbol (not the raw
    route param) is what reaches fmp_client and the insider-activity leg."""

    def setup_method(self):
        cache.invalidate("research_own::BRK-B")
        cache.invalidate("research_own::ZZZZ")

    def test_fmp_effective_symbol_reaches_share_counts_and_insider(self, monkeypatch):
        monkeypatch.setattr(own, "resolve_entity",
                            lambda sym, vendor=None: ({"status": "resolved", "entityId": "em_1"}, "BRK.B"))

        seen = {}

        def fake_shares_float(ticker):
            seen["shares_float_ticker"] = ticker
            return _result([{"floatShares": 1.0, "outstandingShares": 2.0}])

        def fake_insider(ticker):
            seen["insider_ticker"] = ticker
            return []

        def fake_thirteen_f(ticker):
            seen["thirteen_f_ticker"] = ticker
            return None

        monkeypatch.setattr(own.fmp_client, "get_shares_float", fake_shares_float)
        monkeypatch.setattr(own, "get_insider_activity", fake_insider)
        monkeypatch.setattr(own, "_thirteen_f", fake_thirteen_f)
        monkeypatch.setattr(short_data, "held_stock",
                            lambda sym: seen.setdefault("short_sym", sym) and (None, "not_held"))

        out = own.get_ownership("BRK-B")
        assert out["sym"] == "BRK-B"                    # display symbol stays the raw route param
        assert out["entity"] == {"status": "resolved", "entityId": "em_1"}
        assert seen["shares_float_ticker"] == "BRK.B"    # FMP calls use the resolved vendor symbol
        assert seen["insider_ticker"] == "BRK.B"
        assert seen["thirteen_f_ticker"] == "BRK.B"
        assert seen["short_sym"] == "BRK-B"              # the short service takes the house symbol
        assert out["share_counts"]["float_shares"] == 1.0
        assert out["share_counts"]["_meta"]["vendor"] == "fmp"

    def test_entity_master_miss_never_blocks_the_fetch(self, monkeypatch):
        """resolve_entity's own contract is 'never raises, falls back to the
        raw symbol' -- confirm ownership.py relies on exactly that, never a
        try/except of its own around the call."""
        monkeypatch.setattr(own, "resolve_entity",
                            lambda sym, vendor=None: ({"status": "not_found", "entityId": None}, sym))
        monkeypatch.setattr(own, "get_insider_activity", lambda sym: [])
        monkeypatch.setattr(own, "_thirteen_f",
                            lambda sym: {"quarter": "2026Q3", "summary": {"ownership_pct": 40.0}, "holders": []})
        monkeypatch.setattr(own, "_fmp_share_counts", lambda sym: ({}, None))
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))

        out = own.get_ownership("ZZZZ")
        assert out["entity"]["status"] == "not_found"
        assert out["institutional"]["pct_held"] == 40.0   # the fetch still ran


class TestNoOtherSourceIsRead:
    """The record is built from the Form 13F block, FMP's share counts, the insider feed and the
    held FINRA report. The module holds no other reader to fall back to."""

    def test_the_module_has_no_second_holders_or_short_reader(self):
        import inspect
        src = inspect.getsource(own)
        assert not hasattr(own, "_fetch_yf") and not hasattr(own, "_short")
        assert "run_in_pool" not in src and "import yfinance" not in src

    def test_the_record_carries_no_holders_list_outside_the_13f_block(self, monkeypatch):
        cache.invalidate("research_own::TEST")
        monkeypatch.setattr(own, "_thirteen_f", lambda sym: None)
        monkeypatch.setattr(own, "_fmp_share_counts", lambda sym: ({}, None))
        monkeypatch.setattr(own, "get_insider_activity", lambda sym: [])
        monkeypatch.setattr(short_data, "held_stock", lambda sym: (None, "not_held"))
        out = own.get_ownership("test")
        assert set(out) == {"sym", "entity", "institutional", "share_counts", "insider", "thirteen_f",
                            "legs_failed", "short"}
        assert set(out["institutional"]) == {"state", "pct_held", "quarter", "source"}
        cache.invalidate("research_own::TEST")


class TestRoute:
    def setup_method(self):
        cache.invalidate("research_own::AAPL")

    def _client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        return TestClient(app)

    def test_route_shape(self, monkeypatch):
        import api.routers.research as research_router
        monkeypatch.setattr(research_router, "get_ownership", lambda sym: {
            "sym": sym.upper(), "institutional": {"state": "none", "pct_held": None}, "short": {"state": "not_held"},
            "insider": [],
        })
        r = self._client().get("/api/research/ownership/AAPL")
        assert r.status_code == 200
        # funds_nport: the Funds (N-PORT) block the route adds for every stock (fund_holders_nport.overlay)
        assert set(r.json().keys()) == {"sym", "institutional", "short", "insider", "funds_nport"}

    def test_route_failure_is_a_503_not_an_empty_record(self, monkeypatch):
        # R10: a 200 with no holders read as "nobody owns this".
        import api.routers.research as research_router

        def _boom(sym):
            raise RuntimeError("boom")
        monkeypatch.setattr(research_router, "get_ownership", _boom)
        assert self._client().get("/api/research/ownership/AAPL").status_code == 503


class TestShareClassMixing:
    """A whole-company figure set against a single-class share count gives two impossible
    artifacts on dual-class tickers: a float LARGER than shares outstanding (float is a subset
    of shares outstanding), and institutions holding more than 100% of a company. FMP's
    stable/shares-float is class-correct on all four tickers measured 2026-08-06.
    """

    # (ticker, FMP float, FMP outstanding)
    DUAL_CLASS = [
        ("ATROB", 19_093_178.0, 35_851_963.0),
        ("ATRO", 31_324_615.0, 38_448_408.0),
        ("BRK-B", 1_393_387_948.0, 2_156_853_595.0),
        ("LEN-B", 78_914_196.0, 248_295_271.0),
    ]

    def test_fmp_share_counts_are_published_as_they_are(self):
        for sym, fmp_float, fmp_out in self.DUAL_CLASS:
            fs, so = own._reconcile_share_counts({"float_shares": fmp_float, "shares_outstanding": fmp_out})
            assert fs == fmp_float, sym
            assert so == fmp_out, sym
            # The whole point: the published pair is arithmetically possible.
            assert fs <= so, sym

    def test_contradictory_pair_is_suppressed_not_clamped(self):
        """When the pair contradicts itself, publish neither — we cannot tell which side is wrong."""
        fs, so = own._reconcile_share_counts({"float_shares": 40_337_603.0, "shares_outstanding": 10_900_000.0})
        assert fs is None
        assert so is None

    def test_equal_float_and_outstanding_is_legal(self):
        """Boundary: float == outstanding is possible (no restricted stock),
        so the guard must be strictly-greater, not >=."""
        fs, so = own._reconcile_share_counts({"float_shares": 5_000.0, "shares_outstanding": 5_000.0})
        assert fs == 5_000.0
        assert so == 5_000.0

    def test_a_missing_float_does_not_take_the_other_count_with_it(self):
        fs, so = own._reconcile_share_counts({"float_shares": None, "shares_outstanding": 1_000.0})
        assert fs is None
        assert so == 1_000.0

    def test_institutional_pct_over_100_suppressed(self):
        """A percent over 100 says the positions and the share count do not describe the same
        thing (ATRO read 101.84% on 2026-08-06): withheld, never capped."""
        out = own._institutional({"quarter": "2026Q3", "summary": {"ownership_pct": 101.84}})
        assert out["state"] == "ok" and out["pct_held"] is None

    def test_institutional_pct_at_or_under_100_survives(self):
        assert own._institutional({"summary": {"ownership_pct": 100.0}})["pct_held"] == 100.0
        assert own._institutional({"summary": {"ownership_pct": 71.85}})["pct_held"] == 71.85


class TestThirteenFFilingWindow:
    """R12: a quarter whose 13F filing window (45 days) is still open is never
    a candidate -- its summary counts only the managers who have filed so far."""

    def test_early_october_skips_the_quarter_that_just_ended(self):
        import datetime as dt
        assert own._recent_quarters(dt.date(2026, 10, 5)) == [(2026, 2), (2026, 1), (2025, 4), (2025, 3)]

    def test_the_quarter_becomes_a_candidate_once_its_window_closes(self):
        import datetime as dt
        # Q3 ends 2026-09-30; 46 days later is 2026-11-15.
        assert own._recent_quarters(dt.date(2026, 11, 14))[0] == (2026, 2)
        assert own._recent_quarters(dt.date(2026, 11, 15))[0] == (2026, 3)

    def test_the_current_unfinished_quarter_is_never_a_candidate(self):
        import datetime as dt
        today = dt.date(2026, 12, 31)
        assert (2026, 4) not in own._recent_quarters(today)
        assert len(own._recent_quarters(today)) == 4

    def test_quarter_ends(self):
        import datetime as dt
        assert own._quarter_end(2026, 1) == dt.date(2026, 3, 31)
        assert own._quarter_end(2026, 4) == dt.date(2026, 12, 31)
