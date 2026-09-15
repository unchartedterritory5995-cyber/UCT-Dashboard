"""R32 — the gate reads its own API-key variable, and never leaks a value.

⛔⛔ WHY A WISDOM-SPECIFIC NAME EXISTS. `ANTHROPIC_API_KEY` in the operator's shell is the
variable **Claude Code itself** reads to authenticate and bill. Exporting it so the gate can run
changes how the agent session launching the gate is authenticated — a side effect nobody asked
for, on the account that pays for the session. `WISDOM_ANTHROPIC_API_KEY` lets the programme
carry its own credential without touching that.

⛔ Every fixture value here is OBVIOUSLY FAKE and is asserted ABSENT from the exception text and
from captured logs. A test that checked precedence but let a real key reach a log would be worse
than no test at all.
"""
from __future__ import annotations

import logging

import pytest

from api.services.wisdom.extract import batch

FAKE_WISDOM = "FAKE-wisdom-key-not-a-real-credential"
FAKE_GENERIC = "FAKE-generic-key-not-a-real-credential"


@pytest.fixture(autouse=True)
def _no_inherited_key(monkeypatch):
    """Start every case from a known-empty state, so nothing inherits the operator's real key."""
    for name in batch.KEY_VARS:
        monkeypatch.delenv(name, raising=False)


def _key_used(monkeypatch) -> str:
    """Construct a client and report which key it was handed — without any network call."""
    seen = {}

    class _FakeAnthropic:
        def __init__(self, api_key=None, timeout=None, **kw):
            seen["api_key"] = api_key

    import sys
    import types

    module = types.ModuleType("anthropic")
    module.Anthropic = _FakeAnthropic
    monkeypatch.setitem(sys.modules, "anthropic", module)
    batch.make_client()
    return seen["api_key"]


def test_the_wisdom_variable_wins_when_both_are_set(monkeypatch):
    """⛔ THE POINT OF R32. If this ever flips, the gate starts spending the agent's credential."""
    monkeypatch.setenv("WISDOM_ANTHROPIC_API_KEY", FAKE_WISDOM)
    monkeypatch.setenv("ANTHROPIC_API_KEY", FAKE_GENERIC)
    assert _key_used(monkeypatch) == FAKE_WISDOM


def test_the_generic_variable_is_the_fallback(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", FAKE_GENERIC)
    assert _key_used(monkeypatch) == FAKE_GENERIC


def test_an_empty_or_whitespace_wisdom_var_falls_through(monkeypatch):
    """An exported-but-empty variable is not a credential — it must not mask the fallback."""
    monkeypatch.setenv("WISDOM_ANTHROPIC_API_KEY", "   ")
    monkeypatch.setenv("ANTHROPIC_API_KEY", FAKE_GENERIC)
    assert _key_used(monkeypatch) == FAKE_GENERIC


def test_neither_set_raises_and_names_both_variables():
    with pytest.raises(batch.ExtractUnavailable) as exc:
        batch.make_client()
    message = str(exc.value)
    for name in batch.KEY_VARS:
        assert name in message, f"the error must name {name} so the operator knows what to export"


def test_the_error_and_the_logs_carry_no_key_value(monkeypatch, caplog):
    """⛔ An error that quotes a key is a key in a log."""
    monkeypatch.setenv("WISDOM_ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(batch.ExtractUnavailable) as exc:
            batch.make_client()
    blob = str(exc.value) + "".join(r.getMessage() for r in caplog.records)
    for fake in (FAKE_WISDOM, FAKE_GENERIC):
        assert fake not in blob


def test_a_set_key_is_never_echoed_on_the_success_path(monkeypatch, caplog):
    monkeypatch.setenv("WISDOM_ANTHROPIC_API_KEY", FAKE_WISDOM)
    with caplog.at_level(logging.DEBUG):
        used = _key_used(monkeypatch)
    assert used == FAKE_WISDOM                      # it reached the client
    assert FAKE_WISDOM not in "".join(r.getMessage() for r in caplog.records)  # and nowhere else


def test_the_variable_order_is_declared_once_and_preference_first():
    """The tuple IS the precedence; nothing re-states it."""
    assert batch.KEY_VARS == ("WISDOM_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")


# ── R34: the OS credential store as a third source ───────────────────────────

FAKE_STORED = "FAKE-stored-key-not-a-real-credential"


def _fake_keyring(monkeypatch, *, value=None, raises=None):
    """Mock the module. ⛔ The REAL credential store is never touched by a test."""
    import sys
    import types

    module = types.ModuleType("keyring")

    def get_password(service, user):
        if raises is not None:
            raise raises
        return value if (service, user) == (batch.KEYRING_SERVICE, batch.KEYRING_USER) else None

    module.get_password = get_password
    monkeypatch.setitem(sys.modules, "keyring", module)


def test_the_environment_beats_the_store(monkeypatch):
    """⛔ A tie goes to the ENVIRONMENT. `railway run` and a one-off export are deliberate acts
    scoped to ONE process; the store is ambient and applies to every run on the machine."""
    _fake_keyring(monkeypatch, value=FAKE_STORED)
    monkeypatch.setenv("WISDOM_ANTHROPIC_API_KEY", FAKE_WISDOM)
    assert _key_used(monkeypatch) == FAKE_WISDOM


def test_the_store_is_used_when_no_variable_is_set(monkeypatch):
    _fake_keyring(monkeypatch, value=FAKE_STORED)
    assert _key_used(monkeypatch) == FAKE_STORED


def test_a_keyring_error_falls_through_instead_of_crashing(monkeypatch):
    """⭐ No backend, a locked store, a missing module: the gate must behave exactly as it did
    before R34 existed — the same ExtractUnavailable, not a crash."""
    _fake_keyring(monkeypatch, raises=RuntimeError("no backend available"))
    with pytest.raises(batch.ExtractUnavailable):
        batch.make_client()


def test_an_absent_keyring_module_falls_through(monkeypatch):
    import sys

    monkeypatch.setitem(sys.modules, "keyring", None)   # import keyring -> ImportError
    with pytest.raises(batch.ExtractUnavailable):
        batch.make_client()


def test_an_empty_stored_value_is_not_a_credential(monkeypatch):
    _fake_keyring(monkeypatch, value="   ")
    with pytest.raises(batch.ExtractUnavailable):
        batch.make_client()


def test_the_error_names_all_three_sources_and_no_value(monkeypatch, caplog):
    _fake_keyring(monkeypatch, value=None)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(batch.ExtractUnavailable) as exc:
            batch.make_client()
    message = str(exc.value)
    for token in (*batch.KEY_VARS, batch.KEYRING_SERVICE, batch.KEYRING_USER):
        assert token in message
    blob = message + "".join(r.getMessage() for r in caplog.records)
    for fake in (FAKE_WISDOM, FAKE_GENERIC, FAKE_STORED):
        assert fake not in blob


def test_a_stored_key_is_never_echoed(monkeypatch, caplog):
    _fake_keyring(monkeypatch, value=FAKE_STORED)
    with caplog.at_level(logging.DEBUG):
        used = _key_used(monkeypatch)
    assert used == FAKE_STORED
    assert FAKE_STORED not in "".join(r.getMessage() for r in caplog.records)
