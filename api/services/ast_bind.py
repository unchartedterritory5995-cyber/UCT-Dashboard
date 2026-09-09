"""THE BIND-TIME FOLD — a window length is a plain whole number *for a binding*.

⭐⭐⭐ THAT IS NOT THE SAME CLAIM AS "FOR EVER", AND THE DIFFERENCE IS THE WHOLE
POINT. ``ast_interpret._window_literal`` requires a ``num`` node and is right to:
``max_lookback`` is a TREE SUM and the repaint linter depends on it staying one.
But ``Uncharted Volume`` line 233 writes::

    ta.sma(v, isWeekly ? lenWeekly : lenDaily)

and every operand of that is constant once a symbol and a timeframe are chosen —
``timeframe.isweekly`` is the CHART's timeframe, the two lengths are ``input.*``
values. So the length IS a whole number at the only moment anything is evaluated.
Without this pass it refuses ``resolve:window``, which reads as a missing
capability and is really a missing PASS.

────────────────────────────────────────────────────────────────────────────────
WHY IT IS ITS OWN MODULE
────────────────────────────────────────────────────────────────────────────────
⛔ IT REWRITES THE TREE; IT DOES NOT TEACH THE WINDOW CHECK A NEW TRICK. Fold
first, and ``_window_literal`` then sees the literal it has always required,
byte-for-byte unchanged. Every function that takes a length benefits at once --
``sma``, ``ema``, ``rma``, ``highest``, ``lowest``, ``stdev``, ``atr``, ``rsi``
and the rest -- with no per-function work, and there is ONE place to rail. A
branch inside the window check would have had to be repeated for every future
length-taking entry and would have put the fold's rules where nobody looks for
them. Owner ruling, 2026-09-09.

⛔⛔ AND THE BUDGET IS PRICED ON THE FOLDED TREE, NEVER ON A GUESS. `fold_bound`
runs BEFORE `max_lookback` / `check_budget`, so the warm-up cost of a bound
length is the exact number this binding will use -- not a minimum, not a maximum,
not the wider of the two branches. A tree that cannot fold keeps its expression
and the window check refuses it, so the budget is never handed something it would
have to under-state. `lesson_a_declaration_that_under_states_a_window` is the one
direction a budget cannot use.

────────────────────────────────────────────────────────────────────────────────
WHAT FOLDS
────────────────────────────────────────────────────────────────────────────────
Literals; ``input.*`` values (constant per DEFINITION, before any symbol exists);
the ``timeframe.*`` predicates the manifest names in ``_bind_time_constants``
(constant per BINDING); ternaries, arithmetic and comparisons over those; and a
small closed set of scalar functions.

⚠️ NOTHING THAT READS A BAR. A per-bar series, a history reference ``x[1]``, a
``var``, a ``request.*`` read or a drawing object stops the fold, and the refusal
NAMES that operand -- the difference between *"your length is not a number"* and
*"`close` is not a number"* is the difference between a member fixing it and a
member filing a bug.

⚠️ AND IT NEVER PARTIALLY FOLDS. An expression resolves wholly to a number or is
left exactly as it was.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

from api.services.ast_interpret import TABLE, _is_number, _refuse

#: The clock names that are constant for a binding, READ OFF THE MANIFEST.
#:
#: ⛔ NEVER A LIST TYPED HERE. ``dayofweek`` and ``isdaily`` sit in the same
#: manifest section and are opposite kinds -- one is about the bar, the other
#: about the chart -- and the only thing that says so is the sentence each entry
#: already carries. ``closedTable.json::_bind_time_constants`` declares the split
#: and a rail checks it against those sentences, so a clock entry added on either
#: side of the line classifies itself.
BIND_TIME_CLOCK = frozenset(
    (TABLE.get("_bind_time_constants") or {}).get("clock") or ())

#: Scalar functions the fold may evaluate.
#:
#: ⛔ A CLOSED SET, AND SMALL ON PURPOSE. Every name here has an unambiguous value
#: on a scalar. Anything else stops the fold and refuses BY NAME, which is a true
#: answer about this pass rather than a gap in it -- widening this set is a
#: decision with its own evidence, not a convenience.
_FOLD_CALLS = {
    "abs": lambda a: abs(a),
    "round": lambda a: float(round(a)),
    "max": lambda a, b: max(a, b),
    "min": lambda a, b: min(a, b),
    "sqrt": lambda a: math.sqrt(a) if a >= 0 else float("nan"),
    "pow": lambda a, b: float(a) ** float(b),
}

_BINARY = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": lambda a, b: (a / b) if b else float("nan"),
    ">": lambda a, b: float(a > b),
    "<": lambda a, b: float(a < b),
    ">=": lambda a, b: float(a >= b),
    "<=": lambda a, b: float(a <= b),
    "==": lambda a, b: float(a == b),
    "!=": lambda a, b: float(a != b),
    "&&": lambda a, b: float(bool(a) and bool(b)),
    "||": lambda a, b: float(bool(a) or bool(b)),
}


class NotFoldable(Exception):
    """Raised carrying the OPERAND that stopped the fold, never a generic message."""

    def __init__(self, what: str) -> None:
        self.what = what
        super().__init__(what)


def binding_constants(timeframe: Mapping[str, Any] = None,
                      inputs: Mapping[str, Any] = None,
                      symbol: Mapping[str, Any] = None) -> dict:
    """The ``name -> value`` map that ONE binding makes constant.

    ⛔ THE ASSEMBLY RULE LIVES HERE AND NOWHERE ELSE. A caller that built this
    dict itself would be a second authority over *what is constant for a
    binding*, and the pane and the sweep would drift on the one question the
    whole fold rests on.

    ⚠️ ``symbol`` IS ACCEPTED AND CONTRIBUTES NOTHING YET. ``syminfo.*`` is
    symbol-scoped, is resolved from OUR store rather than from the vendor, and
    only the fields the store can populate may ship. Until that lands a window
    mentioning ``syminfo.*`` does not fold and refuses naming the operand -- the
    correct answer, not a placeholder. The parameter exists so the call sites do
    not have to move when it does.
    """
    out: dict = {}
    for name in BIND_TIME_CLOCK:
        if timeframe is not None and name in timeframe:
            out[name] = 1.0 if timeframe[name] else 0.0
    for name, value in (inputs or {}).items():
        if _is_number(value):
            out[str(name)] = float(value)
    return out


def fold_scalar(node: Any, consts: Mapping[str, Any]) -> float:
    """One expression -> a number, or ``NotFoldable`` naming what stopped it."""
    if not isinstance(node, Mapping):
        raise NotFoldable(repr(node))
    kind = node.get("type")

    if kind == "num":
        return float(node.get("value"))

    if kind == "series":
        name = node.get("name")
        if name in consts:
            return float(consts[name])
        raise NotFoldable(str(name))

    if kind == "op":
        name = node.get("name")
        vals = [fold_scalar(a, consts) for a in (node.get("args") or [])]
        if name == "?:" and len(vals) == 3:
            # ⛔ BOTH ARMS ARE FOLDED BEFORE THE SELECTOR IS READ, and that is
            # deliberate: an unfoldable arm must stop the whole expression even
            # when this binding would not have taken it. Otherwise the same saved
            # definition folds on one symbol and refuses on the next, which is a
            # refusal a member cannot reproduce.
            return vals[1] if vals[0] else vals[2]
        if name == "u-" and len(vals) == 1:
            return -vals[0]
        if name == "!" and len(vals) == 1:
            return 0.0 if vals[0] else 1.0
        if name in _BINARY and len(vals) == 2:
            return _BINARY[name](vals[0], vals[1])
        raise NotFoldable(f"operator {name!r}")

    if kind == "call":
        name = node.get("name")
        fn = _FOLD_CALLS.get(name)
        if fn is None:
            raise NotFoldable(f"{name}()")
        args = [fold_scalar(a, consts) for a in (node.get("args") or [])]
        try:
            return float(fn(*args))
        except TypeError as exc:
            raise NotFoldable(f"{name}()") from exc

    # `offset` (x[1]), `tf`, `sym`, `tf_live` all read bars or another request.
    raise NotFoldable(f"a {kind!r} node")


def int_slots(name: Any) -> list:
    """Which argument positions of ``name`` the manifest declares ``int``.

    ⛔ READ OFF THE TABLE, so a new length-taking entry is covered on the day it
    lands. A hand-list here would be the per-function work this pass exists to
    avoid.
    """
    spec = (TABLE.get("functions") or {}).get(name)
    if not isinstance(spec, Mapping):
        return []
    return [i for i, kind in enumerate(spec.get("args") or ()) if kind == "int"]


def fold_bound(ast: Any, consts: Mapping[str, Any] = None) -> Any:
    """The tree with every foldable INT-slot argument replaced by its literal.

    ⭐ RETURNS A NEW TREE AND MUTATES NOTHING. The stored definition must go on
    meaning what it said, because the NEXT symbol folds it differently. A pass
    that rewrote in place would let the second symbol of a sweep inherit the
    first symbol's lengths -- the exact defect the per-binding rule exists to
    prevent, and one that would show as a wrong number rather than an error.

    ⛔ A SLOT THAT IS ALREADY A LITERAL IS UNTOUCHED. A slot that does NOT fold is
    left exactly as it was, and ``_window_literal`` refuses it downstream by name
    -- the pre-existing behaviour, unchanged.

    ⚠️ THE ONE CASE THIS PASS REFUSES ITSELF is a fold that SUCCEEDS and produces
    something that is not a usable window: 2.5, 0, a negative, or a non-finite.
    Only this pass knows what it folded FROM, and a refusal that cannot say
    *"2.5, from lenDaily / 2"* sends a member looking in the wrong place.
    """
    consts = consts or {}

    def walk(node):
        if not isinstance(node, Mapping):
            return node
        if not isinstance(node.get("args"), (list, tuple)):
            return node
        slots = int_slots(node.get("name")) if node.get("type") == "call" else []
        args = []
        for i, arg in enumerate(node.get("args") or ()):
            if i in slots and isinstance(arg, Mapping) and arg.get("type") != "num":
                try:
                    value = fold_scalar(arg, consts)
                except NotFoldable:
                    args.append(walk(arg))
                    continue
                _assert_usable_window(node.get("name"), i, value, render(arg))
                args.append({"type": "num", "value": int(value)})
            else:
                args.append(walk(arg))
        out = dict(node)
        out["args"] = args
        return out

    return walk(ast)


def render(node: Any) -> str:
    """A compact source rendering of an expression, for a refusal to quote.

    ⛔ A REFUSAL THAT SAYS *"argument 1 folded to 2.5"* AND STOPS IS HALF A
    SENTENCE. The member wrote `lenDaily / 2`; the number 2.5 is our arithmetic,
    not their text, and without the text they have to guess which of several
    lengths in their script this was. Owner ruling names the shape:
    *"length folded to 2.5 from lenDaily / 2"*.
    """
    if not isinstance(node, Mapping):
        return repr(node)
    kind = node.get("type")
    if kind == "num":
        v = node.get("value")
        return str(int(v)) if isinstance(v, (int, float)) and float(v).is_integer() else str(v)
    if kind == "series":
        return str(node.get("name"))
    args = [render(a) for a in (node.get("args") or ())]
    name = node.get("name")
    if kind == "op":
        if name == "?:" and len(args) == 3:
            return f"{args[0]} ? {args[1]} : {args[2]}"
        if name == "u-" and len(args) == 1:
            return f"-{args[0]}"
        if name == "!" and len(args) == 1:
            return f"not {args[0]}"
        if len(args) == 2:
            return f"{args[0]} {name} {args[1]}"
    return f"{name}({', '.join(args)})"


def _assert_usable_window(fn_name: Any, index: int, value: float,
                          source: str = None) -> None:
    if value != value or value in (float("inf"), float("-inf")):
        _refuse("resolve:window",
                f"— {fn_name} argument {index} folded to a non-finite value for "
                f"this binding, from `{source}`; a length must be a whole number "
                "of at least 1")
    if not float(value).is_integer() or value < 1:
        _refuse("resolve:window",
                f"— {fn_name} argument {index} folded to {value!r} for this "
                f"binding, from `{source}`; a length must be a whole number of at "
                "least 1")
