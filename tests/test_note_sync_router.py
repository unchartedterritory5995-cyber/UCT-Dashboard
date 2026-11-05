"""HTTP-level tests for the note-connectors router — `/api/j2/notes/connectors/*`.

Spins up a minimal FastAPI app with just the note_sync router (mirrors
`tests/test_broker_router.py`'s pattern — a standalone app + auth dependency
overrides is faster and more isolated than booting the full `api.main.app`,
and exercises the exact same concerns: consent gate, paid-plan gate, DB
isolation), against a temp auth.db.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, engine, errors, registry
from api.services.journal_two.note_connectors.providers.base import AccountInfo, NoteProvider, RemoteRef
from api.middleware import auth_middleware as authmw
from api.routers import note_sync as note_sync_router


class FakeTokenProvider(NoteProvider):
    """Roam/Craft-shaped stand-in — `validate()` is the only method the
    connect flow calls synchronously."""

    name = "fake"

    def __init__(self, *, label="Fake Graph", raise_on_validate=None):
        self.label = label
        self.raise_on_validate = raise_on_validate
        self.validate_calls: list[dict] = []
        self.aclose_calls = 0

    async def validate(self, credentials):
        self.validate_calls.append(credentials)
        if self.raise_on_validate is not None:
            raise self.raise_on_validate
        return AccountInfo(label=self.label)

    async def list_changed(self, credentials, cursor=None):
        return []

    async def fetch(self, credentials, ref):
        raise NotImplementedError

    async def fetch_media(self, credentials, ref):
        raise NotImplementedError

    async def aclose(self):
        self.aclose_calls += 1


@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    # Notion stays "not configured" by default (no env creds) -- individual
    # OAuth tests set these explicitly.
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)

    app = FastAPI()
    app.include_router(note_sync_router.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": "u1", "plan": "pro", "role": "member"}
    # Fix-round-1 Important #2: the OAuth callback binds to the session via
    # get_current_user_optional (never raises) -- default the test session
    # to the SAME user as get_current_user so every EXISTING happy-path
    # callback test still completes; individual cross-user/anonymous tests
    # override this per-test.
    app.dependency_overrides[authmw.get_current_user_optional] = lambda: {"id": "u1", "role": "member"}

    c = TestClient(app)
    c._app = app
    return c


def _free_user(client):
    client._app.dependency_overrides[authmw.get_current_user_with_plan] = \
        lambda: {"id": "u1", "plan": "free", "role": "member"}


# ── GET /status ────────────────────────────────────────────────────────────

def test_status_open_to_logged_in_and_lists_every_registered_provider(client):
    r = client.get("/api/j2/notes/connectors/status")
    assert r.status_code == 200
    body = r.json()
    # Dropbox, OneNote and OneDrive were archived on 2026-11-04 (never configured in production).
    assert set(body["providers"].keys()) == {
        "roam", "craft", "notion", "obsidian",
        "evernote",  # Plan E Task 6 (dark: configured is False with the flag unset)
    }
    # Obsidian's connect_kind is neither "token" nor "oauth" (registry.py's
    # own contract, extended honestly for the 2026-09-02 plan's push-transport
    # connect-code flow) -- and it is dark by default (NOTE_SYNC_OBSIDIAN_ENABLED
    # unset in this fixture's env), so it never claims to be usable yet.
    assert body["providers"]["obsidian"]["connectKind"] == "device"
    assert body["providers"]["obsidian"]["configured"] is False
    assert body["providers"]["roam"]["configured"] is True   # token providers always available
    assert body["providers"]["notion"]["configured"] is False  # no env creds in this fixture
    assert body["providers"]["roam"]["connected"] is False
    assert body["providers"]["roam"]["sources"] == []


def test_status_is_open_to_a_free_user(client):
    _free_user(client)
    assert client.get("/api/j2/notes/connectors/status").status_code == 200


def test_status_consumes_list_connectors_not_a_raw_table_query(client, monkeypatch):
    """Task 11 MUST-RESOLVE #6: the status endpoint must go through
    `connections.list_connectors` (flagged dead code until this consumed
    it) rather than re-querying `j2_note_connectors` directly."""
    calls = []
    real = connections.list_connectors

    def spy(user_id, conn=None):
        calls.append(user_id)
        return real(user_id, conn)

    monkeypatch.setattr(connections, "list_connectors", spy)
    r = client.get("/api/j2/notes/connectors/status")
    assert r.status_code == 200
    assert calls == ["u1"]


def test_status_source_counts_default_to_zero_before_any_sync(client, monkeypatch):
    """Task 12's already-shipped `SourceRow.jsx`/`NoteConnectorsTrustStrip.jsx`
    read `source.counts.{notesCreated,notesUpdated,conflicts}` directly off
    every status response -- a source with no sync-log rows yet must still
    carry a fully-shaped zero object, never a missing/undefined `counts`."""
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    st = client.get("/api/j2/notes/connectors/status").json()
    src = st["providers"]["roam"]["sources"][0]
    assert src["id"] == source_id
    assert src["counts"] == {
        "notesCreated": 0, "notesUpdated": 0, "notesSkipped": 0,
        "mediaUploaded": 0, "conflicts": 0, "sourceDeleted": 0,
    }


def test_status_source_counts_reflect_the_most_recent_sync_log_row(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    conn = auth_db.get_connection()
    try:
        # Two log rows -- the endpoint must report the NEWEST, not the first
        # or a sum.
        conn.execute(
            "INSERT INTO j2_note_sync_log (source_id, user_id, started_at, finished_at, status, "
            "notes_created, notes_updated, notes_skipped, media_uploaded, conflicts) "
            "VALUES (?, 'u1', 't1', 't1', 'ok', 2, 1, 0, 0, 0)",
            (source_id,),
        )
        conn.execute(
            "INSERT INTO j2_note_sync_log (source_id, user_id, started_at, finished_at, status, "
            "notes_created, notes_updated, notes_skipped, media_uploaded, conflicts, "
            "source_deleted) "
            "VALUES (?, 'u1', 't2', 't2', 'ok', 0, 5, 1, 2, 3, 4)",
            (source_id,),
        )
        conn.commit()
    finally:
        conn.close()

    st = client.get("/api/j2/notes/connectors/status").json()
    counts = st["providers"]["roam"]["sources"][0]["counts"]
    assert counts == {
        "notesCreated": 0, "notesUpdated": 5, "notesSkipped": 1,
        "mediaUploaded": 2, "conflicts": 3, "sourceDeleted": 4,
    }


# ── connect == import: the first sync must START, not be scheduled ──────────

def test_the_oauth_callback_starts_the_first_sync_for_the_source_it_creates(client, monkeypatch):
    """⛔ "Connect" is the member's *import my notebook* action.

    Before this wiring, finishing Notion's OAuth created a `j2_note_sources`
    row and redirected to an EMPTY Notebook with nothing running -- the
    content appeared only when the hourly `:23` incremental tick came round
    (up to 60 minutes later) or when the member found "Sync now" themselves.
    The engine was always correct; the WIRING was missing, so that is what
    this pins, by driving the real callback route.
    """
    import api.routers.note_sync as ns

    started: list[str] = []
    monkeypatch.setattr(ns, "_start_initial_sync", started.append)
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "notion-tok", "workspaceId": "ws-1", "workspaceName": "Acme"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    state = ns._sign_state("u1", "notion")
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302 and "connected=1" in r.headers["location"]

    sources = client.get("/api/j2/notes/connectors/status").json()["providers"]["notion"]["sources"]
    assert len(sources) == 1, "callback did not create the source this rail is about"
    assert started == [sources[0]["id"]], (
        "the OAuth callback created a source without starting its first sync -- "
        "the member lands on an empty Notebook until the scheduled tick"
    )


def test_every_oauth_return_lands_on_the_connections_section(client, monkeypatch):
    """⛔ The member finishes the provider's consent screen and is redirected
    back. Without `section=connections` that redirect opened Settings on
    whichever section renders first (Account), so the member had to find
    their way back to Connections to see the thing they had just connected --
    measured by walking the real Notion flow, not theorised.

    Pins EVERY return path, success and failure alike: a member who hit an
    error needs the connector card even more than one who succeeded.
    """
    import api.routers.note_sync as ns

    monkeypatch.setattr(ns, "_start_initial_sync", lambda *_a, **_k: None)
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")

    async def ok_exchange(provider, code, **kw):
        return {"accessToken": "t", "workspaceId": "ws-1", "workspaceName": "Acme"}

    monkeypatch.setattr(ns.oauth, "exchange_code", ok_exchange)
    state = ns._sign_state("u1", "notion")
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "c", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "section=connections" in r.headers["location"], r.headers["location"]
    assert "connected=1" in r.headers["location"]

    # The provider-denied path returns through a different branch.
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"error": "access_denied", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "section=connections" in r.headers["location"], r.headers["location"]


def test_start_initial_sync_never_raises_into_a_successful_connect():
    """A failed kick-off must never turn a SUCCESSFUL connect into an error
    the member sees; with no running loop it degrades to the scheduled tick."""
    import api.routers.note_sync as ns
    ns._start_initial_sync("src-no-loop-at-all")


# ── POST /{provider}/connect — token providers (roam/craft) ─────────────────

def test_connect_requires_consent(client):
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"graphName": "g1", "token": "t1"})
    assert r.status_code == 400


def test_connect_unknown_provider_404(client):
    # Plan E Task 6: "evernote" is a real provider now; an unknown name keeps the 404.
    r = client.post("/api/j2/notes/connectors/evernote-legacy/connect", json={"consent": True})
    assert r.status_code == 404


def test_connect_roam_happy_path(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "roam-tok"})
    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is True
    assert body["accountLabel"] == "my-graph"
    assert body["source"]["remoteId"] == "my-graph"
    assert fake.aclose_calls == 1

    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["roam"]["connected"] is True
    assert len(st["providers"]["roam"]["sources"]) == 1


def test_connect_roam_bad_token_returns_400(client, monkeypatch):
    fake = FakeTokenProvider(raise_on_validate=errors.NoteConnAuthError("Roam rejected the token"))
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "g1", "token": "bad-tok"})
    assert r.status_code == 400
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["roam"]["connected"] is False


def test_connect_roam_missing_fields_400(client):
    r = client.post("/api/j2/notes/connectors/roam/connect", json={"consent": True})
    assert r.status_code == 400


def test_connect_craft_bad_url_400(client):
    r = client.post("/api/j2/notes/connectors/craft/connect",
                     json={"consent": True, "apiUrl": "https://evil.example.com/x", "apiKey": "b"})
    assert r.status_code == 400


def test_connect_paid_gate_blocks_free_user(client, monkeypatch):
    # ⛔ THE PROVIDER IS STUBBED SO THIS TEST IS SAFE INDEPENDENTLY OF THE GATE
    # IT TESTS. Without it, the only thing standing between this case and a
    # real outbound call to a third party is the 403 under test -- so the
    # moment the gate breaks, or anyone mutation-tests it, the handler runs
    # and dials out with a garbage token. "Safe only while the gate works" is
    # not safe; it is the shape that let this repo's suite page production on
    # 2026-08-18. The neighbouring cases above already stub `build_provider`;
    # this copies them.
    monkeypatch.setattr(registry, "build_provider",
                        lambda name, source=None: FakeTokenProvider(label="g1"))
    _free_user(client)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "g1", "token": "t1"})
    assert r.status_code == 403
    # status stays open to any logged-in user regardless of plan.
    assert client.get("/api/j2/notes/connectors/status").status_code == 200


# ── Final-review Important #C: missing NOTE_ENCRYPTION_KEY -> clean 503 ──────

def test_connect_roam_returns_503_not_a_raw_traceback_when_encryption_key_unset(client, monkeypatch):
    """`connections.upsert_connector` is the ONE call site that encrypts the
    stored token -- with `NOTE_ENCRYPTION_KEY` unset it raises a bare
    `crypto_box.CryptoBoxError`, which used to escape as an unhandled 500.
    Must map to the same clean 503 shape `NoteConnNotConfigured` produces
    elsewhere, never a traceback."""
    monkeypatch.delenv("NOTE_ENCRYPTION_KEY", raising=False)
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    assert r.status_code == 503
    body = r.json()
    assert "detail" in body and isinstance(body["detail"], str)
    assert "Traceback" not in body["detail"]
    # The connector must never have been partially persisted.
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["roam"]["connected"] is False


# ── POST /{provider}/connect — device providers (obsidian, Task 5) ──────────
# Neither token-paste nor OAuth-redirect: minting a connect code needs no
# provider stub at all (unlike roam/craft above) -- `obsidian_link.
# mint_connect_code` is pure local HMAC signing, no outbound call, no
# `registry.build_provider` in the request path.

def test_connect_obsidian_not_configured_returns_503_by_default(client):
    """`NOTE_SYNC_OBSIDIAN_ENABLED` is unset in this fixture (deliberately
    dark, docs/feature_flags.json) -- consent alone must not mint a code for
    a door nothing outside this repo can walk through yet."""
    r = client.post("/api/j2/notes/connectors/obsidian/connect", json={"consent": True})
    assert r.status_code == 503
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["obsidian"]["configured"] is False


def test_connect_obsidian_requires_consent(client, monkeypatch):
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")
    r = client.post("/api/j2/notes/connectors/obsidian/connect", json={})
    assert r.status_code == 400


def test_connect_obsidian_mints_a_connect_code_for_the_calling_user(client, monkeypatch):
    from api.services.journal_two.note_connectors import obsidian_link
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")

    r = client.post("/api/j2/notes/connectors/obsidian/connect", json={"consent": True})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["connectCode"], str) and body["connectCode"]
    assert body["expiresInSeconds"] == obsidian_link._CONNECT_CODE_TTL_SECONDS

    # The code is real and scoped to the authenticated caller (u1, per this
    # file's `client` fixture) -- redeeming it (as the plugin eventually
    # would) must attach to THAT user, never a different or blank one.
    device_id, raw_token = obsidian_link.redeem_connect_code(
        body["connectCode"], vault_id="vault-abc", label="Test Vault")
    device = obsidian_link.authenticate_device(raw_token)
    assert device is not None
    assert device["user_id"] == "u1"
    assert device["vault_id"] == "vault-abc"

    # Minting a connect code is NOT connecting -- it creates no
    # `j2_note_connectors`/`j2_note_sources` row, so the status tile must
    # stay in its unconnected state (mirrors the OAuth `_start_oauth` path,
    # which likewise only returns a redirect URL and connects nothing yet).
    st = client.get("/api/j2/notes/connectors/status").json()["providers"]["obsidian"]
    assert st["connected"] is False
    assert st["sources"] == []


def test_connect_obsidian_paid_gate_blocks_free_user(client, monkeypatch):
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")
    _free_user(client)
    r = client.post("/api/j2/notes/connectors/obsidian/connect", json={"consent": True})
    assert r.status_code == 403


def test_connect_obsidian_unknown_provider_still_404s_first(client, monkeypatch):
    """Sanity: the unknown-provider 404 (checked before `entry.connect_kind`
    is ever read) still wins over any device-specific behavior."""
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")
    r = client.post("/api/j2/notes/connectors/not-a-real-provider/connect", json={"consent": True})
    assert r.status_code == 404


# ── POST /{provider}/connect — OAuth providers (notion) ─────────────────────

def test_connect_notion_not_configured_returns_503(client):
    r = client.post("/api/j2/notes/connectors/notion/connect", json={"consent": True})
    assert r.status_code == 503


def test_connect_notion_returns_a_redirect_url_with_signed_state(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    r = client.post("/api/j2/notes/connectors/notion/connect", json={"consent": True})
    assert r.status_code == 200
    url = r.json()["redirectUrl"]
    assert url.startswith("https://api.notion.com/v1/oauth/authorize")
    assert "state=" in url


def test_notion_callback_never_builds_a_provider(client, monkeypatch):
    """Notion's remote_id always resolves from workspaceId/botId, so its
    callback never builds a provider to validate an account (proven here by
    spying on `registry.build_provider` -- Notion's callback must call it
    ZERO times). Written for the OneNote whole-account branch, which was
    archived with OneNote on 2026-11-04; kept as Notion's own rail."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        assert provider == "notion"
        return {"accessToken": "notion-tok", "workspaceId": "ws1", "workspaceName": "My Workspace"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)
    # ⛔ The callback now also kicks off the source's FIRST sync (connect ==
    # import), and that background task legitimately builds a provider. This
    # test is about BRANCH SELECTION -- "notion must not build a provider
    # to validate" -- so the kick-off is neutralised here
    # to keep `build_calls == []` measuring the branch and nothing else.
    # Without this the spy counts a call the branch never made, and the guard
    # stops being able to tell the two apart. The kick-off has its own rail:
    # test_the_oauth_callback_starts_the_first_sync_for_the_source_it_creates.
    monkeypatch.setattr(ns, "_start_initial_sync", lambda *_a, **_k: None)

    build_calls = []
    real_build = registry.build_provider

    def spy_build(name, source=None):
        build_calls.append(name)
        return real_build(name, source)

    monkeypatch.setattr(registry, "build_provider", spy_build)

    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=1" in r.headers["location"]
    assert build_calls == []

    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["notion"]["connected"] is True
    assert st["providers"]["notion"]["sources"][0]["remoteId"] == "ws1"


# ── GET /{provider}/callback (OAuth) ─────────────────────────────────────────

def test_callback_missing_code_or_state_400(client):
    r = client.get("/api/j2/notes/connectors/notion/callback")
    assert r.status_code == 400


def test_callback_tampered_state_400(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    from api.routers.note_sync import _sign_state
    good = _sign_state("u1", "notion")
    tampered = good[:-4] + "abcd"
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": tampered}, follow_redirects=False)
    assert r.status_code == 400


def test_callback_non_ascii_state_signature_fails_cleanly_not_a_500(client, monkeypatch):
    """`_verify_state`'s `compare_digest` call had the identical str-vs-str
    shape as `obsidian_link.py`'s connect-code/device-token checks (fixed the
    same day, same file family) -- `state` arrives as a raw URL query value
    on this shared Notion/Evernote OAuth callback, and a malformed
    one can decode (base64 + `.decode("utf-8")`) into a `sig` half
    containing a non-ASCII character. Before the byte-safety fix,
    `hmac.compare_digest` on two `str` raised `TypeError` (not a clean
    False) the instant either side was non-ASCII -- an uncaught 500, not the
    clean 400 every other malformed state gets. Must fail against
    unfixed code (a `str`-vs-`str` compare_digest call)."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import base64
    import time as _time
    ts = str(int(_time.time()))
    nonce = "non-ascii-sig-test-nonce"
    payload = f"u1:notion:{ts}:{nonce}"
    # Never a valid hex digest either way -- the point is that a non-ASCII
    # `sig` must compare false like any other bad signature, not crash.
    bad_sig = "é" * 64
    state = base64.urlsafe_b64encode(f"{payload}:{bad_sig}".encode("utf-8")).decode("utf-8")
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 400, r.text


def test_callback_expired_state_400(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    import base64
    import hashlib
    import hmac
    import time as _time
    # Hand-build a state carrying a timestamp an hour in the past (well past
    # the 10-min TTL) using the router's OWN signing algorithm (incl. its
    # nonce field), rather than mutating the process-global `time` module
    # (which would leak into every other test sharing this interpreter).
    ts = str(int(_time.time()) - 3600)
    nonce = "expired-test-nonce"
    payload = f"u1:notion:{ts}:{nonce}"
    sig = hmac.new(ns._state_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    state = base64.urlsafe_b64encode(f"{payload}:{sig}".encode("utf-8")).decode("utf-8")
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 400


def test_callback_state_for_a_different_provider_is_rejected(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    other_state = ns._sign_state("u1", "evernote")
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": other_state}, follow_redirects=False)
    assert r.status_code == 400


def test_callback_success_redirects_and_creates_connector_plus_source(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "notion-tok", "workspaceId": "ws1", "workspaceName": "My Workspace"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=1" in r.headers["location"]

    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["notion"]["connected"] is True
    assert len(st["providers"]["notion"]["sources"]) == 1
    assert st["providers"]["notion"]["sources"][0]["remoteId"] == "ws1"


def test_callback_success_redirect_param_matches_the_shipped_frontends_self_heal(client, monkeypatch):
    """Task 12's `ConnectedAppsCard.jsx` (already shipped) only self-heals on
    `params.get('connected') === '1'` — pins the EXACT querystring contract,
    not just "contains connected=1 somewhere"."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    from urllib.parse import urlsplit, parse_qs
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "notion-tok", "workspaceId": "ws1", "workspaceName": "My Workspace"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    qs = parse_qs(urlsplit(r.headers["location"]).query)
    assert qs["connector"] == ["notion"]
    assert qs["connected"] == ["1"]


def test_callback_provider_error_redirects_with_status_error_not_500(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        raise errors.NoteConnAuthError("notion rejected the code")

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=0" in r.headers["location"]
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["notion"]["connected"] is False


# ── Fix-round-1 Important #2: OAuth callback session binding + replay ────────

def test_callback_cross_user_state_is_rejected(client, monkeypatch):
    """A state minted for user2 must NEVER complete inside user1's browser
    session — the reviewer's probe found exactly this landed the connector
    on the wrong account."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state_for_user2 = ns._sign_state("user2", "notion")

    # This client's session dependency override (from the `client` fixture)
    # is "u1" -- a genuinely DIFFERENT user completing user2's state.
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state_for_user2}, follow_redirects=False)
    assert r.status_code == 400
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["notion"]["connected"] is False


def test_callback_with_no_session_is_rejected(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    from api.middleware import auth_middleware as authmw
    state = ns._sign_state("u1", "notion")

    client._app.dependency_overrides[authmw.get_current_user_optional] = lambda: None
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 400


def test_callback_replayed_state_is_rejected_on_second_use(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "notion-tok", "workspaceId": "ws1", "workspaceName": "My Workspace"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r1 = client.get("/api/j2/notes/connectors/notion/callback",
                     params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r1.status_code == 302
    assert "connected=1" in r1.headers["location"]

    r2 = client.get("/api/j2/notes/connectors/notion/callback",
                     params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r2.status_code == 400


def test_a_cross_device_callback_explains_what_happened_and_how_to_finish(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    from api.middleware import auth_middleware as authmw
    state = ns._sign_state("u1", "notion")
    # The other device has no session at all.
    client._app.dependency_overrides[authmw.get_current_user_optional] = lambda: None
    r = client.get("/api/j2/notes/connectors/notion/callback",
                   params={"code": "c", "state": state}, follow_redirects=False)
    assert r.status_code == 400 and r.headers["content-type"].startswith("text/html")
    assert "same browser where you pressed Connect" in r.text
    assert "section=connections&amp;connector=notion&amp;connected=0&amp;reason=oauth_state" in r.text
    assert "u1" not in r.text and state not in r.text
    assert "<script" not in r.text
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["notion"]["connected"] is False


def test_every_state_failure_renders_the_same_page(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    import base64
    import hashlib
    import hmac
    import time as _time
    from api.middleware import auth_middleware as authmw

    def get(state):
        return client.get("/api/j2/notes/connectors/notion/callback",
                          params={"code": "c", "state": state}, follow_redirects=False)

    tampered = ns._sign_state("u1", "notion")[:-4] + "abcd"
    payload = f"u1:notion:{int(_time.time()) - 3600}:expired-nonce"
    sig = hmac.new(ns._state_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    expired = base64.urlsafe_b64encode(f"{payload}:{sig}".encode("utf-8")).decode("utf-8")
    cross_user = ns._sign_state("user2", "notion")

    pages = [get(tampered), get(expired), get(cross_user)]

    good = ns._sign_state("u1", "notion")
    client._app.dependency_overrides[authmw.get_current_user_optional] = lambda: None
    pages.append(get(good))  # no session
    client._app.dependency_overrides[authmw.get_current_user_optional] = lambda: {"id": "u1", "role": "member"}

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "t", "workspaceId": "ws1", "workspaceName": "W"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)
    replay = ns._sign_state("u1", "notion")
    assert get(replay).status_code == 302
    pages.append(get(replay))  # replayed

    for p in pages:
        assert p.status_code == 400 and p.headers["content-type"].startswith("text/html")
    assert len({p.text for p in pages}) == 1


# ── Fix-round-1 Important #3: OAuth state signing fails closed ───────────────

def test_connect_oauth_fails_closed_with_no_secret_configured(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    monkeypatch.delenv("VOICE_ACTION_SECRET", raising=False)
    r = client.post("/api/j2/notes/connectors/notion/connect", json={"consent": True})
    assert r.status_code == 503


def test_callback_fails_closed_with_no_secret_configured(client, monkeypatch):
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    # Mint the state WHILE a secret is configured (mirrors a real in-flight
    # redirect), then pull the secret before the callback lands.
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    monkeypatch.delenv("VOICE_ACTION_SECRET", raising=False)
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 503


def test_callback_redirects_to_settings_connected_0_when_encryption_key_unset(client, monkeypatch):
    """Final-review Important #C fixed the callback path's raw 500;
    post-ship polish item #2 revisited the shape of THAT fix: the callback
    is a top-level browser GET completing the user's own OAuth redirect
    (never an XHR), so a 503 JSON body here would render as a raw error
    page mid-flow instead of landing the user back on Settings. Same
    misconfig (`NOTE_ENCRYPTION_KEY` unset), same "nothing got connected"
    outcome -- surfaced as a redirect now, matching every other
    connect-time failure this endpoint already redirects on
    (`errors.NoteConnError`, above this test in the file). The
    TOKEN-connect path (`_connect_token_provider`, an XHR call site) is
    unaffected and keeps its 503 JSON -- see
    `test_connect_roam_returns_503_not_a_raw_traceback_when_encryption_key_unset`."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    monkeypatch.delenv("NOTE_ENCRYPTION_KEY", raising=False)
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "notion-tok", "workspaceId": "ws1", "workspaceName": "My Workspace"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    location = r.headers["location"]
    assert location.endswith("/settings?section=connections&connector=notion&connected=0")
    # `connected=0` (never `1`) matters concretely, not just as a string:
    # the shipped frontend self-heal effect (ConnectedAppsCard.jsx) is a
    # no-op unless `connected == '1'` -- this redirect must never trip it
    # into believing Notion connected when the connector row was never
    # written.
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["notion"]["connected"] is False
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["notion"]["connected"] is False


# ── DELETE /{provider} (disconnect cascade) ───────────────────────────────────

def test_disconnect_keeps_notes_and_severs_sources(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    client.post("/api/j2/notes/connectors/roam/connect",
                json={"consent": True, "graphName": "my-graph", "token": "tok"})

    from api.services.journal_two import notes as notes_svc
    notes_svc.import_confirm("u1", {
        "source": "roam", "destFolderId": None,
        "notes": [{"importKey": "roam:my-graph/p1", "title": "Kept Note",
                   "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": []}],
    })

    r = client.delete("/api/j2/notes/connectors/roam")
    assert r.status_code == 200
    assert r.json()["disconnected"] is True

    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["roam"]["connected"] is False
    assert st["providers"]["roam"]["sources"] == []

    kept = notes_svc.list_notes("u1")
    assert any(n["title"] == "Kept Note" for n in kept)  # spared, per delete_connector's contract


def test_disconnect_not_connected_404(client):
    r = client.delete("/api/j2/notes/connectors/roam")
    assert r.status_code == 404


def test_disconnect_paid_gate_403(client):
    _free_user(client)
    r = client.delete("/api/j2/notes/connectors/roam")
    assert r.status_code == 403


# ── POST /sources/{id}/sync (manual) ──────────────────────────────────────────

def test_manual_sync_fires_the_engine_with_the_right_args(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    calls = []

    async def fake_sync_source(sid, *, full=False, manual=False, member=False):
        calls.append((sid, full, manual, member))
        return {"status": "ok", "sourceId": sid, "created": 0, "updated": 0, "skipped": 0}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)

    r2 = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync")
    assert r2.status_code == 200
    assert calls == [(source_id, False, True, True)]

    r3 = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync?full=true")
    assert calls[-1] == (source_id, True, True, True)


def test_manual_sync_background_returns_immediately(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    started = asyncio.Event()

    async def fake_sync_source(sid, *, full=False, manual=False, member=False):
        started.set()
        return {"status": "ok"}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)

    r2 = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync?background=true")
    assert r2.status_code == 200
    assert r2.json() == {"status": "started", "background": True}


# ── Plan D: Sync now busy/409, status fields, camelCase log ───────────────────

def _connect_roam(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                    json={"consent": True, "graphName": "my-graph", "token": "tok"})
    return r.json()["source"]["id"]


def _insert_log(source_id, *, finished_at, failures_json, created=0, updated=0, skipped=0,
                status="ok"):
    conn = auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_note_sync_log (source_id, user_id, started_at, finished_at, status, "
            "notes_created, notes_updated, notes_skipped, media_uploaded, conflicts, source_deleted, "
            "failures_json) VALUES (?, 'u1', 's', ?, ?, ?, ?, ?, NULL, 0, NULL, ?)",
            (source_id, finished_at, status, created, updated, skipped, failures_json),
        )
        conn.commit()
    finally:
        conn.close()


def test_manual_sync_on_a_busy_source_is_a_fast_409(client, monkeypatch):
    source_id = _connect_roam(client, monkeypatch)

    async def fake_sync_source(sid, *, full=False, manual=False, member=False):
        return {"status": "busy", "sourceId": sid}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)
    r = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync?full=1")
    assert r.status_code == 409 and r.json()["detail"] == note_sync_router.BUSY_DETAIL
    assert note_sync_router.BUSY_DETAIL == (
        "A sync is already running for this source. Its results will appear here when it finishes.")


def test_background_sync_on_a_busy_source_is_409_and_schedules_nothing(client, monkeypatch):
    source_id = _connect_roam(client, monkeypatch)
    calls = []

    async def fake_sync_source(sid, *, full=False, manual=False, member=False):
        calls.append(sid)
        return {"status": "ok"}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)
    monkeypatch.setattr(engine, "is_source_busy", lambda sid: True)
    r = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync?background=1")
    assert r.status_code == 409 and r.json()["detail"] == note_sync_router.BUSY_DETAIL
    assert calls == []


def test_background_sync_passes_member_true_and_survives_a_busy_result(client, monkeypatch):
    source_id = _connect_roam(client, monkeypatch)
    calls = []

    async def fake_sync_source(sid, *, full=False, manual=False, member=False):
        calls.append((sid, full, manual, member))
        return {"status": "busy", "sourceId": sid}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)
    monkeypatch.setattr(engine, "is_source_busy", lambda sid: False)

    async def drive():
        # Call the route coroutine on a loop we own, so the detached task is
        # awaited deterministically (TestClient may tear its loop down first).
        out = await note_sync_router.sync_source_now(
            source_id, full=True, background=True, user={"id": "u1", "plan": "pro"})
        for _ in range(100):
            if calls:
                break
            await asyncio.sleep(0.01)
        await asyncio.sleep(0)  # let the task finish after the busy result
        return out

    out = asyncio.run(drive())
    assert out == {"status": "started", "background": True}
    assert len(calls) == 1  # a vacuous all([]) cannot satisfy this
    assert calls[0] == (source_id, True, True, True)


def test_status_sources_carry_pending_removal_and_last_failure_count(client, monkeypatch):
    source_id = _connect_roam(client, monkeypatch)
    conn = auth_db.get_connection()
    try:
        for rid in ("r1", "r2"):
            conn.execute(
                "INSERT INTO j2_note_remote_index (user_id, source_id, remote_id, import_key, seen_at, "
                "miss_streak) VALUES ('u1', ?, ?, ?, 't', 1)", (source_id, rid, "k" + rid))
        conn.commit()
    finally:
        conn.close()
    _insert_log(source_id, finished_at="t1", failures_json=json.dumps([{"noteTitle": "old"}]))
    _insert_log(source_id, finished_at="t2", failures_json=json.dumps([
        {"noteTitle": "a", "reason": "x"}, {"noteTitle": "b", "reason": "y"}, {"noteTitle": "c", "reason": "z"}]))
    status = client.get("/api/j2/notes/connectors/status").json()
    src = status["providers"]["roam"]["sources"][0]
    assert src["pendingRemoval"] == 2 and src["lastFailureCount"] == 3
    assert set(src["counts"]) == {"notesCreated", "notesUpdated", "notesSkipped",
                                  "mediaUploaded", "conflicts", "sourceDeleted"}


def test_status_sources_default_pending_removal_and_failure_count_to_zero(client, monkeypatch):
    _connect_roam(client, monkeypatch)
    src = client.get("/api/j2/notes/connectors/status").json()["providers"]["roam"]["sources"][0]
    assert src["pendingRemoval"] == 0 and src["lastFailureCount"] == 0
    assert src["lastFailuresUnreadable"] is False


def test_status_unreadable_latest_failures_are_unknown_never_zero(client, monkeypatch):
    """An unreadable newest `failures_json` is NOT "no failures": the count is
    null (unknown) and `lastFailuresUnreadable` says why, so the card keeps a
    path to the log's "couldn't be read" line."""
    source_id = _connect_roam(client, monkeypatch)
    _insert_log(source_id, finished_at="t1", failures_json="{not json")
    src = client.get("/api/j2/notes/connectors/status").json()["providers"]["roam"]["sources"][0]
    assert src["lastFailureCount"] is None
    assert src["lastFailuresUnreadable"] is True


def test_status_only_the_newest_row_decides_unreadable(client, monkeypatch):
    source_id = _connect_roam(client, monkeypatch)
    _insert_log(source_id, finished_at="t1", failures_json="{not json")
    _insert_log(source_id, finished_at="t2", failures_json=json.dumps([{"noteTitle": "a", "reason": "x"}]))
    src = client.get("/api/j2/notes/connectors/status").json()["providers"]["roam"]["sources"][0]
    assert src["lastFailureCount"] == 1 and src["lastFailuresUnreadable"] is False


def test_source_log_rows_are_camelcase_with_failures_parsed(client, monkeypatch):
    source_id = _connect_roam(client, monkeypatch)
    _insert_log(source_id, finished_at="t1", failures_json=None)
    _insert_log(source_id, finished_at="t2", created=1, updated=2, skipped=3, failures_json=json.dumps([
        {"noteTitle": "Trip", "reason": "Image couldn't be copied", "name": "a.heic", "extra": "dropped"}]))
    rows = client.get(f"/api/j2/notes/connectors/sources/{source_id}/log?limit=5").json()["rows"]
    assert isinstance(rows[0].pop("id"), int)
    assert rows[0] == {"at": "t2", "status": "ok", "created": 1, "updated": 2, "skipped": 3,
                       "conflicts": 0, "sourceDeleted": 0, "adopted": 0, "failuresUnreadable": False,
                       "failures": [{"noteTitle": "Trip", "reason": "Image couldn't be copied",
                                     "name": "a.heic"}]}
    assert rows[1]["failures"] == [] and rows[1]["failuresUnreadable"] is False
    assert not any("_" in k for k in rows[0])


def test_source_log_marks_unreadable_failures_instead_of_reporting_none(client, monkeypatch):
    source_id = _connect_roam(client, monkeypatch)
    _insert_log(source_id, finished_at="t1", failures_json="{not json")
    _insert_log(source_id, finished_at="t2", failures_json=json.dumps([{"noteTitle": 5, "reason": "r"}]))
    rows = client.get(f"/api/j2/notes/connectors/sources/{source_id}/log").json()["rows"]
    assert rows[0]["failuresUnreadable"] is False
    assert rows[0]["failures"] == [{"noteTitle": "Untitled note", "reason": "r", "name": None}]
    assert rows[1]["failures"] == [] and rows[1]["failuresUnreadable"] is True


def test_manual_sync_unknown_source_404(client):
    r = client.post("/api/j2/notes/connectors/sources/does-not-exist/sync")
    assert r.status_code == 404


def test_manual_sync_paid_gate_403(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]
    _free_user(client)
    r2 = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync")
    assert r2.status_code == 403


# ── PUT /sources/{id} ──────────────────────────────────────────────────────────

def test_update_source_toggle_sync_enabled(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    r2 = client.put(f"/api/j2/notes/connectors/sources/{source_id}", json={"syncEnabled": False})
    assert r2.status_code == 200
    assert r2.json()["syncEnabled"] is False


def test_update_source_unknown_404(client):
    r = client.put("/api/j2/notes/connectors/sources/nope", json={"syncEnabled": False})
    assert r.status_code == 404


# ── GET /sources/{id}/log ──────────────────────────────────────────────────────

def test_source_log_open_to_any_logged_in_user(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    r2 = client.get(f"/api/j2/notes/connectors/sources/{source_id}/log")
    assert r2.status_code == 200
    assert r2.json()["rows"] == []


def test_source_log_unknown_source_404(client):
    r = client.get("/api/j2/notes/connectors/sources/nope/log")
    assert r.status_code == 404


# ── POST /{provider}/sources (add an additional source) ──────────────────────

def test_add_source_requires_existing_connector(client):
    r = client.post("/api/j2/notes/connectors/notion/sources", json={"remoteId": "ws-2"})
    assert r.status_code == 409


def test_add_source_creates_an_additional_source(client, monkeypatch):
    # simulate an already-connected Notion connector (bypassing the real OAuth dance)
    connections.upsert_connector("u1", "notion", {"accessToken": "tok"})

    r = client.post("/api/j2/notes/connectors/notion/sources", json={"remoteId": "ws-2"})
    assert r.status_code == 200
    assert r.json()["source"]["remoteId"] == "ws-2"

    st = client.get("/api/j2/notes/connectors/status").json()
    assert len(st["providers"]["notion"]["sources"]) == 1


# ── The 2026-11-04 archive: Dropbox, OneNote and OneDrive are gone ───────────

@pytest.mark.parametrize("name", ["dropbox", "onenote", "onedrive"])
def test_an_archived_provider_has_no_connect_or_callback_door(client, name):
    assert client.post(f"/api/j2/notes/connectors/{name}/connect", json={"consent": True}).status_code == 404
    r = client.get(f"/api/j2/notes/connectors/{name}/callback",
                   params={"code": "c", "state": "s"}, follow_redirects=False)
    assert r.status_code == 404
    assert client.post(f"/api/j2/notes/connectors/{name}/sources", json={"remoteId": "x"}).status_code == 404


@pytest.mark.parametrize("name", ["dropbox", "onedrive", "notion"])
def test_the_folder_picker_route_is_gone(client, name):
    """`GET /{provider}/folders` served only Dropbox and OneDrive; it left with them."""
    assert client.get(f"/api/j2/notes/connectors/{name}/folders").status_code in (404, 405)


def _stored_archived_source(provider="dropbox"):
    """A connector + source row a member could only have from before the archive (none exist in
    production: the providers were never configured). Written straight through `connections`."""
    connections.upsert_connector("u1", provider, {"accessToken": "old"}, account_label="Old")
    return connections.create_source("u1", provider, "/team notes", display_name="Team notes")


def test_status_survives_a_stored_archived_provider_row_and_leaves_it_out(client):
    src = _stored_archived_source()
    r = client.get("/api/j2/notes/connectors/status")
    assert r.status_code == 200
    assert "dropbox" not in r.json()["providers"]
    # never deleted: the rows are still there
    assert connections.get_source("u1", src["id"]) is not None
    assert connections.get_connector("u1", "dropbox") is not None


def test_disconnect_of_an_archived_provider_is_a_404_and_deletes_nothing(client):
    src = _stored_archived_source()
    assert client.delete("/api/j2/notes/connectors/dropbox").status_code == 404
    assert connections.get_source("u1", src["id"]) is not None
    assert connections.get_connector("u1", "dropbox") is not None


def test_manual_sync_of_an_archived_provider_source_is_a_clean_error_not_a_500(client):
    src = _stored_archived_source("onenote")
    r = client.post(f"/api/j2/notes/connectors/sources/{src['id']}/sync")
    assert r.status_code == 503
    assert connections.get_source("u1", src["id"]) is not None


def _sync_log_rows(source_id):
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM j2_note_sync_log WHERE source_id = ?",
                            (source_id,)).fetchone()[0]
    finally:
        conn.close()


@pytest.mark.parametrize("loop", ["due", "nightly"])
async def test_a_loop_skips_an_archived_provider_source_through_the_real_pass(client, monkeypatch, caplog, loop):
    """The hourly and nightly loops run the REAL `sync_source` here. An archived provider's
    source is skipped before any pass: the provider factory is never asked for it, no
    `j2_note_sync_log` row is written, no error is stamped on the row, the row is not deleted,
    nothing is raised into the scheduler, and one warning names it."""
    archived = _stored_archived_source("onedrive")
    before = connections.get_source("u1", archived["id"])
    built = []

    def spy_factory(name, source=None):
        built.append(name)
        raise errors.NoteConnNotConfigured(f"unknown provider {name!r}")

    monkeypatch.setattr(engine, "_provider_factory", spy_factory)
    row = connections.get_source("u1", archived["id"])
    monkeypatch.setattr(connections, "list_due_sources", lambda _interval: [row])
    monkeypatch.setattr(connections, "list_all_sources", lambda: [row])
    caplog.set_level("WARNING", logger="note_connectors.engine")

    if loop == "due":
        await engine.sync_due_sources()
    else:
        await engine.sync_all_active_sources_full()

    assert built == []
    assert _sync_log_rows(archived["id"]) == 0
    assert connections.get_source("u1", archived["id"]) == before
    assert any("was archived" in r.getMessage() and archived["id"] in r.getMessage()
               for r in caplog.records)


async def test_the_due_and_nightly_loops_still_sync_the_next_source(client, monkeypatch):
    """The skip is a `continue`, not a stop: the live source after the archived one still syncs
    in both loops."""
    archived = _stored_archived_source("onedrive")
    connections.upsert_connector("u1", "roam", {"graphName": "g", "graphToken": "t"})
    live = connections.create_source("u1", "roam", "g", display_name="g")

    synced = []

    async def fake_sync_source(source_id, **kw):
        synced.append(source_id)
        return {"status": "ok"}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)
    both = [connections.get_source("u1", archived["id"]), connections.get_source("u1", live["id"])]
    monkeypatch.setattr(connections, "list_due_sources", lambda _interval: list(both))
    monkeypatch.setattr(connections, "list_all_sources", lambda: list(both))
    await engine.sync_due_sources()
    await engine.sync_all_active_sources_full()

    assert synced == [live["id"], live["id"]]


async def test_a_direct_pass_of_an_archived_provider_source_raises_in_the_taxonomy_and_keeps_the_row(client):
    """Belt: a direct `sync_source` (what a member's Sync now runs) fails inside the error
    taxonomy (`NoteConnNotConfigured`, the 503 above), and the row survives."""
    src = _stored_archived_source("dropbox")
    with pytest.raises(errors.NoteConnNotConfigured):
        await engine.sync_source(src["id"], manual=True)
    assert connections.get_source("u1", src["id"]) is not None
