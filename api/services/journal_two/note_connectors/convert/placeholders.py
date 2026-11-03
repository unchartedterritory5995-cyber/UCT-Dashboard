"""Post-conversion placeholder passes shared by the providers.

A provider that borrows `md_to_tiptap`'s image machinery for something that is not an image
(a file chip, an in-note notice) writes it as markdown image syntax under a scheme of its
own, lets the converter hoist it to a block and register it as media, then swaps each such
`image` node for what it really is. `map_image_nodes` is the tree walk of that swap, one
copy for every provider (Dropbox's `_promote_md_attachments` and Obsidian's
`_promote_obsidian_placeholders`).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


def map_image_nodes(doc: Any, fn: Callable[[dict[str, Any]], Any]) -> Any:
    """A copy of `doc` with every `image` node replaced by `fn(node)`. Never mutates `doc`:
    a node with a `content` list is copied with its children mapped, an image goes through
    `fn`, and anything else is returned as it is (the same object). `fn` returning its
    argument keeps the image."""

    def walk(node: Any) -> Any:
        if not isinstance(node, dict):
            return node
        if node.get("type") == "image":
            return fn(node)
        if isinstance(node.get("content"), list):
            new_node = dict(node)
            new_node["content"] = [walk(c) for c in node["content"]]
            return new_node
        return node

    return walk(doc)
