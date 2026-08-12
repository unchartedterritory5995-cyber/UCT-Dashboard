"""Craft provider — the second LIVE connector (spec §7).

Craft's "Connect API" is a single per-space capability URL
(`https://connect.craft.do/links/{LINK_ID}/api/v1`) the user creates in
Craft's UI and pastes here, plus a Bearer key **shown once** at creation
time (Craft's own UI warns the user to copy it immediately) — we only ever
validate + store whatever the user pastes; there is no OAuth dance.

Four provider-specific behaviors this file exists to get right:

  1. **Capability-URL parsing/normalization** (`parse_capability_url`). The
     pasted URL is the credential's identity AND the base for every request
     this provider makes, so it is parsed/validated in exactly one place —
     tolerant of a trailing slash (or several) and surrounding whitespace,
     but strict about the host: anything that isn't `connect.craft.do` (or
     doesn't match the `/links/{id}/api/v1` shape at all) raises
     `NoteConnAuthError("that doesn't look like a Craft API URL")` — the
     exact sentence the connect-screen validation is required to show.
  2. **`validate()` fallback.** Craft's `GET /connection` is the documented
     way to confirm a capability URL + Bearer pair actually works, but not
     every space necessarily exposes it — a 404 there falls back to a
     `GET /documents?fetchMetadata=true` page probe (any 200 there is proof
     enough the credentials work, even with zero documents).
  3. **No documented pagination.** `GET /documents?fetchMetadata=true`
     returns the full document array in one call per Craft's docs — treated
     as complete. Defensively, if a future response ever carries a
     `nextCursor`-shaped field, `list_changed` follows it rather than
     silently truncating.
  4. **Self-imposed rate limiting.** Craft publishes no rate limit for this
     API, so every outbound call passes through an `AsyncRateLimiter`
     (the same token-bucket used by the broker sync's SnapTrade client) capped
     at 3 requests/second — a good citizen default, not a documented ceiling.

Document METADATA (title/folderId/dates) only comes back from the
`/documents` listing, never from `/blocks` (which returns markdown body
only) — so `list_changed` caches each listed document's metadata on the
instance (`self._doc_meta`), and `fetch()` reads it back by id. This mirrors
`RoamProvider`'s `self._title_to_uid` pattern: instance state whose lifetime
is exactly one `CraftProvider` object, which the sync engine constructs
fresh per sync (Task 8) and always calls `list_changed()` before `fetch()`
for the refs it yielded. `fetch()` defensively rebuilds the cache with a
fresh full listing if it's ever asked for an id it hasn't seen — never
raises just because of call order.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ...broker.rate_limit import AsyncRateLimiter
from ..convert import md_to_tiptap
from ..errors import (
    NoteConnAuthError,
    NoteConnRateLimited,
    NoteConnTransient,
)
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef

# Self-imposed politeness ceiling — Craft documents no rate limit for this
# API (spec §7).
_DEFAULT_RATE_PER_SEC = 3.0

# Incremental sync overlap window, per spec §7's
# "`lastModifiedDateGte={cursor-1h-overlap-ISO}`".
_OVERLAP_HOURS = 1.0

_CAPABILITY_URL_RE = re.compile(
    r"^https://connect\.craft\.do/links/(?P<link_id>[^/]+)/api/v1$"
)

_BAD_URL_MESSAGE = "that doesn't look like a Craft API URL"


def parse_capability_url(raw_url: str | None) -> tuple[str, str]:
    """Parses+normalizes a pasted Craft Connect API URL into
    `(base_url, link_id)`. `base_url` never carries a trailing slash, so
    every endpoint builder in this file can safely do
    `f"{base_url}/documents"` etc.

    Tolerant of surrounding whitespace and one-or-more trailing slashes.
    Strict about everything else: a wrong host, a missing `/api/v1` suffix,
    an http (not https) scheme, or empty/garbage input all raise
    `NoteConnAuthError` with the exact user-facing sentence the connect
    screen is required to show — this is the ONE place that message lives.
    """
    url = (raw_url or "").strip().rstrip("/")
    match = _CAPABILITY_URL_RE.match(url)
    if not match:
        raise NoteConnAuthError(_BAD_URL_MESSAGE)
    return url, match.group("link_id")


def _overlap_cursor(cursor: str, *, hours: float = _OVERLAP_HOURS) -> str:
    """`cursor` shifted `hours` earlier, ISO-8601. Malformed input is passed
    through unchanged rather than raising — a corrupt stored cursor should
    degrade to "re-list everything since a slightly-wrong point," never
    crash the sync."""
    try:
        dt = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
    except ValueError:
        return cursor
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt - timedelta(hours=hours)).isoformat()


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _extract_array(data: Any, key: str) -> list[dict[str, Any]]:
    """Craft's list endpoints could plausibly return either a bare JSON
    array or `{"<key>": [...]}`  — accept either shape rather than assuming
    one, degrading to `[]` on anything else (never raises)."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        val = data.get(key)
        if isinstance(val, list):
            return val
    return []


def _extract_next_cursor(data: Any) -> str | None:
    """Defensive-only (spec §7): Craft's `/documents` has no documented
    pagination, but if a future response ever carries a `nextCursor`-shaped
    field, follow it instead of silently truncating the listing."""
    if not isinstance(data, dict):
        return None
    for key in ("nextCursor", "next_cursor", "nextPageUrl", "next"):
        value = data.get(key)
        if value:
            return str(value)
    return None


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


class CraftProvider(NoteProvider):
    name = "craft"

    def __init__(
        self,
        *,
        client: httpx.AsyncClient | None = None,
        rate_limiter: AsyncRateLimiter | None = None,
    ) -> None:
        # Tests inject a `client` built on `httpx.MockTransport` (no live
        # calls) and/or a `rate_limiter` with an injectable clock/sleep so
        # rate-limit engagement is deterministically testable.
        self._client = client
        self._owns_client = client is None
        self._limiter = (
            rate_limiter if rate_limiter is not None
            else AsyncRateLimiter(_DEFAULT_RATE_PER_SEC)
        )
        # doc id -> the /documents listing row for it (title/folderId/dates)
        # and folderId -> folder name, both rebuilt on every `list_changed`
        # call (see module docstring). Instance state, not a module global.
        self._doc_meta: dict[str, dict[str, Any]] = {}
        self._folder_map: dict[str, str] = {}

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── credentials ──────────────────────────────────────────────────────

    @staticmethod
    def _creds(credentials: dict[str, Any]) -> tuple[str, str, str]:
        raw_url = credentials.get("capabilityUrl")
        bearer = credentials.get("bearer")
        if not raw_url or not bearer:
            raise NoteConnAuthError("Craft credentials missing capabilityUrl/bearer")
        base_url, link_id = parse_capability_url(raw_url)
        return base_url, link_id, bearer

    @staticmethod
    def _headers(bearer: str, *, accept: str = "application/json") -> dict[str, str]:
        return {"Authorization": f"Bearer {bearer}", "Accept": accept}

    # ── transport ────────────────────────────────────────────────────────

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def _get(
        self, url: str, *, headers: dict[str, str], params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        await self._limiter.acquire()
        client = await self._get_client()
        return await client.get(url, headers=headers, params=params)

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code == 200:
            return
        if response.status_code in (401, 403):
            raise NoteConnAuthError(
                f"Craft rejected the bearer token ({response.status_code})",
                status=response.status_code,
            )
        if response.status_code == 429:
            raise NoteConnRateLimited(
                "Craft rate limit exceeded",
                retry_after=_parse_retry_after(response.headers.get("retry-after")),
                status=429,
            )
        raise NoteConnTransient(
            f"Craft API error {response.status_code}", status=response.status_code,
        )

    async def _load_folders(self, base_url: str, headers: dict[str, str]) -> dict[str, str]:
        """`GET /folders` -> `{folderId: name}`. OPTIONAL support (spec §7:
        "folder names ... when available ... else flat") — ANY failure here
        (404, other status, network error) degrades to an empty map (flat
        structure) rather than failing the whole sync."""
        try:
            response = await self._get(f"{base_url}/folders", headers=headers)
        except httpx.HTTPError:
            return {}
        if response.status_code != 200:
            return {}
        folders = _extract_array(_safe_json(response), "folders")
        out: dict[str, str] = {}
        for folder in folders:
            folder_id = folder.get("id")
            name = folder.get("name")
            if folder_id and name:
                out[folder_id] = name
        return out

    # ── NoteProvider contract ───────────────────────────────────────────

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        base_url, link_id, bearer = self._creds(credentials)
        headers = self._headers(bearer)

        response = await self._get(f"{base_url}/connection", headers=headers)
        if response.status_code == 200:
            data = _safe_json(response) or {}
            label = data.get("name") or data.get("label") or f"Craft ({link_id})"
            return AccountInfo(label=label, raw=data)

        if response.status_code == 404:
            # `/connection` isn't supported by this space — fall back to a
            # documents page-1 probe (spec §7). Any 200 here (even zero
            # documents) is proof enough the credentials work.
            probe = await self._get(
                f"{base_url}/documents", headers=headers, params={"fetchMetadata": "true"},
            )
            if probe.status_code == 200:
                docs = _extract_array(_safe_json(probe), "documents")
                return AccountInfo(
                    label=f"Craft ({link_id})", raw={"document_count": len(docs)},
                )
            if probe.status_code == 404:
                raise NoteConnAuthError(
                    "Craft connection not found — check the pasted API URL",
                    status=404,
                )
            self._raise_for_status(probe)

        self._raise_for_status(response)
        raise AssertionError("unreachable")  # _raise_for_status always raises on non-200

    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        base_url, _link_id, bearer = self._creds(credentials)
        headers = self._headers(bearer)

        self._folder_map = await self._load_folders(base_url, headers)
        self._doc_meta = {}

        params: dict[str, Any] | None = {"fetchMetadata": "true"}
        if cursor:
            params["lastModifiedDateGte"] = _overlap_cursor(cursor)

        refs: list[RemoteRef] = []
        url: str | None = f"{base_url}/documents"
        while url:
            response = await self._get(url, headers=headers, params=params)
            self._raise_for_status(response)
            data = _safe_json(response) or {}
            for doc in _extract_array(data, "documents"):
                doc_id = doc.get("id")
                if not doc_id:
                    continue
                self._doc_meta[doc_id] = doc
                updated_at = doc.get("lastModifiedDate") or doc.get("createdDate") or ""
                refs.append(RemoteRef(remote_id=doc_id, updated_at=updated_at))
            url = _extract_next_cursor(data)
            params = None  # a followed cursor URL is assumed self-contained

        return refs

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        base_url, _link_id, bearer = self._creds(credentials)

        doc = self._doc_meta.get(ref.remote_id)
        if doc is None:
            # Defensive: `fetch()` called without a prior `list_changed()`
            # on this instance, or for an id that call didn't see — rebuild
            # the metadata cache from a fresh full listing rather than
            # silently emitting a titleless note.
            await self.list_changed(credentials)
            doc = self._doc_meta.get(ref.remote_id) or {}

        title = doc.get("title") or ref.remote_id
        folder_id = doc.get("folderId") or doc.get("folder_id")
        folder_name = self._folder_map.get(folder_id) if folder_id else None
        folder_path = [folder_name] if folder_name else []

        headers = self._headers(bearer, accept="text/markdown")
        response = await self._get(
            f"{base_url}/blocks", headers=headers, params={"id": ref.remote_id},
        )
        self._raise_for_status(response)
        converted = md_to_tiptap(response.text or "")

        return RemoteNote(
            remote_id=ref.remote_id,
            title=title,
            doc=converted["doc"],
            media=converted["media"],
            links=converted["links"],
            tags=[],
            folder_path=folder_path,
            created_at=doc.get("createdDate"),
            updated_at=doc.get("lastModifiedDate") or ref.updated_at,
        )

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        # `ref` is the Craft-hosted image URL mddoc registered verbatim
        # (`_image_node`'s non-data-uri path uses the src AS the ref) — the
        # same Bearer that authenticates the API also authorizes the asset.
        _base_url, _link_id, bearer = self._creds(credentials)
        response = await self._get(ref, headers={"Authorization": f"Bearer {bearer}"})
        if response.status_code >= 400:
            raise NoteConnTransient(
                f"Failed to download Craft media ({response.status_code})",
                status=response.status_code,
            )
        content_type = response.headers.get("content-type", "application/octet-stream")
        return response.content, content_type
