"""
liveflow_monitor curated-feed wedge detection (2026-07-28 blind spot).

The monitor's max_id oracle calls HEALTHY exactly when flow.db is live — which
is why a wedged curated feed (flow.db live, /recent empty) went undetected for
55 min. These cover the pure detection + alert state machine that closes it.
"""

from api.services import liveflow_monitor as m


# --- _curated_is_wedged: wedge vs. legit quiet tape -------------------------

def test_not_cached_is_wedged():
    assert m._curated_is_wedged({"cached": False, "alerts": 0}) is True


def test_cached_fresh_empty_is_quiet_tape_not_wedge():
    # A genuinely quiet tape: canonical key cached + freshly refreshed, 0 alerts.
    assert m._curated_is_wedged({"cached": True, "age_sec": 5, "alerts": 0}) is False


def test_cached_but_stale_is_wedged():
    assert m._curated_is_wedged(
        {"cached": True, "age_sec": 999, "alerts": 3}) is True


def test_hung_fill_is_wedged():
    assert m._curated_is_wedged(
        {"cached": True, "age_sec": 5, "alerts": 0, "fill_running_sec": 500}) is True


def test_missing_curated_block_is_not_flagged():
    assert m._curated_is_wedged(None) is False
    assert m._curated_is_wedged({}) is True  # {} has no 'cached' → treated as not-cached


# --- _curated_wedge_decision: confirm / recover / renag ---------------------

def test_confirms_after_threshold_then_recovers():
    s = m.initial_curated_state()
    s, e = m._curated_wedge_decision(s, True, 1000.0, wedge_after=3)
    assert e is None
    s, e = m._curated_wedge_decision(s, True, 1000.0, wedge_after=3)
    assert e is None
    s, e = m._curated_wedge_decision(s, True, 1000.0, wedge_after=3)
    assert e == "curated_wedged" and s["wedged"]
    # First non-wedged poll → recovery.
    s, e = m._curated_wedge_decision(s, False, 1000.0)
    assert e == "curated_recovered" and not s["wedged"]


def test_flap_below_threshold_never_fires():
    s = m.initial_curated_state()
    s, e = m._curated_wedge_decision(s, True, 1.0, wedge_after=3)
    assert e is None
    s, e = m._curated_wedge_decision(s, False, 2.0, wedge_after=3)   # resets the count
    assert e is None
    s, e = m._curated_wedge_decision(s, True, 3.0, wedge_after=3)
    assert e is None and not s["wedged"]


def test_renags_after_interval_while_wedged():
    s = m.initial_curated_state()
    for _ in range(3):
        s, e = m._curated_wedge_decision(s, True, 1000.0, wedge_after=3, renag_s=1800)
    assert e == "curated_wedged"
    s, e = m._curated_wedge_decision(s, True, 1000.0 + 100, wedge_after=3, renag_s=1800)
    assert e is None                                    # too soon to renag
    s, e = m._curated_wedge_decision(s, True, 1000.0 + 1801, wedge_after=3, renag_s=1800)
    assert e == "curated_still"


def test_alert_texts_render():
    cur = {"cached": False, "age_sec": None, "alerts": 0}
    assert "WEDGED" in m._curated_alert_text("curated_wedged", cur, 1000.0, 1030.0)
    assert "STILL" in m._curated_alert_text("curated_still", cur, 1000.0, 2200.0)
    assert "recovered" in m._curated_alert_text("curated_recovered", {"alerts": 5}, 1000.0, 1600.0)
