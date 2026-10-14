# tests/test_screener_focus_flag.py
import importlib
import pytest

FLAG = "SCREENER_FOCUS_LAYOUT_ENABLED"


@pytest.fixture
def auth(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    import api.routers.auth as mod
    return importlib.reload(mod)


def test_unset_is_off_for_everyone(auth):
    assert auth._screener_flags(is_admin=True) == {"screener_focus_layout_enabled": False}


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
