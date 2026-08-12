"""Shared Microsoft Graph HTTP client — the transport half both `onedrive.py`
and (a later task's) `onenote.py` build on, mirroring `notion.py`'s `_request`
single-chokepoint precedent (spec `2026-08-12-note-connectors-msgraph-design.md`
§4/§5/§15).

This module reads NO env vars and needs none: it only ever sees an
already-decrypted, already-valid-shaped credentials dict
(`{"accessToken": ...}`) handed to it by a provider, which in turn got it from
`connections.get_token` via the sync engine — same "dark until configured at
the OAuth layer" split `notion.py`'s own docstring describes (the app-level
`MSGRAPH_CLIENT_ID`/`MSGRAPH_CLIENT_SECRET` gate lives entirely in `oauth.py`,
consumed at connect/refresh time, never here). Importing this module, or
constructing `MSGraphClient()` with zero arguments, never raises and never
builds an `httpx.AsyncClient` — the client is created lazily on first use
(`get_client()`), matching every other provider's `_owns_client` idiom.

⚠️ CREDENTIAL BOUNDARY (named critical risk class — both wave-1 live
providers had this bug): `send()` is the ONLY place this module ever attaches
`Authorization: Bearer <accessToken>`, and it refuses to do so anywhere except
`graph.microsoft.com` — resolving `path_or_url` to a full URL first (joining a
bare path onto `GRAPH_API_BASE`, or using an already-absolute Graph-issued
URL such as a delta `@odata.nextLink`/`@odata.deltaLink` verbatim) and
asserting the resolved host before ever building the header. A caller that
somehow constructed a non-Graph URL gets a loud `NoteConnUnsupported` refusal
here rather than a silent token leak — this should never trip in practice
(every URL this module is ever asked to fetch is either built from
`GRAPH_API_BASE` by a provider or handed back by Graph itself), but the guard
is cheap and turns "impossible" into "impossible AND enforced." Content
reached via a redirect off a Graph endpoint (OneDrive's `/content` 302) is
NEVER re-requested through this client — providers fetch that hop themselves,
unauthenticated, via `providers.base.guarded_media_get` (SSRF-guarded, no
Authorization header at all). Nothing in this module ever logs a token.

429 handling (spec §10): a self-imposed, bounded retry ladder — honor the
provider's own `Retry-After` header when present, else a jittered exponential
backoff (`_jittered_backoff_seconds`, "full jitter" — a uniform random draw
in `[0, capped_exponential]`, the strategy AWS's architecture blog recommends
over a fixed exponential specifically so many callers retrying after a shared
429 don't all retry in lockstep). Retries are injectable end-to-end for tests:
`sleep_fn` replaces `asyncio.sleep` (never a real sleep in a test), `rng`
replaces `random.random` (a fixed `rng` makes the backoff delay deterministic
and assertable). Retries exhausted -> `send()` returns the final 429 response
rather than raising itself, so a caller with its own error-shape needs (e.g.
OneDrive's 410-vs-everything-else split) can inspect the status before
falling through to the shared `raise_for_status()` classifier below.

No other status is retried here — a 401/403/404/410/5xx is returned as-is;
callers use `raise_for_status()` (or, for OneDrive's 410, their own
recovery path) to turn it into the shared `errors` taxonomy.
"""

from __future__ import annotations

import asyncio
import os
import random
from typing import Any

import httpx

from .. import errors
from .base import AccountInfo

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_HOST = "graph.microsoft.com"

_RATE_LIMIT_MAX_RETRIES = 4
_BACKOFF_BASE_SECONDS = 1.0
_BACKOFF_MAX_SECONDS = 20.0
_DEFAULT_HTTP_TIMEOUT_SECONDS = 30.0


def _http_timeout_seconds() -> float:
    """Read live (never cached at import) — `MSGRAPH_HTTP_TIMEOUT_SECONDS`,
    default 30, per spec §13. An unparseable override falls back to the
    default rather than raising -- a malformed env var must never crash
    client construction."""
    raw = os.environ.get("MSGRAPH_HTTP_TIMEOUT_SECONDS")
    if not raw:
        return _DEFAULT_HTTP_TIMEOUT_SECONDS
    try:
        return float(raw)
    except ValueError:
        return _DEFAULT_HTTP_TIMEOUT_SECONDS


def _bearer_token(credentials: dict[str, Any]) -> str:
    token = credentials.get("accessToken")
    if not token:
        raise errors.NoteConnAuthError("Microsoft Graph credentials missing accessToken")
    return token


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _graph_error_field(response: httpx.Response, field: str) -> str | None:
    body = _safe_json(response) or {}
    err = body.get("error")
    if isinstance(err, dict):
        val = err.get(field)
        return str(val) if val is not None else None
    return None


def _retry_after_seconds(response: httpx.Response) -> float | None:
    header_val = response.headers.get("retry-after")
    if not header_val:
        return None
    try:
        return max(0.0, float(header_val))
    except ValueError:
        return None


def _jittered_backoff_seconds(attempt: int, rng: Any) -> float:
    """"Full jitter" exponential backoff: a uniform draw in
    `[0, min(cap, base * 2**attempt)]`. `rng` is a zero-arg callable
    returning a float in `[0, 1)` (default `random.random`; tests inject a
    fixed value for a deterministic, assertable delay)."""
    capped = min(_BACKOFF_MAX_SECONDS, _BACKOFF_BASE_SECONDS * (2 ** attempt))
    return rng() * capped


def raise_for_status(response: httpx.Response) -> None:
    """Shared error classification for any non-2xx Microsoft Graph response a
    caller hasn't already special-cased (OneDrive's delta drain handles `410
    Gone` itself, before this is ever reached — see `onedrive.py::_drain`).
    Never call this for a 2xx response.

    401/403 -> `NoteConnAuthError`, or its `NoteConnTokenExpired` subclass
    when the Graph error body's own `code`/`message` mentions "expired"
    (Graph's `InvalidAuthenticationToken` error commonly does) — mirrors
    `dropbox.py::_raise_generic_error`'s identical tag-sniffing shape.
    429 here means retries were already exhausted inside `MSGraphClient.send`
    (a 429 mid-retry never reaches a caller at all). Everything else
    (404/410-if-a-caller-forwards-it/5xx/other) is `NoteConnTransient` —
    safe to retry at the sync-engine level on the next tick.
    """
    if response.status_code in (401, 403):
        message = (_graph_error_field(response, "message") or "").lower()
        code = (_graph_error_field(response, "code") or "").lower()
        if "expired" in message or "expired" in code:
            raise errors.NoteConnTokenExpired(
                f"Microsoft Graph rejected the access token ({response.status_code})",
                status=response.status_code,
            )
        raise errors.NoteConnAuthError(
            f"Microsoft Graph rejected the access token ({response.status_code})",
            status=response.status_code,
        )
    if response.status_code == 429:
        raise errors.NoteConnRateLimited(
            "Microsoft Graph rate limited -- retries exhausted",
            retry_after=_retry_after_seconds(response),
            status=429,
        )
    raise errors.NoteConnTransient(
        f"Microsoft Graph API error {response.status_code}", status=response.status_code,
    )


class MSGraphClient:
    """One `httpx.AsyncClient`, shared by every Graph call a provider makes.
    `Authorization: Bearer` is attached ONLY inside `send()`, and ONLY when
    the resolved URL's host is `graph.microsoft.com` (see module docstring).
    Constructing this never raises and never builds a real client — tests
    inject `client` (on `httpx.MockTransport`), `sleep_fn` (never a real
    sleep), and `rng` (a fixed jitter draw) for full determinism, mirroring
    `NotionProvider`'s `client`/`rate_limiter`/`sleep_fn` injection points."""

    def __init__(
        self, *, client: httpx.AsyncClient | None = None,
        sleep_fn: Any = None, rng: Any = None,
    ) -> None:
        self._client = client
        self._owns_client = client is None
        self._sleep = sleep_fn if sleep_fn is not None else asyncio.sleep
        self._rng = rng if rng is not None else random.random

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def get_client(self) -> httpx.AsyncClient:
        """Lazily constructs (and returns) the shared client — exposed
        publicly so a provider can reuse the SAME connection pool for an
        unauthenticated follow-up hop (OneDrive's 302 download target) via
        `providers.base.guarded_media_get`, without that hop ever inheriting
        this client's Authorization machinery (which lives entirely inside
        `send()`'s per-request `headers=`, never on the client object
        itself — the client has no persistent default headers)."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=_http_timeout_seconds())
        return self._client

    async def send(
        self, credentials: dict[str, Any], method: str, path_or_url: str, *,
        params: dict[str, Any] | None = None, json_body: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Sends ONE Graph request, honoring the bounded 429 retry ladder
        (see module docstring). `path_or_url` is either a bare path
        (`"/me"`, joined onto `GRAPH_API_BASE`) or an already-absolute
        Graph-issued URL (a delta `@odata.nextLink`/`@odata.deltaLink`,
        used VERBATIM — never re-parsed or rebuilt, since that string is the
        provider's own opaque continuation token). Refuses (raises
        `NoteConnUnsupported`) rather than attaching the bearer to anything
        whose resolved host isn't `graph.microsoft.com` — see the module
        docstring's CREDENTIAL BOUNDARY section."""
        client = await self.get_client()
        url = path_or_url if path_or_url.startswith(("http://", "https://")) else f"{GRAPH_API_BASE}{path_or_url}"
        host = httpx.URL(url).host
        if host != GRAPH_HOST:
            raise errors.NoteConnUnsupported(
                f"Refusing to attach the Microsoft Graph bearer to a non-Graph host ({host!r})",
                reason="Internal routing error -- every URL this client sends should be Graph-issued",
            )
        token = _bearer_token(credentials)
        headers = {"Authorization": f"Bearer {token}", **(extra_headers or {})}
        attempt = 0
        while True:
            try:
                response = await client.request(method, url, headers=headers, params=params, json=json_body)
            except httpx.RequestError as exc:
                raise errors.NoteConnTransient(f"Microsoft Graph request failed: {exc}") from exc
            if response.status_code == 429:
                if attempt < _RATE_LIMIT_MAX_RETRIES:
                    retry_after = _retry_after_seconds(response)
                    delay = retry_after if retry_after is not None else _jittered_backoff_seconds(attempt, self._rng)
                    await self._sleep(delay)
                    attempt += 1
                    continue
                return response  # retries exhausted -- caller raises via raise_for_status
            return response

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        """`GET /me` -> `AccountInfo(label=displayName or userPrincipalName)`
        — shared by every Graph-backed provider (OneDrive here; OneNote in a
        later task) so the label-resolution rule lives in exactly one place."""
        response = await self.send(credentials, "GET", "/me")
        if response.status_code != 200:
            raise_for_status(response)
        data = response.json()
        label = data.get("displayName") or data.get("userPrincipalName") or "Microsoft"
        return AccountInfo(label=label, raw={"id": data.get("id")})
