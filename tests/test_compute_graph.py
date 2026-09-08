"""Wave C2C — the shared canonical computation graph, server side.

Every test here exercises the REAL ``api.services.user_definitions.save()`` and
the REAL ``param_manifest`` enforcement, on hand-built documents, exactly as
``tests/test_param_manifest.py`` does — the architecture is proved in isolation
from the translator, whose own tests live in the JS lane.

The four failure modes a shared representation has, and where each is proved:

  1. it does not round-trip                 -> ``test_the_graph_is_the_program``
  2. the graph and its inlining disagree    -> ``test_a_disagreeing_inlining_is_refused``
  3. the hash sees layout, not the program  -> ``test_the_identity_does_not_move``
  4. it expands exponentially               -> ``test_the_expansion_bomb_is_refused``
"""
from __future__ import annotations

import json
import sqlite3
import time

import pytest

from api.services import alert_rev_migration as rev
from api.services import compute_graph as cg
from api.services import indicator_alert_service as ias
from api.services import param_manifest as pms
from api.services import user_definitions as svc

USER = "c2c-user"
DEF_ID = "u_c2c000000001"


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


def _conn():
    c = sqlite3.connect(svc._DB_PATH)
    c.row_factory = sqlite3.Row
    return c


# ─── the fixture: one consensus expression, several views of it ──────────────
#
# This is the shape the corpus' two DOCUMENT_SIZE_BLOCKED scripts actually have,
# reduced to something a person can read: `sma(close, 20)` computed ONCE and
# used by three plots.

def _graph(period=20):
    return {
        "graphVersion": cg.GRAPH_VERSION,
        "nodes": [
            {"type": "series", "name": "close"},          # 0
            {"type": "num", "value": period},             # 1
            {"type": "series", "name": "open"},           # 2
            {"type": "call", "name": "sma", "args": [0, 1]},   # 3  <- shared
            {"type": "op", "name": "+", "args": [3, 0]},       # 4
            {"type": "op", "name": "-", "args": [3, 2]},       # 5
        ],
        "outputRoots": {"value": 3, "up": 4, "dn": 5},
        "parameters": {},
    }


def _plots(*keys):
    return [{"key": k, "label": k, "style": "line"} for k in keys]


def _doc(graph=None, scan="value", def_id=DEF_ID):
    g = _graph() if graph is None else graph
    from api.services.user_definitions import ast_hash
    trees = cg.expand_graph(g)
    return {
        "id": def_id,
        "plots": _plots(*sorted(trees)),
        "compute": {
            "kind": "ast",
            "graph": g,
            "scanPlot": scan,
            "treesHash": svc.trees_hash(trees),
            "fn": ast_hash(trees[scan]),
        },
    }


def _inlined_equivalent(def_id=DEF_ID, period=20):
    """The SAME program written the old way — the control every size and
    identity claim below is measured against."""
    trees = cg.expand_graph(_graph(period))
    from api.services.user_definitions import ast_hash
    return {
        "id": def_id,
        "plots": _plots(*sorted(trees)),
        "compute": {
            "kind": "ast",
            "ast": trees["value"],
            "trees": trees,
            "scanPlot": "value",
            "treesHash": svc.trees_hash(trees),
            "fn": ast_hash(trees["value"]),
            "source": "sma(close, 20)",
            "sources": {"value": "sma(close, 20)", "up": "sma(close, 20) + close",
                        "dn": "sma(close, 20) - open"},
        },
    }


# ─── 1. the graph IS the program ─────────────────────────────────────────────

def test_the_graph_is_the_program(store):
    svc.save(USER, DEF_ID, _doc())
    row = svc._newest(_conn(), USER, DEF_ID)
    stored = json.loads(row["definition"])

    # ⛔ WHAT IS STORED IS THE GRAPH, AND ONLY THE GRAPH.
    assert "graph" in stored["compute"]
    assert "trees" not in stored["compute"]
    assert "ast" not in stored["compute"]
    assert "sources" not in stored["compute"]

    # ⭐ AND WHAT A READER GETS IS THE FOREST EVERY EXISTING READER EXPECTS.
    got = svc.get(USER, DEF_ID)["definition"]
    inlined = _inlined_equivalent()["compute"]["trees"]
    assert got["compute"]["trees"] == inlined
    assert got["compute"]["ast"] == inlined["value"]


def test_the_identity_does_not_move(store):
    """⭐⭐ THE PROPERTY THAT MAKES ADOPTION SAFE. `def_hash` keys a results
    table every member shares, and a `rev` bump force-migrates alerts. Storing
    the same program as a graph must produce the SAME identity — otherwise a
    storage change would migrate every member's alerts for maths that did not
    move."""
    graph_row = svc.save(USER, DEF_ID, _doc())
    inline_row = svc.save(USER, "u_c2c000000002", _inlined_equivalent("u_c2c000000002"))
    assert graph_row["ast_hash"] == inline_row["ast_hash"]

    a = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    b = json.loads(svc._newest(_conn(), USER, "u_c2c000000002")["definition"])
    assert a["compute"]["treesHash"] == b["compute"]["treesHash"]


def test_the_graph_document_is_smaller(store):
    """⛔ NON-VACUITY. Every other test in this file passes on a "graph" that
    shares nothing. The saving is the feature."""
    svc.save(USER, DEF_ID, _doc())
    svc.save(USER, "u_c2c000000002", _inlined_equivalent("u_c2c000000002"))
    g = len(svc._newest(_conn(), USER, DEF_ID)["definition"])
    v1 = len(svc._newest(_conn(), USER, "u_c2c000000002")["definition"])
    assert g < v1


def test_a_read_modify_write_round_trip_stays_small(store):
    """The materialised document a caller reads hands straight back: the graph
    rides along, the inlining is verified and dropped, and the blob is the same
    small bytes. Without this the first edit of a big document would store the
    332 KB inlining and be refused by the cap the graph exists to clear."""
    svc.save(USER, DEF_ID, _doc())
    first = svc._newest(_conn(), USER, DEF_ID)["definition"]
    got = svc.get(USER, DEF_ID)["definition"]
    assert "trees" in got["compute"], "the read really did materialise"
    got["name"] = "renamed"
    svc.save(USER, DEF_ID, got)
    second = svc._newest(_conn(), USER, DEF_ID)["definition"]
    again = json.loads(second)
    assert "trees" not in again["compute"]
    # ⛔ THE SAME BYTES THE CAP COUNTS, not a re-serialisation with different
    # separators — comparing a pretty-printed copy against a minified blob is a
    # measurement of `json.dumps` defaults, not of the representation.
    assert len(second) < len(first) + 64


def test_a_disagreeing_inlining_is_refused(store):
    """A client may send the inlining it already had; it may not send one that
    disagrees, because then which of the two is "the definition" would depend on
    the reader."""
    doc = _doc()
    trees = cg.expand_graph(doc["compute"]["graph"])
    trees["up"] = {"type": "series", "name": "high"}
    doc["compute"]["trees"] = trees
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, doc)
    assert str(e.value).startswith("compute.trees:")


def test_a_v1_document_is_untouched(store):
    """⛔ THE CONTROL FOR THE WHOLE WAVE. Every rule above is additive; a
    document that declares no graph must save byte-for-byte as it always did."""
    d = _inlined_equivalent()
    svc.save(USER, DEF_ID, d)
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored == d


# ─── 2. the bomb, and the shapes that are simply not graphs ──────────────────

def test_the_expansion_bomb_is_refused(store):
    """⛔⛔ Forty doubling nodes is a 2 KB document that inlines to 2**40 nodes.
    The refusal must come from ARITHMETIC, not from running out of memory."""
    nodes = [{"type": "series", "name": "close"}]
    for _ in range(40):
        nodes.append({"type": "op", "name": "+",
                      "args": [len(nodes) - 1, len(nodes) - 1]})
    graph = {"graphVersion": cg.GRAPH_VERSION, "nodes": nodes,
             "outputRoots": {"value": len(nodes) - 1, "up": 0}, "parameters": {}}
    assert len(json.dumps(graph)) < 4096
    t0 = time.time()
    with pytest.raises(ValueError) as e:
        cg.assert_graph(graph)
    assert "expands to" in str(e.value)
    assert time.time() - t0 < 1.0, "the refusal must not have built anything"


def test_a_forward_reference_is_not_a_graph():
    graph = {"graphVersion": cg.GRAPH_VERSION,
             "nodes": [{"type": "op", "name": "+", "args": [1, 1]},
                       {"type": "num", "value": 1}],
             "outputRoots": {"value": 0, "up": 1}, "parameters": {}}
    with pytest.raises(ValueError) as e:
        cg.assert_graph(graph)
    assert "declared BEFORE it" in str(e.value)


def test_a_self_reference_is_not_a_graph():
    graph = {"graphVersion": cg.GRAPH_VERSION,
             "nodes": [{"type": "num", "value": 1},
                       {"type": "op", "name": "+", "args": [0, 1]}],
             "outputRoots": {"value": 1, "up": 0}, "parameters": {}}
    with pytest.raises(ValueError):
        cg.assert_graph(graph)


def test_a_single_root_graph_is_refused(store):
    """A one-plot document is byte-identical to a schema-1 one on purpose, and
    a graph over one tree shares nothing with anybody — it would be a second
    spelling of a shape that already has exactly one."""
    g = _graph()
    g["outputRoots"] = {"value": 3}
    doc = _doc(g)
    doc["plots"] = _plots("value")
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, doc)
    assert "at least two plots" in str(e.value)


def test_a_non_canonical_node_is_refused_by_its_own_field_path():
    graph = _graph()
    graph["nodes"][1]["extra"] = 1
    with pytest.raises(ValueError) as e:
        cg.assert_graph(graph)
    assert str(e.value).startswith("compute.graph.nodes[1]:")


def test_source_text_may_not_ride_on_a_graph_document(store):
    doc = _doc()
    doc["compute"]["sources"] = {"value": "sma(close, 20)"}
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, doc)
    assert str(e.value).startswith("compute.sources:")


# ─── 3. parameters, at their new address and under the SAME trust model ──────

def _param_graph(period=14, min_=1, max_=200):
    g = _graph(period)
    g["parameters"] = {
        "__uct_param_1": {
            "sourceName": "len", "title": "SMA Length", "type": "int",
            "default": 14, "min": min_, "max": max_, "step": 1, "options": None,
            # ⭐ ONE LOCATOR FOR ALL THREE PLOTS — the collapse V1 could not
            # express. In the inlined form this parameter needed one astPath per
            # occurrence, and those could disagree with each other.
            "locators": [{"node": 1, "path": ["value"]}],
        }
    }
    return g


def test_a_graph_parameter_reconciles_attached(store):
    svc.save(USER, DEF_ID, _doc(_param_graph()))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    st = stored["compute"]["paramState"]["__uct_param_1"]
    assert st["state"] == pms.ATTACHED
    assert st["value"] == 14
    # the roster stays where the document put it, and NOT in a second place
    assert "paramManifest" not in stored["compute"]
    assert stored["compute"]["graph"]["parameters"]["__uct_param_1"]["min"] == 1


def test_one_locator_moves_every_plot_that_shares_the_node(store):
    """The whole reason sharing is worth doing for parameters: three plots use
    one `sma`, so one edit is one literal, and `conflicted` is unrepresentable
    rather than merely unlikely."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    svc.save(USER, DEF_ID, _doc(_param_graph(21)))
    got = svc.get(USER, DEF_ID)["definition"]
    # ⛔ THE LITERAL ITSELF, AT ITS EXACT POSITION — not a substring search over
    # a serialised tree, which would pass on a `21` that landed anywhere.
    def _period(tree):
        node = tree
        while node.get("name") != "sma":
            node = node["args"][0]
        return node["args"][1]["value"]
    assert [_period(got["compute"]["trees"][k]) for k in ("value", "up", "dn")] == [21, 21, 21]
    assert got["compute"]["paramState"]["__uct_param_1"]["value"] == 21


def test_the_declared_bounds_are_enforced_at_the_graph_locator(store):
    """⛔ SECURITY. The bounds are checked against the value AT the locator; a
    V2 locator must not be a hole in that."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(_param_graph(9999)))
    assert "__uct_param_1" in str(e.value)


def test_a_client_may_not_widen_its_own_bounds(store):
    """`_canonicalize_manifest`: an id already present in the previous save is
    taken VERBATIM from the prior record. Moving the roster into the graph must
    not move that rule."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14, max_=200)))
    with pytest.raises(ValueError):
        svc.save(USER, DEF_ID, _doc(_param_graph(9999, max_=100000)))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["graph"]["parameters"]["__uct_param_1"]["max"] == 200


def test_an_edit_may_not_mint_a_new_parameter_identity(store):
    """Owner condition 15, unchanged by the new address."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    g = _param_graph(14)
    g["parameters"]["__uct_param_2"] = {
        "sourceName": "sneaky", "title": "Sneaky", "type": "int", "default": 1,
        "min": 0, "max": 999999, "step": 1, "options": None,
        "locators": [{"node": 1, "path": ["value"]}],
    }
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(g))
    assert "__uct_param_2" in str(e.value)


def test_two_rosters_over_one_tree_are_refused(store):
    doc = _doc(_param_graph(14))
    doc["compute"]["paramManifest"] = {"__uct_param_1": {"locators": []}}
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, doc)
    assert "compute.paramManifest" in str(e.value)


def test_a_detached_graph_locator_reports_detached_rather_than_refusing(store):
    g = _param_graph(14)
    g["parameters"]["__uct_param_1"]["locators"] = [{"node": 0, "path": ["value"]}]
    svc.save(USER, DEF_ID, _doc(g))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    st = stored["compute"]["paramState"]["__uct_param_1"]
    assert st["state"] in (pms.DETACHED, pms.NON_LITERAL)
    assert st["value"] is None


def test_a_mixed_locator_shape_is_refused(store):
    g = _param_graph(14)
    g["parameters"]["__uct_param_1"]["locators"] = [
        {"node": 1, "path": ["value"], "astPath": ["args", 1]}]
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(g))
    assert "never both" in str(e.value)


def test_a_parameter_with_no_locators_is_legal_and_reports_detached(store):
    """⛔⛔ THE STATE A MIGRATION MUST BE ABLE TO EXPRESS.

    ⚰️ Measured on the live corpus while C2C was running: `…03-supertrend`'s
    "Periods" parameter carries an `astPath` that does not resolve against the
    tree the document actually saves — a PRE-EXISTING Track F defect (`PineBox`
    builds the manifest from its own `paramManifest: true` translation, while
    the document stores the `memberInputTranslation` one), which this lane
    already reports as `partially_detached`.

    A migration to the shared graph therefore has three options for such a
    control and only one of them is honest: refuse the whole document (the fix
    never fires for exactly the documents that need it, and the member sees the
    ORIGINAL size refusal — which is what shipped for an hour), DROP the control
    (silently removes something the member's indicator has, and
    `_canonicalize_manifest` would accept that quietly), or CARRY it with no
    locators. The third is this test: `reconcile` already has a sentence for it.
    """
    g = _param_graph(14)
    g["parameters"]["__uct_param_1"]["locators"] = []
    svc.save(USER, DEF_ID, _doc(g))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    st = stored["compute"]["paramState"]["__uct_param_1"]
    assert st["state"] == pms.DETACHED
    assert st["value"] is None
    assert "no binding locations" in st["reason"]
    # and the METADATA is still there — the member can see what the control was
    assert stored["compute"]["graph"]["parameters"]["__uct_param_1"]["title"] == "SMA Length"


def test_an_unplaceable_parameter_still_cannot_be_edited(store):
    """A carried-but-detached control is DISABLED, not a hole in the bounds
    check: with no locator there is no literal to read, so `_validate_bounds`
    never runs — and nothing can be written through it either."""
    g = _param_graph(14)
    g["parameters"]["__uct_param_1"]["locators"] = []
    svc.save(USER, DEF_ID, _doc(g))
    # A later save may not quietly hand it a locator and a wider bound: the
    # prior record wins verbatim, so the bounds stay the ones first established.
    g2 = _param_graph(14, max_=999999)
    g2["parameters"]["__uct_param_1"]["locators"] = [{"node": 1, "path": ["value"]}]
    svc.save(USER, DEF_ID, _doc(g2))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["graph"]["parameters"]["__uct_param_1"]["max"] == 200


def test_a_locator_outside_the_table_is_refused_before_reconciliation(store):
    g = _param_graph(14)
    g["parameters"]["__uct_param_1"]["locators"] = [{"node": 99, "path": ["value"]}]
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(g))
    assert "locators[0].node" in str(e.value)
