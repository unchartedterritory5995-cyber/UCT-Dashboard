"""Ask Current Note (Wave 2, P0-5) — unit + HTTP integration + adversarial +
multi-user isolation tests.

Real router, real DB (tmp path), real require_paid gate (dependency override
on get_current_user_with_plan, its INPUT, never on require_paid itself —
overriding the gate means never running it, per the same lesson recorded in
test_ai_search_audit_fixes.py). synthesize() is monkeypatched to an async
generator so no real Anthropic call is ever made.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import note_ask
from api.services.journal_two.db import ensure_schema

PAID = {"id": "u1", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "u1", "email": "free@example.test", "role": "member", "plan": "free"}


@pytest.fixture(autouse=True)
def _reset_note_ask_counters():
    note_ask._synth_day = ""
    note_ask._synth_by_user = {}
    note_ask._synth_spend = 0.0
    yield
    note_ask._synth_day = ""
    note_ask._synth_by_user = {}
    note_ask._synth_spend = 0.0


async def _fake_ok_synthesize(query, note_title, note_block, history):
    yield "The note says "
    yield '"margins compressed" '
    yield "in Q3."


async def _fake_raising_synthesize(query, note_title, note_block, history):
    if False:
        yield ""  # pragma: no cover — makes this a real async generator
    raise RuntimeError("boom")


async def _fake_empty_synthesize(query, note_title, note_block, history):
    if False:
        yield ""  # pragma: no cover


@pytest.fixture()
def two_user_clients(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_ask.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    conn.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    monkeypatch.setattr(note_ask, "synthesize", _fake_ok_synthesize)

    def _client_for(user):
        app = FastAPI()
        app.include_router(journal_two.router)
        app.dependency_overrides[get_current_user] = lambda u=user: dict(u)
        app.dependency_overrides[get_current_user_with_plan] = lambda u=user: dict(u)
        return TestClient(app)

    return _client_for(PAID), _client_for({**PAID, "id": "u2"})


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_ask_single.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(auth_db._SCHEMA)  # users/activity_log (Stage A telemetry)
    ensure_schema(conn)
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, created_at)"
        " VALUES (?,?,?,?,?,datetime('now'))",
        (PAID["id"], PAID["email"], "x", "U1", "member"),
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    monkeypatch.setattr(note_ask, "synthesize", _fake_ok_synthesize)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    return TestClient(app)


def _events(resp):
    out = []
    for block in resp.text.split("\n\n"):
        if block.startswith("data: "):
            out.append(json.loads(block[len("data: "):]))
    return out


# ── Unit: reserve/refund ─────────────────────────────────────────────────

def test_reserve_is_atomic_and_caps(monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 2)
    monkeypatch.setattr(note_ask, "_et_day", lambda: "2026-09-05")
    assert note_ask.reserve_ask("u1") is True
    assert note_ask.reserve_ask("u1") is True
    assert note_ask.reserve_ask("u1") is False  # third call over the per-user cap
    assert note_ask.reserve_ask("u2") is True   # a different user has their own bucket


def test_refund_gives_back_the_reservation(monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 1)
    monkeypatch.setattr(note_ask, "_et_day", lambda: "2026-09-05")
    assert note_ask.reserve_ask("u1") is True
    assert note_ask.reserve_ask("u1") is False
    note_ask.refund_ask("u1")
    assert note_ask.reserve_ask("u1") is True  # the refund freed the slot back up


def test_refund_never_underflows(monkeypatch):
    monkeypatch.setattr(note_ask, "_et_day", lambda: "2026-09-05")
    note_ask.refund_ask("never-reserved")  # must not raise or go negative
    assert note_ask._synth_by_user.get("never-reserved", 0) == 0


def test_global_cap_blocks_regardless_of_per_user_room(monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_GLOBAL_HARD", 0.01)
    monkeypatch.setattr(note_ask, "_et_day", lambda: "2026-09-05")
    assert note_ask.reserve_ask("u1") is False


def test_assemble_note_block_caps_length():
    huge = "x" * 50000
    out = note_ask.assemble_note_block(huge)
    assert len(out) == note_ask._NOTE_BODY_CAP


def test_assemble_note_block_handles_none():
    assert note_ask.assemble_note_block(None) == ""


# ── Semantic: the system prompt says the right things ────────────────────

def test_system_prompt_has_historical_claim_contract_not_freshness_firewall():
    system = note_ask.SYNTH_SYSTEM("My NVDA thesis", "margins compressed in Q3")
    assert "HISTORICAL-CLAIM" in system
    assert "historical claim" in system
    # The literal ai_search_personal.py phrase must NOT be copied — Notebook
    # needs the opposite contract (architecture spec §8.1).
    assert "FRESHNESS FIREWALL" not in system
    assert "never override a live number with a stale personal one" not in system


def test_system_prompt_forbids_fabrication_and_names_the_note():
    system = note_ask.SYNTH_SYSTEM("Q3 Earnings Prep", "revenue beat, guidance cut")
    assert "Never invent a fact" in system
    assert "Q3 Earnings Prep" in system
    assert "revenue beat, guidance cut" in system


def test_system_prompt_includes_citation_quoting_instruction():
    system = note_ask.SYNTH_SYSTEM("t", "body")
    assert "double quotes" in system.lower() or "\"double quotes\"" in system


# ── HTTP integration: happy path, validation, ownership ───────────────────

def test_ask_current_note_happy_path_streams_delta_then_final(client):
    note = client.post("/api/j2/notes", json={"title": "NVDA thesis",
                                                "bodyJson": {"type": "doc", "content": []}}).json()["note"]
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "what did I say about margins"})
    assert r.status_code == 200
    events = _events(r)
    assert any(e["type"] == "delta" for e in events)
    final = [e for e in events if e["type"] == "final"][0]
    assert "margins compressed" in final["answer"]


def test_empty_query_rejected(client):
    note = client.post("/api/j2/notes", json={"title": "t"}).json()["note"]
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "  "})
    assert r.status_code == 422


def test_overlong_query_rejected(client):
    note = client.post("/api/j2/notes", json={"title": "t"}).json()["note"]
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "x" * 2001})
    assert r.status_code == 422


def test_missing_note_is_404(client):
    r = client.post("/api/j2/notes/does-not-exist/ask/stream", json={"query": "anything"})
    assert r.status_code == 404


def test_free_user_is_rejected_with_402(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import journal_two

    db_path = str(tmp_path / "j2_notes_ask_free.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    conn.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    monkeypatch.setattr(note_ask, "synthesize", _fake_ok_synthesize)

    app = FastAPI()
    app.include_router(journal_two.router)
    # Note: overriding get_current_user_with_plan (the gate's INPUT), never
    # require_paid itself — the real gate function still runs and must be
    # what actually produces the 402.
    app.dependency_overrides[get_current_user] = lambda: dict(FREE)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(FREE)
    c = TestClient(app)

    note = c.post("/api/j2/notes", json={"title": "t"}).json()["note"]
    r = c.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "anything"})
    assert r.status_code == 402
    assert r.json()["detail"] == "Ask Current Note requires a paid plan"


def test_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 0)
    note = client.post("/api/j2/notes", json={"title": "t"}).json()["note"]
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "anything"})
    assert r.status_code == 429


def test_failed_synthesis_refunds_the_reservation(client, monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 1)
    monkeypatch.setattr(note_ask, "synthesize", _fake_raising_synthesize)
    note = client.post("/api/j2/notes", json={"title": "t"}).json()["note"]
    r1 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "q1"})
    assert r1.status_code == 200  # the stream itself opens fine; the error is IN the SSE body
    events = _events(r1)
    assert any(e["type"] == "error" for e in events)
    # The failed call must have been refunded -- a second call still fits under cap=1.
    r2 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "q2"})
    assert r2.status_code == 200


def test_empty_answer_refunds_the_reservation(client, monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 1)
    monkeypatch.setattr(note_ask, "synthesize", _fake_empty_synthesize)
    note = client.post("/api/j2/notes", json={"title": "t"}).json()["note"]
    r1 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "q1"})
    assert r1.status_code == 200
    r2 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "q2"})
    assert r2.status_code == 200  # refunded, so this still fits under cap=1


# ── Multi-user isolation (HTTP layer) ─────────────────────────────────────

def test_a_member_cannot_ask_about_another_members_note(two_user_clients):
    c1, c2 = two_user_clients
    note = c1.post("/api/j2/notes", json={"title": "u1 private note"}).json()["note"]
    r = c2.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "what does this say"})
    assert r.status_code == 404  # not "200 but empty" -- a flat ownership 404


def test_isolation_does_not_leak_via_error_message(two_user_clients):
    c1, c2 = two_user_clients
    note = c1.post("/api/j2/notes", json={"title": "secret thesis on NVDA"}).json()["note"]
    r = c2.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "q"})
    assert "secret thesis" not in r.text
    assert "NVDA" not in r.text


# ── Stage A member-validation instrumentation (decision-log "Stage A→B
# gate" entry, 2026-09-06) ─────────────────────────────────────────────────

def test_a_successful_ask_logs_the_stage_a_validation_event(client):
    from api.services import auth_db
    note = client.post("/api/j2/notes", json={"title": "margins note"}).json()["note"]
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "what happened to margins"})
    assert r.status_code == 200

    conn = sqlite3.connect(auth_db._DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT action, details FROM activity_log"
        " WHERE user_id = ? AND action = 'j2:notebook_ask_current_note_used'",
        (PAID["id"],),
    ).fetchall()
    conn.close()
    assert len(rows) == 1
    details = json.loads(rows[0]["details"])
    assert details == {"settled": True, "hadAnswer": True}
    # Privacy contract: never the question text or the note content.
    assert "margins" not in rows[0]["details"]
