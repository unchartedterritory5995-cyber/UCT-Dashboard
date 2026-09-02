"""HTTP-level tests for the Obsidian device push transport's two endpoints:
`POST /api/j2/notes/connectors/obsidian/redeem` (Task 5b -- exchanges a
connect code for a device token + creates the vault's `j2_note_sources`
row) and `POST .../obsidian/ingest` (Task 3 -- the plugin's push transport).

Spins up a minimal FastAPI app with just the note_sync router (mirrors
`tests/test_note_sync_router.py`'s pattern) against a temp auth.db, and
drives auth through the REAL device-token path (`obsidian_link.mint_
connect_code` / `redeem_connect_code` / `authenticate_device`) rather than a
dependency override -- there is no session cookie to override here, so the
token IS the credential under test.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import note_sync as note_sync_router
from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, obsidian_link
from api.services.journal_two.note_connectors.providers.obsidian import ObsidianProvider

_URL = "/api/j2/notes/connectors/obsidian/ingest"
_REDEEM_URL = "/api/j2/notes/connectors/obsidian/redeem"


def _seed_user(conn, user_id: str, *, plan: str | None = "pro", status: str = "active") -> None:
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'pw', ?)",
        (user_id, f"{user_id}@example.test", user_id),
    )
    if plan is not None:
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, ?, ?)",
            (f"sub-{user_id}", user_id, plan, status),
        )
    conn.commit()


@pytest.fixture
def client(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    auth_db.init_db()  # base schema (users/subscriptions) -- ensure_schema owns only j2_* tables
    conn = auth_db.get_connection()
    ensure_schema(conn)
    _seed_user(conn, "user-a", plan="pro")
    _seed_user(conn, "user-b", plan="pro")
    _seed_user(conn, "user-free", plan=None)
    conn.close()

    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    # The redeem endpoint gates on the SAME registry `configured()` check
    # `/obsidian/connect` uses to decide whether to mint a code at all -- a
    # code that could never be minted with this flag off shouldn't be able
    # to redeem with it off either. Ingest itself doesn't consult this flag
    # (it only cares about a valid device token), so setting it here doesn't
    # change any existing ingest test's behavior.
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")

    app = FastAPI()
    app.include_router(note_sync_router.router)
    return TestClient(app)


def _device_token(user_id: str, vault_id: str = "vault-1", label: str | None = "My Vault") -> str:
    code = obsidian_link.mint_connect_code(user_id)
    _, token = obsidian_link.redeem_connect_code(code, vault_id, label)
    return token


def _staging_rows(user_id: str, vault_id: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_obsidian_staging WHERE user_id = ? AND vault_id = ?",
            (user_id, vault_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _manifest_paths(user_id: str, vault_id: str) -> set[str]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT vault_path FROM j2_obsidian_manifest WHERE user_id = ? AND vault_id = ?",
            (user_id, vault_id),
        ).fetchall()
        return {r["vault_path"] for r in rows}
    finally:
        conn.close()


def _note(vault_path: str, content_hash: str, body_md: str = "# body") -> dict:
    return {
        "vault_path": vault_path,
        "content_hash": content_hash,
        "body_md": body_md,
        "updated_at": "2026-09-02T00:00:00Z",
    }


# ── auth ──────────────────────────────────────────────────────────────────

def test_an_authenticated_batch_lands_in_staging(client):
    token = _device_token("user-a")
    r = client.post(
        _URL,
        headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("Notes/idea.md", "h1", "# Idea")]},
    )
    assert r.status_code == 200, r.text
    rows = _staging_rows("user-a", "vault-1")
    assert len(rows) == 1
    assert rows[0]["vault_path"] == "Notes/idea.md"
    assert rows[0]["content_hash"] == "h1"
    assert rows[0]["body_md"] == "# Idea"


def test_an_unauthenticated_batch_is_refused(client):
    r = client.post(_URL, json={"consent": True, "notes": [_note("a.md", "h1")]})
    assert r.status_code == 401
    assert _staging_rows("user-a", "vault-1") == []

    r2 = client.post(
        _URL, headers={"Authorization": "Bearer garbage"},
        json={"consent": True, "notes": [_note("a.md", "h1")]},
    )
    assert r2.status_code == 401


def test_a_batch_cannot_write_under_another_user_even_if_the_body_claims_one(client):
    """The one that matters most: the request BODY names a different
    user_id, but the write must land only under the DEVICE's own user."""
    token_a = _device_token("user-a", vault_id="vault-1")
    r = client.post(
        _URL,
        headers={"Authorization": f"Bearer {token_a}"},
        json={
            "consent": True,
            "user_id": "user-b",
            "userId": "user-b",
            "notes": [_note("Notes/x.md", "h1", "mine")],
        },
    )
    assert r.status_code == 200, r.text
    assert len(_staging_rows("user-a", "vault-1")) == 1
    assert _staging_rows("user-b", "vault-1") == []
    # user-b's OWN vault-1 row (a different device/vault_id pair) must also
    # stay untouched -- confirms nothing about the write targeted user-b.
    assert _staging_rows("user-b", "vault-2") == []


def test_a_free_plan_device_is_paid_gated(client):
    token = _device_token("user-free", vault_id="vault-free")
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("a.md", "h1")]},
    )
    assert r.status_code == 403
    assert _staging_rows("user-free", "vault-free") == []


def test_consent_is_required(client):
    token = _device_token("user-a")
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": False, "notes": [_note("a.md", "h1")]},
    )
    assert r.status_code == 400
    assert _staging_rows("user-a", "vault-1") == []


# ── no-op on unchanged content_hash ──────────────────────────────────────────

def test_an_unchanged_content_hash_is_a_no_op(client):
    token = _device_token("user-a")
    body = {"consent": True, "notes": [_note("Notes/idea.md", "h1", "# Idea")]}

    r1 = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=body)
    assert r1.status_code == 200
    assert r1.json()["written"] == 1
    first = _staging_rows("user-a", "vault-1")[0]

    r2 = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=body)
    assert r2.status_code == 200
    assert r2.json()["written"] == 0
    assert r2.json()["skipped"] == 1
    second = _staging_rows("user-a", "vault-1")[0]
    assert second["received_at"] == first["received_at"], \
        "an unchanged content_hash must not rewrite the row or bump received_at"

    # A genuinely changed hash DOES write.
    changed = {"consent": True, "notes": [_note("Notes/idea.md", "h2", "# Idea v2")]}
    r3 = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=changed)
    assert r3.status_code == 200
    assert r3.json()["written"] == 1
    third = _staging_rows("user-a", "vault-1")[0]
    assert third["content_hash"] == "h2"
    assert third["body_md"] == "# Idea v2"


# ── manifest replacement ──────────────────────────────────────────────────

def test_a_manifest_replaces_the_prior_one_atomically_and_a_non_final_push_leaves_it(client):
    token = _device_token("user-a")

    r1 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "manifest": ["a.md", "b.md"], "final": True},
    )
    assert r1.status_code == 200
    assert r1.json()["manifestReplaced"] is True
    assert _manifest_paths("user-a", "vault-1") == {"a.md", "b.md"}

    # A NON-final push, even with a different (smaller) manifest, must not
    # touch the stored manifest at all -- a partial push must never look
    # like mass deletion.
    r2 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "manifest": ["a.md"], "final": False},
    )
    assert r2.status_code == 200
    assert r2.json()["manifestReplaced"] is False
    assert _manifest_paths("user-a", "vault-1") == {"a.md", "b.md"}

    # A final push with no manifest field at all is also a no-touch.
    r3 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "final": True},
    )
    assert r3.status_code == 200
    assert r3.json()["manifestReplaced"] is False
    assert _manifest_paths("user-a", "vault-1") == {"a.md", "b.md"}

    # A final push with a genuinely new complete set replaces it atomically
    # -- old entries not in the new set are gone, new ones are present.
    r4 = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [], "manifest": ["c.md"], "final": True},
    )
    assert r4.status_code == 200
    assert r4.json()["manifestReplaced"] is True
    assert _manifest_paths("user-a", "vault-1") == {"c.md"}


# ── body size cap ────────────────────────────────────────────────────────────

def test_an_oversized_batch_is_refused_with_a_clean_4xx(client):
    token = _device_token("user-a")
    huge_body_md = "x" * (note_sync_router._MAX_OBSIDIAN_INGEST_BYTES + 1000)
    r = client.post(
        _URL, headers={"Authorization": f"Bearer {token}"},
        json={"consent": True, "notes": [_note("Notes/huge.md", "h1", huge_body_md)]},
    )
    assert 400 <= r.status_code < 500, r.text
    assert _staging_rows("user-a", "vault-1") == []


# ── POST /obsidian/redeem (Task 5b) ─────────────────────────────────────────

def test_redeem_with_a_valid_code_returns_a_token_and_creates_exactly_one_source(client):
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(
        _REDEEM_URL, json={"code": code, "vaultId": "vault-1", "label": "My Vault"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deviceId"]
    assert body["token"]
    assert body["vaultId"] == "vault-1"
    assert body["source"]["provider"] == "obsidian"
    assert body["source"]["remoteId"] == "vault-1"

    # The handed-back token actually authenticates as the redeeming user.
    device = obsidian_link.authenticate_device(body["token"])
    assert device is not None
    assert device["user_id"] == "user-a"
    assert device["vault_id"] == "vault-1"

    sources = [s for s in connections.list_sources("user-a") if s["provider"] == "obsidian"]
    assert len(sources) == 1
    assert sources[0]["remoteId"] == "vault-1"


def test_redeem_does_not_require_a_session_cookie(client):
    """This router mounts with no session middleware/dependency override at
    all in this fixture, so if `obsidian_redeem` accidentally depended on
    `get_current_user` this call would fail (missing session), not succeed.
    The plugin has no browser to hold a cookie in -- the connect code IS the
    credential."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"}, cookies={})
    assert r.status_code == 200, r.text


def test_redeem_with_a_garbage_code_fails_cleanly_not_a_500(client):
    r = client.post(_REDEEM_URL, json={"code": "not-a-real-code", "vaultId": "vault-1"})
    assert r.status_code == 400, r.text
    assert connections.list_sources("user-a") == []


def test_redeem_with_an_expired_code_fails_cleanly(client):
    import base64
    import hashlib
    import hmac
    import time as _time

    ts = str(int(_time.time()) - obsidian_link._CONNECT_CODE_TTL_SECONDS - 60)
    nonce = "expired-test-nonce"
    payload = f"user-a:{ts}:{nonce}"
    sig = hmac.new(
        obsidian_link._signing_secret(), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    code = base64.urlsafe_b64encode(f"{payload}:{sig}".encode("utf-8")).decode("utf-8")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r.status_code == 400, r.text
    assert connections.list_sources("user-a") == []


def test_redeem_with_an_already_used_code_fails_cleanly(client):
    code = obsidian_link.mint_connect_code("user-a")
    r1 = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r1.status_code == 200, r1.text
    r2 = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r2.status_code == 400, r2.text
    # The rejected replay created nothing beyond the first, legitimate source.
    assert len(connections.list_sources("user-a")) == 1


def test_redeem_missing_code_or_vault_id_400(client):
    r1 = client.post(_REDEEM_URL, json={"code": "", "vaultId": "vault-1"})
    assert r1.status_code == 400
    code = obsidian_link.mint_connect_code("user-a")
    r2 = client.post(_REDEEM_URL, json={"code": code, "vaultId": "   "})
    assert r2.status_code == 400
    assert connections.list_sources("user-a") == []


def test_redeem_not_configured_returns_503_not_a_500(client, monkeypatch):
    monkeypatch.delenv("NOTE_SYNC_OBSIDIAN_ENABLED", raising=False)
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-1"})
    assert r.status_code == 503, r.text


def test_redeem_free_plan_user_is_paid_gated(client):
    code = obsidian_link.mint_connect_code("user-free")
    r = client.post(_REDEEM_URL, json={"code": code, "vaultId": "vault-free"})
    assert r.status_code == 403, r.text
    assert connections.list_sources("user-free") == []


def test_reredeeming_the_same_vault_does_not_duplicate_the_source_row(client):
    code1 = obsidian_link.mint_connect_code("user-a")
    r1 = client.post(
        _REDEEM_URL, json={"code": code1, "vaultId": "vault-1", "label": "My Vault"},
    )
    assert r1.status_code == 200, r1.text
    device_id1, token1 = r1.json()["deviceId"], r1.json()["token"]

    # A reinstall/reconnect for the SAME vault -- redeem_connect_code
    # ROTATES the existing device row rather than refusing (Task 2's own
    # contract); the source row must likewise stay singular, never duplicate.
    code2 = obsidian_link.mint_connect_code("user-a")
    r2 = client.post(_REDEEM_URL, json={"code": code2, "vaultId": "vault-1"})
    assert r2.status_code == 200, r2.text
    device_id2, token2 = r2.json()["deviceId"], r2.json()["token"]
    assert device_id2 == device_id1

    sources = [s for s in connections.list_sources("user-a")
               if s["provider"] == "obsidian" and s["remoteId"] == "vault-1"]
    assert len(sources) == 1

    # The OLD token from the first redemption no longer authenticates --
    # rotation, not an additional live credential.
    assert obsidian_link.authenticate_device(token1) is None
    assert obsidian_link.authenticate_device(token2) is not None


# ── end-to-end: mint -> redeem -> ingest -> visible through the provider ────

async def test_mint_redeem_ingest_chain_is_visible_through_the_provider_for_that_user_only(client):
    """The test that proves the chain is actually connected, in one function:
    mint a code, redeem it over HTTP, push a small final batch with a
    manifest over HTTP, then read it back through `providers/obsidian.py`'s
    OWN `list_changed`/`list_present_refs` -- the SAME hooks
    `engine.sync_source` calls -- for the redeeming user, confirm a
    different user sees nothing, and (the strongest proof available) run
    the REAL sync engine over the created source end to end."""
    code = obsidian_link.mint_connect_code("user-a")
    r = client.post(
        _REDEEM_URL, json={"code": code, "vaultId": "vault-e2e", "label": "E2E Vault"},
    )
    assert r.status_code == 200, r.text
    redeemed = r.json()
    token = redeemed["token"]

    ingest_body = {
        "consent": True,
        "notes": [
            _note("Ideas/one.md", "h1", "# One"),
            {**_note("Ideas/two.md", "h2", "# Two"), "updated_at": "2026-09-02T00:00:01Z"},
        ],
        "manifest": ["Ideas/one.md", "Ideas/two.md"],
        "final": True,
    }
    ir = client.post(_URL, headers={"Authorization": f"Bearer {token}"}, json=ingest_body)
    assert ir.status_code == 200, ir.text
    assert ir.json()["written"] == 2

    provider = ObsidianProvider(user_id="user-a", vault_id="vault-e2e")
    changed = await provider.list_changed({}, cursor=None)
    assert {ref.remote_id for ref in changed} == {"Ideas/one.md", "Ideas/two.md"}
    present = await provider.list_present_refs({})
    assert {ref.remote_id for ref in present} == {"Ideas/one.md", "Ideas/two.md"}

    # A different user's provider over the SAME vault_id sees nothing --
    # nothing about the mint -> redeem -> ingest chain leaked cross-tenant.
    other = ObsidianProvider(user_id="user-b", vault_id="vault-e2e")
    assert await other.list_changed({}, cursor=None) == []
    assert await other.list_present_refs({}) == []

    # Strongest proof of all: the REAL sync engine, over the REAL source
    # `redeem` created, actually completes -- this is exactly the path that
    # was unreachable before `obsidian_redeem` also wrote a `j2_note_
    # connectors` row (without one, `engine._resolve_credentials` returns
    # None and `_do_sync` raises before `list_changed` is ever called).
    from api.services.journal_two import notes as notes_svc
    from api.services.journal_two.note_connectors import engine as sync_engine

    source_id = redeemed["source"]["id"]
    result = await sync_engine.sync_source(source_id, full=True, manual=True)
    assert result["status"] == "ok", result
    assert result["created"] == 2
    titles = {n["title"] for n in notes_svc.list_notes("user-a")}
    assert titles == {"One", "Two"}
