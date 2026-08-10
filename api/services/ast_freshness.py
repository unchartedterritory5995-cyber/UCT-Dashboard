"""THE SECOND VERDICT -- how fresh a formula's inputs CAN be. The Python lane.

⭐⭐ WHY THERE IS A SECOND VERDICT AT ALL, AND IT IS THE WHOLE POINT OF THIS
MODULE. ``ast_lint.ast_reach`` answers ``(back 0, forward 0)`` for a scalar leaf,
so ``mode_from_reach`` brands ``market_cap > 1e9`` **non-repainting** -- and that
answer is CORRECT. A scalar's value at bar ``i`` does not depend on any bar
``j > i``; it is the same number at every bar of the column. Which means the
repaint gate PASSES a formula whose value is up to a day old and **nothing fires
at all**. The zero is a true answer to a question nobody asked.

That is exactly why freshness is a **GATE** and not a label:
``nativeRegistry.validateAstLane`` requires ``meta.freshness`` on the ``ast``
lane and refuses a disagreement in BOTH directions, the same way it already does
for the repaint badge one field over. Over-claiming ``live`` on a nightly market
cap tells a user a number is current when it is a day old; under-claiming
``as-of-snapshot`` on a pure price formula tells them a live signal is stale, and
a user who discounts a true signal has been misled just as precisely.

Three values and NO CADENCE STRING IN THE BADGE, on purpose. Whether the
snapshot's nightly cadence is the right one is an OPEN OWNER QUESTION, and a
badge spelling ``snapshot:nightly`` would bake an unresolved decision into a
persisted, user-visible field. The cadence lives per-scalar in the manifest and
reaches the user through the read-back, where changing it is not a migration.

⛔ IT IS A CADENCE CLAIM, NOT A STALENESS MEASUREMENT. ``ast_lint``'s module rule
is *"NO EXECUTION, EVER ... an empirical 'we ran it and nothing moved' is a
statement about one bar window; the claim on the badge is universal."* The same
rule holds here: this answers *how fresh this column CAN be*. How fresh a given
symbol's row IS is a per-row runtime fact read off the ``as_of`` column, and it
belongs in a result envelope. Conflating them is how a static claim starts
depending on when it was rendered.

⛔ AND IT IS FAIL-CLOSED, IN THE STALEST DIRECTION. A shape this module cannot
read answers ``unknown``, never ``live`` -- mirroring the repaint linter's
``repaints``. A false ``live`` is the brand claim dying quietly.

⛔ THIS IS A MIRROR OF ``app/src/components/chart/engine/ast/freshness.js``, NOT
A SECOND DESIGN. Both read the SAME ``closedTable.json`` and both are asserted
against the SAME fixture (``tests/fixtures/ast/scalars.json``), so a divergence
is a failing test rather than a discovery six months later.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from api.services.ast_lint import TABLE, declared_inputs

#: The three answers, and there is no fourth.
#:
#: live           -- every leaf reads the bar it draws on. No scalar in the tree.
#: as-of-snapshot -- at least one leaf is a table-declared scalar. The value is
#:                   fixed between builds and is IDENTICAL AT EVERY BAR of the
#:                   column, including at bars that closed before the build ran.
#: unknown        -- a leaf, or the tree's own shape, is something this reader
#:                   cannot resolve. FAIL-CLOSED = the STALEST claim.
FRESHNESS_MODES = ("live", "as-of-snapshot", "unknown")

LIVE, AS_OF_SNAPSHOT, UNKNOWN = FRESHNESS_MODES

#: The canonical node vocabulary. A hand copy of a vocabulary fails in the
#: quietest possible direction HERE: when the bounded backward offset landed as a
#: fifth node type, a stale list would have branded every tree containing
#: ``close[1]`` **unknown** — fail-closed, so nothing goes red, and the badge
#: simply stops telling the truth about the freshest formula a user can write.
#:
#: ⛔ SO IT IS PINNED BY A TEST RATHER THAN BY AN IMPORT, for the same reason
#: ``ast_lint``'s copy is: this module reads the tree and never runs it, it sits
#: downstream of that purity rail, and importing ``ast_interpret`` would drag
#: ``indicator_compute`` in behind it.
#: ⭐ ``test_the_node_vocabulary_here_IS_the_interpreter_s`` is the binding.
#:
#: ⚠️ THE OFFSET ADDS NO FRESHNESS VOCABULARY OF ITS OWN. A scalar still rides
#: the ``series`` node (``closedTable.json::_scalars_node``) and ``_walk``
#: already descends ``args``, so ``market_cap[1]`` reaches ``scalars_in``
#: exactly as ``market_cap`` does: an offset over a snapshot is still a snapshot.
_CANONICAL_TYPES = ("num", "series", "op", "call", "offset")


def _walk(tree: Any) -> List[Any]:
    """Every node, ITERATIVELY -- the escape corpus carries an 8,001-node tree
    and a reader that dies inside itself has no verdict to give."""
    order: List[Any] = []
    stack: List[Any] = [tree]
    while stack:
        node = stack.pop()
        order.append(node)
        if isinstance(node, dict) and isinstance(node.get("args"), list):
            stack.extend(node["args"])
    return order


def _sections(opts: Optional[Dict[str, Any]]):
    opts = opts or {}
    table = opts.get("table") or TABLE
    return (table.get("series") or {},
            table.get("scalars") or {},
            opts.get("inputs") or {})


def scalars_in(tree: Any, opts: Optional[Dict[str, Any]] = None) -> Set[str]:
    """The TABLE-DECLARED SCALARS this tree names.

    ⛔ DERIVED FROM THE MANIFEST, NEVER FROM A LIST OF WHICH NAMES LOOK
    FUNDAMENTAL. A hand-list is the shape that rots the day the screener grows a
    column, and the partition rail exists precisely so that day is loud.
    """
    _series, scalars, _inputs = _sections(opts)
    found: Set[str] = set()
    for node in _walk(tree):
        if (isinstance(node, dict) and node.get("type") == "series"
                and isinstance(node.get("name"), str) and node["name"] in scalars):
            found.add(node["name"])
    return found


def _declaration_is_readable(decl: Any) -> bool:
    """Can this reader resolve the scalar's own freshness declaration?

    ⛔ BOTH HALVES OR NEITHER. ``as_of.column`` is what dates the value PER
    SYMBOL and ``cadence`` is what the badge is a claim about; a declaration
    missing either is one this module cannot stand behind, and standing behind it
    anyway is how ``unknown`` stops being reachable.
    """
    if not isinstance(decl, dict):
        return False
    as_of = decl.get("as_of")
    cadence = decl.get("cadence")
    return (isinstance(as_of, dict)
            and isinstance(as_of.get("column"), str) and bool(as_of["column"])
            and isinstance(cadence, str) and bool(cadence))


def freshness_for(tree: Any, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """``{"mode", "scalars", "cadences", "reasons"}`` for a canonical tree.

    ``opts["table"]`` is the manifest (defaults to the shipped one).
    ``opts["inputs"]`` is the DEFINITION's declared inputs, by name -- the same
    shape ``ast_lint`` and ``interpret`` take. A per-instance knob is dated by
    nothing and therefore neither makes a formula stale nor unreadable.

    ⛔ IT DOES NOT RE-CHECK OPERATOR OR FUNCTION NAMES. ``interpret`` refuses an
    undeclared one at ``resolve:function`` and ``check_budget`` resolves every
    call on its way to a lookback, so a tree carrying one never reaches a badge.
    Re-deciding it here would be a second declaration of one refusal, which is
    the wrong-door defect this branch has found four separate times.
    """
    series_names, scalars, inputs = _sections(opts)
    reasons: List[str] = []
    found: Set[str] = set()
    cadences: Set[str] = set()
    unreadable = False

    for node in _walk(tree):
        if not isinstance(node, dict):
            unreadable = True
            reasons.append("unreadable: a node that is not an object")
            continue
        kind = node.get("type")
        if kind not in _CANONICAL_TYPES:
            unreadable = True
            reasons.append(
                "unreadable: node type %r is not one of %s"
                % (kind, ", ".join(_CANONICAL_TYPES)))
            continue
        if kind in ("op", "call") and not isinstance(node.get("args"), list):
            unreadable = True
            reasons.append("unreadable: a %s node carries an `args` array" % kind)
            continue
        if kind != "series":
            continue
        name = node.get("name")
        if isinstance(name, str) and name in series_names:
            continue
        if isinstance(name, str) and name in scalars:
            decl = scalars[name]
            if not _declaration_is_readable(decl):
                unreadable = True
                reasons.append(
                    "unreadable: the scalar `%s` declares a cadence or an as-of "
                    "column this reader cannot resolve" % name)
                continue
            found.add(name)
            cadences.add(decl["cadence"])
            reasons.append(
                "`%s` is a per-symbol value dated by `%s`, rebuilt %s -- it is the "
                "same number at every bar of the column"
                % (name, decl["as_of"]["column"], decl["cadence"]))
            continue
        if isinstance(name, str) and name in inputs:
            # A per-instance knob. Dated by nothing, so it neither ages the
            # formula nor stops this reader from answering.
            continue
        unreadable = True
        reasons.append(
            "unreadable: `%s` is neither a series nor a scalar this table "
            "declares, and this definition declares %s"
            % (name, ", ".join(sorted(inputs)) or "no inputs"))

    if unreadable:
        mode = UNKNOWN
    elif found:
        mode = AS_OF_SNAPSHOT
    else:
        mode = LIVE
        reasons = ["every value this formula reads comes from the bar it draws on"]

    return {"mode": mode, "scalars": sorted(found),
            "cadences": sorted(cadences), "reasons": reasons}


def freshness_definition(defn: Dict[str, Any],
                         opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Per-plot freshness rows, in the SAME SHAPE ``ast_lint.lint_definition``
    returns for the repaint verdict.

    ⚠️ IT LIVES HERE RATHER THAN BESIDE THE REPAINT ROW, AND THAT IS A MEASURED
    CONSTRAINT RATHER THAN A PREFERENCE. ``tests/test_ast_lint.py::
    test_no_evaluator_is_reachable_from_the_linter`` asserts the linter's import
    set is EXACTLY five standard-library modules, so folding this into
    ``lint_definition`` would have meant deleting the rail that proves the badge
    cannot be reached by RUNNING a formula. The dependency therefore points the
    other way: this module imports the linter, so it inherits the same
    no-execution property by transitivity and the rail keeps its teeth.

    ⭐ THE DEFINITION'S OWN INPUTS ARE DERIVED HERE, NEVER ACCEPTED FROM THE
    CALLER -- verbatim ``lint_definition``'s reasoning. A caller that could hand
    in an input map could make any unresolvable name read as a per-instance knob,
    and an ``unknown`` would quietly become a ``live``.

    A non-``ast`` lane gets ``None``: this reader has no tree to walk, and a
    hand-written compute's data sources are exactly what spec section 11 forbids
    it from analysing.
    """
    opts = opts or {}
    compute = defn.get("compute") or {}
    lane = compute.get("kind") or "unknown"
    plots = defn.get("plots") or []

    rows = []
    for plot in plots:
        plot_key = plot.get("key") if isinstance(plot, dict) else plot
        row = {"address": "%s.%s" % (defn.get("id"), plot_key),
               "defId": defn.get("id"), "plotKey": plot_key, "lane": lane}
        if lane == "ast":
            row.update(freshness_for(compute.get("ast"),
                                     dict(opts, inputs=declared_inputs(defn))))
        else:
            row.update({
                "mode": None, "scalars": [], "cadences": [],
                "reasons": ["the compute is hand-written and this reader has no "
                            "tree to walk; spec section 11 forbids analysing it"],
            })
        rows.append(row)
    return {"id": defn.get("id"), "lane": lane, "plots": rows}
