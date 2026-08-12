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
    or an OAuth redirect, `connect_kind == "oauth"` — Notion/Dropbox).

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


_REGISTRY: dict[str, ProviderEntry] = {
    "roam": ProviderEntry("roam", "Roam Research", "token", _always_configured, _build_roam),
    "craft": ProviderEntry("craft", "Craft", "token", _always_configured, _build_craft),
    "notion": ProviderEntry("notion", "Notion", "oauth", _notion_configured, _build_notion),
    "dropbox": ProviderEntry("dropbox", "Dropbox", "oauth", _dropbox_configured, _build_dropbox),
    "onedrive": ProviderEntry("onedrive", "OneDrive", "oauth", _onedrive_configured, _build_onedrive),
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
    whichever provider needs source-level info (today: only Dropbox's
    folder path). Raises `NoteConnNotConfigured` for an unknown provider
    name — mirrors the OLD `_default_provider_factory`'s contract exactly,
    so callers (engine.py) see no behavior change for a bad name."""
    entry = get_entry(provider)
    return entry.build(source)
