"""The morning-wire missed-run watchdog must be able to FIRE.

⚰️⚰️ THE DEFECT THIS RAIL EXISTS FOR. `register_wire_watchdog_job` ran at 09:05 ET
and tested `wire_date < expected`, where `expected` comes from
`engine.expected_wire_date()` — which rolls back one day while the clock is
before 09:30 ET. So at 09:05 `expected` was YESTERDAY, a wire that missed this
morning is dated yesterday, and `yesterday < yesterday` is False. The alert never
fired for a one-run miss, and since the job runs once it never fired later that
day either. It could only fire at TWO days stale, while the member-facing
freshness badge read "fresh" until 09:30 for the same reason.

⭐ WHY THE SCHEDULED MINUTE IS THE THING UNDER TEST. The fix was to re-time the
job past 09:30 rather than change `expected_wire_date`, which is deliberately ONE
COPY shared with /api/leadership, the breadth payload and the exposure payload.
That makes the cron minute load-bearing — a value someone could "tidy" back to
09:05 without any test noticing. So this rail DERIVES the hour and minute from
`api/main.py` by AST rather than restating them, and asserts the consequence.

⛔ AND IT CARRIES A CONTROL THAT PINS THE OLD BEHAVIOUR (`test_..._at_0905_...`).
A rail that only asserts the fixed case passes just as happily against a
tautology. The control proves this test can DISTINGUISH 09:05 from 09:35, which
is the whole claim; if it ever goes green alongside the others, the rail has
stopped measuring anything.
"""
from __future__ import annotations

import ast
import contextlib
import datetime as dtmod
import os
import re

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(REPO, "api", "main.py")
JOB_ID = "wire_freshness_watchdog"


def _scheduled_hour_minute() -> tuple[int, int]:
    """Read the watchdog's cron hour/minute out of api/main.py by AST.

    ⛔ AST, never a regex over the whole file: `minute=5` and `hour=9` appear on
    many other triggers in this module (a grep finds a dozen), so a textual match
    would happily read some other job's schedule and report it as this one's.
    """
    with open(MAIN, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = getattr(node, "func", None)
        if not (isinstance(func, ast.Attribute) and func.attr == "add_job"):
            continue
        kw = {k.arg: k.value for k in node.keywords if k.arg}
        ident = kw.get("id")
        if not (isinstance(ident, ast.Constant) and ident.value == JOB_ID):
            continue
        trigger = kw.get("trigger")
        assert isinstance(trigger, ast.Call), f"{JOB_ID}: trigger is not a call"
        tkw = {k.arg: k.value for k in trigger.keywords if k.arg}
        hour, minute = tkw.get("hour"), tkw.get("minute")
        assert isinstance(hour, ast.Constant) and isinstance(minute, ast.Constant), (
            f"{JOB_ID}: hour/minute are not literals — this rail can only read "
            f"literals, so make them literal or teach the rail the new shape")
        return int(hour.value), int(minute.value)

    raise AssertionError(
        f"NON-VACUITY FAILURE: no add_job(id={JOB_ID!r}) found in {MAIN}. An empty "
        f"search satisfies every assertion below, so this is a broken rail, not a "
        f"passing one.")


@contextlib.contextmanager
def _frozen_et(year: int, month: int, day: int, hour: int, minute: int):
    """Freeze `datetime.datetime.now()` at a given ET wall-clock instant.

    `expected_wire_date` does `from datetime import datetime as _dt` INSIDE the
    function body, so it resolves the name at call time and this patch reaches
    it. Scoped tightly and restored in `finally` because it patches a stdlib
    attribute process-wide.
    """
    from zoneinfo import ZoneInfo

    target = dtmod.datetime(year, month, day, hour, minute,
                            tzinfo=ZoneInfo("America/New_York"))

    class _FrozenDateTime(dtmod.datetime):
        @classmethod
        def now(cls, tz=None):
            return target

    original = dtmod.datetime
    dtmod.datetime = _FrozenDateTime
    try:
        yield target
    finally:
        dtmod.datetime = original


# 2026-09-28 is a MONDAY, so "yesterday" rolls back across a weekend to Friday
# the 25th — which is the harder case and the one a naive fix gets wrong.
_MONDAY = (2026, 9, 28)
_PREVIOUS_TRADING_DAY = "2026-09-25"


def test_the_watchdog_is_scheduled_after_the_0930_rollback_boundary():
    """The load-bearing assertion: the minute must sit past the rollback."""
    hour, minute = _scheduled_hour_minute()
    assert (hour, minute) >= (9, 30), (
        f"the watchdog is scheduled at {hour:02d}:{minute:02d} ET, which is BEFORE "
        f"expected_wire_date()'s 09:30 rollback — at that time `expected` is "
        f"yesterday, so a one-run miss compares yesterday < yesterday and the "
        f"alert cannot fire. This is the exact defect the job was written to catch.")


def test_expected_wire_date_returns_TODAY_at_the_scheduled_time():
    """At the scheduled minute the expectation must be today, not yesterday."""
    from api.services.engine import expected_wire_date

    hour, minute = _scheduled_hour_minute()
    with _frozen_et(*_MONDAY, hour, minute) as now:
        assert expected_wire_date() == now.date(), (
            "at the scheduled time expected_wire_date() still rolled back — the "
            "comparison in the watchdog cannot distinguish a missed run")


def test_the_comparison_FIRES_for_a_one_day_stale_payload():
    """The consequence, stated the way the watchdog states it."""
    from api.services.engine import expected_wire_date

    hour, minute = _scheduled_hour_minute()
    with _frozen_et(*_MONDAY, hour, minute):
        expected = expected_wire_date().isoformat()
        assert _PREVIOUS_TRADING_DAY < expected, (
            f"a payload dated {_PREVIOUS_TRADING_DAY} did not read as stale against "
            f"expected={expected}; the watchdog would stay silent through a missed run")


def test_the_member_badge_also_reads_STALE_at_the_scheduled_time():
    """Same root cause, the half members actually see."""
    from api.services.engine import wire_freshness

    hour, minute = _scheduled_hour_minute()
    with _frozen_et(*_MONDAY, hour, minute):
        assert wire_freshness(_PREVIOUS_TRADING_DAY) == "stale"


def test_CONTROL_at_0905_the_comparison_could_not_fire():
    """⛔ THE CONTROL. Proves this rail can distinguish 09:05 from 09:35.

    If this test ever FAILS, the 09:30 rollback in `expected_wire_date` has
    changed and the other assertions here are no longer measuring what they
    claim — re-derive the boundary before trusting them.
    """
    from api.services.engine import expected_wire_date

    with _frozen_et(*_MONDAY, 9, 5):
        expected = expected_wire_date().isoformat()
        assert _PREVIOUS_TRADING_DAY == expected, (
            "the 09:05 rollback no longer produces the previous trading day — the "
            "premise of this rail has moved")
        assert not (_PREVIOUS_TRADING_DAY < expected), (
            "at 09:05 the comparison unexpectedly fired; the documented defect is "
            "gone by some other route, so this control is stale")


def test_the_docstring_and_the_schedule_AGREE():
    """⛔ The original defect was half a DOC defect: the docstring said it fires
    on "a pre-today date" while at 09:05 a pre-today date was the expected state.
    A reader believes the docstring, so pin them together."""
    with open(MAIN, encoding="utf-8") as fh:
        src = fh.read()
    start = src.index("def register_wire_watchdog_job")
    body = src[start:start + 4000]
    hour, minute = _scheduled_hour_minute()
    stamp = f"{hour}:{minute:02d}"

    # ⛔ MATCH THE CLAIM SENTENCE, NOT THE WHOLE DOCSTRING. The first version of
    # this test asserted `stamp in body` and could NOT FAIL: the docstring
    # deliberately recounts the old 09:05 defect, so both values appear in the
    # body and the mutation (minute 35 -> 5) left it green while four sibling
    # assertions went red. A fixture that cannot distinguish is not a rail.
    claim = re.search(r"runs on Railway at (\d{1,2}:\d{2}) AM ET", body)
    assert claim, ("the docstring no longer states its schedule in the form "
                   "'runs on Railway at H:MM AM ET' — restore it or teach this "
                   "rail the new wording; the pairing is the point")
    assert claim.group(1) == stamp, (
        f"the docstring says it runs at {claim.group(1)} ET but the trigger is set "
        f"to {stamp} ET. A reader believes the docstring — and a docstring that "
        f"disagreed with the comparison is half of how the 09:05 defect survived.")
