"""Evernote live sync over Evernote's hosted MCP server (Plan E Task 5). Read-only.

Every Evernote call goes through `EvernoteMcpClient.call_tool`, whose first statement refuses any
tool outside `READ_TOOLS`. This provider calls five: `search_notes` (listing, trash),
`get_note` (one note's ENML), `search_notebooks` and `search_tags` (one call each per instance, for
folder and tag names) and `get_attachment` (a fresh pre-signed download URL per media fetch).

Measured facts (`docs/notebook-connectors/evernote-mcp-probe.md`, "Measured field names"): the
provider reads ONLY the measured `get_note` keys (`_NOTE_KEYS`). A measured key missing from a
payload is drift: the field reads as absent and the note carries
`evernote note shape: missing <key>` once per key per instance (`drain_item_failures`). No other
name is ever tried. `resources` is `null` on a note without attachments; every read is
`sc.get("resources") or []`. `search_notebooks`/`search_tags` cannot page (no `startIndex`,
`maxResults` <= 100): one call each, and a full 100 is logged as a cap and the map treated as
partial.

Media (`fetch_media`) accepts exactly two ref kinds and refuses everything else before any I/O:
  - `evernote-res://{noteGuid}/{md5}` -> `get_attachment` on EVERY call (the URL is short-lived and
    pre-signed), the declared size checked first, then a download from exactly
    `storage.googleapis.com` over https, pinned on every redirect hop (`allowed_host`), on top of
    the public-address guard, with no Authorization header ever;
  - `http(s)://` -> a hotlink copied in through the shared guarded path every connector uses
    (`base.fetch_content_url`).
A `data:` image never reaches here: the converter registers it with its `data_uri`, which the
engine decodes itself.

Timestamps: `_iso` -> UTC ISO with milliseconds, through `import_provenance.instant` for ISO
strings and the epoch-ms rule for numbers, so the engine's string cursor comparisons hold.
"""

from __future__ import annotations

import contextlib
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx

from ... import import_provenance
from .. import errors, evernote_oauth
from ..convert import enml
from ..evernote_mcp import EvernoteMcpClient
from . import base
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef

log = logging.getLogger(__name__)

EPOCH_FLOOR = "1970-01-01T00:00:00.000+00:00"
#: Task 5 review I2: how many times a listing whose `totalResultCount` moved between pages is
#: restarted before `list_changed` gives up with `NoteConnTransient` (the cursor then stays put).
LISTING_ATTEMPTS = 3


class _ListingMoved(Exception):
    """A page reported a different `totalResultCount` from page 0: a note entered or left the
    listing while it was read, so the offset pages shifted and one note may have been skipped."""
_HASH_RE = re.compile(r"^[0-9a-f]{32}$")
_MAX_PAGES = 1000  # 100 000 notes: a runaway pager stops here

#: The measured `get_note.structuredContent` keys this provider reads, and ONLY these.
_NOTE_KEYS = {
    "notebook": "notebookId",
    "tags": "tags",
    "created": "created",
    "updated": "updated",
    "attributes": "attributes",
    "resources": "resources",
    "content": "content",
    "title": "title",
}


def _iso(value: Any) -> str | None:
    """ISO string (any offset) or epoch milliseconds (number or all-digit string) -> UTC ISO with
    milliseconds. None or anything unreadable -> None; never raises."""
    dt: datetime | None = None
    try:
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        elif isinstance(value, str):
            text = value.strip()
            if text.isdigit():
                dt = datetime.fromtimestamp(int(text) / 1000, tz=timezone.utc)
            else:
                dt = import_provenance.instant(text)
    except (OverflowError, OSError, ValueError):
        return None
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")


class EvernoteProvider(NoteProvider):
    name = "evernote"
    #: Task 8 reads this to adopt notes imported earlier from `.enex` (`import_source`).
    adopt_import_source = "evernote"

    PAGE_SIZE = 100
    CURSOR_OVERLAP_S = 120
    ATTACHMENT_HOST = "storage.googleapis.com"

    def __init__(self, *, user_id: str | None = None,
                 mcp_factory: Callable[[dict], EvernoteMcpClient] | None = None,
                 http: httpx.AsyncClient | None = None) -> None:
        self._user_id = user_id
        self._mcp_factory = mcp_factory
        self._mcp: Any = None
        self._token: str | None = None
        self._owns_http = http is None
        self._media_http = http if http is not None else base.media_http_client(
            timeout=httpx.Timeout(60.0, connect=10.0))
        self._notebooks: dict[str, dict] | None = None
        self._tags: dict[str, str] | None = None
        self._hit_titles: dict[str, str] = {}
        self._failures: list[dict] = []
        self._recorded: set[str] = set()
        self._shape_logged = False
        self._host_logged = False

    # ------------------------------------------------------------------ plumbing

    def import_key(self, source_remote_id: str, remote_id: str) -> str:
        return enml.live_import_key(remote_id)

    def _client(self, creds: dict[str, Any]) -> Any:
        if self._mcp is None:
            token = (creds or {}).get("accessToken")
            if not token:
                raise errors.NoteConnAuthError("evernote: no access token stored")
            self._token = token
            if self._mcp_factory is not None:
                self._mcp = self._mcp_factory(creds)
            else:
                self._mcp = EvernoteMcpClient(
                    token, on_unauthorized=self._on_unauthorized if self._user_id else None)
        return self._mcp

    async def _on_unauthorized(self) -> str:
        """The MCP client's 401 hook: a forced refresh that names the token it saw rejected, so a
        concurrent refresher's newer token is used rather than rotated again."""
        creds = await evernote_oauth.refresh_if_needed(
            self._user_id, force=True, rejected_access_token=self._token)
        token = (creds or {}).get("accessToken")
        if not token:
            raise errors.NoteConnAuthError("evernote: no connector to refresh (reconnect needed)")
        self._token = token
        return token

    def _record(self, title: str, reason: str) -> None:
        if reason in self._recorded:
            return
        self._recorded.add(reason)
        self._failures.append({"noteTitle": title, "reason": reason, "name": None})

    def drain_item_failures(self) -> list[dict]:
        out, self._failures = self._failures, []
        return out

    async def aclose(self) -> None:
        if self._mcp is not None and hasattr(self._mcp, "aclose"):
            await self._mcp.aclose()
        if self._owns_http:
            await self._media_http.aclose()

    # ------------------------------------------------------------------ listing

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        sc = await self._client(credentials).call_tool("search_notes", {"query": "", "maxResults": 1})
        total = sc.get("totalResultCount")
        return AccountInfo(label="Evernote", raw={"noteCount": int(total) if isinstance(total, (int, float)) else 0})

    async def _pages(self, creds: dict[str, Any], query: str):
        """Yields `(hits, page)` newest first. Raises `_ListingMoved` when a later page reports a
        different `totalResultCount` from page 0 (review I2): offset paging over a set that
        changed mid-read can skip a note without any other sign."""
        client = self._client(creds)
        start = 0
        first_total: Any = None
        for _ in range(_MAX_PAGES):
            page = await client.call_tool("search_notes", {
                "query": query, "sortBy": "updated", "ascending": False,
                "maxResults": self.PAGE_SIZE, "startIndex": start})
            if start == 0:
                first_total = page.get("totalResultCount")
            elif page.get("totalResultCount") != first_total:
                raise _ListingMoved()
            hits = [h for h in page.get("hits") or [] if isinstance(h, dict) and h.get("noteId")]
            yield hits, page
            if page.get("isLastPage") or not hits:
                return
            start += self.PAGE_SIZE
        raise errors.NoteConnTransient("evernote: note listing did not end")

    def _ref(self, hit: dict, floor: str) -> RemoteRef:
        note_id = hit["noteId"]
        if isinstance(hit.get("title"), str):
            self._hit_titles[note_id] = hit["title"]
        when = _iso(hit.get("updatedAt")) or _iso(hit.get("createdAt")) or floor
        return RemoteRef(remote_id=note_id, updated_at=when)

    async def list_changed(self, credentials: dict[str, Any],
                           cursor: str | None = None) -> list[RemoteRef]:
        """Newest first. With a cursor, paging stops at the first page holding a hit older than
        `cursor - CURSOR_OVERLAP_S`; hits at or after that bound are returned (a re-fetch inside
        the overlap is an unchanged-note skip). A hit with no timestamps is listed at the floor:
        the cursor itself, so it can never move the cursor or stop a page."""
        for _attempt in range(LISTING_ATTEMPTS):
            try:
                return await self._changed_once(credentials, cursor)
            except _ListingMoved:
                continue
        raise errors.NoteConnTransient(
            "evernote: the note listing kept changing while it was read (cursor kept)")

    async def _changed_once(self, credentials: dict[str, Any], cursor: str | None) -> list[RemoteRef]:
        floor = cursor or EPOCH_FLOOR
        cursor_at = import_provenance.instant(cursor) if cursor else None
        bound = cursor_at - timedelta(seconds=self.CURSOR_OVERLAP_S) if cursor_at else None
        refs: dict[str, RemoteRef] = {}
        async with contextlib.aclosing(self._pages(credentials, "")) as pages:  # closed on break
            async for hits, _page in pages:
                older_seen = False
                for hit in hits:
                    ref = self._ref(hit, floor)
                    at = import_provenance.instant(ref.updated_at)
                    if bound is not None and at is not None and at < bound:
                        older_seen = True
                        continue
                    refs.setdefault(ref.remote_id, ref)
                if older_seen:
                    break
        return list(refs.values())

    async def _full(self, credentials: dict[str, Any], query: str) -> list[RemoteRef]:
        """The whole listing, checked complete: unique ids == `totalResultCount` and the last page
        `isLastPage`. A mismatch re-enumerates once; a second one is `NoteConnTransient`, so the
        engine skips its removal check rather than act on a partial list."""
        for _attempt in range(2):
            refs: dict[str, RemoteRef] = {}
            total: Any = None
            last = False
            try:
                async for hits, page in self._pages(credentials, query):
                    total = page.get("totalResultCount")
                    last = bool(page.get("isLastPage"))
                    for hit in hits:
                        ref = self._ref(hit, EPOCH_FLOOR)
                        refs.setdefault(ref.remote_id, ref)
            except _ListingMoved:
                continue  # review m4: the count could match the new total with one note skipped
            if last and isinstance(total, (int, float)) and len(refs) == int(total):
                return list(refs.values())
        raise errors.NoteConnTransient(
            f"evernote: the {'trash' if query else 'note'} listing did not add up twice")

    async def list_present_refs(self, credentials: dict[str, Any]) -> list[RemoteRef]:
        return await self._full(credentials, "")

    async def list_deleted(self, credentials: dict[str, Any]) -> list[RemoteRef]:
        return await self._full(credentials, "intrash:true")

    # ------------------------------------------------------------------ fetch

    def _note_field(self, sc: dict, field: str, title: str) -> Any:
        key = _NOTE_KEYS[field]
        if key not in sc:
            self._record(title, f"evernote note shape: missing {key}")
            return None
        return sc[key]

    async def _notebook_map(self, creds: dict[str, Any]) -> dict[str, dict]:
        if self._notebooks is None:
            sc = await self._client(creds).call_tool(
                "search_notebooks", {"query": "", "maxResults": 100})
            hits = [h for h in sc.get("hits") or [] if isinstance(h, dict) and h.get("notebookId")]
            if len(hits) >= 100:
                log.warning("evernote notebooks listing hit the 100 cap")
            self._notebooks = {h["notebookId"]: h for h in hits}
        return self._notebooks

    async def _tag_map(self, creds: dict[str, Any]) -> dict[str, str]:
        if self._tags is None:
            sc = await self._client(creds).call_tool("search_tags", {"query": "", "maxResults": 100})
            hits = [h for h in sc.get("hits") or [] if isinstance(h, dict) and h.get("tagId")]
            if len(hits) >= 100:
                log.warning("evernote tags listing hit the 100 cap")
            self._tags = {h["tagId"]: str(h.get("label") or "") for h in hits}
        return self._tags

    async def _folder(self, creds: dict, notebook_id: Any, title: str) -> list[str]:
        if not isinstance(notebook_id, str) or not notebook_id:
            return []
        nb = (await self._notebook_map(creds)).get(notebook_id)
        if nb is None:
            self._record(title, f"evernote notebook not listed: {notebook_id}")
            return []
        label = str(nb.get("label") or "").strip()
        stack = nb.get("stack")
        if not label:
            return []
        return [stack.strip(), label] if isinstance(stack, str) and stack.strip() else [label]

    async def _tag_labels(self, creds: dict, tags: Any, title: str) -> list[str]:
        if not isinstance(tags, list):
            return []
        labels: list[str] = []
        for el in tags:
            label: str | None = None
            if isinstance(el, str):
                label = (await self._tag_map(creds)).get(el, el)
            elif isinstance(el, dict):
                named = el.get("name") if isinstance(el.get("name"), str) else el.get("label")
                if isinstance(named, str) and named.strip():
                    label = named
                else:
                    tag_id = el.get("guid") if isinstance(el.get("guid"), str) else el.get("id")
                    if isinstance(tag_id, str):
                        label = (await self._tag_map(creds)).get(tag_id)
                        if label is None:
                            self._record(title, f"evernote tag not listed: {tag_id}")
            else:
                self._record(title, f"evernote note shape: tag element {type(el).__name__}")
            if label and label.strip() and label.strip() not in labels:
                labels.append(label.strip())
        return labels

    @staticmethod
    def _source_url(attributes: Any) -> str | None:
        if not isinstance(attributes, dict):
            return None
        value = attributes.get("sourceURL")
        if isinstance(value, dict):
            value = value.get("name")
        if not isinstance(value, str):
            return None
        try:
            scheme = urlsplit(value.strip()).scheme.lower()
        except ValueError:
            return None
        return value.strip() if scheme in ("http", "https") else None

    def _log_shape_sample(self, sc: dict) -> None:
        if self._shape_logged:
            return
        self._shape_logged = True
        tags = sc.get("tags")
        first = tags[0] if isinstance(tags, list) and tags else None
        attributes = sc.get("attributes")
        log.info("evernote note shape sample: tags=%s tag_keys=%s attributes_keys=%s",
                 type(first).__name__ if first is not None else "none",
                 sorted(first.keys()) if isinstance(first, dict) else "none",
                 sorted(attributes.keys()) if isinstance(attributes, dict) else "none")

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        guid = ref.remote_id
        if not enml.is_guid(guid):
            # Review n3: the id builds media refs and import keys; refuse before asking.
            raise errors.NoteConnUnsupported(
                "evernote: a note id that is not a GUID", reason="Evernote returned an unreadable note id")
        sc = await self._client(credentials).call_tool("get_note", {"noteId": guid})
        if not isinstance(sc, dict):
            raise errors.NoteConnUnsupported("evernote: get_note returned no note")
        self._log_shape_sample(sc)
        raw_title = sc.get("title") if "title" in sc else None
        title = (raw_title if isinstance(raw_title, str) and raw_title.strip()
                 else self._hit_titles.get(guid) or "Untitled").strip()
        if "title" not in sc:
            self._record(title, "evernote note shape: missing title")

        content = self._note_field(sc, "content", title)
        resources = self._note_field(sc, "resources", title) or []
        attributes = self._note_field(sc, "attributes", title)
        converted = enml.enml_to_tiptap(
            content if isinstance(content, str) else "", resources if isinstance(resources, list) else [],
            note_guid=guid, source_url=self._source_url(attributes))
        folder = await self._folder(credentials, self._note_field(sc, "notebook", title), title)
        tags = await self._tag_labels(credentials, self._note_field(sc, "tags", title), title)
        return RemoteNote(
            remote_id=guid,
            title=title,
            doc=converted["doc"],
            media=converted["media"],
            links=converted["links"],
            tags=tags,
            folder_path=folder,
            created_at=_iso(self._note_field(sc, "created", title)),
            updated_at=_iso(self._note_field(sc, "updated", title)),
        )

    # ------------------------------------------------------------------ media

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        if not isinstance(ref, str):
            raise errors.NoteConnUnsafeAddress("evernote: a media ref that is not a string")
        if ref.startswith(enml.EVERNOTE_RES_SCHEME):
            return await self._fetch_resource(credentials, ref)
        try:
            scheme = urlsplit(ref).scheme.lower()
        except ValueError:
            scheme = ""
        if scheme in ("http", "https"):
            # A hotlink from the note: copied in through the shared guarded path.
            return await base.fetch_content_url(self._media_http, ref, what="linked image")
        raise errors.NoteConnUnsafeAddress(
            f"evernote: refusing media ref {ref[:40]!r}", reason="Media reference is not allowed")

    async def _fetch_resource(self, creds: dict[str, Any], ref: str) -> tuple[bytes, str]:
        guid, _, md5 = ref[len(enml.EVERNOTE_RES_SCHEME):].partition("/")
        if not enml.is_guid(guid) or not _HASH_RE.match(md5):
            raise errors.NoteConnUnsupported(
                "evernote: a malformed attachment ref", reason="Attachment reference is malformed")
        sc = await self._client(creds).call_tool("get_attachment", {"noteId": guid, "hash": md5})
        if not isinstance(sc, dict):
            raise errors.NoteConnTransient("evernote: get_attachment returned nothing")
        name = sc.get("filename") if isinstance(sc.get("filename"), str) else "attachment"
        size = sc.get("sizeBytes")
        if isinstance(size, (int, float)) and not isinstance(size, bool) and size > base.MEDIA_MAX_BYTES:
            raise errors.NoteConnTooLarge(
                f"evernote: {name} is {int(size)} bytes", reason=f"{name} is larger than the allowed size limit")
        url = sc.get("downloadUrl")
        parts = urlsplit(url) if isinstance(url, str) else None
        if parts is None or parts.scheme.lower() != "https" or (parts.hostname or "") != self.ATTACHMENT_HOST:
            raise errors.NoteConnUnsafeAddress(
                "evernote: an attachment URL off the pinned host",
                reason=f"{name} was offered from an address that isn't allowed")
        if not self._host_logged:
            self._host_logged = True
            log.info("evernote attachment host sample: %s", parts.hostname)
        response = await base.guarded_media_get(
            self._media_http, url, what=name, allowed_host=self.ATTACHMENT_HOST)
        if not 200 <= response.status_code < 300:
            raise errors.NoteConnTransient(
                f"evernote: downloading {name} failed ({response.status_code})", status=response.status_code)
        mime = sc.get("mimeType") if isinstance(sc.get("mimeType"), str) and sc.get("mimeType") else None
        return response.content, mime or response.headers.get("content-type", "application/octet-stream")
