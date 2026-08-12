"""`rewrite_body` — pure Python port of `commit.js`'s `rewriteBody`.

Read `app/src/pages/journal-2-0/lib/importer/commit.js` in full before
touching this file; its `rewriteBody` export is the behavioral contract this
module pins EXACTLY:

  - `image` nodes: `attrs.src === 'import-ref://<ref>'` -> `media_urls[ref]`.
    Unresolvable (upload failed, or the ref was never provided) -> the node
    is dropped from its parent's content and `<ref>` is recorded in the
    returned `dropped_media` list.
  - `attachmentChip` nodes: same swap-or-drop, on `attrs.href` instead of
    `attrs.src`.
  - `link` marks: `attrs.href === 'import-link://<targetKey>'` -> resolved
    via `id_by_key[targetKey]` to `/journal?j2tab=notebook&note=<id>`.
    Unresolved (the target note never imported, or was itself dropped) ->
    the MARK is removed, but the text run it was attached to is kept as
    plain text.

Deep-walks the whole tree (tables, lists, nested blocks — anywhere a media
node or a marked text run can live), and — the load-bearing property spelled
out in the design spec — is PURE: it deep-copies, and never mutates its
input, at any depth.

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §4.
"""

from __future__ import annotations

import copy
from typing import Any

from . import LINK_PREFIX, REF_PREFIX


def _ref_from_placeholder(value: Any) -> str | None:
    if not isinstance(value, str) or not value.startswith(REF_PREFIX):
        return None
    return value[len(REF_PREFIX):]


def _rewrite_marks(marks: list[Any], id_by_key: dict[str, str]) -> list[Any]:
    out: list[Any] = []
    for mark in marks:
        if not isinstance(mark, dict):
            out.append(copy.deepcopy(mark))
            continue
        attrs = mark.get("attrs") or {}
        href = attrs.get("href")
        if mark.get("type") == "link" and isinstance(href, str) and href.startswith(LINK_PREFIX):
            target_key = href[len(LINK_PREFIX):]
            note_id = id_by_key.get(target_key)
            if note_id:
                new_mark = copy.deepcopy(mark)
                new_mark.setdefault("attrs", {})
                new_mark["attrs"]["href"] = f"/journal?j2tab=notebook&note={note_id}"
                out.append(new_mark)
            # unresolved -> drop the mark, keep the text run itself
            continue
        out.append(copy.deepcopy(mark))
    return out


def rewrite_body(
    body_json: dict[str, Any],
    media_urls: dict[str, str] | None = None,
    id_by_key: dict[str, str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Resolves import-time placeholders in `body_json` into their real,
    post-confirm values. Returns `(body, dropped_media)`. Never mutates
    `body_json`."""
    media_urls = media_urls or {}
    id_by_key = id_by_key or {}
    dropped_media: list[str] = []

    def walk(node: Any) -> Any:
        if not isinstance(node, dict):
            return copy.deepcopy(node)

        node_type = node.get("type")

        if node_type == "image":
            ref = _ref_from_placeholder((node.get("attrs") or {}).get("src"))
            if ref is None:
                return copy.deepcopy(node)
            url = media_urls.get(ref)
            if url is None:
                dropped_media.append(ref)
                return None
            new_node = copy.deepcopy(node)
            new_node.setdefault("attrs", {})
            new_node["attrs"]["src"] = url
            return new_node

        if node_type == "attachmentChip":
            ref = _ref_from_placeholder((node.get("attrs") or {}).get("href"))
            if ref is None:
                return copy.deepcopy(node)
            url = media_urls.get(ref)
            if url is None:
                dropped_media.append(ref)
                return None
            new_node = copy.deepcopy(node)
            new_node.setdefault("attrs", {})
            new_node["attrs"]["href"] = url
            return new_node

        next_node = copy.deepcopy(node)
        if isinstance(node.get("marks"), list):
            next_node["marks"] = _rewrite_marks(node["marks"], id_by_key)
        if isinstance(node.get("content"), list):
            walked = [walk(child) for child in node["content"]]
            next_node["content"] = [n for n in walked if n is not None]
        return next_node

    body = walk(body_json)
    return body, dropped_media
