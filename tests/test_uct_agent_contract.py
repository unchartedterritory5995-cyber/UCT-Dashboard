"""UCT Agent manifest contract — the SERVER half.

app/src/agent/contract/manifest.golden.json is the exact manifest the Charts surface sends
(app/src/agent/agentContracts.test.js keeps it current). These tests run that real manifest
through the server's own validator, schema builder and prompt, and hold the server's limits
and closed value sets to the shared contract, so JS and Python cannot drift apart unnoticed.
"""
import json
from pathlib import Path

from api.services.uct_agent import turn

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "app/src/agent/contract/manifest.contract.json").read_text(encoding="utf-8"))
GOLDEN = json.loads((ROOT / "app/src/agent/contract/manifest.golden.json").read_text(encoding="utf-8"))
CAPS = GOLDEN["capabilities"]
BY = {c["name"]: c for c in CAPS}

# Since Batch 6 the CATALOG may exceed one request: the browser routes it (app/src/agent/routing.js)
# into per-request manifests of whole action GROUPS. The server is checked the same way — every
# group (with the always-on agent group) is validated, schema-built and prompted on its own.
_GROUP_OF = {"chart": "charts", "volume": "charts", "widget": "workspace", "layout": "layouts",
             "watchlist": "lists", "screener": "screener", "alert": "alerts", "stock": "data",
             "news": "data", "settings": "settings", "app": "settings", "agent": "agent",
             "drawing": "drawings", "indicator": "indicators", "breadth": "breadth",
             "chartSetup": "chartSetup", "indicatorStyle": "indicatorSetup", "indicatorCopy": "indicatorSetup",
             "pane": "indicatorSetup", "definition": "definitions", "chartGrid": "chartGrid", "board": "boardEdit",
             "guide": "guide",
             # W1-B (2026-11-02): indicator alerts in their own fillLast group (app/src/agent/routing.js)
             "indicatorAlert": "indicatorAlerts",
             "indicatorTemplate": "chartSetup",
             # Wave 3 (2026-11-03): the coach's own fillLast group (registered only while UCT_AGENT_COACH is on)
             "coach": "coach", "journal": "coach", "calendar": "calendar",
             # C3-205..207 (pl-exec6): Tools → Custom-Period Sort, by domain in boardEdit (app/src/agent/routing.js)
             "periodSort": "boardEdit"}
#: membership by ACTION NAME (routing.js `actions`), ahead of the domain — hotfix 2026-11-03: agent.undo's own group
_GROUP_BY_ACTION = {"agent.undo": "undo", "indicatorTemplate.list": "chartSetup", "indicatorTemplate.apply": "chartSetup",
                    "indicatorTemplate.save": "chartSetup", "indicatorTemplate.delete": "chartSetup"}


def _requests():
    groups = {}
    for c in CAPS:
        groups.setdefault(_GROUP_BY_ACTION.get(c["name"]) or _GROUP_OF[c["name"].split(".")[0]], []).append(c)
    agent = groups.pop("agent", [])
    return [(g, cs + agent) for g, cs in groups.items()]


def test_server_limits_equal_the_shared_contract():
    L = CONTRACT["limits"]
    assert turn.MAX_CAPABILITIES == L["maxCapabilities"]
    assert turn.MAX_CAP_BYTES == L["maxCapBytes"]
    assert turn.MAX_HINTS == L["maxHints"]
    assert turn.MAX_CONTEXT_BYTES == L["maxContextBytes"]
    assert turn.MAX_OPS == L["maxOps"]
    assert turn.MAX_SHAPE == L["maxShape"]          # W1.1 R-01: a capability's exact-shape example
    assert CONTRACT["manifestVersion"] in turn.MANIFEST_VERSIONS
    assert GOLDEN["manifestVersion"] == CONTRACT["manifestVersion"]


def test_every_capability_belongs_to_a_routing_group_and_each_request_fits():
    assert all(c["name"].split(".")[0] in _GROUP_OF for c in CAPS)
    for g, req in _requests():
        assert len(req) <= CONTRACT["catalog"]["maxGroupSize"] + 1, g
        assert len(req) <= turn.MAX_CAPABILITIES, g


def test_the_real_manifest_survives_validation_intact():
    kept = [c for _, req in _requests() for c in turn.validate_manifest(req) if c["name"] != "agent.capabilities"]
    kept += turn.validate_manifest([BY["agent.capabilities"]])
    assert sorted(c["name"] for c in kept) == sorted(c["name"] for c in CAPS), "an entry was dropped by the server"
    for c in kept:
        src = BY[c["name"]]
        assert c["summary"] == src["summary"], f"{c['name']}: summary cut"
        assert c["hints"] == src["hints"], f"{c['name']}: hints cut"
        assert c["undo"] == src["undo"] and c["reversible"] == src["reversible"]


def test_schema_and_prompt_build_from_the_real_manifest():
    prompt = ""
    for _, req in _requests():
        kept = turn.validate_manifest(req)
        schema = turn.envelope_schema(kept)
        assert schema["type"] == "object"
        p = turn.system_prompt(kept)
        for c in kept:
            assert f"- {c['name']}(" in p
        prompt += p
    # The model is told the truth about Undo.
    digest = next(line for line in prompt.splitlines() if line.startswith("- settings.setWatchlistDigest("))
    assert "no Undo" in digest
    delete = next(line for line in prompt.splitlines() if line.startswith("- watchlist.delete("))
    assert "permanent -- no Undo" in delete
    chart = next(line for line in prompt.splitlines() if line.startswith("- chart.setTimeframe("))
    assert "Undo" not in chart.split("]:")[0]


def test_every_compact_op_example_round_trips_through_args_match():
    """Each capability's own schema accepts a value built from its own enums (compact mode is
    always on with this many capabilities, so args_match is the server's only arg check)."""
    for c in [c for _, req in _requests() for c in turn.validate_manifest(req)]:
        props = c["args"]["properties"]
        sample = {}
        # (W1.1 R-01: args_match now checks anyOf / nested objects as the grammar does, so a sample is built the same
        # way all the way down — an anyOf arg from its first branch, an object arg from its own properties)
        def sample_of(p):
            p = p["anyOf"][0] if isinstance(p.get("anyOf"), list) and p["anyOf"] else p
            if p.get("enum"):
                return next(v for v in p["enum"] if v is not None) if any(v is not None for v in p["enum"]) else None
            if isinstance(p.get("properties"), dict):
                return {k: sample_of(v) for k, v in p["properties"].items()}
            t = p.get("type")
            t = t[0] if isinstance(t, list) else t
            return {"string": "x", "number": 1, "integer": 1, "boolean": True, "null": None, "array": [], "object": {}}.get(t, None)
        sample = {k: sample_of(p) for k, p in props.items()}
        if any(v is None and "null" not in json.dumps(props[k]) for k, v in sample.items()):
            continue  # an arg with no simple sample; the browser re-validates it
        assert turn.args_match(c["args"], sample), c["name"]


def test_closed_value_sets_match_the_server():
    """Where the server has a closed value set, the Agent's enum is inside it."""
    from api.routers import auth
    tf = BY["settings.setDefaultTimeframe"]["args"]["properties"]["timeframe"]["enum"]
    assert set(tf) <= auth._CLOSED_VALUES["default_chart_tf"]
    sounds = BY["settings.setAlertSound"]["args"]["properties"]
    for k, p in sounds.items():
        if k == "sound" and p.get("enum"):
            assert {v for v in p["enum"] if v is not None} <= auth._CLOSED_VALUES["alert_sound_type"]
    freq = BY["settings.setWatchlistDigest"]["args"]["properties"]["frequency"]["enum"]
    assert set(freq) == {"off", "daily", "weekly"}  # api/routers/watchlists.py set_digest_settings


def test_manifest_version_skew_is_served_and_logged(caplog):
    import types
    env = {"disposition": "answer", "reply": "ok", "question": None, "ops": [], "unsupported_category": None, "research": None}

    def caller(**kw):
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    out = turn.run_turn(message="hi", context={}, history=[], capabilities=CAPS[:3], caller=caller, manifest_version=99)
    assert out["envelope"]["disposition"] == "answer"
    assert any("manifest version" in r.message for r in caplog.records)


def test_over_the_per_request_limit_is_refused_whole_never_trimmed():
    """Batch 6, Gate C: MAX_CAPABILITIES is per REQUEST; a request over it is a client bug and is
    refused (the charge is given back by the route), never cut to "the first 60"."""
    import pytest
    too_many = [dict(CAPS[0], name=f"chart.fake{i}") for i in range(turn.MAX_CAPABILITIES + 1)]
    with pytest.raises(turn.TurnError, match="too many actions"):
        turn.validate_manifest(too_many)
    exactly = [dict(CAPS[0], name=f"chart.fake{i}") for i in range(turn.MAX_CAPABILITIES)]
    assert len(turn.validate_manifest(exactly)) == turn.MAX_CAPABILITIES


def test_catalog_contract_distinguishes_catalog_from_request():
    cat = CONTRACT["catalog"]
    assert cat["maxRegistered"] > CONTRACT["limits"]["maxCapabilities"]
    assert cat["maxGroupSize"] < CONTRACT["routingThreshold"] <= CONTRACT["limits"]["maxCapabilities"]


def _union_enum_nodes(node, path="", out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        if isinstance(node.get("type"), list) and "enum" in node:
            out.append(path)
        for k, v in node.items():
            _union_enum_nodes(v, f"{path}/{k}", out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _union_enum_nodes(v, f"{path}[{i}]", out)
    return out


def test_no_routed_request_sends_an_enum_under_a_union_type():
    # PRODUCTION DEFECT 2026-10-08 (found by the Batch 6 real-model benchmark): small routed
    # requests embed each action's args, and the model API refuses
    # {"type": ["string", "null"], "enum": [...]} with a 400 — every screener-only and
    # settings-only request failed. Each per-group schema must be free of that shape.
    for g, req in _requests():
        kept = turn.validate_manifest(req)
        assert _union_enum_nodes(turn.envelope_schema(kept)) == [], g


def test_model_safe_schema_keeps_the_same_values():
    s = turn.model_safe_schema({"type": ["string", "null"], "enum": ["asc", "desc", None]})
    assert s == {"anyOf": [{"type": "string", "enum": ["asc", "desc"]}, {"type": "null"}]}
    s = turn.model_safe_schema({"type": ["string", "null"], "enum": ["asc", "desc"]})
    assert s == {"anyOf": [{"type": "string", "enum": ["asc", "desc"]}]}
    assert turn.model_safe_schema({"type": "string", "enum": ["a"]}) == {"type": "string", "enum": ["a"]}


# ── schema-subset rail (2026-11-11, #1076): the server leaves out any capability whose args schema uses a keyword
# outside its structured-output subset (minItems, maxItems, minimum, pattern…). That must fail HERE, by name and
# keyword, never reach production as an action the model silently can't call.
def _outside_subset(caps):
    return {c["name"]: turn.schema_problems(c["args"]) for c in caps if turn.schema_problems(c["args"])}


def test_every_manifest_capability_is_inside_the_server_schema_subset():
    assert _outside_subset(CAPS) == {}, "these actions would be dropped by the server (bounds belong in code)"


def _planted(name="drawing.plantedControl"):
    planted = json.loads(json.dumps(BY["agent.capabilities"]))
    planted["name"] = name
    planted["args"] = {"type": "object", "additionalProperties": False, "required": ["levels"],
                       "properties": {"levels": {"type": "array", "minItems": 1, "maxItems": 3,
                                                 "items": {"type": "string", "enum": ["stop", "target"]}}}}
    return planted


def test_control_a_planted_minitems_capability_fails_the_rail_and_is_dropped_loudly(caplog, monkeypatch):
    monkeypatch.setattr(turn, "_SCHEMA_DROP_LOGGED", set())
    base = BY["agent.capabilities"]
    planted = _planted()
    assert _outside_subset(CAPS + [planted]) == {
        "drawing.plantedControl": ["args.levels: unsupported keyword(s) maxItems, minItems"]}
    with caplog.at_level("ERROR", logger=turn.__name__):
        kept = turn.validate_manifest([base, planted])
    assert [c["name"] for c in kept] == [base["name"]]
    msg = " ".join(r.getMessage() for r in caplog.records if r.levelname == "ERROR")
    assert "drawing.plantedControl left out" in msg and "minItems" in msg


def test_schema_problems_names_each_kind_of_violation():
    assert turn.schema_problems({"type": "object", "properties": {}, "required": [], "additionalProperties": False}) == []
    assert turn.schema_problems({"type": "object", "properties": {"a": {"type": "string"}},
                                 "required": [], "additionalProperties": False}) == ["args: required is not every property"]
    assert turn.schema_problems({"type": "object", "properties": {"n": {"type": "integer", "minimum": 0}},
                                 "required": ["n"], "additionalProperties": False}) == [
        "args.n: unsupported keyword(s) minimum"]
    assert turn.schema_problems({"type": "object", "properties": {"x": {"anyOf": [{"type": "null"}, {"type": "string", "pattern": "^a"}]}},
                                 "required": ["x"], "additionalProperties": False}) == [
        "args.x.anyOf[1]: unsupported keyword(s) pattern"]


def test_a_dropped_capability_is_logged_once_per_process_but_dropped_every_turn(caplog, monkeypatch):
    monkeypatch.setattr(turn, "_SCHEMA_DROP_LOGGED", set())
    base, planted = BY["agent.capabilities"], _planted("drawing.plantedOnce")
    with caplog.at_level("ERROR", logger=turn.__name__):
        first = turn.validate_manifest([base, planted])
        second = turn.validate_manifest([base, planted])
    assert [c["name"] for c in first] == [c["name"] for c in second] == [base["name"]]
    errors = [r for r in caplog.records if r.levelname == "ERROR" and "drawing.plantedOnce" in r.getMessage()]
    assert len(errors) == 1
