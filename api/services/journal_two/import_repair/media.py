"""Plan F Task 4: media repair over a stored, already-imported note body.

Pure over its input (every function deep-copies; nothing is written here, the runner writes):
  * `missing_notices`: a picture or file an earlier import lost (a still-stranded `import-ref://`
    placeholder, or an image with no source) becomes the visible, final `missing_from_import`
    marker (Task 2), which tells the member the way back (Re-import to recover);
  * `hotlinks` / `replace_src`: the images still pointing at someone else's server, by the ONE
    predicate `shapes.is_hotlink_src` (C11), and the swap to our stored copy once
    `hotlink_fetch.fetch_and_store` has it. A hotlink that fails to copy is LEFT AS IT IS (it
    still renders and is the member's best copy; a marker beside a working picture would be
    false); the runner logs it and the next run retries it;
  * `lost_file_link_notices`: a relative link to a FILE that never came over (Task 3's
    `relative_file_unresolved`) keeps its href exactly as written (a repair never makes a note
    worse) and gets the same marker after its block; the count is the report's `lostLinks`.
"""
from __future__ import annotations

import copy
import posixpath
import uuid
from typing import Any
from urllib.parse import unquote

from api.services.journal_two import import_notice
from api.services.journal_two.import_repair import links, shapes
from api.services.journal_two.note_connectors import link_keys
from api.services.journal_two.note_connectors.convert import REF_PREFIX, rewrite_body

REASON = "missing_from_import"


def _marker(name: str | None) -> dict:
    return import_notice.notice_node(REASON, name=name, source_url=None, ref=None, attempts=0)


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _basename(path: str) -> str | None:
    return _text(posixpath.basename(unquote(path).split("#", 1)[0].split("?", 1)[0]))


def _attrs(node: dict) -> dict:
    attrs = node.get("attrs")
    return attrs if isinstance(attrs, dict) else {}


def missing_notices(doc: dict) -> tuple[dict, list[str]]:
    """`(new_doc, names)`: every `stranded_media_ref` and `empty_image` node replaced by a
    `missing_from_import` marker, named by its alt, title, chip name or the ref's file name.
    `names` lists what each marker reads, in document order (`NAME_FALLBACK` when unnamed)."""
    notices: dict[str, dict] = {}
    names: list[str] = []

    def lost(node: dict) -> dict | None:
        """The marker for a lost media node, or None when it is not lost. A stranded ref's
        marker is also registered for the one placeholder rewrite below."""
        attrs = _attrs(node)
        ref = shapes.stranded_ref(node)
        if ref is not None:
            if ref not in notices:
                notices[ref] = _marker(_text(attrs.get("alt")) or _text(attrs.get("title"))
                                       or _text(attrs.get("name")) or _basename(ref))
            names.append(notices[ref]["attrs"]["name"] or import_notice.NAME_FALLBACK)
            return notices[ref]
        if shapes.is_empty_image(node):
            marker = _marker(_text(attrs.get("alt")) or _text(attrs.get("title")))
            names.append(marker["attrs"]["name"] or import_notice.NAME_FALLBACK)
            return marker
        return None

    def walk_list(children: list) -> list:
        out: list = []
        for child in children:
            done = walk(child)
            out.extend(done if isinstance(done, list) else [done])
        return out

    def walk(node: Any) -> Any:
        """A node, or a LIST of nodes to splice in (a dissolved figure)."""
        if not isinstance(node, dict):
            return node
        if node.get("type") == "imageFigure" and isinstance(node.get("content"), list):
            # Fix round 1, I-1: `imageFigure` is `image imageCaption`, so a marker cannot stay
            # inside it. As `uctJson.js` does for a refused image, the figure becomes the marker
            # and its caption as a paragraph (an empty caption leaves nothing).
            image = next((c for c in node["content"] if isinstance(c, dict) and c.get("type") == "image"), None)
            marker = lost(image) if image is not None else None
            if marker is not None:
                out: list = [copy.deepcopy(marker)]
                for c in node["content"]:
                    if isinstance(c, dict) and c.get("type") == "imageCaption" and c.get("content"):
                        out.append({"type": "paragraph", "content": c["content"]})
                return out
        if shapes.stranded_ref(node) is not None:
            lost(node)
            return node  # replaced below, by the one placeholder rewrite
        marker = lost(node)
        if marker is not None:
            return marker
        if isinstance(node.get("content"), list):
            node = {**node, "content": walk_list(node["content"])}
        return node

    out = walk(copy.deepcopy(doc))
    if notices:
        out, _dropped = rewrite_body(out, {}, {}, strip_unresolved_links=False, notices=notices)
    return out, names


def hotlinks(doc: dict) -> list[str]:
    """Every distinct still-hotlinked image `src`, in document order (`shapes.is_hotlink_src`)."""
    out: dict[str, None] = {}

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, dict):
            src = _attrs(node).get("src")
            if node.get("type") == "image" and shapes.is_hotlink_src(src):
                out.setdefault(src, None)
            walk(node.get("content"))

    walk(doc)
    return list(out)


def replace_src(doc: dict, old: str, new: str) -> dict:
    """A deep copy of `doc` with every `image` whose `src == old` pointing at `new`; every other
    attr (alt, title, width...) kept."""
    out = copy.deepcopy(doc)

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, dict):
            attrs = node.get("attrs")
            if node.get("type") == "image" and isinstance(attrs, dict) and attrs.get("src") == old:
                attrs["src"] = new
            walk(node.get("content"))

    walk(out)
    return out


def place_stored(doc: dict, url: str, stored: Any) -> dict:
    """A deep copy of `doc` with every image whose `src == url` replaced by what the media
    policy STORED for it (Task 7 review I-1), by the one rule the member door and `commit.js`
    use, through the server's own placeholder rewrite (`rewrite_body`'s `resolved`):
      * `kind == "image"`: the image, `src` swapped, other attrs kept;
      * `kind == "file"` (an SVG, bytes that are not an image): a chip in its place, never an
        <img> of a stored file;
      * a kept `original` (an animation, a HEIC source): a chip right after the image, so
        nothing stored is left unreferenced.
    Inside an `imageFigure` (`image imageCaption`, Task 4 I-1) a chip never stays: an original's
    chip goes after the figure, and a file kind dissolves the figure into the chip and its
    caption as a paragraph (as `uctJson.js` does)."""
    token = "repair-hotlink-" + uuid.uuid4().hex
    marked = replace_src(doc, url, REF_PREFIX + token)
    out, _dropped = rewrite_body(marked, link_keys._media_passthrough(marked), {},
                                 strip_unresolved_links=False, resolved={token: stored})
    return _fix_figures(out)


def _fix_figures(node: Any) -> Any:
    """Restore `image imageCaption` in a figure the rewrite just changed."""
    if isinstance(node, list):
        out: list = []
        for child in node:
            fixed = _fix_figures(child)
            out.extend(fixed if isinstance(fixed, list) else [fixed])
        return out
    if not isinstance(node, dict):
        return node
    content = node.get("content")
    if node.get("type") == "imageFigure" and isinstance(content, list):
        kinds = [c.get("type") if isinstance(c, dict) else None for c in content]
        if kinds == ["image", "imageCaption"]:
            return node
        captions = [c for c in content if isinstance(c, dict) and c.get("type") == "imageCaption"]
        rest = [c for c in content if not (isinstance(c, dict) and c.get("type") == "imageCaption")]
        if rest and isinstance(rest[0], dict) and rest[0].get("type") == "image":
            return [{**node, "content": [rest[0], *captions]}, *rest[1:]]
        paragraphs = [{"type": "paragraph", "content": c["content"]} for c in captions if c.get("content")]
        return [*rest, *paragraphs]
    if isinstance(content, list):
        return {**node, "content": _fix_figures(content)}
    return node


def _link_hrefs(block: dict) -> list[tuple[str, str]]:
    """`(href, text)` of every link mark on `block`'s own text children, in order."""
    found: list[tuple[str, str]] = []
    for child in block.get("content") or []:
        if not isinstance(child, dict) or child.get("type") != "text":
            continue
        for mark in child.get("marks") or []:
            if isinstance(mark, dict) and mark.get("type") == "link":
                href = _attrs(mark).get("href")
                if isinstance(href, str):
                    found.append((href, child.get("text") or ""))
    return found


def lost_file_link_notices(doc: dict, *, import_key: str, import_source: str,
                           index: links.FileKeyIndex) -> tuple[dict, int]:
    """`(new_doc, lost)`: after each block holding a relative link Task 3's rule calls a lost
    FILE (`relative_file_unresolved`), one `missing_from_import` marker per distinct file name,
    unless the markers right after the block already carry it (so a second run adds nothing).
    The link itself is never touched. `lost` counts every such link, every run."""
    out = copy.deepcopy(doc)
    lost = 0

    def names_lost(block: dict) -> list[str]:
        nonlocal lost
        names: list[str] = []
        found = _link_hrefs(block)
        if block.get("type") == "imageFigure":  # I-1: a caption's links count for the figure
            found = [h for c in block.get("content") or [] if isinstance(c, dict) for h in _link_hrefs(c)]
        for href, text in found:
            if not shapes.is_relative_href(href):
                continue
            _key, action = links.relative_target(href, import_key=import_key,
                                                 import_source=import_source, index=index)
            if action != links.FILE_UNRESOLVED:
                continue
            lost += 1
            name = _basename(href) or _text(text) or import_notice.NAME_FALLBACK
            if name not in names:
                names.append(name)
        return names

    def walk(container: dict) -> None:
        content = container.get("content")
        if not isinstance(content, list):
            return
        i = 0
        while i < len(content):
            child = content[i]
            if not isinstance(child, dict):
                i += 1
                continue
            names = names_lost(child)
            if child.get("type") != "imageFigure":  # `image imageCaption`: never insert inside (I-1)
                walk(child)
            j = i + 1
            present: set[str] = set()
            while j < len(content) and isinstance(content[j], dict) \
                    and content[j].get("type") == import_notice.IMPORT_NOTICE_TYPE:
                attrs = _attrs(content[j])
                if attrs.get("reason") == REASON:
                    present.add(attrs.get("name") or import_notice.NAME_FALLBACK)
                j += 1
            new = [_marker(None if n == import_notice.NAME_FALLBACK else n) for n in names if n not in present]
            content[j:j] = new
            i = j + len(new)

    walk(out)
    return out, lost
