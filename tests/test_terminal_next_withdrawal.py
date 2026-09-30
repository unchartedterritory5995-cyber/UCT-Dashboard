"""The MVP trial's withdrawal block + NOW-gate clause 4 ("Rung 0 watched to kill").

While TERMINAL_NEXT_ENABLED is off, a user TAGGED into the terminal-next cohort is told so
(`cohorts_withdrawn`), and the Breadth drill hides its chart for them. Members are never tagged
and never pay a tag read on the auth path. (api/services/rollout_gate.py::withdrawn_cohorts)
"""
from __future__ import annotations

import pytest

from api.routers import auth
from api.services import rollout_gate as rg

TAGGED = "u-ravi"


@pytest.fixture
def tags(monkeypatch):
    calls = []
    from api.services import rollout

    def includes(uid, cohort):
        calls.append((uid, cohort))
        return uid == TAGGED and cohort == rg.TERMINAL_NEXT_COHORT

    monkeypatch.setattr(rollout, "includes", includes)
    return calls


def test_tagged_and_switched_off_is_withdrawn(monkeypatch, tags):
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    assert rg.withdrawn_cohorts(TAGGED) == [rg.TERMINAL_NEXT_COHORT]


def test_tagged_and_switched_on_is_not_withdrawn(monkeypatch, tags):
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    assert rg.withdrawn_cohorts(TAGGED) == []
    assert rg.client_cohorts(TAGGED) == [rg.TERMINAL_NEXT_COHORT]      # the ON state, for contrast


def test_untagged_or_anonymous_is_never_withdrawn(monkeypatch, tags):
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    assert rg.withdrawn_cohorts("u-someone-else") == []
    assert rg.withdrawn_cohorts(None) == []


def test_a_failing_lookup_reports_nothing(monkeypatch):
    from api.services import rollout
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")

    def boom(*a):
        raise RuntimeError("auth.db unreadable")

    monkeypatch.setattr(rollout, "includes", boom)
    assert rg.withdrawn_cohorts(TAGGED) == []                           # the surface stays as it is


def test_a_members_auth_request_gains_no_tag_read(monkeypatch, tags):
    """The universal auth path: with the switch off, a member costs zero tag reads."""
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    out = auth._access_payload({"id": "u-member", "role": "member", "created_at": None}, "pro")
    assert out["cohorts_withdrawn"] == []
    assert tags == []


def test_the_admin_trial_subject_sees_the_withdrawal_on_the_payload(monkeypatch, tags):
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "0")
    out = auth._access_payload({"id": TAGGED, "role": "admin", "created_at": None}, "pro")
    assert out["cohorts_withdrawn"] == [rg.TERMINAL_NEXT_COHORT]
    assert out["cohorts"] == []                                         # the effective list is empty
    monkeypatch.setenv(rg.TERMINAL_NEXT_FLAG_ENV, "1")
    back = auth._access_payload({"id": TAGGED, "role": "admin", "created_at": None}, "pro")
    assert back["cohorts_withdrawn"] == [] and back["cohorts"] == [rg.TERMINAL_NEXT_COHORT]
