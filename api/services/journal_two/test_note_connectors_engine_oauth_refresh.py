"""Tests for the engine-level OAuth token-refresh wiring --
`engine.py::_resolve_credentials` (msgraph fix-round-1 review, Important #1).

`oauth.refresh_if_needed` is lock-guarded and PERSISTING (via
`connections.upsert_connector`); `_resolve_credentials` routes every
provider `oauth.py` registers through it before a pass. Written for the
Microsoft Graph providers (rotating refresh tokens); those were archived on
2026-11-04, and the same wiring still serves Notion, so the cases below now
use Notion with an expiring token:

  (a) a near-expiry stored token triggers a refresh BEFORE the provider's own
      `list_changed` is ever called with credentials.
  (b) the refresh PERSISTS -- re-reading via `connections.get_token`
      independently of the sync call returns the NEW rotated refresh_token.
  (c) a provider with no `expiresAt` (Notion's usual shape -- tokens don't
      expire) is a NO-OP: no refresh call, credentials pass through
      unchanged.
  (d) a provider `oauth.py` doesn't register (Roam's pasted token) never
      touches this path either.

No live HTTP calls: `oauth._post_token` (the one chokepoint every token
request goes through — see `oauth.py`'s own module docstring) is monkeypatched
directly rather than mocking httpx, since this suite tests the WIRING (does a
refresh happen, does it persist, does it skip when it shouldn't) — the token
endpoint's actual wire shape (JSON body, HTTP Basic credentials) is already
covered by `test_note_connectors_notion.py`.

DB isolation mirrors `test_note_connectors_engine.py`'s own `db` fixture
exactly (monkeypatch `auth_db._DB_PATH` to a temp file; every module resolves
it live via `auth_db.get_connection()`, no reload needed).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine, errors, oauth
from api.services.journal_two.note_connectors.providers.base import AccountInfo, NoteProvider


@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    monkeypatch.setenv("NOTION_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "test-client-secret")
    # oauth.py holds module-level per-(user,provider) locks; a stale lock
    # object from a PRIOR test's event loop would belong to a different
    # asyncio loop -- clear defensively.
    oauth._refresh_locks.clear()
    import api.services.journal_two.note_connectors.connections as conns
    return conns


class _CredsCapturingProvider(NoteProvider):
    """A minimal fake provider that only ever needs to prove WHICH
    credentials dict it was handed — this suite is about the engine's
    credential-resolution step, not sync mechanics (already covered by
    `test_note_connectors_engine.py`'s much fuller `FakeProvider`)."""

    name = "fake"

    def __init__(self) -> None:
        self.seen_credentials: list[dict] = []

    async def validate(self, credentials):
        return AccountInfo(label="x")

    async def list_changed(self, credentials, cursor=None):
        self.seen_credentials.append(dict(credentials))
        return []

    async def fetch(self, credentials, ref):
        raise AssertionError("not used in this suite")

    async def fetch_media(self, credentials, ref):
        raise AssertionError("not used in this suite")


def _stored_token(*, expires_in=None, refresh_token="refresh-abc", access_token="access-old"):
    tok = {"accessToken": access_token, "refreshToken": refresh_token}
    if expires_in is not None:
        tok["expiresAt"] = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    return tok


def _fake_post_token(monkeypatch, *, access_token, refresh_token):
    """Replaces oauth.py's ONE low-level HTTP chokepoint so this suite never
    makes a real network call, while still exercising `refresh_if_needed`'s
    real lock/persist logic end to end."""
    calls = {"n": 0}

    async def fake(cfg, provider, client_id, client_secret, body, *, is_refresh, client):
        calls["n"] += 1
        assert is_refresh is True
        assert body.get("grant_type") == "refresh_token"
        return {"access_token": access_token, "refresh_token": refresh_token, "expires_in": 3600}

    monkeypatch.setattr(oauth, "_post_token", fake)
    return calls


# ---------------------------------------------------------------------------
# (a) a near-expiry token triggers a refresh BEFORE the provider call.
# ---------------------------------------------------------------------------


async def test_near_expiry_token_refreshes_before_list_changed(db, monkeypatch):
    db.upsert_connector("u1", "notion", _stored_token(expires_in=-30))  # already expired
    source = db.create_source("u1", "notion", "workspace-1")

    calls = _fake_post_token(monkeypatch, access_token="access-new", refresh_token="refresh-new")
    fake_provider = _CredsCapturingProvider()
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: fake_provider)

    result = await engine.sync_source(source["id"], manual=True)

    assert result["status"] == "ok"
    assert calls["n"] == 1, "the near-expiry token must trigger exactly one refresh"
    assert len(fake_provider.seen_credentials) == 1
    # list_changed must see the REFRESHED token -- proving the refresh ran
    # BEFORE the provider was ever handed credentials.
    assert fake_provider.seen_credentials[0]["accessToken"] == "access-new"


async def test_a_fresh_far_from_expiry_token_never_triggers_a_refresh_call(db, monkeypatch):
    db.upsert_connector("u1", "notion", _stored_token(expires_in=3600, access_token="access-fresh"))
    source = db.create_source("u1", "notion", "workspace-1")

    calls = _fake_post_token(monkeypatch, access_token="should-never-be-used", refresh_token="x")
    fake_provider = _CredsCapturingProvider()
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: fake_provider)

    await engine.sync_source(source["id"], manual=True)

    assert calls["n"] == 0
    assert fake_provider.seen_credentials[0]["accessToken"] == "access-fresh"


# ---------------------------------------------------------------------------
# (b) the refresh PERSISTS -- proven via an INDEPENDENT connections.get_token
#     read, not just the credentials dict the provider happened to see.
# ---------------------------------------------------------------------------


async def test_refresh_persists_the_rotated_refresh_token(db, monkeypatch):
    db.upsert_connector("u1", "notion", _stored_token(expires_in=-30, refresh_token="refresh-old"))
    source = db.create_source("u1", "notion", "workspace-1")

    _fake_post_token(monkeypatch, access_token="access-new", refresh_token="refresh-rotated")
    fake_provider = _CredsCapturingProvider()
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: fake_provider)

    await engine.sync_source(source["id"], manual=True)

    stored = db.get_token("u1", "notion")
    assert stored["accessToken"] == "access-new"
    # The ROTATED refresh_token, never the stale one: had this NOT persisted,
    # the next sync tick would present "refresh-old", which a rotating token
    # endpoint already invalidated when it issued "refresh-rotated".
    assert stored["refreshToken"] == "refresh-rotated"


# ---------------------------------------------------------------------------
# (c) a non-expiring provider (Notion's real shape) is a no-op.
# ---------------------------------------------------------------------------


async def test_notion_shaped_token_with_no_expiry_is_a_refresh_no_op(db, monkeypatch):
    # Real Notion OAuth tokens never expire -- the stored credential
    # legitimately carries no `expiresAt` at all.
    db.upsert_connector("u1", "notion", {"accessToken": "notion-access", "refreshToken": "notion-refresh"})
    source = db.create_source("u1", "notion", "workspace-1")

    calls = _fake_post_token(monkeypatch, access_token="should-never-be-used", refresh_token="x")
    fake_provider = _CredsCapturingProvider()
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: fake_provider)

    await engine.sync_source(source["id"], manual=True)

    assert calls["n"] == 0, "a token with no expiresAt must never trigger a refresh call"
    assert fake_provider.seen_credentials[0]["accessToken"] == "notion-access"
    stored = db.get_token("u1", "notion")
    assert stored["accessToken"] == "notion-access"  # unchanged


# ---------------------------------------------------------------------------
# (d) a provider oauth.py doesn't register never touches this path.
# ---------------------------------------------------------------------------


async def test_roam_pasted_token_never_touches_the_refresh_path(db, monkeypatch):
    """Roam/Craft are "token" connect_kind, not OAuth at all -- credentials
    are a pasted graph token with no accessToken/refreshToken/expiresAt
    shape whatsoever. `_resolve_credentials` must not choke on that shape."""
    db.upsert_connector("u1", "roam", {"token": "roam-graph-token"})
    source = db.create_source("u1", "roam", "my-graph")

    calls = _fake_post_token(monkeypatch, access_token="should-never-be-used", refresh_token="x")
    fake_provider = _CredsCapturingProvider()
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: fake_provider)

    await engine.sync_source(source["id"], manual=True)

    assert calls["n"] == 0
    assert fake_provider.seen_credentials[0]["token"] == "roam-graph-token"


def test_is_registered_matches_the_provider_family_this_wiring_depends_on():
    assert oauth.is_registered("notion") is True
    assert oauth.is_registered("dropbox") is False  # archived 2026-11-04
    assert oauth.is_registered("onenote") is False  # archived 2026-11-04
    assert oauth.is_registered("onedrive") is False  # archived 2026-11-04
    assert oauth.is_registered("roam") is False
    assert oauth.is_registered("craft") is False


# ---------------------------------------------------------------------------
# Not-connected-at-all shape (no regression on the pre-existing contract).
# ---------------------------------------------------------------------------


async def test_no_connected_credentials_still_raises_not_configured(db, monkeypatch):
    source = db.create_source("u1", "notion", "workspace-1")  # never connected
    fake_provider = _CredsCapturingProvider()
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: fake_provider)

    with pytest.raises(errors.NoteConnNotConfigured):
        await engine.sync_source(source["id"], manual=True)

    assert fake_provider.seen_credentials == []
