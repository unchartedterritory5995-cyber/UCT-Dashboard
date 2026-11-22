"""Adopt notes imported earlier from a file export into live sync (Plan E Task 8, spec 15 Q3).

A member who imported an Evernote `.enex` export and then connects Evernote must not get every
note twice. Before a pass reads existing rows, each incoming live note with no row of its own is
matched against the member's file-imported rows of the same app:

- same title (both stripped) and the same `created_at` UTC minute (`import_provenance.instant`,
  the one shared parser; an unreadable stamp on either side never matches);
- several matches: the one whose whitespace-collapsed plain text hashes the same as the incoming
  note's wins. Exactly one survivor is adopted; none or several means no adoption, the note imports
  as new, and a failure names the title;
- several LIVE notes of one title and minute in a call: each adopts only on a body-hash match that
  is unique both ways (one row, one live note). The rest import as new and the title is named:
  listing order never decides which note a row becomes;
- a file row is adopted at most once per pass.

Adoption is one timestamp-neutral `UPDATE` that moves the row onto the live key. It never touches
`updated_at` or `imported_at`, so a note the member edited still reads as edited and the existing
conflict rules apply unchanged. In the same `UPDATE` the stored remote revision becomes the live
one, but only when both name the same UTC second: an unchanged note then reads "remote unchanged"
although the two sources spell the time differently. Otherwise the stored revision is kept and the
remote counts as changed, the conservative branch.
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime
from typing import Any

from api.services.journal_two import import_provenance
from api.services.journal_two.notes import (
    _edited_since_file_import, extract_plain_text, import_title,
)
from api.services.journal_two.note_connectors.convert import enml
from api.services.journal_two.note_connectors.providers.base import RemoteNote

_TITLE_CHUNK = 400  # sqlite variable-limit safety


def _minute(value: Any) -> datetime | None:
    at = import_provenance.instant(value)
    return at.replace(second=0, microsecond=0) if at is not None else None


def _second(value: Any) -> datetime | None:
    at = import_provenance.instant(value)
    return at.replace(microsecond=0) if at is not None else None


def _text_hash(text: str | None) -> str:
    return hashlib.sha256(" ".join((text or "").split()).encode("utf-8")).hexdigest()


def ambiguous_reason(title: str) -> str:
    return f'adoption ambiguous: "{title}"'


def undated_reason(title: str) -> str:
    return f'adoption refused, import date unreadable: "{title}"'


def _file_rows_by_title(conn: sqlite3.Connection, user_id: str, import_source: str,
                        titles: list[str]) -> dict[str, list[sqlite3.Row]]:
    """Non-trashed rows of `import_source` that are NOT live rows, keyed on title."""
    out: dict[str, list[sqlite3.Row]] = {}
    wanted = list(dict.fromkeys(t for t in titles if t))
    prefix = enml.LIVE_KEY_PREFIX
    for i in range(0, len(wanted), _TITLE_CHUNK):
        chunk = wanted[i:i + _TITLE_CHUNK]
        rows = conn.execute(
            f"SELECT id, title, created_at, updated_at, imported_at, body_plain, import_key, "
            f"import_remote_rev "
            f"FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL "
            f"AND lower(import_source) = ? AND import_key IS NOT NULL "
            f"AND substr(import_key, 1, ?) != ? "
            f"AND title IN ({','.join('?' * len(chunk))})",
            (user_id, import_source.lower(), len(prefix), prefix, *chunk),
        ).fetchall()
        for row in rows:
            # Keyed on the title EXACTLY as stored: `import_confirm` wrote it through
            # `notes.import_title`, so a cut title may end in a space and must not be re-stripped.
            out.setdefault(row["title"] or "", []).append(row)
    return out


def adopt_file_imports(
    conn: sqlite3.Connection, user_id: str, import_source: str,
    candidates: list[tuple[str, RemoteNote]], *, pass_state: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    """`candidates` are `(live_key, rn)` pairs no non-trashed row holds yet. Returns
    `(adopted, failures)`: `adopted` is `[{"fromKey", "toKey", "noteId", "editedSinceImport"}]`,
    `failures` is Plan D's `failures_json` shape, one `{noteTitle, reason, name: None}` per
    ambiguous title. The caller commits.

    The call's candidates are grouped by (stored title, created minute) first (Task 8 review I1):
    with ONE live note in a group, today's rule (one row adopts; several rows tie-break on the
    body hash); with TWO OR MORE, a live note adopts a row only when the pair is a unique body-hash
    match both ways, and every live note or row left unpaired names the title. Listing order
    never decides which live note gets a row.

    `editedSinceImport` is the file importer's own answer (`notes._edited_since_file_import`: the
    one predicate minus the old importer's image-finalize write that moved `updated_at`), so a
    pre-cutoff image note whose only write was that finalize reads as unedited (review M1). The
    engine reads it for the adopting pass in place of its plain conflict rule. A row whose
    `imported_at` is missing or unreadable is never adopted, as recover refuses it (review nit 2),
    and its title is named.

    `pass_state` (one dict per sync pass, the engine's) carries what this pass already adopted and
    named across import chunks: in a later chunk the adopted row holds a live key and is no longer a
    candidate, so a second live note matching it would otherwise import silently."""
    adopted: list[dict] = []
    failures: list[dict] = []
    if not candidates:
        return adopted, failures
    state = pass_state if pass_state is not None else {}
    adopted_marks: set = state.setdefault("adopted", set())  # (stored title, minute) adopted
    named: set[str] = state.setdefault("named", set())

    def name(title: str, reason: str | None = None) -> None:
        if title not in named:
            named.add(title)
            failures.append({"noteTitle": title, "reason": reason or ambiguous_reason(title),
                             "name": None})

    # Task 8 review (concern 1): the live title goes through the file importer's OWN rule (strip,
    # cut to MAX_TITLE_CHARS) before comparing, so a long-titled `.enex` note adopts.
    by_title = _file_rows_by_title(
        conn, user_id, import_source, [import_title(rn.title) for _k, rn in candidates])
    groups: dict[tuple[str, datetime], list[tuple[str, RemoteNote, str]]] = {}
    for live_key, rn in candidates:
        title = (rn.title or "").strip()
        minute = _minute(rn.created_at)
        if not title or minute is None:
            continue
        groups.setdefault((import_title(rn.title), minute), []).append((live_key, rn, title))

    for (stored_title, minute), lives in groups.items():
        rows = [row for row in by_title.get(stored_title, []) if _minute(row["created_at"]) == minute]
        if not rows:
            if (stored_title, minute) in adopted_marks:
                # Task 8 review (concern 4): every matching file row was already adopted this pass
                # by another live note. These import as new, and are named, never silently.
                for _k, _rn, title in lives:
                    name(title)
            continue
        pairs: list[tuple[str, RemoteNote, str, sqlite3.Row]] = []
        if len(lives) == 1:
            live_key, rn, title = lives[0]
            matches = rows
            if len(matches) > 1:
                remote_hash = _text_hash(extract_plain_text(rn.doc))
                matches = [row for row in matches if _text_hash(row["body_plain"]) == remote_hash]
            if len(matches) != 1:
                name(title)
                continue
            pairs.append((live_key, rn, title, matches[0]))
        else:
            row_hash = {row["id"]: _text_hash(row["body_plain"]) for row in rows}
            live_hash = [_text_hash(extract_plain_text(rn.doc)) for _k, rn, _t in lives]
            for (live_key, rn, title), h in zip(lives, live_hash):
                matches = [row for row in rows if row_hash[row["id"]] == h]
                if len(matches) == 1 and live_hash.count(h) == 1:
                    pairs.append((live_key, rn, title, matches[0]))
            paired_rows = {row["id"] for *_x, row in pairs}
            paired_keys = {k for k, *_x in pairs}
            if any(k not in paired_keys for k, _rn, _t in lives) or any(
                    row["id"] not in paired_rows for row in rows):
                name(lives[0][2])
        for live_key, rn, title, row in pairs:
            # Task 8 review nit 2: as recover does, a row whose import cannot be dated is hands
            # off: "edited since import" has no answer for it. The live note imports as new.
            if not import_provenance.stamp_readable(row["imported_at"]):
                name(title, undated_reason(title))
                continue
            stored_rev = row["import_remote_rev"]
            same_instant = (rn.updated_at and _second(stored_rev) is not None
                            and _second(stored_rev) == _second(rn.updated_at))
            new_rev = rn.updated_at if same_instant else stored_rev
            cur = conn.execute(
                "UPDATE j2_notes SET import_key = ?, import_remote_rev = ? "
                "WHERE id = ? AND user_id = ? AND import_key = ?",
                (live_key, new_rev, row["id"], user_id, row["import_key"]),
            )
            if cur.rowcount == 1:
                adopted_marks.add((stored_title, minute))
                adopted.append({"fromKey": row["import_key"], "toKey": live_key, "noteId": row["id"],
                                "editedSinceImport": _edited_since_file_import(conn, user_id, row)})
    return adopted, failures
