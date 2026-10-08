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


def test_server_limits_equal_the_shared_contract():
    L = CONTRACT["limits"]
    assert turn.MAX_CAPABILITIES == L["maxCapabilities"]
    assert turn.MAX_CAP_BYTES == L["maxCapBytes"]
    assert turn.MAX_HINTS == L["maxHints"]
    assert turn.MAX_CONTEXT_BYTES == L["maxContextBytes"]
    assert turn.MAX_OPS == L["maxOps"]
    assert CONTRACT["manifestVersion"] in turn.MANIFEST_VERSIONS
    assert GOLDEN["manifestVersion"] == CONTRACT["manifestVersion"]


def test_the_real_manifest_survives_validation_intact():
    kept = turn.validate_manifest(CAPS)
    assert [c["name"] for c in kept] == [c["name"] for c in CAPS], "an entry was dropped by the server"
    for c in kept:
        src = BY[c["name"]]
        assert c["summary"] == src["summary"], f"{c['name']}: summary cut"
        assert c["hints"] == src["hints"], f"{c['name']}: hints cut"
        assert c["undo"] == src["undo"] and c["reversible"] == src["reversible"]


def test_schema_and_prompt_build_from_the_real_manifest():
    kept = turn.validate_manifest(CAPS)
    schema = turn.envelope_schema(kept)
    assert schema["type"] == "object"
    prompt = turn.system_prompt(kept)
    for c in kept:
        assert f"- {c['name']}(" in prompt
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
    for c in turn.validate_manifest(CAPS):
        props = c["args"]["properties"]
        sample = {}
        for k, p in props.items():
            if p.get("enum"):
                sample[k] = next(v for v in p["enum"] if v is not None) if any(v is not None for v in p["enum"]) else None
            else:
                t = p.get("type")
                t = t[0] if isinstance(t, list) else t
                sample[k] = {"string": "x", "number": 1, "integer": 1, "boolean": True, "null": None,
                             "array": [], "object": {}}.get(t, None)
        if any(v is None and "null" not in json.dumps(props[k]) for k, v in sample.items()):
            continue  # an anyOf/object arg with no simple sample; the browser re-validates it
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
