"""Notebook export -- markdown + attachments, human-readable and portable.

The exported archive is one .md per note with YAML front matter, folders as
directories -- a format meant to be readable by any Markdown-aware tool.

✅ It DOES round-trip back into this product now (fixed 2026-09-02, same
adversarial-audit finding A4 that first measured the gap below). Measured
against the real `detectAdapter()` + adapter `parse()` path
(`app/src/pages/journal-2-0/lib/importer/`): a real export zip built by this
module is now claimed by a dedicated `uctAdapter` (detect score 0.97, keyed
off an unconditional `UCT_NOTEBOOK_EXPORT.json` manifest this module writes
into every archive) and imports with title, subtitle, ticker, tags (including
a quoted flow-sequence item containing a literal comma), hero image, inline
image, file attachment, and both real created/updated dates all intact --
proven by a real round trip, not an isolated unit test on either side:
`app/src/pages/journal-2-0/lib/importer/exportRoundtrip.test.js` builds an
archive through this module's own `build_export_zip` (via the
`roundtrip_export_fixture.py` CLI bridge, since the export is Python and the
importer is JS) and feeds it through the real detect+parse path.

The three underlying defects this found are fixed in the SHARED adapters, not
behind the new marker: `generic.js` now strips/honors YAML front matter
(title/subtitle/ticker/tags/hero_image/dates) instead of re-rendering it as a
visible CommonMark heading; `obsidian.js` now resolves ordinary CommonMark
`![alt](path)`/`[text](path)` attachment references the same way `generic.js`
does (not just `![[wiki-embeds]]`), so its `attachments/` support helps a real
vault that has "Use Wikilinks" turned off, not just this export; and its
flow-sequence tag parser is quote-aware, so `[swing, "reclaim, tight"]` no
longer mis-splits on the comma inside the quotes. A member who drops in a
SUBSET of an export (a few .md files, no manifest, no attachments/ tree)
therefore still imports sensibly via the ordinary generic/obsidian path --
the manifest only sharpens detection of a WHOLE, unmodified export; see
`app/src/pages/journal-2-0/lib/importer/adapters/uct.js`'s own docstring for
the full reasoning on why detection is deliberately not marker-only.

⛔ Never raises on an unknown node type. Export runs over content written by
every editor version a member has ever used, and a 500 on one odd block
would deny them the whole archive.

Attachment bundling (Task 8): image/attachmentChip/hero URLs that point at our
own authenticated `/api/j2/notes/attachments/...` route are copied INTO the
archive and every markdown link is rewritten to a relative path alongside the
.md file -- otherwise "export" is a member's text with every picture and file
still living behind a login they are about to lose. A URL that is NOT one of
ours (a plain external link) is left completely untouched.
"""
from __future__ import annotations

import io
import json
import os
import posixpath
import re
import sqlite3
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anyio

from api.services.journal_two.attachment_root import read_candidates_with_roots

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


# ── Attachment bundling ──────────────────────────────────────────────────────
#
# `save_note_image_bytes`/`save_note_attachment_bytes` (notes.py) write files to
# `_ATTACHMENT_ROOT/{user_id}/notes/{note_id}/{sub}/{filename}` (sub is
# "hero"|"inline"|"file") and stamp the note body with the URL
# `/api/j2/notes/attachments/{user_id}/{note_id}/{sub}/{filename}` -- the exact
# same shape whether it came from an inline image, a hero image, or a
# non-image file (attachmentChip). This regex is the ONE place that URL shape
# is parsed back apart; keep it byte-identical to the f-string that builds it.
_ATTACHMENT_URL_RE = re.compile(
    r"^/api/j2/notes/attachments/([^/]+)/([^/]+)/(hero|inline|file)/([^/]+)$"
)

# Default ceiling on TOTAL bundled attachment bytes per export. This is a
# synchronous request on a single-replica pod (the whole zip is built in
# memory before the response is returned), so it must be bounded independent
# of how large one member's library gets. Per-file caps are already 5MB
# (image) / 25MB (file) -- 200 MiB comfortably covers the large majority of
# libraries (Task 4 measured the entire attachment volume at 6MB across every
# user) while keeping the worst case small relative to a single pod's memory
# under concurrent requests. Override with NOTE_EXPORT_MAX_ATTACHMENT_BYTES.
_DEFAULT_ATTACHMENT_CAP_BYTES = 200 * 1024 * 1024


def _attachment_cap_bytes() -> int:
    override = os.environ.get("NOTE_EXPORT_MAX_ATTACHMENT_BYTES")
    if override is not None:
        try:
            return int(override)
        except ValueError:
            pass
    return _DEFAULT_ATTACHMENT_CAP_BYTES


def _resolve_attachment_path(user_id: str, note_id: str, sub: str, filename: str):
    """Member-controlled `note_id`/`filename` -> a real file INSIDE the
    attachment root, or None. Resolve first, THEN containment-check against
    the resolved root -- a bare prefix/string compare is defeated by `..`.
    Belt: reject any segment that is itself `..` or contains a separator
    before ever touching the filesystem. Suspenders: after resolving the
    candidate, require it to still be `relative_to` the RESOLVED root (not
    the unresolved one) -- this is what actually catches an escape (a `..`
    segment, OR a symlink/junction under the root whose target lands outside
    it) that string-matching would miss. Candidate/root PAIRS come from
    `attachment_root.read_candidates_with_roots()` -- the SAME pairing
    `notes.py::serve_note_image_path` uses -- so there is one authority over
    both "where can attachments live" AND which root each candidate must be
    checked against; this function adds nothing but its own (stricter)
    containment check per pair."""
    if sub not in ("hero", "inline", "file"):
        return None
    for part in (note_id, filename):
        if not part or part in (".", "..") or "/" in part or "\\" in part:
            return None
    if filename.startswith("."):
        return None

    rel = Path(user_id) / "notes" / note_id / sub / filename
    for root, candidate in read_candidates_with_roots(rel):
        try:
            target = candidate.resolve()
            target.relative_to(root.resolve())
            # `is_file()` stats the filesystem too -- it belongs in the SAME
            # guard as `resolve()`/`relative_to()` above. A permission error
            # here (an EACCES mount, a race with a delete) used to propagate
            # straight out of this function; the hero-image call site (below,
            # in `_make_attachment_resolver`) has no per-note shield of its
            # own, so that one EACCES took down the entire archive rather
            # than just this one attachment (review finding, fix round 2).
            is_match = target.is_file()
        except (OSError, ValueError):
            continue
        if is_match:
            return target
    return None


def _zip_rel_for(user_id: str, note_id: str, sub: str, filename: str) -> str:
    return f"attachments/{user_id}/{note_id}/{sub}/{filename}"


def _relative_link(note_folder: str, zip_rel: str) -> str:
    """A markdown link from a .md file living at `note_folder` (folder ONLY,
    no filename -- '' means the archive root) to `zip_rel`, so the exported
    archive is portable on its own (no server, no auth) rather than merely
    accompanied by orphan binaries."""
    return posixpath.relpath(zip_rel, note_folder or ".")


def _make_attachment_resolver(user_id: str, note_folder: str, note_id: str,
                               note_title: str, state: dict):
    """Returns a `resolver(url) -> str | None` closure bound to one note
    (its folder, for computing a relative link back to `attachments/...`)
    sharing one `state` dict across the WHOLE export, for:
      - dedup: a file referenced by ten notes is copied into the zip once
        (keyed on the deterministic zip-relative path).
      - a running byte total against the cap, shared across every note.
      - one issues list feeding the SAME EXPORT_ISSUES.txt manifest Task 3's
        per-note guard already writes to -- no second reporting channel.
    Never raises: a missing/oversized/foreign-tenant file is skipped and
    recorded, exactly like the per-note markdown-conversion guard above."""

    def resolve(url: str | None) -> str | None:
        if not url:
            return None
        m = _ATTACHMENT_URL_RE.match(url)
        if not m:
            return None  # not one of ours -- leave external links untouched
        url_user_id, note_ref_id, sub, filename = m.groups()
        if url_user_id != user_id:
            # A note body is member-authored JSON; a crafted `src` pointing
            # at another account's attachment path must never be served
            # through an export, even read-only. Silent skip + a report
            # entry, same as any other unresolvable reference.
            state["issues"].setdefault(
                url, (note_title, "not part of your account"))
            return None

        zip_rel = _zip_rel_for(url_user_id, note_ref_id, sub, filename)
        if zip_rel in state["written"]:
            return _relative_link(note_folder, zip_rel)
        if zip_rel in state["failed"]:
            return None

        path = _resolve_attachment_path(url_user_id, note_ref_id, sub, filename)
        if path is None:
            state["failed"].add(zip_rel)
            state["issues"].setdefault(
                url, (note_title, "file missing on the attachment volume"))
            return None
        try:
            size = path.stat().st_size
            if state["used_bytes"] + size > state["cap_bytes"]:
                state["failed"].add(zip_rel)
                state["issues"].setdefault(
                    url, (note_title,
                          "left out: export attachment size cap reached"))
                return None
            data = path.read_bytes()
        except OSError:
            state["failed"].add(zip_rel)
            state["issues"].setdefault(
                url, (note_title, "file could not be read"))
            return None

        try:
            # Same OSError shield as the read above -- a write failure (full
            # disk, a torn temp-file handle) is exactly as recoverable as a
            # read failure: skip THIS attachment, record why, keep exporting
            # everything else (review finding, fix round 2 -- this call used
            # to sit outside any except clause here).
            state["zf"].writestr(zip_rel, data)
        except OSError:
            state["failed"].add(zip_rel)
            state["issues"].setdefault(
                url, (note_title, "file could not be added to the archive"))
            return None
        state["written"].add(zip_rel)
        state["used_bytes"] += size
        return _relative_link(note_folder, zip_rel)

    return resolve


def _text_with_marks(node: dict[str, Any], resolver=None) -> str:
    text = node.get("text") or ""
    for mark in node.get("marks") or []:
        mtype = mark.get("type")
        if mtype == "link":
            href = (mark.get("attrs") or {}).get("href") or ""
            local = resolver(href) if resolver else None
            text = f"[{text}]({local or href})"
        elif mtype in _INLINE_MARKS:
            open_, close = _INLINE_MARKS[mtype]
            text = f"{open_}{text}{close}"
    return text


def _inline(nodes: list[dict[str, Any]] | None, resolver=None) -> str:
    out = []
    for n in nodes or []:
        if n.get("type") == "text":
            out.append(_text_with_marks(n, resolver))
        elif n.get("type") == "hardBreak":
            out.append("\n")
        else:
            out.append(_block(n, resolver))
    return "".join(out)


def _list_block(node: dict[str, Any], depth: int = 0, resolver=None) -> str:
    """Dispatch for the three list node types, threading nesting `depth`
    through so a list-inside-a-listItem indents under its parent bullet
    instead of rendering as a flat sibling list (fix round 1, finding 4)."""
    ntype = node.get("type")
    if ntype == "bulletList":
        return _list_items(node, lambda i: "-", depth, resolver)
    if ntype == "orderedList":
        return _list_items(node, lambda i: f"{i + 1}.", depth, resolver)
    if ntype == "taskList":
        return _list_items(node, lambda i: "-", depth, resolver)
    return ""


def _list_items(node: dict[str, Any], bullet, depth: int = 0, resolver=None) -> str:
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
                nested = _list_block(c, depth + 1, resolver)
                if nested:
                    nested_blocks.append(nested)
            else:
                b = _block(c, resolver)
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


def _table(node: dict[str, Any], resolver=None) -> str:
    rows: list[list[str]] = []
    for row in node.get("content") or []:
        cells = [
            "\n".join(_block(c, resolver) for c in (cell.get("content") or [])).strip()
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


def _block(node: dict[str, Any], resolver=None) -> str:
    ntype = node.get("type")
    attrs = node.get("attrs") or {}
    kids = node.get("content")

    if ntype == "text":
        return _text_with_marks(node, resolver)
    if ntype == "paragraph":
        return _inline(kids, resolver)
    if ntype == "heading":
        level = int(attrs.get("level") or 1)
        return f"{'#' * max(1, min(level, 6))} {_inline(kids, resolver)}"
    if ntype in ("bulletList", "orderedList", "taskList"):
        return _list_block(node, 0, resolver)
    if ntype == "listItem":
        return "\n".join(_block(c, resolver) for c in (kids or []))
    if ntype == "blockquote":
        inner = "\n".join(_block(c, resolver) for c in (kids or []))
        return "\n".join(f"> {ln}" for ln in inner.split("\n"))
    if ntype == "codeBlock":
        lang = attrs.get("language") or ""
        return f"```{lang}\n{_inline(kids, resolver)}\n```"
    if ntype == "horizontalRule":
        return "---"
    if ntype == "hardBreak":
        return "\n"
    if ntype in ("image", "resizableImage"):
        src = attrs.get("src") or ""
        local = resolver(src) if resolver else None
        return f"![{attrs.get('alt') or ''}]({local or src})"
    if ntype == "attachmentChip":
        href = attrs.get("href") or ""
        local = resolver(href) if resolver else None
        return f"[{attrs.get('name') or 'attachment'}]({local or href})"
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
        return _table(node, resolver)
    if ntype == "callout":
        # Round-trips through the SAME shape the importer reads (see
        # calloutNode.js / importer/convert.js::mapCalloutsAndToggles):
        # Notion's own classic Markdown export represents a callout as a raw
        # `<aside>` HTML island with the emoji inline as the leading
        # character of the text. `<aside>` is a CommonMark "type 6" HTML
        # block, which TERMINATES AT THE FIRST BLANK LINE -- so nested
        # blocks are joined with a single "\n", never "\n\n", or the
        # closing `</aside>` would land outside the block and reappear as
        # literal text on re-import.
        emoji = str(attrs.get("emoji") or "\U0001F4A1")
        inner = "\n".join(b for b in (_block(c, resolver) for c in (kids or [])) if b != "")
        first_line = f"{emoji} {inner}" if inner else emoji
        return f"<aside>\n{first_line}\n</aside>"
    if ntype == "toggle":
        # content = [toggleSummary, toggleContent] by schema, but this reads
        # them by NAME rather than by position -- never raise on a
        # future/older client that reorders or omits one (module docstring).
        summary_node = next(
            (c for c in (kids or []) if isinstance(c, dict) and c.get("type") == "toggleSummary"), None)
        content_node = next(
            (c for c in (kids or []) if isinstance(c, dict) and c.get("type") == "toggleContent"), None)
        summary_text = _inline((summary_node or {}).get("content"), resolver)
        body_kids = (content_node or {}).get("content") or []
        body = "\n".join(b for b in (_block(c, resolver) for c in body_kids) if b != "")
        # Same CommonMark type-6-HTML-block constraint as callout above:
        # `<details>`/`<summary>` are BOTH in the html-block tag list, so no
        # blank line may appear between the opening and closing tags.
        return f"<details>\n<summary>{summary_text}</summary>\n{body}\n</details>"
    if ntype == "toggleSummary":
        return _inline(kids, resolver)
    if ntype == "toggleContent":
        return "\n".join(_block(c, resolver) for c in (kids or []))

    # Unknown node (a block added after this exporter was written): keep the
    # member's text rather than dropping it or raising.
    if kids:
        return "\n".join(_block(c, resolver) for c in kids)
    return ""


def tiptap_to_markdown(doc: dict[str, Any] | None, *, attachment_resolver=None) -> str:
    """TipTap document JSON -> markdown. Never raises on unknown nodes.

    `attachment_resolver`, if given, is called with every image/attachmentChip/
    link URL the walk encounters: `resolver(url) -> local_relative_path | None`.
    A None return (not one of our attachment URLs, or unresolvable) leaves the
    original URL untouched -- callers that don't pass a resolver see byte-
    identical output to before attachment bundling existed."""
    if not isinstance(doc, dict):
        return ""
    blocks = [_block(n, attachment_resolver) for n in (doc.get("content") or [])]
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


# ── YAML front matter escaping ───────────────────────────────────────────────
#
# Front matter is real YAML -- Obsidian (and any other tool a member points at
# this export) parses it as such, and this app's OWN importer strips it with a
# YAML-shaped regex too (the shared `app/src/pages/journal-2-0/lib/importer/
# frontmatter.js` module's `FRONTMATTER_RE` + `parseFrontmatterBlock`, used by
# both `generic.js` and `obsidian.js`). Before this fix
# every value was interpolated bare: `f"title: {row['title']}"`. A title
# containing a colon ("Setup: NVDA reclaim" -- an entirely ordinary title, not
# an edge case) puts a SECOND colon on the `title:` line, which a compliant
# YAML parser reads as a nested mapping and rejects or mis-parses; an embedded
# newline splits the scalar across lines the front-matter block was never
# built to hold. Either one corrupts the round trip back through the
# importer, which is the export's whole stated reason to exist.
#
# `_yaml_scalar` renders a value as a bare plain scalar when that is safe,
# and as a YAML double-quoted scalar (backslash escapes) otherwise -- so an
# ordinary title/subtitle/ticker/URL keeps rendering byte-identically to
# before this fix, and only a value that would actually break parsing pays
# for the quotes.
_YAML_LEADING_UNSAFE = set("-?:,[]{}#&*!|>'\"%@`")
_YAML_RESERVED_SCALARS = {"true", "false", "null", "~", "yes", "no", "on", "off"}
_YAML_NUMERIC_RE = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def _yaml_needs_quoting(value: str, *, flow: bool = False) -> bool:
    if value == "" or value != value.strip():
        return True
    if value[0] in _YAML_LEADING_UNSAFE:
        return True
    if any(c in value for c in ("\n", "\r", "\t")):
        return True
    # A colon is only a YAML mapping indicator when followed by whitespace
    # (or at end-of-line) -- a bare "https://..." colon is unambiguous and
    # every existing export keeps rendering those bare.
    if ": " in value or value.endswith(":"):
        return True
    if " #" in value:
        return True
    if value.lower() in _YAML_RESERVED_SCALARS or _YAML_NUMERIC_RE.match(value):
        return True
    # Inside a flow sequence (`tags: [a, b]`) an unquoted comma/bracket/brace
    # ANYWHERE in the item is a real delimiter, not just when leading.
    if flow and any(c in value for c in (",", "[", "]", "{", "}")):
        return True
    return False


def _yaml_scalar(value: str, *, flow: bool = False) -> str:
    """Render `value` as a single YAML scalar safe to place after `key: `
    (or inside a `[...]` flow sequence when `flow=True`)."""
    if not _yaml_needs_quoting(value, flow=flow):
        return value
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'


def _front_matter(row: sqlite3.Row, hero_local: str | None = None) -> str:
    try:
        tags = json.loads(row["tags"] or "[]")
    except (ValueError, TypeError):
        tags = []
    lines = ["---", f"title: {_yaml_scalar(row['title'] or 'Untitled')}"]
    # subtitle (authored text) and hero_image_url (the note's headline visual)
    # are real j2_notes columns -- dropping them from the archive is silent
    # content loss a member notices immediately (fix round 1, finding 2).
    if row["subtitle"]:
        lines.append(f"subtitle: {_yaml_scalar(row['subtitle'])}")
    if row["ticker"]:
        lines.append(f"ticker: {_yaml_scalar(row['ticker'])}")
    if tags:
        lines.append(
            "tags: [" + ", ".join(_yaml_scalar(str(t), flow=True) for t in tags) + "]"
        )
    if row["hero_image_url"]:
        # hero_local is the bundled-into-the-archive relative path when the
        # hero URL was one of ours and resolved cleanly; otherwise (external
        # URL, or unresolved -- already reported in EXPORT_ISSUES.txt) the
        # original value is kept so the front matter never goes blank.
        lines.append(f"hero_image: {_yaml_scalar(hero_local or row['hero_image_url'])}")
    lines.append(f"created: {row['created_at']}")
    lines.append(f"updated: {row['updated_at']}")
    lines.append("---")
    return "\n".join(lines)


#
# Round-trip self-identification (2026-09-02 adversarial audit, finding A4).
#
# `EXPORT_ISSUES.txt` is written ONLY when something was skipped, so it
# cannot double as "this zip came from us" -- most exports never write it.
# `_EXPORT_MANIFEST_NAME` is written UNCONDITIONALLY on every export instead,
# purely so the frontend importer's `detectAdapter()` can recognize a whole,
# untouched archive from this product at high confidence (the dedicated
# `uctAdapter` in `app/src/pages/journal-2-0/lib/importer/adapters/uct.js`)
# and label it honestly instead of guessing "Obsidian" or "Files".
#
# This is deliberately NOT the only way an export round-trips: a member who
# pulls a handful of .md files out of an export (dropping the manifest and
# the attachments/ tree with them) has no marker left to find, so detection
# falls through to the generic adapter same as any other loose markdown --
# which is exactly why the front-matter/attachment/hero-image fixes in this
# same audit finding live in the SHARED `generic.js`/`obsidian.js` adapters
# rather than only behind this marker. The manifest makes the common case
# (a whole, unmodified export) unambiguous; it is not load-bearing for the
# subset case to still import sensibly.
_EXPORT_MANIFEST_NAME = "UCT_NOTEBOOK_EXPORT.json"
_EXPORT_MANIFEST_VERSION = 1


def _write_notes_archive(
    zf: zipfile.ZipFile, user_id: str, conn: sqlite3.Connection,
) -> None:
    """Writes every note `user_id` owns -- markdown + front matter + bundled
    attachments -- into an already-open `zf`, plus the unconditional
    `_EXPORT_MANIFEST_NAME` self-identification marker and EXPORT_ISSUES.txt
    when anything was skipped. Shared by both `build_export_zip` (in-memory,
    BytesIO-backed -- kept for this file's own direct unit testing of archive
    content) and `build_export_zip_to_tempfile` (disk-backed -- what the
    export ROUTE actually uses); the archive-building logic itself must be
    identical either way, so it lives here once.

    ⛔ Scoped by user_id in SQL, never filtered in Python -- an export is the
    highest-blast-radius place a tenancy mistake could land."""
    folders = {
        r["id"]: (r["name"], r["parent_id"]) for r in conn.execute(
            "SELECT id, name, parent_id FROM j2_note_folders WHERE user_id = ?",
            (user_id,))
    }
    # Wave 0 trash: an export mirrors the member's ACTIVE notebook, not the
    # trash — a soft-deleted note excluded here matches what they currently
    # see everywhere else (list, search, tags, backlinks). The 30-day
    # retention window is the safety net for "I want it back", not the
    # export.
    rows = conn.execute(
        "SELECT id, title, subtitle, body_json, tags, ticker, folder_id,"
        " hero_image_url, created_at, updated_at FROM j2_notes"
        " WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
        (user_id,),
    ).fetchall()

    zf.writestr(_EXPORT_MANIFEST_NAME, json.dumps({
        "product": "uct-notebook-export",
        "manifest_version": _EXPORT_MANIFEST_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "note_count": len(rows),
    }))

    used: set[str] = set()
    failures: list[tuple[str, str]] = []
    # ONE dict shared across every note: dedup (a file ten notes reference is
    # copied into the zip once), a running byte total against the shared cap,
    # and one issues list feeding the SAME EXPORT_ISSUES.txt manifest the
    # per-note guard below writes to.
    attach_state: dict[str, Any] = {
        "zf": zf, "written": set(), "failed": set(), "issues": {},
        "used_bytes": 0, "cap_bytes": _attachment_cap_bytes(),
    }
    for row in rows:
        try:
            doc = json.loads(row["body_json"] or "{}")
        except (ValueError, TypeError):
            doc = {}
        note_title = row["title"] or "Untitled"
        # Folder is needed BEFORE walking the body, so the attachment
        # resolver can compute a relative link from wherever this note's .md
        # file will live back to the shared attachments/ tree. It never
        # changes below (only the leaf filename might, on a title
        # collision), so this is stable to compute early.
        folder = _folder_path(row["folder_id"], folders)
        resolver = _make_attachment_resolver(
            user_id, folder, row["id"], note_title, attach_state,
        )
        try:
            body = tiptap_to_markdown(doc, attachment_resolver=resolver)
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
            failures.append((row["id"], note_title))
        # The hero-image resolver call gets the SAME broad shield as the body
        # walk above -- review finding, fix round 2: this call used to sit
        # OUTSIDE any per-note guard, so a raise from hero resolution (the
        # `is_file()`/`writestr()` OSError leaks fixed above, or anything
        # else) took down the WHOLE archive instead of costing this one note
        # its hero image, exactly the failure shape already prevented for
        # the body walk.
        hero_local = None
        if row["hero_image_url"]:
            try:
                hero_local = resolver(row["hero_image_url"])
            except Exception:  # noqa: BLE001 -- deliberately broad, see above.
                attach_state["issues"].setdefault(
                    row["hero_image_url"],
                    (note_title, "hero image could not be bundled"),
                )
        base = _safe_name(row["title"], row["id"])
        path = f"{folder}/{base}" if folder else base
        # Two notes may share a title; the id keeps them distinct.
        if f"{path}.md" in used:
            path = f"{path}-{row['id'][:8]}"
        used.add(f"{path}.md")
        zf.writestr(
            f"{path}.md",
            f"{_front_matter(row, hero_local)}\n\n{body}\n",
        )

    issue_lines: list[str] = []
    if failures:
        # The archive tells the member itself -- a top-level manifest
        # beside the per-file marker above, so a partial failure is
        # never silent even if they never open the affected file.
        issue_lines += [
            "The following notes could not be fully converted to "
            "markdown during export. Each one still exported with "
            "its title, tags and other front matter intact -- only "
            "the body content was affected.",
            "",
        ]
        issue_lines += [f"- {title} (id: {nid})" for nid, title in failures]

    if attach_state["issues"]:
        if issue_lines:
            issue_lines.append("")
        issue_lines += [
            "The following attachments could not be bundled into "
            "this archive. The note text above still links to them "
            "by their original in-app address, which stops working "
            "once the account is no longer active.",
            "",
        ]
        issue_lines += [
            f"- {url} (referenced by \"{title}\") -- {reason}"
            for url, (title, reason) in attach_state["issues"].items()
        ]

    if issue_lines:
        zf.writestr("EXPORT_ISSUES.txt", "\n".join(issue_lines) + "\n")


def build_export_zip(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> tuple[bytes, str]:
    """Every note this user owns, as markdown in a zip. Returns (bytes, filename).

    In-memory (BytesIO) builder, retained for this file's own direct unit
    testing of archive content/fidelity/tenancy. ⛔ The export ROUTE does NOT
    call this -- see `build_export_zip_to_tempfile`: building the WHOLE
    archive as one in-memory `bytes` object (this function's BytesIO backing
    array, doubled again by `.getvalue()`'s copy) is exactly the two-copies
    shape that turns a rare, member-initiated download into a 400+MiB peak on
    a single-replica pod with documented OOM history."""
    from api.services.auth_db import get_connection

    owned = conn is None
    conn = conn or get_connection()
    try:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            _write_notes_archive(zf, user_id, conn)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return buf.getvalue(), f"uct-notebook-export-{stamp}.zip"
    finally:
        if owned:
            conn.close()


def build_export_zip_to_tempfile(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> tuple[Path, str]:
    """Same archive as `build_export_zip`, built directly to a real file on
    disk instead of an in-memory BytesIO. This is what the export ROUTE uses:
    peak memory during the build is bounded by whatever one note's markdown
    + one attachment's bytes cost transiently (zipfile buffers each
    `writestr()` call, then flushes to disk), never by the archive's total
    size.

    Caller owns deleting the returned path once done with it. ⛔ The route's
    streaming generator (`stream_export_file`) does this in a `finally`,
    which covers success and in-generator errors -- it does NOT cover a
    client disconnect, whatever this docstring used to claim. Starlette
    parks the generator at its `yield` rather than throwing in, so that
    `finally` is reached only at GC (the same measured defect as the slot
    leak). The backstop is `_sweep_abandoned_export_archives`, run from
    `acquire_export_slot`."""
    from api.services.auth_db import get_connection

    owned = conn is None
    conn = conn or get_connection()
    try:
        fd, tmp_name = tempfile.mkstemp(suffix=".zip", prefix="j2-notes-export-")
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
                _write_notes_archive(zf, user_id, conn)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return tmp_path, f"uct-notebook-export-{stamp}.zip"
    finally:
        if owned:
            conn.close()


# ── Concurrency guard + streaming (route-facing) ─────────────────────────────
#
# A single-replica pod with documented OOM history must never run more than a
# small, fixed number of exports at once -- each one now costs one archive's
# worth of disk + transient per-note/per-attachment memory rather than the
# old two-full-copies-in-RAM shape, but "bounded per export" still isn't
# "safe at any concurrency". Chosen: a small process-wide semaphore (default
# 1 -- literally one export in flight at a time on this pod), non-blocking
# acquire. A blocking queue was considered and rejected: queuing a second
# request behind another member's multi-minute build would tie up a request
# thread for no better reason than not having said "busy" sooner, on a pod
# that has already OOM'd from stacked concurrent work twice. A refused
# request (429) costs the member nothing but a retry. This also covers the
# same-member-double-clicks-the-button case as a strict subset -- one member
# exhausting the single slot with two tabs is refused exactly like two
# different members would be.
def _export_concurrency_limit() -> int:
    override = os.environ.get("NOTE_EXPORT_MAX_CONCURRENT")
    if override is not None:
        try:
            n = int(override)
            if n > 0:
                return n
        except ValueError:
            pass
    return 1


_EXPORT_STREAM_CHUNK_BYTES = 1024 * 1024  # 1 MiB read chunks

# ── Self-healing slot lease ──────────────────────────────────────────────────
#
# A `threading.BoundedSemaphore` (the prior design) is a pure counter: once
# acquired, the ONLY way a slot comes back is an explicit `.release()`. That
# is provably wrong for this call site. `stream_export_file`'s cleanup lives
# in an async generator's `finally`, and Starlette does not guarantee that
# ever runs on a real client disconnect -- a disconnect is delivered by
# cancelling whatever the STREAMING RESPONSE is currently awaiting (typically
# `send()`, mid-backpressure), not by throwing into the generator, so the
# generator is left parked at its `yield` with nothing scheduled to resume
# it. Python's asyncgen GC hook *may* eventually finalize it, but only once
# the object is actually collected -- which can be much later, or (a
# never-started generator, cancelled before its first `__anext__`, e.g.
# while `build_export_zip_to_tempfile` still runs in the threadpool) never:
# `aclose()` on a generator that never started is a documented no-op, so its
# `finally` never executes at all. Measured (see
# `test_notes_export_route.py`, driven at the real ASGI level with a
# `receive()` that emits `http.disconnect` -- not by cancelling `__anext__`
# directly, which is not a shape a real client can produce): both leaks are
# real, and the second one is permanent absent this fix.
#
# So a design that *depends on* that `finally` running is the wrong shape no
# matter how well the cleanup inside it is shielded (the shield fixed a real
# bug -- a cancellation reaching the finally would previously re-raise before
# `release_export_slot()` ran -- but it cannot fix a finally that is never
# entered at all). The invariant this module actually needs is: a slot held
# by a connection that is gone becomes available again WITHOUT an operator
# redeploying the pod. A plain counter cannot self-heal; a LEASE can -- each
# acquired slot carries an expiry, and any future acquire attempt first
# reclaims whatever has expired. `release_export_slot()` (called explicitly
# on every path that DOES run -- the generator's shielded `finally`, and the
# router's own except-block when the archive build itself raises before a
# response exists) stays as a good complement: it frees the slot immediately
# on the common paths instead of making every caller wait out the TTL. It is
# no longer the ONLY thing standing between a disconnect and a permanently
# wedged export door.
#
# This is process-local (module-global) state, same as the semaphore it
# replaces. That is deliberately fine here: the web pod this endpoint runs on
# is single-replica (see CLAUDE.md "Performance & Scale" -- the whole
# architecture assumes one uvicorn process), so there is no second worker for
# a second copy of this state to disagree with. If this pod is ever
# multi-instanced, this (like obsidian_link.py's `_used_connect_code_nonces`
# and the other single-process guards catalogued elsewhere in this codebase)
# would need a durable, shared store instead. (⛔ `_connect_code_epoch` was
# this exact example until 2026-09-02's audit finding 4 -- it is now
# persisted, so it is no longer one of these; do not cite it here again.)
_DEFAULT_EXPORT_LEASE_TTL_SECONDS = 30 * 60  # 30 minutes


def _export_lease_ttl_seconds() -> float:
    override = os.environ.get("NOTE_EXPORT_LEASE_TTL_SECONDS")
    if override is not None:
        try:
            v = float(override)
            if v > 0:
                return v
        except ValueError:
            pass
    return _DEFAULT_EXPORT_LEASE_TTL_SECONDS


# Each entry is one held slot's expiry, as a `time.monotonic()` timestamp.
# There is no per-caller lease id (none can be threaded through
# `stream_export_file(path)` or the router's bare `release_export_slot()`
# without changing signatures used outside this file), so a release cannot
# name ITS OWN lease. That makes leases fungible for COUNTING -- but NOT for
# expiry, so the entry a release retires still has to be chosen, not taken
# arbitrarily: see `release_export_slot`, which retires the minimum.
_EXPORT_LEASES: list[float] = []
_EXPORT_LEASES_LOCK = threading.Lock()


def _reclaim_expired_export_leases_locked(now: float) -> None:
    """Caller must hold `_EXPORT_LEASES_LOCK`. Drops every lease whose TTL
    has elapsed -- the self-heal half of the invariant: this runs on every
    `acquire_export_slot()` call, so an abandoned slot is reclaimed the next
    time anyone asks for capacity, with no background thread and no
    dependency on the leaked generator's own cleanup ever running."""
    _EXPORT_LEASES[:] = [exp for exp in _EXPORT_LEASES if exp > now]


# The archive files themselves leak by the SAME mechanism the lease does:
# `build_export_zip_to_tempfile` mkstemp's a zip and only
# `stream_export_file`'s `finally` deletes it -- the finally that a real
# disconnect never reaches. The slot self-heals in one TTL; the FILE used to
# survive until the next redeploy, and a member's library can be hundreds of
# MB. So sweep on the same trigger, with the same reasoning: on demand, no
# background thread, never raising into the caller.
# Bound at import so the monotonic-only fake the lease tests inject as
# `notes_export.time` cannot reach the sweep. These are genuinely two
# different clocks: a lease measures a MONOTONIC interval, the sweep
# compares a file's WALL-clock mtime, and a fake for one is wrong for the
# other.
_wall_clock = time.time

_EXPORT_TMP_PREFIX = "j2-notes-export-"
_EXPORT_TMP_GLOB = f"{_EXPORT_TMP_PREFIX}*.zip"


def _sweep_abandoned_export_archives(cutoff_age: float) -> None:
    """Delete our own abandoned temp archives older than `cutoff_age`.

    ⛔ Deliberately narrow, because this deletes files: only the directory
    `mkstemp` actually used (`tempfile.gettempdir()`, re-read per call so a
    test or an operator repointing it is honoured), only names matching this
    module's OWN mkstemp prefix, and only entries whose mtime is older than a
    full lease TTL -- an export still streaming after that has already lost
    its slot to the reclaim above. Unlinking a file another thread still has
    open is safe on POSIX (the fd stays valid); on Windows it raises, which
    is why every failure here is swallowed. A sweep that raised would break
    the acquire it is trying to help."""
    try:
        tmp_dir = Path(tempfile.gettempdir())
        now = _wall_clock()
        for entry in tmp_dir.glob(_EXPORT_TMP_GLOB):
            try:
                if now - entry.stat().st_mtime > cutoff_age:
                    entry.unlink(missing_ok=True)
            except OSError:
                continue
    except OSError:
        return


def acquire_export_slot() -> bool:
    """Non-blocking. True if a slot was claimed (caller must eventually call
    `release_export_slot()`, or route through `stream_export_file`, which
    does it in its own `finally`); False if the concurrency limit is already
    saturated. Reclaims any expired lease first, so a slot abandoned by a
    connection that is gone comes back on its own within
    `_export_lease_ttl_seconds()`, even if nothing ever explicitly released
    it."""
    ttl = _export_lease_ttl_seconds()
    _sweep_abandoned_export_archives(ttl)
    now = time.monotonic()
    with _EXPORT_LEASES_LOCK:
        _reclaim_expired_export_leases_locked(now)
        if len(_EXPORT_LEASES) >= _export_concurrency_limit():
            return False
        _EXPORT_LEASES.append(now + ttl)
        return True


def release_export_slot() -> None:
    """Frees one held slot immediately, for every path that DOES run to
    completion -- a fast complement to the TTL self-heal above, not a
    substitute for it. A release with no corresponding held lease (the slot
    already self-healed via TTL expiry, or a defensive double-release on an
    error path) is a no-op rather than an error: unlike the
    `BoundedSemaphore` this replaces, over-releasing must never raise, since
    an operator-invisible exception from inside a `finally` would be its own
    new way to leak a slot."""
    with _EXPORT_LEASES_LOCK:
        if _EXPORT_LEASES:
            # Retire the SOONEST-expiring entry, never `pop()`'s newest one.
            # Leases are fungible for COUNTING but not for EXPIRY: dropping
            # the newest leaves the shortest-lived entry standing in for an
            # export that is still streaming, so the reclaim above frees its
            # slot early and the limit briefly serves limit+1. Dropping the
            # minimum is the safe direction -- whatever is still running is
            # always covered by a lease at least as long as its own.
            # `min` rather than `pop(0)` so this holds even if the list is
            # unsorted (the TTL is read from the environment per call).
            _EXPORT_LEASES.remove(min(_EXPORT_LEASES))


def stream_export_file(path: Path):
    """Async generator streaming `path` in bounded chunks. On every path that
    the generator's own code actually resumes on -- the read loop finishing
    normally, or a cancellation delivered while control is genuinely inside
    this generator -- its `finally` closes the handle, deletes the temp
    file, and calls `release_export_slot()`, shielded
    (`anyio.CancelScope(shield=True)`) so those three steps run to
    completion even if the caller is itself in a cancelled state by then.

    ⛔ This docstring has twice asserted a stronger guarantee than the code
    actually provides, and both times the false claim is how the underlying
    defect survived review-by-reading:
      1. It used to say Starlette "cancels this generator's current await
         point ... so the `finally` below always executes before the
         request is torn down." False -- before the shield existed, a
         cancellation reaching this `finally` re-raised on its own first
         checkpoint, skipping the cleanup below it.
      2. After the shield was added, it said "the shield makes every
         checkpoint below run to completion regardless of the caller's
         cancellation state." Also false, for a reason the shield cannot
         fix: on a REAL client disconnect, Starlette's `StreamingResponse`
         (starlette/responses.py) does not cancel this generator at all --
         it cancels whatever `stream_response()` is currently awaiting,
         almost always `send()` mid-backpressure. This generator is left
         parked at its `yield`, with nothing scheduled to resume it, so this
         `finally` is never entered in the first place. A shield only
         changes what happens once a cancellation reaches a scope; it
         cannot make a scope get entered that a real disconnect never
         drives execution into. Measured by driving the real ASGI call
         (`StreamingResponse.__call__` + a `receive()` emitting
         `http.disconnect`, not by cancelling `__anext__()` directly -- that
         shape cannot occur from a real client and is not what this file's
         tests exercise): the temp file and the concurrency slot both
         survive the disconnect, and if the cancellation instead lands
         before this generator's first `__anext__` (e.g. while
         `build_export_zip_to_tempfile` still runs in the threadpool,
         before any `StreamingResponse` exists), the leak is permanent --
         `aclose()` on a never-started async generator is a documented
         no-op, so this `finally` NEVER runs for that request, full stop.

    Because of (2), the concurrency slot cannot depend on this `finally`
    running at all. It doesn't: `acquire_export_slot()`/`release_export_slot()`
    are a self-healing lease (see the comment above them) that reclaims an
    abandoned slot on a bounded timer regardless of whether this generator's
    cleanup ever fires. The shield + explicit release here remain a genuine
    complement -- they free the slot immediately on every path that DOES
    resume, rather than making that request's own next caller wait out the
    TTL -- they are just no longer load-bearing for the "a slot cannot leak
    permanently" invariant.

    Each of the three cleanup steps (close the handle, delete the temp file,
    release the slot) is independently guarded so a failure in one can never
    skip another, on the runs where this code executes at all.

    Blocking file I/O is offloaded to a worker thread
    (`anyio.to_thread.run_sync`) on every call so this never blocks the
    single shared event loop, matching how every other disk/network-bound
    call on this pod is written."""
    async def _iter():
        f = None
        try:
            f = await anyio.to_thread.run_sync(open, path, "rb")
            while True:
                chunk = await anyio.to_thread.run_sync(f.read, _EXPORT_STREAM_CHUNK_BYTES)
                if not chunk:
                    break
                yield chunk
        finally:
            with anyio.CancelScope(shield=True):
                if f is not None:
                    try:
                        await anyio.to_thread.run_sync(f.close)
                    except OSError:
                        pass
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
                release_export_slot()

    return _iter()
