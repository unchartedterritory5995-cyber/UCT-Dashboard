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
    # Notion/Dropbox/OneDrive stay "not configured" by default (no env
    # creds) -- individual OAuth tests set these explicitly.
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("DROPBOX_APP_KEY", raising=False)
    monkeypatch.delenv("DROPBOX_APP_SECRET", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_SECRET", raising=False)

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

def test_status_open_to_logged_in_and_lists_all_six_providers(client):
    r = client.get("/api/j2/notes/connectors/status")
    assert r.status_code == 200
    body = r.json()
    assert set(body["providers"].keys()) == {"roam", "craft", "notion", "dropbox", "onenote", "onedrive"}
    assert body["providers"]["roam"]["configured"] is True   # token providers always available
    assert body["providers"]["notion"]["configured"] is False  # no env creds in this fixture
    assert body["providers"]["roam"]["connected"] is False
    assert body["providers"]["roam"]["sources"] == []


def test_status_onenote_configured_matrix_follows_msgraph_env(client, monkeypatch):
    """Task 7 (msgraph wave): `onenote` is dark until `MSGRAPH_CLIENT_ID` +
    `MSGRAPH_CLIENT_SECRET` are BOTH set -- the same env pair `onedrive`
    shares (one Azure app registration backs both providers)."""
    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["onenote"]["configured"] is False
    assert st["providers"]["onenote"]["connectKind"] == "oauth"
    assert st["providers"]["onenote"]["connected"] is False

    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "mcid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "mcsecret")
    st2 = client.get("/api/j2/notes/connectors/status").json()
    assert st2["providers"]["onenote"]["configured"] is True


def test_status_onedrive_configured_matrix_follows_msgraph_env(client, monkeypatch):
    """Task 3 (msgraph wave): `onedrive` is dark until `MSGRAPH_CLIENT_ID` +
    `MSGRAPH_CLIENT_SECRET` are BOTH set -- same env pair `onenote` shares
    (one Azure app registration backs both providers)."""
    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["onedrive"]["configured"] is False
    assert st["providers"]["onedrive"]["connectKind"] == "oauth"
    assert st["providers"]["onedrive"]["connected"] is False

    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "mcid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "mcsecret")
    st2 = client.get("/api/j2/notes/connectors/status").json()
    assert st2["providers"]["onedrive"]["configured"] is True


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


# ── OneNote (Task 7, msgraph wave): real registry entry + whole-account ──────
# ── auto-source (Notion pattern), unlike OneDrive/Dropbox's sourceless-then- ──
# ── folder-picker shape ────────────────────────────────────────────────────
#
# `registry._REGISTRY["onenote"]` is now a REAL, permanent row (Task 7 lands
# it) -- these tests exercise it directly rather than installing a throwaway
# `ProviderEntry` the way Task 1's tests had to before it existed.

def test_connect_onenote_not_configured_returns_503(client):
    r = client.post("/api/j2/notes/connectors/onenote/connect", json={"consent": True})
    assert r.status_code == 503


def test_connect_onenote_requires_consent(client):
    r = client.post("/api/j2/notes/connectors/onenote/connect", json={})
    assert r.status_code == 400


def test_connect_onenote_returns_a_redirect_url_to_microsoft(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")

    r = client.post("/api/j2/notes/connectors/onenote/connect", json={"consent": True})
    assert r.status_code == 200
    url = r.json()["redirectUrl"]
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    assert "state=" in url
    assert "Notes.Read" in url


def test_connect_onenote_paid_gate_blocks_free_user(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    _free_user(client)
    r = client.post("/api/j2/notes/connectors/onenote/connect", json={"consent": True})
    assert r.status_code == 403


def test_callback_onenote_exchange_error_redirects_with_status_error_not_500(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
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


# ── Task 7's core subtlety: OneNote must land with EXACTLY ONE whole-account ─
# ── source after OAuth -- never Dropbox/OneDrive's sourceless-connector shape ─

def test_callback_onenote_auto_creates_exactly_one_whole_account_source(client, monkeypatch):
    """OneNote's OAuth token response carries no workspace/bot id (that
    vocabulary is Notion's alone -- `_normalize_token_response` never
    invents one for Microsoft Graph), so the generic branch's
    `creds.get("workspaceId") or creds.get("botId")` is always None for it.
    Left there, OneNote would land connected-but-sourceless with NO folder
    picker to complete it (OneNote is deliberately excluded from
    `_FOLDER_PICKER_PROVIDERS`) -- a dead end. The callback must derive a
    stable remote_id (here, via `provider.validate()`'s `AccountInfo.raw`)
    and auto-create exactly one source, mirroring Notion/Roam/Craft."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "onenote")

    async def fake_exchange_code(provider, code, **kw):
        assert provider == "onenote"
        return {"accessToken": "msgraph-tok"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)
    fake = FakeTokenProvider(label="Patrick")  # AccountInfo(label=...) with raw=None
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.get("/api/j2/notes/connectors/onenote/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=1" in r.headers["location"]

    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["onenote"]["connected"] is True
    sources = st["providers"]["onenote"]["sources"]
    assert len(sources) == 1
    # No real Graph account id available (raw=None) -- falls back to the
    # documented "me" sentinel rather than leaving remote_id None/sourceless.
    assert sources[0]["remoteId"] == "me"
    assert st["providers"]["onenote"]["accountLabel"] == "Patrick"
    assert fake.validate_calls == [{"accessToken": "msgraph-tok"}]


def test_callback_onenote_remote_id_prefers_the_real_graph_account_id(client, monkeypatch):
    """When `validate()`'s `AccountInfo.raw["id"]` IS available (the normal
    case -- `MSGraphClient.validate` always populates it from `GET /me`),
    the real Microsoft account id is used instead of the "me" sentinel, and
    the account's own display name flows into `accountLabel`."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    from api.services.journal_two.note_connectors.providers.base import AccountInfo
    state = ns._sign_state("u1", "onenote")

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "msgraph-tok"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    class FakeGraphProvider(FakeTokenProvider):
        async def validate(self, credentials):
            self.validate_calls.append(credentials)
            return AccountInfo(label="Patrick B", raw={"id": "ms-account-42"})

    fake = FakeGraphProvider()
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.get("/api/j2/notes/connectors/onenote/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302

    st = client.get("/api/j2/notes/connectors/status").json()
    sources = st["providers"]["onenote"]["sources"]
    assert len(sources) == 1
    assert sources[0]["remoteId"] == "ms-account-42"
    assert st["providers"]["onenote"]["accountLabel"] == "Patrick B"


def test_callback_onenote_validate_error_redirects_with_status_error_not_500(client, monkeypatch):
    """A token that exchanges fine but fails `validate()` (e.g. rejected on
    the very next call) must redirect `connected=0` -- same shape as an
    exchange failure or Dropbox's own `validate()` failure -- and must
    never leave a half-connected connector behind."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "onenote")

    async def fake_exchange_code(provider, code, **kw):
        return {"accessToken": "msgraph-tok"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)
    fake = FakeTokenProvider(raise_on_validate=errors.NoteConnAuthError("token rejected"))
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.get("/api/j2/notes/connectors/onenote/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=0" in r.headers["location"]
    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["onenote"]["connected"] is False
    assert st["providers"]["onenote"]["sources"] == []


def test_notion_callback_never_takes_the_onenote_whole_account_branch(client, monkeypatch):
    """Notion's remote_id always resolves from workspaceId/botId, so the
    `_MSGRAPH_WHOLE_ACCOUNT_PROVIDERS` branch added for OneNote must never
    fire for it (proven here by spying on `registry.build_provider` --
    Notion's callback must call it ZERO times) -- guards against the new
    branch accidentally widening to cover more than OneNote."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "notion")

    async def fake_exchange_code(provider, code, **kw):
        assert provider == "notion"
        return {"accessToken": "notion-tok", "workspaceId": "ws1", "workspaceName": "My Workspace"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

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


# ── OneDrive (Task 3, msgraph wave): registry entry + folder-picker + ────────
# ── connect flow — mirrors the Dropbox precedent exactly ─────────────────────

class FakeFolderProvider(FakeTokenProvider):
    """`FakeTokenProvider` plus the folder-picker's own extra method (not
    part of the abstract `NoteProvider` contract) -- used for both Dropbox
    and OneDrive's `GET /{provider}/folders` here since the router dispatch
    is identical for both (`provider_obj.list_folders`)."""

    def __init__(self, *, label="Fake Graph", folders=None, raise_on_list_folders=None):
        super().__init__(label=label)
        self._folders = folders if folders is not None else []
        self._raise_on_list_folders = raise_on_list_folders
        self.list_folders_calls: list[tuple[Any, str]] = []

    async def list_folders(self, credentials, path=""):
        self.list_folders_calls.append((credentials, path))
        if self._raise_on_list_folders is not None:
            raise self._raise_on_list_folders
        return self._folders


def test_connect_onedrive_not_configured_returns_503(client):
    r = client.post("/api/j2/notes/connectors/onedrive/connect", json={"consent": True})
    assert r.status_code == 503


def test_connect_onedrive_requires_consent(client):
    r = client.post("/api/j2/notes/connectors/onedrive/connect", json={})
    assert r.status_code == 400


def test_connect_onedrive_returns_a_redirect_url_to_microsoft(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    r = client.post("/api/j2/notes/connectors/onedrive/connect", json={"consent": True})
    assert r.status_code == 200
    url = r.json()["redirectUrl"]
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    assert "state=" in url
    assert "Files.Read" in url


def test_connect_onedrive_paid_gate_blocks_free_user(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    _free_user(client)
    r = client.post("/api/j2/notes/connectors/onedrive/connect", json={"consent": True})
    assert r.status_code == 403


def test_callback_onedrive_creates_connector_with_no_auto_source(client, monkeypatch):
    """Dropbox pattern (spec §7/§8): OneDrive's connector is created by the
    callback, but the SOURCE is picked separately via the folder picker +
    `POST /{provider}/sources` -- unlike Notion/Roam/Craft/OneNote, where the
    connector IS the one implicit source. The generic OAuth path (Task 1)
    already produces this for free: `_normalize_token_response` only ever
    sets `workspaceName`/`workspaceId`/`botId` for Notion's own response
    shape, so `remote_id` is `None` for OneDrive without any per-provider
    code in the router."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "onedrive")

    calls = []

    async def fake_exchange_code(provider, code, **kw):
        calls.append((provider, code))
        return {"accessToken": "msgraph-tok"}

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r = client.get("/api/j2/notes/connectors/onedrive/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=1" in r.headers["location"]
    assert calls == [("onedrive", "authcode")]

    st = client.get("/api/j2/notes/connectors/status").json()
    assert st["providers"]["onedrive"]["connected"] is True
    assert st["providers"]["onedrive"]["sources"] == []  # no auto-source


def test_callback_onedrive_provider_error_redirects_with_status_error_not_500(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    import api.routers.note_sync as ns
    state = ns._sign_state("u1", "onedrive")

    async def fake_exchange_code(provider, code, **kw):
        raise errors.NoteConnAuthError("microsoft rejected the code")

    monkeypatch.setattr(ns.oauth, "exchange_code", fake_exchange_code)

    r = client.get("/api/j2/notes/connectors/onedrive/callback",
                    params={"code": "authcode", "state": state}, follow_redirects=False)
    assert r.status_code == 302
    assert "connected=0" in r.headers["location"]
    assert client.get("/api/j2/notes/connectors/status").json()["providers"]["onedrive"]["connected"] is False


# ── GET /{provider}/folders — Dropbox precedent generalized to OneDrive ──────

def test_folders_notion_still_404(client):
    """The folder picker is DELIBERATELY scoped to providers whose sync unit
    is a picked folder (Dropbox, OneDrive) -- Notion/Roam/Craft/OneNote sync
    a whole workspace/graph/account and must keep 404ing here."""
    r = client.get("/api/j2/notes/connectors/notion/folders")
    assert r.status_code == 404


def test_folders_roam_still_404(client):
    r = client.get("/api/j2/notes/connectors/roam/folders")
    assert r.status_code == 404


def test_folders_onenote_still_404(client, monkeypatch):
    """OneNote is whole-account (Notion's shape) -- unlike its msgraph
    sibling OneDrive, it must never get a folder-picker route, configured
    or not."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    r = client.get("/api/j2/notes/connectors/onenote/folders")
    assert r.status_code == 404


def test_folders_dropbox_not_connected_409(client, monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "secret")
    r = client.get("/api/j2/notes/connectors/dropbox/folders")
    assert r.status_code == 409


def test_folders_dropbox_returns_the_providers_list_folders_result(client, monkeypatch):
    """Regression control: the Dropbox folder-picker path this task
    generalizes must stay green alongside the new OneDrive branch."""
    monkeypatch.setenv("DROPBOX_APP_KEY", "key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "secret")
    connections.upsert_connector("u1", "dropbox", {"accessToken": "tok"})
    fake = FakeFolderProvider(folders=[{"path_lower": "/team", "name": "Team"}])
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.get("/api/j2/notes/connectors/dropbox/folders")
    assert r.status_code == 200
    assert r.json() == {"folders": [{"path_lower": "/team", "name": "Team"}]}
    assert fake.list_folders_calls == [({"accessToken": "tok"}, "")]
    assert fake.aclose_calls == 1


def test_folders_onedrive_not_connected_409(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    r = client.get("/api/j2/notes/connectors/onedrive/folders")
    assert r.status_code == 409


def test_folders_onedrive_returns_the_providers_list_folders_result(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    connections.upsert_connector("u1", "onedrive", {"accessToken": "tok"})
    fake = FakeFolderProvider(folders=[{"id": "item-sub", "name": "sub"}])
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.get("/api/j2/notes/connectors/onedrive/folders")
    assert r.status_code == 200
    assert r.json() == {"folders": [{"id": "item-sub", "name": "sub"}]}
    assert fake.list_folders_calls == [({"accessToken": "tok"}, "")]
    assert fake.aclose_calls == 1


def test_folders_onedrive_drills_into_a_nested_path(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    connections.upsert_connector("u1", "onedrive", {"accessToken": "tok"})
    fake = FakeFolderProvider(folders=[])
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.get("/api/j2/notes/connectors/onedrive/folders", params={"path": "item-sub"})
    assert r.status_code == 200
    assert fake.list_folders_calls == [({"accessToken": "tok"}, "item-sub")]


def test_folders_onedrive_provider_error_maps_through_shared_taxonomy(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    connections.upsert_connector("u1", "onedrive", {"accessToken": "tok"})
    fake = FakeFolderProvider(raise_on_list_folders=errors.NoteConnRateLimited("rate limited"))
    monkeypatch.setattr(registry, "build_provider", lambda name, source=None: fake)

    r = client.get("/api/j2/notes/connectors/onedrive/folders")
    assert r.status_code == 429
    assert fake.aclose_calls == 1  # aclose must still run in the `finally` on a raised error


def test_folders_onedrive_paid_gate_403(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    connections.upsert_connector("u1", "onedrive", {"accessToken": "tok"})
    _free_user(client)
    r = client.get("/api/j2/notes/connectors/onedrive/folders")
    assert r.status_code == 403


# ── POST /onedrive/sources (folder pick -> folder-scoped source) ─────────────

def test_add_onedrive_source_requires_existing_connector(client):
    r = client.post("/api/j2/notes/connectors/onedrive/sources", json={"remoteId": "FOLDER-ID"})
    assert r.status_code == 409


def test_add_onedrive_source_creates_a_folder_scoped_source(client, monkeypatch):
    """Mirrors `test_add_source_creates_an_additional_source` (Dropbox) --
    `POST /{provider}/sources` is already provider-generic (no dropbox-only
    branch), so a picked OneDrive folder id becomes the source's `remoteId`
    with zero router changes beyond the folders allow-list."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    connections.upsert_connector("u1", "onedrive", {"accessToken": "tok"})

    r = client.post("/api/j2/notes/connectors/onedrive/sources",
                     json={"remoteId": "FOLDER-ITEM-ID", "displayName": "Team Notes"})
    assert r.status_code == 200
    assert r.json()["source"]["remoteId"] == "FOLDER-ITEM-ID"

    st = client.get("/api/j2/notes/connectors/status").json()
    assert len(st["providers"]["onedrive"]["sources"]) == 1
    assert st["providers"]["onedrive"]["sources"][0]["remoteId"] == "FOLDER-ITEM-ID"


def test_add_onedrive_source_paid_gate_403(client, monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    connections.upsert_connector("u1", "onedrive", {"accessToken": "tok"})
    _free_user(client)
    r = client.post("/api/j2/notes/connectors/onedrive/sources", json={"remoteId": "FOLDER-ID"})
    assert r.status_code == 403
