"""STUDY_ENABLED — the Study kill switch, on the hub-preview rails
(tests/test_hub_preview_flag.py): the value is READ AT REQUEST TIME, the
default in source is ON, and the client half rides `_access_payload`.

A default-ON gate needs no docs/feature_flags.json entry (T10); this file
pins that it IS default-on by the ledger's own predicate.

Run alone: python -m pytest tests/test_study_flags.py -q
"""
from __future__ import annotations

import importlib
import os

import pytest

from api.services import feature_flag_index as ffi

ENV = "STUDY_ENABLED"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _restore_env():
    before = os.environ.get(ENV)
    yield
    if before is None:
        os.environ.pop(ENV, None)
    else:
        os.environ[ENV] = before


def _set(value):
    if value is None:
        os.environ.pop(ENV, None)
    else:
        os.environ[ENV] = value


# ── the router's own read ─────────────────────────────────────────────────────

def test_unset_means_not_killed():
    from api.routers import study
    _set(None)
    assert study.study_enabled() is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "no", "off", " Off "])
def test_explicit_off_spellings_kill_it(value):
    from api.routers import study
    _set(value)
    assert study.study_enabled() is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "anything-else"])
def test_everything_else_leaves_it_alive(value):
    from api.routers import study
    _set(value)
    assert study.study_enabled() is True


def test_the_flag_is_read_per_request():
    """Same process, same imported module, no reload — the load-bearing one."""
    from api.routers import study
    _set("1")
    assert study.study_enabled() is True
    _set("0")
    assert study.study_enabled() is False
    _set("1")
    assert study.study_enabled() is True


def test_off_answers_the_framework_404_through_the_dependency():
    from fastapi import HTTPException
    from api.routers import study
    _set("0")
    with pytest.raises(HTTPException) as e:
        study._armed()
    assert e.value.status_code == 404 and e.value.detail == "Not Found"
    _set("1")
    assert study._armed() is None


def test_the_default_in_source_is_ON_in_the_router():
    src = open(os.path.join(ROOT, "api", "routers", "study.py"), encoding="utf-8").read()
    i = src.index("def study_enabled")
    window = src[i:i + 400]
    assert '"STUDY_ENABLED", "1"' in window, "STUDY_ENABLED is a KILL switch: unset must mean ON"


def test_every_route_on_the_router_carries_the_armed_dependency():
    """A route added without `dependencies=_ARMED` would stay reachable with
    the product switched off."""
    from api.routers import study
    for r in study.router.routes:
        deps = [d.dependency for d in getattr(r, "dependencies", [])]
        assert study._armed in deps, f"{r.path} is not gated by STUDY_ENABLED"


# ── the client half: _access_payload ──────────────────────────────────────────

@pytest.fixture
def access_payload():
    return importlib.import_module("api.routers.auth")._access_payload


@pytest.fixture
def a_member():
    return {"id": "u1", "email": "m@example.com", "role": "member"}


def test_the_payload_carries_study_enabled_read_per_request(access_payload, a_member):
    _set(None)
    assert access_payload(a_member, "free")["study_enabled"] is True
    _set("0")
    assert access_payload(a_member, "free")["study_enabled"] is False     # no reimport between these
    _set("1")
    assert access_payload(a_member, "free")["study_enabled"] is True


def test_the_payload_default_in_source_is_ON():
    src = open(os.path.join(ROOT, "api", "routers", "auth.py"), encoding="utf-8").read()
    assert src.count('"study_enabled"') == 1
    helper_at = src.index("def _access_payload")
    field_at = src.index('"study_enabled"')
    assert field_at > helper_at, "the flag must live inside _access_payload"
    window = src[field_at:field_at + 400]
    assert '"STUDY_ENABLED", "1"' in window


# ── the ledger: default-ON needs no entry ─────────────────────────────────────

def test_a_default_on_gate_needs_no_ledger_entry():
    assert ffi.needs_declaration(ENV, "1") is False


def test_no_default_off_study_gate_is_undeclared():
    """If a STUDY_* gate that defaults OFF ever lands, it must be declared."""
    import json
    from pathlib import Path
    repo = Path(ROOT)
    gates = ffi.gates(ffi.repo_roots(repo), repo)
    study_gates = {k: v for k, v in gates.items() if k.startswith("STUDY_")}
    assert ENV in study_gates, "the AST index must see STUDY_ENABLED"
    ledger = json.load(open(os.path.join(ROOT, "docs", "feature_flags.json"), encoding="utf-8"))["flags"]
    for name, g in study_gates.items():
        if ffi.needs_declaration(name, g["default"]):
            assert name in ledger, f"{name} defaults off and is not in docs/feature_flags.json"
