"""THE DOOR STAMPS, client and server.

The Pine doors stamp `meta.pineVersion`, `meta.doorVersion` and each static band's
raw `fillTransparency`; the browser resolves a band from them on load
(`memberDocumentMigration.upgradeFromDoorStamps`) and the server mirrors the exact
rule at its save door (`user_definitions.refresh_from_door_stamps`). Both suites
read ONE fixture, `tests/fixtures/door_stamp_cases.json` -- the vitest twin is
`app/src/components/chart/engine/__tests__/doorStamps.test.js`.
"""
import copy
import json
import pathlib

import pytest

from api.services import presentation_schema, scan_definition, user_definitions

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "door_stamp_cases.json").read_text(encoding="utf-8"))


def doc_of(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))["definition"]


def _future_v2(stamp, pv):
    legacy = not isinstance(pv, int) or pv <= 4
    if stamp["via"] == "none" and not legacy:
        return FIXTURE["future"]["modernNoneOpacity"]
    return user_definitions.stamped_fill_opacity(stamp, pv)


FUTURE_RULES = {1: user_definitions.stamped_fill_opacity, 2: _future_v2}


def apply_ops(doc, ops):
    def plot(k):
        return next(p for p in doc["plots"] if p["key"] == k)
    for op in ops:
        kind = op["op"]
        if kind == "deletePlotField":
            plot(op["plot"]).pop(op["field"], None)
        elif kind == "setPlotField":
            plot(op["plot"])[op["field"]] = copy.deepcopy(op["value"])
        elif kind == "deleteMeta":
            doc["meta"].pop(op["key"], None)
        elif kind == "setMeta":
            doc["meta"][op["key"]] = op["value"]
        elif kind == "setFill":
            plot(op["plot"])["fill"].update(op["set"])
        else:
            raise AssertionError(f"unknown op {kind}")
    return doc


def test_the_server_door_version_is_the_browsers():
    assert user_definitions.DOOR_VERSION == FIXTURE["doorVersion"]
    assert max(user_definitions.DOOR_FILL_RULES) == user_definitions.DOOR_VERSION


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_one_rule(case):
    doc = apply_ops(doc_of(case["base"]), case["ops"])
    before = json.dumps(doc, sort_keys=True)
    rules = FUTURE_RULES if case.get("rules") == "future" else None
    out = user_definitions.refresh_from_door_stamps(doc, rules)
    assert json.dumps(doc, sort_keys=True) == before, "pure"
    if not case["expect"]:
        assert out is doc
    else:
        want = json.loads(before)
        for k, v in case["expect"].items():
            next(p for p in want["plots"] if p["key"] == k)["fillOpacity"] = v
        assert json.dumps(out, sort_keys=True) == json.dumps(want, sort_keys=True)
        assert out["compute"] is doc["compute"]
    assert user_definitions.refresh_from_door_stamps(out, rules) is out, "idempotent"
    if case.get("validates"):
        user_definitions.validate_v2(doc)
        assert presentation_schema.presentation_errors(doc) == []
        user_definitions.validate_v2(out)
        assert presentation_schema.presentation_errors(out) == []


def test_an_unstamped_old_save_is_never_guessed():
    old = doc_of("tests/fixtures/pine_param_ids/clouds-saved-master-e3-edit.json")
    assert user_definitions.refresh_from_door_stamps(old) is old


def test_the_stamps_are_in_no_hash():
    stamped = doc_of("tests/fixtures/door_stamps/v6-fills.json")
    bare = apply_ops(doc_of("tests/fixtures/door_stamps/v6-fills.json"), FIXTURE["cases"][1]["ops"])
    assert "pineVersion" not in bare["meta"]
    assert scan_definition.def_hash(copy.deepcopy(stamped)) == scan_definition.def_hash(copy.deepcopy(bare))


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
    return json.loads(user_definitions._newest(c, user, def_id)["definition"])


def test_the_save_door_keeps_the_stamps_and_resolves_a_stated_nothing_band(store):
    doc = doc_of("tests/fixtures/door_stamps/v6-fills.json")
    doc["id"] = "u_d00e57a3b001"
    del next(p for p in doc["plots"] if p["key"] == "value")["fillOpacity"]
    user_definitions.save("stamp-user", doc["id"], doc)
    first = _stored("stamp-user", doc["id"])
    assert first["meta"]["pineVersion"] == 6
    assert first["meta"]["doorVersion"] == user_definitions.DOOR_VERSION
    value = next(p for p in first["plots"] if p["key"] == "value")
    out3 = next(p for p in first["plots"] if p["key"] == "out3")
    assert value["fillOpacity"] == 1
    assert value["fillTransparency"] == {"value": None, "via": "none"}
    assert out3["fillTransparency"] == {"value": 87.5, "via": "color"}
    user_definitions.save("stamp-user", doc["id"], copy.deepcopy(first))
    assert json.dumps(_stored("stamp-user", doc["id"]), sort_keys=True) == json.dumps(first, sort_keys=True)


def test_the_save_door_never_guesses_an_unstamped_band(store):
    doc = apply_ops(doc_of("tests/fixtures/door_stamps/v6-fills.json"), FIXTURE["cases"][1]["ops"])
    doc["id"] = "u_d00e57a3b002"
    user_definitions.save("stamp-user", doc["id"], doc)
    stored = _stored("stamp-user", doc["id"])
    assert "fillOpacity" not in next(p for p in stored["plots"] if p["key"] == "value")
