import pytest
from api.services import source_circuit_breaker as scb


@pytest.fixture(autouse=True)
def reset_state():
    scb._reset()
    yield
    scb._reset()


def test_initial_state_ok():
    assert scb.is_ok("massive") is True
    assert scb.state("massive") == "ok"


def test_records_pass_and_fail():
    scb.record_attempt("massive", success=True)
    scb.record_attempt("massive", success=True)
    scb.record_attempt("massive", success=False)
    rate = scb.pass_rate("massive")
    assert abs(rate - 0.667) < 0.01


def test_transitions_to_degraded_below_95_pct():
    """20+ attempts with <95% pass rate -> degraded."""
    for _ in range(20):
        scb.record_attempt("massive", success=True)
    for _ in range(2):
        scb.record_attempt("massive", success=False)
    # 20/22 = 90.9% < 95%
    assert scb.state("massive") == "degraded"
    assert scb.is_ok("massive") is False


def test_recovers_after_clean_window():
    """After degraded, fresh window of clean attempts -> ok."""
    for _ in range(20):
        scb.record_attempt("massive", success=False)
    assert scb.state("massive") == "degraded"
    scb._reset_source("massive")  # simulate window roll
    for _ in range(20):
        scb.record_attempt("massive", success=True)
    assert scb.state("massive") == "ok"


def test_minimum_attempts_threshold():
    """3 attempts not enough to declare degraded -- need at least 20 for confidence."""
    for _ in range(3):
        scb.record_attempt("massive", success=False)
    assert scb.state("massive") == "ok"  # not enough signal


def test_all_states_returns_per_source_dict():
    scb.record_attempt("massive", success=True)
    scb.record_attempt("fmp", success=True)
    scb.record_attempt("fmp", success=False)
    states = scb.all_states()
    assert "massive" in states
    assert "fmp" in states
    assert states["massive"]["state"] == "ok"
    assert states["fmp"]["pass_rate"] == 0.5
