"""A provider-verified quiet EXTENDED-HOURS tail is a warning, not an alert (2026-11-15).

ONON printed nothing after 18:09 ET on Friday 2026-11-13. The server answered its 1/5/15/30m
charts with tail_status "verified" (the provider was asked after the expected bucket closed and
had nothing newer), yet the monitor held six freshness alerts open all weekend, burying any real
one. ⛔ A missing REGULAR-session bucket must stay a FAIL even when "verified": a provider that
answers nothing for everyone would mark every tail verified.
"""
from __future__ import annotations

from datetime import date

from api.services.chart_monitor import checks as C

from tests.test_chart_monitor_runtime import FakeEdge, _run, at

FRI, SUN, MON, TUE = date(2026, 11, 13), date(2026, 11, 15), date(2026, 11, 16), date(2026, 11, 17)
t = lambda d, h, m: C.et_epoch(d, h * 60 + m)


def test_onon_weekend_5m_and_30m_are_warnings_when_verified_and_alerts_otherwise():
    now = at(SUN, 12, 0)
    for tf, last in (("5", t(FRI, 18, 5)), ("30", t(FRI, 18, 0)), ("1", t(FRI, 18, 9))):
        assert C.check_tail(now, tf, last).status == C.FAIL, tf
        assert C.check_tail(now, tf, last, tail_status="unverified").status == C.FAIL, tf
        v = C.check_tail(now, tf, last, tail_status="verified")
        assert v.status == C.WARN and "provider-verified" in v.detail, (tf, v)


def test_a_missing_regular_session_bar_fails_even_when_verified():
    now = at(SUN, 12, 0)
    assert C.check_tail(now, "5", t(FRI, 14, 0), tail_status="verified").status == C.FAIL


def test_a_quiet_night_into_monday_premarket_is_a_warning_when_verified():
    assert C.check_tail(at(MON, 8, 0), "5", t(FRI, 17, 30), tail_status="verified").status == C.WARN


def test_a_whole_missing_monday_fails_on_tuesday_even_when_verified():
    assert C.check_tail(at(TUE, 8, 0), "5", t(FRI, 17, 30), tail_status="verified").status == C.FAIL


def test_gap_touches_rth_edges():
    assert not C.gap_touches_rth(t(FRI, 15, 55), t(FRI, 16, 0), "5")    # next bucket 16:00 is post
    assert C.gap_touches_rth(t(FRI, 15, 50), t(FRI, 16, 0), "5")        # 15:55 is missing, RTH
    assert not C.gap_touches_rth(t(FRI, 18, 5), t(FRI, 19, 55), "5")
    assert C.gap_touches_rth(t(FRI, 17, 30), t(TUE, 7, 55), "5")         # all of Monday
    assert not C.gap_touches_rth(t(FRI, 18, 0), t(FRI, 18, 0), "5")
    assert not C.gap_touches_rth(t(FRI, 15, 30), t(FRI, 19, 0), "60")   # short 15:30 bucket held
    assert C.gap_touches_rth(t(FRI, 14, 30), t(FRI, 19, 0), "60")       # 15:30 bucket missing


class QuietAfterHours(FakeEdge):
    """ONON's shape: bars stop at 18:00 Friday on every intraday series, tail verified."""

    def get_json(self, path, max_retries=2, deadline=None):
        r = super().get_json(path, max_retries=max_retries, deadline=deadline)
        body = r.get("body")
        if "/ONON?" in path and isinstance(body, dict) and "tf=D" not in path:
            body["bars"] = [b for b in body["bars"] if isinstance(b["t"], int) and b["t"] <= t(FRI, 18, 0)]
            body["tail_status"] = "verified"
            body["newest_bar_is_forming"] = False
        return r


def test_the_monitor_passes_the_servers_tail_status_to_the_freshness_check():
    now = at(SUN, 12, 0)
    cyc = _run(QuietAfterHours(now), now)
    failing = {k: d for k, (f, d) in cyc.observations.items() if f and k.startswith("freshness|")}
    assert not failing, failing
