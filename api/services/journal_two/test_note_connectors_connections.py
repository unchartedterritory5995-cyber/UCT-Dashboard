"""Tests for note-connector persistence (connectors, sources, sync log,
remote index) — `api.services.journal_two.note_connectors.connections`.

Mirrors `tests/test_broker_connections.py`'s fixture style: a real temp-file
SQLite (not :memory:) so multi-connection behavior matches production (each
service call opens its own connection), plus the module-reload-after-env
pattern used by the crypto_box-backed broker connections tests.

The five required cases from the task brief:
  1. token roundtrip (encrypt -> get_token equals dict)
  2. broker env prefix still works (control — proves the two key families
     stayed isolated after the crypto_box generalization)
  3. missing NOTE key -> is_configured() False and get_token raises
     CryptoBoxError (and marks the connector 'broken', broker contract)
  4. delete_connector cascades sources + remote_index but NOT notes
  5. list_due_sources honors last_sync_at + interval + sync_enabled + status
"""

from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    # Import after env + path are set so module-level state is clean.
    import api.services.crypto_box as cb
    importlib.reload(cb)
    import api.services.journal_two.note_connectors.connections as conns
    importlib.reload(conns)
    return conns


def _token(**overrides):
    t = {"graphToken": "roam-graph-token-abc123", "graphName": "my-graph"}
    t.update(overrides)
    return t


# ── 1. Token roundtrip ───────────────────────────────────────────────────────

def test_token_roundtrip(db):
    assert db.get_token("u1", "roam") is None  # no connector yet

    token = _token()
    connector = db.upsert_connector("u1", "roam", token, account_label="Trading Notes")
    assert connector["provider"] == "roam"
    assert connector["accountLabel"] == "Trading Notes"
    assert connector["status"] == "active"
    assert connector["consentAt"] is not None

    got = db.get_token("u1", "roam")
    assert got == token


def test_token_never_stored_in_plaintext_on_disk(db):
    db.upsert_connector("u1", "roam", _token())
    conn = auth_db.get_connection()
    row = conn.execute(
        "SELECT token_enc FROM j2_note_connectors WHERE user_id='u1' AND provider='roam'"
    ).fetchone()
    conn.close()
    assert "roam-graph-token-abc123" not in row["token_enc"]
    assert row["token_enc"].startswith("v1:")


def test_upsert_reconnect_resets_broken_status_and_preserves_consent(db):
    db.upsert_connector("u1", "roam", _token())
    first_consent = db.get_connector("u1", "roam")["consentAt"]
    db.set_connector_status("u1", "roam", "broken")

    db.upsert_connector("u1", "roam", _token(graphToken="new-token"), record_consent=False)

    connector = db.get_connector("u1", "roam")
    assert connector["status"] == "active"          # reconnect clears 'broken'
    assert connector["consentAt"] == first_consent   # consent not clobbered
    assert db.get_token("u1", "roam")["graphToken"] == "new-token"


def test_upsert_with_no_label_does_not_blank_an_existing_one(db):
    db.upsert_connector("u1", "roam", _token(), account_label="My Graph")
    db.upsert_connector("u1", "roam", _token(graphToken="rotated"))  # no label passed
    assert db.get_connector("u1", "roam")["accountLabel"] == "My Graph"


# ── 2. Broker env prefix still works (control) ───────────────────────────────

def test_broker_env_prefix_still_works_control(monkeypatch):
    """The original BROKER_ENCRYPTION_KEY family (crypto_box.encrypt/decrypt/
    is_configured — used by broker sync AND TOTP) must behave byte-identically
    after crypto_box was generalized into two key families, and the two
    families must be isolated from each other."""
    monkeypatch.delenv("NOTE_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("BROKER_ENCRYPTION_KEY", Fernet.generate_key().decode())
    import api.services.crypto_box as cb
    importlib.reload(cb)

    blob = cb.encrypt("broker-secret")
    assert blob.startswith(cb.ACTIVE_VERSION + ":")
    assert cb.decrypt(blob) == "broker-secret"
    assert cb.is_configured() is True

    # Isolation: the NoteBox family sees no key, even though the default
    # (broker) family is fully configured.
    assert cb.NoteBox.is_configured() is False
    with pytest.raises(cb.CryptoBoxError):
        cb.NoteBox.encrypt("anything")


# ── 3. Missing NOTE key fails closed + marks connector broken ───────────────

def test_missing_note_key_fails_closed_and_marks_connector_broken(db, monkeypatch):
    db.upsert_connector("u1", "roam", _token())
    from api.services import crypto_box
    assert crypto_box.NoteBox.is_configured() is True

    # The key disappears (never deployed / rotated out).
    monkeypatch.delenv("NOTE_ENCRYPTION_KEY", raising=False)
    importlib.reload(crypto_box)
    assert crypto_box.NoteBox.is_configured() is False

    with pytest.raises(crypto_box.CryptoBoxError):
        db.get_token("u1", "roam")

    # Broker contract: never crash silently — the connector is marked broken
    # so the scheduler/UI stop looping on it and prompt a reconnect.
    assert db.get_connector("u1", "roam")["status"] == "broken"


# ── 4. delete_connector cascades sources + remote_index, not notes ──────────

def test_delete_connector_cascades_sources_and_index_but_not_notes(db):
    from api.services.journal_two import notes as notes_service

    db.upsert_connector("u1", "roam", _token())
    src = db.create_source("u1", "roam", "graph-1", display_name="My Graph")

    conn = auth_db.get_connection()
    conn.execute(
        "INSERT INTO j2_note_remote_index "
        "(user_id, source_id, remote_id, import_key, remote_updated_at, seen_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("u1", src["id"], "page-1", "roam:my-graph/page-1",
         "2026-08-01T00:00:00+00:00", "2026-08-11T00:00:00+00:00"),
    )
    conn.execute(
        "INSERT INTO j2_note_sync_log "
        "(source_id, user_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?)",
        (src["id"], "u1", "2026-08-11T00:00:00+00:00", "2026-08-11T00:01:00+00:00", "ok"),
    )
    conn.commit()
    conn.close()

    note = notes_service.create_note("u1", {"title": "Synced note"})

    assert db.delete_connector("u1", "roam") is True

    assert db.get_connector("u1", "roam") is None
    assert db.list_sources("u1") == []

    conn = auth_db.get_connection()
    remaining_index = conn.execute(
        "SELECT COUNT(*) FROM j2_note_remote_index WHERE user_id = 'u1'"
    ).fetchone()[0]
    remaining_log = conn.execute(
        "SELECT COUNT(*) FROM j2_note_sync_log WHERE user_id = 'u1'"
    ).fetchone()[0]
    still_has_note = conn.execute(
        "SELECT COUNT(*) FROM j2_notes WHERE id = ?", (note["id"],)
    ).fetchone()[0]
    conn.close()

    assert remaining_index == 0
    assert remaining_log == 0
    assert still_has_note == 1, "disconnecting a provider must NOT delete synced notes"


def test_delete_connector_on_unknown_connector_is_a_noop(db):
    assert db.delete_connector("u1", "roam") is False


# ── 5. list_due_sources honors interval + sync_enabled + status ─────────────

def test_list_due_sources_honors_interval_flags_and_status(db):
    db.upsert_connector("u1", "roam", _token())
    due = db.create_source("u1", "roam", "graph-due")
    fresh = db.create_source("u1", "roam", "graph-fresh")
    disabled = db.create_source("u1", "roam", "graph-disabled")
    broken = db.create_source("u1", "roam", "graph-broken")
    never_synced = db.create_source("u1", "roam", "graph-never-synced")

    conn = auth_db.get_connection()
    stale = (datetime.now(timezone.utc) - timedelta(minutes=120)).isoformat()
    recent = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    conn.execute("UPDATE j2_note_sources SET last_sync_at = ? WHERE id = ?", (stale, due["id"]))
    conn.execute("UPDATE j2_note_sources SET last_sync_at = ? WHERE id = ?", (stale, disabled["id"]))
    conn.execute("UPDATE j2_note_sources SET last_sync_at = ? WHERE id = ?", (stale, broken["id"]))
    conn.execute("UPDATE j2_note_sources SET last_sync_at = ? WHERE id = ?", (recent, fresh["id"]))
    conn.commit()
    conn.close()

    db.set_sync_enabled("u1", disabled["id"], False)
    db.set_source_status("u1", broken["id"], "broken")

    due_ids = {s["id"] for s in db.list_due_sources(30)}

    assert due["id"] in due_ids, "past the interval -> due"
    assert never_synced["id"] in due_ids, "never synced -> due"
    assert fresh["id"] not in due_ids, "inside the interval -> not due"
    assert disabled["id"] not in due_ids, "sync disabled -> excluded"
    assert broken["id"] not in due_ids, "broken -> excluded, needs reconnect first"


def test_record_sync_result_and_update_cursor(db):
    db.upsert_connector("u1", "roam", _token())
    src = db.create_source("u1", "roam", "graph-1")

    assert db.update_cursor("u1", src["id"], "2026-08-11T00:00:00Z") is True
    assert db.record_sync_result("u1", src["id"], ok=True) is True
    got = db.get_source("u1", src["id"])
    assert got["cursor"] == "2026-08-11T00:00:00Z"
    assert got["lastSyncStatus"] == "ok"
    assert got["lastSyncError"] is None

    assert db.record_sync_result("u1", src["id"], ok=False, error="boom") is True
    got = db.get_source("u1", src["id"])
    assert got["lastSyncStatus"] == "error"
    assert got["lastSyncError"] == "boom"
