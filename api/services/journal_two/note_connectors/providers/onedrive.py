"""OneDrive delta-sync provider — the simpler half of the Microsoft Graph
wave (spec `2026-08-12-note-connectors-msgraph-design.md` §7): unlike OneNote,
OneDrive has a REAL delta API, so this drops straight into the engine's
existing `opaque_cursor` mode (Dropbox's precedent) with no resumable-queue
machinery of its own.

Dark-until-configured lives entirely at the OAuth layer (`oauth.configured
("onedrive")`, Task 1) — exactly like `NotionProvider`, NOT like
`DropboxProvider` (which needs its own app key/secret to refresh its own
tokens). This module reads no env vars of its own for gating and needs none:
importing it, or constructing `OneDriveProvider()` with no folder configured,
never raises — only calling a method without a resolvable folder id does
(`NoteConnAuthError`, mirroring `DropboxProvider._resolve_folder_path`'s
identical shape).

⚠️ CREDENTIAL BOUNDARY (named critical risk class — both wave-1 live
providers had this bug): the Graph bearer, via `MSGraphClient.send`, is
attached ONLY to `graph.microsoft.com` — enumeration (`/delta`), content
metadata, and the folder picker (`/children`) all go through that one
chokepoint. The download flow is TWO HOPS: `GET /me/drive/items/{id}/content`
(Graph, authenticated) returns a `302` to a **pre-authenticated** URL that
Microsoft's own docs say needs no `Authorization` header at all — that
second hop is fetched via `providers.base.guarded_media_get` (SSRF-guarded,
literally no Authorization header attached, ever) rather than through
`MSGraphClient`. A genuine external `https://` URL referenced in a note's
own content (an image hot-linked from elsewhere) is the SAME unauthenticated,
guarded path.

CURSOR REPRESENTATION (opaque mode, base.py's `opaque_cursor`): a Graph
delta round returns EITHER `@odata.nextLink` (more pages this round — keep
paging) or, on the final page, `@odata.deltaLink` (the durable, opaque
continuation token for the NEXT round). `list_changed` drains up to
`MSGRAPH_ONEDRIVE_PAGES_PER_TICK` pages (default 200) per tick and publishes
`self.opaque_cursor` as whichever token the drain produced — the
`@odata.deltaLink` when it finished, or the interim `@odata.nextLink` when
the per-tick page budget was hit mid-drain (both are resumable continuation
URLs; the engine persists whichever one verbatim and hands it back unchanged
next tick, exactly like Dropbox's `list_folder` cursor). A stale/invalidated
cursor surfaces as `410 Gone` — caught internally (`_ResyncSignal`) and
recovered by restarting delta from the folder root, the OneDrive analog of
Dropbox's `409 {".tag": "reset"}` self-heal.

DELETE DETECTION: unlike Dropbox (whose `list_folder` also carries a
`.tag: "deleted"` facet but which this codebase's Dropbox provider simply
omits from `refs`, relying on the engine's generic 2-strike miss-streak
detector), Graph's delta feed is OneDrive's ONLY channel for deletions — so
this provider collects every `"deleted"`-faceted item seen during the most
recent `list_changed()` call and exposes it via `list_deleted(credentials)`,
the engine's existing CERTAIN-deletion channel (`engine.py::_do_sync`,
`getattr(provider, "list_deleted", None)`, called on a full pass
immediately after `list_changed`). `list_deleted` never re-queries Graph
itself — the engine's own call order guarantees `list_changed` always runs
first in the same sync.

RELATIVE MEDIA/ATTACHMENTS resolve against the delta-enumerated item index,
mirroring Dropbox's approach — but Graph addresses everything by an opaque
item `id` (not a filesystem path), so this provider builds its own
POSIX-style "virtual path" purely from `parentReference.id` chains + `name`
fields (never Graph's own `parentReference.path` string, whose exact format
this module makes no assumption about), then resolves a markdown/HTML
relative reference against that self-built index exactly as Dropbox resolves
one against `path_lower`. Because the placeholder schemes below carry an
opaque item id (never a path with spaces/special characters), there is only
ONE encoding domain here — unlike Dropbox's documented two-domain split —
`quote()`/`unquote()` round-trips trivially.
"""

from __future__ import annotations

import os
import posixpath
import re
from typing import Any
from urllib.parse import quote, unquote, urlsplit

import httpx

from ...notes import _MAX_FILE_BYTES
from .. import errors
from ..convert import ATTACHMENT_REF_PREFIX, LINK_PREFIX, REF_PREFIX, html_to_tiptap, md_to_tiptap
from . import msgraph_base
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef, guarded_media_get
from .dropbox import _txt_to_tiptap

# Extensions the picker/enumerator treats as note CANDIDATES. `.docx` is
# included here (so a Word file shows up as a named, per-item failure rather
# than silently vanishing from the folder listing) but is refused by name at
# FETCH time -- see `fetch()`. Everything else under the folder (images,
# PDFs, other attachments) is MEDIA -- resolved only when a note references
# it by relative path, never enumerated as its own note.
_NOTE_EXTENSIONS = (".md", ".html", ".htm", ".txt")
_ENUMERATE_EXTENSIONS = _NOTE_EXTENSIONS + (".docx",)

_DOCX_UNSUPPORTED_MESSAGE = "docx files sync via the file importer, not the OneDrive connector"

_MAX_LIST_PAGES = 500  # defensive cap on the folder-picker's /children pagination

# Internal-only prefixes marking a media/attachment ref this provider has
# already resolved to an item id in the delta-enumerated index -- mirrors
# Dropbox's `_MD_MEDIA_SCHEME`/`_MD_ATTACH_SCHEME`/`_HTML_SCHEME` shape.
# Never leak outward; stripped in `fetch_media` before anything reaches Graph.
_MD_MEDIA_SCHEME = "od-md-media:"
_MD_ATTACH_SCHEME = "od-md-attach:"
_MD_SCHEMES = (_MD_MEDIA_SCHEME, _MD_ATTACH_SCHEME)
_HTML_SCHEME = "od-html:"

_MD_IMAGE_RE = re.compile(r"(!\[[^\]]*\]\()\s*([^)\s]+)((?:\s+\"[^\"]*\")?\s*\))")
_MD_LINK_RE = re.compile(r"(?<!\!)\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+\"[^\"]*\")?\s*\))")
_HTML_IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc\s*=\s*)(["\'])(.*?)\2', re.IGNORECASE | re.DOTALL)
_HTML_A_HREF_RE = re.compile(r'(<a\b[^>]*?\bhref\s*=\s*)(["\'])(.*?)\2', re.IGNORECASE | re.DOTALL)

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})

_MAX_PATH_DEPTH = 64  # defensive bound on the parent-id walk (see _virtual_path)

_CONTENT_TYPE_BY_EXT = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}


def _extension(name: str) -> str:
    idx = name.rfind(".")
    return name[idx:].lower() if idx != -1 else ""


def _title_from_name(name: str) -> str:
    stem = posixpath.splitext(name)[0]
    return stem or name


def _guess_content_type(name: str) -> str:
    return _CONTENT_TYPE_BY_EXT.get(_extension(name), "application/octet-stream")


def _pages_per_tick() -> int:
    """`MSGRAPH_ONEDRIVE_PAGES_PER_TICK`, default 200 (spec §13) -- read live
    on every call, never cached, so a test (or an owner tuning production)
    can change it without a process restart."""
    raw = os.environ.get("MSGRAPH_ONEDRIVE_PAGES_PER_TICK")
    if not raw:
        return 200
    try:
        return max(1, int(raw))
    except ValueError:
        return 200


def _looks_like_local_path(url: str) -> bool:
    """True for a reference this provider should attempt to resolve against
    the delta-enumerated item index -- i.e. NOT an absolute URL, a `data:`
    URI, or something already carrying one of mddoc's own placeholder
    prefixes or this module's own schemes (mirrors
    `dropbox.py::_looks_like_local_path` exactly)."""
    if not url:
        return False
    if url.startswith((REF_PREFIX, LINK_PREFIX, "data:") + _MD_SCHEMES + (_HTML_SCHEME,)):
        return False
    first_segment = url.split("/", 1)[0]
    if "://" in first_segment or first_segment.startswith("mailto:"):
        return False
    return True


class _ResyncSignal(Exception):
    """Internal-only sentinel: a delta call 410'd (Graph invalidated the
    stored `deltaLink`/`nextLink`). Caught inside `list_changed` to trigger a
    full re-list from the folder root -- NEVER escapes this module."""


class OneDriveProvider(NoteProvider):
    name = "onedrive"

    def __init__(
        self, *, client: httpx.AsyncClient | None = None,
        sleep_fn: Any = None, rng: Any = None, folder_path: str | None = None,
    ) -> None:
        # Tests inject a `client` built on `httpx.MockTransport` (no live
        # calls), a `sleep_fn` that returns instantly instead of really
        # sleeping through the 429 retry ladder, and an `rng` that returns a
        # fixed draw for a deterministic, assertable jittered-backoff delay.
        self._graph = msgraph_base.MSGraphClient(client=client, sleep_fn=sleep_fn, rng=rng)
        # `folder_path=` per the task brief's stated constructor shape
        # (mirrors `DropboxProvider`'s kwarg name for interface parity) --
        # despite the name, this is actually the OneDrive drive-item ID of
        # the picked folder, never a path string: Graph's delta API
        # addresses a folder by id (`/me/drive/items/{folderId}/delta`),
        # not by path. `credentials["folderId"]` is the equivalent
        # defensive fallback to Dropbox's `credentials["folderPath"]`.
        self._folder_id_override = folder_path
        self._folder_id: str | None = None
        # item id -> raw Graph driveItem dict, rebuilt on every
        # `list_changed()` call from THAT round's items only (a Graph delta
        # round -- even the "everything" initial round -- never re-sends an
        # unchanged item, so an incremental round's index is necessarily
        # partial; this is the exact same accepted limitation
        # `DropboxProvider._entries_by_path` already has for its own
        # incremental `list_folder/continue` rounds). Instance state,
        # lifetime = one `OneDriveProvider` object.
        self._items_by_id: dict[str, dict[str, Any]] = {}
        # lower-cased self-built "virtual path" (see module docstring) ->
        # item id, for relative markdown/HTML reference resolution.
        self._path_by_lower: dict[str, str] = {}
        # Deleted items ("deleted" facet) collected during the MOST RECENT
        # `list_changed()` call -- see `list_deleted`'s own docstring for
        # why this is a plain instance-state handoff, never a re-query.
        self._deleted_refs: list[RemoteRef] = []
        self._enumerated = False

    async def aclose(self) -> None:
        await self._graph.aclose()

    # ── credentials / folder resolution ─────────────────────────────────

    def _resolve_folder_id(self, credentials: dict[str, Any]) -> str:
        folder_id = self._folder_id_override or credentials.get("folderId")
        if not folder_id:
            raise errors.NoteConnAuthError(
                "OneDrive source requires a folder id -- pass folder_path= to "
                "OneDriveProvider() (it carries the drive-item id despite the "
                "name), or set credentials['folderId']",
            )
        return folder_id

    def _require_enumerated(self) -> None:
        if not self._enumerated:
            raise RuntimeError(
                "call list_changed() before fetch()/fetch_media() -- the "
                "item index (relative media resolution, titles, folder_path) "
                "is built there",
            )

    def _delta_url(self, folder_id: str) -> str:
        return f"{msgraph_base.GRAPH_API_BASE}/me/drive/items/{folder_id}/delta"

    # ── NoteProvider contract ───────────────────────────────────────────

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        return await self._graph.validate(credentials)

    async def _drain(
        self, credentials: dict[str, Any], start_url: str,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Pages through `@odata.nextLink` starting at `start_url` (either a
        fresh `/delta` URL for the folder, or a stored `deltaLink`/
        `nextLink`), collecting every item across pages up to
        `MSGRAPH_ONEDRIVE_PAGES_PER_TICK` pages. Returns `(items, cursor)`
        where `cursor` is the final `@odata.deltaLink` when the drain
        completed within budget, or the interim `@odata.nextLink` when the
        page budget was hit mid-drain -- both are resumable continuation
        tokens the engine persists verbatim (base.py's `opaque_cursor`).
        Raises `_ResyncSignal` (internal) on a `410 Gone` at ANY point --
        the caller's job to restart from the folder root."""
        budget = _pages_per_tick()
        items: list[dict[str, Any]] = []
        url = start_url
        pages = 0
        while True:
            response = await self._graph.send(credentials, "GET", url)
            if response.status_code == 410:
                raise _ResyncSignal()
            if response.status_code != 200:
                msgraph_base.raise_for_status(response)
            data = response.json()
            items.extend(data.get("value") or [])
            pages += 1
            next_link = data.get("@odata.nextLink")
            delta_link = data.get("@odata.deltaLink")
            if next_link and pages < budget:
                url = next_link
                continue
            return items, (delta_link or next_link)

    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        folder_id = self._resolve_folder_id(credentials)
        self._deleted_refs = []
        start_url = cursor if cursor else self._delta_url(folder_id)
        try:
            items, final_cursor = await self._drain(credentials, start_url)
        except _ResyncSignal:
            # Graph invalidated the stored cursor -- the documented recovery
            # is a fresh full re-list from the folder root, never a crash
            # (Dropbox's `409 {".tag": "reset"}` analog).
            items, final_cursor = await self._drain(credentials, self._delta_url(folder_id))
        self._index_items(folder_id, items)
        self.opaque_cursor = final_cursor
        return self._items_to_refs(items)

    async def list_deleted(self, credentials: dict[str, Any]) -> list[RemoteRef]:
        """Deleted items collected during the MOST RECENT `list_changed()`
        call. Graph's delta feed is OneDrive's ONLY channel for deletions --
        there is no separate "list trashed items" endpoint the way Notion's
        `search`+`in_trash` sweep has -- so this simply hands back what that
        call already saw rather than re-querying Graph. Safe because the
        engine ALWAYS calls `list_changed()` immediately before
        `list_deleted()`, on the same full pass (`engine.py::_do_sync`)."""
        return list(self._deleted_refs)

    def _items_to_refs(self, items: list[dict[str, Any]]) -> list[RemoteRef]:
        refs: list[RemoteRef] = []
        for item in items:
            item_id = item.get("id")
            if not item_id:
                continue
            if "deleted" in item:
                self._deleted_refs.append(
                    RemoteRef(remote_id=item_id, updated_at=item.get("lastModifiedDateTime") or ""),
                )
                continue
            if "folder" in item:
                continue  # folders never become note candidates
            name = item.get("name") or ""
            if _extension(name) not in _ENUMERATE_EXTENSIONS:
                continue  # media/other attachments resolved by reference, never enumerated
            refs.append(RemoteRef(remote_id=item_id, updated_at=item.get("lastModifiedDateTime") or ""))
        return refs

    def _index_items(self, folder_id: str, items: list[dict[str, Any]]) -> None:
        self._folder_id = folder_id
        by_id: dict[str, dict[str, Any]] = {}
        for item in items:
            item_id = item.get("id")
            if item_id and "deleted" not in item:
                by_id[item_id] = item
        self._items_by_id = by_id
        path_by_lower: dict[str, str] = {}
        for item_id in by_id:
            vpath = self._virtual_path(item_id)
            if vpath:
                path_by_lower[vpath.lower()] = item_id
        self._path_by_lower = path_by_lower
        self._enumerated = True

    def _virtual_path(self, item_id: str) -> str:
        """A POSIX-style path for `item_id`, built PURELY from
        `parentReference.id` chains + `name` fields in `self._items_by_id`
        (never from Graph's own `parentReference.path` string, whose exact
        format this module makes no assumption about) -- rooted at the
        picked scope folder (`self._folder_id` maps to `""`). Bounded
        (`_MAX_PATH_DEPTH`) against a malformed/cyclic parent chain; falls
        back to whatever prefix was resolved so far rather than raising, and
        degrades to "unresolvable" (`""`) if the walk runs off the known
        item set entirely (e.g. this round was an INCREMENTAL delta that
        only contains changed items, not the whole subtree -- an accepted
        limitation, same as Dropbox's identically-partial incremental
        index)."""
        if item_id == self._folder_id:
            return ""
        segments: list[str] = []
        current_id: str | None = item_id
        seen: set[str] = set()
        for _ in range(_MAX_PATH_DEPTH):
            if current_id is None or current_id == self._folder_id:
                break
            if current_id in seen:
                break
            seen.add(current_id)
            item = self._items_by_id.get(current_id)
            if item is None:
                break
            segments.append(item.get("name") or "")
            current_id = (item.get("parentReference") or {}).get("id")
        segments.reverse()
        cleaned = [s for s in segments if s]
        return "/" + "/".join(cleaned) if cleaned else ""

    def _virtual_dir_of(self, item_id: str) -> str:
        item = self._items_by_id.get(item_id)
        if item is None:
            return ""
        parent_id = (item.get("parentReference") or {}).get("id")
        if not parent_id or parent_id == self._folder_id:
            return ""
        return self._virtual_path(parent_id)

    def _relative_folder(self, item: dict[str, Any]) -> list[str]:
        parent_id = (item.get("parentReference") or {}).get("id")
        if not parent_id or parent_id == self._folder_id:
            return []
        vdir = self._virtual_path(parent_id)
        return [seg for seg in vdir.split("/") if seg]

    def _item_name(self, item_id: str) -> str:
        return (self._items_by_id.get(item_id) or {}).get("name") or ""

    # ── folder picker (connect-flow) ────────────────────────────────────

    async def list_folders(
        self, credentials: dict[str, Any], path: str = "",
    ) -> list[dict[str, Any]]:
        """Non-recursive CHILDREN listing for the connect-flow folder picker
        (spec §7 / Dropbox's `list_folders` precedent) -- NOT part of the
        abstract `NoteProvider` contract. `path` is EITHER `""` (drive root)
        or a previously-listed folder's drive-item id -- Graph's
        `/children` endpoint addresses a folder by id, which is what the
        picker UI naturally accumulates as the user drills in. Returns
        immediate child FOLDERS only, files filtered out."""
        url = "/me/drive/root/children" if not path else f"/me/drive/items/{path}/children"
        items: list[dict[str, Any]] = []
        next_url: str | None = url
        pages = 0
        while next_url:
            response = await self._graph.send(credentials, "GET", next_url)
            if response.status_code != 200:
                msgraph_base.raise_for_status(response)
            data = response.json()
            items.extend(data.get("value") or [])
            next_url = data.get("@odata.nextLink")
            pages += 1
            if pages > _MAX_LIST_PAGES:
                raise errors.NoteConnTransient(
                    f"OneDrive folder listing exceeded {_MAX_LIST_PAGES} pages "
                    "without finishing -- aborting rather than looping forever",
                )
        return [
            {"id": item.get("id"), "name": item.get("name")}
            for item in items if "folder" in item
        ]

    # ── content download (credential-boundary critical path) ────────────

    async def _download_content(self, credentials: dict[str, Any], item_id: str) -> bytes:
        """`GET /me/drive/items/{id}/content` (Graph, authenticated) ->
        `302` to a pre-authenticated download URL -> that second hop is
        fetched via `guarded_media_get` with NO Authorization header at all
        (Microsoft's own docs: "you don't need to include an Authorization
        header when you access the download URL") -- see the module
        docstring's CREDENTIAL BOUNDARY section. `MSGraphClient.send` never
        auto-follows redirects (no `follow_redirects=True` is ever passed),
        so the 302 response itself is what this method inspects."""
        response = await self._graph.send(credentials, "GET", f"/me/drive/items/{item_id}/content")
        if response.status_code in _REDIRECT_STATUSES:
            location = response.headers.get("location")
            if not location:
                raise errors.NoteConnTransient("OneDrive content redirect had no Location header")
            client = await self._graph.get_client()
            dl_response = await guarded_media_get(client, location, what="OneDrive file content")
            if dl_response.status_code >= 400:
                raise errors.NoteConnTransient(
                    f"Failed to download OneDrive file content ({dl_response.status_code})",
                    status=dl_response.status_code,
                )
            content = dl_response.content
        elif response.status_code == 200:
            # Defensive fallback (not the documented common case): some
            # small/edge responses could come back inline without a redirect.
            content = response.content
        else:
            msgraph_base.raise_for_status(response)
            raise AssertionError("unreachable")  # raise_for_status always raises here
        if len(content) > _MAX_FILE_BYTES:
            raise errors.NoteConnUnsupported(
                f"OneDrive file exceeds the {_MAX_FILE_BYTES}-byte import cap",
                reason="File is larger than the 25 MB import limit",
            )
        return content

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        self._require_enumerated()
        item_id = ref.remote_id
        item = self._items_by_id.get(item_id)
        name = (item or {}).get("name") or item_id
        ext = _extension(name)

        if ext == ".docx":
            raise errors.NoteConnUnsupported(_DOCX_UNSUPPORTED_MESSAGE)

        raw = await self._download_content(credentials, item_id)
        text = raw.decode("utf-8", errors="replace")

        if ext == ".md":
            text = self._resolve_relative_media_markdown(text, item_id)
            text = self._resolve_relative_attachments_markdown(text, item_id)
            converted = md_to_tiptap(text)
            converted = self._promote_md_attachments(converted)
        elif ext in (".html", ".htm"):
            text = self._resolve_relative_media_html(text, item_id)
            text = self._resolve_relative_attachments_html(text, item_id)
            converted = html_to_tiptap(text)
        else:  # .txt
            converted = _txt_to_tiptap(text)

        updated_at = (item or {}).get("lastModifiedDateTime") or ref.updated_at
        return RemoteNote(
            remote_id=item_id,
            title=_title_from_name(name),
            doc=converted["doc"],
            media=converted["media"],
            links=converted["links"],
            tags=[],
            folder_path=self._relative_folder(item) if item else [],
            created_at=(item or {}).get("createdDateTime"),
            updated_at=updated_at,
        )

    # ── relative reference resolution (Dropbox approach; see module docstring) ──

    def _resolve_one_relative_ref(self, url: str, file_dir: str) -> str | None:
        if not _looks_like_local_path(url):
            return None
        candidate = posixpath.normpath(posixpath.join(file_dir or "/", url))
        item_id = self._path_by_lower.get(candidate.lower())
        if item_id is None:
            return None
        item = self._items_by_id.get(item_id)
        if item is not None and "folder" not in item:
            return item_id
        return None

    def _resolve_relative_media_markdown(self, text: str, item_id: str) -> str:
        file_dir = self._virtual_dir_of(item_id)

        def repl(m: "re.Match[str]") -> str:
            resolved = self._resolve_one_relative_ref(unquote(m.group(2)), file_dir)
            if resolved is None:
                return m.group(0)
            encoded = quote(resolved, safe="")
            return f"{m.group(1)}<{_MD_MEDIA_SCHEME}{encoded}>{m.group(3)}"

        return _MD_IMAGE_RE.sub(repl, text)

    def _resolve_relative_attachments_markdown(self, text: str, item_id: str) -> str:
        """`[text](relpath)` (not image syntax) resolving to a co-located
        non-note FILE -> synthetic markdown IMAGE syntax carrying
        `_MD_ATTACH_SCHEME`, mirroring `dropbox.py`'s identical trick to
        reuse `md_to_tiptap`'s image-hoisting for free; `_promote_md_
        attachments` (below) converts it into a real `attachmentChip` node
        after conversion. A relative link to another IMPORTABLE note
        extension is left as an ordinary, untouched relative link --
        cross-note linking is future connector work, same as Dropbox."""
        file_dir = self._virtual_dir_of(item_id)

        def repl(m: "re.Match[str]") -> str:
            link_text = m.group(1)
            resolved = self._resolve_one_relative_ref(unquote(m.group(2)), file_dir)
            if resolved is None:
                return m.group(0)
            if _extension(self._item_name(resolved)) in _NOTE_EXTENSIONS:
                return m.group(0)  # inert relative anchor -- cross-note linking is future work
            encoded = quote(resolved, safe="")
            return f"![{link_text}](<{_MD_ATTACH_SCHEME}{encoded}>{m.group(3)}"

        return _MD_LINK_RE.sub(repl, text)

    def _promote_md_attachments(self, converted: dict[str, Any]) -> dict[str, Any]:
        marker = f"{REF_PREFIX}{_MD_ATTACH_SCHEME}"

        def walk(node: Any) -> Any:
            if not isinstance(node, dict):
                return node
            if node.get("type") == "image":
                src = (node.get("attrs") or {}).get("src", "")
                if src.startswith(marker):
                    ref = src[len(REF_PREFIX):]
                    item_id = unquote(ref[len(_MD_ATTACH_SCHEME):])
                    name = self._item_name(item_id) or item_id
                    return {"type": "attachmentChip", "attrs": {"href": src, "name": name}}
                return node
            if isinstance(node.get("content"), list):
                new_node = dict(node)
                new_node["content"] = [walk(c) for c in node["content"]]
                return new_node
            return node

        doc = walk(converted["doc"])
        media = [
            {**m, "kind": "file"} if m.get("ref", "").startswith(_MD_ATTACH_SCHEME) else m
            for m in converted["media"]
        ]
        return {"doc": doc, "media": media, "links": converted["links"]}

    def _resolve_relative_media_html(self, text: str, item_id: str) -> str:
        file_dir = self._virtual_dir_of(item_id)

        def repl(m: "re.Match[str]") -> str:
            # HTML attribute values are literal -- never percent-decoded.
            resolved = self._resolve_one_relative_ref(m.group(3), file_dir)
            if resolved is None:
                return m.group(0)
            return f"{m.group(1)}{m.group(2)}{_HTML_SCHEME}{resolved}{m.group(2)}"

        return _HTML_IMG_SRC_RE.sub(repl, text)

    def _resolve_relative_attachments_html(self, text: str, item_id: str) -> str:
        file_dir = self._virtual_dir_of(item_id)

        def repl(m: "re.Match[str]") -> str:
            prefix, q, url = m.group(1), m.group(2), m.group(3)
            resolved = self._resolve_one_relative_ref(url, file_dir)
            if resolved is None:
                return m.group(0)
            if _extension(self._item_name(resolved)) in _NOTE_EXTENSIONS:
                return m.group(0)
            return f"{prefix}{q}{ATTACHMENT_REF_PREFIX}{_HTML_SCHEME}{resolved}{q}"

        return _HTML_A_HREF_RE.sub(repl, text)

    # ── fetch_media (credential-boundary critical path) ─────────────────

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        for scheme in _MD_SCHEMES:
            if ref.startswith(scheme):
                item_id = unquote(ref[len(scheme):])
                content = await self._download_content(credentials, item_id)
                return content, _guess_content_type(self._item_name(item_id))
        if ref.startswith(_HTML_SCHEME):
            item_id = ref[len(_HTML_SCHEME):]
            content = await self._download_content(credentials, item_id)
            return content, _guess_content_type(self._item_name(item_id))

        # NOT a OneDrive-internal item we resolved ourselves -- a genuine
        # external URL taken from DOCUMENT CONTENT (an unresolved relative
        # path, or a real hot-linked image). The Graph bearer is NEVER
        # attached here (mirrors Dropbox/Notion's identical precedent):
        # only `MSGraphClient.send` ever carries it, and this branch never
        # calls it.
        parsed = urlsplit(ref)
        if (parsed.scheme or "").lower() != "https":
            raise errors.NoteConnUnsupported(
                f"Cannot fetch media over a non-OneDrive, non-https reference ({ref!r})",
                reason="Media reference did not resolve to a file in the synced "
                       "folder and is not a secure (https) URL",
            )
        client = await self._graph.get_client()
        response = await guarded_media_get(client, ref, what="OneDrive media")
        if response.status_code >= 400:
            raise errors.NoteConnTransient(
                f"Failed to download media ({response.status_code})", status=response.status_code,
            )
        content_type = response.headers.get("content-type", "application/octet-stream")
        return response.content, content_type
