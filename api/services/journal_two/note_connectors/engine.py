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
import bisect
import copy
import dataclasses
import hashlib
import itertools
import json
import logging
import math
import os
import random
import sqlite3
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import import_notice, import_provenance, media_policy
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.import_provenance import edited_since_import
from api.services.journal_two.notes_quota import NoteQuotaExceeded
from api.services.journal_two.note_connectors import connections, errors, oauth
from api.services.journal_two.note_connectors import adoption, dest_folder
from api.services.journal_two.note_connectors.link_keys import heal_pending_links, resolve_link_keys
from api.services.journal_two.note_connectors.convert import REF_PREFIX, mddoc, rewrite_body
from api.services.journal_two.note_connectors.convert.rewrite import chips_to_images
from api.services.journal_two.note_connectors.convert.linkify import (
    finalize_links, import_link_keys,
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

# The <50% enumeration guard in `_run_delete_detection` applies only when the source tracks at
# least this many notes (live Obsidian probe 2026-11-03, L1). In a 2- or 3-note vault one rename
# plus one delete is already "fewer than half came back", so the guard refused every removal
# check and the ghost notes stayed live forever. Why 10: below it, half a source is at most four
# notes, a count a member can see and fix at a glance, and the guard's job (catching a listing
# that silently came back short) is still done by the 2-strike rule with its
# MEMBER_FULL_PASS_MIN_INTERVAL_S gap: a bad listing must repeat on two passes at least ten
# minutes apart before anything is tagged. And a sever is NON-DESTRUCTIVE: it adds the
# `source-deleted` tag and stops tracking, never erases the note, and the tag comes off by itself
# when the item is listed again (`_untag_note_source_reappeared`). From 10 up the ratio guard is
# unchanged, so a 20-note source returning 3 is still refused. Fix round 1 ruling: ONLY for a
# provider whose listing is authoritative (`NoteProvider.enumeration_is_authoritative`, today
# Obsidian's manifest); an API listing can come back short, so every other provider keeps the
# guard at any size.
DELETE_GUARD_MIN_KNOWN = 10

# A stored `last_full_sync_at` up to this far in the future is clock skew and
# still counts; further ahead it is treated as "no previous full pass", so a
# bad stamp can never lock a member out of the removal check.
_LAST_FULL_FUTURE_SKEW_S = 60

# Roam's own pull-many batches 40 eids/call; other providers just inherit
# fetch_many's default per-ref loop, so this bound mainly controls failure
# isolation granularity (how many notes one bad batch can knock out before
# the per-ref fallback kicks in), not provider-specific behavior.
_FETCH_BATCH_SIZE = 40

#: Plan E Task 5 review I3: a pass fetches, finalizes and IMPORTS this many refs at a time, so at
#: most one chunk of converted notes is held at once (a 5000-note first sync held all 5000). A
#: multiple of `_FETCH_BATCH_SIZE`, so each provider's `fetch_many` batches are unchanged.
IMPORT_CHUNK_NOTES = _FETCH_BATCH_SIZE * 5
#: Plan E Task 9 fix round 1 (I2): at most this many unlisted notes are fetched per full pass to
#: retry their pending media (`_pending_media_refs`), stalest import first, so a large backlog is
#: worked through over several nights instead of one burst against the provider's rate limit.
MEDIA_RETRY_NOTES_PER_PASS = 25

# Quick follow-up passes (live gate 2026-11-03). Evernote's per-minute tool limit cut the owner's
# first import at 75 of 215 notes, and the rest then waited for the hourly :23 tick. A provider that
# declares `follow_up_on_rate_limit` (Evernote) and ends a pass with listed notes left unread by
# `NoteConnRateLimited` gets its source stamped (`warming_until`) for ONE follow-up pass
# retry_after + FOLLOW_UP_MARGIN_S from now, clamped to [FOLLOW_UP_MIN_DELAY_S,
# FOLLOW_UP_MAX_DELAY_S]. The `note_sync_follow_up` APScheduler job (`sync_follow_up_sources`) runs
# due stamps through `sync_source`, so the in-flight lock still means one pass at a time per source.
# Repeats until the backlog is empty, at most FOLLOW_UP_MAX_PASSES_PER_HOUR passes per source per
# hour (counted from the sync log, every kind of pass included); past that the hourly tick takes it.
FOLLOW_UP_MIN_DELAY_S = 120
# Fix round 1 (I7): the ceiling is an hour, reached only when the server itself asks for a wait
# that long (a client never sleeps through a wait over its own cap; it hands it up instead).
FOLLOW_UP_MAX_DELAY_S = 3600
FOLLOW_UP_MARGIN_S = 30
FOLLOW_UP_MAX_PASSES_PER_HOUR = 12
# Fix round 1 (I9): the follow-up job LEASES a due stamp for this long instead of clearing it. The
# pass it starts replaces or clears it; a pass that crashed (or a pod that died) fires again once
# the lease runs out, still inside the hourly bound.
FOLLOW_UP_LEASE_S = 1800
# Fix round 1 (N-B): while its passes run, the follow-up job also re-claims on this timer.
FOLLOW_UP_CLAIM_WAKE_S = 30.0
# Fix round 1 (D2): the most note fetches one pass makes for a provider that opts in to follow-ups.
# 300 at Evernote's observed ~60-80 calls a minute, paced to 80% of that, is ~4-6 minutes of
# get_note (a note's attachments come on top), inside the client's 10-minute wall clock
# (`evernote_mcp.SESSION_BUDGET_S`), so one member's pass never holds the serial scheduler long.
# The notes not reached are leftovers: the follow-up comes for them, and with D1 a later pass
# never fetches a stored, unchanged note again, so the import still converges.
FETCH_CAP_PER_PASS = 300
# Fix round 1 (I10): an import that keeps reading "importing" with no new note stored for this
# many passes in a row, or with none stored in a pass more than IMPORT_STALL_AFTER_S after its
# first importing pass, is shown as stalled (amber) with an honest sentence; it keeps retrying.
IMPORT_STALL_PASSES = 3
IMPORT_STALL_AFTER_S = 86400
# Fix round 1 (D3): a pacing interval a pass learned from a rate limit seeds the next pass,
# halving every PACE_HALF_LIFE_S, and is forgotten after PACE_MEMORY_S.
PACE_MEMORY_S = 86400
PACE_HALF_LIFE_S = 21600
# Fix round 2 (N3): a pass that leaves leftovers but stores nothing new books its follow-up no
# sooner than FOLLOW_UP_BACKOFF_BASE_S x 2^(zero passes - 1), up to FOLLOW_UP_MAX_DELAY_S: 2, 4, 8,
# 16, 32, 60 minutes. Chosen over "leave it to the hourly tick" because an outage that ends after a
# few minutes is picked up in minutes rather than up to an hour later, while a source that stays
# stuck costs at most a pass an hour within six passes, the same as the tick. A pass that makes
# progress resets it (the quick follow-up comes back). The same holds for a listing that keeps
# being rate limited (it counts as a zero pass).
FOLLOW_UP_BACKOFF_BASE_S = 120
# N5: a source whose follow-up pass raised (anything but a rate limit) this many times in a row
# loses its stamp; the hourly tick carries on with it.
FOLLOW_UP_MAX_ERRORS = 3
# D4: at most this many passes of an opt-in provider (Evernote) run at once in this process:
# first syncs, Sync now, follow-ups and the scheduler ticks alike, each still under its source's
# in-flight lock. Bounded because whether Evernote's limit is per user or per app is unknown:
# measured in simulation, 50 first passes started at once against a shared per-app limit thrashed
# it and learned a 10 s pace each (D3 then carried it), taking 5.5 h for what three at a time do
# in about an hour. `evernote_mcp`'s process-level trip guard holds new sessions back on top when
# trips across sessions spike.
#
# Who gets a slot (final hardening, before Evernote opens to every member):
#   * WAITING (`_acquire_pass_slot`) is an ordered queue: priority first (SLOT_MEMBER, a member's
#     Sync now; then SLOT_FIRST_SYNC, a source's first sync after connecting; then SLOT_BACKGROUND,
#     a follow-up), then arrival. A Sync now outranks first syncs too: measured in simulation, with
#     the two sharing one level a Sync now pressed while 50 members were connecting waited behind
#     every one of their first passes (over two hours); a level of its own, it waits for one slot
#     to free (one pass, minutes). Only
#     the head of the queue may take a free slot, so a member never waits behind follow-ups and
#     no waiter is starved by the polling order. Chosen over reserving a slot for members: a
#     reserved slot idles whenever no member is pressing (a third of the pool, most of the day),
#     while the queue keeps all three busy and still puts a member next.
#   * The SERIAL loops (the hourly tick, the nightly pass) never wait (`_try_acquire_pass_slot`):
#     a free slot only when nobody is queued, else the pass is skipped (hourly) or booked as a
#     follow-up full pass (nightly). See `sync_due_sources` / `sync_all_active_sources_full`.
#   * The follow-up job claims only as many sources as there are free slots
#     (`_pass_slot_room`), so its passes never queue at all.
# A waiter's source reads "queued" on /status (`is_source_queued`) and has no log row yet: the
# pass opens its log row only once it holds a slot.
# ⚠️ SINGLE-PROCESS state (a threading lock, a counter and the waiter list, loop-agnostic like
# `_try_acquire_source`, because the scheduler's jobs run on their own event loops): a second web
# process has its own slots.
FOLLOW_UP_CONCURRENCY = 3
PASS_SLOT_POLL_S = 1.0
SLOT_MEMBER = 0
SLOT_FIRST_SYNC = 1
SLOT_BACKGROUND = 2
# Fix round 1 (concern 1): one MORE slot, reserved for a member's press (SLOT_MEMBER). The three
# background slots are unchanged; a press takes the reserved slot when it is free (else a free
# pool slot), so a Sync now pressed during a storm runs at once instead of waiting for a pass to
# end. Only a press uses it: a first sync and every background pass never do. So at most
# FOLLOW_UP_CONCURRENCY + MEMBER_RESERVED_SLOTS Evernote passes run at once.
MEMBER_RESERVED_SLOTS = 1
# Fix round 2: a press that runs in the RESERVED slot while the member's own first import is
# still catching up (cursor None) fetches at most this many notes, so a press during an import
# stays a quick look and never becomes a private ten-minute lane beside the pool.
MEMBER_SLOT_FIRST_IMPORT_CAP = 100
# Fix round 1 (N-D): a background waiter that has waited this long is promoted to first-sync
# priority, so a steady arrival of first syncs can never starve it.
SLOT_AGING_S = 900.0
_PASS_SLOTS_LOCK = threading.Lock()
_pass_slots_used = 0       # pool slots held (background, first syncs, a press when it spills)
_member_slots_used = 0     # the reserved member slot(s) held
#: Waiting tickets `(priority, arrival, source_id)`, kept sorted; the head may take a free slot.
_slot_waiters: list[tuple[int, int, str]] = []
_slot_arrivals = itertools.count()
SLOT_POOL = "pool"
SLOT_RESERVED = "member"


def _slot_clock() -> float:
    """The waiter queue's clock (aging). Tests replace it."""
    return time.monotonic()


async def _acquire_pass_slot(source_id: str, *, priority: int = SLOT_BACKGROUND) -> str:
    """D4: wait, in priority-then-arrival order, for a pass slot; returns which kind it took
    (SLOT_POOL or SLOT_RESERVED, for `_release_pass_slot`). Polls (never blocks the event loop).
    A waiter cancelled while it waits leaves the queue and holds nothing: the slot is only ever
    taken in the same locked step that returns. N-D: a SLOT_BACKGROUND ticket that waited
    SLOT_AGING_S moves to SLOT_FIRST_SYNC, keeping its arrival order."""
    global _pass_slots_used, _member_slots_used
    ticket = (priority, next(_slot_arrivals), source_id)
    since = _slot_clock()
    with _PASS_SLOTS_LOCK:
        bisect.insort(_slot_waiters, ticket)
    granted = False
    try:
        while True:
            with _PASS_SLOTS_LOCK:
                if (ticket[0] == SLOT_BACKGROUND
                        and _slot_clock() - since >= SLOT_AGING_S and ticket in _slot_waiters):
                    _slot_waiters.remove(ticket)
                    ticket = (SLOT_FIRST_SYNC, ticket[1], ticket[2])
                    bisect.insort(_slot_waiters, ticket)
                if _slot_waiters[0] == ticket:
                    kind = None
                    # Fix round 2: a press takes a free POOL slot first and the reserved slot only
                    # when the pool is full, so the reserve stays free for the next press.
                    if _pass_slots_used < FOLLOW_UP_CONCURRENCY:
                        _pass_slots_used += 1
                        kind = SLOT_POOL
                    elif ticket[0] == SLOT_MEMBER and _member_slots_used < MEMBER_RESERVED_SLOTS:
                        _member_slots_used += 1
                        kind = SLOT_RESERVED
                    if kind is not None:
                        _slot_waiters.pop(0)
                        granted = True
                        return kind
            await asyncio.sleep(PASS_SLOT_POLL_S)
    finally:
        if not granted:
            with _PASS_SLOTS_LOCK:
                if ticket in _slot_waiters:
                    _slot_waiters.remove(ticket)


def _try_acquire_pass_slot() -> bool:
    """D4-3: take a POOL slot only if one is free AND nobody is waiting (a serial loop never
    jumps the queue, never waits, and never takes the member slot)."""
    global _pass_slots_used
    with _PASS_SLOTS_LOCK:
        if _pass_slots_used < FOLLOW_UP_CONCURRENCY and not _slot_waiters:
            _pass_slots_used += 1
            return True
        return False


def _release_pass_slot(kind: str = SLOT_POOL) -> None:
    global _pass_slots_used, _member_slots_used
    with _PASS_SLOTS_LOCK:
        if kind == SLOT_RESERVED:
            _member_slots_used = max(0, _member_slots_used - 1)
        else:
            _pass_slots_used = max(0, _pass_slots_used - 1)


def _pass_slots_in_use() -> int:
    """Slots held, the member slot included."""
    with _PASS_SLOTS_LOCK:
        return _pass_slots_used + _member_slots_used


def _pass_slot_room() -> int:
    """D4-1: pool slots no pass holds and no waiter is already lined up for."""
    with _PASS_SLOTS_LOCK:
        return max(0, FOLLOW_UP_CONCURRENCY - _pass_slots_used - len(_slot_waiters))


def is_source_queued(source_id: str) -> bool:
    """True while a pass of this source waits for a pass slot (/status reads "queued")."""
    with _PASS_SLOTS_LOCK:
        return any(t[2] == source_id for t in _slot_waiters)


# NEW-4: three pool passes importing at once each opened a write transaction on auth.db (busy
# timeout 3 s, `auth_db.get_connection`): a collision raised "database is locked", which re-runs
# the WHOLE pass, and a member's own save queued behind several of them could miss its 3 s. The
# write transactions of opt-in (pooled) passes therefore run one at a time under this lock, in a
# worker thread (never on an event loop: a thread waiting on it would freeze the uvicorn loop),
# and the lock never spans a network call: media downloads, link heals and the listing all run
# outside it. Two sections take it: a pass's pre-confirm writes (`_prepare_import_locked`, N-A)
# and each confirm batch (`_import_confirm_serialized`). ⚠️ SINGLE-PROCESS state.
_IMPORT_WRITE_LOCK = threading.Lock()
# Fix round 1 (concern 3): measured, chained importers starved a member's save: SQLite's busy
# handler sleeps and retries, and the next importer, waiting on this lock, took the write lock
# the instant the previous one committed, so the save kept losing the race. A pooled pass
# therefore confirms in batches of POOLED_CONFIRM_BATCH_SIZE (a shorter write each) and HOLDS
# this lock for IMPORT_WRITE_GAP_S after each commit: no importer can start in the gap, so the
# save lands in it. Tuned with a benchmark (3 importers x 5 x 200 notes on a temp auth.db plus a
# save every 20 ms, 3 rounds; second sweep): member save p99 / import wall time
#    gap   0 ms: 3356 ms / 16.9 s (a save timed out once)    gap  75 ms:  330 ms / 21.9 s
#    gap  25 ms: 1849 ms / 19.3 s                              gap 100 ms:  329 ms / 23.8 s
#    gap  50 ms: 1312 ms / 20.4 s                              gap 120 ms:  328 ms / 25.0 s
# 75 ms is the knee: the first gap under ~500 ms, at the least wall time. (25-50 ms, the range
# first proposed, still left a save waiting over a second.) The wall-time cost is invisible in
# practice: a pooled pass fetches at Evernote's ~60-80 calls a minute, so its six 50-note
# confirms are a few seconds of a ten-minute pass.
POOLED_CONFIRM_BATCH_SIZE = 50
IMPORT_WRITE_GAP_S = 0.075


class ImportLockOrderError(RuntimeError):
    """N-A: a connection asked for `_IMPORT_WRITE_LOCK` while it held an open write transaction.
    Waiting there holds SQLite's write lock against the lock's holder (a lock-order inversion
    that cost a whole batch); refused instead."""


def _refuse_open_transaction(conn: sqlite3.Connection) -> None:
    if conn.in_transaction:
        log.error("[note-sync] refused: an open write transaction asked for the import write "
                  "lock (a lock-order inversion; the batch is not stored this pass)")
        raise ImportLockOrderError(
            "an open write transaction may not wait on the import write lock")


def _write_gap() -> None:
    if IMPORT_WRITE_GAP_S > 0:
        time.sleep(IMPORT_WRITE_GAP_S)


def _import_confirm_serialized(user_id: str, payload: dict[str, Any],
                               conn: sqlite3.Connection) -> dict[str, Any]:
    _refuse_open_transaction(conn)
    with _IMPORT_WRITE_LOCK:
        try:
            return notes_svc.import_confirm(user_id, payload, conn=conn)
        finally:
            _write_gap()  # still holding the lock: the next importer waits, a member's save lands


def _pooled_provider(provider_name: str) -> bool:
    """D4-3: does this provider's pass use the pass slots (`follow_up_on_rate_limit`, read from
    the provider CLASS through the registry, the same authority the pass reads on its instance)?
    The serial loops run such a source's pass beside the loop instead of inside it."""
    from . import registry  # lazy, as `_default_provider_factory` imports it
    return registry.runs_sync_in_background(provider_name)

def _skip_archived_provider(source: dict[str, Any]) -> bool:
    """True (and one log line) for a source of an ARCHIVED provider (`registry.ARCHIVED_PROVIDERS`:
    Dropbox, OneNote, OneDrive, removed 2026-11-04). The scheduler loops skip it WITHOUT touching
    the row (no error stamped, no log row, never deleted): nothing can build its provider, so a
    pass could only fail the same way every tick. Only archived names are skipped quietly: any
    OTHER name the registry does not know keeps its old path (the pass fails, the row reads "error",
    the loop logs it and moves on)."""
    from . import registry  # lazy, as `_default_provider_factory` imports it
    provider_name = source.get("provider") or ""
    if provider_name not in registry.ARCHIVED_PROVIDERS:
        return False
    log.warning("[note-sync] source %s skipped: provider %r was archived", source.get("id"), provider_name)
    return True


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
        result = await _do_sync(user_id, source_id, full=False, member=True)
        result["removalCheck"] = _removal_check_summary(
            user_id, source_id, ran=False, reason="rate_limited", severed=0,
        )
        return result
    return await _do_sync(user_id, source_id, full=False, removal_check=True, member=True)


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
    info beyond just the connector's credentials can be constructed
    correctly: Obsidian reads `userId`/`remoteId` (its vault), Evernote reads
    `userId`. (Dropbox's folder, on `remoteId`, was the first such use; it
    was archived 2026-11-04.) Roam/Craft/Notion ignore it entirely (their
    credentials dict alone already identifies the one graph/space/workspace
    they sync).

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
# #3 (source-level threading, first for Dropbox, archived 2026-11-04), so a test fake must accept a second
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

def _drain_provider_item_failures(
    provider: Any, item_failures: list[str], notice_failures: list[dict[str, Any]],
) -> None:
    """Plan E Task 8 (Plan D's design): a provider that records per-note problems itself
    (`drain_item_failures`, `{noteTitle, reason, name}` entries) hands them over here; each reaches
    `failures_json` and its reason the result's `failures` and the log row's `error`. Providers
    without the method are untouched."""
    drain = getattr(provider, "drain_item_failures", None)
    if drain is None:
        return
    for entry in drain() or []:
        notice_failures.append(entry)
        item_failures.append(entry.get("reason") or "")


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
                   failures_json = ?, adopted = ?
             WHERE id = ?
            """,
            (
                _now_iso(), status, error,
                int(counts.get("created", 0)), int(counts.get("updated", 0)),
                int(counts.get("skipped", 0)), int(counts.get("mediaUploaded", 0)),
                int(counts.get("conflicts", 0)), int(source_deleted or 0),
                blob, int(counts.get("adopted", 0)), log_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()


# ── Public entry points ──────────────────────────────────────────────────────

async def sync_source(
    source_id: str, *, full: bool = False, manual: bool = False,
    member: bool = False, slot_wait: bool = True,
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
    `removalCheck` block. Only that combination carries it.

    D4: a pass of an opt-in provider (Evernote) runs only while it holds one of the process-wide
    pass slots. `slot_wait=False` (the serial scheduler loops) never waits for one: with none
    free the pass does nothing and returns `{"status": "no_slot"}`. A member's pass (`member`)
    and a source's first sync wait at the front of the queue."""
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
            return await _do_sync(source["userId"], source_id, full=full, member=member,
                                  slot_wait=slot_wait)
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower() or attempt == attempts - 1:
                raise
            await asyncio.sleep(_LOCKED_RETRY_DELAYS[attempt] * random.uniform(0.5, 1.5))
        finally:
            _release_source(source_id)
    raise RuntimeError("unreachable")  # loop always returns or raises


def _same_revision(a: Any, b: Any) -> bool:
    """Fix round 1 (D1): do two revision stamps name the same instant? Both normalised through
    `import_provenance.instant` and compared at WHOLE SECONDS. Assumption, written down because
    it could not be confirmed against the live server: Evernote's `get_note.updated` (what
    `import_remote_rev` stores) and `search_notes` hits' `updatedAt` (the listing) are the same
    note field, but the probe recorded no format for the first and the corpus mock serves it as
    epoch milliseconds and the second as an ISO string at whole seconds. Comparing at whole
    seconds makes those agree; the cost is that an edit landing in the SAME second as the stored
    revision reads as unchanged until the next edit (the same accepted limitation as Notion's
    minute-precision revisions in `_remote_changed`). Anything unreadable is never "the same"."""
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    da, db_ = import_provenance.instant(a), import_provenance.instant(b)
    if da is None or db_ is None:
        return False
    return da.replace(microsecond=0) == db_.replace(microsecond=0)


#: NEW-2b: the most notes one nightly full pass fetches because their complete-listing revision
#: differs from the stored one (the incremental listing missed the edit). A full pass of a
#: provider that opts in also stays under FETCH_CAP_PER_PASS; the rest carry over a night.
NIGHTLY_REVISION_SWEEP_MAX = 300


def _revision_sweep_refs(
    user_id: str, source: dict[str, Any], provider: NoteProvider, index_refs: list[RemoteRef],
    skip_ids: set[str],
) -> list[RemoteRef]:
    """NEW-2b: refs of the complete listing (`index_refs`) whose listing revision is known and is
    NOT the stored live note's `import_remote_rev` (`_same_revision`, D1's normalisation), oldest
    `imported_at` first, at most NIGHTLY_REVISION_SWEEP_MAX. Refs already being fetched
    (`skip_ids`) and refs with no live row (the delta brings those) are left out. Worker thread."""
    listing_revision = getattr(provider, "listing_revision", None)
    if listing_revision is None:
        return []
    by_key: dict[str, tuple[RemoteRef, str]] = {}
    for r in index_refs:
        if r.remote_id in skip_ids:
            continue
        rev = listing_revision(r)
        if rev:
            by_key[provider.import_key(source["remoteId"], r.remote_id)] = (r, rev)
    if not by_key:
        return []
    keys = list(by_key)
    stale: list[tuple[str, RemoteRef]] = []
    conn = get_connection()
    try:
        for i in range(0, len(keys), 500):  # sqlite variable-limit safety
            chunk = keys[i:i + 500]
            for row in conn.execute(
                    f"SELECT import_key, import_remote_rev, imported_at FROM j2_notes "
                    f"WHERE user_id = ? AND deleted_at IS NULL "
                    f"AND import_key IN ({','.join('?' * len(chunk))})", (user_id, *chunk)):
                ref, rev = by_key[row["import_key"]]
                if not _same_revision(row["import_remote_rev"], rev):
                    stale.append((row["imported_at"] or "", ref))
    finally:
        conn.close()
    stale.sort(key=lambda t: t[0])
    return [ref for _at, ref in stale[:NIGHTLY_REVISION_SWEEP_MAX]]


def _stamp_listed_revisions(user_id: str, source: dict[str, Any], provider: NoteProvider,
                            refs: list[RemoteRef]) -> None:
    """NEW-2b: write each ref's listing revision onto its live note (worker thread)."""
    listing_revision = getattr(provider, "listing_revision", None)
    if listing_revision is None or not refs:
        return
    conn = get_connection()
    try:
        for r in refs:
            rev = listing_revision(r)
            listed_at = import_provenance.instant(rev) if isinstance(rev, str) else None
            if listed_at is None:
                continue
            key = provider.import_key(source["remoteId"], r.remote_id)
            row = conn.execute("SELECT import_remote_rev FROM j2_notes WHERE user_id = ? "
                               "AND import_key = ? AND deleted_at IS NULL", (user_id, key)).fetchone()
            if row is None:
                continue
            # NEW-B (final review): never backwards. `import_confirm` may just have stored a NEWER
            # revision from `get_note` than a lagging index lists; stamping the listing's over it
            # would later read as a remote change and make a phantom "(synced copy)" sibling. Only
            # a NULL stored revision or one OLDER than the listing's (as instants, D1's
            # normalisation at whole seconds) is stamped. An UNREADABLE stored revision cannot be
            # ordered, so it cannot be shown to move backwards, and it never `_same_revision`s the
            # listing: left as it is, the sweep would refetch that note every night forever (the
            # NEW-2b convergence rail). It is stamped, as before.
            stored = row["import_remote_rev"]
            stored_at = import_provenance.instant(stored) if isinstance(stored, str) else None
            if stored_at is not None and (stored_at.replace(microsecond=0)
                                          >= listed_at.replace(microsecond=0)):
                continue
            conn.execute("UPDATE j2_notes SET import_remote_rev = ? WHERE user_id = ? "
                         "AND import_key = ? AND deleted_at IS NULL", (rev, user_id, key))
        conn.commit()
    finally:
        conn.close()


def _classify_listed(
    user_id: str, source: dict[str, Any], provider: NoteProvider, refs: list[RemoteRef],
    want_rows: bool = False,
) -> tuple[set[str], set[str], set[str]]:
    """Fix round 1 (D1) and round 2 (N1): `(unchanged, has_row)` for the listed refs.

    `unchanged`: refs that need no fetch: the provider names a real listing revision
    (`listing_revision`; None, the base default, skips nothing), and the member's stored,
    untrashed note under the provider's live import key carries that same revision and waits on
    no media (`import_media_pending` 0). `has_row`: refs that have such a stored note at all (the
    fetch order puts the rest first). Read from `j2_notes`, NEVER from `j2_note_remote_index`
    (C2). A note adoption could still claim has no row under the live key, so it is never
    skipped. `want_rows` asks for `has_row` even when no ref has a revision. Worker thread: one
    bulk read per 500 keys.

    `trashed` (NEW-7): refs with NO live row whose trashed row (the member trashed the note in
    UCT) carries the listing's own revision. `import_confirm` treats a trashed row as absent (Wave
    0 trash: its key never matches, so a confirm CREATES a fresh note), so fetching such a ref
    would bring back a note the member threw away as soon as an interrupted import listed it
    again. It is not fetched and counts as stored. A remote edit after the trash changes the
    revision, and the ref is fetched and imported exactly as before (a fresh note)."""
    listing_revision = getattr(provider, "listing_revision", None)
    revs: dict[str, str] = {}
    if listing_revision is not None:
        for r in refs:
            rev = listing_revision(r)
            if rev:
                revs[r.remote_id] = rev
    if not revs and not want_rows:
        return set(), set(), set()
    by_key = {provider.import_key(source["remoteId"], r.remote_id): r.remote_id for r in refs}
    unchanged: set[str] = set()
    has_row: set[str] = set()
    trashed_same: set[str] = set()
    keys = list(by_key)
    conn = get_connection()
    try:
        for i in range(0, len(keys), 500):  # sqlite variable-limit safety
            chunk = keys[i:i + 500]
            rows = conn.execute(
                f"SELECT import_key, import_remote_rev, import_media_pending, deleted_at "
                f"FROM j2_notes WHERE user_id = ? "
                f"AND import_key IN ({','.join('?' * len(chunk))})",
                (user_id, *chunk)).fetchall()
            for row in rows:
                rid = by_key[row["import_key"]]
                rev = revs.get(rid)
                if row["deleted_at"] is not None:
                    if rev and _same_revision(row["import_remote_rev"], rev):
                        trashed_same.add(rid)
                    continue
                has_row.add(rid)
                if rev and (row["import_media_pending"] or 0) == import_notice.MEDIA_PENDING_NONE \
                        and _same_revision(row["import_remote_rev"], rev):
                    unchanged.add(rid)
    finally:
        conn.close()
    return unchanged, has_row, trashed_same - has_row


def _load_sync_state(source: dict[str, Any]) -> dict[str, Any]:
    """The source's small JSON state (`j2_note_sources.sync_state`): `pace` (D3) and `importing`
    (I10). Anything unreadable is an empty state, never an error."""
    raw = source.get("syncState")
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _save_sync_state(user_id: str, source_id: str, source: dict[str, Any],
                     state: dict[str, Any]) -> None:
    """NEW-5: write what THIS pass changed, key by key, against the state it read (`source`):
    a key it set or changed is set, a key it dropped is removed, and every other key (the
    follow-up job's `followUpErrors`, the nightly pass's `fullPending`, written by other writers
    meanwhile) is left exactly as it is now. One atomic `UPDATE` (`connections.patch_sync_state`)."""
    base = _load_sync_state(source)
    changed = {k: v for k, v in state.items() if k not in base or base[k] != v}
    removed = [k for k in base if k not in state]
    if changed or removed:
        connections.patch_sync_state(user_id, source_id, set_keys=changed, remove_keys=removed)


def _seeded_interval(pace: Any, now: datetime) -> float | None:
    """D3: the interval to seed a new session with: the stored one halved every
    PACE_HALF_LIFE_S since it was learned, or None once it is PACE_MEMORY_S old (or unreadable).
    The client clamps it to its own adaptive range."""
    if not isinstance(pace, dict):
        return None
    interval = pace.get("intervalS")
    learned_at = _parse_iso(pace.get("learnedAt"))
    if not isinstance(interval, (int, float)) or not math.isfinite(interval) or learned_at is None:
        return None
    age = (now - learned_at).total_seconds()
    if age < 0 or age >= PACE_MEMORY_S:
        return None
    return float(interval) * 0.5 ** (age / PACE_HALF_LIFE_S)


def _track_import_progress(state: dict[str, Any], new_notes: int, now: datetime,
                           *, counted: bool = True) -> bool:
    """I10: update the `importing` record for a pass that left leftovers and say whether the
    import has stalled: IMPORT_STALL_PASSES passes in a row with no new note stored, or a pass
    with none more than IMPORT_STALL_AFTER_S after the first importing pass. `counted=False`
    (N4: a nightly full pass) never adds a zero pass; progress still resets the count."""
    imp = state.get("importing")
    if not isinstance(imp, dict) or _parse_iso(imp.get("since")) is None:
        imp = {"since": now.isoformat(), "zeroPasses": 0}
    previous = int(imp.get("zeroPasses") or 0)
    zero = 0 if new_notes > 0 else previous + 1 if counted else previous
    imp["zeroPasses"] = zero
    state["importing"] = imp
    age = (now - _parse_iso(imp["since"])).total_seconds()
    return zero >= IMPORT_STALL_PASSES or (zero >= 1 and age >= IMPORT_STALL_AFTER_S)


def _schedule_follow_up(user_id: str, source_id: str, retry_afters: list[float | None],
                        zero_passes: int = 0) -> bool:
    """Book ONE quick follow-up pass for a source a rate limit cut short (see
    FOLLOW_UP_MIN_DELAY_S). Returns False, and clears any stamp, when the source already ran
    FOLLOW_UP_MAX_PASSES_PER_HOUR passes in the last hour (this one included): the hourly tick
    takes it from there. `zero_passes` (N3): passes in a row without progress back the follow-up
    off exponentially (FOLLOW_UP_BACKOFF_BASE_S). Worker thread: DB reads and one write."""
    now = datetime.now(timezone.utc)
    passes = connections.count_passes_since(
        user_id, source_id, (now - timedelta(hours=1)).isoformat())
    if passes >= FOLLOW_UP_MAX_PASSES_PER_HOUR:
        # D4-3: a pending full pass is never dropped with the stamp; it waits an hour instead.
        connections.clear_follow_up(
            user_id, source_id,
            full_pending_at=(now + timedelta(seconds=FOLLOW_UP_MAX_DELAY_S)).isoformat())
        return False
    known = [r for r in retry_afters if isinstance(r, (int, float)) and math.isfinite(r) and r >= 0]
    delay = (max(known) if known else 0) + FOLLOW_UP_MARGIN_S
    if zero_passes >= 1:
        delay = max(delay, FOLLOW_UP_BACKOFF_BASE_S * 2 ** min(zero_passes - 1, 20))
    delay = min(max(delay, FOLLOW_UP_MIN_DELAY_S), FOLLOW_UP_MAX_DELAY_S)
    connections.set_follow_up(user_id, source_id, (now + timedelta(seconds=delay)).isoformat())
    return True


async def _listing_rate_limited(
    user_id: str, source_id: str, source: dict[str, Any], provider: Any, log_id: int,
    counts: dict[str, int], sync_state: dict[str, Any], exc: errors.NoteConnRateLimited, *,
    full: bool, removal_check: bool, removal_reason: str | None,
) -> dict[str, Any]:
    """Fix round 2 (concern 4): the LISTING of an opt-in provider was rate limited. The pass is
    recorded as in progress with LISTING_LIMITED_REASON (not "sync stopped"), counts as a pass
    without progress toward the stall rule (a full pass does not), and books its follow-up with
    the same backoff as any pass without progress. Nothing was listed, so nothing moves."""
    stalled = _track_import_progress(sync_state, 0, _utcnow(), counted=not full)
    await asyncio.to_thread(_schedule_follow_up, user_id, source_id, [exc.retry_after],
                            sync_state["importing"]["zeroPasses"])
    learned = getattr(provider, "learned_pacing", None)
    interval, tripped = learned() if learned is not None else (None, False)
    if tripped and isinstance(interval, (int, float)):
        sync_state["pace"] = {"intervalS": float(interval), "learnedAt": _now_iso()}
    await asyncio.to_thread(_save_sync_state, user_id, source_id, source, sync_state)
    label = dest_folder.provider_label(source.get("provider"))
    status = "warning" if stalled else "importing"
    sentence = (LISTING_STALLED_REASON if stalled else LISTING_LIMITED_REASON).format(label=label)
    failure = f"listing rate limited: {exc}"
    log.warning("[note-sync] source %s: %s", source_id, failure)
    await asyncio.to_thread(connections.record_sync_result, user_id, source_id, ok=True,
                            status=status, error=sentence)
    await asyncio.to_thread(_finish_log, log_id, status=status, counts=counts, error=failure,
                            source_deleted=0, failures_json=[])
    result: dict[str, Any] = {"status": status, "sourceId": source_id, **counts,
                              "sourceDeleted": 0, "failures": [failure],
                              "deleteDetectionWarning": None}
    if removal_check:
        result["removalCheck"] = _removal_check_summary(
            user_id, source_id, ran=False, reason=removal_reason or "enumeration_failed",
            severed=0)
    return result


async def sync_follow_up_sources() -> dict[str, int]:
    """Scheduler entry for the quick follow-up passes (`note_sync_follow_up`, every 2 minutes).

    D4-1: the job claims only what it can run. Each round it takes at most `_pass_slot_room()`
    due sources (free slots nobody is queued for), oldest stamp first, LEASES each one's stamp
    (FOLLOW_UP_LEASE_S ahead, so a pass that raises re-fires only once the lease runs out) and
    runs it; the moment a pass ends it claims again, so a slot never idles behind the slowest
    pass of a batch (the job has `max_instances=1`, so the next tick would not have come). A
    source left unclaimed keeps its stamp untouched for the next round or tick: it is not leased,
    has no log row and never reads "syncing now" while nothing runs it. The job ends when nothing
    it started is still running. A source another pass is already syncing is skipped with its
    stamp KEPT (that pass replaces or clears it). One failing source never blocks the others.
    `manual=True`: a follow-up runs inside the 10 min cooldown. A source whose `sync_state`
    carries `fullPending` (D4-3: the nightly pass found no free slot) runs as a FULL pass."""
    ran = busy = 0
    running: set[asyncio.Task] = set()
    seen_busy: set[str] = set()

    async def run(source: dict[str, Any]) -> bool:
        failed = False
        was_busy = False
        full = bool(_load_sync_state(source).get("fullPending"))
        try:
            result = await sync_source(source["id"], full=full, manual=True)
            was_busy = isinstance(result, dict) and result.get("status") == "busy"
        except errors.NoteConnRateLimited:
            log.info("[note-sync] follow-up pass for source %s was rate limited", source["id"])
        except Exception:  # noqa: BLE001 -- isolate per-source failures
            failed = True
            log.exception("[note-sync] follow-up pass failed for source %s", source["id"])
        if not was_busy:
            try:
                await asyncio.to_thread(_note_follow_up_outcome, source, failed)
            except Exception:  # noqa: BLE001 -- bookkeeping never fails the job
                log.exception("[note-sync] follow-up bookkeeping failed for %s", source["id"])
        return was_busy

    def claim_sync() -> list[dict[str, Any]]:
        """One claiming round (a worker thread, N-E: its DB reads and writes stay off the loop):
        lease and return at most the free slots' worth of due sources."""
        nonlocal busy
        room = _pass_slot_room()
        if room <= 0:
            return []
        now = datetime.now(timezone.utc)
        picked: list[dict[str, Any]] = []
        started = 0
        for source in connections.list_follow_up_due(now.isoformat()):
            if started >= room:
                break
            if is_source_busy(source["id"]):
                if source["id"] not in seen_busy:
                    seen_busy.add(source["id"])
                    busy += 1
                continue
            # I9: the hourly bound is enforced here too, not only when a pass books a follow-up.
            if connections.count_passes_since(
                    source["userId"], source["id"],
                    (now - timedelta(hours=1)).isoformat()) >= FOLLOW_UP_MAX_PASSES_PER_HOUR:
                # A pending full pass is never dropped: it waits an hour instead.
                connections.clear_follow_up(
                    source["userId"], source["id"],
                    full_pending_at=(now + timedelta(seconds=FOLLOW_UP_MAX_DELAY_S)).isoformat())
                continue
            # I9: a LEASE, not a clear: the pass replaces or clears it when it ends, and a pass that
            # crashed fires again once the lease runs out.
            connections.set_follow_up(source["userId"], source["id"],
                                      (now + timedelta(seconds=FOLLOW_UP_LEASE_S)).isoformat())
            started += 1
            picked.append(source)
        return picked

    async def claim() -> None:
        nonlocal ran
        for source in await asyncio.to_thread(claim_sync):
            ran += 1
            running.add(asyncio.create_task(run(source)))

    await claim()
    while running:
        # N-B: also wake every FOLLOW_UP_CLAIM_WAKE_S, so a source that becomes due while one
        # long pass runs takes a free slot then, not when that pass ends.
        done, _pending = await asyncio.wait(running, timeout=FOLLOW_UP_CLAIM_WAKE_S,
                                            return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            running.discard(task)
            if task.result():
                busy += 1
        await claim()
    waiting = len(connections.list_follow_up_due(datetime.now(timezone.utc).isoformat()))
    return {"ran": ran, "busy": busy, "waiting": waiting}


def _note_follow_up_outcome(source: dict[str, Any], failed: bool) -> None:
    """N5: count follow-up passes in a row that raised (not a rate limit). At
    FOLLOW_UP_MAX_ERRORS the stamp is cleared and the count reset (a pending full pass with it:
    the next night books it again): the hourly tick carries on. A pass that did not raise resets
    the count. NEW-5: one key at a time, atomically, so the pass's own state is never rewritten
    from a copy read after it."""
    user_id, source_id = source["userId"], source["id"]
    if not failed:
        connections.patch_sync_state(user_id, source_id, remove_keys=["followUpErrors"])
        return
    errors_in_a_row = connections.bump_sync_state_counter(user_id, source_id, "followUpErrors")
    if errors_in_a_row >= FOLLOW_UP_MAX_ERRORS:
        log.warning("[note-sync] source %s: %d follow-up passes failed in a row; leaving it "
                    "to the hourly sync", source_id, errors_in_a_row)
        connections.patch_sync_state(user_id, source_id,
                                     remove_keys=["followUpErrors", "fullPending"])
        connections.set_follow_up(user_id, source_id, None)


async def _pass_beside_the_loop(source: dict[str, Any], *, full: bool) -> None:
    """D4-3: one opt-in source's pass in a serial loop, run as its own task so the loop never
    waits on it, and with `slot_wait=False` so it never waits for a slot either. Nightly (`full`),
    no free slot (or another pass of this source running) books a follow-up flagged as a full
    pass, due now, which the pool runs as a full pass: the removal check still runs tonight."""
    try:
        result = await sync_source(source["id"], full=full, manual=full, slot_wait=False)
    except Exception:  # noqa: BLE001 -- isolate per-source failures
        log.exception("note-connector %s sync failed for source %s",
                      "FULL" if full else "due", source["id"])
        return
    status = result.get("status") if isinstance(result, dict) else None
    if full and status in ("no_slot", "busy"):
        await asyncio.to_thread(_book_full_follow_up, source["userId"], source["id"])
    elif status == "no_slot":
        # N-C: a follow-up due now, so the pool runs it as soon as a slot frees (an established
        # source otherwise went without a sync for the whole storm).
        await asyncio.to_thread(connections.book_follow_up_no_later_than, source["userId"],
                                source["id"], datetime.now(timezone.utc).isoformat())
        log.info("[note-sync] source %s: no free pass slot; the hourly pass is booked as a "
                 "follow-up instead", source["id"])


def _book_full_follow_up(user_id: str, source_id: str) -> None:
    connections.patch_sync_state(user_id, source_id, set_keys={"fullPending": True})
    connections.book_follow_up_no_later_than(
        user_id, source_id, datetime.now(timezone.utc).isoformat())
    log.info("[note-sync] source %s: no free pass slot for the nightly pass; booked as a full "
             "follow-up pass", source_id)


async def sync_due_sources() -> None:
    """Scheduler entry: serial iteration over every due source, across all
    users. One failing source is logged and never blocks the others.

    D4-3: an opt-in source (Evernote) never runs IN the loop: its pass is a task beside it
    (`_pass_beside_the_loop`) that takes a slot only if one is free right now, else is skipped
    (its follow-up chain or the next tick covers it). So no other member's hourly pass waits on
    Evernote work or on a slot; the tick ends when the passes it started have."""
    interval = int(os.environ.get("NOTE_SYNC_INTERVAL_MIN", "30"))
    due = connections.list_due_sources(interval)
    beside: list[asyncio.Task] = []
    for source in due:
        if _skip_archived_provider(source):
            continue
        if _pooled_provider(source.get("provider") or ""):
            beside.append(asyncio.create_task(_pass_beside_the_loop(source, full=False)))
            await asyncio.sleep(0)  # let it take its slot in due order
            continue
        try:
            await sync_source(source["id"], slot_wait=False)
        except Exception:  # noqa: BLE001 — isolate per-source failures
            log.exception("note-connector sync failed for source %s", source["id"])
    if beside:
        await asyncio.gather(*beside)


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
    mirroring `sync_due_sources`.

    D4-3: an opt-in source runs beside the loop and never waits for a slot; with none free it
    is booked as a follow-up FULL pass (`fullPending`), which the pool runs within minutes."""
    sources = connections.list_all_sources()
    beside: list[asyncio.Task] = []
    for source in sources:
        if _skip_archived_provider(source):
            continue
        if _pooled_provider(source.get("provider") or ""):
            beside.append(asyncio.create_task(_pass_beside_the_loop(source, full=True)))
            await asyncio.sleep(0)
            continue
        try:
            result = await sync_source(source["id"], full=True, manual=True, slot_wait=False)
            if isinstance(result, dict) and result.get("status") == "no_slot":
                await asyncio.to_thread(_book_full_follow_up, source["userId"], source["id"])
        except Exception:  # noqa: BLE001 — isolate per-source failures
            log.exception("note-connector FULL sync failed for source %s", source["id"])
    if beside:
        await asyncio.gather(*beside)


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

    (Written for Microsoft Graph's rotating tokens; OneNote and OneDrive
    were archived 2026-11-04, and the same path now serves Notion.)

    Providers with their own `refresh` hook in the registry (Evernote) use
    it. Providers `oauth.py` does NOT register (Roam/Craft pasted tokens,
    Obsidian) fall back to the plain `connections.get_token` read, BYTE-
    IDENTICAL to this function's pre-fix-round-1 behavior. `refresh_if_needed`
    is itself a safe no-op for a registered provider whose stored token
    carries no `expiresAt` (Notion — tokens don't expire, so this makes
    ZERO extra network calls for it, same as before) or no `refreshToken`."""
    # Plan E Task 6: a provider with its own refresh hook (Evernote: rotating refresh token,
    # compare-and-swap, per-user threading lock) uses it; every other provider is unchanged.
    from . import registry  # lazy, as `_default_provider_factory` imports it
    entry = registry.get_entry(provider_name) if registry.is_known(provider_name) else None
    if entry is not None and entry.refresh is not None:
        return await entry.refresh(user_id)
    if oauth.is_registered(provider_name):
        return await oauth.refresh_if_needed(user_id, provider_name)
    return connections.get_token(user_id, provider_name)


# ── Core per-source sync ─────────────────────────────────────────────────────

async def _do_sync(
    user_id: str, source_id: str, *, full: bool, removal_check: bool = False,
    member: bool = False, slot_wait: bool = True,
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

    # D4-2: the log row is opened once the pass holds its slot (below), so a pass waiting for one
    # reads "queued", never a "syncing" row that sits open for as long as the queue is.
    log_id: int | None = None
    counts = {"created": 0, "updated": 0, "skipped": 0, "mediaUploaded": 0, "conflicts": 0,
              "adopted": 0,  # Plan E Task 8: file-imported notes re-keyed onto live sync
              # Fix round 2 (N8): listed notes D1 did not fetch (stored revision match). Its own
              # key, never `skipped` (the card's "Unchanged"), so a large import does not read as
              # thousands of unchanged notes every pass. Not persisted to the log row.
              "unchanged": 0}
    item_failures: list[str] = []
    # Plan A Task 6: {noteTitle, reason, name} per importNotice written this pass,
    # for the log row's `failures_json` (the `failures` strings above are unchanged).
    notice_failures: list[dict[str, Any]] = []
    delete_guard_warning: str | None = None
    delete_guard_refused = False
    fetch_failed = 0  # review M6: notes the row says could not be read (they are retried)
    rate_limited: dict[str, tuple[str, float | None]] = {}  # live gate 2026-11-03: not failures
    media_waiting: set[str] = set()  # notes whose attachment still waits on the limit (I8)
    deleted_count = 0
    provider: NoteProvider | None = None
    slot_held = False
    slot_kind = SLOT_POOL
    removal_noted = False  # F-b: a full pass that raises before its check still counts a skip

    try:
        # Final review M2: building may read the DB (Evernote's admin mode reads the member's
        # role), so it runs in a worker thread; constructors only build clients, never I/O on a loop.
        provider = await asyncio.to_thread(_provider_factory, source["provider"], source)
        follow_up = getattr(provider, "follow_up_on_rate_limit", False) is True
        if follow_up:
            if slot_wait:
                # D4-2: a member's pass, then a first sync, go to the front of the queue.
                priority = (SLOT_MEMBER if member else
                            SLOT_FIRST_SYNC if not source.get("lastSyncAt") else SLOT_BACKGROUND)
                slot_kind = await _acquire_pass_slot(source_id, priority=priority)
            elif not _try_acquire_pass_slot():
                # D4-3: a serial loop never waits; the caller decides what a skip means.
                return {"status": "no_slot", "sourceId": source_id}
            slot_held = True  # released in the `finally` below
            # The row may have moved while this pass waited (a pass of another kind, a pause).
            source = await asyncio.to_thread(connections.get_source_by_id, source_id) or source
        log_id = await asyncio.to_thread(_start_log, user_id, source_id)
        sync_state = _load_sync_state(source)
        if follow_up and hasattr(provider, "seed_pacing"):
            seed = _seeded_interval(sync_state.get("pace"), _utcnow())
            if seed is not None:
                provider.seed_pacing(seed)
        creds = await _resolve_credentials(user_id, source["provider"])
        if creds is None:
            raise errors.NoteConnNotConfigured(
                f"no connected credentials for provider {source['provider']!r}"
            )

        # ⛔ Live audit 2026-11-03 (H1): a source whose destination folder was deleted refused
        # every batch forever. ONE place for every provider (Obsidian's vault folder included:
        # its subfolders are made under this one by `import_confirm`'s folderPath), before any
        # listing: the source gets its default folder back and this pass imports into it. A
        # paused, disabled or disconnected source is never given one (`heal_missing_dest_folder`).
        # Review M2: a repair that raises is logged and the pass goes on as it would have (a
        # missing folder then fails at the confirm, which tries the repair once more).
        try:
            heal = await asyncio.to_thread(dest_folder.heal_missing_dest_folder, user_id, source_id)
        except Exception:  # noqa: BLE001 — never let the repair abort the pass
            log.exception("[note-sync] source %s: destination-folder check failed", source_id)
            heal = None
        if heal is not None and heal.outcome in dest_folder.USABLE:
            # Review M1: the row is the authority (re-pointed by the heal, or by a delete since
            # this dict was read), so every usable answer is applied, not only a repair.
            source = {**source, "destFolderId": heal.dest_folder_id}
        elif heal is not None and heal.outcome in ("paused", "disabled", "failed"):
            # Re-review N2: the folder is missing and this pass cannot repair it, so every batch
            # would be refused (and each would take the write lock to try the repair again).
            # Nothing is listed, fetched or confirmed; the cursor is untouched, so whatever is
            # waiting is fetched the pass after the repair succeeds. One sentence, recorded once.
            sentence = _heal_sentence(heal, source)
            log.warning("[note-sync] source %s: destination folder missing (%s); pass skipped",
                        source_id, heal.outcome)
            connections.record_sync_result(user_id, source_id, ok=True, status="warning",
                                           error=sentence)
            if follow_up:
                # F-a: a follow-up that cannot import gives up its stamp (a pending full pass
                # waits an hour), instead of a lease that fires every 30 minutes uncounted.
                connections.clear_follow_up(
                    user_id, source_id,
                    full_pending_at=(_utcnow() + timedelta(seconds=FOLLOW_UP_MAX_DELAY_S)).isoformat())
            _finish_log(log_id, status="warning", counts=counts,
                        error=f"{DEST_MISSING_FAILURE_PREFIX} ({heal.outcome}): pass skipped",
                        source_deleted=0, failures_json=[])
            skipped: dict[str, Any] = {
                "status": "warning", "sourceId": source_id, **counts, "sourceDeleted": 0,
                "failures": [f"{DEST_MISSING_FAILURE_PREFIX} ({heal.outcome}): pass skipped"],
                "deleteDetectionWarning": None,
            }
            if removal_check:
                skipped["removalCheck"] = _removal_check_summary(
                    user_id, source_id, ran=False, reason=None, severed=0)
            return skipped

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
        enumeration_failed = False  # set below on a full pass whose complete listing fails
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
        try:
            refs = await provider.list_changed(creds, cursor=cursor)
        except errors.NoteConnRateLimited as e:
            if not follow_up:
                raise
            return await _listing_rate_limited(
                user_id, source_id, source, provider, log_id, counts, sync_state, e,
                full=full, removal_check=removal_check, removal_reason=removal_reason)
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
            # ⛔ Plan E Task 5 review I1: when the complete listing FAILS and no removal listing
            # stood in for it, there is NO complete set this pass. The changed-note delta must
            # never stand in for one: every unchanged note would read as missing, and two such
            # nights severed notes that were still there (the <50% guard only catches a SMALL
            # delta). So the removal check does not run at all (no strike, no stamp), exactly as
            # on the member path when its listing fails. OneNote takes this branch too.
            # (`full` and `removal_check` are exclusive, `_do_sync` refuses both: on a full pass
            # there is never a removal listing to stand in, so a failure always skips. Task 6
            # review m1 removed the dead branch that said otherwise.)
            enumeration_failed = False
            if full and present_fn is not None:
                try:
                    index_refs = await present_fn(creds)
                except Exception as e:  # noqa: BLE001
                    enumeration_failed = True
                    item_failures.append(
                        f"list_present_refs sweep failed (removal check skipped "
                        f"this pass, no strikes): {e}"
                    )

            if enumeration_failed:
                if removal_check:
                    removal_reason = "enumeration_failed"
                # Review R2: a skipped check is counted; 3 in a row turn the source amber.
                await asyncio.to_thread(connections.note_removal_check, user_id, source_id, ran=False)
                removal_noted = True
            else:
                await asyncio.to_thread(connections.note_removal_check, user_id, source_id, ran=True)
                removal_noted = True
                # Every full pass, scheduler or member, stamps
                # `last_full_sync_at` in the detection transaction (refused
                # included) — the member rate limit reads it.
                dd = await asyncio.to_thread(
                    _run_delete_detection,
                    user_id, source, index_refs, deleted_refs=deleted_refs,
                    stamp_at=_now_iso(),
                    authoritative=getattr(provider, "enumeration_is_authoritative", False) is True,
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
                    delete_guard_refused = bool(dd["refused"])

        # Off the event loop (fix round 1): one upsert per listed ref, run by "Sync now" and the
        # first sync on the uvicorn loop.
        await asyncio.to_thread(_touch_remote_index, user_id, source, provider, index_refs)

        # Plan E Task 9 (found by the messy Evernote corpus), fix round 1: a
        # provider with `list_present_refs` keeps its stored cursor on a full
        # pass, so a note whose remote never changes is never listed again,
        # and an image that failed to copy on it ("retrying on the next
        # sync") was never retried. ONLY on a scheduler full pass whose
        # complete listing succeeded (never a member's removal-check pass,
        # which is an incremental pass; review C2), and ONLY for a provider
        # whose `fetch` needs no listing state (`fetch_is_listing_independent`,
        # Evernote; review C1), the listed notes still waiting on a retryable
        # copy are fetched too: unedited ones only (review I1), at most
        # MEDIA_RETRY_NOTES_PER_PASS, stalest import first (review I2). Each
        # is a media retry and nothing else: `_import_remote_notes` lets it
        # through only when its payload hash equals the stored one (C1's
        # belt guard). They never feed the cursor (OneNote's is a drain
        # watermark a newer ref would jump) and never hold it.
        # (`not enumeration_failed` is a belt: a failed listing leaves `index_refs is
        # refs`, so there is no unlisted note to pick anyway.)
        fetch_refs = refs
        retry_ids: set[str] = set()
        sweep: list[RemoteRef] = []
        if (full and present_fn is not None and not enumeration_failed
                and getattr(provider, "fetch_is_listing_independent", False) is True):
            retries = _pending_media_refs(user_id, source, provider, refs, index_refs)
            # NEW-2b: listed notes whose complete-listing revision differs from the stored one,
            # oldest import first, at most NIGHTLY_REVISION_SWEEP_MAX a night (the rest carry
            # over): an edit the incremental listing never returned (Evernote's index lagging
            # past CURSOR_OVERLAP_S) is at most a day late, never lost. A full content import,
            # never a media-only retry; like the retries they never feed or hold the cursor.
            listed_now = {r.remote_id for r in refs}
            sweep = await asyncio.to_thread(
                _revision_sweep_refs, user_id, source, provider, index_refs, listed_now)
            sweep_ids = {r.remote_id for r in sweep}
            retries = [r for r in retries if r.remote_id not in sweep_ids]
            retry_ids = {r.remote_id for r in retries}
            fetch_refs = refs + retries + sweep
            if sweep:
                log.info("[note-sync] source %s: nightly revision sweep fetches %d note(s) whose "
                         "listed revision differs from the stored one", source_id, len(sweep))

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
        #
        # Plan E Task 5 review I3: fetched, finalized and imported one chunk at a time, so at
        # most IMPORT_CHUNK_NOTES converted notes are alive at once. A link to a note in a later
        # chunk is left pending and healed by that chunk's `_import_remote_notes` (its heal pass
        # runs at the end of every call). The cursor rule below is unchanged: it still runs once,
        # after every chunk, and only when nothing went unstored.
        fetched_ids: set[str] = set()
        not_stored_refs: set[str] = set()
        linked_note_ids: list[str] = []
        adoption_state: dict = {}  # Task 8 concern 4: what this pass adopted, across chunks
        imported_any = False
        # Fix round 1 (D1): work is cumulative across passes. A listed note whose STORED copy
        # carries the listing's own revision and waits on no media is not fetched again, and
        # counts as stored (for "X of Y" and for the cursor), so an interrupted first import
        # resumes where it stopped instead of re-reading the whole library every pass. Read from
        # `j2_notes` ONLY: `_touch_remote_index` above already stamped every listed ref, fetched
        # or not, so the remote index would skip the very notes that were never read (C2). Never
        # on the nightly full pass (a converter change must still reach every changed note).
        unchanged, has_row, trashed = await asyncio.to_thread(
            _classify_listed, user_id, source, provider, fetch_refs, follow_up)
        listed_count = len(fetch_refs)
        skipped_now: set[str] = set()
        # ⛔ Live bug 2026-11-03 (owner's account): D1's skip-before-fetch applies ONLY while a
        # first import is catching up, i.e. while the cursor is still None. Once the cursor is
        # set, the incremental listing IS the delta, and a listed note is fetched even when its
        # listing revision equals the stored one: Evernote's search index lags, so an edited
        # note was listed with its OLD updatedAt, D1 skipped it ("D1 skipped 2 of 2 listed"),
        # and the edit never arrived (and could be lost once the cursor moved past it). The
        # fetch is cheap at delta size, and `import_confirm`'s own hash check still makes an
        # unchanged refetch a no-op write. N1's ordering below is unchanged.
        #
        # ⛔ NEW-A (final review, reproduced): once the cursor is set the revision match is still
        # computed, for ORDERING and for the cursor only, never to skip a fetch. Fetching every
        # listed note in listing order under FETCH_CAP_PER_PASS livelocked a pass that listed
        # more than the cap (a bulk tag or move inside CURSOR_OVERLAP_S): the notes past the cap
        # held the cursor, the next pass listed the same set and fetched the same first 300, and
        # it read "importing", then "stalled", with the edits ranked past 300 never imported.
        # Now revision matches (`rev_match`: a live row at the listing's revision and no media
        # pending, or a trashed row at it) are fetched LAST, so the cap reaches new, changed and
        # media-pending notes first, and one the cap or the clock left unfetched counts as stored
        # for the cursor (below). The stale-index safety net for those few is CURSOR_OVERLAP_S
        # plus the nightly revision sweep. Any other ref left unfetched holds the cursor as before.
        catching_up = not source.get("cursor")
        rev_match: set[str] = set()
        if not catching_up:
            rev_match = unchanged | trashed
            unchanged, trashed = set(), set()
        if trashed:
            # NEW-7: while a first import catches up, a trashed note at the listed revision is
            # not fetched. Once the cursor is set (incremental and nightly passes alike) it is
            # fetched, and concern 2's path keeps the content in the trashed row, still trashed.
            fetch_refs = [r for r in fetch_refs if r.remote_id not in trashed]
            fetched_ids.update(trashed)
            log.info("[note-sync] source %s: %d listed note(s) the member trashed, unchanged "
                     "since, not imported again", source_id, len(trashed))
        if not full and unchanged:
            skipped_now = unchanged
            fetch_refs = [r for r in fetch_refs if r.remote_id not in unchanged]
            fetched_ids.update(unchanged)
            counts["unchanged"] += len(unchanged)
        if follow_up:
            # Fix round 2 (N1): the cap is safe even if D1's revision match never fires: notes
            # with no stored row first, then changed or media-pending ones, then the rest (only a
            # full pass still has those), each group in listing order. So every pass makes
            # new-note progress until every note has a row.
            # NEW-A: with the cursor set, `rev_match` ranks last the same way (`unchanged` is empty
            # then), and on the nightly full pass that puts the revision sweep and the media retries
            # ahead of a large unchanged delta. A trashed revision match has no live row; it ranks
            # last too, never among the new notes.
            fetch_refs = sorted(fetch_refs, key=lambda r: (
                2 if r.remote_id in unchanged or r.remote_id in rev_match
                else 0 if r.remote_id not in has_row else 1))
            log.info("[note-sync] %s D1 skipped %d of %d listed (stored revision match)",
                     source.get("provider"), len(skipped_now), listed_count)
        # Fix round 1 (D2): a bounded pass for a provider that opts in (a one-item list, so the
        # count is shared across chunks).
        fetch_cap = None
        if follow_up:
            # NEW-C (final review): keyed on the member's press during their own first import
            # (cursor None), whichever slot it runs in (the reserved one or a free pool slot).
            fetch_cap = [MEMBER_SLOT_FIRST_IMPORT_CAP
                         if member and not source.get("cursor")
                         else FETCH_CAP_PER_PASS]
        for chunk_index, chunk_refs in enumerate(_chunks(fetch_refs, IMPORT_CHUNK_NOTES)):
            if chunk_index:
                # M2: a source paused, disconnected or removed mid-pass stops at the next chunk.
                current = await asyncio.to_thread(connections.get_source_by_id, source_id)
                if (current is None or not current.get("syncEnabled")
                        or current.get("status") != "active"):
                    log.info("[note-sync] source %s was paused or removed mid-pass; stopping",
                             source_id)
                    break
            chunk_notes, fetch_failures = await _fetch_remote_notes(
                provider, creds, chunk_refs, rate_limited, fetch_cap)
            fetch_failed += len(fetch_failures)
            item_failures.extend(fetch_failures)
            _drain_provider_item_failures(provider, item_failures, notice_failures)
            # Plan A Task 10: links finalized here, before anything hashes or stores a doc.
            chunk_notes = await asyncio.to_thread(_finalize_remote_notes, chunk_notes)
            fetched_ids.update(rn.remote_id for rn in chunk_notes)
            if chunk_notes:
                imported_any = True
                result = await _import_remote_notes(
                    user_id, source, provider, creds, chunk_notes, heal=False,
                    adoption_state=adoption_state, retry_only=retry_ids)
                linked_note_ids.extend(result.get("linkedNoteIds", []))
                counts["created"] += result["created"]
                counts["updated"] += result["updated"]
                counts["skipped"] += result["skipped"]
                counts["mediaUploaded"] += result["mediaUploaded"]
                counts["conflicts"] += result["conflicts"]
                counts["adopted"] += result.get("adopted", 0)
                item_failures.extend(result["failures"])
                notice_failures.extend(result.get("noticeFailures", []))
                not_stored_refs.update(result.get("notStoredRefs", []))
                # I8: a note whose attachment the rate limit stopped is a leftover: stored, but
                # not finished, so it holds the cursor and the follow-up fetches it again.
                for rid, retry_after in result.get("rateLimitedRefs", []):
                    rate_limited.setdefault(rid, (None, retry_after))
                    not_stored_refs.add(rid)
                    media_waiting.add(rid)
                _drain_provider_item_failures(provider, item_failures, notice_failures)
            del chunk_notes  # this chunk's docs are not held while the next is fetched
        listed_ids = {r.remote_id for r in refs}
        # NEW-A: a listed revision match the cap (no failure string) or the clock (a rate limit)
        # left unfetched counts as stored for the cursor, and is no leftover and no failure.
        credited = {rid for rid in rev_match & listed_ids
                    if rid not in fetched_ids and rid in rate_limited}
        if credited:
            credited_strings = {rate_limited[rid][0] for rid in credited} - {None}
            fetch_failed -= sum(1 for f in item_failures if f in credited_strings)
            item_failures = [f for f in item_failures if f not in credited_strings]
            for rid in credited:
                rate_limited.pop(rid, None)
            fetched_ids.update(credited)
            log.info("[note-sync] source %s: %d listed note(s) at their stored revision left for "
                     "a later pass (fetch cap or rate limit); they do not hold the cursor",
                     source_id, len(credited))
        if sweep:
            # NEW-2b: a swept note now stored carries the listing's revision, so the sweep
            # converges even when the content was unchanged (`import_confirm` skipped it and
            # left the old stamp) and is not fetched again every night.
            stored_sweep = [r for r in sweep
                            if r.remote_id in fetched_ids and r.remote_id not in not_stored_refs]
            await asyncio.to_thread(_stamp_listed_revisions, user_id, source, provider, stored_sweep)
        not_stored_refs = {rid for rid in not_stored_refs if rid in listed_ids}  # retries never hold the cursor
        not_stored_refs.update(listed_ids - fetched_ids)
        if imported_any:
            item_failures.extend(await asyncio.to_thread(
                _heal_after_pass, user_id, linked_note_ids))

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
                await asyncio.to_thread(connections.update_cursor, user_id, source_id, opaque_cursor)
            elif refs:
                newest = max(r.updated_at for r in refs)
                await asyncio.to_thread(connections.update_cursor, user_id, source_id, newest)

        # A1: a pass that fetched refs but stored NONE of them (the "13 of
        # 13 lost" catastrophic case a whole-batch confirm failure used to
        # produce) must not report "ok" and move on. A genuine PARTIAL
        # commit — most notes stored, one oversized note isolated and named
        # in `failures` — still reports "ok": the batch committed what it
        # could, exactly as designed; the failure is visible in `failures`,
        # not hidden behind the top-level status.
        # Live gate 2026-11-03: listed notes a provider's rate limit left unread. For a provider
        # that opts in they are a first import still catching up: a quick follow-up pass is booked,
        # the member reads a progress sentence, and they are neither "lost" nor "couldn't be read".
        leftovers = {rid for rid in rate_limited if rid in not_stored_refs} if follow_up else set()
        if follow_up and full:
            # D4-3: this IS the full pass a nightly booking asked for (its listing and removal
            # check ran, leftovers or not); the follow-ups after it are incremental again.
            sync_state.pop("fullPending", None)
            await asyncio.to_thread(connections.patch_sync_state, user_id, source_id,
                                    remove_keys=["fullPending"])
        member_failures = item_failures
        progress: str | None = None
        stalled = False
        if leftovers:
            limited_strings = {rate_limited[rid][0] for rid in rate_limited} - {None}
            fetch_failed -= sum(1 for f in item_failures if f in limited_strings)
            member_failures = [f for f in item_failures if f not in limited_strings]
            # N4: attachments copied are progress too; a nightly full pass adds no zero pass.
            # A note re-read only to retry an attachment that is STILL waiting is no progress,
            # though the import path counts it as updated.
            stalled = _track_import_progress(
                sync_state, counts["created"] + max(0, counts["updated"] - len(media_waiting))
                + counts.get("adopted", 0) + counts["mediaUploaded"], _utcnow(), counted=not full)
            booked = await asyncio.to_thread(
                _schedule_follow_up, user_id, source_id,
                [rate_limited[rid][1] for rid in leftovers],
                sync_state["importing"]["zeroPasses"])
            label = dest_folder.provider_label(source.get("provider"))
            total = len(listed_ids)
            if source.get("cursor"):
                template = (IMPORT_NEW_STALLED_REASON if stalled else
                            IMPORT_NEW_PROGRESS_REASON if booked else IMPORT_NEW_PROGRESS_LATER_REASON)
            else:
                template = (IMPORT_STALLED_REASON if stalled else
                            IMPORT_PROGRESS_REASON if booked else IMPORT_PROGRESS_LATER_REASON)
            progress = template.format(
                label=label, stored=total - len(not_stored_refs), total=total,
                notes="note" if total == 1 else "notes")
        else:
            sync_state.pop("importing", None)
            if follow_up:
                # Nothing left over: the stamp goes, unless a full pass is still pending (booked
                # by the nightly pass while this one ran): then it stays, due now.
                await asyncio.to_thread(connections.clear_follow_up, user_id, source_id,
                                        full_pending_at=_now_iso())
        if follow_up:
            learned = getattr(provider, "learned_pacing", None)
            interval, tripped = learned() if learned is not None else (None, False)
            if tripped and isinstance(interval, (int, float)):
                sync_state["pace"] = {"intervalS": float(interval), "learnedAt": _now_iso()}
            await asyncio.to_thread(_save_sync_state, user_id, source_id, source, sync_state)
        lost_everything = bool(not_stored_refs - leftovers) and not (
            counts["created"] or counts["updated"] or counts["skipped"] or counts["unchanged"]
        )
        # Plan E Task 6 review R2: deletions cannot propagate while every complete listing fails.
        # From the 3rd consecutive skipped check, EVERY pass (incremental ones too, so a quiet
        # tick never wipes it) is a warning carrying the member's sentence, until a check runs.
        removal_warning = _removal_skip_warning(  # M2: its own connection, off the loop
            source, await asyncio.to_thread(connections.removal_skips, user_id, source_id))
        status = "warning" if (delete_guard_warning or lost_everything or removal_warning) else "ok"
        if stalled:
            status = "warning"  # I10: amber, with the stalled sentence
        elif progress is not None and status == "ok" and fetch_failed == 0 and not any(
                f.get("reason") for f in notice_failures):
            # Nothing but the rate-limit leftovers: in progress, not a warning (SourceRow's pill).
            status = "importing"
        error_parts = (([removal_warning] if removal_warning else [])
                       + ([delete_guard_warning] if delete_guard_warning else []) + item_failures)

        # ⛔⛔ Recorded HERE, not before the block above, and from the SAME
        # `status`/`error_parts` the log and the return value use -- one
        # authority for "how did this pass go". This call used to fire above
        # as a bare `ok=True`, so a pass that stored 0 of 13 notes returned
        # status="warning" while writing "ok" with a NULL error to the source
        # row -- and that row is the one the connectors card reads. `ok=True`
        # is still right even for a warning: the pass authenticated and
        # fetched, so it is genuine evidence a previously-'broken' source has
        # recovered; only what the MEMBER is shown differs.
        # M2 (live audit 2026-11-03): the source row is what the member reads (SourceRow renders
        # `lastSyncError`), so it carries member sentences only. The developer text, batch counts
        # and raw ids included, stays in the server log and the log row's `error` column (which
        # no endpoint serves).
        member_error = _member_sync_error(
            source, removal_warning=removal_warning, delete_guard_warning=delete_guard_warning,
            delete_guard_refused=delete_guard_refused, item_failures=member_failures,
            notice_failures=notice_failures, fetch_failed=fetch_failed, progress=progress)
        if error_parts:
            log.warning("[note-sync] source %s pass finished %s: %s", source_id, status,
                        "; ".join(error_parts))
        await asyncio.to_thread(
            connections.record_sync_result,
            user_id, source_id, ok=True, status=status, error=member_error,
        )

        await asyncio.to_thread(
            _finish_log,
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
        # Review M7: the source row is member-facing; the raw text goes to the server log and the
        # log row's `error` column (which no endpoint serves), never to `lastSyncError`.
        log.warning("[note-sync] source %s sync stopped: %s: %s", source_id, type(e).__name__, e)
        member_error = _member_hard_error(source, e)
        await asyncio.to_thread(
            connections.record_sync_result, user_id, source_id, ok=False, error=member_error)
        if log_id is None:  # it failed before the pass opened its row (building the provider)
            log_id = await asyncio.to_thread(_start_log, user_id, source_id)
        if full and not removal_noted:
            # F-b: a full pass that raised before its removal check is a skipped check, so three
            # such nights in a row turn the source amber like three failed listings do.
            try:
                await asyncio.to_thread(connections.note_removal_check, user_id, source_id,
                                        ran=False)
            except Exception:  # noqa: BLE001 — never let this bookkeeping mask the real error
                pass
        if isinstance(e, errors.NoteConnAuthError):
            # Auth rejected (incl. NoteConnTokenExpired, a subclass) — retrying
            # on the next scheduled sync would just fail identically forever
            # (mirrors broker/sync.py's SnapAuthError handling). Mark BOTH the
            # source and the connector 'broken' so list_due_sources excludes
            # this source going forward and the UI prompts a reconnect.
            try:
                connections.set_source_status(user_id, source_id, "broken", error=member_error)
                connections.set_connector_status(user_id, source["provider"], "broken")
            except Exception:  # noqa: BLE001 — never let this bookkeeping mask the real error
                pass
        await asyncio.to_thread(_finish_log, log_id, status="error", counts=counts, error=str(e),
                                failures_json=notice_failures)
        raise
    finally:
        if slot_held:
            _release_pass_slot(slot_kind)
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
    *, deleted_refs: list[RemoteRef] | None = None, stamp_at: str, authoritative: bool = False,
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
        # L1 (2026-11-03): for a provider whose listing is AUTHORITATIVE (`authoritative`,
        # Obsidian's manifest) the ratio guard runs only from DELETE_GUARD_MIN_KNOWN tracked
        # items up; below it the 2-strike rule and its strike gap protect a small vault. Every
        # other provider keeps the guard at any size (fix round 1 ruling).
        guarded = prev_count >= DELETE_GUARD_MIN_KNOWN if authoritative else prev_count > 0
        if guarded and len(seen_ids) < prev_count * 0.5:
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


#: The member's sentence for a note that could not be stored, when nothing better was said.
NOT_STORED_RETRY_REASON = "This note couldn't be saved this time. It will be tried again on the next sync."
#: The member's sentence for a media retry the hash gate skipped (C1's belt guard; fix round 2, m2):
#: the note is kept as it is, and its pending images are tried again on a later full pass.
RETRY_SKIPPED_REASON = ("An image in this note couldn't be copied this time, because the note looks "
                        "different from the copy here. It will be tried again on the next sync.")


#: The `import_confirm` failures that are already member sentences (m1). Anything else (a
#: developer's validation message, a raw DB error) is never shown: see `_member_reason`.
_MEMBER_NOT_STORED_SENTENCES = frozenset({
    notes_svc.TOO_LONG_BODY_DETAIL, notes_svc.TOO_DEEP_BODY_DETAIL,
    notes_svc.UNBUILDABLE_BODY_DETAIL, notes_svc.S_TITLE_TOO_LONG,
})


def _member_reason(error: Any, *, key: Any) -> str:
    """What a member reads for a note `import_confirm` could not store (Plan E Task 9 fix round 2,
    m1): a known member sentence as it is, else `NOT_STORED_RETRY_REASON`. The raw text is logged
    server-side only."""
    if isinstance(error, str) and error in _MEMBER_NOT_STORED_SENTENCES:
        return error
    log.warning("[note-sync] note %r could not be stored: %s", key, error)
    return NOT_STORED_RETRY_REASON


#: The developer string (`result["failures"]`, the server log) for a batch refused because the
#: source's destination folder is missing; `_member_sync_error` keeps it out of the member's text.
DEST_MISSING_FAILURE_PREFIX = "destination folder missing"
#: The source row's sentence for per-note problems the log rows name (`failures_json`). Review M6:
#: it never repeats the "N items didn't come over" the Recent syncs toggle already shows.
NOTES_INCOMPLETE_REASON = "Some notes didn't sync completely. Recent syncs names each one and why."
#: Notes whose fetch failed: the log rows do not name them, so this says how many and that they are
#: retried (true: the cursor holds on an unfetched note).
FETCH_FAILED_REASON = "{n} {notes} couldn't be read from {label} this time. {they} tried again on the next sync."
#: Live gate 2026-11-03: a pass a provider's rate limit cut short is a first import still catching
#: up, not a failure. `stored` of `total` are this pass's listed notes stored vs listed. The first
#: form is used when a quick follow-up pass is booked, the second when the hourly bound is reached.
IMPORT_PROGRESS_REASON = ("Still importing from {label}: {stored} of {total} {notes} so far. "
                          "The rest will come in over the next few minutes.")
IMPORT_PROGRESS_LATER_REASON = ("Still importing from {label}: {stored} of {total} {notes} so far. "
                                "The rest will come in on the next sync.")
#: Fix round 1 (I10): the same for a source that already has a cursor (its first import finished):
#: the listing is only what changed, so "X of Y" would not be the library.
IMPORT_NEW_PROGRESS_REASON = ("Still importing new notes from {label}. "
                              "The rest will come in over the next few minutes.")
IMPORT_NEW_PROGRESS_LATER_REASON = ("Still importing new notes from {label}. "
                                    "The rest will come in on the next sync.")
#: Fix round 1 (I10): an import that stopped making progress. Amber, and true: it keeps retrying.
IMPORT_STALLED_REASON = ("{label} import has stalled at {stored} of {total} {notes}. It will keep "
                         "retrying; if this lasts, disconnect and reconnect {label}.")
IMPORT_NEW_STALLED_REASON = ("Importing new notes from {label} has stalled. It will keep "
                             "retrying; if this lasts, disconnect and reconnect {label}.")
#: Fix round 2 (concern 4): the provider rate limited the LISTING itself. In progress, not "sync
#: stopped"; it counts as a pass without progress, so it can stall like any other.
LISTING_LIMITED_REASON = "{label} is slowing us down; retrying shortly."
LISTING_STALLED_REASON = ("{label} keeps slowing us down, so syncing has stalled. It will keep "
                          "retrying; if this lasts, disconnect and reconnect {label}.")
#: The source row's sentence for a pass that left something unfinished and names nothing per note
#: (a sweep that did not run, a link pass that failed): each is retried on a later pass.
PASS_UNFINISHED_REASON = "Part of this sync didn't finish. It will be tried again on the next sync."
#: Review M7: a pass that stopped on an exception (the raw text is in the server log).
SYNC_STOPPED_REASON = ("This sync stopped early because of a problem on our side or {label}'s. "
                       "It will be tried again on the next sync.")
#: An auth failure: the source is marked broken and is not retried until the member reconnects.
RECONNECT_REASON = "{label} needs to be reconnected before it can sync again. Press Reconnect."
#: The <50% enumeration guard refused the removal check (`_run_delete_detection`).
REMOVALS_REFUSED_REASON = ("Couldn't confirm removals this time: {label} returned far fewer notes "
                           "than expected, so nothing was changed.")
#: The 20% cap refused `list_deleted`'s explicit signal; the 2-strike rule still applies.
REMOVALS_DOUBLE_CHECKED_REASON = ("{label} reported many notes as deleted at once, so they will be "
                                  "double-checked on later syncs before anything is marked removed.")


def _dest_folder_missing_reason(user_id: str, source: dict[str, Any]) -> str:
    """The member's sentence for a batch refused because the source's folder is missing, after
    trying the repair once more (the folder went while this pass ran). Each sentence is true of
    what the repair did: a usable answer re-points `source` (so later batches of this pass use it)
    and the notes are saved on the next pass; a paused or disabled source says what will fix it."""
    heal = dest_folder.heal_missing_dest_folder(user_id, source["id"])
    if heal.outcome in dest_folder.USABLE:
        source["destFolderId"] = heal.dest_folder_id
    return _heal_sentence(heal, source)


def _heal_sentence(heal: "dest_folder.HealResult", source: dict[str, Any]) -> str:
    """The one mapping from what the repair did to what the member reads."""
    label = dest_folder.provider_label(source.get("provider"))
    if heal.outcome in dest_folder.USABLE:
        if heal.outcome == "remade":
            return dest_folder.dest_folder_remade_sentence(heal.folder_name or "")
        return dest_folder.DEST_FOLDER_MOVED_SENTENCE
    if heal.outcome == "paused":
        return dest_folder.dest_folder_gone_sentence(label)
    if heal.outcome == "disabled":
        return dest_folder.dest_folder_disabled_sentence(label)
    return dest_folder.DEST_FOLDER_RETRY_SENTENCE  # "failed" (and "gone": nobody reads it)


def _member_hard_error(source: dict[str, Any], exc: BaseException) -> str:
    label = dest_folder.provider_label(source.get("provider"))
    if isinstance(exc, errors.NoteConnAuthError):
        return RECONNECT_REASON.format(label=label)
    return SYNC_STOPPED_REASON.format(label=label)


def _member_sync_error(
    source: dict[str, Any], *, removal_warning: str | None, delete_guard_warning: str | None,
    delete_guard_refused: bool, item_failures: list[str], notice_failures: list[dict[str, Any]],
    fetch_failed: int = 0, progress: str | None = None,
) -> str | None:
    """What the source row tells the member about a pass (M2, live audit 2026-11-03): sentences,
    never developer text. It used to be every failure string joined, so a member read
    "confirm failed for a batch of 1 note(s): ..." and "media '<url>' on note 919630dd...: ...",
    a raw note id included. Per-note detail lives in the log rows (`failures_json`, by title);
    this is the summary: a whole-source problem in full (a missing folder's sentence, which all
    begin `dest_folder.DEST_SENTENCE_PREFIX`), the notes that could not be read, and a pointer to
    the log rows for the rest."""
    label = dest_folder.provider_label(source.get("provider"))
    parts: list[str] = [progress] if progress else []
    if removal_warning:
        parts.append(removal_warning)
    if delete_guard_warning:
        parts.append((REMOVALS_REFUSED_REASON if delete_guard_refused
                      else REMOVALS_DOUBLE_CHECKED_REASON).format(label=label))
    reasons = [f.get("reason") or "" for f in notice_failures]
    parts.extend(r for r in dict.fromkeys(reasons) if dest_folder.is_dest_folder_sentence(r))
    per_note = [r for r in reasons if not dest_folder.is_dest_folder_sentence(r)]
    if fetch_failed:
        parts.append(FETCH_FAILED_REASON.format(
            n=fetch_failed, notes="note" if fetch_failed == 1 else "notes", label=label,
            they="It will be" if fetch_failed == 1 else "They will be"))
    if per_note:
        parts.append(NOTES_INCOMPLETE_REASON)
    elif not fetch_failed and any(
            not f.startswith(DEST_MISSING_FAILURE_PREFIX) for f in item_failures):
        parts.append(PASS_UNFINISHED_REASON)
    return " ".join(parts) if parts else None


def _not_stored_notice(title: Any, key: Any, reason: str) -> dict[str, Any]:
    """`failures_json`'s `{noteTitle, reason, name}` for a note that was not stored (concern 4):
    its title, else its import key, so the row always names something."""
    name = title.strip() if isinstance(title, str) and title.strip() else str(key or "Untitled")
    return {"noteTitle": name, "reason": reason, "name": None}


def _pending_media_refs(
    user_id: str, source: dict[str, Any], provider: NoteProvider,
    refs: list[RemoteRef], index_refs: list[RemoteRef],
) -> list[RemoteRef]:
    """The refs of the complete listing `index_refs` that `refs` (this pass's delta) does not
    hold and whose stored note waits on a retryable media copy (`import_media_pending = 1`;
    2, waiting for storage space, is not a retry). A note the member edited is never one
    (`_is_conflict`, the one predicate: its edited branch never confirms, so it would be
    refetched every pass for nothing; review I1). At most `MEDIA_RETRY_NOTES_PER_PASS`, the
    stalest `imported_at` first, so every note gets its turn (review I2). One query: the
    pending rows are few, and the listing is matched in memory. See the call site."""
    listed = {r.remote_id for r in refs}
    by_key: dict[str, RemoteRef] = {}
    for r in index_refs:
        if r.remote_id not in listed:
            by_key.setdefault(provider.import_key(source["remoteId"], r.remote_id), r)
    if not by_key:
        return []
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT import_key, updated_at, imported_at FROM j2_notes "
            "WHERE user_id = ? AND deleted_at IS NULL AND import_media_pending = ? "
            "ORDER BY imported_at, import_key",
            (user_id, import_notice.MEDIA_PENDING_RETRY),
        ).fetchall()
    finally:
        conn.close()
    out: list[RemoteRef] = []
    for row in rows:
        r = by_key.get(row["import_key"])
        if r is None or _is_conflict({"updatedAt": row["updated_at"], "importedAt": row["imported_at"]}):
            continue
        out.append(r)
        if len(out) >= MEDIA_RETRY_NOTES_PER_PASS:
            break
    return out


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

_HEAL_NAMED_CHUNK = 200  # named notes healed per call: bounds the bodies held at once

#: Plan E Task 6 review R2: consecutive skipped removal checks before the source turns amber.
REMOVAL_SKIP_WARN_AFTER = 3


def _removal_skip_warning(source: dict[str, Any], skips: int) -> str | None:
    """The member-facing sentence for a source whose removal check has been skipped
    `REMOVAL_SKIP_WARN_AFTER`+ nights in a row; None below that."""
    if skips < REMOVAL_SKIP_WARN_AFTER:
        return None
    from . import registry
    name = source.get("provider") or "the app"
    label = registry.get_entry(name).label if registry.is_known(name) else name
    return f"Couldn't check which notes were deleted in {label} for {skips} nights — retrying"


def _heal_after_pass(user_id: str, linked_note_ids: list[str]) -> list[str]:
    """Plan E Task 6 review R1: after the LAST chunk of a pass, heal BY NAME every note this pass
    stored that still has a pending link (a forward link into a later chunk), then run the
    member's random sweep ONCE (review m4: it used to run once per chunk). Named notes are read
    regardless of the sweep's sample; they are filtered to `import_links_pending = 1` first and
    healed `_HEAL_NAMED_CHUNK` at a time, so a 5000-note pass never holds 5000 bodies. Runs in
    a worker thread, each call on its own connection. Never fails the pass: returns failures."""
    failures: list[str] = []
    try:
        pending: list[str] = []
        ids = list(dict.fromkeys(linked_note_ids))
        conn = get_connection()
        try:
            for i in range(0, len(ids), 500):  # SQLite variable limit
                chunk = ids[i:i + 500]
                pending.extend(r["id"] for r in conn.execute(
                    f"SELECT id FROM j2_notes WHERE user_id = ? AND import_links_pending = 1 "
                    f"AND id IN ({','.join('?' * len(chunk))})", (user_id, *chunk)).fetchall())
        finally:
            conn.close()
        for i in range(0, len(pending), _HEAL_NAMED_CHUNK):
            result = heal_pending_links(user_id, note_ids=pending[i:i + _HEAL_NAMED_CHUNK], limit=0)
            failures.extend(result.get("failures", []))
        result = heal_pending_links(user_id)  # the member's sweep: once per pass
        failures.extend(result.get("failures", []))
    except Exception as e:  # noqa: BLE001
        failures.append(f"link heal pass failed: {e}")
    return failures


async def _fetch_remote_notes(
    provider: NoteProvider, creds: dict[str, Any], refs: list[RemoteRef],
    rate_limited: dict[str, tuple[str | None, float | None]] | None = None,
    fetch_cap: list[int] | None = None,
) -> tuple[list[RemoteNote], list[str]]:
    """`rate_limited`, when given, collects `{remote_id: (failure string, retry_after)}` for each
    ref whose own fetch raised `NoteConnRateLimited` (live gate 2026-11-03: a follow-up pass, not
    a failure, for a provider that opts in). The failure strings are returned as before.

    Fix round 1 (I4): a provider on the BASE `fetch_many` (a plain loop over `fetch`) is fetched
    one ref at a time directly: a batch that failed on its 30th note used to be fetched again,
    every note of it, one by one. `fetch_cap` (D2, a one-item list shared across calls) bounds
    how many refs are fetched; one not reached is a rate-limit leftover with no failure string."""
    if not refs:
        return [], []
    notes: list[RemoteNote] = []
    failures: list[str] = []
    if type(provider).fetch_many is NoteProvider.fetch_many:
        for ref in refs:
            if fetch_cap is not None:
                if fetch_cap[0] <= 0:
                    if rate_limited is not None:
                        rate_limited.setdefault(ref.remote_id, (None, None))
                    continue
                fetch_cap[0] -= 1
            try:
                notes.append(await provider.fetch(creds, ref))
            except Exception as e2:  # noqa: BLE001
                failure = f"fetch failed for {ref.remote_id!r}: {e2}"
                failures.append(failure)
                if rate_limited is not None and isinstance(e2, errors.NoteConnRateLimited):
                    rate_limited[ref.remote_id] = (failure, e2.retry_after)
        return notes, failures
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
                    failure = f"fetch failed for {ref.remote_id!r}: {e2}"
                    failures.append(failure)
                    if rate_limited is not None and isinstance(e2, errors.NoteConnRateLimited):
                        rate_limited[ref.remote_id] = (failure, e2.retry_after)
    return notes, failures


def _finalize_remote_doc(doc: dict[str, Any]) -> dict[str, Any]:
    """Plan A Task 10 (L-3, L-4): THE chokepoint every provider's doc passes through --
    Notion rich text, Roam, Craft, OneNote, Dropbox and Obsidian alike -- before it is
    hashed or stored. Existing hrefs go through the one scheme policy first (an unsafe or
    dead link becomes text), then bare URLs in plain text become links. Pure."""
    return finalize_links(doc)  # B-14 fix round 1: a refused link's text is never re-linked


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
            f"SELECT id, import_key, title, updated_at, imported_at, tags, folder_id, import_hash, "
            f"import_remote_rev, "
            f"CASE WHEN import_media_pending IN (1, 2) THEN body_json END AS pending_body "
            f"FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
            f" AND import_key IN ({placeholders})",
            (user_id, *chunk),
        ).fetchall()
        for row in rows:
            out[row["import_key"]] = {
                "id": row["id"],
                "title": row["title"],  # Plan E Task 9 fix round 1: names a skipped retry
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


#: Plan F (Task 7 fix round 1, concern 2): the SQL name of `stored_body_sha`, registered on the
#: connection right before the UPDATE that uses it.
_BODY_SHA_SQL = "j2_body_sha256"


def stored_body_sha(body_json_text: Any) -> str:
    """sha256 of a note's stored `body_json` text (NULL reads as ""). THE body hash: the import
    repair records it when it plans a note and `_apply_resolved_body(expected_body_hash=)`
    compares it inside the UPDATE, so the two can never hash differently."""
    text = body_json_text if isinstance(body_json_text, str) else ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _ensure_body_sha_function(conn: sqlite3.Connection) -> None:
    """Register `stored_body_sha` on `conn` ONLY if the connection lacks it (Plan F re-review
    N-1): SQLite refuses to RE-register a function while another statement on the connection is
    active, so registering on every call would fail inside a caller's cursor loop. A probe
    answers whether this connection has it (a pooled connection drops its functions on reuse)."""
    try:
        conn.execute(f"SELECT {_BODY_SHA_SQL}('')").fetchone()
    except sqlite3.OperationalError:
        conn.create_function(_BODY_SHA_SQL, 1, stored_body_sha, deterministic=True)


def _apply_resolved_body(
    conn: sqlite3.Connection, user_id: str, note_id: str, body: dict[str, Any],
    *, expected_updated_at: str | None, expected_body_hash: str | None = None,
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
    target exists, writing through THIS function.

    Plan F (`expected_body_hash`, optional; None = exactly the behaviour above, for every
    existing caller): a timestamp-neutral writer (this function, from the heal pass) does not
    move `updated_at`, so the stamp lock cannot see it. With a hash, the write also requires the
    STORED body to still hash to it (`stored_body_sha`), checked in the SAME UPDATE's WHERE
    through a deterministic SQL function registered on this connection. One statement: no
    window between the check and the write, whatever else writes the row."""
    body_plain = notes_svc.extract_plain_text(body)
    body_blob = json.dumps(body)
    # Plan A Task 6: tri-state -- 1 while a placeholder or a retryable importNotice
    # remains (the next sync retries it), 2 while only a storage_limit notice waits.
    media_pending = import_notice.media_pending_state(body)
    links_pending = 1 if notes_svc._body_has_import_link(body) else 0
    # One unit with its sidecars (below): a SAVEPOINT, so a failed projection undoes
    # THIS note's body write and nothing else the connection may hold.
    body_clause, body_params = "", ()
    if expected_body_hash is not None:
        _ensure_body_sha_function(conn)
        body_clause, body_params = f" AND {_BODY_SHA_SQL}(body_json) = ?", (expected_body_hash,)
    conn.execute("SAVEPOINT apply_resolved_body")
    try:
        cur = conn.execute(
            "UPDATE j2_notes SET body_json = ?, body_plain = ?, import_media_pending = ?, "
            "import_links_pending = ? "
            "WHERE id = ? AND user_id = ? AND updated_at = ?" + body_clause,
            (body_blob, body_plain, media_pending, links_pending, note_id, user_id,
             expected_updated_at, *body_params),
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
    rn: RemoteNote, key: str, resolved_body: dict[str, Any], *, pooled: bool = False,
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
    payload = {"source": source["provider"], "destFolderId": original_folder_id, "notes": [entry]}
    try:
        if pooled:
            # NEW-5: a pooled pass's sibling confirm takes the import write lock like every other
            # confirm (its caller runs this in a worker thread). This pass's own resolve writes
            # are committed first, so it never waits on the lock holding a write transaction.
            if conn.in_transaction:
                conn.commit()
            sib_result = _import_confirm_serialized(user_id, payload, conn)
        else:
            sib_result = notes_svc.import_confirm(user_id, payload, conn=conn)
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
    door (`POST /api/j2/notes/media/fetch`, Plan A Task 9) both read it. One provider type
    carries its own plugin reason: `NoteConnAttachmentNotSent` (an Obsidian file the plugin did
    not send, live audit 2026-11-03 F2) reads its own (`obsidian-plugin-outdated` or `not-sent`),
    never `unsupported`."""
    if isinstance(exc, media_policy.MediaRejected):
        return exc.reason
    if isinstance(exc, errors.NoteConnUnsafeAddress):
        return "unsafe"
    if isinstance(exc, errors.NoteConnTooLarge):
        return "too_large"
    if isinstance(exc, errors.NoteConnAttachmentNotSent):
        return exc.notice_reason
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
    """Space a waiting note can use: room under the member's media cap for the largest item a
    sync can copy (`MEDIA_SOURCE_MAX_BYTES`) AND volume headroom (`assert_import_headroom`, the
    other storage_limit source -- read through `notes`, the same reference every save checks).
    Final review (promoted minor): merely "under the cap" re-downloaded every waiting note of a
    member a few bytes under it on every nightly pass, forever, only to hit the cap again."""
    room = media_policy.MEMBER_IMPORT_MEDIA_CAP_BYTES - budget.used
    if room < media_policy.MEDIA_SOURCE_MAX_BYTES:
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


def _media_reuse_on(provider: NoteProvider) -> bool:
    """L4: the provider names media by CONTENT for some refs (`media_ref_names_content(ref)`;
    Obsidian's staged-blob refs carry their sha256), so a ref seen again is the same bytes."""
    return callable(getattr(provider, "media_ref_names_content", None))


def _stored_file_exists(user_id: str, note_id: str, url: str) -> bool:
    """Whether a stored UCT attachment URL of THIS note still has its file (the attachment
    GC removes unreferenced ones), through the path resolver the attachment door serves with."""
    parts = (url or "").rsplit("/", 2)
    if len(parts) != 3:
        return False
    path = notes_svc.serve_note_image_path(user_id, note_id, parts[1], parts[2])
    return path is not None and path.is_file()


def _stored_from_json(raw: str) -> media_policy.StoredMedia | None:
    try:
        d = json.loads(raw)
        original = d.pop("original", None)
        return media_policy.StoredMedia(
            **d, original=media_policy.StoredMedia(**original) if original else None)
    except (TypeError, ValueError):
        return None


def _reusable_stored_media(
    conn: sqlite3.Connection, user_id: str, note_id: str, provider: NoteProvider, refs: list[Any],
) -> dict[str, media_policy.StoredMedia]:
    """L4 (live Obsidian probe 2026-11-03): `{ref: StoredMedia}` this note already stored for
    the content-named refs among `refs` (`j2_note_import_media`), whose files (and kept original)
    are all still on disk. Reused as they are: same URL, no fetch, no copy, nothing reserved
    under the media cap (the bytes are already counted). Anything else is fetched as before."""
    wanted = sorted({r for r in refs if isinstance(r, str) and provider.media_ref_names_content(r)})
    out: dict[str, media_policy.StoredMedia] = {}
    for i in range(0, len(wanted), 400):  # sqlite variable-limit safety
        part = wanted[i:i + 400]
        for row in conn.execute(
                "SELECT ref, stored_json FROM j2_note_import_media WHERE user_id = ? AND note_id = ?"
                f" AND ref IN ({','.join('?' * len(part))})", (user_id, note_id, *part)):
            stored = _stored_from_json(row["stored_json"])
            if stored is None or not _stored_file_exists(user_id, note_id, stored.url):
                continue
            if stored.original is not None and not _stored_file_exists(
                    user_id, note_id, stored.original.url):
                continue
            out[row["ref"]] = stored
    return out


def _record_stored_media(
    conn: sqlite3.Connection, user_id: str, note_id: str, provider: NoteProvider,
    resolved: dict[str, media_policy.StoredMedia], note_refs: list[str], body: Any,
) -> None:
    """L4: remember what each content-named ref of this note is stored as, for the next update
    (`_reusable_stored_media`), and forget the refs the note no longer has. Upserts only: a media
    retry resolves a subset and must not forget the refs resolved on an earlier pass. Rows beside
    the note, never attrs in the body: the editor's schema would drop an extra attr on save.
    Fix round 1: only a ref whose stored URL is in the WRITTEN `body` is recorded. When the
    resolved body failed validation and `_final_body_without_media` wrote notices instead, the
    copied files are in no body, so nothing may later be "reused" from them. Commits."""
    written = json.dumps(body)
    keep = sorted({r for r in note_refs if isinstance(r, str)})
    conn.execute(
        "DELETE FROM j2_note_import_media WHERE user_id = ? AND note_id = ?"
        " AND ref NOT IN (SELECT value FROM json_each(?))",
        (user_id, note_id, json.dumps(keep)))
    now = _now_iso()
    conn.executemany(
        "INSERT OR REPLACE INTO j2_note_import_media (user_id, note_id, ref, stored_json, recorded_at)"
        " VALUES (?, ?, ?, ?, ?)",
        [(user_id, note_id, ref, json.dumps(dataclasses.asdict(stored)), now)
         for ref, stored in resolved.items()
         if isinstance(ref, str) and provider.media_ref_names_content(ref)
         and stored.url in written])
    conn.commit()


async def _upload_media_for_note(
    provider: NoteProvider, creds: dict[str, Any], user_id: str, note_id: str,
    media_entries: list[dict[str, Any]], *, prior_attempts: dict[str, int],
    budget: media_policy.MediaBudget,
    rate_limited_out: list[tuple[str, float | None]] | None = None,
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
            file_intent = m.get("kind") != "image"
            if (file_intent and getattr(provider, "promote_raster_files", False) is True
                    and media_policy.raster_signature(data)):
                # Plan E Task 9 fix round 1 (concern 5): content wins for a raster the provider
                # listed under a generic type. The caller turns its placeholder into an image.
                file_intent = False
            # Fix round 1, I2: the decide+store work (a 25 MB decode/downscale, disk writes)
            # runs OFF the event loop -- a manual "Sync now" runs this on the uvicorn loop.
            # The policy's own decode semaphore bounds it alongside the upload doors.
            resolved[ref] = await asyncio.to_thread(
                _decide_and_store, user_id, note_id, data, content_type, name,
                file_intent=file_intent, budget=budget)
            uploaded += 1
        except Exception as e:  # noqa: BLE001
            if isinstance(e, errors.NoteConnRateLimited) and rate_limited_out is not None:
                # Fix round 1 (I8): the provider's rate limit stopped this copy. It waits, as a
                # storage-limit notice does: a retrying notice that spends NO attempt, and the
                # caller makes the note a leftover (a follow-up fetches it again). Not a failure.
                log.info("[note-sync] media %r on note %s waits on the rate limit", ref, note_id)
                rate_limited_out.append((ref, e.retry_after))
                if isinstance(ref, str) and ref:
                    notices[ref] = import_notice.notice_node(
                        "fetch_failed", name=m.get("name"), source_url=_media_source_url(m),
                        ref=ref, attempts=prior)
                continue
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
    totals.setdefault("rateLimitedRefs", []).extend(res.get("rateLimitedRefs", []))
    all_touched.extend(res.get("touched", []))


async def _reroute(*args: Any, pooled: bool) -> tuple[str | None, list[str]]:
    """NEW-5: the sibling reroute, in a worker thread for a pooled pass (its confirm waits on the
    import write lock, which must never be waited on from an event loop)."""
    if pooled:
        return await asyncio.to_thread(_reroute_resolved_body_to_sibling, *args, pooled=True)
    return _reroute_resolved_body_to_sibling(*args)


async def _resolve_links_final_pass(
    conn: sqlite3.Connection, user_id: str, source: dict[str, Any],
    touched: list[tuple[RemoteNote, str, str]], *, pooled: bool = False,
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
            sibling_id, reroute_failures = await _reroute(
                conn, user_id, source, rn, key, body, pooled=pooled)
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
) -> dict[str, Any]:
    """`budget` (Plan A Task 8): the member's `MediaBudget` for the whole pass; None reads one
    (a direct caller). `retry_bodies` (fix round 1, I4): `{import_key: stored body}` for a
    note re-imported only to retry its media (remote unchanged); see `_retry_source`.
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
        "noticeFailures": [], "rateLimitedRefs": [],
    }
    # Every ref THIS batch is attempting, so a whole-call exception below
    # (a batch-level failure, e.g. a malformed overall payload — NOT a
    # per-note one; `import_confirm` isolates those into its own `failed`
    # bucket and returns normally, see below) can still report every one of
    # them as not-stored — the cursor must not advance past ANY of them.
    remote_id_by_key = {key: rn.remote_id for rn, key in pairs}
    pooled = getattr(provider, "follow_up_on_rate_limit", False) is True  # NEW-4 / NEW-5
    # Plan E Task 9 fix round 1 (concern 4): a note that is not stored is named by its TITLE
    # for the member (`failures_json`), once per pass; the failure strings above stay by key.
    title_by_key = {e.get("importKey"): e.get("title") for e in entries}
    if budget is None:
        budget = media_policy.MediaBudget.for_member(user_id)
    payload = {"source": source["provider"], "destFolderId": dest_folder_id, "notes": entries}
    try:
        if pooled:
            # NEW-4: a pooled pass's write transaction waits its turn, off the event loop.
            r = await asyncio.to_thread(_import_confirm_serialized, user_id, payload, conn)
        else:
            r = notes_svc.import_confirm(user_id, payload, conn=conn)
    except Exception as e:  # noqa: BLE001 — one bad batch must not strand others or abort the sync
        log.warning("[note-sync] confirm failed for a batch of %d note(s): %s", len(entries), e)
        reason = NOT_STORED_RETRY_REASON
        if isinstance(e, notes_svc.DestinationFolderNotFound):
            # ⛔ M2: no retry fixes a deleted folder, so the member is never told "tried again"
            # unless something now makes it true. The pass-start heal found the folder; it went
            # while this pass ran. Heal again now (`import_confirm` rolled `conn` back, so no
            # write lock is held here): the next pass then imports into the new folder, and so
            # does every later batch of THIS pass (the source dict is the one they all read).
            # Its own connection, off the loop (the write lock may be busy).
            reason = await asyncio.to_thread(_dest_folder_missing_reason, user_id, source)
        prefix = (DEST_MISSING_FAILURE_PREFIX if isinstance(e, notes_svc.DestinationFolderNotFound)
                  else "confirm failed")
        result["failures"].append(f"{prefix} for a batch of {len(entries)} note(s): {reason}")
        result["notStoredRefs"].extend(remote_id_by_key.values())
        result["noticeFailures"].extend(
            _not_stored_notice(title_by_key.get(k), k, reason) for k in remote_id_by_key)
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
        reason = _member_reason(item.get("error"), key=fkey)  # m1: never raw text for a member
        result["failures"].append(f"note {fkey!r} could not be stored: {reason}")
        rid = remote_id_by_key.get(fkey)
        if rid is not None:
            result["notStoredRefs"].append(rid)
        result["noticeFailures"].append(_not_stored_notice(title_by_key.get(fkey), fkey, reason))

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
        if retry is not None:
            source_doc, retry_refs = retry
            media = [m for m in (rn.media or []) if m.get("ref") in retry_refs]

        resolved: dict[str, media_policy.StoredMedia] = {}
        notices: dict[str, dict] = {}
        waiting: list[tuple[str, float | None]] = []
        reuse = _media_reuse_on(provider)
        if media:
            # L4 (2026-11-03): an update reuses what this note already stored for an unchanged,
            # content-named ref (same URL, nothing fetched or copied); the rest is fetched.
            reused = (await asyncio.to_thread(
                _reusable_stored_media, conn, user_id, note_id, provider,
                [m.get("ref") for m in media]) if reuse and status != "created" else {})
            to_fetch = [m for m in media if m.get("ref") not in reused]
            resolved, notices, up, med_failures = (await _upload_media_for_note(
                provider, creds, user_id, note_id, to_fetch,
                prior_attempts=(notice_attempts or {}).get(key, {}), budget=budget,
                rate_limited_out=waiting) if to_fetch else ({}, {}, 0, []))
            resolved = {**reused, **resolved}
            if waiting:
                known = [w for _r, w in waiting if isinstance(w, (int, float))]
                result["rateLimitedRefs"].append((rn.remote_id, max(known) if known else None))
            result["mediaUploaded"] += up
            result["failures"].extend(med_failures)
            # Concern 5: a file the bytes said is a raster was stored as an image; its chip
            # placeholder becomes an image placeholder before the rewrite (opted-in providers only:
            # for any other, a file-kind item is never stored as an image).
            promoted = {m["ref"] for m in media if m.get("kind") != "image" and isinstance(m.get("ref"), str)
                        and getattr(resolved.get(m["ref"]), "kind", None) == "image"}
            if promoted:
                source_doc = chips_to_images(source_doc, promoted)
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
            if reuse:
                _record_stored_media(conn, user_id, note_id, provider, resolved,
                                     _placeholder_refs(rn.doc), body)
            # I8: an attachment waiting on the rate limit is no failure to list.
            waiting_refs = {r for r, _w in waiting}
            result["noticeFailures"].extend(_notice_failures(
                _note_title(rn, key), body,
                {r: n for r, n in notices.items() if r not in waiting_refs}))
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
            sibling_id, reroute_failures = await _reroute(
                conn, user_id, source, rn, key, body, pooled=pooled)
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


_FOLDER_MISSING = object()


def _existing_folder(conn: sqlite3.Connection, user_id: str, dest: str, parts: list[str]) -> Any:
    """The folder `import_confirm` would file `parts` under `dest` into, if it exists, WITHOUT
    making any (the read half of `notes.ensure_folder_path`, same segment rule and the same
    depth clamp `import_confirm` applies). `_FOLDER_MISSING` when a segment is not there;
    `dest or None` for no parts."""
    depth = notes_svc._folder_depth(conn, user_id, dest) if dest else 0
    parts = list(parts)[:max(0, notes_svc.MAX_FOLDER_DEPTH - depth)]
    if not parts:
        return dest or None
    pid = dest or ""
    for raw in parts:
        name = (raw or "").strip()[:80] or "Untitled"
        row = notes_svc.find_folder_segment(conn, user_id, pid, name)   # the same rule (root: any casing)
        if row is None:
            return _FOLDER_MISSING
        pid = row["id"]
    return pid


def _apply_source_renames(
    conn: sqlite3.Connection, user_id: str, source: dict[str, Any], provider: NoteProvider,
    remote_notes: list[RemoteNote], import_keys: list[str],
) -> set[str]:
    """L2 (live Obsidian probe 2026-11-03): before the existing-row read, re-key the note a
    remote RENAME moved, so it updates in place instead of a duplicate being created. Only for a
    provider that reports renames (`pending_renames`/`clear_renames`; Obsidian, from what one
    final push showed: `obsidian_staging._record_renames`). Every other provider makes no query.
    Returns the OLD remote ids it moved, which the caller drops from this chunk.

    For each rename whose new path is in this chunk, all of:
      * no row (live or trashed: the unique index covers both) holds the new key yet;
      * a row holds the old key, live or in the member's trash;
      * that row was last imported from the old path's CURRENT staged state: its
        `import_remote_rev` is the old staged row's `updated_at` (fix round 1). Staging paired
        the new body with the old path's latest STAGED body; this makes it the last IMPORTED one,
        as the spec asks. An Obsidian edit pushed but never synced, then a rename, fails it and
        falls back to today's behaviour: the old note takes the edit (or its conflict), the new
        path is a new note, and the old one is tagged after two strikes. Nothing is lost and
        nothing goes untracked;
    then the row's `import_key` moves to the new key in one raw write that never touches
    `updated_at`, `imported_at` or `import_remote_rev`. Its id, history, links, favourites and
    content stay. Its conflict sibling (`<old key>#remote`) moves with it when the new
    sibling key is free. Its old remote-index row goes (the new path's was written by
    `_touch_remote_index`), and a `source-deleted` tag comes off. The old path's RemoteNote, if
    this chunk holds one, is dropped by the caller: confirming it would CREATE a note at the old
    key that no remote-index row tracks. Then the ordinary import runs:
      * a TRASHED note stays in the trash; the new key reaches `_prepare_import`'s kept-in-trash
        path (concern 2), never a live copy;
      * an UNEDITED note is updated by `import_confirm` like any remote change, which files it
        in the new folder and gives it the new title;
      * a note the member EDITED is never rewritten. Its folder moves unless the member had
        filed it elsewhere in UCT, and its title only while it was still the old file name. Its
        remote revision is NOT stamped (fix round 1): the conflict gate decides. A rename that
        kept the file's mtime (Obsidian's own rename does) reads "remote unchanged"; one that
        moved it is a remote change and gets a "(synced copy)".
    Anything else applies nothing and the note imports as before. Every record seen here is
    cleared. Commits."""
    pending = getattr(provider, "pending_renames", None)
    if pending is None:
        return set()
    by_id = {rn.remote_id: (rn, key) for rn, key in zip(remote_notes, import_keys) if key}
    hints = pending(conn, list(by_id))
    if not hints:
        return set()
    dest = source.get("destFolderId") or ""
    moved: set[str] = set()

    def key_taken(key: str) -> bool:
        return conn.execute("SELECT 1 FROM j2_notes WHERE user_id = ? AND import_key = ?",
                            (user_id, key)).fetchone() is not None

    for h in hints:
        rn, new_key = by_id[h["newId"]]
        old_key = provider.import_key(source["remoteId"], h["oldId"])
        if old_key == new_key or key_taken(new_key):
            continue
        old = conn.execute(
            "SELECT id, title, folder_id, tags, updated_at, imported_at, import_remote_rev,"
            " deleted_at FROM j2_notes WHERE user_id = ? AND import_key = ?",
            (user_id, old_key)).fetchone()
        if old is None or h.get("oldRev") is None or old["import_remote_rev"] != h["oldRev"]:
            continue
        sets: dict[str, Any] = {"import_key": new_key}
        tags = json.loads(old["tags"] or "[]")
        if "source-deleted" in tags:
            sets["tags"] = json.dumps([t for t in tags if t != "source-deleted"])
        if old["deleted_at"] is None and edited_since_import(old["updated_at"], old["imported_at"]):
            was = _existing_folder(conn, user_id, dest, h.get("oldFolderPath") or [])
            if was is not _FOLDER_MISSING and (old["folder_id"] or None) == (was or None):
                parts = list(rn.folder_path or [])
                depth = notes_svc._folder_depth(conn, user_id, dest) if dest else 0
                parts = parts[:max(0, notes_svc.MAX_FOLDER_DEPTH - depth)]
                sets["folder_id"] = (notes_svc.ensure_folder_path(user_id, parts, dest, conn=conn)
                                     if parts else (dest or None))
            title = notes_svc.import_title(rn.title)
            if old["title"] == h.get("oldFallbackTitle") and title != old["title"]:
                sets["title"] = title
        cols = ", ".join(f"{c} = ?" for c in sets)
        conn.execute(f"UPDATE j2_notes SET {cols} WHERE id = ? AND user_id = ? AND import_key = ?",
                     (*sets.values(), old["id"], user_id, old_key))
        if not key_taken(f"{new_key}#remote"):
            conn.execute("UPDATE j2_notes SET import_key = ? WHERE user_id = ? AND import_key = ?",
                         (f"{new_key}#remote", user_id, f"{old_key}#remote"))
        conn.execute(
            "DELETE FROM j2_note_remote_index WHERE user_id = ? AND source_id = ? AND remote_id = ?",
            (user_id, source["id"], h["oldId"]))
        moved.add(h["oldId"])
    provider.clear_renames(conn, [h["newId"] for h in hints])
    conn.commit()
    if moved:
        log.info("[note-sync] source %s: %d renamed note(s) kept their note (re-keyed)",
                 source.get("id"), len(moved))
    return moved


def _adopt_file_imports(
    conn: sqlite3.Connection, user_id: str, provider: NoteProvider,
    remote_notes: list[RemoteNote], import_keys: list[str], pass_state: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    """Plan E Task 8: before the existing-row read, re-key the member's file-imported notes
    (`.enex`) that these live notes ARE, so they update in place instead of duplicating. Runs on
    every pass (a later file import adds candidates), and only for a provider that sets
    `adopt_import_source`: every other provider makes no adoption query at all."""
    import_source = getattr(provider, "adopt_import_source", None)
    if not import_source:
        return [], []
    keys = [k for k in import_keys if k]
    held: set[str] = set()
    for i in range(0, len(keys), 500):  # sqlite variable-limit safety
        chunk = keys[i:i + 500]
        held.update(r[0] for r in conn.execute(
            f"SELECT import_key FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL "
            f"AND import_key IN ({','.join('?' * len(chunk))})", (user_id, *chunk)))
    candidates = [(k, rn) for rn, k in zip(remote_notes, import_keys) if k and k not in held]
    adopted, failures = adoption.adopt_file_imports(
        conn, user_id, import_source, candidates, pass_state=pass_state)
    if adopted:
        conn.commit()
    return adopted, failures


def _prepare_import(
    conn: sqlite3.Connection, user_id: str, source: dict[str, Any], provider: NoteProvider,
    remote_notes: list[RemoteNote], retry_only: set[str], adoption_state: dict | None,
    budget: media_policy.MediaBudget,
) -> dict[str, Any]:
    """Everything `_import_remote_notes` does BEFORE its first confirm: the storage-wait flip,
    the `.enex` adoption re-keys, the existing-row read, the revision backfill, and the routing
    of each note (normal, conflict sibling, member-owned, media retry, kept in trash) with the
    conflict gate's hash baselines. Synchronous and on `conn`; a pooled pass runs it in a worker
    thread under `_IMPORT_WRITE_LOCK` (`_prepare_import_locked`). `budget` (NEW-3) is read by the
    caller BEFORE the lock: its usage read walks the member's stored media."""
    if _storage_has_freed(budget):
        try:
            _flip_storage_waits(conn, user_id)
        except sqlite3.Error as e:   # a busy DB defers the wait one pass; never fails the sync
            log.warning("[note-sync] storage-wait flip deferred (%s)", type(e).__name__)
    import_keys = [
        provider.import_key(source["remoteId"], rn.remote_id) for rn in remote_notes
    ]
    # L2: a remote rename moves the existing note onto its new key first (Obsidian only). The
    # old path's own note, if listed in this chunk, is dropped: confirming it would create an
    # untracked note at the key the rename just vacated.
    moved = _apply_source_renames(conn, user_id, source, provider, remote_notes, import_keys)
    if moved:
        kept = [(rn, k) for rn, k in zip(remote_notes, import_keys) if rn.remote_id not in moved]
        remote_notes, import_keys = [rn for rn, _k in kept], [k for _rn, k in kept]
    adopted, adoption_failures = _adopt_file_imports(
        conn, user_id, provider, remote_notes, import_keys, adoption_state)
    existing = _bulk_existing_note_meta(conn, user_id, import_keys)
    # Fix round 1 (concern 2): the member's trashed rows among the keys with no live row.
    trashed_rows = _trashed_rows_by_key(
        conn, user_id, [k for k in import_keys if k not in existing])
    kept_in_trash = 0
    # Task 8 review M1: a row adopted THIS pass is judged by the file importer's own
    # predicate (it forgives the old importer's image-finalize write), never a second rule.
    adopted_unedited = {a["toKey"] for a in adopted if not a["editedSinceImport"]}
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
    retry_skipped: list[str] = []

    for rn, key in zip(remote_notes, import_keys):
        meta = existing.get(key)
        if meta is None and key in trashed_rows and rn.remote_id not in retry_only:
            # Concern 2: the member trashed this note in UCT and the remote changed since. The
            # trash is theirs: nothing comes back into the Notebook (and `import_confirm`
            # would refuse the key anyway: the trashed row still holds it), but nothing is lost
            # either: the new content goes INTO the trashed row, `deleted_at` kept, and the
            # stamped revision makes NEW-7 skip it from the next pass on. A restore shows it.
            trow = trashed_rows[key]
            entry = _build_confirm_entry(rn, key)
            if trow["importHash"] == notes_svc._import_payload_hash(entry):
                # NEW-4: the trashed row already holds exactly this: nothing to write.
                kept_in_trash += 1
                continue
            if _is_conflict(trow) or not import_provenance.stamp_readable(trow["importedAt"]):
                # NEW-1: the member edited this note before trashing it. Their words are never
                # overwritten by a remote change: only the revision is stamped (so NEW-7 and
                # the incremental listing stop asking), and the note stays trashed. Final
                # review: a missing or unreadable `imported_at` cannot be dated, so it is hands
                # off the same way (recover's rule, R4), never read as unedited.
                _stamp_trashed_row_revision(conn, user_id, trow["id"], rn.updated_at or None)
            else:
                _write_into_trashed_row(conn, user_id, trow["id"], entry)
            kept_in_trash += 1
            continue
        edited = meta is not None and _is_conflict(meta) and key not in adopted_unedited
        # `entry` is what WOULD be written under the ORIGINAL import_key —
        # built unconditionally (not just in the else-branch) because
        # Fix-round-3 needs its hash regardless of which path is taken.
        entry = _build_confirm_entry(rn, key)
        if rn.remote_id in retry_only:
            # C1 belt guard: a retry-only ref may only retry media on the stored body.
            if (meta is not None and not edited and meta.get("pendingBody")
                    and meta.get("importHash") == notes_svc._import_payload_hash(entry)):
                normal_items.append((entry, rn, key))
                retry_bodies[key] = meta["pendingBody"]
            else:
                user_owned_unchanged += 1
                retry_skipped.append(((meta or {}).get("title") or rn.title or key, key))
            continue
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
            edited
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
        elif edited:
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
            # Fix round 1 (I4): remote unchanged and media still pending -> this pass
            # is a media RETRY; it builds on the stored body (`_retry_source`).
            if (meta is not None and meta.get("pendingBody")
                    and meta.get("importHash") == notes_svc._import_payload_hash(entry)):
                retry_bodies[key] = meta["pendingBody"]

    return {
        "budget": budget, "adopted": adopted, "adoption_failures": adoption_failures,
        "existing": existing, "normal_items": normal_items, "sibling_items": sibling_items,
        "conflict_tag_updates": conflict_tag_updates, "pre_confirm_conflicts": pre_confirm_conflicts,
        "user_owned_unchanged": user_owned_unchanged, "retry_bodies": retry_bodies,
        "retry_skipped": retry_skipped, "kept_in_trash": kept_in_trash,
    }


def _prepare_import_locked(*args: Any) -> dict[str, Any]:
    """N-A: a pooled pass's pre-confirm writes take `_IMPORT_WRITE_LOCK` FIRST and commit before
    it is released. Before, they opened a write transaction (adoption re-keys, conflict
    baselines) and the pass then WAITED on the lock holding SQLite's write lock, while the lock's
    holder sat out busy_timeout inside `import_confirm` and lost its whole batch as "database is
    locked"."""
    conn = args[0]
    with _IMPORT_WRITE_LOCK:
        _refuse_open_transaction(conn)
        try:
            out = _prepare_import(*args)
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            _write_gap()
    return out


def _trashed_rows_by_key(conn: sqlite3.Connection, user_id: str,
                         keys: list[str]) -> dict[str, dict[str, Any]]:
    """{import_key: {id, updatedAt, importedAt, importHash}} of the member's TRASHED rows among
    `keys` (concern 2)."""
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(keys), 500):  # sqlite variable-limit safety
        chunk = [k for k in keys[i:i + 500] if k]
        if not chunk:
            continue
        for row in conn.execute(
                f"SELECT id, import_key, updated_at, imported_at, import_hash FROM j2_notes "
                f"WHERE user_id = ? AND deleted_at IS NOT NULL "
                f"AND import_key IN ({','.join('?' * len(chunk))})", (user_id, *chunk)):
            out[row["import_key"]] = {"id": row["id"], "updatedAt": row["updated_at"],
                                      "importedAt": row["imported_at"],
                                      "importHash": row["import_hash"]}
    return out


def _stamp_trashed_row_revision(conn: sqlite3.Connection, user_id: str, note_id: str,
                                remote_rev: str | None) -> None:
    """NEW-1: a member-edited trashed note learns the remote's revision and nothing else."""
    conn.execute("UPDATE j2_notes SET import_remote_rev = ? "
                 "WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
                 (remote_rev, note_id, user_id))


def _write_into_trashed_row(conn: sqlite3.Connection, user_id: str, note_id: str,
                            entry: dict[str, Any]) -> None:
    """Concern 2: the remote's new content written into a note the member trashed, the way
    `import_confirm`'s update branch writes a note (same derivations, same columns, the folder
    left where the member had it) but keeping `deleted_at`, so the note stays in the trash and a
    restore brings back the latest version. `import_remote_rev` is stamped, so NEW-7 skips it
    from the next pass on. Its media stays pending (`import_media_pending`): a restored note's
    next pass copies the images. One INFO line per pass (the caller), never a member warning.
    NEW-1: only ever for an UNEDITED row (the caller checks), and the content it replaces is
    checkpointed into version history first, as `import_confirm`'s recover branch does."""
    full = conn.execute("SELECT * FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
                        (note_id, user_id)).fetchone()
    if full is None:
        return
    notes_svc._maybe_capture_version(conn, note_id, user_id, full, force=True)
    now = notes_svc._now_iso()
    body_json = notes_svc._imported_widgets_private(notes_svc._validate_body_json(entry["bodyJson"]))
    body_plain = notes_svc.extract_plain_text(body_json)
    conn.execute(
        "UPDATE j2_notes SET title=?, body_json=?, body_plain=?, first_image_url=?, tags=?, "
        "import_hash=?, import_media_pending=?, import_links_pending=?, imported_at=?, "
        "updated_at=?, import_remote_rev=? "
        "WHERE id=? AND user_id=? AND deleted_at IS NOT NULL",
        (notes_svc.import_title(entry.get("title")), json.dumps(body_json), body_plain,
         notes_svc._extract_first_image(body_json),
         json.dumps(notes_svc._validate_tags(entry.get("tags"))),
         notes_svc._import_payload_hash(entry), import_notice.media_pending_state(body_json),
         1 if notes_svc._body_has_import_link(body_json) else 0, now,
         notes_svc._import_date(entry.get("updatedAt"), now), entry.get("updatedAt") or None,
         note_id, user_id))
    notes_svc._sync_note_sidecars(conn, user_id, note_id, body_json, body_plain)


async def _import_remote_notes(
    user_id: str, source: dict[str, Any], provider: NoteProvider, creds: dict[str, Any],
    remote_notes: list[RemoteNote], *, heal: bool = True, adoption_state: dict | None = None,
    retry_only: set[str] | None = None,
) -> dict[str, Any]:
    """`retry_only` (Plan E Task 9 fix round 1, C1): remote ids in this call ONLY to retry their
    pending media (`_pending_media_refs`). Such a note goes through the media-retry path
    (`retry_bodies`) when its payload hash equals the stored `import_hash`; otherwise it is not
    written at all, counted as skipped and named. A retry is never a content sync."""
    retry_only = retry_only or set()
    # NEW-4 / N-A: a pooled (opt-in) pass's writes before and in its confirms take the import
    # write lock; every other provider runs exactly as before.
    pooled = getattr(provider, "follow_up_on_rate_limit", False) is True
    conn = get_connection()
    try:
        # Plan A Task 8: ONE media budget for this whole pass (one memoised usage read), and
        # the storage wait: once space has freed, this member's notes waiting at
        # `import_media_pending = 2` go back to 1 BEFORE the existing-meta read, so the
        # confirm below re-imports them like any other retry.
        budget = (await asyncio.to_thread(media_policy.MediaBudget.for_member, user_id) if pooled
                  else media_policy.MediaBudget.for_member(user_id))
        prep_args = (conn, user_id, source, provider, remote_notes, retry_only, adoption_state,
                     budget)
        prep = (await asyncio.to_thread(_prepare_import_locked, *prep_args) if pooled
                else _prepare_import(*prep_args))
        budget = prep["budget"]
        adopted, adoption_failures = prep["adopted"], prep["adoption_failures"]
        existing = prep["existing"]
        normal_items, sibling_items = prep["normal_items"], prep["sibling_items"]
        conflict_tag_updates = prep["conflict_tag_updates"]
        pre_confirm_conflicts = prep["pre_confirm_conflicts"]
        user_owned_unchanged = prep["user_owned_unchanged"] + prep["kept_in_trash"]
        retry_bodies, retry_skipped = prep["retry_bodies"], prep["retry_skipped"]
        if prep["kept_in_trash"]:
            log.info("[note-sync] source %s: %d note(s) the member trashed changed remotely; the "
                     "new content was kept in the trashed note", source.get("id"),
                     prep["kept_in_trash"])

        totals: dict[str, Any] = {
            "created": 0, "updated": 0, "skipped": user_owned_unchanged, "mediaUploaded": 0,
            "conflicts": pre_confirm_conflicts, "failures": [], "notStoredRefs": [],
            "noticeFailures": [], "rateLimitedRefs": [],
        }
        # Plan E Task 8: the adoption seam's count and its Plan D-shaped failures.
        totals["adopted"] = len(adopted)
        totals["failures"].extend(
            f"media retry skipped for {title!r}: the note as fetched now differs from the stored "
            f"one, so it was left as it is" for title, _key in retry_skipped)
        # m2: named for the member by title, through Concern 4's one naming path
        totals["noticeFailures"].extend(
            _not_stored_notice(title, key, RETRY_SKIPPED_REASON) for title, key in retry_skipped)
        totals["noticeFailures"].extend(adoption_failures)
        totals["failures"].extend(f["reason"] for f in adoption_failures)
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
        for batch in _chunks(normal_items,
                             POOLED_CONFIRM_BATCH_SIZE if pooled else _CONFIRM_BATCH_SIZE):
            entries = [e for e, _rn, _k in batch]
            pairs = [(rn, k) for _e, rn, k in batch]
            res = await _confirm_and_resolve_batch(
                conn, user_id, source, provider, creds,
                source.get("destFolderId"), entries, pairs, notice_attempts=notice_attempts,
                budget=budget, retry_bodies=retry_bodies,
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
            link_result = await _resolve_links_final_pass(conn, user_id, source, all_touched,
                                                          pooled=pooled)
            totals["conflicts"] += link_result["conflicts"]
            totals["failures"].extend(link_result["failures"])
        except Exception as e:  # noqa: BLE001
            totals["failures"].append(f"link resolution pass failed: {e}")

        # Plan A Task 4: heal the member's still-pending links -- a link written in an
        # EARLIER round whose target has only now arrived. Bounded (`limit`, index-served
        # on `import_links_pending`), timestamp-neutral, and never fails the sync: a
        # failure here is one named failure, and the marks stay for the next round.
        # Final review I2: up to `HEAL_LIMIT` bodies parsed and rewritten -- never on the event
        # loop (a manual "Sync now" runs this pass on the uvicorn loop). A worker thread, on
        # its OWN connection (`conn=None`): a sqlite connection never crosses threads. Same
        # writes as before (timestamp-neutral, per-note edited re-check inside the heal).
        # Plan E Task 6 review R1: a caller importing in CHUNKS passes `heal=False` and heals
        # once, after its last chunk, naming this pass's notes (`linkedNoteIds`): a forward link
        # into a later chunk is pending until then, and the random sweep alone heals it only by
        # chance.
        totals["linkedNoteIds"] = [note_id for rn, _key, note_id in all_touched if rn.links]
        if heal:
            try:
                conn.commit()   # nothing of this pass left open to make the heal's writes wait
                heal_result = await asyncio.to_thread(heal_pending_links, user_id)
                totals["failures"].extend(heal_result.get("failures", []))
            except Exception as e:  # noqa: BLE001
                totals["failures"].append(f"link heal pass failed: {e}")
        else:
            conn.commit()

        return totals
    finally:
        conn.close()
