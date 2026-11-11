"""Note-connector persistence — DB layer for connectors, sources, sync log,
and the remote-delete-detection index.

Mirrors `api/services/journal_two/broker/connections.py`'s idiom exactly:
provider-agnostic, synchronous, testable against an in-memory/temp-file
SQLite, encrypt through exactly one encrypt helper (`_encrypt_token`, used by
`upsert_connector` and `swap_token_if_unchanged`) and decrypt through exactly
one decrypt helper (`_decrypt_token`, used by `get_token` and
`swap_token_if_unchanged`). Provider network calls live in
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
import re
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
    """Encrypt + upsert a connector's token, through `_encrypt_token` (the
    one helper that invokes `crypto_box.NoteBox.encrypt`; `get_token` reads
    through `_decrypt_token`, the one that invokes `.decrypt`).

    `token_dict` is JSON-encoded before encryption (token blobs are dicts —
    e.g. Roam's {graphToken, graphName}, Craft's {capabilityUrl, bearer}).

    Resets status to 'active' on every upsert: supplying a fresh token is
    exactly the reconnect action that should clear a prior 'broken' status.
    consent_at is set on first save (or backfilled if currently null),
    mirroring `broker.connections.save_broker_user`. A None `account_label`
    on an existing row leaves the stored label untouched (so a token-only
    refresh doesn't blank a user-set label)."""
    enc = _encrypt_token(token_dict)
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
    None if no connector row exists. Decrypts through `_decrypt_token`.

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
            return _decrypt_token(row["token_enc"])
        except crypto_box.CryptoBoxError:
            set_connector_status(user_id, provider, "broken", conn=conn)
            raise
    finally:
        if owned:
            conn.close()


def _encrypt_token(token_dict: dict[str, Any]) -> str:
    """THE one helper that invokes `crypto_box.NoteBox.encrypt` (token blobs are JSON dicts)."""
    return crypto_box.NoteBox.encrypt(json.dumps(token_dict))


def _decrypt_token(token_enc: str) -> dict[str, Any]:
    """THE one helper that invokes `crypto_box.NoteBox.decrypt`. Raises `CryptoBoxError`."""
    return json.loads(crypto_box.NoteBox.decrypt(token_enc))


def swap_token_if_unchanged(
    user_id: str, provider: str, expected_refresh_token: str, new_token: dict[str, Any],
) -> bool:
    """Compare-and-swap for a ROTATING refresh token (Plan E Task 2, Evernote).

    Writes `new_token` only if the stored credential's `refreshToken` is still
    `expected_refresh_token`, and returns True when it wrote. The read and the write run inside
    ONE `BEGIN IMMEDIATE` transaction, so the write lock is held from before the compare until the
    commit: no other writer (a second refresher in another process, or a reconnect through
    `upsert_connector`) can land between them. A refresher that lost the race, or that a member's
    reconnect overtook, gets False and must re-read rather than overwrite the newer credential.

    Returns False, writing nothing, when there is no connector row or the stored blob cannot be
    decrypted (the caller's `get_token` re-read then surfaces that failure the usual way and marks
    the connector broken). Touches only `token_enc` and `updated_at`: status, label and consent
    are the reconnect path's to set."""
    enc = _encrypt_token(new_token)  # outside the transaction: hold the write lock briefly
    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT token_enc FROM j2_note_connectors WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
        if row is None:
            conn.rollback()
            return False
        try:
            current = _decrypt_token(row["token_enc"])
        except crypto_box.CryptoBoxError:
            conn.rollback()
            return False
        if current.get("refreshToken") != expected_refresh_token:
            conn.rollback()
            return False
        conn.execute(
            "UPDATE j2_note_connectors SET token_enc = ?, updated_at = ? "
            "WHERE user_id = ? AND provider = ?",
            (enc, _now_iso(), user_id, provider),
        )
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise
    finally:
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


def pending_removal_counts(
    user_id: str, source_ids: list[str], conn: sqlite3.Connection | None = None,
) -> dict[str, int]:
    """Per source, how many remote-index rows have missed at least one pass
    (`miss_streak >= 1`, i.e. a removal awaiting its second strike). Sources
    with none are absent from the result; an empty `source_ids` returns {}
    without querying."""
    if not source_ids:
        return {}
    owned = conn is None
    conn = conn or get_connection()
    try:
        marks = ",".join("?" for _ in source_ids)
        rows = conn.execute(
            "SELECT source_id, COUNT(*) AS n FROM j2_note_remote_index "
            f"WHERE user_id = ? AND miss_streak >= 1 AND source_id IN ({marks}) "
            "GROUP BY source_id",
            (user_id, *source_ids),
        ).fetchall()
        return {r["source_id"]: int(r["n"]) for r in rows}
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


def set_follow_up(
    user_id: str, source_id: str, until_iso: str | None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Stamp (or clear, with None) when a quick follow-up pass is due for this source
    (`warming_until`, live gate 2026-11-03): a pass a provider's rate limit cut short. Read by
    `list_follow_up_due` for the `note_sync_follow_up` job."""
    return _update_source_fields(user_id, source_id, {"warming_until": until_iso}, conn)


def set_sync_state(
    user_id: str, source_id: str, raw: str | None, conn: sqlite3.Connection | None = None,
) -> bool:
    """The source's small JSON engine state (`sync_state`, fix round 1): the learned pacing
    interval (D3) and an import's progress record (I10). `None` clears it."""
    return _update_source_fields(user_id, source_id, {"sync_state": raw}, conn)


_STATE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# The stored state as a JSON object, whatever is there now: unreadable or non-object text reads as
# an empty object, so a patch never fails on (or keeps) a corrupt value.
_STATE_OBJECT_SQL = ("(CASE WHEN json_valid(sync_state) AND json_type(sync_state) = 'object' "
                     "THEN sync_state ELSE '{}' END)")


def _state_path(key: str) -> str:
    if not isinstance(key, str) or not _STATE_KEY_RE.match(key):
        raise ValueError(f"sync_state key {key!r} is not a plain identifier")
    return f"$.{key}"


def patch_sync_state(
    user_id: str, source_id: str, *, set_keys: dict[str, Any] | None = None,
    remove_keys: list[str] | tuple[str, ...] | set[str] | None = None,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """NEW-5: change single top-level keys of `sync_state` in ONE `UPDATE` (SQLite `json_set` /
    `json_remove`), never a read-modify-write of the whole blob. Two writers that touch different
    keys (a pass's `importing`/`pace`, the follow-up job's `followUpErrors`, the nightly pass's
    `fullPending`) can then never lose each other's update. An empty object is stored as NULL."""
    set_keys = dict(set_keys or {})
    remove = [k for k in (remove_keys or ()) if k not in set_keys]
    if not set_keys and not remove:
        return False
    expr = _STATE_OBJECT_SQL
    params: list[Any] = []
    if set_keys:
        parts = []
        for key, value in set_keys.items():
            parts.append(f"'{_state_path(key)}', json(?)")
            params.append(json.dumps(value, sort_keys=True))
        expr = f"json_set({expr}, {', '.join(parts)})"
    if remove:
        expr = f"json_remove({expr}, {', '.join(repr(_state_path(k)) for k in remove)})"
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            f"UPDATE j2_note_sources SET sync_state = NULLIF({expr}, '{{}}') "
            "WHERE id = ? AND user_id = ?", (*params, source_id, user_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def bump_sync_state_counter(
    user_id: str, source_id: str, key: str, conn: sqlite3.Connection | None = None,
) -> int:
    """NEW-5: add one to the integer `sync_state[key]` atomically (one `UPDATE`, then a read in
    the SAME write transaction) and return the new value; 0 when the source is gone."""
    path = _state_path(key)
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute(
            f"UPDATE j2_note_sources SET sync_state = json_set({_STATE_OBJECT_SQL}, '{path}', "
            f"COALESCE(CAST(json_extract({_STATE_OBJECT_SQL}, '{path}') AS INTEGER), 0) + 1) "
            "WHERE id = ? AND user_id = ?", (source_id, user_id))
        value = 0
        if cur.rowcount > 0:
            row = conn.execute(
                f"SELECT json_extract(sync_state, '{path}') FROM j2_note_sources "
                "WHERE id = ? AND user_id = ?", (source_id, user_id)).fetchone()
            value = int(row[0] or 0) if row else 0
        conn.commit()
        return value
    except BaseException:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def clear_follow_up(
    user_id: str, source_id: str, *, full_pending_at: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Clear the follow-up stamp, unless `sync_state.fullPending` is set (D4-3: a nightly full
    pass that found no free slot): then the stamp becomes `full_pending_at`, so the pool still
    runs that full pass. One `UPDATE`, so a flag booked a moment ago is never cleared with it."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_sources SET warming_until = CASE "
            f"WHEN json_extract({_STATE_OBJECT_SQL}, '$.fullPending') THEN ? ELSE NULL END "
            "WHERE id = ? AND user_id = ?", (full_pending_at, source_id, user_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def book_follow_up_no_later_than(
    user_id: str, source_id: str, at_iso: str, conn: sqlite3.Connection | None = None,
) -> bool:
    """Stamp a follow-up for `at_iso`, or keep an EARLIER stamp already there (one `UPDATE`)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_sources SET warming_until = CASE "
            "WHEN warming_until IS NULL OR warming_until > ? THEN ? ELSE warming_until END "
            "WHERE id = ? AND user_id = ?", (at_iso, at_iso, source_id, user_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def list_follow_up_due(
    now_iso: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Every sync-enabled, active source whose follow-up stamp is at or before `now_iso`, oldest
    stamp first. Same filters as `list_due_sources`: a paused, broken or disabled source never
    gets a follow-up pass."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT * FROM j2_note_sources
             WHERE sync_enabled = 1 AND status = 'active'
               AND warming_until IS NOT NULL AND warming_until <= ?
             ORDER BY warming_until ASC
            """,
            (now_iso,),
        ).fetchall()
        return [_row_to_source(r) for r in rows]
    finally:
        if owned:
            conn.close()


def count_passes_since(
    user_id: str, source_id: str, since_iso: str, conn: sqlite3.Connection | None = None,
) -> int:
    """How many sync passes (log rows, any status) started for this source after `since_iso`:
    the hourly bound on follow-up passes reads it, so no new counter column is needed."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_note_sync_log "
            "WHERE source_id = ? AND user_id = ? AND started_at > ?",
            (source_id, user_id, since_iso),
        ).fetchone()
        return int(row["n"]) if row else 0
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


def note_removal_check(user_id: str, source_id: str, *, ran: bool) -> int:
    """Plan E Task 6 review R2: record whether a full pass's removal check RAN (resets the count)
    or was SKIPPED because the complete listing failed (adds one). Returns the new count of
    consecutive skips. Atomic: one UPDATE, then a read on the same connection."""
    conn = get_connection()
    try:
        if ran:
            conn.execute("UPDATE j2_note_sources SET removal_skips = 0 WHERE id = ? AND user_id = ?",
                         (source_id, user_id))
        else:
            conn.execute("UPDATE j2_note_sources SET removal_skips = removal_skips + 1 "
                         "WHERE id = ? AND user_id = ?", (source_id, user_id))
        row = conn.execute("SELECT removal_skips FROM j2_note_sources WHERE id = ? AND user_id = ?",
                           (source_id, user_id)).fetchone()
        conn.commit()
        return int(row["removal_skips"]) if row else 0
    finally:
        conn.close()


def removal_skips(user_id: str, source_id: str) -> int:
    conn = get_connection()
    try:
        row = conn.execute("SELECT removal_skips FROM j2_note_sources WHERE id = ? AND user_id = ?",
                           (source_id, user_id)).fetchone()
        return int(row["removal_skips"]) if row else 0
    finally:
        conn.close()


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
    status: str | None = None, conn: sqlite3.Connection | None = None,
) -> bool:
    """Fix-round (msgraph wave, Important #4): a SUCCESSFUL sync also clears
    a prior 'broken' status back to 'active' — shared by every provider
    (Notion/Dropbox/Roam/Craft/OneNote/OneDrive alike), not a msgraph-only
    fix. Without this, a source that hit a mid-drain auth failure
    (`engine.py`'s own `NoteConnAuthError` handler marks BOTH the source and
    the connector 'broken') stayed 'broken' FOREVER even after the user
    reconnected and a manual sync actually succeeded: `upsert_connector`
    resets only the CONNECTOR's status on reconnect, and `create_source`'s
    idempotent-return leaves an EXISTING source's status untouched — while
    `list_due_sources`/`list_all_sources` both filter to `status='active'`,
    so the source silently fell off the schedule permanently (a real trap
    whenever Microsoft rotates/revokes a refresh token — Graph is the
    provider family most likely to trip this).

    Scoped to `'broken' -> 'active'` ONLY (the `WHERE status = 'broken'` in
    the UPDATE below) — never touches any other status a future disable
    path might set (e.g. 'disabled', reserved but not exercised by any
    source today). A genuinely FAILING sync (`ok=False`) never touches
    `status` at all here — marking 'broken' stays engine.py's own, separate
    `set_source_status` call on an auth error; this function only ever
    WIDENS what counts as recovered, never weakens what counts as broken.

    ⛔⛔ session-audit.md A1 follow-up — `status` and `ok` are SEPARATE
    questions, and collapsing them is what hid a lost sync. `ok` answers
    "did this pass run without raising", which is what drives the
    'broken' -> 'active' recovery above. `status` is what the member is
    SHOWN (`SourceRow.jsx` dots an amber warning on
    `lastSyncStatus === 'warning'`). A pass that authenticated, fetched, and
    then stored NOTHING is `ok=True` (auth works, so recover the source) but
    `status='warning'` (the member must not be told it was fine). Before
    this, `last_sync_status` could only ever be written "ok" or "error", so
    SourceRow's warning branch was unreachable: built, green, and dead.

    `error` is now persisted whatever the status, rather than only on a
    failure -- a warning with no reason gives the member an amber dot and
    nothing to act on. It still CLEARS on a healthy pass, because a
    successful sync passes `error=None` and this writes exactly what it is
    given; a stale reason left on a recovered source is its own lie."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE j2_note_sources
               SET last_sync_at = ?, last_sync_status = ?, last_sync_error = ?,
                   status = CASE WHEN ? AND status = 'broken' THEN 'active' ELSE status END
             WHERE id = ? AND user_id = ?
            """,
            (
                _now_iso(), status or ("ok" if ok else "error"), error,
                1 if ok else 0,
                source_id, user_id,
            ),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


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
        "syncState": row["sync_state"] if "sync_state" in row.keys() else None,
        "lastFullSyncAt": row["last_full_sync_at"],
        "createdAt": row["created_at"],
    }
