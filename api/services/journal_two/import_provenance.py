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


def edited_since_import(updated_at: Any, imported_at: Any) -> bool:
    """True when the note's `updated_at` is later than its `imported_at`."""
    updated = _instant(updated_at)
    imported = _instant(imported_at)
    if updated is None or imported is None:
        return False
    return updated > imported


def register_sql_function(conn: sqlite3.Connection) -> None:
    """Make `j2_edited_since_import(updated_at, imported_at)` callable in `conn`'s SQL."""
    conn.create_function(
        SQL_FUNCTION, 2, lambda u, i: 1 if edited_since_import(u, i) else 0, deterministic=True)
