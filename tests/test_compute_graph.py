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


# ─── C2D.4 — the Track F attack set, re-run against V2 locators ──────────────
#
# ⛔ THE TRUST MODEL DID NOT MOVE, AND THIS IS WHERE THAT IS CHECKED RATHER
# THAN ASSERTED. Every case below is one of the nine the owner named, expressed
# against a `{node, path}` locator instead of a `{treeIndex, astPath}` one. A
# refusal must name the field, not merely happen: a test that only asserts
# "something raised" is green on a refusal that blames the wrong thing.


def test_attack_invented_parameter_id(store):
    """An edit may never mint an identity — owner condition 15."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    g = _param_graph(14)
    g["parameters"]["__uct_param_99"] = {
        "sourceName": "x", "title": "X", "type": "int", "default": 1,
        "min": 0, "max": 10 ** 9, "step": 1, "options": None,
        "locators": [{"node": 1, "path": ["value"]}],
    }
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(g))
    assert "__uct_param_99" in str(e.value)
    assert "never by editing an existing" in str(e.value)


def test_attack_altered_type(store):
    """`type` is immutable import-time metadata; the prior record wins."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    g = _param_graph(14)
    g["parameters"]["__uct_param_1"]["type"] = "float"
    svc.save(USER, DEF_ID, _doc(g))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["graph"]["parameters"]["__uct_param_1"]["type"] == "int"


def test_attack_altered_bounds_in_both_directions(store):
    """Widening is the classic bypass; NARROWING is refused the same way,
    because the rule is 'the prior record wins verbatim', not 'wider is bad'."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14, min_=1, max_=200)))
    for lo, hi in ((1, 10 ** 9), (13, 15)):
        g = _param_graph(14, min_=lo, max_=hi)
        svc.save(USER, DEF_ID, _doc(g))
        stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
        entry = stored["compute"]["graph"]["parameters"]["__uct_param_1"]
        assert (entry["min"], entry["max"]) == (1, 200)


def test_attack_forged_locator_is_not_bounds_checked_it_is_DISCARDED(store):
    """⛔⛔ THE SECURITY CORE, AND IT IS STRONGER THAN 'THE BOUNDS CATCH IT'.

    ⚰️ This test was first written expecting a bounds refusal — point the
    locator at a node holding 9999 and watch `max: 200` reject it. It did not
    raise, and the reason is the better answer: `locators` is in
    `_IMMUTABLE_FIELDS`, so for an id the previous save already established the
    PRIOR record's locators are used verbatim and the submitted ones are never
    read at all. The forged address is not judged; it is discarded.

    The bounds check is the SECOND line of defence (it guards the VALUE at a
    trusted locator), not the first. Asserting only the second would leave the
    first untested and would go green if `locators` were ever quietly dropped
    from the immutable set."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    g = _param_graph(14)
    # node 1 is the declared literal; point at a node holding something else.
    g["nodes"].append({"type": "num", "value": 9999})
    g["parameters"]["__uct_param_1"]["locators"] = [
        {"node": len(g["nodes"]) - 1, "path": ["value"]}]
    svc.save(USER, DEF_ID, _doc(g))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    entry = stored["compute"]["graph"]["parameters"]["__uct_param_1"]
    assert entry["locators"] == [{"node": 1, "path": ["value"]}], "the PRIOR locator survived"
    assert stored["compute"]["paramState"]["__uct_param_1"]["value"] == 14

    # …and the second line still holds on its own: with a TRUSTED locator, an
    # out-of-range literal is refused by name.
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(_param_graph(9999)))
    assert "__uct_param_1" in str(e.value) and "200" in str(e.value)


def test_attack_transplanted_parameter_from_another_definition(store):
    """A parameter established on one definition may not be carried onto
    another by id — each definition's prior record is its own."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    other = "u_c2c0000000ff"
    # A fresh definition may establish any identity it likes — client-side
    # translation is the authority at creation, which is the one honest trust
    # boundary the ADR names. What it may NOT do is inherit another
    # definition's record, so `other` gets its OWN prior, and from then on that
    # prior is what judges it.
    svc.save(USER, other, _doc(_param_graph(14, max_=10 ** 9), def_id=other))
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(_param_graph(9999, max_=10 ** 9)))
    assert "__uct_param_1" in str(e.value)
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["graph"]["parameters"]["__uct_param_1"]["max"] == 200


def test_attack_stale_manifest_against_a_moved_graph(store):
    """The topology changed under a manifest that still claims the old node.
    Reconciliation is derived FRESH every save, so the stale claim reconciles
    to what is actually there — never to what the client asserted."""
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    g = _param_graph(14)
    # Swap the literal the locator names for a series read — no longer a number.
    g["nodes"][1] = {"type": "series", "name": "high"}
    g["nodes"][3] = {"type": "call", "name": "sma", "args": [0, 0]}
    svc.save(USER, DEF_ID, _doc(g))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    st = stored["compute"]["paramState"]["__uct_param_1"]
    # ⚠️ `detached`, not `non_literal`, and the difference is real: a `series`
    # node has no `value` FIELD at all, so the path does not resolve — which is
    # "the binding was removed", not "the binding is no longer a number". The
    # two have different sentences for the member and this is the one that fits.
    assert st["state"] == pms.DETACHED
    assert st["value"] is None


def test_attack_raw_json_boolean_injection(store):
    """`true` is not 1 — and it never reaches reconciliation to find that out.

    ⚰️ Written expecting `non_literal` (which `_literal_value` would indeed
    answer, since it excludes `bool` before any type check). The real answer is
    earlier and harder: `ast_hash`'s canonical serialiser refuses a boolean
    outright, so the whole DOCUMENT is rejected before any parameter is
    reconciled. Asserting the weaker outcome would have gone green if that
    serialiser ever started coercing `true` to 1."""
    g = _param_graph(14)
    g["nodes"][1] = {"type": "num", "value": True}
    with pytest.raises(ValueError) as e:
        svc.save(USER, DEF_ID, _doc(g))
    assert "got a boolean" in str(e.value)


def test_attack_mismatched_ownership_two_parameters_one_node(store):
    """Two ids naming the SAME graph node is not refused — it is RECONCILED,
    and that is the honest answer: both read the same literal, so both report
    the same attached value and an edit through either moves one number. What
    must never happen is the two disagreeing about what is stored, and they
    cannot: there is one literal."""
    g = _param_graph(14)
    g["parameters"]["__uct_param_2"] = {
        "sourceName": "other", "title": "Other", "type": "int", "default": 14,
        "min": 1, "max": 200, "step": 1, "options": None,
        "locators": [{"node": 1, "path": ["value"]}],
    }
    svc.save(USER, DEF_ID, _doc(g))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    state = stored["compute"]["paramState"]
    assert state["__uct_param_1"]["value"] == 14
    assert state["__uct_param_2"]["value"] == 14


def test_attack_a_path_that_walks_off_the_node(store):
    """A locator whose path does not resolve inside its node is DETACHED, not
    an exception and not a silent pass."""
    g = _param_graph(14)
    g["parameters"]["__uct_param_1"]["locators"] = [
        {"node": 1, "path": ["args", 7, "value"]}]
    svc.save(USER, DEF_ID, _doc(g))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["paramState"]["__uct_param_1"]["state"] == pms.DETACHED


# ─── C2D.6 — V1 -> V2 MIGRATION, and the defect that nearly shipped ──────────
#
# ⚰️⚰️ FOUND BY WRITING C2D.4's ATTACK SET, NOT BY A FAILING PRODUCT RUN.
# `locators` is in `_IMMUTABLE_FIELDS`, which is what makes a forged locator
# unusable — the prior record's address is taken verbatim. Correct, and it has
# a consequence nobody had traced: a definition that was SAVED as V1 and is
# re-saved as a shared graph keeps its `{treeIndex, astPath}` locators, and an
# astPath means nothing in a graph document. Every control on every migrated
# document would have reconciled `detached`, silently, on the save that was
# supposed to be a pure storage improvement.
#
# ⛔ THE FIX IS NOT TO TRUST THE CLIENT'S NEW LOCATORS. It is for the server to
# RE-EXPRESS the position it already trusts: an astPath is a chain of `args`
# steps, and in a graph each step is one index lookup, so the same position has
# a graph address that is derived, not asserted.


def _v1_doc(period=14, def_id=DEF_ID, max_=200):
    """The same program as `_param_graph`, stored the old way."""
    from api.services.user_definitions import ast_hash
    trees = cg.expand_graph(_graph(period))
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
            # `sources[scanPlot]` must EQUAL `compute.source` — one text for the
            # scan tree, never two that agree today.
            "sources": {k: ("sma(close, 20)" if k == "value" else f"src {k}") for k in trees},
            "paramManifest": {
                "__uct_param_1": {
                    "sourceName": "len", "title": "SMA Length", "type": "int",
                    "default": 14, "min": 1, "max": max_, "step": 1, "options": None,
                    # `value` IS the shared `sma` node, whose arg 1 is the literal.
                    "locators": [{"treeIndex": None, "astPath": ["args", 1]}],
                }
            },
        },
    }


def test_a_v1_document_saves_edits_and_reopens(store):
    """The V1 lane is untouched — the control below is the whole point."""
    svc.save(USER, DEF_ID, _v1_doc(14))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["paramState"]["__uct_param_1"]["value"] == 14
    svc.save(USER, DEF_ID, _v1_doc(21))
    got = svc.get(USER, DEF_ID)["definition"]
    assert got["compute"]["paramState"]["__uct_param_1"]["value"] == 21
    assert "graph" not in got["compute"]


def test_v1_then_v2_keeps_the_parameter_attached(store):
    """⛔⛔ THE MIGRATION. Same program, same parameter, new storage form."""
    svc.save(USER, DEF_ID, _v1_doc(14))
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    st = stored["compute"]["paramState"]["__uct_param_1"]
    assert st["state"] == pms.ATTACHED, "a storage change must not disable a control"
    assert st["value"] == 14
    # …and the stored locator is now GRAPH-NATIVE, derived from the trusted
    # V1 position rather than accepted from the client.
    entry = stored["compute"]["graph"]["parameters"]["__uct_param_1"]
    assert entry["locators"] == [{"node": 1, "path": ["value"]}]
    # the bounds are still the ones the FIRST save established
    assert entry["max"] == 200


def test_v1_then_v2_then_edit_then_reopen(store):
    """C2D.6's full round trip, end to end."""
    svc.save(USER, DEF_ID, _v1_doc(14))
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    svc.save(USER, DEF_ID, _doc(_param_graph(21)))
    got = svc.get(USER, DEF_ID)["definition"]
    assert got["compute"]["paramState"]["__uct_param_1"]["value"] == 21
    # every plot that shares the node moved together
    def period(tree):
        node = tree
        while node.get("name") != "sma":
            node = node["args"][0]
        return node["args"][1]["value"]
    assert [period(got["compute"]["trees"][k]) for k in ("value", "up", "dn")] == [21, 21, 21]


def test_the_migration_cannot_be_used_to_widen_a_bound(store):
    """Re-expressing an address must not re-open the metadata."""
    svc.save(USER, DEF_ID, _v1_doc(14, max_=200))
    svc.save(USER, DEF_ID, _doc(_param_graph(14, max_=10 ** 9)))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["graph"]["parameters"]["__uct_param_1"]["max"] == 200
    with pytest.raises(ValueError):
        svc.save(USER, DEF_ID, _doc(_param_graph(9999, max_=10 ** 9)))


def test_a_v1_locator_that_cannot_be_re_expressed_reports_detached(store):
    """An honest failure, not an invented address: if the trusted V1 position
    has no counterpart in the graph, the control is disabled with a reason
    rather than silently pointed at whatever is nearby."""
    d = _v1_doc(14)
    d["compute"]["paramManifest"]["__uct_param_1"]["locators"] = [
        {"treeIndex": None, "astPath": ["args", 9]}]
    svc.save(USER, DEF_ID, d)
    svc.save(USER, DEF_ID, _doc(_param_graph(14)))
    stored = json.loads(svc._newest(_conn(), USER, DEF_ID)["definition"])
    assert stored["compute"]["paramState"]["__uct_param_1"]["state"] == pms.DETACHED
