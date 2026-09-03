"""Provider registry — maps a provider NAME to its class + a `configured()`
check. Single source of truth for "which providers exist, and is each one
usable right now" — consumed by:

  - `note_connectors/engine.py`'s `_default_provider_factory` (constructs a
    fresh provider instance per sync call; per `providers/base.py`'s own
    documented contract, the engine "never imports a concrete provider
    module directly except through the registry (Task 11)" — this module
    is that registry).
  - `api/routers/note_sync.py` — `GET /status`'s configured/connected
    matrix, and the connect/OAuth-start endpoints (decide whether a
    provider needs a pasted token, `connect_kind == "token"` — Roam/Craft —
    an OAuth redirect, `connect_kind == "oauth"` — Notion/Dropbox — or a
    connect code minted here and redeemed by a separately-installed local
    plugin, `connect_kind == "device"` — Obsidian; see `ProviderEntry
    .connect_kind`'s own comment below for why this is a THIRD value, not a
    mislabelled "token").

Import-inert (Global Constraint): importing this module with ZERO env vars
set never raises and never constructs a provider instance or an httpx
client — every provider class import + live `configured()` check is
deferred to inside a function body, mirroring `engine.py`'s own prior
`_default_provider_factory` discipline ("lazy imports so importing this
module never pulls in httpx-based provider modules unless a provider
actually needs resolving").

Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §7, §8.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable

from . import errors


@dataclass(frozen=True)
class ProviderEntry:
    name: str
    label: str
    # "token": the user pastes a live credential (Roam graph token + graph
    #   name; Craft capability URL + bearer) — `POST /{provider}/connect`
    #   validates it synchronously and stores it.
    # "oauth": `POST /{provider}/connect` mints a signed state and returns a
    #   redirect URL; `GET /{provider}/callback` completes the exchange.
    # "device": neither of the above — a locally-installed plugin
    #   (Obsidian) cannot run a browser OAuth redirect at all, and there is
    #   no credential for the member to paste (the plugin's push transport
    #   authenticates with a device token it hasn't been issued yet).
    #   `POST /{provider}/connect` mints a short-lived, single-use CONNECT
    #   CODE and returns it directly (no redirect, no synchronous credential
    #   validation, no source auto-created here); the member pastes that
    #   code into the plugin, which exchanges it for a long-lived device
    #   token via `obsidian_link.redeem_connect_code` — entirely outside
    #   this router's `/connect` + `/callback` pair. Calling this "token"
    #   would be dishonest (nothing is pasted INTO this UI) and calling it
    #   "oauth" would be worse (there is no redirect, no third-party
    #   authorization screen, no callback exchange) — see
    #   `obsidian_link.py`'s own module docstring for why this shape is the
    #   shortest honest substitute for a browser-based flow Obsidian cannot
    #   host.
    connect_kind: str
    configured: Callable[[], bool]
    # (source_row_or_None) -> a fresh NoteProvider instance.
    build: Callable[[dict[str, Any] | None], Any]


def _always_configured() -> bool:
    # Roam/Craft are LIVE providers (spec §7) — the user pastes a token
    # directly, there is no server-side app registration/env gate. Always
    # "available to try connecting," unlike Notion/Dropbox's OAuth apps.
    return True


def _build_roam(source: dict[str, Any] | None) -> Any:
    from .providers.roam import RoamProvider
    return RoamProvider()


def _build_craft(source: dict[str, Any] | None) -> Any:
    from .providers.craft import CraftProvider
    return CraftProvider()


def _notion_configured() -> bool:
    from . import oauth
    return oauth.configured("notion")


def _build_notion(source: dict[str, Any] | None) -> Any:
    from .providers.notion import NotionProvider
    return NotionProvider()


def _dropbox_configured() -> bool:
    from .providers.dropbox import configured as dbx_configured
    return dbx_configured()


def _build_dropbox(source: dict[str, Any] | None) -> Any:
    from .providers.dropbox import DropboxProvider
    # Task 11 MUST-RESOLVE #3: Dropbox's synced folder is SOURCE-level (one
    # OAuth connector can back multiple folders — `j2_note_connectors` is
    # PK'd (user_id, provider), `j2_note_sources` is not), stored on
    # `remote_id` per spec §5's column comment ("... / folder id"). This is
    # the one call site that threads it — every other provider ignores
    # `source` entirely.
    folder_path = (source or {}).get("remoteId")
    return DropboxProvider(folder_path=folder_path)


def _onenote_configured() -> bool:
    from . import oauth
    return oauth.configured("onenote")


def _build_onenote(source: dict[str, Any] | None) -> Any:
    from .providers.onenote import OneNoteProvider
    # Whole-account provider (Notion's shape) -- `source` is ignored, same
    # as `_build_notion` above: there is exactly one OneNote source per
    # account ("page ids are globally unique within the account ... there
    # is exactly one OneNote source per account", providers/onenote.py's
    # own `import_key` docstring), so there is nothing source-level to
    # thread through here (unlike Dropbox/OneDrive's per-source
    # `folder_path`).
    return OneNoteProvider()


def _onedrive_configured() -> bool:
    from . import oauth
    return oauth.configured("onedrive")


def _build_onedrive(source: dict[str, Any] | None) -> Any:
    from .providers.onedrive import OneDriveProvider
    # Same one-connector-backs-multiple-folder-sources shape as Dropbox
    # above (Task 3 of the msgraph wave, MUST-RESOLVE #3's identical
    # pattern) — `source["remoteId"]` threads through as `folder_path=`.
    # Despite the kwarg name (chosen for constructor-shape parity with
    # `DropboxProvider`), `OneDriveProvider` treats it as a Graph
    # drive-item folder id, never a path — see that module's own docstring.
    folder_path = (source or {}).get("remoteId")
    return OneDriveProvider(folder_path=folder_path)


def _obsidian_configured() -> bool:
    """Obsidian's per-provider gate (Global Constraint, plan §"Everything
    stays behind `NOTE_SYNC_ENABLED` plus a per-provider gate, like every
    other connector"). Unlike Notion/Dropbox/msgraph, there is no
    third-party app registration to check env vars for — Obsidian talks to
    no external API at all (push transport, spec §7.2). The two real
    prerequisites:

      1. `NOTE_SYNC_OBSIDIAN_ENABLED=1` — a DELIBERATE rollout flag,
         registered `dark` in docs/feature_flags.json (the plugin itself is
         a separate, not-yet-published repo — Wave 3b — and Task 6's
         mock-plugin live-gate lifecycle test has not run yet). Without
         this a fresh deploy would immediately advertise a "Connect" button
         for a door nothing outside this repo can walk through yet.
      2. `crypto_box.NoteBox.is_configured()` — a genuine capability check,
         the same shape `_notion_configured`/`_dropbox_configured` use for
         their own OAuth env vars: without `NOTE_ENCRYPTION_KEY`,
         `obsidian_link.redeem_connect_code` cannot encrypt a device token
         at all (it calls `crypto_box.NoteBox.encrypt` directly), so
         advertising the tile as available would dead-end a member who
         actually tries to connect rather than failing before they start.

    Both are read live (no caching) so a Railway var flip takes effect on
    the next request, matching every other `_*_configured` function here."""
    if os.environ.get("NOTE_SYNC_OBSIDIAN_ENABLED") != "1":
        return False
    from api.services import crypto_box
    return crypto_box.NoteBox.is_configured()


def _build_obsidian(source: dict[str, Any] | None) -> Any:
    """Threads BOTH `source["userId"]` and `source["remoteId"]` through to
    the provider's constructor kwargs (`user_id=`/`vault_id=`) — every other
    provider here threads at most `source["remoteId"]` (Dropbox/OneDrive's
    folder path), because every other provider resolves its own tenant
    scope from the DECRYPTED CREDENTIALS the engine hands it. Obsidian has
    no credentials to resolve a user from at all (push transport, nothing to
    decrypt) — `providers/obsidian.py`'s own docstring is explicit that
    binding `(user_id, vault_id)` at CONSTRUCTION, never from `credentials`,
    is what keeps its per-tenant reads structural rather than a bolted-on
    filter. `source["userId"]` is always present on a real `j2_note_sources`
    row (`connections._row_to_source` sets it unconditionally); a caller
    building with no source at all (this registry's own `configured()`
    probe, existing registry tests) gets `user_id=None, vault_id=None`,
    which simply matches no staging/manifest rows — never a crash, the same
    "no source -> harmless default" contract every other provider here
    already has for its own source-derived kwarg."""
    from .providers.obsidian import ObsidianProvider
    source = source or {}
    return ObsidianProvider(user_id=source.get("userId"), vault_id=source.get("remoteId"))


_REGISTRY: dict[str, ProviderEntry] = {
    "roam": ProviderEntry("roam", "Roam Research", "token", _always_configured, _build_roam),
    "craft": ProviderEntry("craft", "Craft", "token", _always_configured, _build_craft),
    "notion": ProviderEntry("notion", "Notion", "oauth", _notion_configured, _build_notion),
    "dropbox": ProviderEntry("dropbox", "Dropbox", "oauth", _dropbox_configured, _build_dropbox),
    "onenote": ProviderEntry("onenote", "OneNote", "oauth", _onenote_configured, _build_onenote),
    "onedrive": ProviderEntry("onedrive", "OneDrive", "oauth", _onedrive_configured, _build_onedrive),
    "obsidian": ProviderEntry("obsidian", "Obsidian", "device", _obsidian_configured, _build_obsidian),
}


def names() -> list[str]:
    """Stable order (dict insertion order, Python 3.7+) — matches the order
    providers are documented in spec §7, and gives `GET /status` a
    deterministic `providers` key order."""
    return list(_REGISTRY.keys())


def is_known(provider: str) -> bool:
    return provider in _REGISTRY


def get_entry(provider: str) -> ProviderEntry:
    entry = _REGISTRY.get(provider)
    if entry is None:
        raise errors.NoteConnNotConfigured(f"unknown provider {provider!r}")
    return entry


def configured(provider: str) -> bool:
    """Never raises — an unknown provider name is simply "not configured,"
    matching `oauth.configured`'s own contract (the primitive a connect UI
    calls to decide "not available yet" vs a live Connect button)."""
    entry = _REGISTRY.get(provider)
    if entry is None:
        return False
    return entry.configured()


def build_provider(provider: str, source: dict[str, Any] | None = None) -> Any:
    """Constructs a FRESH provider instance for `provider`, threading
    `source` (the full `j2_note_sources` row, when the caller has one) to
    whichever provider needs source-level info — each `_build_*` function
    above documents its own use of it (or lack of one); read those rather
    than a count here. Raises `NoteConnNotConfigured` for an unknown
    provider name — mirrors the OLD `_default_provider_factory`'s contract
    exactly, so callers (engine.py) see no behavior change for a bad name."""
    entry = get_entry(provider)
    return entry.build(source)
