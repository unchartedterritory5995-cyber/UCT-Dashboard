"""agent-qa G4 — a signed-in NON-admin member is refused on the Agent routes, before any provider call.

Until now admin-only was covered by a code-level check (every route Depends on require_admin_dark) and by the
signed-out 401s. This drives the REAL app (api.main:app) through the REAL auth chain: a real users row, a real
session from auth_service.create_session, a real comped plan from auth_service.comp_user_access. No dependency is
overridden, so the refusal measured here is the one production would give.

  * a PAID member (comped, role 'member')  -> 403 on /config, /turn, /turn/stream and /data, the last with the gateway
    ON (UCT_AGENT_DATA=1, UCT_AGENT_DATA_KINDS=quote,instrument.resolve) for quote AND instrument.resolve. The member
    is paid on purpose: an unpaid member is refused by require_paid (402) before the admin gate is ever asked, which
    would prove the plan gate, not the admin gate. The unpaid case is pinned separately as 402.
  * "no provider call" is measured, not assumed: the model client (engine._get_anthropic_client) and every
    market-data adapter (a spy registry over the REAL registrars, the pattern of test_uct_agent_data_kinds_allowlist)
    record each call, and the per-member daily request counter must not move.
  * NON-VACUITY: the same requests from an ADMIN do reach the spies (the model client on /turn and /turn/stream, the
    quote and instrument.resolve adapters on /data), so a spy that could never fire cannot make the refusals pass.
"""
from __future__ import annotations

import json
import types
import uuid

import pytest
from fastapi.testclient import TestClient

from api.services import auth_db, auth_service
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw

DATA_KINDS = "quote,instrument.resolve"
REPLY = {"disposition": "answer", "reply": "agent-qa stub answer.", "question": None, "ops": [],
         "unsupported_category": None, "research": None}
TURN_BODY = {"message": "what is NVDA trading at?", "context": {}}
DATA_BODIES = {
    "quote": {"kind": "quote", "params": {"symbol": "NVDA"}, "turn_id": "qa-g4-quote"},
    "instrument.resolve": {"kind": "instrument.resolve", "params": {"symbols": [{"text": "NVDA", "form": "upper"}]},
                           "turn_id": "qa-g4-resolve"},
}


# ── fixtures ────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app                       # the real app, real dependencies, no overrides
    assert not real_app.dependency_overrides
    return real_app


@pytest.fixture()
def client(app):
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    for name in (gw.SCAN_ENV, gw.ISOLATED_ENV, "UCT_AGENT_STREAM", "UCT_AGENT_COST_CAP_DAILY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, DATA_KINDS)
    yield


class _Messages:
    def __init__(self, log):
        self.log = log

    def create(self, **kw):
        self.log.append("messages.create")
        return types.SimpleNamespace(
            content=[types.SimpleNamespace(type="text", text=json.dumps(REPLY))], stop_reason="end_turn",
            model=kw.get("model"), usage=types.SimpleNamespace(
                input_tokens=100, output_tokens=20, cache_read_input_tokens=0, cache_creation_input_tokens=0))

    def stream(self, **kw):                                    # streaming is off; never expected
        raise AssertionError("agent-qa stub: streaming was not expected")


class _Client:
    def __init__(self, log):
        self.messages = _Messages(log)

    def with_options(self, **kw):
        return self


@pytest.fixture()
def spies(monkeypatch):
    """Record every model-client acquisition/call, every market-data adapter run, every daily-counter take."""
    log = {"model": [], "adapters": [], "takes": []}

    from api.services import engine

    def _get_client():
        log["model"].append("client")
        return _Client(log["model"])
    monkeypatch.setattr(engine, "_get_anthropic_client", _get_client)

    gw._reset_for_test(None)
    real = gw.registry()
    fake = gw.Registry()
    for name in real.names():
        k = real.get(name)

        def fn(params, ctx, _n=name):
            log["adapters"].append(_n)
            return env.make_envelope(_n, params, status="ok", freshness="historical",
                                     as_of="2026-11-01T20:00:00Z", source="fixture", data={"v": 1})
        fake.register(gw.Kind(name=name, fn=fn, freshness=k.freshness, category=k.category,
                              owner=k.owner, model_isolated=k.model_isolated))
    gw._reset_for_test(fake)

    from api.services import daily_counters
    real_take = daily_counters.take

    def _take(*a, **kw):
        log["takes"].append(a[1] if len(a) > 1 else kw)
        return real_take(*a, **kw)
    monkeypatch.setattr(daily_counters, "take", _take)
    yield log
    gw._reset_for_test(None)


def _account(*, role: str, paid: bool) -> dict:
    """A real users row + a real session, through the app's own service functions."""
    auth_db.init_db()
    email = f"qa-g4-{role}-{'paid' if paid else 'free'}-{uuid.uuid4().hex[:8]}@local.dev"
    user = auth_service.create_user(email, "QaLocalOnly-2026!", display_name=f"g4 {role}")
    uid = user["id"]
    if role != "member":
        c = auth_db.get_connection()
        try:
            c.execute("UPDATE users SET role = ? WHERE id = ?", (role, uid))
            c.commit()
        finally:
            c.close()
    if paid:
        auth_service.comp_user_access(email, grant=True)
    token = auth_service.create_session(uid)
    me = auth_service.validate_session(token)
    assert me and me["email"] == email.lower(), "the session must resolve to this account"
    plan = auth_service.get_user_plan(uid)
    from api.middleware.auth_middleware import is_paid_user               # the predicate require_paid applies
    return {"cookies": {"uct_session": token}, "role": me.get("role"), "plan": plan,
            "paid": is_paid_user({**me, "plan": plan})}


@pytest.fixture()
def member():
    return _account(role="member", paid=True)


@pytest.fixture()
def free_member():
    return _account(role="member", paid=False)


@pytest.fixture()
def admin():
    return _account(role="admin", paid=False)


def _call(client, who, route, kind=None):
    if route == "config":
        return client.get("/api/agent/config", cookies=who["cookies"])
    if route == "turn":
        return client.post("/api/agent/turn", json=TURN_BODY, cookies=who["cookies"])
    if route == "turn/stream":
        return client.post("/api/agent/turn/stream", json=TURN_BODY, cookies=who["cookies"])
    if route == "data":
        return client.post("/api/agent/data", json=DATA_BODIES[kind], cookies=who["cookies"])
    raise AssertionError(route)


CASES = [("config", None), ("turn", None), ("turn/stream", None), ("data", "quote"), ("data", "instrument.resolve")]


# ── the accounts are what they claim to be ──────────────────────────────────────────────────────────

def test_the_accounts_are_real_and_distinct(member, free_member, admin):
    assert member["role"] == "member" and member["plan"] == "pro" and member["paid"]       # comp grant = pro
    assert free_member["role"] == "member" and free_member["plan"] == "free" and not free_member["paid"]
    assert admin["role"] == "admin"


def test_the_gateway_is_ON_for_the_data_cases(spies):
    assert gw.data_enabled() and gw.enabled_kinds() == frozenset({"quote", "instrument.resolve"})


# ── G4: a signed-in, PAID, non-admin member is refused with 403, before any provider call ─────────────

@pytest.mark.parametrize("route,kind", CASES)
def test_G4_a_paid_non_admin_member_is_refused_403_with_no_provider_call(client, spies, member, route, kind):
    r = _call(client, member, route, kind)
    assert r.status_code == 403, (route, kind, r.status_code, r.text[:200])
    assert r.json().get("detail") == "Admin access required"
    assert spies["model"] == [], f"{route}: the model client was reached"
    assert spies["adapters"] == [], f"{route}: a market-data adapter ran"
    assert spies["takes"] == [], f"{route}: the daily request counter was charged"


@pytest.mark.parametrize("route,kind", CASES)
def test_an_UNPAID_member_is_refused_earlier_by_the_plan_gate_402_with_no_provider_call(
        client, spies, free_member, route, kind):
    r = _call(client, free_member, route, kind)
    assert r.status_code == 402, (route, kind, r.status_code, r.text[:200])
    assert spies["model"] == [] and spies["adapters"] == [] and spies["takes"] == []


@pytest.mark.parametrize("route,kind", CASES)
def test_signed_out_is_401_with_no_provider_call(client, spies, route, kind):
    r = _call(client, {"cookies": {}}, route, kind)
    assert r.status_code == 401
    assert spies["model"] == [] and spies["adapters"] == [] and spies["takes"] == []


# ── NON-VACUITY: the same requests from an admin DO reach the spies ──────────────────────────────────

def test_control_admin_config_is_served(client, spies, admin):
    r = _call(client, admin, "config")
    assert r.status_code == 200 and r.json()["data"] is True
    assert r.json()["data_kinds"] == ["instrument.resolve", "quote"]


@pytest.mark.parametrize("kind", ["quote", "instrument.resolve"])
def test_control_admin_data_reaches_the_adapter(client, spies, admin, kind):
    r = _call(client, admin, "data", kind)
    assert r.status_code == 200, r.text[:200]
    assert spies["adapters"] == [kind]


@pytest.mark.parametrize("route", ["turn", "turn/stream"])
def test_control_admin_turn_reaches_the_model_client(client, spies, admin, route):
    r = _call(client, admin, route)
    assert r.status_code == 200, r.text[:300]
    assert "messages.create" in spies["model"], spies
    assert spies["takes"], "an admin turn charges the daily counter"
