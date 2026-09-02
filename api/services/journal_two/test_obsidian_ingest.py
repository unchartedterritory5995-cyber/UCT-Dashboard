"""HTTP-level tests for `POST /api/j2/notes/connectors/obsidian/ingest` --
the Obsidian plugin's push transport (Task 3).

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
from api.services.journal_two.note_connectors import obsidian_link

_URL = "/api/j2/notes/connectors/obsidian/ingest"


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
