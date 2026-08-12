"""Notion provider — built COMPLETE but DARK (spec §7). Activates via env
(`NOTION_CLIENT_ID`/`NOTION_CLIENT_SECRET`, consumed by `..oauth`, NOT by
this module — see below) when the owner registers the free integration.

This module needs NO env vars of its own and reads none: importing it, or
constructing `NotionProvider()` with zero arguments, never raises — the
OAuth *app* credentials (client id/secret) belong entirely to `..oauth`
(consumed at connect/refresh time, before this provider is ever
constructed); this provider only ever sees an already-decrypted, already-
valid-shaped user credentials dict (`{"accessToken": ...}`) handed to it by
the sync engine via `connections.get_token`. That split is what makes
"dark until configured" true at EVERY layer: no env check anywhere in this
file gates anything, because there is nothing here TO gate.

⚠️ CREDENTIAL-BOUNDARY (named critical risk — both other live providers had
this bug class):
  - The Notion bearer token (`Authorization: Bearer <accessToken>`) is sent
    to `api.notion.com` ONLY — every `_request()` call, never anywhere else.
  - Notion media (image/video/file/pdf blocks) is a pre-signed S3 url when
    `type == "file"` (expires ~1h) or an arbitrary permanent url when
    `type == "external"`. NEITHER ever receives the Notion bearer —
    `_get_media_bytes`/`fetch_media` are always a plain, unauthenticated
    GET. The `file`-type url is downloaded DURING TRAVERSAL (not deferred
    to the engine's later upload pass, which could easily run past the 1h
    window on a large sync) and embedded as a `data_uri` media entry —
    `note_connectors/engine.py::_upload_media_for_note` already decodes a
    `data_uri` entry directly with NO `provider.fetch_media` call at all,
    so there is no code path where a "fetch this file-type url again
    later" call could even exist. `external`-type media is deferred to
    `fetch_media()` normally (it doesn't expire, so there's no reason not
    to let the engine's usual upload pass handle it) — `fetch_media()`
    still never attaches any auth header, matching the S3 case.
  - A 403 on the immediate `file`-type download (the url expired mid-
    traversal, e.g. a very slow multi-page sync) triggers exactly ONE
    re-fetch of the owning block (a NORMAL, Bearer-authenticated Notion API
    call — `GET /v1/blocks/{id}` is api.notion.com, not media) for a fresh
    url, then one retry of the SAME unauthenticated download. No further
    retries.

Notion-Version pinned on every request (`..oauth.NOTION_VERSION` — one
constant, imported rather than redefined, since `..oauth` already has to
know it for the token endpoint).

`fetch_many` is overridden (not the default per-ref loop) so ONE
`NotionBlockConverter` is shared across a whole batch — giving the
converter's synced_block cache real cross-page value within a batch — and
so per-page database overflow rows (>50-row `child_database` -> per-row
pages) can be appended as EXTRA `RemoteNote`s alongside the page that
embedded them. `fetch()` (the engine's per-ref fallback when a WHOLE batch
raises) necessarily returns only the primary page's own note — any overflow
row-pages discovered during that single conversion are silently dropped in
THAT fallback path only; documented, not fixed here (see the module-level
`_KNOWN_LIMITATIONS` note).

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §7.
"""

from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ..oauth import NOTION_VERSION
from ..convert import notion_blocks
from ..errors import (
    NoteConnAuthError,
    NoteConnError,
    NoteConnRateLimited,
    NoteConnTransient,
)
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef

# The SAME byte limits notes.py's own persistence layer enforces on decoded
# media bytes (`save_note_image_bytes`/`save_note_attachment_bytes`) —
# imported, never retyped, so nothing that clears the guard below can later
# fail that stricter, downstream check.
from ...notes import _MAX_FILE_BYTES, _MAX_IMAGE_BYTES

_API_BASE = "https://api.notion.com/v1"

# Self-imposed politeness ceiling (spec §7: "self-imposed 3 rps token bucket").
_DEFAULT_RATE_PER_SEC = 3.0

# Incremental sync overlap — spec §7: "stop when older than cursor−2min
# (minute rounding!)".
_OVERLAP_MINUTES = 2

_MAX_SEARCH_PAGES = 100      # bounds POST /v1/search pagination
_MAX_CHILDREN_PAGES = 100    # bounds GET /v1/blocks/{id}/children pagination
_MAX_DATA_SOURCE_PAGES = 100  # bounds POST /v1/data_sources/{id}/query pagination

# 429/529 retry ladder: honor the provider's own Retry-After when present,
# else this default; bounded so a misbehaving server can't stall a sync
# forever.
_MAX_RATE_RETRIES = 3
_DEFAULT_RETRY_DELAY = 1.0


class _MediaTooLarge(Exception):
    """Internal-only signal: a `file`-type (pre-signed S3) media download hit
    the size cap (Content-Length pre-check or the cumulative streamed byte
    count) before finishing. Caught in `_resolve_media`, turned into a named
    `too_large` result — never lets a giant file get fully buffered +
    base64-embedded into a note's TipTap doc, which would otherwise blow
    past `notes_svc.MAX_BODY_JSON_BYTES` (1MB) during `import_confirm` well
    after the (wasted) download+encode work was already done."""


# NOTE (known, deliberate limitation): a `child_database` with >50 rows
# spawns extra per-row `RemoteNote`s (see notion_blocks.py's
# `convert_row_page`) that only `fetch_many`'s batch path can surface — the
# abstract `fetch()` signature returns exactly one `RemoteNote`, so the
# engine's per-ref fallback (only exercised when a WHOLE `fetch_many` batch
# raises) returns just the primary page for that ref; that batch's overflow
# rows are lost in that fallback case only. Acceptable: the primary page's
# own content and the fallback's error-isolation guarantee are unaffected,
# and the common path (`fetch_many` succeeding) is unaffected entirely.


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _round_to_minute(iso_str: str | None) -> str:
    """Notion timestamps minute-rounded, per spec §7. Returns `""` (never
    raises) for unparseable/empty input — callers treat that as "no usable
    timestamp" rather than crashing a sync over one bad value."""
    dt = _parse_iso(iso_str)
    if dt is None:
        return ""
    return dt.replace(second=0, microsecond=0).isoformat()


def _shift_minutes(iso_str: str, minutes: int) -> str:
    dt = _parse_iso(iso_str)
    if dt is None:
        return iso_str
    return (dt + timedelta(minutes=minutes)).isoformat()


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


class NotionProvider(NoteProvider):
    name = "notion"

    def __init__(
        self, *, client: httpx.AsyncClient | None = None,
        rate_limiter: Any | None = None, sleep_fn: Any | None = None,
    ) -> None:
        # Tests inject a `client` on `httpx.MockTransport` (no live calls),
        # a rate limiter with an injectable clock (proving throttling
        # actually engages, per the Craft precedent), and a `sleep_fn` that
        # returns instantly instead of really sleeping through a 429/529
        # retry.
        self._client = client
        self._owns_client = client is None
        if rate_limiter is None:
            from ...broker.rate_limit import AsyncRateLimiter
            rate_limiter = AsyncRateLimiter(_DEFAULT_RATE_PER_SEC)
        self._limiter = rate_limiter
        self._sleep = sleep_fn if sleep_fn is not None else asyncio.sleep
        # page id -> the /search result row for it (title/timestamps) —
        # populated by list_changed()/list_deleted(), consumed by fetch() so
        # a plain page-metadata GET isn't needed for every fetched ref.
        # Instance state, lifetime = one provider instance (mirrors
        # RoamProvider._title_to_uid / CraftProvider._doc_meta).
        self._page_meta: dict[str, dict[str, Any]] = {}

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    def import_key(self, source_remote_id: str, remote_id: str) -> str:
        # Flat `notion:{page_id}` — no source component (base.py's
        # documented exception; a Notion page id is already globally
        # unique, unlike Roam's uid-scoped-to-a-graph).
        return f"notion:{remote_id}"

    # ── credentials ──────────────────────────────────────────────────────

    @staticmethod
    def _creds(credentials: dict[str, Any]) -> str:
        token = credentials.get("accessToken")
        if not token:
            raise NoteConnAuthError("Notion credentials missing accessToken")
        return token

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }

    # ── transport ────────────────────────────────────────────────────────

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def _request(
        self, method: str, path: str, token: str, *,
        json_body: dict[str, Any] | None = None, params: dict[str, Any] | None = None,
    ) -> Any:
        """Central call point for every `api.notion.com` request: rate-
        limited (self-imposed 3 rps), retries 429/529 honoring
        Retry-After, and is the ONE chokepoint that wraps raw
        httpx/JSON-decode failures into the errors taxonomy."""
        client = await self._get_client()
        url = f"{_API_BASE}{path}"
        attempt = 0
        while True:
            await self._limiter.acquire()
            try:
                response = await client.request(
                    method, url, headers=self._headers(token), json=json_body, params=params,
                )
            except httpx.RequestError as exc:
                raise NoteConnTransient(f"Notion request failed: {exc}") from exc

            if response.status_code == 200:
                try:
                    return response.json()
                except json.JSONDecodeError as exc:
                    snippet = (response.text or "")[:200]
                    raise NoteConnTransient(
                        f"Notion returned invalid JSON: {exc}. Body snippet: {snippet!r}",
                    ) from exc
            if response.status_code in (401, 403):
                raise NoteConnAuthError(
                    f"Notion rejected the access token ({response.status_code})",
                    status=response.status_code,
                )
            if response.status_code in (429, 529):
                if attempt < _MAX_RATE_RETRIES:
                    delay = _parse_retry_after(response.headers.get("retry-after")) or _DEFAULT_RETRY_DELAY
                    await self._sleep(delay)
                    attempt += 1
                    continue
                raise NoteConnRateLimited(
                    f"Notion rate limited ({response.status_code}) — retries exhausted",
                    retry_after=_parse_retry_after(response.headers.get("retry-after")),
                    status=response.status_code,
                )
            raise NoteConnTransient(f"Notion API error {response.status_code}", status=response.status_code)

    # ── NoteProvider contract ───────────────────────────────────────────

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        token = self._creds(credentials)
        data = await self._request("GET", "/users/me", token)
        label = credentials.get("workspaceName") or data.get("name") or "Notion"
        return AccountInfo(label=label, raw={"bot_id": data.get("id")})

    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        token = self._creds(credentials)
        threshold = _shift_minutes(_round_to_minute(cursor), -_OVERLAP_MINUTES) if cursor else None
        self._page_meta = {}
        refs: list[RemoteRef] = []
        start_cursor: str | None = None
        for _ in range(_MAX_SEARCH_PAGES):
            body: dict[str, Any] = {
                "filter": {"property": "object", "value": "page"},
                "sort": {"direction": "descending", "timestamp": "last_edited_time"},
                "page_size": 100,
            }
            if start_cursor:
                body["start_cursor"] = start_cursor
            data = await self._request("POST", "/search", token, json_body=body)

            stop = False
            for page in data.get("results") or []:
                if page.get("object") != "page" or page.get("in_trash"):
                    continue
                updated_at = _round_to_minute(page.get("last_edited_time"))
                if not updated_at:
                    continue
                # Sorted descending -> the first ref older than the
                # threshold means every remaining result is even older;
                # stop paginating rather than scanning the whole workspace.
                if threshold is not None and updated_at < threshold:
                    stop = True
                    break
                self._page_meta[page["id"]] = page
                refs.append(RemoteRef(remote_id=page["id"], updated_at=updated_at))

            if stop or not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")
            if not start_cursor:
                break
        else:
            # The loop ran out of iterations WITHOUT ever hitting a `break`
            # above (an early `stop`, or `has_more` finally false) — i.e.
            # `has_more` was STILL true after `_MAX_SEARCH_PAGES` pages. A
            # workspace this large silently losing its oldest pages on the
            # FIRST sync (while reporting success) is the house silent-
            # truncation bug class (see providers/craft.py's precedent) —
            # loud and named beats quiet and wrong.
            raise NoteConnTransient(
                f"Notion search (list_changed) exceeded {_MAX_SEARCH_PAGES} pages "
                f"without finishing ({len(refs)} pages collected so far) -- "
                "aborting rather than silently truncating the sync",
            )
        return refs

    async def list_deleted(self, credentials: dict[str, Any]) -> list[RemoteRef]:
        """Pages currently in Notion's trash, via search's own `in_trash`
        flag — spec §7: "in_trash sweep (search filter) — expose via
        list_deleted() for the engine's full pass." NOT part of the
        `NoteProvider` ABC, but — Task 11 fix-round-1 Important #1c — IS
        NOW CALLED from `note_connectors/engine.py`'s `_do_sync`, on every
        FULL sync (`getattr(provider, "list_deleted", None)`, then fed into
        `_run_delete_detection(..., deleted_refs=...)` as a CERTAIN
        deletion signal). Do not treat this as inert or "forward-looking" —
        a bug here can sever a live note ahead of the generic 2-strike
        miss-streak detector (bounded by `_run_delete_detection`'s own
        20%-of-tracked-items cap, refused-with-warning above that, same
        shape as its <50% full-enumeration refuse guard)."""
        token = self._creds(credentials)
        refs: list[RemoteRef] = []
        start_cursor: str | None = None
        for _ in range(_MAX_SEARCH_PAGES):
            body: dict[str, Any] = {
                "filter": {"property": "object", "value": "page"},
                "page_size": 100,
            }
            if start_cursor:
                body["start_cursor"] = start_cursor
            data = await self._request("POST", "/search", token, json_body=body)
            for page in data.get("results") or []:
                if page.get("object") == "page" and page.get("in_trash"):
                    refs.append(RemoteRef(
                        remote_id=page["id"], updated_at=_round_to_minute(page.get("last_edited_time")),
                    ))
            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")
            if not start_cursor:
                break
        else:
            raise NoteConnTransient(
                f"Notion search (list_deleted) exceeded {_MAX_SEARCH_PAGES} pages "
                f"without finishing ({len(refs)} trashed pages collected so far) -- "
                "aborting rather than silently truncating the trash sweep",
            )
        return refs

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        note, _extra = await self._fetch_one(credentials, ref)
        return note

    async def fetch_many(
        self, credentials: dict[str, Any], refs: list[RemoteRef],
    ) -> list[RemoteNote]:
        """Overrides the default per-ref loop: ONE `NotionBlockConverter`
        (and its synced_block cache) is shared across the whole batch, and
        per-page database overflow (>50-row child_database -> per-row
        pages) is appended as EXTRA `RemoteNote`s after the page that
        embedded it — see the module docstring."""
        if not refs:
            return []
        token = self._creds(credentials)
        converter = self._build_converter(token)
        notes: list[RemoteNote] = []
        for ref in refs:
            note, extra = await self._convert_page(converter, token, ref)
            notes.append(note)
            notes.extend(self._extra_to_remote_notes(extra))
        return notes

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        # `ref` here is an `external`-type media url (a permanent, arbitrary
        # host) registered by `_resolve_media` below — the Notion bearer is
        # NEVER attached to it (credential-boundary rule). Plain,
        # unauthenticated GET, exactly like the S3 download path.
        client = await self._get_client()
        try:
            response = await client.get(ref)
        except httpx.RequestError as exc:
            raise NoteConnTransient(f"Failed to download Notion media: {exc}") from exc
        if response.status_code >= 400:
            raise NoteConnTransient(
                f"Failed to download Notion media ({response.status_code})", status=response.status_code,
            )
        content_type = response.headers.get("content-type", "application/octet-stream")
        return response.content, content_type

    # ── page/block fetch helpers ─────────────────────────────────────────

    def _build_converter(self, token: str) -> notion_blocks.NotionBlockConverter:
        async def fetch_children(block_id: str) -> list[dict[str, Any]]:
            return await self._fetch_children(block_id, token)

        async def query_database(database_id: str) -> list[dict[str, Any]]:
            return await self._query_database(database_id, token)

        async def resolve_media(block: dict[str, Any]) -> dict[str, Any] | None:
            return await self._resolve_media(block, token)

        return notion_blocks.NotionBlockConverter(
            fetch_children=fetch_children, query_database=query_database, resolve_media=resolve_media,
        )

    async def _fetch_one(
        self, credentials: dict[str, Any], ref: RemoteRef,
    ) -> tuple[RemoteNote, list[dict[str, Any]]]:
        token = self._creds(credentials)
        converter = self._build_converter(token)
        return await self._convert_page(converter, token, ref)

    async def _convert_page(
        self, converter: notion_blocks.NotionBlockConverter, token: str, ref: RemoteRef,
    ) -> tuple[RemoteNote, list[dict[str, Any]]]:
        page_id = ref.remote_id
        meta = self._page_meta.get(page_id)
        if meta is None:
            meta = await self._request("GET", f"/pages/{page_id}", token)
        title = notion_blocks.extract_title(meta)
        children = await self._fetch_children(page_id, token)
        result = await converter.convert(children)
        note = RemoteNote(
            remote_id=page_id, title=title, doc=result["doc"], media=result["media"],
            links=result["links"], tags=[], folder_path=[],
            created_at=_round_to_minute(meta.get("created_time")) or None,
            updated_at=ref.updated_at,
        )
        return note, result["extra_pages"]

    def _extra_to_remote_notes(self, extra: list[dict[str, Any]]) -> list[RemoteNote]:
        return [
            RemoteNote(
                remote_id=item["remote_id"], title=item["title"], doc=item["doc"],
                media=item["media"], links=item["links"], tags=[], folder_path=[],
                created_at=_round_to_minute(item.get("created_at")) or None,
                updated_at=_round_to_minute(item.get("updated_at")) or None,
            )
            for item in extra
        ]

    async def _fetch_children(self, block_id: str, token: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        start_cursor: str | None = None
        for _ in range(_MAX_CHILDREN_PAGES):
            params: dict[str, Any] = {"page_size": 100}
            if start_cursor:
                params["start_cursor"] = start_cursor
            data = await self._request("GET", f"/blocks/{block_id}/children", token, params=params)
            out.extend(data.get("results") or [])
            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")
            if not start_cursor:
                break
        else:
            raise NoteConnTransient(
                f"Notion block children ({block_id}) pagination exceeded "
                f"{_MAX_CHILDREN_PAGES} pages without finishing ({len(out)} "
                "blocks collected so far) -- aborting rather than silently "
                "truncating the page",
            )
        return out

    async def _get_block(self, block_id: str, token: str) -> dict[str, Any] | None:
        try:
            return await self._request("GET", f"/blocks/{block_id}", token)
        except NoteConnError:
            return None

    async def _query_database(self, database_id: str, token: str) -> list[dict[str, Any]]:
        db = await self._request("GET", f"/databases/{database_id}", token)
        rows: list[dict[str, Any]] = []
        for ds in db.get("data_sources") or []:
            ds_id = ds.get("id")
            if ds_id:
                rows.extend(await self._query_data_source(ds_id, token))
        return rows

    async def _query_data_source(self, data_source_id: str, token: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start_cursor: str | None = None
        for _ in range(_MAX_DATA_SOURCE_PAGES):
            body: dict[str, Any] = {"page_size": 100}
            if start_cursor:
                body["start_cursor"] = start_cursor
            data = await self._request("POST", f"/data_sources/{data_source_id}/query", token, json_body=body)
            rows.extend(data.get("results") or [])
            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")
            if not start_cursor:
                break
        else:
            raise NoteConnTransient(
                f"Notion data_source query ({data_source_id}) pagination exceeded "
                f"{_MAX_DATA_SOURCE_PAGES} pages without finishing ({len(rows)} "
                "rows collected so far) -- aborting rather than silently truncating",
            )
        return rows

    # ── media (credential-boundary critical path — see module docstring) ──

    async def _resolve_media(self, block: dict[str, Any], token: str) -> dict[str, Any] | None:
        info = notion_blocks.extract_media_info(block)
        if info is None:
            return None
        url, is_external, name = info
        kind = "image" if block.get("type") == "image" else "file"

        if is_external:
            # Permanent url, no expiry -> defer to fetch_media() at the
            # engine's normal upload-pass time (no reason to double-fetch).
            # notes_svc's OWN size check already guards that later path
            # (save_note_image_bytes/save_note_attachment_bytes) — no
            # separate cap needed here for content we never download now.
            return {"ref": url, "kind": kind, "name": name}

        cap = _MAX_IMAGE_BYTES if kind == "image" else _MAX_FILE_BYTES
        try:
            data, content_type = await self._download_internal(block, url, token, cap=cap)
        except _MediaTooLarge:
            return {"too_large": True, "name": name}
        if data is None:
            return None
        ref = f"notion:{block.get('id')}"
        b64 = base64.b64encode(data).decode("ascii")
        return {"ref": ref, "kind": kind, "name": name, "data_uri": f"data:{content_type};base64,{b64}"}

    async def _download_internal(
        self, block: dict[str, Any], url: str, token: str, *, cap: int,
    ) -> tuple[bytes | None, str]:
        data, content_type, status = await self._get_media_bytes(url, cap=cap)
        if status == 403:
            # Pre-signed url expired mid-traversal — refetch the BLOCK
            # (a normal, authenticated api.notion.com call) for a fresh
            # one, retry the unauthenticated media GET exactly once more.
            fresh_block = await self._get_block(block.get("id"), token)
            info2 = notion_blocks.extract_media_info(fresh_block) if fresh_block else None
            if info2 is not None and not info2[1]:
                data, content_type, status = await self._get_media_bytes(info2[0], cap=cap)
        if data is None or (status is not None and status >= 400):
            return None, ""
        return data, content_type

    async def _get_media_bytes(
        self, url: str, *, cap: int,
    ) -> tuple[bytes | None, str, int | None]:
        """Streamed GET, NEVER Authorization-headed (credential-boundary
        rule). `cap` is the SAME raw-byte limit notes.py's own persistence
        layer will enforce on the decoded bytes (`_MAX_IMAGE_BYTES`/
        `_MAX_FILE_BYTES`, imported not retyped) — checked TWICE:

          1. Against `Content-Length` (when the server sends one) BEFORE any
             body bytes are read at all.
          2. Against the CUMULATIVE streamed byte count on every chunk, so a
             server that lies about (or omits) Content-Length can still only
             overshoot the cap by about one chunk's worth before this aborts
             the read — no need for a separate numeric margin constant.

        Raises `_MediaTooLarge` (never returns a partial/oversized buffer)
        on either trip. base64-encoding the survivors afterward inflates
        the EMBEDDED size further (~4/3) — which is exactly why the cap
        enforced here is the raw persistence limit itself, not a looser
        one: this module embeds the base64 form directly into the note's
        TipTap doc during traversal, well before `import_confirm`'s own
        whole-doc size gate would ever get a chance to catch an oversized
        result."""
        client = await self._get_client()
        try:
            async with client.stream("GET", url) as response:
                if response.status_code >= 400:
                    return None, "", response.status_code
                content_length = response.headers.get("content-length")
                if content_length is not None:
                    try:
                        if int(content_length) > cap:
                            raise _MediaTooLarge()
                    except ValueError:
                        pass  # unparseable header -> fall through to the streamed check
                content_type = response.headers.get("content-type", "application/octet-stream")
                total = 0
                chunks: list[bytes] = []
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > cap:
                        raise _MediaTooLarge()
                    chunks.append(chunk)
                return b"".join(chunks), content_type, response.status_code
        except httpx.RequestError:
            return None, "", None
