"""The Data Charts V2 flags are RUNTIME, not build-time, and default OFF.

DC-2 §2. These replace `VITE_BREADTH_CHARTS_V2_ENABLED`, which is compiled into the bundle:
a flip was a rebuild, a rollback was a deploy, and a per-owner preview could not be
expressed at all because there is only one bundle. Read per request from the auth payload,
all three become real.

⛔ WHAT THESE RAILS ARE FOR. Every one of them fails in the direction that would expose an
unreleased surface to members. A flag that reads ON when it should read OFF is the only
failure here that costs anything.
"""
from __future__ import annotations

import importlib

import pytest

auth = importlib.import_module("api.routers.auth")


FLAGS = ("BREADTH_DC_V2_2_ENABLED", "BREADTH_DC_V2_3_ENABLED")
KEYS = ("breadth_dc_v2_2_enabled", "breadth_dc_v2_3_enabled")


def test_unset_means_OFF_for_both():
    """⛔ THE LOAD-BEARING DEFAULT. These are ENABLEMENT gates on surfaces that ship dark:
    a forgotten variable must never expose something nobody decided to release. The
    opposite polarity (the hub's KILL switch) is deliberate and different — see
    `_access_payload`."""
    import os
    for f in FLAGS:
        os.environ.pop(f, None)
    out = auth._breadth_dc_flags()
    assert out == {k: False for k in KEYS}, out


@pytest.mark.parametrize("truthy", ["1", "true", "TRUE", "yes", "on", " on "])
def test_an_explicit_truthy_value_enables(monkeypatch, truthy):
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", truthy)
    assert auth._breadth_dc_flags()["breadth_dc_v2_2_enabled"] is True


@pytest.mark.parametrize("falsy", ["0", "false", "FALSE", "no", "off", " off "])
def test_an_explicit_falsy_value_disables(monkeypatch, falsy):
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", falsy)
    assert auth._breadth_dc_flags()["breadth_dc_v2_2_enabled"] is False


@pytest.mark.parametrize("junk", ["flase", "ON!", "", "2", "yes please"])
def test_an_UNRECOGNISED_value_takes_the_default_never_the_opposite(monkeypatch, junk):
    """⛔ A typo must not turn a dark surface on. `flase` is not `false` and it is
    certainly not `true` — it is "I cannot read this", which for an enablement gate
    means OFF."""
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", junk)
    assert auth._breadth_dc_flags()["breadth_dc_v2_2_enabled"] is False, junk


def test_the_flags_are_independent(monkeypatch):
    """V2-3 must not ride in on V2-2's flip. They are separate increments and the owner
    reverts them separately."""
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", "1")
    monkeypatch.delenv("BREADTH_DC_V2_3_ENABLED", raising=False)
    out = auth._breadth_dc_flags()
    assert out["breadth_dc_v2_2_enabled"] is True
    assert out["breadth_dc_v2_3_enabled"] is False


def test_the_read_is_PER_REQUEST_not_captured_at_import(monkeypatch):
    """⛔⛔ THE PROPERTY THE WHOLE DESIGN RESTS ON, and the one a module-level capture
    would silently break. `tests/test_hub_preview_flag.py` calls its equivalent "the
    load-bearing one" for the same reason: a captured value passes every other test in
    this file and makes the no-rebuild flip a fiction.

    Two reads of the same function across a change of environment must disagree."""
    monkeypatch.delenv("BREADTH_DC_V2_2_ENABLED", raising=False)
    before = auth._breadth_dc_flags()["breadth_dc_v2_2_enabled"]
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", "1")
    after = auth._breadth_dc_flags()["breadth_dc_v2_2_enabled"]
    assert (before, after) == (False, True), (
        f"the flag did not change within one process ({before} -> {after}); it is being "
        "captured at import, so a Railway flip would need a redeploy and the runtime "
        "mechanism is a fiction")


def test_admin_means_ADMIN_ONLY_and_a_member_sees_OFF(monkeypatch):
    """⛔⛔ THE SAFETY PROPERTY OF THE OWNER PREVIEW, and the only direction of this
    value that can cost anything. `admin` is chosen BECAUSE it is the cautious setting;
    if it leaked to members it would ship an unreleased surface to the whole roster
    under the value picked to avoid exactly that."""
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", "admin")
    assert auth._breadth_dc_flags(is_admin=False)["breadth_dc_v2_2_enabled"] is False
    assert auth._breadth_dc_flags(is_admin=True)["breadth_dc_v2_2_enabled"] is True


@pytest.mark.parametrize("spelling", ["admin", "ADMIN", " Admin "])
def test_the_admin_value_is_case_and_whitespace_insensitive(monkeypatch, spelling):
    """A Railway value typed by hand must not fall through to the default and read as
    'not released' while the owner believes the preview is live — the quiet direction,
    but the one that wastes a flip."""
    monkeypatch.setenv("BREADTH_DC_V2_3_ENABLED", spelling)
    assert auth._breadth_dc_flags(is_admin=True)["breadth_dc_v2_3_enabled"] is True


def test_an_uninstrumented_caller_fails_CLOSED(monkeypatch):
    """⛔ `is_admin` DEFAULTS TO FALSE. A call site that forgets to pass the role must
    see what a MEMBER sees, never what the owner sees. The default is a safety floor."""
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", "admin")
    assert auth._breadth_dc_flags()["breadth_dc_v2_2_enabled"] is False


def test_the_payload_passes_the_REAL_role_not_a_constant(monkeypatch):
    """NON-VACUITY for the two above: `_breadth_dc_flags` could be perfect and
    `_access_payload` could still hand it a hardcoded False (dead preview) or True
    (leak). Drive the REAL payload from both sides of the role."""
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", "admin")
    member = auth._access_payload({"role": "free", "created_at": None}, "free")
    admin = auth._access_payload({"role": "admin", "created_at": None}, "free")
    assert member["breadth_dc_v2_2_enabled"] is False, "an admin-only surface reached a member"
    assert admin["breadth_dc_v2_2_enabled"] is True, "the owner preview never turns on"


def test_the_flags_reach_the_access_payload(monkeypatch):
    """NON-VACUITY for everything above: the helper could be perfect and unwired.
    `_access_payload` is what signup/login/me actually return."""
    monkeypatch.setenv("BREADTH_DC_V2_2_ENABLED", "1")
    monkeypatch.delenv("BREADTH_DC_V2_3_ENABLED", raising=False)
    payload = auth._access_payload({"role": "free", "created_at": None}, "free")
    for k in KEYS:
        assert k in payload, f"{k} never reaches the payload the client reads: {sorted(payload)}"
    assert payload["breadth_dc_v2_2_enabled"] is True
    assert payload["breadth_dc_v2_3_enabled"] is False


def test_the_defaults_declared_in_source_are_OFF_and_cannot_be_flipped_unnoticed():
    """Pins the LITERAL, not just the behaviour. Without this, someone can change the
    default to True and 'fix' the failing test to match — which is how a dark surface
    ships to everyone in one line."""
    assert auth.BREADTH_DC_FLAGS == {
        "BREADTH_DC_V2_2_ENABLED": False,
        "BREADTH_DC_V2_3_ENABLED": False,
    }, auth.BREADTH_DC_FLAGS
