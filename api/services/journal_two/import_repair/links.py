"""Plan F Task 3: link repair over a stored, already-imported note body.

`repair_links` fixes the link shapes `shapes.py` counts, by the rules the live importers use
today, and never by a rule of its own, except where the live rule would GUESS:
  * an Obsidian relative href resolves by the provider's exact-path order (`_resolve_relative`:
    beside the note, then from the top) over a per-vault `_VaultIndex`. Its name rule is
    narrowed (fix round 1, C-1): see `_obsidian_target`;
  * a Notion relative href resolves to the key the client's Notion adapter writes
    (`notion:<id-stripped path>`, its raw path on a collision, else `notion_note_key(<id>)`);
  * a bare URL is linked by `linkify_doc` (the live allow-list);
  * every `import-link://` key resolves through `link_keys.resolve_link_keys`, and is
    rewritten by `rewrite_body` with `strip_unresolved_links=False`, so an unresolved key stays
    a placeholder the live heal sweep finishes once its target arrives (spec Q5);
  * a link it cannot resolve stays exactly as written and is counted (`COUNT_ONLY_ACTIONS`):
    a repair never makes a note worse (fix round 1, I-3).

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
import unicodedata
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
#: The generic file importer's note files and its TextBundle text (`adapters/generic.js`).
_GENERIC_NOTE_EXT_RE = re.compile(r"\.(md|txt|html|docx)$", re.IGNORECASE)
_TEXTBUNDLE_TEXT_RE = re.compile(r"\.textbundle/text\.md$", re.IGNORECASE)
_TEXTBUNDLE_DIR_RE = re.compile(r"(^|/)[^/]+\.textbundle/", re.IGNORECASE)

# ── action codes (fix round 1) ───────────────────────────────────────────────
# WRITES: the body changed. COUNTS: nothing was written for that link; it stays exactly as
# written and the code is what the dry run counts (a repair never makes a note worse).
TO_NOTE = "relative_to_note"            # write: the exact path (or the client's key) named a note
BY_NAME = "relative_by_name"            # write: the ONE same-folder name match (C-1)
AMBIGUOUS = "relative_ambiguous"        # count: two or more notes carry that name (C-1)
TRASHED = "relative_target_trashed"     # count: the exact path names a note in the trash (I-1)
UNRESOLVED = "relative_unresolved"      # count: a note link nothing names (yet)
FILE_UNRESOLVED = "relative_file_unresolved"  # count: a link to a file that is not a note;
#                                         T4/T6 place the visible `missing_from_import` marker
HOSTLIKE_LINKED = "relative_hostlike_linked"  # write: `www.x.tld/...` became linkify's URL
HOSTLIKE = "relative_hostlike"          # count: another host-like href; no marker, not a file
#: Step 2's codes, in the order `repair_links` reports them.
RELATIVE_ACTIONS = (TO_NOTE, BY_NAME, HOSTLIKE_LINKED, AMBIGUOUS, TRASHED, UNRESOLVED,
                    FILE_UNRESOLVED, HOSTLIKE)
COUNT_ONLY_ACTIONS = frozenset({AMBIGUOUS, TRASHED, UNRESOLVED, FILE_UNRESOLVED, HOSTLIKE})


def strip_notion_id_path(path: str) -> str:
    """Every segment with its trailing ` <32 hex>` id removed (the client's `stripIdPath`)."""
    return "/".join(_STRIP_ID_RE.sub("", seg, count=1) for seg in path.split("/"))


@dataclass
class FileKeyIndex:
    """One member's non-trashed import keys, read once per member."""
    keys: frozenset[str]
    obsidian: dict[str, Any] = field(default_factory=dict)  # vault -> `_VaultIndex`
    #: vault -> lowercased paths (inside the vault) of the member's TRASHED Obsidian file
    #: notes (fix round 1, I-1): a link that names one exactly is never given another note.
    obsidian_trashed: dict[str, frozenset[str]] = field(default_factory=dict)
    #: Every Obsidian file note's FULL key path, lowercased -> as stored (the first in sort
    #: order wins a case tie), and the trashed ones: the drop-wide exact retry (I-4).
    obsidian_paths: dict[str, str] = field(default_factory=dict)
    obsidian_paths_trashed: frozenset[str] = frozenset()
    #: NFC form of every non-trashed key -> the key as STORED (fix round 1, M-1). Every lookup
    #: above is built over NFC forms; this maps an answer back to the exact stored key.
    by_nfc: dict[str, str] = field(default_factory=dict)

    def stored(self, key: str) -> str | None:
        """The stored key whose NFC form is `key`'s, else None."""
        return self.by_nfc.get(_nfc(key))


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _vault_split(path: str) -> tuple[str, str]:
    """(vault, path inside the vault): the first segment is the vault (C9)."""
    vault, sep, rest = path.partition("/")
    return (vault, rest) if sep else ("", path)


def build_file_key_index(conn, user_id: str) -> FileKeyIndex:
    """ONE query over the member's import keys: the non-trashed ones are the index, and the
    trashed Obsidian file paths are kept apart (I-1). Column access is by position, so a
    connection without `row_factory` reads the same. The Obsidian structures hold NFC forms."""
    keys: set[str] = set()
    by_nfc: dict[str, str] = {}
    by_vault: dict[str, list[str]] = {}
    trashed: dict[str, set[str]] = {}
    for row in conn.execute(
        "SELECT import_key, import_source, deleted_at IS NOT NULL FROM j2_notes"
        " WHERE user_id = ? AND import_key IS NOT NULL ORDER BY import_key",
        (user_id,),
    ):
        key, source, is_trashed = row[0], row[1], bool(row[2])
        if not isinstance(key, str):
            continue
        if not is_trashed:
            keys.add(key)
            by_nfc.setdefault(_nfc(key), key)
        if source == OBSIDIAN_SOURCE and key.startswith(_OBSIDIAN):
            vault, inner = _vault_split(_nfc(key)[len(_OBSIDIAN):])
            if not inner:
                continue
            if is_trashed:
                trashed.setdefault(vault, set()).add(inner.lower())
            else:
                by_vault.setdefault(vault, []).append(inner)
    full_paths: dict[str, str] = {}
    for full in sorted(f"{v}/{p}" if v else p for v, ps in by_vault.items() for p in ps):
        full_paths.setdefault(full.lower(), full)
    return FileKeyIndex(
        keys=frozenset(keys),
        obsidian={v: obsidian_provider._build_basename_map(sorted(set(p))) for v, p in by_vault.items()},
        obsidian_trashed={v: frozenset(p) for v, p in trashed.items()},
        obsidian_paths=full_paths,
        obsidian_paths_trashed=frozenset((f"{v}/{p}" if v else p).lower()
                                         for v, ps in trashed.items() for p in ps),
        by_nfc=by_nfc,
    )


def _join(base_dir: str, rel: str) -> str:
    """`rel` beside `base_dir`, `.`/`..`/empty segments folded the way the client's Notion
    `resolvePath` folds them (a `..` above the top stays at the top). NOTION ONLY: `file:`
    keys use `posixpath.normpath` (fix round 1, I-2)."""
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


def _exact_forms(path: str, from_dir: str, *, rooted: bool = True) -> list[str]:
    """The paths a relative href names exactly, in the provider's order (`_resolve_relative`):
    beside the linking note, then (`rooted`) from the top. One that climbs above the top is
    no path."""
    joined = posixpath.normpath(posixpath.join(from_dir, path)) if from_dir else posixpath.normpath(path)
    forms = (joined, posixpath.normpath(path.lstrip("/"))) if rooted else (joined,)
    out: list[str] = []
    for form in forms:
        if not obsidian_provider._escapes_root(form) and form not in out:
            out.append(form)
    return out


def _name_candidates(path: str, vault_index: Any) -> list[str]:
    """EVERY vault path the name rule could pick for `path` (a bare name by basename, a
    path-qualified one by `/`-boundary suffix), never just the first."""
    form = posixpath.normpath(path.lstrip("/"))
    if obsidian_provider._escapes_root(form) or form == ".":
        return []
    lower = form.lower()
    if "/" in form:
        return [p for p in vault_index.paths if p.lower() == lower or p.lower().endswith("/" + lower)]
    named = vault_index.get(obsidian_provider._strip_ext(form).lower()) or []
    return [p for p in named if obsidian_provider._basename(p).lower() == lower]


def _obsidian_target(path: str, full: str, index: FileKeyIndex) -> tuple[str | None, str]:
    """`(stored key path, action)` for a `.md` relative href of the note whose key path is
    `full` (`obsidian:<full>`).

    1. The exact path the member wrote (beside the note, then from the top), inside the C9
       vault: `relative_to_note`. When that path is a note the member TRASHED, the link meant
       that note: it is left as written (`relative_target_trashed`), never handed to a
       same-named note (I-1).
    2. Fix round 1, I-4: the EXACT path beside the note, over every Obsidian file path of the
       member. A member who dropped the vault's contents has no vault folder, so the first
       segment is just a folder; an exact path is what they wrote, never a guess. Exact only:
       the name rule never runs across first folders. Fix round 2, N-1: never "from the top"
       here; the top of the member's whole key space mixes separate imports.
    3. Fix round 1, C-1: the provider's NAME rule chooses among same-named notes (same folder,
       else shortest path). A connector vault is one vault, so that choice is safe there; the
       file importer's keys do not show where a drop's vaults are rooted (`.obsidian/` is not
       stored), so here a choice could open ANOTHER vault's note. A name match is taken only
       when it is the ONE candidate in the C9 vault AND it sits in the linking note's own first
       folder (`relative_by_name`); two or more is `relative_ambiguous`; one elsewhere is
       `relative_unresolved`. Both leave the link as written."""
    vault, inner = _vault_split(full)
    prefix = vault + "/" if vault else ""
    vault_index = index.obsidian.get(vault) or obsidian_provider._build_basename_map([])
    trashed = index.obsidian_trashed.get(vault, frozenset())
    for form in _exact_forms(path, obsidian_provider._dir_of(inner)):
        found = vault_index.by_lower.get(form.lower())
        if found is not None:
            return prefix + found, TO_NOTE
        if form.lower() in trashed:
            return None, TRASHED
    for form in _exact_forms(path, obsidian_provider._dir_of(full), rooted=False):
        found = index.obsidian_paths.get(form.lower())
        if found is not None:
            return found, TO_NOTE
        if form.lower() in index.obsidian_paths_trashed:
            return None, TRASHED
    candidates = _name_candidates(path, vault_index)
    if len(candidates) > 1:
        return None, AMBIGUOUS
    scope = inner.split("/", 1)[0] + "/" if "/" in inner else ""
    if len(candidates) == 1 and candidates[0].startswith(scope):
        return prefix + candidates[0], BY_NAME
    return None, UNRESOLVED


def _hostlike(href: str) -> tuple[bool, str | None]:
    """`(is a web address written without a scheme, linkify's URL for it or None)`.

    Host-like: the live linkify matcher reads the WHOLE href as one web address, and it starts
    `www.` or has a path (`example.com/x`). A bare `name.tld` is not enough: `deck.mov` and
    `notes.md` are file names that end in a real TLD. The URL is linkify's own (`_matches`, the
    live allow-list: `www.` and http(s) only), so the repair links exactly what linkify would
    link if the member had typed that text."""
    h = href.strip()
    with linkify._LINKIFY_LOCK:
        found = linkify._LINKIFY.match(h) or []
    whole = len(found) == 1 and found[0].index == 0 and found[0].last_index == len(h)
    if not whole or not (h[:4].lower() == "www." or "/" in h):
        return False, None
    kept = linkify._matches(h)
    url = kept[0][2] if len(kept) == 1 and kept[0][:2] == (0, len(h)) else None
    return True, url


def relative_target(href: str, *, import_key: str, import_source: str,
                    index: FileKeyIndex) -> tuple[str | None, str]:
    """`(import key, action)` for a relative href in a FILE note. With a key, the action is a
    write (`relative_to_note`); without one it is a count (`COUNT_ONLY_ACTIONS`) and the link
    stays exactly as written: never a guess, and never made worse (fix round 1, I-3)."""
    if not isinstance(href, str) or not isinstance(import_key, str):
        return None, UNRESOLVED
    is_host, url = _hostlike(href)
    if is_host:  # never a lost file, never a note (fix round 1 follow-up, concern 2)
        return None, HOSTLIKE_LINKED if url else HOSTLIKE
    # M-1: the comparison is in NFC on both sides (a macOS export stores NFD names); every
    # answer is mapped back to the key as STORED (`index.stored`).
    target = _nfc(unquote(href)).split("#", 1)[0].strip()
    import_key = _nfc(import_key)
    if not target:
        return None, UNRESOLVED
    if import_source == OBSIDIAN_SOURCE and import_key.startswith(_OBSIDIAN):
        path = target.split("?", 1)[0].strip()
        if not _OBSIDIAN_NOTE_EXT_RE.search(path):
            return None, FILE_UNRESOLVED  # only a `.md` link names a note (the provider's rule)
        # `|` separates a pending key's fields and cannot be in an Obsidian file name.
        if "|" in path:
            return None, UNRESOLVED
        resolved, action = _obsidian_target(path, import_key[len(_OBSIDIAN):], index)
        return (None if resolved is None else index.stored(_OBSIDIAN + resolved)), action
    if import_source == NOTION_SOURCE and import_key.startswith(_NOTION):
        path = _join(posixpath.dirname(import_key[len(_NOTION):]), target.split("?", 1)[0])
        if not _NOTION_PAGE_EXT_RE.search(path):
            return None, FILE_UNRESOLVED  # an attachment, never a page
        for key in (_NOTION + strip_notion_id_path(path), _NOTION + path):
            stored = index.stored(key)
            if stored is not None:
                return stored, TO_NOTE
        m = _NOTION_PAGE_ID_RE.search(path.rsplit("/", 1)[-1])
        return (linkify.notion_note_key(m.group(1)), TO_NOTE) if m else (None, UNRESOLVED)
    if import_key.startswith(_FILE):
        # Fix round 1, I-2: `posixpath.normpath` (the brief's rule; there is no client resolver
        # to match here). A path that climbs above the drop names nothing in it.
        path = posixpath.normpath(posixpath.join(posixpath.dirname(import_key[len(_FILE):]), target))
        if obsidian_provider._escapes_root(path):
            return None, UNRESOLVED if _GENERIC_NOTE_EXT_RE.search(path) else FILE_UNRESOLVED
        # A TextBundle is ONE note keyed `file:<bundle dir>`, and its `text.md` maps to that key
        # (`generic.js` keyByPath, exact path); any other bundle member is a file, never a note.
        if _TEXTBUNDLE_TEXT_RE.search(path):
            stored = index.stored(_FILE + path[:-len("/text.md")])
            return (stored, TO_NOTE) if stored is not None else (None, UNRESOLVED)
        if _TEXTBUNDLE_DIR_RE.search(path):
            return None, FILE_UNRESOLVED
        stored = index.stored(_FILE + path)
        if stored is not None:
            return stored, TO_NOTE
        if not _GENERIC_NOTE_EXT_RE.search(path):
            return None, FILE_UNRESOLVED  # anything the generic importer never makes a note of
        return None, UNRESOLVED
    return None, UNRESOLVED


def relative_target_key(href: str, *, import_key: str, import_source: str,
                        index: FileKeyIndex) -> str | None:
    """The import key a relative href in a FILE note names, else None (never a guess)."""
    return relative_target(href, import_key=import_key, import_source=import_source, index=index)[0]


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
                     index: FileKeyIndex) -> set[str]:
    """Step 2 (FILE notes only): every relative href that names a note becomes its key; any
    other stays as written. Returns the action codes that occurred."""
    seen: set[str] = set()

    def fix(_node, marks, i, href):
        if not is_relative_href(href):
            return
        key, action = relative_target(href, import_key=import_key, import_source=import_source,
                                      index=index)
        if key is not None:
            marks[i] = {**marks[i], "attrs": {**marks[i]["attrs"], "href": LINK_PREFIX + key}}
        elif action == HOSTLIKE_LINKED:
            marks[i] = {**marks[i], "attrs": {**marks[i]["attrs"], "href": _hostlike(href)[1]}}
        seen.add(action)

    _walk_link_marks(doc, fix)
    return seen


def repair_links(doc: dict, *, note_class: str, import_key: str, import_source: str,
                 index: FileKeyIndex, conn, user_id: str) -> tuple[dict, list[str]]:
    """`(new_doc, actions)`; `actions` is empty when nothing changed. Never mutates `doc`."""
    out = copy.deepcopy(doc)
    actions: list[str] = []
    if _decode_pct_keys(out, conn, user_id):
        actions.append("pct_key_decoded")
    if note_class == import_repair.FILE:
        seen = _repair_relative(out, import_key=import_key, import_source=import_source, index=index)
        actions.extend(code for code in RELATIVE_ACTIONS if code in seen)
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
