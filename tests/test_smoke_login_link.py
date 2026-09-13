"""The admin-issued, single-use smoke-account login link.

⛔⛔ THIS FILE RAILS AN AUTHENTICATION BYPASS, so the cases that matter are the REFUSALS. A test
suite for a feature like this that only proves the happy path is worse than none: it certifies
that the door opens and says nothing about who it opens for.

Four independent conditions gate issuance, and each is asserted to be sufficient ON ITS OWN —
flag off, non-admin, wrong id, and (at redemption) single-use and expiry. The pairwise
"everything else is right except this one thing" shape is deliberate: a test that turns off two
conditions at once cannot tell you which one did the refusing.

⭐ THE TWO-DIRECTION PURPOSE RAIL IS THE POINT OF THE `purpose` COLUMN. `password_resets` backs
both token kinds now, and the dangerous confusion is not "a login token resets a password" — it
is a leaked PASSWORD-RESET token being redeemed as a LOGIN, which would make every reset email a
bearer credential. Both directions are driven here against the real functions.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import auth as auth_router
from api.services import auth_db, auth_service
from tests.authclients import ADMIN, PAID_MEMBER, authorize

SMOKE_ID = auth_router.SMOKE_USER_ID_DEFAULT


def _mk_app(identity):
    auth_db.init_db()
    app = FastAPI()
    app.include_router(auth_router.router)
    authorize(app, identity)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    """⭐ THE LIMITER IS PROCESS-GLOBAL AND IP-KEYED, so without this the module's own refusal
    tests exhaust `5/hour` and every later case fails with a 429 that looks like a broken feature.

    ⚠️ Worth stating rather than just clearing: a REFUSED call consumes quota too — slowapi runs
    before the handler — so in production five mistyped user ids lock an admin out of issuing for
    an hour. That is the rate limit doing exactly what it was asked to do, and it is the reason
    this fixture exists rather than the limit being loosened to make tests convenient.
    """
    from api.limiter import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def admin_client():
    return _mk_app(ADMIN)


@pytest.fixture
def member_client():
    return _mk_app(PAID_MEMBER)


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv("SMOKE_LOGIN_LINK_ENABLED", "1")
    monkeypatch.setenv("SMOKE_ID", SMOKE_ID)


def _seed_user(user_id: str, email: str) -> None:
    """Put a row in `users` so redemption has something to return. Uses the schema directly
    because there is no signup path for a synthetic id, and the id is the thing under test."""
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)",
            (user_id, email, "x", "user"),
        )
        conn.commit()
    finally:
        conn.close()


# ── Issuance: four gates, each sufficient alone ──────────────────────────────

def test_issuance_requires_the_flag(admin_client, monkeypatch):
    monkeypatch.delenv("SMOKE_LOGIN_LINK_ENABLED", raising=False)
    r = admin_client.post("/api/auth/smoke-login-link", json={"user_id": SMOKE_ID})
    assert r.status_code == 404, r.text


def test_issuance_requires_admin(member_client, flag_on):
    r = member_client.post("/api/auth/smoke-login-link", json={"user_id": SMOKE_ID})
    assert r.status_code == 403, r.text


def test_issuance_refuses_any_other_user_id(admin_client, flag_on):
    other = str(uuid.uuid4())
    r = admin_client.post("/api/auth/smoke-login-link", json={"user_id": other})
    assert r.status_code == 404, r.text


def test_issuance_refuses_an_allow_listed_id_with_no_user_row(admin_client, flag_on, monkeypatch):
    """⭐ FOUND BY THIS FILE, NOT BY REVIEW. `password_resets.user_id` is a foreign key, so minting
    for an id the database has never seen raised `IntegrityError` -> 500 with a traceback, for what
    is really a misconfigured SMOKE_ID. It is a 404 like every other refusal now."""
    ghost = str(uuid.uuid4())
    monkeypatch.setenv("SMOKE_ID", ghost)
    r = admin_client.post("/api/auth/smoke-login-link", json={"user_id": ghost})
    assert r.status_code == 404, r.text


def test_the_flag_and_the_wrong_id_are_indistinguishable(admin_client, monkeypatch):
    """⭐ Same status AND same body. A different answer for "wrong id" would make this endpoint an
    oracle for which id is the privileged one — the single most useful thing it could leak."""
    monkeypatch.setenv("SMOKE_LOGIN_LINK_ENABLED", "1")
    wrong = admin_client.post("/api/auth/smoke-login-link", json={"user_id": str(uuid.uuid4())})
    monkeypatch.delenv("SMOKE_LOGIN_LINK_ENABLED", raising=False)
    off = admin_client.post("/api/auth/smoke-login-link", json={"user_id": SMOKE_ID})
    assert wrong.status_code == off.status_code == 404
    assert wrong.json() == off.json()


def test_issuance_returns_a_url_carrying_a_token(admin_client, flag_on):
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    r = admin_client.post("/api/auth/smoke-login-link", json={"user_id": SMOKE_ID})
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert "/smoke-login#token=" in url
    assert len(url.split("token=", 1)[1]) >= 32


def test_the_token_is_never_written_to_the_activity_log(admin_client, flag_on):
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    # ⛔ THE ISSUING ADMIN NEEDS A ROW TOO. `activity_log.user_id` is a foreign key and
    # `log_activity` SWALLOWS its own failure by design (an audit write must never break the
    # action it records) — so without this the endpoint still succeeds, the log is silently empty,
    # and a rail that only checked "the token is absent" would pass over zero rows. The `assert
    # rows` below is what turns that into a failure instead of a false green.
    _seed_user(ADMIN["id"], ADMIN["email"])
    r = admin_client.post("/api/auth/smoke-login-link", json={"user_id": SMOKE_ID})
    token = r.json()["url"].split("token=", 1)[1]
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT action, details FROM activity_log WHERE action LIKE 'smoke_login%'"
        ).fetchall()
    finally:
        conn.close()
    assert rows, "the issuance was not logged at all — the audit trail is the point"
    for row in rows:
        assert token not in (row["details"] or ""), "the token reached the activity log"


# ── Redemption ───────────────────────────────────────────────────────────────

def test_redemption_creates_a_session_and_returns_the_login_shape(admin_client, flag_on):
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    token = admin_client.post(
        "/api/auth/smoke-login-link", json={"user_id": SMOKE_ID}
    ).json()["url"].split("token=", 1)[1]

    r = admin_client.post("/api/auth/smoke-login", json={"token": token})
    assert r.status_code == 200, r.text
    body = r.json()
    # The SAME shape password login returns — that is the "one session-creation path" claim,
    # asserted rather than trusted to the comment that makes it.
    assert set(["user", "plan"]).issubset(body.keys())
    assert body["user"]["id"] == SMOKE_ID
    assert "uct_session" in r.cookies, "no session cookie was set"


def test_a_token_is_single_use(admin_client, flag_on):
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    token = admin_client.post(
        "/api/auth/smoke-login-link", json={"user_id": SMOKE_ID}
    ).json()["url"].split("token=", 1)[1]

    assert admin_client.post("/api/auth/smoke-login", json={"token": token}).status_code == 200
    second = admin_client.post("/api/auth/smoke-login", json={"token": token})
    assert second.status_code == 400, "the same link was redeemed twice"


def test_an_expired_token_is_refused(admin_client, flag_on):
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    token = auth_service.create_smoke_login_token(SMOKE_ID)
    conn = auth_db.get_connection()
    try:
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        conn.execute("UPDATE password_resets SET expires_at = ? WHERE token = ?", (past, token))
        conn.commit()
    finally:
        conn.close()
    assert admin_client.post("/api/auth/smoke-login", json={"token": token}).status_code == 400


def test_redemption_requires_the_flag(admin_client, monkeypatch):
    monkeypatch.setenv("SMOKE_LOGIN_LINK_ENABLED", "1")
    monkeypatch.setenv("SMOKE_ID", SMOKE_ID)
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    token = auth_service.create_smoke_login_token(SMOKE_ID)
    monkeypatch.delenv("SMOKE_LOGIN_LINK_ENABLED", raising=False)
    assert admin_client.post("/api/auth/smoke-login", json={"token": token}).status_code == 404


def test_redemption_rechecks_the_allow_list(admin_client, flag_on, monkeypatch):
    """A token minted for one id must stop working the moment SMOKE_ID names another —
    narrowing the allow-list has to reach tokens already in flight, not five minutes later."""
    other = str(uuid.uuid4())
    _seed_user(other, "other@example.test")
    token = auth_service.create_smoke_login_token(other)
    assert admin_client.post("/api/auth/smoke-login", json={"token": token}).status_code == 400


def test_a_link_never_out_ranks_two_factor(admin_client, flag_on, monkeypatch):
    """⛔ NOT IN THE ORIGINAL SPEC, and the feature would have been a 2FA bypass without it:
    password login hands back a CHALLENGE when TOTP is on, so a link that minted a session would
    grant strictly more than the password does."""
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    token = auth_service.create_smoke_login_token(SMOKE_ID)
    monkeypatch.setattr(auth_router.totp_service, "is_enabled", lambda _uid: True)
    assert admin_client.post("/api/auth/smoke-login", json={"token": token}).status_code == 400


# ── The purpose column, in both directions ───────────────────────────────────

def test_a_login_token_cannot_reset_a_password():
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    token = auth_service.create_smoke_login_token(SMOKE_ID)
    assert auth_service.execute_password_reset(token, "hunter2-not-really") is False


def test_a_password_reset_token_cannot_log_anyone_in():
    """⭐ THE DIRECTION THAT ACTUALLY COSTS YOU. Without the purpose filter every reset email in
    a member's inbox would be a working session for their account."""
    email = f"reset-{uuid.uuid4().hex[:8]}@example.test"
    uid = str(uuid.uuid4())
    _seed_user(uid, email)
    token = auth_service.create_password_reset(email)
    assert token, "the fixture did not produce a reset token — this rail measured nothing"
    assert auth_service.redeem_smoke_login_token(token) is None


def test_issuing_a_login_link_does_not_cancel_a_pending_password_reset():
    """The purpose-scoped DELETE. Unscoped, minting a link would evict the member's in-flight
    reset and produce a "the link in my email stopped working" report with no trace."""
    # ⛔ A FRESH id, NOT SMOKE_ID. `_seed_user` is `INSERT OR IGNORE`, so reusing an id already
    # seeded under another email silently does nothing and `create_password_reset` then returns
    # None — the rail would have been measuring a missing fixture, not the DELETE's scope.
    email = f"both-{uuid.uuid4().hex[:8]}@example.test"
    uid = str(uuid.uuid4())
    _seed_user(uid, email)
    reset_token = auth_service.create_password_reset(email)
    assert reset_token, "the fixture produced no reset token — this rail measured nothing"
    auth_service.create_smoke_login_token(uid)
    # Still redeemable as a reset.
    assert auth_service.execute_password_reset(reset_token, "a-new-password-123") is True


# ── Non-vacuity control ──────────────────────────────────────────────────────

def test_the_allow_listed_id_is_the_one_the_router_ships():
    """If SMOKE_ID_DEFAULT ever changes, every refusal test above would still pass while
    testing a different id than production uses. This pins the two together."""
    assert SMOKE_ID == "f4433528-6466-474a-949c-8d5eda8a7b91"
    assert os.getenv("SMOKE_LOGIN_LINK_ENABLED", "") != "1", (
        "the flag is set in this environment, so the 'off by default' tests prove nothing"
    )


def test_the_token_is_in_the_FRAGMENT_and_never_a_query_string(admin_client, flag_on):
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")
    """⛔⛔ THE HARDENING PROPERTY. A fragment is never sent to any server -- ours, a CDN, or a
    search engine if the URL is mistyped into a search box -- and never lands in an access log or
    a Referer header.

    ⚰️ It was `?token=` until 2026-09-12, when a mistyped navigation on a BrowserStack mirror ran
    a GOOGLE SEARCH for the whole URL and handed a live token to a third party. This test is the
    thing that stops it silently going back."""
    url = admin_client.post("/api/auth/smoke-login-link",
                            json={"user_id": SMOKE_ID}).json()["url"]
    assert "#token=" in url, url
    # ⭐ The load-bearing half: the token must not ALSO appear before the '#'. A URL carrying it in
    # both places would pass a naive "is there a fragment" check and still leak on every request.
    before_fragment = url.split("#", 1)[0]
    assert "token=" not in before_fragment, before_fragment
    assert "?" not in before_fragment, before_fragment


def test_the_link_lives_two_minutes_not_five(admin_client, flag_on):
    """⛔ The TTL is asserted as a VALUE, not just 'some expiry exists'. It was 5 minutes; the
    shorter it is, the more often a leaked link is already dead by the time anyone notices."""
    from api.services import auth_service
    assert auth_service.SMOKE_LOGIN_TTL == timedelta(minutes=2)


def test_a_token_older_than_the_ttl_is_refused(admin_client, flag_on, monkeypatch):
    """Non-vacuity for the number above: prove the TTL is ENFORCED, not merely declared. A constant
    nothing reads is indistinguishable from no expiry at all.

    ⭐ The clock is moved by minting with a NEGATIVE ttl, so the token is born already expired and
    the redemption runs its real comparison against a real stored expiry. No production test-only
    helper exists for this and none is added -- inventing one would put a second, weaker door next
    to the real one."""
    from api.services import auth_service
    _seed_user(SMOKE_ID, "smoke@uctintelligence.internal")

    # Control first: a normal token redeems, so a 400 below means expiry and not something else.
    good = admin_client.post("/api/auth/smoke-login-link",
                             json={"user_id": SMOKE_ID}).json()["url"].split("#token=", 1)[1]
    assert admin_client.post("/api/auth/smoke-login", json={"token": good}).status_code == 200

    monkeypatch.setattr(auth_service, "SMOKE_LOGIN_TTL", timedelta(seconds=-1))
    stale = admin_client.post("/api/auth/smoke-login-link",
                              json={"user_id": SMOKE_ID}).json()["url"].split("#token=", 1)[1]
    assert admin_client.post("/api/auth/smoke-login", json={"token": stale}).status_code == 400
