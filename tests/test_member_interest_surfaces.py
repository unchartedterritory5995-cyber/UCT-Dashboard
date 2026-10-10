"""D-9 (Personalization UC-1): the Breadth drill, Screener and Morning Wire consumers of
GET /api/member/interest. Each rides its OWN dark gate on the auth payload, present only
when on, and the client mirror lists every key the server can send."""
from __future__ import annotations

import importlib
import json
import os

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SURFACES = [
    ("MEMBER_INTEREST_BREADTH_ENABLED", "member_interest_breadth_enabled", "member_interest_breadth"),
    ("MEMBER_INTEREST_SCREENER_ENABLED", "member_interest_screener_enabled", "member_interest_screener"),
    ("MEMBER_INTEREST_WIRE_ENABLED", "member_interest_wire_enabled", "member_interest_wire"),
]


def _clear(monkeypatch):
    for env, _key, _mod in SURFACES:
        monkeypatch.delenv(env, raising=False)


@pytest.mark.parametrize("env,key,mod", SURFACES)
def test_each_gate_is_off_by_default_and_read_per_call(monkeypatch, env, key, mod):
    _clear(monkeypatch)
    m = importlib.import_module(f"api.services.{mod}")
    assert m.ENABLED_ENV == env
    assert m.is_enabled() is False
    monkeypatch.setenv(env, "1")
    assert m.is_enabled() is True          # no re-import: read per call
    monkeypatch.setenv(env, "0")
    assert m.is_enabled() is False


@pytest.mark.parametrize("env,key,mod", SURFACES)
def test_the_payload_key_rides_only_when_its_own_gate_is_on(monkeypatch, env, key, mod):
    from api.routers import auth
    _clear(monkeypatch)
    assert auth._member_interest_flags() == {}           # all unset => byte-identical payload
    monkeypatch.setenv(env, "1")
    flags = auth._member_interest_flags()
    assert flags == {key: True}                          # ONLY its own key, never a sibling's
    # ...and it is not a Research notice or a Depth panel.
    assert key not in auth._research_notice_flags()
    assert key not in auth._research_depth_flags()


def test_the_tuple_names_exactly_the_three_consumers():
    from api.routers import auth
    assert [k for k, _ in auth._MEMBER_INTEREST_SURFACES] == [k for _e, k, _m in SURFACES]
    assert [m for _, m in auth._MEMBER_INTEREST_SURFACES] == [m for _e, _k, m in SURFACES]


def test_the_access_payload_splices_the_member_interest_flags():
    """Non-vacuity: the function exists AND the payload builder calls it (a key the
    payload never carries would leave the client gate permanently off)."""
    import inspect
    from api.routers import auth
    src = inspect.getsource(auth)
    assert "**_member_interest_flags()," in src
    assert "**_research_notice_flags()," in src     # control: the probe can see a sibling


def test_the_js_mirror_lists_every_key():
    from api.routers import auth
    js = open(os.path.join(HERE, "app", "src", "lib", "memberInterest.js"), encoding="utf-8").read()
    for key, _mod in auth._MEMBER_INTEREST_SURFACES:
        assert f"'{key}'" in js, key


def test_each_gate_is_declared_dark_in_the_ledger():
    flags = json.load(open(os.path.join(HERE, "docs", "feature_flags.json"), encoding="utf-8"))["flags"]
    for env, _key, _mod in SURFACES:
        e = flags.get(env)
        assert e, env
        assert e["status"] == "dark", env
        assert e.get("since") == "2026-10-10", env
        assert "web" in e.get("where", []), env
        assert "—" not in e["note"], f"{env}: no em-dash in new copy"
