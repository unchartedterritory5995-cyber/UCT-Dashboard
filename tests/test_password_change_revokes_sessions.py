"""Changing a password signs out every other device.

⚰️ **Before 2026-09-13 it did not.** All three password-writing paths wrote `password_hash`
and nothing else, so a member who changed their password *because* they suspected a
compromise kept every stolen session alive. The attacker stayed signed in and nothing told
the member. Found while rotating a leaked credential: **step 1 alone would have changed a
password and left every stolen session live** — that rotation only closed because a
separate, explicit `revoke-others` call was made by hand.

Three paths write a password and each gets its own case, because they differ in what they
may spare:

| path | spares |
|---|---|
| self-service `change_password` | the caller's own session — you must not be signed out of the device you are typing on |
| `execute_password_reset` (the emailed forgot-password link) | **nothing** — there is no caller session, and this is the path a locked-out or compromised member actually uses |
| admin `POST /auth/admin/reset-password` | **nothing** — the admin's own session belongs to a different user |

⛔ Scoped runs only on this box — name the file:

    python -m pytest tests/test_password_change_revokes_sessions.py -q
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services import auth_db, auth_service
from tests.authclients import ADMIN, authorize

PW = "OldPassword123!"
NEW = "BrandNewPassword456!"


def _user(email_prefix: str) -> dict:
    auth_db.init_db()
    # ⛔ `.internal`, NOT `.invalid`. `AdminResetRequest.email` is an `EmailStr`, and the
    # validator REJECTS special-use domains by name — `*.invalid` 422s before the endpoint
    # is ever reached, while `.internal` (RFC 8375) passes. The service-level cases never
    # touch Pydantic, so only the HTTP case sees it: a fixture domain can be wrong for
    # five tests and fatal for the sixth.
    return auth_service.create_user(f"{email_prefix}-{uuid.uuid4().hex[:8]}@uct-test.internal", PW, "T")


def _sessions(user_id: str, n: int) -> list[str]:
    return [auth_service.create_session(user_id) for _ in range(n)]


def _alive(tokens) -> list[bool]:
    return [auth_service.validate_session(t) is not None for t in tokens]


@pytest.fixture
def two_users():
    """User A (3 sessions) and an untouched bystander B (2 sessions).

    ⛔ B IS THE CONTROL THAT MATTERS. A revoke that deletes the whole `sessions` table
    would pass every assertion about A and sign out the entire membership.
    """
    a, b = _user("subject"), _user("bystander")
    ta, tb = _sessions(a["id"], 3), _sessions(b["id"], 2)
    # ⛔ NON-VACUITY: if these were already dead, every assertion below is satisfied by a
    # no-op and the whole file certifies nothing.
    assert all(_alive(ta)), "subject's sessions were not alive to begin with"
    assert all(_alive(tb)), "bystander's sessions were not alive to begin with"
    return a, b, ta, tb


def test_self_service_change_keeps_the_caller_and_drops_the_rest(two_users):
    a, b, ta, tb = two_users
    keep, other1, other2 = ta

    assert auth_service.change_password(a["id"], PW, NEW, keep_token=keep) is True

    assert auth_service.validate_session(keep) is not None, \
        "the device that changed the password was signed out — members would stop using this"
    assert _alive([other1, other2]) == [False, False], "a stolen session survived the change"
    assert all(_alive(tb)), "another member was signed out"


def test_a_wrong_current_password_revokes_nothing(two_users):
    """A failed attempt must not be a logout weapon against the account it targets."""
    a, b, ta, tb = two_users
    assert auth_service.change_password(a["id"], "not-the-password", NEW, keep_token=ta[0]) is False
    assert all(_alive(ta)), "a REJECTED password change signed the member out"
    assert all(_alive(tb))


def test_the_forgot_password_link_revokes_every_session(two_users):
    """The path a compromised member actually reaches for. Nothing is spared."""
    a, b, ta, tb = two_users
    token = auth_service.create_password_reset(a["email"])
    assert token, "no reset token was issued — the rest of this test would be vacuous"

    assert auth_service.execute_password_reset(token, NEW) is True

    assert _alive(ta) == [False, False, False], "the attacker's session survived a password RESET"
    assert all(_alive(tb)), "another member was signed out"
    assert auth_service.verify_password(a["email"], NEW), "the new password does not work"


def test_admin_reset_revokes_every_session_of_the_target(two_users):
    """Driven through the real endpoint, so the wiring is proved and not just the service."""
    a, b, ta, tb = two_users
    app = FastAPI()
    # ⛔ No prefix here: the router already declares prefix="/api/auth" (auth.py:87).
    # Adding one mounts it at /api/auth/api/auth/... and every call 404s.
    app.include_router(auth_router.router)
    authorize(app, ADMIN)
    client = TestClient(app)

    r = client.post("/api/auth/admin/reset-password",
                    json={"email": a["email"], "new_password": NEW})
    assert r.status_code == 200, r.text
    assert r.json().get("sessions_revoked") == 3, r.json()

    assert _alive(ta) == [False, False, False], "an admin reset left the stolen sessions alive"
    assert all(_alive(tb)), "an admin reset signed out an unrelated member"


def test_a_reset_does_not_disturb_a_smoke_login_token(two_users):
    """`password_resets` backs two token kinds; `purpose` is what keeps them apart.

    A password reset must not collaterally burn an outstanding smoke LOGIN token — that
    table is shared, and a revoke that reached across `purpose` would break the device
    sign-in path while looking like a security improvement.
    """
    a, _b, _ta, _tb = two_users
    login_token = auth_service.create_smoke_login_token(a["id"])
    reset_token = auth_service.create_password_reset(a["email"])
    assert login_token and reset_token

    assert auth_service.execute_password_reset(reset_token, NEW) is True

    conn = auth_db.get_connection()
    try:
        row = conn.execute(
            "SELECT used FROM password_resets WHERE token = ?", (login_token,)).fetchone()
    finally:
        conn.close()
    assert row is not None, "the smoke login token row was deleted by a password reset"
    assert not row["used"], "the smoke login token was burned by an unrelated password reset"


def test_revoke_sessions_with_no_keep_token_spares_nothing(two_users):
    """The primitive itself, both branches, so the callers above are reading a real switch."""
    a, b, ta, tb = two_users
    assert auth_service.revoke_sessions(a["id"], keep_token=ta[0]) == 2
    assert _alive(ta) == [True, False, False]
    assert auth_service.revoke_sessions(a["id"], keep_token=None) == 1
    assert _alive(ta) == [False, False, False]
    assert all(_alive(tb))
