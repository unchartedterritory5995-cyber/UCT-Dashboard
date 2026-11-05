"""Plan E Task 7 -- the Evernote doors on `/api/j2/notes/connectors/*`.

The router half of the Evernote connector: connect (PKCE consent URL), the callback
(code exchange with the verifier derived from the signed state, one whole-account
source), the plan-required reason, and the per-member gate that `admin` mode needs.

No network: `evernote_oauth.exchange_code` and `EvernoteProvider.validate` are replaced
with recorders. The fixture mirrors tests/test_note_sync_router.py's standalone app.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.routers import note_sync as ns
from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, errors, evernote_oauth, registry
from api.services.journal_two.note_connectors.providers.base import AccountInfo
from api.services.journal_two.note_connectors.providers.evernote import EvernoteProvider

NOT_CONFIGURED = "Evernote is not configured on this server."
BASE = "/api/j2/notes/connectors"


def _app(tmp_path, monkeypatch, role: str) -> TestClient:
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "evernote-test-client")
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "admin")
    monkeypatch.setattr(ns, "_start_initial_sync", lambda *_a, **_k: None)

    user = {"id": "u1", "role": role}
    app = FastAPI()
    app.include_router(ns.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {**user, "plan": "pro"}
    app.dependency_overrides[authmw.get_current_user_optional] = lambda: dict(user)
    return TestClient(app)


@pytest.fixture
def client_admin(tmp_path, monkeypatch):
    return _app(tmp_path, monkeypatch, "admin")


@pytest.fixture
def client_member(tmp_path, monkeypatch):
    return _app(tmp_path, monkeypatch, "member")


def _fake_exchange(monkeypatch, *, creds=None):
    calls: list[tuple] = []

    async def fake(code, state, secret, **kw):
        calls.append((code, state, secret))
        return creds or {"accessToken": "ev-at", "refreshToken": "ev-rt",
                         "expiresAt": None, "clientId": "evernote-test-client"}

    monkeypatch.setattr(evernote_oauth, "exchange_code", fake)
    return calls


def _fake_validate(monkeypatch, *, raises=None):
    seen: list[dict] = []

    async def validate(self, credentials):
        seen.append({"creds": credentials, "user_id": self._user_id})
        if raises is not None:
            raise raises
        return AccountInfo(label="Evernote", raw={"noteCount": 3})

    monkeypatch.setattr(EvernoteProvider, "validate", validate)
    return seen


def _callback(client, state, **params):
    return client.get(f"{BASE}/evernote/callback",
                      params={"code": "authcode", "state": state, **params},
                      follow_redirects=False)


# ── status ───────────────────────────────────────────────────────────────────

def test_status_hides_evernote_from_members_in_admin_mode(client_member):
    ev = client_member.get(f"{BASE}/status").json()["providers"]["evernote"]
    assert ev["configured"] is False


def test_status_shows_evernote_to_admin_in_admin_mode(client_admin):
    ev = client_admin.get(f"{BASE}/status").json()["providers"]["evernote"]
    assert ev["configured"] is True
    assert ev["connectKind"] == "oauth"


def test_status_shows_evernote_to_members_when_on(client_member, monkeypatch):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "1")
    assert client_member.get(f"{BASE}/status").json()["providers"]["evernote"]["configured"] is True


def test_status_hides_evernote_from_admin_when_off(client_admin, monkeypatch):
    monkeypatch.delenv("NOTE_SYNC_EVERNOTE_ENABLED")
    assert client_admin.get(f"{BASE}/status").json()["providers"]["evernote"]["configured"] is False


# ── connect ──────────────────────────────────────────────────────────────────

def test_connect_returns_pkce_authorize_url(client_admin):
    r = client_admin.post(f"{BASE}/evernote/connect", json={"consent": True})
    assert r.status_code == 200, r.text
    url = urlparse(r.json()["redirectUrl"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == evernote_oauth.AUTHORIZE_URL
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert q["client_id"] == "evernote-test-client"
    assert q["code_challenge_method"] == "S256"
    assert q["scope"] == "read"
    # The challenge is the one the callback will be able to re-derive from the state alone.
    verifier = evernote_oauth.pkce_verifier(q["state"], ns._state_secret())
    assert q["code_challenge"] == evernote_oauth.pkce_challenge(verifier)
    assert "dropbox" not in r.json()["redirectUrl"]


def test_connect_503_for_member_in_admin_mode(client_member):
    r = client_member.post(f"{BASE}/evernote/connect", json={"consent": True})
    assert r.status_code == 503
    assert r.json()["detail"] == NOT_CONFIGURED


def test_connect_503_reads_the_same_when_off(client_admin, monkeypatch):
    """A member cannot tell "admin-only" from "off": the same 503 text."""
    monkeypatch.delenv("NOTE_SYNC_EVERNOTE_ENABLED")
    r = client_admin.post(f"{BASE}/evernote/connect", json={"consent": True})
    assert r.status_code == 503
    assert r.json()["detail"] == NOT_CONFIGURED


def test_connect_member_allowed_when_on(client_member, monkeypatch):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "1")
    r = client_member.post(f"{BASE}/evernote/connect", json={"consent": True})
    assert r.status_code == 200 and "redirectUrl" in r.json()


# ── callback ─────────────────────────────────────────────────────────────────

def test_callback_exchanges_with_verifier_from_state_and_creates_one_source(client_admin, monkeypatch):
    calls = _fake_exchange(monkeypatch)
    seen = _fake_validate(monkeypatch)
    started: list[str] = []
    monkeypatch.setattr(ns, "_start_initial_sync", started.append)

    url = client_admin.post(f"{BASE}/evernote/connect", json={"consent": True}).json()["redirectUrl"]
    q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    r = _callback(client_admin, q["state"])

    assert r.status_code == 302, r.text
    assert "connector=evernote" in r.headers["location"] and "connected=1" in r.headers["location"]
    # Exchanged with THIS state and the router's own state secret: the verifier it derives
    # answers the challenge the consent URL carried.
    assert len(calls) == 1
    code, state, secret = calls[0]
    assert (code, state, secret) == ("authcode", q["state"], ns._state_secret())
    assert evernote_oauth.pkce_challenge(evernote_oauth.pkce_verifier(state, secret)) == q["code_challenge"]
    assert seen and seen[0]["user_id"] is None and seen[0]["creds"]["accessToken"] == "ev-at"

    conn = connections.get_connector("u1", "evernote")
    assert conn is not None and conn["accountLabel"] == "Evernote"
    assert connections.get_token("u1", "evernote")["refreshToken"] == "ev-rt"
    sources = [s for s in connections.list_sources("u1") if s["provider"] == "evernote"]
    assert len(sources) == 1
    assert sources[0]["remoteId"] == "account" and sources[0]["displayName"] == "Evernote"
    assert started == [sources[0]["id"]]


def test_callback_a_second_connect_keeps_one_source(client_admin, monkeypatch):
    _fake_exchange(monkeypatch)
    _fake_validate(monkeypatch)
    for _ in range(2):
        assert _callback(client_admin, ns._sign_state("u1", "evernote")).status_code == 302
    sources = [s for s in connections.list_sources("u1") if s["provider"] == "evernote"]
    assert len(sources) == 1


def test_callback_state_of_other_user_gets_the_same_failure_page(client_admin, monkeypatch):
    calls = _fake_exchange(monkeypatch)
    other = _callback(client_admin, ns._sign_state("u2", "evernote"))
    bad = _callback(client_admin, "not-a-state")
    assert other.status_code == 400 and bad.status_code == 400
    assert other.text == bad.text
    assert calls == []
    assert connections.get_connector("u1", "evernote") is None
    assert connections.get_connector("u2", "evernote") is None


def test_callback_403_on_validate_redirects_with_evernote_plan_reason(client_admin, monkeypatch):
    _fake_exchange(monkeypatch)
    _fake_validate(monkeypatch, raises=errors.NoteConnAuthError(
        "evernote mcp: access forbidden (403)", status=403, code="evernote_forbidden"))
    r = _callback(client_admin, ns._sign_state("u1", "evernote"))
    assert r.status_code == 302
    loc = r.headers["location"]
    assert "connected=0" in loc and f"reason={ns.EVERNOTE_PLAN_REASON}" in loc
    assert ns.EVERNOTE_PLAN_REASON == "evernote_plan"
    assert connections.get_connector("u1", "evernote") is None


def test_callback_other_validate_error_is_not_the_plan_reason(client_admin, monkeypatch):
    _fake_exchange(monkeypatch)
    _fake_validate(monkeypatch, raises=errors.NoteConnAuthError(
        "evernote mcp: access token rejected (401)", status=401))
    loc = _callback(client_admin, ns._sign_state("u1", "evernote")).headers["location"]
    assert "connected=0" in loc and "evernote_plan" not in loc
    assert connections.get_connector("u1", "evernote") is None


def test_callback_access_denied_with_plan_description_reads_as_plan(client_admin):
    r = client_admin.get(f"{BASE}/evernote/callback", follow_redirects=False, params={
        "error": "access_denied",
        "error_description": "Your Evernote plan does not include MCP access"})
    assert r.status_code == 302 and "reason=evernote_plan" in r.headers["location"]


def test_callback_access_denied_without_plan_description_keeps_the_raw_reason(client_admin):
    r = client_admin.get(f"{BASE}/evernote/callback", follow_redirects=False, params={
        "error": "access_denied", "error_description": "The user cancelled"})
    loc = r.headers["location"]
    assert "reason=access_denied" in loc and "evernote_plan" not in loc


def test_callback_takes_the_evernote_branch_end_to_end(client_admin, monkeypatch):
    """Written as "never falls into the Dropbox branch"; Dropbox was archived on 2026-11-04, so
    what is left to pin is that connect and callback both take Evernote's own PKCE path."""
    _fake_exchange(monkeypatch)
    _fake_validate(monkeypatch)

    url = client_admin.post(f"{BASE}/evernote/connect", json={"consent": True}).json()["redirectUrl"]
    assert url.startswith(evernote_oauth.AUTHORIZE_URL)
    r = _callback(client_admin, ns._sign_state("u1", "evernote"))
    assert r.status_code == 302 and "connected=1" in r.headers["location"]


def test_callback_refused_for_member_in_admin_mode(client_member, monkeypatch):
    """The state is signed, but the flag can change between connect and callback; a member in
    admin mode gets nothing stored and no exchange runs."""
    calls = _fake_exchange(monkeypatch)
    _fake_validate(monkeypatch)
    r = _callback(client_member, ns._sign_state("u1", "evernote"))
    assert r.status_code == 302
    assert "connected=0" in r.headers["location"]
    assert "NOTE_SYNC" not in r.headers["location"]
    assert calls == []
    assert connections.get_connector("u1", "evernote") is None


def _folder_name(user_id: str, folder_id: str | None) -> str | None:
    from api.services.journal_two import notes as notes_svc
    return next((f["name"] for f in notes_svc.list_folders(user_id) if f["id"] == folder_id), None)


def test_callback_default_folder_is_named_exactly_evernote(client_admin, monkeypatch):
    """T7-m1: never "Evernote — Evernote"."""
    _fake_exchange(monkeypatch)
    _fake_validate(monkeypatch)
    assert _callback(client_admin, ns._sign_state("u1", "evernote")).status_code == 302
    src = next(s for s in connections.list_sources("u1") if s["provider"] == "evernote")
    assert _folder_name("u1", src["destFolderId"]) == "Evernote"


def test_callback_folder_name_of_other_providers_is_unchanged(client_admin, monkeypatch):
    """T7-m1 is scoped to Evernote: Notion keeps "<label> — <workspace>"."""
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")

    async def notion_exchange(provider, code, **kw):
        return {"accessToken": "t", "workspaceId": "ws-1", "workspaceName": "Acme"}

    monkeypatch.setattr(ns.oauth, "exchange_code", notion_exchange)
    r = client_admin.get(f"{BASE}/notion/callback", follow_redirects=False,
                         params={"code": "c", "state": ns._sign_state("u1", "notion")})
    assert r.status_code == 302 and "connected=1" in r.headers["location"]
    src = next(s for s in connections.list_sources("u1") if s["provider"] == "notion")
    assert _folder_name("u1", src["destFolderId"]) == "Notion — Acme"


def test_callback_validates_the_new_token_without_a_refresh_hook(client_admin, monkeypatch):
    """T7-m2: the callback's provider has no user, so a 401 on the NEW token can never refresh
    (and rotate) the member's OLD stored connection; validation proves the new token alone."""
    _seed_evernote_source()
    refreshed: list = []

    async def no_refresh(*a, **k):
        refreshed.append((a, k))
        return None

    monkeypatch.setattr(evernote_oauth, "refresh_if_needed", no_refresh)
    _fake_exchange(monkeypatch)
    seen = _fake_validate(monkeypatch)
    assert _callback(client_admin, ns._sign_state("u1", "evernote")).status_code == 302
    assert seen and seen[0]["user_id"] is None
    assert seen[0]["creds"]["accessToken"] == "ev-at"
    assert refreshed == []


def test_callback_rechecks_configured_and_redirects_in_member_words(client_admin, monkeypatch):
    """Nit: the client id vanished between connect and callback. The member sees member words,
    never the env var name or the tool, and nothing is stored. No network: refused before."""
    from urllib.parse import quote
    monkeypatch.delenv("EVERNOTE_CLIENT_ID")
    r = _callback(client_admin, ns._sign_state("u1", "evernote"))
    assert r.status_code == 302
    loc = r.headers["location"]
    assert "connected=0" in loc
    assert "EVERNOTE_CLIENT_ID" not in loc and "evernote_register_client" not in loc
    assert ns.EVERNOTE_UNAVAILABLE_REASON == NOT_CONFIGURED
    assert f"reason={quote(NOT_CONFIGURED)}" in loc
    assert connections.get_connector("u1", "evernote") is None


# ── the other member doors ───────────────────────────────────────────────────

def _seed_evernote_source(user_id="u1"):
    connections.upsert_connector(user_id, "evernote", {"accessToken": "a", "refreshToken": "r"},
                                 account_label="Evernote")
    return connections.create_source(user_id, "evernote", "account", display_name="Evernote")


def test_add_source_503_for_member_in_admin_mode(client_member):
    _seed_evernote_source()
    r = client_member.post(f"{BASE}/evernote/sources", json={"remoteId": "account"})
    assert r.status_code == 503 and r.json()["detail"] == NOT_CONFIGURED


def test_sync_now_503_for_member_in_admin_mode(client_member):
    src = _seed_evernote_source()
    for params in ({}, {"background": "1"}):
        r = client_member.post(f"{BASE}/sources/{src['id']}/sync", params=params)
        assert r.status_code == 503 and r.json()["detail"] == NOT_CONFIGURED


def test_update_source_503_for_member_in_admin_mode(client_member):
    src = _seed_evernote_source()
    r = client_member.put(f"{BASE}/sources/{src['id']}", json={"syncEnabled": False})
    assert r.status_code == 503 and r.json()["detail"] == NOT_CONFIGURED


def test_member_can_still_disconnect_and_read_the_log_in_admin_mode(client_member):
    """Removing a connector and reading its history are never gated: a paused member must be
    able to leave."""
    src = _seed_evernote_source()
    assert client_member.get(f"{BASE}/sources/{src['id']}/log").status_code == 200
    r = client_member.delete(f"{BASE}/evernote")
    assert r.status_code == 200 and r.json()["disconnected"] is True


def test_disconnect_evernote_deletes_connector_and_keeps_notes(client_admin):
    _seed_evernote_source()
    from api.services.journal_two import notes as notes_svc
    notes_svc.import_confirm("u1", {
        "source": "evernote", "destFolderId": None,
        "notes": [{"importKey": "evernote:account/n1", "title": "Kept Evernote Note",
                   "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": []}],
    })
    r = client_admin.delete(f"{BASE}/evernote")
    assert r.status_code == 200 and r.json()["disconnected"] is True
    assert connections.get_connector("u1", "evernote") is None
    st = client_admin.get(f"{BASE}/status").json()["providers"]["evernote"]
    assert st["connected"] is False and st["sources"] == []
    assert any(n["title"] == "Kept Evernote Note" for n in notes_svc.list_notes("u1"))


# ── final review M1: one whole-account source ────────────────────────────────

@pytest.mark.parametrize("remote_id", ["account", "another"])
def test_a_second_evernote_source_is_refused_with_a_clear_message(client_admin, remote_id):
    """Evernote's import keys do not depend on the source, so a second source would sync the same
    notes under the same keys into a second folder with a second delete index."""
    _seed_evernote_source()
    r = client_admin.post(f"{BASE}/evernote/sources", json={"remoteId": remote_id})
    assert r.status_code == 409
    assert r.json()["detail"] == ns.EVERNOTE_ONE_SOURCE
    assert len([s for s in connections.list_sources("u1") if s["provider"] == "evernote"]) == 1


def test_a_first_evernote_source_is_still_created(client_admin):
    connections.upsert_connector("u1", "evernote", {"accessToken": "a", "refreshToken": "r"},
                                 account_label="Evernote")
    r = client_admin.post(f"{BASE}/evernote/sources", json={"remoteId": "account"})
    assert r.status_code == 200
    assert [s["provider"] for s in connections.list_sources("u1")] == ["evernote"]


# ── final review M5: Disconnect revokes the grant at Evernote, best-effort ──────────

def test_disconnect_evernote_revokes_the_stored_grant_before_the_purge(client_admin, monkeypatch):
    _seed_evernote_source()
    calls = []

    async def fake_revoke(creds, **kw):
        calls.append((creds, connections.get_connector("u1", "evernote") is not None))

    monkeypatch.setattr(evernote_oauth, "revoke_token", fake_revoke)
    r = client_admin.delete(f"{BASE}/evernote")
    assert r.status_code == 200 and r.json()["disconnected"] is True
    assert calls == [({"accessToken": "a", "refreshToken": "r"}, True)]   # read before the purge
    assert connections.get_connector("u1", "evernote") is None


def test_disconnect_evernote_succeeds_when_the_revoke_fails(client_admin, monkeypatch):
    _seed_evernote_source()

    async def failing(creds, **kw):
        raise errors.NoteConnTransient("revoke endpoint unreachable")

    monkeypatch.setattr(evernote_oauth, "revoke_token", failing)
    r = client_admin.delete(f"{BASE}/evernote")
    assert r.status_code == 200 and r.json()["disconnected"] is True
    assert connections.get_connector("u1", "evernote") is None


def test_disconnect_evernote_revokes_even_while_the_flag_is_off(client_admin, monkeypatch):
    """Disconnect stays ungated (by design): a member can always cut the grant."""
    _seed_evernote_source()
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "0")
    calls = []

    async def fake_revoke(creds, **kw):
        calls.append(creds)

    monkeypatch.setattr(evernote_oauth, "revoke_token", fake_revoke)
    assert client_admin.delete(f"{BASE}/evernote").status_code == 200
    assert len(calls) == 1


def test_a_hanging_revoke_never_holds_the_disconnect(client_admin, monkeypatch):
    """Final re-review N1: the whole best-effort revoke is bounded (EVERNOTE_REVOKE_BUDGET_S, 10 s
    in production; shortened here so no real 10 s wait), so a hanging Evernote never holds the
    member's Disconnect, and the purge still happens."""
    import asyncio
    import time
    _seed_evernote_source()
    monkeypatch.setattr(ns, "EVERNOTE_REVOKE_BUDGET_S", 0.2)

    async def hangs(creds, **kw):
        await asyncio.sleep(3600)

    monkeypatch.setattr(evernote_oauth, "revoke_token", hangs)
    t0 = time.monotonic()
    r = client_admin.delete(f"{BASE}/evernote")
    assert time.monotonic() - t0 < 5
    assert r.status_code == 200 and r.json()["disconnected"] is True
    assert connections.get_connector("u1", "evernote") is None


def test_the_revoke_budget_is_ten_seconds():
    assert ns.EVERNOTE_REVOKE_BUDGET_S == 10.0


# ── fix round 1 (I3): Sync now never holds the request through a rate-limit wait ─────────

def test_sync_now_for_evernote_always_runs_in_the_background(client_admin, monkeypatch):
    from api.services.journal_two.note_connectors import engine
    src = _seed_evernote_source()
    started: list[dict] = []

    async def fake_sync_source(source_id, **kw):
        started.append({"id": source_id, **kw})
        return {"status": "ok"}

    monkeypatch.setattr(engine, "sync_source", fake_sync_source)
    monkeypatch.setattr(engine, "is_source_busy", lambda sid: False)
    r = client_admin.post(f"{BASE}/sources/{src['id']}/sync", params={"full": "1"})
    # No background=1 asked for: the router chose it, because Evernote opts in to follow-ups.
    assert r.status_code == 200 and r.json() == {"status": "started", "background": True}


def test_the_background_choice_comes_from_the_provider_class():
    assert registry.runs_sync_in_background("evernote") is True
    assert registry.runs_sync_in_background("notion") is False
    assert registry.runs_sync_in_background("no-such-provider") is False


def test_status_says_which_sources_are_syncing(client_admin, monkeypatch):
    from api.services.journal_two.note_connectors import engine
    src = _seed_evernote_source()
    monkeypatch.setattr(engine, "is_source_busy", lambda sid: sid == src["id"])
    body = client_admin.get(f"{BASE}/status").json()
    [row] = body["providers"]["evernote"]["sources"]
    assert row["syncing"] is True and row["queued"] is False


def test_status_says_queued_not_syncing_while_a_pass_waits_for_a_slot(client_admin, monkeypatch):
    # D4-2: a pass waiting for one of the shared pass slots holds the source's in-flight lock but
    # is not running: the row reads "queued", never "syncing now".
    from api.services.journal_two.note_connectors import engine
    src = _seed_evernote_source()
    monkeypatch.setattr(engine, "is_source_busy", lambda sid: sid == src["id"])
    monkeypatch.setattr(engine, "is_source_queued", lambda sid: sid == src["id"])
    body = client_admin.get(f"{BASE}/status").json()
    [row] = body["providers"]["evernote"]["sources"]
    assert row["queued"] is True and row["syncing"] is False


def test_the_background_choice_reads_follow_up_on_rate_limit_and_nothing_else(monkeypatch):
    class Listed:
        fetch_is_listing_independent = True
        follow_up_on_rate_limit = False

    class Limited:
        fetch_is_listing_independent = False
        follow_up_on_rate_limit = True

    def entry(name, cls):
        return registry.ProviderEntry(name, name, "oauth", lambda: True, lambda s: None,
                                      provider_class=lambda: cls)

    monkeypatch.setitem(registry._REGISTRY, "fake-listed", entry("fake-listed", Listed))
    monkeypatch.setitem(registry._REGISTRY, "fake-limited", entry("fake-limited", Limited))
    assert registry.runs_sync_in_background("fake-listed") is False
    assert registry.runs_sync_in_background("fake-limited") is True
