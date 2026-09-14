"""F-S7-TICK-1's regression guard, asserted at the CALLER — not at the predicate.

⚰️ **WHY THE CALLER AND NOT THE PREDICATE.** The syntactic sweep that looked for this defect
class (`tools/audit_absent_bound.py`) found **30** sites matching the shape and hand-triage
found **zero** defects: `X is not None and …` is the ordinary optional-guard idiom. What
made F-S7-TICK-1 a defect was never the shape — it was that shape inside a predicate **whose
caller reads "the guard did not fire" as "we are inside the window"**. That property lives at
the caller, so the guard has to live there too.

So these six cases drive `ticking_one()` — the function whose output the Layer 1 monitor
posts to admin Discord at 09:12 ET and the gate check reads at 16:30 — and assert the
DECISION a human acts on: **is this reported as a fault, or as "not yet due"?**

⛔ **THE CLOCK IS INJECTED, NOT MOCKED.** `now=` threads a real `datetime` into `_window`,
whose real logic then runs. Nothing patches the *source* of time, which is the trap
F-CLOCK-1 records: on this box `TZ=America/New_York date` silently returns UTC, so a test
that stubbed a time source would pass against a clock that lies. A fixed instant through a
real predicate cannot.

⛔ Every case uses a sweep with **no heartbeat at all** — the exact state the three sweeps
were in when the report called them dead.
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
_TOOL = pathlib.Path(__file__).resolve().parents[1] / "tools" / "s7_price_level_report.py"


def _load():
    spec = importlib.util.spec_from_file_location("s7rep_caller", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


R = _load()

#: A sweep whose store is empty. `db_path` points nowhere, so `_beat_row` returns None —
#: which is precisely "no heartbeat at all".
NO_STORE = "does-not-exist.db"

#: Three fixed instants. ⭐ Named for what they mean to a person, not for their numbers.
MON_INSIDE_RTH = dt.datetime(2026, 9, 14, 12, 0, tzinfo=ET)
MON_BEFORE_OPEN = dt.datetime(2026, 9, 14, 3, 0, tzinfo=ET)
SUNDAY = dt.datetime(2026, 9, 13, 12, 0, tzinfo=ET)


def _spec(key):
    return [s for s in R.SWEEPS if s[0] == key][0]


def _decide(spec, when):
    """The caller's decision: (is-it-reported-as-a-fault, the text a human reads)."""
    text, code = R.ticking_one(NO_STORE, spec, now=when)
    return code == 1, text


# ── an HOURS-BOUND sweep: the bound is PRESENT ──────────────────────────────

def test_hours_present_inside_the_window_a_silent_sweep_IS_a_fault():
    """⛔ NON-VACUITY FOR THE WHOLE FILE. If this ever stops failing, the guard below
    has silenced real faults and every other case here is passing for free."""
    fault, text = _decide(_spec("price_level"), MON_INSIDE_RTH)
    assert fault is True, text
    assert "no heartbeat at all" in text


def test_hours_present_before_the_open_a_silent_sweep_is_NOT_a_fault():
    fault, text = _decide(_spec("price_level"), MON_BEFORE_OPEN)
    assert fault is False, text
    assert "EXPECTED here, not a fault" in text


def test_hours_present_on_a_sunday_a_silent_sweep_is_NOT_a_fault():
    fault, text = _decide(_spec("price_level"), SUNDAY)
    assert fault is False, text


# ── a FIXED-TIME sweep: the hours bound is ABSENT ───────────────────────────
# This is the F-S7-TICK-1 trio. `hours` is None for all three, because they do not run
# across a range — they fire at named times.

@pytest.mark.parametrize("key", ["event_proximity", "catalyst_match"])
def test_absent_hours_before_the_first_firing_is_NOT_reported_as_a_fault(key):
    """⚰️ THE REGRESSION. On 2026-09-14 at 00:43 ET this reported, for all three:

        NO  -- no heartbeat at all, and it IS inside the window

    with remediation pointing at flags that read '1' in-process and a log line that does
    not exist. Every one of them was healthy and simply had not been scheduled to fire.
    """
    spec = _spec(key)
    assert spec[5] is None, "%s is supposed to have NO hours bound" % key
    fault, text = _decide(spec, dt.datetime(2026, 9, 14, 0, 43, tzinfo=ET))
    assert fault is False, "F-S7-TICK-1 has regressed: %s" % text
    assert "EXPECTED here, not a fault" in text


def test_a_NIGHTLY_sweep_is_always_judgeable_and_that_is_the_OTHER_half_of_the_fix():
    """⛔ `scan_membership` is in the trio but NOT in the case above, and the reason is the
    finding's other half.

    Its cron carries **no day_of_week** — it runs EVERY night at ~05:20 — so its last
    scheduled firing is never more than ~24h back and is always inside its 26h bound.
    Staleness is therefore ALWAYS judgeable, and a silent store IS a fault, including at
    00:43 on a Monday.

    ⭐ The pre-fix code got this WRONG IN THE OPPOSITE DIRECTION: a blanket weekend branch
    returned `n/a (weekend)` for it, so a nightly sweep that died on a Friday was invisible
    until Monday. Its cadence STRING said "weekdays"; its cron disagreed, and the cron wins.
    Declaring the firing times narrowed the false alarms AND widened the real coverage.

    ⚠️ On 2026-09-14 this sweep's live `NO` was still not a real fault — it had been ARMED
    at Sunday 12:00 ET, after that day's 05:20 firing. The tool does not know arm times and
    deliberately does not guess: inventing a grace period would silence a sweep on the
    morning it actually died. That residual is documented, not fixed.
    """
    fault, text = _decide(_spec("scan_membership"), dt.datetime(2026, 9, 14, 0, 43, tzinfo=ET))
    assert fault is True, text
    assert "no heartbeat at all" in text


def test_absent_hours_AFTER_its_firing_a_silent_sweep_IS_a_fault_again():
    """⭐ The other half, and the one that makes the fix a fix rather than a mute.

    `catalyst-match` fires 17:30 ET weekdays. At 17:31 on a Monday a silent store is a
    REAL fault, and the report must say so. A guard that only ever says "not yet due"
    would have closed the false alarm by closing the alarm.
    """
    fault, text = _decide(_spec("catalyst_match"), dt.datetime(2026, 9, 14, 17, 31, tzinfo=ET))
    assert fault is True, text
    assert "no heartbeat at all" in text


def test_the_monday_0912_monitor_post_does_not_alarm_on_catalyst_match():
    """The concrete weekly cost: the Layer 1 monitor posts `ticking` at 09:12 ET, and
    catalyst-match cannot have fired yet (it fires 17:30). Before the fix this alarmed
    EVERY Monday, in a channel the owner reads."""
    fault, _ = _decide(_spec("catalyst_match"), dt.datetime(2026, 9, 14, 9, 12, tzinfo=ET))
    assert fault is False
