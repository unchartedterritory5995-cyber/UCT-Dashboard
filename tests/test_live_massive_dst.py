"""The live tape's ET handling must be DST-aware.

WHY THIS EXISTS
---------------
`live_massive_router.py` hard-coded a -4 (EDT) offset in five places, and the
comments admitted it: "July DST", "US Eastern DST". Everything looked perfect all
summer. From the November rollover until March, ET is -5, so every one of them
would have been an hour wrong:

  * the liveness badge reads "○ WORKER IDLE" on a perfectly healthy tape
  * every printed TIME on every print is an hour early
  * the Market Read "LAST HOUR" panel is permanently empty
  * worker-history's scan window runs ~60 minutes past the newest real print, so
    those minutes read as zero-write and render a gold "1 FEED GAP TODAY" alarm
    banner — every single day, all winter, on a healthy feed

That is the nastiest shape of bug: invisible for eight months, then wrong for
four, with the symptom ("the tape is down") pointing away from the cause.

The rest of the codebase already uses ZoneInfo("America/New_York") — main.py,
daily_tracker.py, deploy_log.py, discord_watchlist.py. This file was the outlier.

These tests pin the property, not the implementation: ET must actually change
offset across the year. A future edit that reintroduces a fixed offset fails here
regardless of which month it is run in.
"""
import re
import pathlib
from datetime import datetime

import pytest

ROUTER = pathlib.Path(__file__).resolve().parents[1] / "api" / "live_massive_router.py"
SRC = ROUTER.read_text(encoding="utf-8")


def _strip_comments(s: str) -> str:
    return "\n".join(
        l for l in s.split("\n") if not l.lstrip().startswith("#")
    )


def test_et_is_zoneinfo_not_a_fixed_offset():
    """A fixed-offset ET is correct for only part of the year."""
    assert 'ZoneInfo("America/New_York")' in SRC, (
        "live_massive_router must use ZoneInfo for ET, like main.py and "
        "daily_tracker.py already do"
    )
    assert "ET = timezone(timedelta(" not in SRC, (
        "ET is back to a fixed offset — it will be an hour wrong every winter"
    )


def test_no_hardcoded_eastern_offsets_anywhere_in_the_file():
    """The five original sites were spread across ~5,700 lines; catch any new one."""
    code = _strip_comments(SRC)
    offenders = re.findall(r"timedelta\(hours=-?[45]\)", code)
    assert not offenders, (
        f"hard-coded Eastern offset(s) reintroduced: {offenders}. "
        "Use the module-level ET (ZoneInfo) so it follows DST."
    )


def test_zoneinfo_actually_shifts_across_the_dst_boundary():
    """Guards against a tzdata-less environment silently yielding a fixed offset.

    If this ever fails, ET is not really DST-aware in the deployed image and the
    winter bugs come straight back.
    """
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    summer = datetime(2026, 7, 26, 12, 0, tzinfo=et)
    winter = datetime(2026, 12, 15, 12, 0, tzinfo=et)

    assert summer.strftime("%z") == "-0400", "EDT should be UTC-4"
    assert winter.strftime("%z") == "-0500", "EST should be UTC-5"
    assert summer.utcoffset() != winter.utcoffset(), (
        "ET offset did not change across the DST boundary — tzdata is missing, "
        "so the timezone is effectively fixed and the winter bugs are live"
    )


@pytest.mark.parametrize(
    "y,m,d,expected",
    [
        (2026, 7, 26, "-0400"),   # mid-EDT
        (2026, 12, 15, "-0500"),  # mid-EST
        # DST flips at 2 AM, so MIDNIGHT on a transition day still carries the
        # OLD offset. Getting these two backwards is the classic off-by-an-hour,
        # and a fixed-offset implementation cannot express them at all.
        (2026, 3, 8, "-0500"),    # spring-forward day: 00:00 is still EST
        (2026, 11, 1, "-0400"),   # fall-back day:      00:00 is still EDT
    ],
)
def test_day_boundary_offsets_are_right_on_transition_days(y, m, d, expected):
    """`day_start_ts`/`day_end_ts` build a midnight-ET timestamp for an arbitrary
    date, so they have to be correct on the transition days too — not just in the
    middle of each season."""
    from zoneinfo import ZoneInfo

    midnight = datetime(y, m, d, 0, 0, 0, tzinfo=ZoneInfo("America/New_York"))
    assert midnight.strftime("%z") == expected


def test_push_secret_is_not_accepted_in_a_url():
    """PUSH_SECRET grants full flow-admin AND is the proxy HMAC key.

    Query strings are logged by Cloudflare and Railway and leak via Referer, so
    it must only ever travel in the Authorization header.
    """
    p = ROUTER.parent / "routers" / "massive_stream_router.py"
    src = p.read_text(encoding="utf-8")
    assert 'query_params.get("token"' not in src, (
        "stream-test accepts PUSH_SECRET as ?token= again — that puts a "
        "full-admin credential into access logs and Referer headers"
    )
    assert 'headers.get("authorization"' in src, (
        "the Bearer header path must remain — it is the only way in"
    )
