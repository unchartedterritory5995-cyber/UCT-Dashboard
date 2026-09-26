"""⛔⛔ WAVE K — the server half. K-R6, and the per-request property for the
Notebook's keys.

`tests/test_hub_preview_flag.py` already pins the load-bearing property for the
hub flag: **it is read PER REQUEST**, because a module-level capture makes the
no-redeploy rollback a fiction. Wave K put four more flags on the same payload
(and G-064 a fifth), so the same property is asserted for them here — a rail that
covered one flag and not its neighbours would be satisfied by exactly the mistake
it exists to catch.
"""
from __future__ import annotations

import importlib
import os

import pytest

from api.routers import auth as auth_router


NOTEBOOK_KEYS = [
    "notebook_offline_default_on",
    "notebook_offline_read_on",
    "notebook_conflict_ux_on",
    "notebook_attachments_on",
    "notebook_ask_insert_on",
    # Wave 7 lane H (H2): editor writing help — an enablement gate.
    "notebook_writing_help_enabled",
]


def _payload(**env):
    """A fresh payload with `env` applied — and removed again afterwards."""
    old = {k: os.environ.get(k) for k in env}
    try:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return auth_router._access_payload({"role": "member"}, "free")
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_every_notebook_capability_appears_on_the_payload():
    p = _payload()
    for k in NOTEBOOK_KEYS:
        assert k in p, f"{k} is a capability with no key — it cannot ship dark"


def test_K_R6_the_env_var_and_the_payload_key_are_DERIVED_from_one_function():
    # ⛔ THE ONLY PLACE THE TWO NAMES ARE RELATED. Comparing two hand-written
    # lists would pass while they drifted; this calls the derivation itself.
    for env_name in auth_router.NOTEBOOK_FLAGS:
        key = auth_router._notebook_flag_key(env_name)
        assert key in _payload(), f"{env_name} derives {key}, which is not on the payload"
    # …and the roster is exactly the capabilities, no more and no fewer.
    assert sorted(auth_router._notebook_flag_key(e) for e in auth_router.NOTEBOOK_FLAGS) == sorted(NOTEBOOK_KEYS)


def test_the_kill_switch_defaults_ON_and_the_enablement_gates_default_OFF():
    # ⛔ POLARITY IS PER CAPABILITY AND IT IS NOT A STYLE CHOICE. An unset kill
    # switch must be indistinguishable from "not killed"; an unset enablement
    # gate must never expose a surface nobody decided to release.
    p = _payload(**{k: None for k in auth_router.NOTEBOOK_FLAGS})
    assert p["notebook_offline_default_on"] is True, "a forgotten variable must not kill a shipped wave"
    for k in NOTEBOOK_KEYS[1:]:
        assert p[k] is False, f"{k} is an enablement gate — unset means not turned on yet"


@pytest.mark.parametrize("raw,expected", [
    ("0", False), ("false", False), ("no", False), ("off", False), ("FALSE", False), (" 0 ", False),
    ("1", True), ("true", True), ("yes", True), ("on", True), ("ON", True),
])
def test_the_kill_switch_reads_both_polarities(raw, expected):
    assert _payload(NOTEBOOK_OFFLINE_DEFAULT_ON=raw)["notebook_offline_default_on"] is expected


def test_an_UNRECOGNISED_value_takes_the_DEFAULT_never_its_opposite():
    # ⚰️ A typo'd "flase" must not kill a shipped wave, and must not silently
    # release a dark one.
    assert _payload(NOTEBOOK_OFFLINE_DEFAULT_ON="flase")["notebook_offline_default_on"] is True
    assert _payload(NOTEBOOK_ATTACHMENTS_ON="ture")["notebook_attachments_on"] is False


def test_the_flags_are_read_PER_REQUEST_not_captured_at_import():
    # ⛔⛔ THE LOAD-BEARING ONE. If these were captured at module import, the
    # flip would need a redeploy — which is the rollback this whole wave exists
    # to avoid. Two calls, one env change between them, no reimport.
    first = _payload(NOTEBOOK_OFFLINE_DEFAULT_ON="1")["notebook_offline_default_on"]
    second = _payload(NOTEBOOK_OFFLINE_DEFAULT_ON="0")["notebook_offline_default_on"]
    assert (first, second) == (True, False), (
        "the flag did not change without a reimport — it is captured at import, "
        "and every 'no redeploy needed' claim about it is false")


def test_the_source_contains_no_module_level_capture_of_a_notebook_flag():
    # ⭐ The behavioural test above can be satisfied by a cache that happens to
    # miss. This reads the source: the env lookup must live INSIDE a function.
    src = (
        importlib.import_module("api.routers.auth").__file__
    )
    with open(src, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    for i, line in enumerate(lines):
        if "os.environ" in line and "NOTEBOOK_" in line:
            indent = len(line) - len(line.lstrip())
            assert indent > 0, (
                f"api/routers/auth.py:{i + 1} reads a Notebook flag at module level: {line.strip()}")


def test_the_notebook_keys_do_not_collide_with_the_flags_already_on_the_payload():
    p = _payload()
    for existing in ("hub_preview_enabled", "research_technical_tab_enabled", "s7_filing_watch_enabled"):
        assert existing in p, f"{existing} must survive — K adds keys, it does not replace any"
