"""TERM-078 (FB-I1-04) -- the population-wide daily cap over member AI requests.

WHAT IS RAILED, and each case fails for a different reason
  * OFF (the default) is exactly today's behaviour: no read, no write, no refusal.
  * SHADOW NEVER BLOCKS -- it counts real demand and logs a would-cap line once
    per (door, day). A cap nobody has seen fire is not a cap (GATE-1), and
    shadow is how it is seen to fire before it can refuse anyone.
  * ENFORCE refuses past the cap with a sentence that NAMES the cap -- asserted
    as text (PROD-2) -- and counts nothing for the refused request.
  * FAIL OPEN: an unreadable counter store admits (daily_counters' own rule).
  * AT THE DOORS: the refusal reaches a member as THIS sentence, never the
    door's own per-member one (PROD-5), and the member's own reservation is
    given back first -- proved on AI Search, writing help and Compass chat.
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3

import pytest
from fastapi import HTTPException

from api.services import ai_population_cap as pop
from api.services import daily_counters, note_ask

DAY = "2026-09-25"
UID = "member-9"


@pytest.fixture
def store(tmp_path, monkeypatch):
    from api.services import auth_db
    path = str(tmp_path / "auth.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    monkeypatch.setenv("AUTH_DB_PATH", path)
    monkeypatch.setattr(note_ask, "_et_day", lambda: DAY)
    monkeypatch.delenv(pop.FLAG, raising=False)
    monkeypatch.delenv(pop.CAP_ENV, raising=False)
    pop._reset_for_tests()
    return path


def _count(day=DAY):
    return daily_counters.value(day, pop.SCOPE, daily_counters.GLOBAL)


def _rows(path):
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT count(*) FROM sqlite_master WHERE name = 'daily_usage_counters'"
                         ).fetchone()[0]
    finally:
        c.close()


# ── the flag ─────────────────────────────────────────────────────────────────

def test_the_default_is_OFF_and_off_touches_nothing(store):
    assert pop.mode() == pop.MODE_OFF
    for _ in range(5):
        assert pop.admit("ai_search", day=DAY) is None
    assert _rows(store) == 0, "off mode opened the counter store"


def test_the_mode_table_declares_the_default_and_vocabulary_the_code_falls_back_to():
    default, allowed = pop.AI_POPULATION_MODE_FLAGS[pop.FLAG]
    assert default == pop.MODE_OFF
    assert allowed == (pop.MODE_OFF, pop.MODE_SHADOW, pop.MODE_ENFORCE)


def test_an_unrecognised_mode_is_SHADOW_never_blocking_and_never_silent(store, monkeypatch):
    monkeypatch.setenv(pop.FLAG, "enforc")
    assert pop.mode() == pop.MODE_SHADOW


# ── shadow never blocks ──────────────────────────────────────────────────────

def test_SHADOW_never_blocks_counts_real_demand_and_says_would_cap_once(store, monkeypatch, caplog):
    monkeypatch.setenv(pop.FLAG, "shadow")
    monkeypatch.setenv(pop.CAP_ENV, "2")
    caplog.set_level(logging.WARNING, logger=pop.log.name)
    for _ in range(6):
        assert pop.admit("ai_search", day=DAY) is None
    assert _count() == 6, "shadow must count the demand past the cap, or it measures nothing"
    lines = [r.getMessage() for r in caplog.records if "would-cap" in r.getMessage()]
    assert len(lines) == 1 and "door=ai_search" in lines[0], lines


# ── enforce refuses, and names the cap ───────────────────────────────────────

def test_ENFORCE_refuses_past_the_cap_with_a_sentence_that_names_it(store, monkeypatch):
    monkeypatch.setenv(pop.FLAG, "enforce")
    monkeypatch.setenv(pop.CAP_ENV, "2")
    assert pop.admit("ai_search", day=DAY) is None
    assert pop.admit("ai_search", day=DAY) is None
    refusal = pop.admit("ai_search", day=DAY)
    assert refusal == pop.REFUSAL_SENTENCE
    assert "shared limit for the whole membership" in refusal
    assert "not your own allowance" in refusal
    assert "midnight ET" in refusal
    assert _count() == 2, "a refused request was counted"


def test_the_cap_is_read_per_call_and_a_bad_value_falls_back(store, monkeypatch):
    monkeypatch.setenv(pop.CAP_ENV, "not-a-number")
    assert pop.daily_cap() == pop.DEFAULT_DAILY_CAP
    monkeypatch.setenv(pop.CAP_ENV, "-3")
    assert pop.daily_cap() == pop.DEFAULT_DAILY_CAP
    monkeypatch.setenv(pop.CAP_ENV, "0")
    assert pop.daily_cap() == 0               # 0 is a closed door, never an unlimited one


# ── fail open ────────────────────────────────────────────────────────────────

def test_an_unreadable_store_FAILS_OPEN_even_in_enforce_and_the_snapshot_says_so(store, monkeypatch):
    from api.services import auth_db
    monkeypatch.setenv(pop.FLAG, "enforce")
    monkeypatch.setenv(pop.CAP_ENV, "0")

    def broken():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(auth_db, "get_connection", broken)
    assert pop.admit("ai_search", day=DAY) is None
    snap = pop.snapshot(day=DAY)
    assert snap["mode"] == pop.MODE_ENFORCE and snap["readable"] is False


# ── at the doors ─────────────────────────────────────────────────────────────

@pytest.fixture
def ai(monkeypatch):
    import api.routers.ai_search as ai
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._usage_seeded_day = ai._et_day()
    monkeypatch.setattr(ai, "_persist_usage", lambda key, delta: None)
    return ai


def test_AI_SEARCH_in_enforce_refuses_with_the_population_sentence_and_refunds(store, ai, monkeypatch):
    monkeypatch.setenv(pop.FLAG, "enforce")
    monkeypatch.setenv(pop.CAP_ENV, "1")
    ai._reserve_request(UID, 2)                          # admitted: the day's one unit
    assert ai._quota_snapshot(UID)["used"] == 2
    with pytest.raises(HTTPException) as e:
        ai._reserve_request(UID, 2)
    assert e.value.status_code == 429 and e.value.detail == pop.REFUSAL_SENTENCE
    assert ai._quota_snapshot(UID)["used"] == 2, "the member was charged for a refused request"


def test_AI_SEARCH_in_shadow_never_blocks_a_request_past_the_cap(store, ai, monkeypatch):
    monkeypatch.setenv(pop.FLAG, "shadow")
    monkeypatch.setenv(pop.CAP_ENV, "1")
    for _ in range(4):
        ai._reserve_request(UID, 1)                       # would raise if shadow blocked
    assert ai._quota_snapshot(UID)["used"] == 4


def test_AI_SEARCH_a_member_over_their_OWN_limit_never_spends_the_populations(store, ai, monkeypatch):
    monkeypatch.setenv(pop.FLAG, "shadow")
    monkeypatch.setenv("AI_SEARCH_DAILY_LIMIT", "1")
    ai._reserve_request(UID, 1)
    with pytest.raises(HTTPException) as e:
        ai._reserve_request(UID, 1)
    assert "research limit" in e.value.detail                # the member's own sentence
    assert _count(pop.et_day()) == 1


def test_WRITING_HELP_in_enforce_refunds_the_draft_and_names_the_shared_cap(store, monkeypatch):
    from api.routers import notebook_writing_help as nwh
    monkeypatch.setenv(pop.FLAG, "enforce")
    monkeypatch.setenv(pop.CAP_ENV, "0")
    assert note_ask.reserve_writing_help(UID, cost=0.01, day=DAY) is True
    assert note_ask.writing_help_used(UID, day=DAY) == 1
    with pytest.raises(HTTPException) as e:
        asyncio.run(nwh._population_gate("notebook_writing_help", UID, 0.01, DAY))
    assert e.value.status_code == 429 and e.value.detail == pop.REFUSAL_SENTENCE
    assert note_ask.writing_help_used(UID, day=DAY) == 0, "the refused draft stayed charged"


def test_COMPASS_CHAT_in_enforce_yields_the_population_refusal_before_storing_anything(store, monkeypatch):
    from api.services.journal_two import coach_chat
    c = sqlite3.connect(store)
    c.execute("CREATE TABLE j2_chat_messages (user_id TEXT, account_id TEXT, role TEXT, created_at TEXT)")
    c.commit()
    c.close()
    monkeypatch.setenv(pop.FLAG, "enforce")
    monkeypatch.setenv(pop.CAP_ENV, "0")
    monkeypatch.setenv("COMPASS_CHAT_ENABLED", "true")
    events = list(coach_chat.handle_user_turn(user_id=UID, account_id="a1", user_message="hi"))
    assert events == [{"type": "error", "code": pop.REFUSAL_CODE, "message": pop.REFUSAL_SENTENCE}]
    c = sqlite3.connect(store)
    assert c.execute("SELECT count(*) FROM j2_chat_messages").fetchone()[0] == 0
    c.close()
