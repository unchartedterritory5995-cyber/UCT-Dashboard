"""Readiness gate — the fix for the 2026-07-26 "app is slow all day" report.

Railway switches live traffic the moment the healthcheck passes. `/api/health`
returns 200 as soon as uvicorn binds, which is 20-120s BEFORE the staggered warm
threads fill the caches (dashboard tiles T+20s, chart hot-tier T+45s, RS
rankings T+120s). With 40 deploys in one day that produced 40 windows where real
users hit a pod with empty caches and paid the 3-5s / ~17s cold recomputes.

These tests pin the readiness gate that holds traffic on the OLD pod until the
new one is actually warm.
"""
import pytest

from api.services.readiness import Readiness


class FakeClock:
    """Hand-cranked monotonic clock so deadline behavior is deterministic."""

    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def test_not_ready_while_a_registered_gate_is_outstanding():
    r = Readiness(deadline_seconds=240.0, clock=FakeClock())
    r.register("dashboard")
    assert r.is_ready() is False


def test_ready_once_every_gate_completes():
    r = Readiness(deadline_seconds=240.0, clock=FakeClock())
    r.register("dashboard")
    r.register("hot_tier")
    r.mark_done("dashboard")
    assert r.is_ready() is False, "still one gate outstanding"
    r.mark_done("hot_tier")
    assert r.is_ready() is True


def test_ready_when_nothing_registered():
    """Worker + flow-worker register no gates — they must be instantly ready."""
    r = Readiness(deadline_seconds=240.0, clock=FakeClock())
    assert r.is_ready() is True


def test_deadline_forces_ready_so_a_stuck_warmer_cannot_fail_the_deploy():
    clock = FakeClock()
    r = Readiness(deadline_seconds=240.0, clock=clock)
    r.register("dashboard")
    clock.advance(239.0)
    assert r.is_ready() is False, "inside the deadline, still gated"
    clock.advance(2.0)
    assert r.is_ready() is True, "past the deadline the gate must release"


def test_marking_an_unregistered_gate_is_harmless():
    r = Readiness(deadline_seconds=240.0, clock=FakeClock())
    r.mark_done("never_registered")
    assert r.is_ready() is True


def test_snapshot_reports_outstanding_gates_and_elapsed():
    clock = FakeClock()
    r = Readiness(deadline_seconds=240.0, clock=clock)
    r.register("dashboard")
    r.register("hot_tier")
    r.mark_done("dashboard")
    clock.advance(30.0)

    snap = r.snapshot()
    assert snap["ready"] is False
    assert snap["pending"] == ["hot_tier"]
    assert snap["done"] == ["dashboard"]
    assert snap["elapsed_seconds"] == 30
    assert snap["deadline_seconds"] == 240
    assert snap["deadline_exceeded"] is False


def test_snapshot_flags_a_deadline_release_so_it_is_visible_not_silent():
    """A deploy that goes live still-cold must be observable, not silent."""
    clock = FakeClock()
    r = Readiness(deadline_seconds=240.0, clock=clock)
    r.register("rs_rankings")
    clock.advance(300.0)

    snap = r.snapshot()
    assert snap["ready"] is True
    assert snap["deadline_exceeded"] is True
    assert snap["pending"] == ["rs_rankings"], "must still name what never warmed"


def test_gate_context_manager_marks_done_even_when_the_warmer_raises():
    """Warmers are best-effort. A CRASHED warmer must not hold traffic hostage
    for the full deadline — it has attempted, so its gate is finished."""
    r = Readiness(deadline_seconds=240.0, clock=FakeClock())
    r.register("dashboard")

    with pytest.raises(ValueError):
        with r.gate("dashboard"):
            raise ValueError("warmer blew up")

    assert r.is_ready() is True
