"""Compass tools over the TSDR trader archive, chat AND voice (owner ruling 2026-10-15).

Kept out of the test_wisdom_* files on purpose: these rails exercise the Compass tool
registries (journal_two.coach_chat_tools, voice_tools), which the Wisdom journal-exclusion
grep forbids Wisdom-scoped code from importing. The registries read the archive; the
archive never reads them.

SYNTHETIC data only, the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
the Compass tools missing from EITHER registry, or visible / served while the flag is off.
"""
from __future__ import annotations

import pytest

from api.services.wisdom.archive import tools as archive_tools
from api.services.wisdom.core import store
from tests.test_wisdom_archive_members import SECRET, _seed


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


def test_chat_registry_hides_both_tools_while_off_and_shows_them_while_on(monkeypatch):
    from api.services.journal_two import coach_chat_tools as cct

    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    for name in archive_tools.NAMES:
        assert name not in cct.TOOLS and cct.TOOLS.get(name) is None
        assert name not in {s["name"] for s in cct.TOOLS.values()}
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    assert cct.TOOLS["trader_archive_search"]["executor"] is cct._exec_trader_archive_search
    assert cct.TOOLS["trader_archive_ticker"]["executor"] is cct._exec_trader_archive_ticker
    assert cct.TOOLS["trader_archive_setup"]["executor"] is cct._exec_trader_archive_setup
    assert "find_patterns_on_ticker" in cct.TOOLS                             # control: ungated tools unaffected


def test_voice_registry_union_and_core_carry_both_tools_and_gate_them_per_call(monkeypatch):
    from api.services import voice_agents, voice_tool_impls  # noqa: F401  (registers)
    from api.services import voice_tools as vt

    for name in archive_tools.NAMES:
        assert name in vt._REGISTRY, name
        assert name in voice_agents._compass_tool_union()
        assert name in voice_agents._COMPASS_CORE_TOOLS
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    names_off = {t["name"] for t in vt.get_schema_for_context("compass")}
    assert not names_off & set(archive_tools.NAMES)
    assert "find_patterns_on_ticker" in names_off                             # control: the schema is real
    with pytest.raises(KeyError):
        vt.dispatch("trader_archive_search", {"query": "breakout"})
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    names_on = {t["name"] for t in vt.get_schema_for_context("compass")}
    assert set(archive_tools.NAMES) <= names_on


def test_the_tools_refuse_while_off_and_answer_bounded_while_on(wisdom_db, on, monkeypatch):
    _seed()
    from api.services.journal_two import coach_chat_tools as cct

    found = cct._exec_trader_archive_ticker(user_id="u", account_id=None, args={"symbol": "zzta"})
    assert found["ok"] and found["symbol"] == "ZZTA" and found["n_calls"] == 1
    assert found["recent_calls"][0]["outcome"]["r20"] == 0.10
    assert len(found["recent_posts"]) <= archive_tools.MAX_HITS
    hits = cct._exec_trader_archive_search(user_id="u", account_id=None, args={"query": "patience"})
    assert hits["ok"] and [h["record_id"] for h in hits["results"]] == ["t9102"]
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    off = cct._exec_trader_archive_search(user_id="u", account_id=None, args={"query": "patience"})
    assert off == {"ok": False, "error": archive_tools.OFF_MESSAGE, "narration": archive_tools.OFF_MESSAGE}


def test_the_setup_tool_answers_a_bounded_playbook_and_refuses_while_off(wisdom_db, on, monkeypatch):
    _seed()
    from api.services.journal_two import coach_chat_tools as cct

    out = cct._exec_trader_archive_setup(user_id="u", account_id=None, args={"setup": "synthetic setup"})
    assert out["ok"] and out["setup_id"] == "synthetic_setup" and out["stats"]["n_scored"] == 140
    assert out["best_context"][0]["value"] == "downtrend"                         # n >= 30, best edge first
    assert all(c["n_scored"] >= 30 for c in out["best_context"] + out["worst_context"])
    assert len(out["teachings"]) <= archive_tools.MAX_TEACHINGS and out["teachings"][0]["trader"]
    assert len(out["winners"]) <= archive_tools.MAX_EXAMPLES
    assert out["narration"].startswith("[PLAYBOOK")
    by_id = cct._exec_trader_archive_setup(user_id="u", account_id=None, args={"setup": "synthetic_setup"})
    assert by_id["setup_id"] == "synthetic_setup"
    none = cct._exec_trader_archive_setup(user_id="u", account_id=None, args={"setup": "zzz nothing"})
    assert not none["ok"] and "Synthetic setup" in none["error"]                  # names what exists
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    off = cct._exec_trader_archive_setup(user_id="u", account_id=None, args={"setup": "synthetic setup"})
    assert off == {"ok": False, "error": archive_tools.OFF_MESSAGE, "narration": archive_tools.OFF_MESSAGE}
