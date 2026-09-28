"""TERM-078 (FB-I1-04) -- a member's AI meter reads THE COUNTER THE DOOR SPENDS.

⭐ "Never ship a hard cap without a meter" (F-01 PROD-C1). With one paid tier
there is no tier to explain a refusal (PROD-C2), so the number must be readable
before it runs out -- and it is only worth reading if it is the number the door
enforces.

EVERY RAIL HERE SPENDS THROUGH THE DOOR'S OWN RESERVATION and requires the
meter to move by exactly that much. A meter that read a neighbouring counter
(Ask's meter reading writing help's scope, say) stays still and goes red by
name; a meter computed from a copy of the cap goes red when the door's cap moves.

⛔ UNREADABLE IS NOT ZERO: with the store unreadable the doors fail OPEN
(`daily_counters`' rule), and the meter must say `readable: False`, never show
a full allowance that is not being counted.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import ai_meters, ai_population_cap, daily_counters, note_ask

DAY = "2026-09-25"
UID = "member-7"


@pytest.fixture
def store(tmp_path, monkeypatch):
    from api.services import auth_db
    path = str(tmp_path / "auth.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    monkeypatch.setenv("AUTH_DB_PATH", path)                  # coach_chat reads the env
    # voice_usage binds auth_db.get_connection AT IMPORT. If another suite imported
    # it while get_connection was patched to that suite's temp DB, it keeps the stale
    # binding and this file reads the wrong store (order-dependent red, 2026-09-28).
    from api.services import voice_usage
    monkeypatch.setattr(voice_usage, "get_connection", auth_db.get_connection)
    monkeypatch.setattr(note_ask, "_et_day", lambda: DAY)
    monkeypatch.delenv("NOTEBOOK_WRITING_HELP_PERUSER_CAP", raising=False)
    monkeypatch.delenv(ai_population_cap.FLAG, raising=False)
    c = sqlite3.connect(path)
    c.executescript("""
        CREATE TABLE j2_accounts (id TEXT PRIMARY KEY, user_id TEXT, name TEXT);
        CREATE TABLE j2_chat_messages (user_id TEXT, account_id TEXT, role TEXT,
                                       created_at TEXT, forgotten INTEGER DEFAULT 0);
        CREATE TABLE voice_usage_monthly (
            user_id TEXT NOT NULL, year_month TEXT NOT NULL,
            mode_a_seconds INTEGER NOT NULL DEFAULT 0, mode_b_calls INTEGER NOT NULL DEFAULT 0,
            mode_c_seconds INTEGER NOT NULL DEFAULT 0, mode_d_seconds INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (user_id, year_month));
    """)
    c.commit()
    c.close()
    return path


def _row(out, key):
    rows = [r for r in out["meters"] if r["key"] == key]
    assert len(rows) == 1, (key, [r["key"] for r in out["meters"]])
    return rows[0]


USER = {"id": UID, "role": "member", "plan": "pro"}


# ── Notebook: the durable daily_counters doors ───────────────────────────────

def test_the_ask_meter_moves_when_the_ask_door_spends(store):
    before = _row(ai_meters.meters_for(USER), "notebook_ask")
    assert before["readable"] and before["used"] == 0
    assert before["limit"] == note_ask._SYNTH_PERUSER_CAP == before["remaining"]
    for _ in range(3):
        assert note_ask.reserve_ask(UID) is True               # the DOOR's reservation
    after = _row(ai_meters.meters_for(USER), "notebook_ask")
    assert after["used"] == 3 and after["remaining"] == note_ask._SYNTH_PERUSER_CAP - 3
    note_ask.refund_ask(UID)                                    # ...and its refund
    assert _row(ai_meters.meters_for(USER), "notebook_ask")["used"] == 2


def test_the_ask_meter_does_not_move_when_a_NEIGHBOURING_counter_does(store, monkeypatch):
    """The discriminator: writing help spends a different scope. An Ask meter
    that read it would move here -- this is the mutation the rail exists for."""
    monkeypatch.setenv("NOTEBOOK_WRITING_HELP_ENABLED", "1")
    assert note_ask.reserve_writing_help(UID) is True
    out = ai_meters.meters_for(USER)
    assert _row(out, "notebook_ask")["used"] == 0
    assert _row(out, "notebook_writing_help")["used"] == 1


def test_the_writing_help_meter_follows_the_doors_cap_read_per_call(store, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_WRITING_HELP_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_WRITING_HELP_PERUSER_CAP", "7")
    note_ask.reserve_writing_help(UID)
    row = _row(ai_meters.meters_for(USER), "notebook_writing_help")
    assert (row["used"], row["limit"], row["remaining"]) == (1, 7, 6)


def test_a_dark_door_shows_no_meter(store, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_WRITING_HELP_ENABLED", raising=False)
    keys = [r["key"] for r in ai_meters.meters_for(USER)["meters"]]
    assert "notebook_writing_help" not in keys and "notebook_ask" in keys


# ── AI Search (in-process authority) ─────────────────────────────────────────

@pytest.fixture
def ai_search_counters(monkeypatch):
    import api.routers.ai_search as ai
    ai._usage_day = ""
    ai._usage_by_user = {}
    ai._usage_global = 0
    ai._usage_seeded_day = ai._et_day()                # no ledger re-seed mid-test
    monkeypatch.setattr(ai, "_persist_usage", lambda key, delta: None)
    return ai


def test_the_ai_search_meter_moves_when_the_ai_search_door_spends(store, ai_search_counters):
    ai = ai_search_counters
    assert _row(ai_meters.meters_for(USER), "ai_search")["used"] == 0
    ai._reserve(UID, 3)
    row = _row(ai_meters.meters_for(USER), "ai_search")
    assert (row["used"], row["limit"]) == (3, ai._user_daily_limit())
    ai._refund(UID, 1)
    assert _row(ai_meters.meters_for(USER), "ai_search")["used"] == 2


def test_the_personal_synth_meter_reads_the_synth_gates_own_dict(store, ai_search_counters, monkeypatch):
    from api.services import ai_search_personal as asp
    monkeypatch.setenv("AI_SEARCH_PERSONAL_ENABLED", "1")
    asp._reset_synth_counters()
    uid = ai_search_counters._personal_uid(USER)
    assert asp.reserve_synth(uid) is True
    row = _row(ai_meters.meters_for(USER), "ai_search_personal")
    assert (row["used"], row["limit"]) == (1, asp._SYNTH_PERUSER_CAP)


# ── Options Flow explain (flow_explain.db) ───────────────────────────────────

def test_the_flow_explain_meter_reads_the_doors_own_table(store, tmp_path, monkeypatch):
    from api import flow_explain as fe
    monkeypatch.setenv("FLOW_EXPLAIN_DB_PATH", str(tmp_path / "flow_explain.db"))
    today = fe._today_et()
    assert _row(ai_meters.meters_for(USER), "flow_explain")["used"] == 0
    fe._bump_user_count(UID, today)                            # the DOOR's increment
    fe._bump_user_count(UID, today)
    row = _row(ai_meters.meters_for(USER), "flow_explain")
    assert (row["used"], row["limit"]) == (2, fe._user_daily_cap())


# ── Compass chat (j2_chat_messages, per account) ─────────────────────────────

def test_the_compass_chat_meter_is_per_account_and_reads_the_doors_count(store):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    c = sqlite3.connect(store)
    c.executemany("INSERT INTO j2_accounts VALUES (?,?,?)",
                  [("a1", UID, "Swing"), ("a2", UID, "IRA"), ("zz", "someone-else", "X")])
    c.executemany("INSERT INTO j2_chat_messages (user_id, account_id, role, created_at) VALUES (?,?,?,?)",
                  [(UID, "a1", "user", now), (UID, "a1", "user", now),
                   (UID, "a1", "assistant", now), (UID, "a2", "user", now)])
    c.commit()
    c.close()
    out = ai_meters.meters_for(USER)
    assert _row(out, "compass_chat:a1")["used"] == 2           # assistant turns are not counted
    assert _row(out, "compass_chat:a2")["used"] == 1
    assert not any(r["key"] == "compass_chat:zz" for r in out["meters"])
    assert _row(out, "compass_chat:a1")["resets"] == "midnight UTC"


# ── Compass voice (voice_usage_monthly) ──────────────────────────────────────

def test_the_voice_meters_move_when_the_voice_doors_record(store):
    from api.services import voice_usage
    voice_usage.record_mode_b_call(UID)
    voice_usage.record_mode_d_seconds(UID, 120)
    out = ai_meters.meters_for(USER)
    assert _row(out, "voice_one_shot")["used"] == 1
    assert _row(out, "voice_one_shot")["limit"] == voice_usage.MODE_B_DEFAULT_CAP_CALLS
    assert _row(out, "voice_dictation")["used"] == 2           # 120 s = 2 minutes
    assert _row(out, "voice_read_aloud")["used"] == 0


def test_an_admin_is_shown_uncapped_voice_because_the_door_does_not_cap_them(store):
    out = ai_meters.meters_for({"id": UID, "role": "admin", "plan": "pro"})
    row = _row(out, "voice_one_shot")
    assert row["uncapped"] is True and row["limit"] is None and row["remaining"] is None


# ── ⛔ fail-open: an unreadable store is said, never shown as zero ────────────

def test_an_unreadable_counter_store_reads_as_unreadable_and_the_door_still_admits(store, monkeypatch):
    from api.services import auth_db

    def broken():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(auth_db, "get_connection", broken)
    out = ai_meters.meters_for(USER)
    ask = _row(out, "notebook_ask")
    assert ask["readable"] is False and ask["used"] is None and ask["remaining"] is None
    assert out["all_readable"] is False
    # ...and the door itself is not blocked by the same failure (its own rule)
    assert note_ask.reserve_ask(UID) is True


def test_daily_counters_read_distinguishes_unreadable_from_zero(store, monkeypatch):
    assert daily_counters.read(DAY, "nothing-here", UID) == 0.0
    from api.services import auth_db
    monkeypatch.setattr(auth_db, "get_connection",
                        lambda: (_ for _ in ()).throw(sqlite3.OperationalError("x")))
    assert daily_counters.read(DAY, "nothing-here", UID) is None
    assert daily_counters.value(DAY, "nothing-here", UID) == 0.0   # value keeps its old contract


# ── the population block ─────────────────────────────────────────────────────

def test_the_population_cap_is_shown_only_while_it_can_refuse(store, monkeypatch):
    assert ai_meters.meters_for(USER)["population"] == {"enforced": False}
    monkeypatch.setenv(ai_population_cap.FLAG, "shadow")
    assert ai_meters.meters_for(USER)["population"] == {"enforced": False}
    monkeypatch.setenv(ai_population_cap.FLAG, "enforce")
    monkeypatch.setenv(ai_population_cap.CAP_ENV, "4")
    ai_population_cap.admit("t")
    pop = ai_meters.meters_for(USER)["population"]
    assert pop["enforced"] is True and pop["readable"] is True
    assert pop["pct_used"] == 25 and pop["reached"] is False
    assert "used" not in pop and "limit" not in pop           # no membership volume to members
    assert "message" not in pop
    for _ in range(3):
        ai_population_cap.admit("t")
    pop = ai_meters.meters_for(USER)["population"]
    assert pop["reached"] is True and pop["pct_used"] == 100
    assert pop["message"] == ai_population_cap.REFUSAL_SENTENCE   # the refusal, verbatim


# ── the route ────────────────────────────────────────────────────────────────

def test_the_meters_route_is_paid_gated_and_answers_the_members_own_meters(store, ai_search_counters):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    ai = ai_search_counters
    app = FastAPI()
    app.include_router(ai.router)
    assert TestClient(app).get("/api/ai-search/meters").status_code in (401, 403)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": UID, "role": "member", "plan": "free"}
    assert TestClient(app).get("/api/ai-search/meters").status_code == 402
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(USER)
    note_ask.reserve_ask(UID)
    r = TestClient(app).get("/api/ai-search/meters")
    assert r.status_code == 200
    assert _row(r.json(), "notebook_ask")["used"] == 1
