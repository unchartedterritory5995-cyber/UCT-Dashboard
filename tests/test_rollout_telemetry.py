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


# ⭐ PHASE 5: another symbol and a HIGHER timeframe are authorable now, so the
# pre-flight's remaining refusals are an AMBIGUOUS spelling and a LOWER timeframe.
@pytest.mark.parametrize("message,category", [
    ("Plot VIX's RSI 14", "other_symbol"),
    ("show the 5 minute RSI on this daily chart", "other_timeframe"),
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


# --- version stamps: what produced the turn (plan section 7, L1) -----------------

def test_every_turn_is_stamped_with_what_produced_it(store, conv, model):
    from api.services import concept_vocabulary, definition_concierge as dc, user_definitions
    e = env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}])
    model([emits(e)])
    conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    (_, p), = rows("converse_turn")
    assert p["prompt_sha"] == conv.prompt_sha() and len(p["prompt_sha"]) == 16
    assert p["vocab_version"] == concept_vocabulary.version()
    assert p["model"] == dc.MODEL
    assert p["engine"] == user_definitions.SCRIPT_ENGINE_VERSION


def test_a_refusal_before_the_model_is_stamped_too(store, conv):
    conv.converse("Plot VIX's RSI 14", user_id="u1", view=empty_view(0),
                  chart={"sym": "XRPN", "tf": "1D"})
    (_, p), = rows("converse_turn")
    assert p["failure_class"] == "preflight_refused" and p["prompt_sha"] == conv.prompt_sha()


def test_the_prompt_stamp_moves_when_the_instructions_or_the_tool_move(conv, monkeypatch):
    conv.prompt_sha.cache_clear()
    base = conv.prompt_sha()
    try:
        monkeypatch.setattr(conv, "CONVERSE_SYSTEM_PROMPT", conv.CONVERSE_SYSTEM_PROMPT + " ")
        conv.prompt_sha.cache_clear()
        assert conv.prompt_sha() != base
        monkeypatch.undo()
        real_tool = conv.anthropic_tool()
        monkeypatch.setattr(conv, "anthropic_tool", lambda: dict(real_tool, description="x"))
        conv.prompt_sha.cache_clear()
        assert conv.prompt_sha() != base
        monkeypatch.undo()
        conv.prompt_sha.cache_clear()
        assert conv.prompt_sha() == base      # control: unchanged inputs, unchanged stamp
    finally:
        conv.prompt_sha.cache_clear()


def test_a_stamp_that_cannot_be_read_is_left_out_and_the_turn_is_still_recorded(
        store, conv, model, monkeypatch):
    def boom():
        raise RuntimeError("no prompt")
    monkeypatch.setattr(conv, "prompt_sha", boom)
    e = env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}])
    model([emits(e)])
    conv.converse("make it 80", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    (_, p), = rows("converse_turn")
    assert "prompt_sha" not in p and p["failure_class"] == "ok" and "model" in p


@pytest.mark.parametrize("key,value", [
    ("prompt_sha", "make it eighty"),          # words, not a hash
    ("prompt_sha", "0123456789ABCDEF"),        # not lower-case hex
    ("vocab_version", "the member said this"),
    ("model", "Please Build Me A Table"),
    ("engine", "57"),                          # a string where a number is owed
    ("engine", True),
])
def test_a_stamp_can_never_carry_free_text(key, value):
    assert tel._prop_violation("converse_turn", key, value) is not None


@pytest.mark.parametrize("key,value", [
    ("prompt_sha", "0123456789abcdef"), ("vocab_version", "2026-11-15.1"),
    ("model", "claude-opus-5"), ("engine", 57),
])
def test_a_well_formed_stamp_is_accepted(key, value):
    assert tel._prop_violation("converse_turn", key, value) is None


# --- was it wanted: the undone signal, and what produced the window (L7) -----------

def test_an_undone_conversation_is_counted_once_and_apart_from_a_discarded_one(store, conv):
    # `conv` is here for its isolation: the report reads the shared spend pool, and without the
    # fixture that read opens the real data root (the suite's own guard caught exactly that).
    for cid, actions in (("auth_dddddddddddd", ("opened", "preview", "undone", "saved")),
                         ("auth_eeeeeeeeeeee", ("opened", "preview", "undone", "discarded")),
                         ("auth_ffffffffffff", ("opened", "preview", "saved"))):
        for action in actions:
            tel.log_event("m1", "studio_action", import_id=f"{cid}:{action}",
                          conversation_id=cid, action=action, surface="studio")
    f = tel.rollout_report(7)["funnel"]
    assert f["undone"] == 2 and f["saved_after_undo"] == 1
    assert f["saved"] == 2 and f["discarded"] == 1        # control: the older counts are untouched


def test_undone_is_an_action_the_door_accepts_and_a_made_up_one_is_not():
    assert tel._prop_violation("studio_action", "action", "undone") is None
    assert tel._prop_violation("studio_action", "action", "regretted") is not None


def test_the_report_says_what_produced_the_turns(store, conv, model):
    from api.services import definition_concierge as dc
    good = env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}])
    model([emits(good), emits(good)])
    conv.converse("make it 80", user_id="m1", view=view(1, [out("value", RSI_GT_70)]))
    conv.converse("make it 80", user_id="m2", view=view(1, [out("value", RSI_GT_70)]))
    by = tel.rollout_report(7)["produced_by"]
    assert by["prompt_sha"] == {conv.prompt_sha(): 2}
    assert by["model"] == {dc.MODEL: 2}
    assert set(by) == {"prompt_sha", "vocab_version", "model", "engine"}


def test_a_window_spanning_two_instruction_versions_shows_both(store, conv, model, monkeypatch):
    good = env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}])
    model([emits(good), emits(good)])
    conv.converse("make it 80", user_id="m1", view=view(1, [out("value", RSI_GT_70)]))
    first = conv.prompt_sha()
    monkeypatch.setattr(conv, "prompt_sha", lambda: "0123456789abcdef")
    conv.converse("make it 80", user_id="m2", view=view(1, [out("value", RSI_GT_70)]))
    assert tel.rollout_report(7)["produced_by"]["prompt_sha"] == {first: 1, "0123456789abcdef": 1}



# --- the learning data: every operation is countable; which check caused each repair -----------
#
# 2026-11-17. Two things the record could not say. (1) The list of operations a turn may record
# was typed by hand and seven operations had been added to the patch contract since, so a turn
# that built a table, colour states, a setting or a calculation timeframe lost its whole
# `op_kinds`. (2) A repaired turn said THAT it was repaired, and the report did not say by which
# check; and when the browser sends its own refusal back (`definition_conversation.
# browser_refusal`) nothing said which of the browser's rules it was.

EMA_LINE = {"op": "create", "name": "Average", "placement": "price",
            "outputs": [{"key": "ema", "tree": {"type": "call", "name": "ema", "args": [
                {"type": "series", "name": "close"}, {"type": "num", "value": 10}]}}]}
NEWER = [{"op": "set_table", "cells": [{"row": 0, "col": 0, "text": "EMA"}, {"row": 0, "col": 1, "output": "ema"}]},
         {"op": "set_color_states", "output": "ema", "states": [{"relation": "rising", "color": "#089981"}], "otherwise": "#F23645"},
         {"op": "set_calculation_timeframe", "timeframe": "W"}]


def _contract_ops():
    import io
    from pathlib import Path
    path = Path(tel.__file__).resolve().parents[2] / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "patchSchema.json"
    defs = json.loads(io.open(path, encoding="utf-8").read())["$defs"]
    return {v["properties"]["op"]["const"] for k, v in defs.items() if k.startswith("op_")}


def test_the_operations_a_turn_may_record_are_the_contracts():
    contract = _contract_ops()
    assert len(contract) > len(tel._CONVERSE_OPS_AS_TYPED)          # the premise: the contract has grown
    assert tel._CONVERSE_OPS == contract == tel.contract_ops()
    assert {"set_table", "set_color_states", "set_calculation_timeframe", "set_input"} <= tel._CONVERSE_OPS


def test_a_turn_that_uses_a_newer_operation_keeps_its_record(store, conv, model):
    model([emits(env(0, [EMA_LINE] + NEWER))])
    r = conv.converse("a weekly 10 EMA with a table", user_id="u1", view=empty_view(0))
    assert r["ok"] is True
    (_uid, p), = rows("converse_turn")
    assert p["op_kinds"] == "create,set_table,set_color_states,set_calculation_timeframe"
    assert tel.rollout_report(7)["everyone_incl_admins"]["op_kinds"]["set_table"] == 1


def test_an_unreadable_contract_answers_the_typed_list_never_raises_and_SAYS_SO(monkeypatch, caplog):
    """The fallback is LOUD: falling back silently is how the typed list went seven operations
    stale without anybody being told."""
    import logging

    def broken(*_a, **_kw):
        raise ValueError("not JSON")
    monkeypatch.setattr(tel.json, "loads", broken)
    with caplog.at_level(logging.ERROR, logger=tel.log.name):
        assert tel.contract_ops() == tel._CONVERSE_OPS_AS_TYPED
    said = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert said and "the patch contract could not be read" in said[-1].getMessage()
    caplog.clear()
    monkeypatch.setattr(tel.json, "loads", lambda *_a, **_kw: {"$defs": {}})
    with caplog.at_level(logging.ERROR, logger=tel.log.name):
        assert tel.contract_ops() == tel._CONVERSE_OPS_AS_TYPED     # a contract with no operations is not one
    said = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert said and "defines no operations" in said[-1].getMessage()
    # and a contract that reads says nothing
    caplog.clear()
    monkeypatch.undo()
    with caplog.at_level(logging.ERROR, logger=tel.log.name):
        assert len(tel.contract_ops()) > len(tel._CONVERSE_OPS_AS_TYPED)
    assert not caplog.records


PAINT_A_NUMBER = [EMA_LINE, {"op": "set_paint", "output": "ema", "channel": "barcolor", "color": "#089981"}]
SENT_BACK = {"envelope": env(0, PAINT_A_NUMBER), "errors": [
    f"paint:refused: ema: A signal colour reads a yes/no. {SECRET}",
    "fill:not-series: the other line is a yes/no",
    f"Not A Code: {SECRET}",                                         # no code: contributes nothing
    "paint:refused: said twice",                                     # one rule, counted once
]}


def test_a_turn_the_browser_sent_back_records_which_rules_and_none_of_the_words(store, conv, model):
    model([emits(env(0, [EMA_LINE]))])
    r = conv.converse("a 10 EMA, candles green above it", user_id="u1", view=empty_view(0), browser_refusal=SENT_BACK)
    assert r["ok"] is True and r["usage"]["browser_codes"] == "paint:refused,fill:not-series"
    (_uid, p), = rows("converse_turn")
    assert p["repair_gate"] == "browser:refused" and p["browser_codes"] == "paint:refused,fill:not-series"
    assert SECRET not in raw_dump() and "yes/no" not in raw_dump()
    # an ordinary turn records neither
    model([emits(env(0, [EMA_LINE]))])
    conv.converse("a 10 EMA", user_id="u2", view=empty_view(0))
    plain = [p for u, p in rows("converse_turn") if u == "u2"][0]
    assert "browser_codes" not in plain and "repair_gate" not in plain


@pytest.mark.parametrize("value", [
    "make the candles green", "paint:refused words", "Paint:Refused", "paint:refused1", "p4int:refused",
    "paint", "paint:", ":refused", "a:b", ",", "",
    "one:two,three:four,five:six,seven:eight,nine:ten",              # five: more than a refusal carries
    "paint:refused;drop table", "x" * 16 + "y:refused", 7, None, ["paint:refused"],
])
def test_a_browser_code_can_never_carry_free_text(value):
    if value is None:
        return                                                       # an absent prop is simply absent
    assert tel._prop_violation("converse_turn", "browser_codes", value) is not None


@pytest.mark.parametrize("value", ["paint:refused", "calc-tf:lower", "color:condition-output,fill:not-series",
                                   "signal:numeric-output,table:invalid,output:unknown,input:none"])
def test_a_well_formed_browser_code_is_accepted(value):
    assert tel._prop_violation("converse_turn", "browser_codes", value) is None


def test_the_REPORT_says_which_check_caused_each_repair(store, conv, model):
    # one repaired at the door (colour states on an output drawn as markers), one sent back by the
    # browser, one built first time
    marked = env(0, [EMA_LINE, {"op": "set_marker", "output": "ema", "shape": "circle"}, NEWER[1]])
    model([emits(marked), emits(env(0, [EMA_LINE]))])
    a = conv.converse("a 10 EMA", user_id="m1", view=empty_view(0))
    model([emits(env(0, [EMA_LINE]))])
    conv.converse("a 10 EMA, candles green above it", user_id="m2", view=empty_view(0), browser_refusal=SENT_BACK)
    model([emits(env(0, [EMA_LINE]))])
    conv.converse("a 10 EMA", user_id="m3", view=empty_view(0))
    block = tel.rollout_report(7)["everyone_incl_admins"]
    assert a["ok"] is True and a["attempts"] == 2
    assert block["model_turns"] == 3 and block["repairs"] == 2
    assert block["repair_gates"] == {a["usage"]["repair_gate"]: 1, "browser:refused": 1}
    assert block["browser_refusals"] == {"paint:refused": 1, "fill:not-series": 1}
