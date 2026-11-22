"""TERMINAL_BOARD_TABS_ENABLED: the Terminal's new shell (boards in tabs), read per request.

Three values, the Screener scan board's grammar through the same parse (`_breadth_dc_scope`):
unset / 0 = off, `admin` = admins only, 1 = every member who has the Terminal. A value the parse
does not know is OFF. The payload key is present only when on, so with the flag off
`/api/auth/me` is what it was before this flag existed.

The new shell also keeps its open tabs in ONE new preference key; the last tests pin that the key
is accepted by the preferences endpoint and is not part of the versioned Terminal document.
"""
import importlib
import inspect

import pytest

FLAG = "TERMINAL_BOARD_TABS_ENABLED"
KEY = "terminal_board_tabs_enabled"
PREF = "terminal_board_tabs"


@pytest.fixture
def auth(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    import api.routers.auth as mod
    return importlib.reload(mod)


def test_unset_is_off_for_everyone_and_the_key_is_absent(auth):
    assert auth._terminal_board_tabs_flag(is_admin=True) == {}
    assert auth._terminal_board_tabs_flag(is_admin=False) == {}


@pytest.mark.parametrize("raw", ["1", "true", "yes", "on", " 1 ", "TRUE"])
def test_on_values_are_on_for_members(auth, monkeypatch, raw):
    monkeypatch.setenv(FLAG, raw)
    assert auth._terminal_board_tabs_flag(is_admin=False) == {KEY: True}
    assert auth._terminal_board_tabs_flag(is_admin=True) == {KEY: True}


@pytest.mark.parametrize("raw", ["admin", "ADMIN", " admin "])
def test_admin_means_admins_only_and_a_member_gets_off(auth, monkeypatch, raw):
    monkeypatch.setenv(FLAG, raw)
    assert auth._terminal_board_tabs_flag(is_admin=True) == {KEY: True}
    assert auth._terminal_board_tabs_flag(is_admin=False) == {}


@pytest.mark.parametrize("raw", ["0", "false", "off", "no", ""])
def test_off_values_are_off_for_everyone(auth, monkeypatch, raw):
    monkeypatch.setenv(FLAG, raw)
    assert auth._terminal_board_tabs_flag(is_admin=True) == {}
    assert auth._terminal_board_tabs_flag(is_admin=False) == {}


@pytest.mark.parametrize("raw", ["flase", "admins", "2", "member", "yes please", "1;admin"])
def test_a_value_the_parse_does_not_know_is_off(auth, monkeypatch, raw):
    monkeypatch.setenv(FLAG, raw)
    assert auth._terminal_board_tabs_flag(is_admin=True) == {}
    assert auth._terminal_board_tabs_flag(is_admin=False) == {}


def test_is_admin_defaults_false_so_a_caller_that_forgets_the_role_fails_closed(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "admin")
    assert auth._terminal_board_tabs_flag() == {}


def test_it_does_not_ride_on_the_scan_board_flag(auth, monkeypatch):
    monkeypatch.setenv("SCREENER_SCAN_BOARD_ENABLED", "1")
    assert auth._terminal_board_tabs_flag(is_admin=True) == {}
    assert auth._screener_flags(is_admin=False)["screener_scan_board_enabled"] is True


def test_the_payload_carries_it_with_the_viewers_role(auth):
    src = inspect.getsource(auth._access_payload)
    assert "_terminal_board_tabs_flag(is_admin=is_admin)" in src


def test_the_tabs_preference_key_is_accepted_and_is_not_a_versioned_board_key(auth):
    from api.services import workspace_doc_store as wds

    assert auth._PREFERENCE_KEYS[PREF] == auth._PREF_OPAQUE
    # The board on screen and the saved boards keep their own keys, untouched.
    assert auth._PREFERENCE_KEYS["terminal_layout"] == auth._PREF_OPAQUE
    assert auth._PREFERENCE_KEYS["terminal_boards"] == auth._PREF_OPAQUE
    assert PREF not in wds.TERMINAL_PREF_KEYS
    assert set(wds.TERMINAL_PREF_KEYS) == {"terminal_layout", "terminal_boards"}
