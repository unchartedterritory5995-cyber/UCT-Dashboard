"""Plan F Task 6: selection, the one hands-off guard, and the dry-run scan.

`scan` reads every imported note of every member (or of `members`), one body at a time, and
reports what the repair WOULD do. It never writes; the CLI runs it on a read-only connection.
`plan_note` is the one place a note's repair is decided, and the only caller of `hands_off`.

Classes (`classify`): the file importer stores its adapter LABEL as `import_source` ('Notion',
'Obsidian', 'Files (Markdown, Text, HTML, Word)', ...) and the connector engine stores the
lowercase provider id, so an exact match against the registry separates them.
  * FILE: link repair, then the lost-file-link and missing-media markers; hotlinks listed.
  * CONNECTOR_ORPHANED (a provider id with no active source): link repair only. Its pending
    media refs are never marked: the engine may still retry them (`media_pending_state == 1`).
  * CONNECTOR_LIVE / CONNECTOR_RELIST: counted, never planned (the engine owns them).
  * the sample notebook: skipped.

Rulings applied (progress.md): C3 (legacy finalize is `notes._edited_since_file_import`'s own
composition), C4 (an unreadable stamp is hands off, counted `unreadableStamp`), C5 (the
converter precondition is 01:47 ET on 2026-11-03), C6 (`sample_marker.is_sample` for stored
rows), C11 (`byClassShape`: shapes per class), Task 3/4 (count-only actions never make a write;
`lostLinks`).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator

from api.services.journal_two import hotlink_fetch, import_provenance, import_repair, sample_marker
from api.services.journal_two import notes
from api.services.journal_two.import_repair import links, media, shapes, store
from api.services.journal_two.note_connectors import engine, registry

logger = logging.getLogger(__name__)

FLAG = "NOTE_IMPORT_REPAIR_ENABLED"
RUN_ID_DEFAULT = "2026-11-connector-fidelity-f"
MAX_SCAN_BODY_BYTES = 4_000_000
SAMPLE_PER_SHAPE = 5
#: C5: the nightly re-convert (`main.py`, 01:47 America/New_York) on 2026-11-03, after DST
#: ended on 11-01: 01:47 EST = 06:47Z. A test derives it from the zone.
CONVERTER_NIGHTLY_AT = "2026-11-03T06:47:00+00:00"

FILE, LIVE, RELIST, ORPHANED = (import_repair.FILE, import_repair.CONNECTOR_LIVE,
                                import_repair.CONNECTOR_RELIST, import_repair.CONNECTOR_ORPHANED)
_RELIST_PROVIDER = "obsidian"

_NOTE_FILTER = ("imported_at IS NOT NULL AND import_key IS NOT NULL AND deleted_at IS NULL")


@dataclass(frozen=True)
class NoteRow:
    id: str
    import_source: str | None
    import_key: str
    updated_at: str | None
    imported_at: str | None
    body_bytes: int


@dataclass
class NotePlan:
    note_class: str
    shapes: dict[str, int]
    kept_edited: bool
    legacy_finalize: bool
    new_doc: dict | None
    actions: list[str]
    hotlinks: list[str]
    loss: bool
    #: Task 3/4 carry-ins: relative links to a FILE that never came over (marked, counted).
    lost_links: int = 0
    #: C4: a stamp that cannot be read; the note is hands off.
    unreadable_stamp: bool = False
    #: The stored body is not a JSON object; nothing is planned.
    unreadable_body: bool = False
    #: Task 7 review M-2: sha256 of the stored body text the plan was made from. The apply writes
    #: only while the stored body still hashes to it (a timestamp-neutral writer, such as the
    #: live link heal pass, does not move `updated_at`).
    body_sha: str | None = None


#: THE body hash is the engine's: `_apply_resolved_body(expected_body_hash=)` compares it inside
#: the UPDATE, so the plan's hash and the write's check can never differ.
body_sha = engine.stored_body_sha


def iter_members(conn) -> Iterator[str]:
    for row in conn.execute(
            f"SELECT DISTINCT user_id FROM j2_notes WHERE {_NOTE_FILTER} ORDER BY user_id").fetchall():
        yield row[0]


def iter_note_rows(conn, user_id: str) -> Iterator[NoteRow]:
    """The member's imported notes WITHOUT their bodies (`load_body` reads one at a time).
    `body_bytes` is the stored body's size in bytes."""
    for r in conn.execute(
            "SELECT id, import_source, import_key, updated_at, imported_at,"
            " length(CAST(body_json AS BLOB)) FROM j2_notes"
            f" WHERE user_id = ? AND {_NOTE_FILTER} ORDER BY id", (user_id,)).fetchall():
        yield NoteRow(id=r[0], import_source=r[1], import_key=r[2], updated_at=r[3], imported_at=r[4],
                      body_bytes=int(r[5] or 0))


def load_body(conn, note_id: str) -> str:
    row = conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
    return row[0] if row is not None and isinstance(row[0], str) else ""


def active_providers(conn, user_id: str) -> set[str]:
    return {r[0] for r in conn.execute(
        "SELECT provider FROM j2_note_sources WHERE user_id = ? AND status = 'active' AND sync_enabled = 1",
        (user_id,))}


def classify(row: NoteRow, active: set[str]) -> str | None:
    """The note's class, or None for the sample notebook (C6: the stored-row check)."""
    if sample_marker.is_sample(row.import_source):
        return None
    # An archived provider (`registry.ARCHIVED_PROVIDERS`) is still a connector id, never a file
    # importer label, so its notes keep the class they had before the archive: CONNECTOR_ORPHANED,
    # or CONNECTOR_LIVE if a stored source row is still active (counted, never planned). The engine
    # now skips such a source, so "the engine owns it" is not literally true for one; leaving it
    # unplanned is what keeps the repair from writing to it.
    if row.import_source in registry._REGISTRY or row.import_source in registry.ARCHIVED_PROVIDERS:
        if row.import_source in active:
            return RELIST if row.import_source == _RELIST_PROVIDER else LIVE
        return ORPHANED
    return FILE


def hands_off(row: NoteRow) -> bool:
    """THE guard: never write a note edited since its import. Called only inside `plan_note`."""
    return import_provenance.edited_since_import(row.updated_at, row.imported_at)


def plan_note(conn, user_id: str, row: NoteRow, note_class: str, index: links.FileKeyIndex) -> NotePlan:
    """What the repair would do to one note. Reads its body; writes nothing."""
    body_text = load_body(conn, row.id)
    try:
        doc = json.loads(body_text) if body_text else None
    except ValueError:
        doc = None
    if not isinstance(doc, dict):
        return NotePlan(note_class, {}, False, False, None, [], [], False, unreadable_body=True)
    found = shapes.detect_shapes(doc)
    if note_class == FILE:
        orphans = shapes.orphan_media_count(user_id, row.id, body_text)
        if orphans:
            found["orphan_media"] = orphans
    planned_sha = body_sha(body_text)
    del body_text
    # Fix round 1, I-1: a link to a file that never came over is a lost file too. Counted for
    # EVERY FILE note, edited or not (counting reads; only the write waits on the guard).
    lost_links = 0
    if note_class == FILE:
        _marked, lost_links = media.lost_file_link_notices(doc, import_key=row.import_key,
                                                           import_source=row.import_source or "",
                                                           index=index)
        del _marked
    loss = note_class == FILE and (lost_links > 0 or any(found.get(s) for s in shapes.LOSS_SHAPES))

    # C4: an unreadable stamp makes `edited_since_import` answer "not edited"; the repair must
    # read it as hands off instead. A readability precondition, not a second "edited" rule.
    readable = (import_provenance.stamp_readable(row.updated_at)
                and import_provenance.stamp_readable(row.imported_at))
    kept_edited = (not readable) or hands_off(row)
    if kept_edited:
        legacy = False
        if readable and note_class == FILE:
            # C3: the file importer's own composition, never restated here.
            legacy = not notes._edited_since_file_import(
                conn, user_id, {"id": row.id, "updated_at": row.updated_at, "imported_at": row.imported_at})
        return NotePlan(note_class, found, True, legacy, None, [], [], loss, lost_links=lost_links,
                        unreadable_stamp=not readable)

    if note_class not in (FILE, ORPHANED):
        return NotePlan(note_class, found, False, False, None, [], [], loss)
    out, actions = links.repair_links(doc, note_class=note_class, import_key=row.import_key,
                                      import_source=row.import_source or "", index=index, conn=conn,
                                      user_id=user_id)
    lost_links, hotlinks = 0, []
    if note_class == FILE:
        out, lost_links = media.lost_file_link_notices(out, import_key=row.import_key,
                                                       import_source=row.import_source or "", index=index)
        out, _names = media.missing_notices(out)
        hotlinks = media.hotlinks(out)
    # Count-only actions (links.COUNT_ONLY_ACTIONS) leave the body as it was: a write is planned
    # only when the body changed.
    return NotePlan(note_class, found, False, False, out if out != doc else None, actions, hotlinks, loss,
                    lost_links=lost_links, body_sha=planned_sha)


def _peak_rss_mb() -> float:
    try:
        import resource
    except ImportError:  # Windows: no getrusage
        return 0
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)  # Linux: KB


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sources(conn, members: list[str] | None) -> tuple[int, int]:
    """(active sources not fully synced since the converter ran, active Obsidian sources)."""
    stale = relist = 0
    for r in conn.execute("SELECT user_id, provider, last_full_sync_at FROM j2_note_sources"
                          " WHERE status = 'active' AND sync_enabled = 1").fetchall():
        if members is not None and r[0] not in members:
            continue
        # fully synced since the converter ran: a readable stamp not earlier than it
        fresh = (import_provenance.stamp_readable(r[2])
                 and not import_provenance.is_later(CONVERTER_NIGHTLY_AT, r[2]))
        stale += not fresh
        if r[1] == _RELIST_PROVIDER:
            relist += 1
    return stale, relist


class _Tally:
    """The report both `scan` and `apply` build, one note at a time."""

    def __init__(self, conn, run_id: str, members: list[str] | None, mode: str):
        self.started = _now()
        self.run_id, self.mode = run_id, mode
        self.stale, relist = _sources(conn, members)
        self.totals: dict[str, Any] = {
            "members": 0, "notesScanned": 0, "tooLargeToScan": 0,
            "byClass": dict.fromkeys(import_repair.NOTE_CLASSES, 0), "byShape": {}, "bySource": {},
            "wouldRepairNotes": 0, "hotlinksToFetch": 0, "keptEdited": 0, "legacyFinalize": 0,
            "obsidianSourcesToRelist": relist, "noticeMembers": 0,
            "unreadableStamp": 0, "byClassShape": {}, "lostLinks": 0, "unreadableBody": 0,
        }
        self.per_member: list[dict] = []
        self.samples: dict[str, list[str]] = {}
        self.mine: dict = {}

    def member(self, user_id: str) -> None:
        self.mine = {"userId": user_id, "notes": 0, "wouldRepair": 0, "byShape": {}, "lossNotes": 0,
                     "lostLinks": 0}

    def row(self, note_class: str) -> None:
        self.totals["notesScanned"] += 1
        self.totals["byClass"][note_class] += 1
        self.mine["notes"] += 1

    def too_large(self) -> None:
        self.totals["tooLargeToScan"] += 1

    def plan(self, row: NoteRow, note_class: str, plan: NotePlan) -> None:
        t, mine = self.totals, self.mine
        t["unreadableBody"] += plan.unreadable_body
        side = "edited" if plan.kept_edited else "unedited"
        for shape, n in plan.shapes.items():
            t["byShape"].setdefault(shape, {"unedited": 0, "edited": 0})[side] += n
            t["byClassShape"].setdefault(note_class, {}).setdefault(shape, {"unedited": 0, "edited": 0})[side] += n
            source = t["bySource"].setdefault(row.import_source or "", {})
            source[shape] = source.get(shape, 0) + n
            mine["byShape"][shape] = mine["byShape"].get(shape, 0) + n
            bucket = self.samples.setdefault(shape, [])
            if len(bucket) < SAMPLE_PER_SHAPE:
                bucket.append(row.id)
        t["keptEdited"] += plan.kept_edited
        t["legacyFinalize"] += plan.legacy_finalize
        t["unreadableStamp"] += plan.unreadable_stamp
        t["hotlinksToFetch"] += len(plan.hotlinks)
        t["lostLinks"] += plan.lost_links
        mine["lostLinks"] += plan.lost_links
        if writes(plan):
            t["wouldRepairNotes"] += 1
            mine["wouldRepair"] += 1
        if plan.loss:
            mine["lossNotes"] += 1

    def member_end(self) -> int:
        """Close the member; returns its loss-note count."""
        mine = self.mine
        if mine["notes"]:
            self.totals["members"] += 1
        if mine["byShape"]:
            self.per_member.append(mine)
        if mine["lossNotes"]:
            self.totals["noticeMembers"] += 1
        return mine["lossNotes"]

    def report(self, **extra: Any) -> dict:
        return {"runId": self.run_id, "mode": self.mode, "startedAt": self.started, "finishedAt": _now(),
                "peakRssMb": _peak_rss_mb(), "sourcesNotFullSyncedSinceConverter": self.stale,
                "totals": self.totals, "perMember": self.per_member, "samples": self.samples, **extra}


def writes(plan: NotePlan) -> bool:
    """Would the apply write this note? A changed body, or a hotlink to swap for our copy (M-2)."""
    return not plan.kept_edited and (plan.new_doc is not None or bool(plan.hotlinks))


def scan(conn, *, run_id: str, members: list[str] | None = None, sleep_ms: int = 0,
         rss_ceiling_mb: float | None = None) -> dict:
    """The dry-run report. Never writes. With `rss_ceiling_mb` (the CLI passes it: re-review
    T8-M5), memory more than that above the start raises `RepairAborted`, checked every
    `RSS_CHECK_EVERY` notes, exactly as `apply` does."""
    tally = _Tally(conn, run_id, members, "dry-run")
    rss_start = _rss_mb() if rss_ceiling_mb is not None else 0.0
    planned = 0
    for user_id in (members if members is not None else list(iter_members(conn))):
        active = active_providers(conn, user_id)
        index: links.FileKeyIndex | None = None
        tally.member(user_id)
        for row in iter_note_rows(conn, user_id):
            note_class = classify(row, active)
            if note_class is None:
                continue
            tally.row(note_class)
            if row.body_bytes > MAX_SCAN_BODY_BYTES:
                tally.too_large()
                continue
            planned += 1
            if (rss_ceiling_mb is not None and planned % RSS_CHECK_EVERY == 0
                    and _rss_mb() - rss_start > rss_ceiling_mb):
                raise RepairAborted(f"memory grew more than {rss_ceiling_mb:.0f} MB during the dry run")
            if index is None:
                index = links.build_file_key_index(conn, user_id)
            plan = plan_note(conn, user_id, row, note_class, index)
            tally.plan(row, note_class, plan)
            del plan
            if sleep_ms:
                time.sleep(sleep_ms / 1000)
        tally.member_end()
    return tally.report()


# ── apply (Plan F Task 7) ────────────────────────────────────────────────────

class RepairRefused(Exception):
    """`apply` will not start: the flag is off, or it is market hours (C8)."""


class RepairAborted(Exception):
    """`apply` stopped itself: memory grew past its ceiling (C8). The CLI exits 4; the run is
    resumable (finished members are skipped, every note write is a fixed point)."""


#: C8: memory may grow at most this far above the start before the run aborts, checked every
#: `RSS_CHECK_EVERY` notes.
RSS_CEILING_MB = 250.0
RSS_CHECK_EVERY = 25
#: Task 7 review M-8: the lease is also renewed every `RSS_CHECK_EVERY` notes and at least this
#: often, far inside `store.LEASE_STALE_S`.
LEASE_RENEW_S = 60.0
#: Re-review I-6: a note's hotlinks are fetched by at most this many runs that failed them.
DEAD_HOTLINK_RUNS = 2
_ET = "America/New_York"


def _rss_mb() -> float:
    """The process's CURRENT resident memory, in MB (Linux /proc); 0 where it cannot be read."""
    try:
        with open("/proc/self/statm", encoding="ascii") as f:
            pages = int(f.read().split()[1])
        import os as _os
        return pages * _os.sysconf("SC_PAGE_SIZE") / (1024 * 1024)
    except (OSError, ValueError, IndexError, AttributeError):
        return 0.0


def _market_hours(at: datetime) -> bool:
    """9:30-16:00 ET on a weekday (C8: `--apply` refuses then unless allowed)."""
    from zoneinfo import ZoneInfo
    et = at.astimezone(ZoneInfo(_ET))
    minutes = et.hour * 60 + et.minute
    return et.weekday() < 5 and 9 * 60 + 30 <= minutes < 16 * 60


def _relist(conn, run_id: str, user_id: str) -> int:
    """The Obsidian re-list: NULL the cursor of the member's active Obsidian sources, so the web
    process's own scheduled sync converts every note again (never a sync started from here: the
    engine's in-flight guard is per process). One `relist_requested` row per source, carrying the
    prior cursor."""
    rows = conn.execute(
        "SELECT id, cursor FROM j2_note_sources WHERE user_id = ? AND provider = ? AND status = 'active'"
        " AND sync_enabled = 1", (user_id, _RELIST_PROVIDER)).fetchall()
    for source_id, cursor in rows:
        conn.execute("UPDATE j2_note_sources SET cursor = NULL WHERE id = ? AND user_id = ?", (source_id, user_id))
        store.log_note(conn, run_id, user_id, source_id, "relist_requested", {}, [f"prior_cursor:{cursor}"], None)
    conn.commit()
    return len(rows)


def _current_updated_at(conn, note_id: str) -> str | None:
    row = conn.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
    return row[0] if row is not None else None


def _apply_note(conn, run_id: str, user_id: str, row: NoteRow, plan: NotePlan, holder: str,
                counts: dict, max_fetches: int) -> str:
    """Carry out one note's plan. Returns its outcome; `lease_lost` means stop this member."""
    if plan.kept_edited:
        if plan.shapes:
            store.log_note(conn, run_id, user_id, row.id, "kept_edited", plan.shapes, [], None)
            conn.commit()
        return "kept_edited"
    if not writes(plan):
        return "unchanged"  # C12: counted, never logged
    try:
        # C7: a member edit since the listing means hands off, BEFORE anything is downloaded
        # (a lost race must not leave an orphan file on the member's budget). Review M-2: so
        # does a timestamp-neutral write (the link heal pass), seen as a different stored body.
        current = load_body(conn, row.id)
        if _current_updated_at(conn, row.id) != row.updated_at or body_sha(current) != plan.body_sha:
            store.log_note(conn, run_id, user_id, row.id, "race_lost", plan.shapes, plan.actions, None)
            conn.commit()
            return "race_lost"
        doc = plan.new_doc
        changed = doc is not None
        if doc is None:
            doc = json.loads(current)
        del current
        failed: list[str] = []
        copies: list = []  # review M-6: handed to documents once the write lands
        for i, url in enumerate(plan.hotlinks):
            if counts["fetched"] + counts["fetchFailed"] >= max_fetches:
                # review M-1: the rest waits; the member is left unfinished (apply), so a resume
                # with the SAME run id fetches them.
                counts["fetchDeferred"] += len(plan.hotlinks) - i
                break
            try:
                # T4 M-1: this row's own member and note. Sequential: one download at a time (C8).
                stored = asyncio.run(hotlink_fetch.fetch_and_store(user_id, row.id, url))
            except Exception as exc:  # noqa: BLE001 -- refused, unreachable, over the cap: keep the image
                counts["fetchFailed"] += 1
                failed.append(url)
                logger.info("import repair: hotlink not copied for note %s: %s", row.id, exc)
                continue
            counts["fetched"] += 1
            copies.append(stored)
            doc = media.place_stored(doc, url, stored)  # I-1: kind and original, as the door
            changed = True
        if failed:
            store.log_note(conn, run_id, user_id, row.id, "fetch_failed", plan.shapes,
                           [f"fetch_failed:{len(failed)}"] + [store.FAILED_URL_ACTION + u for u in failed], None)
            conn.commit()
        if not changed:
            return "fetch_failed" if failed else "deferred"
        body = notes._validate_body_json(doc)
        # Task 6 M-3: the lease, re-checked right before the write.
        if not store.renew_lease(conn, run_id, user_id, holder):
            return "lease_lost"
        before = load_body(conn, row.id)
        if body_sha(before) != plan.body_sha:  # review M-2: changed while downloading
            store.log_note(conn, run_id, user_id, row.id, "race_lost", plan.shapes, plan.actions, None)
            conn.commit()
            return "race_lost"
        store.log_started(conn, run_id, user_id, row.id, plan.shapes, plan.actions, before)  # C7, commits
        # Concern 2: the stamp lock AND the body lock in one UPDATE: a timestamp-neutral write
        # landing after the check above still makes this `race_lost`.
        applied = engine._apply_resolved_body(conn, user_id, row.id, body, expected_updated_at=row.updated_at,
                                              expected_body_hash=plan.body_sha)
        outcome = "repaired" if applied else "race_lost"
        if applied:
            for stored in copies:  # review M-6: searchable like the door's copies
                hotlink_fetch.hand_off(user_id, row.id, stored)
        try:
            store.log_note(conn, run_id, user_id, row.id, outcome, plan.shapes, plan.actions,
                           before if applied else None)
            conn.commit()
        except Exception as exc:  # noqa: BLE001 -- review M-4: the write itself is committed
            conn.rollback()
            logger.warning("import repair: note %s %s, but its log row failed: %s", row.id, outcome, exc)
        return outcome
    except Exception as exc:  # noqa: BLE001 -- one note's failure never stops the run
        conn.rollback()
        logger.warning("import repair: note %s failed: %s", row.id, exc)
        store.log_note(conn, run_id, user_id, row.id, "failed", plan.shapes, plan.actions, None)
        conn.commit()
        return "failed"


def apply(conn, *, run_id: str, members: list[str] | None = None, max_fetches: int = 2000,
          sleep_ms: int = 20, obsidian_relist: bool = False, allow_market_hours: bool = False,
          now: Any = None, max_members: int | None = None, max_notes: int | None = None,
          rss_ceiling_mb: float = RSS_CEILING_MB, holder: str | None = None) -> dict:
    """Write the repair. Refused unless `NOTE_IMPORT_REPAIR_ENABLED == "1"` and outside market
    hours (or `allow_market_hours`). Per member: skip it when done in this run; claim its lease
    (another live runner's member is skipped, counted `busyMembers`); the Obsidian re-list only
    with `obsidian_relist` (C10: off until Plan C is deployed); then each note through
    `plan_note` and `_apply_note`. A member is finished, and its loss notice recorded, only when
    every note was gone through. Returns the scan-shaped report with `mode: apply` and the
    write counts."""
    if os.environ.get(FLAG) != "1":
        raise RepairRefused(f"{FLAG} is not set to 1")
    clock = now or (lambda: datetime.now(timezone.utc))
    if not allow_market_hours and _market_hours(clock()):
        raise RepairRefused("market hours (9:30-16:00 ET): run outside them, or allow it explicitly")
    holder = holder or uuid.uuid4().hex
    tally = _Tally(conn, run_id, members, "apply")
    counts = {"repaired": 0, "raceLost": 0, "failed": 0, "fetchFailed": 0, "fetched": 0,
              "busyMembers": 0, "leaseLost": 0, "relistRequested": 0, "fetchDeferred": 0}
    by_outcome = {"repaired": "repaired", "race_lost": "raceLost", "failed": "failed"}
    rss_start = _rss_mb()
    planned = taken = 0
    worked = 0  # I-2: notes that needed a write; `max_notes` counts only these
    stopped_for_market = False
    for user_id in (members if members is not None else list(iter_members(conn))):
        if store.member_done(conn, run_id, user_id):
            continue
        if max_members is not None and taken >= max_members:
            break
        if not allow_market_hours and _market_hours(clock()):
            stopped_for_market = True  # review M-5: a long run never writes into the session
            break
        try:
            store.claim_member(conn, run_id, user_id, holder)
        except store.MemberBusy:
            counts["busyMembers"] += 1
            continue
        taken += 1
        try:
            active = active_providers(conn, user_id)
            rows = list(iter_note_rows(conn, user_id))
            classes = {r.id: classify(r, active) for r in rows}
            if obsidian_relist and RELIST in classes.values():
                counts["relistRequested"] += _relist(conn, run_id, user_id)
            index: links.FileKeyIndex | None = None
            tally.member(user_id)
            deferred_before = counts["fetchDeferred"]
            last_renew = time.monotonic()
            checked = repaired = 0
            complete = True
            for row in rows:
                note_class = classes[row.id]
                if note_class is None:
                    continue
                tally.row(note_class)
                if row.body_bytes > MAX_SCAN_BODY_BYTES:  # Task 6 M-6 (1)
                    tally.too_large()
                    continue
                # I-3: a note that already failed in this run is not tried again in it (no poison
                # pill on resume); a NEW run id tries it again.
                if store.latest_outcome(conn, run_id, row.id) == "failed":
                    continue
                planned += 1
                checked += 1
                if planned % RSS_CHECK_EVERY == 0 or time.monotonic() - last_renew > LEASE_RENEW_S:
                    if planned % RSS_CHECK_EVERY == 0 and _rss_mb() - rss_start > rss_ceiling_mb:
                        raise RepairAborted(f"memory grew more than {rss_ceiling_mb:.0f} MB during the run")
                    # review M-8: renewed while working, not only before a write
                    if not store.renew_lease(conn, run_id, user_id, holder):
                        counts["leaseLost"] += 1
                        complete = False
                        break
                    last_renew = time.monotonic()
                try:
                    if index is None:
                        index = links.build_file_key_index(conn, user_id)
                    plan = plan_note(conn, user_id, row, note_class, index)
                except Exception as exc:  # noqa: BLE001 -- I-3: one note's failure, never the run's
                    conn.rollback()
                    logger.warning("import repair: note %s could not be planned: %s", row.id, exc)
                    store.log_note(conn, run_id, user_id, row.id, "failed", {}, ["plan_failed"], None)
                    conn.commit()
                    counts["failed"] += 1
                    continue
                if plan.hotlinks:
                    # Re-review I-6: a hotlink that failed to copy is DONE for this run (its image
                    # stays as it is), and a new run retries it at most once more. Without its
                    # dead hotlinks a note may need no write at all, so it never stalls a batch.
                    # Round 2 S-5: per URL, so a live hotlink beside a dead one is still fetched.
                    failed_here, failed_runs = store.failed_hotlinks(conn, run_id, row.id)
                    plan.hotlinks = [u for u in plan.hotlinks
                                     if u not in failed_here and failed_runs.get(u, 0) < DEAD_HOTLINK_RUNS]
                # Final review M-4: one member's notes (hotlinks up to a minute each) can carry a
                # run past 09:30 ET, so the session is re-checked before each note too. The member
                # is released unfinished, like a batch limit, and a later run resumes it.
                if not allow_market_hours and _market_hours(clock()):
                    stopped_for_market = True
                    complete = False
                    break
                if writes(plan):
                    # I-2: a batch is a number of notes still needing work. A note an earlier
                    # batch repaired plans as unchanged and does not count, so each batch moves on.
                    if max_notes is not None and worked >= max_notes:
                        complete = False
                        break
                    worked += 1
                tally.plan(row, note_class, plan)
                outcome = _apply_note(conn, run_id, user_id, row, plan, holder, counts, max_fetches)
                del plan
                if outcome == "lease_lost":
                    counts["leaseLost"] += 1
                    complete = False
                    break
                if outcome in by_outcome:
                    counts[by_outcome[outcome]] += 1
                repaired += outcome == "repaired"
                if sleep_ms:
                    time.sleep(sleep_ms / 1000)
            loss_notes = tally.member_end()
            if counts["fetchDeferred"] > deferred_before:
                complete = False  # review M-1: hotlinks wait for a resume of this run
            if complete:
                store.record_notice(conn, user_id, loss_notes)
                try:  # review M-8: only a member this runner still holds is finished
                    store.finish_member(conn, run_id, user_id, checked=checked, repaired=repaired,
                                        holder=holder)  # commits
                except store.MemberBusy:
                    counts["leaseLost"] += 1
        finally:
            # I-3 / M-3: on ANY exit (a batch limit, a lost lease, an abort, an error, ^C) the
            # member is given back at once; after `finish_member` this is a no-op.
            try:
                conn.rollback()
                store.release_lease(conn, run_id, user_id, holder)
            except Exception as exc:  # noqa: BLE001 -- never mask the exit's own exception
                logger.warning("import repair: could not release member %s: %s", user_id, exc)
        if not complete and max_notes is not None and worked >= max_notes:
            break
        if stopped_for_market:
            break
    return tally.report(**counts, stoppedForMarketHours=stopped_for_market)
