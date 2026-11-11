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
repairs a source already in that state (the engine runs it at the start of every pass), and it
repairs it the SAME way prevention would have (review I1, see its docstring).

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


#: Every member sentence about a missing destination folder begins with this, so the engine can
#: tell a whole-source problem from a per-note one (`is_dest_folder_sentence`); a test pins it.
DEST_SENTENCE_PREFIX = "The Notebook folder "


def is_dest_folder_sentence(reason: str | None) -> bool:
    return isinstance(reason, str) and reason.startswith(DEST_SENTENCE_PREFIX)


def dest_folder_remade_sentence(folder_name: str) -> str:
    """The folder vanished during a pass and the pass gave the source a folder again (made, or an
    existing root folder of that name reused, so it names the folder rather than claiming a new
    one): true, because the next pass imports into it (the cursor did not move past them)."""
    return (f"The Notebook folder this sync saves into had been deleted, so it now saves into "
            f"\"{folder_name}\". These notes will be saved there on the next sync.")


#: The folder vanished during a pass and the source now points at the folder the deleted one's
#: notes moved to (the parent, or the top of the Notebook): `delete_folder` re-pointed it, or the
#: heal sent a source that already has notes to the top, where `delete_folder` put its folders.
DEST_FOLDER_MOVED_SENTENCE = ("The Notebook folder this sync saves into was deleted while it ran. "
                              "These notes will be saved on the next sync.")
#: No folder could be made this time; the source is left as it was and the next pass tries again.
DEST_FOLDER_RETRY_SENTENCE = ("The Notebook folder this sync saves into was deleted, and a new one "
                              "couldn't be made this time. It will be tried again on the next sync.")


def dest_folder_gone_sentence(label: str) -> str:
    """The folder is gone and the source is PAUSED, so no repair runs. A retry cannot fix it, so it
    says what will: turning sync back on lets the next pass repair it."""
    return (f"The Notebook folder {label} syncs into was deleted, so nothing could be saved. "
            f"Turn sync back on for {label} and it will start saving again on the next sync.")


def dest_folder_disabled_sentence(label: str) -> str:
    """The folder is gone and the source is DISABLED (`status = 'disabled'`: reserved, set by no
    member-facing control, so a member cannot clear it). It never says "turn sync back on"."""
    return (f"The Notebook folder {label} syncs into was deleted, so nothing could be saved. "
            f"Syncing is switched off for this source on our side; contact Support to turn it back on.")


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
    answers `None` (the connect flow then lets notes land at the Notebook root; the heal leaves the
    source as it was). Handed a connection, it writes inside the caller's transaction and leaves
    the commit to it."""
    # Stripped again after the cut (re-review N4): `create_folder` stores the name stripped, so a
    # cut that ends on a space must compare as it was stored or the reuse below never matches.
    trimmed = (name or "").strip()[:80].strip() or FALLBACK_FOLDER_NAME
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
    """`outcome`:
      * "present": the folder exists (`dest_folder_id` is the source's current one).
      * "root": the source imports at the top of the Notebook (`dest_folder_id IS NULL`).
      * "remade": missing, and the source had imported nothing yet: its default folder was made
        (or an existing root folder of that name reused) and the source re-pointed at it.
      * "rooted": missing, and the source HAS imported notes: re-pointed at the root (None).
      * "failed": missing, but no folder could be made; the source is left as it was, so the
        next pass tries again.
      * "paused" / "disabled": missing, and nothing was done (sync off / status 'disabled').
      * "gone": no such source (disconnected).
    `folder_name` is the default folder's name on "remade"."""
    outcome: str
    dest_folder_id: str | None
    folder_name: str | None = None


#: Outcomes after which `dest_folder_id` names a real destination and the pass can import.
USABLE = frozenset({"present", "root", "remade", "rooted"})


def _source_has_imports(conn: sqlite3.Connection, user_id: str, source_id: str) -> bool:
    """Whether any live note came from this source. The engine scopes a note to a source through
    `j2_note_remote_index` (one row per remote item the source listed, carrying the `import_key`
    `provider.import_key(source.remoteId, ...)` gave it); a key the source listed but never stored
    has no note, so it does not count."""
    return conn.execute(
        "SELECT 1 FROM j2_note_remote_index r JOIN j2_notes n "
        "ON n.user_id = r.user_id AND n.import_key = r.import_key "
        "WHERE r.user_id = ? AND r.source_id = ? AND n.deleted_at IS NULL LIMIT 1",
        (user_id, source_id)).fetchone() is not None


def _settled(conn: sqlite3.Connection, user_id: str, source_id: str):
    """(row, result): `result` is set when there is nothing to repair."""
    row = conn.execute(
        "SELECT provider, remote_id, display_name, dest_folder_id, status, sync_enabled "
        "FROM j2_note_sources WHERE id = ? AND user_id = ?", (source_id, user_id)).fetchone()
    if row is None:
        return None, HealResult("gone", None)
    dest = row["dest_folder_id"]
    if not dest:
        return row, HealResult("root", None)
    if conn.execute("SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                    (dest, user_id)).fetchone():
        return row, HealResult("present", dest)
    return row, None


def heal_missing_dest_folder(user_id: str, source_id: str) -> HealResult:
    """Repair a source whose destination folder no longer exists, the way `delete_folder` now
    does at the moment of the delete.

    ⛔ A source that already imported notes goes to the ROOT, never to a recreated folder. The old
    `delete_folder` moved the deleted folder's notes and subfolders to its parent (the root, for the
    default folder); a recreated "<Provider> — <account>" would grow a SECOND copy of every
    subfolder as remote notes change, one note at a time, while the first copy sits at the root
    (review I1, `probe_path.py`). Only a source that has imported nothing yet gets its default
    folder back, made or reused by name.

    Lock-free first: a source whose folder exists (every pass but the broken one) never takes the
    write lock. Only a missing folder takes `BEGIN IMMEDIATE` and reads the row again, so a
    disconnect (which deletes the row) or a pause landing first wins, and two concurrent passes
    cannot both repair it. A paused source (`sync_enabled = 0`) and a disabled one are left alone;
    a 'broken' one (its auth worked this pass) is repaired. If no folder can be made, the row is
    left exactly as it was, so the next pass tries again: never a silent None."""
    conn = get_connection()
    try:
        _row, settled = _settled(conn, user_id, source_id)
        if settled is not None:
            return settled
        notes_svc._begin_immediate(conn)
        row, settled = _settled(conn, user_id, source_id)
        if settled is not None:
            conn.rollback()
            return settled
        dest = row["dest_folder_id"]
        if row["status"] == "disabled":
            conn.rollback()
            return HealResult("disabled", None)
        if not row["sync_enabled"]:
            conn.rollback()
            return HealResult("paused", None)
        name: str | None = None
        if _source_has_imports(conn, user_id, source_id):
            new_id, outcome = None, "rooted"
        else:
            name = default_folder_name(row["provider"], row["display_name"], row["remote_id"])
            new_id, outcome = default_folder_id(user_id, name, conn=conn), "remade"
            if new_id is None:
                conn.rollback()
                log.warning("[note-sync] source %s: destination folder %s is missing and no folder "
                            "%r could be made; left as it was", source_id, dest, name)
                return HealResult("failed", None)
        conn.execute("UPDATE j2_note_sources SET dest_folder_id = ? WHERE id = ? AND user_id = ?",
                     (new_id, source_id, user_id))
        conn.commit()
        log.warning("[note-sync] source %s: destination folder %s was missing; %s -> %s (%r)",
                    source_id, dest, outcome, new_id, name)
        return HealResult(outcome, new_id, name)
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()
