"""The `--ticking` window must know when each sweep is actually SCHEDULED to fire.

⚰️ **THE FALSE ALARM THIS KILLS.** `_window` treated `hours is None` as "the whole
weekday", so the three sweeps that fire at FIXED TIMES read as *inside the window* at
any hour. Measured live 2026-09-14 00:43 ET: EVENT-PROXIMITY, SCAN-MEMBERSHIP and
CATALYST-MATCH all reported

    NO  -- no heartbeat at all, and it IS inside the window

with remediation pointing at flags that read `'1'` in-process and a log line that does
not exist. Their last scheduled firings were the previous FRIDAY, ~55h back and far
outside their 26h bounds.

⭐ **A sweep cannot be stale before a firing it was never scheduled to make.** The
question is whether a scheduled firing has happened inside the staleness bound; if not,
the sweep is UNJUDGEABLE, never a fault.

⛔ The load-bearing case is `catalyst_match`, which fires 17:30 weekdays: without this,
**every Monday** the 09:12 ET monitor post and the 16:30 ET gate check alarmed on a
healthy sweep. A rail that cries wolf weekly gets muted, and then it is not a rail.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import pathlib

import pytest

try:
    from zoneinfo import ZoneInfo
except ImportError:                                      # pragma: no cover
    pytest.skip("no zoneinfo", allow_module_level=True)

ET = ZoneInfo("America/New_York")
_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "s7_price_level_report.py"


def _load():
    spec = importlib.util.spec_from_file_location("s7rep_window", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


R = _load()


def _spec(key):
    return [x for x in R.SWEEPS if x[0] == key][0]


def _win(key, when):
    x = _spec(key)
    return R._window(x[5], fires=x[8], bound=x[6], now=when)


# ── the Monday hole, which is the whole reason this exists ──────────────────

@pytest.mark.parametrize("when,label", [
    (dt.datetime(2026, 9, 14, 0, 43, tzinfo=ET), "the hour the false alarm was measured"),
    (dt.datetime(2026, 9, 14, 9, 12, tzinfo=ET), "the Layer 1 monitor's ticking post"),
    (dt.datetime(2026, 9, 14, 16, 30, tzinfo=ET), "the Layer 1 gate-check post"),
])
def test_catalyst_match_is_UNJUDGEABLE_on_a_monday_before_its_1730_firing(when, label):
    inside, why = _win("catalyst_match", when)
    assert inside is False, "%s: still claims to be inside the window" % label
    assert "cannot be judged" in why
    assert "next Mon 17:30 ET" in why


def test_catalyst_match_becomes_judgeable_once_it_has_fired():
    """NON-VACUITY: if this ever fails the fix has silenced the sweep entirely."""
    inside, _ = _win("catalyst_match", dt.datetime(2026, 9, 14, 17, 31, tzinfo=ET))
    assert inside is True
    inside, _ = _win("catalyst_match", dt.datetime(2026, 9, 15, 9, 12, tzinfo=ET))
    assert inside is True, "a Tuesday morning must still be able to report a stall"


def test_event_proximity_is_unjudgeable_before_its_first_monday_firing():
    inside, why = _win("event_proximity", dt.datetime(2026, 9, 14, 6, 0, tzinfo=ET))
    assert inside is False and "next Mon 07:05 ET" in why
    inside, _ = _win("event_proximity", dt.datetime(2026, 9, 14, 7, 6, tzinfo=ET))
    assert inside is True


# ── the weekday-only / nightly distinction, read from the cron not the prose ──

def test_the_nightly_sweep_is_STILL_JUDGED_at_a_weekend():
    """⛔ `scan_membership`'s cron carries NO day_of_week — it runs every night.

    The old code returned `n/a (weekend)` for it, so a nightly sweep that died on a
    Friday was invisible until Monday. Declaring the firing times fixes both
    directions: fewer false alarms on Monday, and no false silence at the weekend.
    """
    sat = dt.datetime(2026, 9, 12, 23, 0, tzinfo=ET)
    inside, _ = _win("scan_membership", sat)
    assert inside is True, "a nightly sweep must remain judgeable at a weekend"


def test_a_weekday_only_sweep_is_not_judged_at_a_weekend():
    sat = dt.datetime(2026, 9, 12, 23, 0, tzinfo=ET)
    inside, why = _win("catalyst_match", sat)
    assert inside is False
    assert "cannot be judged" in why


# ── the per-minute sweeps are untouched ─────────────────────────────────────

@pytest.mark.parametrize("key", ["price_level", "position_risk", "indicator_condition"])
def test_the_per_minute_sweeps_keep_their_hours_model(key):
    assert _spec(key)[8] is None, "an hours-based sweep must declare no firing table"
    inside, _ = _win(key, dt.datetime(2026, 9, 14, 12, 0, tzinfo=ET))
    assert inside is True
    inside, why = _win(key, dt.datetime(2026, 9, 14, 3, 0, tzinfo=ET))
    assert inside is False and "outside 09:00-16:59" in why


def test_an_unresolvable_clock_still_assumes_INSIDE():
    """⛔ Never guess QUIET — this direction must survive the refactor."""
    src = _TOOL.read_text(encoding="utf-8")
    assert 'return (True, "could not resolve ET -- assuming inside the window")' in src


def test_every_descriptor_declares_the_firing_field():
    for x in R.SWEEPS:
        assert len(x) == 9, "descriptor arity changed — update the controls"
        assert x[8] is None or (isinstance(x[8], tuple) and len(x[8]) == 2), x[1]
