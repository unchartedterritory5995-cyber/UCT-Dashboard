"""New signups join the terminal-next cohort (owner decision 2026-10-05)."""
from unittest.mock import patch


def test_signup_assigns_terminal_cohort():
    from api.routers import auth
    from api.services.rollout_gate import TERMINAL_NEXT_COHORT
    src = open(auth.__file__, encoding="utf-8").read()
    body = src[src.index("def signup("):src.index('@router.post("/login")')]
    assert "rollout.assign_cohort(TERMINAL_NEXT_COHORT, [user[\"id\"]])" in body
    assert TERMINAL_NEXT_COHORT == "terminal-next"
