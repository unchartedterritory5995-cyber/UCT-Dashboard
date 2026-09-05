"""Unit tests for the canonical Earnings AI evidence adapter (Earnings
Events AI slice, owner-authorized, 2026-09-04). Covers the two owner-locked
hard requirements directly: (1) CONFIRMED/PROVISIONAL/CONFLICTING/UNKNOWN
status semantics, and (2) date-keyed (never index-based) price-reaction
association with omit-on-uncertain behavior."""
from api.services.research import earnings_ai_adapter as ea


class TestResolveNextDateStatus:
    def test_no_date_from_the_canonical_resolver_is_unknown(self, monkeypatch):
        monkeypatch.setattr("api.services.earnings_table._next_report_date", lambda sym: None)
        out = ea._resolve_next_date_status("AAPL")
        assert out == {"date": None, "timing": None, "status": "UNKNOWN", "conflicting_date": None}

    def test_a_resolver_exception_is_treated_as_unknown_not_a_crash(self, monkeypatch):
        def _boom(sym):
            raise RuntimeError("provider down")
        monkeypatch.setattr("api.services.earnings_table._next_report_date", _boom)
        out = ea._resolve_next_date_status("AAPL")
        assert out["status"] == "UNKNOWN"

    def test_no_cross_check_data_is_provisional_never_confirmed(self, monkeypatch):
        # Owner-locked: an unavailable secondary cross-check must NEVER be
        # silently upgraded to CONFIRMED -- "do not imply multi-provider
        # agreement" when the cross-check has nothing to say.
        monkeypatch.setattr("api.services.earnings_table._next_report_date", lambda sym: "2026-10-30")
        monkeypatch.setattr(ea, "_cross_check_live_window", lambda sym, d: None)
        out = ea._resolve_next_date_status("AAPL")
        assert out["status"] == "PROVISIONAL"
        assert out["date"] == "2026-10-30"

    def test_same_date_cross_check_with_a_session_bearing_entry_is_confirmed(self, monkeypatch):
        monkeypatch.setattr("api.services.earnings_table._next_report_date", lambda sym: "2026-10-30")
        monkeypatch.setattr(ea, "_cross_check_live_window",
                            lambda sym, d: {"match": "same_date", "timing": "amc", "date_est": False})
        out = ea._resolve_next_date_status("AAPL")
        assert out["status"] == "CONFIRMED"
        assert out["timing"] == "amc"

    def test_same_date_cross_check_but_still_estimated_is_provisional(self, monkeypatch):
        monkeypatch.setattr("api.services.earnings_table._next_report_date", lambda sym: "2026-10-30")
        monkeypatch.setattr(ea, "_cross_check_live_window",
                            lambda sym, d: {"match": "same_date", "timing": "tbd", "date_est": True})
        out = ea._resolve_next_date_status("AAPL")
        assert out["status"] == "PROVISIONAL"

    def test_a_different_date_cross_check_is_conflicting(self, monkeypatch):
        monkeypatch.setattr("api.services.earnings_table._next_report_date", lambda sym: "2026-10-30")
        monkeypatch.setattr(ea, "_cross_check_live_window",
                            lambda sym, d: {"match": "different_date", "other_date": "2026-10-29"})
        out = ea._resolve_next_date_status("AAPL")
        assert out["status"] == "CONFLICTING"
        assert out["conflicting_date"] == "2026-10-29"


class TestCrossCheckLiveWindow:
    def test_returns_none_when_the_week_cannot_be_resolved_at_all(self, monkeypatch):
        import api.routers.calendar as cal
        monkeypatch.setattr(cal, "_monday_of", lambda d: d)
        monkeypatch.setattr(cal, "_week_dates", lambda: [d for d in [None]])  # never equals monday
        monkeypatch.setattr(cal, "_get_or_build_range_week", lambda monday: None)
        out = ea._cross_check_live_window("AAPL", "2026-10-30")
        assert out is None

    def test_an_internal_exception_is_swallowed_to_none(self, monkeypatch):
        import api.routers.calendar as cal

        def _boom(monday):
            raise RuntimeError("boom")
        monkeypatch.setattr(cal, "_monday_of", lambda d: d)
        monkeypatch.setattr(cal, "_week_dates", lambda: [None])
        monkeypatch.setattr(cal, "_get_or_build_range_week", _boom)
        assert ea._cross_check_live_window("AAPL", "2026-10-30") is None

    def test_same_date_match_returns_its_timing_and_date_est(self, monkeypatch):
        import api.routers.calendar as cal
        from datetime import date
        # _week_dates() (the CURRENT week) deliberately differs from
        # _monday_of(target date) so the code takes the _get_or_build_
        # range_week branch this test mocks, not the calendar_weekly cache.
        monkeypatch.setattr(cal, "_monday_of", lambda d: date(2026, 10, 26))
        monkeypatch.setattr(cal, "_week_dates", lambda: [date(2026, 9, 7)])
        monkeypatch.setattr(cal, "_get_or_build_range_week", lambda monday: {
            "days": {"2026-10-30": {"amc": [{"sym": "AAPL", "date_est": False}], "bmo": [], "tbd": []}}
        })
        out = ea._cross_check_live_window("AAPL", "2026-10-30")
        assert out == {"match": "same_date", "timing": "amc", "date_est": False}

    def test_different_date_match_is_reported_as_a_conflict(self, monkeypatch):
        import api.routers.calendar as cal
        from datetime import date
        # _week_dates() (the CURRENT week) deliberately differs from
        # _monday_of(target date) so the code takes the _get_or_build_
        # range_week branch this test mocks, not the calendar_weekly cache.
        monkeypatch.setattr(cal, "_monday_of", lambda d: date(2026, 10, 26))
        monkeypatch.setattr(cal, "_week_dates", lambda: [date(2026, 9, 7)])
        monkeypatch.setattr(cal, "_get_or_build_range_week", lambda monday: {
            "days": {"2026-10-29": {"bmo": [{"sym": "AAPL", "date_est": True}], "amc": [], "tbd": []}}
        })
        out = ea._cross_check_live_window("AAPL", "2026-10-30")
        assert out == {"match": "different_date", "other_date": "2026-10-29"}

    def test_ticker_not_present_anywhere_in_the_week_is_none(self, monkeypatch):
        import api.routers.calendar as cal
        from datetime import date
        # _week_dates() (the CURRENT week) deliberately differs from
        # _monday_of(target date) so the code takes the _get_or_build_
        # range_week branch this test mocks, not the calendar_weekly cache.
        monkeypatch.setattr(cal, "_monday_of", lambda d: date(2026, 10, 26))
        monkeypatch.setattr(cal, "_week_dates", lambda: [date(2026, 9, 7)])
        monkeypatch.setattr(cal, "_get_or_build_range_week", lambda monday: {
            "days": {"2026-10-29": {"bmo": [{"sym": "MSFT", "date_est": True}], "amc": [], "tbd": []}}
        })
        assert ea._cross_check_live_window("AAPL", "2026-10-30") is None


class TestReactionByDate:
    def test_no_quarterly_history_yields_empty(self, monkeypatch):
        monkeypatch.setattr("api.services.engine._fetch_quarterly_history", lambda sym: [])
        assert ea._reaction_by_date("AAPL") == {}

    def test_null_moves_are_never_included(self, monkeypatch):
        monkeypatch.setattr("api.services.engine._fetch_quarterly_history",
                            lambda sym: [{"reportedDate": "2026-08-01"}, {"reportedDate": "2026-05-01"}])
        monkeypatch.setattr("api.services.earnings_enrichment.get_historical_earnings_moves",
                            lambda sym, q: {"moves_pct": [None, -3.2]})
        out = ea._reaction_by_date("AAPL")
        assert out == {"2026-05-01": -3.2}
        assert "2026-08-01" not in out

    def test_date_keyed_never_positional(self, monkeypatch):
        # The whole point of this function: the caller gets a dict keyed by
        # the REAL date string, so a later join can never accidentally use
        # array position.
        monkeypatch.setattr("api.services.engine._fetch_quarterly_history",
                            lambda sym: [{"reportedDate": "2026-08-01"}, {"reportedDate": "2026-05-01"},
                                        {"reportedDate": "2026-02-01"}])
        monkeypatch.setattr("api.services.earnings_enrichment.get_historical_earnings_moves",
                            lambda sym, q: {"moves_pct": [4.1, -3.2, 1.0]})
        out = ea._reaction_by_date("AAPL")
        assert out == {"2026-08-01": 4.1, "2026-05-01": -3.2, "2026-02-01": 1.0}

    def test_an_exception_degrades_to_empty_not_a_crash(self, monkeypatch):
        def _boom(sym):
            raise RuntimeError("yfinance down")
        monkeypatch.setattr("api.services.engine._fetch_quarterly_history", _boom)
        assert ea._reaction_by_date("AAPL") == {}


class TestHistoricalEvents:
    def _mock_intel(self, monkeypatch, beat_history):
        monkeypatch.setattr("api.services.earnings_estimates.get_earnings_intel",
                            lambda sym: {"beat_history": beat_history})

    def test_builds_events_with_a_correctly_date_matched_reaction(self, monkeypatch):
        self._mock_intel(monkeypatch, [
            {"period": "2026-06-27", "report_date": "2026-08-01", "actual": 1.52, "estimate": 1.45,
             "surprise": 4.8, "year": 2026, "quarter": 3, "revenue_actual": 94_500_000_000,
             "revenue_estimate": 92_000_000_000},
        ])
        monkeypatch.setattr(ea, "_reaction_by_date", lambda sym: {"2026-08-01": 2.3})
        events = ea._historical_events("AAPL")
        assert len(events) == 1
        e = events[0]
        assert e["event_date"] == "2026-08-01"
        assert e["reporting_period"] == "2026-06-27"
        assert e["reaction_pct"] == 2.3

    def test_omits_reaction_when_no_date_match_exists_never_fabricates_one(self, monkeypatch):
        self._mock_intel(monkeypatch, [
            {"period": "2026-06-27", "report_date": "2026-08-01", "actual": 1.52, "estimate": 1.45,
             "surprise": 4.8, "year": 2026, "quarter": 3},
        ])
        # The reaction dict has data, but NOT for this exact report_date --
        # proves the join is by date, not "reactions exist so use one."
        monkeypatch.setattr(ea, "_reaction_by_date", lambda sym: {"2026-05-01": -9.9})
        events = ea._historical_events("AAPL")
        assert events[0]["reaction_pct"] is None

    def test_get_earnings_intel_failure_yields_empty_list(self, monkeypatch):
        def _boom(sym):
            raise RuntimeError("down")
        monkeypatch.setattr("api.services.earnings_estimates.get_earnings_intel", _boom)
        assert ea._historical_events("AAPL") == []

    def test_no_beat_history_yields_empty_list(self, monkeypatch):
        self._mock_intel(monkeypatch, [])
        assert ea._historical_events("AAPL") == []


class TestExpectedMove:
    def test_no_report_date_short_circuits_without_a_call(self, monkeypatch):
        called = []
        monkeypatch.setattr("api.services.implied_move.get_expected_move",
                            lambda *a, **kw: called.append(1))
        assert ea._expected_move("AAPL", None) is None
        assert not called

    def test_a_real_move_is_returned(self, monkeypatch):
        monkeypatch.setattr("api.services.implied_move.get_expected_move",
                            lambda sym, d: {"pct": 6.4, "dollar": 12.3, "strike": 200})
        out = ea._expected_move("AAPL", "2026-10-30")
        assert out == {"pct": 6.4, "dollar": 12.3}

    def test_unavailable_move_is_none_not_fabricated(self, monkeypatch):
        monkeypatch.setattr("api.services.implied_move.get_expected_move", lambda sym, d: None)
        assert ea._expected_move("AAPL", "2026-10-30") is None

    def test_an_exception_degrades_to_none(self, monkeypatch):
        def _boom(sym, d):
            raise RuntimeError("no options chain")
        monkeypatch.setattr("api.services.implied_move.get_expected_move", _boom)
        assert ea._expected_move("AAPL", "2026-10-30") is None


class TestGetEarningsAiEvidence:
    def test_blank_symbol_returns_a_well_shaped_unknown_result(self):
        out = ea.get_earnings_ai_evidence("")
        assert out["next_report"]["status"] == "UNKNOWN"
        assert out["historical_events"] == []
        assert out["expected_move"] is None

    def test_assembles_all_three_legs_together(self, monkeypatch):
        monkeypatch.setattr(ea, "resolve_entity", lambda sym: ({"status": "resolved", "entityId": "e1"}, sym))
        monkeypatch.setattr(ea, "_resolve_next_date_status",
                            lambda sym: {"date": "2026-10-30", "timing": "amc",
                                        "status": "CONFIRMED", "conflicting_date": None})
        monkeypatch.setattr(ea, "_historical_events", lambda sym: [{"event_date": "2026-08-01"}])
        monkeypatch.setattr(ea, "_expected_move", lambda sym, d: {"pct": 6.4, "dollar": 12.3})
        out = ea.get_earnings_ai_evidence("aapl")
        assert out["sym"] == "AAPL"
        assert out["entity"]["status"] == "resolved"
        assert out["next_report"]["status"] == "CONFIRMED"
        assert out["historical_events"] == [{"event_date": "2026-08-01"}]
        assert out["expected_move"] == {"pct": 6.4, "dollar": 12.3}

    def test_an_entity_resolution_failure_does_not_break_the_rest(self, monkeypatch):
        def _boom(sym):
            raise RuntimeError("entity master down")
        monkeypatch.setattr(ea, "resolve_entity", _boom)
        monkeypatch.setattr(ea, "_resolve_next_date_status",
                            lambda sym: {"date": None, "timing": None, "status": "UNKNOWN",
                                        "conflicting_date": None})
        monkeypatch.setattr(ea, "_historical_events", lambda sym: [])
        out = ea.get_earnings_ai_evidence("AAPL")
        assert out["entity"] is None
        assert out["sym"] == "AAPL"
