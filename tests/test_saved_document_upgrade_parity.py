"""ONE saved-document width-control upgrade, client and server.

A plot's width control saved before #526 stops at 4 (the Builder's old constant). The
browser raises its `max` on load (`memberDocumentMigration.migrateWidthControlMax`);
the server mirrors the exact rule in `user_definitions.refresh_width_control_max`,
applied in memory at the save door. Both suites read ONE fixture,
`tests/fixtures/saved_document_upgrade_cases.json` -- the vitest twin is
`app/src/components/chart/engine/__tests__/savedDocumentUpgradeParity.test.js`.
"""
import copy
import json
import pathlib

import pytest

from api.services import user_definitions

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "saved_document_upgrade_cases.json").read_text(encoding="utf-8"))
BASE = json.loads((ROOT / FIXTURE["base"]).read_text(encoding="utf-8"))["definition"]


def apply_ops(doc, ops):
    for op in ops:
        kind = op["op"]
        if kind == "allWidthControls":
            for s in doc["inputs"]:
                if s["key"] in FIXTURE["widthControlKeys"]:
                    s.update(op["set"])
        elif kind == "input":
            next(s for s in doc["inputs"] if s["key"] == op["key"]).update(op["set"])
        elif kind == "addInput":
            doc["inputs"].append(copy.deepcopy(op["spec"]))
        elif kind == "plotWidth":
            next(p for p in doc["plots"] if p["key"] == op["plot"])["width"] = op["value"]
        elif kind == "dropPlots":
            del doc["plots"]
        else:
            raise AssertionError(f"unknown op {kind}")
    return doc


def expected(doc, case):
    want = copy.deepcopy(doc)
    for s in want["inputs"]:
        if s["key"] in case["upgraded"]:
            s["max"] = (case.get("max") or {}).get(s["key"], FIXTURE["defaultMax"])
    return want


def test_the_fixture_is_not_vacuous():
    assert len(FIXTURE["widthControlKeys"]) == len(BASE["plots"])
    for k in FIXTURE["widthControlKeys"]:
        spec = next(s for s in BASE["inputs"] if s["key"] == k)
        assert (spec["type"], spec["min"], spec["max"], spec["step"]) == ("int", 1, 4, 1)


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_one_rule(case):
    doc = apply_ops(copy.deepcopy(BASE), case["ops"])
    before = json.dumps(doc, sort_keys=True)
    out = user_definitions.refresh_width_control_max(doc)
    assert json.dumps(doc, sort_keys=True) == before, "pure: the input is never mutated"
    if not case["upgraded"]:
        assert out is doc
        return
    assert out is not doc
    assert out == expected(doc, case)
    assert out["compute"] is doc["compute"]
    assert out["plots"] is doc["plots"]


def test_idempotent():
    once = user_definitions.refresh_width_control_max(copy.deepcopy(BASE))
    assert user_definitions.refresh_width_control_max(once) is once
    again = json.loads(json.dumps(once))
    assert user_definitions.refresh_width_control_max(again) is again


@pytest.fixture
def store(tmp_path, monkeypatch):
    """`tests/test_stale_handle_parity.py::store`, verbatim."""
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


def _stored(user, def_id):
    import sqlite3
    c = sqlite3.connect(user_definitions._DB_PATH)
    c.row_factory = sqlite3.Row
    row = user_definitions._newest(c, user, def_id)
    return json.loads(row["definition"])


def test_the_save_door_stores_todays_control_and_a_resave_changes_nothing(store):
    doc = copy.deepcopy(BASE)
    doc["id"] = "u_5a1e0000e302"
    user_definitions.save("width-user", "u_5a1e0000e302", doc)
    first = _stored("width-user", "u_5a1e0000e302")
    for k in FIXTURE["widthControlKeys"]:
        spec = next(s for s in first["inputs"] if s["key"] == k)
        orig = next(s for s in BASE["inputs"] if s["key"] == k)
        assert spec["max"] == 10, k
        assert {kk: v for kk, v in spec.items() if kk != "max"} == {kk: v for kk, v in orig.items() if kk != "max"}
    # ⛔ no churn: re-saving what the store holds stores the same document
    user_definitions.save("width-user", "u_5a1e0000e302", copy.deepcopy(first))
    second = _stored("width-user", "u_5a1e0000e302")
    assert json.dumps(second, sort_keys=True) == json.dumps(first, sort_keys=True)
