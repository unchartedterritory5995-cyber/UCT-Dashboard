"""Adopt notes imported earlier from a file export into live sync (Plan E Task 8, spec 15 Q3).

A member who imported an Evernote `.enex` export and then connects Evernote must not get every
note twice. Before a pass reads existing rows, each incoming live note with no row of its own is
matched against the member's file-imported rows of the same app:

- same title (both stripped) and the same `created_at` UTC minute (`import_provenance.instant`,
  the one shared parser; an unreadable stamp on either side never matches);
- several matches: the one whose whitespace-collapsed plain text hashes the same as the incoming
  note's wins. Exactly one survivor is adopted; none or several means no adoption, the note imports
  as new, and a failure names the title;
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
from api.services.journal_two.notes import extract_plain_text, import_title
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


def _file_rows_by_title(conn: sqlite3.Connection, user_id: str, import_source: str,
                        titles: list[str]) -> dict[str, list[sqlite3.Row]]:
    """Non-trashed rows of `import_source` that are NOT live rows, keyed on title."""
    out: dict[str, list[sqlite3.Row]] = {}
    wanted = list(dict.fromkeys(t for t in titles if t))
    prefix = enml.LIVE_KEY_PREFIX
    for i in range(0, len(wanted), _TITLE_CHUNK):
        chunk = wanted[i:i + _TITLE_CHUNK]
        rows = conn.execute(
            f"SELECT id, title, created_at, body_plain, import_key, import_remote_rev "
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
    `(adopted, failures)`: `adopted` is `[{"fromKey", "toKey", "noteId"}]`, `failures` is Plan D's
    `failures_json` shape, one `{noteTitle, reason, name: None}` per ambiguous title. The caller
    commits.

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
    # Task 8 review (concern 1): the live title goes through the file importer's OWN rule (strip,
    # cut to MAX_TITLE_CHARS) before comparing, so a long-titled `.enex` note adopts.
    by_title = _file_rows_by_title(
        conn, user_id, import_source, [import_title(rn.title) for _k, rn in candidates])
    used: set[str] = set()
    for live_key, rn in candidates:
        title = (rn.title or "").strip()
        minute = _minute(rn.created_at)
        if not title or minute is None:
            continue
        same = [row for row in by_title.get(import_title(rn.title), [])
                if _minute(row["created_at"]) == minute]
        matches = [row for row in same if row["id"] not in used]
        if not matches:
            if (same or (import_title(rn.title), minute) in adopted_marks) and title not in named:
                # Task 8 review (concern 4): every matching file row was already adopted this pass
                # by another live note. This one imports as new, and is named, never silently.
                named.add(title)
                failures.append({"noteTitle": title, "reason": ambiguous_reason(title), "name": None})
            continue
        if len(matches) > 1:
            remote_hash = _text_hash(extract_plain_text(rn.doc))
            matches = [row for row in matches if _text_hash(row["body_plain"]) == remote_hash]
        if len(matches) != 1:
            if title not in named:
                named.add(title)
                failures.append({"noteTitle": title, "reason": ambiguous_reason(title), "name": None})
            continue
        row = matches[0]
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
            used.add(row["id"])
            adopted_marks.add((import_title(rn.title), minute))
            adopted.append({"fromKey": row["import_key"], "toKey": live_key, "noteId": row["id"]})
    return adopted, failures
