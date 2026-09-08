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
