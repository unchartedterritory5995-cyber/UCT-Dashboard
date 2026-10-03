"""Lane R client-only gates (COV-10 extra colour groups, FT-046 how-to checklists).

No route reads either flag, so the auth payload IS the gate: unset must leave the
payload byte-identical, and each key must ride it only when on.
"""
from __future__ import annotations

import importlib
import json

import pytest

USER = {"id": "u1", "email": "m@example.com", "role": "member"}
FLAGS = [
    ("CHARTS_EXTRA_GROUPS_ENABLED", "charts_extra_groups_enabled"),
    ("HOW_TO_CHECKLISTS_ENABLED", "how_to_checklists_enabled"),
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


def test_the_flags_are_read_per_call(monkeypatch):
    auth = _auth()
    for env, reader in (("HOW_TO_CHECKLISTS_ENABLED", auth.how_to_checklists_enabled),
                        ("CHARTS_EXTRA_GROUPS_ENABLED", auth.charts_extra_groups_enabled)):
        monkeypatch.setenv(env, "1")
        assert reader() is True
        monkeypatch.setenv(env, "0")
        assert reader() is False


def test_every_flag_has_a_ledger_row():
    from pathlib import Path
    ledger = json.loads((Path(__file__).resolve().parents[1] / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    text = json.dumps(ledger)
    for env, _ in FLAGS:
        assert f'"{env}"' in text, env
