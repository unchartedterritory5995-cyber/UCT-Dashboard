"""A quarter's report date is the ANNOUNCEMENT, i.e. the earliest a provider gives.

Production, 8 Sep 2026: MU's FY2026 Q3 carried 2026-06-30. FMP's feed says
2026-06-24 (the announcement, after the close); Finnhub says 2026-06-30. The
collision tiebreak kept the LATER row, so the earnings-reaction strip measured
30 Jun -> 1 Jul and printed -6.3% for a print the market answered with +17.6%
on 25 Jun. The winner is still chosen on which row carries real consensus; only
the DATE is now decided separately.
"""
import inspect

from api.services import earnings_intel as ei


class TestReportDateIsTheAnnouncement:
    def test_the_collision_rule_takes_the_earliest_date(self):
        src = inspect.getsource(ei._quarters_from_estimates)
        assert 'rows[(fy, fq)]["report_date"] = min(' in src, (
            "the colliding rows' EARLIEST date must win")

    def test_the_winner_is_still_chosen_on_consensus(self):
        """The date rule must not have replaced the row-selection rule."""
        src = inspect.getsource(ei._quarters_from_estimates)
        assert 'if new_has and not prior_has:' in src

    def test_min_over_iso_dates_picks_the_announcement(self):
        # The rule reduces to this: ISO dates sort lexicographically.
        assert min("2026-06-30", "2026-06-24") == "2026-06-24"
        assert min("2025-12-17", "2026-01-05") == "2025-12-17"


class TestCollisionKeepsTheEarliestDate:
    """MU's provider feed really does return both rows for FY2026 Q3:
         2026-06-24  eps 25.11  rev 41,456,000,000   <- the announcement
         2026-06-30  eps 25.11  rev None             <- a later duplicate
    The first version of this fix read the prior date AFTER the tiebreak had
    already replaced the stored row, so min() compared the incoming date against
    itself and 2026-06-30 survived anyway.
    """

    def _rows(self, monkeypatch, feed):
        from api.services import earnings_intel as ei
        from api.services import earnings_estimates as ee

        class Cal:
            def period_end_for_report(self, rd):
                return {"fiscal_year": 2026, "fiscal_quarter": 3,
                        "period_end": "2026-05-31", "confidence": "observed"}

        monkeypatch.setattr(ee, "get_year_earnings",
                            lambda s, y: feed if y == 2026 else [])
        return ei._quarters_from_estimates("MU", Cal())

    def test_the_announcement_date_wins_regardless_of_order(self, monkeypatch):
        announce = {"date": "2026-06-24", "eps_actual": 25.11,
                    "revenue_actual": 41456000000, "eps_estimate": 24.0}
        dup = {"date": "2026-06-30", "eps_actual": 25.11,
               "revenue_actual": None, "eps_estimate": None}
        for feed in ([announce, dup], [dup, announce]):
            rows = self._rows(monkeypatch, feed)
            assert rows[(2026, 3)]["report_date"] == "2026-06-24", feed

    def test_the_row_with_consensus_still_wins_the_financials(self, monkeypatch):
        """The date rule must not have overridden the row-selection rule."""
        no_consensus = {"date": "2026-06-24", "eps_actual": 1.0,
                        "revenue_actual": None, "eps_estimate": None}
        with_consensus = {"date": "2026-06-30", "eps_actual": 25.11,
                          "revenue_actual": 41456000000, "eps_estimate": 24.0}
        rows = self._rows(monkeypatch, [no_consensus, with_consensus])
        assert rows[(2026, 3)]["eps_actual"] == 25.11        # consensus row kept
        assert rows[(2026, 3)]["report_date"] == "2026-06-24"  # earliest date
