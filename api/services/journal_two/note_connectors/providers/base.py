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

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


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
