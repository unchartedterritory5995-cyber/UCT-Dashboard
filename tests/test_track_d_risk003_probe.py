"""Tests for tools/track_d_risk003_probe.py's pure classification logic.

The network/railway-ssh side is not exercised here (that's an actual
production read); only the freshness math is unit-tested, against the real
evidence shape this probe already produced once (2026-09-05 run).
"""

from __future__ import annotations

import datetime

from tools import track_d_risk003_probe as probe


class TestLastTradingDay:
    def test_a_weekday_returns_itself(self):
        wed = datetime.date(2026, 9, 2)  # Wednesday
        assert probe._last_trading_day_on_or_before(wed) == wed

    def test_saturday_walks_back_to_friday(self):
        sat = datetime.date(2026, 9, 5)
        assert probe._last_trading_day_on_or_before(sat) == datetime.date(2026, 9, 4)

    def test_sunday_walks_back_to_friday(self):
        sun = datetime.date(2026, 9, 6)
        assert probe._last_trading_day_on_or_before(sun) == datetime.date(2026, 9, 4)

    def test_monday_returns_itself_not_the_weekend(self):
        mon = datetime.date(2026, 9, 7)
        assert probe._last_trading_day_on_or_before(mon) == mon


class TestClassify:
    def test_max_as_of_matches_last_trading_day_is_healthy(self):
        result = {"coverage_summary": [52, 20, 20260904, 20260810]}
        verdict, reason = probe.classify(result, today=datetime.date(2026, 9, 5))  # Saturday
        assert verdict == "VERIFIED HEALTHY"
        assert "20260904" in reason

    def test_real_2026_09_05_evidence_is_healthy(self):
        # The exact result this probe produced on 2026-09-05 (Saturday) --
        # a regression pin so a future refactor can't silently change the
        # verdict this run already delivered and was recorded on.
        result = {
            "now_utc": "2026-09-05T15:28:40.325132",
            "coverage_summary": [52, 20, 20260904, 20260810],
        }
        verdict, _ = probe.classify(
            result,
            today=datetime.date(2026, 9, 5),
            now_utc=datetime.datetime(2026, 9, 5, 15, 28, 40),
        )
        assert verdict == "VERIFIED HEALTHY"

    def test_many_sessions_behind_after_the_morning_window_is_broken(self):
        result = {"coverage_summary": [10, 5, 20260901, 20260801]}  # 4+ trading days behind
        verdict, _ = probe.classify(
            result,
            today=datetime.date(2026, 9, 7),  # Monday
            now_utc=datetime.datetime(2026, 9, 7, 20, 0, 0),  # 4pm ET
        )
        assert verdict == "VERIFIED BROKEN"

    def test_one_session_behind_before_the_sweep_window_stays_unverified(self):
        result = {"coverage_summary": [10, 5, 20260904, 20260801]}  # Friday's close, sweep may not have posted yet
        verdict, _ = probe.classify(
            result,
            today=datetime.date(2026, 9, 7),  # Monday
            now_utc=datetime.datetime(2026, 9, 7, 9, 0, 0),  # ~5am ET
        )
        assert verdict == "STILL PRODUCTION-UNVERIFIED"
