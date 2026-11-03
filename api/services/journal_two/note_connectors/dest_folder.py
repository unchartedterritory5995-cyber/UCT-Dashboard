"""The Notebook folder a connector source imports into: its default name, and its repair.

⛔ ONE AUTHORITY FOR THE NAME. The connect flow (`api/routers/note_sync.py`, every provider) and
the engine's self-heal both name a source's folder through `default_folder_name`. The name used
to be typed at five call sites in the router; a self-heal typing it a sixth time would drift from
them the first time one changed.

⚰️ Why the repair exists (live audit 2026-11-03, H1): a member deleted the folder a Notion source
imported into. `notes.delete_folder` never touched `j2_note_sources.dest_folder_id`, so every pass
had `import_confirm` refuse the whole batch ("destination folder not found"), the member was told
the notes would be "tried again on the next sync", the cursor stayed pinned, and nothing could
ever succeed. `delete_folder` now re-points the source (prevention); `heal_missing_dest_folder`
repairs a source already in that state (the engine runs it at the start of every pass).

`dest_folder_id IS NULL` is NOT missing: it is the Notebook root, a real destination that
`import_confirm` accepts (`destFolderId: None` imports at the root). Only an id naming a folder
that no longer exists is repaired.
"""
from __future__ import annotations

import logging
import sqlite3
from typing import NamedTuple

from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc

log = logging.getLogger(__name__)

#: The name used when nothing better is known (an empty provider/account label).
FALLBACK_FOLDER_NAME = "Notebook Sync"

#: The member's sentence when the folder vanished during a pass and the pass made a new one: true,
#: because the next pass imports into it (the cursor did not move past the unsaved notes).
DEST_FOLDER_REMADE_SENTENCE = ("The Notebook folder this sync saves into had been deleted, so a new "
                               "one was made. These notes will be saved there on the next sync.")
#: The same, when the source now points at the folder the deleted one's notes moved to (the
#: parent, or the top of the Notebook): `delete_folder` re-pointed it, or no new folder could be made.
DEST_FOLDER_MOVED_SENTENCE = ("The Notebook folder this sync saves into was deleted while it ran. "
                              "These notes will be saved on the next sync.")


def dest_folder_gone_sentence(label: str) -> str:
    """The member's sentence when the folder is gone and NO folder will be made for it (the source
    is paused or disabled): a retry cannot fix it, so it says what will."""
    return (f"The Notebook folder {label} syncs into was deleted, so nothing could be saved. "
            f"Turn sync back on for {label} and a new folder will be made on the next sync.")


def provider_label(provider: str | None) -> str:
    from . import registry  # lazy: registry imports the providers
    name = provider or ""
    return registry.get_entry(name).label if registry.is_known(name) else (name or "the app")


def default_folder_name(provider: str, display_name: str | None, remote_id: str | None) -> str:
    """The folder a newly connected source imports into: "<Provider> — <account>".

    The account is the source's display name, else its remote id; an Obsidian vault with no
    device label reads "Vault (<vault id>)". Evernote syncs the whole account, so its folder is
    just "Evernote" (Task 7 review m1: never "Evernote — Evernote")."""
    label = provider_label(provider)
    if provider == "evernote":
        return label
    account = display_name or (f"Vault ({remote_id})" if provider == "obsidian" else remote_id)
    return f"{label} — {account}" if account else label


def default_folder_id(user_id: str, name: str, conn: sqlite3.Connection | None = None) -> str | None:
    """Best-effort ROOT folder named `name` (spec §5: "default: 'Roam — {graph}' root folder"),
    made or, when one of that name already exists at the root, reused. NEVER raises: a failure
    degrades to `None` (notes land at the Notebook root) rather than blocking the caller.
    Handed a connection, it writes inside the caller's transaction and leaves the commit to it."""
    trimmed = (name or "").strip()[:80] or FALLBACK_FOLDER_NAME
    try:
        folder = notes_svc.create_folder(user_id, trimmed, conn=conn)
        return folder["id"]
    except notes_svc.NoteValidationError:
        try:
            for f in notes_svc.list_folders(user_id, conn=conn):
                if f["name"] == trimmed and not f.get("parentId"):
                    return f["id"]
        except Exception:  # noqa: BLE001
            pass
        return None
    except Exception:  # noqa: BLE001
        return None


class HealResult(NamedTuple):
    """`outcome`: "present" (the folder exists), "root" (the source imports at the root),
    "healed" (a folder was made or reused and the source re-pointed), "refused" (missing, but the
    source is paused or disabled, so nothing was made), "gone" (no such source: disconnected)."""
    outcome: str
    dest_folder_id: str | None


def heal_missing_dest_folder(user_id: str, source_id: str) -> HealResult:
    """Give a source whose destination folder no longer exists its default folder back.

    Under the write lock (`BEGIN IMMEDIATE`), it reads the source row again and acts only when the
    row still exists, still names a folder, that folder is gone, and the source is active with
    sync on. So a disconnect (which deletes the row) or a pause landing first wins, and two
    concurrent passes cannot both make a folder: the second reads the first's re-pointed row.
    Nothing already imported is moved; only the source's `dest_folder_id` changes."""
    conn = get_connection()
    try:
        notes_svc._begin_immediate(conn)
        row = conn.execute(
            "SELECT provider, remote_id, display_name, dest_folder_id, status, sync_enabled "
            "FROM j2_note_sources WHERE id = ? AND user_id = ?", (source_id, user_id)).fetchone()
        if row is None:
            conn.rollback()
            return HealResult("gone", None)
        dest = row["dest_folder_id"]
        if not dest:
            conn.rollback()
            return HealResult("root", None)
        if conn.execute("SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                        (dest, user_id)).fetchone():
            conn.rollback()
            return HealResult("present", dest)
        if row["status"] != "active" or not row["sync_enabled"]:
            conn.rollback()
            return HealResult("refused", None)
        name = default_folder_name(row["provider"], row["display_name"], row["remote_id"])
        new_id = default_folder_id(user_id, name, conn=conn)
        conn.execute("UPDATE j2_note_sources SET dest_folder_id = ? WHERE id = ? AND user_id = ?",
                     (new_id, source_id, user_id))
        conn.commit()
        log.warning("[note-sync] source %s: destination folder %s was missing; re-pointed at %s (%r)",
                    source_id, dest, new_id, name)
        return HealResult("healed", new_id)
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()

