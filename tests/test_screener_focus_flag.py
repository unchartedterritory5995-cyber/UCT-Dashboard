# tests/test_screener_focus_flag.py
import importlib
import pytest

FLAG = "SCREENER_FOCUS_LAYOUT_ENABLED"
PHONE = "SCREENER_FOCUS_PHONE_ENABLED"
BOARD = "SCREENER_SCAN_BOARD_ENABLED"
GALLERY = "SCREENER_LAYOUT_GALLERY_ENABLED"
TABLET = "SCREENER_SCAN_BOARD_TABLET_ENABLED"


@pytest.fixture
def auth(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    monkeypatch.delenv("SCREENER_NEW_TODAY_ENABLED", raising=False)
    monkeypatch.delenv("SCREENER_PREMARKET_ENABLED", raising=False)
    monkeypatch.delenv(PHONE, raising=False)
    monkeypatch.delenv(BOARD, raising=False)
    monkeypatch.delenv(GALLERY, raising=False)
    import api.routers.auth as mod
    return importlib.reload(mod)


def test_unset_is_off_for_everyone(auth):
    assert auth._screener_flags(is_admin=True) == {"screener_focus_layout_enabled": False,
                                                   "screener_new_today_enabled": False,
                                                   "screener_premarket_enabled": False,
                                                   "screener_focus_phone_enabled": False,
                                                   "screener_scan_board_enabled": False,
                                                   "screener_layout_gallery_enabled": False,
                                                   "screener_scan_board_tablet_enabled": False}


@pytest.mark.parametrize("raw", ["1", "true", "yes", "on"])
def test_on_values_are_on_for_members(auth, monkeypatch, raw):
    monkeypatch.setenv(FLAG, raw)
    assert auth._screener_flags(is_admin=False)["screener_focus_layout_enabled"] is True


def test_admin_means_admin_only_and_a_member_sees_off(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "admin")
    assert auth._screener_flags(is_admin=True)["screener_focus_layout_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_focus_layout_enabled"] is False


def test_typo_takes_the_default_not_the_opposite(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "flase")
    assert auth._screener_flags(is_admin=True)["screener_focus_layout_enabled"] is False


def test_is_admin_defaults_false_so_an_uninstrumented_caller_fails_closed(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "admin")
    assert auth._screener_flags()["screener_focus_layout_enabled"] is False


def test_the_payload_carries_it(auth):
    import inspect
    src = inspect.getsource(auth._access_payload)
    assert "_screener_flags(is_admin=" in src


# The phone flag (spec 2026-10-16 s3): same three-value grammar, its own key.
@pytest.mark.parametrize("raw", ["1", "true", "yes", "on"])
def test_phone_on_values_are_on_for_members(auth, monkeypatch, raw):
    monkeypatch.setenv(PHONE, raw)
    assert auth._screener_flags(is_admin=False)["screener_focus_phone_enabled"] is True


def test_phone_admin_means_admin_only_and_a_member_sees_off(auth, monkeypatch):
    monkeypatch.setenv(PHONE, "admin")
    assert auth._screener_flags(is_admin=True)["screener_focus_phone_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_focus_phone_enabled"] is False


def test_phone_typo_takes_the_default_not_the_opposite(auth, monkeypatch):
    monkeypatch.setenv(PHONE, "flase")
    assert auth._screener_flags(is_admin=True)["screener_focus_phone_enabled"] is False


def test_phone_flag_is_independent_of_the_layout_flag(auth, monkeypatch):
    monkeypatch.setenv(PHONE, "1")
    out = auth._screener_flags(is_admin=True)
    assert out["screener_focus_phone_enabled"] is True
    assert out["screener_focus_layout_enabled"] is False


# -- the scan board (owner direction 2026-11-17): the same three-value grammar as its siblings --
def test_scan_board_is_off_until_armed(auth):
    assert auth._screener_flags(is_admin=True)["screener_scan_board_enabled"] is False


def test_scan_board_on_is_on_for_members(auth, monkeypatch):
    monkeypatch.setenv(BOARD, "1")
    assert auth._screener_flags(is_admin=False)["screener_scan_board_enabled"] is True


def test_scan_board_admin_is_the_owner_preview(auth, monkeypatch):
    monkeypatch.setenv(BOARD, "admin")
    assert auth._screener_flags(is_admin=True)["screener_scan_board_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_scan_board_enabled"] is False


def test_scan_board_does_not_ride_on_the_focus_layout_flag(auth, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    assert auth._screener_flags(is_admin=False)["screener_scan_board_enabled"] is False


# -- community scan-board layouts (owner direction 2026-11-17): its own key, the same grammar --
def test_layout_gallery_is_off_until_armed(auth):
    assert auth._screener_flags(is_admin=True)["screener_layout_gallery_enabled"] is False


def test_layout_gallery_on_is_on_for_members(auth, monkeypatch):
    monkeypatch.setenv(GALLERY, "1")
    assert auth._screener_flags(is_admin=False)["screener_layout_gallery_enabled"] is True


def test_layout_gallery_admin_is_the_owner_preview(auth, monkeypatch):
    monkeypatch.setenv(GALLERY, "admin")
    assert auth._screener_flags(is_admin=True)["screener_layout_gallery_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_layout_gallery_enabled"] is False


def test_layout_gallery_does_not_ride_on_the_scan_board_flag(auth, monkeypatch):
    monkeypatch.setenv(BOARD, "1")
    out = auth._screener_flags(is_admin=False)
    assert out["screener_scan_board_enabled"] is True
    assert out["screener_layout_gallery_enabled"] is False


# -- the scan board on tablets (owner 2026-11-17: "yeah do all of that"): its own key, the same grammar --
def test_tablet_board_is_off_until_armed(auth):
    assert auth._screener_flags(is_admin=True)["screener_scan_board_tablet_enabled"] is False


def test_tablet_board_on_is_on_for_members(auth, monkeypatch):
    monkeypatch.setenv(TABLET, "1")
    assert auth._screener_flags(is_admin=False)["screener_scan_board_tablet_enabled"] is True


def test_tablet_board_admin_is_the_owner_preview(auth, monkeypatch):
    monkeypatch.setenv(TABLET, "admin")
    assert auth._screener_flags(is_admin=True)["screener_scan_board_tablet_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_scan_board_tablet_enabled"] is False


def test_tablet_board_does_not_ride_on_the_scan_board_flag(auth, monkeypatch):
    monkeypatch.setenv(BOARD, "1")
    out = auth._screener_flags(is_admin=False)
    assert out["screener_scan_board_enabled"] is True
    assert out["screener_scan_board_tablet_enabled"] is False
