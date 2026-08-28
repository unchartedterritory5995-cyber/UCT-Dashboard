"""What makes an ordinary definition a SCAN, and what a scan is called.

⭐ A SCAN IS NOT A NEW LANE AND NOT A NEW LANGUAGE (E-A1). ``closedTable.json``'s
own ``_booleans`` note settles it: *"There is no boolean node type … a condition
is therefore a 0/1 column"*. So a scan is ``WHERE <ast> != 0`` evaluated on the
last confirmed bar, over a tree the SAME parser built, the SAME linter badged and
the SAME store holds. This module adds no vocabulary, no node type and no second
identity — it answers two questions about a definition that already exists:

    1. does its tree produce 0/1?           ``is_boolean_tree``
    2. what is it called?                   ``def_hash``

⛔ AND THE ANSWER TO (1) IS DERIVED, NEVER HAND-LISTED. Without the manifest's
``yields`` declaration this check and the picker's *"is this row a condition"*
check would each hand-list the same nine comparison and logical operators, in two
languages — the two-vocabularies defect this repo has already paid for twice
(``williams_r`` here is ``williamsR`` in the chart registry, which is the only
reason ``indicator_compute._CASE_COLUMNS`` exists at all). With ``yields``
declared once, a twelfth function is classified the day it lands, and a RENAMED
logical operator cannot silently drop out of the classification with every gate
green — which is precisely what the Phase-E plan review caught ``vocabulary()``
doing on the JavaScript side.

⛔ THE FAIL-CLOSED DIRECTION IS THE NUMERIC ONE, and it is not symmetric.
Refusing to call a tree a scan costs a user one error message. Admitting a
real-valued tree as a scan makes ``<tree> != 0`` true for every non-zero price on
the board — the screen returns the whole universe and looks like a very good day.

⚠️ THIS MODULE SPELLS NO NAME THE TABLE DECLARES. Not an operator, not a
function, not a scalar, not a bar series. ``test_scan_definition.py`` walks this
file with ``ast`` and intersects its string constants with
``ast_table.declared_names()``; a hand-list necessarily spells the names and a
derivation necessarily does not. The node types and result kinds below ARE
spelled, because they are STRUCTURE rather than vocabulary — and each one is
pinned to its single declaration by a test in that file.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from api.services import ast_freshness
from api.services import ast_interpret
from api.services import ast_table
from api.services import user_definitions

#: The canonical node types, spelled as STRUCTURE and pinned to
#: ``ast_interpret.NODE_TYPES`` by ``test_the_node_types_this_module_branches_on
#: _ARE_the_declared_ones``. A tree carries these shapes and this module has a
#: case for each; that is a surface small enough to prove closed.
_NUM = "num"
_SERIES = "series"
_OP = "op"
_CALL = "call"
#: ⭐ THE BOUNDED BACKWARD OFFSET. It changes *when* a value is read and never
#: *what* it is, so its result kind is its child's — see ``yields_bool``.
_OFFSET = "offset"
#: ⚠️ A HIGHER-TIMEFRAME READ. Declared here because this module BRANCHES on it
#: — `test_the_node_types_this_module_branches_on_ARE_the_declared_ones` asserts
#: this set equals `ast_interpret.NODE_TYPES`, and it is what caught `tf` being
#: added to the engine while the classifier below still knew five types.
_TF = "tf"
#: ⚠️ A READ OF ANOTHER INSTRUMENT. Same census rule as `_TF` above — it is in
#: this tuple because the classifier BRANCHES on it, and the branch census is what
#: fails the day the engine learns a seventh type this module has not been taught.
_SYM = "sym"
#: ⚠️ THE FORMING higher-timeframe read. Classified with `_TF` below — a period
#: changes WHEN, never WHAT — but it is its own constant because the branch census
#: compares this module's set against the engine's, name for name.
_TF_LIVE = "tf_live"

#: The three answers ``ast_table.yields_of`` can give, likewise pinned by a test
#: rather than assumed. ``passthrough`` belongs to the ternary alone: its result
#: kind is the join of its arms, so it has no static answer of its own.
_KIND_NUM = "num"
_KIND_BOOL = "bool"
_KIND_PASSTHROUGH = "passthrough"

#: ``compute.kind`` for the lane a scan lives in. Not a table name — a lane name.
AST_KIND = "ast"

#: ⭐ THE GATES ARE A CLOSED SET, and that is what makes a refusal actionable.
#: A caller catching ``ScanRefused`` can branch on ``.gate`` and know the branch
#: list is finite; an open-ended reason string would be prose a surface has to
#: pattern-match, which is how a refusal becomes a 500.
#: ⚠️ `symbol` JOINED THEM IN W2b TASK 4, and it is the first gate that refuses
#: something `interpret` ACCEPTS: a scan may only read a DECLARED benchmark,
#: while the chart lane serves any symbol it can fetch. It is its own gate
#: rather than folded into `tree` precisely because a caller branches on this
#: — "your formula is malformed" and "that instrument is fine to chart but not
#: to sweep" are different things to tell a member, and only one of them has a
#: list of alternatives to offer.
GATES = ("kind", "tree", "hash", "yields", "symbol")


class ScanRefused(Exception):
    """A definition that cannot be run as a screen, and the gate that said so.

    The message always leads with ``[gate:<name>]`` so a test can bind to the
    GATE rather than to the prose — prose gets edited, a gate does not.
    """

    def __init__(self, gate: str, detail: str) -> None:
        if gate not in GATES:
            raise ValueError(
                f"{gate!r} is not one of this module's gates {GATES}. The set is "
                "closed on purpose: a caller branches on it."
            )
        self.gate = gate
        self.detail = detail
        super().__init__(f"[gate:{gate}] {detail}")


#: The sections a ``series`` NODE may legally name.
#:
#: ⛔ FUNCTIONS AND OPERATORS ARE ABSENT, AND THAT IS THE WHOLE POINT. A leaf
#: named ``crossOver`` is not a call — it is a name the interpreter refuses at
#: ``resolve:name``. Letting the yields lookup find the FUNCTION entry answered
#: ``bool`` for it, and the gate stamped the tree scannable while every sweep row
#: refused. Derived from ``ast_table``'s own section names, never retyped.
_LEAF_SECTIONS = (ast_table.CLOCK_SECTION, ast_table.SCALARS_SECTION)


def _declared_kind(name: Any, table: Optional[Mapping[str, Any]],
                   sections: Optional[tuple] = None) -> str:
    """What the table says a name's values can be, or the numeric default.

    ⛔ AN UNDECLARED NAME READS AS THE NUMERIC DEFAULT RATHER THAN RAISING, and
    that covers two different cases with one honest answer: a BAR SERIES (the
    ``series`` section declares no ``yields``, because a price is a number and
    always was) and a name this table has never heard of (an instance input, or a
    manifest that grew an entry nobody classified yet). Both are numbers until
    somebody declares otherwise.
    """
    try:
        return ast_table.yields_of(name, table, sections)
    except KeyError:
        return ast_table.YIELDS_DEFAULT


def _leaf_kind(value: Any) -> str:
    """A ``num`` literal's kind: ``bool`` only for the two values a 0/1 column holds.

    ⚠️ ``type(value) is bool`` IS CHECKED FIRST, AND THAT IS NOT PEDANTRY.
    ``True == 1``, ``isinstance(True, int)`` is True, and ``True in (0, 1)`` is
    True — a bool sails through every obvious numeric guard, which Phase D Task 5
    measured the hard way. A canonical tree cannot carry one (``stable_stringify``
    refuses it), so meeting one here means the tree is not the persisted artifact
    and the fail-closed answer is the right one.
    """
    if type(value) is bool:
        return _KIND_NUM
    if isinstance(value, (int, float)):
        try:
            as_float = float(value)
        except (TypeError, ValueError, OverflowError):
            return _KIND_NUM
        if as_float == 0.0 or as_float == 1.0:
            return _KIND_BOOL
    return _KIND_NUM


def _settle(kind: str) -> str:
    """Collapse a declared kind onto the two a NODE can actually have.

    Anything that is not ``bool`` is a number here, including a ``passthrough``
    that reached a node with no arms to join. Fail closed.
    """
    return _KIND_BOOL if kind == _KIND_BOOL else _KIND_NUM


def is_boolean_tree(ast: Any, table: Optional[Mapping[str, Any]] = None) -> bool:
    """Does this tree's ROOT produce values in ``{0, 1, NaN}``?

    Derived from the manifest's ``yields`` declaration, iteratively:

    ==============  ====================================================
    ``num``         ``bool`` iff the literal is 0 or 1, else ``num``
    ``series``      the declared scalar's ``yields``; a bar series is
                    undeclared and reads as ``num``
    ``op``/``call`` the declared ``yields``; ``passthrough`` resolves to
                    ``bool`` iff every ARM is ``bool``
    ==============  ====================================================

    ⭐ THE ARMS OF A ``passthrough`` ARE EVERY ARGUMENT AFTER THE FIRST, and that
    is read off the interpreter rather than guessed: ``ast_interpret._ternary``
    takes ``(t, a, b)`` — the selector first, the two results after it. So the
    kind of ``x ? a : b`` is the join of ``a`` and ``b``. ⛔ NOT "either arm",
    which would admit ``(a > b) ? 1 : close`` — a tree that hands back a price on
    one branch — as a screen.

    ⛔ ITERATIVE, NEVER RECURSIVE, and it reuses ``ast_interpret._flatten`` rather
    than walking the tree a second way. The escape corpus's ``too_many_nodes``
    case is 8,001 nodes deep against a ~1,000 recursion limit, and a classifier
    that crashed on a deep tree would be a refusal nobody could catch. Reusing the
    shipped flattener also means this module and the interpreter can never
    disagree about what the tree's nodes ARE.

    :raises ast_interpret.TableRefusal: the tree is not made of canonical nodes.
        Left to propagate on purpose — ``assert_scannable`` turns it into a
        ``[gate:tree]`` refusal, and a caller asking this question directly about
        a malformed tree has a bug worth seeing.
    """
    kinds: dict[int, str] = {}
    for node in ast_interpret._flatten(ast):
        node_type = node["type"]
        if node_type == _NUM:
            kinds[id(node)] = _leaf_kind(node.get("value"))
            continue
        if node_type == _SERIES:
            # ⚠️ SCOPED TO THE SECTIONS A LEAF MAY NAME. Unscoped, a leaf named
            # after a bool-yielding FUNCTION borrowed that function's declaration
            # — see `_LEAF_SECTIONS`. A bar field and an instance input both miss
            # every section here and settle to the numeric default, which is the
            # honest answer for both and is what this arm did before.
            kinds[id(node)] = _settle(
                _declared_kind(node.get("name"), table, _LEAF_SECTIONS))
            continue
        if node_type == _OFFSET:
            # ⭐ AN OFFSET CHANGES *WHEN*, NEVER *WHAT*. `(close > open)[1]` is
            # still the yes/no it was a bar ago, so the kind passes through from
            # the child. Falling to the lookup below would ask the table for a
            # declaration of the name `None`, settle to `num`, and quietly refuse
            # every offset condition at the `yields` gate — a screen that says
            # "this formula is not a filter" about a formula that plainly is.
            children = list(node.get("args") or [])
            kinds[id(node)] = (kinds[id(children[0])] if len(children) == 1
                               else _KIND_NUM)
            continue
        if node_type in (_TF, _SYM, _TF_LIVE):
            # ⭐ NEITHER CHANGES *WHAT*. A timeframe changes WHICH PERIOD and a
            # symbol changes WHICH INSTRUMENT, so both pass the kind through from
            # the child exactly as an offset's does: `sym('SPY', close > open)` is
            # still a yes/no, and `sym('SPY', close)` is still a price.
            # `tf(close > open, 'W')` is the same yes/no, read on the last CLOSED
            # week — a perfectly good screen.
            # ⛔⛔ AND WITHOUT THIS ARM IT FELL TO THE LOOKUP BELOW, which is the
            # trap the comment directly above already spells out: a `tf` node has
            # no `name` (its canonical keys are type/value/args), so the table
            # would be asked to declare `None`, settle to `num`, and the `yields`
            # gate would tell a member *"this formula is not a filter"* about a
            # weekly condition that plainly is. The node type was added to the
            # engine and this classifier was not taught it; the branch census
            # rail is what said so, not a bug report from a member.
            children = list(node.get("args") or [])
            kinds[id(node)] = (kinds[id(children[0])] if len(children) == 1
                               else _KIND_NUM)
            continue
        declared = _declared_kind(node.get("name"), table)
        if declared == _KIND_PASSTHROUGH:
            arms = list(node.get("args") or [])[1:]
            kinds[id(node)] = (
                _KIND_BOOL
                if arms and all(kinds[id(a)] == _KIND_BOOL for a in arms)
                else _KIND_NUM
            )
            continue
        kinds[id(node)] = _settle(declared)
    return kinds[id(ast)] == _KIND_BOOL


#: The manifest key holding role name -> the ``yields`` kind an argument in that
#: role must settle to. STRUCTURE, not vocabulary: it names a SECTION of the
#: table, never an entry inside one, so the anti-copy scan is untouched.
_ARG_ROLE_KINDS_KEY = "_functions_arg_role_kinds"

#: The per-function key naming what each argument position IS.
_ARG_ROLES_KEY = "argRoles"


def arg_role_kinds(table: Optional[Mapping[str, Any]] = None) -> Mapping[str, str]:
    """The roles the table makes REQUIREMENTS, and the kind each demands.

    ⭐ READ OFF THE MANIFEST, NEVER TYPED. ``_``-prefixed keys inside the section
    are its own notes — the same split ``_functions_excluded`` carries — so a
    second role declared there is enforced the day it lands.
    """
    m = table if table is not None else ast_table.TABLE
    section = m.get(_ARG_ROLE_KINDS_KEY) or {}
    return {role: kind for role, kind in section.items()
            if not role.startswith("_") and isinstance(kind, str)}


def arg_role_violation(node: Any, spec: Any,
                       table: Optional[Mapping[str, Any]] = None) -> Optional[dict]:
    """The first argument whose ROLE demands a kind its tree does not settle to.

    Returns ``{"index", "role", "want", "got"}`` or ``None``. The CALLER refuses
    — this module answers the question and names no guard, because the guard
    vocabulary belongs to the walker that owns the refusal table.

    ⭐⭐ THE ROLE THAT IS A REQUIREMENT, MADE ENFORCEABLE — because ``argRoles``
    on its own is DOCUMENTATION, and two entries landed depending on it as
    though it were not. ``barssince(cond, n)`` and ``valuewhen(cond, src, n)``
    each declare ``args[0]`` as a plain ``series`` and ``argRoles[0]`` as a
    condition. Nothing read the second half, so ``barssince(close, 100)``
    resolved and answered **0.0 on every bar** — a price is never zero, so
    *"bars since it was last true"* is zero forever — while
    ``valuewhen(close, high, 5)`` handed back its source column on every bar.
    Plausible on every bar and wrong on every bar, saveable, scannable and
    alertable in that state.

    ⛔ THE KIND COMES FROM ``is_boolean_tree`` ABOVE, NEVER A SECOND WALK. A
    ``node["name"] in _COMPARISONS`` test would be the hand-list this module's
    own header exists to retire, arriving one function later.

    ⛔ AND IT REPORTS RATHER THAN COERCING. ``!= 0`` over a price column would
    make every non-zero bar "true", which is the confident-wrong-number shape
    rather than a cure for it.
    """
    wanted = arg_role_kinds(table)
    if not wanted:
        return None
    roles = spec.get(_ARG_ROLES_KEY) if hasattr(spec, "get") else None
    if not isinstance(roles, (list, tuple)):
        return None
    args = node.get("args") if hasattr(node, "get") else None
    if not isinstance(args, (list, tuple)):
        return None
    for i, role in enumerate(roles):
        want = wanted.get(role)
        if want is None or i >= len(args):
            continue
        # ⭐ THE RESOLVER ANSWERS A BOOLEAN AND THE MANIFEST NAMES A KIND. One
        # mapping, through this module's own spelling of the kinds — which is
        # pinned to `ast_table.yields_of`'s vocabulary by its own test — so the
        # comparison can never become a third spelling of the same word.
        got = _KIND_BOOL if is_boolean_tree(args[i], table) else _KIND_NUM
        if got != want:
            return {"index": i, "role": role, "want": want, "got": got}
    return None


def def_hash(definition: Any) -> str:
    """A scan's identity: ``compute.fn``, which IS ``astHash`` over its tree.

    ⭐ ONE HASH, ONE HANDLE, ONE EVENT. ``defSchema.validateAstCompute`` requires
    an ``ast`` definition's ``compute.fn`` to equal its own ``astHash`` — *"the
    tree is the implementation, so there is no third thing for the handle to
    name; naming it by its own hash makes 'the handle changed' and 'the maths
    changed' one event rather than two that can disagree."* A results table keyed
    on it therefore cannot serve one formula's answers under another's name.

    ⛔ AND THE KEY IS NOT ``(user_id, def_id, version)``. Two members who type the
    same formula have the same maths, share one result set, and cost the pod one
    sweep — which is also the property that makes the store member-INDEPENDENT,
    the thing E-6 exists to obtain.

    The stored handle is CHECKED rather than trusted: a blob that arrived over a
    wire carrying a stale ``fn`` would otherwise file its answers under the
    previous formula's name, silently.
    """
    compute = _compute_of(definition)
    tree = compute.get("ast")
    try:
        computed = user_definitions.ast_hash(tree)
    except ValueError as exc:
        raise ScanRefused("tree", str(exc)) from exc
    stored = compute.get("fn")
    if isinstance(stored, str) and stored and stored != computed:
        raise ScanRefused(
            "hash",
            f"compute.fn is {stored!r} but the tree hashes to {computed!r}. An "
            "'ast' definition's compute handle IS its astHash; a stored handle "
            "that disagrees would file this formula's answers under another "
            "formula's name.",
        )
    return computed


def _compute_of(definition: Any) -> Mapping[str, Any]:
    if not isinstance(definition, dict):
        raise ScanRefused(
            "kind", f"a definition is an object; got {type(definition).__name__}")
    compute = definition.get("compute")
    if not isinstance(compute, dict):
        raise ScanRefused(
            "kind", f"the definition carries no compute object; got {compute!r}")
    return compute


def assert_scannable(definition: Any) -> dict:
    """Refuse a definition that cannot be run as a screen, or describe it.

    Returns ``{"def_hash", "yields", "scalars"}`` — the handle the results are
    filed under, the settled result kind, and the table-declared scalars the tree
    reads (so the sweep knows which snapshot columns it must carry, without
    deriving that a second way).

    ⛔ EVERY REFUSAL NAMES ITS GATE and the gates are closed (``GATES``):

    ``kind``    the definition is not on the ``ast`` lane. A native or server
                definition names maths this lane cannot walk.
    ``tree``    ``compute.ast`` is not a canonical tree — four node types with
                exact key sets — or it is canonical and does not RESOLVE: an
                undeclared name, the wrong arity, a window that is not a literal,
                or an argument outside the domain its own entry declares
                (``resolve:domain``). Both are properties of the tree alone, and
                the resolve pass is where a whole-formula defect is decided.
    ``hash``    a stored ``compute.fn`` disagrees with the tree it sits beside.
    ``yields``  the tree returns a NUMBER. ``<tree> != 0`` over a price column is
                true for every symbol trading above zero, so this is the gate
                that stops a screen from silently returning the universe.
    """
    compute = _compute_of(definition)
    if compute.get("kind") != AST_KIND:
        raise ScanRefused(
            "kind",
            f"compute.kind is {compute.get('kind')!r}; a scan is a tree this lane "
            f"can walk, so only {AST_KIND!r} is scannable.",
        )
    tree = compute.get("ast")
    try:
        user_definitions.assert_canonical(tree)
    except ValueError as exc:
        raise ScanRefused("tree", str(exc)) from exc

    handle = def_hash(definition)

    try:
        # ⛔⛔ THE RESOLVE PASS, RUN ONCE, AT THE DOOR. `is_boolean_tree` below
        # classifies the tree's KIND and resolves nothing — it reads `yields` off
        # the manifest and defaults an unknown name to `num` — so until X41 a
        # tree could pass this gate and still be un-runnable. The measured case
        # was `close > macd(close, 26, 12)`: `fast > slow` is a DECLARED argument
        # domain (`closedTable.json::_functions_domain`), both walkers answer an
        # all-NaN column for it, and the comparison turned that hole into `0.0` on
        # every bar — a screen this function called `bool`, that saved, and that
        # reported every symbol ANSWERED while matching nothing.
        #
        # ⭐ `max_lookback` IS THE PASS, NOT A NEW ONE. It resolves every call on
        # its way to a number and is already what `scan_evaluator` runs before its
        # loop *"once, loudly — rather than 3,742 times inside"*. Running it HERE
        # moves the refusal from the worker to the request, so a member is told at
        # the door instead of watching a job come back empty.
        ast_interpret.max_lookback(tree)
        boolean = is_boolean_tree(tree)
        named = ast_interpret.symbols_named(tree)
    except ast_interpret.TableRefusal as exc:
        raise ScanRefused("tree", str(exc)) from exc

    # ⭐⭐ A SWEEP MAY ONLY READ A DECLARED BENCHMARK, AND THE REFUSAL SAYS WHICH.
    #
    # ⛔ THIS GATE DELIBERATELY REFUSES SOMETHING `interpret` ACCEPTS, AND THAT IS
    # NOT THE TWO-AUTHORITIES DEFECT. The two answer different questions: `interpret`
    # asks *can this be evaluated?* and the chart lane rightly serves any symbol it
    # can fetch; this asks *can this be SWEPT over the whole universe?*, where an
    # arbitrary ticker means a whole extra history held for every one of thousands
    # of rows. `closedTable.json::_benchmarks` records the distinction so nobody
    # later "fixes" the two into agreement — which would either cripple the chart
    # lane or let any instrument into the nightly sweep.
    #
    # ⭐ THE LIST IS READ, NOT TYPED, and it is the SAME list the sweep loads
    # (`ast_table.benchmarks` → the manifest section). A second roster here would
    # be the copy that goes stale, and a refusal quoting a stale roster tells a
    # member to use a benchmark that no longer works.
    if named:
        allowed = ast_table.benchmarks()
        unknown = [t for t in named if t not in allowed]
        if unknown:
            raise ScanRefused(
                "symbol",
                "a scan can read %s, and not %s. A saved scan is run against the "
                "whole universe, so the instruments it compares against are a "
                "declared set the sweep loads once — charting against any symbol "
                "still works on the Formula tab."
                % (", ".join(sorted(allowed)), ", ".join(sorted(unknown))),
            )
    if not boolean:
        raise ScanRefused(
            "yields",
            "this tree returns a number, not a 0/1 column. A scan is "
            "`<tree> != 0` on the last confirmed bar, so a real-valued tree "
            "matches every symbol whose value is not exactly zero.",
        )
    return {
        "def_hash": handle,
        "yields": _KIND_BOOL,
        "scalars": sorted(ast_freshness.scalars_in(tree)),
    }
