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
    an OAuth redirect, `connect_kind == "oauth"` — Notion/Evernote — or a
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
from typing import Any, Awaitable, Callable, Literal

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
    # Plan E Task 6: (user_id) -> the member's current creds, refreshed when needed, or None.
    # When set, `engine._resolve_credentials` uses it instead of the `oauth.py` path. A
    # trailing defaulted field, so no existing entry changes.
    refresh: Callable[[str], Awaitable[dict | None]] | None = None
    # Evernote rate-limit fix round 1 (I3): () -> the provider CLASS, imported lazily, so a door
    # can read a class attribute (`follow_up_on_rate_limit`) without building an instance. The
    # attribute stays the one authority; this only reaches it. A trailing defaulted field.
    provider_class: Callable[[], type] | None = None


def _always_configured() -> bool:
    # Roam/Craft are LIVE providers (spec §7) — the user pastes a token
    # directly, there is no server-side app registration/env gate. Always
    # "available to try connecting," unlike Notion's OAuth app.
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


def _obsidian_configured() -> bool:
    """Obsidian's per-provider gate (Global Constraint, plan §"Everything
    stays behind `NOTE_SYNC_ENABLED` plus a per-provider gate, like every
    other connector"). Unlike Notion/Evernote, there is no
    third-party app registration to check env vars for — Obsidian talks to
    no external API at all (push transport, spec §7.2). The two real
    prerequisites:

      1. `NOTE_SYNC_OBSIDIAN_ENABLED=1` — a DELIBERATE rollout flag,
         registered `dark` in docs/feature_flags.json. ⚰️ This used to say
         "the plugin itself is a separate, not-yet-published repo — Wave
         3b" — stale as of a 2026-09-22 competitive audit: a real, tagged,
         released plugin exists —
         `unchartedterritory5995-cyber/obsidian-uct-notebook-sync`,
         releases 0.1.0 and 0.1.1, listed on the third-party ObsidianStats
         tracker. Whether it has been SUBMITTED to and accepted into
         Obsidian's own official `obsidian.md/plugins` in-app directory
         (installable without BRAT/manual unzip) is a separate, still-open
         question this correction does not answer — check
         `obsidian/obsidian-releases` before claiming that half. Without
         this flag a fresh deploy would immediately advertise a "Connect"
         button for a door a member may not yet be able to walk through
         from inside Obsidian itself.
      2. `crypto_box.NoteBox.is_configured()` — a genuine capability check,
         the same shape `_notion_configured` uses for
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
    provider here threads at most `source["userId"]` (Evernote) or nothing,
    because every other provider resolves its own tenant
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


#: What a member's source row says while Evernote sync is switched off for them.
EVERNOTE_PAUSED = "Evernote sync is paused"


def evernote_flag_mode() -> Literal["off", "admin", "on"]:
    """`NOTE_SYNC_EVERNOTE_ENABLED`, read live: "1" -> on (every member), "admin" -> admins only,
    anything else (unset, "0", "true", ...) -> off. Exact strings, so a typo stays off."""
    value = os.environ.get("NOTE_SYNC_EVERNOTE_ENABLED")
    if value == "1":
        return "on"
    if value == "admin":
        return "admin"
    return "off"


def provider_allowed_for(provider: str, user: dict[str, Any]) -> bool:
    """Whether `user` may use `provider`. Every provider but Evernote: yes. Evernote: mode `on`,
    or mode `admin` and the user's role is admin."""
    if provider != "evernote":
        return True
    mode = evernote_flag_mode()
    return mode == "on" or (mode == "admin" and (user or {}).get("role") == "admin")


def _evernote_configured() -> bool:
    """Mode not off, a registered client id (`EVERNOTE_CLIENT_ID`, read live), and the note
    encryption key (credentials are stored encrypted). All read live."""
    if evernote_flag_mode() == "off":
        return False
    from api.services import crypto_box
    from . import evernote_oauth
    return bool(evernote_oauth.client_id()) and crypto_box.NoteBox.is_configured()


def _evernote_class() -> type:
    from .providers.evernote import EvernoteProvider
    return EvernoteProvider


def _build_evernote(source: dict[str, Any] | None) -> Any:
    """Refuses while the flag is off: the flag is a real kill switch, so scheduled syncs of
    EXISTING sources stop too, with nothing deleted (the engine logs an error row per tick; it
    marks nothing broken -- only an auth error does that). Threads `source["userId"]` as
    `_build_obsidian` does, so the provider can refresh on a mid-sync 401; a probe (`None`
    source) gets `user_id=None`."""
    mode = evernote_flag_mode()
    user_id = (source or {}).get("userId")
    if mode == "off":
        # Task 6 review m7: the source row shows this text; member words, never an env var.
        raise errors.NoteConnNotConfigured(EVERNOTE_PAUSED)
    if mode == "admin" and user_id is not None:
        # Task 6 review m5: flipping 1 -> admin stops members' EXISTING sources too, exactly as
        # off does, not only new connects. The owner's role is read live from the users table.
        from api.services import auth_service
        if (auth_service.get_user_by_id(user_id) or {}).get("role") != "admin":
            raise errors.NoteConnNotConfigured(EVERNOTE_PAUSED)
    from .providers.evernote import EvernoteProvider
    return EvernoteProvider(user_id=user_id)


async def _evernote_refresh(user_id: str) -> dict | None:
    from . import evernote_oauth
    return await evernote_oauth.refresh_if_needed(user_id)


_REGISTRY: dict[str, ProviderEntry] = {
    "roam": ProviderEntry("roam", "Roam Research", "token", _always_configured, _build_roam),
    "craft": ProviderEntry("craft", "Craft", "token", _always_configured, _build_craft),
    "notion": ProviderEntry("notion", "Notion", "oauth", _notion_configured, _build_notion),
    "obsidian": ProviderEntry("obsidian", "Obsidian", "device", _obsidian_configured, _build_obsidian),
    "evernote": ProviderEntry("evernote", "Evernote", "oauth", _evernote_configured, _build_evernote,
                              refresh=_evernote_refresh, provider_class=_evernote_class),
}


#: Providers ARCHIVED on 2026-11-04 (Dropbox, OneNote, OneDrive): never configured in production,
#: so no member could connect one, and their code was removed (restore: revert the archive commit).
#: NOT in `_REGISTRY`, so no door builds, connects or syncs them. A stored `j2_note_connectors` /
#: `j2_note_sources` row naming one is never deleted: `/status` leaves it out, the sync loops skip
#: it with a log line (`engine._skip_archived_provider`), and the import repair keeps classing its notes as connector notes
#: (`import_repair.runner.classify`), exactly as it did while the provider had no active source.
ARCHIVED_PROVIDERS: frozenset[str] = frozenset({"dropbox", "onenote", "onedrive"})


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


def runs_sync_in_background(provider: str) -> bool:
    """Fix round 1 (I3): does a member's "Sync now" for this provider always run in the
    background? True exactly when the provider's class opts in to rate-limit follow-ups
    (`follow_up_on_rate_limit`): such a pass can wait on the provider's limit for minutes, which
    must never hold an HTTP request open. Never raises; unknown or class-less entries say False."""
    entry = _REGISTRY.get(provider)
    if entry is None or entry.provider_class is None:
        return False
    try:
        cls = entry.provider_class()
    except Exception:  # noqa: BLE001 -- a door must not fail on this question
        return False
    return getattr(cls, "follow_up_on_rate_limit", False) is True


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
