"""The roll ledger must name who held the build slot when a version was sighted.

`handoff_ms` (detector sighting -> pass 1 start) measured ≤2 ms on 22 of 25 prod
rolls and 4,429 / 8,188 / 15,190 ms on the other three. The ledger could not say
why: it recorded when a version was seen and how long its own build took, never
who was occupying `_PREPARE_INFLIGHT` at the moment of sighting. That semaphore is
the only thing in the dispatch path that can delay a build, and it is held across
BOTH passes.
"""
from __future__ import annotations

import pytest

from api import flow_router as fr


@pytest.fixture(autouse=True)
def _clean():
    fr._VERSION_FIRST_SEEN.clear()
    fr._VERSION_BLOCKED_BY.clear()
    fr._PREPARE_ROLLS.clear()
    fr._INFLIGHT_HOLDER.update({"version": None, "since": None, "pass": None})
    yield
    fr._INFLIGHT_HOLDER.update({"version": None, "since": None, "pass": None})


def _last():
    return fr._PREPARE_ROLLS[-1]


def test_a_version_sighted_while_a_build_holds_the_slot_names_the_holder():
    import time
    fr._INFLIGHT_HOLDER.update({"version": 100, "since": time.time() - 7.0, "pass": 2})

    fr._note_version_seen(101)
    fr._record_roll(101, prepare_ms=5000, pass2_skipped=False)

    r = _last()
    assert r["blocked_by"] == 100
    assert r["blocked_pass"] == 2
    assert 6500 <= r["blocked_held_ms"] <= 7500


def test_a_version_sighted_with_the_slot_free_records_no_blame():
    """CONTROL: without this, a field that is always populated looks informative
    and explains nothing — 22 of 25 rolls really are unblocked."""
    fr._note_version_seen(201)
    fr._record_roll(201, prepare_ms=5000, pass2_skipped=False)

    r = _last()
    assert r["blocked_by"] is None
    assert r["blocked_pass"] is None
    assert r["blocked_held_ms"] is None


def test_the_holder_is_snapshotted_AT_SIGHTING_not_at_record_time():
    """⛔ THE WHOLE POINT. By the time a roll is recorded, the slot is held by
    THAT roll — reading the holder late would make every roll blame itself and
    the field would be unfalsifiable."""
    import time
    fr._INFLIGHT_HOLDER.update({"version": 300, "since": time.time() - 3.0, "pass": 1})
    fr._note_version_seen(301)

    # the blocking build finishes and 301's own build takes the slot
    fr._INFLIGHT_HOLDER.update({"version": 301, "since": time.time(), "pass": 1})
    fr._record_roll(301, prepare_ms=5000, pass2_skipped=False)

    assert _last()["blocked_by"] == 300, "the holder was read at record time, not at sighting"


def test_a_roll_that_holds_the_slot_itself_is_not_blamed_on_itself():
    import time
    fr._INFLIGHT_HOLDER.update({"version": 400, "since": time.time(), "pass": 1})
    fr._note_version_seen(400)
    fr._record_roll(400, prepare_ms=5000, pass2_skipped=False)

    assert _last()["blocked_by"] is None
