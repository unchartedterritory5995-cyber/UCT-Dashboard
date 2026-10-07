"""Wave 14, lane W14-C2 -- per-tour seen state merged on the SERVER.

`POST /api/auth/preferences` replaces a preference's whole value, so two tabs that each
record a different tour in the same moment each post a map lacking the other's row, and the
later arrival erases the earlier one. `PUT /api/j2/onboarding/tours/{tour_id}` upserts ONE
row inside one SQL statement. These rails prove:

* the merge keeps every other row (sequential AND two real threads racing);
* the CONTROL: a whole-value write -- what the preference endpoint does -- DOES lose a row
  under the same race, so the race rail can fail;
* the door is authenticated, gated (404 dark, nothing written), validated (id, step, state),
  and size-capped (413, nothing written), and a corrupt stored value is treated as `{}`;
* nothing runs at import (the 10/02 boot lesson).

The database is a temp file (`auth_db._DB_PATH`); nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import json
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db, auth_service
from api.services.journal_two import tour_seen_state

U1, U2 = "u-tours-1", "u-tours-2"


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "tours.db"))
    auth_db.init_db()
    return tmp_path


@pytest.fixture
def app(db, monkeypatch):
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import notebook_onboarding

    monkeypatch.setenv("NOTEBOOK_ONBOARDING_ENABLED", "1")
    fa = FastAPI()
    fa.include_router(notebook_onboarding.router)
    # A paid member: the tour write takes a paid plan (owner ruling 2026-10-02, I-7).
    fa.dependency_overrides[get_current_user] = lambda: {"id": U1, "role": "member", "plan": "pro"}
    fa.dependency_overrides[get_current_user_with_plan] = lambda: {"id": U1, "role": "member", "plan": "pro"}
    return fa


def _stored(user_id=U1):
    raw = auth_service.get_user_preferences(user_id).get(tour_seen_state.PREF_KEY)
    return json.loads(raw) if raw else None


# ── the merge ────────────────────────────────────────────────────────────────

def test_one_row_is_written_and_the_whole_map_is_answered(app):
    r = TestClient(app).put("/api/j2/onboarding/tours/tour-a", json={"state": "started", "step": "s1"})
    assert r.status_code == 200, r.text
    assert json.loads(r.json()["value"]) == {"tour-a": {"v": 1, "state": "started", "step": "s1"}}
    assert _stored() == {"tour-a": {"v": 1, "state": "started", "step": "s1"}}


def test_a_second_tour_never_touches_the_first_tours_row(app):
    c = TestClient(app)
    c.put("/api/j2/onboarding/tours/tour-a", json={"state": "done", "step": "last"})
    r = c.put("/api/j2/onboarding/tours/tour-b", json={"state": "dismissed", "step": None})
    assert json.loads(r.json()["value"]) == {
        "tour-a": {"v": 1, "state": "done", "step": "last"},
        "tour-b": {"v": 1, "state": "dismissed", "step": None},
    }


def test_rewriting_a_row_replaces_only_that_row(app):
    c = TestClient(app)
    c.put("/api/j2/onboarding/tours/tour-a", json={"state": "started", "step": "s1"})
    c.put("/api/j2/onboarding/tours/tour-b", json={"state": "started", "step": "x"})
    c.put("/api/j2/onboarding/tours/tour-a", json={"state": "done", "step": "s2"})
    assert _stored() == {
        "tour-a": {"v": 1, "state": "done", "step": "s2"},
        "tour-b": {"v": 1, "state": "started", "step": "x"},
    }


def test_rows_written_by_the_old_whole_value_door_survive_a_merge(db):
    """A member whose map was written by `POST /api/auth/preferences` (every write before
    this route) keeps those rows: the merge starts FROM the stored map."""
    auth_service.set_user_preference(U1, "notebook_tours", json.dumps({"old": {"v": 1, "state": "done", "step": None}}))
    out = tour_seen_state.record(U1, "new", "started", "s1")
    assert out == {"old": {"v": 1, "state": "done", "step": None}, "new": {"v": 1, "state": "started", "step": "s1"}}


@pytest.mark.parametrize("corrupt", ["not json", "[1,2]", "42", '"str"'])
def test_a_stored_value_that_is_not_an_object_reads_as_empty(db, corrupt):
    auth_service.set_user_preference(U1, "notebook_tours", corrupt)
    assert tour_seen_state.record(U1, "tour-a", "done", None) == {"tour-a": {"v": 1, "state": "done", "step": None}}


def test_one_members_rows_never_reach_another_member(db):
    tour_seen_state.record(U1, "tour-a", "done", None)
    tour_seen_state.record(U2, "tour-b", "done", None)
    assert _stored(U1) == {"tour-a": {"v": 1, "state": "done", "step": None}}
    assert _stored(U2) == {"tour-b": {"v": 1, "state": "done", "step": None}}


# ── two tabs at once ─────────────────────────────────────────────────────────

N_TOURS = 24


def _race(writer):
    """Two 'tabs' (threads), each recording its own tours, released together."""
    gate = threading.Barrier(2)
    errors = []

    def tab(prefix):
        try:
            gate.wait()
            for i in range(N_TOURS // 2):
                writer(f"{prefix}-{i}")
        except Exception as e:  # noqa: BLE001 - surfaced below
            errors.append(e)

    threads = [threading.Thread(target=tab, args=(p,)) for p in ("left", "right")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert not errors, errors


def test_two_tabs_recording_different_tours_at_once_lose_no_row(db):
    _race(lambda tid: tour_seen_state.record(U1, tid, "done", None))
    stored = _stored()
    assert len(stored) == N_TOURS, sorted(stored)


def test_CONTROL_a_whole_value_write_under_the_same_race_does_lose_rows(db):
    """The read-modify-write a client does through the whole-value preference door, made
    deliberately interleaving-prone (read, yield, write) the way two tabs' caches are: the
    same race loses rows, so the rail above can fail."""
    import time

    def whole_value(tid):
        raw = auth_service.get_user_preferences(U1).get("notebook_tours")
        current = json.loads(raw) if raw else {}
        time.sleep(0.002)
        current[tid] = {"v": 1, "state": "done", "step": None}
        auth_service.set_user_preference(U1, "notebook_tours", json.dumps(current))

    _race(whole_value)
    assert len(_stored()) < N_TOURS


# ── the door ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["", "-lead", "has space", "a" * 65, 'quo"te', "dot.path", "back\\slash"])
def test_an_invalid_tour_id_is_refused_and_nothing_is_written(app, bad):
    r = TestClient(app).put(f"/api/j2/onboarding/tours/{bad}", json={"state": "done", "step": None})
    assert r.status_code in (400, 404, 405), (bad, r.status_code)
    assert _stored() is None


def test_an_invalid_state_or_step_is_refused(app):
    c = TestClient(app)
    assert c.put("/api/j2/onboarding/tours/tour-a", json={"state": "finished", "step": None}).status_code == 400
    assert c.put("/api/j2/onboarding/tours/tour-a", json={"state": "done", "step": 'x"y'}).status_code == 400
    assert c.put("/api/j2/onboarding/tours/tour-a", json={"step": "s1"}).status_code == 422
    assert _stored() is None


def test_the_map_is_capped_and_a_row_past_the_cap_writes_nothing(app, monkeypatch):
    monkeypatch.setattr(tour_seen_state, "MAX_TOURS", 3)
    c = TestClient(app)
    for i in range(3):
        assert c.put(f"/api/j2/onboarding/tours/t{i}", json={"state": "done", "step": None}).status_code == 200
    r = c.put("/api/j2/onboarding/tours/t9", json={"state": "done", "step": None})
    assert r.status_code == 413
    assert sorted(_stored()) == ["t0", "t1", "t2"]
    # rewriting a row that already exists is always allowed at the cap
    assert c.put("/api/j2/onboarding/tours/t1", json={"state": "started", "step": "s"}).status_code == 200
    assert _stored()["t1"] == {"v": 1, "state": "started", "step": "s"}


def test_the_gate_off_is_404_and_writes_nothing(app, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_ONBOARDING_ENABLED", "0")
    r = TestClient(app).put("/api/j2/onboarding/tours/tour-a", json={"state": "done", "step": None})
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert _stored() is None


def test_an_anonymous_caller_is_refused(db, monkeypatch):
    from api.routers import notebook_onboarding

    monkeypatch.setenv("NOTEBOOK_ONBOARDING_ENABLED", "1")
    fa = FastAPI()
    fa.include_router(notebook_onboarding.router)
    r = TestClient(fa).put("/api/j2/onboarding/tours/tour-a", json={"state": "done", "step": None})
    assert r.status_code == 401
    assert _stored() is None


def test_importing_the_module_does_no_work(monkeypatch):
    """The 10/02 boot lesson: no connection or query at import."""
    import importlib

    calls = []
    monkeypatch.setattr(auth_db, "get_connection", lambda: calls.append(1))
    try:
        importlib.reload(tour_seen_state)
        assert calls == []
    finally:
        monkeypatch.undo()                    # restore the real get_connection FIRST,
        importlib.reload(tour_seen_state)     # then rebind the module to it
    assert tour_seen_state.get_connection is auth_db.get_connection
