"""Wave 11 (lane 11B): `rollup` properties, end to end through the router.

What these pin:
  * every aggregate (count, sum, average, min, max, win rate by number and by a
    select option) and every set source (notes linking here, notes this note
    links to, a saved view's notes, the trades linked to this note);
  * ⛔ TENANT ISOLATION: another member's note named in a link, and another
    member's trade named in an embed, never count (both planted through the
    real write doors -- a link target and a trade ref are client text);
  * the set cap: past MAX_ROLLUP_SET rows the value covers the first N and says so;
  * recompute when an input changes (a linked note's value, a new link, a trash);
  * trashed notes are excluded;
  * a rollup survives a deleted input with a sentence, never a crash;
  * validation: a rollup can't summarise another rollup, win rate needs an option.
"""
from __future__ import annotations

import importlib
import json
import os
import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


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
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    def as_user(uid):
        app.dependency_overrides[authmw.get_current_user] = lambda: {"id": uid, "role": "member"}
    c = TestClient(app)
    c.as_user = as_user
    as_user("u1")
    return c


def _doc(*nodes):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}, *nodes]}


def _link(note_id):
    return {"type": "paragraph", "content": [{"type": "noteLink", "attrs": {"noteId": note_id}}]}


def _trade_embed(trade_id, kind="equity_trade"):
    return {"type": "widgetEmbed", "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"},
                                             "tradeRef": trade_id, "tradeRefType": kind}}


def _note(client, title, *nodes, props=None):
    body = {"title": title}
    if nodes:
        body["bodyJson"] = _doc(*nodes)
    r = client.post("/api/j2/notes", json=body)
    assert r.status_code == 200, r.text
    nid = r.json()["note"]["id"]
    if props:
        r = client.put(f"/api/j2/notes/{nid}", json={"properties": props})
        assert r.status_code == 200, r.text
    return nid


def _set_body(client, nid, *nodes):
    r = client.put(f"/api/j2/notes/{nid}", json={"bodyJson": _doc(*nodes)})
    assert r.status_code == 200, r.text


def _def(client, name, type_, **extra):
    r = client.post("/api/j2/property-defs", json={"name": name, "type": type_, **extra})
    assert r.status_code == 200, r.text
    return r.json()["propertyDef"]["id"]


def _rollup(client, name, config):
    return client.post("/api/j2/property-defs", json={"name": name, "type": "rollup", "config": config})


def _value(client, nid, name):
    r = client.get(f"/api/j2/notes/{nid}/properties")
    assert r.status_code == 200, r.text
    p = next(x for x in r.json()["properties"] if x["name"] == name)
    return p["value"], (p.get("computedValue") or {})


def _insert_trade(db_path, user_id, r_multiple, pnl, result=None, position_id=None):
    from api.services.auth_db import get_connection
    conn = get_connection()
    tid = uuid.uuid4().hex
    result = result or ("Win" if pnl > 0 else ("Loss" if pnl < 0 else "BE"))
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result,"
        " context_at_entry, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, user_id, position_id or uuid.uuid4().hex, "NVDA", "Long", 10, 100, "2026-09-01", 110,
         "2026-09-0" + str(1 + len(tid) % 8), 95, pnl, pnl / 1000, r_multiple, 3, result, "{}",
         "2026-09-01T00:00:00+00:00"),
    )
    conn.commit()
    conn.close()
    return tid


@pytest.fixture
def r_prop(client):
    return _def(client, "R", "number")


@pytest.fixture
def family(client, r_prop):
    """Three children with R = 2, -1, 0.5 and one with no R; a parent linking to all four."""
    kids = [_note(client, f"kid{i}", props={r_prop: v} if v is not None else None)
            for i, v in enumerate([2, -1, 0.5, None])]
    parent = _note(client, "parent", *[_link(k) for k in kids])
    return parent, kids


# ── every aggregate over "notes this note links to" ─────────────────────────

@pytest.mark.parametrize("aggregate,expected", [
    ("count", 4.0), ("sum", 1.5), ("avg", 0.5), ("min", -1.0), ("max", 2.0),
    ("win_rate", 2 / 3 * 100.0),
])
def test_each_aggregate_over_linked_notes(client, family, r_prop, aggregate, expected):
    parent, _ = family
    cfg = {"source": "links_from_this", "aggregate": aggregate}
    if aggregate != "count":
        cfg["propertyId"] = r_prop
    assert _rollup(client, "Roll", cfg).status_code == 200
    value, cell = _value(client, parent, "Roll")
    assert value == pytest.approx(expected)
    assert cell["setSize"] == 4 and cell["usedSize"] == 4 and cell["capped"] is False


def test_win_rate_by_a_select_option(client):
    outcome = _def(client, "Outcome", "select", options=[{"label": "Win"}, {"label": "Loss"}])
    opts = next(d for d in client.get("/api/j2/property-defs").json()["propertyDefs"] if d["id"] == outcome)["options"]
    win = next(o["id"] for o in opts if o["label"] == "Win")
    loss = next(o["id"] for o in opts if o["label"] == "Loss")
    kids = [_note(client, f"k{i}", props={outcome: v}) for i, v in enumerate([win, win, loss])]
    kids.append(_note(client, "unset"))
    parent = _note(client, "p", *[_link(k) for k in kids])
    r = _rollup(client, "Win rate", {"source": "links_from_this", "aggregate": "win_rate",
                                      "propertyId": outcome, "optionId": win})
    assert r.status_code == 200, r.text
    value, _ = _value(client, parent, "Win rate")
    assert value == pytest.approx(200 / 3)     # 2 of the 3 with a value -- the unset one is not a loss


def test_a_rollup_can_average_a_formula(client):
    e, s, x = (_def(client, n, "number") for n in ("Entry", "Stop", "Exit"))
    r = client.post("/api/j2/property-defs", json={
        "name": "R", "type": "formula", "config": {"expression": "({Exit} - {Entry}) / ({Entry} - {Stop})"}})
    rid = r.json()["propertyDef"]["id"]
    k1 = _note(client, "k1", props={e: 100, s: 90, x: 120})    # R 2
    k2 = _note(client, "k2", props={e: 100, s: 90, x: 140})    # R 4
    k3 = _note(client, "k3", props={e: 100, s: 100, x: 140})   # division by zero: empty, not counted
    parent = _note(client, "p", _link(k1), _link(k2), _link(k3))
    assert _rollup(client, "Avg R", {"source": "links_from_this", "aggregate": "avg",
                                     "propertyId": rid}).status_code == 200
    assert _value(client, parent, "Avg R")[0] == 3.0


# ── every source ─────────────────────────────────────────────────────────────

def test_source_notes_linking_to_this_note(client, r_prop):
    hub = _note(client, "hub")
    for v in (1, 3):
        _note(client, f"ref{v}", _link(hub), props={r_prop: v})
    _note(client, "unrelated", props={r_prop: 100})
    assert _rollup(client, "Avg in", {"source": "links_to_this", "aggregate": "avg",
                                      "propertyId": r_prop}).status_code == 200
    assert _value(client, hub, "Avg in")[0] == 2.0


def test_source_a_saved_view(client, r_prop):
    status = _def(client, "Status", "select", options=[{"label": "Closed"}, {"label": "Open"}])
    opts = next(d for d in client.get("/api/j2/property-defs").json()["propertyDefs"] if d["id"] == status)["options"]
    closed = next(o["id"] for o in opts if o["label"] == "Closed")
    opened = next(o["id"] for o in opts if o["label"] == "Open")
    _note(client, "a", props={status: closed, r_prop: 3})
    _note(client, "b", props={status: closed, r_prop: 1})
    _note(client, "c", props={status: opened, r_prop: 50})
    view = client.post("/api/j2/saved-views", json={
        "name": "Closed trades", "viewType": "table",
        "spec": {"propertyFilter": [{"propertyId": status, "op": "eq", "value": closed}]}}).json()["savedView"]
    summary = _note(client, "summary")
    r = _rollup(client, "Closed avg R", {"source": "saved_view", "savedViewId": view["id"],
                                         "aggregate": "avg", "propertyId": r_prop})
    assert r.status_code == 200, r.text
    value, cell = _value(client, summary, "Closed avg R")
    assert value == 2.0 and cell["setSize"] == 2


def test_source_the_trades_linked_to_this_note(client, db_path):
    t1 = _insert_trade(db_path, "u1", 2.0, 200)
    t2 = _insert_trade(db_path, "u1", -1.0, -100)
    t3 = _insert_trade(db_path, "u1", 3.0, 300)
    n = _note(client, "plan", _trade_embed(t1), _trade_embed(t2), _trade_embed(t3))
    _note(client, "other", _trade_embed(_insert_trade(db_path, "u1", 9.0, 900)))
    for name, cfg, want in [
        ("Avg R", {"aggregate": "avg", "tradeField": "r_multiple"}, 4 / 3),
        ("Sum P&L", {"aggregate": "sum", "tradeField": "pnl_dollar"}, 400.0),
        ("Trades", {"aggregate": "count"}, 3.0),
        ("Win rate", {"aggregate": "win_rate", "tradeField": "pnl_dollar"}, 200 / 3),
        ("Win rate by result", {"aggregate": "win_rate", "tradeField": "result", "optionId": "Win"}, 200 / 3),
        ("Max R", {"aggregate": "max", "tradeField": "r_multiple"}, 3.0),
        ("Min R", {"aggregate": "min", "tradeField": "r_multiple"}, -1.0),
    ]:
        r = _rollup(client, name, {"source": "trades", **cfg})
        assert r.status_code == 200, r.text
        assert _value(client, n, name)[0] == pytest.approx(want), name


def test_a_position_that_closed_into_one_trade_counts_as_that_trade(client, db_path):
    pid = uuid.uuid4().hex
    _insert_trade(db_path, "u1", 1.5, 150, position_id=pid)
    n = _note(client, "plan", _trade_embed(pid, kind="position"))
    assert _rollup(client, "R", {"source": "trades", "aggregate": "avg", "tradeField": "r_multiple"}).status_code == 200
    assert _value(client, n, "R")[0] == 1.5


# ── ⛔ tenant isolation ──────────────────────────────────────────────────────

def test_another_members_note_never_counts_even_when_linked_by_id(client, r_prop):
    client.as_user("u2")
    r2 = _def(client, "R", "number")
    theirs = _note(client, "theirs", props={r2: 100})
    client.as_user("u1")
    mine = _note(client, "mine", props={r_prop: 2})
    parent = _note(client, "parent", _link(mine), _link(theirs))     # a link to u2's note id
    assert _rollup(client, "Count", {"source": "links_from_this", "aggregate": "count"}).status_code == 200
    assert _rollup(client, "Sum", {"source": "links_from_this", "aggregate": "sum", "propertyId": r_prop}).status_code == 200
    assert _value(client, parent, "Count")[0] == 1.0
    assert _value(client, parent, "Sum")[0] == 2.0


def test_another_member_linking_to_my_note_never_counts(client, r_prop):
    hub = _note(client, "hub")
    client.as_user("u2")
    r2 = _def(client, "R", "number")
    _note(client, "theirs", _link(hub), props={r2: 100})
    client.as_user("u1")
    _note(client, "mine", _link(hub), props={r_prop: 3})
    assert _rollup(client, "Count in", {"source": "links_to_this", "aggregate": "count"}).status_code == 200
    assert _value(client, hub, "Count in")[0] == 1.0


def test_another_members_trade_never_counts_even_when_embedded_by_id(client, db_path):
    mine = _insert_trade(db_path, "u1", 1.0, 100)
    theirs = _insert_trade(db_path, "u2", 50.0, 5000)
    n = _note(client, "plan", _trade_embed(mine), _trade_embed(theirs))
    assert _rollup(client, "Sum R", {"source": "trades", "aggregate": "sum", "tradeField": "r_multiple"}).status_code == 200
    assert _rollup(client, "Trades", {"source": "trades", "aggregate": "count"}).status_code == 200
    assert _value(client, n, "Sum R")[0] == 1.0
    assert _value(client, n, "Trades")[0] == 1.0


def test_another_member_never_reads_my_rollup(client, r_prop):
    kid = _note(client, "kid", props={r_prop: 7})
    parent = _note(client, "parent", _link(kid))
    pid = _rollup(client, "Sum", {"source": "links_from_this", "aggregate": "sum", "propertyId": r_prop}).json()["propertyDef"]["id"]
    assert _value(client, parent, "Sum")[0] == 7.0
    client.as_user("u2")
    assert client.get(f"/api/j2/notes/{parent}/properties").status_code == 404
    rows = client.get("/api/j2/notes").json()["notes"]
    assert rows == [] or all("computed" not in r or pid not in r["computed"] for r in rows)


# ── the cap ──────────────────────────────────────────────────────────────────

def test_a_set_past_the_cap_covers_the_first_n_and_says_so(client, r_prop, monkeypatch):
    from api.services.journal_two import note_computed
    monkeypatch.setattr(note_computed, "MAX_ROLLUP_SET", 3)
    kids = [_note(client, f"k{i}", props={r_prop: 1}) for i in range(5)]
    parent = _note(client, "parent", *[_link(k) for k in kids])
    assert _rollup(client, "Sum", {"source": "links_from_this", "aggregate": "sum", "propertyId": r_prop}).status_code == 200
    value, cell = _value(client, parent, "Sum")
    assert value == 3.0
    assert cell["setSize"] == 5 and cell["usedSize"] == 3 and cell["capped"] is True


# ── recompute when an input changes; trash excluded ──────────────────────────

def test_a_changed_input_is_recomputed_on_the_next_read(client, family, r_prop):
    parent, kids = family
    assert _rollup(client, "Avg", {"source": "links_from_this", "aggregate": "avg", "propertyId": r_prop}).status_code == 200
    assert _value(client, parent, "Avg")[0] == pytest.approx(0.5)
    client.put(f"/api/j2/notes/{kids[0]}", json={"properties": {r_prop: 5}})       # 5, -1, 0.5
    assert _value(client, parent, "Avg")[0] == pytest.approx(1.5)
    new_kid = _note(client, "new", props={r_prop: 1.5})
    _set_body(client, parent, *[_link(k) for k in kids], _link(new_kid))           # 5, -1, 0.5, 1.5
    assert _value(client, parent, "Avg")[0] == pytest.approx(1.5)
    client.put(f"/api/j2/notes/{kids[1]}", json={"properties": {r_prop: 3}})       # 5, 3, 0.5, 1.5
    assert _value(client, parent, "Avg")[0] == pytest.approx(2.5)


def test_a_trashed_note_is_excluded_and_a_restored_one_returns(client, family, r_prop):
    parent, kids = family
    assert _rollup(client, "Sum", {"source": "links_from_this", "aggregate": "sum", "propertyId": r_prop}).status_code == 200
    assert _value(client, parent, "Sum")[0] == 1.5
    assert client.delete(f"/api/j2/notes/{kids[0]}").status_code == 200           # R 2 to the trash
    value, cell = _value(client, parent, "Sum")
    assert value == -0.5 and cell["setSize"] == 3
    assert client.post(f"/api/j2/notes/{kids[0]}/restore").status_code == 200
    assert _value(client, parent, "Sum")[0] == 1.5


def test_a_changed_trade_is_recomputed(client, db_path):
    tid = _insert_trade(db_path, "u1", 1.0, 100)
    n = _note(client, "plan", _trade_embed(tid))
    assert _rollup(client, "R", {"source": "trades", "aggregate": "sum", "tradeField": "r_multiple"}).status_code == 200
    assert _value(client, n, "R")[0] == 1.0
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.execute("UPDATE j2_trades SET r_multiple = 2.5 WHERE id = ?", (tid,))
    conn.commit()
    conn.close()
    assert _value(client, n, "R")[0] == 2.5


# ── empties, deleted inputs, validation ──────────────────────────────────────

def test_an_empty_set_is_an_empty_value_with_a_reason(client, r_prop):
    lonely = _note(client, "lonely")
    assert _rollup(client, "Avg", {"source": "links_from_this", "aggregate": "avg", "propertyId": r_prop}).status_code == 200
    value, cell = _value(client, lonely, "Avg")
    assert value is None and cell["reason"] == "This note links to no notes yet"


def test_a_deleted_rolled_up_property_says_so(client, family, r_prop):
    parent, _ = family
    assert _rollup(client, "Avg", {"source": "links_from_this", "aggregate": "avg", "propertyId": r_prop}).status_code == 200
    client.delete(f"/api/j2/property-defs/{r_prop}")
    value, cell = _value(client, parent, "Avg")
    assert value is None and "deleted" in cell["reason"]


def test_a_deleted_saved_view_says_so(client, r_prop):
    view = client.post("/api/j2/saved-views", json={"name": "v", "viewType": "list", "spec": {}}).json()["savedView"]
    n = _note(client, "n")
    assert _rollup(client, "C", {"source": "saved_view", "savedViewId": view["id"], "aggregate": "count"}).status_code == 200
    assert _value(client, n, "C")[0] == 1.0
    client.delete(f"/api/j2/saved-views/{view['id']}")
    value, cell = _value(client, n, "C")
    assert value is None and "deleted" in cell["reason"]


@pytest.mark.parametrize("cfg,needle", [
    ({"source": "elsewhere", "aggregate": "sum"}, "Pick which notes"),
    ({"source": "links_from_this", "aggregate": "median"}, "Pick how to summarise"),
    ({"source": "links_from_this", "aggregate": "sum"}, "Pick the property"),
    ({"source": "trades", "aggregate": "sum"}, "Pick which trade number"),
    ({"source": "trades", "aggregate": "sum", "tradeField": "result"}, "use count or win rate"),
    ({"source": "saved_view", "aggregate": "count", "savedViewId": "nope"}, "Pick a saved view"),
])
def test_a_bad_rollup_is_refused_with_a_sentence(client, cfg, needle):
    r = _rollup(client, "Bad", cfg)
    assert r.status_code == 400 and needle in r.json()["detail"]


def test_a_rollup_cannot_summarise_a_rollup(client, r_prop):
    inner = _rollup(client, "Inner", {"source": "links_from_this", "aggregate": "sum", "propertyId": r_prop})
    r = _rollup(client, "Outer", {"source": "links_to_this", "aggregate": "sum",
                                  "propertyId": inner.json()["propertyDef"]["id"]})
    assert r.status_code == 400 and "can't summarise another rollup" in r.json()["detail"]


def test_the_table_sorts_by_a_rollup(client, r_prop):
    kids = [_note(client, f"k{i}", props={r_prop: v}) for i, v in enumerate([1, 5, 3])]
    parents = [_note(client, f"p{i}", _link(k)) for i, k in enumerate(kids)]
    pid = _rollup(client, "Linked R", {"source": "links_from_this", "aggregate": "sum",
                                       "propertyId": r_prop}).json()["propertyDef"]["id"]
    sort = json.dumps({"propertyId": pid, "direction": "desc"})
    rows = client.get("/api/j2/notes", params={"propertySort": sort}).json()["notes"]
    ordered = [r["id"] for r in rows if r["id"] in parents]
    assert ordered == [parents[1], parents[2], parents[0]]
    f = json.dumps([{"propertyId": pid, "op": "gte", "value": 3}])
    got = {r["id"] for r in client.get("/api/j2/notes", params={"propertyFilter": f}).json()["notes"]}
    assert got == {parents[1], parents[2]}
