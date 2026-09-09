"""Wave L Slice 3 — structural rails on the Browser Capture credential (§19).

Written BEFORE the extension, because the whole point of Option B is a ceiling
on what a stolen credential is worth, and a ceiling nobody has watched hold is a
paragraph in a document.

⛔ THE RAIL THAT MATTERS MOST is `test_the_extension_credential_reaches_ONLY…`.
It does not read a list of allowed routes — it walks the REAL app's resolved
dependency graph and derives the set, so a route that opts into the capture
resolver tomorrow is covered the day it lands. A hand-typed allowlist beside the
routes it describes is the defect this repo has paid for repeatedly.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.auth_service import create_session
from api.services.journal_two import capture_auth as ca
from api.services.journal_two import capture_destinations, notes as notes_service

REDIRECT = "https://" + ("a" * 32) + ".chromiumapp.org/"
OTHER_REDIRECT = "https://" + ("b" * 32) + ".chromiumapp.org/"
URL = "https://www.reuters.com/tech/nvda-q3?id=7"
PASSAGE = "Management expects gross margins to normalize through fiscal 2027."


@pytest.fixture()
def conn():
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        ca.ensure_capture_auth_schema(c)
        yield c
    finally:
        c.close()


@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app
    return real_app


@pytest.fixture()
def client(app):
    return TestClient(app, raise_server_exceptions=False)


def _user(conn) -> str:
    uid = uuid.uuid4().hex
    conn.execute("INSERT INTO users (id, email, password_hash, created_at)"
                 " VALUES (?,?,?,datetime('now'))", (uid, f"{uid}@t.local", "x"))
    conn.commit()
    return uid


def _connected(conn, user_id: str) -> str:
    """A member who has connected the extension. Returns the bearer."""
    code = ca.mint_authorization_code(user_id, REDIRECT, conn=conn)["code"]
    return ca.exchange_authorization_code(code, REDIRECT, conn=conn)["token"]


def _note(conn, user_id: str, title="NVDA") -> str:
    return notes_service.create_note(user_id, {"title": title}, conn=conn)["id"]


# ── 1. No extension path touches the session cookie ──────────────────────────

class TestNoSessionPossession:
    def test_the_resolver_never_reads_the_session_cookie(self):
        # The credential resolver takes a bearer string and nothing else. If it
        # could reach the cookie, "the extension does not possess your session"
        # would stop being true without any route changing.
        import inspect
        src = inspect.getsource(ca)
        assert "uct_session" not in src
        assert "Cookie" not in src

    def test_a_session_token_is_not_a_capture_token(self, conn):
        # The two credential spaces are disjoint by construction: a session
        # token presented as a bearer resolves to nobody.
        uid = _user(conn)
        session = create_session(uid)
        assert ca.resolve_token(session, conn=conn) is None

    def test_the_calendar_export_token_cannot_authorize_capture(self, conn):
        # The named trap. hmac(PUSH_SECRET, user_id) is a real credential in
        # this codebase; it must be worthless here.
        uid = _user(conn)
        secret = os.environ.get("PUSH_SECRET", "test-secret")
        forged = hmac.new(secret.encode(), uid.encode(), hashlib.sha256).hexdigest()
        assert ca.resolve_token(forged, conn=conn) is None


# ── 2. The blast radius: which routes an extension credential can reach ──────

def _capture_scoped_routes(app) -> dict[str, set[str]]:
    """Derived from the app, never typed: every route whose resolved dependency
    graph includes a `require_capture_scope(...)` closure, and the scope it
    demands."""
    found: dict[str, set[str]] = {}

    def walk(dep, into: set[str]):
        call = getattr(dep, "call", None)
        scope = getattr(call, "_capture_scope", None)
        if scope:
            into.add(scope)
        for sub in getattr(dep, "dependencies", []) or []:
            walk(sub, into)

    for route in app.routes:
        dependant = getattr(route, "dependant", None)
        if dependant is None:
            continue
        scopes: set[str] = set()
        walk(dependant, scopes)
        if scopes:
            found[route.path] = scopes
    return found


class TestBlastRadius:
    def test_the_extension_credential_reaches_ONLY_the_browser_capture_surfaces(self, app):
        reached = _capture_scoped_routes(app)
        assert reached == {
            "/api/j2/capture": {ca.SCOPE_CAPTURE_WRITE},
            "/api/j2/capture/destinations": {ca.SCOPE_DESTINATIONS_READ},
        }, (
            "A route opted into the Browser Capture credential. That is a "
            "deliberate decision requiring a security review, not a drive-by: "
            f"reached={sorted(reached)}"
        )

    def test_the_probe_can_actually_SEE_a_capture_scoped_route(self, app):
        # Non-vacuity. A walker that found nothing would pass the assertion
        # above only if the expected dict were also empty — it is not, but a
        # broken walker returning {} must not read as "nothing is exposed".
        assert _capture_scoped_routes(app), "the dependency walk found nothing at all"

    def test_get_current_user_still_takes_a_cookie_and_nothing_else(self):
        # The mutation this file exists to catch: teaching the app-wide
        # dependency to accept the capture bearer turns it into a site-wide
        # credential in one line.
        import inspect
        from api.middleware import auth_middleware
        sig = inspect.signature(auth_middleware.get_current_user)
        assert list(sig.parameters) == ["uct_session"]
        src = inspect.getsource(auth_middleware)
        assert "capture_auth" not in src and "Authorization" not in src


class TestUnrelatedEndpointsRefuse:
    """Behavioural half of the above: the wire, not the graph."""

    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/j2/notes"),
        ("GET", "/api/j2/notes/recents"),
        ("GET", "/api/auth/me"),
        ("GET", "/api/j2/accounts"),
        ("GET", "/api/watchlists"),
        ("GET", "/api/j2/capture/connections"),
    ])
    def test_an_extension_token_is_refused_by_an_unrelated_endpoint(
        self, client, conn, method, path
    ):
        token = _connected(conn, _user(conn))
        r = client.request(method, path, headers={"Authorization": f"Bearer {token}"})
        assert r.status_code in (401, 403, 404), (
            f"{method} {path} accepted a Browser Capture credential "
            f"({r.status_code}) — the token is no longer capture-only"
        )

    def test_listing_connections_is_session_only(self, client, conn):
        # Named separately because it is the sharpest case: a capture credential
        # that could enumerate or revoke credentials would be a self-managing
        # credential, which is an account operation.
        uid = _user(conn)
        token = _connected(conn, uid)
        r = client.get("/api/j2/capture/connections",
                       headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401
        client.cookies.set("uct_session", create_session(uid))
        try:
            ok = client.get("/api/j2/capture/connections")
            assert ok.status_code == 200, "the session path must still work"
            assert len(ok.json()["connections"]) == 1
        finally:
            client.cookies.clear()


# ── 3. Credential lifecycle: every fail-closed path ──────────────────────────

class TestCredentialLifecycle:
    def test_a_valid_token_resolves_to_exactly_one_member(self, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        p = ca.resolve_token(token, conn=conn)
        assert p["user_id"] == uid
        assert p["scopes"] == frozenset(ca.GRANTED_SCOPES)

    def test_a_revoked_token_is_rejected_immediately(self, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        token_id = ca.resolve_token(token, conn=conn)["token_id"]
        assert ca.revoke_connection(uid, token_id, conn=conn) is True
        assert ca.resolve_token(token, conn=conn) is None

    def test_revoking_one_members_token_leaves_another_members_alone(self, conn):
        a, b = _user(conn), _user(conn)
        ta, tb = _connected(conn, a), _connected(conn, b)
        ca.revoke_connection(a, ca.resolve_token(ta, conn=conn)["token_id"], conn=conn)
        assert ca.resolve_token(ta, conn=conn) is None
        assert ca.resolve_token(tb, conn=conn)["user_id"] == b, \
            "revocation must be per credential, not per anything larger"

    def test_a_member_cannot_revoke_a_credential_that_is_not_theirs(self, conn):
        a, b = _user(conn), _user(conn)
        tb = _connected(conn, b)
        b_token_id = ca.resolve_token(tb, conn=conn)["token_id"]
        assert ca.revoke_connection(a, b_token_id, conn=conn) is False
        assert ca.resolve_token(tb, conn=conn) is not None

    def test_an_expired_token_is_rejected(self, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        conn.execute(
            "UPDATE j2_capture_tokens SET expires_at = ? WHERE user_id = ?",
            ((datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), uid),
        )
        conn.commit()
        assert ca.resolve_token(token, conn=conn) is None

    def test_expiry_is_ABSOLUTE_not_extended_by_use(self, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        before = conn.execute("SELECT expires_at FROM j2_capture_tokens WHERE user_id = ?",
                              (uid,)).fetchone()["expires_at"]
        ca.resolve_token(token, conn=conn)
        after = conn.execute("SELECT expires_at FROM j2_capture_tokens WHERE user_id = ?",
                             (uid,)).fetchone()["expires_at"]
        assert before == after, "a sliding expiry is a never-expiring credential in disguise"

    def test_the_ttl_never_outlives_the_session_it_is_weaker_than(self):
        from api.routers import auth as auth_router
        import inspect
        src = inspect.getsource(auth_router._set_session_cookie)
        assert "30 * 24 * 60 * 60" in src, \
            "the session TTL moved; re-derive TOKEN_TTL_DAYS rather than leaving it"
        assert ca.TOKEN_TTL_DAYS <= 30

    @pytest.mark.parametrize("bad", [None, "", "   ", "not-a-token", "uctcap_", "Bearer x",
                                     "uctcap_" + "z" * 43])
    def test_a_malformed_token_is_rejected_without_raising(self, conn, bad):
        assert ca.resolve_token(bad, conn=conn) is None

    def test_account_deletion_destroys_every_credential(self, conn):
        from api.services.journal_two import account_purge
        uid = _user(conn)
        _connected(conn, uid)
        ca.mint_authorization_code(uid, REDIRECT, conn=conn)   # an unspent code too
        assert conn.execute("SELECT COUNT(*) c FROM j2_capture_tokens WHERE user_id=?",
                            (uid,)).fetchone()["c"] == 1
        account_purge.purge_user_data(uid, conn)
        assert conn.execute("SELECT COUNT(*) c FROM j2_capture_tokens WHERE user_id=?",
                            (uid,)).fetchone()["c"] == 0
        assert conn.execute("SELECT COUNT(*) c FROM j2_capture_auth_codes WHERE user_id=?",
                            (uid,)).fetchone()["c"] == 0

    def test_both_credential_tables_are_in_the_purge_manifest(self):
        # The purge above works because these are listed. Pin it: a table added
        # to the schema and forgotten here leaves live credentials behind.
        from api.services.journal_two import account_purge
        assert "j2_capture_tokens" in account_purge._DIRECT_USER_TABLES
        assert "j2_capture_auth_codes" in account_purge._DIRECT_USER_TABLES


class TestSecretsAtRest:
    def test_the_raw_bearer_is_NEVER_stored_server_side(self, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        for table in ("j2_capture_tokens", "j2_capture_auth_codes"):
            for row in conn.execute(f"SELECT * FROM {table}").fetchall():
                for value in tuple(row):
                    assert token not in str(value), \
                        f"{table} holds the raw bearer — a DB leak would hand out credentials"

    def test_the_stored_material_is_a_hash_of_the_presented_value(self, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        stored = conn.execute("SELECT token_hash FROM j2_capture_tokens WHERE user_id=?",
                              (uid,)).fetchone()["token_hash"]
        assert stored == hashlib.sha256(token.encode()).hexdigest()
        assert len(stored) == 64

    def test_a_connection_listing_exposes_no_token_material(self, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        listed = ca.list_connections(uid, conn=conn)
        blob = repr(listed)
        assert token not in blob
        assert hashlib.sha256(token.encode()).hexdigest() not in blob, \
            "a hash of a live credential is still a fact about it"


# ── 4. The one-time authorization code (§6) ──────────────────────────────────

class TestAuthorizationCode:
    def test_a_code_exchanges_exactly_once(self, conn):
        uid = _user(conn)
        code = ca.mint_authorization_code(uid, REDIRECT, conn=conn)["code"]
        first = ca.exchange_authorization_code(code, REDIRECT, conn=conn)
        assert first["token"].startswith(ca.TOKEN_PREFIX)
        with pytest.raises(ca.CaptureAuthError):
            ca.exchange_authorization_code(code, REDIRECT, conn=conn)

    def test_a_replay_mints_no_second_credential(self, conn):
        uid = _user(conn)
        code = ca.mint_authorization_code(uid, REDIRECT, conn=conn)["code"]
        ca.exchange_authorization_code(code, REDIRECT, conn=conn)
        try:
            ca.exchange_authorization_code(code, REDIRECT, conn=conn)
        except ca.CaptureAuthError:
            pass
        assert conn.execute("SELECT COUNT(*) c FROM j2_capture_tokens WHERE user_id=?",
                            (uid,)).fetchone()["c"] == 1

    def test_an_expired_code_is_refused_and_stays_spent(self, conn):
        uid = _user(conn)
        code = ca.mint_authorization_code(uid, REDIRECT, conn=conn)["code"]
        conn.execute("UPDATE j2_capture_auth_codes SET expires_at = ? WHERE user_id = ?",
                     ((datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), uid))
        conn.commit()
        with pytest.raises(ca.CaptureAuthError):
            ca.exchange_authorization_code(code, REDIRECT, conn=conn)
        assert conn.execute("SELECT COUNT(*) c FROM j2_capture_tokens WHERE user_id=?",
                            (uid,)).fetchone()["c"] == 0

    def test_a_code_cannot_be_redeemed_against_a_DIFFERENT_redirect(self, conn):
        # The confused-deputy case: a code intercepted en route must not be
        # redeemable by whoever holds it against their own target.
        uid = _user(conn)
        code = ca.mint_authorization_code(uid, REDIRECT, conn=conn)["code"]
        with pytest.raises(ca.CaptureAuthError):
            ca.exchange_authorization_code(code, OTHER_REDIRECT, conn=conn)

    def test_the_code_ttl_is_seconds_not_days(self):
        assert ca.AUTH_CODE_TTL_SECONDS <= 300, \
            "a long-lived authorization code IS a quasi-token"

    def test_the_refusal_message_does_not_say_WHICH_failure_it_was(self, conn):
        uid = _user(conn)
        spent = ca.mint_authorization_code(uid, REDIRECT, conn=conn)["code"]
        ca.exchange_authorization_code(spent, REDIRECT, conn=conn)
        messages = set()
        for bad in (spent, "totally-unknown-code"):
            try:
                ca.exchange_authorization_code(bad, REDIRECT, conn=conn)
            except ca.CaptureAuthError as e:
                messages.add(str(e))
        assert len(messages) == 1, f"the error distinguishes cases: {messages}"


class TestRedirectPolicy:
    @pytest.mark.parametrize("bad", [
        None, "", "http://" + "a" * 32 + ".chromiumapp.org/",   # not https
        "https://evil.example/cb",
        "https://" + "a" * 32 + ".chromiumapp.org.evil.example/",
        "https://" + "a" * 32 + ".chromiumapp.org/?next=https://evil.example",
        "https://" + "z" * 32 + ".chromiumapp.org/",            # z is outside a-p
        "javascript:alert(1)",
    ])
    def test_a_redirect_that_is_not_an_extension_origin_is_refused(self, bad):
        with pytest.raises(ca.CaptureAuthError):
            ca.validate_redirect_uri(bad)

    def test_a_real_extension_redirect_passes(self):
        assert ca.validate_redirect_uri(REDIRECT) == REDIRECT

    def test_the_allowlist_pins_to_our_extension_when_set(self, monkeypatch):
        monkeypatch.setenv("CAPTURE_EXTENSION_IDS", "c" * 32)
        with pytest.raises(ca.CaptureAuthError):
            ca.validate_redirect_uri(REDIRECT)
        assert ca.validate_redirect_uri("https://" + "c" * 32 + ".chromiumapp.org/")


# ── 5. Tenant binding + rights, through the real route ───────────────────────

class TestThroughTheRoute:
    def _post(self, client, token, body):
        return client.post("/api/j2/capture", json=body,
                           headers={"Authorization": f"Bearer {token}"})

    def test_a_scoped_token_can_capture(self, client, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        r = self._post(client, token, {"noteId": _note(conn, uid), "tier": "passage",
                                       "url": URL, "title": "Reuters", "passage": PASSAGE})
        assert r.status_code == 200, r.text
        # Read the vocabulary from the module that owns it, never retyped here.
        from api.services.journal_two import web_capture_store as wcs
        assert r.json()["captureType"] == wcs.CAPTURE_WEB_PASSAGE
        # The extension door produced the SAME object shape as every other door.
        assert set(r.json()) >= {"documentId", "noteId", "captureType", "coverage",
                                 "sourceUrl", "deduped"}

    def test_a_token_for_member_A_cannot_reach_member_Bs_note(self, client, conn):
        a, b = _user(conn), _user(conn)
        token_a = _connected(conn, a)
        b_note = _note(conn, b, title="B's private research")
        real = self._post(client, token_a, {"noteId": b_note, "tier": "reference",
                                            "url": URL, "title": "Reuters"})
        ghost = self._post(client, token_a, {"noteId": "does-not-exist-" + uuid.uuid4().hex,
                                             "tier": "reference", "url": URL, "title": "Reuters"})
        assert real.status_code == ghost.status_code == 404
        assert real.json()["detail"] == ghost.json()["detail"], \
            "a different message for an existing note is a cross-tenant existence oracle"

    def test_the_extension_cannot_bypass_the_rights_boundary(self, client, conn):
        # §13. The extension technically has DOM access; the server does not care.
        uid = _user(conn)
        token = _connected(conn, uid)
        note = _note(conn, uid)
        full = self._post(client, token, {"noteId": note, "tier": "full_page",
                                          "url": URL, "title": "Reuters", "passage": PASSAGE})
        assert full.status_code == 422
        oversized = self._post(client, token, {
            "noteId": note, "tier": "passage", "url": URL, "title": "Reuters",
            "passage": "z" * 40_000})
        assert oversized.status_code == 422, \
            "a 40k 'passage' is the full-page tier wearing another name"

    def test_a_revoked_token_stops_capturing_immediately(self, client, conn):
        uid = _user(conn)
        token = _connected(conn, uid)
        note = _note(conn, uid)
        assert self._post(client, token, {"noteId": note, "tier": "reference",
                                          "url": URL, "title": "Reuters"}).status_code == 200
        ca.revoke_connection(uid, ca.resolve_token(token, conn=conn)["token_id"], conn=conn)
        after = self._post(client, token, {"noteId": note, "tier": "reference",
                                           "url": URL + "&x=2", "title": "Reuters"})
        assert after.status_code == 401
        assert after.json()["detail"]["error"] == "reconnect_required", \
            "the extension must be able to tell 'reconnect' from 'that is not allowed'"

    def test_no_credential_at_all_is_refused(self, client, conn):
        uid = _user(conn)
        r = client.post("/api/j2/capture", json={"noteId": _note(conn, uid),
                                                 "tier": "reference", "url": URL})
        assert r.status_code == 401

    def test_a_wrong_scope_credential_is_refused_with_a_DIFFERENT_answer(self, conn):
        # Scope failure is not a reconnect: reconnecting mints the same scopes.
        from api.middleware.capture_scope import require_capture_scope
        from fastapi import HTTPException
        uid = _user(conn)
        token = _connected(conn, uid)
        conn.execute("UPDATE j2_capture_tokens SET scopes = ? WHERE user_id = ?",
                     (ca.SCOPE_DESTINATIONS_READ, uid))
        conn.commit()
        dep = require_capture_scope(ca.SCOPE_CAPTURE_WRITE)
        with pytest.raises(HTTPException) as e:
            dep(uct_session=None, authorization=f"Bearer {token}")
        assert e.value.status_code == 403
        assert e.value.detail["error"] == "insufficient_scope"

    def test_the_session_door_is_unchanged_by_all_of_this(self, client, conn):
        # Slice 2's in-app doors must behave exactly as before.
        uid = _user(conn)
        client.cookies.set("uct_session", create_session(uid))
        try:
            r = client.post("/api/j2/capture", json={"noteId": _note(conn, uid),
                                                     "tier": "reference", "url": URL,
                                                     "title": "Reuters"})
            assert r.status_code == 200, r.text
        finally:
            client.cookies.clear()


# ── 6. Destination discovery stays narrow (§18) ──────────────────────────────

class TestDestinationProjection:
    def test_a_destination_carries_no_note_content(self, conn):
        uid = _user(conn)
        note = notes_service.create_note(uid, {
            "title": "NVDA thesis",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "SECRET-RESEARCH-TEXT"}]}]},
        }, conn=conn)
        notes_service.record_note_opened(uid, note["id"], conn=conn)
        dests = capture_destinations.list_destinations(uid, conn=conn)
        assert dests and dests[0]["id"] == note["id"]
        assert set(dests[0]) == set(capture_destinations.PROJECTION_KEYS)
        assert "SECRET-RESEARCH-TEXT" not in repr(dests)

    def test_the_in_app_recents_endpoint_WOULD_have_leaked_it(self, conn):
        # Why this module exists rather than reusing /api/j2/notes/recents. If
        # this ever stops being true the projection can be reconsidered — until
        # then it is the measured reason.
        uid = _user(conn)
        note = notes_service.create_note(uid, {
            "title": "NVDA thesis",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "SECRET-RESEARCH-TEXT"}]}]},
        }, conn=conn)
        notes_service.record_note_opened(uid, note["id"], conn=conn)
        recents = notes_service.list_recents(uid, conn=conn)
        assert "SECRET-RESEARCH-TEXT" in repr(recents), \
            "the recents projection changed — re-derive the destination decision"

    def test_destinations_are_tenant_scoped(self, client, conn):
        a, b = _user(conn), _user(conn)
        b_note = notes_service.create_note(b, {"title": "B private"}, conn=conn)
        notes_service.record_note_opened(b, b_note["id"], conn=conn)
        token_a = _connected(conn, a)
        r = client.get("/api/j2/capture/destinations",
                       headers={"Authorization": f"Bearer {token_a}"})
        assert r.status_code == 200
        assert all(d["id"] != b_note["id"] for d in r.json()["destinations"])

    def test_destinations_require_the_destinations_scope(self, conn):
        from api.middleware.capture_scope import require_capture_scope
        from fastapi import HTTPException
        uid = _user(conn)
        token = _connected(conn, uid)
        conn.execute("UPDATE j2_capture_tokens SET scopes = ? WHERE user_id = ?",
                     (ca.SCOPE_CAPTURE_WRITE, uid))
        conn.commit()
        with pytest.raises(HTTPException) as e:
            require_capture_scope(ca.SCOPE_DESTINATIONS_READ)(
                uct_session=None, authorization=f"Bearer {token}")
        assert e.value.status_code == 403


# ── 7. Secret hygiene in logs (§14) ──────────────────────────────────────────

class TestLogHygiene:
    def test_no_bearer_or_code_reaches_the_logs_on_a_real_capture(
        self, client, conn, caplog, capsys
    ):
        import logging
        uid = _user(conn)
        code = ca.mint_authorization_code(uid, REDIRECT, conn=conn)["code"]
        token = ca.exchange_authorization_code(code, REDIRECT, conn=conn)["token"]
        note = _note(conn, uid)
        with caplog.at_level(logging.DEBUG):
            client.post("/api/j2/capture",
                        json={"noteId": note, "tier": "passage", "url": URL,
                              "title": "Reuters", "passage": PASSAGE},
                        headers={"Authorization": f"Bearer {token}"})
            client.post("/api/j2/capture", json={"noteId": note, "tier": "reference",
                                                 "url": URL},
                        headers={"Authorization": "Bearer uctcap_bogus-value-here"})
        emitted = caplog.text + capsys.readouterr().err + capsys.readouterr().out
        assert token not in emitted
        assert code not in emitted
        assert "uctcap_bogus-value-here" not in emitted, \
            "a REJECTED credential is still a credential — do not log the value"

    def test_the_app_installs_no_middleware_that_dumps_headers(self, app):
        # Generic request logging is where an Authorization value escapes without
        # anyone writing a log line for it.
        import inspect
        for mw in app.user_middleware:
            try:
                src = inspect.getsource(mw.cls)
            except (OSError, TypeError):
                continue
            assert "request.headers" not in src or "authorization" not in src.lower(), \
                f"{mw.cls.__name__} reads request headers near an authorization mention"
