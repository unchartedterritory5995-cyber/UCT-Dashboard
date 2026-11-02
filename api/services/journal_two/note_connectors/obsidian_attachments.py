"""Obsidian attachment staging store (connector fidelity Plan C, Task 1).

The Obsidian plugin is a PUSH transport: it cannot be fetched from, so a vault's
attachments (images, PDFs, ...) are uploaded by content hash ahead of the sync that
needs them. This module stages those bytes per (member, vault, sha256) so the
provider's `fetch_media` can serve them during the next sync, through the ordinary
media door (`media_policy.normalize_media` / `normalize_file` + `store_media`).

Layout: `blob_root()/<user_id>/<vault_id>/<sha256>`, one row per blob in
`j2_obsidian_attachments`. `blob_root()` deliberately lives OUTSIDE
`attachment_root()`, so the nightly attachment backup never tars staging copies and
`media_policy.member_media_bytes` never counts them.

Invariants, one guard each:
  * Member scoping -- every read resolves the blob through its ROW, looked up by
    `(user_id, vault_id, sha256)`; the file path is built from that row's columns,
    never from the request's. A member can never read another member's blob.
  * Integrity -- the bytes are hashed while streaming; a digest that is not the
    named `sha256` is refused (400) and nothing is left on disk.
  * Size -- one blob is at most `MAX_BLOB_BYTES` (A's media source cap, 25 MB).
  * Member room -- `remaining_bytes(user) = max(0, min(CAP - staged SUM,
    CAP - live stored media))` (Plan C ledger ruling): the staged copy is a cache with
    its own bound, and the plugin is never promised room the stored-media cap refuses.
    The 2 GB cap is never counted twice (the two usages are never summed).
  * Volume headroom -- `notes_quota.assert_import_headroom`; full volume is a 503.

Heavy work stays off the event loop: `stage_blob_stream` runs every disk write, hash
and DB call through `asyncio.to_thread`. `gc_unreferenced` is sync (callers run it in
a worker thread) and bounded: at most `GC_BATCH` blobs per call, for one vault.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import AsyncIterator

from api.services.auth_db import get_connection
from api.services.journal_two import media_policy
from api.services.journal_two.media_policy import MEMBER_IMPORT_MEDIA_CAP_BYTES  # noqa: F401 -- module attr, patched in tests
from api.services.journal_two.notes_quota import NoteQuotaExceeded, assert_import_headroom

log = logging.getLogger("journal_two.obsidian_attachments")

# A's media authority (== notes._MAX_FILE_BYTES, 25 MiB).
MAX_BLOB_BYTES: int = media_policy.MEDIA_SOURCE_MAX_BYTES
# Most blobs one `gc_unreferenced` call removes.
GC_BATCH = 500
# Most hashes per `IN (...)` query.
_IN_CHUNK = 500

_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
# Serialises the final room check with the row insert, so two concurrent uploads for
# one member cannot both pass a check that only one of them fits.
_COMMIT_LOCK = threading.Lock()


class BlobRejected(Exception):
    """A staging upload refused: `.status` is the HTTP status (400/413/503)."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def blob_root() -> Path:
    override = os.environ.get("J2_OBSIDIAN_BLOB_ROOT")
    if override:
        return Path(override)
    return Path(os.environ.get("DATA_DIR", "/data")) / "j2_obsidian_staging_blobs"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _valid_ids(user_id, vault_id) -> bool:
    # Same segment rule media_policy applies to the member's attachment directory.
    return (isinstance(user_id, str) and isinstance(vault_id, str)
            and media_policy._safe_segment(user_id) and media_policy._safe_segment(vault_id))


def _valid_sha(sha256) -> bool:
    return isinstance(sha256, str) and bool(_SHA_RE.match(sha256))


def _check_ids(user_id, vault_id, sha256=None) -> None:
    if not _valid_ids(user_id, vault_id):
        raise BlobRejected(400, "invalid member or vault id")
    if sha256 is not None and not _valid_sha(sha256):
        raise BlobRejected(400, "sha256 must be 64 lowercase hex characters")


def _path(user_id: str, vault_id: str, sha256: str) -> Path:
    return blob_root() / user_id / vault_id / sha256


# ── room ────────────────────────────────────────────────────────────────────

def _staged_sum(conn: sqlite3.Connection, user_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(size), 0) FROM j2_obsidian_attachments WHERE user_id = ?", (user_id,)
    ).fetchone()
    return int(row[0] or 0)


def remaining_bytes(user_id: str) -> int:
    """Bytes this member may still stage: the smaller of the staged-blob remainder and
    the live stored-media remainder (`media_policy`'s memoised per-member usage), floored
    at 0. Both against the one `MEMBER_IMPORT_MEDIA_CAP_BYTES`."""
    cap = MEMBER_IMPORT_MEDIA_CAP_BYTES
    conn = get_connection()
    try:
        staged = _staged_sum(conn, user_id)
    finally:
        conn.close()
    live = media_policy.MediaBudget.for_member(user_id).used
    return max(0, min(cap - staged, cap - live))


# ── stage ───────────────────────────────────────────────────────────────────

def _existing(user_id: str, vault_id: str, sha256: str) -> bool:
    """True when the blob is staged (row AND file). A row whose file is gone is dropped,
    so the upload stores it again instead of answering "already staged" forever."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM j2_obsidian_attachments WHERE user_id = ? AND vault_id = ? AND sha256 = ?",
            (user_id, vault_id, sha256),
        ).fetchone()
        if row is None:
            return False
        if _path(user_id, vault_id, sha256).is_file():
            return True
        conn.execute(
            "DELETE FROM j2_obsidian_attachments WHERE user_id = ? AND vault_id = ? AND sha256 = ?",
            (user_id, vault_id, sha256),
        )
        conn.commit()
        return False
    finally:
        conn.close()


def _headroom(nbytes: int) -> None:
    try:
        assert_import_headroom(nbytes)
    except NoteQuotaExceeded as e:
        raise BlobRejected(503, "storage is temporarily full; try again later") from e


def _too_large() -> BlobRejected:
    return BlobRejected(413, f"attachment is too large (limit {MAX_BLOB_BYTES // (1024 * 1024)} MB)")


def _no_room() -> BlobRejected:
    return BlobRejected(413, "storage limit reached for imported media")


def _commit(user_id: str, vault_id: str, sha256: str, tmp: Path, final: Path, size: int,
            declared_mime: str | None, name: str | None) -> bool:
    """Final room check + rename + row insert, under `_COMMIT_LOCK`."""
    with _COMMIT_LOCK:
        if size > remaining_bytes(user_id):
            raise _no_room()
        conn = get_connection()
        try:
            os.replace(tmp, final)
            cur = conn.execute(
                "INSERT OR IGNORE INTO j2_obsidian_attachments"
                " (user_id, vault_id, sha256, size, declared_mime, name, received_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, vault_id, sha256, size, declared_mime, name, _now()),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


async def stage_blob_stream(*, user_id: str, vault_id: str, sha256: str, declared_mime: str | None,
                            name: str | None, chunks: AsyncIterator[bytes],
                            declared_length: int | None) -> bool:
    """Streams one blob into staging. Returns True when newly stored, False when the
    blob was already staged for this (member, vault). Raises `BlobRejected`: 400 bad
    ids / hash mismatch / length mismatch, 413 over `MAX_BLOB_BYTES` or over the
    member's remaining room, 503 volume full. Nothing is left on disk on any failure."""
    _check_ids(user_id, vault_id, sha256)
    if await asyncio.to_thread(_existing, user_id, vault_id, sha256):
        return False

    room = await asyncio.to_thread(remaining_bytes, user_id)
    if declared_length is not None:
        if declared_length < 0:
            raise BlobRejected(400, "invalid content length")
        if declared_length > MAX_BLOB_BYTES:
            raise _too_large()
        if declared_length > room:
            raise _no_room()
        await asyncio.to_thread(_headroom, declared_length)
    else:
        await asyncio.to_thread(_headroom, min(MAX_BLOB_BYTES, room))

    final = _path(user_id, vault_id, sha256)
    tmp = final.with_name(f"{sha256}.tmp-{uuid.uuid4().hex}")
    await asyncio.to_thread(final.parent.mkdir, parents=True, exist_ok=True)
    digest = hashlib.sha256()
    count = 0
    fh = await asyncio.to_thread(open, tmp, "xb")
    try:
        try:
            async for chunk in chunks:
                if not chunk:
                    continue
                count += len(chunk)
                if count > MAX_BLOB_BYTES:
                    raise _too_large()
                if count > room:
                    raise _no_room()
                await asyncio.to_thread(_write, fh, digest, chunk)
        finally:
            await asyncio.to_thread(fh.close)
        if declared_length is not None and count != declared_length:
            raise BlobRejected(400, "body length does not match the declared length")
        if digest.hexdigest() != sha256:
            raise BlobRejected(400, "content does not match its sha256")
        return await asyncio.to_thread(_commit, user_id, vault_id, sha256, tmp, final, count,
                                       declared_mime, name)
    except BaseException:
        await asyncio.to_thread(_unlink, tmp)
        raise


def _write(fh, digest, chunk: bytes) -> None:
    digest.update(chunk)
    fh.write(chunk)


def _unlink(p: Path) -> None:
    try:
        p.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:  # noqa: BLE001 -- reported, the caller's own error is what surfaces
        log.warning("obsidian staging tmp cleanup failed for %s: %s", p, e)


# ── read ────────────────────────────────────────────────────────────────────

def missing_hashes(user_id: str, vault_id: str, hashes: list[str]) -> list[str]:
    """The hashes NOT staged for this (member, vault), in request order, deduped."""
    _check_ids(user_id, vault_id)
    wanted: list[str] = []
    seen: set[str] = set()
    for h in hashes:
        if not _valid_sha(h):
            raise BlobRejected(400, "sha256 must be 64 lowercase hex characters")
        if h not in seen:
            seen.add(h)
            wanted.append(h)
    have: set[str] = set()
    conn = get_connection()
    try:
        for i in range(0, len(wanted), _IN_CHUNK):
            part = wanted[i:i + _IN_CHUNK]
            marks = ",".join("?" * len(part))
            have.update(r[0] for r in conn.execute(
                f"SELECT sha256 FROM j2_obsidian_attachments WHERE user_id = ? AND vault_id = ?"
                f" AND sha256 IN ({marks})", (user_id, vault_id, *part)))
    finally:
        conn.close()
    return [h for h in wanted if h not in have]


def read_blob(user_id: str, vault_id: str, sha256: str) -> tuple[bytes, str | None] | None:
    """`(data, declared_mime)` for a blob staged for this (member, vault), else None.
    The ROW is the scoping guard: the path is built from the row's own columns."""
    if not _valid_ids(user_id, vault_id) or not _valid_sha(sha256):
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT user_id, vault_id, sha256, declared_mime FROM j2_obsidian_attachments"
            " WHERE user_id = ? AND vault_id = ? AND sha256 = ?",
            (user_id, vault_id, sha256),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    try:
        data = _path(row[0], row[1], row[2]).read_bytes()
    except FileNotFoundError:
        return None
    return data, row[3]


# ── gc / purge ──────────────────────────────────────────────────────────────

def gc_unreferenced(user_id: str, vault_id: str, *, older_than: timedelta = timedelta(hours=24)) -> int:
    """Removes up to `GC_BATCH` blobs of ONE (member, vault) that no staging row's
    `attachments_json` references and that were received before `older_than` ago.
    A referenced blob always survives (an engine retry re-calls `fetch_media`). When any
    reference list for the vault is unreadable, nothing is removed: guessing could delete
    a blob a note still needs. Returns the number removed. Sync: run it in a worker thread."""
    if not _valid_ids(user_id, vault_id):
        return 0
    cutoff = (datetime.now(timezone.utc) - older_than).isoformat()
    conn = get_connection()
    try:
        referenced: set[str] = set()
        for (raw,) in conn.execute(
            "SELECT attachments_json FROM j2_obsidian_staging"
            " WHERE user_id = ? AND vault_id = ? AND attachments_json IS NOT NULL",
            (user_id, vault_id),
        ):
            try:
                items = json.loads(raw)
                referenced.update(it["sha256"] for it in items if isinstance(it, dict) and "sha256" in it)
            except (ValueError, TypeError, KeyError):
                log.warning("obsidian staging gc skipped for %s/%s: unreadable attachments_json",
                            user_id, vault_id)
                return 0
        doomed: list[str] = []
        for (sha,) in conn.execute(
            "SELECT sha256 FROM j2_obsidian_attachments WHERE user_id = ? AND vault_id = ?"
            " AND received_at < ? ORDER BY received_at", (user_id, vault_id, cutoff),
        ):
            if sha not in referenced:
                doomed.append(sha)
                if len(doomed) >= GC_BATCH:
                    break
        for sha in doomed:
            conn.execute(
                "DELETE FROM j2_obsidian_attachments WHERE user_id = ? AND vault_id = ? AND sha256 = ?",
                (user_id, vault_id, sha),
            )
        conn.commit()
    finally:
        conn.close()
    # Rows first, files after the commit: a crash between leaves an orphan FILE (overwritten
    # by a later upload), never a row pointing at nothing.
    for sha in doomed:
        _unlink(_path(user_id, vault_id, sha))
    return len(doomed)


def delete_user_rows(conn: sqlite3.Connection, user_id: str) -> int:
    """Deletes the member's staging rows on the CALLER's connection, uncommitted, so a
    caller can make it part of its own transaction. Pair with `remove_user_tree` AFTER the
    commit."""
    return conn.execute("DELETE FROM j2_obsidian_attachments WHERE user_id = ?", (user_id,)).rowcount


def remove_user_tree(user_id: str) -> bool:
    """Removes `blob_root()/<user_id>`. True when a directory was removed."""
    if not isinstance(user_id, str) or not media_policy._safe_segment(user_id):
        return False
    udir = blob_root() / user_id
    if not udir.is_dir():
        return False
    shutil.rmtree(udir, ignore_errors=True)
    return True


def purge_user(user_id: str) -> int:
    """Every staged blob of the member, every vault: rows, then the directory. Returns the
    number of rows removed."""
    conn = get_connection()
    try:
        n = delete_user_rows(conn, user_id)
        conn.commit()
    finally:
        conn.close()
    remove_user_tree(user_id)
    return n
