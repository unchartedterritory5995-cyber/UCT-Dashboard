"""THE MACHINE REPAINT LINTER -- the Python lane.

⭐ THE RULE, IN ONE SENTENCE: a formula repaints iff its output at bar ``i``
depends on any bar ``j > i``. That is decidable on this table because every
function declares its dependency window as a constant or as a named argument, so
the window of a node is a TREE SUM and nothing needs a dataflow analysis.

Three verdicts, spec section 3's vocabulary, and there is no fourth:

    non-repainting   -- the forward reach is exactly 0.
    preview-repaints -- the forward reach is a KNOWN FINITE k > 0. The output at
                        bar ``i`` moves while bars ``i+1 .. i+k`` are forming and
                        is FINAL the moment bar ``i+k`` closes. You can say when
                        it settles, and that sentence is the badge.
    repaints         -- the forward reach is UNKNOWN or UNBOUNDED. There is no
                        bar after which the value is guaranteed final.

⛔ THIS IS A MIRROR OF ``app/src/components/chart/engine/ast/lint.js``, NOT A
SECOND DESIGN. Both read the SAME manifest -- ``closedTable.json``, the file the
parser is configured from -- and ``tests/test_ast_lint.py`` runs both lanes over
the SAME corpus fixture, so a divergence is a failing test rather than a
discovery six months later. The repo has already paid for one second vocabulary
(``williams_r`` here is ``williamsR`` in the chart registry, which is the whole
reason ``_CASE_COLUMNS`` exists) and is not paying for another.

⛔ THERE IS NO EXEMPTION LIST, AND THERE MAY NOT BE ONE. An exemption is
precisely the hand-audited metadata this linter exists to replace, and the brand
position is receipts. If this linter disagrees with a shipped badge, the linter
is the MEASUREMENT and the badge is the CLAIM -- the disagreement goes to the
OWNER (``docs/decisions/2026-08-06-machine-repaint-linter.md``), never into this
file. That absence is proven STRUCTURALLY, by parsing this module with ``ast``
and asking which string constants it contains, never by grep: on this branch a
grep has counted comments in BOTH directions, and this very docstring names
several of the words a grep would trip on.

⛔ AND IT IS FAIL-CLOSED. A shape this module does not recognise returns
``repaints`` with an ``unanalysable:`` reason, NEVER ``non-repainting``. A false
``repaints`` costs a user one confused moment; a false ``non-repainting`` costs
the brand its central claim, and it costs it in a way a competitor can
demonstrate.

⛔ NO EXECUTION, EVER. This module never evaluates a formula, never samples a bar
and never compares two outputs. An empirical *"we ran it and nothing moved"* is a
statement about one bar window; the claim on the badge is universal.
"""
from __future__ import annotations

import json
import pathlib
import re
from typing import Any, Dict, List, Optional, Tuple, Union

# --------------------------------------------------------------------------- #
# the vocabulary
# --------------------------------------------------------------------------- #

#: Spec section 3's three badge values. ONE declaration per lane, and the two
#: lanes are asserted equal by ``tests/test_ast_lint.py``.
REPAINT_MODES: Tuple[str, ...] = ("non-repainting", "preview-repaints", "repaints")

#: The two answers to *"could the linter decide this at all?"* -- record
#: obligation 8. This exists so that *"the linter agreed with every shipped
#: badge"* is an impossible sentence when the truth is *"the linter could not read
#: any of them"*.
DECIDABILITY: Tuple[str, ...] = ("decided", "undecidable-hand-written")

#: A reach the linter could not bound. NOT a number: ``float("inf")`` would
#: compare, sum and ``max`` its way silently through every arithmetic path below,
#: and ``-1``/``None`` would each be a hole a future ``> 0`` test reads as clean.
UNKNOWN = "unknown"

#: A forward reach the manifest declares to have no bound. DECIDED (the manifest
#: said so) -- it just decides ``repaints``.
UNBOUNDED = "unbounded"

Reach = Union[int, str]

# --------------------------------------------------------------------------- #
# the manifest -- the one both lanes read
# --------------------------------------------------------------------------- #

_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
TABLE_PATH = _ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"


def load_table(path: Optional[pathlib.Path] = None) -> Dict[str, Any]:
    """The closed table, read from the file the PARSER is configured from.

    ⛔ NOT A COPY, AND NOT A PORT. ``closedTable.json`` is DATA precisely so that
    both lanes can read it; a hand-carried Python dict of the same names would be
    a second grammar, and it would drift the first time somebody edited one side.
    """
    return json.loads((path or TABLE_PATH).read_text(encoding="utf-8"))


TABLE: Dict[str, Any] = load_table()

# --------------------------------------------------------------------------- #
# the window, DERIVED FROM THE MANIFEST
# --------------------------------------------------------------------------- #

# ⭐⭐ OBLIGATION 2 -- THE FORWARD-REFERENCE SET COMES FROM THE MANIFEST BOTH
# LANES READ, AND THERE IS NO SECOND OFFSET TABLE IN THIS FILE.
#
# ``closedTable.json`` declares, per function, a ``lookback``: a non-negative
# integer, or the name of an argument that carries one. That declaration IS the
# dependency window, and this is the whole of what the linter knows:
#
#     lookback n >= 0  =>  the window is [i-n, i]    =>  forward reach 0
#     lookback n <  0  =>  the window is [i, i+|n|]  =>  forward reach |n|
#     lookback "argK"  =>  the same, with n = the K-th argument's literal value
#
# ⭐ THE SIGN IS THE MECHANISM, AND IT IS WHY THERE IS NO SECOND LIST. The day
# somebody adds an offset form to the manifest, its forward reach is already
# decided here -- by arithmetic on the number the manifest declares -- without a
# line of this file changing.
#
# ⚠️ DECLARED BLINDNESS, WRITTEN DOWN RATHER THAN LEFT TO BE DISCOVERED. This
# reads what the manifest SAYS a function's window is. A compute whose real
# window is wider than its declaration would be branded on the declaration and
# the linter would be wrong -- and no static analysis of the TREE can see that,
# because the tree does not contain the compute.
_ARG_REF = re.compile(r"^arg(\d+)$")


def _resolve_declaration(decl: Any, arg_nodes: List[Any]) -> Reach:
    """One declaration (``lookback`` or ``forward``) against a call's arguments.

    Returns an ``int``, ``UNBOUNDED`` or ``UNKNOWN``.

    ⛔ ``UNKNOWN`` FOR EVERY SHAPE THIS DOES NOT RECOGNISE, including an ``argK``
    whose argument is not a literal number. ``sma(close, 5 + 5)`` parses today and
    its window is a computed value; bounding it would need a constant folder,
    which is the dataflow analysis the manifest's ``_no_offset`` note exists to
    avoid. Fail closed.
    """
    if decl == UNBOUNDED:
        return UNBOUNDED
    if isinstance(decl, bool):
        return UNKNOWN
    if isinstance(decl, int):
        return decl
    if isinstance(decl, str):
        m = _ARG_REF.match(decl)
        if not m:
            return UNKNOWN
        idx = int(m.group(1))
        if idx >= len(arg_nodes):
            return UNKNOWN
        node = arg_nodes[idx]
        if not isinstance(node, dict) or node.get("type") != "num":
            return UNKNOWN
        value = node.get("value")
        if isinstance(value, bool) or not isinstance(value, int):
            return UNKNOWN
        return value
    return UNKNOWN


# --------------------------------------------------------------------------- #
# the definition's own inputs -- a DECLARED SCALAR, never an undeclared series
# --------------------------------------------------------------------------- #


def declared_inputs(defn: Any) -> Dict[str, bool]:
    """The input names a DEFINITION declares -- ``inputs[].key``, and nothing else.

    ⭐⭐ AN INPUT REFERENCE IS A SCALAR, AND THAT IS WHY IT HAS NO WINDOW.
    ``parse.js`` turns every identifier into a ``series`` node -- deliberately, so
    the parser needs no table -- and ``interpret`` seeds a declared input into the
    scope as ONE NUMBER, not a column. A per-instance constant is the same value
    at every bar, so its dependency window is ``[i, i]``: back 0, forward 0. Until
    this existed the linter had no way to say that, badged ``close * lineWidth``
    ``repaints`` on the strength of *"`lineWidth` is not a series this table
    declares"*, and every builder definition carries ``lineWidth`` -- so an
    input-referencing formula could not be armed at all.

    ⛔ ONE VOCABULARY, AND IT IS ``key``. ``defSchema.validateInput`` REQUIRES
    ``input.key``, ``nativeRegistry.resolveInputs`` reads it, and the house's own
    server-side reader ``signature/registry_defs.resolve_inputs`` reads
    ``spec["key"]``. ``name`` is NOT accepted as a fallback: a reader that took
    either would be the second vocabulary for one field that
    ``alert_user_series._inputs_for`` already cost this branch once.

    ⛔ THE VALUE IS DISCARDED, ON PURPOSE. Reading it would let a per-instance
    number decide a WINDOW -- ``_resolve_declaration`` still refuses an ``argK``
    that is not a literal ``num`` node, so ``sma(close, period)`` stays
    unanalysable and fails closed even though ``period`` is declared. A window
    that changed with a knob is a window the badge cannot promise anything about.
    """
    out: Dict[str, bool] = {}
    specs = defn.get("inputs") if isinstance(defn, dict) else None
    for spec in (specs if isinstance(specs, list) else []):
        if isinstance(spec, dict):
            key = spec.get("key")
            if isinstance(key, str) and key:
                out[key] = True
    return out


def _own_window(spec: Any, arg_nodes: List[Any]) -> Tuple[Reach, Reach]:
    """``(back, forward)`` for a call's OWN window, from the manifest.

    Both come out of ONE object so they cannot drift apart: ``max_lookback`` and
    the repaint verdict are two readings of the same declaration.
    """
    if not isinstance(spec, dict):
        return UNKNOWN, UNKNOWN

    lookback = _resolve_declaration(spec.get("lookback"), arg_nodes)
    declared_forward = (
        _resolve_declaration(spec["forward"], arg_nodes) if "forward" in spec else 0
    )

    if lookback == UNKNOWN or declared_forward == UNKNOWN:
        return UNKNOWN, UNKNOWN
    if lookback == UNBOUNDED or declared_forward == UNBOUNDED:
        return UNKNOWN, UNBOUNDED

    back = lookback if lookback >= 0 else 0
    from_sign = 0 if lookback >= 0 else -lookback
    forward = max(from_sign, declared_forward)
    return back, (UNKNOWN if forward < 0 else forward)


# --------------------------------------------------------------------------- #
# the tree sum
# --------------------------------------------------------------------------- #


def _max_reach(a: Reach, b: Reach) -> Reach:
    """``max`` over the reach lattice: UNKNOWN > UNBOUNDED > any finite number.

    ⛔ UNKNOWN OUTRANKS EVERYTHING, so one unreadable subtree makes the whole
    formula unreadable. Anything else would let a clean sibling launder a branch
    the linter could not read.
    """
    if a == UNKNOWN or b == UNKNOWN:
        return UNKNOWN
    if a == UNBOUNDED or b == UNBOUNDED:
        return UNBOUNDED
    return max(a, b)


def _add_reach(a: Reach, b: Reach) -> Reach:
    """``a + b`` over the same lattice, for a window that COMPOSES."""
    if a == UNKNOWN or b == UNKNOWN:
        return UNKNOWN
    if a == UNBOUNDED or b == UNBOUNDED:
        return UNBOUNDED
    return a + b


#: ⛔⛔ A LITERAL, AND THE DUPLICATION IS FORCED RATHER THAN LAZY.
#: ``test_no_evaluator_is_reachable_from_the_linter`` asserts by AST that this
#: module imports the STANDARD LIBRARY AND NOTHING ELSE — because a linter that
#: could reach ``indicator_compute`` could reach a verdict by RUNNING a formula,
#: and a claim measured on one bar window is not the universal claim the badge
#: makes. Importing ``ast_interpret.NODE_TYPES`` here would buy one derivation
#: and sell that proof, so the copy stays and
#: ``test_the_node_vocabulary_here_IS_the_interpreter_s`` is what binds the two.
#: ⭐ THE BINDING LIVES IN THE TEST, WHERE BOTH MODULES MAY BE IMPORTED AT ONCE.
_CANONICAL_TYPES = ("num", "series", "op", "call", "offset")


def ast_reach(tree: Any, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The dependency window of a whole tree, in bars.

    ``{"back": .., "forward": .., "reasons": [..]}`` where each of back/forward is
    a non-negative ``int``, ``UNBOUNDED`` or ``UNKNOWN``.

    ⚠️ ITERATIVE, NOT RECURSIVE -- the same reason ``parse.js``'s forbidden-node
    scan is: the escape corpus carries an 8,001-node tree, and a guard that dies
    inside itself is not a guard.
    """
    opts = opts or {}
    table = opts.get("table") or TABLE
    functions = table.get("functions") or {}
    series_names = table.get("series") or {}
    operators = table.get("operators") or {}
    #: ⭐ THE TABLE'S OWN PER-SYMBOL SCALARS. Read from the SAME manifest as the
    #: series, so a name the table grants is a name this linter can bound — and
    #: the freshness question it does NOT answer is asked by ``ast_freshness``
    #: over this same section.
    scalar_names = table.get("scalars") or {}
    #: ⭐ THE CLOCK (tableVersion 2), read from the SAME manifest. A clock leaf is
    #: a property of the bar it draws on, so it reaches neither way.
    clock_names = table.get("clock") or {}
    #: ⭐ ``opts["inputs"]`` -- the definition's declared inputs, BY NAME. The same
    #: shape ``sentence.js::explainSentence`` already takes and the same shape
    #: ``interpret`` takes; only the KEYS are read here (see ``declared_inputs``).
    #: ``lint_definition`` derives it from the definition itself, so a caller
    #: cannot widen a definition's own input set by handing in another one.
    inputs = opts.get("inputs") or {}
    reasons: List[str] = []

    order: List[Any] = []
    stack: List[Any] = [tree]
    while stack:
        node = stack.pop()
        order.append(node)
        if isinstance(node, dict) and isinstance(node.get("args"), list):
            stack.extend(node["args"])

    reach_of: Dict[int, Tuple[Reach, Reach]] = {}

    def unknown(why: str) -> Tuple[Reach, Reach]:
        reasons.append("unanalysable: %s" % why)
        return UNKNOWN, UNKNOWN

    for node in reversed(order):
        if not isinstance(node, dict):
            reach_of[id(node)] = unknown("a node that is not an object")
            continue
        kind = node.get("type")
        args = node.get("args") if isinstance(node.get("args"), list) else []

        if kind == "num":
            reach_of[id(node)] = (0, 0)
        elif kind == "series":
            name = node.get("name")
            # ⛔ THE TABLE IS CONSULTED FIRST AND THE ORDER IS LOAD-BEARING --
            # verbatim ``sentence.js::renderName``'s reasoning, for the same
            # reason. A definition whose input shadows ``close`` is a wiring
            # defect ``interpret`` raises on outright; what this must never do is
            # let the ANSWER depend on which map was consulted second.
            if isinstance(name, str) and name in series_names:
                reach_of[id(node)] = (0, 0)
            elif isinstance(name, str) and name in clock_names:
                # ⭐ A CLOCK LEAF, AND ITS ZERO IS A DIFFERENT FACT FROM A
                # SCALAR'S. A scalar is (0, 0) because it is ONE number for the
                # whole column; a clock value is (0, 0) because it is THIS bar's
                # own -- `hour` changes every bar and still reads no other one.
                # Both are non-repainting and the reasons do not transfer, which
                # is why this is its own branch rather than a widened scalar test.
                #
                # ⛔ AND UNLIKE A SCALAR, THERE IS NO SECOND VERDICT TO ASK FOR.
                # ``ast_freshness`` exists because a scalar's zero hides a
                # day-old value; a clock leaf is read off the bar being drawn, so
                # it answers ``live`` and this zero is the whole truth.
                reach_of[id(node)] = (0, 0)
            elif isinstance(name, str) and name in scalar_names:
                # ⭐ A TABLE-DECLARED SCALAR, AND IT IS THE SAME (0, 0) AS A
                # DECLARED INPUT FOR THE SAME REASON: one number for the whole
                # column depends on no bar at all, least of all a later one.
                #
                # ⛔ AND THAT ZERO IS CORRECT AND USELESS ON ITS OWN. It makes
                # `mode_from_reach` answer `non-repainting` for a formula whose
                # value is up to a day old, so this gate PASSES a nightly market
                # cap and nothing fires. It is a true answer to a question nobody
                # asked, which is why ``ast_freshness`` is a SECOND VERDICT and a
                # gate rather than a label. This module does not bend to cover
                # it: a scalar genuinely reads no future bar.
                reach_of[id(node)] = (0, 0)
            elif isinstance(name, str) and name in inputs:
                # A DECLARED SCALAR. One number for the whole column, so it
                # depends on no bar at all -- least of all a later one.
                reach_of[id(node)] = (0, 0)
            else:
                reach_of[id(node)] = unknown(
                    "`%s` is not a series this table declares, and this "
                    "definition declares %s"
                    % (name, ", ".join(sorted(inputs)) or "no inputs"))
        elif kind == "offset":
            # ⭐⭐ THE OFFSET IS THE ONE NODE THAT MOVES A WINDOW WITHOUT NAMING
            # A FUNCTION, AND IT MOVES IT BACKWARDS ONLY. `close[3]` at bar `i`
            # reads bar `i-3`: `back` grows by the offset, `forward` is
            # untouched. That asymmetry is not a policy this file applies -- it
            # is a fact about the node, because `parse.js` refuses a negative
            # literal at the door and the shape has no slot for an expression
            # that could evaluate to one.
            #
            # ⛔ WHICH IS WHY THIS ARM CANNOT MAKE ANYTHING REPAINT, AND WHY
            # `ichimoku.chikou` IS STILL DECIDABLE: `mode_from_reach` still reads
            # ONE authority on forward reach, the manifest's own declaration.
            n = node.get("value")
            if (len(args) != 1 or isinstance(n, bool) or not isinstance(n, (int, float))
                    or float(n) != int(n) or n < 0):
                reach_of[id(node)] = unknown(
                    "an offset node carries one child and a whole number of bars >= 0, "
                    "got %r over %d" % (n, len(args)))
            else:
                cb, cf = reach_of.get(id(args[0]), (UNKNOWN, UNKNOWN))
                reach_of[id(node)] = (_add_reach(int(n), cb), cf)
        elif kind == "op":
            spec = operators.get(node.get("name"))
            if not spec or spec.get("arity") != len(args):
                reach_of[id(node)] = unknown(
                    "`%s` is not an operator this table declares at arity %d"
                    % (node.get("name"), len(args)))
            else:
                # An operator is POINTWISE: it reads its arguments at bar `i` and
                # nowhere else, so it contributes no window of its own.
                back: Reach = 0
                forward: Reach = 0
                for child in args:
                    cb, cf = reach_of.get(id(child), (UNKNOWN, UNKNOWN))
                    back = _max_reach(back, cb)
                    forward = _max_reach(forward, cf)
                reach_of[id(node)] = (back, forward)
        elif kind == "call":
            spec = functions.get(node.get("name"))
            if not spec:
                reach_of[id(node)] = unknown(
                    "`%s` is not a function this table declares" % node.get("name"))
            else:
                own_back, own_forward = _own_window(spec, args)
                if own_forward == UNKNOWN:
                    reach_of[id(node)] = unknown(
                        "`%s` declares a window this linter cannot bound" % node.get("name"))
                else:
                    arg_back: Reach = 0
                    arg_forward: Reach = 0
                    for child in args:
                        cb, cf = reach_of.get(id(child), (UNKNOWN, UNKNOWN))
                        arg_back = _max_reach(arg_back, cb)
                        arg_forward = _max_reach(arg_forward, cf)
                    # The outer window COMPOSES on top of whatever the arguments
                    # reach: an output at `i` reads argument outputs across
                    # [i-back, i+forward], each already reaching `arg_forward`.
                    forward = _add_reach(own_forward, arg_forward)
                    if forward != UNKNOWN and forward != 0:
                        reasons.append(
                            "`%s` declares an UNBOUNDED forward reach - no bar makes this value final"
                            % node.get("name")
                            if forward == UNBOUNDED else
                            "`%s` reads %d bar%s ahead of the bar it writes"
                            % (node.get("name"), forward, "" if forward == 1 else "s"))
                    reach_of[id(node)] = (_add_reach(own_back, arg_back), forward)
        else:
            reach_of[id(node)] = unknown(
                "node type %r is not one of %s" % (kind, ", ".join(_CANONICAL_TYPES)))

    back, forward = reach_of.get(id(tree), (UNKNOWN, UNKNOWN))
    return {"back": back, "forward": forward, "reasons": reasons}


def max_lookback(tree: Any, opts: Optional[Dict[str, Any]] = None) -> Reach:
    """The BACKWARD window only -- warm-up bars, nothing else.

    ⛔ IT IS NOT A BOUND ON THE FORWARD DEPENDENCY AND MUST NEVER BE USED AS ONE.
    Treating a lookback as a forward bound brands ``sma(close, 20)`` as reading 20
    bars ahead, and every clean case in the corpus goes with it.
    """
    return ast_reach(tree, opts)["back"]


# --------------------------------------------------------------------------- #
# the verdict
# --------------------------------------------------------------------------- #


def mode_from_reach(forward: Reach) -> str:
    """Reach -> badge. The whole decision, in three lines, on purpose.

    ⭐ THE MIDDLE LINE IS THE FORWARD-REFERENCE CHECK. Deleting it is the
    guard-deleted control the record's section 5.5 requires: with it gone every
    bounded forward reference reads ``non-repainting`` and the must-repaint
    corpus comes back non-zero clean, which is what proves this linter is capable
    of being wrong. A gate that cannot fail is not a gate.
    """
    if forward == UNKNOWN or forward == UNBOUNDED:
        return "repaints"
    if forward > 0:
        return "preview-repaints"
    return "non-repainting"


def lint_repaint(tree: Any, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Assign a repaint mode to an AST. Same verdict, same vocabulary, as the JS lane.

    ``opts["table"]`` is a GRAMMAR keyed by function name -- never an allow-list,
    never keyed by an indicator id. It defaults to the shipped manifest.

    ``opts["inputs"]`` is the DEFINITION's declared inputs, by name -- the same
    shape ``sentence.js`` and ``interpret`` take. A ``series`` node naming one of
    them is a per-instance SCALAR and reaches no bar; a name in neither map is
    unanalysable and fails closed, exactly as before. It is NOT an allow-list
    either: ``lint_definition`` derives it from ``defn["inputs"]``, so what a
    definition may call a scalar is what that definition itself declares.
    """
    reach = ast_reach(tree, opts)
    mode = mode_from_reach(reach["forward"])
    if mode == "non-repainting":
        reasons = ["every bar this output depends on is at or before its own index"]
    else:
        reasons = reach["reasons"] or ["unanalysable: the linter could not bound this tree"]
    return {"mode": mode, "reasons": reasons, "forward": reach["forward"], "back": reach["back"]}


# --------------------------------------------------------------------------- #
# per-plot, per-definition -- the shape the owner's ruling needs
# --------------------------------------------------------------------------- #


def lint_definition(defn: Dict[str, Any], opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """⭐⭐ OBLIGATION 9 -- PER-PLOT GRANULARITY, EXPRESSIBLE BEFORE ANY BADGE MOVES.

    The owner's ruling (record section 4) is per PLOT. Today ``meta.repaint`` is
    per DEFINITION and no plot carries a badge, so the ruling cannot be applied
    without lying in one direction or the other. This is the output shape that can
    hold it -- ``(defId, plotKey) -> verdict`` -- and it exists BEFORE any badge
    moves, which is the order the record demands.

    ⛔ THIS FUNCTION MEASURES. It never reads a shipped badge, never compares
    against one and never writes anything.

    ``opts["declared_forward_facts"]`` maps ``"<fn>.<plot>"`` to an externally
    PINNED forward dependency for a lane this linter cannot read. The linter owns
    no such fact and cannot invent one; it is handed them by a caller that read
    them from where they are already pinned.

    ⭐ THE DEFINITION'S OWN INPUTS ARE DERIVED HERE, NEVER ACCEPTED FROM THE
    CALLER. ``opts["inputs"]`` is overwritten with ``declared_inputs(defn)`` on
    the ``ast`` lane, so a caller cannot widen a definition's scalar set by
    handing one in -- which is what would turn a declared knob into a general
    escape hatch for any name at all. The closed table stays closed; what an
    input adds is exactly the names the DOCUMENT declares.
    """
    opts = opts or {}
    facts = opts.get("declared_forward_facts") or {}
    compute = defn.get("compute") or {}
    lane = compute.get("kind") or "unknown"
    fn = compute.get("fn") or ""
    plots = defn.get("plots") or []

    rows = []
    for plot in plots:
        plot_key = plot.get("key") if isinstance(plot, dict) else plot
        address = "%s.%s" % (defn.get("id"), plot_key)

        if lane == "ast":
            # W1b -- A PLOT LINTS **ITS** TREE; the scan alias (``compute.ast``) is
            # what a plot with no tree of its own lints, which is every plot of a
            # tree-less (pre-W1b) document and every ``hlines`` guide. Reading
            # ``compute.ast`` for all of them would report one tree's verdict under
            # four plot keys. ``.get(key, default)`` rather than ``or`` on purpose:
            # a tree that is present and falsy is a document defect for
            # ``defSchema``/``user_definitions`` to name, not something to paper
            # over with the scan tree's answer -- and the JS lane's
            # ``hasOwnProperty`` says exactly the same thing.
            tree = (compute.get("trees") or {}).get(plot_key, compute.get("ast"))
            verdict = lint_repaint(tree, dict(opts, inputs=declared_inputs(defn)))
            rows.append(dict(address=address, defId=defn.get("id"), plotKey=plot_key,
                             lane=lane, decidability="decided", **verdict))
            continue

        fact_key = "%s.%s" % (fn, plot_key)
        if fact_key in facts:
            forward = facts[fact_key]
            rows.append({
                "address": address, "defId": defn.get("id"), "plotKey": plot_key, "lane": lane,
                "decidability": "decided",
                "mode": mode_from_reach(forward),
                "forward": forward,
                "back": UNKNOWN,
                "reasons": [
                    "the compute is hand-written and unreadable to this linter, but a forward "
                    "dependency of %d bar%s is PINNED outside it and was handed in - bar i's value "
                    "is written to index i-%d, so the point at a historical index moves while the "
                    "newest bar forms and is final the moment that bar closes"
                    % (forward, "" if forward == 1 else "s", forward),
                ],
            })
            continue

        rows.append({
            "address": address, "defId": defn.get("id"), "plotKey": plot_key, "lane": lane,
            "decidability": "undecidable-hand-written",
            "mode": None,
            "forward": UNKNOWN,
            "back": UNKNOWN,
            "reasons": [
                "the compute is hand-written %s and spec section 11 forbids static analysis of it; "
                "nothing outside the linter pins a forward dependency for this plot"
                % ("Python" if lane == "server" else "JS"),
            ],
        })

    return {"id": defn.get("id"), "lane": lane, "plots": rows}


def lint_catalogue(defs: List[Dict[str, Any]], opts: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Every definition, every plot, one flat table. The measurement."""
    return [row for d in defs for row in lint_definition(d, opts)["plots"]]


def disagreements(rows: List[Dict[str, Any]], badges: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The rows on which the linter DISAGREES with a shipped badge.

    ⛔ A DISAGREEMENT IS A FINDING, NOT A FIX. This returns it; it does not
    resolve it, and there is deliberately no function in this module that could.
    The only response available to a caller is to report -- which is obligation 7:
    the failure direction is *"the finding is loud"*, never *"the badge was
    quietly corrected to match"*.

    An ``undecidable-hand-written`` row is NOT a disagreement. The linter having
    no opinion is not the same as the linter agreeing, and conflating them is
    exactly the sentence obligation 8 exists to make unwriteable.
    """
    out = []
    for row in rows:
        if row.get("decidability") != "decided":
            continue
        shipped = badges.get(row.get("defId"))
        if row.get("mode") != shipped:
            out.append({"address": row["address"], "shipped": shipped,
                        "measured": row.get("mode"), "reasons": row.get("reasons", [])})
    return out
