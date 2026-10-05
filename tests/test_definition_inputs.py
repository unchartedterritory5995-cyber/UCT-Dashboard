"""A1 (2026-10-04) — server-side validation of a definition's ``inputs[]``.

What this file proves, each half separately:

1. EVERY RULE REFUSES BY FIELD PATH, and a legal document passes untouched —
   the rail for each guard is the SENTENCE, not merely "it raised"
   (`lesson_rail_the_sentence_not_just_the_guard`).
2. THE STORE'S OWN DOOR CALLS IT, on the ast lane AND the runtime lane, before
   anything is written (a refused save leaves no row behind).
3. THE MIRRORED VOCABULARY HAS NOT DRIFTED from the browser's — read out of
   ``defSchema.js`` / ``parse.js`` here, never retyped in the assertion.
"""
from __future__ import annotations

import copy
import re
import sqlite3
from pathlib import Path

import pytest

from api.services import definition_inputs as di
from api.services import indicator_alert_service as ias
from api.services import alert_rev_migration as rev
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
DEF_SCHEMA_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "defSchema.js"
PARSE_JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "parse.js"


def _good_inputs() -> list:
    """The shapes a shipped builder document carries: chrome + a member knob +
    every other buildable type."""
    return [
        {"key": "color", "type": "color", "label": "Color", "default": "#c9a84c"},
        {"key": "lineWidth", "type": "int", "label": "Line width", "default": 1,
         "min": 1, "max": 4, "step": 1},
        {"key": "mult", "type": "float", "label": "Mult", "default": 2.0, "min": 0.5},
        {"key": "showBand", "type": "bool", "label": "Show band", "default": True},
        {"key": "mode", "type": "enum", "options": [["a", "A"], {"value": "b"}, "c"],
         "default": "b"},
        {"key": "src", "type": "source", "default": "close",
         "activeWhen": {"key": "showBand", "equals": True}},
        {"key": "note", "type": "string", "default": ""},
    ]


def _doc(inputs) -> dict:
    return {"id": "x", "inputs": inputs}


# ─── 1. the rules ────────────────────────────────────────────────────────────

def test_a_legal_roster_passes():
    di.validate_inputs(_doc(_good_inputs()))
    di.validate_inputs({"id": "x"})            # no inputs at all is legal
    di.validate_inputs(_doc([]))


def test_an_integral_float_is_an_int_as_the_browser_reads_it():
    # JSON cannot tell `5` from `5.0` once a browser parsed it; Number.isInteger(5.0)
    di.validate_inputs(_doc([{"key": "n", "type": "int", "default": 5.0}]))


def _bad(**over):
    spec = {"key": "len", "type": "int", "default": 14}
    spec.update(over)
    return spec


REFUSALS = [
    ("not a list", {"id": "x", "inputs": {"len": 14}}, r"^inputs: expected an array"),
    ("null roster", {"id": "x", "inputs": None}, r"^inputs: expected an array, got null"),
    ("row not an object", _doc(["len"]), r"^inputs\[0\]: expected an object"),
    ("missing key", _doc([{"type": "int", "default": 1}]), r"^inputs\[0\]\.key: required"),
    ("illegal key", _doc([_bad(key="my len")]), r"^inputs\[0\]\.key: \"my len\" is not a legal"),
    ("leading digit", _doc([_bad(key="1len")]), r"^inputs\[0\]\.key: \"1len\" is not a legal"),
    ("duplicate key", _doc([_bad(), _bad()]),
     r"^inputs\[1\]\.key: duplicate input key \"len\" \(first declared at inputs\[0\]\)"),
    ("shadows a series", _doc([_bad(key="close")]),
     r"^inputs\[0\]\.key: \"close\" is already a name this engine computes"),
    ("shadows a function", _doc([_bad(key="sma")]), r"^inputs\[0\]\.key: \"sma\" is already"),
    ("shadows a scalar", _doc([_bad(key="market_cap")]), r"^inputs\[0\]\.key: \"market_cap\""),
    ("shadows a clock field", _doc([_bad(key="hour")]), r"^inputs\[0\]\.key: \"hour\""),
    ("shadows a recurrence binding", _doc([_bad(key="self")]), r"^inputs\[0\]\.key: \"self\""),
    ("unknown type", _doc([_bad(type="number")]), r"^inputs\[0\]\.type: unknown input type"),
    ("reserved type", _doc([_bad(type="timeframe")]), r"^inputs\[0\]\.type: .*SCHEMA-RESERVED"),
    ("no default", _doc([{"key": "len", "type": "int"}]), r"^inputs\[0\]\.default: required"),
    ("int as text", _doc([_bad(default="14")]), r"^inputs\[0\]\.default: type \"int\" requires"),
    ("int fractional", _doc([_bad(default=14.5)]), r"^inputs\[0\]\.default: type \"int\""),
    ("bool is not an int", _doc([_bad(default=True)]), r"^inputs\[0\]\.default: type \"int\""),
    ("float NaN", _doc([_bad(type="float", default=float("nan"))]),
     r"^inputs\[0\]\.default: type \"float\" requires a finite number"),
    ("bool as int", _doc([_bad(type="bool", default=1)]), r"^inputs\[0\]\.default: type \"bool\""),
    ("empty colour", _doc([_bad(type="color", default="")]), r"^inputs\[0\]\.default: type \"color\""),
    ("empty source", _doc([_bad(type="source", default="")]), r"^inputs\[0\]\.default: type \"source\""),
    ("string as number", _doc([_bad(type="string", default=3)]), r"^inputs\[0\]\.default: type \"string\""),
    ("enum without options", _doc([_bad(type="enum", default="a")]),
     r"^inputs\[0\]\.default: type \"enum\" requires a non-empty options array"),
    ("enum non-scalar option", _doc([_bad(type="enum", options=[{"value": [1]}], default="a")]),
     r"^inputs\[0\]\.default: enum option values must be scalars"),
    ("enum default not an option", _doc([_bad(type="enum", options=["a", "b"], default="z")]),
     r"^inputs\[0\]\.default: \"z\" is not one of the declared options"),
    ("enum true is not 1", _doc([_bad(type="enum", options=[1, 2], default=True)]),
     r"^inputs\[0\]\.default: true is not one of"),
    ("below min", _doc([_bad(min=20)]), r"^inputs\[0\]\.default: 14 is below the declared min 20"),
    ("above max", _doc([_bad(max=10)]), r"^inputs\[0\]\.default: 14 is above the declared max 10"),
    ("min not a number", _doc([_bad(min="1")]), r"^inputs\[0\]\.min: expected a finite number"),
    ("step null", _doc([_bad(step=None)]), r"^inputs\[0\]\.step: expected a finite number, got null"),
    ("min > max", _doc([_bad(type="string", min=20, max=10, default="")]), r"^inputs\[0\]: min must be <= max"),
    ("step <= 0", _doc([_bad(step=0)]), r"^inputs\[0\]\.step: must be > 0"),
    ("label not a string", _doc([_bad(label=3)]), r"^inputs\[0\]\.label: expected a string"),
    ("activeWhen not an object", _doc([_bad(activeWhen="x")]),
     r"^inputs\[0\]\.activeWhen: expected an object"),
    ("activeWhen dangling", _doc([_bad(activeWhen={"key": "ghost"})]),
     r"^inputs\[0\]\.activeWhen\.key: unresolvable reference \"ghost\""),
    ("activeWhen self", _doc([_bad(activeWhen={"key": "len"})]),
     r"^inputs\[0\]\.activeWhen\.key: \"len\" refers to its own input"),
]


@pytest.mark.parametrize("name,doc,sentence", REFUSALS, ids=[r[0] for r in REFUSALS])
def test_each_rule_refuses_by_field_path(name, doc, sentence):
    with pytest.raises(ValueError) as exc:
        di.validate_inputs(doc)
    assert re.search(sentence, str(exc.value)), f"{name}: {exc.value}"


def test_the_reserved_set_is_the_interpreters_and_reads_the_manifest():
    names = di.table_names()
    # a member of every section the interpreter's shadow check reads
    for n in ("close", "sma", "market_cap", "hour", "self"):
        assert n in names
    # …and the builder's ordinary knob names stay free
    for n in ("color", "lineWidth", "len", "src", "mult"):
        assert n not in names


# ─── 2. the store's door calls it, on every lane ─────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _sma_doc(def_id: str, inputs) -> dict:
    ast = {"type": "call", "name": "sma", "args": [{"type": "series", "name": "close"},
                                                 {"type": "num", "value": 20}]}
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "compute": {"kind": "ast", "fn": svc.ast_hash(ast), "rev": 1, "ast": ast,
                    "source": "sma(close, 20)"},
        "meta": {"name": "SMA", "tier": "premium", "repaint": "non-repainting",
                 "freshness": "live"},
        "placement": {"target": "price"},
        "inputs": inputs,
        "plots": [{"key": "value", "style": "line", "color": "$color", "width": "$lineWidth"}],
    }


def _rows(tmp_path) -> int:
    con = sqlite3.connect(str(tmp_path / "user_definitions.db"))
    try:
        return con.execute("SELECT COUNT(*) FROM user_definitions").fetchone()[0]
    finally:
        con.close()


def test_the_store_saves_a_legal_document(store):
    inputs = [{"key": "color", "type": "color", "default": "#c9a84c"},
              {"key": "lineWidth", "type": "int", "default": 1, "min": 1, "max": 4}]
    row = svc.save("u1", "u_0000000000a1", _sma_doc("u_0000000000a1", inputs))
    assert row["def_id"] == "u_0000000000a1"
    assert _rows(store) == 1


def test_the_store_refuses_a_shadowing_knob_and_writes_nothing(store):
    inputs = [{"key": "color", "type": "color", "default": "#c9a84c"},
              {"key": "lineWidth", "type": "int", "default": 1},
              {"key": "close", "type": "float", "default": 1.0}]
    with pytest.raises(ValueError, match=r"^inputs\[2\]\.key: \"close\" is already a name"):
        svc.save("u1", "u_0000000000b2", _sma_doc("u_0000000000b2", inputs))
    assert _rows(store) == 0


def test_the_runtime_lane_is_validated_before_its_own_door(store):
    # ⛔ The runtime save switch is OFF in this test, so if inputs were checked
    # only on the ast lane this would raise the runtime door's own sentence
    # instead. The sentence below proves the inputs door ran FIRST, on this lane.
    doc = {"id": "u_0000000000c3", "compute": {"kind": "runtime", "source": "//@version=5"},
           "inputs": [{"key": "len", "type": "int", "default": "14"}]}
    with pytest.raises(ValueError, match=r"^inputs\[0\]\.default: type \"int\" requires"):
        svc.save("u1", "u_0000000000c3", doc)
    assert _rows(store) == 0


def test_a_put_payload_is_validated_the_same_way(store):
    inputs = [{"key": "color", "type": "color", "default": "#c9a84c"},
              {"key": "lineWidth", "type": "int", "default": 1}]
    svc.save("u1", "u_0000000000d4", _sma_doc("u_0000000000d4", inputs))
    bad = copy.deepcopy(_sma_doc("u_0000000000d4", inputs))
    bad["inputs"].append({"key": "lineWidth", "type": "int", "default": 2})
    with pytest.raises(ValueError, match=r"^inputs\[2\]\.key: duplicate input key"):
        svc.save("u1", "u_0000000000d4", bad)
    assert _rows(store) == 1


# ─── 3. the mirrored vocabulary has not drifted ──────────────────────────────

def _frozen_array(js: str, name: str) -> tuple:
    m = re.search(rf"export const {name} = Object\.freeze\(\[(.*?)\]\)", js, re.S)
    assert m, f"{name} not found in defSchema.js — the rail cannot read it"
    return tuple(re.findall(r"'([^']+)'", m.group(1)))


def test_input_types_match_defschema():
    js = DEF_SCHEMA_JS.read_text(encoding="utf-8")
    assert di.INPUT_TYPES == _frozen_array(js, "INPUT_TYPES")
    assert di.RESERVED_INPUT_TYPES == _frozen_array(js, "RESERVED_INPUT_TYPES")


def test_key_pattern_matches_parse_js():
    js = PARSE_JS.read_text(encoding="utf-8")
    m = re.search(r"export const KEY_RE = /(.+?)/\s*$", js, re.M)
    assert m, "KEY_RE not found in parse.js — the rail cannot read it"
    assert di.KEY_PATTERN == m.group(1)


def test_string_modifiers_match_defschema():
    js = DEF_SCHEMA_JS.read_text(encoding="utf-8")
    m = re.search(r"for \(const k of \[([^\]]+)\]\) \{\s*if \(input\[k\] !== undefined && "
                  r"typeof input\[k\] !== 'string'\)", js)
    assert m, "the presentation-modifier loop moved in defSchema.js"
    assert di._STRING_MODIFIERS == tuple(re.findall(r"'([^']+)'", m.group(1)))
