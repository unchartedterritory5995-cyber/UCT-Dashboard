"""Evernote's registry entry, flag modes, refresh hook and ledger (Plan E Task 6).

`NOTE_SYNC_EVERNOTE_ENABLED`: unset/"0"/anything else -> off, "admin" -> admins only, "1" -> every
member. Off is a real kill switch: `_build_evernote` refuses, so scheduled syncs of existing sources
stop too, and nothing is deleted.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from api.services import crypto_box
from api.services.journal_two.note_connectors import engine, errors, evernote_oauth, oauth, registry
from api.services.journal_two.note_connectors import connections

LEDGER = pathlib.Path(__file__).resolve().parents[3] / "docs" / "feature_flags.json"


@pytest.fixture
def configured(monkeypatch):
    """Everything an enabled Evernote needs, with the mode left to each test."""
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "cid-1")
    monkeypatch.setattr(crypto_box.NoteBox, "is_configured", lambda: True)


@pytest.mark.parametrize("val,mode", [(None, "off"), ("0", "off"), ("admin", "admin"), ("1", "on"),
                                      ("true", "off"), ("on", "off"), (" 1", "off"), ("ADMIN", "off")])
def test_flag_modes(monkeypatch, val, mode):
    if val is None:
        monkeypatch.delenv("NOTE_SYNC_EVERNOTE_ENABLED", raising=False)
    else:
        monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", val)
    assert registry.evernote_flag_mode() == mode


def test_flag_mode_is_read_live(monkeypatch):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "1")
    assert registry.evernote_flag_mode() == "on"
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "0")
    assert registry.evernote_flag_mode() == "off"


def test_evernote_is_a_known_oauth_provider():
    entry = registry.get_entry("evernote")
    assert (entry.name, entry.label, entry.connect_kind) == ("evernote", "Evernote", "oauth")
    assert entry.refresh is not None
    assert registry.is_known("evernote") and "evernote" in registry.names()


def test_evernote_configured_needs_mode_client_id_and_key(monkeypatch, configured):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "1")
    assert registry.configured("evernote") is True
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "admin")
    assert registry.configured("evernote") is True


def test_evernote_not_configured_without_client_id_or_key(monkeypatch, configured):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "1")
    monkeypatch.delenv("EVERNOTE_CLIENT_ID")
    assert registry.configured("evernote") is False
    monkeypatch.setenv("EVERNOTE_CLIENT_ID", "cid-1")
    monkeypatch.setattr(crypto_box.NoteBox, "is_configured", lambda: False)
    assert registry.configured("evernote") is False


def test_evernote_not_configured_when_off(monkeypatch, configured):
    monkeypatch.delenv("NOTE_SYNC_EVERNOTE_ENABLED", raising=False)
    assert registry.configured("evernote") is False


def test_admin_mode_allows_admins_only(monkeypatch):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "admin")
    assert registry.provider_allowed_for("evernote", {"role": "admin"}) is True
    assert registry.provider_allowed_for("evernote", {"role": "member"}) is False
    assert registry.provider_allowed_for("evernote", {}) is False
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "1")
    assert registry.provider_allowed_for("evernote", {"role": "member"}) is True
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "0")
    assert registry.provider_allowed_for("evernote", {"role": "admin"}) is False


def test_every_other_provider_is_allowed_for_everyone(monkeypatch):
    monkeypatch.delenv("NOTE_SYNC_EVERNOTE_ENABLED", raising=False)
    for name in registry.names():
        if name != "evernote":
            assert registry.provider_allowed_for(name, {}) is True


def test_build_raises_not_configured_when_flag_off(monkeypatch, configured):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "0")
    with pytest.raises(errors.NoteConnNotConfigured):
        registry.build_provider("evernote", {"userId": "u1", "remoteId": "account"})


def test_the_flag_off_error_is_member_language_never_the_env_var(monkeypatch, configured):
    # Task 6 review m7: the source row shows this text (a red dot) on every tick while off.
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "0")
    with pytest.raises(errors.NoteConnNotConfigured) as ei:
        registry.build_provider("evernote", {"userId": "u1", "remoteId": "account"})
    assert str(ei.value) == "Evernote sync is paused"
    assert "NOTE_SYNC" not in str(ei.value)


@pytest.mark.parametrize("role,allowed", [("admin", True), ("member", False), (None, False)])
def test_admin_mode_stops_a_non_admins_existing_source(monkeypatch, configured, role, allowed):
    # Task 6 review m5: flipping 1 -> admin must stop members' sources too, not only new connects.
    from api.services import auth_service
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "admin")
    monkeypatch.setattr(auth_service, "get_user_by_id",
                        lambda uid: None if role is None else {"id": uid, "role": role})
    source = {"userId": "u1", "remoteId": "account"}
    if allowed:
        assert registry.build_provider("evernote", source)._user_id == "u1"
    else:
        with pytest.raises(errors.NoteConnNotConfigured) as ei:
            registry.build_provider("evernote", source)
        assert str(ei.value) == "Evernote sync is paused"


def test_build_passes_the_source_user_id_to_the_provider(monkeypatch, configured):
    monkeypatch.setenv("NOTE_SYNC_EVERNOTE_ENABLED", "1")
    provider = registry.build_provider("evernote", {"userId": "u1", "remoteId": "account"})
    assert provider.name == "evernote" and provider._user_id == "u1"
    probe = registry.build_provider("evernote", None)
    assert probe._user_id is None


async def test_resolve_credentials_routes_evernote_through_its_refresh_hook(monkeypatch):
    calls = []

    async def refresh(user_id, **kw):
        calls.append((user_id, kw))
        return {"accessToken": "at-fresh"}

    monkeypatch.setattr(evernote_oauth, "refresh_if_needed", refresh)
    monkeypatch.setattr(connections, "get_token",
                        lambda *a, **k: pytest.fail("evernote must not read the token raw"))
    creds = await engine._resolve_credentials("u1", "evernote")
    assert creds == {"accessToken": "at-fresh"}
    assert calls == [("u1", {})]  # a plain refresh-if-needed: not forced, no client


@pytest.mark.parametrize("provider,path", [("notion", "oauth"), ("roam", "token")])
async def test_resolve_credentials_unchanged_for_notion_and_roam(monkeypatch, provider, path):
    seen = []

    async def oauth_refresh(user_id, name, **kw):
        seen.append(("oauth", name))
        return {"via": "oauth"}

    def get_token(user_id, name, *a, **k):
        seen.append(("token", name))
        return {"via": "token"}

    monkeypatch.setattr(oauth, "refresh_if_needed", oauth_refresh)
    monkeypatch.setattr(connections, "get_token", get_token)
    monkeypatch.setattr(evernote_oauth, "refresh_if_needed",
                        lambda *a, **k: pytest.fail("only evernote uses its hook"))
    creds = await engine._resolve_credentials("u1", provider)
    assert creds == {"via": path} and seen == [(path, provider)]


def test_flag_is_in_the_ledger_as_dark():
    entry = json.loads(LEDGER.read_text(encoding="utf-8"))["flags"]["NOTE_SYNC_EVERNOTE_ENABLED"]
    assert entry["status"] == "dark" and entry["since"] == "2026-11-02" and "live gate" in entry["note"]
    assert entry["where"] == ["web"]
