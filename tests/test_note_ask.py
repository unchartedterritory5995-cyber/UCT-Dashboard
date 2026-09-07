"""Ask Current Note (Wave 2, P0-5) — unit + HTTP integration + adversarial +
multi-user isolation tests.

Real router, real DB (tmp path), real require_paid gate (dependency override
on get_current_user_with_plan, its INPUT, never on require_paid itself —
overriding the gate means never running it, per the same lesson recorded in
test_ai_search_audit_fixes.py).

⛔ THE SEAM MOVED IN SLICE 6. `note_ask.synthesize` no longer exists: this
module is now only the reservation ledger, because its prompt builder put
member note text into `system=`. The transport is
`ask_service.synthesize(kwargs)`, which takes an ALREADY-BUILT request and so
has no way to assemble a prompt at all. Everything these tests actually assert
-- reserve/refund, the caps, 402/404/422/429, tenant isolation, telemetry --
is unchanged and still runs against the real router.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import note_ask
from api.services.journal_two import ask_service
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


async def _fake_ok_synthesize(kwargs):
    yield "Margins compressed "
    yield "in Q3 [1]."


async def _fake_raising_synthesize(kwargs):
    if False:
        yield ""  # pragma: no cover — makes this a real async generator
    raise RuntimeError("boom")


async def _fake_empty_synthesize(kwargs):
    if False:
        yield ""  # pragma: no cover


def _body(text):
    """A TipTap doc the note-scope retriever can actually split into blocks.

    ⛔ NOT AN EMPTY DOC. Wave 2 sent the whole note to the model regardless, so
    an empty note still produced an answer; Slice 6 answers from retrieved
    blocks, so an empty note now correctly refuses WITHOUT a provider call.
    A test that wants the synthesis path must give the note something to find.
    """
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _note_with_body(c, title, text):
    return c.post("/api/j2/notes",
                  json={"title": title, "bodyJson": _body(text)}).json()["note"]


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
    monkeypatch.setattr(ask_service, "synthesize", _fake_ok_synthesize)

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
    monkeypatch.setattr(ask_service, "synthesize", _fake_ok_synthesize)

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


# ── HTTP integration: happy path, validation, ownership ───────────────────

def test_ask_current_note_happy_path_streams_sources_delta_then_final(client):
    note = _note_with_body(client, "NVDA thesis", "margins compressed in Q3")
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream",
                    json={"query": "what did I say about margins"})
    assert r.status_code == 200
    events = _events(r)
    # sources arrive FIRST so the client can validate a handle the moment it
    # appears, rather than after the answer has been rendered.
    assert events[0]["type"] == "sources"
    assert events[0]["scopeLabel"] == "This note"
    assert events[0]["sources"], "the note block should have been retrieved"
    assert any(e["type"] == "delta" for e in events)
    final = [e for e in events if e["type"] == "final"][0]
    assert "Margins compressed" in final["answer"]
    assert final["cited"] == [1] and final["invalidCitations"] == []


def test_an_empty_note_refuses_without_calling_the_model(client, monkeypatch):
    """⛔ NO ANSWER MEANS NO PROVIDER CALL. Paying a model to say "I could not
    find that" asks the one component able to invent an answer to decline to."""
    called = {"n": 0}

    async def _must_not_run(kwargs):
        called["n"] += 1
        yield "should never be produced"

    monkeypatch.setattr(ask_service, "synthesize", _must_not_run)
    note = client.post("/api/j2/notes", json={"title": "empty"}).json()["note"]
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream",
                    json={"query": "what did I say about margins"})
    assert r.status_code == 200
    events = _events(r)
    assert called["n"] == 0
    assert events[0]["noAnswer"] is True
    final = [e for e in events if e["type"] == "final"][0]
    assert "couldn\'t find that in this note" in final["answer"]


def test_a_refusal_does_not_burn_the_daily_allowance(client, monkeypatch):
    # No provider call means no cost, so it must not spend the member's cap.
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 1)
    note = client.post("/api/j2/notes", json={"title": "empty"}).json()["note"]
    r1 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "anything at all"})
    assert r1.status_code == 200
    # The one paid slot is still available for a question that can be answered.
    real = _note_with_body(client, "NVDA", "margins compressed in Q3")
    r2 = client.post(f"/api/j2/notes/{real['id']}/ask/stream", json={"query": "margins"})
    assert r2.status_code == 200


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
    monkeypatch.setattr(ask_service, "synthesize", _fake_ok_synthesize)

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
    assert r.json()["detail"] == "Notebook Ask requires a paid plan"


def test_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 0)
    note = _note_with_body(client, "t", "margins compressed in Q3")
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r.status_code == 429


def test_failed_synthesis_refunds_the_reservation(client, monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 1)
    monkeypatch.setattr(ask_service, "synthesize", _fake_raising_synthesize)
    note = _note_with_body(client, "t", "margins compressed in Q3")
    r1 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r1.status_code == 200  # the stream itself opens fine; the error is IN the SSE body
    events = _events(r1)
    assert any(e["type"] == "error" for e in events)
    # The failed call must have been refunded -- a second call still fits under cap=1.
    r2 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r2.status_code == 200


def test_empty_answer_refunds_the_reservation(client, monkeypatch):
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 1)
    monkeypatch.setattr(ask_service, "synthesize", _fake_empty_synthesize)
    note = _note_with_body(client, "t", "margins compressed in Q3")
    r1 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r1.status_code == 200
    r2 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r2.status_code == 200  # refunded, so this still fits under cap=1


# ── Concurrency (Slice 7) ─────────────────────────────────────────────────

def test_a_finished_stream_releases_its_concurrency_slot(client, monkeypatch):
    """A slot that leaks locks the member out until the process restarts."""
    monkeypatch.setattr(note_ask, "_MAX_CONCURRENT", 1)
    note = _note_with_body(client, "t", "margins compressed in Q3")
    for _ in range(3):
        r = client.post(f"/api/j2/notes/{note['id']}/ask/stream",
                        json={"query": "margins"})
        assert r.status_code == 200


def test_a_failed_stream_still_releases_its_slot(client, monkeypatch):
    # The finally has to survive the failure path too, or one provider error
    # costs the member every subsequent question.
    monkeypatch.setattr(note_ask, "_MAX_CONCURRENT", 1)
    monkeypatch.setattr(ask_service, "synthesize", _fake_raising_synthesize)
    note = _note_with_body(client, "t", "margins compressed in Q3")
    r1 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r1.status_code == 200
    assert any(e["type"] == "error" for e in _events(r1))
    r2 = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r2.status_code == 200


def test_too_many_open_streams_is_a_429_that_does_not_charge(client, monkeypatch):
    monkeypatch.setattr(note_ask, "_MAX_CONCURRENT", 0)
    monkeypatch.setattr(note_ask, "_SYNTH_PERUSER_CAP", 1)
    note = _note_with_body(client, "t", "margins compressed in Q3")
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert r.status_code == 429
    assert "in progress" in r.json()["detail"]
    # The reservation was refunded, so the member did not pay for being told
    # to wait: the one daily slot is still theirs.
    assert note_ask._synth_by_user.get(PAID["id"], 0) == 0


# ── Multi-user isolation (HTTP layer) ─────────────────────────────────────

def test_a_member_cannot_ask_about_another_members_note(two_user_clients):
    c1, c2 = two_user_clients
    note = c1.post("/api/j2/notes", json={"title": "u1 private note"}).json()["note"]
    r = c2.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "what does this say"})
    assert r.status_code == 404  # not "200 but empty" -- a flat ownership 404


def test_isolation_does_not_leak_via_error_message(two_user_clients):
    c1, c2 = two_user_clients
    note = _note_with_body(c1, "secret thesis on NVDA", "margins compressed in Q3")
    r = c2.post(f"/api/j2/notes/{note['id']}/ask/stream", json={"query": "margins"})
    assert "secret thesis" not in r.text
    assert "NVDA" not in r.text


# ── Stage A member-validation instrumentation (decision-log "Stage A→B
# gate" entry, 2026-09-06) ─────────────────────────────────────────────────

def test_a_successful_ask_logs_the_stage_a_validation_event(client):
    """Stage A telemetry survives the unification under ONE event name with a
    `scope` field. The historical series is `j2:notebook_ask_current_note_used`;
    from Slice 6 it continues as `j2:notebook_ask_used` with scope='note'."""
    from api.services import auth_db
    note = _note_with_body(client, "margins note", "margins compressed in Q3")
    r = client.post(f"/api/j2/notes/{note['id']}/ask/stream",
                    json={"query": "what happened to margins"})
    assert r.status_code == 200

    conn = sqlite3.connect(auth_db._DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT action, details FROM activity_log"
        " WHERE user_id = ? AND action = 'j2:notebook_ask_used'",
        (PAID["id"],),
    ).fetchall()
    conn.close()
    assert len(rows) == 1
    details = json.loads(rows[0]["details"])
    assert details["settled"] is True and details["hadAnswer"] is True
    assert details["scope"] == "note"
    assert details["sources"] >= 1 and details["citedCount"] == 1
    assert details["hallucinatedCitation"] is False

    # ⛔ AGGREGATE ONLY. The question, the answer, the note body and the note
    # TITLE are all member content; a telemetry row is not the place for any
    # of them. The route this replaced logged `query={query!r}` to the process
    # log -- that was a defect, not a precedent.
    blob = json.dumps(details).lower()
    for secret in ("margins", "what happened", "compressed", "q3", "margins note"):
        assert secret not in blob, f"telemetry leaked member content: {secret!r}"
    # Privacy contract: never the question text or the note content.
    assert "margins" not in rows[0]["details"]
