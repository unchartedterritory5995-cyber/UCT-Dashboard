"""Tests for the shared Microsoft Graph OAuth wiring in `note_connectors.oauth`
(Task 1 of the `2026-08-12-note-connectors-msgraph` plan).

`oauth.py` grows a `token_request_style`/`credentials_in` branch on
`_OAuthProviderConfig` so ONE `_post_token` serves both Notion's original
shape (JSON body, HTTP Basic client credentials) and Microsoft Graph's
documented shape (form-encoded body, client_id/secret merged INTO the
body). No live calls anywhere: every HTTP interaction goes through
`httpx.AsyncClient(transport=httpx.MockTransport(handler))`, mirroring
`test_note_connectors_notion.py`'s convention exactly. `pytest.ini`'s
`asyncio_mode = auto` means `async def test_*` needs no explicit marker.

Sections:
  1. Form-encoded token POST — client_id/secret travel in the BODY, correct
     Content-Type, no Basic auth header.
  2. `configured("onenote")`/`configured("onedrive")` — true iff BOTH
     `MSGRAPH_CLIENT_ID`/`MSGRAPH_CLIENT_SECRET` are set.
  3. `authorize_url` shape — common Microsoft endpoint + per-provider scope
     + the derived `/{provider}/callback` redirect.
  4. Refresh rotation persists the NEW refresh_token (reuses the existing
     Notion lock-dedupe test shape from `test_note_connectors_notion.py`).
  5. CONTROL: Notion's JSON+Basic token POST is unaffected by the new
     branch — this is the regression proof that `_post_token` growing a
     shape parameter didn't silently move Notion's own wire behavior.
  6. Unconfigured-inert — import-clean with no env, `NotConnNotConfigured`
     raised (never a bare KeyError) when called against an unconfigured
     Microsoft Graph provider.
"""

from __future__ import annotations

import asyncio
import importlib
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, parse_qsl, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import errors


# ---------------------------------------------------------------------------
# 1. Form-encoded token POST (Microsoft Graph shape).
# ---------------------------------------------------------------------------

async def test_exchange_code_onenote_posts_form_encoded_with_credentials_in_body(monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    from api.services.journal_two.note_connectors import oauth as oauth_mod

    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["content_type"] = request.headers.get("content-type", "")
        seen["auth_header"] = request.headers.get("authorization")
        seen["body"] = dict(parse_qsl(request.content.decode("utf-8")))
        return httpx.Response(200, json={"access_token": "tok-1", "refresh_token": "ref-1"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    creds = await oauth_mod.exchange_code("onenote", "auth-code-1", client=client)

    assert seen["url"] == oauth_mod._MSGRAPH_TOKEN_URL
    assert seen["content_type"].startswith("application/x-www-form-urlencoded")
    # Credentials travel in the body -- never a Basic auth header for
    # Microsoft Graph (its token endpoint documents this contract).
    assert seen["auth_header"] is None
    assert seen["body"]["client_id"] == "cid"
    assert seen["body"]["client_secret"] == "csecret"
    assert seen["body"]["grant_type"] == "authorization_code"
    assert seen["body"]["code"] == "auth-code-1"
    assert creds == {"accessToken": "tok-1", "refreshToken": "ref-1"}


async def test_exchange_code_onedrive_also_form_encoded(monkeypatch):
    """Same shared MSGraph shape for onedrive -- proves it isn't onenote-only."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    from api.services.journal_two.note_connectors import oauth as oauth_mod

    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["content_type"] = request.headers.get("content-type", "")
        seen["body"] = dict(parse_qsl(request.content.decode("utf-8")))
        return httpx.Response(200, json={"access_token": "tok-od"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await oauth_mod.exchange_code("onedrive", "code-2", client=client)

    assert seen["content_type"].startswith("application/x-www-form-urlencoded")
    assert seen["body"]["client_id"] == "cid"
    assert seen["body"]["client_secret"] == "csecret"


async def test_exchange_code_onedrive_normalizes_expires_in_to_expiresAt(monkeypatch):
    """Fix-round-1 review confirmation: a Microsoft Graph token response
    carrying `expires_in` produces `expiresAt` in the stored credentials.
    `_normalize_token_response` already does this GENERICALLY (unchanged by
    the fix-round-1 engine wiring), but nothing previously asserted it for
    the msgraph shape specifically -- and it is exactly what lets
    `engine._resolve_credentials` -> `oauth.refresh_if_needed` know WHEN a
    stored OneDrive/OneNote token needs a proactive refresh."""
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    from api.services.journal_two.note_connectors import oauth as oauth_mod

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"access_token": "tok-1", "refresh_token": "ref-1", "expires_in": 3600},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    creds = await oauth_mod.exchange_code("onedrive", "code-1", client=client)

    assert "expiresAt" in creds
    parsed = datetime.fromisoformat(creds["expiresAt"])
    delta = parsed - datetime.now(timezone.utc)
    # ~1h out; generous slack for wall-clock time spent running the test.
    assert timedelta(minutes=55) < delta < timedelta(minutes=65)


# ---------------------------------------------------------------------------
# 2. configured() -- true iff BOTH MSGRAPH env vars are set.
# ---------------------------------------------------------------------------

def test_configured_true_iff_both_msgraph_env_vars_set(monkeypatch):
    from api.services.journal_two.note_connectors import oauth as oauth_mod

    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_SECRET", raising=False)
    assert oauth_mod.configured("onenote") is False
    assert oauth_mod.configured("onedrive") is False

    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    assert oauth_mod.configured("onenote") is False  # only one of the two set
    assert oauth_mod.configured("onedrive") is False

    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    assert oauth_mod.configured("onenote") is False  # the OTHER one set alone
    assert oauth_mod.configured("onedrive") is False

    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    assert oauth_mod.configured("onenote") is True
    assert oauth_mod.configured("onedrive") is True


# ---------------------------------------------------------------------------
# 3. authorize_url shape.
# ---------------------------------------------------------------------------

def test_authorize_url_onenote_shape(monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("DASHBOARD_URL", "https://example.test")
    from api.services.journal_two.note_connectors import oauth as oauth_mod

    url = oauth_mod.authorize_url("onenote", "signed-state-xyz")
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?")

    qs = parse_qs(urlsplit(url).query)
    assert qs["client_id"] == ["cid"]
    assert qs["state"] == ["signed-state-xyz"]
    assert qs["response_type"] == ["code"]
    assert qs["response_mode"] == ["query"]
    assert qs["scope"] == ["openid offline_access User.Read Notes.Read"]
    assert qs["redirect_uri"] == ["https://example.test/api/j2/notes/connectors/onenote/callback"]


def test_authorize_url_onedrive_scope_and_redirect(monkeypatch):
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "cid")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("DASHBOARD_URL", "https://example.test")
    from api.services.journal_two.note_connectors import oauth as oauth_mod

    url = oauth_mod.authorize_url("onedrive", "state-1")
    qs = parse_qs(urlsplit(url).query)
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?")
    assert qs["scope"] == ["openid offline_access User.Read Files.Read"]
    assert qs["response_mode"] == ["query"]
    assert qs["redirect_uri"] == ["https://example.test/api/j2/notes/connectors/onedrive/callback"]


def test_authorize_url_raises_not_configured_when_msgraph_env_missing(monkeypatch):
    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_SECRET", raising=False)
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    with pytest.raises(errors.NoteConnNotConfigured):
        oauth_mod.authorize_url("onenote", "some-state")


# ---------------------------------------------------------------------------
# 4. Refresh rotation persists the NEW refresh_token (reuses the Notion
#    lock-dedupe test shape from test_note_connectors_notion.py).
# ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("MSGRAPH_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("MSGRAPH_CLIENT_SECRET", "test-client-secret")
    import api.services.crypto_box as cb
    importlib.reload(cb)
    import api.services.journal_two.note_connectors.connections as conns
    importlib.reload(conns)
    import api.services.journal_two.note_connectors.oauth as oauth_mod
    importlib.reload(oauth_mod)
    # oauth.py holds module-level per-(user,provider) locks; a stale lock
    # object from a PRIOR test's reload would be a different asyncio event
    # loop's lock -- reload clears it (same precedent as the Notion suite).
    oauth_mod._refresh_locks.clear()
    return conns, oauth_mod


def _stored_token(*, expires_in=None, refresh_token="refresh-abc"):
    tok = {"accessToken": "access-1", "refreshToken": refresh_token}
    if expires_in is not None:
        tok["expiresAt"] = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    return tok


async def test_two_concurrent_refresh_calls_on_expired_onenote_token_post_exactly_once(db):
    conns, oauth_mod = db
    conns.upsert_connector("u1", "onenote", _stored_token(expires_in=-30))  # already expired

    post_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        post_count["n"] += 1
        assert request.headers.get("content-type", "").startswith("application/x-www-form-urlencoded")
        body = dict(parse_qsl(request.content.decode("utf-8")))
        assert body["grant_type"] == "refresh_token"
        assert body["refresh_token"] == "refresh-abc"
        assert body["client_id"] == "test-client-id"
        assert body["client_secret"] == "test-client-secret"
        return httpx.Response(200, json={"access_token": "access-2", "refresh_token": "refresh-def"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    results = await asyncio.gather(
        oauth_mod.refresh_if_needed("u1", "onenote", client=client),
        oauth_mod.refresh_if_needed("u1", "onenote", client=client),
    )

    assert post_count["n"] == 1, "concurrent refreshes on the SAME expired token must POST exactly once"
    assert results[0]["accessToken"] == "access-2"
    assert results[1]["accessToken"] == "access-2"
    assert results[0]["refreshToken"] == "refresh-def"
    assert results[1]["refreshToken"] == "refresh-def"

    # Persisted for future calls too -- the ROTATED pair, not the old one.
    stored = conns.get_token("u1", "onenote")
    assert stored["accessToken"] == "access-2"
    assert stored["refreshToken"] == "refresh-def"


async def test_refresh_onedrive_persists_new_refresh_token_single_call(db):
    conns, oauth_mod = db
    conns.upsert_connector("u1", "onedrive", _stored_token(expires_in=-10, refresh_token="old-refresh"))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"access_token": "access-new", "refresh_token": "new-refresh"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await oauth_mod.refresh_if_needed("u1", "onedrive", client=client)

    assert result["accessToken"] == "access-new"
    assert result["refreshToken"] == "new-refresh"
    stored = conns.get_token("u1", "onedrive")
    assert stored["refreshToken"] == "new-refresh"  # the NEW token, not "old-refresh"


# ---------------------------------------------------------------------------
# 5. CONTROL: Notion's JSON+Basic token POST is unaffected.
# ---------------------------------------------------------------------------

async def test_control_notion_token_post_is_still_json_with_basic_auth(monkeypatch):
    """The generalization that makes onenote/onedrive form-encoded must be
    byte-identical no-op for Notion's own defaults (`token_request_style`
    defaults to "json", `credentials_in` defaults to "basic"). This is the
    regression proof named in the task brief."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    import base64 as b64mod
    import json as jsonmod

    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["content_type"] = request.headers.get("content-type")
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = jsonmod.loads(request.content)
        return httpx.Response(200, json={"access_token": "tok-1", "bot_id": "bot-1"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    creds = await oauth_mod.exchange_code("notion", "auth-code-1", client=client)

    assert seen["content_type"] == "application/json"
    expected_basic = "Basic " + b64mod.b64encode(b"cid:csecret").decode()
    assert seen["auth"] == expected_basic
    # Credentials arrive ONLY via the Basic header -- the generalization
    # must never additionally duplicate them into the JSON body.
    assert "client_id" not in seen["body"]
    assert "client_secret" not in seen["body"]
    assert seen["body"]["grant_type"] == "authorization_code"
    assert creds["accessToken"] == "tok-1"


# ---------------------------------------------------------------------------
# 6. Unconfigured-inert.
# ---------------------------------------------------------------------------

def test_oauth_module_imports_cleanly_with_no_msgraph_env(monkeypatch):
    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_SECRET", raising=False)
    import api.services.journal_two.note_connectors.oauth as oauth_mod
    importlib.reload(oauth_mod)  # must not raise
    assert oauth_mod.configured("onenote") is False
    assert oauth_mod.configured("onedrive") is False
    # onenote/onedrive are known providers (registered in _PROVIDERS) --
    # unlike a truly unknown name, "unconfigured" is the only reason
    # configured() is False here.
    assert "onenote" in oauth_mod._PROVIDERS
    assert "onedrive" in oauth_mod._PROVIDERS


async def test_exchange_code_onenote_raises_not_configured_when_env_missing(monkeypatch):
    monkeypatch.delenv("MSGRAPH_CLIENT_ID", raising=False)
    monkeypatch.delenv("MSGRAPH_CLIENT_SECRET", raising=False)
    from api.services.journal_two.note_connectors import oauth as oauth_mod
    with pytest.raises(errors.NoteConnNotConfigured):
        await oauth_mod.exchange_code("onenote", "some-code")
