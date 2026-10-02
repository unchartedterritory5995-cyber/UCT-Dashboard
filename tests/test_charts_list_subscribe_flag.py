"""COV-10 — the /charts list-subscribe gate rides the auth payload, and ONLY when on.

The feature is client-only (no route reads the flag), so the auth payload IS the
gate: unset must leave the payload byte-identical to before COV-10.
"""
from __future__ import annotations

import importlib
import json

FLAG = "CHARTS_LIST_SUBSCRIBE_ENABLED"
KEY = "charts_list_subscribe_enabled"
USER = {"id": "u1", "email": "m@example.com", "role": "member"}


def _auth():
    return importlib.import_module("api.routers.auth")


def test_unset_the_payload_does_not_grow_a_key(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    assert KEY not in _auth()._access_payload(USER, "pro")


def test_off_values_are_off(monkeypatch):
    for v in ("0", "", "false", "no", "off", "garbage"):
        monkeypatch.setenv(FLAG, v)
        assert KEY not in _auth()._access_payload(USER, "pro"), v


def test_on_the_payload_carries_true(monkeypatch):
    for v in ("1", "true", "ON", " yes "):
        monkeypatch.setenv(FLAG, v)
        assert _auth()._access_payload(USER, "pro")[KEY] is True, v


def test_on_adds_exactly_one_key_and_changes_nothing_else(monkeypatch):
    auth = _auth()
    monkeypatch.delenv(FLAG, raising=False)
    off = auth._access_payload(USER, "pro")
    monkeypatch.setenv(FLAG, "1")
    on = auth._access_payload(USER, "pro")
    on.pop(KEY)
    # feature_status is derived from the payload; compare everything else verbatim.
    off.pop("feature_status", None)
    on.pop("feature_status", None)
    assert json.dumps(on, sort_keys=True, default=str) == json.dumps(off, sort_keys=True, default=str)


def test_the_flag_is_read_per_call_not_at_import(monkeypatch):
    auth = _auth()
    monkeypatch.setenv(FLAG, "1")
    assert auth.charts_list_subscribe_enabled() is True
    monkeypatch.setenv(FLAG, "0")
    assert auth.charts_list_subscribe_enabled() is False
