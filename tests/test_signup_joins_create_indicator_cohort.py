"""New signups join the create-indicator cohort (owner decision 2026-11-15: Create
Indicator is open to every account).

The cohort is named only in rollout_gate, so signup calls
rollout_gate.enroll_in_create_indicator; the kill switch still decides what is shown."""
from unittest.mock import patch


def test_signup_enrolls_through_the_gate():
    from api.routers import auth
    src = open(auth.__file__, encoding="utf-8").read()
    body = src[src.index("def signup("):src.index('@router.post("/login")')]
    assert 'rollout_gate.enroll_in_create_indicator(user["id"])' in body
    # and a cohort write failure can never fail a signup
    i = body.index("enroll_in_create_indicator")
    assert "try:" in body[max(0, i - 200):i] and "except Exception" in body[i:i + 200]
    # control: the probe can see the sibling enrolment it is not looking for
    assert 'rollout_gate.enroll_in_terminal_next(user["id"])' in body


def test_enroll_assigns_the_create_indicator_cohort():
    from api.services import rollout_gate
    with patch("api.services.rollout.assign_cohort") as assign:
        rollout_gate.enroll_in_create_indicator("u-1")
    assign.assert_called_once_with("create-indicator", ["u-1"])
    assert rollout_gate.CREATE_INDICATOR_COHORT == "create-indicator"


def test_enrolment_alone_shows_nothing_while_the_flag_is_off(monkeypatch):
    """Membership is a write; the kill switch is read first and decides."""
    from api.services import rollout_gate
    monkeypatch.delenv(rollout_gate.CREATE_INDICATOR_FLAG_ENV, raising=False)
    with patch("api.services.rollout.includes", return_value=True) as inc:
        assert rollout_gate.create_indicator_enabled_for("u-1") is False
        inc.assert_not_called()
        monkeypatch.setenv(rollout_gate.CREATE_INDICATOR_FLAG_ENV, "1")
        assert rollout_gate.create_indicator_enabled_for("u-1") is True
