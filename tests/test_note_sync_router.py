"""HTTP-level tests for the note-connectors router — `/api/j2/notes/connectors/*`.

Spins up a minimal FastAPI app with just the note_sync router (mirrors
`tests/test_broker_router.py`'s pattern — a standalone app + auth dependency
overrides is faster and more isolated than booting the full `api.main.app`,
and exercises the exact same concerns: consent gate, paid-plan gate, DB
isolation), against a temp auth.db.
"""

from __future__ import annotations

import asyncio

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
    # Notion/Dropbox stay "not configured" by default (no env creds) --
    # individual OAuth tests set these explicitly.
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("DROPBOX_APP_KEY", raising=False)
    monkeypatch.delenv("DROPBOX_APP_SECRET", raising=False)

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

def test_status_open_to_logged_in_and_lists_all_four_providers(client):
    r = client.get("/api/j2/notes/connectors/status")
    assert r.status_code == 200
    body = r.json()
    assert set(body["providers"].keys()) == {"roam", "craft", "notion", "dropbox"}
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
        "mediaUploaded": 0, "conflicts": 0,
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
            "notes_created, notes_updated, notes_skipped, media_uploaded, conflicts) "
            "VALUES (?, 'u1', 't2', 't2', 'ok', 0, 5, 1, 2, 3)",
            (source_id,),
        )
        conn.commit()
    finally:
        conn.close()

    st = client.get("/api/j2/notes/connectors/status").json()
    counts = st["providers"]["roam"]["sources"][0]["counts"]
    assert counts == {
        "notesCreated": 0, "notesUpdated": 5, "notesSkipped": 1,
        "mediaUploaded": 2, "conflicts": 3,
    }


# ── POST /{provider}/connect — token providers (roam/craft) ─────────────────

def test_connect_requires_consent(client):
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"graphName": "g1", "token": "t1"})
    assert r.status_code == 400


def test_connect_unknown_provider_404(client):
    r = client.post("/api/j2/notes/connectors/evernote/connect", json={"consent": True})
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


def test_connect_paid_gate_blocks_free_user(client):
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


# ── POST /{provider}/connect — OAuth providers (notion/dropbox) ─────────────

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


# ── Task 1 (msgraph-wave plan): _start_oauth/oauth_callback generalize to  ───
# ── `provider in oauth._PROVIDERS` instead of the literal `== "notion"`.  ───
#
# onenote's own `registry.py` row doesn't land until Task 3/7 of that plan --
# these tests only need to prove THIS router's generic branch (Task 1's own
# scope), so they install a throwaway `ProviderEntry` the same shape Task 3/7
# eventually will, without touching registry.py itself. If a real "onenote"
# row is ever added to `registry._REGISTRY` for real, `monkeypatch.setitem`
# below simply overrides it for the duration of the test and restores
# whatever was there afterward -- never a permanent mutation.

def _install_onenote_registry_entry(monkeypatch):
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    from api.services.journal_two.note_connectors.registry import ProviderEntry

    entry = ProviderEntry(
        "onenote", "OneNote", "oauth", lambda: oauth_mod.configured("onenote"),
        lambda source=None: None,
    )
    monkeypatch.setitem(registry._REGISTRY, "onenote", entry)


def test_connect_onenote_not_configured_returns_503(client, monkeypatch):
    _install_onenote_registry_entry(monkeypatch)
    r = client.post("/api/j2/notes/connectors/onenote/connect", json={"consent": True})
    assert r.status_code == 503


def test_connect_onenote_returns_a_redirect_url_to_microsoft(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    _install_onenote_registry_entry(monkeypatch)

    r = client.post("/api/j2/notes/connectors/onenote/connect", json={"consent": True})
    assert r.status_code == 200
    url = r.json()["redirectUrl"]
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    assert "state=" in url
    assert "Notes.Read" in url


def test_callback_onenote_calls_exchange_code_and_upserts(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    _install_onenote_registry_entry(monkeypatch)
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "onenote")

    calls = []

    async def fake_exchange_code(provider, code, **kw):
        calls.append((provider, code))
        return {"accessToken": "msgraph-tok"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r = client.get("/api/j2/notes/connectors/onenote/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=1" in r.headers["location"]
    assert calls == [("onenote", "authcode")]

    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["onenote"]["connected"] is True


def test_callback_onenote_provider_error_redirects_with_status_error_not_500(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    _install_onenote_registry_entry(monkeypatch)
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "onenote")

    async def fake_exchange_code(provider, code, **kw):
        raise errors.NoteConnAuthError("microsoft rejected the code")

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r = client.get("/api/j2/notes/connectors/onenote/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=0" in r.headers["location"]
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["onenote"]["connected"] is False


def test_notion_connect_and_callback_regression_stays_green_alongside_onenote(client, monkeypatch):
    """The router's generalized `provider in oauth._PROVIDERS` branch now
    covers BOTH notion and onenote -- prove Notion's own connect+callback
    round trip is unaffected when an onenote registry entry is ALSO
    installed in the same process (guards against the branch accidentally
    picking up cross-provider state)."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "mcid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "mcsecret")
    _install_onenote_registry_entry(monkeypatch)

    r = client.post("/api/j2/notes/connectors/notion/connect", json={"consent": True})
    assert r.status_code == 200
    assert r.json()["redirectUrl"].startswith("https://api.notion.com/v1/oauth/authorize")

    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        assert provider == "notion"
        return {"accessToken": "notion-tok", "workspaceId": "ws1", "workspaceName": "My Workspace"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r2 = client.get("/api/j2/notes/connectors/notion/callback",
                     params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r2.status_code == 302
    assert "connected=1" in r2.headers["location"]

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
    dropbox_state = ns._sign_state("u1", "dropbox")
    r = client.get("/api/j2/notes/connectors/notion/callback",
                    params={"code": "authcode", "state": dropbox_state}, follow_redirects=False)
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
    assert location.endswith("/settings?connector=notion&connected=0")
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


# ── Fix-round-1 Important #5: Dropbox best-effort revoke on disconnect ───────

def test_disconnect_dropbox_calls_revoke_with_the_stored_credentials(client, monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "secret")
    connections.upsert_connector("u1", "dropbox", {"accessToken": "dbx-tok-abc"})

    calls = []

    async def fake_revoke_token(credentials, **kw):
        calls.append(credentials)

    import api.services.journal_two.note_connectors.providers.dropbox as dbx_module
    monkeypatch.setattr(dbx_module, "revoke_token", fake_revoke_token)

    r = client.delete("/api/j2/notes/connectors/dropbox")
    assert r.status_code == 200
    assert r.json()["disconnected"] is True
    assert calls == [{"accessToken": "dbx-tok-abc"}]


def test_disconnect_dropbox_succeeds_even_when_revoke_fails(client, monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "secret")
    connections.upsert_connector("u1", "dropbox", {"accessToken": "dbx-tok-abc"})

    async def failing_revoke_token(credentials, **kw):
        raise errors.NoteConnTransient("Dropbox revoke endpoint unreachable")

    import api.services.journal_two.note_connectors.providers.dropbox as dbx_module
    monkeypatch.setattr(dbx_module, "revoke_token", failing_revoke_token)

    r = client.delete("/api/j2/notes/connectors/dropbox")
    assert r.status_code == 200
    assert r.json()["disconnected"] is True
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["dropbox"]["connected"] is False


def test_disconnect_roam_never_calls_dropbox_revoke(client, monkeypatch):
    """Revoke is Dropbox-only by design (Roam/Craft = user-managed tokens,
    Notion = no revoke endpoint) -- proves the router doesn't accidentally
    fire it for every provider."""
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    client.post("/api/j2/notes/connectors/roam/connect",
                json={"consent": True, "graphName": "my-graph", "token": "tok"})

    calls = []

    async def spy_revoke_token(credentials, **kw):
        calls.append(credentials)

    import api.services.journal_two.note_connectors.providers.dropbox as dbx_module
    monkeypatch.setattr(dbx_module, "revoke_token", spy_revoke_token)

    r = client.delete("/api/j2/notes/connectors/roam")
    assert r.status_code == 200
    assert calls == []


# ── POST /sources/{id}/sync (manual) ──────────────────────────────────────────

def test_manual_sync_fires_the_engine_with_the_right_args(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    calls = []

    async def fake_sync_source(sid, *, full=False, manual=False):
        calls.append((sid, full, manual))
        return {"status": "ok", "sourceId": sid, "created": 0, "updated": 0, "skipped": 0}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)

    r2 = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync")
    assert r2.status_code == 200
    assert calls == [(source_id, False, True)]

    r3 = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync?full=true")
    assert calls[-1] == (source_id, True, True)


def test_manual_sync_background_returns_immediately(client, monkeypatch):
    fake = FakeTokenProvider(label="my-graph")
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)
    r = client.post("/api/j2/notes/connectors/roam/connect",
                     json={"consent": True, "graphName": "my-graph", "token": "tok"})
    source_id = r.json()["source"]["id"]

    started = asyncio.Event()

    async def fake_sync_source(sid, *, full=False, manual=False):
        started.set()
        return {"status": "ok"}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)

    r2 = client.post(f"/api/j2/notes/connectors/sources/{source_id}/sync?background=true")
    assert r2.status_code == 200
    assert r2.json() == {"status": "started", "background": True}


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
    r = client.post("/api/j2/notes/connectors/dropbox/sources", json={"remoteId": "/team notes"})
    assert r.status_code == 409


def test_add_source_creates_an_additional_source(client, monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "secret")
    # simulate an already-connected Dropbox connector (bypassing the real OAuth dance)
    connections.upsert_connector("u1", "dropbox", {"accessToken": "tok"})

    r = client.post("/api/j2/notes/connectors/dropbox/sources", json={"remoteId": "/team notes"})
    assert r.status_code == 200
    assert r.json()["source"]["remoteId"] == "/team notes"

    st = client.get("/api/j2/notes/connectors/status").json()
    assert len(st["providers"]["dropbox"]["sources"]) == 1
