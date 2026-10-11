"""Task 14b (ruling R16): `compass_notes_tool_enabled`, the auth-payload key for COMPASS_NOTES_TOOL_ENABLED.

Compass's text-chat tool `search_my_notes` has a SERVER gate that nothing on the client could read, so
the Notebook could not say, truthfully and only while it is on, that Compass can read a member's notes.
The key rides the same `_access_payload` the other Notebook capability keys ride (read per request,
an enablement gate: unset means OFF). This file is the scoped proof for the one new key:

  * the key follows the environment variable BOTH WAYS, and a typo or an off-word is OFF;
  * the payload and the tool's own gate (`coach_chat_tools.notes_tool_enabled`) agree on every
    spelling, because they read through the same parse (`notebook_flags.flag_on`);
  * it is read PER REQUEST (flipped between two calls in one process, no reimport).

The general roster rails (tests/test_notebook_flags.py, tests/test_notebook_flag_parse.py) carry the
key too; this file is the one a reader of the ruling opens.
"""
from __future__ import annotations

import pytest

from api.routers import auth as auth_router
from api.services.journal_two import coach_chat_tools as cct

ENV = "COMPASS_NOTES_TOOL_ENABLED"
KEY = "compass_notes_tool_enabled"


def _payload():
    return auth_router._access_payload({"role": "member"}, "free")


def test_the_key_is_on_the_payload_and_derived_from_the_env_name():
    assert auth_router._notebook_flag_key(ENV) == KEY
    assert ENV in auth_router.NOTEBOOK_FLAGS
    assert KEY in _payload()


def test_an_enablement_gate_unset_means_OFF(monkeypatch):
    monkeypatch.delenv(ENV, raising=False)
    assert auth_router.NOTEBOOK_FLAGS[ENV] is False
    assert _payload()[KEY] is False


@pytest.mark.parametrize("raw,expected", [
    ("1", True), ("true", True), ("TRUE", True), ("yes", True), ("on", True), (" 1 ", True),
    ("0", False), ("false", False), ("no", False), ("off", False), ("", False), ("flase", False),
])
def test_the_key_follows_the_variable_both_ways(monkeypatch, raw, expected):
    monkeypatch.setenv(ENV, raw)
    assert _payload()[KEY] is expected


@pytest.mark.parametrize("raw", [None, "", "0", "1", "true", "yes", "on", "off", "flase", " 1 "])
def test_the_payload_and_the_tools_own_gate_never_disagree(monkeypatch, raw):
    if raw is None:
        monkeypatch.delenv(ENV, raising=False)
    else:
        monkeypatch.setenv(ENV, raw)
    # A member must never see a Compass line for a tool the server has withheld (or the reverse).
    assert _payload()[KEY] is cct.notes_tool_enabled()


def test_it_is_read_PER_REQUEST_flipped_between_two_calls_with_no_reimport(monkeypatch):
    monkeypatch.setenv(ENV, "1")
    assert _payload()[KEY] is True
    monkeypatch.setenv(ENV, "0")
    assert _payload()[KEY] is False
    monkeypatch.delenv(ENV)
    assert _payload()[KEY] is False
    monkeypatch.setenv(ENV, "on")
    assert _payload()[KEY] is True


def test_the_ledger_entry_names_the_client_key():
    import json
    from pathlib import Path
    ledger = json.loads((Path(__file__).resolve().parents[1] / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    note = ledger["flags"][ENV]["note"] if "flags" in ledger else ledger[ENV]["note"]
    assert KEY in note, "docs/feature_flags.json must say which payload key a client reads this gate through"
