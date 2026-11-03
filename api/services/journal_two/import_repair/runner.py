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

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator

from api.services.journal_two import import_provenance, import_repair, sample_marker
from api.services.journal_two import notes
from api.services.journal_two.import_repair import links, media, shapes
from api.services.journal_two.note_connectors import registry

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
    if row.import_source in registry._REGISTRY:
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
    del body_text
    loss = note_class == FILE and any(found.get(s) for s in shapes.LOSS_SHAPES)

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
        return NotePlan(note_class, found, True, legacy, None, [], [], loss, unreadable_stamp=not readable)

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
                    lost_links=lost_links)


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


def scan(conn, *, run_id: str, members: list[str] | None = None, sleep_ms: int = 0) -> dict:
    """The dry-run report. Never writes."""
    started = _now()
    stale, relist = _sources(conn, members)
    totals: dict[str, Any] = {
        "members": 0, "notesScanned": 0, "tooLargeToScan": 0,
        "byClass": dict.fromkeys(import_repair.NOTE_CLASSES, 0), "byShape": {}, "bySource": {},
        "wouldRepairNotes": 0, "hotlinksToFetch": 0, "keptEdited": 0, "legacyFinalize": 0,
        "obsidianSourcesToRelist": relist, "noticeMembers": 0,
        "unreadableStamp": 0, "byClassShape": {}, "lostLinks": 0, "unreadableBody": 0,
    }
    per_member: list[dict] = []
    samples: dict[str, list[str]] = {}
    for user_id in (members if members is not None else list(iter_members(conn))):
        active = active_providers(conn, user_id)
        index: links.FileKeyIndex | None = None
        mine = {"userId": user_id, "notes": 0, "wouldRepair": 0, "byShape": {}, "lossNotes": 0, "lostLinks": 0}
        for row in iter_note_rows(conn, user_id):
            note_class = classify(row, active)
            if note_class is None:
                continue
            totals["notesScanned"] += 1
            totals["byClass"][note_class] += 1
            mine["notes"] += 1
            if row.body_bytes > MAX_SCAN_BODY_BYTES:
                totals["tooLargeToScan"] += 1
                continue
            if index is None:
                index = links.build_file_key_index(conn, user_id)
            plan = plan_note(conn, user_id, row, note_class, index)
            totals["unreadableBody"] += plan.unreadable_body
            side = "edited" if plan.kept_edited else "unedited"
            for shape, n in plan.shapes.items():
                totals["byShape"].setdefault(shape, {"unedited": 0, "edited": 0})[side] += n
                totals["byClassShape"].setdefault(note_class, {}).setdefault(
                    shape, {"unedited": 0, "edited": 0})[side] += n
                source = totals["bySource"].setdefault(row.import_source or "", {})
                source[shape] = source.get(shape, 0) + n
                mine["byShape"][shape] = mine["byShape"].get(shape, 0) + n
                bucket = samples.setdefault(shape, [])
                if len(bucket) < SAMPLE_PER_SHAPE:
                    bucket.append(row.id)
            totals["keptEdited"] += plan.kept_edited
            totals["legacyFinalize"] += plan.legacy_finalize
            totals["unreadableStamp"] += plan.unreadable_stamp
            totals["hotlinksToFetch"] += len(plan.hotlinks)
            totals["lostLinks"] += plan.lost_links
            mine["lostLinks"] += plan.lost_links
            if plan.new_doc is not None:
                totals["wouldRepairNotes"] += 1
                mine["wouldRepair"] += 1
            if plan.loss:
                mine["lossNotes"] += 1
            del plan
            if sleep_ms:
                time.sleep(sleep_ms / 1000)
        if mine["notes"]:
            totals["members"] += 1
        if mine["byShape"]:
            per_member.append(mine)
        if mine["lossNotes"]:
            totals["noticeMembers"] += 1
    return {"runId": run_id, "mode": "dry-run", "startedAt": started, "finishedAt": _now(),
            "peakRssMb": _peak_rss_mb(), "sourcesNotFullSyncedSinceConverter": stale,
            "totals": totals, "perMember": per_member, "samples": samples}
