"""Extended-hours tails are judged against the EXTENDED session, not the 16:00 close.

⛔ MEASURED ON PRODUCTION 2026-11-11 01:22Z (20:22 ET): AAPL / TSLA / SOFI tf=1 first
answers ended at 16:53 ET — three hours of post-market missing — served `sqlite` with
`tail_status: current` and no Retry-After; a second request ~20 s later was complete.
Two server rules were RTH-only while the served series carries 04:00-20:00 ET:
  * `_needs_fresh` after 20:00 asked only "does the tail reach 16:00?";
  * `intraday_tail_status` judged the tail against the final RTH bucket.
"""
from __future__ import annotations

import time as _real_time
import types
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch

_ET = ZoneInfo("America/New_York")


def et(y, m, d, hh, mm, ss=0) -> int:
    return int(datetime(y, m, d, hh, mm, ss, tzinfo=_ET).timestamp())


# Tuesday 2026-11-10 (a full trading day); the prod clock 20:22 ET.
NOW_2022 = et(2026, 11, 10, 20, 22)
TAIL_1653 = et(2026, 11, 10, 16, 53)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(bars_fetch, "_tail_verified", {})
    monkeypatch.setattr(bars_fetch, "_ext_completeness_attempt", {})
    monkeypatch.setattr(bars_fetch, "_completeness_attempt", {})
    bars_fetch.set_request_interactive(False)
    yield
    bars_fetch.set_request_interactive(False)


def _st(tf, tail, now):
    return bars_fetch.intraday_tail_status("AAPL", tf, tail, now=now)["tail_status"]


# ── tail_status ──────────────────────────────────────────────────────────────

def test_PROD_1m_tail_at_1653_is_NOT_current_at_2022():
    assert _st("1", TAIL_1653, NOW_2022) == "unverified"


def test_a_tail_through_the_extended_close_is_current_after_2000():
    assert _st("1", et(2026, 11, 10, 19, 59), NOW_2022) == "current"
    assert _st("5", et(2026, 11, 10, 19, 55), NOW_2022) == "current"
    assert _st("60", et(2026, 11, 10, 19, 0), NOW_2022) == "current"
    assert _st("60", et(2026, 11, 10, 16, 0), NOW_2022) == "unverified"


def test_post_market_hours_judge_the_live_extended_bucket():
    now = et(2026, 11, 10, 18, 0, 30)
    assert _st("1", TAIL_1653, now) == "unverified"
    assert _st("1", et(2026, 11, 10, 17, 59), now) == "current"


def test_pre_market_tail_from_last_night_is_missing_the_pre_market():
    now = et(2026, 11, 10, 8, 0, 30)
    assert _st("1", et(2026, 11, 9, 19, 59), now) == "unverified"
    assert _st("1", et(2026, 11, 10, 7, 59), now) == "current"


def test_overnight_before_0400_judges_the_previous_extended_close():
    now = et(2026, 11, 11, 2, 0)
    assert _st("1", et(2026, 11, 10, 19, 59), now) == "current"
    assert _st("1", TAIL_1653, now) == "unverified"


def test_early_close_day_extended_session_ends_at_1700():
    now = et(2026, 11, 27, 18, 0)                     # Black Friday, 13:00 close
    assert _st("1", et(2026, 11, 27, 16, 59), now) == "current"
    assert _st("1", et(2026, 11, 27, 12, 59), now) == "unverified"


def test_RTH_frontier_is_unchanged():
    now = et(2026, 11, 10, 11, 33)
    assert _st("1", et(2026, 11, 10, 11, 31), now) == "current"
    assert _st("1", et(2026, 11, 10, 11, 30), now) == "unverified"
    assert _st("5", et(2026, 11, 10, 11, 20), now) == "current"


def test_verification_after_the_extended_close_makes_a_thin_tail_verified():
    bars_fetch._mark_tail_verified("AAPL", "1", et(2026, 11, 10, 20, 10))
    assert _st("1", TAIL_1653, NOW_2022) == "verified"


def test_CONTROL_verification_before_the_extended_close_proves_nothing():
    bars_fetch._mark_tail_verified("AAPL", "1", et(2026, 11, 10, 17, 0))
    assert _st("1", TAIL_1653, NOW_2022) == "unverified"


# ── _needs_fresh after 20:00 ET ──────────────────────────────────────────────

class _FrozenDT(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime.fromtimestamp(NOW_2022, tz)

    @classmethod
    def utcnow(cls):
        return datetime.utcfromtimestamp(NOW_2022)


@pytest.fixture
def frozen_2022(monkeypatch):
    fake_time = types.SimpleNamespace(**{k: getattr(_real_time, k) for k in dir(_real_time)
                                         if not k.startswith("__")})
    fake_time.time = lambda: float(NOW_2022)
    monkeypatch.setattr(bars_fetch, "_time", fake_time)
    monkeypatch.setattr(bars_fetch, "datetime", _FrozenDT)


def test_PROD_interactive_request_refetches_the_missing_post_market(frozen_2022):
    bars_fetch.set_request_interactive(True)
    assert bars_fetch._needs_fresh(TAIL_1653, "1", "AAPL") is True


def test_CONTROL_background_sweeps_do_not_escalate(frozen_2022):
    bars_fetch.set_request_interactive(False)
    assert bars_fetch._needs_fresh(TAIL_1653, "1", "AAPL") is False


def test_a_tail_through_the_extended_close_needs_nothing(frozen_2022):
    bars_fetch.set_request_interactive(True)
    assert bars_fetch._needs_fresh(et(2026, 11, 10, 19, 59), "1", "AAPL") is False


def test_a_verified_thin_session_is_not_re_asked(frozen_2022):
    bars_fetch.set_request_interactive(True)
    bars_fetch._mark_tail_verified("THIN", "1", et(2026, 11, 10, 20, 5))
    assert bars_fetch._needs_fresh(TAIL_1653, "1", "THIN") is False


def test_the_escalation_is_rate_limited_per_tail(frozen_2022):
    bars_fetch.set_request_interactive(True)
    assert bars_fetch._needs_fresh(TAIL_1653, "1", "AAPL") is True
    assert bars_fetch._needs_fresh(TAIL_1653, "1", "AAPL") is False


def test_ext_complete_tolerates_one_bucket():
    assert bars_fetch.intraday_ext_session_complete("1", et(2026, 11, 10, 19, 58)) is True
    assert bars_fetch.intraday_ext_session_complete("1", et(2026, 11, 10, 19, 57)) is False
    assert bars_fetch.intraday_ext_session_complete("1", TAIL_1653) is False
