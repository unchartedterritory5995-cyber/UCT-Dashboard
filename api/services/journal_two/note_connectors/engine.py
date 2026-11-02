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
  1. `provider.list_changed(creds, cursor)` — the "what to FETCH" signal.
     The raw stored cursor is passed straight through; providers own their
     own overlap window internally (Craft: -1h; Roam: re-enumerates + diffs
     edit-times) — the engine never adjusts it. For a provider whose full
     enumeration is cheap but whose content fetch is expensive (OneNote,
     Task 6), this may be a BOUNDED content-fetch drain rather than the
     complete remote set — see `list_present_refs` below.
     ⚠️ Fix-round-1 Important #1 (Finding B): on a `full` pass, the cursor
     handed to THIS call resets to `None` only for a provider WITHOUT
     `list_present_refs` — the pre-existing "force a full re-list" mechanism.
     A provider WITH the hook (OneNote) keeps its STORED cursor even on a
     full pass, because that hook already supplies completeness for delete
     detection/`_touch_remote_index` independently (step 2) — resetting
     `list_changed`'s cursor too would, for a provider whose `list_changed`
     is itself a bounded resumable drain (not a re-list), regress that
     drain's progress backward every night. See the inline comment at the
     cursor-decision line for the full incident writeup.
  2. Full syncs (`full=True`) run delete detection FIRST, against the
     PRE-sync remote_index snapshot (see `_run_delete_detection`), then
     every seen ref is upserted into remote_index (`_touch_remote_index`).
     Task 4: an OPTIONAL `provider.list_present_refs(creds)` hook (checked
     via `getattr`, mirrors `list_deleted` immediately below it) supplies
     the COMPLETE current remote set for BOTH of those steps when present
     and successful — `index_refs` in `_do_sync` — while `list_changed`'s
     own (possibly bounded) result still drives content fetch, unchanged.
     A raising hook, or a provider without one (Roam/Craft/Notion/Dropbox/
     OneDrive define none), falls back to `list_changed`'s result driving
     everything, today's unchanged behavior.
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
     Plan A Task 4: that retry is the link heal pass
     (`link_keys.heal_pending_links`, run at the end of every round over the
     member's `import_links_pending` notes), never a re-import: an unresolved
     link no longer keeps `import_media_pending` set, so it no longer makes
     `import_confirm` re-write the note or the engine re-download its media.
  6. Cursor advances to `max(ref.updated_at for ref in refs)` ONLY if the
     whole sync completed without raising — a provider exception mid-source
     updates the log row to 'error' and leaves the cursor untouched.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import dataclasses
import json
import logging
import os
import random
import sqlite3
import threading
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import import_notice, media_policy
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.import_provenance import edited_since_import
from api.services.journal_two.notes_quota import NoteQuotaExceeded
from api.services.journal_two.note_connectors import connections, errors, oauth
from api.services.journal_two.note_connectors.link_keys import heal_pending_links, resolve_link_keys
from api.services.journal_two.note_connectors.convert import REF_PREFIX, mddoc, rewrite_body
from api.services.journal_two.note_connectors.convert.linkify import (
    import_link_keys, linkify_doc, normalize_link_hrefs,
)
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


def is_source_busy(source_id: str) -> bool:
    """True while a sync of this source is in flight (read-only peek)."""
    with _inflight_lock:
        return source_id in _inflight_sources

# Backoff ladder after a transient sqlite3 "database is locked" (mirrors
# broker/sync.py's _LOCKED_RETRY_DELAYS exactly). Jittered so parallel
# retriers don't re-collide in lockstep.
_LOCKED_RETRY_DELAYS = (1.0, 3.0, 8.0)

# A source synced within this window is skipped unless the caller passes
# manual=True (the explicit "Sync now" action always runs).
_COOLDOWN_SECONDS = 600

# A member's "Sync now" runs the removal check (a complete listing feeding the
# 2-strike delete detection) at most once per this many seconds per source,
# measured from `j2_note_sources.last_full_sync_at`, which EVERY full pass
# writes (scheduler and member alike). Inside the window the press downgrades
# to an incremental pass. The same gap holds for EVERY full pass, scheduler
# included: `_run_delete_detection` counts no enumeration-only miss as a
# strike when the previous full pass was under this many seconds ago, so
# strike 2 always lands at least 10 minutes after strike 1. Scheduler passes
# are never downgraded (they still list fully, stamp, and honour explicit
# trash refs); only their enumeration strikes wait for the gap.
MEMBER_FULL_PASS_MIN_INTERVAL_S = 600

# A stored `last_full_sync_at` up to this far in the future is clock skew and
# still counts; further ahead it is treated as "no previous full pass", so a
# bad stamp can never lock a member out of the removal check.
_LAST_FULL_FUTURE_SKEW_S = 60

# Roam's own pull-many batches 40 eids/call; other providers just inherit
# fetch_many's default per-ref loop, so this bound mainly controls failure
# isolation granularity (how many notes one bad batch can knock out before
# the per-ref fallback kicks in), not provider-specific behavior.
_FETCH_BATCH_SIZE = 40

# Server-side cap on notes_svc.import_confirm is 500/batch; the engine stays
# well under it.
_CONFIRM_BATCH_SIZE = 200


def _utcnow() -> datetime:
    """The engine's one clock. Tests monkeypatch this to move time."""
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _utcnow().isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _last_full_pass_at(value: Any, now: datetime) -> datetime | None:
    """The stored `last_full_sync_at` as an aware datetime, or None when it
    must count as "no previous full pass": absent, unparseable, or more than
    `_LAST_FULL_FUTURE_SKEW_S` in the future. A naive stamp is read as UTC."""
    last = _parse_iso(value)
    if last is None:
        return None
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last > now + timedelta(seconds=_LAST_FULL_FUTURE_SKEW_S):
        return None
    return last


def _removal_check_summary(
    user_id: str, source_id: str, *, ran: bool, reason: str | None, severed: int,
) -> dict[str, Any]:
    """The `removalCheck` block of a member full-pass result, read AFTER the
    pass: `pending` from the index, `nextAllowedAt` from the stored stamp
    (None when the next check is already allowed)."""
    now = _utcnow()
    source = connections.get_source_by_id(source_id) or {}
    last = _last_full_pass_at(source.get("lastFullSyncAt"), now)
    next_allowed = None
    if last is not None:
        nxt = last + timedelta(seconds=MEMBER_FULL_PASS_MIN_INTERVAL_S)
        if nxt > now:
            next_allowed = nxt.isoformat()
    pending = connections.pending_removal_counts(user_id, [source_id]).get(source_id, 0)
    return {
        "ran": ran, "reason": reason, "nextAllowedAt": next_allowed,
        "pending": int(pending), "severed": int(severed or 0),
    }


async def _member_full_pass(user_id: str, source_id: str) -> dict[str, Any]:
    """A member's "Sync now" with full=True. Decided under the in-flight
    guard, from a fresh read of the source, so a pass that finished a moment
    ago is always seen. Inside the rate-limit window it downgrades to a plain
    incremental pass (no strike, no stamp); otherwise it runs the removal
    check."""
    current = connections.get_source_by_id(source_id) or {}
    now = _utcnow()
    last = _last_full_pass_at(current.get("lastFullSyncAt"), now)
    if last is not None and (now - last).total_seconds() < MEMBER_FULL_PASS_MIN_INTERVAL_S:
        result = await _do_sync(user_id, source_id, full=False)
        result["removalCheck"] = _removal_check_summary(
            user_id, source_id, ran=False, reason="rate_limited", severed=0,
        )
        return result
    return await _do_sync(user_id, source_id, full=False, removal_check=True)


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


#: The most `failures_json` entries one log row keeps (Plan D's card lists them).
FAILURES_JSON_CAP = 50


def _finish_log(
    log_id: int, *, status: str, counts: dict[str, int], error: str | None = None,
    source_deleted: int = 0, failures_json: list[dict] | None = None,
) -> None:
    """`source_deleted` is passed SEPARATELY from `counts` on purpose: the
    sever count is produced by delete detection, not by the per-note import
    loop that owns every key in `counts`, and folding it into that dict would
    give one value two authors. It is persisted here because
    `_latest_sync_counts` (routers/note_sync.py) reads the newest log row to
    build the connectors card's counts -- a deletion that is never written to
    this row is invisible to the member no matter what the sync response
    said in the moment.

    `failures_json` (Plan A Task 6, read by Plan D's `/log` parser in
    routers/note_sync.py): the `{noteTitle, reason, name}` of every
    importNotice this pass wrote, `reason` being the member-readable sentence.
    Capped at `FAILURES_JSON_CAP`; NULL when there were none. Plan D's DDL
    always has the column, so it is written unconditionally."""
    items = list(failures_json or [])[:FAILURES_JSON_CAP]
    blob = json.dumps(items, ensure_ascii=False) if items else None
    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE j2_note_sync_log
               SET finished_at = ?, status = ?, error = ?,
                   notes_created = ?, notes_updated = ?, notes_skipped = ?,
                   media_uploaded = ?, conflicts = ?, source_deleted = ?,
                   failures_json = ?
             WHERE id = ?
            """,
            (
                _now_iso(), status, error,
                int(counts.get("created", 0)), int(counts.get("updated", 0)),
                int(counts.get("skipped", 0)), int(counts.get("mediaUploaded", 0)),
                int(counts.get("conflicts", 0)), int(source_deleted or 0),
                blob, log_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()


# ── Public entry points ──────────────────────────────────────────────────────

async def sync_source(
    source_id: str, *, full: bool = False, manual: bool = False,
    member: bool = False,
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
    answer, never a crash.

    `member=True` is a person waiting on "Sync now": it implies
    `manual=True` (no cooldown) and makes exactly ONE acquire attempt — if
    the source is busy it returns `busy` at once, never walking the sleep
    ladder. The sqlite "locked" retry ladder is unchanged for every caller.

    `member=True, full=True` runs the removal check (`_member_full_pass`),
    rate-limited by `MEMBER_FULL_PASS_MIN_INTERVAL_S`; its result carries a
    `removalCheck` block. Only that combination carries it."""
    if member:
        manual = True
    source = connections.get_source_by_id(source_id)
    if source is None:
        raise ValueError(f"unknown note-connector source {source_id!r}")

    if not manual and _within_cooldown(source):
        return {"status": "cooldown", "lastSyncAt": source.get("lastSyncAt")}

    attempts = 1 + len(_LOCKED_RETRY_DELAYS)
    for attempt in range(attempts):
        if not _try_acquire_source(source_id):
            if member or attempt == attempts - 1:
                return {"status": "busy", "sourceId": source_id}
            await asyncio.sleep(_LOCKED_RETRY_DELAYS[attempt] * random.uniform(0.5, 1.5))
            continue
        try:
            if member and full:
                return await _member_full_pass(source["userId"], source_id)
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


# ── Credential resolution (Fix-round-1 Important #1) ────────────────────────

async def _resolve_credentials(user_id: str, provider_name: str) -> dict[str, Any] | None:
    """Returns the current, USABLE credentials dict for (user_id,
    provider_name) — refreshing first when the provider is one `oauth.py`
    knows how to refresh (`oauth.is_registered`) AND its stored token is
    at/near expiry. `None` if there is no connected credential at all
    (matches `connections.get_token`'s own contract).

    `oauth.refresh_if_needed` (built in Task 1) already does the hard part —
    lock-guarded, re-reads the stored credential after acquiring the lock,
    and PERSISTS a refreshed (and, for Microsoft Graph, ROTATED)
    refresh_token via `connections.upsert_connector` — but had ZERO call
    sites before this. That gap is a correctness bug for Microsoft Graph
    specifically, not just a missed optimization: Graph access tokens are
    short-lived (~60-90min) AND redeeming the refresh token returns a NEW
    refresh_token that immediately invalidates the old one. A provider that
    refreshed reactively in its own `_send`/`send` on a bare 401 WITHOUT
    persisting (Dropbox's `_try_refresh` shape — safe there only because
    Dropbox refresh tokens do NOT rotate) would silently strand the OLD,
    now-dead refresh_token in the DB the moment it refreshed once, breaking
    the connector on the very next sync tick. Calling the already-built,
    already-persisting `refresh_if_needed` HERE — before every sync tick,
    for every provider `oauth.py` knows about — closes that gap for Notion,
    OneNote, and OneDrive at once, with no per-provider code.

    Providers `oauth.py` does NOT register (Dropbox — its own app key/secret
    and refresh mechanics live entirely in `providers/dropbox.py` by
    design) fall back to the plain `connections.get_token` read, BYTE-
    IDENTICAL to this function's pre-fix-round-1 behavior. `refresh_if_needed`
    is itself a safe no-op for a registered provider whose stored token
    carries no `expiresAt` (Notion — tokens don't expire, so this makes
    ZERO extra network calls for it, same as before) or no `refreshToken`."""
    if oauth.is_registered(provider_name):
        return await oauth.refresh_if_needed(user_id, provider_name)
    return connections.get_token(user_id, provider_name)


# ── Core per-source sync ─────────────────────────────────────────────────────

async def _do_sync(
    user_id: str, source_id: str, *, full: bool, removal_check: bool = False,
) -> dict[str, Any]:
    """`full` is the scheduler's nightly pass. `removal_check` is a member's
    full pass (`_member_full_pass`): a complete listing feeds delete
    detection while only the incremental delta is fetched and imported. The
    two flags are mutually exclusive; the caller guarantees it."""
    if full and removal_check:
        raise ValueError("_do_sync: full and removal_check are mutually exclusive")
    source = connections.get_source_by_id(source_id)
    if source is None:
        raise ValueError(f"unknown note-connector source {source_id!r}")

    log_id = _start_log(user_id, source_id)
    counts = {"created": 0, "updated": 0, "skipped": 0, "mediaUploaded": 0, "conflicts": 0}
    item_failures: list[str] = []
    # Plan A Task 6: {noteTitle, reason, name} per importNotice written this pass,
    # for the log row's `failures_json` (the `failures` strings above are unchanged).
    notice_failures: list[dict[str, Any]] = []
    delete_guard_warning: str | None = None
    deleted_count = 0
    provider: NoteProvider | None = None

    try:
        provider = _provider_factory(source["provider"], source)
        creds = await _resolve_credentials(user_id, source["provider"])
        if creds is None:
            raise errors.NoteConnNotConfigured(
                f"no connected credentials for provider {source['provider']!r}"
            )

        # `list_present_refs` governs BOTH the cursor-reset decision right
        # below AND (further down, on a full pass) the complete-set input to
        # delete detection — computed ONCE, here, and reused in both places
        # rather than two separate `getattr` calls that could theoretically
        # read differently (this repo's own "a second authority over one
        # value" defect shape).
        present_fn = getattr(provider, "list_present_refs", None)

        # Plan D task 3, removal check step (1): the COMPLETE listing comes
        # FIRST — `list_present_refs` when the provider has it, else
        # `list_changed(cursor=None)` — so that the stored-cursor
        # `list_changed` below is the LAST listing call and every provider's
        # per-call instance state (Notion `_page_meta`, Craft `_doc_meta`,
        # Dropbox/OneDrive `opaque_cursor`, OneDrive `_deleted_refs`, Roam
        # `_title_to_uid`) ends exactly as after a plain incremental pass. If
        # this listing fails, the check does not run (no strike, no stamp)
        # and the pass carries on as an ordinary incremental one.
        removal_listing: list[RemoteRef] | None = None
        removal_reason: str | None = None
        if removal_check:
            try:
                if present_fn is not None:
                    removal_listing = await present_fn(creds)
                else:
                    removal_listing = await provider.list_changed(creds, cursor=None)
            except Exception as e:  # noqa: BLE001 — degrade to incremental, never abort
                item_failures.append(
                    f"removal check skipped: the full listing failed (synced "
                    f"changes only): {e}"
                )
                removal_reason = "enumeration_failed"

        # Raw cursor, unadjusted — providers own their own overlap window.
        # A provider WITHOUT `list_present_refs` (Roam/Craft/Notion/Dropbox/
        # OneDrive) resets to None on every full pass — the pre-existing,
        # unchanged mechanism for forcing a complete re-list on that provider's
        # OWN `list_changed`.
        #
        # A provider WITH `list_present_refs` (OneNote) must NOT also reset
        # here (fix-round-1 Important #1 / Finding B): that hook already
        # supplies a COMPLETE remote set for delete detection + remote_index
        # on every full pass (see below), so `list_changed` has no need to
        # re-derive completeness itself — for OneNote specifically,
        # `list_changed` is a bounded, RESUMABLE watermark drain, not a full
        # re-list. Resetting its cursor to None on every nightly full pass
        # would restart that drain from the epoch and regress the watermark
        # BACKWARD from wherever incremental ticks had already reached —
        # re-importing old content and, on any account bigger than
        # K × (ticks between full passes), starving the newest edits forever
        # (confirmed via `repro_fullpass.py`: incremental reached T99, one
        # full pass dropped the cursor to T39). Passing the STORED cursor
        # through on a full pass for such a provider lets its bounded drain
        # continue exactly where it left off, while `list_present_refs`
        # (below) independently supplies the completeness delete detection
        # needs — the two concerns are already cleanly separated by design
        # (spec §9); this is that separation actually holding on the cursor
        # too, not just on `index_refs`.
        cursor = None if (full and present_fn is None) else source.get("cursor")
        refs = await provider.list_changed(creds, cursor=cursor)
        # Task 4: `index_refs` is what delete detection + remote_index
        # bookkeeping actually see. Defaults to `refs` (today's behavior,
        # unconditionally) and is ONLY ever overridden below, on a `full`
        # pass, by a provider that exposes `list_present_refs` and whose
        # call succeeds — so an incremental pass, or a provider without the
        # hook, leaves this byte-for-byte equal to `refs`.
        index_refs = refs

        # Removal check step (4): a page in EITHER listing is present (union
        # by remote_id, the delta's ref winning) — absorbs search-index lag
        # in either listing, so a lagging full listing can never strike a
        # page the delta just returned.
        if removal_listing is not None:
            by_id = {r.remote_id: r for r in removal_listing}
            by_id.update({r.remote_id: r for r in refs})
            index_refs = list(by_id.values())

        if full or removal_listing is not None:
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

            # Task 4: an optional, full-pass-only hook for a provider whose
            # full ENUMERATION is cheap but whose content FETCH is expensive
            # (OneNote, Task 6) — it returns the COMPLETE current remote set
            # while `list_changed` above returns only a bounded drain (a
            # content-fetch budget, not a full listing). Mirrors the
            # `list_deleted` seam immediately above EXACTLY: same `getattr`
            # gating, same full-pass-only placement, same catch-and-fall-
            # back-with-named-failure discipline. When present and
            # successful, `index_refs` becomes this COMPLETE set, so delete
            # detection (`_run_delete_detection`'s `seen_ids`) and
            # `_touch_remote_index` see every item that still exists
            # remotely — a present-but-not-yet-fetched item is correctly
            # touched (miss_streak reset), never mistaken for missing/
            # deleted just because this round's bounded drain didn't reach
            # it. `refs` itself is UNCHANGED and still drives
            # `_fetch_remote_notes` below — enumeration is complete, content
            # fetch stays bounded. A raising hook, or a provider without the
            # method (Roam/Craft/Notion/Dropbox/OneDrive define none), never
            # aborts the sync — `index_refs` simply falls back to `refs`,
            # today's behavior, unchanged. `present_fn` itself was already
            # resolved once, above, before the cursor decision — reused here.
            # (A removal check already called it, as step (1), above.)
            if full and present_fn is not None:
                try:
                    index_refs = await present_fn(creds)
                except Exception as e:  # noqa: BLE001
                    item_failures.append(
                        f"list_present_refs sweep failed (falling back to "
                        f"refs-drive-everything): {e}"
                    )

            # Every full pass, scheduler or member, stamps
            # `last_full_sync_at` in the detection transaction (refused
            # included) — the member rate limit reads it.
            dd = _run_delete_detection(
                user_id, source, index_refs, deleted_refs=deleted_refs,
                stamp_at=_now_iso(),
            )
            if removal_check:
                removal_reason = "refused" if dd["refused"] else None
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

        _touch_remote_index(user_id, source, provider, index_refs)

        remote_notes, fetch_failures = await _fetch_remote_notes(provider, creds, refs)
        item_failures.extend(fetch_failures)
        # Plan A Task 10: links finalized here, before anything hashes or stores a doc.
        remote_notes = await asyncio.to_thread(_finalize_remote_notes, remote_notes)

        # ⛔⛔ session-audit.md A1: every ref this pass fetched but never
        # actually got a stored note out of — a fetch failure (never made it
        # into `remote_notes`) or a per-note storage failure `import_confirm`
        # isolated (`result["notStoredRefs"]`, below) — is tracked so the
        # cursor-advance step can refuse to move past it. Without this, the
        # provider's own cursor (computed from EVERY fetched ref, before any
        # import is attempted) advances regardless of what actually landed,
        # and an oversized-but-otherwise-ordinary note is lost permanently:
        # a plain re-push of unchanged content is a no-op (no new hash, no
        # new timestamp), so nothing would ever ask for it again.
        not_stored_refs: set[str] = {r.remote_id for r in refs} - {rn.remote_id for rn in remote_notes}

        if remote_notes:
            result = await _import_remote_notes(user_id, source, provider, creds, remote_notes)
            counts["created"] += result["created"]
            counts["updated"] += result["updated"]
            counts["skipped"] += result["skipped"]
            counts["mediaUploaded"] += result["mediaUploaded"]
            counts["conflicts"] += result["conflicts"]
            item_failures.extend(result["failures"])
            notice_failures.extend(result.get("noticeFailures", []))
            not_stored_refs.update(result.get("notStoredRefs", []))

        # Task 11 MUST-RESOLVE #1: an opaque cursor the provider published
        # on ITSELF (Dropbox — see base.py's `opaque_cursor` docstring)
        # takes precedence, stored VERBATIM, and unconditionally (even with
        # `refs == []` — an empty incremental delta still needs its
        # continuation cursor persisted so the NEXT call keeps continuing
        # from here rather than falling back to a full re-list). Timestamp
        # mode (Roam/Craft/Notion — `opaque_cursor` stays the class default
        # `None`) is completely unchanged: only advances on a non-empty
        # `refs`, derived as `max(updated_at)`.
        #
        # ⛔⛔ A1: neither branch runs at all when `not_stored_refs` is
        # non-empty — the cursor stays exactly where it was BEFORE this
        # pass, for every provider uniformly. Coarser than a per-provider
        # partial-safe watermark (opaque-cursor providers like Obsidian
        # expose no per-item granularity to do better), but correct: every
        # note this round DID store is unaffected — `import_confirm`'s own
        # hash check makes reprocessing an already-stored note on the next
        # pass a harmless no-op — and the still-unstored one is retried
        # (and re-reported) every pass until it is fixed or removed,
        # instead of silently disappearing.
        opaque_cursor = getattr(provider, "opaque_cursor", None)
        if not not_stored_refs:
            if opaque_cursor is not None:
                connections.update_cursor(user_id, source_id, opaque_cursor)
            elif refs:
                newest = max(r.updated_at for r in refs)
                connections.update_cursor(user_id, source_id, newest)

        # A1: a pass that fetched refs but stored NONE of them (the "13 of
        # 13 lost" catastrophic case a whole-batch confirm failure used to
        # produce) must not report "ok" and move on. A genuine PARTIAL
        # commit — most notes stored, one oversized note isolated and named
        # in `failures` — still reports "ok": the batch committed what it
        # could, exactly as designed; the failure is visible in `failures`,
        # not hidden behind the top-level status.
        lost_everything = bool(not_stored_refs) and not (
            counts["created"] or counts["updated"] or counts["skipped"]
        )
        status = "warning" if (delete_guard_warning or lost_everything) else "ok"
        error_parts = ([delete_guard_warning] if delete_guard_warning else []) + item_failures

        # ⛔⛔ Recorded HERE, not before the block above, and from the SAME
        # `status`/`error_parts` the log and the return value use -- one
        # authority for "how did this pass go". This call used to fire above
        # as a bare `ok=True`, so a pass that stored 0 of 13 notes returned
        # status="warning" while writing "ok" with a NULL error to the source
        # row -- and that row is the one the connectors card reads. `ok=True`
        # is still right even for a warning: the pass authenticated and
        # fetched, so it is genuine evidence a previously-'broken' source has
        # recovered; only what the MEMBER is shown differs.
        connections.record_sync_result(
            user_id, source_id, ok=True, status=status,
            error="; ".join(error_parts) if error_parts else None,
        )

        _finish_log(
            log_id, status=status, counts=counts,
            error="; ".join(error_parts) if error_parts else None,
            source_deleted=deleted_count, failures_json=notice_failures,
        )

        result = {
            "status": status,
            "sourceId": source_id,
            **counts,
            "sourceDeleted": deleted_count,
            "failures": item_failures,
            "deleteDetectionWarning": delete_guard_warning,
        }
        if removal_check:
            result["removalCheck"] = _removal_check_summary(
                user_id, source_id, ran=removal_listing is not None,
                reason=removal_reason, severed=deleted_count,
            )
        return result
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
        _finish_log(log_id, status="error", counts=counts, error=str(e),
                    failures_json=notice_failures)
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
    *, deleted_refs: list[RemoteRef] | None = None, stamp_at: str,
) -> dict[str, Any]:
    """Plan D task 3: `stamp_at` is written to `j2_note_sources.
    last_full_sync_at` in the SAME transaction on EVERY branch, the <50%
    refuse branch included (a refused check is still a check for the member
    rate limit), so that branch now commits. The result carries `refused`,
    True only on the <50% branch. Neither guard's condition changed.

    Runs BEFORE `_touch_remote_index` so `prev_count` reflects the index
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
        # Strike gap for EVERY pass: when the PREVIOUS full pass (read before
        # this one stamps) was under MEMBER_FULL_PASS_MIN_INTERVAL_S ago, an
        # enumeration-only miss does not count as a strike this pass. Explicit
        # `deleted_refs` still sever (within the 20% cap) and seen notes still
        # reset. Unparseable or far-future stamps count as "no previous pass".
        prev_stamp_row = conn.execute(
            "SELECT last_full_sync_at FROM j2_note_sources WHERE id = ? AND user_id = ?",
            (source_id, user_id),
        ).fetchone()
        gap_now = _utcnow()
        prev_full = _last_full_pass_at(prev_stamp_row["last_full_sync_at"] if prev_stamp_row else None, gap_now)
        strike_gap_open = (
            prev_full is not None
            and (gap_now - prev_full).total_seconds() < MEMBER_FULL_PASS_MIN_INTERVAL_S
        )
        conn.execute(
            "UPDATE j2_note_sources SET last_full_sync_at = ? WHERE id = ? AND user_id = ?",
            (stamp_at, source_id, user_id),
        )
        existing_rows = conn.execute(
            "SELECT remote_id, import_key, miss_streak FROM j2_note_remote_index "
            "WHERE user_id = ? AND source_id = ?",
            (user_id, source_id),
        ).fetchall()
        prev_count = len(existing_rows)
        if prev_count > 0 and len(seen_ids) < prev_count * 0.5:
            conn.commit()  # the stamp only: no index row is touched
            return {
                "status": "warning",
                "refused": True,
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
            if strike_gap_open:
                continue  # inside the strike gap: an enumeration miss is not a strike
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
            return {"status": "warning", "refused": False, "deleted": deleted,
                    "reason": explicit_refuse_reason}
        return {"status": "ok", "refused": False, "deleted": deleted, "reason": None}
    finally:
        conn.close()


def _write_tags_preserving_updated_at(
    conn: sqlite3.Connection, user_id: str, note_id: str, tags: list[str],
) -> None:
    """Writes ONLY the `tags` column, deliberately WITHOUT bumping
    `updated_at` — used EXCLUSIVELY by the engine's own tag writes: the
    sever/un-sever tags (`_tag_note_source_deleted`,
    `_untag_note_source_reappeared`) and, since Plan A Task 15 (D1), the
    `sync-conflict` tag on a member-edited original (`_import_remote_notes`'
    conflict loop and `_reroute_resolved_body_to_sibling`) — never by a real
    user edit (Fix-round-2 Important, carried from Task 8: made user-visible
    by round-1's heal path, not introduced by it). Through `update_note` the
    conflict tag moved the member's edit time to the sync time, so the note
    jumped to the top of "recently edited".

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
    *, remote_rev: str | None,
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
    detected".

    Plan A Task 1: `remote_rev`, when given, is written to
    `import_remote_rev` in the same raw write, for the same reason — the
    revision gate in `_remote_changed` must compare against the last
    revision this sync SAW, not the one before the first conflict."""
    if remote_rev is None:
        conn.execute(
            "UPDATE j2_notes SET import_hash = ? WHERE id = ? AND user_id = ?",
            (import_hash, note_id, user_id),
        )
    else:
        conn.execute(
            "UPDATE j2_notes SET import_hash = ?, import_remote_rev = ? "
            "WHERE id = ? AND user_id = ?",
            (import_hash, remote_rev, note_id, user_id),
        )


def _backfill_remote_revs_preserving_updated_at(
    conn: sqlite3.Connection, user_id: str, remote_notes: list[RemoteNote],
    import_keys: list[str], existing: dict[str, dict[str, Any]],
) -> int:
    """Plan A Task 1 fix round 1: give a LEGACY row (`import_remote_rev`
    NULL) its revision the first time a pass sees it UNCHANGED (stored
    `import_hash` == this pass's hash, so `rn.updated_at` is exactly the
    revision that hash was taken at). Without it a legacy row that had
    already conflicted (imported_at stale, remote revision later) stays on
    `_remote_changed`'s imported_at fallback, and the first converter change
    reads as a remote edit and re-tallies the conflict / re-confirms a
    sibling the member deleted.

    Raw write, never `updated_at` (same idiom as
    `_write_import_hash_preserving_updated_at`). Run BEFORE the conflict
    gate's own writes and committed on its own by the caller, so committing
    it can never commit a conflict baseline ahead of its sibling."""
    n = 0
    for rn, key in zip(remote_notes, import_keys):
        meta = existing.get(key)
        rev = rn.updated_at or None
        if meta is None or rev is None or meta.get("importRemoteRev") is not None:
            continue
        if notes_svc._import_payload_hash(_build_confirm_entry(rn, key)) != (meta.get("importHash") or ""):
            continue
        conn.execute(
            "UPDATE j2_notes SET import_remote_rev = ? "
            "WHERE id = ? AND user_id = ? AND import_remote_rev IS NULL",
            (rev, meta["id"], user_id),
        )
        meta["importRemoteRev"] = rev
        n += 1
    return n


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


def _finalize_remote_doc(doc: dict[str, Any]) -> dict[str, Any]:
    """Plan A Task 10 (L-3, L-4): THE chokepoint every provider's doc passes through --
    Notion rich text, Roam, Craft, OneNote, Dropbox and Obsidian alike -- before it is
    hashed or stored. Existing hrefs go through the one scheme policy first (an unsafe or
    dead link becomes text), then bare URLs in plain text become links. Pure."""
    return linkify_doc(normalize_link_hrefs(doc))


def _finalize_remote_notes(notes: list[RemoteNote]) -> list[RemoteNote]:
    """Each note with a finalized doc -- a NEW `RemoteNote`, the provider's object is never
    mutated. A deep link the policy turned into a pending `import-link://` key joins
    `links`, so the round's final link pass resolves it like any other. Called through
    `asyncio.to_thread`: linear, but a large batch is still CPU work off the event loop."""
    out: list[RemoteNote] = []
    for rn in notes:
        doc = _finalize_remote_doc(rn.doc)
        links = list(rn.links)
        links.extend(k for k in import_link_keys(doc) if k not in links)
        out.append(dataclasses.replace(rn, doc=doc, links=links))
    return out


# ── Conflict policy + import_confirm + media/rewrite (spec §6, §3) ──────────

def _is_conflict(meta: dict[str, Any]) -> bool:
    """Edited by the member since the last import -- the ONE predicate
    (`import_provenance.edited_since_import`, Plan A Task 4 controller ruling 2)."""
    return edited_since_import(meta.get("updatedAt"), meta.get("importedAt"))


def _remote_changed(meta: dict[str, Any], rn: RemoteNote, entry_hash: str) -> bool:
    """Plan A Task 1: did the REMOTE change since the last time this sync
    confirmed or baselined the note? Keyed on the remote's own revision
    (`import_remote_rev`), NOT on `import_hash` alone — the hash covers OUR
    conversion of the body, so a converter fix moves it for every note and,
    on a member-edited note, used to read as "edited AND remote changed" and
    manufacture a "(synced copy)" sibling on the next nightly full pass.

    Rule, in order:
      1. hash equal                       -> False (nothing moved at all)
      2. stored rev and remote rev known  -> the revisions differ
      3. remote reports no revision       -> True (the pre-Task-1 hash rule;
                                             nothing better to key on)
      4. legacy row (stored rev NULL)     -> remote revision is later than
                                             `imported_at`

    ⚠️ Known, accepted limitation (controller ruling, 2026-11-01): some
    providers (Notion) report minute-precision revision timestamps, so a
    remote edit made within the same minute as the last sync, on a
    member-edited note, reads as the same revision and is skipped until the
    next remote edit. Deliberately NOT papered over with a raw-payload hash."""
    if entry_hash == (meta.get("importHash") or ""):
        return False
    stored_rev = meta.get("importRemoteRev")
    # `or None`: an empty revision is no revision, exactly as import_confirm
    # stores it (`n.get("updatedAt") or None`).
    remote_rev = rn.updated_at or None
    if stored_rev is not None and remote_rev is not None:
        return remote_rev != stored_rev
    if remote_rev is None:
        return True
    remote = _parse_iso(remote_rev)
    imported = _parse_iso(meta.get("importedAt"))
    if remote is None or imported is None:
        return True  # unreadable -> the conservative pre-Task-1 answer
    if remote.tzinfo is None:
        remote = remote.replace(tzinfo=timezone.utc)
    if imported.tzinfo is None:
        imported = imported.replace(tzinfo=timezone.utc)
    return remote > imported


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
        # Wave 0 trash: a soft-deleted note's import_key must read as
        # "doesn't exist" to the sync engine, same reasoning as
        # notes.py::import_check — otherwise a background sync would
        # silently resurrect a note the member deliberately trashed.
        # Plan A Task 6: the body is read only for a note still pending media (1 retry
        # now, 2 waiting for space) -- the only rows whose notices carry attempts the
        # next try must count from. Read HERE, before confirm overwrites the body.
        rows = conn.execute(
            f"SELECT id, import_key, updated_at, imported_at, tags, folder_id, import_hash, "
            f"import_remote_rev, "
            f"CASE WHEN import_media_pending IN (1, 2) THEN body_json END AS pending_body "
            f"FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
            f" AND import_key IN ({placeholders})",
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
                "importRemoteRev": row["import_remote_rev"],  # Plan A Task 1
                # Plan A Task 6: {ref: attempts} of this note's notices ({} unless pending)
                "noticeAttempts": (import_notice.notice_attempts_by_ref(row["pending_body"])
                                   if row["pending_body"] else {}),
                # Plan A Task 8 fix round 1 (I4): the resolved body a retry builds on, so
                # what already resolved is reused, never fetched and stored again.
                "pendingBody": row["pending_body"],
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
    the already-resolved content into a conflict sibling instead (spec §6).

    audit B5: also recomputes `import_media_pending` from the body this call
    is ABOUT to write (not the note's prior state). Media resolves fully in
    one pass, so a media-only note clears the flag here. Plan A Task 6: this
    is also the ONLY writer of an `importNotice`'s `attempts` (the retry
    bookkeeping lives in the body), so the count moves without `updated_at`.

    Plan A Task 4: and `import_links_pending`, separately. A link left as an
    inert intact placeholder (unresolved marks are never stripped, on
    purpose) keeps `import_links_pending = 1` and nothing else: media pending
    would make `import_confirm` re-write the note and the engine re-download
    its media on every pass, for a link no re-import can resolve. The link
    heal pass (`link_keys.heal_pending_links`, run at the end of every
    import round and from the member's heal door) finishes it once its
    target exists, writing through THIS function."""
    body_plain = notes_svc.extract_plain_text(body)
    body_blob = json.dumps(body)
    # Plan A Task 6: tri-state -- 1 while a placeholder or a retryable importNotice
    # remains (the next sync retries it), 2 while only a storage_limit notice waits.
    media_pending = import_notice.media_pending_state(body)
    links_pending = 1 if notes_svc._body_has_import_link(body) else 0
    # One unit with its sidecars (below): a SAVEPOINT, so a failed projection undoes
    # THIS note's body write and nothing else the connection may hold.
    conn.execute("SAVEPOINT apply_resolved_body")
    try:
        cur = conn.execute(
            "UPDATE j2_notes SET body_json = ?, body_plain = ?, import_media_pending = ?, "
            "import_links_pending = ? "
            "WHERE id = ? AND user_id = ? AND updated_at = ?",
            (body_blob, body_plain, media_pending, links_pending, note_id, user_id,
             expected_updated_at),
        )
        applied = cur.rowcount > 0
        if applied:
            # Plan A Task 2, controller ruling 1: every other body write rebuilds the
            # content sidecars in its own transaction, and this one must too -- a link
            # this pass resolves (import-link:// -> /journal?j2tab=notebook&note=<id>),
            # or one Task 4's heal pass writes through here, is otherwise never a
            # backlink or a graph edge. Timestamp-neutral like the UPDATE above:
            # `_sync_note_sidecars` writes only the sidecar tables, never j2_notes.
            notes_svc._sync_note_sidecars(conn, user_id, note_id, body, body_plain)
    except Exception:
        # The body write is undone with its projection, never left pending for some
        # later commit to land alone. The caller records a per-note failure (fix
        # round 1, M1); the stored placeholder body stays for self-heal to retry.
        conn.execute("ROLLBACK TO SAVEPOINT apply_resolved_body")
        conn.execute("RELEASE SAVEPOINT apply_resolved_body")
        raise
    conn.execute("RELEASE SAVEPOINT apply_resolved_body")
    conn.commit()
    return applied


def _find_stranded_placeholder_ids(
    conn: sqlite3.Connection, note_ids: list[str],
) -> set[str]:
    """Targeted SELECT on exactly the given (already-known 'skipped') note
    ids — never a table scan. A hit means a PRIOR sync round's resolve step
    never completed for this note (e.g. it was in a confirm batch whose
    resolve step raised, before Critical 3's per-batch pipeline existed, or
    a process crash mid-resolve) and the literal placeholder is still sitting
    in the stored body. Self-heal (Critical 3b): any hit re-enters Phase 2
    even though its content hash says 'unchanged'.

    Plan A Task 4: MEDIA placeholders only. A stranded `import-link://` is
    not a reason to re-enter Phase 2 (that re-downloads the note's media and
    rewrites it for a link that may never resolve, every pass); the link
    heal pass at the end of `_import_remote_notes` finishes it instead."""
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
            if "import-ref://" in body:
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
            # Engine bookkeeping, not an edit: the member's own edit time stays (Task 15 D1).
            _write_tags_preserving_updated_at(conn, user_id, row["id"], cur_tags)
            conn.commit()
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


#: Task 9 fix round 1 (minor a): room for the `data:<mime>;params,` header and line breaks.
DATA_URI_SLACK_CHARS = 4096


def data_uri_max_chars() -> int:
    """The longest data URI that can decode to a source the media policy would keep: the
    base64 length of `MEDIA_SOURCE_MAX_BYTES` (read per call, never retyped) plus slack."""
    return media_policy.MEDIA_SOURCE_MAX_BYTES * 4 // 3 + DATA_URI_SLACK_CHARS


def _decode_data_uri(data_uri: str) -> tuple[bytes, str]:
    """`(bytes, mime)` for a data URI (Plan A Task 9, I-6): base64 when a `;base64` parameter
    is present, else percent-encoded (`data:image/svg+xml,%3Csvg...`). The grammar is
    `mddoc.DATA_URI_RE`, the one copy. Run off the event loop (`asyncio.to_thread`).

    Fix round 1: a URI longer than `data_uri_max_chars()` is `NoteConnTooLarge` (`too_large`)
    BEFORE any decoding; a malformed URI or bad base64 is `NoteConnUnsupported`, a FINAL
    `unsupported` notice -- bytes that cannot decode never will, so it is never retried."""
    if len(data_uri) > data_uri_max_chars():
        raise errors.NoteConnTooLarge(
            f"data URI of {len(data_uri)} characters exceeds {data_uri_max_chars()}",
            reason="Inline image is larger than the allowed size limit")
    match = mddoc.DATA_URI_RE.match(data_uri)
    if match is None:
        raise errors.NoteConnUnsupported(f"malformed data URI: {data_uri[:40]!r}",
                                         reason="Inline image data is malformed")
    content_type = match.group("mime").strip().lower() or "application/octet-stream"
    params = [p.strip().lower() for p in match.group("params").split(";")]
    payload = match.group("payload")
    if "base64" in params:
        try:
            return base64.b64decode(payload, validate=True), content_type
        except (binascii.Error, ValueError) as exc:
            raise errors.NoteConnUnsupported(f"data URI base64 does not decode: {exc}",
                                             reason="Inline image data is malformed") from exc
    return urllib.parse.unquote_to_bytes(payload), content_type


def media_failure_reason(exc: BaseException) -> str:
    """The `SERVER_REASONS` code for a media failure, decided by TYPE (see
    `_notice_for_exception`). The ONE mapping: the engine's notices and the member media-fetch
    door (`POST /api/j2/notes/media/fetch`, Plan A Task 9) both read it."""
    if isinstance(exc, media_policy.MediaRejected):
        return exc.reason
    if isinstance(exc, errors.NoteConnUnsafeAddress):
        return "unsafe"
    if isinstance(exc, errors.NoteConnTooLarge):
        return "too_large"
    if isinstance(exc, errors.NoteConnUnsupported):
        return "unsupported"
    if isinstance(exc, NoteQuotaExceeded) or isinstance(exc.__cause__, NoteQuotaExceeded):
        return "storage_limit"
    if isinstance(exc, notes_svc.NoteValidationError):
        return "unsupported"
    return "fetch_failed"


def _notice_for_exception(
    exc: Exception, *, ref: str, name: str | None, source_url: str | None, attempts: int,
) -> dict:
    """The importNotice a media failure leaves where the file was (Plan A Task 6).

    Decided by TYPE, never by an error's wording (Plan A Task 8): a `MediaRejected` from the
    one media policy carries its own reason; `NoteConnUnsafeAddress` (the SSRF guard) is
    `unsafe`; `NoteConnTooLarge` (a capped download) is `too_large`; any other
    `NoteConnUnsupported` is final `unsupported`. A `NoteValidationError` from a save is final
    `unsupported`, except the storage quota (raised `from NoteQuotaExceeded`), which is
    `storage_limit`: it waits for space (`import_media_pending = 2`). Anything else
    (`NoteConnTransient`, a network error, a bad data URI) is `fetch_failed`, retried while
    `attempts < MEDIA_RETRY_MAX_ATTEMPTS`. `attempts` counts fetch tries and is kept only
    on `fetch_failed`, the one reason it bounds: a waiting or final notice stores 0, so a
    storage wait can never run a bound out."""
    reason = media_failure_reason(exc)
    return import_notice.notice_node(
        reason, name=name, source_url=source_url, ref=ref,
        attempts=attempts if reason == "fetch_failed" else 0)


def _media_source_url(m: dict[str, Any]) -> str | None:
    """The address a notice links to: the entry's own `source_url` (http(s) only), else
    the ref itself when the ref is a safe http(s) address."""
    return import_notice.safe_source_url(m.get("source_url")) or import_notice.safe_source_url(m.get("ref"))


def _placeholder_refs(doc: Any) -> list[str]:
    """Every media placeholder ref in a body, in document order: an `image`'s `src` or an
    `attachmentChip`'s `href` reading `import-ref://<ref>` -- exactly what `rewrite_body`
    resolves."""
    out: list[str] = []
    stack = [doc]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        attr = {"image": "src", "attachmentChip": "href"}.get(node.get("type"))
        value = (node.get("attrs") or {}).get(attr) if attr else None
        if isinstance(value, str) and value.startswith(REF_PREFIX) and value[len(REF_PREFIX):]:
            out.append(value[len(REF_PREFIX):])
        content = node.get("content")
        if isinstance(content, list):
            stack.extend(reversed(content))
    return list(dict.fromkeys(out))


def _placeholder_nodes(doc: Any) -> dict[str, dict]:
    """`{ref: placeholder node}` for every media placeholder in a body (first one per ref)."""
    out: dict[str, dict] = {}
    stack = [doc]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        attr = {"image": "src", "attachmentChip": "href"}.get(node.get("type"))
        value = (node.get("attrs") or {}).get(attr) if attr else None
        if isinstance(value, str) and value.startswith(REF_PREFIX) and value[len(REF_PREFIX):]:
            out.setdefault(value[len(REF_PREFIX):], node)
        content = node.get("content")
        if isinstance(content, list):
            stack.extend(reversed(content))
    return out


def _retry_source(stored_body: str | None, rn: RemoteNote) -> tuple[dict[str, Any], set[str]] | None:
    """Plan A Task 8 fix round 1 (I4): a media RETRY (a storage wait that freed, or a
    `fetch_failed` with attempts left) of a note whose remote content is unchanged builds on
    the body already stored, not on the placeholder doc: every notice still worth retrying
    goes back to its placeholder, and everything that already resolved stays exactly as
    stored. Returns `(doc, refs_to_retry)`, or None when the stored body cannot be built on
    (unreadable, still holding a raw placeholder, or nothing to retry): the caller then
    imports the whole note as before."""
    if not stored_body or REF_PREFIX in stored_body:
        return None
    try:
        stored = json.loads(stored_body)
    except (TypeError, ValueError):
        return None
    placeholders = _placeholder_nodes(rn.doc)
    retry: set[str] = set()

    def walk(node: Any) -> Any:
        if not isinstance(node, dict):
            return node
        if node.get("type") == import_notice.IMPORT_NOTICE_TYPE:
            attrs = node.get("attrs") or {}
            ref = attrs.get("ref")
            if ref in placeholders and (import_notice.is_retryable(attrs)
                                        or attrs.get("reason") == "storage_limit"):
                retry.add(ref)
                return copy.deepcopy(placeholders[ref])
            return node
        if isinstance(node.get("content"), list):
            return {**node, "content": [walk(c) for c in node["content"]]}
        return node

    doc = walk(stored)
    return (doc, retry) if retry and isinstance(doc, dict) else None


_ATTACHMENT_URL_PREFIX = "/api/j2/notes/attachments/"


def _owned_media(user_id: str, note_id: str, url: Any, *, sub: str) -> tuple[str, int] | None:
    """`(file name, size on disk)` when `url` is one of THIS note's own stored files under
    `sub` ("inline" or "file") and the file is still there; else None."""
    if not isinstance(url, str):
        return None
    head = f"{_ATTACHMENT_URL_PREFIX}{user_id}/{note_id}/{sub}/"
    if not url.startswith(head):
        return None
    filename = url[len(head):]
    if not all(notes_svc._is_safe_path_segment(s) for s in (user_id, note_id, filename)):
        return None
    # The write root first (where `store_media` put it), then every root the serve route reads.
    for path in (notes_svc._ATTACHMENT_ROOT / user_id / "notes" / note_id / sub / filename,
                 notes_svc.serve_note_image_path(user_id, note_id, sub, filename)):
        try:
            if path is not None and path.is_file():
                return filename, path.stat().st_size
        except OSError:
            continue
    return None


def _media_sequence(doc: Any) -> list[tuple[dict, list, int]]:
    """Every media node of a body in document order, with its parent list and index there:
    an `image`, an `attachmentChip` or an `importNotice` carrying a ref."""
    out: list[tuple[dict, list, int]] = []

    def walk(node: Any) -> None:
        content = node.get("content") if isinstance(node, dict) else None
        if not isinstance(content, list):
            return
        for i, child in enumerate(content):
            if not isinstance(child, dict):
                continue
            kind = child.get("type")
            if kind in ("image", "attachmentChip") or (
                    kind == import_notice.IMPORT_NOTICE_TYPE and (child.get("attrs") or {}).get("ref")):
                out.append((child, content, i))
            walk(child)

    walk(doc)
    return out


def _reusable_media(
    stored_body: str | None, doc: Any, user_id: str, note_id: str,
) -> dict[str, media_policy.StoredMedia]:
    """Final review I1(b): `{ref: StoredMedia}` for every placeholder of the NEW conversion
    `doc` whose media the note's CURRENT stored body already holds, so a re-import of a note
    whose REMOTE REVISION is unchanged (a converter change re-hashes every note) reuses it
    instead of downloading and storing it again. The `_retry_source` pattern, for the case
    where the body itself must be rebuilt from the new conversion.

    The stored body keeps no ref on a resolved node, so the two bodies are aligned in
    document order, exactly as `rewrite_body` produced the stored one: a placeholder image
    became `image{src}` (attrs otherwise unchanged), optionally followed by its original's
    chip; one stored as a file became a chip; a placeholder chip stayed a chip with its
    name; a failure became an `importNotice` with the same ref (not reused: it is fetched,
    its attempts counting on). Every reused URL must be one of THIS note's own files, still
    on disk. Anything that does not line up -- a converter change that moved, added or
    removed media, an ambiguous original -- returns {} and the note imports exactly as
    before (fetch everything): a wrong image in the wrong place is never the trade."""
    if not stored_body or REF_PREFIX in stored_body:
        return {}
    try:
        stored = json.loads(stored_body)
    except (TypeError, ValueError):
        return {}
    placeholders = [(node, parent, i) for node, parent, i in _media_sequence(doc)
                    if node.get("type") in ("image", "attachmentChip")]
    slots = _media_sequence(stored)
    if not placeholders:
        return {}

    def ref_of(node: dict) -> str | None:
        attr = "src" if node.get("type") == "image" else "href"
        value = (node.get("attrs") or {}).get(attr)
        if isinstance(value, str) and value.startswith(REF_PREFIX) and value[len(REF_PREFIX):]:
            return value[len(REF_PREFIX):]
        return None

    def without(attrs: Any, *keys: str) -> dict:
        return {k: v for k, v in (attrs or {}).items() if k not in keys}

    owned_seen: dict[tuple[Any, str], tuple[str, int] | None] = {}

    def owned_media(url: Any, sub: str) -> tuple[str, int] | None:
        key = (url if isinstance(url, str) else None, sub)
        if key not in owned_seen:                  # one stat per stored file, not per state
            owned_seen[key] = _owned_media(user_id, note_id, url, sub=sub)
        return owned_seen[key]

    def chip_media(attrs: dict, *, exact: bool) -> media_policy.StoredMedia | None:
        if exact and set(attrs) != {"href", "name", "size"}:
            return None
        owned = owned_media(attrs.get("href"), "file")
        if owned is None:
            return None
        name = attrs.get("name") if isinstance(attrs.get("name"), str) else owned[0]
        return media_policy.StoredMedia(kind="file", url=attrs["href"], name=name, size=owned[1],
                                        mime="", width=None, height=None)

    refs = [ref_of(node) for node, _p, _i in placeholders]
    n_ph, n_slots = len(placeholders), len(slots)
    if None in refs or n_slots < n_ph:
        return {}           # a non-placeholder image in the new conversion: not ours to align

    def options(k: int, j: int) -> list[tuple[media_policy.StoredMedia | None, int]]:
        """Every way placeholder `k` can match the stored slots starting at `j`:
        `(media or None for a notice, next slot)`."""
        if j >= n_slots:
            return []
        pnode, ref = placeholders[k][0], refs[k]
        snode, sparent, si = slots[j]
        pattrs, sattrs, stype = pnode.get("attrs") or {}, snode.get("attrs") or {}, snode.get("type")
        if stype == import_notice.IMPORT_NOTICE_TYPE:
            # it failed last time: fetched again (attempts counting on), never reused
            return [(None, j + 1)] if sattrs.get("ref") == ref else []
        if pnode.get("type") == "image" and stype == "image":
            if without(pattrs, "src") != without(sattrs, "src"):
                return []
            owned = owned_media(sattrs.get("src"), "inline")
            if owned is None:
                return []
            media = media_policy.StoredMedia(kind="image", url=sattrs["src"], name=owned[0],
                                             size=owned[1], mime="", width=None, height=None)
            found = [(media, j + 1)]
            nxt = slots[j + 1] if j + 1 < n_slots else None
            if (nxt is not None and nxt[0].get("type") == "attachmentChip"
                    and nxt[1] is sparent and nxt[2] == si + 1):
                original = chip_media(nxt[0].get("attrs") or {}, exact=True)
                if original is not None:          # the chip right after it may be its original
                    found.append((dataclasses.replace(media, original=original), j + 2))
            return found
        if stype == "attachmentChip":
            if pnode.get("type") == "attachmentChip":
                if without(pattrs, "href", "size") != without(sattrs, "href", "size") and not (
                        "name" not in pattrs and without(pattrs, "href", "size")
                        == without(sattrs, "href", "size", "name")):
                    return []
                media = chip_media(sattrs, exact=False)
            else:
                media = chip_media(sattrs, exact=True)   # an image the policy kept as a file
            return [(media, j + 1)] if media is not None else []
        return []

    # Count the alignments from each (placeholder, slot) state, capped at 2, backwards. Each
    # placeholder takes one slot, or two (an image and its original), so slot j for
    # placeholder k lies in [k, k + n_slots - n_ph]: O(placeholders x originals) states.
    span = n_slots - n_ph
    count: dict[tuple[int, int], int] = {}
    opts: dict[tuple[int, int], list] = {}
    for k in range(n_ph, -1, -1):
        for j in range(k, k + span + 1):
            if k == n_ph:
                count[(k, j)] = 1 if j == n_slots else 0
                continue
            opts[(k, j)] = options(k, j)
            count[(k, j)] = min(2, sum(count.get((k + 1, nj), 0) for _m, nj in opts[(k, j)]))
    if count.get((0, 0)) != 1:
        return {}           # no alignment, or two (an original vs the next file): never guess
    out: dict[str, media_policy.StoredMedia] = {}
    j = 0
    for k in range(n_ph):
        media, j = next((m, nj) for m, nj in opts[(k, j)] if count.get((k + 1, nj), 0) == 1)
        if media is None:
            continue
        if refs[k] in out and out[refs[k]] != media:
            return {}       # one ref, two different stored files: not a body we produced
        out[refs[k]] = media
    return out


def _note_title(rn: RemoteNote, key: str) -> str:
    """The title the member sees for the note at `key` (a conflict sibling's included)."""
    return f"{rn.title} (synced copy)" if key.endswith("#remote") else rn.title


def _notice_failures(title: str, body: Any, notices: dict[str, dict]) -> list[dict[str, Any]]:
    """`failures_json` entries for the notices THIS pass placed in `body`: `{noteTitle,
    reason, name}`, `reason` being the sentence the member reads in the note."""
    placed = [a for a in import_notice.iter_notices(body) if a.get("ref") in notices]
    return [{"noteTitle": title or "Untitled note", "reason": import_notice.notice_text(a),
             "name": a.get("name")} for a in placed]


def _provider_notice_failures(title: str, doc: Any) -> list[dict[str, Any]]:
    """`failures_json` entries for the notices the provider's converter wrote into the remote
    doc itself (Plan A Task 12). Those carry no ref (they hold no placeholder), so they never
    overlap `_notice_failures`, which lists only the notices this pass placed by ref."""
    return [{"noteTitle": title or "Untitled note", "reason": import_notice.notice_text(a),
             "name": a.get("name")} for a in import_notice.iter_notices(doc) if not a.get("ref")]


def _strip_media_placeholders(node: Any) -> Any:
    """A copy of `node` with every media placeholder (`image`/`attachmentChip` on an
    `import-ref://`) removed. Pure, and never through `rewrite_body`: it is the last resort
    when even `rewrite_body`'s output cannot be stored."""
    if isinstance(node, list):
        return [c for c in (_strip_media_placeholders(n) for n in node) if c is not None]
    if not isinstance(node, dict):
        return node
    attr = {"image": "src", "attachmentChip": "href"}.get(node.get("type"))
    value = (node.get("attrs") or {}).get(attr) if attr else None
    if isinstance(value, str) and value.startswith(REF_PREFIX):
        return None
    out = dict(node)
    if isinstance(node.get("content"), list):
        out["content"] = _strip_media_placeholders(node["content"])
    return out


def _final_body_without_media(
    rn: RemoteNote, key: str, doc: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, dict], list[dict[str, Any]]]:
    """Plan A Task 8 (Task 6 review d): the body to store when the RESOLVED body fails
    validation, so the note terminates instead of staying pending (which re-fetched every
    item on every pass with no attempt counted). First choice: every placeholder becomes its
    FINAL `unsupported` notice (attempts 0). If that body cannot be stored either, the
    placeholders are removed. Returns `(body, notices, dropped_failures)`: `dropped_failures`
    are the `failures_json` entries for items removed with no notice left in the note, so the
    loss is still named. `(None, {}, [])` when nothing storable can be built (cannot happen
    for a body `import_confirm` accepted; the old leave-in-place behaviour is the fallback).
    `doc` is the body the pass resolved from (`rn.doc`, or a retry's stored body)."""
    doc = rn.doc if doc is None else doc
    names = {m.get("ref"): m.get("name") for m in (rn.media or []) if isinstance(m, dict)}
    by_ref = {m.get("ref"): m for m in (rn.media or []) if isinstance(m, dict)}
    final = {ref: import_notice.notice_node(
        "unsupported", name=names.get(ref),
        source_url=_media_source_url(by_ref[ref]) if ref in by_ref else import_notice.safe_source_url(ref),
        ref=ref, attempts=0) for ref in _placeholder_refs(doc)}
    body, _dropped = rewrite_body(doc, {}, {}, strip_unresolved_links=False, notices=final)
    try:
        notes_svc._validate_body_json(body)
        return body, final, []
    except notes_svc.NoteValidationError:
        pass
    stripped = _strip_media_placeholders(doc)
    try:
        notes_svc._validate_body_json(stripped)
    except notes_svc.NoteValidationError:
        return None, {}, []
    title = _note_title(rn, key) or "Untitled note"
    return stripped, {}, [{"noteTitle": title, "reason": import_notice.notice_text(n["attrs"]),
                           "name": n["attrs"]["name"]} for n in final.values()]


#: At most this many waiting notes come back per pass when storage frees (bounded work).
STORAGE_WAIT_FLIP_LIMIT = 200


def _flip_storage_waits(conn: sqlite3.Connection, user_id: str) -> int:
    """Plan A Task 8 (spec §15 Q2, "they come back once space frees"): this member's notes
    waiting for storage (`import_media_pending = 2`) go back to 1 (retry), so the pass that
    follows re-imports them. Member-scoped, bounded (`STORAGE_WAIT_FLIP_LIMIT`), and
    timestamp-neutral: only `import_media_pending` moves. The caller decides that space has
    freed; this commits and returns how many rows moved."""
    cur = conn.execute(
        "UPDATE j2_notes SET import_media_pending = 1 WHERE id IN ("
        "SELECT id FROM j2_notes WHERE user_id = ? AND import_media_pending = 2 LIMIT ?)",
        (user_id, STORAGE_WAIT_FLIP_LIMIT))
    conn.commit()
    return cur.rowcount


def _storage_has_freed(budget: media_policy.MediaBudget) -> bool:
    """Space a waiting note can use: the member is under the media cap AND the volume has
    headroom (`assert_import_headroom`, the other storage_limit source -- read through
    `notes`, the same reference every save checks)."""
    if not budget.under_cap():
        return False
    try:
        notes_svc.assert_import_headroom(0)
    except NoteQuotaExceeded:
        return False
    return True


def _decide_and_store(
    user_id: str, note_id: str, data: bytes, content_type: str | None, name: str, *,
    file_intent: bool, budget: media_policy.MediaBudget,
) -> media_policy.StoredMedia:
    """One media item through the policy, synchronously -- called via `asyncio.to_thread`.
    An item the provider listed as a file keeps file intent (fix round 1, I5): `normalize_file`,
    never decoded, so an attached image is never refused for its pixels."""
    decide = media_policy.normalize_file if file_intent else media_policy.normalize_media
    return media_policy.store_media(user_id, note_id, decide(data, content_type, name), budget=budget)


async def _upload_media_for_note(
    provider: NoteProvider, creds: dict[str, Any], user_id: str, note_id: str,
    media_entries: list[dict[str, Any]], *, prior_attempts: dict[str, int],
    budget: media_policy.MediaBudget,
) -> tuple[dict[str, media_policy.StoredMedia], dict[str, dict], int, list[str]]:
    """`_upload_media_for_note(provider, creds, user_id, note_id, media_entries, *,
    prior_attempts, budget) -> (resolved, notices, uploaded, failures)`.

    Per-item try/except — one bad media ref is a NAMED failure, never a crash
    of the whole note (or the whole sync).

    Plan A Task 8: every item goes through the ONE media policy --
    `media_policy.normalize_media` (sniff, convert, downscale, classify, refuse) then
    `media_policy.store_media` under `budget`, the member's `MediaBudget` for this whole
    pass (one `MediaBudget.for_member` per `_import_remote_notes` call, never per item).
    `resolved` is `{ref: StoredMedia}` for `rewrite_body(..., resolved=...)`. An item the
    provider listed as a file (`kind != "image"`) keeps chip intent: `normalize_file`, the
    bytes stored as a file, never decoded or re-routed inline. Items past the cap are
    `storage_limit` notices; the note itself still imports. The policy work runs in a
    worker thread (`asyncio.to_thread`), never on the event loop.

    Plan A Task 6 (spec I-7): a ref that cannot be copied gets an importNotice in
    `notices`, which `rewrite_body` puts where the file was -- never a silent drop.
    `prior_attempts` is `{ref: attempts}` from the note's stored notices; a ref that
    has already used `MEDIA_RETRY_MAX_ATTEMPTS` is not fetched again, it keeps its
    final notice."""
    resolved: dict[str, media_policy.StoredMedia] = {}
    notices: dict[str, dict] = {}
    uploaded = 0
    failures: list[str] = []
    for m in media_entries:
        ref = m.get("ref")
        prior = prior_attempts.get(ref, 0) if isinstance(ref, str) else 0
        if prior >= import_notice.MEDIA_RETRY_MAX_ATTEMPTS:
            notices[ref] = import_notice.notice_node(
                "fetch_failed", name=m.get("name"), source_url=_media_source_url(m),
                ref=ref, attempts=prior)
            continue
        try:
            data_uri = m.get("data_uri")
            if data_uri:
                # Plan A Task 9: decoding (base64 or percent) is off the event loop too.
                data, content_type = await asyncio.to_thread(_decode_data_uri, data_uri)
            else:
                data, content_type = await provider.fetch_media(creds, ref)
            name = m.get("name") or ref
            # Fix round 1, I2: the decide+store work (a 25 MB decode/downscale, disk writes)
            # runs OFF the event loop -- a manual "Sync now" runs this on the uvicorn loop.
            # The policy's own decode semaphore bounds it alongside the upload doors.
            resolved[ref] = await asyncio.to_thread(
                _decide_and_store, user_id, note_id, data, content_type, name,
                file_intent=m.get("kind") != "image", budget=budget)
            uploaded += 1
        except Exception as e:  # noqa: BLE001
            failures.append(f"media {ref!r} on note {note_id}: {e}")
            if isinstance(ref, str) and ref:
                notices[ref] = _notice_for_exception(
                    e, ref=ref, name=m.get("name"), source_url=_media_source_url(m),
                    attempts=prior + 1)
    return resolved, notices, uploaded, failures


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
    totals["notStoredRefs"].extend(res.get("notStoredRefs", []))
    totals["noticeFailures"].extend(res.get("noticeFailures", []))
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
    # Plan A Task 4: every key kind (exact import keys, Evernote titles) through the ONE resolver.
    id_by_key = resolve_link_keys(conn, user_id, link_targets)
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
        try:
            applied = _apply_resolved_body(conn, user_id, note_id, body, expected_updated_at=expected)
        except Exception as e:  # noqa: BLE001 -- fix round 1, M1: one note never stops the pass
            result["failures"].append(f"link pass: resolved body write failed for note {note_id!r}: {e}")
            continue
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
    *, notice_attempts: dict[str, dict[str, int]] | None = None,
    budget: media_policy.MediaBudget | None = None,
    retry_bodies: dict[str, str] | None = None,
    reuse_bodies: dict[str, str] | None = None,
) -> dict[str, Any]:
    """`budget` (Plan A Task 8): the member's `MediaBudget` for the whole pass; None reads one
    (a direct caller). `retry_bodies` (fix round 1, I4): `{import_key: stored body}` for a
    note re-imported only to retry its media (remote unchanged); see `_retry_source`.
    `reuse_bodies` (final review I1): `{import_key: stored body}` for a note re-imported
    because OUR conversion changed while its remote revision did not; see `_reusable_media`.
    `notice_attempts` (Plan A Task 6): `{import_key: {ref: attempts}}`, read by
    `_bulk_existing_note_meta` BEFORE this confirm overwrites the bodies; each
    failed ref counts on from its prior attempts. `result["noticeFailures"]` holds
    the `failures_json` entries of every notice this batch wrote.

    Confirms ONE batch, then immediately resolves MEDIA (upload +
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
        "conflicts": 0, "failures": [], "touched": [], "notStoredRefs": [],
        "noticeFailures": [],
    }
    # Every ref THIS batch is attempting, so a whole-call exception below
    # (a batch-level failure, e.g. a malformed overall payload — NOT a
    # per-note one; `import_confirm` isolates those into its own `failed`
    # bucket and returns normally, see below) can still report every one of
    # them as not-stored — the cursor must not advance past ANY of them.
    remote_id_by_key = {key: rn.remote_id for rn, key in pairs}
    if budget is None:
        budget = media_policy.MediaBudget.for_member(user_id)
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
        result["notStoredRefs"].extend(remote_id_by_key.values())
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

    # session-audit.md A1/A2: `import_confirm` isolates a per-note storage
    # failure (oversized/malformed body) into its own `failed` bucket
    # instead of raising for the whole batch. Surface each one as a named
    # failure (the same per-ref idiom `_fetch_remote_notes` already uses
    # for a fetch failure) and record its REMOTE ref so `_do_sync` can
    # refuse to advance the sync cursor past a note that was never stored —
    # a re-sync (with no action needed from the member) picks it back up
    # rather than skipping it as already-seen.
    for item in r.get("failed", []):
        fkey = item.get("importKey")
        result["failures"].append(
            f"note {fkey!r} could not be stored: {item.get('error')}"
        )
        rid = remote_id_by_key.get(fkey)
        if rid is not None:
            result["notStoredRefs"].append(rid)

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
        if status != "skipped":
            # Plan A Task 12 fix round 1: notices the PROVIDER placed (a truncated database, a
            # file with no address) are failures the member reads in the log too -- listed when
            # this pass writes the note, never again while it is skipped unchanged.
            result["noticeFailures"].extend(_provider_notice_failures(_note_title(rn, key), rn.doc))
        if status == "skipped" and not healing:
            continue  # unchanged, no stranded placeholder -> nothing to do

        if not healing and not rn.media and not _placeholder_refs(rn.doc):
            # No media to resolve in THIS pass (Plan A Task 6: and no media
            # placeholder either -- one with no `media` entry still needs its notice). If it has links, the final
            # link pass reads the confirm-written body directly — nothing
            # else has touched it since, so no write happens here at all.
            if rn.links:
                result["touched"].append((rn, key, note_id))
            continue

        # Fix round 1, I4: a media retry builds on the stored body, fetching only what is
        # still missing; anything already resolved is reused, never stored twice.
        source_doc, media = rn.doc, rn.media
        retry = _retry_source((retry_bodies or {}).get(key), rn) if status == "updated" else None
        resolved: dict[str, media_policy.StoredMedia] = {}
        if retry is not None:
            source_doc, retry_refs = retry
            media = [m for m in (rn.media or []) if m.get("ref") in retry_refs]
        elif status == "updated" and key in (reuse_bodies or {}):
            # Final review I1(b): the remote revision is unchanged (only OUR conversion
            # moved), so media the stored body already holds is reused, never re-fetched
            # and stored again against the member's cap.
            resolved = _reusable_media(reuse_bodies[key], rn.doc, user_id, note_id)
            media = [m for m in (rn.media or []) if m.get("ref") not in resolved]

        notices: dict[str, dict] = {}
        if media:
            fetched, notices, up, med_failures = await _upload_media_for_note(
                provider, creds, user_id, note_id, media,
                prior_attempts=(notice_attempts or {}).get(key, {}), budget=budget)
            resolved = {**resolved, **fetched}
            result["mediaUploaded"] += up
            result["failures"].extend(med_failures)
        # Plan A Task 6, no silent drop: a placeholder the provider never listed in
        # `media` cannot be fetched at all, so it is a final notice too.
        for ref in _placeholder_refs(source_doc):
            if ref not in resolved and ref not in notices:
                notices[ref] = import_notice.notice_node(
                    "unsupported", name=None, source_url=import_notice.safe_source_url(ref),
                    ref=ref, attempts=0)

        # MEDIA ONLY in this pass: id_by_key={} + strip_unresolved_links=False
        # means every import-link:// mark passes through completely
        # untouched (not stripped, not resolved) for the final pass to see.
        # `notices`: every placeholder without a URL becomes its importNotice.
        body, _dropped = rewrite_body(
            source_doc, {}, {}, strip_unresolved_links=False, notices=notices, resolved=resolved)

        # Important 6: validate the RESOLVED doc (1MB/shape backstop) before
        # the raw write — a malformed/oversized result must never land in
        # the DB. Plan A Task 8 (Task 6 review d): the placeholder body is NOT
        # left pending -- that re-fetched the media on every pass with no attempt
        # counted, outside the I-7 bound. The note gets each item's FINAL notice
        # instead (or, if even that cannot be stored, loses the placeholders), and
        # every item is a named failure, so it terminates this pass.
        dropped_failures: list[dict[str, Any]] = []
        try:
            notes_svc._validate_body_json(body)
        except notes_svc.NoteValidationError as e:
            result["failures"].append(
                f"resolved body failed validation for note {note_id!r}: {e}"
            )
            body, notices, dropped_failures = _final_body_without_media(rn, key, source_doc)
            if body is None:
                if rn.links:
                    result["touched"].append((rn, key, note_id))  # placeholder still intact
                continue

        expected = baseline_updated_at.get(note_id)
        try:
            applied = _apply_resolved_body(conn, user_id, note_id, body, expected_updated_at=expected)
        except Exception as e:  # noqa: BLE001 -- fix round 1, M1: one note never stops the source
            # Its body write was rolled back with its projection, so the confirm-written
            # placeholder body stays and self-heal retries it on a later sync. Same
            # shape as the validation failure above.
            result["failures"].append(f"resolved body write failed for note {note_id!r}: {e}")
            if rn.links:
                result["touched"].append((rn, key, note_id))  # placeholder still intact
            continue
        if applied:
            result["noticeFailures"].extend(_notice_failures(_note_title(rn, key), body, notices))
            result["noticeFailures"].extend(dropped_failures)
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
            if sibling_id:
                result["noticeFailures"].extend(_notice_failures(
                    _note_title(rn, f"{key}#remote"), body, notices))
                result["noticeFailures"].extend(
                    dict(f, noteTitle=_note_title(rn, f"{key}#remote")) for f in dropped_failures)
            if sibling_id and rn.links:
                result["touched"].append((rn, f"{key}#remote", sibling_id))

    return result


async def _import_remote_notes(
    user_id: str, source: dict[str, Any], provider: NoteProvider, creds: dict[str, Any],
    remote_notes: list[RemoteNote],
) -> dict[str, Any]:
    conn = get_connection()
    try:
        # Plan A Task 8: ONE media budget for this whole pass (one memoised usage read), and
        # the storage wait: once space has freed, this member's notes waiting at
        # `import_media_pending = 2` go back to 1 BEFORE the existing-meta read, so the
        # confirm below re-imports them like any other retry.
        budget = media_policy.MediaBudget.for_member(user_id)
        if _storage_has_freed(budget):
            try:
                _flip_storage_waits(conn, user_id)
            except sqlite3.Error as e:   # a busy DB defers the wait one pass; never fails the sync
                log.warning("[note-sync] storage-wait flip deferred (%s)", type(e).__name__)
        import_keys = [
            provider.import_key(source["remoteId"], rn.remote_id) for rn in remote_notes
        ]
        existing = _bulk_existing_note_meta(conn, user_id, import_keys)
        if _backfill_remote_revs_preserving_updated_at(
                conn, user_id, remote_notes, import_keys, existing):
            conn.commit()

        normal_items: list[tuple[dict[str, Any], RemoteNote, str]] = []
        # (confirm_entry, remote_note, sibling_key, original_folder_id)
        sibling_items: list[tuple[dict[str, Any], RemoteNote, str, str | None]] = []
        conflict_tag_updates: dict[str, list[str]] = {}  # original note id -> new tags
        pre_confirm_conflicts = 0
        user_owned_unchanged = 0
        retry_bodies: dict[str, str] = {}
        reuse_ids: dict[str, str] = {}   # import_key -> note id (final review I1)

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
            # Plan A Task 1: the hash alone also moves when OUR converter
            # changes, so `_remote_changed` keys the answer on the remote's
            # own revision (see its docstring, incl. the minute-precision
            # limitation accepted for Notion). Consequence: a remote move/
            # rename that does NOT advance the remote revision (folderPath and
            # title sit in the hash) is now SKIPPED on an edited note, not copied.
            is_genuine_conflict = (
                meta is not None and _is_conflict(meta)
                and _remote_changed(meta, rn, notes_svc._import_payload_hash(entry))
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
                    conn, user_id, meta["id"], notes_svc._import_payload_hash(entry),
                    remote_rev=rn.updated_at or None)
            elif meta is not None and _is_conflict(meta):
                # Edited by the member, remote UNCHANGED -> the note is the
                # member's; nothing to write. It must NOT go to import_confirm:
                # that call re-writes a note whose `import_media_pending` is
                # still set even when the hash matches (audit B5, the media
                # retry), and a note with a link that can never resolve stays
                # pending forever -- so the member's edit was overwritten on
                # every later sync, with no conflict and no copy kept.
                user_owned_unchanged += 1
            else:
                # Either no genuine conflict, or a conflict whose remote side
                # is UNCHANGED -> plain pass-through. `import_confirm`'s own
                # hash check on `entry` no-ops it (skipped) when nothing
                # changed -- no tally, no sibling confirm, no resurrection of
                # a sibling the user deleted.
                normal_items.append((entry, rn, key))
                entry_hash = notes_svc._import_payload_hash(entry)
                # Fix round 1 (I4): remote unchanged and media still pending -> this pass
                # is a media RETRY; it builds on the stored body (`_retry_source`).
                if (meta is not None and meta.get("pendingBody")
                        and meta.get("importHash") == entry_hash):
                    retry_bodies[key] = meta["pendingBody"]
                # Final review I1(b): our conversion changed but the REMOTE revision did not
                # (the same `_remote_changed` answer the conflict gate uses) -> this note's
                # stored media is reused by the re-import; its body is read below, before
                # confirm overwrites it.
                elif (meta is not None and (rn.media or _placeholder_refs(rn.doc))
                        and meta.get("importHash") != entry_hash
                        and not _remote_changed(meta, rn, entry_hash)):
                    reuse_ids[key] = meta["id"]

        stored_bodies = _bulk_note_body_json(conn, list(reuse_ids.values()))
        reuse_bodies = {key: stored_bodies[nid] for key, nid in reuse_ids.items()
                        if stored_bodies.get(nid)}

        totals: dict[str, Any] = {
            "created": 0, "updated": 0, "skipped": user_owned_unchanged, "mediaUploaded": 0,
            "conflicts": pre_confirm_conflicts, "failures": [], "notStoredRefs": [],
            "noticeFailures": [],
        }
        # Plan A Task 6: prior notice attempts per key, read before any confirm below.
        notice_attempts = {k: m["noticeAttempts"] for k, m in existing.items() if m["noticeAttempts"]}
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
                source.get("destFolderId"), entries, pairs, notice_attempts=notice_attempts,
                budget=budget, retry_bodies=retry_bodies, reuse_bodies=reuse_bodies,
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
                original_folder_id, [entry], [(rn, sibling_key)], notice_attempts=notice_attempts,
                budget=budget,
            )
            _merge_batch_result(totals, res, all_touched)

        # Tag the ORIGINAL note in a pre-confirm conflict — add-tag only,
        # body/title untouched. Both the original and its sibling now carry
        # 'sync-conflict'; neither version was lost. Timestamp-neutral (Task 15 D1): the
        # original is member-edited, and a tag the ENGINE adds must not move its edit time.
        for note_id, tags in conflict_tag_updates.items():
            _write_tags_preserving_updated_at(conn, user_id, note_id, tags)
        if conflict_tag_updates:
            conn.commit()

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

        # Plan A Task 4: heal the member's still-pending links -- a link written in an
        # EARLIER round whose target has only now arrived. Bounded (`limit`, index-served
        # on `import_links_pending`), timestamp-neutral, and never fails the sync: a
        # failure here is one named failure, and the marks stay for the next round.
        try:
            heal = heal_pending_links(user_id, conn=conn)
            totals["failures"].extend(heal.get("failures", []))
        except Exception as e:  # noqa: BLE001
            totals["failures"].append(f"link heal pass failed: {e}")

        return totals
    finally:
        conn.close()
