"""UCT RS — the five count-only events at the indicator-telemetry door (plan §13).

`app/src/lib/rsTelemetry.js` posts `rs_on`, `rs_off_within_60s`, `rs_benchmark`,
`rs_marker_card` and `rs_learn` through
`POST /api/indicator-telemetry/event`, each with a fresh `import_id` and at most
one prop. This file proves the door: each event is accepted with every legal value
of its prop, and refused (422, nothing stored) with an unknown prop, another
event's prop, a container, or a free-text value under its own prop.

⛔ The closed sets in `api/services/indicator_telemetry.py` are one fact in two
files with `RS_LINE_V5_RAW` in `nativeRegistry.js`, and the event/prop table is one
fact in two files with `RS_TELEMETRY_EVENTS` in `rsTelemetry.js`. Both are PARSED
out of the JS here, never retyped.

⚰️ `rs_preset` was the sixth event until the RS split retired it (U9, 2026-11-09:
the slim UCT RS Line has no presets). It is refused at the door now, like any
unknown event, and this file proves THAT too; the preset parser went with it.
"""
from __future__ import annotations

import json
import pathlib
import re
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services import indicator_telemetry as tel
from api.services.signature import registry_defs

RS_EVENTS = ("rs_on", "rs_off_within_60s", "rs_benchmark", "rs_marker_card", "rs_learn")
RETIRED_EVENT = "rs_preset"   # U9
_JS_DEF = pathlib.Path("app/src/components/chart/engine/nativeRegistry.js")
_JS_TEL = pathlib.Path("app/src/lib/rsTelemetry.js")


# ── the JS, parsed ─────────────────────────────────────────────────────────

def _rs_body() -> str:
    return _JS_DEF.read_text(encoding="utf-8").split("const RS_LINE_V5_RAW = {", 1)[1]


def _js_learn() -> set:
    block = _rs_body().split("\n    learn: [", 1)[1].split("\n    ],", 1)[0]
    return set(re.findall(r"\{ key: '(\w+)'", block))


def _js_card_keys() -> set:
    block = _rs_body().split("\n  readout: [", 1)[1].split("\n  ],", 1)[0]
    block = "\n".join(line for line in block.split("\n") if not line.lstrip().startswith("//"))
    out = set()
    for entry in re.split(r"\n    \{", block)[1:]:
        if re.search(r"\bcard:\s*\{", entry):
            out.add(re.search(r"\bkey:\s*'(\w+)'", entry).group(1))
    return out


def _js_benchmarks() -> set:
    # 2026-11-12: the menu is the shared benchmark declaration every RS definition spreads.
    src = _JS_DEF.read_text(encoding="utf-8").split("const rsSplitBenchmarkInputs = () => ([", 1)[1]
    m = re.search(r"key: 'benchmark', type: 'enum'.*?options: \[(.*?)\]\],", src, re.S)
    return set(re.findall(r"\['(\w+)', '", m.group(1)))


def _js_event_props() -> dict:
    src = _JS_TEL.read_text(encoding="utf-8")
    block = src.split("export const RS_TELEMETRY_EVENTS = Object.freeze({", 1)[1].split("\n})", 1)[0]
    return {e: p for e, p in re.findall(r"(\w+): Object\.freeze\(\['(\w+)'\]\)", block)}


def _js_symbol_re() -> str:
    m = re.search(r"export const SYMBOL_RE = /\^(.*?)\$/", _JS_TEL.read_text(encoding="utf-8"))
    return m.group(1)


def test_the_parsers_read_what_they_claim_to():
    assert _js_learn() >= {"rsLine", "fourChecks"} and len(_js_learn()) == 6
    assert {"ratingSummary", "beforePrice", "checks", "rotation", "quality", "vars"} <= _js_card_keys()
    assert "rating" not in _js_card_keys(), "a detail row with no card opens nothing"
    assert _js_benchmarks() >= {"SPY", "SECTOR", "CUSTOM"}
    assert len(_js_event_props()) == 5   # U9: six less the retired rs_preset


# ── the lists, against their owners ────────────────────────────────────────

def test_the_five_are_known_and_client_fireable_and_the_retired_one_is_not():
    for e in RS_EVENTS:
        assert e in tel.EVENTS and e in tel.CLIENT_FIREABLE_EVENTS, e
    # U9: retired means GONE from every list, not left dangling
    assert RETIRED_EVENT not in tel.EVENTS and RETIRED_EVENT not in tel.CLIENT_FIREABLE_EVENTS
    assert RETIRED_EVENT not in tel.EVENT_SCHEMAS and RETIRED_EVENT not in tel._VALUE_RULES
    assert not hasattr(tel, "RS_PRESETS")
    assert RETIRED_EVENT not in _js_event_props()
    # the server-decision events stay server-only
    for e in ("import_accepted", "delivery_configured", "execution_finished", "converse_turn"):
        assert e not in tel.CLIENT_FIREABLE_EVENTS, e


def test_each_schema_is_exactly_the_correlation_id_and_the_one_prop_the_client_sends():
    props = _js_event_props()
    assert set(props) == set(RS_EVENTS)
    for e, prop in props.items():
        assert tel.EVENT_SCHEMAS[e] == {"import_id": (str,), prop: (str,)}, e
        assert set(tel._VALUE_RULES[e]) == {"import_id", prop}, f"{e}: every string prop has a value rule"


def test_the_closed_sets_are_the_definitions_own():
    assert tel.RS_LEARN_TARGETS == _js_learn()
    assert tel.RS_CARD_KINDS == _js_card_keys()
    # the benchmark rule reads the v4 menu, which the JS enum mirrors (3-08)
    assert set(registry_defs.RS_LINE_BENCHMARKS_V4) == _js_benchmarks()


def test_the_client_symbol_rule_is_the_servers():
    assert _js_symbol_re() == tel._RS_TICKER.pattern


# ── the door ───────────────────────────────────────────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    return tmp_path


@pytest.fixture
def client(db):
    from api.middleware.auth_middleware import get_current_user
    from api.routers import indicator_telemetry as router_mod
    a = FastAPI()
    a.include_router(router_mod.router)
    a.dependency_overrides[get_current_user] = lambda: {"id": "u1", "role": "user"}
    return TestClient(a)


def _rows(event: str) -> list:
    conn = auth_db.get_connection()
    try:
        return [json.loads(r[0]) if r[0] else {} for r in conn.execute(
            "SELECT props FROM landing_events WHERE visitor_id = 'u1' AND event = ? ORDER BY id", (event,))]
    finally:
        conn.close()


def _post(client, event, props=None, import_id=None, dialect=None):
    return client.post("/api/indicator-telemetry/event", json={
        "event": event, "import_id": import_id or str(uuid.uuid4()), "dialect": dialect, "props": props})


def _legal():
    out = []
    for e in ("rs_on", "rs_off_within_60s"):
        for sym in ("NVDA", "BRK-B", "BRK.B", "X:BTCUSD", "A"):
            out.append((e, "symbol", sym))
    out += [("rs_benchmark", "value", v) for v in registry_defs.RS_LINE_BENCHMARKS_V4]
    out += [("rs_marker_card", "kind", v) for v in sorted(tel.RS_CARD_KINDS)]
    out += [("rs_learn", "target", v) for v in sorted(tel.RS_LEARN_TARGETS)]
    return out


@pytest.mark.parametrize("event,prop,value", _legal())
def test_each_event_is_accepted_with_each_legal_value_and_stores_only_that(client, event, prop, value):
    iid = str(uuid.uuid4())
    r = _post(client, event, {prop: value}, import_id=iid)
    assert r.status_code == 200 and r.json()["logged"] is True, r.text
    assert _rows(event) == [{"import_id": iid, prop: value}]


@pytest.mark.parametrize("event", RS_EVENTS)
def test_each_event_is_accepted_with_no_prop_the_client_dropped_it(client, event):
    # the client drops a value its own rule refuses and still sends the count
    r = _post(client, event, {}, import_id=f"{event}:1762530000000:k3j9x2ab")
    assert r.status_code == 200 and r.json()["logged"] is True
    assert _rows(event) == [{"import_id": f"{event}:1762530000000:k3j9x2ab"}]


def test_dialect_is_never_stored_for_an_rs_event(client):
    r = _post(client, "rs_marker_card", {"kind": "checks"}, dialect="pine")
    assert r.status_code == 200
    assert "dialect" not in _rows("rs_marker_card")[0]


def test_the_retired_rs_preset_is_refused_at_the_door_and_nothing_is_stored(client):
    # U9: a build that still sent the count would get 400 (no prop) / 422 (its old prop), never a row
    assert _post(client, RETIRED_EVENT, {}).status_code == 400
    assert _post(client, RETIRED_EVENT, {"name": "classic"}).status_code == 422
    assert _rows(RETIRED_EVENT) == []


_REFUSED = [
    # an unknown prop, however short
    ("rs_on", {"note": "hi"}),
    ("rs_marker_card", {"email": "a@b.co"}),
    # another event's prop
    ("rs_on", {"kind": "checks"}),
    ("rs_learn", {"kind": "checks"}),
    ("rs_benchmark", {"symbol": "NVDA"}),
    # free text under the event's own prop
    ("rs_on", {"symbol": "nvda"}),
    ("rs_on", {"symbol": "I like this stock"}),
    ("rs_off_within_60s", {"symbol": "ABCDEFGHIJKLM"}),
    ("rs_learn", {"target": "my own lesson"}),
    ("rs_learn", {"target": "RedDay"}),
    ("rs_benchmark", {"value": "AAPL"}),
    ("rs_benchmark", {"value": "spy"}),
    ("rs_marker_card", {"kind": "rating"}),
    ("rs_marker_card", {"kind": "the card about checks"}),
    ("rs_learn", {"target": "https://example.com"}),
    # a container, a number, a bool under a legal key
    ("rs_learn", {"target": ["redDay"]}),
    ("rs_marker_card", {"kind": {"k": "checks"}}),
    ("rs_learn", {"target": 7}),
    ("rs_on", {"symbol": True}),
    # a correlation id smuggled as a prop must match its rule too
    ("rs_learn", {"target": "redDay", "import_id": "has spaces in it"}),
]


@pytest.mark.parametrize("event,props", _REFUSED)
def test_refused_with_an_unknown_prop_or_a_free_text_value_and_nothing_is_stored(client, event, props):
    r = _post(client, event, props)
    assert r.status_code == 422, (event, props, r.text)
    assert _rows(event) == []


def test_an_rs_event_spelled_wrong_is_refused(client):
    # with a prop the unknown event has no schema for, the props check answers first (422)
    assert _post(client, "rs_onn", {"symbol": "NVDA"}).status_code == 422
    # with none, the event list does (400)
    assert _post(client, "rs_onn", {}).status_code == 400
    assert _rows("rs_onn") == []


def test_a_malformed_import_id_is_dropped_server_side_never_stored(db):
    assert tel.log_event("u1", "rs_learn", import_id="x" * 80, target="redDay") is True
    assert _rows("rs_learn") == [{"target": "redDay"}]


def test_the_benchmark_rule_fails_closed_when_the_row_cannot_be_read(monkeypatch):
    class Broken:
        def __getattr__(self, name):
            raise RuntimeError("row gone")
    import api.services.signature as sigpkg
    monkeypatch.setattr(sigpkg, "registry_defs", Broken())
    assert tel._prop_violation("rs_benchmark", "value", "SPY") is not None
