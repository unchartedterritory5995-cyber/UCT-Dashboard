"""Market Cap V1 currentness: two clocks, four states, computed at read time against the NYSE calendar."""
from __future__ import annotations

from datetime import datetime, timezone

from api.services.marketcap import currentness as CU


def man(latest, cutoff, bid="MCAP_V1-20261002T050000Z"):
    return {"build_id": bid, "knowledge": {"latest_valued_session": latest, "filing_knowledge_cutoff": cutoff},
            "build": {"finished_at": "x"}}


def at(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def test_expected_session_respects_due_time_weekends_and_holidays():
    assert CU.expected_session(at("2026-10-02T09:00:00-04:00")).isoformat() == "2026-10-01"     # Fri 09:00: Thu due
    assert CU.expected_session(at("2026-10-02T05:00:00-04:00")).isoformat() == "2026-09-30"     # before 06:00 ET
    assert CU.expected_session(at("2026-10-05T09:00:00-04:00")).isoformat() == "2026-10-02"     # Mon: Fri's session
    assert CU.expected_session(at("2026-11-27T09:00:00-05:00")).isoformat() == "2026-11-25"     # day after Thanksgiving


def test_current():
    c = CU.evaluate(man("2026-10-01", "2026-10-02T04:00:00Z"), now=at("2026-10-02T09:00:00-04:00"))
    assert c["state"] == "CURRENT" and c["lag_sessions"] == 0


def test_weekend_is_still_current():
    c = CU.evaluate(man("2026-10-02", "2026-10-03T04:00:00Z"), now=at("2026-10-04T12:00:00-04:00"))
    assert c["state"] == "CURRENT"


def test_one_session_behind_inside_grace_is_degraded():
    c = CU.evaluate(man("2026-09-30", "2026-10-01T04:00:00Z"), now=at("2026-10-02T08:00:00-04:00"))
    assert c["state"] == "DEGRADED_UPSTREAM_LATE" and c["lag_sessions"] == 1


def test_one_session_behind_past_grace_is_stale():
    c = CU.evaluate(man("2026-09-30", "2026-10-01T04:00:00Z"), now=at("2026-10-02T15:00:00-04:00"))
    assert c["state"] == "STALE"


def test_running_refresh_keeps_degraded_past_grace():
    c = CU.evaluate(man("2026-09-30", "2026-10-01T04:00:00Z"), heartbeat={"in_progress": True, "at": "2026-10-02T17:30:00Z"},
                    now=at("2026-10-02T15:00:00-04:00"))
    assert c["state"] == "DEGRADED_UPSTREAM_LATE"


def test_a_dead_runs_heartbeat_excuses_nothing():
    # a deploy killed the run: status.json still says in_progress, but it has not moved for > 6.5 h (or has no time)
    for hb in ({"in_progress": True, "at": "2026-10-02T05:20:00Z"}, {"in_progress": True}):
        c = CU.evaluate(man("2026-09-30", "2026-10-01T04:00:00Z"), heartbeat=hb, now=at("2026-10-02T15:00:00-04:00"))
        assert c["state"] == "STALE"


def test_failed_refresh_after_due_is_build_failed_and_old_authority_named():
    hb = {"in_progress": False, "last_run": {"run_id": "r1", "state": "FAILED", "stage": "gates",
                                              "finished_at": "2026-10-02T07:00:00Z", "error": "gates failed: ['C']"}}
    c = CU.evaluate(man("2026-09-30", "2026-10-01T04:00:00Z"), heartbeat=hb, now=at("2026-10-02T09:00:00-04:00"))
    assert c["state"] == "BUILD_FAILED" and c["authority_build_id"] == "MCAP_V1-20261002T050000Z"
    assert any("FAILED" in r for r in c["reasons"])


def test_prolonged_staleness_keeps_counting_sessions():
    c = CU.evaluate(man("2026-09-22", "2026-09-23T04:00:00Z"), now=at("2026-10-02T09:00:00-04:00"))
    assert c["state"] == "STALE" and c["lag_sessions"] == 7


def test_filing_clock_behind_is_not_current():
    c = CU.evaluate(man("2026-10-01", "2026-09-29T04:00:00Z"), now=at("2026-10-02T09:00:00-04:00"))
    assert c["state"] != "CURRENT" and any("filing clock" in r for r in c["reasons"])
