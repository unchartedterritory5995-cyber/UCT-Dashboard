"""The shared canonical computation graph, server side (Wave C2C).

⭐⭐ THIS IS A DEREFERENCE, NOT A PARSER. There is exactly one parser and it is
in JS (D-A1), and nothing here changes that: a graph is a table of canonical
nodes whose ``args`` entries are INTEGER INDICES into that same table, so
expanding one is substitution, the same class of operation as
``param_manifest._walk``. No grammar is read, no text is tokenised, no second
authority over the language is created.

⛔ WHY THE SERVER EXPANDS AT ALL. Every existing reader of a definition —
``ast_lint``, ``alert_user_series``, ``scan_evaluator``, ``trees_hash``,
``param_manifest`` — is written against ``compute.ast`` / ``compute.trees``.
Teaching each of them a second representation would put the graph semantics in
a dozen places. Instead the STORED form is the graph and the IN-MEMORY form is
the forest every reader already knows, materialised once at the row boundary
(``user_definitions._row_to_dict``) and once on the write path before hashing.
The saving is in the bytes at rest, which is exactly where the 64 KB cap
counts them.

⛔⛔ THE ONE NEW ATTACK, GUARDED BEFORE IT RUNS. Sharing is what makes a graph
small and it is also what lets forty nodes describe a trillion: ``op(k-1,
k-1)`` chained forty deep is a 2 KB document that inlines to 2**40 nodes.
``expanded_sizes`` computes every node's inlined size BOTTOM-UP IN INTEGERS —
O(N) arithmetic that materialises nothing — and a root over the ceiling is
refused from that addition, so the refusal costs nothing because the work never
starts. Same shape as ``interpret``'s ``MAX_RECURRENCE_STEPS``.

⛔ ACYCLICITY IS STRUCTURAL, NOT DETECTED. The JS builder numbers nodes by
(height, content digest), which is topological, so a legal graph's references
run strictly BACKWARDS. ``assert_graph`` enforces exactly that with one integer
comparison; a cycle needs a forward or self edge, so it is unrepresentable
rather than caught.

The JS half is ``app/src/components/chart/engine/ast/graph.js``. The two are
mirrors and ``tests/test_compute_graph_parity.py`` runs the SHIPPED JS under
node against this module's answers rather than trusting that they agree.
"""
from __future__ import annotations

import re
from typing import Any, Mapping

GRAPH_VERSION = 2

#: Mirrors ``graph.js``. A single tree already refuses past 128 nodes at compute
#: time (``DEFAULT_BUDGET.maxNodes``), so this bound is not about what can run —
#: it is about what VALIDATION will agree to materialise.
MAX_EXPANDED_NODES = 2048
MAX_EXPANDED_TOTAL = 32768
MAX_GRAPH_NODES = 8192

#: The exact key set each canonical node type carries — the same roster
#: ``parse.js::CANONICAL_KEYS`` declares. A V2 node differs from a V1 one only
#: in what an ``args`` ENTRY means (an integer reference instead of an inlined
#: child), never in which keys exist.
CANONICAL_KEYS = {
    "num": ("type", "value"),
    "series": ("type", "name"),
    "op": ("type", "name", "args"),
    "call": ("type", "name", "args"),
    "offset": ("type", "value", "args"),
    "tf": ("type", "value", "args"),
    "sym": ("type", "value", "args"),
    "tf_live": ("type", "value", "args"),
}

_PLOT_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def declares_graph(compute: Any) -> bool:
    """Does this ``compute`` CLAIM to be a shared-graph document?

    ⛔ ASKED WITH ``in``, NEVER ``.get()`` — the same rule ``_assert_trees``
    states for ``trees``. ``{"graph": None}`` is a graph document with a broken
    graph, not a forest one; reading it as absent would validate it under the
    wrong branch and refuse it by the wrong field name.
    """
    return isinstance(compute, Mapping) and "graph" in compute


def assert_graph(graph: Any) -> list:
    """Shape, acyclicity and expansion bounds. Returns the output keys, sorted.

    Everything decidable without materialising anything.
    """
    if not isinstance(graph, Mapping):
        got = ("null" if graph is None
               else "an array" if isinstance(graph, (list, tuple))
               else type(graph).__name__)
        raise ValueError(f"compute.graph: expected an object, got {got}")
    if graph.get("graphVersion") != GRAPH_VERSION:
        raise ValueError(
            f"compute.graph.graphVersion: expected {GRAPH_VERSION}, got "
            f"{graph.get('graphVersion')!r}")

    nodes = graph.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("compute.graph.nodes: expected a non-empty array of canonical nodes")
    if len(nodes) > MAX_GRAPH_NODES:
        raise ValueError(
            f"compute.graph.nodes: {len(nodes)} nodes is over the {MAX_GRAPH_NODES} limit")

    for i, node in enumerate(nodes):
        if not isinstance(node, Mapping):
            raise ValueError(f"compute.graph.nodes[{i}]: not an object")
        expected = CANONICAL_KEYS.get(node.get("type"))
        if expected is None:
            raise ValueError(
                f"compute.graph.nodes[{i}]: node type {node.get('type')!r} is not one of "
                f"{', '.join(sorted(CANONICAL_KEYS))}")
        own = sorted(node)
        want = sorted(expected)
        if own != want:
            raise ValueError(
                f"compute.graph.nodes[{i}]: a {node['type']} node must carry exactly "
                f"[{', '.join(want)}] — got [{', '.join(own)}]")
        if "args" in node:
            args = node["args"]
            if not isinstance(args, list):
                raise ValueError(f"compute.graph.nodes[{i}].args: must be an array")
            for a, ref in enumerate(args):
                if isinstance(ref, bool) or not isinstance(ref, int):
                    raise ValueError(
                        f"compute.graph.nodes[{i}].args[{a}]: must be an integer node "
                        f"reference, got {ref!r}")
                # ⛔ THE WHOLE ACYCLICITY PROOF, in one comparison.
                if ref < 0 or ref >= i:
                    raise ValueError(
                        f"compute.graph.nodes[{i}].args[{a}]: {ref} is not a node declared "
                        "BEFORE it — a graph's references run strictly backwards, which is "
                        "what makes a cycle unrepresentable")

    roots = graph.get("outputRoots")
    if not isinstance(roots, Mapping):
        raise ValueError(
            "compute.graph.outputRoots: expected an object of plotKey → node index, got "
            f"{type(roots).__name__ if roots is not None else 'null'}")
    keys = sorted(roots)
    if not keys:
        raise ValueError("compute.graph.outputRoots: names no plot")
    for k in keys:
        if not isinstance(k, str) or not _PLOT_KEY_RE.match(k):
            raise ValueError(
                f"compute.graph.outputRoots: {k!r} is not a legal plot key "
                f"({_PLOT_KEY_RE.pattern})")
        ref = roots[k]
        if isinstance(ref, bool) or not isinstance(ref, int) or ref < 0 or ref >= len(nodes):
            raise ValueError(
                f"compute.graph.outputRoots.{k}: {ref!r} is not an index into nodes[]")

    _assert_parameters(graph, len(nodes))
    expanded_sizes(graph, keys)
    return keys


def _assert_parameters(graph: Mapping, node_count: int) -> None:
    """Every locator names a node that exists and a non-empty path.

    ⚠️ SHAPE ONLY, ON PURPOSE. Whether the value at that locator is in bounds,
    and whether this parameter identity is one the previous save established,
    belong to ``param_manifest`` — which is where the trust model lives and
    where it stays. Two places deciding that would be two authorities over one
    security check.
    """
    params = graph.get("parameters")
    if params is None:
        return
    if not isinstance(params, Mapping):
        raise ValueError(
            f"compute.graph.parameters: expected an object, got {type(params).__name__}")
    for pid, entry in params.items():
        if not isinstance(entry, Mapping):
            raise ValueError(f"compute.graph.parameters.{pid}: expected an object")
        locators = entry.get("locators")
        # ⚠️ AN EMPTY LIST IS LEGAL, AND IT MEANS SOMETHING. ``reconcile``
        # answers ``detached`` — "this parameter declares no binding locations"
        # — for a roster entry with no locators, and that is exactly the state a
        # control whose bindings were lost must be left in. Refusing it here
        # would force a migration to either DROP such a control (silently
        # removing something the member's indicator has) or fake a locator.
        if not isinstance(locators, list):
            raise ValueError(
                f"compute.graph.parameters.{pid}.locators: expected an array")
        for i, loc in enumerate(locators):
            if not isinstance(loc, Mapping):
                raise ValueError(f"compute.graph.parameters.{pid}.locators[{i}]: expected an object")
            node = loc.get("node")
            if isinstance(node, bool) or not isinstance(node, int) \
                    or node < 0 or node >= node_count:
                raise ValueError(
                    f"compute.graph.parameters.{pid}.locators[{i}].node: not an index into nodes[]")
            path = loc.get("path")
            if not isinstance(path, list) or not path:
                raise ValueError(
                    f"compute.graph.parameters.{pid}.locators[{i}].path: expected a non-empty path")


def expanded_sizes(graph: Mapping, keys: Any = None) -> list:
    """The inlined node count of every graph node, bottom-up, in integers.

    ⛔⛔ THE BOMB GUARD, AND IT RUNS BEFORE ANY EXPANSION. Because references
    run strictly backwards, one forward pass with no recursion computes every
    size, and the numbers stay numbers — nothing is built.
    """
    nodes = graph["nodes"]
    size = [0] * len(nodes)
    for i, node in enumerate(nodes):
        s = 1
        for ref in node.get("args") or ():
            s += size[ref]
        if s > MAX_EXPANDED_TOTAL:
            raise ValueError(
                f"compute.graph.nodes[{i}]: expands to {s} inlined nodes, over the "
                f"{MAX_EXPANDED_TOTAL} ceiling — a shared graph can describe a tree far "
                "larger than it is")
        size[i] = s
    out_keys = sorted(graph["outputRoots"]) if keys is None else keys
    total = 0
    for k in out_keys:
        s = size[graph["outputRoots"][k]]
        if s > MAX_EXPANDED_NODES:
            raise ValueError(
                f"compute.graph.outputRoots.{k}: expands to {s} nodes, over the "
                f"{MAX_EXPANDED_NODES} per-plot ceiling")
        total += s
        if total > MAX_EXPANDED_TOTAL:
            raise ValueError(
                f"compute.graph: expands to over {MAX_EXPANDED_TOTAL} nodes in total")
    return size


def expand_graph(graph: Any) -> dict:
    """``{plotKey: canonical tree}`` — pure structural dereference.

    ⚠️ THE EXPANDED FOREST DOES **NOT** SHARE NODE OBJECTS, unlike the JS side.
    Python readers of a definition are ordinary dict walkers and at least one
    consumer (``param_manifest``) is handed the result of a client mutation, so
    an aliased subtree would let one write appear in several trees at once. The
    JS lane can share because every one of its consumers is read-only or
    copy-on-write; this lane pays the copy and says why.
    """
    keys = assert_graph(graph)
    nodes = graph["nodes"]

    def build(i: int) -> dict:
        n = nodes[i]
        out: dict = {"type": n["type"]}
        if "name" in n:
            out["name"] = n["name"]
        if "value" in n:
            out["value"] = n["value"]
        if "args" in n:
            out["args"] = [build(ref) for ref in n["args"]]
        return out

    return {k: build(graph["outputRoots"][k]) for k in keys}


def node_at(graph: Any, index: Any) -> Any:
    """The graph node one V2 parameter locator names, or ``None``.

    The V2 counterpart of ``param_manifest._walk``: a detached locator looks
    exactly like this, and answering ``None`` rather than raising is what lets
    ``reconcile`` report ``detached`` instead of refusing the whole save.
    """
    if not isinstance(graph, Mapping):
        return None
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return None
    if isinstance(index, bool) or not isinstance(index, int):
        return None
    if index < 0 or index >= len(nodes):
        return None
    return nodes[index]
