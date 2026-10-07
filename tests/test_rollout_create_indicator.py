"""CONTROLLED MEMBER ROLLOUT — Create Indicator's authorization matrix.

The lock is ``require_create_indicator_access`` on ``POST /api/user-definitions/converse``:
an ADMIN, or a member ``rollout_gate.create_indicator_enabled_for`` releases (the
``CREATE_INDICATOR_COHORT_ENABLED`` flag FIRST, then an admin-written cohort tag).
Everything else is refused exactly as before (403; free users 402 first).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import auth_db, rollout, rollout_gate as rg

COHORT = rg.CREATE_INDICATOR_COHORT
FLAG = rg.CREATE_INDICATOR_FLAG_ENV
MEMBER, OTHER, ADMIN = "ci-member", "ci-other", "ci-admin"


@pytest.fixture
def people(tmp_path, monkeypatch):
    """An isolated auth.db built by the product's own ``init_db()`` (the
    kill-switch rail's fixture), with three paid people and nobody tagged."""
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(path))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth_db.init_db()
    conn = auth_db.get_connection()
    try:
        for uid, role in ((MEMBER, "member"), (OTHER, "member"), (ADMIN, "admin")):
            conn.execute("INSERT OR IGNORE INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
                         (uid, f"{uid}@example.test", "x", role))
        conn.commit()
    finally:
        conn.close()
    yield


@pytest.fixture
def http(monkeypatch):
    """The real router; only the IDENTITY is overridden and the model is never
    reached (a sentinel answers the service call)."""
    app = FastAPI()
    app.include_router(router_mod.router)
    state = {"user": None}
    app.dependency_overrides[get_current_user_with_plan] = lambda: state["user"]
    app.dependency_overrides[get_current_user] = lambda: state["user"]
    from api.services import definition_conversation as conv
    calls = []
    monkeypatch.setattr(conv, "converse", lambda *a, **k: calls.append(k) or {"ok": True, "sentinel": True})
    router_mod._propose_calls.clear()
    yield TestClient(app, raise_server_exceptions=False), state, calls
    router_mod._propose_calls.clear()


def person(uid, role="member", plan="pro"):
    return {"id": uid, "email": f"{uid}@example.test", "role": role, "plan": plan}


def post(client, **extra):
    return client.post("/api/user-definitions/converse",
                       json={"message": "Add a 20 EMA.", "view": {}, **extra})


@pytest.mark.parametrize("flag", [None, "0", "1"])
def test_admin_is_allowed_whatever_the_flag(people, http, monkeypatch, flag):
    client, state, calls = http
    if flag is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, flag)
    state["user"] = person(ADMIN, "admin")
    assert post(client).status_code == 200 and calls[-1]["admin"] is True


def test_a_paid_member_outside_the_cohort_is_refused_even_with_the_flag_ON(people, http, monkeypatch):
    client, state, calls = http
    monkeypatch.setenv(FLAG, "1")
    state["user"] = person(OTHER)
    assert post(client).status_code == 403 and not calls


@pytest.mark.parametrize("flag", [None, "0", "banana", "treu"])
def test_a_tagged_member_is_refused_while_the_flag_is_not_ON(people, http, monkeypatch, flag):
    client, state, calls = http
    rollout.assign_cohort(COHORT, [MEMBER])
    if flag is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, flag)
    state["user"] = person(MEMBER)
    assert post(client).status_code == 403 and not calls


def test_a_tagged_member_is_allowed_with_the_flag_ON_and_gets_the_MEMBER_cap(people, http, monkeypatch):
    client, state, calls = http
    rollout.assign_cohort(COHORT, [MEMBER])
    monkeypatch.setenv(FLAG, "1")
    state["user"] = person(MEMBER)
    assert post(client).status_code == 200
    assert calls[-1]["admin"] is False and calls[-1]["user_id"] == MEMBER


def test_REMOVAL_takes_effect_on_the_next_request_with_no_restart(people, http, monkeypatch):
    client, state, calls = http
    rollout.assign_cohort(COHORT, [MEMBER])
    monkeypatch.setenv(FLAG, "1")
    state["user"] = person(MEMBER)
    assert post(client).status_code == 200
    rollout.remove_from_cohort(COHORT, [MEMBER])
    assert post(client).status_code == 403


def test_the_KILL_SWITCH_stops_every_member_at_once_and_deletes_no_tag(people, http, monkeypatch):
    client, state, calls = http
    rollout.assign_cohort(COHORT, [MEMBER])
    monkeypatch.setenv(FLAG, "1")
    state["user"] = person(MEMBER)
    assert post(client).status_code == 200
    monkeypatch.setenv(FLAG, "0")
    assert post(client).status_code == 403
    assert rollout.includes(MEMBER, COHORT) is True        # the switch is never a delete
    monkeypatch.setenv(FLAG, "1")
    assert post(client).status_code == 200                 # back on, nobody re-tagged


def test_one_members_tag_never_admits_another(people, http, monkeypatch):
    client, state, calls = http
    rollout.assign_cohort(COHORT, [MEMBER])
    monkeypatch.setenv(FLAG, "1")
    state["user"] = person(OTHER)
    assert post(client).status_code == 403


def test_a_member_cannot_self_grant_through_the_request_or_identity_fields(people, http, monkeypatch):
    """The door reads no access field from the body, and a `cohorts` key on the
    identity is not the store (rollout_gate: an admin-written tag, NEVER preferences)."""
    client, state, calls = http
    monkeypatch.setenv(FLAG, "1")
    state["user"] = {**person(OTHER), "cohorts": [COHORT]}
    r = post(client, cohorts=[COHORT], admin=True, role="admin")
    assert r.status_code == 403 and not calls


def test_anonymous_is_refused():
    from api.main import app
    r = TestClient(app).post("/api/user-definitions/converse", json={"message": "x", "view": {}})
    assert r.status_code == 401


def test_a_free_user_is_refused_before_the_cohort_is_consulted(people, http, monkeypatch):
    client, state, calls = http
    rollout.assign_cohort(COHORT, [MEMBER])
    monkeypatch.setenv(FLAG, "1")
    state["user"] = person(MEMBER, plan="free")
    assert post(client).status_code in (402, 403) and not calls


def test_the_effective_client_cohorts_follow_the_switch(people, monkeypatch):
    rollout.assign_cohort(COHORT, [MEMBER])
    monkeypatch.delenv(FLAG, raising=False)
    assert COHORT not in rg.client_cohorts(MEMBER)
    monkeypatch.setenv(FLAG, "1")
    assert COHORT in rg.client_cohorts(MEMBER)
    assert COHORT not in rg.client_cohorts(OTHER)


def test_the_ledger_declares_the_flag_with_the_readers_default():
    flags = json.loads(Path("docs/feature_flags.json").read_text(encoding="utf-8"))["flags"]
    assert flags[FLAG]["default"] == rg.CREATE_INDICATOR_FLAG_DEFAULT == "0"
    assert flags[FLAG]["status"] == "pending"
