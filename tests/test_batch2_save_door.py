"""BATCH 2 -- the server's save door accepts the definitions Batch 2 writes, and serves
them back exactly: four-state palette plots, three-state palette candle paints, tables
with conditional / theme colours, text sizes and merged headers, sized markers, and the
stored expansions of linreg / correlation. The fixture is written by the browser's own
engine (``batch2.saveFixture.test.js`` holds it equal to what the engine builds today).
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import indicator_alert_service as ias
from api.services import presentation_schema as ps
from api.services import user_definitions as svc

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFS = json.loads((ROOT / "tests/fixtures/authoring/batch2_definitions.json").read_text(encoding="utf-8"))
OWNER, FRIEND = "u-owner", "u-friend"


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()


def _look(d):
    return {k: d.get(k) for k in ("plots", "paints", "objects", "inputs", "placement")}


@pytest.mark.parametrize("name", sorted(DEFS))
def test_saves_and_reopens_exactly(name):
    doc = json.loads(json.dumps(DEFS[name]))
    def_id = svc.new_def_id()
    doc["id"] = def_id
    svc.save(OWNER, def_id, doc)
    got = svc.get(OWNER, def_id)["definition"]
    assert _look(got) == _look(DEFS[name])
    assert got["compute"]["ast"] == DEFS[name]["compute"]["ast"] if "ast" in DEFS[name]["compute"] else True


@pytest.mark.parametrize("name", sorted(DEFS))
def test_no_colour_problem_and_shareable(name):
    doc = DEFS[name]
    assert ps.definition_colour_errors(doc) == []
    if doc.get("objects"):
        assert ps.object_colour_errors(doc["objects"]) == []
    def_id = svc.new_def_id()
    d = json.loads(json.dumps(doc))
    d["id"] = def_id
    svc.save(OWNER, def_id, d)
    token = svc.share(OWNER, def_id)["token"]
    assert svc.install_share(FRIEND, token)          # the strict copy path accepts it too
    assert svc.fork(OWNER, def_id)


def test_a_palette_with_a_non_colour_is_still_refused():
    doc = json.loads(json.dumps(DEFS["four_state_histogram"]))
    def_id = svc.new_def_id()
    doc["id"] = def_id
    plot = next(p for p in doc["plots"] if p.get("colorPalette"))
    plot["colorPalette"][2] = "url(https://evil.example/x)"
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save(OWNER, def_id, doc)
    assert exc.value.guard == "presentation:colour"


def test_the_stored_expansions_carry_no_new_function_name():
    text = json.dumps(DEFS["linreg_and_correlation"]["compute"])
    for name in ("\"linreg\"", "\"correlation\""):
        assert f"\"name\": {name}" not in text
