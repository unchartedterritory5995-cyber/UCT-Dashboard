"""Evernote live sync over Evernote's hosted MCP server (Plan E Task 5). Read-only.

Every Evernote call goes through `EvernoteMcpClient.call_tool`, whose first statement refuses any
tool outside `READ_TOOLS`. This provider calls five: `search_notes` (listing, trash),
`get_note` (one note's ENML), `search_notebooks` and `search_tags` (one call each per instance, for
folder and tag names) and `get_attachment` (a fresh pre-signed download URL per media fetch).

Measured facts (`docs/notebook-connectors/evernote-mcp-probe.md`, "Measured field names"): the
provider reads ONLY the measured `get_note` keys (`_NOTE_KEYS`). A measured key missing from a
payload is drift: the field reads as absent and the note carries
`evernote note shape: missing <key>` once per key per instance (`drain_item_failures`). No other
name is ever tried. `resources` is `null` on a note without attachments; it reaches
`enml.enml_to_tiptap` as measured, whose one guard reads `null` as `[]`. `search_notebooks`/`search_tags` cannot page (no `startIndex`,
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

import asyncio
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
#: An Evernote GUID's own shape (8-4-4-4-12 hex): "looks like an id" for a tag string (m2).
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
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
    #: `fetch` is one `get_note` plus the instance's notebook and tag maps, which it loads itself:
    #: nothing a listing call filled. The engine may retry pending media on unlisted notes.
    fetch_is_listing_independent = True
    #: A resource's kind comes from its declared MIME; content wins for a raster (concern 5).
    promote_raster_files = True
    #: Evernote's per-minute tool limit leaves notes unread on a large first import: the engine
    #: follows up a few minutes later instead of waiting for the hourly tick (live gate 2026-11-03).
    follow_up_on_rate_limit = True

    PAGE_SIZE = 100
    # NEW-2a (slot scheduling fix round 2): 30 minutes, was 120 s. Evernote's search index can
    # lag an edit by longer than two minutes (measured on the owner's account 2026-11-03: a
    # listed note still carried its old updatedAt), and an edit landing inside the overlap of a
    # cursor that moved past it was simply never listed again. The cost is a re-listing (and,
    # since the D1 rule of the same round, a refetch) of the notes edited in the last 30 minutes
    # on each incremental pass: a handful of `get_note` calls, which `import_confirm`'s hash
    # check turns into no-op writes. A lag longer than this is caught by the nightly revision
    # sweep (`engine.NIGHTLY_REVISION_SWEEP_MAX`): at most a day late, never lost.
    CURSOR_OVERLAP_S = 1800
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
        # Fix round 1 (D1): the `updatedAt` each listed note carried, only when it had one (a hit
        # listed by `createdAt` or the floor has no real revision and is always fetched).
        self._listing_revs: dict[str, str] = {}
        self._pace_seed: float | None = None  # D3
        self._failures: list[dict] = []
        self._recorded: dict[str, dict] = {}
        self._tags_capped = False
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
            if self._pace_seed is not None and hasattr(self._mcp, "seed_interval"):
                self._mcp.seed_interval(self._pace_seed)
        return self._mcp

    def seed_pacing(self, interval_s: float) -> None:
        """D3: the engine's learned interval for this session, applied when the client is made."""
        self._pace_seed = interval_s
        if self._mcp is not None and hasattr(self._mcp, "seed_interval"):
            self._mcp.seed_interval(interval_s)

    def learned_pacing(self) -> tuple[float | None, bool]:
        """D3: (the session's adaptive interval or None, whether a rate limit tripped)."""
        if self._mcp is None or not hasattr(self._mcp, "learned_interval"):
            return None, False
        return self._mcp.learned_interval()

    def listing_revision(self, ref: RemoteRef) -> str | None:
        """D1: the listing's `updatedAt` for this note (normalised by `_iso`), or None when the
        hit had none. The SAME Evernote field as `get_note.updated`, which `fetch` stores as the
        note's revision; the engine compares the two at whole seconds (`engine._same_revision`)."""
        return self._listing_revs.get(ref.remote_id)

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
        """One row per reason per instance; a repeat names how many more notes it covers (m5)."""
        entry = self._recorded.get(reason)
        if entry is not None:
            entry["more"] += 1
            entry["row"]["noteTitle"] = f"{entry['first']} (and {entry['more']} more)"
            return
        row = {"noteTitle": title, "reason": reason, "name": None}
        self._recorded[reason] = {"first": title, "more": 0, "row": row}
        self._failures.append(row)

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
        # Fix round 2 (N2): each listing has its own clock allowance in the client, sized by its
        # page count once page 0 says how many results there are, and closed when it ends.
        begin = getattr(client, "begin_listing", None)
        end = getattr(client, "end_listing", None)
        if begin is not None:
            begin()
        try:
            async for item in self._paged(client, query):
                yield item
        finally:
            if end is not None:
                end()

    async def _paged(self, client: Any, query: str):
        start = 0
        first_total: Any = None
        for _ in range(_MAX_PAGES):
            page = await client.call_tool("search_notes", {
                "query": query, "sortBy": "updated", "ascending": False,
                "maxResults": self.PAGE_SIZE, "startIndex": start})
            if start == 0:
                first_total = page.get("totalResultCount")
                size = getattr(client, "size_listing", None)
                if (size is not None and isinstance(first_total, (int, float))
                        and not isinstance(first_total, bool)):
                    # NEW-3: the server's count is clamped to what this pager will ever read.
                    size(min(_MAX_PAGES, max(1, -(-int(first_total) // self.PAGE_SIZE))))
            elif page.get("totalResultCount") != first_total:
                raise _ListingMoved()
            hits = []
            for h in page.get("hits") or []:
                if not isinstance(h, dict) or not h.get("noteId"):
                    continue
                if not enml.is_guid(h["noteId"]):
                    # m1: a non-GUID id would become an import key `fetch` refuses every pass.
                    title = h.get("title") if isinstance(h.get("title"), str) else "Untitled"
                    self._record(title, "evernote note shape: note id")
                    continue
                hits.append(h)
            yield hits, page
            if page.get("isLastPage") or not hits:
                return
            start += self.PAGE_SIZE
        raise errors.NoteConnTransient("evernote: note listing did not end")

    def _ref(self, hit: dict, floor: str) -> RemoteRef:
        note_id = hit["noteId"]
        if isinstance(hit.get("title"), str):
            self._hit_titles[note_id] = hit["title"]
        updated = _iso(hit.get("updatedAt"))
        if updated is not None:
            self._listing_revs[note_id] = updated
        else:
            self._listing_revs.pop(note_id, None)
        when = updated or _iso(hit.get("createdAt")) or floor
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
        cursor_at = import_provenance.instant(cursor) if cursor else None
        # m3: an unparseable cursor is no cursor: enumerate everything, at the epoch floor (a
        # garbage floor would survive the engine's string max as the cursor forever).
        floor = cursor if cursor_at is not None else EPOCH_FLOOR
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
                self._tags_capped = True
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
                tag_map = await self._tag_map(creds)
                if el in tag_map:
                    label = tag_map[el]
                elif self._tags_capped and _UUID_RE.match(el):
                    # m2: the map is partial; a GUID-shaped string is an id we could not resolve,
                    # never a label to show.
                    self._record(title, f"evernote tag not listed: {el}")
                else:
                    label = el
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
        # Task 9 fix round 1 (concern 6): passed through as measured (`null` on a note with no
        # attachments); the converter holds the ONE null-resources guard.
        resources = self._note_field(sc, "resources", title)
        attributes = self._note_field(sc, "attributes", title)
        # Final review I1(b): the converter is pure and a large web clip takes seconds, so it runs in
        # a worker thread, never on the event loop (the first sync and every "Sync now" run there).
        converted = await asyncio.to_thread(
            enml.enml_to_tiptap, content if isinstance(content, str) else "", resources,
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
