"""The Python lane's tree walker — the same tree, the same numbers, 1e-9.

⭐ ONE PARSER, TWO WALKERS. ``app/src/components/chart/engine/ast/parse.js``
parses; **this lane never parses**. The canonical AST is the persisted artifact
and this module walks a tree it did not build. A parser here would be a second
grammar and the drift would be silent (decision D-A1).

⛔ FOUR NODE TYPES, AND AN UNKNOWN ONE RAISES. ``canonicalise`` produces
num/series/op/call; a fifth arriving here means the two lanes disagree about the
wire shape, and a walker that guessed would be running a tree nobody authored.

⛔ NAME RESOLUTION IS AN EXPLICIT MEMBERSHIP TEST ON A PLAIN DICT — never
``getattr``, never ``eval``, never ``globals()``. The JS lane's equivalent is
``Object.prototype.hasOwnProperty.call`` on an ``Object.create(null)`` object and
the two are the same decision written twice; the escape corpus drives both.
``getattr(scope, name)`` on a dict answers ``keys``, ``items``, ``__class__`` and
``__init__`` — Python's ``Object.prototype``, reached through a different door.

⚠️ NaN IS ``None`` AT THE BOUNDARY AND ``float('nan')`` INSIDE, AND THAT SPLIT IS
DELIBERATE. Every returned list is ``len(bars)`` long with ``None`` where the
column is not computable, matching ``indicator_compute``'s alignment rule and
spec §4's wire format. INSIDE the walker the pad is an IEEE NaN, because IEEE NaN
arithmetic is bit-identical to the JS lane's — ``nan + 1`` is ``nan`` and
``nan > 5`` is ``False`` in both languages, for the same reason, by the same
standard. Carrying ``None`` through the arithmetic would mean re-deriving each of
those rules by hand, and every hand-derived rule is a place the two lanes can
disagree.

⚠️ PLAIN LOOPS, NOT NUMPY. ``indicator_compute.py`` carries the same rule and
states why: numpy changes summation order, and a 1e-9 equality across two
languages only holds if the accumulations happen in the same order with the same
associativity. Every reduction below is written in the same order as its JS twin.

⛔ THE ``{0, 1, NaN}`` DOMAIN IS ASSERTED, NOT INHERITED. The JS lane's event
columns live in a ``Float64Array``, which coerces ``true`` to ``1`` — so a JS
implementation that returned booleans is a semantic no-op there (Task 4 measured
exactly that, its M6a). A Python list has no such container, so a ``True`` would
ride all the way to the wire and JSON-encode as ``true``. Every value this module
produces is therefore built as a ``float`` on purpose, and ``_number`` REFUSES a
``bool`` loudly rather than coercing it — because ``True == 1.0`` and
``True in (0.0, 1.0)`` are both true in Python, so no value-level check can catch
one.
"""
from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from api.services.ast_table import TABLE, FUNCTIONS_SECTION, OPERATORS_SECTION, SERIES_SECTION

MaybeNum = Optional[float]

NAN = float("nan")
INF = float("inf")

#: The canonical persisted node vocabulary — the same four
#: ``app/src/components/chart/engine/ast/parse.js`` exports as ``NODE_TYPES``.
#:
#: ⚠️ NOT HAND-TRUSTED. ``test_ast_interpret.py`` derives the same four from the
#: union of every ``type`` in the committed corpus and asserts the equality, so a
#: fifth type arriving on the wire cannot be absorbed here quietly.
NODE_TYPES = ("num", "series", "op", "call")


# --------------------------------------------------------------------------- #
# refusals
# --------------------------------------------------------------------------- #

class TableRefusal(Exception):
    """The closed table saying no, at INTERPRET time. Carries the guard that fired.

    ⛔ THE ONLY THING THAT COUNTS AS A REFUSAL. An ``AttributeError``, a
    ``TypeError`` or a ``RecursionError`` is the LANGUAGE declining, incidentally,
    for this one input — a different input reaches a value where that one did not.
    ``tools/ast_conformance.py`` recognises a refusal BY TYPE and its docstring
    states the contract; this is the Python half of it.
    """

    def __init__(self, guard: str, message: str) -> None:
        super().__init__(message)
        self.guard = guard


#: guard → the sentence it always refuses with.
#:
#: ⛔ PAIRWISE DISJOINT, AND THE SAME SIX SENTENCES ``interpret.js`` USES. Two
#: gates sharing a phrase let a ``raises(match=…)`` pass with the safety deleted,
#: and that has happened in this repo (Phase C Task 9's M1). The cross-lane
#: equality of these strings is asserted in ``test_ast_interpret.py``: a lane that
#: refuses for a different stated reason is a lane whose chip tooltip tells the
#: user a different story about the same formula.
REFUSALS: Mapping[str, str] = {
    "resolve:name": "unknown name",
    "resolve:function": "unknown function",
    "resolve:arity": "wrong number of arguments",
    "resolve:window": "a window must be a whole-number literal",
    "interpret:node": "not a canonical node",
    "interpret:operator": "unknown operator",
}


def _refuse(guard: str, detail: str) -> Any:
    raise TableRefusal(guard, f"{REFUSALS[guard]} {detail}")


def _declared(obj: Mapping[str, Any]) -> str:
    return ", ".join(obj)


# --------------------------------------------------------------------------- #
# numbers and columns
# --------------------------------------------------------------------------- #

def _is_number(v: Any) -> bool:
    """A real number, and a ``bool`` IS NOT ONE.

    ⛔ ``isinstance(True, int)`` is ``True`` and ``True == 1.0`` is ``True``, so
    every value-level check in this file would accept a boolean silently. The JS
    lane is protected from the same mistake by its ``Float64Array``; this lane has
    to say it.
    """
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _number(v: Any) -> float:
    """A finite float, or NaN. Raises on a ``bool`` — never coerces one.

    A ``TypeError`` here is NOT a table refusal and must never be dressed up as
    one: it can only fire if this module produced a value outside its own domain,
    which is a defect in the walker rather than in the formula the user wrote.
    """
    if isinstance(v, bool):
        raise TypeError(
            "a bool reached a numeric column. This lane's domain is float and "
            "None; `True == 1.0` is true in Python, so a bool that survived here "
            "would JSON-encode as `true` and diverge from the JS lane's `1`."
        )
    if not _is_number(v):
        return NAN
    f = float(v)
    return f if math.isfinite(f) else NAN


def _nan_col(n: int) -> List[float]:
    return [NAN] * n


def _to_column(value: Any, length: int) -> List[float]:
    """A value the walker produced → an input-length, NaN-padded column.

    ⭐ ``len(bars)``, ALWAYS, AND NEVER THE VALUE'S OWN LENGTH. ``computeFor``
    returns one column per key aligned to the bar count (spec §4). A column that
    is SHORTER silently shifts every index — a scalar formula (``20``) is the case
    that proves it, because its value has no length at all.

    ⚠️ ±Infinity NORMALISES TO NaN, the same rule ``nativeRegistry::toColumn``
    uses. It is load-bearing across the lanes: JS answers ``Infinity`` for
    ``1 / 0`` while Python's ``/`` RAISES, so ``_binary_div`` reproduces the IEEE
    answer and this collapses it to the pad both lanes draw as a hole.
    """
    col = _nan_col(length)
    if isinstance(value, bool):
        _number(value)                       # raises, with the reason
    if _is_number(value):
        v = _number(value)
        if math.isfinite(v):
            for i in range(length):
                col[i] = v
        return col
    if not isinstance(value, (list, tuple)):
        return col
    n = min(len(value), length)
    for i in range(n):
        col[i] = _number(value[i])
    return col


def _is_column(v: Any) -> bool:
    return isinstance(v, list)


def _isnan(x: float) -> bool:
    return isinstance(x, float) and math.isnan(x)


# --------------------------------------------------------------------------- #
# the table's functions
# --------------------------------------------------------------------------- #
#
# ⚠️ EVERY IMPLEMENTATION BELOW RECEIVES A LIST OF FLOATS FOR A `series` ARGUMENT
# AND A PLAIN int FOR AN `int` ONE. The coercion happens once, in the walker,
# driven by `TABLE['functions'][name]['args']` — so no implementation carries its
# own idea of what its arguments are, and a table edit reaches all eleven at once.
#
# ⭐ NaN IS A WARMUP, NOT A ZERO, AND IT PROPAGATES. A fabricated 0 during a
# 199-bar warmup is a number a user could arm an alert on.

def _rolling(series: Sequence[float], n: int,
             reduce: Callable[[Sequence[float], int, int], float]) -> List[float]:
    """Rolling reduction over a full window. NaN before bar ``n-1``."""
    out = _nan_col(len(series))
    for i in range(n - 1, len(series)):
        out[i] = reduce(series, i - n + 1, i)
    return out


def _window_mean(series: Sequence[float], lo: int, hi: int) -> float:
    total = 0.0
    for i in range(lo, hi + 1):
        total += series[i]
    return total / (hi - lo + 1)


def _window_extreme(series: Sequence[float], lo: int, hi: int,
                    better: Callable[[float, float], bool]) -> float:
    best = series[lo]
    for i in range(lo, hi + 1):
        v = series[i]
        if math.isnan(v):
            return NAN                        # explicit: NaN does not lose a comparison
        if better(v, best):
            best = v
    return best


def _window_stdev(series: Sequence[float], lo: int, hi: int) -> float:
    """POPULATION standard deviation — divisor ``n``, not ``n - 1``.

    ⚠️ NAMED OUT LOUD BECAUSE THE CORPUS SAYS IT IS INVISIBLE OTHERWISE: a
    population/sample disagreement between the lanes has the same tree, the same
    column length and the same NaN pad, and shows up only in the number. This
    matches ``indicators.js::computeBB`` and ``interpret.js::windowStdev``
    (``sqrt(sqSum / period)``), so a user's ``sma(close,20) + 2*stdev(close,20)``
    draws the same band the native Bollinger definition draws.
    """
    avg = _window_mean(series, lo, hi)
    sq = 0.0
    for i in range(lo, hi + 1):
        sq += (series[i] - avg) ** 2
    return math.sqrt(sq / (hi - lo + 1))


def _ema_col(series: Sequence[float], n: int) -> List[float]:
    """EMA seeded with the SMA of the first full window, ``k = 2 / (n + 1)``.

    ⚠️ THE SEED IS A DECISION AND IT MATCHES BOTH THE NATIVE LANE AND
    ``interpret.js::emaCol``. A NaN in the input RESTARTS the seed — the warmup of
    a composed series (``ema(sma(close,20), 9)``) is exactly that case, and an EMA
    that carried its state across a hole would be reporting an average of bars it
    never saw.
    """
    out = _nan_col(len(series))
    k = 2 / (n + 1)
    prev = NAN
    count = 0
    total = 0.0
    for i in range(len(series)):
        v = series[i]
        if not math.isfinite(v):
            prev, count, total = NAN, 0, 0.0
            continue
        if math.isnan(prev):
            total += v
            count += 1
            if count == n:
                prev = total / n
                out[i] = prev
        else:
            prev = prev * (1 - k) + v * k
            out[i] = prev
    return out


def _elementwise2(a: Sequence[float], b: Sequence[float],
                  f: Callable[[float, float], float]) -> List[float]:
    out = _nan_col(len(a))
    for i in range(len(a)):
        out[i] = f(a[i], b[i])
    return out


def _crossing(a: Sequence[float], b: Sequence[float],
              fired: Callable[[float, float, float, float], bool]) -> List[float]:
    """``{0.0, 1.0, NaN}`` AND NOTHING ELSE — spec §3.1's event domain.

    ⛔ NOT ``True``/``False``. ``nativeRegistry``'s ``validateEventColumns``
    already refuses a 0.5 at registration for a native; a formula must not be the
    way in. And on THIS lane the type matters as much as the value: a Python
    ``True`` survives a list, survives ``== 1.0``, survives ``in (0.0, 1.0)`` and
    JSON-encodes as ``true``.
    """
    out = _nan_col(len(a))
    for i in range(1, len(a)):
        an, bn, ap, bp = a[i], b[i], a[i - 1], b[i - 1]
        if math.isnan(an) or math.isnan(bn) or math.isnan(ap) or math.isnan(bp):
            continue
        out[i] = 1.0 if fired(an, bn, ap, bp) else 0.0
    return out


def _fn_change(series: Sequence[float]) -> List[float]:
    out = _nan_col(len(series))
    for i in range(1, len(series)):
        out[i] = series[i] - series[i - 1]
    return out


def _fn_abs(series: Sequence[float]) -> List[float]:
    out = _nan_col(len(series))
    for i in range(len(series)):
        out[i] = abs(series[i])
    return out


def _guarded_min(x: float, y: float) -> float:
    return NAN if (math.isnan(x) or math.isnan(y)) else min(x, y)


def _guarded_max(x: float, y: float) -> float:
    return NAN if (math.isnan(x) or math.isnan(y)) else max(x, y)


#: name → implementation. THE KEY SET IS ``TABLE['functions']``'s, both directions.
#:
#: ⛔ AN IMPLEMENTED-BUT-UNDECLARED KEY HERE IS A CALLABLE OUTSIDE THE CLOSED
#: TABLE, which is the one thing this phase exists to make impossible; a
#: DECLARED-BUT-UNIMPLEMENTED one is a formula the builder offers and this lane
#: cannot evaluate — which is the exact shape of the bug B5 fixed, where an alert
#: naming a JS-only indicator could be STORED and could never FIRE.
FN: Dict[str, Callable[..., List[float]]] = {
    "sma": lambda series, n: _rolling(series, n, _window_mean),
    "ema": lambda series, n: _ema_col(series, n),
    "highest": lambda series, n: _rolling(
        series, n, lambda s, lo, hi: _window_extreme(s, lo, hi, lambda v, b: v > b)),
    "lowest": lambda series, n: _rolling(
        series, n, lambda s, lo, hi: _window_extreme(s, lo, hi, lambda v, b: v < b)),
    "stdev": lambda series, n: _rolling(series, n, _window_stdev),
    "change": _fn_change,
    "abs": _fn_abs,
    # ⚠️ NaN PROPAGATES, WRITTEN OUT RATHER THAN INHERITED. JS's `Math.min(NaN, x)`
    # is NaN and Python's bare `min` returns whichever it meets FIRST — a real
    # cross-lane divergence the corpus names explicitly. Spelling the rule kills it
    # in both lanes instead of relying on one language's luck.
    "min": lambda a, b: _elementwise2(a, b, _guarded_min),
    "max": lambda a, b: _elementwise2(a, b, _guarded_max),
    "crossOver": lambda a, b: _crossing(a, b, lambda an, bn, ap, bp: an > bn and ap <= bp),
    "crossUnder": lambda a, b: _crossing(a, b, lambda an, bn, ap, bp: an < bn and ap >= bp),
}


# --------------------------------------------------------------------------- #
# the operators
# --------------------------------------------------------------------------- #
#
# ⭐⭐ THE BOOLEAN DECISION, IMPLEMENTED — AND IT IS DELIBERATELY UNLIKE BOTH
# LANGUAGES. `closedTable.json`'s `_booleans` key records it: there is NO boolean
# node type, because the manifest declares `!`, `&&`, `||` and `?:` over a table
# whose only literal is a NUMBER. A condition is therefore a 0/1 column BY
# CONSTRUCTION, and the parser's `true`/`false` already canonicalise to num 1/0.
#
# WHAT IT COSTS, STATED RATHER THAN DISCOVERED:
#   * `1 && 2` is **1**, not 2 (JS) and not 2 (Python). The value-returning forms
#     are deliberately NOT implemented — they would put a non-{0,1} value in a
#     column the alert grammar, the screener and `validateEventColumns` all read
#     as a signal.
#   * `0 || 5` is **1**, not 5.
#   * `!5` is **0** and `!0` is **1**; there is no `!!x` idiom to write because a
#     comparison is already 0/1.
#   * TRUTHINESS IS `x != 0`, not either language's.
#
# ⛔ NaN PROPAGATES THROUGH `&&`, `||`, `!` AND `?:` — AND THAT IS THE OPPOSITE OF
# BOTH LANGUAGES' DEFAULTS, WHICH ALREADY DISAGREE WITH EACH OTHER: `!NaN` is
# `true` in JS and `not nan` is `False` in Python. Matching either language would
# have guaranteed a divergence with the other. The `{0,1,NaN}` domain distinguishes
# "it did not happen" from "it is not computable yet", and a warmup that collapsed
# to 0 would be a signal the user can arm an alert on.
#
# ⛔ A COMPARISON AGAINST NaN IS 0, NOT NaN. That is the other half of the same
# decision and it is the one place JS and Python agree by luck (`NaN > x` is false
# in both), so it is pinned rather than assumed.

def _cmp(f: Callable[[float, float], bool]) -> Callable[[float, float], float]:
    return lambda a, b: 0.0 if (_isnan(a) or _isnan(b)) else (1.0 if f(a, b) else 0.0)


def _logical(f: Callable[[bool, bool], bool]) -> Callable[[float, float], float]:
    return lambda a, b: (NAN if (_isnan(a) or _isnan(b))
                         else (1.0 if f(a != 0, b != 0) else 0.0))


def _binary_div(a: float, b: float) -> float:
    """IEEE division, because JS's ``/`` IS IEEE division and Python's RAISES.

    ⛔ THE SHARPEST CROSS-LANE DIVERGENCE IN THE WHOLE TABLE, and it is invisible
    in the shape: ``1 / 0`` is ``Infinity`` in JS and ``ZeroDivisionError`` in
    Python, ``0 / 0`` is ``NaN`` there and the same exception here. A lane that
    let the exception escape would turn one bar of a user's formula into a 500,
    and a lane that answered ``None`` for it would disagree with the other on the
    sign. So the IEEE answer is reproduced and ``_to_column`` collapses ±Infinity
    to the pad — exactly what the JS lane's ``Float64Array`` + ``Number.isFinite``
    boundary does.
    """
    if _isnan(a) or _isnan(b):
        return NAN
    if b == 0.0:
        if a == 0.0:
            return NAN
        return math.copysign(INF, a) * math.copysign(1.0, b)
    return a / b


_BINARY: Dict[str, Callable[[float, float], float]] = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": _binary_div,
    ">": _cmp(lambda a, b: a > b),
    "<": _cmp(lambda a, b: a < b),
    ">=": _cmp(lambda a, b: a >= b),
    "<=": _cmp(lambda a, b: a <= b),
    "==": _cmp(lambda a, b: a == b),
    "!=": _cmp(lambda a, b: a != b),
    "&&": _logical(lambda a, b: a and b),
    "||": _logical(lambda a, b: a or b),
}

_UNARY: Dict[str, Callable[[float], float]] = {
    "u-": lambda a: -a,
    "!": lambda a: NAN if _isnan(a) else (0.0 if a != 0 else 1.0),
}

_TERNARY_NAME = "?:"


def _ternary(t: float, a: float, b: float) -> float:
    return NAN if _isnan(t) else (a if t != 0 else b)


def operator_names() -> set:
    """Every operator this module implements. DERIVED from the three tables."""
    return set(_BINARY) | set(_UNARY) | {_TERNARY_NAME}


# --------------------------------------------------------------------------- #
# the static measurements Task 6's budgets threshold
# --------------------------------------------------------------------------- #

def _assert_node(node: Any) -> None:
    if not isinstance(node, dict):
        _refuse("interpret:node", f"got {node!r}")
    if node.get("type") not in NODE_TYPES:
        _refuse("interpret:node",
                f"unknown node type {node.get('type')!r} — legal types are "
                f"{', '.join(NODE_TYPES)}")


def _flatten(root: Any) -> List[dict]:
    """Every node of a canonical tree, DESCENDANTS BEFORE PARENTS, iteratively.

    ⛔ ITERATIVE ON PURPOSE, AND THIS IS THE WHOLE REASON THE MEASUREMENTS ARE
    SEPARATE FUNCTIONS. The escape corpus's ``too_many_nodes`` case is 8,001 nodes
    deep and Python's recursion limit is ~1,000. A recursive counter would die
    inside the guard rather than inside the thing being guarded — and a guard that
    crashes is not a refusal. ``parse.js`` made its forbidden-node scan iterative
    for exactly this reason, and ``interpret.js::flatten`` is the same shape.
    """
    order: List[dict] = []
    stack: List[Any] = [root]
    while stack:
        node = stack.pop()
        _assert_node(node)
        order.append(node)
        if node["type"] in ("op", "call"):
            args = node.get("args")
            if not isinstance(args, list):
                _refuse("interpret:node",
                        f"a {node['type']} node carries an `args` array; got {args!r}")
            for arg in args:
                stack.append(arg)
    order.reverse()          # a reversed pre-order puts every child before its parent
    return order


def _fn_spec(name: Any) -> Mapping[str, Any]:
    functions = TABLE[FUNCTIONS_SECTION]
    if not isinstance(name, str) or name not in functions:
        _refuse("resolve:function",
                f"{name!r} — this table declares {_declared(functions)}")
    return functions[name]


def _assert_arity(node: dict, spec: Mapping[str, Any]) -> None:
    if len(node["args"]) != len(spec["args"]):
        _refuse("resolve:arity",
                f"— {node.get('name')} expects {len(spec['args'])} arguments, "
                f"got {len(node['args'])}")


def _window_literal(node: dict, index: int) -> int:
    """An ``int`` argument's value, which MUST be a ``num`` literal.

    ⭐ NOT A CONVENIENCE — IT IS WHAT MAKES ``max_lookback`` A TREE SUM. The
    manifest declares every function's lookback as a constant or as a NAMED
    ARGUMENT (``arg1``), and ``max_lookback(ast)`` takes no bars and no inputs. A
    window that is an input name, or a computed column, is not decidable
    statically — and the moment lookback stops being decidable statically, the
    repaint linter stops being a tree sum and becomes a dataflow analysis, which
    is the exact trade ``closedTable.json::_no_offset`` refuses on the owner's
    behalf.
    """
    args = node["args"]
    arg = args[index] if index < len(args) else None
    ok = (isinstance(arg, dict) and arg.get("type") == "num"
          and _is_number(arg.get("value"))
          and float(arg["value"]).is_integer() and arg["value"] >= 1)
    if not ok:
        shown = arg.get("value") if isinstance(arg, dict) and arg.get("type") == "num" else arg
        _refuse("resolve:window",
                f"— {node.get('name')} argument {index} must be a whole number of "
                f"at least 1, got {shown!r}")
    return int(arg["value"])


def _own_lookback(node: dict, spec: Mapping[str, Any]) -> int:
    """The declared lookback of ONE call node: a constant, or a named argument."""
    lb = spec.get("lookback")
    if _is_number(lb):
        return int(lb)
    text = str(lb)
    if not (text.startswith("arg") and text[3:].isdigit()):
        _refuse("interpret:node",
                f"{node.get('name')!r} declares lookback {lb!r}, which is neither a "
                "constant nor an argument")
    return _window_literal(node, int(text[3:]))


def max_lookback(ast: Any) -> int:
    """How many bars of history the tree needs. A TREE SUM, never a dataflow pass.

    ⭐ THE SUM IS ALONG THE PATH, WHICH IS THE CASE A PER-ARGUMENT CHECK MISSES.
    ``sma(sma(close, 5000), 5000)`` needs 10,000 bars and neither 5,000 alone
    exceeds anything — ``escapes.json::nested_lookback`` exists for precisely
    that, and nothing else in that corpus catches it.

    ⚠️ THIS IS A MEASUREMENT, NOT A GUARD. Refusing a tree that asks for too much
    needs a DECLARED budget, and ``compute.budget`` is not declared yet.
    """
    order = _flatten(ast)
    seen: Dict[int, int] = {}
    for node in order:
        kind = node["type"]
        if kind in ("num", "series"):
            seen[id(node)] = 0
            continue
        if kind == "op":
            best = 0
            for arg in node["args"]:
                best = max(best, seen[id(arg)])
            seen[id(node)] = best
            continue
        spec = _fn_spec(node.get("name"))
        _assert_arity(node, spec)
        best = 0
        for i in range(len(node["args"])):
            if spec["args"][i] == "int":
                _window_literal(node, i)
                continue
            best = max(best, seen[id(node["args"][i])])
        seen[id(node)] = _own_lookback(node, spec) + best
    return seen[id(ast)]


def node_count(ast: Any) -> int:
    """How many nodes the tree has. The number ``budget:nodes`` will threshold.

    ⚠️ ITERATIVE, so it survives the 8,001-node tree that makes ``interpret``
    itself raise ``RecursionError``. That asymmetry is the point: a budget guard
    runs BEFORE the walker and must not need the walker to be safe first.
    """
    return len(_flatten(ast))


# --------------------------------------------------------------------------- #
# interpret
# --------------------------------------------------------------------------- #

def interpret(ast: Any, bars: List[dict],
              inputs: Optional[Mapping[str, Any]] = None) -> List[MaybeNum]:
    """Evaluate a canonical AST over bars → one aligned column of ``len(bars)``.

    :param ast:    a canonical tree (``parse.js::canonicalise``'s output)
    :param bars:   ``[{'t':…,'o':…,'h':…,'l':…,'c':…,'v':…}, …]``
    :param inputs: declared instance inputs, by name; finite numbers only
    :returns:      a list exactly ``len(bars)`` long, ``None`` where not computable

    Raises ``TableRefusal`` for anything the table refuses. Everything else — a
    ``RecursionError`` from a tree deep enough to exhaust the stack, say — is NOT
    a refusal and must never be caught and relabelled as one.
    """
    if not isinstance(bars, list):
        # A plain TypeError, NOT a TableRefusal: the table refuses what a USER
        # wrote, and the bars are the caller's. Conflating the two would let a
        # wiring bug read as "the formula was rejected" on a chip's tooltip.
        raise TypeError(f"interpret(ast, bars): bars must be a list, got {type(bars).__name__}")
    length = len(bars)

    # ⛔ A PLAIN DICT, AND EVERY LOOKUP IS `name in scope`. Python has no prototype
    # chain, so `in` on a dict is already exact — what it does NOT protect against
    # is `getattr(scope, name)`, which answers `keys`, `items`, `get`, `__class__`
    # and `__init__`. That is this lane's `Object.prototype`, and the escape probes
    # in `test_ast_interpret.py` are the cases that keep the door shut.
    scope: Dict[str, Any] = {}
    for name, spec in TABLE[SERIES_SECTION].items():
        field = spec["field"]
        col = _nan_col(length)
        for i in range(length):
            bar = bars[i]
            v = bar.get(field) if isinstance(bar, dict) else None
            # ⚠️ A missing field is NOT a price of zero; it is a bar we cannot
            # compute on.
            col[i] = _number(v) if _is_number(v) else NAN
        scope[name] = col

    for name, value in (inputs or {}).items():
        if name in scope or name in TABLE[FUNCTIONS_SECTION]:
            # A plain ValueError again: a definition whose input shadows `close`
            # is a WIRING defect, and silently letting it win would change what
            # every formula on that definition means.
            raise ValueError(
                f"interpret: the input {name!r} shadows a table name. The table "
                f"declares {_declared(TABLE[SERIES_SECTION])} and "
                f"{_declared(TABLE[FUNCTIONS_SECTION])}.")
        # Only finite numbers are seeded. An input that is a callable, an object
        # or a string is NOT a name this table can resolve, and leaving it out
        # makes referencing it a loud `resolve:name` refusal rather than a column
        # of None.
        if _is_number(value) and math.isfinite(float(value)):
            scope[name] = float(value)

    def lookup(name: Any) -> Any:
        # ⛔ `in`, NEVER `getattr`. See the module header.
        if not isinstance(name, str) or name not in scope:
            _refuse("resolve:name",
                    f"{name!r} — this table declares {', '.join(scope)}")
        return scope[name]

    def eval_node(n: Any) -> Any:
        # ⚠️ THE FINAL `else` BELOW *IS* THE GUARD, and it has to be REACHABLE for
        # the mutation that deletes it to be lethal. A validating pre-pass would
        # make it unreachable, which is how a guard becomes an equivalent mutant.
        if not isinstance(n, dict):
            return _refuse("interpret:node", f"got {n!r}")
        kind = n.get("type")
        if kind in ("op", "call") and not isinstance(n.get("args"), list):
            return _refuse("interpret:node",
                           f"a {kind} node carries an `args` array; got {n.get('args')!r}")
        if kind == "num":
            value = n.get("value")
            if not _is_number(value) or not math.isfinite(float(value)):
                _refuse("interpret:node",
                        f"a num node carries a finite number; got {value!r}")
            return float(value)
        if kind == "series":
            return lookup(n.get("name"))
        if kind == "op":
            return apply_op(n, [eval_node(a) for a in n["args"]])
        if kind == "call":
            spec = _fn_spec(n.get("name"))
            _assert_arity(n, spec)
            args: List[Any] = []
            for i in range(len(n["args"])):
                if spec["args"][i] == "int":
                    args.append(_window_literal(n, i))
                else:
                    args.append(_to_column(eval_node(n["args"][i]), length))
            return FN[n["name"]](*args)
        # ⛔ NOT A FALLTHROUGH TO SOMETHING PLAUSIBLE. Written as a refusal rather
        # than a `return NaN` because a tree nobody authored must refuse, not draw
        # a blank line that reads exactly like a warmup.
        return _refuse("interpret:node",
                       f"unknown node type {kind!r} — legal types are "
                       f"{', '.join(NODE_TYPES)}")

    def apply_op(node: dict, values: List[Any]) -> Any:
        name = node.get("name")
        if name == _TERNARY_NAME:
            if len(values) != 3:
                _refuse("resolve:arity",
                        f"— the ternary {_TERNARY_NAME} expects 3 arguments, got {len(values)}")
            return _lift3(values[0], values[1], values[2], _ternary, length)
        if isinstance(name, str) and name in _UNARY:
            if len(values) != 1:
                _refuse("resolve:arity", f"— {name} expects 1 arguments, got {len(values)}")
            return _lift1(values[0], _UNARY[name], length)
        if isinstance(name, str) and name in _BINARY:
            if len(values) != 2:
                _refuse("resolve:arity", f"— {name} expects 2 arguments, got {len(values)}")
            return _lift2(values[0], values[1], _BINARY[name], length)
        return _refuse("interpret:operator",
                       f"{name!r} — this table declares {_declared(TABLE[OPERATORS_SECTION])}")

    column = _to_column(eval_node(ast), length)
    # ⚠️ THE ONE CONVERSION, AT THE ONE BOUNDARY. NaN inside, `None` on the wire —
    # `indicator_compute`'s alignment rule and spec §4's format, and the same
    # mapping `tools/ast_conformance.py` applies to the JS lane's NaN.
    return [None if math.isnan(v) else v for v in column]


# --------------------------------------------------------------------------- #
# lifting scalars and columns
# --------------------------------------------------------------------------- #
#
# A scalar stays a scalar until it meets a column, so `20 * 2` is 40.0 (a number)
# and `close * 2` is a column. That keeps `sma(close, 10 * 2)` out of reach,
# deliberately — `_window_literal` refuses a computed window because `max_lookback`
# must stay decidable without evaluating anything.

def _lift1(a: Any, f: Callable[[float], float], length: int) -> Any:
    if not _is_column(a):
        return f(a)
    out = _nan_col(length)
    for i in range(length):
        out[i] = f(a[i])
    return out


def _lift2(a: Any, b: Any, f: Callable[[float, float], float], length: int) -> Any:
    if not _is_column(a) and not _is_column(b):
        return f(a, b)
    ca = a if _is_column(a) else None
    cb = b if _is_column(b) else None
    out = _nan_col(length)
    for i in range(length):
        out[i] = f(ca[i] if ca is not None else a, cb[i] if cb is not None else b)
    return out


def _lift3(t: Any, a: Any, b: Any,
           f: Callable[[float, float, float], float], length: int) -> Any:
    if not _is_column(t) and not _is_column(a) and not _is_column(b):
        return f(t, a, b)
    ct = t if _is_column(t) else None
    ca = a if _is_column(a) else None
    cb = b if _is_column(b) else None
    out = _nan_col(length)
    for i in range(length):
        out[i] = f(ct[i] if ct is not None else t,
                   ca[i] if ca is not None else a,
                   cb[i] if cb is not None else b)
    return out
