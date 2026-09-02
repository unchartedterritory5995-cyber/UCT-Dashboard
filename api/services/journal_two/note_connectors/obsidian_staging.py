"""Staging writes for the Obsidian push transport (Task 3 of the
2026-09-02-obsidian-ingest-server plan).

Obsidian is local-first, so the plugin PUSHES; the sync engine only PULLS
from providers. Staging is the seam: this module writes `j2_obsidian_staging`
(and, on a `final` push, `j2_obsidian_manifest`), and Task 4's provider reads
those SAME tables and satisfies the ordinary `NoteProvider` contract, so the
engine's convert -> upsert -> conflict -> media path and its delete detection
are INHERITED here, never re-implemented.

⛔ This module NEVER writes `j2_notes`. See the router docstring
(`api/routers/note_sync.py::obsidian_ingest`) for why that shortcut is
forbidden -- writing notes directly would duplicate the conflict ratchet,
delete detection, media phase and import-hash logic, and the copies would
drift apart silently.

Cross-tenant safety: every function here takes `user_id`/`vault_id` as
explicit keyword parameters that the ROUTER must source from the
authenticated device (`obsidian_link.authenticate_device`), never from the
request body. Task 1's review carried this forward as the constraint most
likely to bite here: `j2_obsidian_devices`'s bare `id` primary key does not
stop a cross-tenant read/write on its own, so every query in this module
filters on both `user_id` AND `vault_id` explicitly -- there is no code path
that lets a value from the request body pick which tenant's rows get touched.

Spec: .superpowers/sdd/2026-09-02-obsidian-ingest-server/task-3-brief.md
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ingest_batch(
    *,
    user_id: str,
    vault_id: str,
    notes: list[dict[str, Any]],
    manifest: list[str] | None,
    final: bool,
) -> dict[str, Any]:
    """Writes `notes` into `j2_obsidian_staging` for `(user_id, vault_id)`,
    then -- only when `final` is true AND a `manifest` was actually supplied
    -- atomically replaces `j2_obsidian_manifest` for the same pair. Returns
    `{"written": int, "skipped": int, "manifestReplaced": bool}`.

    No-op on an unchanged hash: an existing row whose stored `content_hash`
    already equals the pushed one is neither rewritten nor its `received_at`
    bumped -- a plugin's routine re-push of untouched files must never
    manufacture fake activity for that path.

    Manifest atomicity: the DELETE + INSERT for the manifest run in the SAME
    transaction as the note writes -- one `commit()` at the end, one
    `rollback()` on any failure -- so the table is never observably empty
    between the delete and the re-insert. A partial push must never leave a
    truncated manifest: Task 4 hands this table to the engine's
    `list_present_refs` hook as the COMPLETE remote set, and a truncated one
    would read as "the member deleted every file not in this batch." A
    NON-final push, or a final push that sends no `manifest` field at all
    (`manifest is None`), never touches this table.
    """
    received_at = _now_iso()
    written = 0
    skipped = 0
    conn = get_connection()
    try:
        for note in notes:
            vault_path = note["vault_path"]
            content_hash = note["content_hash"]
            existing = conn.execute(
                "SELECT content_hash FROM j2_obsidian_staging "
                "WHERE user_id = ? AND vault_id = ? AND vault_path = ?",
                (user_id, vault_id, vault_path),
            ).fetchone()
            if existing is not None and existing["content_hash"] == content_hash:
                skipped += 1
                continue
            conn.execute(
                "INSERT OR REPLACE INTO j2_obsidian_staging "
                "(user_id, vault_id, vault_path, content_hash, body_md, updated_at, received_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id, vault_id, vault_path, content_hash,
                    note["body_md"], note["updated_at"], received_at,
                ),
            )
            written += 1

        manifest_replaced = False
        if final and manifest is not None:
            conn.execute(
                "DELETE FROM j2_obsidian_manifest WHERE user_id = ? AND vault_id = ?",
                (user_id, vault_id),
            )
            recorded_at = _now_iso()
            conn.executemany(
                "INSERT INTO j2_obsidian_manifest (user_id, vault_id, vault_path, recorded_at) "
                "VALUES (?, ?, ?, ?)",
                [(user_id, vault_id, path, recorded_at) for path in manifest],
            )
            manifest_replaced = True

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {"written": written, "skipped": skipped, "manifestReplaced": manifest_replaced}
