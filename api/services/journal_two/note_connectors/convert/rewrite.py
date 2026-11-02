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
    by DEFAULT the MARK is removed, but the text run it was attached to is
    kept as plain text. This is `commit.js`'s one-shot behavior (the wizard
    never revisits a note after import) — do NOT change it or touch
    commit.js.

`strip_unresolved_links` (review fix, 2026-08-12): the sync engine's
per-batch pipeline resolves a note's placeholder body in more than one pass
(media now, links in a later pass — see `note_connectors/engine.py`'s
`_confirm_and_resolve_batch` / `_resolve_links_final_pass`), so an
`import-link://` mark that isn't resolvable YET (its target hasn't been
confirmed yet, e.g. it lands in a LATER batch) must never be silently
stripped — the engine passes `strip_unresolved_links=False` everywhere,
which keeps the mark (href unchanged) instead of dropping it. That is also
what lets the engine's self-heal step find it later (it greps the stored
body for the literal `import-link://` substring). Wizard-parity default
stays `True` so every existing caller (and the JS twin) is byte-for-byte
unaffected.

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


def _rewrite_marks(
    marks: list[Any], id_by_key: dict[str, str], *, strip_unresolved_links: bool,
) -> list[Any]:
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
                continue
            # unresolved
            if strip_unresolved_links:
                pass  # drop the mark, keep the text run itself (wizard/JS parity)
            else:
                out.append(copy.deepcopy(mark))  # keep the mark intact (href unchanged)
            continue
        out.append(copy.deepcopy(mark))
    return out


def rewrite_body(
    body_json: dict[str, Any],
    media_urls: dict[str, str] | None = None,
    id_by_key: dict[str, str] | None = None,
    *,
    strip_unresolved_links: bool = True,
    notices: dict[str, dict] | None = None,
    resolved: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Resolves import-time placeholders in `body_json` into their real,
    post-confirm values. Returns `(body, dropped_media)`. Never mutates
    `body_json`.

    `notices` (Plan A Task 6, spec I-7): `{ref: importNotice node}`. When given,
    an `image`/`attachmentChip` placeholder with no URL whose ref has a notice
    is REPLACED by (a copy of) that notice, in place, instead of dropped, so a
    file that could not be copied leaves a visible marker. Only a ref with
    neither a URL nor a notice is still dropped and listed in `dropped_media`.
    `notices=None` (the default) is today's JS-parity drop, byte-for-byte.

    `resolved` (Plan A Task 8): `{ref: media_policy.StoredMedia}`, what the one media policy
    stored for each ref; it wins over `media_urls` for the same ref. An `image` placeholder
    whose stored kind is "image" becomes `image{src=url}`, followed, when the policy kept an
    `original` (a HEIC, an animation), by an `attachmentChip{href, name, size}` for it; one
    stored as a "file" (an SVG, a file the bytes say is not an image) becomes an
    `attachmentChip`. An `attachmentChip` placeholder stays a chip, its `size` filled.

    `strip_unresolved_links` (default True, matching the original/JS-twin
    one-shot behavior): when an `import-link://` mark can't be resolved via
    `id_by_key`, True drops the mark and keeps the text as plain text; False
    keeps the mark (and its href) intact so a LATER pass — or self-heal —
    can still find and resolve it. See the module docstring."""
    media_urls = media_urls or {}
    id_by_key = id_by_key or {}
    resolved = resolved or {}
    dropped_media: list[str] = []

    def unresolved(ref: str) -> Any:
        """A placeholder with no URL: its notice when there is one, else dropped."""
        if notices is not None and ref in notices:
            return copy.deepcopy(notices[ref])
        dropped_media.append(ref)
        return None

    def chip(stored: Any) -> dict[str, Any]:
        return {"type": "attachmentChip",
                "attrs": {"href": stored.url, "name": stored.name, "size": stored.size}}

    def walk(node: Any) -> Any:
        """A node, None (dropped), or a list of nodes (an image followed by its original)."""
        if not isinstance(node, dict):
            return copy.deepcopy(node)

        node_type = node.get("type")

        if node_type in ("image", "attachmentChip"):
            attr = "src" if node_type == "image" else "href"
            ref = _ref_from_placeholder((node.get("attrs") or {}).get(attr))
            stored = resolved.get(ref) if ref is not None else None
            if stored is not None:
                if node_type == "attachmentChip" or stored.kind != "image":
                    new_chip = copy.deepcopy(node) if node_type == "attachmentChip" else chip(stored)
                    new_chip.setdefault("attrs", {})
                    new_chip["attrs"].update(href=stored.url, size=stored.size)
                    if node_type != "attachmentChip" or not new_chip["attrs"].get("name"):
                        new_chip["attrs"]["name"] = stored.name
                    return new_chip
                new_node = copy.deepcopy(node)
                new_node.setdefault("attrs", {})
                new_node["attrs"]["src"] = stored.url
                if stored.original is not None:
                    return [new_node, chip(stored.original)]
                return new_node

        if node_type == "image":
            ref = _ref_from_placeholder((node.get("attrs") or {}).get("src"))
            if ref is None:
                return copy.deepcopy(node)
            url = media_urls.get(ref)
            if url is None:
                return unresolved(ref)
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
                return unresolved(ref)
            new_node = copy.deepcopy(node)
            new_node.setdefault("attrs", {})
            new_node["attrs"]["href"] = url
            return new_node

        next_node = copy.deepcopy(node)
        if isinstance(node.get("marks"), list):
            next_node["marks"] = _rewrite_marks(
                node["marks"], id_by_key, strip_unresolved_links=strip_unresolved_links)
        if isinstance(node.get("content"), list):
            out: list[Any] = []
            for child in node["content"]:
                walked = walk(child)
                if isinstance(walked, list):
                    out.extend(walked)
                elif walked is not None:
                    out.append(walked)
            next_node["content"] = out
        return next_node

    body = walk(body_json)
    return body, dropped_media
