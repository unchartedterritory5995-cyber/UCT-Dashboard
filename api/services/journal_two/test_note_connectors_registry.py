"""Tests for `note_connectors.registry` — the provider name -> class +
`configured()` lookup Task 11 introduces so the engine and router never
import a concrete provider module directly (per `providers/base.py`'s own
documented contract).

Covers:
  - import-inertness with zero env vars set (Global Constraint)
  - `configured()` per provider (token providers always True; OAuth
    providers reflect their env gate)
  - `build_provider` dispatch to the right concrete class
  - the 2026-11-04 archive: Dropbox, OneNote and OneDrive are gone from the
    registry and named in `ARCHIVED_PROVIDERS`
"""

from __future__ import annotations

import importlib

import pytest


def test_import_is_inert_with_zero_env_vars(monkeypatch):
    for var in (
        "NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET",
        "NOTE_SYNC_OBSIDIAN_ENABLED", "NOTE_ENCRYPTION_KEY", "NOTE_ENCRYPTION_KEYS_V1",
    ):
        monkeypatch.delenv(var, raising=False)
    from api.services.journal_two.note_connectors import registry
    importlib.reload(registry)  # re-run module body with the clean env -- must not raise
    assert registry.names() == ["roam", "craft", "notion", "obsidian", "evernote"]  # Plan E Task 6
    assert registry.configured("notion") is False
    assert registry.configured("obsidian") is False
    assert registry.configured("roam") is True
    assert registry.configured("craft") is True


def test_configured_reflects_env_for_oauth_providers(monkeypatch):
    from api.services.journal_two.note_connectors import registry
    monkeypatch.delenv("NOTION_CLIENT_ID", raising=False)
    monkeypatch.delenv("NOTION_CLIENT_SECRET", raising=False)
    assert registry.configured("notion") is False
    monkeypatch.setenv("NOTION_CLIENT_ID", "cid")
    monkeypatch.setenv("NOTION_CLIENT_SECRET", "csecret")
    assert registry.configured("notion") is True


def test_configured_reflects_env_for_obsidian(monkeypatch):
    """Obsidian's `configured()` is a TWO-part gate (registry.py's own
    `_obsidian_configured` docstring): the deliberate `NOTE_SYNC_OBSIDIAN_ENABLED`
    rollout flag AND a working `NOTE_ENCRYPTION_KEY` (obsidian_link.py needs it
    to encrypt a device token at all). Either one missing must read as
    not-configured -- never a raise, never a false-positive "Connect" button
    for a door nothing can complete yet."""
    from api.services.journal_two.note_connectors import registry

    monkeypatch.delenv("NOTE_SYNC_OBSIDIAN_ENABLED", raising=False)
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", "any-non-empty-value")
    assert registry.configured("obsidian") is False  # flag off -> not configured, even with a key

    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")
    monkeypatch.delenv("NOTE_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("NOTE_ENCRYPTION_KEYS_V1", raising=False)
    assert registry.configured("obsidian") is False  # flag on, but no encryption key -> still not configured

    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", "any-non-empty-value")
    assert registry.configured("obsidian") is True  # both prerequisites met


def test_configured_is_false_not_raising_for_an_unknown_provider():
    from api.services.journal_two.note_connectors import registry
    # Plan E Task 6: "evernote" is a real provider now; this pins the contract on an unknown name.
    assert registry.configured("evernote-legacy") is False
    assert registry.is_known("evernote-legacy") is False


def test_build_provider_dispatches_to_the_right_class():
    from api.services.journal_two.note_connectors import registry
    from api.services.journal_two.note_connectors.providers.roam import RoamProvider
    from api.services.journal_two.note_connectors.providers.craft import CraftProvider
    from api.services.journal_two.note_connectors.providers.notion import NotionProvider
    from api.services.journal_two.note_connectors.providers.obsidian import ObsidianProvider

    assert isinstance(registry.build_provider("roam"), RoamProvider)
    assert isinstance(registry.build_provider("craft"), CraftProvider)
    assert isinstance(registry.build_provider("notion"), NotionProvider)
    assert isinstance(registry.build_provider("obsidian"), ObsidianProvider)


def test_build_provider_raises_not_configured_for_an_unknown_name():
    from api.services.journal_two.note_connectors import registry, errors
    with pytest.raises(errors.NoteConnNotConfigured):
        registry.build_provider("evernote-legacy")


def test_build_provider_ignores_source_for_token_providers():
    """Roam/Craft/Notion don't need source-level info -- passing one must
    never raise or change construction."""
    from api.services.journal_two.note_connectors import registry
    from api.services.journal_two.note_connectors.providers.roam import RoamProvider
    p = registry.build_provider("roam", {"id": "src1", "remoteId": "some-graph"})
    assert isinstance(p, RoamProvider)


def test_build_provider_threads_user_and_vault_to_obsidian():
    """Obsidian is the ONE provider that needs `source["userId"]` (every
    other provider resolves its tenant from decrypted credentials instead —
    see `registry._build_obsidian`'s own docstring for why this provider has
    none to resolve from)."""
    from api.services.journal_two.note_connectors import registry
    p = registry.build_provider("obsidian", {"id": "src1", "userId": "u1", "remoteId": "vault-abc"})
    assert p.user_id == "u1"
    assert p.vault_id == "vault-abc"


def test_build_provider_with_no_source_leaves_obsidian_scope_unset():
    from api.services.journal_two.note_connectors import registry
    p = registry.build_provider("obsidian", None)
    assert p.user_id is None
    assert p.vault_id is None


def test_get_entry_exposes_connect_kind_for_the_router():
    from api.services.journal_two.note_connectors import registry
    assert registry.get_entry("roam").connect_kind == "token"
    assert registry.get_entry("craft").connect_kind == "token"
    assert registry.get_entry("notion").connect_kind == "oauth"
    assert registry.get_entry("obsidian").connect_kind == "device"


@pytest.mark.parametrize("name", ["dropbox", "onenote", "onedrive"])
def test_an_archived_provider_is_unknown_and_unbuildable_but_named(name):
    """The 2026-11-04 archive: no door can connect, configure or build one, and the name is kept
    in `ARCHIVED_PROVIDERS` so a stored row can still be recognised (the import repair's
    classifier reads it)."""
    from api.services.journal_two.note_connectors import errors, registry
    assert registry.is_known(name) is False
    assert registry.configured(name) is False
    assert name not in registry.names()
    assert name in registry.ARCHIVED_PROVIDERS
    with pytest.raises(errors.NoteConnNotConfigured):
        registry.build_provider(name, {"id": "s1", "userId": "u1", "remoteId": "/x"})


def test_archived_providers_are_disjoint_from_the_registry():
    from api.services.journal_two.note_connectors import registry
    assert not (registry.ARCHIVED_PROVIDERS & set(registry.names()))
