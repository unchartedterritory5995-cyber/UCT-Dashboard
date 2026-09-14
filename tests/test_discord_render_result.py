"""The adapter Result envelope (step 2.4b P2.1, 03 §3.8).

The properties that matter, and each one is a defect this repo has already paid for:

  * a failure is a VALUE with a NAMED class — C-08 was one `except` turning four causes into one
    sentence that was wrong for three of them;
  * `stale` is three-valued, and UNKNOWN is not FRESH;
  * the vintage stamp has ONE authority — the envelope — so a log line can never say
    `degraded=stale` beside `stale=False`;
  * `data` never reaches a log line.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services.discord_render import freshness as fr
from api.services.discord_render.adapters import result as R

NOW = dt.datetime(2026, 9, 13, 11, 0, tzinfo=fr.ET)          # a Saturday morning, market shut


def _env(as_of, tf="D"):
    return fr.envelope(as_of, tf=tf, provider="bars_store", now=NOW)


FRESH = _env("2026-09-11 16:00:00")      # Friday's close — the session we should hold
OLD = _env("2026-09-04 16:00:00")        # a week behind
UNKNOWN = _env(None)                     # no vintage at all


def test_the_fixtures_are_what_this_file_claims_they_are():
    """⛔ A NON-VACUITY CONTROL. Every case below is scored against these three envelopes; if the
    market clock moved under them, the assertions would still pass while measuring nothing."""
    assert FRESH.stale is False and OLD.stale is True and UNKNOWN.stale is None
    assert FRESH.session_state == fr.WEEKEND, "the whole file assumes a closed market"


# ── a failure is a value, and it is named ───────────────────────────────────

def test_a_failure_is_a_returned_value_carrying_a_named_class():
    r = R.fail(R.TIMEOUT, provider="renderer", corr_id="abcd1234", elapsed_ms=20000.0)
    assert r.ok is False and r.data is None
    assert r.reason() == R.TIMEOUT and r.degraded is True
    assert r.corr_id == "abcd1234"


def test_an_unnamed_failure_is_refused():
    """⛔ There is no free-text failure. A class nobody can count is a class nobody fixes, and §3.5
    has no copy for it — the member would get a generic apology, which is C-08 restored."""
    with pytest.raises(ValueError, match="taxonomy"):
        R.fail("the flow feed is reconnecting")


def test_every_taxonomy_member_is_usable_and_the_fatal_set_is_a_strict_subset():
    for reason in sorted(R.ALL_REASONS - {R.STALE}):
        r = R.fail(reason) if reason in R.FATAL_REASONS else R.ok(1, provider="p", reasons=(reason,))
        assert reason in r.degraded_reasons
    assert R.FATAL_REASONS < R.ALL_REASONS
    assert R.STALE not in R.FATAL_REASONS and R.CACHED not in R.FATAL_REASONS, (
        "a labelled stand-in is a DELIVERY (S8); counting it as a failure hides a renderer outage "
        "inside a green success rate")


def test_a_success_cannot_carry_a_fatal_class():
    with pytest.raises(ValueError, match="fatal"):
        R.ok({"bars": []}, provider="bars_store", reasons=(R.TIMEOUT,))


# ── the vintage has exactly one authority ───────────────────────────────────

def test_stale_is_derived_from_the_envelope_and_never_passed_in():
    served = R.ok(1, provider="bars_store", envelope=OLD)
    assert served.stale is True and R.STALE in served.degraded_reasons
    assert served.degraded is True, "served, but not at house quality"


def test_a_stale_label_that_contradicts_the_stamp_is_refused():
    """⚰️ The first smoke run of this module logged `degraded=stale` beside `stale=False`. Two
    authorities over one value, disagreeing inside a single event line."""
    with pytest.raises(ValueError, match="single authority"):
        R.ok(1, provider="p", envelope=FRESH, reasons=(R.STALE,))


def test_a_fresh_payload_carries_no_stale_label_and_no_badge():
    r = R.ok(1, provider="bars_store", envelope=FRESH)
    assert r.stale is False and r.degraded_reasons == () and r.badge is None


def test_unknown_vintage_is_none_and_is_not_false():
    """⛔ A caller that renders None as 'fine' is the bug the three-valued verdict exists to stop."""
    r = R.ok(1, provider="p", envelope=UNKNOWN)
    assert r.stale is None and r.stale is not False
    assert r.badge is None, "absent, not reassuring"
    assert R.STALE not in r.degraded_reasons


def test_no_envelope_at_all_reports_nothing_rather_than_guessing():
    r = R.ok(1, provider="p")
    assert r.stale is None and r.as_of is None and r.session is None and r.vintage is None


def test_the_derived_fields_track_the_envelope_exactly():
    r = R.ok(1, provider="p", envelope=OLD)
    assert r.as_of == OLD.as_of_utc and r.as_of_et == OLD.as_of_et
    assert r.session == OLD.session_state and r.vintage == OLD.as_dict()
    assert r.badge == OLD.badge


# ── the event line ──────────────────────────────────────────────────────────

def test_the_event_never_carries_the_payload():
    """⛔ `data` is bars, a PNG, or a flow card. A log line is not where any of those belong."""
    ev = R.ok({"bars": [{"c": 1}] * 500}, provider="bars_store", envelope=FRESH, corr_id="x").as_event()
    assert "data" not in ev
    assert all(not isinstance(v, (list, dict)) for v in ev.values())


def test_an_unknown_vintage_logs_as_unknown_rather_than_vanishing():
    """⛔ The None-filter would DROP a three-valued None, and an absent field reads to an operator as
    'nothing to report' — the opposite of an unestablished vintage."""
    assert R.ok(1, provider="p", envelope=UNKNOWN).as_event()["stale"] == "unknown"
    assert R.ok(1, provider="p", envelope=FRESH).as_event()["stale"] is False
    assert "stale" not in R.fail(R.TIMEOUT).as_event(), "no envelope: nothing was measured"


def test_meta_reaches_the_event_without_overwriting_the_contract():
    ev = R.fail(R.TIMEOUT, provider="renderer", attempts=2, path="/r/chart").as_event()
    assert ev["attempts"] == 2 and ev["path"] == "/r/chart"
    ev2 = R.fail(R.TIMEOUT, provider="renderer", ok="spoofed", provider_meta="x").as_event()
    assert ev2["ok"] is False, "meta must never overwrite a contract field"


# ── composition ─────────────────────────────────────────────────────────────

def test_reasons_compose_in_order_without_duplicating():
    r = R.fail(R.BREAKER_OPEN, provider="flow").with_reason(R.CACHED).with_reason(R.CACHED)
    assert r.degraded_reasons == (R.BREAKER_OPEN, R.CACHED)
    assert r.reason() == R.BREAKER_OPEN, "the FIRST class is the cause; the rest followed from it"


def test_with_reason_refuses_a_class_outside_the_taxonomy():
    with pytest.raises(ValueError, match="taxonomy"):
        R.fail(R.TIMEOUT).with_reason("something went wrong")


def test_a_result_is_frozen():
    """A Result is a record of what happened; a caller that can edit it can make the record lie."""
    r = R.ok(1, provider="p", envelope=FRESH)
    with pytest.raises(Exception):
        r.ok = False                                      # type: ignore[misc]


def test_with_reason_returns_a_copy_and_leaves_the_original_alone():
    first = R.fail(R.TIMEOUT, provider="renderer")
    second = first.with_reason(R.CACHED)
    assert first.degraded_reasons == (R.TIMEOUT,) and second is not first
