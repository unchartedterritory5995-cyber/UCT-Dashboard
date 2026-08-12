"""Note-connector persistence — DB layer for connectors, sources, sync log,
and the remote-delete-detection index.

Mirrors `api/services/journal_two/broker/connections.py`'s idiom exactly:
provider-agnostic, synchronous, testable against an in-memory/temp-file
SQLite, encrypt at exactly ONE write site (`upsert_connector`) and decrypt
at exactly ONE read site (`get_token`). Provider network calls live in
`note_connectors/providers/*` (later tasks); this module only ever touches
`j2_note_connectors` / `j2_note_sources` / `j2_note_sync_log` /
`j2_note_remote_index` (spec §5).

Key family: `crypto_box.NoteBox` (`NOTE_ENCRYPTION_KEY` env, isolated from
the broker family's `BROKER_ENCRYPTION_KEY`). A `crypto_box.CryptoBoxError`
on decrypt (missing/rotated key, tampered blob) is the broker contract:
never crash the caller — `get_token` flips the connector's status to
'broken' (so the scheduler/UI stop looping on it and prompt a reconnect)
and then re-raises so the immediate caller still sees the failure.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services import crypto_box


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Connector (per-provider token) ───────────────────────────────────────────

def upsert_connector(
    user_id: str,
    provider: str,
    token_dict: dict[str, Any],
    account_label: str | None = None,
    conn: sqlite3.Connection | None = None,
    *,
    record_consent: bool = True,
) -> dict[str, Any]:
    """Encrypt + upsert a connector's token. THE ONLY call site in this
    module that invokes `crypto_box.NoteBox.encrypt` — mirrors `get_token`
    being the only call site that invokes `.decrypt`.

    `token_dict` is JSON-encoded before encryption (token blobs are dicts —
    e.g. Roam's {graphToken, graphName}, Craft's {capabilityUrl, bearer}).

    Resets status to 'active' on every upsert: supplying a fresh token is
    exactly the reconnect action that should clear a prior 'broken' status.
    consent_at is set on first save (or backfilled if currently null),
    mirroring `broker.connections.save_broker_user`. A None `account_label`
    on an existing row leaves the stored label untouched (so a token-only
    refresh doesn't blank a user-set label)."""
    enc = crypto_box.NoteBox.encrypt(json.dumps(token_dict))
    owned = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        existing = conn.execute(
            "SELECT consent_at FROM j2_note_connectors "
            "WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO j2_note_connectors
                    (user_id, provider, token_enc, account_label, status,
                     consent_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
                """,
                (user_id, provider, enc, account_label,
                 now if record_consent else None, now, now),
            )
        else:
            consent = existing["consent_at"]
            if record_consent and not consent:
                consent = now
            conn.execute(
                """
                UPDATE j2_note_connectors
                   SET token_enc = ?,
                       account_label = COALESCE(?, account_label),
                       status = 'active', consent_at = ?, updated_at = ?
                 WHERE user_id = ? AND provider = ?
                """,
                (enc, account_label, consent, now, user_id, provider),
            )
        conn.commit()
        return _row_to_connector(
            conn.execute(
                "SELECT * FROM j2_note_connectors WHERE user_id = ? AND provider = ?",
                (user_id, provider),
            ).fetchone()
        )
    finally:
        if owned:
            conn.close()


def get_token(
    user_id: str, provider: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Return the decrypted+json-loaded token dict for this connector, or
    None if no connector row exists. THE ONLY call site in this module that
    invokes `crypto_box.NoteBox.decrypt`.

    Raises `crypto_box.CryptoBoxError` if the stored token cannot be
    decrypted (key lost/rotated, tampered blob). Per the broker contract
    this never crashes silently: the connector's status is flipped to
    'broken' BEFORE re-raising, so the scheduler/UI see it and prompt a
    reconnect instead of retrying forever against an undecryptable blob."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT token_enc FROM j2_note_connectors "
            "WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
        if row is None:
            return None
        try:
            return json.loads(crypto_box.NoteBox.decrypt(row["token_enc"]))
        except crypto_box.CryptoBoxError:
            set_connector_status(user_id, provider, "broken", conn=conn)
            raise
    finally:
        if owned:
            conn.close()


def set_connector_status(
    user_id: str, provider: str, status: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    if status not in ("active", "broken", "disabled"):
        raise ValueError(f"invalid status {status!r}")
    return _update_connector_fields(user_id, provider, {"status": status}, conn)


def get_connector(
    user_id: str, provider: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Connector metadata WITHOUT the token (never decrypts) — use
    `get_token` when the plaintext token is actually needed."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_connectors WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
        return _row_to_connector(row) if row else None
    finally:
        if owned:
            conn.close()


def list_connectors(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_connectors WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        return [_row_to_connector(r) for r in rows]
    finally:
        if owned:
            conn.close()


def delete_connector(
    user_id: str, provider: str, conn: sqlite3.Connection | None = None,
) -> bool:
    """Disconnect: purge the connector's token, every j2_note_sources row
    for (user_id, provider), and their j2_note_remote_index +
    j2_note_sync_log rows (both keyed on source_id, and — like the broker
    equivalent's raw activities/equity ledgers — dead weight the moment
    their source row is gone, since a reconnect mints a fresh source id).

    Deliberately does NOT touch j2_notes/j2_note_folders — disconnecting a
    provider keeps every note it already synced; only the source LINK is
    severed."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute("BEGIN")
        source_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM j2_note_sources WHERE user_id = ? AND provider = ?",
                (user_id, provider),
            ).fetchall()
        ]
        if source_ids:
            placeholders = ", ".join("?" * len(source_ids))
            conn.execute(
                f"DELETE FROM j2_note_remote_index "
                f"WHERE user_id = ? AND source_id IN ({placeholders})",
                (user_id, *source_ids),
            )
            conn.execute(
                f"DELETE FROM j2_note_sync_log "
                f"WHERE user_id = ? AND source_id IN ({placeholders})",
                (user_id, *source_ids),
            )
        conn.execute(
            "DELETE FROM j2_note_sources WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        )
        cur = conn.execute(
            "DELETE FROM j2_note_connectors WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        )
        conn.commit()
        return cur.rowcount > 0
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def _update_connector_fields(
    user_id: str, provider: str, fields: dict[str, Any],
    conn: sqlite3.Connection | None,
) -> bool:
    if not fields:
        return False
    owned = conn is None
    conn = conn or get_connection()
    try:
        sets = ", ".join(f"{k} = ?" for k in fields)
        params = list(fields.values()) + [_now_iso(), user_id, provider]
        cur = conn.execute(
            f"UPDATE j2_note_connectors SET {sets}, updated_at = ? "
            f"WHERE user_id = ? AND provider = ?",
            params,
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def _row_to_connector(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "userId": row["user_id"],
        "provider": row["provider"],
        "accountLabel": row["account_label"],
        "status": row["status"],
        "consentAt": row["consent_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


# ── Source (one connected item — a graph/space/workspace/folder) ────────────

def create_source(
    user_id: str,
    provider: str,
    remote_id: str,
    *,
    display_name: str | None = None,
    dest_folder_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Idempotent on (user_id, provider, remote_id) — mirrors
    `map_snaptrade_account`: a second call for the same remote item returns
    the existing row rather than raising on the UNIQUE constraint."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_note_sources "
            "WHERE user_id = ? AND provider = ? AND remote_id = ?",
            (user_id, provider, remote_id),
        ).fetchone()
        if existing:
            return _row_to_source(existing)
        new_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO j2_note_sources
                (id, user_id, provider, remote_id, display_name,
                 dest_folder_id, sync_enabled, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?)
            """,
            (new_id, user_id, provider, remote_id, display_name,
             dest_folder_id, _now_iso()),
        )
        conn.commit()
        return _row_to_source(
            conn.execute(
                "SELECT * FROM j2_note_sources WHERE id = ?", (new_id,)
            ).fetchone()
        )
    finally:
        if owned:
            conn.close()


def get_source(
    user_id: str, source_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_sources WHERE id = ? AND user_id = ?",
            (source_id, user_id),
        ).fetchone()
        return _row_to_source(row) if row else None
    finally:
        if owned:
            conn.close()


def get_source_by_id(
    source_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Like `get_source`, but not scoped to a caller-known `user_id` — the
    sync engine's entry point (`engine.sync_source(source_id, ...)`, and the
    scheduler/webhook callers behind it) only ever has the source id.
    `j2_note_sources.id` is a UUID primary key, so no user scoping is needed
    for correctness (mirrors how `sync_due_sources`/the scheduler already
    reach across users via `list_due_sources`)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_sources WHERE id = ?", (source_id,),
        ).fetchone()
        return _row_to_source(row) if row else None
    finally:
        if owned:
            conn.close()


def list_sources(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_sources WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,),
        ).fetchall()
        return [_row_to_source(r) for r in rows]
    finally:
        if owned:
            conn.close()


def list_due_sources(
    interval_minutes: int, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All sync-enabled, active sources (across ALL users) whose last sync
    is older than `interval_minutes` (or never synced). Mirrors
    `broker.connections.list_due_accounts`. Excludes 'broken' (needs
    reconnect) and 'disabled'."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=interval_minutes)).isoformat()
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT * FROM j2_note_sources
             WHERE sync_enabled = 1 AND status = 'active'
               AND (last_sync_at IS NULL OR last_sync_at < ?)
             ORDER BY (last_sync_at IS NOT NULL), last_sync_at ASC
            """,
            (cutoff,),
        ).fetchall()
        return [_row_to_source(r) for r in rows]
    finally:
        if owned:
            conn.close()


def set_source_status(
    user_id: str, source_id: str, status: str,
    conn: sqlite3.Connection | None = None, *, error: str | None = None,
) -> bool:
    if status not in ("active", "broken", "disabled"):
        raise ValueError(f"invalid status {status!r}")
    return _update_source_fields(
        user_id, source_id, {"status": status, "last_sync_error": error}, conn
    )


def set_sync_enabled(
    user_id: str, source_id: str, enabled: bool,
    conn: sqlite3.Connection | None = None,
) -> bool:
    return _update_source_fields(
        user_id, source_id, {"sync_enabled": 1 if enabled else 0}, conn
    )


def update_cursor(
    user_id: str, source_id: str, cursor: str | None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    return _update_source_fields(user_id, source_id, {"cursor": cursor}, conn)


def set_dest_folder_id(
    user_id: str, source_id: str, dest_folder_id: str | None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Router-facing setter for `PUT /sources/{id}` (spec §8: "sync_enabled,
    dest folder"). No existing writer touched this column outside
    `create_source`'s initial insert; added here (Task 11) rather than
    reaching into the private `_update_source_fields` from the router
    module, which would cross the module's own encapsulation boundary."""
    return _update_source_fields(user_id, source_id, {"dest_folder_id": dest_folder_id}, conn)


def list_all_sources(conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """Every sync-enabled, active source across ALL users — the nightly
    FULL-sync job's enumeration (Task 11 MUST-RESOLVE #2). Mirrors
    `list_due_sources` but with no recency filter: "full-sync everything
    active tonight," not "what's due right now." Delete detection (engine's
    2-strike miss_streak) only runs on a full listing, which the
    interval-based `sync_due_sources` path never produces on its own — this
    is what makes delete detection reachable in production at all."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_sources WHERE sync_enabled = 1 AND status = 'active' "
            "ORDER BY created_at ASC",
        ).fetchall()
        return [_row_to_source(r) for r in rows]
    finally:
        if owned:
            conn.close()


def record_sync_result(
    user_id: str, source_id: str, *, ok: bool, error: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    return _update_source_fields(
        user_id, source_id,
        {
            "last_sync_at": _now_iso(),
            "last_sync_status": "ok" if ok else "error",
            "last_sync_error": None if ok else error,
        },
        conn,
    )


def _update_source_fields(
    user_id: str, source_id: str, fields: dict[str, Any],
    conn: sqlite3.Connection | None,
) -> bool:
    if not fields:
        return False
    owned = conn is None
    conn = conn or get_connection()
    try:
        sets = ", ".join(f"{k} = ?" for k in fields)
        params = list(fields.values()) + [source_id, user_id]
        cur = conn.execute(
            f"UPDATE j2_note_sources SET {sets} WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def _row_to_source(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "provider": row["provider"],
        "remoteId": row["remote_id"],
        "displayName": row["display_name"],
        "destFolderId": row["dest_folder_id"],
        "cursor": row["cursor"],
        "syncEnabled": bool(row["sync_enabled"]),
        "status": row["status"],
        "lastSyncAt": row["last_sync_at"],
        "lastSyncStatus": row["last_sync_status"],
        "lastSyncError": row["last_sync_error"],
        "warmingUntil": row["warming_until"],
        "createdAt": row["created_at"],
    }
