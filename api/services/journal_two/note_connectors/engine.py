"""The sync engine — orchestrates providers into synced Notebook notes.

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §3 (flow),
§5 (tables incl. remote_index + delete detection), §6 (conflict policy).

Mirrors `api/services/journal_two/broker/sync.py`'s idioms (locks, cooldown,
`_LOCKED_RETRY_DELAYS`, `_start_log`/`_finish_log` bracket) — NOT its trading
logic. Every DB access opens its own short-lived connection via
`auth_db.get_connection()` (never threads an explicit `conn` across module
boundaries in production code) so tests achieve isolation the same way
`test_note_connectors_connections.py` does: monkeypatch `auth_db._DB_PATH`
to a temp file before any connection is opened.

Flow per source, per sync:
  1. `provider.list_changed(creds, cursor)` — the ONLY "what changed" signal.
     The raw stored cursor is passed straight through; providers own their
     own overlap window internally (Craft: -1h; Roam: re-enumerates + diffs
     edit-times) — the engine never adjusts it.
  2. Full syncs (`full=True`) run delete detection FIRST, against the
     PRE-sync remote_index snapshot (see `_run_delete_detection`), then
     every seen ref is upserted into remote_index (`_touch_remote_index`).
  3. Resolve refs -> RemoteNotes, preferring `provider.fetch_many` (batched)
     with a per-ref `fetch()` fallback so one bad ref in a batch yields one
     named failure, never the whole batch.
  4. Conflict policy (spec §6): for each fetched note whose import_key
     already exists locally AND whose local `updated_at` is newer than its
     `imported_at` (edited locally since the last sync), do NOT touch the
     original — instead upsert a sibling under `{key}#remote` titled
     "{title} (synced copy)", tag BOTH the sibling and the (untouched)
     original `sync-conflict`. Everything else goes through the normal
     import_key and lets `import_confirm`'s own hash check decide
     create/update/skip.
  5. `import_confirm` is called with the PLACEHOLDER body (import-ref://,
     import-link://) in <=200-note batches — the hash is computed over that
     placeholder body, with the remote's own `updatedAt` in the hash basis
     (it IS the change signal). Only AFTER confirm: media is downloaded
     (`provider.fetch_media` or a `data_uri` entry decoded directly) and
     `rewrite_body` resolves the placeholders; the result is written via
     `_apply_resolved_body` (NOT `notes_svc.update_note`) — that raw write
     deliberately skips bumping `updated_at`, since this step is completing
     the SAME import episode `import_confirm` just stamped, not a new edit
     (see `_apply_resolved_body`'s docstring for the false-conflict bug this
     avoids).
  6. Cursor advances to `max(ref.updated_at for ref in refs)` ONLY if the
     whole sync completed without raising — a provider exception mid-source
     updates the log row to 'error' and leaves the cursor untouched.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import random
import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.note_connectors import connections, errors
from api.services.journal_two.note_connectors.convert import rewrite_body
from api.services.journal_two.note_connectors.providers.base import (
    NoteProvider, RemoteNote, RemoteRef,
)

log = logging.getLogger("note_connectors.engine")

# Per-source async locks (process-local) — prevents scheduler + manual
# "Sync now" + webhook-triggered calls from double-processing one source.
_locks: dict[str, asyncio.Lock] = {}

# Backoff ladder after a transient sqlite3 "database is locked" (mirrors
# broker/sync.py's _LOCKED_RETRY_DELAYS exactly). Jittered so parallel
# retriers don't re-collide in lockstep.
_LOCKED_RETRY_DELAYS = (1.0, 3.0, 8.0)

# A source synced within this window is skipped unless the caller passes
# manual=True (the explicit "Sync now" action always runs).
_COOLDOWN_SECONDS = 600

# Roam's own pull-many batches 40 eids/call; other providers just inherit
# fetch_many's default per-ref loop, so this bound mainly controls failure
# isolation granularity (how many notes one bad batch can knock out before
# the per-ref fallback kicks in), not provider-specific behavior.
_FETCH_BATCH_SIZE = 40

# Server-side cap on notes_svc.import_confirm is 500/batch; the engine stays
# well under it.
_CONFIRM_BATCH_SIZE = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _chunks(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ── Provider resolution (test seam; Task 11's registry replaces this) ───────

def _default_provider_factory(provider_name: str) -> NoteProvider:
    """Builds a FRESH provider instance per sync call — providers may keep
    per-sync instance state (Roam's title->uid link map), so a shared/cached
    instance across sources or across calls would be wrong. Lazy imports so
    importing this module never pulls in httpx-based provider modules unless
    a provider actually needs resolving."""
    if provider_name == "roam":
        from .providers.roam import RoamProvider
        return RoamProvider()
    if provider_name == "craft":
        from .providers.craft import CraftProvider
        return CraftProvider()
    raise errors.NoteConnNotConfigured(f"no provider registered for {provider_name!r}")


# Module-level so tests can `monkeypatch.setattr(engine, "_provider_factory", ...)`
# to inject a fake provider without touching real provider modules.
_provider_factory = _default_provider_factory


# ── Locks + cooldown ─────────────────────────────────────────────────────────

def _lock_for(source_id: str) -> asyncio.Lock:
    # setdefault is atomic (no await in between) -> no lazy-create TOCTOU
    # race that could hand two coroutines distinct locks for one source.
    return _locks.setdefault(source_id, asyncio.Lock())


def _within_cooldown(source: dict[str, Any]) -> bool:
    last = _parse_iso(source.get("lastSyncAt"))
    if last is None:
        return False
    return (datetime.now(timezone.utc) - last).total_seconds() < _COOLDOWN_SECONDS


# ── Sync log bracket (mirrors broker/sync.py's _start_log/_finish_log) ──────

def _start_log(user_id: str, source_id: str) -> int:
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO j2_note_sync_log (source_id, user_id, started_at) "
            "VALUES (?, ?, ?)",
            (source_id, user_id, _now_iso()),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _finish_log(
    log_id: int, *, status: str, counts: dict[str, int], error: str | None = None,
) -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE j2_note_sync_log
               SET finished_at = ?, status = ?, error = ?,
                   notes_created = ?, notes_updated = ?, notes_skipped = ?,
                   media_uploaded = ?, conflicts = ?
             WHERE id = ?
            """,
            (
                _now_iso(), status, error,
                int(counts.get("created", 0)), int(counts.get("updated", 0)),
                int(counts.get("skipped", 0)), int(counts.get("mediaUploaded", 0)),
                int(counts.get("conflicts", 0)),
                log_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()


# ── Public entry points ──────────────────────────────────────────────────────

async def sync_source(
    source_id: str, *, full: bool = False, manual: bool = False,
) -> dict[str, Any]:
    """Sync one source. Serialized per source via an asyncio lock. A source
    synced within the cooldown window is skipped unless `manual=True`."""
    source = connections.get_source_by_id(source_id)
    if source is None:
        raise ValueError(f"unknown note-connector source {source_id!r}")

    if not manual and _within_cooldown(source):
        return {"status": "cooldown", "lastSyncAt": source.get("lastSyncAt")}

    async with _lock_for(source_id):
        attempts = 1 + len(_LOCKED_RETRY_DELAYS)
        for attempt in range(attempts):
            try:
                return await _do_sync(source["userId"], source_id, full=full)
            except sqlite3.OperationalError as e:
                if "locked" not in str(e).lower() or attempt == attempts - 1:
                    raise
                await asyncio.sleep(_LOCKED_RETRY_DELAYS[attempt] * random.uniform(0.5, 1.5))
        raise RuntimeError("unreachable")  # loop always returns or raises


async def sync_due_sources() -> None:
    """Scheduler entry: serial iteration over every due source, across all
    users. One failing source is logged and never blocks the others."""
    interval = int(os.environ.get("NOTE_SYNC_INTERVAL_MIN", "30"))
    due = connections.list_due_sources(interval)
    for source in due:
        try:
            await sync_source(source["id"])
        except Exception:  # noqa: BLE001 — isolate per-source failures
            log.exception("note-connector sync failed for source %s", source["id"])


# ── Core per-source sync ─────────────────────────────────────────────────────

async def _do_sync(user_id: str, source_id: str, *, full: bool) -> dict[str, Any]:
    source = connections.get_source_by_id(source_id)
    if source is None:
        raise ValueError(f"unknown note-connector source {source_id!r}")

    log_id = _start_log(user_id, source_id)
    counts = {"created": 0, "updated": 0, "skipped": 0, "mediaUploaded": 0, "conflicts": 0}
    item_failures: list[str] = []
    delete_guard_warning: str | None = None
    deleted_count = 0
    provider: NoteProvider | None = None

    try:
        provider = _provider_factory(source["provider"])
        creds = connections.get_token(user_id, source["provider"])
        if creds is None:
            raise errors.NoteConnNotConfigured(
                f"no connected credentials for provider {source['provider']!r}"
            )

        # Raw cursor, unadjusted — providers own their own overlap window.
        cursor = None if full else source.get("cursor")
        refs = await provider.list_changed(creds, cursor=cursor)

        if full:
            dd = _run_delete_detection(user_id, source, refs)
            if dd["status"] == "warning":
                delete_guard_warning = dd["reason"]
            else:
                deleted_count = dd["deleted"]

        _touch_remote_index(user_id, source, provider, refs)

        remote_notes, fetch_failures = await _fetch_remote_notes(provider, creds, refs)
        item_failures.extend(fetch_failures)

        if remote_notes:
            result = await _import_remote_notes(user_id, source, provider, creds, remote_notes)
            counts["created"] += result["created"]
            counts["updated"] += result["updated"]
            counts["skipped"] += result["skipped"]
            counts["mediaUploaded"] += result["mediaUploaded"]
            counts["conflicts"] += result["conflicts"]
            item_failures.extend(result["failures"])

        if refs:
            newest = max(r.updated_at for r in refs)
            connections.update_cursor(user_id, source_id, newest)

        connections.record_sync_result(user_id, source_id, ok=True)

        status = "warning" if delete_guard_warning else "ok"
        error_parts = ([delete_guard_warning] if delete_guard_warning else []) + item_failures
        _finish_log(
            log_id, status=status, counts=counts,
            error="; ".join(error_parts) if error_parts else None,
        )

        return {
            "status": status,
            "sourceId": source_id,
            **counts,
            "sourceDeleted": deleted_count,
            "failures": item_failures,
            "deleteDetectionWarning": delete_guard_warning,
        }
    except Exception as e:
        connections.record_sync_result(user_id, source_id, ok=False, error=str(e))
        if isinstance(e, errors.NoteConnAuthError):
            # Auth rejected (incl. NoteConnTokenExpired, a subclass) — retrying
            # on the next scheduled sync would just fail identically forever
            # (mirrors broker/sync.py's SnapAuthError handling). Mark BOTH the
            # source and the connector 'broken' so list_due_sources excludes
            # this source going forward and the UI prompts a reconnect.
            try:
                connections.set_source_status(user_id, source_id, "broken", error=str(e))
                connections.set_connector_status(user_id, source["provider"], "broken")
            except Exception:  # noqa: BLE001 — never let this bookkeeping mask the real error
                pass
        _finish_log(log_id, status="error", counts=counts, error=str(e))
        raise
    finally:
        if provider is not None:
            aclose = getattr(provider, "aclose", None)
            if aclose is not None:
                try:
                    await aclose()
                except Exception:  # noqa: BLE001 — never let cleanup mask the real error
                    pass


# ── Delete detection (spec §5) ───────────────────────────────────────────────

def _run_delete_detection(
    user_id: str, source: dict[str, Any], refs: list[RemoteRef],
) -> dict[str, Any]:
    """Runs BEFORE `_touch_remote_index` so `prev_count` reflects the index
    as of before this sync touched anything — touching first would inflate
    the denominator with brand-new rows and mask a genuine bad-enumeration
    refuse case. Refs seen this round and refs not seen are disjoint sets, so
    running the two passes in either order never double-touches a row; only
    the refuse-guard's denominator cares about ordering."""
    source_id = source["id"]
    seen_ids = {r.remote_id for r in refs}
    conn = get_connection()
    try:
        existing_rows = conn.execute(
            "SELECT remote_id, import_key, miss_streak FROM j2_note_remote_index "
            "WHERE user_id = ? AND source_id = ?",
            (user_id, source_id),
        ).fetchall()
        prev_count = len(existing_rows)
        if prev_count > 0 and len(seen_ids) < prev_count * 0.5:
            return {
                "status": "warning",
                "deleted": 0,
                "reason": (
                    f"delete-detection refused for source {source_id}: full "
                    f"enumeration returned {len(seen_ids)} of {prev_count} "
                    f"previously-known items (<50%) — leaving the index untouched"
                ),
            }

        deleted = 0
        for row in existing_rows:
            if row["remote_id"] in seen_ids:
                continue  # still present -> refreshed by _touch_remote_index
            streak = (row["miss_streak"] or 0) + 1
            if streak >= 2:
                _tag_note_source_deleted(conn, user_id, row["import_key"])
                conn.execute(
                    "DELETE FROM j2_note_remote_index "
                    "WHERE user_id = ? AND source_id = ? AND remote_id = ?",
                    (user_id, source_id, row["remote_id"]),
                )
                deleted += 1
            else:
                conn.execute(
                    "UPDATE j2_note_remote_index SET miss_streak = ? "
                    "WHERE user_id = ? AND source_id = ? AND remote_id = ?",
                    (streak, user_id, source_id, row["remote_id"]),
                )
        conn.commit()
        return {"status": "ok", "deleted": deleted, "reason": None}
    finally:
        conn.close()


def _tag_note_source_deleted(conn: sqlite3.Connection, user_id: str, import_key: str) -> None:
    """NEVER deletes the note — flags it (mirrors the `demote_broker_accounts`
    instinct: a missing-remote item soft-degrades, it doesn't vanish)."""
    row = conn.execute(
        "SELECT id, tags FROM j2_notes WHERE user_id = ? AND import_key = ?",
        (user_id, import_key),
    ).fetchone()
    if row is None:
        return  # note was never successfully imported (or already removed) — nothing to tag
    tags = json.loads(row["tags"] or "[]")
    if "source-deleted" in tags:
        return
    tags.append("source-deleted")
    notes_svc.update_note(user_id, row["id"], {"tags": tags}, conn=conn)


def _touch_remote_index(
    user_id: str, source: dict[str, Any], provider: NoteProvider, refs: list[RemoteRef],
) -> None:
    """Upserts every SEEN ref (regardless of whether its content was
    successfully fetched/imported — existence is the signal remote_index
    tracks, not import success). Resets miss_streak on every touch."""
    if not refs:
        return
    now = _now_iso()
    conn = get_connection()
    try:
        for ref in refs:
            key = provider.import_key(source["remoteId"], ref.remote_id)
            conn.execute(
                """
                INSERT INTO j2_note_remote_index
                    (user_id, source_id, remote_id, import_key, remote_updated_at,
                     seen_at, miss_streak)
                VALUES (?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(user_id, source_id, remote_id) DO UPDATE SET
                    import_key = excluded.import_key,
                    remote_updated_at = excluded.remote_updated_at,
                    seen_at = excluded.seen_at,
                    miss_streak = 0
                """,
                (user_id, source["id"], ref.remote_id, key, ref.updated_at, now),
            )
        conn.commit()
    finally:
        conn.close()


# ── Fetch (batched, with per-ref fallback) ───────────────────────────────────

async def _fetch_remote_notes(
    provider: NoteProvider, creds: dict[str, Any], refs: list[RemoteRef],
) -> tuple[list[RemoteNote], list[str]]:
    if not refs:
        return [], []
    notes: list[RemoteNote] = []
    failures: list[str] = []
    for batch in _chunks(refs, _FETCH_BATCH_SIZE):
        try:
            notes.extend(await provider.fetch_many(creds, batch))
        except Exception:  # noqa: BLE001 — ALL-OR-NOTHING batch: fall back to
            # per-ref fetch so ONE bad ref yields ONE named failure, not the
            # whole batch.
            for ref in batch:
                try:
                    notes.append(await provider.fetch(creds, ref))
                except Exception as e2:  # noqa: BLE001
                    failures.append(f"fetch failed for {ref.remote_id!r}: {e2}")
    return notes, failures


# ── Conflict policy + import_confirm + media/rewrite (spec §6, §3) ──────────

def _is_conflict(meta: dict[str, Any]) -> bool:
    updated = _parse_iso(meta.get("updatedAt"))
    imported = _parse_iso(meta.get("importedAt"))
    if updated is None or imported is None:
        return False
    return updated > imported


def _bulk_existing_note_meta(
    conn: sqlite3.Connection, user_id: str, import_keys: list[str],
) -> dict[str, dict[str, Any]]:
    """Raw SQL — `notes_svc._row_to_note` doesn't surface `imported_at`
    (internal import provenance), which the conflict check needs alongside
    `updated_at`/`tags`/`folder_id`."""
    keys = list(dict.fromkeys(k for k in import_keys if k))
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(keys), 500):  # sqlite variable-limit safety
        chunk = keys[i:i + 500]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT id, import_key, updated_at, imported_at, tags, folder_id "
            f"FROM j2_notes WHERE user_id = ? AND import_key IN ({placeholders})",
            (user_id, *chunk),
        ).fetchall()
        for row in rows:
            out[row["import_key"]] = {
                "id": row["id"],
                "updatedAt": row["updated_at"],
                "importedAt": row["imported_at"],
                "tags": json.loads(row["tags"] or "[]"),
                "folderId": row["folder_id"],
            }
    return out


def _apply_resolved_body(
    conn: sqlite3.Connection, user_id: str, note_id: str, body: dict[str, Any],
    *, expected_updated_at: str | None,
) -> bool:
    """Writes the placeholder-resolved body directly, WITHOUT bumping
    `updated_at` (unlike `notes_svc.update_note`). This call is the sync
    engine completing the SAME import operation (import-ref:// -> a real
    URL, import-link:// -> a real note link) that `import_confirm` already
    stamped `updated_at`/`imported_at` for — not a new edit. Routing it
    through `update_note` instead would bump `updated_at` to "now",
    stranding it just after `imported_at` and making `_is_conflict` treat
    EVERY note that ever needed a rewrite pass as locally-edited on its very
    next sync (a false-positive conflict that reproduced on every 2nd sync
    of any note carrying media or a cross-note link).

    Optimistic-locked on `updated_at == expected_updated_at` — the value
    `import_confirm` just stamped for this note, captured by the caller
    immediately after its confirm call. If a user's own edit lands in the
    window between confirm and this write (via `notes_svc.update_note`,
    which always bumps `updated_at`), the guard fails (rowcount 0) and this
    returns False — the caller must NOT overwrite in that case; it re-routes
    the already-resolved content into a conflict sibling instead (spec §6)."""
    body_plain = notes_svc.extract_plain_text(body)
    cur = conn.execute(
        "UPDATE j2_notes SET body_json = ?, body_plain = ? "
        "WHERE id = ? AND user_id = ? AND updated_at = ?",
        (json.dumps(body), body_plain, note_id, user_id, expected_updated_at),
    )
    conn.commit()
    return cur.rowcount > 0


def _find_stranded_placeholder_ids(
    conn: sqlite3.Connection, note_ids: list[str],
) -> set[str]:
    """Targeted SELECT on exactly the given (already-known 'skipped') note
    ids — never a table scan. A hit means a PRIOR sync round's resolve step
    never completed for this note (e.g. it was in a confirm batch whose
    resolve step raised, before Critical 3's per-batch pipeline existed, or
    a process crash mid-resolve) and the literal placeholder is still sitting
    in the stored body. Self-heal (Critical 3b): any hit re-enters Phase 2
    even though its content hash says 'unchanged'."""
    if not note_ids:
        return set()
    out: set[str] = set()
    for i in range(0, len(note_ids), 500):
        chunk = note_ids[i:i + 500]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT id, body_json FROM j2_notes WHERE id IN ({placeholders})", chunk,
        ).fetchall()
        for row in rows:
            body = row["body_json"] or ""
            if "import-ref://" in body or "import-link://" in body:
                out.add(row["id"])
    return out


def _reroute_resolved_body_to_sibling(
    conn: sqlite3.Connection, user_id: str, source: dict[str, Any],
    rn: RemoteNote, key: str, resolved_body: dict[str, Any],
) -> list[str]:
    """Critical 2's race path: `_apply_resolved_body`'s optimistic lock
    failed, meaning a concurrent user edit landed between this note's
    `import_confirm` and this resolve step. The original is left exactly as
    the racing edit + confirm left it (never touched here) — the ALREADY-
    RESOLVED remote content goes to a sibling instead, and both are tagged
    'sync-conflict'. Returns a list of failure strings (empty on success);
    never raises."""
    failures: list[str] = []
    sibling_key = f"{key}#remote"
    row = conn.execute(
        "SELECT id, tags, folder_id FROM j2_notes WHERE user_id = ? AND import_key = ?",
        (user_id, key),
    ).fetchone()
    original_folder_id = row["folder_id"] if row else None
    tags = list(rn.tags or [])
    if "sync-conflict" not in tags:
        tags.append("sync-conflict")
    entry: dict[str, Any] = {
        "importKey": sibling_key,
        "title": f"{rn.title} (synced copy)",
        "bodyJson": resolved_body,  # already resolved — no further rewrite needed
        "tags": tags,
        "folderPath": [],
    }
    if rn.created_at:
        entry["createdAt"] = rn.created_at
    if rn.updated_at:
        entry["updatedAt"] = rn.updated_at
    try:
        notes_svc.import_confirm(
            user_id,
            {"source": source["provider"], "destFolderId": original_folder_id, "notes": [entry]},
            conn=conn,
        )
    except Exception as e:  # noqa: BLE001 — the original is safe either way; a later sync retries
        failures.append(f"conflict sibling for {key!r} failed after a body-write race: {e}")
        return failures
    if row is not None:
        cur_tags = json.loads(row["tags"] or "[]")
        if "sync-conflict" not in cur_tags:
            cur_tags.append("sync-conflict")
            notes_svc.update_note(user_id, row["id"], {"tags": cur_tags}, conn=conn)
    return failures


def _build_confirm_entry(
    rn: RemoteNote, import_key: str, *, sibling: bool = False,
) -> dict[str, Any]:
    tags = list(rn.tags or [])
    if sibling and "sync-conflict" not in tags:
        tags.append("sync-conflict")
    entry: dict[str, Any] = {
        "importKey": import_key,
        "title": f"{rn.title} (synced copy)" if sibling else rn.title,
        # PLACEHOLDER body (import-ref://, import-link://) — media upload +
        # rewrite_body + update_note happen AFTER confirm, never before.
        "bodyJson": rn.doc,
        "tags": tags,
        "folderPath": [] if sibling else list(rn.folder_path or []),
    }
    if rn.created_at:
        entry["createdAt"] = rn.created_at
    if rn.updated_at:
        # The remote's own updated_at IS the change signal — it participates
        # in import_confirm's hash basis.
        entry["updatedAt"] = rn.updated_at
    return entry


def _decode_data_uri(data_uri: str) -> tuple[bytes, str]:
    header, _, b64_payload = data_uri.partition(",")
    if ";base64" not in header:
        raise ValueError(f"unsupported data URI (not base64): {header[:40]!r}")
    content_type = header[len("data:"):].split(";")[0] or "application/octet-stream"
    data = base64.b64decode(b64_payload, validate=True)
    return data, content_type


async def _upload_media_for_note(
    provider: NoteProvider, creds: dict[str, Any], user_id: str, note_id: str,
    media_entries: list[dict[str, Any]],
) -> tuple[dict[str, str], int, list[str]]:
    """Per-item try/except — one bad media ref is a NAMED failure, dropped
    from the note's body by `rewrite_body`, never a crash of the whole note
    (or the whole sync)."""
    media_urls: dict[str, str] = {}
    uploaded = 0
    failures: list[str] = []
    for m in media_entries:
        ref = m.get("ref")
        try:
            data_uri = m.get("data_uri")
            if data_uri:
                data, content_type = _decode_data_uri(data_uri)
            else:
                data, content_type = await provider.fetch_media(creds, ref)
            name = m.get("name") or ref
            if m.get("kind") == "image":
                result = notes_svc.save_note_image_bytes(
                    user_id, note_id, data, name, content_type, kind="inline")
            else:
                result = notes_svc.save_note_attachment_bytes(
                    user_id, note_id, data, name, content_type)
            media_urls[ref] = result["url"]
            uploaded += 1
        except Exception as e:  # noqa: BLE001
            failures.append(f"media {ref!r} on note {note_id}: {e}")
    return media_urls, uploaded, failures


def _bulk_note_updated_at(conn: sqlite3.Connection, note_ids: list[str]) -> dict[str, str | None]:
    """Bulk-reads current `updated_at` for exactly the given ids — used to
    snapshot the optimistic-lock baseline right after confirm (Critical 2),
    before the (potentially slow) media/rewrite work for this batch begins."""
    if not note_ids:
        return {}
    out: dict[str, str | None] = {}
    for i in range(0, len(note_ids), 500):
        chunk = note_ids[i:i + 500]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT id, updated_at FROM j2_notes WHERE id IN ({placeholders})", chunk,
        ).fetchall()
        for row in rows:
            out[row["id"]] = row["updated_at"]
    return out


def _merge_batch_result(totals: dict[str, Any], res: dict[str, Any]) -> None:
    totals["created"] += res["created"]
    totals["updated"] += res["updated"]
    totals["skipped"] += res["skipped"]
    totals["mediaUploaded"] += res["mediaUploaded"]
    totals["conflicts"] += res.get("conflicts", 0)
    totals["failures"].extend(res["failures"])


async def _confirm_and_resolve_batch(
    conn: sqlite3.Connection, user_id: str, source: dict[str, Any],
    provider: NoteProvider, creds: dict[str, Any], dest_folder_id: str | None,
    entries: list[dict[str, Any]], pairs: list[tuple[RemoteNote, str]],
) -> dict[str, Any]:
    """Confirms ONE batch, then immediately resolves (media + links +
    validate + write) every created/updated note in THAT SAME batch, plus
    any 'skipped' note whose stored body still carries a stranded literal
    placeholder (self-heal). Per Critical 3 (PRIMARY): confirm batch N ->
    resolve batch N -> only THEN move to batch N+1, so a later batch's
    failure can never strand an already-resolved earlier batch.

    Never raises — a bad batch's `import_confirm` exception is caught and
    turned into a named failure (SAFETY NET half of Critical 3: one bad
    batch degrades gracefully like a bad ref/bad media item already do,
    instead of aborting the rest of the sync or the notes already resolved
    by prior batches)."""
    result: dict[str, Any] = {
        "created": 0, "updated": 0, "skipped": 0, "mediaUploaded": 0,
        "conflicts": 0, "failures": [],
    }
    try:
        r = notes_svc.import_confirm(
            user_id,
            {"source": source["provider"], "destFolderId": dest_folder_id, "notes": entries},
            conn=conn,
        )
    except Exception as e:  # noqa: BLE001 — one bad batch must not strand others or abort the sync
        result["failures"].append(
            f"confirm failed for a batch of {len(entries)} note(s): {e}"
        )
        return result

    result["created"] = len(r["created"])
    result["updated"] = len(r["updated"])
    result["skipped"] = len(r["skipped"])
    outcome_by_key: dict[str, tuple[str, str]] = {}
    for item in r["created"]:
        outcome_by_key[item["importKey"]] = ("created", item["id"])
    for item in r["updated"]:
        outcome_by_key[item["importKey"]] = ("updated", item["id"])
    for item in r["skipped"]:
        outcome_by_key[item["importKey"]] = ("skipped", item["id"])

    # Self-heal (Critical 3, SAFETY NET): a note marked 'skipped' this round
    # (content hash unchanged) may still carry a stranded import-ref://
    # import-link:// placeholder from a PRIOR round whose resolve step never
    # completed. Targeted SELECT on just this batch's skipped ids.
    skipped_ids = [nid for (status, nid) in outcome_by_key.values() if status == "skipped"]
    stranded = _find_stranded_placeholder_ids(conn, skipped_ids)

    # Critical 2: capture each note's updated_at IMMEDIATELY after confirm —
    # before ANY media download / rewrite work begins for this batch — as
    # the optimistic-lock baseline. The media+rewrite step below is
    # network-bound and can take a while; THAT whole window is what the lock
    # protects. Capturing this right before the write instead would only
    # guard the few-microsecond gap between the SELECT and the UPDATE and
    # miss the real race window entirely.
    ids_needing_baseline = [
        nid for (status, nid) in outcome_by_key.values()
        if status != "skipped" or nid in stranded
    ]
    baseline_updated_at = _bulk_note_updated_at(conn, ids_needing_baseline)

    link_targets = sorted({lk for rn, _k in pairs for lk in (rn.links or [])})
    id_by_key: dict[str, str] = {}
    if link_targets:
        link_check = notes_svc.import_check(user_id, link_targets, conn=conn)
        id_by_key = {k: v["id"] for k, v in link_check["existing"].items()}

    for rn, key in pairs:
        outcome = outcome_by_key.get(key)
        if outcome is None:
            continue  # shouldn't happen, but a lookup miss must never crash the sync
        status, note_id = outcome
        healing = status == "skipped" and note_id in stranded
        if status == "skipped" and not healing:
            continue  # unchanged, no stranded placeholder -> nothing to do
        if not healing and not rn.media and not rn.links:
            continue  # nothing to resolve -> placeholder body IS the final body

        media_urls: dict[str, str] = {}
        if rn.media:
            media_urls, up, med_failures = await _upload_media_for_note(
                provider, creds, user_id, note_id, rn.media)
            result["mediaUploaded"] += up
            result["failures"].extend(med_failures)

        body, _dropped = rewrite_body(rn.doc, media_urls, id_by_key)

        # Important 6: validate the RESOLVED doc (1MB/shape backstop) before
        # the raw write — a malformed/oversized result must never land in
        # the DB. Leave the placeholder body in place; the self-heal branch
        # above retries it on a future sync once the underlying issue clears.
        try:
            notes_svc._validate_body_json(body)
        except notes_svc.NoteValidationError as e:
            result["failures"].append(
                f"resolved body failed validation for note {note_id!r}: {e}"
            )
            continue

        expected = baseline_updated_at.get(note_id)
        applied = _apply_resolved_body(conn, user_id, note_id, body, expected_updated_at=expected)
        if not applied:
            # A concurrent user edit landed in the window between confirm
            # and this write — never clobber it. Reroute the ALREADY-
            # RESOLVED content to a conflict sibling instead (spec §6).
            result["failures"].extend(
                _reroute_resolved_body_to_sibling(conn, user_id, source, rn, key, body)
            )
            result["conflicts"] += 1

    return result


async def _import_remote_notes(
    user_id: str, source: dict[str, Any], provider: NoteProvider, creds: dict[str, Any],
    remote_notes: list[RemoteNote],
) -> dict[str, Any]:
    conn = get_connection()
    try:
        import_keys = [
            provider.import_key(source["remoteId"], rn.remote_id) for rn in remote_notes
        ]
        existing = _bulk_existing_note_meta(conn, user_id, import_keys)

        normal_items: list[tuple[dict[str, Any], RemoteNote, str]] = []
        # (confirm_entry, remote_note, sibling_key, original_folder_id)
        sibling_items: list[tuple[dict[str, Any], RemoteNote, str, str | None]] = []
        conflict_tag_updates: dict[str, list[str]] = {}  # original note id -> new tags
        pre_confirm_conflicts = 0

        for rn, key in zip(remote_notes, import_keys):
            meta = existing.get(key)
            if meta and _is_conflict(meta):
                # Local edit since the last sync -> NEVER overwrite the
                # original. Route the fresh remote content to a sibling note
                # instead; both versions survive.
                pre_confirm_conflicts += 1
                sibling_key = f"{key}#remote"
                entry = _build_confirm_entry(rn, sibling_key, sibling=True)
                sibling_items.append((entry, rn, sibling_key, meta["folderId"]))
                if "sync-conflict" not in (meta["tags"] or []):
                    conflict_tag_updates[meta["id"]] = list(meta["tags"] or []) + ["sync-conflict"]
            else:
                entry = _build_confirm_entry(rn, key)
                normal_items.append((entry, rn, key))

        totals: dict[str, Any] = {
            "created": 0, "updated": 0, "skipped": 0, "mediaUploaded": 0,
            "conflicts": pre_confirm_conflicts, "failures": [],
        }

        # Per-batch pipeline (Critical 3, PRIMARY): confirm batch N, resolve
        # batch N immediately, THEN move to batch N+1. Known, deliberate
        # tradeoff: an import-link:// from a note in batch N to a note that
        # only lands in a LATER batch N+k resolves as unresolved this round
        # (mark dropped, text kept) rather than waiting for the whole round —
        # narrower than the stranding bug this fixes, and only reachable
        # when a single sync round changes > _CONFIRM_BATCH_SIZE notes.
        for batch in _chunks(normal_items, _CONFIRM_BATCH_SIZE):
            entries = [e for e, _rn, _k in batch]
            pairs = [(rn, k) for _e, rn, k in batch]
            res = await _confirm_and_resolve_batch(
                conn, user_id, source, provider, creds,
                source.get("destFolderId"), entries, pairs,
            )
            _merge_batch_result(totals, res)

        # Siblings land under the ORIGINAL note's CURRENT folder (its own
        # folderPath is [] so it resolves straight to destFolderId) — that
        # can differ per conflicting note, so each gets its own confirm+
        # resolve pass rather than sharing the batch-wide destFolderId
        # above. Conflicts are rare; correctness beats micro-batching here.
        for entry, rn, sibling_key, original_folder_id in sibling_items:
            res = await _confirm_and_resolve_batch(
                conn, user_id, source, provider, creds,
                original_folder_id, [entry], [(rn, sibling_key)],
            )
            _merge_batch_result(totals, res)

        # Tag the ORIGINAL note in a pre-confirm conflict — add-tag only,
        # body/title untouched. Both the original and its sibling now carry
        # 'sync-conflict'; neither version was lost.
        for note_id, tags in conflict_tag_updates.items():
            notes_svc.update_note(user_id, note_id, {"tags": tags}, conn=conn)

        return totals
    finally:
        conn.close()
