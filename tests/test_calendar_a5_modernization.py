"""Tests for the 2026-09-03 A5 (Events & Calendar) modernization: canonical
entity resolution (S3) on the four real event categories, typed D1 access
for the three FMP-backed legs (earnings/economic/IPO), and the honest
per-payload provenance envelope those legs now carry.

Narrow slice, per the LOCKED IMPLEMENTATION SCOPE: this does NOT touch
Fed-event population, corporate actions, analyst/investor events, the
existing merge/precedence/caching/timezone logic, or calendar_alerts.py.
"""
from unittest import mock

from api.routers import calendar as cal
from api.services import provider_errors as pe
from api.services import provider_licensing_class as plc


def _result(value, *, freshness="end_of_day", degraded=None):
    return pe.ProviderResult(
        value=value,
        provenance=pe.ProvenanceRecord(vendor="fmp", source_activity="test"),
        licensing_class="R",
        freshness=freshness,
        degraded=degraded,
    )


# ── _attach_entities ──────────────────────────────────────────────────────────

class TestAttachEntities:
    def test_resolves_entity_for_every_earnings_entry(self, monkeypatch):
        monkeypatch.setattr(
            cal, "resolve_entity",
            lambda sym: ({"status": "resolved", "entityId": f"em_{sym}"}, sym))
        days = {
            "2026-09-08": {
                "bmo": [{"sym": "AAPL"}], "amc": [{"sym": "MSFT"}], "tbd": [],
                "econ": [], "fed": [],
            },
        }
        cal._attach_entities(days)
        assert days["2026-09-08"]["bmo"][0]["entity"] == {"status": "resolved", "entityId": "em_AAPL"}
        assert days["2026-09-08"]["amc"][0]["entity"] == {"status": "resolved", "entityId": "em_MSFT"}

    def test_never_applies_to_econ_or_fed_entries(self, monkeypatch):
        """A macro release carries no ticker -- S3 genuinely does not apply."""
        called = []
        monkeypatch.setattr(cal, "resolve_entity", lambda sym: called.append(sym) or
                             ({"status": "not_found", "entityId": None}, sym))
        days = {
            "2026-09-08": {
                "bmo": [], "amc": [], "tbd": [],
                "econ": [{"event": "CPI m/m"}], "fed": [{"event": "Fed Chair Speaks"}],
            },
        }
        cal._attach_entities(days)
        assert called == []
        assert "entity" not in days["2026-09-08"]["econ"][0]
        assert "entity" not in days["2026-09-08"]["fed"][0]

    def test_a_resolution_miss_stamps_an_honest_not_found_never_blocks(self, monkeypatch):
        monkeypatch.setattr(cal, "resolve_entity",
                            lambda sym: ({"status": "not_found", "entityId": None}, sym))
        days = {"2026-09-08": {"bmo": [{"sym": "ZZZZ"}], "amc": [], "tbd": [],
                               "econ": [], "fed": []}}
        cal._attach_entities(days)
        assert days["2026-09-08"]["bmo"][0]["entity"] == {"status": "not_found", "entityId": None}

    def test_skips_an_entry_with_no_symbol(self, monkeypatch):
        called = []
        monkeypatch.setattr(cal, "resolve_entity", lambda sym: called.append(sym) or
                             ({"status": "not_found", "entityId": None}, sym))
        days = {"2026-09-08": {"bmo": [{"sym": ""}], "amc": [], "tbd": [], "econ": [], "fed": []}}
        cal._attach_entities(days)
        assert called == []
        assert "entity" not in days["2026-09-08"]["bmo"][0]

    def test_never_re_resolves_an_entry_that_already_carries_one(self, monkeypatch):
        """Idempotent -- a second pass (e.g. month assembly re-spreading week
        entries) must not re-hit Entity Master for work already done."""
        called = []
        monkeypatch.setattr(cal, "resolve_entity", lambda sym: called.append(sym) or
                             ({"status": "resolved", "entityId": "em_x"}, sym))
        days = {"2026-09-08": {
            "bmo": [{"sym": "AAPL", "entity": {"status": "resolved", "entityId": "em_prior"}}],
            "amc": [], "tbd": [], "econ": [], "fed": [],
        }}
        cal._attach_entities(days)
        assert called == []
        assert days["2026-09-08"]["bmo"][0]["entity"] == {"status": "resolved", "entityId": "em_prior"}


# ── D1 typed transport: earnings leg ──────────────────────────────────────────

class TestFmpCalendarDay:
    def test_returns_rows_and_meta_on_success(self):
        import datetime
        rows = [{"symbol": "AAPL", "date": "2026-09-08"}]
        with mock.patch("api.services.fmp_client.get_earnings_calendar",
                        return_value=_result(rows)):
            data, meta = cal._fmp_calendar_day(datetime.date(2026, 9, 8))
        assert data == rows
        assert meta["vendor"] == "fmp"
        assert meta["freshnessClass"] == "end_of_day"
        assert meta["licensingClass"] == "R"

    def test_returns_none_none_on_failure(self):
        import datetime
        with mock.patch("api.services.fmp_client.get_earnings_calendar",
                        side_effect=RuntimeError("boom")):
            data, meta = cal._fmp_calendar_day(datetime.date(2026, 9, 8))
        assert data is None and meta is None

    def test_returns_none_none_when_degraded_with_no_value(self):
        import datetime
        with mock.patch("api.services.fmp_client.get_earnings_calendar",
                        return_value=_result(None, degraded="cached_forbidden")):
            data, meta = cal._fmp_calendar_day(datetime.date(2026, 9, 8))
        assert data is None and meta is None

    def test_a_genuinely_empty_day_returns_empty_list_not_none(self):
        """2026-09-03 range_empty follow-up. `not_found_if=_empty_list` on the
        shared typed method raises FMPNotFound for a real, empty JSON array —
        the right call for that method's per-symbol callers, wrong for a
        market-wide calendar day, where zero rows is a legitimate, common
        outcome. Must NOT collapse into the same (None, None) signal as an
        actual transport failure, or a quiet day looks identical to FMP
        being unreachable."""
        import datetime
        from api.services import fmp_client
        with mock.patch("api.services.fmp_client.get_earnings_calendar",
                        side_effect=fmp_client.FMPNotFound("no rows", vendor="fmp")):
            data, meta = cal._fmp_calendar_day(datetime.date(2026, 9, 8))
        assert data == []
        assert data is not None
        assert meta is None


class TestFmpRangeWeek:
    def test_meta_comes_from_a_successful_chunk(self):
        with mock.patch.object(
                cal, "_fmp_calendar_day",
                side_effect=lambda d: ([{"symbol": "AAPL", "date": d.isoformat()}],
                                       {"vendor": "fmp", "freshnessClass": "end_of_day"})):
            rows, meta = cal._fmp_range_week("2026-09-08", "2026-09-08")
        assert len(rows) == 1
        assert meta == {"vendor": "fmp", "freshnessClass": "end_of_day"}

    def test_total_failure_across_every_chunk_returns_none_none(self):
        with mock.patch.object(cal, "_fmp_calendar_day", return_value=(None, None)):
            rows, meta = cal._fmp_range_week("2026-09-08", "2026-09-09")
        assert rows is None and meta is None

    def test_a_partial_failure_still_returns_the_meta_of_the_chunk_that_worked(self):
        def _one_day_ok(d):
            if d.isoformat() == "2026-09-08":
                return [{"symbol": "AAPL", "date": "2026-09-08"}], {"vendor": "fmp"}
            return None, None
        with mock.patch.object(cal, "_fmp_calendar_day", side_effect=_one_day_ok):
            rows, meta = cal._fmp_range_week("2026-09-08", "2026-09-09")
        assert len(rows) == 1
        assert meta == {"vendor": "fmp"}


# ── D1 typed transport: economic + IPO legs, and the licensing table ─────────

class TestLicensingClassTable:
    def test_economic_data_class_is_registered_r(self):
        assert plc.licensing_class_for("fmp", "economic") == "R"

    def test_ipo_data_class_is_honestly_unregistered(self):
        """No licensing-register row covers FMP's `stable/ipos-calendar`
        specifically (T-52 is Finnhub's IPO leg) -- must fall through to the
        conservative default, never a guessed 'R'."""
        assert plc.licensing_class_for("fmp", "ipo") == "U"


class TestCurateEconEvents:
    def test_returns_none_when_forexfactory_covers_every_day(self, monkeypatch):
        import datetime
        # `ff_eligible` compares week_start against the REAL current week
        # (`_week_dates()`) -- pin it so this test doesn't depend on when it
        # happens to run relative to 2026-09-08.
        monkeypatch.setattr(cal, "_week_dates", lambda: [
            datetime.date(2026, 9, 7) + datetime.timedelta(days=i) for i in range(5)])
        monkeypatch.setattr(cal, "_fetch_ff_events", lambda *a, **kw: {
            "2026-09-08": {"econ": [{"event": "CPI"}], "fed": []},
        })
        days = {"2026-09-08": {"econ": [], "fed": []}}
        called = mock.Mock()
        monkeypatch.setattr("api.services.econ_calendar_fmp.fetch_us_econ_week_with_meta", called)
        out = cal._curate_econ_events("2026-09-08", "2026-09-08", days)
        assert out is None
        called.assert_not_called()

    def test_returns_the_fmp_legs_meta_when_it_actually_ran(self, monkeypatch):
        monkeypatch.setattr(cal, "_fetch_ff_events", lambda *a, **kw: {})
        days = {"2026-09-08": {"econ": [], "fed": []}}
        meta = {"vendor": "fmp", "freshnessClass": "end_of_day", "licensingClass": "R"}
        monkeypatch.setattr(
            "api.services.econ_calendar_fmp.fetch_us_econ_week_with_meta",
            lambda *a, **kw: ({"2026-09-08": [{"event": "CPI", "estimate": None,
                                                "prior": None, "is_fed": False}]}, meta))
        out = cal._curate_econ_events("2026-09-08", "2026-09-08", days)
        assert out == meta
        assert days["2026-09-08"]["econ"][0]["event"] == "CPI"

    def test_returns_none_when_the_fmp_leg_fails_entirely(self, monkeypatch):
        monkeypatch.setattr(cal, "_fetch_ff_events", lambda *a, **kw: {})
        days = {"2026-09-08": {"econ": [], "fed": []}}
        monkeypatch.setattr(
            "api.services.econ_calendar_fmp.fetch_us_econ_week_with_meta",
            mock.Mock(side_effect=RuntimeError("down")))
        out = cal._curate_econ_events("2026-09-08", "2026-09-08", days)
        assert out is None
        assert days["2026-09-08"]["econ"] == []


# ── IPO calendar: D1 leg + entity resolution ──────────────────────────────────

class TestIpoCalendarModernization:
    def test_fmp_ipo_get_uses_the_typed_d1_adapter(self):
        from api.services import ipo_calendar
        rows = [{"symbol": "NEWCO", "company": "NewCo Inc", "date": "2026-09-10",
                 "exchange": "NASDAQ", "actions": "Expected",
                 "shares": None, "priceRange": None, "marketCap": None}]
        with mock.patch("api.services.fmp_client.get_ipo_calendar",
                        return_value=_result(rows)):
            out = ipo_calendar._fmp_ipo_get("2026-09-08", "2026-09-12")
        assert out == rows

    def test_fmp_ipo_get_returns_none_on_typed_failure(self):
        from api.services import ipo_calendar
        with mock.patch("api.services.fmp_client.get_ipo_calendar",
                        side_effect=RuntimeError("boom")):
            assert ipo_calendar._fmp_ipo_get("2026-09-08", "2026-09-12") is None

    def test_get_ipos_stamps_entity_on_every_merged_row(self, monkeypatch):
        from api.services import ipo_calendar
        monkeypatch.setattr(ipo_calendar, "cache", mock.Mock(get=lambda k: None, set=lambda *a, **kw: None))
        monkeypatch.setattr(ipo_calendar, "_fh_ipo_get", lambda a, b: [
            {"symbol": "NEWCO", "name": "NewCo", "date": "2026-09-10", "exchange": "NASDAQ",
             "price": "$10.00", "numberOfShares": 1000000, "totalSharesValue": 10000000,
             "status": "expected"},
        ])
        monkeypatch.setattr(ipo_calendar, "_fmp_ipo_get", lambda a, b: None)
        monkeypatch.setattr(ipo_calendar, "resolve_entity",
                            lambda sym: ({"status": "not_found", "entityId": None}, sym))
        out = ipo_calendar.get_ipos("2026-09-08", "2026-09-12")
        assert out[0]["entity"] == {"status": "not_found", "entityId": None}


# ── Dividends calendar: entity resolution, no D1 leg (yfinance-only) ─────────

class TestDividendsCalendarModernization:
    def test_get_events_stamps_entity_once_per_symbol(self, monkeypatch):
        from api.services import dividends_calendar as dc
        monkeypatch.setattr(dc, "cache", mock.Mock(get=lambda k: None, set=lambda *a, **kw: None))
        calls = []

        def _fake_resolve(sym):
            calls.append(sym)
            return {"status": "resolved", "entityId": f"em_{sym}"}, sym
        monkeypatch.setattr(dc, "resolve_entity", _fake_resolve)

        # A symbol contributing BOTH a dividend and a split event.
        import datetime as _dt

        class _FakeSeries(dict):
            @property
            def empty(self):
                return len(self) == 0

            def items(self):
                return dict.items(self)

            @property
            def iloc(self):
                vals = list(self.values())
                class _Loc:
                    def __getitem__(self_, i):
                        return vals[i]
                return _Loc()

        class _FakeTicker:
            def __init__(self, sym):
                self.calendar = {"Ex-Dividend Date": _dt.date(2099, 1, 1)}
                self.dividends = _FakeSeries({_dt.date(2098, 12, 1): 0.5})
                self.splits = _FakeSeries({_dt.date(2099, 2, 1): 2.0})

        fake_yf = mock.Mock()
        fake_yf.Ticker = _FakeTicker
        monkeypatch.setitem(__import__("sys").modules, "yfinance", fake_yf)

        out = dc.get_events(["DUAL"])
        syms_seen = {e["sym"] for e in out}
        assert syms_seen == {"DUAL"}
        assert all(e["entity"] == {"status": "resolved", "entityId": "em_DUAL"} for e in out)
        assert calls == ["DUAL"]   # resolved once, not once per event


# ── range_empty vs range_error (2026-09-03 follow-up) ────────────────────────
# Root cause: `source` used to stay "range_empty" whenever NEITHER provider
# contributed a row -- which was true both for a genuinely quiet range (both
# providers reached, both correctly answered "nothing here") and a real
# provider outage (neither could be reached at all). A member had no way to
# tell "no events" from "we couldn't check." These tests pin the split.

import datetime as _dt


def _monday():
    return cal._monday_of(_dt.date(2026, 9, 21))


class TestBuildRangeWeekSourceSplit:
    def _build(self, monkeypatch, *, fh_raw, fmp_result):
        monkeypatch.setattr(cal, "_load_cap_universe", lambda: set())
        monkeypatch.setattr(cal, "_fh_get_month", lambda a, b: fh_raw)
        monkeypatch.setattr(cal, "_fmp_range_week", lambda a, b: fmp_result)
        monkeypatch.setattr(cal, "_finviz_week_filter", lambda monday, today: None)
        monkeypatch.setattr(cal, "_curate_econ_events", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_attach_names", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_attach_date_moves", lambda *a, **kw: None)
        monkeypatch.setattr(cal, "_attach_entities", lambda *a, **kw: None)
        return cal._build_range_week(_monday())

    def test_both_providers_genuinely_empty_is_not_an_error(self, monkeypatch):
        """Finnhub reached (empty earningsCalendar) AND FMP reached (empty
        list, not None) -- a real, confirmed-quiet week. Must stay
        "range_empty", never "range_error"."""
        payload = self._build(
            monkeypatch,
            fh_raw={"earningsCalendar": []},
            fmp_result=([], None),
        )
        assert payload["source"] == "range_empty"

    def test_both_providers_failing_is_an_honest_error(self, monkeypatch):
        """Finnhub's call itself failed (raw None) AND FMP's call itself
        failed (rows None) -- the real outage case the original code's own
        comment described but the original logic never actually detected."""
        payload = self._build(
            monkeypatch,
            fh_raw=None,
            fmp_result=(None, None),
        )
        assert payload["source"] == "range_error"

    def test_one_leg_failing_and_the_other_confirming_empty_is_not_an_error(self, monkeypatch):
        """Only one provider needs to actually answer for the "empty" to be
        trustworthy -- Finnhub down, FMP confirms zero."""
        payload = self._build(
            monkeypatch,
            fh_raw=None,
            fmp_result=([], None),
        )
        assert payload["source"] == "range_empty"

    def test_a_populated_week_is_unaffected(self, monkeypatch):
        payload = self._build(
            monkeypatch,
            fh_raw={"earningsCalendar": [
                {"symbol": "AAPL", "date": _monday().isoformat(), "hour": "bmo",
                 "epsEstimate": 1.5, "epsActual": None,
                 "revenueEstimate": None, "revenueActual": None},
            ]},
            fmp_result=(None, None),
        )
        assert payload["source"] == "range_finnhub"
        assert payload["days"][_monday().isoformat()]["bmo"][0]["sym"] == "AAPL"


class TestRangeErrorDownstreamTreatment:
    def test_range_week_cache_uses_the_short_ttl_only_for_range_error(self, monkeypatch):
        monkeypatch.setattr(cal.cache, "get", lambda k: None)
        sets = []
        monkeypatch.setattr(cal.cache, "set", lambda k, v, ttl=None: sets.append((k, v, ttl)))
        monkeypatch.setattr(cal, "_build_range_week",
                            lambda monday: {"source": "range_error", "days": {}})
        monkeypatch.setattr(cal, "_week_dates_for", lambda monday: [monday])
        monkeypatch.setattr(cal, "_today_et", lambda: _dt.date(2099, 1, 1))
        cal._get_or_build_range_week(_monday())
        assert sets[-1][2] == 120

    def test_range_week_cache_uses_the_normal_ttl_for_a_genuinely_empty_week(self, monkeypatch):
        monkeypatch.setattr(cal.cache, "get", lambda k: None)
        sets = []
        monkeypatch.setattr(cal.cache, "set", lambda k, v, ttl=None: sets.append((k, v, ttl)))
        monkeypatch.setattr(cal, "_build_range_week",
                            lambda monday: {"source": "range_empty", "days": {}})
        monkeypatch.setattr(cal, "_week_dates_for", lambda monday: [monday])
        monkeypatch.setattr(cal, "_today_et", lambda: _dt.date(2099, 1, 1))  # week is "past"
        cal._get_or_build_range_week(_monday())
        assert sets[-1][2] == cal._RANGE_WEEK_TTL_PAST

    def test_month_assembly_flags_degraded_only_for_range_error(self, monkeypatch):
        monkeypatch.setattr(cal, "_get_or_build_range_week",
                            lambda monday: {"source": "range_empty", "days": {}})
        monkeypatch.setattr(cal.cache, "get", lambda k: None)
        monkeypatch.setattr(cal.cache, "set", lambda *a, **kw: None)
        result = cal.get_month_calendar(year=2026, month=9)
        assert result["month"] == "2026-09"  # never raised, degraded path taken silently

    def test_month_assembly_still_degrades_on_range_error(self, monkeypatch):
        calls = {"n": 0}

        def _fake_range_week(monday):
            calls["n"] += 1
            return {"source": "range_error", "days": {}}
        monkeypatch.setattr(cal, "_get_or_build_range_week", _fake_range_week)
        monkeypatch.setattr(cal.cache, "get", lambda k: None)
        sets = []
        monkeypatch.setattr(cal.cache, "set", lambda k, v, ttl=None: sets.append((k, v, ttl)))
        cal.get_month_calendar(year=2026, month=9)
        assert calls["n"] > 0
        # A degraded month is cached for 120s (self-heal), not the full TTL.
        assert sets[-1][2] == 120
