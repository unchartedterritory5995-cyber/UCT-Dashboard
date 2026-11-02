"""Plan F Task 3: link repair over a stored, already-imported note body.

`repair_links` fixes the link shapes `shapes.py` counts, by the rules the live importers use
today, and never by a rule of its own:
  * an Obsidian relative href resolves by the provider's `resolve_pending_target` (the rule
    conversion and the heal both use), over a per-vault `_VaultIndex`;
  * a Notion relative href resolves to the key the client's Notion adapter writes
    (`notion:<id-stripped path>`, its raw path on a collision, else `notion_note_key(<id>)`);
  * a bare URL is linked by `linkify_doc` (the live allow-list);
  * every `import-link://` key resolves through `link_keys.resolve_link_keys`, and is
    rewritten by `rewrite_body` with `strip_unresolved_links=False`, so an unresolved key stays
    a placeholder the live heal sweep finishes once its target arrives (spec Q5).

Pure over its input: it deep-copies first and never writes. The runner does the write.

Obsidian keys (C9): the file importer stores `obsidian:${vfile.path}`, the vault folder
included. The vault is the key path's first segment; each vault's index is built from its
paths with that segment stripped, a link resolves inside its own note's vault only, and the
key written back is `obsidian:<vault>/<path>`. A note at the top of the drop (no folder) sits
in the vault `""`.
"""
from __future__ import annotations

import copy
import posixpath
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import unquote

from api.services.journal_two import import_repair
from api.services.journal_two.import_repair.shapes import is_relative_href
from api.services.journal_two.note_connectors import link_keys
from api.services.journal_two.note_connectors.convert import LINK_PREFIX, linkify, rewrite_body
from api.services.journal_two.note_connectors.providers import obsidian as obsidian_provider

#: The client's `STRIP_ID_RE` (`adapters/notion.js`), pinned to it by a test reading that file.
STRIP_ID_PATTERN = r" [0-9a-f]{32}(?=(\.[a-z]+)?$)"
_STRIP_ID_RE = re.compile(STRIP_ID_PATTERN, re.IGNORECASE)
#: The client's `PAGE_FILE_ID_RE` / `PAGE_EXT` (`adapters/notion.js`): a page file and its id.
_NOTION_PAGE_ID_RE = re.compile(r" ([0-9a-f]{32})\.(md|html)$", re.IGNORECASE)
_NOTION_PAGE_EXT_RE = re.compile(r"\.(md|html)$", re.IGNORECASE)
#: The provider's own `.md` test: only a `.md` relative link names a note.
_OBSIDIAN_NOTE_EXT_RE = obsidian_provider._NOTE_EXT_RE

OBSIDIAN_SOURCE = "Obsidian"
NOTION_SOURCE = "Notion"
_OBSIDIAN = "obsidian:"
_NOTION = "notion:"
_FILE = "file:"
_PCT_KEY_PREFIXES = ("obsidian:", "name:obsidian:")
_PCT_RE = re.compile(r"%[0-9A-Fa-f]{2}")


def strip_notion_id_path(path: str) -> str:
    """Every segment with its trailing ` <32 hex>` id removed (the client's `stripIdPath`)."""
    return "/".join(_STRIP_ID_RE.sub("", seg, count=1) for seg in path.split("/"))


@dataclass
class FileKeyIndex:
    """One member's non-trashed import keys, read once per member."""
    keys: frozenset[str]
    obsidian: dict[str, Any] = field(default_factory=dict)  # vault -> `_VaultIndex`


def _vault_split(path: str) -> tuple[str, str]:
    """(vault, path inside the vault): the first segment is the vault (C9)."""
    vault, sep, rest = path.partition("/")
    return (vault, rest) if sep else ("", path)


def build_file_key_index(conn, user_id: str) -> FileKeyIndex:
    """ONE query over the member's non-trashed import keys. Column access is by position, so
    a connection without `row_factory` reads the same."""
    keys: set[str] = set()
    by_vault: dict[str, list[str]] = {}
    for row in conn.execute(
        "SELECT import_key, import_source FROM j2_notes"
        " WHERE user_id = ? AND deleted_at IS NULL AND import_key IS NOT NULL",
        (user_id,),
    ):
        key, source = row[0], row[1]
        if not isinstance(key, str):
            continue
        keys.add(key)
        if source == OBSIDIAN_SOURCE and key.startswith(_OBSIDIAN):
            vault, inner = _vault_split(key[len(_OBSIDIAN):])
            if inner:
                by_vault.setdefault(vault, []).append(inner)
    return FileKeyIndex(
        keys=frozenset(keys),
        obsidian={v: obsidian_provider._build_basename_map(sorted(set(p))) for v, p in by_vault.items()},
    )


def _join(base_dir: str, rel: str) -> str:
    """`rel` beside `base_dir`, `.`/`..`/empty segments folded the way the client's
    `resolvePath` folds them (a `..` above the top stays at the top)."""
    stack = base_dir.split("/") if base_dir else []
    for part in rel.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if stack:
                stack.pop()
            continue
        stack.append(part)
    return "/".join(stack)


def relative_target_key(href: str, *, import_key: str, import_source: str,
                        index: FileKeyIndex) -> str | None:
    """The import key a relative href in a FILE note names, else None (never a guess)."""
    if not isinstance(href, str) or not isinstance(import_key, str):
        return None
    target = unquote(href).split("#", 1)[0].strip()
    if not target:
        return None
    if import_source == OBSIDIAN_SOURCE and import_key.startswith(_OBSIDIAN):
        vault, inner = _vault_split(import_key[len(_OBSIDIAN):])
        vault_index = index.obsidian.get(vault)
        path = target.split("?", 1)[0].strip()
        # `|` separates a pending key's fields and cannot be in an Obsidian file name.
        if vault_index is None or "|" in path or not _OBSIDIAN_NOTE_EXT_RE.search(path):
            return None
        from_dir = obsidian_provider._dir_of(inner)
        resolved = obsidian_provider.resolve_pending_target(f"{path}|{from_dir}|rel", vault_index)
        if resolved is None:
            return None
        return f"{_OBSIDIAN}{vault}/{resolved}" if vault else f"{_OBSIDIAN}{resolved}"
    if import_source == NOTION_SOURCE and import_key.startswith(_NOTION):
        path = _join(posixpath.dirname(import_key[len(_NOTION):]), target.split("?", 1)[0])
        if not _NOTION_PAGE_EXT_RE.search(path):
            return None
        for key in (_NOTION + strip_notion_id_path(path), _NOTION + path):
            if key in index.keys:
                return key
        m = _NOTION_PAGE_ID_RE.search(path.rsplit("/", 1)[-1])
        return linkify.notion_note_key(m.group(1)) if m else None
    if import_key.startswith(_FILE):
        key = _FILE + _join(posixpath.dirname(import_key[len(_FILE):]), target)
        return key if key in index.keys else None
    return None


def _walk_link_marks(node: Any, fn) -> None:
    """Calls `fn(text_node, marks, i, href)` for every link mark, in document order."""
    if isinstance(node, list):
        for child in node:
            _walk_link_marks(child, fn)
        return
    if not isinstance(node, dict):
        return
    marks = node.get("marks")
    if isinstance(marks, list):
        for i in range(len(marks) - 1, -1, -1):
            mark = marks[i]
            if isinstance(mark, dict) and mark.get("type") == "link":
                attrs = mark.get("attrs")
                href = attrs.get("href") if isinstance(attrs, dict) else None
                fn(node, marks, i, href)
    _walk_link_marks(node.get("content"), fn)


def _decode_pct_keys(doc: dict, conn, user_id: str) -> bool:
    """Step 1: an Obsidian key holding `%xx` is decoded ONCE. Guarded so a second run can never
    decode it again: a key that already names a note is left alone, and a decoded key that
    still holds `%xx` is taken only when it names a note."""
    found: list[tuple[dict, str, str]] = []

    def collect(_node, marks, i, href):
        if isinstance(href, str) and href.startswith(LINK_PREFIX):
            key = href[len(LINK_PREFIX):]
            if key.startswith(_PCT_KEY_PREFIXES) and _PCT_RE.search(key):
                found.append((marks[i], key, unquote(key)))

    _walk_link_marks(doc, collect)
    if not found:
        return False
    resolvable = link_keys.resolve_link_keys(conn, user_id, [k for _, raw, dec in found for k in (raw, dec)])
    changed = False
    for mark, raw, decoded in found:
        if raw in resolvable or decoded == raw:
            continue
        if decoded in resolvable or not _PCT_RE.search(decoded):
            mark["attrs"]["href"] = LINK_PREFIX + decoded
            changed = True
    return changed


def _repair_relative(doc: dict, *, import_key: str, import_source: str,
                     index: FileKeyIndex) -> tuple[bool, bool]:
    """Step 2 (FILE notes only): `(any became a note key, any became plain text)`."""
    outcome = {"note": False, "text": False}

    def fix(node, marks, i, href):
        if not is_relative_href(href):
            return
        key = relative_target_key(href, import_key=import_key, import_source=import_source, index=index)
        if key is not None:
            marks[i] = {**marks[i], "attrs": {**marks[i]["attrs"], "href": LINK_PREFIX + key}}
            outcome["note"] = True
            return
        # spec L-4: no source URL to resolve against, and a relative href would land on our
        # origin. The text and its other marks stay.
        del marks[i]
        if not marks:
            node.pop("marks", None)
        outcome["text"] = True

    _walk_link_marks(doc, fix)
    return outcome["note"], outcome["text"]


def repair_links(doc: dict, *, note_class: str, import_key: str, import_source: str,
                 index: FileKeyIndex, conn, user_id: str) -> tuple[dict, list[str]]:
    """`(new_doc, actions)`; `actions` is empty when nothing changed. Never mutates `doc`."""
    out = copy.deepcopy(doc)
    actions: list[str] = []
    if _decode_pct_keys(out, conn, user_id):
        actions.append("pct_key_decoded")
    if note_class == import_repair.FILE:
        to_note, to_text = _repair_relative(out, import_key=import_key, import_source=import_source,
                                            index=index)
        if to_note:
            actions.append("relative_to_note")
        if to_text:
            actions.append("relative_to_text")
    if note_class != import_repair.CONNECTOR_LIVE:
        linked = linkify.linkify_doc(out)
        if linked != out:
            actions.append("linkified")
            out = linked
    id_by_key = link_keys.resolve_link_keys(conn, user_id, linkify.import_link_keys(out))
    if id_by_key:
        out, _dropped = rewrite_body(out, link_keys._media_passthrough(out), id_by_key,
                                     strip_unresolved_links=False)
        actions.append(f"link_resolved:{len(id_by_key)}")
    return out, actions
