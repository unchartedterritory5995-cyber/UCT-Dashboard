"""R64 AMENDED — tools/deploy_frequency_cost_report.py.

⛔ This report NEVER gates a push — there is no exit code that means "refuse". These
tests drive `compute_report` directly (pure, no CLI, no clock) plus the market-window
boundary and the unreadable-CLI path, mirroring `pre_push_guard.py`'s own discipline:
UNREADABLE is reported honestly, never silently folded into "0 deploys, all clear".
"""
import datetime as dt
import zoneinfo

import pytest

from tools import deploy_frequency_cost_report as r

ET = zoneinfo.ZoneInfo("America/New_York")


def _dep(hour, minute, day_offset=0, base=None):
    base = base or dt.datetime(2026, 9, 17, tzinfo=ET)
    when = (base + dt.timedelta(days=day_offset)).replace(hour=hour, minute=minute)
    return {"createdAt": when.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")}


# ─────────────────────────────────────────────────────── the window boundary

def test_a_deploy_inside_the_market_window_is_counted():
    now = dt.datetime(2026, 9, 17, 12, 0, tzinfo=ET)
    rep = r.compute_report([_dep(10, 0)], now=now, days=1)
    assert rep["deploys_in_window"] == 1
    assert rep["deploys_outside_window"] == 0


def test_a_deploy_before_08_30_is_NOT_counted():
    now = dt.datetime(2026, 9, 17, 12, 0, tzinfo=ET)
    rep = r.compute_report([_dep(8, 29)], now=now, days=1)
    assert rep["deploys_in_window"] == 0
    assert rep["deploys_outside_window"] == 1


def test_a_deploy_after_16_20_is_NOT_counted():
    now = dt.datetime(2026, 9, 17, 20, 0, tzinfo=ET)
    rep = r.compute_report([_dep(16, 21)], now=now, days=1)
    assert rep["deploys_in_window"] == 0
    assert rep["deploys_outside_window"] == 1


def test_the_boundaries_themselves_are_INSIDE_the_window():
    """⛔ `<=` vs `<` at the edges is exactly the off-by-one this report exists to be
    honest about — a deploy at exactly 08:30 or 16:20 is still a member looking at a
    live screen."""
    now = dt.datetime(2026, 9, 17, 20, 0, tzinfo=ET)
    rep = r.compute_report([_dep(8, 30), _dep(16, 20)], now=now, days=1)
    assert rep["deploys_in_window"] == 2


# ─────────────────────────────────────────────────────── the arithmetic, plainly

def test_the_cost_line_multiplies_count_by_the_measured_range_not_a_guess():
    now = dt.datetime(2026, 9, 17, 20, 0, tzinfo=ET)
    rep = r.compute_report([_dep(10, 0), _dep(11, 0), _dep(12, 0)], now=now, days=1)
    assert rep["deploys_in_window"] == 3
    assert rep["estimated_member_facing_seconds_low"] == pytest.approx(3 * r.BLIP_LOW_S)
    assert rep["estimated_member_facing_seconds_high"] == pytest.approx(3 * r.BLIP_HIGH_S)


def test_the_sample_size_behind_the_blip_figure_is_reported_as_ONE():
    """⛔ n=1 must never quietly read as a confidence interval. The report carries the
    sample size beside the range so nobody downstream mistakes "the one measurement we
    have" for "a statistically supported bound"."""
    rep = r.compute_report([], now=dt.datetime(2026, 9, 17, 12, 0, tzinfo=ET), days=1)
    assert rep["blip_sample_size"] == 1


def test_a_recommendation_only_fires_when_there_is_something_to_recommend_about():
    now = dt.datetime(2026, 9, 17, 20, 0, tzinfo=ET)
    zero = r.compute_report([], now=now, days=1)
    assert "no market-window" in zero["recommendation"]
    one = r.compute_report([_dep(10, 0)], now=now, days=1)
    assert "recommended, not imposed" in one["recommendation"]


# ────────────────────────────────────────────────── the days window + staleness

def test_a_deploy_older_than_the_requested_window_is_excluded():
    now = dt.datetime(2026, 9, 17, 20, 0, tzinfo=ET)
    old = _dep(10, 0, day_offset=-5)
    rep = r.compute_report([old], now=now, days=1)
    assert rep["deploys_in_window"] == 0
    assert rep["deploys_outside_window"] == 0, "an old deploy was counted at all"


def test_widening_days_recovers_the_older_deploy():
    now = dt.datetime(2026, 9, 17, 20, 0, tzinfo=ET)
    old = _dep(10, 0, day_offset=-5)
    rep = r.compute_report([old], now=now, days=7)
    assert rep["deploys_in_window"] == 1


# ────────────────────────────────────────── an unreadable date is COUNTED, not skipped

def test_an_unparsable_createdAt_is_recorded_not_silently_dropped():
    """⛔ Same discipline as `pre_push_guard.py`'s UNREADABLE state: a row this report
    could not date is a fact worth surfacing, not a row that quietly vanishes from
    every count as though it never existed."""
    now = dt.datetime(2026, 9, 17, 20, 0, tzinfo=ET)
    rep = r.compute_report([{"createdAt": "not-a-date"}, _dep(10, 0)], now=now, days=1)
    assert rep["deploys_unreadable_date"] == 1
    assert rep["deploys_in_window"] == 1


# ───────────────────────────────────────────── the CLI-unreadable path never fakes zero

def test_main_reports_UNREADABLE_and_exits_1_when_the_cli_cannot_be_read(monkeypatch, capsys):
    """⛔⛔ THE ONE THIS REPORT MUST NEVER GET WRONG. If `read_deploys` cannot read the
    list at all, the report must say so and exit non-zero — NOT silently compute a
    report over an empty list, which would print 'estimated member-facing 502s: 0-0 s'
    and read exactly like a clean, deploy-free day."""
    monkeypatch.setattr(r, "read_deploys", lambda service=r.SERVICE: None)
    rc = r.main([])
    assert rc == 1
    assert "UNREADABLE" in capsys.readouterr().out


def test_main_with_a_readable_EMPTY_list_reports_zero_and_exits_0(monkeypatch, capsys):
    """⛔ NON-VACUITY / discriminator for the test above: an ACTUALLY EMPTY list (the
    CLI works, there is genuinely nothing to report) must read differently from an
    UNREADABLE one, or the distinction above is decorative."""
    monkeypatch.setattr(r, "read_deploys", lambda service=r.SERVICE: [])
    rc = r.main([])
    out = capsys.readouterr().out
    assert rc == 0
    assert "UNREADABLE" not in out


def test_main_never_returns_a_refusal_style_code_this_report_is_not_a_gate():
    """⛔ R64 is observational. The only non-zero exit is UNREADABLE (a measurement
    failure), never a verdict about whether deploys happened — this report has no
    business refusing anything, and a future edit that turns it into a second gate
    beside pre_push_guard.py should be caught here."""
    import inspect
    src = inspect.getsource(r.main)
    assert "REFUSE" not in src and "REFUSING" not in src
