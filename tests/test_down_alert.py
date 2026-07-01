"""Unit tests for the worker down-alert state machine (2026-07-01)."""

from api.worker_main import _down_alert_decision


def _fresh():
    return {"fails": 0, "down": False, "last_alert_at": None}


def test_single_blip_does_not_alert():
    st = _fresh()
    st, ev = _down_alert_decision(st, ok=False, now=1000, down_after=2)
    assert ev is None and st["down"] is False and st["fails"] == 1


def test_alerts_down_after_two_consecutive_fails():
    st = _fresh()
    st, ev = _down_alert_decision(st, ok=False, now=1000, down_after=2)
    assert ev is None
    st, ev = _down_alert_decision(st, ok=False, now=1060, down_after=2)
    assert ev == "down" and st["down"] is True and st["last_alert_at"] == 1060


def test_no_repeat_down_before_renag_then_still_down_after():
    st = _fresh()
    _down_alert_decision(st, ok=False, now=1000, down_after=2)  # (ignored, use returns)
    st, _ = _down_alert_decision(st, ok=False, now=1000, down_after=2)
    st, ev = _down_alert_decision(st, ok=False, now=1060, down_after=2)
    assert ev == "down"
    # still down, but before the renag window → no event
    st, ev = _down_alert_decision(st, ok=False, now=1200, down_after=2, renag_s=1800)
    assert ev is None and st["down"] is True
    # past the renag window → nag again
    st, ev = _down_alert_decision(st, ok=False, now=1060 + 1801, down_after=2, renag_s=1800)
    assert ev == "still_down"


def test_recovery_fires_up_and_resets():
    st = {"fails": 5, "down": True, "last_alert_at": 500}
    st, ev = _down_alert_decision(st, ok=True, now=2000, down_after=2)
    assert ev == "up" and st["down"] is False and st["fails"] == 0


def test_success_resets_fail_counter_without_alerting():
    st = {"fails": 1, "down": False, "last_alert_at": None}
    st, ev = _down_alert_decision(st, ok=True, now=1000, down_after=2)
    assert ev is None and st["fails"] == 0 and st["down"] is False
