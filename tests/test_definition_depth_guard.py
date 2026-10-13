"""A0 — a deeply nested definition is refused BY NAME, never as an HTTP 500.

Measured 2026-10-13 on master: `save()` hashes the tree with a recursive walker
(`stable_stringify`) before the node budget runs, so a ~240-deep tree escaped as a
`RecursionError`. A 600-long shared-graph chain did the same inside the expansion,
and a definition whose `meta` nested ~3,500 deep did it inside `json.dumps`. The
router catches only the store's own refusals, so each was a 500.

What these tests hold:
  * nothing a member can save today changes — a shallow tree saves, and a tree
    over the node budget keeps its `budget:nodes` refusal;
  * every deeper document gets a NAMED refusal (`budget:depth`, `tree:nesting`)
    through the real router, as a 422, and nothing is stored;
  * the bound is not wider than the node budget can already reach, and not so
    close to the recursion limit that a deeper call stack could still overflow.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import ast_budget
from api.services import compute_graph as cg
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

USER = "depth-user"


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    return tmp_path


@pytest.fixture
def client(store):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    return TestClient(app)


def chain(depth: int) -> dict:
    """`1 + (1 + (… + close))` — `depth` operator levels above one series leaf."""
    tree = {"type": "series", "name": "close"}
    for _ in range(depth):
        tree = {"type": "op", "name": "+", "args": [{"type": "num", "value": 1}, tree]}
    return tree


def v1_doc(tree: dict) -> dict:
    try:
        fn = svc.ast_hash(tree)
    except RecursionError:
        fn = "sha256:" + "0" * 64       # the guard must refuse before the hash is read
    return {"version": 1, "plots": [{"key": "value", "style": "line"}],
            "compute": {"kind": "ast", "ast": tree, "fn": fn}}


def graph_doc(length: int) -> dict:
    nodes = [{"type": "series", "name": "close"}, {"type": "num", "value": 1}]
    for _ in range(length):
        nodes.append({"type": "op", "name": "+", "args": [1, len(nodes) - 1]})
    graph = {"graphVersion": cg.GRAPH_VERSION, "nodes": nodes,
             "outputRoots": {"value": len(nodes) - 1}, "parameters": {}}
    return {"version": 1, "plots": [{"key": "value", "style": "line"}],
            "compute": {"kind": "ast", "graph": graph, "scanPlot": "value",
                        "treesHash": "sha256:" + "0" * 64, "fn": "sha256:" + "0" * 64}}


def nested(depth: int) -> dict:
    value: dict = {"x": 1}
    for _ in range(depth):
        value = {"x": value}
    return value


def refusal(resp) -> dict:
    assert resp.status_code == 422, (resp.status_code, resp.text[:300])
    return resp.json()["refusal"]


def stored_count() -> int:
    return len(svc.list_for_user(USER))


# ─── nothing a member can save today moves ──────────────────────────────────

def test_a_shallow_tree_still_saves(client):
    resp = client.post("/api/user-definitions", json={"definition": v1_doc(chain(20))})
    assert resp.status_code == 200, resp.text
    assert stored_count() == 1


@pytest.mark.parametrize("depth", [129, svc.MAX_TREE_DEPTH - 1])
def test_a_tree_over_the_node_budget_keeps_its_budget_refusal(client, depth):
    assert refusal(client.post("/api/user-definitions",
                               json={"definition": v1_doc(chain(depth))}))["guard"] == "budget:nodes"
    assert stored_count() == 0


def test_the_depth_bound_is_unreachable_by_any_tree_the_budget_admits():
    """A tree's longest path holds that many DISTINCT subtrees, so a tree deeper than
    the node budget cannot pass it: the depth bound refuses nothing new."""
    assert svc.MAX_TREE_DEPTH > ast_budget.DEFAULT_BUDGET["maxNodes"]


def test_the_depth_bound_leaves_room_below_the_recursion_limit():
    """The measured overflow was ~240 levels under pytest's stack; a production
    request runs deeper, so the bound keeps a wide margin below it."""
    assert svc.MAX_TREE_DEPTH <= 200


# ─── every deeper document is refused by name, through the real router ──────

@pytest.mark.parametrize("depth", [svc.MAX_TREE_DEPTH, 300, 1000])
def test_a_deep_tree_is_a_named_refusal_not_a_500(client, depth):
    r = refusal(client.post("/api/user-definitions",
                            json={"definition": v1_doc(chain(depth))}))
    assert r["gate"] == "budget" and r["guard"] == "budget:depth"
    assert stored_count() == 0


def raw_body(depth: int) -> str:
    """Built as TEXT: past ~1,500 levels no JSON encoder (the test client's included)
    can produce the request, but a client can still send it."""
    leaf = '{"type":"series","name":"close"}'
    tree = '{"type":"op","name":"+","args":[{"type":"num","value":1},' * depth + leaf + "]}" * depth
    return ('{"definition":{"version":1,"plots":[{"key":"value","style":"line"}],'
            '"compute":{"kind":"ast","fn":"sha256:x","ast":' + tree + "}}}")


@pytest.mark.parametrize("depth", [1200, 1600, 5000])
def test_a_body_too_deep_to_encode_is_still_refused_never_a_500(store, depth):
    """Beyond what the framework can parse it answers 400 itself; below that the store
    names the refusal. Neither is ever a 500."""
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post("/api/user-definitions", content=raw_body(depth),
                  headers={"content-type": "application/json"})
    assert resp.status_code in (400, 422), (resp.status_code, resp.text[:200])
    if resp.status_code == 422:
        assert resp.json()["refusal"]["guard"] == "budget:depth"
    assert stored_count() == 0


@pytest.mark.parametrize("length", [600, 2000])
def test_a_deep_shared_graph_chain_is_a_named_refusal_not_a_500(client, length):
    r = refusal(client.post("/api/user-definitions",
                            json={"definition": graph_doc(length)}))
    assert r["guard"] == "budget:depth"
    assert stored_count() == 0


@pytest.mark.parametrize("where", ["meta", "plot"])
def test_deep_nesting_outside_the_tree_is_a_named_refusal_not_a_500(client, where):
    doc = v1_doc(chain(5))
    if where == "meta":
        doc["meta"] = {"note": nested(svc.MAX_DOCUMENT_NESTING + 10)}
    else:
        doc["plots"][0]["extra"] = nested(svc.MAX_DOCUMENT_NESTING + 10)
    r = refusal(client.post("/api/user-definitions", json={"definition": doc}))
    assert r["gate"] == "tree" and r["guard"] == "tree:nesting"
    assert stored_count() == 0


def test_an_edit_is_held_to_the_same_bound(client):
    created = client.post("/api/user-definitions", json={"definition": v1_doc(chain(5))})
    def_id = created.json()["def_id"]
    deep = v1_doc(chain(1000))
    deep["id"] = def_id
    r = refusal(client.put(f"/api/user-definitions/{def_id}", json={"definition": deep}))
    assert r["guard"] == "budget:depth"
    assert svc.get(USER, def_id)["version"] == 1


def test_the_store_refuses_without_the_router_too(store):
    """Every caller of `save()` — share install, fork, the Agent — is covered, not
    only the HTTP door."""
    with pytest.raises(svc.SaveRefused) as exc:
        svc.save(USER, svc.new_def_id(), v1_doc(chain(1000)))
    assert exc.value.guard == "budget:depth"
