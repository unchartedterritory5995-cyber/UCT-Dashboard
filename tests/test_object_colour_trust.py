"""Stabilization 1 -- a drawing program's colours are colours, at the server's save door.

⚰️ THE GAP (trust review 2026-10-08). A stored definition's ``objects`` program carries
colour literals as strings and the chart-table renderer writes them into CSS. The
server stored any string, and a share install / fork copies a stored row WITHOUT
presentation validation, so a hand-crafted definition shared to a second member could
put ``url(...)`` into that member's page (a privacy beacon; no script).

ASKED / DID per case. The grammar is held byte-equal to the browser's
(``objectColour.js``) and both lanes answer ``object_colour_cases.json``.
"""
from __future__ import annotations

import json
import pathlib
import re
import sqlite3

import pytest

from api.services import indicator_alert_service as ias
from api.services import presentation_schema as ps
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests/fixtures/ast/object_colour_cases.json").read_text(encoding="utf-8"))
JS = (ROOT / "app/src/components/chart/engine/objectColour.js").read_text(encoding="utf-8")
OWNER, FRIEND = "u-owner", "u-friend"


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()


def _colour(hex_):
    return {"v": "color", "node": {"c": "lit", "hex": hex_}}


def _definition(def_id, bg="#2962FF", text="#D1D4DC"):
    close = {"type": "series", "name": "close"}
    return {
        "schemaVersion": 1, "id": def_id, "version": 1,
        "meta": {"name": "Table", "shortName": "TBL", "repaint": "non-repainting"},
        "compute": {"kind": "ast", "ast": close, "fn": svc.ast_hash(close)},
        "placement": {"target": "price"},
        "plots": [{"key": "value", "style": "line", "role": "primary", "hidden": True}],
        "inputs": [],
        "objects": {"programVersion": 1, "regs": [{"id": 0, "family": "table"}], "colls": [], "trees": [],
                    "ops": [{"op": "create", "reg": 0, "props": {"position": {"v": "const", "value": "top_right"},
                                                                 "bgcolor": _colour(bg)}},
                            {"op": "cell", "reg": 0, "props": {"text_color": _colour(text)}}]},
    }


def test_the_grammar_is_byte_equal_to_the_browser_s():
    js = re.search(r"export const OBJECT_COLOUR_LITERAL = /(.+)/i\n", JS).group(1)
    assert js == ps.OBJECT_COLOUR_LITERAL.pattern


@pytest.mark.parametrize("value", CASES["literal"]["accept"])
def test_accepted_literals(value):
    assert ps.is_object_colour_literal(value)


@pytest.mark.parametrize("value", CASES["literal"]["reject"])
def test_rejected_literals(value):
    assert not ps.is_object_colour_literal(value)


def test_a_legitimate_table_saves_and_reopens_byte_identical():
    """ASKED: save a table whose colours are hex / theme references. DID: saved; read back equal."""
    def_id = svc.new_def_id()
    doc = _definition(def_id, bg="#2962FF80", text="chart.fg_color@20")
    svc.save(OWNER, def_id, doc)
    row = svc.get(OWNER, def_id)
    assert row["definition"]["objects"] == doc["objects"]


@pytest.mark.parametrize("bad", ["url(https://evil.example/x)", "#fff url(x)", "red", "expression(alert(1))"])
def test_a_handcrafted_unsafe_colour_is_refused_at_save(bad):
    """ASKED: POST a definition whose table colour is not a colour. DID: refused, nothing stored."""
    def_id = svc.new_def_id()
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save(OWNER, def_id, _definition(def_id, text=bad))
    assert exc.value.guard == "presentation:object-colour"
    assert svc.get(OWNER, def_id) is None


def test_a_nested_unsafe_colour_inside_a_conditional_is_found():
    def_id = svc.new_def_id()
    doc = _definition(def_id)
    doc["objects"]["ops"][1]["props"]["bgcolor"] = {"v": "color", "node": {
        "c": "if", "cond": {"v": "tree", "tree": 0},
        "then": {"c": "lit", "hex": "#000000"}, "else": {"c": "lit", "hex": "url(https://evil.example/x)"}}}
    with pytest.raises(svc.SaveRefused):
        svc.save(OWNER, def_id, doc)


def test_a_SHARED_unsafe_row_is_refused_at_install_and_fork():
    """ASKED: a row stored BEFORE this rule (simulated by writing it past the door) is shared;
    a second member installs it, and its owner forks it. DID: both copies refused -- the
    copy path skips presentation validation but never this check."""
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id))
    bad = _definition(def_id, text="url(https://evil.example/x)")
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute("UPDATE user_definitions SET definition = ? WHERE user_id = ? AND def_id = ?",
                  (json.dumps(bad), OWNER, def_id))
    token = svc.share(OWNER, def_id)["token"]
    with pytest.raises(svc.SaveRefused) as exc:
        svc.install_share(FRIEND, token)
    assert exc.value.guard == "presentation:object-colour"
    with sqlite3.connect(svc._DB_PATH) as c:
        assert c.execute("SELECT COUNT(*) FROM user_definitions WHERE user_id = ?", (FRIEND,)).fetchone()[0] == 0
    with pytest.raises(svc.SaveRefused):
        svc.fork(OWNER, def_id)


def test_a_SAFE_shared_table_still_installs():
    def_id = svc.new_def_id()
    svc.save(OWNER, def_id, _definition(def_id))
    token = svc.share(OWNER, def_id)["token"]
    out = svc.install_share(FRIEND, token)
    assert out
