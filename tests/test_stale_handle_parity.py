"""ONE stale-handle repair rule, client and server.

The browser repairs a param-edited document whose `compute.fn` is stale on load
(`memberDocumentMigration.migrateStaleHandle`); the server mirrors the exact rule in
`user_definitions.refresh_stale_handle`, applied in memory at the save door and at
`scan_definition.def_hash`. Both suites read ONE fixture,
`tests/fixtures/stale_handle_cases.json` -- the vitest twin is
`app/src/components/chart/engine/__tests__/staleHandleParity.test.js`.
"""
import copy
import json
import pathlib

import pytest

from api.services import scan_definition, user_definitions

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "stale_handle_cases.json").read_text(encoding="utf-8"))
BASE = json.loads((ROOT / FIXTURE["base"]).read_text(encoding="utf-8"))["definition"]


def transformed(name):
    d = copy.deepcopy(BASE)
    c = d["compute"]
    if name == "dropTreesHash":
        del c["treesHash"]
    elif name == "dropManifest":
        del c["paramManifest"]
    elif name == "tamperTree":
        key = sorted(c["trees"])[-1]
        c["trees"][key] = {"type": "num", "value": 7}
    elif name == "dropFn":
        del c["fn"]
    elif name == "freshFn":
        c["fn"] = FIXTURE["expectFn"]
    elif name == "kindJs":
        c["kind"] = "js"
    return d


def test_the_python_hash_is_the_browsers():
    assert user_definitions.ast_hash(BASE["compute"]["ast"]) == FIXTURE["expectFn"]
    assert BASE["compute"]["fn"] != FIXTURE["expectFn"]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_one_rule(case):
    doc = transformed(case["transform"])
    before = json.dumps(doc, sort_keys=True)
    out = user_definitions.refresh_stale_handle(doc)
    assert json.dumps(doc, sort_keys=True) == before, "pure: the input is never mutated"
    if case["repaired"]:
        assert out is not doc
        assert out["compute"]["fn"] == FIXTURE["expectFn"]
        assert {k: v for k, v in out["compute"].items() if k != "fn"} == {k: v for k, v in doc["compute"].items() if k != "fn"}
    else:
        assert out is doc


def test_the_scan_door_accepts_the_repaired_document_and_still_refuses_a_forged_one():
    assert scan_definition.def_hash(copy.deepcopy(BASE)).startswith(FIXTURE["expectFn"])
    with pytest.raises(scan_definition.ScanRefused):
        scan_definition.def_hash(transformed("dropManifest"))
    with pytest.raises(scan_definition.ScanRefused):
        scan_definition.def_hash(transformed("tamperTree"))


@pytest.fixture
def store(tmp_path, monkeypatch):
    """`tests/test_param_manifest.py::store`, verbatim."""
    from api.services import alert_rev_migration as rev
    from api.services import indicator_alert_service as ias
    monkeypatch.setattr(user_definitions, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    user_definitions._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def test_the_save_door_stores_the_repaired_handle(store):
    import sqlite3
    doc = copy.deepcopy(BASE)
    doc["id"] = "u_5a1e0000e301"
    user_definitions.save("stale-user", "u_5a1e0000e301", doc)
    c = sqlite3.connect(user_definitions._DB_PATH)
    c.row_factory = sqlite3.Row
    row = user_definitions._newest(c, "stale-user", "u_5a1e0000e301")
    assert json.loads(row["definition"])["compute"]["fn"] == FIXTURE["expectFn"]
