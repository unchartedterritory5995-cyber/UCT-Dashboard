"""Wave 7 lane G (G1) — the member's personal API: create a note, append to a
note, append to today's daily note. The HTTP half is
`api/routers/notebook_personal_api.py`; the credential is a `personal_api` row
minted by `capture_auth.mint_personal_token`.

⛔⛔ EVERY WRITE GOES THROUGH `notes.py`. A note is created by
`notes.create_note` and a body is changed by `notes.update_note` — never by SQL
here — so the version history, the FTS mirror, the link/mention sidecars and the
note-write door rails see these writes exactly as they see the editor's.

⛔⛔ AN APPEND IS A COMPARE-AND-SET INSIDE ONE WRITE LOCK (ruling D-G1(a)). The
note is read inside `BEGIN IMMEDIATE` and written with `expected_updated_at` set
to what was read — the `notes.patch_note_tags` shape — so nothing can land
between this read and this write, and if anything ever did, the write is
REFUSED rather than silently overwriting it. What this cannot do, stated rather
than hidden (D-G1(b)): a browser tab holding UNSENT words when an append lands
keeps its words as a conflict copy, because the offline classifier (F5-frozen)
merges only three node types. The member loses nothing; they reconcile a fork.

⛔ A LOCKED NOTE REFUSES (D-G1(d)): 423, body untouched, `updated_at` unchanged.

⛔ MARKDOWN NEVER FETCHES. `mddoc.md_to_tiptap` turns an image reference into an
`import-ref://` placeholder for the importer to resolve; nothing here resolves
it. Each one is replaced by a plain-text marker naming the image, so a
Shortcut's markdown can never make the server reach out to a URL.
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from typing import Any

from api.services.auth_db import get_connection

# ── The gate ─────────────────────────────────────────────────────────────────
# Unset means OFF and that is the decision: every personal-API route answers
# 404 and no token can be minted. Read per request (the router calls this on
# every request), so a flip needs no restart. Same read shape as
# `note_tasks.KILL_SWITCH`: a module constant, no literal default.
PERSONAL_API_GATE = "NOTEBOOK_PERSONAL_API_ENABLED"
_GATE_ON_VALUES = {"1", "true", "yes", "on"}

MAX_MARKDOWN_BYTES = 200 * 1024
APP_ORIGIN = "https://uctintelligence.com"
DAILY_TEMPLATE_PREF = "notebook_daily_template"   # lib/dailyNote.js DAILY_TEMPLATE_PREF

# The sentences a Shortcut shows. Plain, and each says what to do next.
LOCKED_SENTENCE = "This note is locked — unlock it in the Notebook first"
NOT_FOUND_SENTENCE = "That note wasn't found. It may have been deleted, or the note id is wrong."
TOO_LARGE_SENTENCE = "That text is over the 200 KB limit. Send it in smaller pieces."
CHANGED_SENTENCE = "That note changed while this was being added. Try again."
BUSY_SENTENCE = "UCT is busy saving other changes. Wait a few seconds and try again."

_REF_PREFIX = "import-ref://"
_LINK_PREFIX = "import-link://"
_BLOCK_CONTAINERS = {"doc", "blockquote", "listItem", "taskItem", "tableCell", "tableHeader"}


def personal_api_enabled() -> bool:
    raw = os.environ.get(PERSONAL_API_GATE)
    return raw is not None and raw.strip().lower() in _GATE_ON_VALUES


class PersonalApiError(Exception):
    """A refusal with the HTTP status and the member-facing sentence."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def note_url(note_id: str) -> str:
    """The app's one routing idiom for a note (`?note=`), made absolute so a
    Shortcut can open it."""
    return f"{APP_ORIGIN}/journal/notebook?note={note_id}"


def public_note(note: dict[str, Any]) -> dict[str, Any]:
    return {"id": note["id"], "title": note.get("title") or "", "url": note_url(note["id"])}


def check_markdown(markdown: Any, *, required: bool) -> str:
    """The markdown a caller sent, or a refusal. ⛔ Size is measured in UTF-8
    BYTES, the unit the limit is stated in."""
    if markdown is None:
        markdown = ""
    if not isinstance(markdown, str):
        raise PersonalApiError(400, "“markdown” must be text.")
    if len(markdown.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise PersonalApiError(413, TOO_LARGE_SENTENCE)
    if required and not markdown.strip():
        raise PersonalApiError(400, "Send some text in “markdown” to add to the note.")
    return markdown


# ── markdown -> TipTap nodes, with no fetch ──────────────────────────────────

def _image_marker(node: dict[str, Any]) -> str:
    src = str((node.get("attrs") or {}).get("src") or "")
    if src.startswith(_REF_PREFIX):
        src = src[len(_REF_PREFIX):]
    if src.startswith("data:") or src.startswith("md-img-"):
        return "[image]"
    return f"[image: {src}]" if src else "[image]"


def _link_mark_survives(mark: Any) -> bool:
    """Keep a mark unless it is a link that must not be stored.

    ⛔ The href is read AS A BROWSER READS IT -- whitespace and control
    characters removed -- by mddoc's `link_href_as_read`, the one normaliser
    the allow-list itself uses (wave 7 lane J fix round 1, review M-2: this
    file used to carry a byte-identical copy of the character class). The
    `import-link://` refusal below and the allow-list both see that string.
    ⚰️ Fix round 1 (M-5): mddoc's `_is_allowed_link_href` once checked the raw
    string, so `<a href="java&#9;script:alert(1)">` was stored as a link to
    `java\\tscript:alert(1)`. TipTap blanks it when it renders today, but a
    note outlives today's renderer (a share page, an HTML export). The mark is
    dropped and the words stay."""
    if not (isinstance(mark, dict) and mark.get("type") == "link"):
        return True
    from api.services.journal_two.note_connectors.convert.mddoc import (
        _is_allowed_link_href, link_href_as_read,
    )
    href = link_href_as_read(str((mark.get("attrs") or {}).get("href") or ""))
    if href.startswith(_LINK_PREFIX):
        return False       # names a document of an import that does not exist here
    return _is_allowed_link_href(href)


def _strip_media(node: dict[str, Any], parent: str) -> dict[str, Any] | None:
    """Make converted content safe to store in a member's note. Returns a new
    node.

      * every image becomes a text marker (inline) or a paragraph holding one
        (block) -- nothing is fetched;
      * every `attachmentChip` becomes a text marker the same way: a converter
        only ever emits one as an `import-ref://` PLACEHOLDER for a file this
        note does not have, which leads nowhere and would make the Notebook
        think an import is still pending (fix round 1, M-5);
      * a link mark is dropped (its text kept) when it names an import document
        or its scheme is not allowed -- see `_link_mark_survives`."""
    if not isinstance(node, dict):
        return None
    kind = node.get("type")
    if kind in ("image", "attachmentChip"):
        if kind == "image":
            marker = _image_marker(node)
        else:
            name = str((node.get("attrs") or {}).get("name") or "").strip()
            marker = f"[attachment: {name}]" if name else "[attachment]"
        text = {"type": "text", "text": marker}
        return {"type": "paragraph", "content": [text]} if parent in _BLOCK_CONTAINERS else text
    out = dict(node)
    marks = node.get("marks")
    if isinstance(marks, list):
        kept = [m for m in marks if _link_mark_survives(m)]
        if kept:
            out["marks"] = kept
        else:
            out.pop("marks", None)
    if isinstance(node.get("content"), list):
        kids = [_strip_media(c, node.get("type") or "") for c in node["content"]]
        out["content"] = [k for k in kids if k is not None]
    return out


def markdown_nodes(markdown: str) -> list[dict[str, Any]]:
    """Top-level TipTap nodes for `markdown` through the server port of the
    importer (`mddoc.md_to_tiptap`). ⚠️ Headings are capped at H3 there
    (R15); an H4-H6 in a Shortcut's text arrives as H3."""
    from api.services.journal_two.note_connectors.convert.mddoc import md_to_tiptap
    doc = md_to_tiptap(markdown or "")["doc"]
    stripped = _strip_media(doc, "") or {"type": "doc", "content": []}
    return list(stripped.get("content") or [])


def _is_empty_paragraph(node: Any) -> bool:
    return (isinstance(node, dict) and node.get("type") == "paragraph"
            and not node.get("content"))


# ── create ───────────────────────────────────────────────────────────────────

def _folder_id(user_id: str, folder: Any) -> str | None:
    """A folder given as a path (`"Inbox/Ideas"`), made on first use by
    `notes.ensure_folder_path`. Empty means the Notebook's root."""
    if folder is None or folder == "":
        return None
    if not isinstance(folder, str):
        raise PersonalApiError(400, "“folder” must be a path like Inbox/Ideas.")
    parts = [p.strip() for p in folder.replace("\\", "/").split("/") if p.strip()]
    if not parts:
        return None
    from api.services.journal_two import notes as notes_service
    if len(parts) > notes_service.MAX_FOLDER_DEPTH:
        raise PersonalApiError(
            400, f"“folder” can be at most {notes_service.MAX_FOLDER_DEPTH} levels deep.")
    # ⛔ OUR connection, and WE commit. `ensure_folder_path` hands the
    # connection it is given to `create_folder`, which commits only a
    # connection it opened itself — so called with no connection, the folders
    # it makes are rolled back when its own connection closes (measured: the
    # note then fails with "folder not found").
    conn = get_connection()
    try:
        folder_id = notes_service.ensure_folder_path(user_id, parts, conn=conn)
        conn.commit()
        return folder_id
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()


def create_note_from_markdown(
    user_id: str, *, title: Any = None, markdown: Any = None,
    folder: Any = None, tags: Any = None,
) -> dict[str, Any]:
    from api.services.journal_two import notes as notes_service

    if title is not None and not isinstance(title, str):
        raise PersonalApiError(400, "“title” must be text.")
    md = check_markdown(markdown, required=False)
    if not (title or "").strip() and not md.strip():
        raise PersonalApiError(400, "Send a “title” or some “markdown” — a note needs one of them.")
    if tags is not None and not isinstance(tags, list):
        raise PersonalApiError(400, "“tags” must be a list of words.")
    payload: dict[str, Any] = {
        "title": (title or "").strip(),
        "bodyJson": {"type": "doc", "content": markdown_nodes(md)},
        "tags": tags or [],
    }
    folder_id = _folder_id(user_id, folder)
    if folder_id:
        payload["folderId"] = folder_id
    try:
        note = notes_service.create_note(user_id, payload)
    except notes_service.NoteValidationError as e:
        raise PersonalApiError(400, f"The note wasn't saved: {e}.") from e
    return note


# ── append ───────────────────────────────────────────────────────────────────

def append_markdown(user_id: str, note_id: str, markdown: Any) -> dict[str, Any]:
    """Append `markdown` to the END of one of this member's notes.

    ⛔ Tenant-scoped in the read (`user_id` in the WHERE): another member's note,
    a trashed note and a missing one are the same 404."""
    md = check_markdown(markdown, required=True)
    nodes = markdown_nodes(md)
    if not nodes:
        raise PersonalApiError(400, "Send some text in “markdown” to add to the note.")
    return append_nodes(user_id, note_id, nodes)


def append_nodes(user_id: str, note_id: str, nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """Append TipTap `nodes` to the END of one of this member's notes, as ONE
    read-and-write inside `BEGIN IMMEDIATE`: the body is read under the write
    lock and the update is a compare-and-set against exactly that read, so a
    concurrent edit is kept, never overwritten. Shared by the personal API's
    append and by email-in's attachment linking (fix round 1, M-6).

    ⛔ Tenant-scoped in the read (`user_id` in the WHERE): another member's
    note, a trashed note and a missing one are the same 404; a locked note is
    423."""
    from api.services.journal_two import notes as notes_service

    if not isinstance(note_id, str) or not note_id:
        raise PersonalApiError(404, NOT_FOUND_SENTENCE)
    conn = get_connection()
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT body_json, updated_at, locked FROM j2_notes"
            " WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (note_id, user_id),
        ).fetchone()
        if row is None:
            conn.rollback()
            raise PersonalApiError(404, NOT_FOUND_SENTENCE)
        if row["locked"]:
            conn.rollback()
            raise PersonalApiError(423, LOCKED_SENTENCE)
        try:
            doc = json.loads(row["body_json"] or "{}")
        except (TypeError, ValueError):
            doc = {}
        if not isinstance(doc, dict) or doc.get("type") != "doc":
            doc = {"type": "doc", "content": []}
        content = list(doc.get("content") or [])
        # A fresh note's body is one empty paragraph; appending after it would
        # leave a blank line at the top of what the member wrote.
        if len(content) == 1 and _is_empty_paragraph(content[0]):
            content = []
        new_doc = {**doc, "content": content + nodes}
        try:
            note = notes_service.update_note(
                user_id, note_id, {"bodyJson": new_doc}, conn=conn,
                expected_updated_at=row["updated_at"])
        except notes_service.NoteConflictError as e:
            raise PersonalApiError(409, CHANGED_SENTENCE) from e
        except notes_service.NoteValidationError as e:
            raise PersonalApiError(400, f"The note wasn't changed: {e}.") from e
        if note is None:
            raise PersonalApiError(404, NOT_FOUND_SENTENCE)
        return note
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()


def _daily_template_id(user_id: str) -> str | None:
    """The member's daily template, from the same preference the Notebook's
    Today button reads. A value stored JSON-encoded is read either way."""
    from api.services import auth_service
    raw = auth_service.get_user_preferences(user_id).get(DAILY_TEMPLATE_PREF)
    if not isinstance(raw, str) or not raw.strip():
        return None
    raw = raw.strip()
    if raw.startswith('"'):
        try:
            raw = json.loads(raw)
        except ValueError:
            return None
    return raw if isinstance(raw, str) and raw else None


def append_to_daily(user_id: str, markdown: Any, *, now: datetime | None = None) -> dict[str, Any]:
    """Append to TODAY's daily note, making it (with the member's daily
    template) if it does not exist yet.

    ⛔ THE DAY IS THE SERVER'S ET DAY (`note_tasks.today_et`), never a phone's
    clock or time zone. ⛔ EXACTLY ONE daily note per member per day even when
    two appends race on a fresh day: `note_daily.open_daily_note` answers the
    loser of the insert race with the winner's note (the unique index does the
    deciding), and the two appends then serialise on the write lock."""
    from api.services.journal_two import note_daily, note_tasks

    md = check_markdown(markdown, required=True)
    day = note_tasks.today_et(now)
    opened = note_daily.open_daily_note(user_id, day, _daily_template_id(user_id))
    note = append_markdown(user_id, opened["note"]["id"], md)
    return {"note": note, "created": bool(opened.get("created")), "day": day}
