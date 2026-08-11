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

from api.services.ast_table import (
    TABLE, FUNCTIONS_SECTION, OPERATORS_SECTION, SCALARS_SECTION, SERIES_SECTION,
    recurrences, recurrence_bindings, is_pointwise,
)

# ⭐⭐ NOT ONE LINE OF INDICATOR MATHS LIVES IN THIS FILE. ``indicator_compute``
# is what ``indicator_alert_evaluator`` already fires on and what
# ``tests/fixtures/indicators/`` already pins against
# ``app/src/components/chart/indicators.js`` at rel-tol 1e-9, case by case. That
# pre-existing equality is the ONLY reason a formula calling ``rsi`` can be
# promised to agree across the two lanes; a private RSI here would be a third
# implementation and a second authority over one value.
# ``closedTable.json::_functions_indicators`` records the decision.
#
# ⚠️ THE `_raw` FORMS, ALWAYS. The delivery wrappers round (2dp for RSI, 4dp for
# ATR ...) because two live consumers compare those numbers against user
# thresholds; a formula composes values and then compares, so rounding here would
# put a half-ulp step inside every expression -- and it would break the 1e-9
# equality with the JS lane, which does not round at all.
from api.services.indicator_compute import (
    compute_adx_raw,
    compute_atr_raw,
    compute_cci_raw,
    compute_donchian_raw,
    compute_ichimoku_raw,
    compute_macd_raw,
    compute_mfi_raw,
    compute_rsi_raw,
    compute_stoch_raw,
    compute_williams_r_raw,
)

MaybeNum = Optional[float]

NAN = float("nan")
INF = float("inf")

#: The canonical persisted node vocabulary — the same five
#: ``app/src/components/chart/engine/ast/parse.js`` exports as ``NODE_TYPES``.
#:
#: ⚠️ NOT HAND-TRUSTED. ``test_ast_interpret.py`` derives the same set from the
#: union of every ``type`` in the committed corpus and asserts the equality, so a
#: sixth type arriving on the wire cannot be absorbed here quietly.
#:
#: ⭐⭐ ``offset`` IS THE BOUNDED BACKWARD FORM — ``{type: "offset", value: <int
#: ≥ 0>, args: [<one child>]}``, which the JS lane's ``parse.js`` produces for
#: the source spelling ``EXPR[N]``. Python STILL NEVER PARSES; it walks the tree
#: that door built. The bar count is a NUMBER ON THE NODE rather than a child
#: expression, and that is the whole design: a shape with no slot for an
#: expression cannot hold one, so ``max_lookback`` stays a TREE SUM and a
#: FORWARD reference stays inexpressible in both lanes at once.
NODE_TYPES = ("num", "series", "op", "call", "offset")


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
    "interpret:offset": "an offset node carries a whole-number count of bars",
    "interpret:recurrence": (
        "a running value reads its own past only inside its own update, and only "
        "through operators and pointwise calls"),
    "interpret:steps": (
        "warming this running value up over these bars would take more steps than "
        "the engine will spend"),
}

#: The ceiling on ``bars x warmup`` for one recurrence -- the ONE cost in this
#: engine a STATIC budget cannot threshold, because it depends on how many bars
#: the caller brought rather than on the tree alone.
#:
#: ⚠️ ONE NUMBER FOR BOTH LANES, AND THIS LANE IS WHY IT IS THIS LOW. The walker
#: here is plain loops on purpose (numpy would change summation order and cost
#: the 1e-9 parity), so it is far slower per step than the JS one. A per-lane
#: ceiling would be two engines: the same formula would draw on a chart and
#: refuse in an alert, which is the one divergence a cross-lane parity run is
#: blind to, because both lanes would be internally consistent.
#:
#: ⛔ THE VALUE IS ASSERTED EQUAL TO ``interpret.js::MAX_RECURRENCE_STEPS`` in
#: ``test_ast_interpret.py``, read out of the JS source rather than retyped.
MAX_RECURRENCE_STEPS = 1000000


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
# own idea of what its arguments are, and a table edit reaches every one of them
# at once. ⛔ NO COUNT HERE. This comment said "all eleven" while the table held
# eleven, which is the hand-typed-count-beside-the-list defect the ledger is full
# of; ``test_ast_interpret.py`` asserts the key sets are EQUAL, which is the claim
# a number was only ever approximating.
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


def _window_sum(series: Sequence[float], lo: int, hi: int) -> float:
    total = 0.0
    for i in range(lo, hi + 1):
        total += series[i]
    return total


def _window_mean_abs_dev(series: Sequence[float], lo: int, hi: int) -> float:
    """Pine's ``ta.dev``: the MEAN ABSOLUTE deviation about the window's average.

    ⛔ NOT ``_window_stdev``, which is the root-mean-square one. They differ on
    every real series, and CCI is defined on this one -- mapping ``dev`` to
    ``stdev`` returns a plausible CCI that is wrong on every bar, the same
    look-alike failure the PCF refusal table exists to prevent.
    """
    avg = _window_mean(series, lo, hi)
    total = 0.0
    for i in range(lo, hi + 1):
        total += abs(series[i] - avg)
    return total / (hi - lo + 1)


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


def _smooth_col(series: Sequence[float], n: int, k: float) -> List[float]:
    """An exponential smoother seeded with the SMA of the first full window.

    ⭐ ONE SMOOTHER, TWO CONSTANTS. ``ema`` passes ``2 / (n + 1)`` and ``rma``
    (Wilder's) passes ``1 / n``; the seed, the restart-on-a-hole and the NaN
    prefix are shared BY CONSTRUCTION rather than by two loops that agree today.
    See ``closedTable.json::_functions_smoothing`` for why the ALPHA is what is
    shared and the period is not.

    ⚠️ THE SEED IS A DECISION AND IT MATCHES BOTH THE NATIVE LANE AND
    ``interpret.js::emaCol``. A NaN in the input RESTARTS the seed — the warmup of
    a composed series (``ema(sma(close,20), 9)``) is exactly that case, and an EMA
    that carried its state across a hole would be reporting an average of bars it
    never saw.
    """
    out = _nan_col(len(series))
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


def _ema_col(series: Sequence[float], n: int) -> List[float]:
    return _smooth_col(series, n, 2 / (n + 1))


def _rma_col(series: Sequence[float], n: int) -> List[float]:
    return _smooth_col(series, n, 1 / n)


def _window_weighted_mean(series: Sequence[float], lo: int, hi: int) -> float:
    """The linearly weighted mean of ``[lo, hi]`` -- the most recent bar carries
    the most weight.

    ⚠️ NaN PROPAGATES through the sum, which is what makes the warm-up of a
    composed argument show as a hole rather than as a lighter average of the bars
    that happened to be there.
    """
    weighted = 0.0
    weights = 0.0
    for i in range(lo, hi + 1):
        w = float(i - lo + 1)
        weighted += series[i] * w
        weights += w
    return weighted / weights


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


def _guarded_abs(x: float) -> float:
    return abs(x)


def _guarded_sign(x: float) -> float:
    """⛔ THREE ANSWERS, WRITTEN OUT. `math.copysign(1, -0.0)` is -1.0 and JS's
    `Math.sign(-0)` is -0; a signed zero is invisible in every comparison and in
    the read-back, and NOT invisible to a parity run that divides by it."""
    if math.isnan(x):
        return NAN
    return 1.0 if x > 0 else (-1.0 if x < 0 else 0.0)


def _guarded_round(x: float) -> float:
    """⛔ NOT PYTHON'S `round`, WHICH ROUNDS A HALF TO EVEN, AND NOT JS's
    `Math.round`, WHICH ROUNDS IT TOWARD +inf. Pine rounds a half AWAY FROM ZERO
    and so does this, in both lanes, spelled the same way. `math.floor` also
    RAISES on NaN, so the guard is load-bearing rather than tidy. See
    `closedTable.json::_functions_rounding`."""
    if math.isnan(x):
        return NAN
    return _guarded_sign(x) * math.floor(abs(x) + 0.5)


def _guarded_na(x: float) -> float:
    """⭐ ONE OF THE TWO ENTRIES THAT DO NOT PROPAGATE NaN. It INSPECTS
    not-computable rather than carrying it -- see `_functions_na`."""
    return 1.0 if math.isnan(x) else 0.0


def _guarded_nz(x: float, y: float) -> float:
    """⭐ THE OTHER ONE. It REPLACES not-computable with a value the user named
    explicitly; there is no one-argument form, because a default zero is the
    invisible half of the defect `_functions_na` describes."""
    return y if math.isnan(x) else x


def _fn_abs(series: Sequence[float]) -> List[float]:
    out = _nan_col(len(series))
    for i in range(len(series)):
        out[i] = _guarded_abs(series[i])
    return out


def _guarded_min(x: float, y: float) -> float:
    return NAN if (math.isnan(x) or math.isnan(y)) else min(x, y)


def _guarded_max(x: float, y: float) -> float:
    return NAN if (math.isnan(x) or math.isnan(y)) else max(x, y)


#: The pointwise functions AS SCALARS -- one bar in, one bar out.
#:
#: ⭐ THE COLUMN FORMS ARE DEFINED IN TERMS OF THESE, NOT BESIDE THEM, and that
#: is the whole reason this map exists. A recurrence body is evaluated one bar at
#: a time (see ``_run_recurrence``), so ``max(self, close)`` needs a scalar
#: ``max``; writing a second one there would be two implementations of one
#: function, and the first thing to diverge would be the NaN rule the comment on
#: ``FN`` says was already a measured cross-lane bug.
#:
#: ⚠️ THE KEY SET IS DERIVED AND ASSERTED, NOT CURATED. ``is_pointwise`` decides
#: which table entries a body may call; ``test_ast_interpret.py`` asserts that set
#: equals these keys BOTH WAYS, so a pointwise entry that lands in the manifest
#: without a scalar form here fails by name rather than refusing inside a body
#: that looks legal.
#: The "no precomputed column here" sentinel. ⛔ NOT ``None`` and not a falsy
#: check: a precomputed subtree can legitimately evaluate to 0.0 or to NaN, and
#: `if not columns.get(...)` would send both back through the step walker —
#: which would then meet a bare ``series`` node it had deliberately not planned.
_MISSING = object()

# ── pure math ─────────────────────────────────────────────────────────────── #
#
# ⭐⭐ EVERY DOMAIN REFUSAL ANSWERS nan, AND IT IS WRITTEN OUT IN BOTH LANES.
# Python RAISES `ValueError` for `math.sqrt(-1)` and `math.log(0)`; JavaScript
# hands back `NaN` for the first and `-Infinity` for the second. Left to their
# defaults the two lanes would part company on the first zero close in the tape —
# one lane blowing up the whole evaluation, the other serving `-Infinity`, which
# COMPARES AS THE SMALLEST THING IN THE UNIVERSE and silently wins every `<` a
# member could write. `nan` is what this engine already means by "not
# computable", so both lanes say exactly that, in the same place.


def _guarded_sqrt(x: float) -> float:
    return NAN if _isnan(x) or x < 0 else math.sqrt(x)


def _guarded_ln(x: float) -> float:
    return NAN if _isnan(x) or x <= 0 else math.log(x)


def _guarded_log10(x: float) -> float:
    return NAN if _isnan(x) or x <= 0 else math.log10(x)


def _finite_or_nan(v: float) -> float:
    """⛔ An overflow is not an answer: `exp(1000)` is `inf`, which would compare
    as larger than every threshold a member could write."""
    return v if math.isfinite(v) else NAN


#: ``math.log(sys.float_info.max)`` -- the exponent above which ``exp`` overflows.
#: Written as the BOUNDARY rather than discovered by catching the throw, because
#: this file contains no try/except by construction (see test_ast_budget).
_LOG_MAX = 709.782712893384


def _guarded_exp(x: float) -> float:
    if _isnan(x) or x > _LOG_MAX:
        return NAN
    return _finite_or_nan(math.exp(x))


def _guarded_pow(x: float, y: float) -> float:
    if _isnan(x) or _isnan(y):
        return NAN
    # ⛔ A NEGATIVE BASE WITH A FRACTIONAL EXPONENT DOES NOT RAISE IN PYTHON --
    # IT RETURNS A COMPLEX NUMBER. `(-8) ** (1/3)` is `1.0000000000000002+1.732j`,
    # so a guard written around ValueError sails straight past it and the value
    # then blows up somewhere far away. JS answers NaN. Refused here by DOMAIN.
    if x < 0 and y != int(y):
        return NAN
    # 0 to a negative power is a division by zero.
    if x == 0 and y < 0:
        return NAN
    # Overflow, decided BEFORE computing: |x|**y overflows when y*ln|x| passes the
    # largest representable exponent.
    if x != 0 and y * math.log(abs(x)) > _LOG_MAX:
        return NAN
    return _finite_or_nan(float(x) ** float(y))


def _guarded_mod(x: float, y: float) -> float:
    """⛔ TRUNCATED, NOT PYTHON'S FLOORED `%`. `-7 % 2` is `1` in Python and `-1`
    in JS; TC2000 truncates toward zero, so the sign follows the LEFT operand and
    the operator is spelled out rather than borrowed."""
    if _isnan(x) or _isnan(y) or y == 0:
        return NAN
    return x - y * float(int(x / y))


def _guarded_idiv(x: float, y: float) -> float:
    if _isnan(x) or _isnan(y) or y == 0:
        return NAN
    return float(int(x / y))


def _guarded_sin(x: float) -> float:
    return NAN if _isnan(x) else math.sin(x)


def _guarded_cos(x: float) -> float:
    return NAN if _isnan(x) else math.cos(x)


def _guarded_tan(x: float) -> float:
    return NAN if _isnan(x) else math.tan(x)


def _guarded_atan(x: float) -> float:
    return NAN if _isnan(x) else math.atan(x)


def _guarded_sinh(x: float) -> float:
    # sinh overflows just past where exp does, symmetrically about zero.
    if _isnan(x) or abs(x) > _LOG_MAX + 1.0:
        return NAN
    return _finite_or_nan(math.sinh(x))


_POINTWISE: Mapping[str, Callable[..., float]] = {
    "abs": _guarded_abs,
    "min": _guarded_min,
    "max": _guarded_max,
    "sign": _guarded_sign,
    "round": _guarded_round,
    "na": _guarded_na,
    "nz": _guarded_nz,
    "sqrt": _guarded_sqrt,
    "ln": _guarded_ln,
    "log10": _guarded_log10,
    "exp": _guarded_exp,
    "pow": _guarded_pow,
    "mod": _guarded_mod,
    "idiv": _guarded_idiv,
    "sin": _guarded_sin,
    "cos": _guarded_cos,
    "tan": _guarded_tan,
    "atan": _guarded_atan,
    "sinh": _guarded_sinh,
}

#: The manifest's recurrence declarations, read ONCE at import. ⛔ Not re-derived
#: per call: two readings of one manifest is how a lane comes to disagree with
#: itself between a chart request and an alert evaluation.
RECURRENCES: Mapping[str, Any] = recurrences()
RECURRENCE_BINDINGS: tuple = recurrence_bindings()


# --------------------------------------------------------------------------- #
# the indicators -- a BINDING to the server's own maths, never a second copy
# --------------------------------------------------------------------------- #
#
# ⭐ THREE HELPERS AND NOTHING ELSE. Everything below is (1) pack the declared
# ``series`` columns into the ``{h,l,c,v}`` bar shape ``indicator_compute``
# reads, (2) call the shipped function, (3) unpack its ``[float | None]`` back
# into a NaN-padded column. ``interpret.js`` carries the SAME three, in the same
# order, against the same shipped functions -- so the two lanes differ only where
# ``indicators.js`` and ``indicator_compute.py`` already differ, which is the
# thing the golden fixtures measure.


#: The bar-field name lists the bindings below pack into. THE SHIPPED
#: FUNCTIONS' parameter shape, never the table's vocabulary -- ``high`` is the
#: table's name for the series and ``h`` is the key ``indicator_compute`` reads.
_HL = ("h", "l")
_HLC = ("h", "l", "c")
_HLCV = ("h", "l", "c", "v")


def _finite_tail_start(cols: Sequence[Sequence[float]], length: int) -> int:
    """⭐⭐ THE FIRST BAR FROM WHICH EVERY INPUT COLUMN IS FINITE TO THE END --
    and this is the load-bearing half of the whole binding.

    🔴 THE MEASURED REASON, NOT A PRECAUTION. ``indicator_compute`` and
    ``indicators.js`` are written for BARS, and a bar is finite. Hand either one
    a NaN and the two languages stop agreeing: ``compute_atr_raw``'s
    ``max(h - l, abs(h - prev_c), abs(l - prev_c))`` with a NaN ``prev_c``
    returns Python's FIRST argument, because every NaN comparison is false and
    ``max`` keeps the incumbent -- while ``Math.max`` returns NaN. Same
    expression, same fixture, two answers, and no golden fixture can see it
    because no fixture contains a NaN. A composed argument
    (``atr(high, low, sma(close,3), 14)``) is how a user reaches it in one
    keystroke.

    ⭐ SO THE SHIPPED MATHS NEVER SEES ONE. The column starts after the LAST
    non-finite value in ANY argument, which is ``_ema_col``'s already-declared
    rule ("a NaN in the input RESTARTS the seed") applied to a whole bar.
    ``rsi(sma(close, 20), 14)`` therefore produces its first value at bar 33 --
    exactly the ``19 + 14`` the manifest's tree sum promises -- and an
    uncomposed ``close`` argument starts at 0, so every column this binding
    returns for an ordinary call is identical to calling the shipped function
    directly.

    ⛔ WRITTEN TWICE, HERE AND IN ``interpret.js``, deliberately. It is a
    CONTRACT between the two lanes, not an optimisation, and the corpus pins it.
    """
    start = 0
    for col in cols:
        for i in range(length - 1, start - 1, -1):
            if not math.isfinite(col[i]):
                start = i + 1
                break
    return start


def _bind_shipped(fields: Sequence[str], cols: Sequence[Sequence[float]],
                  length: int, run: Callable[[List[dict]], Any]) -> List[float]:
    """Pack the declared series columns into bars, run the server's own maths
    over them, and unpack the result into a NaN-padded column of ``length``.

    ⚠️ ``t`` IS SET AND NEVER READ BY ANY BOUND FUNCTION, exactly as in
    ``interpret.js::bindShipped``. It is a bar index, NOT the real timestamp --
    which is precisely why ``vwap`` is refused (``_functions_excluded``): a
    session anchor cannot be reconstructed from a column of prices.

    ⛔ A LENGTH MISMATCH IS ALL-NaN, NOT A PARTIAL FILL. Every bound function
    returns either a bar-aligned list or an all-``None`` one; the JS lane's
    equivalent refuses the same way against that lane's ``[]`` form of the same
    "too short to compute anything" signal.
    """
    out = _nan_col(length)
    start = _finite_tail_start(cols, length)
    n = length - start
    if n <= 0:
        return out
    bars: List[dict] = []
    for i in range(n):
        bar = {"t": i}
        for k, field in enumerate(fields):
            bar[field] = cols[k][start + i]
        bars.append(bar)
    values = run(bars)
    if not isinstance(values, list) or len(values) != n:
        return out
    for i in range(n):
        v = values[i]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        out[start + i] = NAN if math.isnan(float(v)) else float(v)
    return out


def _ichimoku_line(h: Sequence[float], l: Sequence[float], c: Sequence[float],  # noqa: E741
                   tenkan: int, kijun: int, senkou_b: int, index: int) -> List[float]:
    """One line of the Ichimoku family, with ``_functions_domain``'s guard first.

    ⛔ THE GUARD IS WRITTEN IN BOTH LANES ON PURPOSE. ``compute_ichimoku_raw``
    returns empty columns when ``max(tenkan, kijun) > senkou_b``;
    ``indicators.js::computeIchimoku`` reads a NEGATIVE index and throws a
    TypeError. Letting either lane's native answer through would be a cross-lane
    divergence on an argument list the table admits.

    ⚠️ THE FOUR MIDLINE ENTRIES PASS ``high`` AS THE CLOSE COLUMN AND THAT IS NOT
    A SHORTCUT. ``compute_ichimoku_raw`` reads ``c`` for exactly one thing -- the
    lagging span -- so a line that declares no close argument cannot be affected
    by what sits there, and declaring a fifth series every one of them ignores
    would put a term in the read-back that says nothing about the number.
    """
    if max(tenkan, kijun) > senkou_b:
        return _nan_col(len(h))
    return _bind_shipped(
        _HLC, (h, l, c), len(h),
        lambda bars: compute_ichimoku_raw(bars, tenkan, kijun, senkou_b)[index])


def _fn_rsi(s: Sequence[float], n: int) -> List[float]:
    return _bind_shipped(("c",), (s,), len(s),
                         lambda bars: compute_rsi_raw([b["c"] for b in bars], n))


def _fn_macd(s: Sequence[float], fast: int, slow: int) -> List[float]:
    """The MACD LINE only.

    ⛔ ``signal`` IS PINNED TO 1 AND IT IS NOT A HIDDEN DEFAULT. This entry
    declares the line; the only thing ``signal`` still reaches is the guard
    ``n < slow + signal``, and 1 is the smallest value that cannot make that
    guard refuse a series the LINE could have been computed over. ``computeMACD``
    is passed the same 1. The signal line is ``ema(macd(close,12,26), 9)`` --
    see ``_functions_excluded.macdSignal``.
    """
    if fast > slow:
        return _nan_col(len(s))
    return _bind_shipped(
        ("c",), (s,), len(s),
        lambda bars: compute_macd_raw([b["c"] for b in bars], fast, slow, 1)[0])


def _fn_atr(h, l, c, n):  # noqa: E741
    return _bind_shipped(_HLC, (h, l, c), len(c), lambda bars: compute_atr_raw(bars, n))


def _fn_plus_di(h, l, c, n):  # noqa: E741
    return _bind_shipped(_HLC, (h, l, c), len(c), lambda bars: compute_adx_raw(bars, n)[1])


def _fn_minus_di(h, l, c, n):  # noqa: E741
    return _bind_shipped(_HLC, (h, l, c), len(c), lambda bars: compute_adx_raw(bars, n)[2])


def _fn_stoch(h, l, c, n):  # noqa: E741
    """%K only. %D is ``sma(stoch(...), d)`` -- ``_functions_excluded.stochD``.

    ``d_period`` is pinned to 1 for the same reason ``macd``'s ``signal`` is: it
    must not reach a guard this entry's declaration says nothing about.
    """
    return _bind_shipped(_HLC, (h, l, c), len(c),
                         lambda bars: compute_stoch_raw(bars, n, 1)[0])


def _fn_cci(h, l, c, n):  # noqa: E741
    return _bind_shipped(_HLC, (h, l, c), len(c), lambda bars: compute_cci_raw(bars, n))


def _fn_williams_r(h, l, c, n):  # noqa: E741
    return _bind_shipped(_HLC, (h, l, c), len(c),
                         lambda bars: compute_williams_r_raw(bars, n))


def _fn_mfi(h, l, c, v, n):  # noqa: E741
    return _bind_shipped(_HLCV, (h, l, c, v), len(c), lambda bars: compute_mfi_raw(bars, n))


def _donchian(h, l, n, index):  # noqa: E741
    return _bind_shipped(_HL, (h, l), len(h),
                         lambda bars: compute_donchian_raw(bars, n)[index])


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
    "sum": lambda series, n: _rolling(series, n, _window_sum),
    "dev": lambda series, n: _rolling(series, n, _window_mean_abs_dev),
    "change": _fn_change,
    "abs": _fn_abs,
    # ⚠️ NaN PROPAGATES, WRITTEN OUT RATHER THAN INHERITED. JS's `Math.min(NaN, x)`
    # is NaN and Python's bare `min` returns whichever it meets FIRST — a real
    # cross-lane divergence the corpus names explicitly. Spelling the rule kills it
    # in both lanes instead of relying on one language's luck.
    "min": lambda a, b: _elementwise2(a, b, _guarded_min),

    # ── pure math, lifted to columns ─────────────────────────────────────────
    # ⭐ EACH IS THE POINTWISE SCALAR APPLIED PER BAR AND NOTHING ELSE, so the
    # maths lives in exactly one place and `tests/test_ast_math_parity.py` drives
    # that place against the JS lane. A second copy written out here is how the
    # column lane and the scalar lane come to disagree about `log(0)` later.
    "sqrt": lambda a: [_guarded_sqrt(v) for v in a],
    "ln": lambda a: [_guarded_ln(v) for v in a],
    "log10": lambda a: [_guarded_log10(v) for v in a],
    "exp": lambda a: [_guarded_exp(v) for v in a],
    "sin": lambda a: [_guarded_sin(v) for v in a],
    "cos": lambda a: [_guarded_cos(v) for v in a],
    "tan": lambda a: [_guarded_tan(v) for v in a],
    "atan": lambda a: [_guarded_atan(v) for v in a],
    "sinh": lambda a: [_guarded_sinh(v) for v in a],
    "pow": lambda a, b: _elementwise2(a, b, _guarded_pow),
    "mod": lambda a, b: _elementwise2(a, b, _guarded_mod),
    "idiv": lambda a, b: _elementwise2(a, b, _guarded_idiv),
    "max": lambda a, b: _elementwise2(a, b, _guarded_max),
    "rma": lambda series, n: _rma_col(series, n),
    "wma": lambda series, n: _rolling(series, n, _window_weighted_mean),
    "sign": lambda series: [_guarded_sign(v) for v in series],
    "round": lambda series: [_guarded_round(v) for v in series],
    "na": lambda series: [_guarded_na(v) for v in series],
    "nz": lambda a, b: _elementwise2(a, b, _guarded_nz),
    "crossOver": lambda a, b: _crossing(a, b, lambda an, bn, ap, bp: an > bn and ap <= bp),
    "crossUnder": lambda a, b: _crossing(a, b, lambda an, bn, ap, bp: an < bn and ap >= bp),
    # ── the indicators, bound to the server's own maths ────────────────────
    #
    # ⚠️ ``compute_rsi_raw`` and ``compute_macd_raw`` ALREADY TAKE A SERIES, so
    # those two need no bar packing at all -- which is what makes
    # ``rsi(sma(close,20), 14)`` an RSI of a smoothed series rather than a
    # different function. That composability is the reason the table declares a
    # ``series`` argument instead of reading ``close`` itself.
    "rsi": _fn_rsi,
    "macd": _fn_macd,
    "atr": _fn_atr,
    "plusDI": _fn_plus_di,
    "minusDI": _fn_minus_di,
    "stoch": _fn_stoch,
    "cci": _fn_cci,
    "williamsR": _fn_williams_r,
    "mfi": _fn_mfi,
    "donchianUpper": lambda h, l, n: _donchian(h, l, n, 0),   # noqa: E741
    "donchianMiddle": lambda h, l, n: _donchian(h, l, n, 1),  # noqa: E741
    "donchianLower": lambda h, l, n: _donchian(h, l, n, 2),   # noqa: E741
    "ichimokuTenkan": lambda h, l, t, k, s: _ichimoku_line(h, l, h, t, k, s, 0),  # noqa: E741
    "ichimokuKijun": lambda h, l, t, k, s: _ichimoku_line(h, l, h, t, k, s, 1),   # noqa: E741
    "ichimokuSpanA": lambda h, l, t, k, s: _ichimoku_line(h, l, h, t, k, s, 2),   # noqa: E741
    "ichimokuSpanB": lambda h, l, t, k, s: _ichimoku_line(h, l, h, t, k, s, 3),   # noqa: E741
    "ichimokuChikou": lambda h, l, c, t, k, s: _ichimoku_line(h, l, c, t, k, s, 4),  # noqa: E741
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
        if node["type"] in ("op", "call", "offset"):
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


def _offset_bars(node: dict) -> int:
    """The bar count of ONE ``offset`` node, VALIDATED. Refuses ``interpret:offset``.

    ⭐ THE SHAPE ALREADY MAKES A COMPUTED OFFSET INEXPRESSIBLE — ``value`` is a
    number on the node and there is no slot for an expression. This is what
    stands between that guarantee and a PERSISTED tree, which is user data that
    never went through ``canonicalise``: a stored blob can spell
    ``{"type": "offset", "value": -26}`` by hand, and the negative is the one
    thing that must never reach the walker.

    ⛔ A REFUSAL, NOT A CLAMP. Clamping ``-26`` to ``0`` would silently turn a
    forward reference into ``close`` and draw a confident wrong column.

    ⛔ ``type(v) is bool`` IS CHECKED, because ``isinstance(True, int)`` is True
    and ``True`` would otherwise read as an offset of one bar. The same trap
    ``stable_stringify`` documents, one door along.
    """
    args = node.get("args")
    if not isinstance(args, list) or len(args) != 1:
        _refuse("interpret:offset",
                f"— an offset reads exactly one child column, got "
                f"{len(args) if isinstance(args, list) else args!r}")
    n = node.get("value")
    if (isinstance(n, bool) or not _is_number(n)
            or not float(n).is_integer() or n < 0):
        _refuse("interpret:offset",
                f"— got {n!r}; a bar offset counts backwards from the bar it writes")
    return int(n)


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
        if kind == "offset":
            # ⭐ THE TREE SUM, EXTENDED BY EXACTLY ONE TERM, and byte-for-byte
            # the JS lane's arithmetic: ``sma(close[2], 20)`` needs 22 bars.
            seen[id(node)] = _offset_bars(node) + seen[id(node["args"][0])]
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


def unresolved_scalars(ast: Any,
                       scalars: Optional[Mapping[str, Any]] = None) -> List[str]:
    """The declared scalars this tree names that have NO usable value here.

    🔴 THIS EXISTS BECAUSE A COMPARISON EATS THE HOLE, AND THAT IS MEASURED
    RATHER THAN FEARED. ``_cmp`` answers **0** when either side is NaN --
    *"A COMPARISON AGAINST NaN IS 0, NOT NaN ... the one place JS and Python
    agree by luck"* -- and that rule is correct for a bar warmup (the crossing
    did not happen) and PINNED by 17 frozen cross-lane digests. Applied to a
    scalar it is the ``scan_volume._job`` bug at the leaf: with no market cap,

        interpret(market_cap > 1e9)        -> [0.0, 0.0, ...]   a confident False
        interpret(market_cap)              -> [None, None, ...] the honest hole

    So the hole is visible at the LEAF and invisible one node up, and a sweep
    that read the column would count a symbol it knows nothing about as a symbol
    that did not match. ⛔ THE ANSWER IS NOT TO CHANGE `_cmp`: propagating NaN
    through comparisons would move every digest in the conformance log and
    change what a warmup means on the chart. The answer is to ask THIS question
    before evaluating, which is why it is a function and not a comment.

    ⚠️ PYTHON-ONLY, DECLARED RATHER THAN FORGOTTEN. Its consumer is the
    server-side universe sweep; a browser evaluates one symbol whose row it does
    not have, so a mirrored JS export would be a callable nothing calls -- the
    silently-dead shape this phase exists to retire.

    Returns the names in the manifest's own order, so the list is stable.
    """
    provided = scalars or {}
    named = {n.get("name") for n in _flatten(ast) if n["type"] == "series"}
    out: List[str] = []
    for name in TABLE[SCALARS_SECTION]:
        if name not in named:
            continue
        v = provided.get(name)
        if not (_is_number(v) and math.isfinite(float(v))):
            out.append(name)
    return out


def unresolved_lookback(ast: Any, bars: Optional[List[dict]]) -> int:
    """How many bars SHORT this series is of what the tree declares it reads.
    ``0`` means the history is sufficient.

    🔴 THIS EXISTS FOR THE SAME REASON ``unresolved_scalars`` DOES, ONE AXIS
    OVER — and it was measured, not feared. ``_cmp`` answers **0** when either
    side is NaN, which is correct for a warmup on the chart (the crossing did not
    happen) and is pinned by 17 frozen cross-lane digests. Applied to a tree the
    series is too SHORT to answer, it is a confident False forever. Evaluated on
    200 real AAPL bars:

        interpret(sma(close, 300))          -> 200 x None      the honest hole
        interpret(close > sma(close, 300))  -> 200 x 0.0       a confident "no"

    and ``ema(close, 200)`` on exactly 200 bars produces ONE value at index 199,
    which is the SMA200 SEED, not an EMA — so ``close > ema(close, 200)`` returned
    ``1.0`` and an alert fired on a number that is not the indicator it names.

    ⛔ THE ANSWER IS NOT TO CHANGE ``_cmp``. Propagating NaN through comparisons
    would move every conformance digest and change what a warmup means on the
    chart. The answer is to ask THIS question BEFORE evaluating — which is why it
    is a function and not a comment, and why it is shaped exactly like
    ``unresolved_scalars``.

    ⚠️ ``max_lookback`` is the tree's OWN declaration — the same number the
    budget and the repaint linter read — so this cannot disagree with them about
    how much past a formula needs.
    """
    have = len(bars) if isinstance(bars, list) else 0
    return max(0, max_lookback(ast) - have)


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
              inputs: Optional[Mapping[str, Any]] = None,
              budget: Optional[Mapping[str, Any]] = None,
              scalars: Optional[Mapping[str, Any]] = None) -> List[MaybeNum]:
    """Evaluate a canonical AST over bars → one aligned column of ``len(bars)``.

    :param ast:    a canonical tree (``parse.js::canonicalise``'s output)
    :param bars:   ``[{'t':…,'o':…,'h':…,'l':…,'c':…,'v':…}, …]``
    :param inputs: declared instance inputs, by name; finite numbers only
    :param budget: the definition's stored ``compute.budget``. Resolved through
                   ``effective_budget``, so it can only ever TIGHTEN the default
                   and a stored blob cannot turn off its own limit.
    :param scalars: this SYMBOL's values for the table's declared scalars. Every
                   declared name is seeded whether or not it appears here; an
                   absent or unusable value seeds a NaN column.
    :returns:      a list exactly ``len(bars)`` long, ``None`` where not computable

    Raises ``TableRefusal`` for anything the table refuses. Everything else — a
    ``RecursionError`` from a tree deep enough to exhaust the stack, say — is NOT
    a refusal and must never be caught and relabelled as one.
    """
    # ⚠️ IMPORTED HERE RATHER THAN AT MODULE LEVEL, AND IT IS THE CYCLE, NOT A
    # STYLE. ``ast_budget`` imports THIS module's ``max_lookback`` / ``node_count``
    # (a second copy of either would be a second grammar). Python has no live
    # bindings, so a top-level import both ways breaks for whichever module is
    # imported second — and the two test files import them in opposite orders.
    # The JS lane resolves the same two edges with an ESM cycle; see
    # ``ast_budget``'s header, which states the asymmetry so nobody reads it as
    # two different designs.
    from api.services.ast_budget import check_budget

    if not isinstance(bars, list):
        # A plain TypeError, NOT a TableRefusal: the table refuses what a USER
        # wrote, and the bars are the caller's. Conflating the two would let a
        # wiring bug read as "the formula was rejected" on a chip's tooltip.
        raise TypeError(f"interpret(ast, bars): bars must be a list, got {type(bars).__name__}")
    # ⭐ THE COMPUTE-TIME BUDGET, AND IT IS THE SAFETY HALF. It runs BEFORE the
    # scope is built and before a single node is walked, because the tree it
    # exists to refuse is the one that never returns. ``check_budget``'s
    # measurements are iterative, so this line survives the 8,001-node input that
    # makes the recursive walker below raise ``RecursionError`` — the guard does
    # not need the walker to be safe first.
    #
    # ⛔ NOT WRAPPED IN A ``try``. A ``RecursionError`` from a tree this admits
    # must reach the caller AS a ``RecursionError``; relabelling it as a budget
    # refusal is the same wrong-door defect this whole phase is about.
    check_budget(ast, budget)
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

    # ⭐ A DECLARED SCALAR IS ALWAYS IN SCOPE. Present or absent, the name
    # RESOLVES — an absent value seeds a NaN column, exactly like a bar with a
    # missing field ("a missing field is NOT a price of zero; it is a bar we
    # cannot compute on"). That is what separates "declared but not known for
    # this symbol" — a HOLE, which a sweep counts and reports — from "a name this
    # table never declared", which is `resolve:name` and a formula defect. A
    # missing market cap read as 0 would make `market_cap > 1e9` a confident
    # False, which is the shape of `scan_volume._job`'s `m = {}`: a failed
    # reference indistinguishable from an empty market.
    #
    # ⚠️ A BARE FLOAT, NOT A COLUMN. `_lift1/2/3` already broadcast a scalar
    # against a column and `_to_column` already fills a length-n column from a
    # bare number, so a scalar-only tree is a flat column of `len(bars)` — which
    # is what makes it composable with a per-bar one.
    #
    # ⛔ AND `inputs` IS SEEDED AFTER, SO THE SHADOW CHECK BELOW SEES IT. An
    # input named after a declared scalar must RAISE, the same plain ValueError a
    # `close`-shadowing input already raises: a definition whose knob silently
    # outranks a table name changes what its formula means with nothing red.
    provided = scalars or {}
    for name in TABLE[SCALARS_SECTION]:
        v = provided.get(name)
        scope[name] = float(v) if (_is_number(v) and math.isfinite(float(v))) else NAN

    for name, value in (inputs or {}).items():
        # ⛔ AND A RECURRENCE BINDING IS RESERVED TOO. ``self`` is not in
        # ``scope`` and not in ``functions``, so without this an input could take
        # the name and every body in the definition would silently read the KNOB
        # instead of the running value — a formula that still computes, and
        # computes the wrong thing. The list is derived from the manifest.
        if name in scope or name in TABLE[FUNCTIONS_SECTION] or name in RECURRENCE_BINDINGS:
            # A plain ValueError again: a definition whose input shadows `close`
            # is a WIRING defect, and silently letting it win would change what
            # every formula on that definition means.
            raise ValueError(
                f"interpret: the input {name!r} shadows a table name. The table "
                f"declares {_declared(TABLE[SERIES_SECTION])}, "
                f"{_declared(TABLE[FUNCTIONS_SECTION])} and "
                f"{_declared(TABLE[SCALARS_SECTION])}.")
        # Only finite numbers are seeded. An input that is a callable, an object
        # or a string is NOT a name this table can resolve, and leaving it out
        # makes referencing it a loud `resolve:name` refusal rather than a column
        # of None.
        if _is_number(value) and math.isfinite(float(value)):
            scope[name] = float(value)

    def lookup(name: Any) -> Any:
        # ⛔ `in`, NEVER `getattr`. See the module header.
        if not isinstance(name, str) or name not in scope:
            # ⭐ A RECURRENCE BINDING IS NEVER IN SCOPE, EVEN INSIDE ITS OWN
            # BODY — ``run_recurrence``'s step loop intercepts it before the
            # walker gets here. So reaching this line with one means it was
            # written where no running value is being computed, and saying THAT
            # is worth its own guard: `unknown name 'self'` beside a list of
            # price fields sends the reader hunting a typo in a name that is
            # spelled correctly.
            if isinstance(name, str) and name in RECURRENCE_BINDINGS:
                _refuse("interpret:recurrence",
                        f"— `{name}` was read outside the update of a "
                        f"{_declared(RECURRENCES)} call")
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
        if kind in ("op", "call", "offset") and not isinstance(n.get("args"), list):
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
        if kind == "offset":
            back = _offset_bars(n)
            # ⛔ MATERIALISED TO A COLUMN FIRST, ALWAYS — the JS lane does the
            # same, and for the same reason: a scalar child has no history
            # either, so broadcasting and THEN shifting is what makes "three bars
            # ago" mean one thing in both lanes for every child kind.
            src = _to_column(eval_node(n["args"][0]), length)
            # ⭐⭐ THE LEFT EDGE, AND IT IS THE DEFINING RULE OF THIS ENGINE.
            # Bars before index `back` have no bar to read, so the answer is NOT
            # COMPUTABLE. ⛔ NEVER 0.0 and ⛔ NEVER ``src[0]``: a clamped first
            # bar makes ``close > close[3]`` a confident answer on bar 1, which
            # is the defect class ``unresolved_lookback`` above was written
            # against. The prefix is NaN and the loop starts AT ``back``.
            out = _nan_col(length)
            for i in range(back, length):
                out[i] = src[i - back]
            return out
        if kind == "op":
            return apply_op(n, [eval_node(a) for a in n["args"]])
        if kind == "call":
            spec = _fn_spec(n.get("name"))
            _assert_arity(n, spec)
            # ⭐ THE ONE ARM THAT DOES NOT EVALUATE ITS ARGUMENTS EAGERLY, and
            # the MANIFEST says so rather than this line asserting it: an entry
            # declaring a ``recurrence`` carries a per-bar BODY, not a column.
            if n["name"] in RECURRENCES:
                return run_recurrence(n, spec)
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

    def apply_op_step(node: dict, values: List[Any]) -> Any:
        """One operator, applied to BARE FLOATS. The recurrence step loop's arm.

        ⭐ THE SAME ``_UNARY``/``_BINARY``/``_ternary`` ENTRIES ``apply_op`` USES,
        and that is not a convenience: ``_lift1/2/3`` are pure elementwise
        applications of these very functions, so a body evaluated one bar at a
        time and a column evaluated all at once are the SAME ARITHMETIC by
        construction. A second scalar table here would be a second grammar, and
        the first thing to diverge would be the NaN rule (``_cmp`` answers 0.0,
        ``_logical`` answers NaN) — a difference NO cross-lane parity run would
        catch, because it would be wrong identically in both lanes.
        """
        name = node.get("name")
        if name == _TERNARY_NAME:
            if len(values) != 3:
                _refuse("resolve:arity",
                        f"— the ternary {_TERNARY_NAME} expects 3 arguments, got {len(values)}")
            return _ternary(values[0], values[1], values[2])
        if isinstance(name, str) and name in _UNARY:
            if len(values) != 1:
                _refuse("resolve:arity", f"— {name} expects 1 arguments, got {len(values)}")
            return _UNARY[name](values[0])
        if isinstance(name, str) and name in _BINARY:
            if len(values) != 2:
                _refuse("resolve:arity", f"— {name} expects 2 arguments, got {len(values)}")
            return _BINARY[name](values[0], values[1])
        return _refuse("interpret:operator",
                       f"{name!r} — this table declares {_declared(TABLE[OPERATORS_SECTION])}")

    def run_recurrence(node: dict, spec: Mapping[str, Any]) -> Any:
        """A declared recurrence — bar-to-bar state, bounded so the answer cannot
        depend on which bars the caller happened to fetch.

        ⭐⭐ THE DEFINITION, AND EVERYTHING ELSE FOLLOWS FROM IT. At bar ``i`` the
        state is SEEDED FRESH at bar ``i - warmup`` and the body is applied once
        per bar across ``(i - warmup, i]``. So the value at bar ``i`` is a
        function of exactly ``warmup + 1`` bars and nothing else — the same
        bargain ``sma(close, 20)`` makes, and the reason panning a chart cannot
        change it.

        ⛔ THE OBVIOUS IMPLEMENTATION IS THE WRONG ONE, AND IT IS WRONG QUIETLY.
        A single forward pass from bar 0 is O(n) instead of O(n x warmup) and
        gives a DIFFERENT number for the same bar the moment the window moves —
        a rolling value needs a warm-up prefix and a cumulative one needs an
        ABSOLUTE seed; "wherever this fetch started" is neither.

        ⛔ AND THE PREFIX IS NaN, NEVER A SHORT RUN. Bars before ``warmup`` have
        no seed bar to start from, so they are not computable — a partial
        accumulation there would be a confident wrong number wearing a warm-up's
        clothes, the same shape as the clamped ``src[0]`` the offset arm refuses.

        ⚠️ LINE FOR LINE THE SAME SHAPE AS ``interpret.js::runRecurrence``. The
        two are held equal by the parity corpus at 1e-9, and a recurrence is
        ORDER-SENSITIVE, so the loop bounds here are part of the contract rather
        than an implementation detail.
        """
        rec = spec["recurrence"]
        bind = rec["binds"]
        warmup = _window_literal(node, rec["warmup"])
        body = node["args"][rec["body"]]

        # ⭐ THE ONE COST A STATIC BUDGET CANNOT SEE. ``warmup`` alone is already
        # capped by ``budget:lookback`` like any other window; the WORK is
        # ``bars x warmup``, and the bar count arrives with the caller.
        if length * warmup > MAX_RECURRENCE_STEPS:
            _refuse("interpret:steps",
                    f"— {node['name']} over {length} bars with a {warmup}-bar warm-up "
                    f"is {length * warmup} steps and the ceiling is {MAX_RECURRENCE_STEPS}")

        def is_bind(x: Any) -> bool:
            return isinstance(x, dict) and x.get("type") == "series" and x.get("name") == bind

        # Which nodes of the body read the running value. Memoised over node
        # IDENTITY, so a tree that shares a subtree object answers once.
        reads_cache: Dict[int, bool] = {}

        def reads(x: Any) -> bool:
            key = id(x)
            if key in reads_cache:
                return reads_cache[key]
            answer = is_bind(x)
            if not answer and isinstance(x, dict) and isinstance(x.get("args"), list):
                for child in x["args"]:
                    if reads(child):
                        answer = True
                        break
            reads_cache[key] = answer
            return answer

        # ⭐ THE PARTITION, AND IT IS WHAT KEEPS THIS AFFORDABLE. Every maximal
        # subtree that does NOT read the running value is an ordinary column and
        # is evaluated ONCE, by the ordinary walker. Only the spine that actually
        # depends on the previous bar is re-evaluated per step — so ``sma`` inside
        # a body costs one pass, not ``bars x warmup`` of them.
        columns: Dict[int, Any] = {}
        planned = set()

        def plan(x: Any) -> None:
            if id(x) in planned:
                return
            planned.add(id(x))
            if not reads(x):
                columns[id(x)] = eval_node(x)
                return
            if is_bind(x):
                return
            kind = x.get("type") if isinstance(x, dict) else None
            if kind == "offset":
                _refuse("interpret:recurrence",
                        f"— `{bind}` sits under a bar offset in {node['name']}(…). The step "
                        f"loop holds ONE previous value, not a history of them.")
            if kind == "call":
                inner = _fn_spec(x.get("name"))
                if x["name"] in RECURRENCES:
                    _refuse("interpret:recurrence",
                            f"— `{bind}` sits inside a nested {x['name']}(…), so which "
                            f"running value it names would depend on where a reader started "
                            f"counting.")
                if not is_pointwise(inner):
                    _refuse("interpret:recurrence",
                            f"— `{bind}` sits inside {x['name']}(…), which reads a window "
                            f"of bars rather than one. Write the windowed part outside the "
                            f"update, or spell it with {_declared(TABLE[OPERATORS_SECTION])}.")
                _assert_arity(x, inner)
            for child in ((x.get("args") or []) if isinstance(x, dict) else []):
                plan(child)

        plan(body)

        def step(x: Any, j: int, carried: float) -> float:
            got = columns.get(id(x), _MISSING)
            if got is not _MISSING:
                return got[j] if _is_column(got) else got
            if is_bind(x):
                return carried
            values = [step(child, j, carried) for child in x["args"]]
            if x["type"] == "op":
                return apply_op_step(x, values)
            return _POINTWISE[x["name"]](*values)

        seed = _to_column(eval_node(node["args"][rec["seed"]]), length)
        out = _nan_col(length)
        for i in range(warmup, length):
            carried = seed[i - warmup]
            for j in range(i - warmup + 1, i + 1):
                carried = step(body, j, carried)
            out[i] = carried
        return out

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
