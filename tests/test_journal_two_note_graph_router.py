"""Router-level tests for GET /api/j2/notes/graph — the whole note-link graph.

Same standalone-FastAPI-app + temp-auth.db pattern as
test_journal_two_note_links_router.py, whose helpers this mirrors deliberately
so the two read side by side.

⛔ The graph read and the per-note backlinks read answer DIFFERENT questions and
disagree on trash by design. `get_note_backlinks` does not gate on the TARGET
being trashed ("who links here" is a fact about the linking notes); the graph
gates BOTH ends, because drawing an edge to a trashed note renders a node the
member cannot open. There is a test for that below, so the difference cannot be
"tidied" into consistency without a red.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
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
    return TestClient(app)


def _login_as(app, user_id):
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": user_id, "role": "member"}


def _create_note(client, title="A note", body_json=None):
    payload = {"title": title}
    if body_json is not None:
        payload["bodyJson"] = body_json
    r = client.post("/api/j2/notes", json=payload)
    assert r.status_code == 200
    return r.json()["note"]["id"]


def _link_doc(*target_ids):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "noteLink", "attrs": {"noteId": t}} for t in target_ids
    ]}]}


def _ids(nodes):
    return {n["id"] for n in nodes}


# ── the route exists and is not swallowed by /notes/{note_id} ────────────────

def test_the_graph_route_is_not_swallowed_by_the_note_id_route(app, client):
    """⛔ THE ORDERING TRAP, railed. FastAPI matches in DECLARATION order, so if
    `/notes/graph` is ever moved below `/notes/{note_id}` this returns 404 for a
    note called "graph" instead of the graph. This repo has paid for that twice."""
    _login_as(app, "u1")
    r = client.get("/api/j2/notes/graph")
    assert r.status_code == 200, "the {note_id} route swallowed 'graph'"
    assert set(r.json()) == {"nodes", "edges", "truncated"}


def test_empty_notebook_is_an_empty_graph_not_an_error(app, client):
    _login_as(app, "u1")
    body = client.get("/api/j2/notes/graph").json()
    assert body == {"nodes": [], "edges": [], "truncated": False}


# ── nodes ────────────────────────────────────────────────────────────────────

def test_an_UNLINKED_note_is_still_a_node(app, client):
    """⛔ THE POINT OF A GRAPH VIEW. An isolated note is the most interesting
    thing a graph can show a member; an inner join against the edges would drop
    exactly the notes they most need to see."""
    _login_as(app, "u1")
    lonely = _create_note(client, title="Nobody links to me")
    body = client.get("/api/j2/notes/graph").json()
    assert lonely in _ids(body["nodes"])
    assert body["edges"] == []


def test_degree_counts_both_directions(app, client):
    _login_as(app, "u1")
    hub = _create_note(client, title="Hub")
    _create_note(client, title="Spoke A", body_json=_link_doc(hub))
    _create_note(client, title="Spoke B", body_json=_link_doc(hub))
    nodes = {n["id"]: n for n in client.get("/api/j2/notes/graph").json()["nodes"]}
    assert nodes[hub]["degree"] == 2, "the hub is linked TO twice"


# ── edges ────────────────────────────────────────────────────────────────────

def test_an_edge_is_one_relationship_even_when_linked_many_times(app, client):
    """⛔ Deduplicated by PAIR with a weight, never one line per occurrence —
    the same ruling get_note_backlinks applies to its own rows."""
    _login_as(app, "u1")
    target = _create_note(client, title="Target")
    source = _create_note(client, title="Source", body_json=_link_doc(target, target, target))
    edges = client.get("/api/j2/notes/graph").json()["edges"]
    assert len(edges) == 1
    assert edges[0]["source"] == source
    assert edges[0]["target"] == target
    assert edges[0]["weight"] == 3


def test_edges_carry_direction(app, client):
    _login_as(app, "u1")
    target = _create_note(client, title="Target")
    source = _create_note(client, title="Source", body_json=_link_doc(target))
    e = client.get("/api/j2/notes/graph").json()["edges"][0]
    assert (e["source"], e["target"]) == (source, target), "direction was lost"


# ── trash, tenancy ───────────────────────────────────────────────────────────

def test_a_trashed_note_is_neither_a_node_nor_an_edge_END(app, client):
    """⛔ DELIBERATELY STRICTER THAN get_note_backlinks, which does NOT gate on
    the target being trashed. An edge to a trashed note draws a node the member
    cannot open."""
    _login_as(app, "u1")
    target = _create_note(client, title="Target")
    source = _create_note(client, title="Source", body_json=_link_doc(target))
    assert client.delete(f"/api/j2/notes/{target}").status_code == 200

    body = client.get("/api/j2/notes/graph").json()
    assert target not in _ids(body["nodes"])
    assert source in _ids(body["nodes"]), "the surviving source must remain"
    assert body["edges"] == [], "no edge may point at a trashed note"


def test_the_graph_is_tenant_isolated(app, client):
    _login_as(app, "u1")
    target = _create_note(client, title="Target")
    _create_note(client, title="Source", body_json=_link_doc(target))

    _login_as(app, "u2")
    assert client.get("/api/j2/notes/graph").json() == {
        "nodes": [], "edges": [], "truncated": False,
    }


# ── the cap ──────────────────────────────────────────────────────────────────

def test_truncated_is_MEASURED_not_inferred_from_hitting_the_cap(app, client):
    """⛔ `truncated` must mean "there are more", not "you asked for N and got
    N". The service reads cap+1 rows precisely so exactly-N is not reported as
    truncation."""
    _login_as(app, "u1")
    for i in range(3):
        _create_note(client, title=f"n{i}")

    exact = client.get("/api/j2/notes/graph?limit=3").json()
    assert len(exact["nodes"]) == 3
    assert exact["truncated"] is False, "exactly at the cap is NOT truncated"

    over = client.get("/api/j2/notes/graph?limit=2").json()
    assert len(over["nodes"]) == 2
    assert over["truncated"] is True


def test_an_edge_whose_far_end_missed_the_cap_is_dropped(app, client):
    """A line to a node that was not returned cannot be drawn, and a renderer
    should not have to guess what it meant."""
    _login_as(app, "u1")
    target = _create_note(client, title="oldest")
    _create_note(client, title="newest", body_json=_link_doc(target))
    # limit=1 keeps only the most recently updated note.
    body = client.get("/api/j2/notes/graph?limit=1").json()
    assert len(body["nodes"]) == 1
    assert body["edges"] == []


def test_a_link_to_a_TRASHED_note_does_not_count_toward_degree(app, client):
    """⛔ THE DEGREE AND THE DRAWN EDGES MUST AGREE ABOUT TRASH.

    The edge query gates `deleted_at IS NULL` on BOTH ends, so trashing a target
    removes the line. If the degree subquery does not gate the same way, the
    surviving source keeps degree=1 and the renderer draws it as a LINKED node
    with no line attached to it -- while the member's real situation is that the
    note is now orphaned, which is the one thing a graph view exists to show.
    """
    _login_as(app, "u1")
    target = _create_note(client, title="Target")
    source = _create_note(client, title="Source", body_json=_link_doc(target))

    before = {n["id"]: n for n in client.get("/api/j2/notes/graph").json()["nodes"]}
    assert before[source]["degree"] == 1, "precondition: the link counts while the target lives"

    assert client.delete(f"/api/j2/notes/{target}").status_code == 200

    body = client.get("/api/j2/notes/graph").json()
    after = {n["id"]: n for n in body["nodes"]}
    assert body["edges"] == [], "precondition: the line is gone"
    assert after[source]["degree"] == 0, (
        "the source still counts a link to a note that is in the trash -- it will "
        "render as linked-but-lineless instead of as the orphan it now is"
    )
