"""Notebook export -- markdown + attachments, in the shape the importer reads.

The exported archive is deliberately the SAME shape the generic/Obsidian
importer already ingests: one .md per note with YAML front matter, folders as
directories. That makes the export a real exit rather than a gesture -- a
member can round-trip out and back in, which is the whole reason it earns
trust.

⛔ Never raises on an unknown node type. Export runs over content written by
every editor version a member has ever used, and a 500 on one odd block
would deny them the whole archive.
"""
from __future__ import annotations

import io
import json
import re
import sqlite3
import zipfile
from datetime import datetime, timezone
from typing import Any

_INLINE_MARKS = {
    "bold": ("**", "**"),
    "italic": ("*", "*"),
    "strike": ("~~", "~~"),
    "code": ("`", "`"),
}


def _fmt_time(secs: Any) -> str:
    """Port of app/src/components/video/playerUtils.js::fmtTime -- the exact
    helper the editor's own videoTimestamp node view renders with, so an
    exported timestamp reads identically to the app. `secs` may be
    missing/None/NaN/non-numeric; those coerce to 0, matching JS's
    `Number(secs) || 0`. But 0 is a real, valid timestamp (the very start of
    the clip) -- it must come out as "0:00", never be treated as absent."""
    try:
        n = float(secs)
        if n != n:  # NaN
            n = 0.0
    except (TypeError, ValueError):
        n = 0.0
    s = max(0, int(n))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def _text_with_marks(node: dict[str, Any]) -> str:
    text = node.get("text") or ""
    for mark in node.get("marks") or []:
        mtype = mark.get("type")
        if mtype == "link":
            href = (mark.get("attrs") or {}).get("href") or ""
            text = f"[{text}]({href})"
        elif mtype in _INLINE_MARKS:
            open_, close = _INLINE_MARKS[mtype]
            text = f"{open_}{text}{close}"
    return text


def _inline(nodes: list[dict[str, Any]] | None) -> str:
    out = []
    for n in nodes or []:
        if n.get("type") == "text":
            out.append(_text_with_marks(n))
        elif n.get("type") == "hardBreak":
            out.append("\n")
        else:
            out.append(_block(n))
    return "".join(out)


def _list_block(node: dict[str, Any], depth: int = 0) -> str:
    """Dispatch for the three list node types, threading nesting `depth`
    through so a list-inside-a-listItem indents under its parent bullet
    instead of rendering as a flat sibling list (fix round 1, finding 4)."""
    ntype = node.get("type")
    if ntype == "bulletList":
        return _list_items(node, lambda i: "-", depth)
    if ntype == "orderedList":
        return _list_items(node, lambda i: f"{i + 1}.", depth)
    if ntype == "taskList":
        return _list_items(node, lambda i: "-", depth)
    return ""


def _list_items(node: dict[str, Any], bullet, depth: int = 0) -> str:
    """Render one list's items at `depth` (0 = top level). A child
    bulletList/orderedList/taskList inside an item is rendered at depth+1 and
    appended as indented lines UNDER that item, rather than flattened to a
    sibling list at depth 0 -- outlines are a primary reason people keep
    notes, and collapsing their hierarchy is content loss even though every
    word of text survives (fix round 1, finding 4)."""
    indent = "  " * depth
    lines = []
    i = 0  # ordinal among ITEMS (not output lines -- a nested list appends
    # extra lines per item, which must never shift a later item's number)
    for item in node.get("content") or []:
        if not isinstance(item, dict):
            continue
        parts = []
        nested_blocks = []
        for c in item.get("content") or []:
            ctype = c.get("type") if isinstance(c, dict) else None
            if ctype in ("bulletList", "orderedList", "taskList"):
                nested = _list_block(c, depth + 1)
                if nested:
                    nested_blocks.append(nested)
            else:
                b = _block(c)
                if b:
                    parts.append(b)
        inner = "\n".join(parts).strip()
        if item.get("type") == "taskItem":
            box = "x" if (item.get("attrs") or {}).get("checked") else " "
            lines.append(f"{indent}- [{box}] {inner}")
        else:
            lines.append(f"{indent}{bullet(i)} {inner}")
        lines.extend(nested_blocks)
        i += 1
    return "\n".join(lines)


def _table(node: dict[str, Any]) -> str:
    rows: list[list[str]] = []
    for row in node.get("content") or []:
        cells = [
            "\n".join(_block(c) for c in (cell.get("content") or [])).strip()
            for cell in (row.get("content") or [])
        ]
        rows.append(cells)
    if not rows:
        return ""
    out = ["| " + " | ".join(rows[0]) + " |",
           "| " + " | ".join("---" for _ in rows[0]) + " |"]
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


def _block(node: dict[str, Any]) -> str:
    ntype = node.get("type")
    attrs = node.get("attrs") or {}
    kids = node.get("content")

    if ntype == "text":
        return _text_with_marks(node)
    if ntype == "paragraph":
        return _inline(kids)
    if ntype == "heading":
        level = int(attrs.get("level") or 1)
        return f"{'#' * max(1, min(level, 6))} {_inline(kids)}"
    if ntype in ("bulletList", "orderedList", "taskList"):
        return _list_block(node, 0)
    if ntype == "listItem":
        return "\n".join(_block(c) for c in (kids or []))
    if ntype == "blockquote":
        inner = "\n".join(_block(c) for c in (kids or []))
        return "\n".join(f"> {ln}" for ln in inner.split("\n"))
    if ntype == "codeBlock":
        lang = attrs.get("language") or ""
        return f"```{lang}\n{_inline(kids)}\n```"
    if ntype == "horizontalRule":
        return "---"
    if ntype == "hardBreak":
        return "\n"
    if ntype in ("image", "resizableImage"):
        src = attrs.get("src") or ""
        return f"![{attrs.get('alt') or ''}]({src})"
    if ntype == "attachmentChip":
        return f"[{attrs.get('name') or 'attachment'}]({attrs.get('href') or ''})"
    if ntype == "videoTimestamp":
        # Mirrors app/src/components/video/playerUtils.js::fmtTime exactly --
        # the same helper the editor's own node view renders with
        # (videoTimestampNode.js has only a `seconds` attr, no `label`; an
        # `or` chain here would swallow a real 0-second timestamp as if it
        # were absent, per fix round 1 finding 3).
        return f"[{_fmt_time(attrs.get('seconds'))}]"
    if ntype == "widgetEmbed":
        # A live widget cannot exist in markdown. Exporting nothing would make
        # the note look like it lost content, so emit the widget's own
        # pre-computed search line -- the same string that feeds body_plain.
        label = attrs.get("searchText") or attrs.get("widgetId") or "widget"
        return f"> [{label}]"
    if ntype == "table":
        return _table(node)

    # Unknown node (a block added after this exporter was written): keep the
    # member's text rather than dropping it or raising.
    if kids:
        return "\n".join(_block(c) for c in kids)
    return ""


def tiptap_to_markdown(doc: dict[str, Any] | None) -> str:
    """TipTap document JSON -> markdown. Never raises on unknown nodes."""
    if not isinstance(doc, dict):
        return ""
    blocks = [_block(n) for n in (doc.get("content") or [])]
    return "\n\n".join(b for b in blocks if b != "").strip()


_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_name(name: str, fallback: str) -> str:
    cleaned = _UNSAFE.sub("-", (name or "").strip()).strip(". ")
    return (cleaned or fallback)[:120]


def _folder_path(folder_id: str | None, folders: dict[str, tuple[str, str]]) -> str:
    """Full nested directory path for a folder, walking the parent_id chain.

    j2_note_folders is a real tree (`parent_id`, TEXT sentinel '' for roots --
    NOT NULL). Resolving only the immediate folder name would collapse a
    nested library ("Trading/Setups/Cup and Handle") down to one level
    ("Setups/") on every export, which is silent data loss for anyone who
    actually organized their notes into subfolders -- and it would round-trip
    wrong, since the importer's own `folderPath` is a full segment list
    (see `notes.py::import_confirm`). Cycle-guarded like `_folder_depth` in
    notes.py, in case of a corrupted parent chain.
    """
    parts: list[str] = []
    seen: set[str] = set()
    cur = folder_id or ""
    while cur and cur in folders and cur not in seen:
        seen.add(cur)
        name, parent_id = folders[cur]
        parts.append(_safe_name(name, "folder"))
        cur = parent_id or ""
    parts.reverse()
    return "/".join(parts)


def _front_matter(row: sqlite3.Row) -> str:
    try:
        tags = json.loads(row["tags"] or "[]")
    except (ValueError, TypeError):
        tags = []
    lines = ["---", f"title: {row['title'] or 'Untitled'}"]
    # subtitle (authored text) and hero_image_url (the note's headline visual)
    # are real j2_notes columns -- dropping them from the archive is silent
    # content loss a member notices immediately (fix round 1, finding 2).
    if row["subtitle"]:
        lines.append(f"subtitle: {row['subtitle']}")
    if row["ticker"]:
        lines.append(f"ticker: {row['ticker']}")
    if tags:
        lines.append("tags: [" + ", ".join(str(t) for t in tags) + "]")
    if row["hero_image_url"]:
        lines.append(f"hero_image: {row['hero_image_url']}")
    lines.append(f"created: {row['created_at']}")
    lines.append(f"updated: {row['updated_at']}")
    lines.append("---")
    return "\n".join(lines)


def build_export_zip(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> tuple[bytes, str]:
    """Every note this user owns, as markdown in a zip. Returns (bytes, filename).

    ⛔ Scoped by user_id in SQL, never filtered in Python -- an export is the
    highest-blast-radius place a tenancy mistake could land."""
    from api.services.auth_db import get_connection

    owned = conn is None
    conn = conn or get_connection()
    try:
        folders = {
            r["id"]: (r["name"], r["parent_id"]) for r in conn.execute(
                "SELECT id, name, parent_id FROM j2_note_folders WHERE user_id = ?",
                (user_id,))
        }
        rows = conn.execute(
            "SELECT id, title, subtitle, body_json, tags, ticker, folder_id,"
            " hero_image_url, created_at, updated_at FROM j2_notes"
            " WHERE user_id = ? ORDER BY updated_at DESC", (user_id,),
        ).fetchall()

        buf = io.BytesIO()
        used: set[str] = set()
        failures: list[tuple[str, str]] = []
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for row in rows:
                try:
                    doc = json.loads(row["body_json"] or "{}")
                except (ValueError, TypeError):
                    doc = {}
                try:
                    body = tiptap_to_markdown(doc)
                except Exception as exc:  # noqa: BLE001 -- deliberately broad.
                    # One malformed note (e.g. a non-dict entry in a content
                    # array) must never deny the member the rest of a
                    # 4,000-note archive. The note still exports -- front
                    # matter intact, a visible marker in place of the body --
                    # rather than vanishing silently or aborting the whole
                    # run (fix round 1, finding 1).
                    body = (
                        "> ⚠ This note's content could not be converted "
                        f"for export ({type(exc).__name__}). The original "
                        "note is unaffected in the app -- contact support if "
                        "this repeats."
                    )
                    failures.append((row["id"], row["title"] or "Untitled"))
                folder = _folder_path(row["folder_id"], folders)
                base = _safe_name(row["title"], row["id"])
                path = f"{folder}/{base}" if folder else base
                # Two notes may share a title; the id keeps them distinct.
                if f"{path}.md" in used:
                    path = f"{path}-{row['id'][:8]}"
                used.add(f"{path}.md")
                zf.writestr(f"{path}.md", f"{_front_matter(row)}\n\n{body}\n")

            if failures:
                # The archive tells the member itself -- a top-level manifest
                # beside the per-file marker above, so a partial failure is
                # never silent even if they never open the affected file.
                lines = [
                    "The following notes could not be fully converted to "
                    "markdown during export. Each one still exported with "
                    "its title, tags and other front matter intact -- only "
                    "the body content was affected.",
                    "",
                ]
                lines += [f"- {title} (id: {nid})" for nid, title in failures]
                zf.writestr("EXPORT_ISSUES.txt", "\n".join(lines) + "\n")

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return buf.getvalue(), f"uct-notebook-export-{stamp}.zip"
    finally:
        if owned:
            conn.close()
