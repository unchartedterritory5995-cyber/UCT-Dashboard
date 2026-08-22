"""Provider contract for note connectors — spec §3.

Every provider (Roam, Craft, Notion, Dropbox) implements `NoteProvider` and
raises ONLY the shared `note_connectors.errors` taxonomy outward — never a
raw httpx/SDK exception. The sync engine (Task 8) is written against this
contract alone; it never imports a concrete provider module directly except
through the registry (Task 11).

All three provider methods are `async` (providers speak to real HTTP APIs;
`httpx.AsyncClient` throughout — see `roam.py`). `validate`/`list_changed`/
`fetch`/`fetch_media` all take the DECRYPTED credentials dict as returned by
`connections.get_token` — providers never touch `crypto_box` or the DB
themselves.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from ..errors import NoteConnTransient, NoteConnUnsupported


@dataclass
class AccountInfo:
    """Returned by `validate()` — enough to label the connected account in
    the UI ("Connected as {label}"). `raw` carries any provider-specific
    detail worth keeping for diagnostics; callers never depend on its shape."""

    label: str
    raw: dict[str, Any] | None = None


@dataclass
class RemoteRef:
    """One item a provider's enumeration knows about.

    `updated_at` is ALWAYS an ISO-8601 UTC string — providers whose native
    timestamp format differs (Roam's epoch-millis `:edit/time`) convert at
    the provider boundary so the engine's cursor comparisons are plain
    provider-agnostic string comparisons, never a per-provider parse."""

    remote_id: str
    updated_at: str


@dataclass
class RemoteNote:
    """One fully-resolved note, shaped for the engine's import_confirm-style
    upsert (Task 8). `doc` is TipTap JSON with a PLACEHOLDER body —
    `import-ref://`/`import-link://` refs left unresolved, matching
    `convert.mddoc.md_to_tiptap`'s own `doc` output exactly (every provider
    ultimately routes through that function, or a sibling like the design's
    planned `notion_blocks.py`). `media`/`links` mirror that same function's
    `media`/`links` lists so the engine drives `rewrite_body` identically
    regardless of which provider produced the doc."""

    remote_id: str
    title: str
    doc: dict[str, Any]
    media: list[dict[str, Any]] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    folder_path: list[str] = field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None


class NoteProvider(ABC):
    """Abstract provider contract.

    `name` is the short provider key used both in DB rows
    (`j2_note_connectors.provider` / `j2_note_sources.provider`) and in
    `import_key` formatting below — every concrete provider MUST set it.
    """

    name: str = ""

    # Opaque-cursor extension point (Task 11 MUST-RESOLVE #1). A provider
    # whose native change-feed is an opaque continuation token (Dropbox's
    # `list_folder` cursor) rather than a comparable timestamp sets this
    # attribute, VERBATIM, at the end of its own `list_changed()` — the
    # engine reads it back after that call and, when not None, persists it
    # via `connections.update_cursor` UNCHANGED (never parsed or compared),
    # taking precedence over the default `max(ref.updated_at for ref in
    # refs)` derivation. Roam/Craft/Notion never set this (it stays this
    # class-level default), so their existing timestamp-cursor mode is
    # unaffected. Deliberately a plain attribute, not a `list_changed`
    # return-value change — every provider already implements the
    # `list[RemoteRef]` return contract, and widening it to a tuple for one
    # provider would be a breaking change to three others for no reason.
    opaque_cursor: str | None = None

    def import_key(self, source_remote_id: str, remote_id: str) -> str:
        """Formats the durable `import_key` a synced note upserts under
        (`j2_note_remote_index.import_key`). The ENGINE never hand-builds
        this string itself — it always goes through the owning provider, so
        the format lives in exactly one place per provider.

        Default: `{provider}:{source_remote_id}/{remote_id}` — matches Roam
        (`roam:{graph}/{uid}`, where `source_remote_id` is the graph name
        stored on the `j2_note_sources` row and `remote_id` is the page
        uid), and per spec §5 also matches Craft (`craft:{link_id}/{doc_id}`)
        and Dropbox (`dropbox:{folder_id}/{path_lower}`) unchanged. Notion's
        flat `notion:{page_id}` (no source component) is the one provider
        that overrides this method.
        """
        return f"{self.name}:{source_remote_id}/{remote_id}"

    @abstractmethod
    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        """Confirms `credentials` actually work against the provider (auth +
        reachability), raising the `errors` taxonomy on failure. Called once
        at connect time; safe to call again to re-validate a stored token."""

    @abstractmethod
    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        """Every item whose `updated_at` is strictly newer than `cursor`
        (`cursor=None` -> everything, i.e. a full initial sync). Providers
        with no true delta API (Roam) re-enumerate everything and filter
        in-memory; providers with a native filter (Craft's
        `lastModifiedDateGte`) push it server-side. Either way, this is the
        engine's ONLY signal for "what changed.\""""

    @abstractmethod
    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        """Resolves one `RemoteRef` into a full `RemoteNote` with a
        PLACEHOLDER body (unresolved media/link refs) — the engine uploads
        media and calls `rewrite_body` afterward."""

    async def fetch_many(
        self, credentials: dict[str, Any], refs: list[RemoteRef],
    ) -> list[RemoteNote]:
        """OPTIONAL batch resolution, `refs` -> `RemoteNote`s in the SAME
        order. Default implementation just loops `fetch()` one ref at a
        time — correct for any provider, but wasteful for one whose API
        supports true batch resolution (Roam's `pull-many`, up to 40 eids
        per call), which should override this method for real batching.
        The sync engine (Task 8) prefers `fetch_many` when a provider
        overrides it, falling back to per-ref `fetch()` otherwise."""
        return [await self.fetch(credentials, ref) for ref in refs]

    @abstractmethod
    async def fetch_media(
        self, credentials: dict[str, Any], ref: str,
    ) -> tuple[bytes, str]:
        """Downloads one media reference (a `ref` string taken from a
        `RemoteNote`'s `media` list) -> `(bytes, content_type)`."""


# ── SSRF guard for content-controlled media refs (final-review Item D) ────
#
# `fetch_media`'s `ref` is, on every provider's genuine-external-URL branch,
# a string taken verbatim from a note's CONTENT (an image `src`, a pasted
# link) — never something the provider itself vouches for the way its own
# API host is vouched for. No provider attaches a credential to this fetch
# (see each provider's own credential-boundary note), so the risk here is
# never token leakage; it's the server blindly issuing a GET wherever an
# attacker-controlled string points, e.g. at a cloud metadata endpoint or an
# internal service that trusts requests originating from this host.
#
# `assert_public_https` is the shared check every such fetch site must run
# BEFORE the request leaves this process. It is deliberately synchronous in
# spirit but `async def` because refusing a bad HOSTNAME (as opposed to a
# bad literal IP) requires resolving it first, and DNS resolution must not
# block the event loop.
#
# ⚠️ NOT REBINDING-PROOF — READ BEFORE TRUSTING THIS AS A HARD BOUNDARY.
# This guard is RESOLVE-THEN-FETCH, not resolve-and-connect-to-that-exact-
# address: `assert_public_https` resolves `host` once and checks THOSE
# addresses, then hands the same `host` string back to httpx, which does
# its OWN independent `getaddrinfo` at TCP-connect time. A DNS server an
# attacker controls (or a compromised/rebinding-capable resolver) can
# legitimately answer PUBLIC on the first lookup and PRIVATE on the second,
# a few milliseconds later — "DNS rebinding" — and this guard cannot see
# the second answer at all. Closing that gap for real means never letting
# httpx re-resolve the hostname: pin the address this function already
# validated and connect to it directly (e.g. an httpx transport that
# accepts a literal IP + a Host header, or a custom `AsyncHTTPTransport`
# with connection-level IP pinning) — deliberately NOT built here. This
# guard is accepted as-is because every call site already established (see
# each provider's own credential-boundary note) that a content-controlled
# fetch carries NO credential to steal — the worst a successful rebind
# achieves is an unauthenticated GET landing on an internal service the
# attacker already had to guess the existence of, not a token leak. Treat
# this as a defense-in-depth SPEED BUMP against the common case (a literal
# private IP or a static private-pointing hostname typed into note
# content), never as a hard guarantee against a DETERMINED, actively
# rebinding adversary.


async def _resolve_host(host: str) -> list[str]:
    """The REAL DNS lookup `assert_public_https` uses for a non-literal-IP
    hostname -- pulled out to its own module-level function (same
    injectable-seam idiom as `RoamProvider`'s `sleep_fn`) purely so tests
    can monkeypatch `base._resolve_host` and stay hermetic (this repo's own
    provider-test convention is "no live calls anywhere," and a real
    `getaddrinfo` is a live call). Production code never overrides this."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None)
    return [info[4][0] for info in infos]


def _is_disallowed_ip(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True for any address family a public https:// media fetch must never
    reach: loopback (127.0.0.1, ::1), RFC1918/ULA private ranges, link-local
    (169.254.0.0/16 -- this is ALSO where the AWS/GCP/Azure metadata endpoint
    169.254.169.254 lives, so this one check covers that named risk too),
    multicast, "reserved," and unspecified (0.0.0.0, ::). `is_private` alone
    already covers most of these in the stdlib's own categorization, but
    each is named explicitly so a refusal reads as "this is a loopback
    address" rather than an opaque "this is private," and so the check
    doesn't silently stop covering a category if a future Python release
    ever narrows what `is_private` means."""
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


async def assert_public_https(url: str, *, what: str = "media reference") -> str:
    """SSRF guard for a `ref` taken from content an attacker fully controls.
    Enforces: (1) `https://` scheme -- never bare `http://` or any other
    scheme; (2) every IP address the host resolves to is a PUBLIC address --
    a hostname that merely LOOKS public but resolves (via attacker-influenced
    DNS, or simply because someone registered it) to a loopback/private/
    link-local/metadata address is refused exactly like a literal
    `http://127.0.0.1/...` would be. A literal IP in the URL skips DNS
    resolution and is checked directly.

    Raises `NoteConnUnsupported` on any refusal (same taxonomy member the
    pre-existing https-scheme-only checks in dropbox.py/craft.py already
    raised, so no call site's error handling needs to change) and
    `NoteConnTransient` if the hostname simply fails to resolve -- a
    resolution failure is a network condition, not proof the reference is
    unsafe, so it gets the taxonomy's normal "safe to retry" treatment
    rather than being refused outright. Returns `url` unchanged on success
    so a call site can inline it.

    ⚠️ NOT rebinding-proof: this resolves `host` and checks THOSE
    addresses, but the caller's subsequent `client.get`/`client.stream`
    re-resolves independently at connect time -- a DNS-rebinding attacker
    can answer differently between the two lookups. See the module-level
    comment above this section for why that gap is accepted here (no
    credential ever rides on this fetch) rather than closed with a
    connect-by-pinned-IP transport."""
    parsed = urlsplit(url)
    if (parsed.scheme or "").lower() != "https":
        raise NoteConnUnsupported(
            f"Cannot fetch {what} over a non-https URL ({parsed.scheme or 'no scheme'!r})",
            reason="Media reference is not a secure (https) URL",
        )
    host = parsed.hostname
    if not host:
        raise NoteConnUnsupported(
            f"Cannot fetch {what}: URL has no host",
            reason="Media reference has no host",
        )
    try:
        addrs = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            resolved = await _resolve_host(host)
        except (socket.gaierror, OSError) as exc:
            raise NoteConnTransient(
                f"Could not resolve host for {what} ({host!r}): {exc}",
            ) from exc
        addrs = [ipaddress.ip_address(a) for a in resolved]
    for addr in addrs:
        if _is_disallowed_ip(addr):
            raise NoteConnUnsupported(
                f"Cannot fetch {what}: host resolves to a non-public address ({addr})",
                reason="Media reference points at a private/internal network address",
            )
    return url


_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


async def guarded_media_get(
    client: httpx.AsyncClient, url: str, *, what: str = "media reference", max_redirects: int = 5,
) -> httpx.Response:
    """Guarded stand-in for `client.get(url, follow_redirects=True)` on a
    content-controlled `ref`. `follow_redirects=True` alone re-validates
    NOTHING between hops -- a public-looking URL that 302s to
    `http://169.254.169.254/...` would sail straight through, since httpx's
    own redirect-follow only ever looks at the ORIGINAL request's settings,
    not each new target. This follows redirects manually instead, one hop
    at a time, running `assert_public_https` before every single request
    (the first and every subsequent hop) so no Location header ever reaches
    `client.get` unchecked. Bounded by `max_redirects` so a malicious or
    misconfigured server chaining redirects can't hang the request.

    ⚠️ Inherits `assert_public_https`'s NOT-rebinding-proof caveat at every
    hop: each `assert_public_https` call resolves and checks a hostname,
    then the very next line's `client.get` re-resolves that SAME hostname
    itself to actually connect -- a DNS-rebinding attacker controlling the
    answer between those two lookups is not caught. See the module-level
    comment above this section."""
    next_url = url
    for _ in range(max_redirects + 1):
        await assert_public_https(next_url, what=what)
        try:
            response = await client.get(next_url, follow_redirects=False)
        except httpx.RequestError as exc:
            raise NoteConnTransient(f"Failed to download {what}: {exc}") from exc
        if response.status_code in _REDIRECT_STATUSES:
            location = response.headers.get("location")
            if not location:
                return response
            next_url = urljoin(next_url, location)
            continue
        return response
    raise NoteConnUnsupported(
        f"Too many redirects fetching {what}",
        reason="Media reference redirected too many times",
    )


async def guarded_media_stream(
    client: httpx.AsyncClient, url: str, *, what: str = "media reference",
    max_redirects: int = 5, max_bytes: int,
) -> tuple[bytes, httpx.Response]:
    """STREAMED sibling of `guarded_media_get`, added for the msgraph
    fix-round-1 review (Important #2): `guarded_media_get` calls
    `client.get(...)`, which httpx fully buffers into memory BEFORE the
    caller ever gets a chance to check its size -- fine for a small note
    body, but OneDrive's PRIMARY content path (both `fetch()`'s note bodies
    and same-drive `fetch_media`) routes every download through the guarded
    helper, so an ordinary large synced file would buffer whole and could
    OOM the single web pod. This function bounds memory to `max_bytes`
    (REQUIRED, no default -- every caller must be explicit about its cap,
    mirroring `dropbox.py`'s own `_MAX_FILE_BYTES` usage) the same way
    `DropboxProvider._download_streamed` already does: reject via
    `Content-Length` BEFORE reading any body bytes when the server supplies
    one, and unconditionally via a running total while streaming (the
    backstop regardless of whether Content-Length was present/honest).

    Redirect hops are followed manually, one at a time, exactly like
    `guarded_media_get` -- `assert_public_https` re-runs on EVERY hop
    (original URL and every subsequent Location), so a public-looking URL
    that redirects to a private/metadata address is still refused before
    ANY request reaches it. Only the FINAL (non-redirect) response is
    streamed; a redirect hop's body (typically empty) is drained via
    `aread()` without ever being size-checked against `max_bytes` (it isn't
    the content being fetched).

    Returns `(bytes, response)` on success -- the `response` object stays
    valid (headers already arrived before body streaming starts) after this
    function returns, so a caller can still inspect `.status_code`/
    `.headers` (e.g. `content-type`) the same way `guarded_media_get`'s
    callers do with THEIR returned response. Raises `NoteConnUnsupported`
    on either size trip (never returns a partial or oversized buffer) and
    `NoteConnTransient` on a network-level failure -- same taxonomy members
    `guarded_media_get` and `DropboxProvider._download_streamed` already
    use for the equivalent conditions, so no call site's error handling
    needs a new branch.

    ⚠️ Inherits `guarded_media_get`'s NOT-rebinding-proof caveat identically
    (see that function's and `assert_public_https`'s own docstrings)."""
    next_url = url
    for _ in range(max_redirects + 1):
        await assert_public_https(next_url, what=what)
        try:
            async with client.stream("GET", next_url, follow_redirects=False) as response:
                if response.status_code in _REDIRECT_STATUSES:
                    await response.aread()  # drain the (typically empty) redirect body
                    location = response.headers.get("location")
                    if not location:
                        return response.content, response
                    next_url = urljoin(next_url, location)
                    continue
                if response.status_code >= 400:
                    # Error bodies are typically small -- safe to buffer so
                    # the caller can still inspect status/content for
                    # diagnostics, same as guarded_media_get's non-2xx path.
                    await response.aread()
                    return response.content, response
                content_length = response.headers.get("content-length")
                if content_length is not None:
                    try:
                        if int(content_length) > max_bytes:
                            raise NoteConnUnsupported(
                                f"Cannot fetch {what}: exceeds the {max_bytes}-byte cap "
                                f"(reported size {content_length} bytes)",
                                reason=f"{what} is larger than the allowed size limit",
                            )
                    except ValueError:
                        pass  # unparseable header -- fall through to the streamed check
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise NoteConnUnsupported(
                            f"Cannot fetch {what}: exceeds the {max_bytes}-byte cap "
                            "(exceeded while streaming)",
                            reason=f"{what} is larger than the allowed size limit",
                        )
                    chunks.append(chunk)
                return b"".join(chunks), response
        except httpx.RequestError as exc:
            raise NoteConnTransient(f"Failed to download {what}: {exc}") from exc
    raise NoteConnUnsupported(
        f"Too many redirects fetching {what}",
        reason="Media reference redirected too many times",
    )
