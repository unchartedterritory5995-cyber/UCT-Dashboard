"""Tests for `note_connectors.registry` — the provider name -> class +
`configured()` lookup Task 11 introduces so the engine and router never
import a concrete provider module directly (per `providers/base.py`'s own
documented contract).

Covers:
  - import-inertness with zero env vars set (Global Constraint)
  - `configured()` per provider (token providers always True; OAuth
    providers reflect their env gate)
  - `build_provider` dispatch to the right concrete class
  - Task 11 MUST-RESOLVE #3: Dropbox folder-path threading from a
    `j2_note_sources` row's `remoteId` through to `DropboxProvider`
"""

from __future__ import annotations

import importlib

import pytest


def test_import_is_inert_with_zero_env_vars(monkeypatch):
    for var in ("NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"):
        monkeypatch.delenv(var, raising=False)
    from api.services.journal_two.note_connectors import registry
    importlib.reload(registry)  # re-run module body with the clean env -- must not raise
    assert registry.names() == ["roam", "craft", "notion", "dropbox"]
    assert registry.configured("notion") is False
    assert registry.configured("dropbox") is False
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

    monkeypatch.delenv("DROPBOX_APP_KEY", raising=False)
    monkeypatch.delenv("DROPBOX_APP_SECRET", raising=False)
    assert registry.configured("dropbox") is False
    monkeypatch.setenv("DROPBOX_APP_KEY", "key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "secret")
    assert registry.configured("dropbox") is True


def test_configured_is_false_not_raising_for_an_unknown_provider():
    from api.services.journal_two.note_connectors import registry
    assert registry.configured("evernote") is False
    assert registry.is_known("evernote") is False


def test_build_provider_dispatches_to_the_right_class():
    from api.services.journal_two.note_connectors import registry
    from api.services.journal_two.note_connectors.providers.roam import RoamProvider
    from api.services.journal_two.note_connectors.providers.craft import CraftProvider
    from api.services.journal_two.note_connectors.providers.notion import NotionProvider
    from api.services.journal_two.note_connectors.providers.dropbox import DropboxProvider

    assert isinstance(registry.build_provider("roam"), RoamProvider)
    assert isinstance(registry.build_provider("craft"), CraftProvider)
    assert isinstance(registry.build_provider("notion"), NotionProvider)
    assert isinstance(registry.build_provider("dropbox"), DropboxProvider)


def test_build_provider_raises_not_configured_for_an_unknown_name():
    from api.services.journal_two.note_connectors import registry, errors
    with pytest.raises(errors.NoteConnNotConfigured):
        registry.build_provider("evernote")


def test_build_provider_threads_the_source_row_folder_path_to_dropbox():
    """Task 11 MUST-RESOLVE #3: `source["remoteId"]` (the j2_note_sources
    column spec §5 documents as "... / folder id" for Dropbox) reaches
    `DropboxProvider`'s `folder_path` constructor kwarg."""
    from api.services.journal_two.note_connectors import registry
    p = registry.build_provider("dropbox", {"id": "src1", "remoteId": "/team notes"})
    assert p._folder_path_override == "/team notes"


def test_build_provider_with_no_source_leaves_dropbox_folder_path_unset():
    from api.services.journal_two.note_connectors import registry
    p = registry.build_provider("dropbox", None)
    assert p._folder_path_override is None


def test_build_provider_ignores_source_for_token_providers():
    """Roam/Craft/Notion don't need source-level info -- passing one must
    never raise or change construction."""
    from api.services.journal_two.note_connectors import registry
    from api.services.journal_two.note_connectors.providers.roam import RoamProvider
    p = registry.build_provider("roam", {"id": "src1", "remoteId": "some-graph"})
    assert isinstance(p, RoamProvider)


def test_get_entry_exposes_connect_kind_for_the_router():
    from api.services.journal_two.note_connectors import registry
    assert registry.get_entry("roam").connect_kind == "token"
    assert registry.get_entry("craft").connect_kind == "token"
    assert registry.get_entry("notion").connect_kind == "oauth"
    assert registry.get_entry("dropbox").connect_kind == "oauth"
