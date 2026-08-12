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
     (it IS the change signal). Resolution happens in TWO passes, deliberately
     split (round-2 review fix, 2026-08-12):
       a. Per-batch, immediately after that batch's confirm:
          `_confirm_and_resolve_batch` downloads media (`provider.fetch_media`
          or a `data_uri` entry decoded directly) and resolves ONLY
          `import-ref://` media placeholders — `import-link://` marks pass
          through completely untouched (`strip_unresolved_links=False`),
          because a link's target may not be confirmed yet (a later batch).
       b. Once every batch (+ conflict siblings) has confirmed, ONE final
          sweep (`_resolve_links_final_pass`) resolves every `import-link://`
          mark across the whole round via a single `import_check` — this
          naturally covers a same-round forward reference into a later batch.
     Every write in both passes goes through `_apply_resolved_body` (NOT
     `notes_svc.update_note`) — that raw write deliberately skips bumping
     `updated_at`, since this step is completing the SAME import episode
     `import_confirm` just stamped, not a new edit (see
     `_apply_resolved_body`'s docstring for the false-conflict bug this
     avoids), and is optimistic-locked so a concurrent user edit can never be
     clobbered (reroutes to a conflict sibling instead — spec §6). A mark
     that's still unresolved after BOTH passes (target genuinely absent from
     this round) stays as an inert intact placeholder rather than being
     silently stripped, so self-heal's substring check keeps a real signal
     to retry against on a future sync.
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
import threading
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

# Per-source mutual exclusion (process-local) — prevents scheduler + manual
# "Sync now" + webhook-triggered calls from double-processing one source.
#
# Fix-round-1 Important #4: this was an `asyncio.Lock` dict until the
# reviewer's probe found it crashes across event loops. An `asyncio.Lock`
# binds to whichever loop FIRST contends on it; this engine is invoked from
# TWO genuinely different loops in production — the long-lived uvicorn loop
# (the router's manual "Sync now" / background sync) and a FRESH loop per
# `asyncio.run(...)` call from `note_connectors/scheduler.py`'s
# BackgroundScheduler jobs (the due-tick and the nightly full pass are two
# SEPARATE job ids, `max_instances=1` is per-job, so they can genuinely
# overlap on the SAME source). A second contended acquire from a different
# loop raised `RuntimeError: <Lock> is bound to a different event loop` —
# a 500 to a member clicking "Sync now" during the 01:47 nightly pass, not
# a graceful "busy".
#
# A plain `threading.Lock`-guarded set has NO loop affinity at all (it is
# not an asyncio primitive), so it holds correctly regardless of which
# event loop — or which OS thread — calls in. The critical sections below
# are a single dict/set mutation each (no I/O, no `await`), so guarding
# them with a synchronous lock never blocks an event loop for a
# meaningful duration.
_inflight_lock = threading.Lock()
_inflight_sources: set[str] = set()


def _try_acquire_source(source_id: str) -> bool:
    with _inflight_lock:
        if source_id in _inflight_sources:
            return False
        _inflight_sources.add(source_id)
        return True


def _release_source(source_id: str) -> None:
    with _inflight_lock:
        _inflight_sources.discard(source_id)

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


# ── Provider resolution (Task 11: delegates to the registry) ────────────────

def _default_provider_factory(
    provider_name: str, source: dict[str, Any] | None = None,
) -> NoteProvider:
    """Builds a FRESH provider instance per sync call — providers may keep
    per-sync instance state (Roam's title->uid link map), so a shared/cached
    instance across sources or across calls would be wrong.

    `source` (Task 11 MUST-RESOLVE #3) is the full `j2_note_sources` row
    being synced — threaded through so a provider that needs SOURCE-level
    info beyond just the connector's credentials (Dropbox: which folder —
    stored on `source["remoteId"]` per spec §5's `remote_id` column comment,
    "folder id" for Dropbox) can be constructed correctly. Roam/Craft/Notion
    ignore it entirely (their credentials dict alone already identifies the
    one graph/space/workspace they sync).

    Delegates to `registry.py` — mirrors `providers/base.py`'s own
    documented contract ("the engine ... never imports a concrete provider
    module directly except through the registry (Task 11)"); this function
    itself does no provider imports anymore, real or lazy."""
    from . import registry
    return registry.build_provider(provider_name, source)


# Module-level so tests can `monkeypatch.setattr(engine, "_provider_factory", ...)`
# to inject a fake provider without touching real provider modules. The call
# site (`_do_sync` below) now always passes BOTH positional args
# (`provider_name, source`) — Task 11 widened the signature for MUST-RESOLVE
# #3 (Dropbox folder-path threading), so a test fake must accept a second
# param too (`lambda name, source: p`, or `lambda name, source=None: p` if it
# doesn't care about `source`).
_provider_factory = _default_provider_factory


# ── Cooldown ─────────────────────────────────────────────────────────────────

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
    """Sync one source. Serialized per source via a loop-agnostic in-flight
    guard (Fix-round-1 #4 — see `_try_acquire_source`'s module-level
    docstring for why this is NOT an `asyncio.Lock`). A source synced within
    the cooldown window is skipped unless `manual=True`.

    Reuses the SAME retry ladder (`_LOCKED_RETRY_DELAYS`) for two distinct
    reasons a single attempt can fail to make progress: the source is
    already being synced elsewhere ("busy" — checked BEFORE each attempt),
    or a transient sqlite "database is locked" mid-sync (checked in the
    `except`). Only after every attempt is still busy does this return a
    `"busy"` status rather than raising — a caller in a race with the
    nightly full pass or another "Sync now" click gets a clean, actionable
    answer, never a crash."""
    source = connections.get_source_by_id(source_id)
    if source is None:
        raise ValueError(f"unknown note-connector source {source_id!r}")

    if not manual and _within_cooldown(source):
        return {"status": "cooldown", "lastSyncAt": source.get("lastSyncAt")}

    attempts = 1 + len(_LOCKED_RETRY_DELAYS)
    for attempt in range(attempts):
        if not _try_acquire_source(source_id):
            if attempt == attempts - 1:
                return {"status": "busy", "sourceId": source_id}
            await asyncio.sleep(_LOCKED_RETRY_DELAYS[attempt] * random.uniform(0.5, 1.5))
            continue
        try:
            return await _do_sync(source["userId"], source_id, full=full)
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower() or attempt == attempts - 1:
                raise
            await asyncio.sleep(_LOCKED_RETRY_DELAYS[attempt] * random.uniform(0.5, 1.5))
        finally:
            _release_source(source_id)
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


async def sync_all_active_sources_full() -> None:
    """Scheduler entry for the nightly FULL-listing pass (Task 11
    MUST-RESOLVE #2) — every sync-enabled, active source across ALL users,
    regardless of `last_sync_at`/cooldown (`full=True, manual=True`).

    Delete detection (`_run_delete_detection`'s 2-strike miss_streak, plus
    Task 11's `list_deleted` wiring) ONLY runs when `full=True` — which
    `sync_due_sources` above NEVER passes (it always calls the 1-arg
    `sync_source(id)`, i.e. incremental/cursor mode). Without this job,
    delete detection is built, tested, and green, but UNREACHABLE in
    production — the exact defect class this repo's `lesson_built_tested_
    green_and_unreachable` names. Serial + exception-walled per source,
    mirroring `sync_due_sources`."""
    sources = connections.list_all_sources()
    for source in sources:
        try:
            await sync_source(source["id"], full=True, manual=True)
        except Exception:  # noqa: BLE001 — isolate per-source failures
            log.exception("note-connector FULL sync failed for source %s", source["id"])


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
        provider = _provider_factory(source["provider"], source)
        creds = connections.get_token(user_id, source["provider"])
        if creds is None:
            raise errors.NoteConnNotConfigured(
                f"no connected credentials for provider {source['provider']!r}"
            )

        # Raw cursor, unadjusted — providers own their own overlap window.
        cursor = None if full else source.get("cursor")
        refs = await provider.list_changed(creds, cursor=cursor)

        if full:
            # Task 11 MUST-RESOLVE #4: when the provider exposes a
            # provider-precise trash sweep (Notion's `list_deleted`, NOT
            # part of the abstract `NoteProvider` contract — checked via
            # `getattr`), call it and feed the result into delete detection
            # as a CERTAIN signal, bypassing the generic 2-strike
            # miss-streak wait for exactly those items. A failing sweep
            # (rate limit, transient, provider without one) never aborts
            # the sync — the generic detector remains the fallback/only
            # signal, unchanged from before this wiring existed.
            deleted_refs: list[RemoteRef] = []
            list_deleted_fn = getattr(provider, "list_deleted", None)
            if list_deleted_fn is not None:
                try:
                    deleted_refs = await list_deleted_fn(creds)
                except Exception as e:  # noqa: BLE001
                    item_failures.append(
                        f"list_deleted sweep failed (falling back to miss-streak "
                        f"delete detection): {e}"
                    )
            dd = _run_delete_detection(user_id, source, refs, deleted_refs=deleted_refs)
            # `deleted` is meaningful even alongside a warning now (Fix-round-1
            # #1a): the explicit-sever cap can refuse the LIST_DELETED signal
            # for a subset of rows in the same pass unrelated 2-strike misses
            # still legitimately sever — unlike the <50% guard, which always
            # returns deleted=0 because it refuses the WHOLE pass before any
            # row is touched. Reading `dd["deleted"]` unconditionally is a
            # strict superset of the old "else" branch's behavior.
            deleted_count = dd["deleted"]
            if dd["status"] == "warning":
                delete_guard_warning = dd["reason"]

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

        # Task 11 MUST-RESOLVE #1: an opaque cursor the provider published
        # on ITSELF (Dropbox — see base.py's `opaque_cursor` docstring)
        # takes precedence, stored VERBATIM, and unconditionally (even with
        # `refs == []` — an empty incremental delta still needs its
        # continuation cursor persisted so the NEXT call keeps continuing
        # from here rather than falling back to a full re-list). Timestamp
        # mode (Roam/Craft/Notion — `opaque_cursor` stays the class default
        # `None`) is completely unchanged: only advances on a non-empty
        # `refs`, derived as `max(updated_at)`.
        opaque_cursor = getattr(provider, "opaque_cursor", None)
        if opaque_cursor is not None:
            connections.update_cursor(user_id, source_id, opaque_cursor)
        elif refs:
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
    *, deleted_refs: list[RemoteRef] | None = None,
) -> dict[str, Any]:
    """Runs BEFORE `_touch_remote_index` so `prev_count` reflects the index
    as of before this sync touched anything — touching first would inflate
    the denominator with brand-new rows and mask a genuine bad-enumeration
    refuse case. Refs seen this round and refs not seen are disjoint sets, so
    running the two passes in either order never double-touches a row; only
    the refuse-guard's denominator cares about ordering.

    `deleted_refs` (Task 11 MUST-RESOLVE #4) is an OPTIONAL, provider-precise
    CERTAIN-deletion signal (Notion's trash sweep via `list_deleted`) — a
    remote_id in this set skips straight to being tagged+severed, bypassing
    the generic 2-strike miss-streak wait, but ONLY for rows already tracked
    in `j2_note_remote_index` (this function only ever iterates
    `existing_rows`, never `deleted_refs` directly). That is what makes the
    Notion >50-row database-overflow exemption (MUST-RESOLVE #5) hold
    automatically, with no special-case code: overflow row-pages are
    resolved as EXTRA `RemoteNote`s during `fetch_many` (engine.py's
    `_fetch_remote_notes`/`_import_remote_notes`), which runs AFTER this
    function and `_touch_remote_index` — their remote_ids never enter
    `j2_note_remote_index` in the first place, so even if `list_deleted()`'s
    own search happened to also surface one of their ids, there is no
    `existing_rows` entry for it here to act on. Still subject to the SAME
    refuse-guard as the generic path below — an untrustworthy round (< 50%
    enumeration) leaves the index untouched for explicit deletions too, not
    just miss-streak ones.

    Fix-round-1 Important #1a — EXPLICIT-SEVER BOUND: the 2-strike
    miss-streak path bounds a bad ENUMERATION (the <50% guard above); until
    this fix, nothing bounded a bad `deleted_refs` SIGNAL — a buggy/
    compromised `list_deleted` naming 40 of a source's 100 tracked items as
    "deleted" would sever all 40 in ONE pass, and `_tag_note_source_deleted`
    only ever APPENDS its tag, so that damage was PERMANENT until Fix-round-1
    #1b's un-tag heal landed. Mirrors the <50% guard's ALL-OR-NOTHING shape:
    when the explicit-delete candidates exceed 20% of the previously-tracked
    count in one pass, NONE of them sever this round — every one of those
    rows instead falls through to the ordinary miss-streak counter below
    (a genuine mass-deletion still gets caught, just via the same bounded,
    2-strike path everything else uses, never in a single certain-but-wrong
    pass)."""
    source_id = source["id"]
    seen_ids = {r.remote_id for r in refs}
    explicit_deleted_ids = {r.remote_id for r in (deleted_refs or [])}
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

        missing_rows = [row for row in existing_rows if row["remote_id"] not in seen_ids]
        explicit_candidates = [row for row in missing_rows if row["remote_id"] in explicit_deleted_ids]

        explicit_refused = False
        explicit_refuse_reason: str | None = None
        if explicit_candidates:
            explicit_cap = max(1, int(prev_count * 0.2)) if prev_count > 0 else 0
            if len(explicit_candidates) > explicit_cap:
                explicit_refused = True
                explicit_refuse_reason = (
                    f"explicit-delete signal refused for source {source_id}: "
                    f"list_deleted named {len(explicit_candidates)} of {prev_count} "
                    f"previously-known items as deleted in one pass "
                    f"(> {explicit_cap}, the 20% cap) — falling back to "
                    f"miss-streak detection for them"
                )

        deleted = 0
        for row in missing_rows:
            if not explicit_refused and row["remote_id"] in explicit_deleted_ids:
                # A CERTAIN signal from the provider's own trash sweep,
                # within the blast-radius cap — sever immediately, no need
                # to wait for a second miss.
                _tag_note_source_deleted(conn, user_id, row["import_key"])
                conn.execute(
                    "DELETE FROM j2_note_remote_index "
                    "WHERE user_id = ? AND source_id = ? AND remote_id = ?",
                    (user_id, source_id, row["remote_id"]),
                )
                deleted += 1
                continue
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
        if explicit_refused:
            return {"status": "warning", "deleted": deleted, "reason": explicit_refuse_reason}
        return {"status": "ok", "deleted": deleted, "reason": None}
    finally:
        conn.close()


def _write_tags_preserving_updated_at(
    conn: sqlite3.Connection, user_id: str, note_id: str, tags: list[str],
) -> None:
    """Writes ONLY the `tags` column, deliberately WITHOUT bumping
    `updated_at` — used EXCLUSIVELY by the engine's own sever/un-sever tag
    writes (`_tag_note_source_deleted`, `_untag_note_source_reappeared`),
    never by a real user edit (Fix-round-2 Important, carried from Task 8:
    made user-visible by round-1's heal path, not introduced by it).

    Root cause: `notes_svc.update_note` (notes.py) unconditionally bumps
    `updated_at` to now on ANY patch, including a tags-only one. `_is_conflict`
    (`updated_at > imported_at`) has no way to tell "the user edited this"
    apart from "the engine's OWN bookkeeping wrote to this row" — so the
    sever-tag write alone made `updated_at > imported_at` PERMANENTLY true,
    and the next time that remote_id reappeared, `_import_remote_notes`
    treated it as a local edit and duplicated it into a "(synced copy)"
    conflict sibling (tagging BOTH `sync-conflict`) — every single time,
    forever, even for content that never actually changed. The round-1
    un-tag heal's own `update_note` call made this WORSE (re-bumped on
    every heal), not better.

    Mirrors `_apply_resolved_body`'s established "raw write, skip
    updated_at" idiom for the identical reason. Deliberately does NOT touch
    `notes_svc.update_note` itself or any other caller of it — a genuine
    user tag edit (via the notes UI) must keep bumping `updated_at`
    normally, or the conflict machinery would go blind to real edits too."""
    conn.execute(
        "UPDATE j2_notes SET tags = ? WHERE id = ? AND user_id = ?",
        (json.dumps(tags), note_id, user_id),
    )


def _write_import_hash_preserving_updated_at(
    conn: sqlite3.Connection, user_id: str, note_id: str, import_hash: str,
) -> None:
    """Writes ONLY the `import_hash` column, WITHOUT touching `updated_at`/
    `imported_at`/content (Fix-round-3 Important; same "raw write, skip
    updated_at" idiom as `_write_tags_preserving_updated_at` right above).

    Used EXCLUSIVELY by `_import_remote_notes`'s pre-confirm conflict check,
    on the ORIGINAL note's row, the moment a GENUINE conflict is detected
    (remote content changed while the user had it locally edited). Once a
    note is conflicted, `import_confirm` is never called again for its
    ORIGINAL import_key (only the `{key}#remote` sibling gets confirmed) —
    so without this write, the original's `import_hash` stays frozen at
    whatever it was BEFORE the very first conflict, forever. The next
    pass's "did remote content change SINCE LAST TIME" comparison would then
    always answer "yes" (comparing against a hash from a version further and
    further in the past), even when the remote genuinely stopped moving
    right after the first conflict — permanently re-tallying `conflicts`,
    re-confirming a sibling that's usually a no-op skip, and, if the user
    ever deleted that sibling, silently resurrecting it on every subsequent
    sync. This write makes the original's `import_hash` track "the last
    remote content this sync actually saw" independent of what's displayed
    (which stays exactly as the user left it) — the correct baseline for
    "changed since last pass," not "changed since the user's edit was first
    detected"."""
    conn.execute(
        "UPDATE j2_notes SET import_hash = ? WHERE id = ? AND user_id = ?",
        (import_hash, note_id, user_id),
    )


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
    _write_tags_preserving_updated_at(conn, user_id, row["id"], tags)


def _untag_note_source_reappeared(conn: sqlite3.Connection, user_id: str, import_key: str) -> None:
    """Un-tag heal (Fix-round-1 Important #1b). `_tag_note_source_deleted`
    only ever APPENDS `source-deleted` — without this, a false-positive
    sever (a transient enumeration gap that happened to land two full syncs
    in a row, or a bad `list_deleted` signal that slipped under the #1a
    cap) is PERMANENT: the note stays flagged forever even once the source
    is tracking the item again. Mirrors `_tag_note_source_deleted`'s shape
    exactly, in reverse. A no-op (not an error) when the note was never
    tagged, or was never successfully imported in the first place."""
    row = conn.execute(
        "SELECT id, tags FROM j2_notes WHERE user_id = ? AND import_key = ?",
        (user_id, import_key),
    ).fetchone()
    if row is None:
        return
    tags = json.loads(row["tags"] or "[]")
    if "source-deleted" not in tags:
        return
    tags = [t for t in tags if t != "source-deleted"]
    _write_tags_preserving_updated_at(conn, user_id, row["id"], tags)


def _touch_remote_index(
    user_id: str, source: dict[str, Any], provider: NoteProvider, refs: list[RemoteRef],
) -> None:
    """Upserts every SEEN ref (regardless of whether its content was
    successfully fetched/imported — existence is the signal remote_index
    tracks, not import success). Resets miss_streak on every touch.

    Also runs the Fix-round-1 #1b un-tag heal for any ref NOT already in
    the index — i.e. genuinely new OR reappearing after a prior sever. ONE
    bulk existence-check query up front narrows the candidate set (an
    already-continuously-tracked ref can never carry the tag, since its
    index row would still exist and `_run_delete_detection` would never
    have severed it) — but each ref in that narrowed "new to the index"
    subset still runs its own `_untag_note_source_reappeared` lookup
    (one SELECT per ref, not batched). Accurate claim: bounded to 1 bulk
    query + at most len(refs) per-ref lookups, never a query per ALREADY-
    tracked ref — not "never N+1" outright. Fine at today's per-sync ref
    counts; batch `_untag_note_source_reappeared` into one bulk read if a
    source's per-sync ref count ever grows enough to matter."""
    if not refs:
        return
    now = _now_iso()
    conn = get_connection()
    try:
        existing_ids = {
            row["remote_id"] for row in conn.execute(
                "SELECT remote_id FROM j2_note_remote_index WHERE user_id = ? AND source_id = ?",
                (user_id, source["id"]),
            ).fetchall()
        }
        for ref in refs:
            key = provider.import_key(source["remoteId"], ref.remote_id)
            if ref.remote_id not in existing_ids:
                _untag_note_source_reappeared(conn, user_id, key)
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
    (internal import provenance) or `import_hash`, which the conflict check
    needs alongside `updated_at`/`tags`/`folder_id`.

    `import_hash` (Fix-round-3 Important) is what lets the pre-confirm
    conflict check distinguish "the user edited this AND the remote actually
    changed" from "the user edited this once, and every subsequent sync of
    UNCHANGED remote content re-tallies the same non-conflict as a conflict
    forever" — see `_import_remote_notes`."""
    keys = list(dict.fromkeys(k for k in import_keys if k))
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(keys), 500):  # sqlite variable-limit safety
        chunk = keys[i:i + 500]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT id, import_key, updated_at, imported_at, tags, folder_id, import_hash "
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
                "importHash": row["import_hash"],
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
) -> tuple[str | None, list[str]]:
    """Critical 2's race path: `_apply_resolved_body`'s optimistic lock
    failed, meaning a concurrent user edit landed between this note's
    `import_confirm` and this resolve step. The original is left exactly as
    the racing edit + confirm left it (never touched here) — the ALREADY-
    RESOLVED remote content goes to a sibling instead, and both are tagged
    'sync-conflict'. Returns `(sibling_note_id_or_None, failures)`; never
    raises. Called from two stages with different `resolved_body` states —
    the per-batch media pass (media resolved, links still intact
    placeholders) and the final link pass (links now also resolved) — the
    per-batch caller must still add the sibling to "touched" for the link
    pass; the final-pass caller needs no further action (its own output IS
    the fully-resolved content)."""
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
        "bodyJson": resolved_body,  # media already resolved — links resolve in the final pass
        "tags": tags,
        "folderPath": [],
    }
    if rn.created_at:
        entry["createdAt"] = rn.created_at
    if rn.updated_at:
        entry["updatedAt"] = rn.updated_at
    try:
        sib_result = notes_svc.import_confirm(
            user_id,
            {"source": source["provider"], "destFolderId": original_folder_id, "notes": [entry]},
            conn=conn,
        )
    except Exception as e:  # noqa: BLE001 — the original is safe either way; a later sync retries
        failures.append(f"conflict sibling for {key!r} failed after a body-write race: {e}")
        return None, failures
    sibling_id = next(
        (item["id"] for group in ("created", "updated", "skipped") for item in sib_result[group]),
        None,
    )
    if row is not None:
        cur_tags = json.loads(row["tags"] or "[]")
        if "sync-conflict" not in cur_tags:
            cur_tags.append("sync-conflict")
            notes_svc.update_note(user_id, row["id"], {"tags": cur_tags}, conn=conn)
    return sibling_id, failures


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


def _bulk_note_body_json(conn: sqlite3.Connection, note_ids: list[str]) -> dict[str, str | None]:
    """Bulk-reads the raw (still-JSON-encoded) `body_json` TEXT for exactly
    the given ids — used by the final link-resolution pass to read each
    note's CURRENT stored body (whatever the per-batch media pass left it
    at) without re-fetching one row at a time."""
    if not note_ids:
        return {}
    out: dict[str, str | None] = {}
    for i in range(0, len(note_ids), 500):
        chunk = note_ids[i:i + 500]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"SELECT id, body_json FROM j2_notes WHERE id IN ({placeholders})", chunk,
        ).fetchall()
        for row in rows:
            out[row["id"]] = row["body_json"]
    return out


def _merge_batch_result(
    totals: dict[str, Any], res: dict[str, Any], all_touched: list[tuple[RemoteNote, str, str]],
) -> None:
    totals["created"] += res["created"]
    totals["updated"] += res["updated"]
    totals["skipped"] += res["skipped"]
    totals["mediaUploaded"] += res["mediaUploaded"]
    totals["conflicts"] += res.get("conflicts", 0)
    totals["failures"].extend(res["failures"])
    all_touched.extend(res.get("touched", []))


async def _resolve_links_final_pass(
    conn: sqlite3.Connection, user_id: str, source: dict[str, Any],
    touched: list[tuple[RemoteNote, str, str]],
) -> dict[str, Any]:
    """Runs AFTER every batch (normal + sibling) has confirmed+resolved its
    media (Critical 3's stranding fix stays intact for media; this is the
    round-2 review fix for links). Accumulates `id_by_key` across the WHOLE
    round via ONE `import_check` covering every link target any touched note
    references — this naturally includes a note confirmed in a LATER batch,
    since by now every batch has already confirmed, closing the cross-batch
    hole the per-batch design had. Cheap: no network calls, just DB reads +
    pure `rewrite_body` + guarded writes.

    Never strips an unresolved mark (`strip_unresolved_links=False`) — a
    target genuinely absent from this round (deleted, never synced, wrong
    provider) stays as an inert intact placeholder rather than being
    silently erased, so self-heal keeps a real, greppable signal to retry
    against on a future sync."""
    result: dict[str, Any] = {"conflicts": 0, "failures": []}
    candidates = [(rn, key, note_id) for rn, key, note_id in touched if rn.links]
    if not candidates:
        return result

    link_targets = sorted({lk for rn, _k, _n in candidates for lk in rn.links})
    link_check = notes_svc.import_check(user_id, link_targets, conn=conn)
    id_by_key = {k: v["id"] for k, v in link_check["existing"].items()}
    if not id_by_key:
        return result  # nothing resolvable yet -> leave every mark intact; self-heal retries later

    note_ids = [note_id for _rn, _k, note_id in candidates]
    baseline_updated_at = _bulk_note_updated_at(conn, note_ids)
    current_bodies = _bulk_note_body_json(conn, note_ids)

    for rn, key, note_id in candidates:
        raw_body = current_bodies.get(note_id)
        if raw_body is None or "import-link://" not in raw_body:
            continue  # note vanished, or nothing left to resolve
        try:
            doc = json.loads(raw_body)
        except (TypeError, ValueError) as e:
            result["failures"].append(f"link pass: unreadable stored body for note {note_id!r}: {e}")
            continue

        body, _dropped = rewrite_body(doc, {}, id_by_key, strip_unresolved_links=False)

        try:
            notes_svc._validate_body_json(body)
        except notes_svc.NoteValidationError as e:
            result["failures"].append(
                f"link pass: resolved body failed validation for note {note_id!r}: {e}"
            )
            continue

        expected = baseline_updated_at.get(note_id)
        applied = _apply_resolved_body(conn, user_id, note_id, body, expected_updated_at=expected)
        if not applied:
            sibling_id, reroute_failures = _reroute_resolved_body_to_sibling(
                conn, user_id, source, rn, key, body)
            result["failures"].extend(reroute_failures)
            result["conflicts"] += 1
            # Not recursed further: the sibling's link mark is now resolved
            # (it was built from `body`, this pass's OWN resolved output),
            # so it needs no second visit.

    return result


async def _confirm_and_resolve_batch(
    conn: sqlite3.Connection, user_id: str, source: dict[str, Any],
    provider: NoteProvider, creds: dict[str, Any], dest_folder_id: str | None,
    entries: list[dict[str, Any]], pairs: list[tuple[RemoteNote, str]],
) -> dict[str, Any]:
    """Confirms ONE batch, then immediately resolves MEDIA (upload +
    validate + guarded write) for every created/updated note in THAT SAME
    batch, plus any 'skipped' note whose stored body still carries a
    stranded literal placeholder (self-heal). Per Critical 3 (PRIMARY):
    confirm batch N -> resolve batch N's media -> only THEN move to batch
    N+1, so a later batch's failure can never strand an already-resolved
    earlier batch's media.

    LINK resolution is deliberately NOT done here (round-2 review fix,
    2026-08-12): a link target that lands in a LATER batch doesn't exist yet
    at this point in the pipeline, and the original per-batch design
    resolved links with whatever `id_by_key` it had *right then* — which,
    with `strip_unresolved_links` defaulting True, silently and permanently
    ERASED any forward reference to a not-yet-confirmed note (the mark was
    dropped, and since the erased body then hashed as "no placeholder left",
    self-heal's substring check could never find it again either). Every
    note this pass touches that has `rn.links` is returned in `"touched"`
    for `_resolve_links_final_pass` to handle in ONE sweep after every batch
    (normal + sibling) has confirmed — see `_import_remote_notes`.

    Never raises — a bad batch's `import_confirm` exception is caught and
    turned into a named failure (SAFETY NET half of Critical 3: one bad
    batch degrades gracefully like a bad ref/bad media item already do,
    instead of aborting the rest of the sync or the notes already resolved
    by prior batches)."""
    result: dict[str, Any] = {
        "created": 0, "updated": 0, "skipped": 0, "mediaUploaded": 0,
        "conflicts": 0, "failures": [], "touched": [],
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

    for rn, key in pairs:
        outcome = outcome_by_key.get(key)
        if outcome is None:
            continue  # shouldn't happen, but a lookup miss must never crash the sync
        status, note_id = outcome
        healing = status == "skipped" and note_id in stranded
        if status == "skipped" and not healing:
            continue  # unchanged, no stranded placeholder -> nothing to do

        if not healing and not rn.media:
            # No media to resolve in THIS pass. If it has links, the final
            # link pass reads the confirm-written body directly — nothing
            # else has touched it since, so no write happens here at all.
            if rn.links:
                result["touched"].append((rn, key, note_id))
            continue

        media_urls: dict[str, str] = {}
        if rn.media:
            media_urls, up, med_failures = await _upload_media_for_note(
                provider, creds, user_id, note_id, rn.media)
            result["mediaUploaded"] += up
            result["failures"].extend(med_failures)

        # MEDIA ONLY in this pass: id_by_key={} + strip_unresolved_links=False
        # means every import-link:// mark passes through completely
        # untouched (not stripped, not resolved) for the final pass to see.
        body, _dropped = rewrite_body(rn.doc, media_urls, {}, strip_unresolved_links=False)

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
            if rn.links:
                result["touched"].append((rn, key, note_id))  # placeholder still intact
            continue

        expected = baseline_updated_at.get(note_id)
        applied = _apply_resolved_body(conn, user_id, note_id, body, expected_updated_at=expected)
        if applied:
            if rn.links:
                result["touched"].append((rn, key, note_id))
        else:
            # A concurrent user edit landed in the window between confirm
            # and this write — never clobber it. Reroute the ALREADY-
            # (media-)RESOLVED content to a conflict sibling instead (spec
            # §6); the original is never added to "touched" (it must not be
            # written to again), the sibling is (it still needs its links
            # resolved in the final pass).
            sibling_id, reroute_failures = _reroute_resolved_body_to_sibling(
                conn, user_id, source, rn, key, body)
            result["failures"].extend(reroute_failures)
            result["conflicts"] += 1
            if sibling_id and rn.links:
                result["touched"].append((rn, f"{key}#remote", sibling_id))

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
            # `entry` is what WOULD be written under the ORIGINAL import_key —
            # built unconditionally (not just in the else-branch) because
            # Fix-round-3 needs its hash regardless of which path is taken.
            entry = _build_confirm_entry(rn, key)
            # Fix-round-3 Important (live-gate 23rd check): a conflict is only
            # a conflict when the REMOTE side actually changed. `_is_conflict`
            # alone (`updated_at > imported_at`) is permanently true for any
            # note the user ever legitimately edited — without the hash gate,
            # EVERY subsequent full sync of UNCHANGED remote content re-tallied
            # a phantom conflict: `counts.conflicts` never cleared on the trust
            # strip, the `{key}#remote` sibling was re-confirmed every pass
            # (harmless only because import_confirm's OWN hash check no-ops an
            # unchanged sibling that still exists), and — the sharp edge — if
            # the user deleted that "(synced copy)" sibling, the next sync's
            # `import_confirm` found no row for `{key}#remote` and silently
            # RECREATED it, forever, as long as the original stayed
            # user-edited. Comparing `entry`'s hash (the SAME
            # `notes_svc._import_payload_hash` basis `import_confirm` itself
            # uses, over the SAME placeholder-body shape `_build_confirm_entry`
            # produces — never re-derived here) against the original's stored
            # `import_hash` answers "did the remote content change since the
            # last time we looked," independent of the user's own edit.
            is_genuine_conflict = (
                meta is not None and _is_conflict(meta)
                and notes_svc._import_payload_hash(entry) != (meta.get("importHash") or "")
            )
            if is_genuine_conflict:
                # Local edit since the last sync AND the remote genuinely
                # changed -> NEVER overwrite the original. Route the fresh
                # remote content to a sibling note instead; both versions
                # survive.
                pre_confirm_conflicts += 1
                sibling_key = f"{key}#remote"
                sibling_entry = _build_confirm_entry(rn, sibling_key, sibling=True)
                sibling_items.append((sibling_entry, rn, sibling_key, meta["folderId"]))
                if "sync-conflict" not in (meta["tags"] or []):
                    conflict_tag_updates[meta["id"]] = list(meta["tags"] or []) + ["sync-conflict"]
                # Record what we just saw as the new "last seen remote hash"
                # baseline on the ORIGINAL row (never touching its content or
                # updated_at/imported_at) — see
                # `_write_import_hash_preserving_updated_at`'s docstring for
                # why skipping this freezes the comparison at the FIRST
                # conflict forever instead of tracking pass-to-pass change.
                _write_import_hash_preserving_updated_at(
                    conn, user_id, meta["id"], notes_svc._import_payload_hash(entry))
            else:
                # Either no genuine conflict, or a conflict whose remote side
                # is UNCHANGED -> plain pass-through. `import_confirm`'s own
                # hash check on `entry` no-ops it (skipped) when nothing
                # changed -- no tally, no sibling confirm, no resurrection of
                # a sibling the user deleted.
                normal_items.append((entry, rn, key))

        totals: dict[str, Any] = {
            "created": 0, "updated": 0, "skipped": 0, "mediaUploaded": 0,
            "conflicts": pre_confirm_conflicts, "failures": [],
        }
        all_touched: list[tuple[RemoteNote, str, str]] = []

        # Per-batch pipeline (Critical 3, PRIMARY): confirm batch N, resolve
        # batch N's MEDIA immediately, THEN move to batch N+1 — a later
        # batch's failure can never strand an already-resolved earlier
        # batch's media. LINK resolution is deliberately deferred to
        # `_resolve_links_final_pass` below, run once every batch (+
        # siblings) has confirmed — see `_confirm_and_resolve_batch`'s
        # docstring for why (a per-batch link resolution silently and
        # permanently erased any forward reference to a not-yet-confirmed
        # note; round-2 review fix, 2026-08-12).
        for batch in _chunks(normal_items, _CONFIRM_BATCH_SIZE):
            entries = [e for e, _rn, _k in batch]
            pairs = [(rn, k) for _e, rn, k in batch]
            res = await _confirm_and_resolve_batch(
                conn, user_id, source, provider, creds,
                source.get("destFolderId"), entries, pairs,
            )
            _merge_batch_result(totals, res, all_touched)

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
            _merge_batch_result(totals, res, all_touched)

        # Tag the ORIGINAL note in a pre-confirm conflict — add-tag only,
        # body/title untouched. Both the original and its sibling now carry
        # 'sync-conflict'; neither version was lost.
        for note_id, tags in conflict_tag_updates.items():
            notes_svc.update_note(user_id, note_id, {"tags": tags}, conn=conn)

        # Final pass (Critical 3 round-2 fix, PRIMARY): resolve every
        # import-link:// mark across the WHOLE round now that every batch
        # (normal + sibling) has confirmed, so a same-round forward
        # reference resolves correctly regardless of which batch its target
        # landed in. Safety-netted as a UNIT: a total failure here (e.g. the
        # bulk `import_check` call itself raising) must not lose an
        # otherwise-successful sync — every note's media is already
        # resolved+written, and any note whose link never got resolved this
        # round simply keeps its intact `import-link://` placeholder (never
        # stripped) for self-heal to pick up on a future sync.
        try:
            link_result = await _resolve_links_final_pass(conn, user_id, source, all_touched)
            totals["conflicts"] += link_result["conflicts"]
            totals["failures"].extend(link_result["failures"])
        except Exception as e:  # noqa: BLE001
            totals["failures"].append(f"link resolution pass failed: {e}")

        return totals
    finally:
        conn.close()
