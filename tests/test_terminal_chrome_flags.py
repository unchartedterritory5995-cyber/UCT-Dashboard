"""TERMINAL-NEXT lane T4: the two client-only gates (api/services/terminal_chrome.py).

No route reads either flag, so the auth payload IS the gate: unset must leave the payload
byte-identical, and each key must ride it only when on, read per call.

    python -m pytest tests/test_terminal_chrome_flags.py -q
"""
from __future__ import annotations

import importlib
import json

import pytest

USER = {"id": "u1", "email": "m@example.com", "role": "member"}
FLAGS = [
    ("TERMINAL_CHROME_ENABLED", "terminal_chrome_enabled"),
    ("CHARTS_PHONE_DOORS_ENABLED", "charts_phone_doors_enabled"),
]


def _auth():
    return importlib.import_module("api.routers.auth")


def _clear(monkeypatch):
    for env, _ in FLAGS:
        monkeypatch.delenv(env, raising=False)


@pytest.mark.parametrize("env,key", FLAGS)
def test_unset_the_payload_does_not_grow_a_key(monkeypatch, env, key):
    _clear(monkeypatch)
    assert key not in _auth()._access_payload(USER, "pro")


@pytest.mark.parametrize("env,key", FLAGS)
def test_off_values_are_off(monkeypatch, env, key):
    _clear(monkeypatch)
    for v in ("0", "", "false", "no", "off", "garbage"):
        monkeypatch.setenv(env, v)
        assert key not in _auth()._access_payload(USER, "pro"), v


@pytest.mark.parametrize("env,key", FLAGS)
def test_on_adds_exactly_its_own_key(monkeypatch, env, key):
    auth = _auth()
    _clear(monkeypatch)
    off = auth._access_payload(USER, "pro")
    monkeypatch.setenv(env, "1")
    on = auth._access_payload(USER, "pro")
    assert on.pop(key) is True
    off.pop("feature_status", None)
    on.pop("feature_status", None)
    assert json.dumps(on, sort_keys=True, default=str) == json.dumps(off, sort_keys=True, default=str)


def test_read_per_call_not_at_import(monkeypatch):
    from api.services import terminal_chrome as tc
    for env, reader in (("TERMINAL_CHROME_ENABLED", tc.chrome_enabled),
                        ("CHARTS_PHONE_DOORS_ENABLED", tc.charts_phone_doors_enabled)):
        monkeypatch.setenv(env, "1")
        assert reader() is True
        monkeypatch.setenv(env, "0")
        assert reader() is False


def test_the_client_reads_both_keys_strictly():
    """AuthContext must read each key `=== true` (an enablement gate never defaults to shown)."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "app" / "src" / "context" / "AuthContext.jsx").read_text(encoding="utf-8")
    for _env, key in FLAGS:
        assert f"d.{key} === true" in src, key
