"""CONTROLLED ROLLOUT — telemetry: shape only, distinct outcome classes, an owner report.

``converse_turn`` (server-only) and ``studio_action`` (client) ride the existing
``landing_events`` store through ``indicator_telemetry``'s allowlists, now with
value-level rules: no member words, model reply, tree or formula can be stored.
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import auth_db, indicator_telemetry as tel
from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, conv, emits, empty_view, env, model, out, view,
)

SECRET = "PLEASE-DO-NOT-STORE-my private strategy words"


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(path))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    auth_db.init_db()
    return path


def rows(event):
    conn = auth_db.get_connection()
    try:
        return [(v, json.loads(p) if p else {}) for v, p in conn.execute(
            "SELECT visitor_id, props FROM landing_events WHERE event = ?", (event,)).fetchall()]
    finally:
        conn.close()


def raw_dump():
    conn = auth_db.get_connection()
    try:
        return "\n".join(str(r) for r in conn.execute("SELECT * FROM landing_events").fetchall())
    finally:
        conn.close()


def test_a_change_turn_is_recorded_as_shape_with_no_words(store, conv, model):
    e = env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}], reply=SECRET)
    model([emits(e)])
    r = conv.converse(f"make it 80 {SECRET}", user_id="u-cohort", view=view(1, [out("value", RSI_GT_70)]),
                      conversation_id="auth_0123456789ab")
    assert r["ok"] is True
    (uid, p), = rows("converse_turn")
    assert uid == "u-cohort"
    assert p["failure_class"] == "ok" and p["disposition"] == "change" and p["access"] == "cohort"
    assert p["attempts"] == 1 and p["calls"] == 1 and p["op_kinds"] == "set_slot"
    assert p["conversation_id"] == "auth_0123456789ab" and "unsupported_category" not in p
    assert SECRET not in raw_dump() and "PLEASE" not in raw_dump()


def test_an_unsupported_turn_records_its_DEMAND_CATEGORY_not_its_words(store, conv, model):
    e = env(0, [], disposition="unsupported", reply=f"Tables are not drawable. {SECRET}")
    model([emits(e)])
    conv.converse(f"Build me an earnings table in the bottom right {SECRET}", user_id="u1",
                  view=empty_view(0), admin=True)
    (_, p), = rows("converse_turn")
    assert p["disposition"] == "unsupported" and p["failure_class"] == "ok"
    assert p["unsupported_category"] == "table" and p["access"] == "admin"
    assert SECRET not in raw_dump()


@pytest.mark.parametrize("message,category", [
    ("Plot SPY's RSI 14", "other_symbol"),
    ("show the weekly RSI on this daily chart", "other_timeframe"),
])
def test_a_PREFLIGHT_refusal_is_its_own_class_and_names_its_category(store, conv, message, category):
    r = conv.converse(message, user_id="u1", view=empty_view(0), chart={"sym": "XRPN", "tf": "1D"})
    assert r["ok"] is False and r.get("preflight") is True
    (_, p), = rows("converse_turn")
    assert p["failure_class"] == "preflight_refused" and p["unsupported_category"] == category
    assert p.get("calls", 0) == 0 and p["usd"] == 0


def test_a_MODEL_failure_is_not_a_refusal_nor_unsupported(store, conv, model):
    bad = env(1, [{"op": "set_slot", "slot": "value#1"}])
    model([emits(bad), emits(bad)])
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False
    (_, p), = rows("converse_turn")
    assert p["failure_class"] == "model_invalid" and p["repair_gate"] == "envelope:schema"
    assert p["attempts"] == 2


def test_a_BUDGET_stop_is_its_own_class(store, conv, monkeypatch):
    from api.services import definition_concierge as dc
    monkeypatch.setattr(dc, "spend_for", lambda *_a, **_k: 999.0)
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["gate"] == "cost:user"
    (_, p), = rows("converse_turn")
    assert p["failure_class"] == "budget_user"


def test_the_SHARED_POOL_stop_is_its_own_class(store, conv, monkeypatch):
    from api.services.catalyst import cost_guard
    monkeypatch.setattr(cost_guard, "may_member_spend", lambda *_a, **_k: False)
    r = conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["gate"] == "cost:global"
    (_, p), = rows("converse_turn")
    assert p["failure_class"] == "budget_global"


def test_a_PROVIDER_outage_is_platform_not_model(store, conv, monkeypatch):
    monkeypatch.setattr(conv, "_call_model", lambda _m: (_ for _ in ()).throw(RuntimeError("boom")))
    conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    (_, p), = rows("converse_turn")
    assert p["failure_class"] == "platform"


@pytest.mark.parametrize("key,value", [
    ("action", "I asked for an earnings table"),
    ("kinds", "series,my secret sauce"),
    ("conversation_id", "has spaces in it!"),
    ("surface", "studio; DROP TABLE"),
    ("failure", "the model said something rude"),
])
def test_the_CLIENT_door_rejects_free_text_under_any_legal_key(key, value):
    assert tel._prop_violation("studio_action", key, value) is not None


def test_the_client_may_not_claim_a_converse_turn():
    assert "converse_turn" not in tel.CLIENT_FIREABLE_EVENTS
    assert "studio_action" in tel.CLIENT_FIREABLE_EVENTS


def test_the_REPORT_aggregates_and_separates_cohort_from_admins(store, conv, model):
    good = env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}])
    model([emits(good), emits(good)])
    conv.converse("make it 80", user_id="m1", view=view(1, [out("value", RSI_GT_70)]), conversation_id="auth_aaaaaaaaaaaa")
    conv.converse("make it 80", user_id="a1", view=view(1, [out("value", RSI_GT_70)]), admin=True, conversation_id="auth_bbbbbbbbbbbb")
    for action in ("opened", "preview", "saved"):
        tel.log_event("m1", "studio_action", import_id=f"auth_aaaaaaaaaaaa:{action}",
                      conversation_id="auth_aaaaaaaaaaaa", action=action, surface="studio",
                      **({"kinds": "condition,candle_paint", "origin": "native", "created": True} if action == "saved" else {}))
    tel.log_event("m1", "studio_action", import_id="auth_cccccccccccc:opened",
                  conversation_id="auth_cccccccccccc", action="opened", surface="studio")
    r = tel.rollout_report(7)
    cm = r["cohort_members"]
    assert cm["members"] == 1 and cm["turns"] == 1 and cm["first_pass"] == 1 and cm["repairs"] == 0
    assert r["everyone_incl_admins"]["turns"] == 2
    f = r["funnel"]
    assert f["conversations_started"] == 2 and f["saved"] == 1 and f["save_rate"] == 0.5
    assert f["saved_kinds"] == {"candle_paint": 1, "condition": 1}
    assert "shared_pool_today" in r and r["cohort"]["name"] == "create-indicator"


def test_the_REPORT_is_admin_only():
    from api.routers import indicator_telemetry as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    who = {"user": {"id": "m1", "role": "member", "plan": "pro"}}
    app.dependency_overrides[get_current_user] = lambda: who["user"]
    app.dependency_overrides[get_current_user_with_plan] = lambda: who["user"]
    c = TestClient(app, raise_server_exceptions=False)
    assert c.get("/api/indicator-telemetry/rollout-report").status_code == 403
