"""UCT Agent: the MEMBER DOOR (UCT_AGENT_MEMBERS_ENABLED).

Decided 2026-11-24 by the integrator under the owner's delegation of 2026-11-24 ("you decide it all and get it all
done"; docs/feature_flags.json flags.UCT_AGENT_MEMBERS_ENABLED): the Agent opens to PAID members behind a switch.
`1` lets every paid account in; unset or any other value keeps the admin-only Agent exactly as before (the emergency
off). The paid-plan check (402) always holds, and the budget page (GET /api/agent/budget) stays admin-only.

Pinned here:
  * the exact-value semantics of the switch (only `1`, surrounding spaces ignored);
  * the door itself (`require_admin_dark`) with the switch off and on, and the budget page's own admin-only door;
  * STRUCTURE: every /api/agent/* route passes the paid check and one of the two doors, the budget page the
    admin-only one and nothing else the admin-only one, so no route can be left behind when the switch flips;
  * the auth payload's `uct_agent_members_enabled` (the browser's first answer): explicit False while off, True only
    for a PAID account while on;
  * /api/agent/config's `members`.
The same doors through the REAL app and auth chain: tests/test_uct_agent_qa_member_refused.py (switch off and on).
"""
from __future__ import annotations

import importlib

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

rx = importlib.import_module("api.routers.uct_agent")
auth = importlib.import_module("api.routers.auth")

ENV = "UCT_AGENT_MEMBERS_ENABLED"
ADMIN = {"id": "5d1f0a9e-7b2c-4e11-9a3d-0c7e2f4b1a01", "plan": "pro", "role": "admin"}
MEMBER = {"id": "5d1f0a9e-7b2c-4e11-9a3d-0c7e2f4b1a02", "plan": "pro", "role": "user"}


@pytest.fixture(autouse=True)
def _door_unset(monkeypatch):
    monkeypatch.delenv(ENV, raising=False)
    yield


# ── the switch: only `1` opens it ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["1", " 1 ", "1\n"])
def test_the_member_switch_opens_only_on_exactly_1(monkeypatch, value):
    monkeypatch.setenv(ENV, value)
    assert rx.members_enabled() is True


@pytest.mark.parametrize("value", ["", "0", "true", "on", "yes", "admin", "2", "01", "1,admin"])
def test_any_other_member_switch_value_keeps_the_agent_admin_only(monkeypatch, value):
    monkeypatch.setenv(ENV, value)
    assert rx.members_enabled() is False


def test_the_member_switch_unset_is_admin_only():
    assert rx.members_enabled() is False


def test_the_switch_name_is_the_ledgered_one():
    assert rx.MEMBERS_ENV == ENV


# ── the doors, called directly ────────────────────────────────────────────────────────────────────────

def test_door_closed_a_paid_member_is_refused_403_and_an_admin_passes():
    with pytest.raises(HTTPException) as e:
        rx.require_admin_dark(dict(MEMBER))
    assert e.value.status_code == 403
    assert rx.require_admin_dark(dict(ADMIN))["id"] == ADMIN["id"]


def test_door_open_a_paid_member_passes_and_an_admin_still_passes(monkeypatch):
    monkeypatch.setenv(ENV, "1")
    assert rx.require_admin_dark(dict(MEMBER))["id"] == MEMBER["id"]
    assert rx.require_admin_dark(dict(ADMIN))["id"] == ADMIN["id"]


@pytest.mark.parametrize("value", [None, "1"])
def test_the_budget_door_is_admin_only_whatever_the_switch_says(monkeypatch, value):
    if value is not None:
        monkeypatch.setenv(ENV, value)
    with pytest.raises(HTTPException) as e:
        rx.require_admin_always(dict(MEMBER))
    assert e.value.status_code == 403
    assert rx.require_admin_always(dict(ADMIN))["id"] == ADMIN["id"]


@pytest.mark.parametrize("value", [None, "1"])
def test_an_unpaid_account_is_refused_402_by_the_plan_gate_whatever_the_switch_says(monkeypatch, value):
    if value is not None:
        monkeypatch.setenv(ENV, value)
    monkeypatch.setattr(rx, "is_paid_user", lambda u: u.get("plan") != "free")
    with pytest.raises(HTTPException) as e:
        rx.require_paid({**MEMBER, "plan": "free"})
    assert e.value.status_code == 402


# ── STRUCTURE: every route is behind the paid check and exactly one of the two doors ──────────────────

def _calls(dependant):
    for d in dependant.dependencies:
        yield d.call
        yield from _calls(d)


def _agent_routes():
    return [r for r in rx.router.routes if isinstance(r, APIRoute) and r.path.startswith("/api/agent")]


def test_every_agent_route_is_behind_the_paid_check_and_one_door():
    routes = _agent_routes()
    assert len(routes) >= 20, [r.path for r in routes]               # non-vacuity: the whole router is walked
    budget = [r for r in routes if r.path == "/api/agent/budget"]
    assert len(budget) == 1
    for r in routes:
        calls = set(_calls(r.dependant))
        assert rx.require_paid in calls, f"{r.path}: no paid check"
        if r.path == "/api/agent/budget":
            assert rx.require_admin_always in calls and rx.require_admin_dark not in calls, r.path
        else:
            assert rx.require_admin_dark in calls and rx.require_admin_always not in calls, r.path


def _member_app(user):
    from api.middleware.auth_middleware import get_current_user_with_plan
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_REQUESTS_door_closed_a_paid_member_gets_403_on_config_and_budget(monkeypatch):
    monkeypatch.setattr(rx, "is_paid_user", lambda u: u.get("plan") != "free")
    c = _member_app(MEMBER)
    assert c.get("/api/agent/config").status_code == 403
    assert c.get("/api/agent/budget").status_code == 403


def test_REQUESTS_door_open_config_answers_a_paid_member_and_says_members_but_budget_stays_403(monkeypatch):
    monkeypatch.setenv(ENV, "1")
    monkeypatch.setattr(rx, "is_paid_user", lambda u: u.get("plan") != "free")
    c = _member_app(MEMBER)
    r = c.get("/api/agent/config")
    assert r.status_code == 200 and r.json()["members"] is True
    assert c.get("/api/agent/budget").status_code == 403
    assert _member_app({**MEMBER, "plan": "free"}).get("/api/agent/config").status_code == 402


def test_REQUESTS_the_emergency_off_reaches_the_very_next_request(monkeypatch):
    monkeypatch.setattr(rx, "is_paid_user", lambda u: u.get("plan") != "free")
    c = _member_app(MEMBER)
    monkeypatch.setenv(ENV, "1")
    assert c.get("/api/agent/config").status_code == 200
    monkeypatch.setenv(ENV, "0")
    assert c.get("/api/agent/config").status_code == 403


def test_REQUESTS_an_admin_reads_members_false_while_the_door_is_closed(monkeypatch):
    monkeypatch.setattr(rx, "is_paid_user", lambda u: u.get("plan") != "free")
    r = _member_app(ADMIN).get("/api/agent/config")
    assert r.status_code == 200 and r.json()["members"] is False


# ── the auth payload: the browser's first answer ──────────────────────────────────────────────────────

def test_auth_payload_carries_an_explicit_false_while_the_door_is_closed():
    for who, plan in ((MEMBER, "pro"), (ADMIN, "pro"), ({**MEMBER}, "free")):
        p = auth._access_payload({"id": None, "role": who["role"], "created_at": None}, plan)
        assert p.get("uct_agent_members_enabled") is False, (who["role"], plan)


def test_auth_payload_is_true_only_for_a_paid_account_while_the_door_is_open(monkeypatch):
    monkeypatch.setenv(ENV, "1")
    paid = auth._access_payload({"id": None, "role": "user", "created_at": None}, "pro")
    admin = auth._access_payload({"id": None, "role": "admin", "created_at": None}, "free")
    free = auth._access_payload({"id": None, "role": "user", "created_at": None}, "free")
    assert paid["uct_agent_members_enabled"] is True
    assert admin["uct_agent_members_enabled"] is True
    assert free["uct_agent_members_enabled"] is False


def test_auth_payload_reads_the_same_predicate_as_the_routes(monkeypatch):
    monkeypatch.setenv(ENV, "true")                                    # not `1`: the routes stay admin-only
    p = auth._access_payload({"id": None, "role": "user", "created_at": None}, "pro")
    assert p["uct_agent_members_enabled"] is False and rx.members_enabled() is False
