"""
Tests for the full-access trial (api/services/trial.py) and its wiring
into the paid-gate chokepoint (api/middleware/auth_middleware.py).

Covered:
  * new user (inside window) → paid-equivalent when J2_TRIAL_ENABLED=1
  * disabled (J2_TRIAL_ENABLED=0) → NOT paid-equivalent
  * past-window unpaid → NOT paid-equivalent
  * real paid plan → always paid-equivalent (even with trial disabled)
  * admin gates are UNAFFECTED by trial (trial never grants admin)
  * defensive defaults (bad/missing input → not-trial, never accidentally-paid)
"""

from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException

from api.services import trial as trial_mod
from api.middleware import auth_middleware


def _user(days_old, **kw):
    """A user dict whose created_at is `days_old` days in the past (UTC)."""
    created = datetime.now(timezone.utc) - timedelta(days=days_old)
    base = {
        "id": "u1",
        "email": "t@example.com",
        "created_at": created.strftime("%Y-%m-%d %H:%M:%S.%f"),
        "role": "member",
    }
    base.update(kw)
    return base


def _pin_cutoff_far_future(monkeypatch):
    """Window-mechanics tests use accounts aged relative to REAL now, which
    inevitably lands after the 2026-07-13 no-card cutover — pin the cutoff far
    in the future so account AGE is the only thing under test."""
    monkeypatch.setenv("J2_TRIAL_NOCARD_CUTOFF", "2099-01-01T00:00:00+00:00")


# ── trial window ─────────────────────────────────────────────────────────────

def test_new_user_in_trial_when_enabled(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    _pin_cutoff_far_future(monkeypatch)
    u = _user(2, plan="free")
    assert trial_mod.is_account_in_trial(u) is True
    st = trial_mod.trial_status(u)
    assert st["active"] is True
    assert 1 <= st["days_left"] <= trial_mod.TRIAL_DAYS


def test_new_user_is_paid_equiv_when_enabled(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    _pin_cutoff_far_future(monkeypatch)
    u = _user(2, plan="free")
    assert trial_mod.is_paid_or_trial(u) is True
    # The backend gate honors it.
    assert auth_middleware.is_paid_user(u) is True


def test_trial_disabled_flag_blocks_it(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "0")
    u = _user(2, plan="free")
    assert trial_mod.is_account_in_trial(u) is False
    assert trial_mod.is_paid_or_trial(u) is False
    assert auth_middleware.is_paid_user(u) is False


def test_old_unpaid_user_not_in_trial(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    u = _user(30, plan="free")
    assert trial_mod.is_account_in_trial(u) is False
    assert trial_mod.is_paid_or_trial(u) is False
    assert auth_middleware.is_paid_user(u) is False


def test_boundary_just_inside_and_outside(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    _pin_cutoff_far_future(monkeypatch)
    assert trial_mod.is_account_in_trial(_user(trial_mod.TRIAL_DAYS - 1)) is True
    assert trial_mod.is_account_in_trial(_user(trial_mod.TRIAL_DAYS + 1)) is False


def test_real_paid_user_always_paid_even_trial_off(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "0")
    u = _user(90, plan="pro")
    assert trial_mod.is_paid_or_trial(u) is True
    assert auth_middleware.is_paid_user(u) is True


def test_lifetime_and_premium_paid(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "0")
    assert auth_middleware.is_paid_user(_user(90, plan="lifetime")) is True
    assert auth_middleware.is_paid_user(_user(90, plan="premium")) is True


# ── no-card cutover (2026-07-13) — post-cutoff accounts trial via Stripe ─────
# Fixed created_at/now dates so these never depend on when the suite runs.

def _dated_user(created_iso, **kw):
    base = {"id": "u1", "email": "t@example.com", "created_at": created_iso, "role": "member"}
    base.update(kw)
    return base


def test_post_cutoff_account_gets_no_card_free_window(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    monkeypatch.delenv("J2_TRIAL_NOCARD_CUTOFF", raising=False)
    u = _dated_user("2026-07-14 09:00:00.000000", plan="free")
    now = datetime(2026, 7, 15, tzinfo=timezone.utc)  # 1 day old — would be in-window
    assert trial_mod.is_account_in_trial(u, now=now) is False
    assert trial_mod.trial_status(u, now=now) == {"active": False, "days_left": 0}


def test_pre_cutoff_account_keeps_its_window(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    monkeypatch.delenv("J2_TRIAL_NOCARD_CUTOFF", raising=False)
    u = _dated_user("2026-07-10 09:00:00.000000", plan="free")
    now = datetime(2026, 7, 12, tzinfo=timezone.utc)  # 2 days old, pre-cutoff signup
    assert trial_mod.is_account_in_trial(u, now=now) is True
    # …and it still lapses normally after TRIAL_DAYS.
    later = datetime(2026, 7, 20, tzinfo=timezone.utc)
    assert trial_mod.is_account_in_trial(u, now=later) is False


def test_account_created_exactly_at_cutoff_excluded(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    monkeypatch.delenv("J2_TRIAL_NOCARD_CUTOFF", raising=False)
    u = _dated_user("2026-07-13 00:00:00.000000", plan="free")
    now = datetime(2026, 7, 13, 1, tzinfo=timezone.utc)
    assert trial_mod.is_account_in_trial(u, now=now) is False


def test_cutoff_env_override(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    monkeypatch.setenv("J2_TRIAL_NOCARD_CUTOFF", "2026-06-01T00:00:00+00:00")
    after = _dated_user("2026-06-02 09:00:00.000000", plan="free")
    now = datetime(2026, 6, 3, tzinfo=timezone.utc)
    assert trial_mod.is_account_in_trial(after, now=now) is False
    before = _dated_user("2026-05-20 09:00:00.000000", plan="free")
    then = datetime(2026, 5, 22, tzinfo=timezone.utc)
    assert trial_mod.is_account_in_trial(before, now=then) is True


def test_cutoff_unparseable_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    monkeypatch.setenv("J2_TRIAL_NOCARD_CUTOFF", "not-a-date")
    # Default (2026-07-13) applies — post-default-cutoff account excluded…
    u = _dated_user("2026-07-14 09:00:00.000000", plan="free")
    assert trial_mod.is_account_in_trial(u, now=datetime(2026, 7, 15, tzinfo=timezone.utc)) is False
    # …pre-default-cutoff account keeps its window (fallback ≠ deny-everyone).
    v = _dated_user("2026-07-10 09:00:00.000000", plan="free")
    assert trial_mod.is_account_in_trial(v, now=datetime(2026, 7, 11, tzinfo=timezone.utc)) is True


# ── defensive defaults — never accidentally-paid ─────────────────────────────

def test_defensive_bad_input(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    assert trial_mod.is_account_in_trial({}) is False
    assert trial_mod.is_account_in_trial({"created_at": "not-a-date"}) is False
    assert trial_mod.is_account_in_trial({"created_at": None}) is False
    assert trial_mod.is_paid_or_trial(None) is False
    assert trial_mod.is_paid_or_trial("nope") is False
    assert trial_mod.trial_status(None) == {"active": False, "days_left": 0}


def test_future_created_at_clock_skew_is_day_zero(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    _pin_cutoff_far_future(monkeypatch)
    u = _user(-1)  # created "in the future" (skew) → treated as active day-0
    assert trial_mod.is_account_in_trial(u) is True


# ── admin surfaces are UNAFFECTED by trial ───────────────────────────────────

def test_admin_gates_unaffected_by_trial(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    trial_user = _user(1, plan="free", role="member")
    # A trial (non-admin) user must NOT pass an admin gate.
    with pytest.raises(HTTPException):
        auth_middleware.require_admin(trial_user)
    # An actual admin passes.
    admin = {"role": "admin"}
    assert auth_middleware.require_admin(admin) is admin


# ── the other two shared gates honor trial too ───────────────────────────────

def test_require_plan_honors_trial(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    _pin_cutoff_far_future(monkeypatch)
    checker = auth_middleware.require_plan(list(auth_middleware.PAID_PLANS))
    trial_user = _user(3, plan="free", role="member")
    assert checker(trial_user) is trial_user  # trial grants the paid feature
    # An old unpaid user is rejected.
    with pytest.raises(HTTPException):
        checker(_user(40, plan="free", role="member"))


def test_requires_voice_access_honors_trial(monkeypatch):
    monkeypatch.setenv("J2_TRIAL_ENABLED", "1")
    _pin_cutoff_far_future(monkeypatch)
    trial_user = _user(3, plan="free", role="member")
    assert auth_middleware.requires_voice_access(trial_user) is trial_user
    with pytest.raises(HTTPException):
        auth_middleware.requires_voice_access(_user(40, plan="free", role="member"))
