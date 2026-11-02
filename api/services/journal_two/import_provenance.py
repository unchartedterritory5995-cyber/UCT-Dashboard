"""The ONE answer to "has the member edited this imported note since it was imported?"

Connector fidelity Plan A Task 4, controller ruling 2. Every edited-since-import check
reads `edited_since_import` -- the sync engine's conflict gate (`engine._is_conflict`),
the link heal pass (`note_connectors/link_keys.py`), and Plan B's file importer, which
reuses or extends THIS function rather than writing a second definition. A dependency
leaf (stdlib only), so `notes.py`, the engine and the heal pass can all import it
without a cycle.

Today the rule is `updated_at > imported_at`, compared as instants: `import_confirm`
stamps `imported_at` with the import's own clock and `updated_at` with the remote's
revision (or the same clock), and every member write moves `updated_at` past it. The
engine's bookkeeping writes never move `updated_at` (timestamp-neutral), which is what
keeps this answer honest. A stamp that is missing or unreadable answers False ("not
known to be edited"), the engine's long-standing reading; a naive stamp is read as UTC.

`register_sql_function` puts the SAME function into a SQLite connection as
`j2_edited_since_import(updated_at, imported_at)`, so a query can select on it without
restating the rule in SQL.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

SQL_FUNCTION = "j2_edited_since_import"


def _instant(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def stamp_readable(value: Any) -> bool:
    """True when `value` is a stamp this module can read as an instant."""
    return _instant(value) is not None


def is_later(value: Any, reference: Any) -> bool:
    """True when both stamps read and `value` is strictly later than `reference`. The one
    comparison every rule here uses; unreadable either side answers False."""
    a = _instant(value)
    b = _instant(reference)
    if a is None or b is None:
        return False
    return a > b


def edited_since_import(updated_at: Any, imported_at: Any) -> bool:
    """True when the note's `updated_at` is later than its `imported_at`."""
    return is_later(updated_at, imported_at)


#: Plan B Task 10 (ruling R4): how long after `imported_at` the importer's media copies may
#: land, and how soon after the newest media file its finalize PUT follows.
LEGACY_FINALIZE_WINDOW_S = 7200
LEGACY_FINALIZE_SLACK_S = 120
#: Fix round 1 (controller ruling): the legacy shape describes only imports from BEFORE
#: `update_note` stamped `imported_at` on the finalize PUT. After that, a member pasting an
#: image soon after an import has exactly the same shape (an image adds no text, so no version
#: is captured), and reading it as unedited would let a recover or a guarded import overwrite
#: it. Imports between this cutoff and the deploy read as edited: fail-safe.
#: ⚠️ ACCEPTED RESIDUAL: before the cutoff the ambiguity remains -- a pre-cutoff import whose
#: only member edit was an image-only save within the window reads as the importer's finalize.
LEGACY_FINALIZE_CUTOFF = "2026-11-02T00:00:00+00:00"


def predates_finalize_stamp(imported_at: Any) -> bool:
    """True when `imported_at` is readable and earlier than `LEGACY_FINALIZE_CUTOFF`: the only
    imports `legacy_finalize_shape` may describe."""
    return is_later(LEGACY_FINALIZE_CUTOFF, imported_at)


def legacy_finalize_shape(updated_at: Any, imported_at: Any, newest_media_mtime: Any,
                          has_later_version: bool) -> bool:
    """True when an apparent edit is the file importer's OWN finalize write from before that
    write stamped `imported_at` (Plan B Task 10, R5): the note's newest stored media file
    landed within `LEGACY_FINALIZE_WINDOW_S` after `imported_at`, `updated_at` follows that
    file by 0..`LEGACY_FINALIZE_SLACK_S` seconds, and no version was captured after the import
    (a member's text edit captures one). Anything unreadable, or no media, answers False.

    ⛔ Not a second definition of "edited": callers use
    `edited_since_import(...) and not (predates_finalize_stamp(imported_at) and
    legacy_finalize_shape(...))` -- the shape alone is ambiguous after the cutoff. Only the file importer's
    recover/guard reads it -- the heal pass's SQL prefilter cannot read file mtimes, so a legacy
    file-imported note is healed by a recover, never by the heal pass."""
    updated = _instant(updated_at)
    imported = _instant(imported_at)
    if updated is None or imported is None or has_later_version:
        return False
    if isinstance(newest_media_mtime, bool) or not isinstance(newest_media_mtime, (int, float)):
        return False
    media = datetime.fromtimestamp(newest_media_mtime, tz=timezone.utc)
    after_import = (media - imported).total_seconds()
    write_lag = (updated - media).total_seconds()
    return (0 <= after_import <= LEGACY_FINALIZE_WINDOW_S
            and 0 <= write_lag <= LEGACY_FINALIZE_SLACK_S)


def register_sql_function(conn: sqlite3.Connection) -> None:
    """Make `j2_edited_since_import(updated_at, imported_at)` callable in `conn`'s SQL."""
    conn.create_function(
        SQL_FUNCTION, 2, lambda u, i: 1 if edited_since_import(u, i) else 0, deterministic=True)
