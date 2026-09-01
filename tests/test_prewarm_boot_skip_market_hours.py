"""Boot-pass skip during MARKET HOURS (2026-09-01).

A mid-session worker restart used to re-fetch the WHOLE warm universe (~68k D/W/M,
0 cached) because `_boot_can_skip` refused to skip anything inside the active data
window — grading against `_expected_session()`, which is TODAY during RTH (whose
daily bar is still evolving). That churn reset the instant-symbol re-warm to a slow
crawl and competed with the web serving users.

Fix: during market hours, skip a D/W/M whose newest bar already has the last
COMPLETED session (yesterday during RTH). Only a genuinely stale bar (missing a
completed session) still re-fetches. This never OVER-skips.
"""
from unittest.mock import patch

import api.services.bars_prewarm as bp


def _mkt_open(v=True):
    return patch.object(bp, "_in_active_data_window", lambda: v)


def test_during_market_hours_a_daily_with_yesterdays_close_is_SKIPPED():
    # last_completed = 20260831 (yesterday), expected = 20260901 (today, evolving).
    with _mkt_open(True), \
         patch.object(bp, "_last_completed_session", lambda: 20260831), \
         patch.dict("os.environ", {"PREWARM_BOOT_SKIP_SETTLED": "1"}):
        # Has yesterday's completed close → warm enough for the boot → SKIP.
        assert bp._boot_can_skip(20260831, "D") is True
        # Has today's (evolving) bar → also skip.
        assert bp._boot_can_skip(20260901, "D") is True


def test_during_market_hours_a_genuinely_stale_daily_still_REFETCHES():
    with _mkt_open(True), \
         patch.object(bp, "_last_completed_session", lambda: 20260831), \
         patch.dict("os.environ", {"PREWARM_BOOT_SKIP_SETTLED": "1"}):
        # Missing the last completed session (only has data through 8/28) → NOT skipped.
        assert bp._boot_can_skip(20260828, "D") is False


def test_kill_switch_disables_the_skip():
    with _mkt_open(True), \
         patch.object(bp, "_last_completed_session", lambda: 20260831), \
         patch.dict("os.environ", {"PREWARM_BOOT_SKIP_SETTLED": "0"}):
        assert bp._boot_can_skip(20260831, "D") is False


def test_a_cold_entry_last_ts_None_is_never_skipped():
    with _mkt_open(True), patch.dict("os.environ", {"PREWARM_BOOT_SKIP_SETTLED": "1"}):
        assert bp._boot_can_skip(None, "D") is False


def test_last_completed_session_is_the_prior_trading_day_not_today():
    # The whole point: it must trail _expected_session() during RTH (never equal today
    # mid-session, or nothing skips).
    from api.services.bars_fetch import _expected_latest_session_yyyymmdd
    assert bp._last_completed_session() <= _expected_latest_session_yyyymmdd()
