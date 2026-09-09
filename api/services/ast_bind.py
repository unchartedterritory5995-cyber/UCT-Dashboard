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


def _load_symbol_scope() -> dict:
    """``symbolScope.json``, or an empty scope.

    ⚠️ AN EMPTY SCOPE IS THE SAFE FAILURE, AND IT IS NOT SILENT IN EFFECT: with
    no ``confirmed`` entries the fold refuses every symbol-scoped field by name,
    which is exactly what it does today. A missing file therefore cannot make
    this lane ANSWER differently from the other one -- it can only make it refuse
    more, and the parity fixture is what would catch that.
    """
    import json
    import pathlib
    p = (pathlib.Path(__file__).resolve().parents[2] / "app" / "src" / "components"
         / "chart" / "engine" / "ast" / "symbolScope.json")
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}

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


#: The arithmetic of the text questions, mirroring
#: ``app/src/components/chart/engine/ast/bind.js::TEXT_PREDICATE_FN`` exactly.
#:
#: ⛔ TWO LANES, ONE ARTIFACT: ``tests/fixtures/ast/bind_fold_parity.json`` pins
#: the answers, because *"do the two lanes agree on emptiness and case"* is
#: precisely the question a cross-lane divergence hides in. Pine's
#: ``str.contains`` is case-SENSITIVE and substring-based, and an empty needle is
#: contained by every string -- true in Python and JavaScript alike, so the
#: mirror is exact rather than merely close.
_TEXT_PREDICATE = {
    "contains": lambda a, b: 1.0 if str(b) in str(a) else 0.0,
    "startswith": lambda a, b: 1.0 if str(a).startswith(str(b)) else 0.0,
    "endswith": lambda a, b: 1.0 if str(a).endswith(str(b)) else 0.0,
    "length": lambda a: float(len(str(a))),
    "eq": lambda a, b: 1.0 if str(a) == str(b) else 0.0,
    "ne": lambda a, b: 0.0 if str(a) == str(b) else 1.0,
}

#: The symbol-scoped vocabulary, READ OFF THE SAME DATA FILE THE JS LANE READS.
#:
#: ⛔⛔ ONE FILE, NOT TWO ROSTERS. ``symbolScope.json`` sits beside the manifest
#: because that is where the manifest lives, and this lane reads it from disk for
#: the same reason ``ast_interpret`` reads ``closedTable.json``: a second copy of
#: *which exchange spellings have been witnessed* would be a second authority
#: over the one question that decides whether a member gets a right answer or an
#: inverted one.
_SYMBOL_SCOPE = _load_symbol_scope()

#: ``<our store exchange string>`` -> ``<the string TradingView returns>``, and
#: ONLY where a capture witnessed it. ``store_to_pine`` beside it in the same
#: file is a PROPOSAL; reading that here would turn eleven guesses into eleven
#: shipped answers in a single edit.
SYMBOL_EXCHANGE_CONFIRMED = {
    k: str(v["pine"])
    for k, v in (_SYMBOL_SCOPE.get("confirmed") or {}).items()
    if not k.startswith("_") and isinstance(v, Mapping)
    and isinstance(v.get("pine"), str) and isinstance(v.get("witness"), str)
}

#: The reason the fold quotes when a symbol-scoped field cannot be resolved for
#: a binding -- read off the manifest so the sentence has one owner.
_PENDING = {k: v for k, v in (_SYMBOL_SCOPE.get("pending_measurement") or {}).items()
            if not k.startswith("_")}


def symbol_constants(symbol=None) -> dict:
    """What ONE symbol makes constant: ``syminfo.*``, and nothing else.

    ⭐⭐ ``ticker`` ALWAYS; THE OTHER TWO ONLY ON A WITNESSED EXCHANGE. The plain
    symbol is the string our own store is keyed by, so there is no vendor
    question in it. ``tickerid`` and ``exchange`` are TradingView strings a
    member compares with ``==`` and ``str.contains``, where a
    plausible-but-unmeasured spelling does not degrade the answer -- it INVERTS
    it.

    ⛔ THE GATE IS HERE AND NOT AT THE TRANSLATOR DOOR, because confirmation is a
    property of THE SYMBOL EXCHANGE. A door runs once per script and cannot
    answer a question whose answer is *"it depends which symbol"*.

    ⚠️ ``tickerid`` IS ASSEMBLED, NOT STORED: Pine spells it ``EXCHANGE:SYMBOL``,
    so it is exactly as measured as its exchange half and is gated on the same
    witness.
    """
    return symbol_constants_with(SYMBOL_EXCHANGE_CONFIRMED, symbol)


def symbol_constants_with(confirmed, symbol=None) -> dict:
    """``symbol_constants`` with the witness map handed in.

    ⭐⭐ THE PRODUCTION CALL IS THE ONE-LINE SPECIALISATION ABOVE. ``confirmed``
    is empty today, so every path that reads an exchange is DARK -- and a rail
    that could only drive the dark path would prove the refusal works while
    proving nothing about the answer. Taking the map as a parameter lets a test
    drive the SERVING path with a synthetic witness, so *"these fields refuse"*
    becomes a statement about the DATA rather than about a code path nobody has
    ever seen run (``lesson_built_tested_green_and_unreachable``).
    """
    out: dict = {}
    if not isinstance(symbol, Mapping):
        return out
    ticker = str(symbol.get("ticker") or "").strip()
    if not ticker:
        return out
    out["syminfo.ticker"] = ticker
    stored = str(symbol.get("exchange") or "").strip()
    if stored and confirmed and stored in confirmed:
        pine = confirmed[stored]
        out["syminfo.exchange"] = pine
        out["syminfo.tickerid"] = pine + ":" + ticker
    return out


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

    ⚰️ ``symbol`` USED TO BE ACCEPTED AND CONTRIBUTE NOTHING. It now
    contributes ``syminfo.*`` through ``symbol_constants`` -- see there for why
    ``ticker`` resolves for every symbol while ``tickerid`` and ``exchange``
    wait on a witnessed exchange spelling. The old note said only the fields our
    store can populate may ship; that is still the rule, and what changed is
    that one of them can.
    """
    out: dict = {}
    for name in BIND_TIME_CLOCK:
        if timeframe is not None and name in timeframe:
            out[name] = 1.0 if timeframe[name] else 0.0
    for name, value in (inputs or {}).items():
        if _is_number(value):
            out[str(name)] = float(value)
    # ⭐ TEXT AND NUMBERS SHARE ONE MAP, and each reader checks the type it
    # needs: ``fold_scalar`` accepts only a finite number, ``fold_text`` only a
    # string. A single map keeps *what is constant for this binding* one
    # question with one answer, which is the whole reason this function exists
    # rather than each caller assembling its own.
    out.update(symbol_constants(symbol))
    return out


def fold_text(node, consts) -> str:
    """One TEXT expression -> a string, or ``NotFoldable`` naming what stopped it.

    ⛔⛔ TEXT LIVES ONLY INSIDE THIS PASS. Nothing here hands a string back to a
    caller that could put it in a tree: ``fold_scalar`` consumes these through
    ``_TEXT_PREDICATE`` and returns a NUMBER. That containment is what let the
    closed table gain ``str.contains`` without gaining a second value system in
    every walk that prices, lints and evaluates a tree.

    ⭐ AND THE REFUSAL NAMES THE FIELD WITH ITS REASON. A binding whose exchange
    has no witness stops on ``syminfo.exchange`` carrying the measurement gap --
    a member told *"the engine grammar does not hold this name"* would rewrite a
    script that will work unchanged the day a capture lands.
    """
    if not isinstance(node, Mapping):
        raise NotFoldable(repr(node))
    kind = node.get("type")
    if kind == "str":
        return str(node.get("value"))
    if kind == "symtext":
        field = str(node.get("name"))
        key = "syminfo." + field
        have = consts.get(key)
        if isinstance(have, str) and have:
            return have
        why = _PENDING.get(field)
        raise NotFoldable(key + " \u2014 " + why if why else key)
    raise NotFoldable("a " + repr(kind) + " node where text was needed")


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

    # ⭐ A TEXT QUESTION WITH A NUMERIC ANSWER. ``str.contains(syminfo.ticker,
    # "/")`` is 1 or 0 for a binding, and after this line nothing textual remains
    # in the tree -- which is what lets a window length, a screener column and
    # the repaint linter all go on seeing only numbers.
    if kind == "textop":
        name = node.get("name")
        fn = _TEXT_PREDICATE.get(name)
        if fn is None:
            raise NotFoldable("text predicate " + repr(name))
        try:
            return float(fn(*[fold_text(a, consts) for a in (node.get("args") or [])]))
        except TypeError as exc:
            raise NotFoldable("text predicate " + repr(name)) from exc

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
        # ⭐⭐ A ``textop`` FOLDS WHEREVER IT SITS, not only in an int slot -- and
        # that is not symmetry for its own sake. ``Uncharted Volume`` line 222
        # feeds its answer to a BOOLEAN (``isRatioSymbol``), never to a window
        # length, so a pass that only rewrote lengths would leave the node in the
        # tree and the evaluator would refuse a definition that was perfectly
        # decidable. Every ``textop`` is bind-time by construction, so folding it
        # everywhere is the same claim the node type already makes.
        # ⛔ AND AN UNFOLDABLE ONE IS LEFT EXACTLY AS IT WAS, like every other
        # operand here: the check downstream then refuses the member's own
        # expression, naming the field that stopped it.
        if node.get("type") == "textop":
            try:
                return {"type": "num", "value": fold_scalar(node, consts)}
            except NotFoldable:
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
    if kind == "str":
        return chr(34) + str(node.get("value")) + chr(34)
    if kind == "symtext":
        return "syminfo." + str(node.get("name"))
    args = [render(a) for a in (node.get("args") or ())]
    if kind == "textop":
        name = node.get("name")
        if name == "eq" and len(args) == 2:
            return args[0] + " == " + args[1]
        if name == "ne" and len(args) == 2:
            return args[0] + " != " + args[1]
        return "str." + str(name) + "(" + ", ".join(args) + ")"
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


def _show(value: float) -> str:
    """A number rendered the way BOTH lanes render it.

    ⛔⛔ THE FIXTURE CAUGHT THIS AND IT IS EXACTLY THE DIVERGENCE THE OWNER RULED
    AGAINST. Python's ``repr`` of a float prints ``0.0`` where JavaScript prints
    ``0``, so the same length in the same script produced *"folded to 0.0"* in the
    sweep and *"folded to 0"* on the pane — two sentences about one number, which
    is two products. Integral values print without the fractional tail in both.
    """
    return str(int(value)) if float(value).is_integer() else str(value)


def _assert_usable_window(fn_name: Any, index: int, value: float,
                          source: str = None) -> None:
    if value != value or value in (float("inf"), float("-inf")):
        _refuse("resolve:window",
                f"— {fn_name} argument {index} folded to a non-finite value for "
                f"this binding, from `{source}`; a length must be a whole number "
                "of at least 1")
    if not float(value).is_integer() or value < 1:
        _refuse("resolve:window",
                f"— {fn_name} argument {index} folded to {_show(value)} for this "
                f"binding, from `{source}`; a length must be a whole number of at "
                "least 1")
