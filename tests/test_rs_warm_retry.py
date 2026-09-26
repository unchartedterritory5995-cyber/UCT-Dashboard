"""The RS-rankings boot warmer retries a FAILED warm soon, not in 50 minutes.

⚰️ 2026-09-25: a 9-minute-old production pod answered 404 for /api/rs-rankings/AAPL
(every RsBadge blank) while the next pod's warm logged 3,612 entries at +2.5 min.
The warmer's loop slept `3000` after every attempt, success or not, so one
transient error at +120 s — the boot herd on bar I/O is exactly when it runs —
cost members the badge for the rest of that pod's first hour. The sleep is now a
pure function of (ok, failures); this pins the schedule so the retry cannot be
quietly flattened back to the happy-path wait.
"""
from api.main import (
    RS_WARM_OK_SLEEP_S,
    RS_WARM_RETRY_BASE_S,
    RS_WARM_RETRY_CAP_S,
    _rs_warm_sleep_seconds,
)


def test_a_successful_warm_keeps_the_under_ttl_cadence():
    assert _rs_warm_sleep_seconds(True, 0) == RS_WARM_OK_SLEEP_S == 3000
    # ...even right after a run of failures — success resets the schedule.
    assert _rs_warm_sleep_seconds(True, 7) == 3000


def test_a_failed_warm_retries_soon_and_backs_off_to_a_cap():
    assert [_rs_warm_sleep_seconds(False, n) for n in (1, 2, 3, 4, 5, 9)] == [120, 240, 480, 900, 900, 900]
    assert RS_WARM_RETRY_BASE_S == 120 and RS_WARM_RETRY_CAP_S == 900


def test_a_failure_never_waits_as_long_as_a_success():
    # The whole point: an empty table must not sit for the happy-path 50 minutes.
    for n in range(1, 12):
        assert _rs_warm_sleep_seconds(False, n) < RS_WARM_OK_SLEEP_S
