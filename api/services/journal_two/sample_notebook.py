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
(`{"v": 1, "ids": [...], "at": "<iso>"}`) the moment pass 1 has written them. ⛔ That
preference is NOT what `remove` or the Research Home strip trust (fin-data M3): a client can
write a preference, and a seed that dies before recording leaves it short. Every sample note
carries `import_source = 'sample'` (`sample_marker`), written with the note itself; `remove`
trashes exactly the notes that carry it and are not in Trash already, through the Notebook's
own soft delete, so every one of them can be restored from Trash. The preference only orders
them.

⛔⛔ WAVE 14, LANE W14-E -- ONE EXAMPLE PER CAPABILITY, SAME CLICK, SAME DOOR. Right after pass
2, `seed` also calls `sample_examples.seed`, which writes one seeded example per Notebook
capability (an untraded trade plan with its chart, an active setup, a thesis with a
resurfacing notice, a passed setup, an earnings-prep draft, a cited transcript passage) --
each through that capability's own real door, documented in `sample_examples.py`'s module
docstring. Those six example notes' ids are folded into the SAME `ids` list this module has
always recorded, so `remove` trashes them exactly like the five base notes, for free. The
non-note rows a capability example also wrote (a passed setup, a resurfacing insight) are
recorded under the preference's new `examples` key and
cleaned up by `sample_examples.remove` -- see that module for which capability's own "remove"
verb each one uses and why none of it is raw SQL. The preference's `v` moved to 2 for this
(a `v: 1` reader -- `recorded_ids`/`active_ids` -- reads the unchanged `ids` key and does not
notice; `examples` is ignored by anything that does not look for it).
⛔⛔ NO TRADE IS EVER SEEDED (wave 14 integration, round 2): an example trade would land in
every P&L, stat, equity curve, report and export, which read `j2_trades` with no sample filter.
See `sample_examples.py` and `tests/test_sample_notebook_trade_exclusion.py`.
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
from api.services.journal_two import notes, plan_grading, sample_examples, sample_marker
from api.services.notebook_wave14_switch import wave14_switch_on

SAMPLE_PATH = Path(__file__).with_name("sample_notebook.json")
PREF_KEY = "notebook_sample"
SOURCE = sample_marker.SAMPLE_SOURCE   # the ONE durable marker: j2_notes.import_source
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
    """Write the sample notebook for a member who has no notes at all: the five base
    practice notes, then (W14-E) one example per capability, folded into the same `ids`.

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

        # ⛔ THE WAVE-14 SWITCH (W14-C1 ruling): the per-capability examples, and the v2
        # preference that records them, exist only while wave 14 is armed. Off, this click
        # writes exactly what it wrote before wave 14: the five base notes and a v1 preference.
        wave14 = wave14_switch_on()
        version = 2 if wave14 else 1
        examples = None

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
            "v": version, "ids": seeded, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
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

        # Wave 14, W14-E: one example per capability, same click, same lock. Each piece is
        # independent and defensive (see sample_examples.py) -- a capability's own failure
        # never loses the base five, and whatever it DID create is still recorded below so
        # `remove` can find it.
        if wave14:
            examples = sample_examples.seed(user_id, conn)
            seeded = seeded + list(examples["noteIds"])
    finally:
        if owned:
            conn.close()

    if examples is not None:
        auth_service.set_user_preference(user_id, PREF_KEY, json.dumps({
            "v": 2, "ids": seeded, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "examples": {k: v for k, v in examples.items() if k != "noteIds"},
        }))

    return {"folderId": folder_id, "welcomeNoteId": welcome_id, "ids": seeded}


def _link_targets(node: Any) -> list[str]:
    if not isinstance(node, dict):
        return []
    found = [_link_target(node)] if node.get("type") == "noteLink" and _link_target(node) else []
    for c in node.get("content") or []:
        found.extend(_link_targets(c))
    return found


def _recorded_pref(user_id: str) -> dict[str, Any]:
    raw = auth_service.get_user_preferences(user_id).get(PREF_KEY)
    try:
        value = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        value = None
    return value if isinstance(value, dict) else {}


def _sample_ids(user_id: str, conn: sqlite3.Connection, *, live_only: bool) -> list[str]:
    """This member's sample notes, found by the notes' OWN durable marker
    (`sample_marker`), in the order the preference recorded them, then any it never did.

    ⛔ THE MARKER DECIDES WHICH NOTES; THE PREFERENCE ONLY ORDERS THEM (fin-data M3).
    `notebook_sample` is a preference: a client can write it, and a seed that dies before
    recording leaves it short. Read as the list of what to remove it could MISS sample notes
    (orphans "Remove it" could never find) and could NAME a note that is not the sample's.
    An id it names that does not carry the marker is ignored."""
    sql = "SELECT id FROM j2_notes WHERE user_id = ? AND import_source = ?"
    if live_only:
        sql += " AND deleted_at IS NULL"
    marked = [r[0] for r in conn.execute(sql + " ORDER BY created_at, rowid",
                                         (user_id, sample_marker.SAMPLE_SOURCE))]
    have = set(marked)
    pref = _recorded_pref(user_id).get("ids")
    named = [i for i in (pref if isinstance(pref, list) else []) if isinstance(i, str) and i in have]
    seen = set(named)
    return named + [i for i in marked if i not in seen]


def recorded_ids(user_id: str, *, conn: sqlite3.Connection | None = None) -> list[str]:
    """Every sample note this member has -- in Trash or not -- or [] when there is no sample."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        return _sample_ids(user_id, conn, live_only=False)
    finally:
        if owned:
            conn.close()


def recorded_examples(user_id: str) -> dict[str, Any]:
    """W14-E: the non-note rows `sample_examples.seed` recorded (a passed-setup id, a
    resurfacing insight id; a trade id or entry-context key only in a preference written by
    the earlier, never-shipped version), or `{}` for a pre-W14-E sample
    (a `v: 1` preference, or none at all) -- `sample_examples.remove` then has nothing to do,
    which is correct: there is nothing of that shape to clean up."""
    examples = _recorded_pref(user_id).get("examples")
    return examples if isinstance(examples, dict) else {}


def active_ids(user_id: str, *, conn: sqlite3.Connection | None = None) -> list[str]:
    """The sample notes that are not in Trash (archived ones count as still here)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        return _sample_ids(user_id, conn, live_only=True)
    finally:
        if owned:
            conn.close()


#: Said when a folder the sample made BEFORE folders carried a mark is still there. Those exist
#: only in sandboxes seeded before the column; they are never guessed at and never deleted.
OLDER_FOLDER_SENTENCE = ("An older example folder may remain. It was made before folders were "
                         "marked, so it was left alone. You can delete it by hand.")


def _folder_depths(rows: list[sqlite3.Row]) -> dict[str, int]:
    parent = {r["id"]: r["parent_id"] or "" for r in rows}

    def depth(fid: str) -> int:
        n, seen = 0, set()
        while fid and fid in parent and fid not in seen:
            seen.add(fid)
            fid, n = parent[fid], n + 1
        return n

    return {r["id"]: depth(r["id"]) for r in rows}


def _sample_folders(user_id: str, conn: sqlite3.Connection) -> tuple[list[sqlite3.Row], list[sqlite3.Row]]:
    """(the folders the seed MADE, deepest first; older unmarked folders that hold sample notes).

    ⛔ BY THE FOLDER'S OWN MARK, NOTHING ELSE (owner ruling, fin-data2 round 2). The seed's
    import stamps `j2_note_folders.import_source` on every folder it creates, and only on
    those: a folder it found and reused is not marked. The mark is read with the one sample
    predicate. Never by name (a member can name a folder anything), never from the preference
    (a client can write it), and never by when it was made (a member's own empty folder made
    in the same second would be deleted).

    A folder seeded before the column existed has no mark. It is NOT deleted and not guessed
    at: it is returned second, so the removal can say one may remain."""
    rows = conn.execute(
        "SELECT id, name, parent_id, import_source FROM j2_note_folders WHERE user_id = ?", (user_id,)).fetchall()
    depths = _folder_depths(rows)
    made = sorted((r for r in rows if sample_marker.is_sample(r["import_source"])),
                  key=lambda r: -depths[r["id"]])
    holding = {r[0] for r in conn.execute(
        "SELECT DISTINCT folder_id FROM j2_notes WHERE user_id = ? AND import_source = ? AND folder_id IS NOT NULL",
        (user_id, sample_marker.SAMPLE_SOURCE))}
    older = [r for r in rows if r["id"] in holding and not sample_marker.is_sample(r["import_source"])]
    return made, older


def _remove_folders(user_id: str, conn: sqlite3.Connection) -> tuple[list[dict], list[dict], list[dict]]:
    """Delete each folder the seed made that holds nothing of the member's. Returns
    (removed, kept, older): `older` are unmarked folders left alone, each with its sentence.

    A folder is KEPT, and nothing in it is moved, when it holds a note that is not a sample
    note (live, archived or in Trash: all of them are the member's), or a folder that is
    still there. Deepest first, so an emptied child goes before its parent is looked at.
    A deleted folder's sample notes are in Trash already; the Notebook's own folder delete
    moves them up one level, so a restore from Trash still works."""
    removed: list[dict] = []
    kept: list[dict] = []
    made, older = _sample_folders(user_id, conn)
    for f in made:
        mine = conn.execute(
            "SELECT COUNT(*) FROM j2_notes WHERE user_id = ? AND folder_id = ? AND " + sample_marker.not_sample_sql(),
            (user_id, f["id"])).fetchone()[0]
        inner = conn.execute(
            "SELECT COUNT(*) FROM j2_note_folders WHERE user_id = ? AND parent_id = ?",
            (user_id, f["id"])).fetchone()[0]
        if mine:
            kept.append({"id": f["id"], "name": f["name"], "memberNotes": mine, "sentence": (
                f'The folder "{f["name"]}" has {mine} note{"" if mine == 1 else "s"} of yours in it, '
                "so it was kept.")})
        elif inner:
            kept.append({"id": f["id"], "name": f["name"], "memberNotes": 0, "sentence": (
                f'The folder "{f["name"]}" still holds a folder that was kept, so it was kept too.')})
        elif notes.delete_folder(user_id, f["id"], conn=conn):
            removed.append({"id": f["id"], "name": f["name"]})
    conn.commit()
    left = [{"id": f["id"], "name": f["name"], "sentence": OLDER_FOLDER_SENTENCE} for f in older]
    return removed, kept, left


def remove(user_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Trash exactly the sample notes that are not in Trash already, and (W14-E) undo every
    non-note row a capability example wrote -- a passed setup, a resurfacing insight --
    through that capability's own "remove" verb (`sample_examples.remove`).

    WHICH notes: the ones carrying the sample's own marker (`_sample_ids`), never the id list
    in the preference. So a seed that died before recording leaves nothing this cannot find,
    and nothing a preference names can be removed unless the sample made it.

    The Notebook's own soft delete, one note at a time: each one can be restored from Trash."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        trashed = [i for i in _sample_ids(user_id, conn, live_only=True)
                   if notes.delete_note(user_id, i, conn=conn)]
        examples_removed = sample_examples.remove(user_id, recorded_examples(user_id), conn=conn)
        # fin-data I3: no real trade may stay graded against a sample plan once the sample is
        # gone. Matching no longer picks a sample, so this only finds links frozen before that
        # rule; it is done here as well as on read so removal alone is enough.
        examples_removed["planLinksForgotten"] = plan_grading.forget_sample_links(conn, user_id)
        # fin walk P8: the folders the seed made go too, unless the member put something of
        # their own in one. Last, so every sample note is in Trash before a folder is judged.
        folders_removed, folders_kept, folders_older = _remove_folders(user_id, conn)
    finally:
        if owned:
            conn.close()
    return {"trashed": trashed, "examplesRemoved": examples_removed,
            "foldersRemoved": folders_removed, "foldersKept": folders_kept,
            "foldersOlder": folders_older}
