"""Wave 11 (lane 11B): `formula` properties, end to end through the router.

What these pin:
  * a formula is created from the member's {Name} text and STORED with property
    ids, so renaming an input never breaks it;
  * its value is computed per note; division by zero, an empty input, a deleted
    input give an empty value with a reason -- never NaN, never a 500;
  * a formula can use another formula; a circular reference is REFUSED at save
    time with a plain sentence (mutation-proved in the report);
  * a formula can't be set by hand;
  * the table can sort and filter by it (server side, over the whole library);
  * ⛔ FLAG OFF: the type is refused, an existing formula is invisible to every
    read, and GET /notes carries no `computed` key;
  * ONE FACT IN TWO FILES: the client's COMPUTED_PROPERTY_TYPES and the server's
    note_computed.COMPUTED_TYPES, the client list PARSED.
"""
from __future__ import annotations

import importlib
import json
import os
import re
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

REPO = Path(__file__).resolve().parents[1]
PROPERTIES_SECTION = REPO / "app" / "src" / "pages" / "journal-2-0" / "components" / "notebook" / "PropertiesSection.jsx"


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_FORMULAS_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def app(db_path):
    from api.routers import journal_two as journal_two_router
    fa = FastAPI()
    fa.include_router(journal_two_router.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def _note(client, title):
    r = client.post("/api/j2/notes", json={"title": title})
    assert r.status_code == 200, r.text
    return r.json()["note"]["id"]


def _number(client, name):
    r = client.post("/api/j2/property-defs", json={"name": name, "type": "number"})
    assert r.status_code == 200, r.text
    return r.json()["propertyDef"]["id"]


def _formula(client, name, expression):
    return client.post("/api/j2/property-defs", json={
        "name": name, "type": "formula", "config": {"expression": expression}})


def _set(client, note_id, values):
    r = client.put(f"/api/j2/notes/{note_id}", json={"properties": values})
    assert r.status_code == 200, r.text


def _props(client, note_id):
    r = client.get(f"/api/j2/notes/{note_id}/properties")
    assert r.status_code == 200, r.text
    return {p["name"]: p for p in r.json()["properties"]}


@pytest.fixture
def trade_plan(client):
    ids = {name: _number(client, name) for name in ("Entry", "Stop", "Target", "Exit")}
    r = _formula(client, "R", "({Exit} - {Entry}) / ({Entry} - {Stop})")
    assert r.status_code == 200, r.text
    ids["R"] = r.json()["propertyDef"]["id"]
    return ids


def test_a_formula_is_stored_by_property_id_not_by_name(client, trade_plan):
    d = next(x for x in client.get("/api/j2/property-defs").json()["propertyDefs"] if x["name"] == "R")
    expr = d["config"]["expression"]
    assert "{Exit}" not in expr and "{@" + trade_plan["Exit"] + "}" in expr
    assert d["type"] == "formula" and d["computed"] is True


def test_the_r_multiple_is_computed_for_a_long_and_a_short(client, trade_plan):
    long_, short = _note(client, "long"), _note(client, "short")
    _set(client, long_, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 95, trade_plan["Exit"]: 110})
    _set(client, short, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 105, trade_plan["Exit"]: 90})
    assert _props(client, long_)["R"]["value"] == 2.0
    assert _props(client, short)["R"]["value"] == 2.0


def test_renaming_an_input_does_not_break_the_formula(client, trade_plan):
    n = _note(client, "n")
    _set(client, n, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 95, trade_plan["Exit"]: 105})
    r = client.put(f"/api/j2/property-defs/{trade_plan['Entry']}", json={"name": "Entry price"})
    assert r.status_code == 200
    assert _props(client, n)["R"]["value"] == 1.0


@pytest.mark.parametrize("values,reason", [
    ({"Entry": 100, "Stop": 100, "Exit": 110}, "Division by zero"),
    ({"Entry": 100, "Stop": 95}, "Exit is empty"),
])
def test_an_uncomputable_value_is_empty_with_a_reason(client, trade_plan, values, reason):
    n = _note(client, "n")
    _set(client, n, {trade_plan[k]: v for k, v in values.items()})
    cell = _props(client, n)["R"]
    assert cell["value"] is None
    assert cell["computedValue"]["reason"] == reason


def test_deleting_an_input_says_so_and_nothing_crashes(client, trade_plan):
    n = _note(client, "n")
    _set(client, n, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 95, trade_plan["Exit"]: 105})
    assert client.delete(f"/api/j2/property-defs/{trade_plan['Stop']}").status_code == 200
    cell = _props(client, n)["R"]
    assert cell["value"] is None and "deleted" in cell["computedValue"]["reason"]
    assert client.get("/api/j2/notes").status_code == 200


def test_a_formula_can_use_another_formula(client, trade_plan):
    r = _formula(client, "Risk", "abs({Entry} - {Stop})")
    assert r.status_code == 200
    acct = _number(client, "Account risk")
    r = _formula(client, "Size", "round({Account risk} / {Risk}, 0)")
    assert r.status_code == 200, r.text
    n = _note(client, "n")
    _set(client, n, {trade_plan["Entry"]: 50, trade_plan["Stop"]: 45, acct: 500})
    assert _props(client, n)["Size"]["value"] == 100.0


def test_a_formula_cannot_refer_to_itself(client, trade_plan):
    rid = trade_plan["R"]
    r = client.put(f"/api/j2/property-defs/{rid}", json={"config": {"expression": "{R} + 1"}})
    assert r.status_code == 400
    assert "Circular reference" in r.json()["detail"]


def test_a_cycle_through_two_formulas_is_refused_at_save_with_both_names(client, trade_plan):
    a = _formula(client, "A", "{Entry} + 1").json()["propertyDef"]["id"]
    b = _formula(client, "B", "{A} * 2")
    assert b.status_code == 200
    r = client.put(f"/api/j2/property-defs/{a}", json={"config": {"expression": "{B} - 1"}})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert detail.startswith("Circular reference: A -> B -> A"), detail
    # ...and the refused edit wrote nothing: A still computes from Entry.
    a_def = next(x for x in client.get("/api/j2/property-defs").json()["propertyDefs"] if x["name"] == "A")
    assert a_def["config"]["expression"] == "{@" + trade_plan["Entry"] + "} + 1"


@pytest.mark.parametrize("expression,needle", [
    ("{Nope} + 1", "No number property is named"),
    ("constructor", "Unknown name"),
    ("1 / ", "ends too soon"),
    ("", "Write a formula first"),
])
def test_a_bad_formula_is_refused_with_a_plain_sentence(client, trade_plan, expression, needle):
    r = _formula(client, "Bad", expression)
    assert r.status_code == 400
    assert needle in r.json()["detail"]


def test_a_formula_can_only_use_number_properties(client):
    client.post("/api/j2/property-defs", json={"name": "Notes", "type": "text"})
    r = _formula(client, "Bad", "{Notes} + 1")
    assert r.status_code == 400
    assert "No number property is named" in r.json()["detail"]


def test_a_formula_cannot_be_set_by_hand(client, trade_plan):
    n = _note(client, "n")
    r = client.put(f"/api/j2/notes/{n}", json={"properties": {trade_plan["R"]: 5}})
    assert r.status_code == 400
    assert "calculated" in r.json()["detail"]


def test_the_list_carries_computed_values_for_the_page(client, trade_plan):
    n = _note(client, "n")
    _set(client, n, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 95, trade_plan["Exit"]: 115})
    rows = client.get("/api/j2/notes").json()["notes"]
    row = next(r for r in rows if r["id"] == n)
    assert row["computed"][trade_plan["R"]]["value"] == 3.0


def _r_notes(client, trade_plan, rs):
    out = {}
    for i, exit_ in enumerate(rs):
        n = _note(client, f"t{i}")
        if exit_ is not None:
            _set(client, n, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 90, trade_plan["Exit"]: exit_})
        out[n] = exit_
    return out


def test_the_table_sorts_by_a_formula_over_the_whole_library_empties_last(client, trade_plan):
    ids = _r_notes(client, trade_plan, [120, 90, None, 150, 100])     # R = 2, -1, empty, 5, 0
    sort = json.dumps({"propertyId": trade_plan["R"], "direction": "desc"})
    rows = client.get("/api/j2/notes", params={"propertySort": sort, "limit": 2}).json()["notes"]
    assert [r["computed"][trade_plan["R"]]["value"] for r in rows] == [5.0, 2.0]
    asc = json.dumps({"propertyId": trade_plan["R"], "direction": "asc"})
    rows = client.get("/api/j2/notes", params={"propertySort": asc}).json()["notes"]
    values = [r["computed"][trade_plan["R"]]["value"] for r in rows if r["id"] in ids]
    assert values == [-1.0, 0.0, 2.0, 5.0, None]


@pytest.mark.parametrize("cond,expected", [
    ({"op": "gt", "value": 0}, {2.0, 5.0}),
    ({"op": "lte", "value": 0}, {-1.0, 0.0}),
    ({"op": "eq", "value": 5}, {5.0}),
    ({"op": "is_empty"}, {None}),
    ({"op": "is_not_empty"}, {-1.0, 0.0, 2.0, 5.0}),
])
def test_the_table_filters_by_a_formula(client, trade_plan, cond, expected):
    _r_notes(client, trade_plan, [120, 90, None, 150, 100])
    f = json.dumps([{"propertyId": trade_plan["R"], **cond}])
    body = client.get("/api/j2/notes", params={"propertyFilter": f}).json()
    got = {r["computed"][trade_plan["R"]]["value"] for r in body["notes"]}
    assert got == expected
    assert body["total"] == len(body["notes"])


def test_a_sorted_page_crosses_from_the_valued_notes_into_the_empties(client, trade_plan):
    """The valued notes are ordered in memory and the empties are paged in SQL, so
    the page that straddles the two must stitch them without a gap or a repeat."""
    ids = _r_notes(client, trade_plan, [120, 90, None, 150, 100, None])   # 2, -1, -, 5, 0, -
    sort = json.dumps({"propertyId": trade_plan["R"], "direction": "desc"})
    seen = []
    for offset in range(0, 6, 2):
        body = client.get("/api/j2/notes", params={"propertySort": sort, "limit": 2, "offset": offset}).json()
        assert body["total"] == 6
        seen += [(r["id"], r["computed"][trade_plan["R"]]["value"]) for r in body["notes"]]
    assert [v for _, v in seen] == [5.0, 2.0, 0.0, -1.0, None, None]
    assert sorted(i for i, _ in seen) == sorted(ids)            # every note once


def test_a_sort_and_a_filter_together_page_and_count_the_same_set(client, trade_plan):
    _r_notes(client, trade_plan, [120, 90, None, 150, 100])
    sort = json.dumps({"propertyId": trade_plan["R"], "direction": "asc"})
    f = json.dumps([{"propertyId": trade_plan["R"], "op": "gte", "value": 0}])
    body = client.get("/api/j2/notes", params={"propertySort": sort, "propertyFilter": f}).json()
    assert [r["computed"][trade_plan["R"]]["value"] for r in body["notes"]] == [0.0, 2.0, 5.0]
    assert body["total"] == 3


# ── the formula-value memo (a pure-function cache, keyed by content) ──────────

def _filtered_values(client, trade_plan, cond):
    f = json.dumps([{"propertyId": trade_plan["R"], **cond}])
    body = client.get("/api/j2/notes", params={"propertyFilter": f}).json()
    return sorted((r["computed"][trade_plan["R"]]["value"] for r in body["notes"]), key=lambda v: (v is None, v))


def test_editing_a_formula_is_seen_by_the_next_filter_though_no_note_changed(client, trade_plan):
    """The memo is keyed by the definitions as well as the note's text: a note whose
    properties did not change must still get the NEW formula's value."""
    _r_notes(client, trade_plan, [120, 90, 150])                     # R = 2, -1, 5
    assert _filtered_values(client, trade_plan, {"op": "gt", "value": 1}) == [2.0, 5.0]
    r = client.put(f"/api/j2/property-defs/{trade_plan['R']}", json={"config": {"expression": "{Exit} - {Entry}"}})
    assert r.status_code == 200, r.text                                # now 20, -10, 50
    assert _filtered_values(client, trade_plan, {"op": "gt", "value": 1}) == [20.0, 50.0]


def test_deleting_an_input_is_seen_by_the_next_filter(client, trade_plan):
    _r_notes(client, trade_plan, [120, 90])
    assert _filtered_values(client, trade_plan, {"op": "is_not_empty"}) == [-1.0, 2.0]
    assert client.delete(f"/api/j2/property-defs/{trade_plan['Stop']}").status_code == 200
    assert _filtered_values(client, trade_plan, {"op": "is_not_empty"}) == []


def test_the_formula_memo_is_bounded(client, trade_plan, monkeypatch):
    from api.services.journal_two import note_computed
    monkeypatch.setenv("NOTEBOOK_FORMULA_MEMO_MAX", "4")
    note_computed._FORMULA_MEMO.clear()
    _r_notes(client, trade_plan, [110, 120, 130, 140, 150, 160, 170])
    assert _filtered_values(client, trade_plan, {"op": "gt", "value": 0}) == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
    assert 0 < len(note_computed._FORMULA_MEMO) <= 4


def _scan_plan(conn):
    from api.services.journal_two import note_computed
    sql = (f"EXPLAIN QUERY PLAN SELECT j2_notes.rowid, properties_json FROM j2_notes"
           f"{note_computed._props_index(conn)} WHERE {note_computed._PROPS_WHERE}")
    return " | ".join(str(r[3]) for r in conn.execute(sql, ("u1",)))


def test_the_formula_scan_reads_the_covering_index_not_the_table(client, trade_plan, db_path):
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        plan = _scan_plan(conn)
    finally:
        conn.close()
    assert "COVERING INDEX idx_j2_notes_props_live" in plan, plan


def test_without_the_index_the_reads_are_slower_never_wrong(client, trade_plan, db_path):
    """An index is an optimisation (db.py logs-and-skips one it cannot build), so
    INDEXED BY is only asked for when the index exists -- a missing index must
    degrade to a table scan, never to 'no such index'."""
    import sqlite3
    _r_notes(client, trade_plan, [120, 90, None, 150])
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DROP INDEX idx_j2_notes_props_live")
        conn.commit()
        assert "idx_j2_notes_props_live" not in _scan_plan(conn)
    finally:
        conn.close()
    sort = json.dumps({"propertyId": trade_plan["R"], "direction": "desc"})
    r = client.get("/api/j2/notes", params={"propertySort": sort})
    assert r.status_code == 200, r.text
    assert [x["computed"][trade_plan["R"]]["value"] for x in r.json()["notes"]] == [5.0, 2.0, -1.0, None]


def test_a_formula_filter_needs_a_number(client, trade_plan):
    f = json.dumps([{"propertyId": trade_plan["R"], "op": "gt", "value": "2"}])
    assert client.get("/api/j2/notes", params={"propertyFilter": f}).status_code == 400


def test_an_edit_recomputes_the_formula_on_the_next_read(client, trade_plan):
    n = _note(client, "n")
    _set(client, n, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 90, trade_plan["Exit"]: 110})
    assert _props(client, n)["R"]["value"] == 1.0
    _set(client, n, {trade_plan["Exit"]: 130})
    assert _props(client, n)["R"]["value"] == 3.0
    sort = json.dumps({"propertyId": trade_plan["R"], "direction": "desc"})
    rows = client.get("/api/j2/notes", params={"propertySort": sort}).json()["notes"]
    assert rows[0]["computed"][trade_plan["R"]]["value"] == 3.0


# ── ⛔ flag off ──────────────────────────────────────────────────────────────

def test_flag_off_the_type_is_refused(client, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_FORMULAS_ENABLED", "0")
    _number(client, "Entry")
    r = _formula(client, "R", "{Entry} * 2")
    assert r.status_code == 400 and "Unsupported property type" in r.json()["detail"]


def test_flag_off_an_existing_formula_is_invisible_everywhere(client, trade_plan, monkeypatch):
    n = _note(client, "n")
    _set(client, n, {trade_plan["Entry"]: 100, trade_plan["Stop"]: 95, trade_plan["Exit"]: 110})
    assert "computed" in next(r for r in client.get("/api/j2/notes").json()["notes"] if r["id"] == n)
    monkeypatch.setenv("NOTEBOOK_FORMULAS_ENABLED", "0")
    names = [d["name"] for d in client.get("/api/j2/property-defs").json()["propertyDefs"]]
    assert "R" not in names and "Entry" in names
    assert "R" not in _props(client, n)
    row = next(r for r in client.get("/api/j2/notes").json()["notes"] if r["id"] == n)
    assert "computed" not in row
    sort = json.dumps({"propertyId": trade_plan["R"], "direction": "desc"})
    assert client.get("/api/j2/notes", params={"propertySort": sort}).status_code == 400
    # ...and the ordinary property types are untouched.
    _set(client, n, {trade_plan["Entry"]: 101})
    assert _props(client, n)["Entry"]["value"] == 101


def test_flag_off_a_def_payload_is_byte_for_byte_the_old_shape(client):
    pid = _number(client, "Entry")
    d = next(x for x in client.get("/api/j2/property-defs").json()["propertyDefs"] if x["id"] == pid)
    assert set(d) == {"id", "name", "type", "options", "sortOrder", "source", "createdAt", "updatedAt"}


# ── ONE FACT IN TWO FILES ────────────────────────────────────────────────────

def test_the_client_computed_type_list_matches_the_server():
    from api.services.journal_two import note_computed
    src = PROPERTIES_SECTION.read_text(encoding="utf-8")
    block = re.search(r"export const COMPUTED_PROPERTY_TYPES = \[(.*?)\n\]", src, re.S)
    assert block, "COMPUTED_PROPERTY_TYPES not found in PropertiesSection.jsx -- the parser is broken, not the lists"
    client_types = re.findall(r"value:\s*'([a-z_]+)'", block.group(1))
    assert client_types, "parsed an empty list"
    assert sorted(client_types) == sorted(note_computed.COMPUTED_TYPES)
