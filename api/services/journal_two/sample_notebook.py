"""The sample notebook (wave 8, lane 8C, C3; ruling D-C6).

A new member's Notebook is empty, and an empty tool teaches nothing. On an explicit click,
`seed` writes five notes into a folder named "Sample notebook" -- a welcome note that says
how to remove them, a research note (headings, a table, a callout, a formula, a code block),
a thesis, a daily note and a checklist, with two of them linked to each other so the graph
and the backlinks show something. `remove` puts them in Trash again.

⛔ THE CONTENT IS DATA (`sample_notebook.json`) AND IS RAILED, NEVER TRUSTED
(`tests/test_sample_notebook.py`): no cashtag, no ticker, no word that is a real ticker, no
date mention, no dated task, no properties. The sample must never make the Awareness
Engine's thesis-stop alert, the reminders, or a member's ticker vocabulary think this
member wrote about a stock.

⛔ ONE DOOR IN: `notes.import_confirm` -- the SAME function the file importer uses, with
`source="sample"`. A link between two sample notes is written the way the importer writes
one too: a second `import_confirm` pass over the same import keys, whose bodies now carry
the ids the first pass created. No SQL here writes a note row.

⛔ REFUSED FOR ANYONE WHO HAS A NOTE. `seed` counts EVERY note row the member has --
active, archived and trashed -- first WITHOUT the lock (the common refusal never takes it;
wave-8 final review M-9), then, for a member with none, takes the write lock
(`BEGIN IMMEDIATE`) and counts AGAIN under it -- so two clicks at once produce one sample,
and a member's own work never shares a notebook with practice notes they did not ask for.

The seeded ids are recorded in the member's preference `notebook_sample`
(`{"v": 1, "ids": [...], "at": "<iso>"}`) the moment pass 1 has written them (M-9: a
failure in pass 2 still leaves a sample `remove` can find), which is what `remove` and the
Research Home strip read. `remove` trashes exactly those ids that are not in Trash already, through the
Notebook's own soft delete, so every one of them can be restored from Trash.
"""
from __future__ import annotations

import copy
import json
import sqlite3
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from api.services import auth_service
from api.services.auth_db import get_connection
from api.services.journal_two import notes

SAMPLE_PATH = Path(__file__).with_name("sample_notebook.json")
PREF_KEY = "notebook_sample"
SOURCE = "sample"
KEY_PREFIX = "sample:"

REFUSED_SENTENCE = "You already have notes, so we didn't add the sample. You can import notes instead."
BUSY_SENTENCE = "The sample notebook is being added. Try again in a moment."


class SampleRefused(Exception):
    """The member already has a note (active, archived or trashed)."""


class SampleBusy(Exception):
    """Another write held the notebook for longer than the database waits."""


@lru_cache(maxsize=1)
def _sample() -> dict[str, Any]:
    with open(SAMPLE_PATH, encoding="utf-8") as f:
        return json.load(f)


def sample_notes() -> list[dict[str, Any]]:
    """The sample's notes as the JSON holds them (a fresh copy -- callers may mutate)."""
    return copy.deepcopy(_sample()["notes"])


def folder_name() -> str:
    return _sample()["folder"]


def _import_key(key: str) -> str:
    return f"{KEY_PREFIX}{key}"


def _link_target(node: dict[str, Any]) -> str | None:
    """`@research` -> "research": the sample key a noteLink points at, or None."""
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    target = attrs.get("noteId")
    return target[1:] if isinstance(target, str) and target.startswith("@") else None


def _has_links(node: Any) -> bool:
    if not isinstance(node, dict):
        return False
    if node.get("type") == "noteLink" and _link_target(node):
        return True
    return any(_has_links(c) for c in node.get("content") or [])


def _without_links(node: Any) -> Any:
    """The first pass writes each body with its links left out (the ids they point at do not
    exist yet); the second pass writes them in."""
    if not isinstance(node, dict):
        return node
    out = dict(node)
    if "content" in node:
        out["content"] = [_without_links(c) for c in node["content"]
                          if not (isinstance(c, dict) and c.get("type") == "noteLink" and _link_target(c))]
    return out


def _with_links(node: Any, ids: dict[str, str]) -> Any:
    if not isinstance(node, dict):
        return node
    out = dict(node)
    if node.get("type") == "noteLink" and _link_target(node):
        out["attrs"] = {**node["attrs"], "noteId": ids[_link_target(node)]}
    if "content" in node:
        out["content"] = [_with_links(c, ids) for c in node["content"]]
    return out


def _payload(entries: list[dict[str, Any]], bodies: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": SOURCE,
        "notes": [{
            "importKey": _import_key(e["key"]),
            "title": e["title"],
            "bodyJson": bodies[e["key"]],
            "tags": [],
            "folderPath": [folder_name()],
        } for e in entries],
    }


def count_all_notes(user_id: str, conn: sqlite3.Connection) -> int:
    """Every note row the member has: active, archived AND trashed."""
    return conn.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (user_id,)).fetchone()[0]


def seed(user_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Write the sample notebook for a member who has no notes at all.

    Returns `{"folderId", "welcomeNoteId", "ids"}`. Raises `SampleRefused` when the member
    has any note, `SampleBusy` when the write lock could not be had in time."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        # ⭐ THE FAST PATH IS UNLOCKED (wave-8 final review M-9). The common POST is a refusal
        # (the member already has notes), and it used to take `BEGIN IMMEDIATE` -- the auth.db
        # write lock -- just to count and roll back, on a route with no rate limit. A plain
        # COUNT answers it without the lock; only a member who has NO note takes the lock, and
        # then counts AGAIN under it, which is what makes two clicks at once produce one sample.
        if count_all_notes(user_id, conn) > 0:
            raise SampleRefused(REFUSED_SENTENCE)
        try:
            conn.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError as exc:
            raise SampleBusy(str(exc)) from exc
        if count_all_notes(user_id, conn) > 0:
            conn.rollback()
            raise SampleRefused(REFUSED_SENTENCE)

        entries = sample_notes()
        # Pass 1, inside the lock taken above: every note, its links left out.
        # `import_confirm` commits, which is what releases the lock -- a second seed waiting
        # on BEGIN IMMEDIATE then counts these notes and is refused.
        first = notes.import_confirm(
            user_id, _payload(entries, {e["key"]: _without_links(e["body"]) for e in entries}), conn=conn)
        ids = {item["importKey"][len(KEY_PREFIX):]: item["id"] for item in first["created"]}
        seeded = [ids[e["key"]] for e in entries if e["key"] in ids]

        # ⭐ RECORDED RIGHT AFTER PASS 1 (M-9). The notes exist from this moment, so their ids
        # are recorded now: if anything below raises, "Remove it" can still find every one.
        # ⚰️ The ids were recorded after pass 2, so a failure between the two passes left
        # notes no `remove` could see -- and a member who now "has notes" can never re-seed.
        auth_service.set_user_preference(user_id, PREF_KEY, json.dumps({
            "v": 1, "ids": seeded, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }))

        # Pass 2: the notes that link to another, now that every id exists -- the same
        # function, over the same import keys, so each is an update of its own note.
        linked = [e for e in entries if _has_links(e["body"]) and e["key"] in ids
                  and all(t in ids for t in _link_targets(e["body"]))]
        if linked:
            notes.import_confirm(
                user_id, _payload(linked, {e["key"]: _with_links(e["body"], ids) for e in linked}), conn=conn)

        welcome_id = ids.get(_sample()["welcome"])
        folder_id = None
        if welcome_id:
            note = notes.get_note(user_id, welcome_id, conn=conn)
            folder_id = (note or {}).get("folderId")
    finally:
        if owned:
            conn.close()

    return {"folderId": folder_id, "welcomeNoteId": welcome_id, "ids": seeded}


def _link_targets(node: Any) -> list[str]:
    if not isinstance(node, dict):
        return []
    found = [_link_target(node)] if node.get("type") == "noteLink" and _link_target(node) else []
    for c in node.get("content") or []:
        found.extend(_link_targets(c))
    return found


def recorded_ids(user_id: str) -> list[str]:
    """The ids `seed` recorded for this member, or [] when there is no sample."""
    raw = auth_service.get_user_preferences(user_id).get(PREF_KEY)
    try:
        value = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        value = None
    ids = value.get("ids") if isinstance(value, dict) else None
    return [i for i in ids if isinstance(i, str) and i] if isinstance(ids, list) else []


def active_ids(user_id: str, *, conn: sqlite3.Connection | None = None) -> list[str]:
    """The recorded sample ids that are not in Trash (archived ones count as still here)."""
    ids = recorded_ids(user_id)
    if not ids:
        return []
    owned = conn is None
    conn = conn or get_connection()
    try:
        return [i for i in ids if notes.get_note(user_id, i, conn=conn) is not None]
    finally:
        if owned:
            conn.close()


def remove(user_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Trash exactly the recorded sample notes that are not in Trash already.

    The Notebook's own soft delete, one note at a time: nothing but the recorded ids is
    touched, and each one can be restored from Trash."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        trashed = [i for i in recorded_ids(user_id) if notes.delete_note(user_id, i, conn=conn)]
    finally:
        if owned:
            conn.close()
    return {"trashed": trashed}
