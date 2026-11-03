"""Plan F Task 1: detectors for the known-broken shapes in an already-imported note body.

Read-only. `detect_shapes` walks a parsed TipTap doc once and counts every shape except
`orphan_media`, which needs the disk (`orphan_media_count`). Zero counts are omitted.

Nothing here restates a policy that lives elsewhere:
- "is this href kept as-is" is linkify's `_KEPT_PREFIXES` (plus the in-page `#`, `?`, `//`);
- "has a scheme" is linkify's `_SCHEME_RE`;
- "is there a bare URL" is `linkify_doc` itself (the live allow-list decides);
- "our own host" is linkify's `_APP_HOST`;
- the media dirs are read the way `notes._newest_media_mtime` reads them.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from api.services.journal_two import notes
from api.services.journal_two.note_connectors.convert import LINK_PREFIX, REF_PREFIX
from api.services.journal_two.note_connectors.convert import linkify

WRITABLE_SHAPES = ("dead_import_link", "obsidian_pct_key", "relative_note_href", "bare_url",
                   "hotlinked_image", "stranded_media_ref", "empty_image")
COUNT_ONLY_SHAPES = ("obsidian_literal_embed", "orphan_media")
LOSS_SHAPES = ("stranded_media_ref", "empty_image", "orphan_media")

_NOT_RELATIVE_PREFIXES = ("#", "?", "//") + tuple(linkify._KEPT_PREFIXES)
_OWN_HOSTS = frozenset({linkify._APP_HOST, "www." + linkify._APP_HOST})
_PCT_RE = re.compile(r"%[0-9A-Fa-f]{2}")
_OBSIDIAN_KEY_PREFIXES = ("obsidian:", "name:obsidian:")
_EMBED_EXT = r"\.(?:png|jpe?g|gif|webp|svg|bmp|heic|avif|pdf)"
_EMBED_RE = re.compile(r"!?\[\[[^\]]+" + _EMBED_EXT + r"\]\]", re.IGNORECASE)
# A bare file name: no brackets, no path separators, no line break. Spaces are allowed,
# because Obsidian's own pasted-image names have them ("Pasted image 20240101.png").
_BARE_NAME_RE = re.compile(r"[^\[\]/\\\n]+" + _EMBED_EXT, re.IGNORECASE)
_MEDIA_SUBDIRS = ("inline", "file")


def is_relative_href(href: object) -> bool:
    """A link target with no scheme that is not an in-app, in-page or placeholder target:
    a vault- or export-relative path the importer never resolved."""
    if not isinstance(href, str) or not href.strip():
        return False
    if linkify._SCHEME_RE.match(href):
        return False
    return not href.startswith(_NOT_RELATIVE_PREFIXES)


def is_hotlink_src(src: object) -> bool:
    """An image still pointing at someone else's server (http/https, host not ours).
    The scheme is case-insensitive, as a browser reads it (`HTTPS://x/a.png` loads too)."""
    if not isinstance(src, str) or not src[:8].lower().startswith(("http://", "https://")):
        return False
    try:
        host = (urlsplit(src).hostname or "").lower()
    except ValueError:
        return True
    return host not in _OWN_HOSTS


def _count_mark(marks: Any, counts: dict[str, int]) -> None:
    if not isinstance(marks, list):
        return
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("type") != "link":
            continue
        attrs = mark.get("attrs")
        href = attrs.get("href") if isinstance(attrs, dict) else None
        if isinstance(href, str) and href.startswith(LINK_PREFIX):
            counts["dead_import_link"] += 1
            key = href[len(LINK_PREFIX):]
            if key.startswith(_OBSIDIAN_KEY_PREFIXES) and _PCT_RE.search(key):
                counts["obsidian_pct_key"] += 1
        elif is_relative_href(href):
            counts["relative_note_href"] += 1


def _is_bare_name_paragraph(node: dict) -> bool:
    content = node.get("content")
    if not isinstance(content, list) or len(content) != 1:
        return False
    only = content[0]
    return (isinstance(only, dict) and only.get("type") == "text" and not only.get("marks")
            and isinstance(only.get("text"), str)
            and _BARE_NAME_RE.fullmatch(only["text"].strip()) is not None)


def is_empty_image(node: Any) -> bool:
    """`empty_image`: an `image` node with no usable `src`. THE predicate (Task 4 review M-2):
    the repair (`media.missing_notices`) marks exactly what this counts."""
    if not isinstance(node, dict) or node.get("type") != "image":
        return False
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    src = attrs.get("src")
    return not isinstance(src, str) or not src.strip()


def stranded_ref(node: Any) -> str | None:
    """`stranded_media_ref`: the ref of an `image` (`src`) or `attachmentChip` (`href`) still
    holding an `import-ref://` placeholder, else None. THE predicate (Task 4 review M-2)."""
    if not isinstance(node, dict):
        return None
    attr = {"image": "src", "attachmentChip": "href"}.get(node.get("type"))
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    value = attrs.get(attr) if attr else None
    return value[len(REF_PREFIX):] if isinstance(value, str) and value.startswith(REF_PREFIX) else None


def _walk(node: Any, counts: dict[str, int]) -> None:
    if isinstance(node, list):
        for child in node:
            _walk(child, counts)
        return
    if not isinstance(node, dict):
        return
    kind = node.get("type")
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    _count_mark(node.get("marks"), counts)
    if is_empty_image(node):
        counts["empty_image"] += 1
    elif stranded_ref(node) is not None:
        counts["stranded_media_ref"] += 1
    elif kind == "image" and is_hotlink_src(attrs.get("src")):
        counts["hotlinked_image"] += 1
    elif kind == "text":
        text = node.get("text")
        if isinstance(text, str) and _EMBED_RE.fullmatch(text.strip()):
            counts["obsidian_literal_embed"] += 1
    elif kind == "paragraph" and _is_bare_name_paragraph(node):
        counts["obsidian_literal_embed"] += 1  # its text child has no `[[`, so no double count
    _walk(node.get("content"), counts)


def detect_shapes(doc: dict) -> dict[str, int]:
    """Counts of every shape except `orphan_media` in one parsed body; zero counts omitted.
    Never mutates `doc` (`linkify_doc` works on a deep copy)."""
    counts = dict.fromkeys(WRITABLE_SHAPES + COUNT_ONLY_SHAPES, 0)
    _walk(doc, counts)
    if isinstance(doc, dict) and linkify.linkify_doc(doc) != doc:
        counts["bare_url"] = 1
    return {shape: n for shape, n in counts.items() if n}


def orphan_media_count(user_id: str, note_id: str, body_json_text: str) -> int:
    """Stored media files under the note's `inline/` and `file/` dirs whose file name does not
    occur in the raw body text. Reads the dirs the way `notes._newest_media_mtime` does."""
    body = body_json_text if isinstance(body_json_text, str) else ""
    orphans = 0
    for sub in _MEDIA_SUBDIRS:
        base = Path(notes._ATTACHMENT_ROOT) / user_id / "notes" / note_id / sub
        try:
            entries = list(base.rglob("*"))
        except OSError:
            continue
        for p in entries:
            try:
                if p.is_file() and p.name not in body:
                    orphans += 1
            except OSError:
                continue
    return orphans
