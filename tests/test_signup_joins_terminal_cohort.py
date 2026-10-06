"""New signups join the terminal-next cohort (owner decision 2026-10-05).

The cohort is named only in rollout_gate (tests/test_terminal_next_kill_switch.py), so
signup calls rollout_gate.enroll_in_terminal_next; the kill switch still decides what a
member sees."""
from unittest.mock import patch


def test_signup_enrolls_through_the_gate():
    from api.routers import auth
    src = open(auth.__file__, encoding="utf-8").read()
    body = src[src.index("def signup("):src.index('@router.post("/login")')]
    assert 'rollout_gate.enroll_in_terminal_next(user["id"])' in body
    # and a cohort write failure can never fail a signup
    i = body.index("enroll_in_terminal_next")
    assert "try:" in body[max(0, i - 200):i] and "except Exception" in body[i:i + 200]


def test_enroll_assigns_the_terminal_next_cohort():
    from api.services import rollout_gate
    with patch("api.services.rollout.assign_cohort") as assign:
        rollout_gate.enroll_in_terminal_next("u-1")
    assign.assert_called_once_with("terminal-next", ["u-1"])
    assert rollout_gate.TERMINAL_NEXT_COHORT == "terminal-next"
