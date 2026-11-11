"""Constant schema (owner 2026-11-05): the model-facing schema is the same bytes on every request, the kill switch restores the
routed schema exactly, and everything the schema used to narrow is still refused by the server. docs/agent/LATENCY.md."""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.uct_agent import budget, store, turn
from tests.test_uct_agent import CAPS, CTX, OP, _resp, caller_of, env

GROUP_A = [{"id": "alerts", "title": "Alerts"}]
GROUP_B = [{"id": "layouts", "title": "Layouts"}, {"id": "news", "title": "News"}]


def cap(name):
    return {**CAPS[0], "name": name}


def schema_bytes(caps, unselected=None):
    return json.dumps(turn.envelope_schema(caps, unselected, turn.compact_ops(caps)), sort_keys=False, separators=(",", ":"))


def routing_shapes():
    one = turn.validate_manifest([cap("chart.setSymbol")], 60)
    many = turn.validate_manifest([cap(f"x.a{i}") for i in range(30)], 60)
    return [(one, None), (one, GROUP_A), (many, None), (many, GROUP_B), (turn.validate_manifest(CAPS, 60), GROUP_A)]


def test_the_schema_is_the_same_bytes_whatever_routing_picked():
    assert len({schema_bytes(c, u) for c, u in routing_shapes()}) == 1


def test_the_rules_block_is_the_same_bytes_and_the_actions_follow_it():
    parts = [turn.system_parts(c, u, True) for c, u in routing_shapes()]
    assert len({p[0] for p in parts}) == 1
    assert all(len(p) == 2 for p in parts)
    assert turn._ACTIONS_HEADING not in parts[0][0] and all(turn._ACTIONS_HEADING in p[1] for p in parts)


def test_every_rule_and_action_the_single_block_prompt_had_is_still_sent(monkeypatch):
    c, u = routing_shapes()[3]
    joined = "".join(turn.system_parts(c, u, True))
    monkeypatch.setenv(turn.CONSTANT_SCHEMA_ENV, "0")
    old = turn.system_prompt(c, u, True)
    assert sorted(old.split()) == sorted(joined.split())


@pytest.mark.parametrize("off", ["0", "false", "OFF", "no"])
def test_the_kill_switch_restores_the_routed_schema_and_one_block(monkeypatch, off):
    monkeypatch.setenv(turn.CONSTANT_SCHEMA_ENV, off)
    assert not turn.constant_schema()
    one = turn.validate_manifest([cap("chart.setSymbol")], 60)
    many = turn.validate_manifest([cap(f"x.a{i}") for i in range(30)], 60)
    assert "anyOf" in turn.envelope_schema(one, None, False)["properties"]["ops"]["items"]
    assert "need_groups" not in turn.envelope_schema(one, None, False)["properties"]
    assert turn.envelope_schema(many, None, True)["properties"]["ops"]["items"]["properties"]["action"]["enum"]
    assert turn.envelope_schema(many, GROUP_A, True)["properties"]["need_groups"]["anyOf"][1]["items"]["enum"] == ["alerts"]
    assert turn.system_parts(many, GROUP_A, True) == [turn.system_prompt(many, GROUP_A, True)]


@pytest.mark.parametrize("value", [None, "", "1", "on"])
def test_the_constant_schema_is_the_default(monkeypatch, value):
    if value is None:
        monkeypatch.delenv(turn.CONSTANT_SCHEMA_ENV, raising=False)
    else:
        monkeypatch.setenv(turn.CONSTANT_SCHEMA_ENV, value)
    assert turn.constant_schema()


def test_the_constant_schema_carries_no_action_name_group_or_workspace_value():
    text = schema_bytes(*routing_shapes()[3])
    for word in ("x.a0", "chart.setSymbol", "alerts", "layouts", "NVDA", "c1"):
        assert word not in text


def test_an_action_outside_the_manifest_never_reaches_the_browser():
    caps = turn.validate_manifest(CAPS, 60)
    forged = {"disposition": "apply", "reply": "", "question": None, "unsupported_category": None, "research": None,
              "ops": [{"action": "watchlist.deleteAll", "target": "c1", "args_json": "{}"}]}
    with pytest.raises(turn.TurnError) as e:
        turn.expand_compact_ops(forged, caps)
    assert e.value.reason == "unreadable:args_schema"


def test_args_are_still_checked_against_the_capabilitys_own_schema():
    caps = turn.validate_manifest(CAPS, 60)
    name = caps[0]["name"]
    forged = {"ops": [{"action": name, "target": "c1", "args_json": json.dumps({"not_an_arg": 1})}]}
    with pytest.raises(turn.TurnError):
        turn.expand_compact_ops(forged, caps)


def test_a_group_the_request_was_not_withheld_cannot_be_asked_for():
    out = turn.sanitize_envelope({"disposition": "answer", "reply": "ok", "question": None, "ops": [], "unsupported_category": None,
                                  "research": None, "need_groups": ["invented"]}, {"c1"}, {"chart.setSymbol"}, {"alerts"})
    assert not out.get("need_groups")


def test_need_groups_is_ignored_on_a_request_that_withheld_nothing():
    out = turn.sanitize_envelope({"disposition": "answer", "reply": "ok", "question": None, "ops": [], "unsupported_category": None,
                                  "research": None, "need_groups": ["alerts"]}, {"c1"}, {"chart.setSymbol"}, set())
    assert not out.get("need_groups")


def test_a_real_turn_sends_the_constant_schema_and_two_cache_blocks():
    seen = []
    base = caller_of(_resp(env("answer", reply="Hello.")))

    def spy(**kw):
        seen.append(kw)
        return base(**kw)

    out = turn.run_turn(message="hello", context=CTX, history=[], capabilities=CAPS, caller=spy)
    assert out["usage"]["schema_mode"] == "constant"
    assert [b["cache_control"]["type"] for b in seen[0]["system"]] == ["ephemeral", "ephemeral"]
    fmt = seen[0]["output_config"]["format"]["schema"]
    assert "enum" not in fmt["properties"]["ops"]["items"]["properties"]["action"]


def test_the_worst_case_reservation_is_lower_on_the_same_request(monkeypatch):
    caps = turn.validate_manifest([cap(f"x.a{i}") for i in range(40)], 60)
    ask = lambda system, schema: budget.worst_case_usd({"model": "claude-haiku-4-5", "max_tokens": 2048, "system": system,
                                                        "output_config": {"format": {"type": "json_schema", "schema": schema}},
                                                        "messages": [{"role": "user", "content": "hello"}]})
    new = ask([{"type": "text", "text": t} for t in turn.system_parts(caps, GROUP_B, True)], turn.envelope_schema(caps, GROUP_B, True))
    monkeypatch.setenv(turn.CONSTANT_SCHEMA_ENV, "0")
    old = ask([{"type": "text", "text": t} for t in turn.system_parts(caps, GROUP_B, True)], turn.envelope_schema(caps, GROUP_B, True))
    assert new <= old


def test_speed_telemetry_keeps_numbers_and_one_mode_word_only():
    store.record_telemetry("u1", "ac_1", {"path": "fast", "disposition": "apply", "actions": ["chart.setSymbol"], "visible_ms": 40, "verified_ms": 310,
                                          "model_calls": 1, "input_tokens": 5, "output_tokens": 6, "cache_read_tokens": 7, "cache_write_tokens": 8,
                                          "schema_mode": "NVDA at 123"})
    row = store.telemetry_rows()[0]
    assert (row["visible_ms"], row["verified_ms"], row["model_calls"], row["cache_read_tokens"]) == (40, 310, 1, 7)
    assert row["schema_mode"] is None


@pytest.mark.parametrize("bad", ["NVDA", {"a": 1}, [1], True])
def test_a_browser_cannot_put_words_in_the_number_columns(bad):
    store.record_telemetry("u1", "ac_1", {"path": "fast", "visible_ms": bad, "verified_ms": bad})
    row = store.telemetry_rows()[0]
    assert row["visible_ms"] is None and row["verified_ms"] is None


def test_an_existing_database_gains_the_columns(tmp_path):
    db = sqlite3.connect(tmp_path / "old.db")
    db.execute("CREATE TABLE agent_conversations (id TEXT, pinned_at INTEGER, title_source TEXT)")
    db.execute("CREATE TABLE agent_telemetry (id INTEGER PRIMARY KEY, created_at INTEGER)")
    store._migrate(db)
    store._migrate(db)          # idempotent
    cols = {r[1] for r in db.execute("PRAGMA table_info(agent_telemetry)")}
    assert {"schema_mode", "visible_ms", "verified_ms", "cache_read_tokens"} <= cols


def test_only_a_reason_code_is_recorded_for_a_failed_turn():
    src = open(rx_path(), encoding="utf8").read()
    assert 'reason.startswith("unreadable")' in src and '"unsupported": reason' in src


def rx_path():
    from api.routers import uct_agent
    return uct_agent.__file__


_ = OP
