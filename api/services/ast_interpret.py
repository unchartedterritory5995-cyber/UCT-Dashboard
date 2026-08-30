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

import datetime
import math
import re
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from api.services.ast_table import (
    TABLE, CLOCK_SECTION, FUNCTIONS_SECTION, OPERATORS_SECTION, SCALARS_SECTION,
    SERIES_SECTION, ARG_DOMAIN, arg_domains, bar_readers, recurrences,
    recurrence_bindings, is_pointwise,
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
# ⚠️ THE `_raw` FORMS, ALWAYS -- except ``compute_clock``, which HAS no delivery
# wrapper because a calendar field is an integer already and a rounding layer
# that cannot change anything is ceremony a later reader mistakes for a boundary.
# The delivery wrappers round (2dp for RSI, 4dp for
# ATR ...) because two live consumers compare those numbers against user
# thresholds; a formula composes values and then compares, so rounding here would
# put a half-ulp step inside every expression -- and it would break the 1e-9
# equality with the JS lane, which does not round at all.
from api.services.indicator_compute import (
    compute_adx_raw,
    AVWAP_MIN_INSTANT,
    compute_atr_raw,
    compute_avwap_raw,
    compute_cci_raw,
    compute_clock,
    compute_donchian_raw,
    compute_ichimoku_raw,
    compute_macd_raw,
    compute_mfi_raw,
    compute_obv_raw,
    compute_rsi_raw,
    compute_stoch_raw,
    compute_vwap_raw,
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
NODE_TYPES = ("num", "series", "op", "call", "offset", "tf", "sym", "tf_live")


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
#: ⭐ THE HIGHER-TIMEFRAME LADDER, LOW TO HIGH. `tf` may only ever read a
#: timeframe STRICTLY ABOVE the bars it was handed: asking a daily series for a
#: 5-minute value cannot be answered from the bars in hand, and inventing one is
#: the silent mistranslation this engine exists against.
#:
#: ⛔ THE ORDER IS THE MEANING, not decoration — `_tf_rank` is a position in this
#: tuple and nothing else, so adding a timeframe is one edit and the comparison
#: cannot drift from the list it compares.
TF_LADDER = ("1", "5", "15", "30", "60", "D", "W", "M")

#: Which of those `tf` can actually RESAMPLE today. ⚠️ Deliberately smaller than
#: the ladder: the ladder is what an ORDER can be taken over, this is what a
#: value can be produced for. Conflating them would let `tf(close, '60')` parse,
#: rank correctly and then answer nothing.
TF_RESAMPLABLE = ("W", "M")

#: How many BASE bars one higher-timeframe bar spans, for the lookback sum.
#: ⚠️ TRADING days, not calendar: 5 to a week, 21 to a month. These are the
#: numbers `max_lookback` multiplies by, and a lookback that is too SMALL is
#: the dangerous direction — it would let a tree claim it needs fewer bars
#: than it reads and answer off a warmup it never had.
TF_BASE_BARS = {"W": 5, "M": 21}


def _assert_sym_placement(root: Any) -> None:
    """Refuse a `sym` that sits UNDER a `tf` — THE ONE PLACE THAT DECIDES.

    ⛔⛔ THE DANGEROUS ORDERING IS THE ONE THAT ALMOST WORKS. `tf` hands its child
    RESAMPLED bars; the series a caller supplies for `sym` is not resampled. So
    ``tf(sym('SPY', close), 'W')`` asks `sym` to align DAILY SPY bars onto WEEKLY
    base dates — and a weekly bar keyed at its Friday close genuinely matches a
    real SPY Friday bar. The answer is therefore NOT NaN. It is a confident,
    partially-correct column: one day's close standing in for a week's. It draws,
    it backtests, and it is wrong — exactly the silent mistranslation this engine
    refuses everywhere else.

    ⭐ THE REFUSAL CARRIES THE WORKING ORDERING, so it costs the member nothing:
    ``sym('SPY', tf(close, 'W'))`` swaps the series FIRST and then resamples
    SPY's own bars, which is what they meant. A refusal that only forbids is half
    an artifact (`lesson_rail_the_sentence_not_just_the_guard`).

    ⚠️ STATIC, AND CALLED FROM BOTH ENTRY POINTS. The rule is a property of the
    TREE, so it is checked once per tree rather than once per bar — and
    `max_lookback` calls it too, so `assert_scannable` refuses the definition ONCE
    instead of letting the sweep fail every symbol in the universe. That split is
    the defect fixed in 06333cb48 for timeframes; this is the same shape, declined
    in advance (`lesson_a_second_authority_over_one_value`).

    ⛔ IT IS NOT "a tree containing both nodes". `close > sym('SPY', close)`
    beside a `tf` is fine, and so is `sym` OUTSIDE `tf`. Only the ancestry is
    refused — the control in `test_the_nesting_guard_does_NOT_refuse_the_shapes_
    that_are_fine` is what keeps this from quietly becoming "no `sym` at all".
    """
    stack = [(root, False)]
    while stack:
        node, under_tf = stack.pop()
        if not isinstance(node, dict):
            continue
        kind = node.get("type")
        if kind == "sym" and under_tf:
            ticker = str(node.get("value"))
            _refuse("interpret:symbol",
                    "a `sym` read cannot sit inside a `tf` read — `tf` resamples "
                    "the bars it was handed and the %s series is not resampled "
                    "with them, so the column would silently mix one session's "
                    "value into a whole period. Write it the other way round, "
                    "which reads %s's own higher-timeframe bar: "
                    "sym('%s', tf(…))." % (ticker, ticker, ticker))
        args = node.get("args")
        if isinstance(args, list):
            for a in args:
                stack.append((a, under_tf or kind in ("tf", "tf_live")))


def _assert_resamplable(code):
    """Refuse a `tf` code this engine cannot serve — THE ONE PLACE THAT DECIDES.

    ⛔⛔ THIS EXISTS BECAUSE THE ANSWER WAS GIVEN TWICE AND THE COPIES DISAGREED.
    `interpret` refused anything outside ``TF_RESAMPLABLE``. The ``max_lookback``
    arm beside it read ``TF_BASE_BARS.get(code, 1)`` and let an unknown code fall
    through as span 1. ``assert_scannable`` runs ``max_lookback`` and never
    ``interpret`` — so ``tf(close, '60')`` was stamped **scannable: true** on the
    member's saved-scan list while every row of the sweep refused at
    ``interpret:timeframe``. The member is told the scan will run; it then answers
    nothing, for every symbol, forever, and the receipt blames the universe.

    ⭐ THE KNOWING SIDE STAMPS ITS ANSWER (`lesson_a_second_authority_over_one_value`).
    ``TF_RESAMPLABLE`` is the authority and this is its only reader; the lookback
    arm no longer holds an opinion about which timeframes exist. ⚠️ A span table
    with a DEFAULT is a second opinion wearing a fallback's clothes — which is why
    ``TF_BASE_BARS`` is now subscripted, never ``.get``-with-a-default, and only
    after this has run.
    """
    if code not in TF_RESAMPLABLE:
        _refuse("interpret:timeframe",
                "%r — this engine resamples %s from the bars it is given. "
                "The declared ladder is %s; a code outside it is not a "
                "timeframe this table knows."
                % (code, ", ".join(TF_RESAMPLABLE), ", ".join(TF_LADDER)))



def _tf_rank(code: Any) -> Optional[int]:
    """Position on the ladder, or ``None`` for a code it does not declare."""
    # ⛔ A MEMBERSHIP TEST, NOT A `try`. `test_neither_the_budget_nor_the_
    # interpreter_contains_a_single_try` forbids try/except anywhere in this file,
    # and it is not a style rule: a caught exception here is one line from
    # swallowing the `RecursionError` an 8,001-node tree raises and re-reporting it
    # as a refusal — the wrong-door defect this whole phase is about. This shipped
    # as `try: TF_LADDER.index(...)` in de1e77019 and sat RED on master, unseen,
    # because the backend gate never once ran to completion
    # (`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`).
    spelled = str(code)
    return TF_LADDER.index(spelled) if spelled in TF_LADDER else None


def _iso_day(t: Any) -> Optional[str]:
    """One bar's ``t`` as ``YYYY-MM-DD``, whichever way it was stored.

    ⛔⛔ THIS EXISTS BECAUSE THE RESAMPLERS PARSE A STRING AND THE STORE DOES NOT
    KEEP ONE. `bars_fetch._resample_weekly_iso` reads
    ``datetime.strptime(bar["t"], "%Y-%m-%d")``, while `bars_sqlite` stores
    daily/weekly/monthly ``t`` as **YYYYMMDD ints** and intraday ``t`` as **unix
    seconds** (measured 2026-08-27: ``{"t": 20260827, ...}``). Handing the store's
    own bars straight to the resampler dates every higher-timeframe bar to 1970 —
    and the column still DRAWS, which is the shape of defect this engine refuses
    everywhere else.

    ⚠️ IT RETURNS ``None`` RATHER THAN GUESSING. A ``t`` in neither spelling is a
    bar this function cannot place in a week, and a placed-wrong bar is worse
    than an absent one.
    """
    if isinstance(t, str):
        return t[:10] if len(t) >= 10 and t[4] == "-" and t[7] == "-" else None
    if isinstance(t, bool) or not isinstance(t, (int, float)):
        return None
    n = int(t)
    # 8-digit YYYYMMDD — the store's daily spelling. Bounded by the calendar
    # rather than by digit count so 19700101 and 99991231 cannot both pass.
    if 19000101 <= n <= 99991231:
        y, md = divmod(n, 10000)
        m, d = divmod(md, 100)
        if 1 <= m <= 12 and 1 <= d <= 31:
            return "%04d-%02d-%02d" % (y, m, d)
    # otherwise: unix SECONDS (the intraday spelling). Not milliseconds — this
    # platform's unit everywhere a bar carries one, as `compute_clock` states.
    if 0 < n < 4102444800:                      # < 2100-01-01
        return datetime.datetime.utcfromtimestamp(n).strftime("%Y-%m-%d")
    return None


def _tf_bucket(iso: str, code: str) -> Any:
    """The higher-timeframe bucket an ISO day falls in.

    ⛔ THE SAME KEYS THE RESAMPLERS GROUP BY — ISO (year, week) for `W` and
    (year, month) for `M` — because this function decides WHICH resampled bar a
    base bar reads, and a second bucketing rule here would silently misalign the
    two by one period at every year boundary.
    """
    d = datetime.datetime.strptime(iso, "%Y-%m-%d")
    return d.isocalendar()[:2] if code == "W" else (d.year, d.month)


REFUSALS: Mapping[str, str] = {
    "resolve:name": "unknown name",
    "resolve:function": "unknown function",
    "resolve:arity": "wrong number of arguments",
    "resolve:window": "a window must be a whole-number literal",
    "resolve:condition": (
        "a condition argument must be a 0/1 column, and this one is a number"),
    "resolve:domain": "a period reaches past the window its own entry declares",
    "interpret:node": "not a canonical node",
    "interpret:operator": "unknown operator",
    "interpret:offset": "an offset node carries a whole-number count of bars",
    "interpret:recurrence": (
        "a running value reads its own past only inside its own update, and only "
        "through operators and pointwise calls"),
    "interpret:timeframe": (
        "a higher-timeframe read names a timeframe this engine cannot serve "
        "from the bars it was given"),
    "interpret:symbol": (
        "a read of another instrument sits where this engine cannot align it "
        "to the bars in hand"),
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

#: How far back a running value may read its OWN past -- ``self[k]``.
#:
#: ⭐ FOUR IS DERIVED, NOT CHOSEN. The deepest classical recursive filter in
#: common use is 2-pole (Butterworth / SuperSmoother / Ehlers), needing
#: ``self[1]``; 4 leaves room for a 4-pole design without opening the door to a
#: history nobody would author by hand. ⛔ IT MUST STAY SMALL AND EQUAL TO THE JS
#: LANE'S: the history is carried per STEP, and the step loop already runs
#: ``bars x warmup`` times, so a deep lag is paid on every bar of every symbol.
MAX_SELF_LAG = 4

#: The one ``lookback`` that names a window instead of measuring one.
#:
#: ⭐⭐ ``lookback: "session"`` reaches back to the first bar of the bar's own New
#: York calendar day. It could never have been spelled ``argN``: no argument
#: carries it, because how many bars a session holds is decided by the CALENDAR
#: and the TIMEFRAME rather than by anything the author typed.
SESSION_LOOKBACK = "session"

#: How far back that reaches, in bars -- READ OFF THE MANIFEST.
#:
#: ⛔⛔ NOT A LITERAL HERE. Four readers need this number across two languages,
#: and ``ast_lint`` is pinned by its own import rail to the standard library, so
#: it can import neither this module nor ``ast_table``. The ONE place all four
#: can see it is the table, which is DATA for precisely that reason -- and a
#: per-lane copy would be the fifth hand-written copy of a window grammar in this
#: engine. The fourth branded ADX as repainting in production.
#:
#: ⭐ 960 = the minutes in the extended ET session (04:00-20:00), and the finest
#: bar this platform serves is one minute, so no timeframe can hold more bars in
#: a session than that. ``closedTable.json::_session`` carries the full argument
#: and the measurement; this is the reader, not the authority.
SESSION_MAX_BARS = TABLE["sessionMaxBars"]
if not isinstance(SESSION_MAX_BARS, int) or isinstance(SESSION_MAX_BARS, bool) \
        or SESSION_MAX_BARS < 1:
    # ⛔ A REFUSAL AT IMPORT, NOT A DEFAULT. A fallback here would BE the per-lane
    # copy this constant exists to prevent, and it would be invisible: the
    # grammar would go on answering, with a window nobody declared.
    raise ValueError(
        f"closedTable.json declares sessionMaxBars={SESSION_MAX_BARS!r}; the session "
        "window must be a whole number of bars, and no lane may supply one of its own")


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


def _window_arg_extreme(series: Sequence[float], lo: int, hi: int,
                        better: Callable[[float, float], bool]) -> float:
    """WHICH BAR holds the window's extreme, as an offset back from ``hi``.

    ⛔⛔ THE TIE-BREAK IS THE MOST RECENT BAR, AND IT IS THE MANIFEST'S RULING,
    NOT THIS FUNCTION'S -- ``closedTable.json::_functions_arg_extreme`` argues it
    out loud. ``_window_extreme`` returns the same NUMBER whichever of two equal
    bars won, so nothing above it can see the choice; this one names a BAR, and
    two hand-written lanes each picking a side would agree on every fixture that
    happens to contain no tie.

    ⚰️ AND THIS SENTENCE ENDED *"The committed 579-bar corpus contains none"* --
    WHICH IS FALSE. Measured on that series: **56** of its 5-bar `high` windows
    and **36** of its `low` windows hold their extreme TWICE, and every one of
    them separates the two conventions, so the frozen digests DO move if the
    ruling flips. The blindness is real as a CLASS and not true of THIS corpus.
    ⛔ IT SURVIVED IN FOUR PLACES because it was written once and mirrored --
    the twin below this line, the manifest note, and the test's own docstring --
    and four agreeing copies read as certainty. See
    ``closedTable.json::_functions_arg_extreme`` for what the corpus still
    cannot reach, and why the constructed fixture is not redundant.

    ⭐ DERIVED FROM THE VALUE RATHER THAN COMPUTED BESIDE IT, so
    ``high[highestbars(high, n)] == highest(high, n)`` holds BY CONSTRUCTION and
    the NaN rule (*"NaN does not lose a comparison"*) is inherited rather than
    restated -- a second scan with its own comparison would be a second authority
    over one window. ``interpret.js::windowArgExtreme`` is the same two steps.
    """
    best = _window_extreme(series, lo, hi, better)
    if math.isnan(best):
        return NAN
    # ⭐ BACKWARD FROM THE BAR BEING WRITTEN: the FIRST match is the MOST RECENT
    # one. Bounded by ``lo`` rather than run open -- a walk that could step past
    # the window would read a negative index (Python wraps; JS yields
    # ``undefined`` and never terminates).
    for i in range(hi, lo - 1, -1):
        if series[i] == best:
            return float(hi - i)
    # ⚠️ UNREACHABLE WHILE ``_window_extreme`` HOLDS ITS CONTRACT -- it only ever
    # returns a member of ``series[lo..hi]``. NaN rather than a raise because a
    # broken extreme must not become an escape inside the walker.
    return NAN


def _pivot_col(series: Sequence[float], left: int, right: int,
               beats: Callable[[float, float], bool]) -> List[float]:
    """``pivothigh``/``pivotlow`` -- the bar's own value where it is the STRICT
    extreme of ``[i-left, i+right]``, and NOT COMPUTABLE everywhere else.

    ⭐⭐ THIS IS THE ONLY IMPLEMENTATION IN THIS FILE THAT READS A LATER BAR, and
    it is legal precisely because the entry DECLARES it: ``forward: "arg2"`` is
    what ``ast_lint.mode_from_reach`` turns into ``preview-repaints``. A user's
    formula still cannot SPELL a forward reference -- the ``offset`` node is
    backward-only and ``parse.js`` refuses a negative at the door -- so the
    manifest stays the single authority on forward reach.

    ⛔ STRICT, SO A PLATEAU IS NOT A PIVOT. Two equal maxima mean neither bar is
    uniquely the extreme. A ``>=`` reading emits both and looks entirely
    reasonable; on the committed 579-bar corpus it would emit 20 extra bars in
    ``high`` and 15 in ``low``, which is why those counts are asserted rather
    than an absence.

    ⛔ AND BOTH EDGES ARE NOT COMPUTABLE, FOR THE SAME REASON IN TWO DIRECTIONS.
    The first ``left`` bars and the last ``right`` bars have a window that runs
    off the fetch. The TAIL is the interesting one: those bars are *not yet
    decidable*, not *decided false* -- they read the same blank, and the
    difference only shows when more bars arrive. That is what the badge means.
    """
    # ⛔ THE `- right` IS LOAD-BEARING HERE AND MERELY DEFENSIVE IN THE JS TWIN,
    # which is the kind of asymmetry a mirrored lane hides. Python raises
    # IndexError past the end (the sweep KILLED this mutation); JS reads
    # `undefined`, every comparison against it is false, and the bar blanks
    # anyway (the same mutation SURVIVED there, equivalently). Do not "simplify"
    # this one by analogy with the other.
    out = _nan_col(len(series))
    for i in range(left, len(series) - right):
        v = series[i]
        if math.isnan(v):
            continue
        ok = True
        for j in range(i - left, i + right + 1):
            if j == i:
                continue
            w = series[j]
            # ⭐ A HOLE ANYWHERE IN THE WINDOW MAKES THE ANSWER UNKNOWN -- the same
            # rule `_window_extreme` states out loud.
            #
            # ⚠️ AND THE `isnan` HALF IS REDUNDANT BY CONSTRUCTION TODAY, WHICH IS
            # MEASURED RATHER THAN GUESSED: deleting it is an EQUIVALENT MUTANT in
            # both lanes (W2a.6 sweep, 0 differing bars on every fixture including
            # a purpose-built holed one). `v` is finite by the check above and
            # `finite > NaN` is False, so `not beats(v, w)` already blanks the bar.
            # ⛔ IT IS KEPT, NOT DELETED, AND NOT BECAUSE IT GUARDS ANYTHING TODAY:
            # it states the rule at the site, and it STOPS being redundant the
            # moment `beats` is anything but a strict comparison. Labelled so
            # nobody reads it as a live guard -- `lesson_gate_that_cannot_fail`.
            if math.isnan(w) or not beats(v, w):
                ok = False
                break
        if ok:
            out[i] = v
    return out


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


def _hma_col(series: Sequence[float], n: int) -> List[float]:
    """Alan Hull's average -- ``wma`` three times, mirroring ``interpret.js::hma``.

    ⛔ ``round(sqrt(n))`` IS WRITTEN OUT AS ``floor(x + 0.5)`` RATHER THAN
    ``round`` -- Python's ``round`` is banker's rounding, JavaScript's
    ``Math.round`` rounds half away from zero, and the two disagree exactly on a
    half.

    ⭐ AND IT IS AN EQUIVALENT MUTANT, RECORDED AS ONE RATHER THAN IMPLIED TO BE
    A GUARD. The manifest types this argument ``int``, and ``sqrt(m)`` is never a
    half-integer for a positive integer ``m``: ``(k + 1/2)**2 = k**2 + k + 1/4``
    is never whole. So no ``n`` a member may write can reach the disagreement, and
    swapping this back to ``round`` would not redden any test. It stays because it
    states JavaScript's rule at the seam instead of resting on a proof that stops
    holding the day the argument stops being an integer -- and saying which of
    those two it is costs one paragraph.
    """
    half = max(1, int(n) // 2)
    root = max(1, int(math.floor(math.sqrt(float(n)) + 0.5)))
    near = _rolling(series, half, _window_weighted_mean)
    full = _rolling(series, n, _window_weighted_mean)
    raw = [2.0 * a - b for a, b in zip(near, full)]
    return _rolling(raw, root, _window_weighted_mean)


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


# --------------------------------------------------------------------------- #
# the BOUNDED STATE pair -- one forward pass each, not a window scan
# --------------------------------------------------------------------------- #
#
# ⭐ BAR-TO-BAR, NOT ``_rolling``. A window scan over ``n`` bars is O(bars x n)
# and these two have an exact recurrence, so they are one pass. The three state
# variables are what the recurrence needs and no more:
#
#   ``since`` -- bars since the last TRUE condition bar, or ``None`` when no true
#                bar lies in the contiguous READABLE run ending here.
#   ``run``   -- how many contiguous READABLE condition bars end here, capped at
#                ``n`` because nothing above ``n`` changes an answer.
#
# ⛔ ``run`` IS THE HOLE RULE AND THE LEFT EDGE AT ONCE, which is why it is not a
# bar counter: a NOT-COMPUTABLE condition bar RESETS it, so a sentinel is never
# reported across a bar this engine could not read -- and the first ``n - 1`` bars
# of any series are the same case, because the window runs off the front of the
# FETCH. See ``closedTable.json::_functions_bounded_state``.


def _fn_barssince(cond: Sequence[float], n: int) -> List[float]:
    """``barssince(cond, n)`` -- bars since ``cond`` was last true, capped at ``n``.

    ⛔ ``n`` IS A SENTINEL, NOT A COUNT. It means *"not true within the last n
    bars"*, and it may only be said once ``n`` readable condition bars have been
    seen. ⛔ AND IT IS NOT TC2000's ``-1``: that spelling belongs to the PCF
    translation of ``SinceTrue``, which already composes it from ``accum(-1, …)``.
    """
    out = _nan_col(len(cond))
    since: Optional[int] = None
    run = 0
    for i in range(len(cond)):
        c = cond[i]
        if math.isnan(c):
            since, run = None, 0
            continue
        run = run + 1 if run < n else n
        if c != 0.0:
            since = 0
        elif since is not None:
            since = since + 1 if since < n else n
        if since is not None:
            # ⭐ A HIT THIS ENGINE CAN SEE IS FINAL however short the fetch: no
            # wider one can insert a NEARER true bar. Only the sentinel below is
            # a claim about bars that had to be read.
            out[i] = float(since)
        elif run >= n:
            out[i] = float(n)
    return out


def _fn_valuewhen(cond: Sequence[float], src: Sequence[float], n: int) -> List[float]:
    """``valuewhen(cond, src, n)`` -- ``src`` as it stood at the most recent true
    bar within ``n``.

    ⛔ NOT COMPUTABLE RATHER THAN STALE once the last hit leaves the window. A
    price carried past its declared window is a confident wrong number, and the
    declaration would stop being true of the value.

    🔴 THE NaN PREFIX MEETS X23 -- a comparison over it reads as a confident
    FALSE and its negation as a confident TRUE, so a scan returns nothing or the
    whole universe. Not this entry's to fix; declared at
    ``closedTable.json::_functions_bounded_state`` and measured at
    ``tests/test_ast_bounded_state.py``.
    """
    out = _nan_col(len(cond))
    since: Optional[int] = None
    held = NAN
    for i in range(len(cond)):
        c = cond[i]
        if math.isnan(c):
            since, held = None, NAN
            continue
        if c != 0.0:
            since, held = 0, src[i]
        elif since is not None:
            since = since + 1 if since < n else n
        if since is not None and since < n:
            out[i] = held
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
    # ⚰️ `>=`, NOT `>` — THE BOUNDARY WAS THE ONE CASE IT MISSED. `2.0 ** 1024.0`
    # is the largest power of two that does NOT fit, and `1024 * log(2)` evaluates
    # BIT-FOR-BIT EQUAL to `_LOG_MAX` in float. So `>` was false, the guard passed,
    # and Python raised `OverflowError` — not a ``TableRefusal``, so it reached the
    # sweep as a crash. The JS lane computes and then applies `Number.isFinite(v) ?
    # v : NaN`, so it already answered NaN; this aligns Python TO it.
    # ⚠️ THE COST IS ONE VALUE: an exponent landing exactly on the bound now
    # returns NaN instead of `float_info.max`. Float rounding makes that boundary
    # unreliable in either direction, and NaN is this engine's word for "not
    # computable" — which is the honest answer for a number at the edge of the type.
    if x != 0 and y * math.log(abs(x)) >= _LOG_MAX:
        return NAN
    return _finite_or_nan(float(x) ** float(y))


def _guarded_mod(x: float, y: float) -> float:
    """⛔ TRUNCATED, NOT PYTHON'S FLOORED `%`. `-7 % 2` is `1` in Python and `-1`
    in JS; TC2000 truncates toward zero, so the sign follows the LEFT operand and
    the operator is spelled out rather than borrowed."""
    if _isnan(x) or _isnan(y) or y == 0:
        return NAN
    # ⚰️⚰️ THE QUOTIENT CAN BE INFINITE, and `int(inf)` raises `OverflowError`
    # — not a ``TableRefusal``, so it reached the sweep as a crash rather than as a
    # refusal. The JS lane failed the OTHER way on the same inputs: `Math.trunc`
    # of Infinity is Infinity, so `> 0` answered a confident TRUE on every bar of
    # every symbol. NaN is this engine's word for "not computable" and is what
    # both lanes now say.
    quotient = x / y
    if not math.isfinite(quotient):
        return NAN
    return x - y * float(int(quotient))


def _guarded_idiv(x: float, y: float) -> float:
    if _isnan(x) or _isnan(y) or y == 0:
        return NAN
    quotient = x / y
    if not math.isfinite(quotient):
        return NAN
    return float(int(quotient))


def _guarded_sin(x: float) -> float:
    return NAN if _isnan(x) else math.sin(x)


def _guarded_cos(x: float) -> float:
    return NAN if _isnan(x) else math.cos(x)


def _guarded_tan(x: float) -> float:
    return NAN if _isnan(x) else math.tan(x)


def _guarded_atan(x: float) -> float:
    return NAN if _isnan(x) else math.atan(x)


#: Where ``sinh`` overflows: ``sinh(x) ≈ exp(x)/2``, so it passes the largest
#: double at ``log(2 * max)`` — DERIVED, not rounded.
#:
#: ⚰️ THE BOUND WAS `_LOG_MAX + 1.0`, WHICH IS 0.307 TOO WIDE (`1 - log 2`), and
#: every argument in that gap sailed through the guard and raised `OverflowError`
#: out of `math.sinh` — a crash rather than a refusal. Measured: 710.47 answers,
#: 710.48 overflows, and this constant is 710.4758600739439.
_LOG_SINH_MAX = _LOG_MAX + math.log(2.0)


def _guarded_sinh(x: float) -> float:
    # sinh overflows just past where exp does, symmetrically about zero.
    if _isnan(x) or abs(x) > _LOG_SINH_MAX:
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
    which is precisely why ``vwap`` was refused (``_functions_excluded``) for as
    long as this table has existed: a session anchor cannot be reconstructed from
    a column of prices.

    ⭐ AND THAT IS WHY THE ANSWER WAS NOT A SPECIAL CASE HERE. An entry declaring
    ``reads: "bars"`` takes no series arguments, so it has nothing to pack; it is
    handed ``interpret``'s OWN bar array by ``_bar_column`` below and reads the
    real instant. This adapter is unchanged, and its fabricated ``t`` still means
    exactly what it says.

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


def _fn_adx(h, l, c, n):  # noqa: E741
    # Bound to the SHIPPED implementation, never composed — the same rule as
    # its +DI/-DI siblings, and for a sharper reason: ADX smooths DX with
    # Wilder's k = 1/n while this table's `ema` is k = 2/(n+1), so an
    # expansion would have been a look-alike wearing the right name.
    return _bind_shipped(_HLC, (h, l, c), len(c), lambda bars: compute_adx_raw(bars, n)[0])


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
    # ⭐ THE ARG-EXTREMES, AND THE `better` PREDICATE IS THE SAME OBJECT SHAPE THE
    # VALUE FORMS PASS -- `_window_arg_extreme` asks `_window_extreme` for the
    # value and only then names the bar, so the pair cannot disagree about one
    # window and the tie-break is the manifest's ruling rather than this line's.
    "highestbars": lambda series, n: _rolling(
        series, n, lambda s, lo, hi: _window_arg_extreme(s, lo, hi, lambda v, b: v > b)),
    "lowestbars": lambda series, n: _rolling(
        series, n, lambda s, lo, hi: _window_arg_extreme(s, lo, hi, lambda v, b: v < b)),
    "barssince": _fn_barssince,
    "valuewhen": _fn_valuewhen,
    # ⭐ THE PIVOTS, AND THE PREDICATE IS THE WHOLE DIFFERENCE BETWEEN THEM. The
    # STRICT comparison is what makes a plateau not a pivot; `>=` here would emit
    # both bars of a tie. See `closedTable.json::_functions_pivots`.
    "pivothigh": lambda series, left, right: _pivot_col(
        series, left, right, lambda v, w: v > w),
    "pivotlow": lambda series, left, right: _pivot_col(
        series, left, right, lambda v, w: v < w),
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
    "hma": lambda series, n: _hma_col(series, n),
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
    "adx": _fn_adx,
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
# the entries that read the BAR, not a column
# --------------------------------------------------------------------------- #
#
# ⭐⭐ ONE SESSION ACCUMULATOR, TWO NAMES. ``compute_vwap_raw`` is the ONLY
# session-VWAP in this lane -- it is what ``indicator_alert_evaluator`` fires on
# and what ``tests/fixtures/indicators`` pins against ``computeVWAP`` -- and the
# bindings below pass the bars straight to it. A formula's ``vwap()`` that
# disagreed with the VWAP the chart draws would be the most legible instance this
# repo could ship of ``a second authority over one value``.
#
# ⛔ THE DISPATCH IS DERIVED FROM THE MANIFEST (``bar_readers``), never from a
# name typed here, exactly as ``recurrences`` is -- see
# ``closedTable.json::_functions_bar_readers``. ``_BAR_FN``'s key set is asserted
# against it, both directions, so a declared-but-unbound entry fails by name
# instead of refusing inside the walker with a message about the wrong thing.


def _fn_vwap(bars: List[dict], args: Sequence[Any]) -> List[MaybeNum]:
    """``vwap()`` -- the shipped session accumulator, untouched.

    ⚠️ ITS LEADING PARTIAL SESSION IS INHERITED AND DELIBERATELY NOT TRIMMED.
    The first ET day in a series may start after its true open, so those bars
    move if the window moves. Trimming them HERE would fork this column away from
    the one the chart draws, which is worse than the caveat; it belongs to
    ``compute_vwap_raw`` and to whoever changes it, in both lanes at once.
    """
    return compute_vwap_raw(bars)


def _fn_avwap(bars: List[dict], args: Sequence[Any]) -> List[MaybeNum]:
    """``avwap(anchorEpoch)`` -- the same accumulator, restarted at an INSTANT,
    and bounded so that ``lookback: "session"`` is a TRUE declaration.

    ⛔ RULE 1 -- THE ANCHOR'S BOUNDARY MUST BE VISIBLE. Some bar of the series
    must fall strictly before the anchor. Otherwise "the first bar at or after
    the anchor" is whichever bar the caller happened to fetch first, and the
    value MOVES when the window moves -- ``lesson_a_derived_value_must_not_
    depend_on_the_request``, the exact defect ``_functions_recurrence`` says
    ``accum``'s re-seeded window exists to prevent.

    ⛔ RULE 2 -- AND IT MAY NOT REACH PAST THE WINDOW IT DECLARES. A raw epoch
    reaches back however far a member types, so ``lookback: "session"`` would
    UNDER-state it -- the one direction ``_functions_warmup`` says a window
    declaration may never take. Bars more than ``SESSION_MAX_BARS`` past the
    anchor are NOT COMPUTABLE, so every bar this answers for was computed from
    inside the window the manifest promises.

    Both are the ordinary warm-up bargain turned round. ⚠️ THEY ARE NOT THE SAME
    SHAPE, and saying so matters: RULE 1 refuses the WHOLE COLUMN (nothing about
    this series can be answered), while RULE 2 blanks only the TAIL past the
    declared window and leaves every bar inside it exact. Neither ever returns a
    partial accumulation, which would be a confident wrong number wearing a
    warm-up's clothes.
    """
    anchor = args[0]
    # ⛔ A SUB-1990 ANCHOR IS A UNIT ERROR IN THE TREE, AND IT IS REFUSED BY NAME
    # AT THE TOKEN. ``avwap(20250101)`` is the store's daily key spelled as an
    # instant; it resolves to 1970 and is wrong for EVERY symbol, on every
    # timeframe, forever -- a formula defect, not a per-symbol data condition,
    # and this lane's rule for a formula defect is a named refusal rather than a
    # quiet column. ``resolve:window`` already owns "this ``int`` argument is not
    # a value this slot can take".
    #
    # ⚠️ THE OTHER REFUSAL BELOW IS DELIBERATELY *NOT* NAMED, and the asymmetry
    # is the point: "no bar precedes the anchor" is true of ONE SYMBOL'S HISTORY,
    # not of the tree. Refusing it by name would make one short-history symbol
    # reject a formula that is correct for the rest of the universe.
    if (isinstance(anchor, (int, float)) and not isinstance(anchor, bool)
            and anchor < AVWAP_MIN_INSTANT):
        _refuse("resolve:window",
                f"— avwap argument 0 is {anchor}, which is not a unix-second "
                f"instant (the floor is {AVWAP_MIN_INSTANT}, 1990-01-01). A "
                "date-shaped key like 20250101 read as seconds anchors in 1970.")
    if not bars:
        return []
    first = bars[0].get("t")
    if isinstance(first, bool) or not isinstance(first, (int, float)):
        return []
    # ⭐ ``>=``, NOT ``>``. An anchor EXACTLY on the first bar is well-defined:
    # any wider fetch adds only bars with ``t < bars[0]["t"]``, and those are
    # strictly before the anchor, so they are excluded from the accumulation
    # whatever the window is. Refusing it was a NARROW OVER-REFUSAL -- corrected
    # 2026-08-26.
    if not anchor >= first:
        return []
    column = compute_avwap_raw(bars, anchor)
    ceiling = None
    for i, bar in enumerate(bars):
        t = bar.get("t")
        if isinstance(t, (int, float)) and not isinstance(t, bool) and t >= anchor:
            ceiling = i + SESSION_MAX_BARS
            break
    if ceiling is None:
        return column
    for i in range(ceiling + 1, len(column)):
        column[i] = None
    return column


def _bar_column(name: str, bars: List[dict], args: Sequence[Any],
                length: int) -> List[float]:
    """Run a bar-reading entry over the REAL bars and unpack a NaN-padded column.

    ⛔ A LENGTH MISMATCH IS ALL-NaN, NOT A PARTIAL FILL -- the same contract
    ``_bind_shipped`` states, against the same ``[]`` "there is nothing to say
    here" signal both refusals above return. A short list padded from the left
    would put a real value at the wrong bar.
    """
    out = _nan_col(length)
    values = _BAR_FN[name](bars, args)
    if not isinstance(values, list) or len(values) != length:
        return out
    for i in range(length):
        v = values[i]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        out[i] = NAN if math.isnan(float(v)) else float(v)
    return out


def _fn_obvn(bars: List[dict], args: Sequence[Any]) -> List[MaybeNum]:
    """``obvN(n)`` -- on-balance volume's CHANGE across the last ``n`` bars.

    ⭐⭐ IT READS THE BARS BECAUSE IT NAMES NO SERIES. OBV is close-and-volume by
    definition, so there is no column to hand it and ``_bind_shipped`` has nothing
    to pack -- the same absence of arguments that finally made ``vwap`` declarable.

    ⛔⛔ THE INCREMENT OF THE SHIPPED ACCUMULATOR, NEVER A SECOND SUM.
    ``compute_obv_raw`` is what the chart draws and what
    ``indicator_alert_evaluator`` fires on; differencing it ``n`` bars apart is
    the same arithmetic in one place instead of two, so ``obvN`` can never drift
    from the OBV a member sees beside it.

    ⭐ AND THE DIFFERENCE IS WHY THE BOUNDED FORM IS DECLARABLE WHERE THE LEVEL IS
    REFUSED (``_functions_excluded.obv``): the level's seed is a fact about where
    the fetch started, and it CANCELS -- the same bar reads the same number off a
    60-bar fetch and off a 260-bar one. The first ``n`` bars are NOT COMPUTABLE
    because their window reaches past the front of the fetch, which is exactly
    what ``lookback: "arg0"`` declares.
    """
    n = int(args[0])
    level = compute_obv_raw(bars)
    out: List[MaybeNum] = [None] * len(bars)
    if len(level) != len(bars):
        return out
    for i in range(n, len(bars)):
        near, far = level[i], level[i - n]
        if not (_is_number(near) and _is_number(far)):
            continue
        out[i] = float(near) - float(far)
    return out


def _fn_cum_from(bars: List[dict], args: Sequence[Any]) -> List[MaybeNum]:
    """``cumFrom(source, anchorEpoch, maxBars)`` -- a RUNNING TOTAL that is a
    fact about the market rather than about the fetch.

    ⭐⭐ THE WHOLE RULING IS ``closedTable.json::_functions_cumulative``; this is
    the half of it that runs. A cumulative sum is fixed only up to an ADDITIVE
    CONSTANT -- widen the fetch and every value shifts by the same amount -- so
    the fetch would otherwise be CHOOSING the answer. Naming an absolute anchor
    takes that choice away from it.

    ⛔ THE TWO REFUSALS ARE ``avwap``'S, AND THAT IS DELIBERATE: this is the same
    bargain applied to a sum the member names, not a new one. (1) The anchor's
    boundary must be VISIBLE -- it may not fall before the first fetched bar --
    else the WHOLE column is not computable, because "the first bar at or after
    the anchor" would otherwise be whichever bar the caller happened to fetch
    first. (2) A bar more than ``maxBars`` past the anchor bar is not computable,
    so ``lookback: "arg2"`` is a TRUE declaration rather than an under-stated one.

    ⭐ AND ``maxBars`` IS AN ORDINARY ``int`` WHERE ``avwap``'S CEILING IS THE
    SESSION, which is what keeps this composable. ``lookback: "session"`` is the
    WHOLE budget, so a session-declared version measures 961 for
    ``cumFrom(sign(change(close)) * volume, t)`` against a cap of 960 -- the
    anchored on-balance volume, the exact quantity this entry exists to make
    sayable, refused by the budget. Measured, not predicted: that is why the
    reach is an argument.

    ⛔ A STORE WHOSE ``ts`` IS A ``YYYYMMDD`` INT ANSWERS NOTHING, AND RULE 1
    IS WHAT DOES IT rather than a second magnitude guard: those bars all land in
    1970, strictly before any anchor the floor above accepts, so no bar is ever
    at or after the anchor. That is the scan lane's ``DEFAULT_TF = "D"`` case,
    and ``unresolved_inputs`` reports it NAMING ``cumFrom`` instead of letting a
    comparison launder the hole into a confident 0 (the X23 shape
    ``_functions_bar_readers`` measures for ``vwap``).

    ⛔ A HOLE IN ``source`` PROPAGATES AND IS STICKY. A total with an unknown
    term is unknown, and every later total contains that same unknown term -- so
    this never resumes after one. ``cumFrom(nz(x, 0), anchor, n)`` is how a
    member says "treat the missing bar as zero", and ``_functions_na`` is the
    argument for why that choice is theirs and visible rather than ours and
    silent.

    ⚠️ FIRST BAR READER TAKING A ``series``. ``args[0]`` is the already-evaluated
    column and ``bars`` is the real bar array -- the call site hands over both,
    so nothing here reaches for a fabricated ``t``.
    """
    src = args[0]
    anchor = args[1]
    max_bars = int(args[2])
    # ⛔ SAME NAMED REFUSAL ``_fn_avwap`` MAKES, AND FOR THE SAME REASON: a
    # sub-1990 "epoch" is a UNIT ERROR IN THE TREE -- wrong for every symbol, on
    # every timeframe, forever -- so it is a formula defect, and this lane
    # refuses a formula defect by name rather than drawing a quiet column.
    if (isinstance(anchor, (int, float)) and not isinstance(anchor, bool)
            and anchor < AVWAP_MIN_INSTANT):
        _refuse("resolve:window",
                f"— cumFrom argument 1 is {anchor}, which is not a unix-second "
                f"instant (the floor is {AVWAP_MIN_INSTANT}, 1990-01-01). A "
                "date-shaped key like 20250101 read as seconds anchors in 1970.")
    if not bars:
        return []
    # ⚠️ THE REFUSALS BELOW ARE DELIBERATELY *NOT* NAMED -- they are facts about
    # ONE SYMBOL'S BARS, not about the tree, and refusing them by name would make
    # one short-history symbol reject a formula that is right for the rest of the
    # universe.
    #
    # ⛔⛔ THE ``AVWAP_MIN_INSTANT`` CHECK ON THE BARS STAYS, AND THE ARGUMENT FOR
    # DELETING IT WAS TRUE OF ONE BAR AND FALSE OF AN ARRAY. ⚰️ THIS SAID a magnitude
    # check here "could never change an answer", because a ``YYYYMMDD`` int lands in
    # 1970, strictly before any anchor the floor above accepts, so no bar is ever at
    # or after it. Every clause of that is true PER BAR and it does not survive a
    # MIXED-UNIT array. Rule 1 below is ``anchor >= first``, and a date-shaped first
    # bar (20200101) is NUMERICALLY FAR BELOW the 1990 floor -- so rule 1 PASSES, the
    # date-shaped bars are skipped one at a time as "before the anchor", and the
    # epoch-shaped ones accumulate into a total that is finite, plausible, and
    # MISSING TERMS. That is the one outcome ``_functions_cumulative`` forbids in as
    # many words: "a level that moved because somebody scrolled is a lie with a
    # decimal point". A uniformly date-shaped store answers nothing either way, so
    # the guard changes exactly one case -- and turns it from a quiet wrong number
    # into an honest hole.
    # ⚠️ THE MUTATION RUN THAT CLEARED ITS DELETION IS WHY IT IS BACK, NOT WHY IT WENT:
    # every fixture in both lanes carried ONE unit, so no gate could distinguish the
    # two behaviours (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). The
    # mixed-unit case is now a fixture in BOTH lanes, so deleting this goes RED.
    #
    # ⭐ THE TYPE CHECK STAYS AND IT REALLY FIRES: a bar carrying no ``t`` at all
    # would raise from the comparison below, and a walker must answer NOT
    # COMPUTABLE rather than crash on one bad row.
    for bar in bars:
        t = bar.get("t")
        if isinstance(t, bool) or not isinstance(t, (int, float)):
            return []
        if t < AVWAP_MIN_INSTANT:
            return []
    first = bars[0]["t"]
    # ⭐ ``>=``, NOT ``>`` -- an anchor EXACTLY on the first bar is well defined:
    # any wider fetch adds only bars strictly before it, which this sum excludes
    # whatever the window is. The same correction ``_fn_avwap`` already carries.
    if not anchor >= first:
        return []
    out: List[MaybeNum] = [None] * len(bars)
    started = -1
    running = 0.0
    broken = False
    for i, bar in enumerate(bars):
        if bar["t"] < anchor:
            continue
        if started < 0:
            started = i
        # ⛔ RULE 2 -- counted from the ANCHOR BAR, never from the front of the
        # fetch, which is exactly what makes the ceiling land on the same MARKET
        # bar however many bars the caller brought.
        if i > started + max_bars:
            break
        v = src[i] if src is not None and i < len(src) else NAN
        if not (_is_number(v) and math.isfinite(float(v))):
            broken = True
            continue
        if broken:
            continue
        running += float(v)
        out[i] = running
    return out


def _aroon_col(bars: List[dict], n: int, field: str, want_max: bool) -> List[MaybeNum]:
    """Chande's Aroon, from the published formula and this table's own arg-extreme.

    ⭐ THE PUBLISHED FORM, VERBATIM (StockCharts):
    ``Aroon-Up = ((25 - Days Since 25-day High)/25) x 100``. "Days Since" is the
    number of periods elapsed since the most recent extreme -- which is exactly
    what ``_window_arg_extreme`` returns, because ``_functions_arg_extreme``
    ruled that the MOST RECENT bar wins a tie.

    ⛔ THE WINDOW IS ``n + 1`` BARS, AND THAT IS ARITHMETIC RATHER THAN A CHOICE.
    Aroon's published range is 0-100. Over ``n`` bars "days since" maxes at
    ``n - 1`` and the indicator could never print 0; over ``n + 1`` it reaches
    exactly 0 on the bar whose extreme sits at the far edge. Pine ships the same
    reading (``ta.highestbars(high, length + 1)``).

    ⭐ AND THE SIGN QUESTION FROM W2a.5 CLOSES HERE. Pine's ``highestbars`` is
    NON-POSITIVE and this table's is the positive distance, so Pine writes
    ``100 * (hb + n) / n`` where this writes ``100 * (n - hb) / n``. The two look
    opposite and compute the SAME number -- which is precisely why
    ``ta.highestbars`` is refused at the Pine door rather than mapped across.
    """
    values = [_number(b.get(field)) if _is_number(b.get(field)) else NAN for b in bars]
    better = (lambda v, w: v > w) if want_max else (lambda v, w: v < w)
    out: List[MaybeNum] = [None] * len(bars)
    for i in range(n, len(bars)):
        days = _window_arg_extreme(values, i - n, i, better)
        if math.isnan(days):
            continue
        out[i] = 100.0 * (n - days) / n
    return out


def _fn_aroon_up(bars: List[dict], args: Sequence[Any]) -> List[MaybeNum]:
    return _aroon_col(bars, int(args[0]), "h", True)


def _fn_aroon_down(bars: List[dict], args: Sequence[Any]) -> List[MaybeNum]:
    return _aroon_col(bars, int(args[0]), "l", False)


def _fn_bop(bars: List[dict], args: Sequence[Any]) -> List[MaybeNum]:
    """Balance of Power -- the ``n``-bar mean of ``(close - open) / (high - low)``.

    ⭐ DECLARED THOUGH IT IS A COMPOSITION, AND THE CRITERION IS STATED HERE.
    ⚰️ This cited a manifest key named ``_functions_compositions`` and NO SUCH KEY
    HAS EVER EXISTED -- one ruling, three comments in two lanes, all pointing at a
    manifest that never carried it, so the criterion lived only in a commit
    message. The manifest owns the NEGATIVE half in
    ``closedTable.json::_functions_excluded`` (``variance``, ``hl2``, ``bbMiddle``:
    already expressible, so declaring one would compute a second copy of a number
    this table already has). The POSITIVE half belongs at the implementation, and
    that is here: ``bop`` earns an entry because it has a PUBLISHED IDENTITY under
    its own name, its window is a single declarable argument, and it reuses the
    shipped rolling mean -- so unlike ``variance`` there is no second average that
    could drift from the one ``sma`` uses.
    ⛔ ``tests/test_closed_table_citations.py`` now resolves every
    ``closedTable.json::<key>`` written in source against the manifest, so the next
    dangling citation fails by file AND key instead of standing for a month.

    ⛔ THE RATIO IS BUILT THROUGH THE SAME TWO SEAMS THE OPERATOR PATH USES --
    ``_binary_div`` for IEEE division and the finite-or-NaN collapse ``_to_column``
    applies -- so a zero-range bar answers exactly what
    ``sma((close - open) / (high - low), n)`` answers, rather than nearly.
    """
    n = int(args[0])
    ratio = []
    for b in bars:
        o, h, l, c = (b.get("o"), b.get("h"), b.get("l"), b.get("c"))  # noqa: E741
        if not all(_is_number(v) for v in (o, h, l, c)):
            ratio.append(NAN)
            continue
        ratio.append(_finite_or_nan(
            _binary_div(_number(c) - _number(o), _number(h) - _number(l))))
    col = _rolling(ratio, n, _window_mean)
    return [None if math.isnan(v) else v for v in col]


#: name -> ``(bars, args) -> column``. Keys asserted against ``bar_readers()``.
_BAR_FN: Dict[str, Callable[[List[dict], Sequence[Any]], List[MaybeNum]]] = {
    "vwap": _fn_vwap,
    "avwap": _fn_avwap,
    "obvN": _fn_obvn,
    "cumFrom": _fn_cum_from,
    "aroonUp": _fn_aroon_up,
    "aroonDown": _fn_aroon_down,
    "bop": _fn_bop,
}

#: The declared set, read off the manifest. ``parse.js::BAR_READERS`` is the same
#: read on the same declaration.
BAR_READERS: tuple = bar_readers()

if set(BAR_READERS) != set(_BAR_FN):
    raise RuntimeError(
        "closedTable.json declares reads:'bars' for "
        f"{sorted(BAR_READERS)} and ast_interpret binds {sorted(_BAR_FN)}. A "
        "declared-but-unbound entry is a formula the builder offers and this "
        "lane cannot evaluate; a bound-but-undeclared one is a callable outside "
        "the closed table.")


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
        if node["type"] in ("op", "call", "offset", "tf", "sym", "tf_live"):
            args = node.get("args")
            if not isinstance(args, list):
                _refuse("interpret:node",
                        f"a {node['type']} node carries an `args` array; got {args!r}")
            for arg in args:
                stack.append(arg)
    order.reverse()          # a reversed pre-order puts every child before its parent
    return order


def symbols_named(ast: Any) -> tuple:
    """Every OTHER instrument a tree reads, sorted — the `sym` tickers in it.

    ⭐⭐ ONE WALKER, TWO CONSUMERS, AND THAT IS THE POINT. The scan GATE asks it to
    decide whether every named symbol is a declared benchmark; the SWEEP asks it
    to decide which series to load. Two walkers would be two answers to *"which
    instruments does this formula read?"* — and the pair could disagree in the
    quietest possible way: a gate that admitted a ticker the loader never fetched
    would return `not_computable` on every row of a scan it had just promised was
    runnable (`lesson_a_second_authority_over_one_value`).

    ⚠️ UPPERCASED AND DEDUPED, because `sym('spy', …)` and `sym('SPY', …)` name one
    instrument and must load one series — the evaluator upper-cases before it
    looks the series up, so anything else here would miss.
    """
    found = set()
    for node in _flatten(ast):
        if node["type"] == "sym":
            found.add(str(node.get("value")).strip().upper())
    return tuple(sorted(found))


def session_anchored_in(ast: Any) -> tuple:
    """Every call in a tree whose entry declares ``lookback: "session"``, sorted.

    ⭐ EXPORTED FOR THE MESSAGE, NOT FOR A DECISION. ``ast_budget`` refuses on
    the NUMBER, exactly as it always has; this only lets the refusal say WHY the
    formula a member types first -- ``crossOver(close, vwap())`` -- is one bar
    over. A session-anchored call spends the WHOLE lookback budget by
    construction (the cap is derived to hold one session), so anything wrapped
    around it is over by the width of the wrapper.

    ⛔ IT NAMES, IT DOES NOT EXEMPT.
    """
    found = set()
    stack = [ast]
    functions = TABLE[FUNCTIONS_SECTION]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        name = node.get("name")
        if node.get("type") == "call" and isinstance(name, str)                 and name in functions                 and functions[name].get("lookback") == SESSION_LOOKBACK:
            found.add(name)
        args = node.get("args")
        if isinstance(args, list):
            stack.extend(args)
    return tuple(sorted(found))


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


def _assert_arg_roles(node: dict, spec: Mapping[str, Any]) -> None:
    """Refuse an argument whose declared ROLE demands a kind it does not yield.

    ⭐ THE ANSWER IS ``scan_definition.arg_role_violation``, WHICH ASKS THIS
    LANE'S ONE ``yields`` RESOLVER (``is_boolean_tree``). The rule lives beside
    that resolver; the GUARD lives here, because the refusal vocabulary belongs
    to the walker that owns ``REFUSALS``.

    ⚠️ IMPORTED INSIDE THE CALL, AND THAT IS NOT STYLE. ``scan_definition``
    imports THIS module at its top, so a module-level import here is a cycle --
    the same arrangement ``definition_concierge._cadence_ceiling`` uses. After
    the first call it is a ``sys.modules`` lookup.
    """
    from api.services import scan_definition
    bad = scan_definition.arg_role_violation(node, spec)
    if bad is None:
        return
    _refuse("resolve:condition",
            f"— {node.get('name')} argument {bad['index']} is its "
            f"{bad['role']}: compare it to something, or use a name this "
            f"table declares as yielding 0/1")


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


#: name → the CEILING DECLARATION its argument domain points at, read off the
#: manifest. ⛔ NEVER A NAME TYPED HERE: a hand-list would be the thing
#: ``_functions_domain`` exists to retire, and it would be the SECOND copy of it
#: because the JS lane would need its own.
_ARG_DOMAINS: Mapping[str, str] = arg_domains()


def _assert_arg_domain(node: dict, spec: Mapping[str, Any]) -> None:
    """⭐⭐ THE ARGUMENT DOMAIN THE MANIFEST DECLARES, ENFORCED AT THE RESOLVE
    PASS — because ``int`` can say "a whole number" and cannot say "no larger
    than that one".

    🔴 THE DEFECT THIS CLOSES (X41). ``macd(close, 26, 12)`` is the 12/26 pair
    transposed -- one keystroke -- and both walkers answer an ALL-NaN COLUMN for
    it by declaration. A comparison then eats the hole:
    ``close > macd(close, 26, 12)`` measured **0.0 on all 60 bars, one distinct
    value**, with ``unresolved_inputs() == []``, ``unresolved_lookback() == 0``
    and ``assert_scannable`` calling it a ``bool`` tree. The screen was savable,
    every symbol was reported ANSWERED, and nothing anywhere said the formula was
    meaningless -- a member reads "0 matches" as a quiet market. The Ichimoku five
    carry the same shape whenever ``max(tenkan, kijun) > senkouB``.

    ⛔ IT IS A FORMULA DEFECT, SO IT IS DECIDED WHERE THE FORMULA IS ADMITTED AND
    NOWHERE ELSE. ``fast > slow`` is true of that tree on every bar, for every
    symbol, forever -- a per-row check would carry a decision that cannot vary by
    row and would pay for it 3,742 times a night. This is exactly the line
    ``_fn_avwap`` already draws: its sub-1990 anchor is refused BY NAME
    (``resolve:window``) while "no bar precedes the anchor" stays a quiet per-row
    column, *"and the asymmetry is the point"*.

    ⛔ AND IT DOES NOT REPLACE THE ADAPTERS' NaN. ``_fn_macd`` and
    ``_ichimoku_line`` still answer an all-NaN column, because they are also
    reachable directly and the two shipped implementations disagree about the
    out-of-order case (one returns empty columns, the other throws a
    ``TypeError`` off a negative index). What changed is that a TREE carrying one
    no longer resolves.

    ⚠️ EVERY ``int`` SLOT IS READ IN INDEX ORDER FIRST, so ``resolve:window``
    still wins on a slot that is not a literal at all: a call whose window cannot
    be read has no periods to compare, and reporting the later door would measure
    traversal order instead of the defect.
    """
    declaration = _ARG_DOMAINS.get(node.get("name"))
    if declaration is None:
        return
    # ⛔ THE SAME ``argN`` GRAMMAR ``_own_lookback`` READS, not a second one -- and
    # a declaration that names no argument (``0``, ``"session"``) has no ceiling
    # to compare against, so it is left alone rather than given a fabricated slot.
    # ⚠️ A MULTIPLIER (``2*arg3``) NAMES THE SAME ARGUMENT: this compares PERIODS,
    # and ``adx``'s doubled REACH says nothing about which slot holds the larger.
    m = _LOOKBACK_RE.fullmatch(str(declaration))
    if m is None:
        return
    ceiling = int(m.group(2))
    if spec["args"][ceiling] != "int":
        return
    values: List[Optional[int]] = []
    for i in range(len(spec["args"])):
        values.append(_window_literal(node, i) if spec["args"][i] == "int" else None)
    roles = spec.get("argRoles")

    def _role(i: int) -> str:
        if isinstance(roles, (list, tuple)) and i < len(roles) and isinstance(roles[i], str):
            return roles[i]
        return "period"

    for i, value in enumerate(values):
        if i == ceiling or value is None or value <= values[ceiling]:
            continue
        _refuse("resolve:domain",
                f"— {node.get('name')} argument {i} is its {_role(i)} at {value}, past "
                f"argument {ceiling}, its {_role(ceiling)}, at {values[ceiling]}. This entry "
                f"declares {spec[ARG_DOMAIN]} `{declaration}`, so every other period must fit "
                f"inside it — put the larger one in argument {ceiling}. As written, this call "
                "computes nothing on any bar.")


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


#: A declared lookback: ``arg3`` or a whole multiple of one, ``2*arg3``.
#: ⛔ MIRRORS `interpret.js::ownLookback` EXACTLY. Every form one lane accepts the
#: other must accept identically — `tests/test_ast_lookback_parity.py` measures it
#: on the shipped manifest, because a lane that reads `2*arg3` as `arg3` would
#: fetch half the bars ADX needs and answer from data it never had.
_LOOKBACK_RE = re.compile(r"(?:(\d+)\s*\*\s*)?arg(\d+)\Z")


def _own_lookback(node: dict, spec: Mapping[str, Any]) -> int:
    """The declared lookback of ONE call node: a constant, a named argument, or a
    whole MULTIPLE of a named argument (``"2*arg3"``).

    ⭐ The multiple exists because ``adx`` could not be declared without it: its
    first value lands on bar ``2 * period - 1``, and the table could previously
    only say "one of my arguments". Over-stating a window costs extra NaN at the
    left edge; UNDER-stating hands back numbers computed from bars that were never
    fetched, which is why the indicator was withheld rather than mis-declared.

    ⭐⭐ AND ONE FORM THAT IS NEITHER A CONSTANT NOR AN ARGUMENT -- ``"session"``,
    checked BEFORE the regex. It resolves to ``SESSION_MAX_BARS``, which is read
    off the manifest so that ``ast_lint`` -- a module that may not import this one
    -- resolves it to the same number. That is the only arrangement in which the
    two ``max_lookback`` implementations can go on agreeing.
    """
    lb = spec.get("lookback")
    if _is_number(lb):
        return int(lb)
    if lb == SESSION_LOOKBACK:
        return SESSION_MAX_BARS
    m = _LOOKBACK_RE.fullmatch(str(lb))
    if m is None:
        _refuse("interpret:node",
                f"{node.get('name')!r} declares lookback {lb!r}, which is neither a "
                "constant nor an argument")
    times = int(m.group(1)) if m.group(1) else 1
    return times * _window_literal(node, int(m.group(2)))


def max_lookback(ast: Any) -> int:
    """How many bars of history the tree needs. A TREE SUM, never a dataflow pass.

    ⭐ THE SUM IS ALONG THE PATH, WHICH IS THE CASE A PER-ARGUMENT CHECK MISSES.
    ``sma(sma(close, 5000), 5000)`` needs 10,000 bars and neither 5,000 alone
    exceeds anything — ``escapes.json::nested_lookback`` exists for precisely
    that, and nothing else in that corpus catches it.

    ⚠️ THIS IS A MEASUREMENT, NOT A GUARD. Refusing a tree that asks for too much
    needs a DECLARED budget, and ``compute.budget`` is not declared yet.
    """
    # ⛔ THE SAME TREE-SHAPE RULE `interpret` ASKS, from the gate that runs
    # FIRST. `assert_scannable` calls this and never calls `interpret`, so without
    # it a `tf(sym(…))` definition would be accepted up front and then refused
    # once per symbol across the whole universe — the split fixed in 06333cb48.
    _assert_sym_placement(ast)
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
        if kind == "tf":
            # ⭐ THE TREE SUM, IN BASE BARS. The child's lookback is counted in
            # HIGHER-timeframe bars, so it is multiplied by the span; the +1 is the
            # bar this node always steps back to reach the last CLOSED period.
            # ⚠⚠ ROUNDING UP IS THE SAFE DIRECTION and it is why the ratio is a
            # constant rather than a measurement: a lookback that is too SMALL lets
            # a tree claim it needs fewer bars than it reads and answer off a warmup
            # it never had.
            # ⛔ ASK FIRST, and by the SAME authority `interpret` uses. A code
            # this engine cannot resample is refused HERE, so every up-front gate
            # that runs `max_lookback` — `assert_scannable`, and the sweep's own
            # pre-flight — refuses the definition ONCE, by name, instead of
            # accepting it and then failing every symbol in the universe.
            code = str(node.get("value"))
            _assert_resamplable(code)
            span = TF_BASE_BARS[code]
            seen[id(node)] = (seen[id(node["args"][0])] + 1) * span
            continue
        if kind == "tf_live":
            # ⭐ THE FORMING PERIOD, SO THERE IS NO `+1`: a base bar reads the bucket
            # it is IN, not the one before it. Everything else is the `tf` arm's
            # arithmetic — the child is counted in higher-timeframe bars, so it is
            # multiplied by the span, rounded UP because a lookback that is too
            # small answers off a warmup it never had.
            code = str(node.get("value"))
            _assert_resamplable(code)
            seen[id(node)] = max(1, seen[id(node["args"][0])] * TF_BASE_BARS[code])
            continue
        if kind == "sym":
            # ⭐ THE CHILD'S OWN, UNMULTIPLIED. One benchmark bar per base bar —
            # same timeframe, so there is no span factor and no +1: `sym` changes
            # WHICH INSTRUMENT, not which period. (Contrast the `tf` arm directly
            # above, whose whole arithmetic exists because its child is counted in
            # higher-timeframe bars.)
            # ⚠️ THE WARMUP IS THE BENCHMARK'S, and the caller is what must honour
            # it: a supplier that hands over fewer bars than this asks for gets a
            # NaN prefix from the child, which is `not_computable` and correct —
            # never a confident answer off a warmup it never had.
            seen[id(node)] = seen[id(node["args"][0])]
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
        # ⛔ THE RESOLVE PASS IS WHERE THE DECLARED ARGUMENT DOMAIN IS DECIDED,
        # and this pass is the reason it lands at every door at once:
        # ``check_budget`` inside ``interpret``, the concierge's ``_validate``,
        # ``assert_scannable`` and the sweep's own one-shot resolve all run THIS
        # function, so a transposed ``macd`` is refused once per formula rather
        # than once per symbol. AFTER the loop above, so ``resolve:window`` still
        # owns a slot that is not a literal.
        _assert_arg_domain(node, spec)
        # ⚰️⚰️ AND THE ROLE CHECK BESIDE IT, FOR THE REASON THE COMMENT ABOVE
        # ALREADY GIVES. `_assert_arg_roles` lived ONLY in `interpret`, and
        # `assert_scannable` runs THIS function and never that one — so
        # `barssince(close, 100) > 5` was stamped **scannable: true** on the
        # member's saved-scan list while every row of the sweep refused at
        # `resolve:condition`. The member is told the scan will run; it answers
        # nothing, for every symbol, forever, and the receipt blames the universe.
        #
        # ⛔ THAT IS THE IDENTICAL DEFECT `_assert_resamplable` WAS WRITTEN TO
        # CLOSE, three arms up in this same walk, and its docstring describes this
        # exact outcome for `tf(close, '60')`. The hardening pass that put
        # `_assert_arity` and `_assert_arg_domain` here missed this one, so the
        # shape survived in a second check while its first instance was being
        # documented as fixed.
        #
        # ⚠️ `barssince`/`valuewhen` are why the role check exists at all: with
        # a price where a condition belongs, `barssince` answers 0.0 on EVERY bar
        # (a price is never zero) — plausible on every bar and wrong on every bar.
        # Catching that in `interpret` alone still let it be SAVED and SCANNED.
        _assert_arg_roles(node, spec)
        seen[id(node)] = _own_lookback(node, spec) + best
    return seen[id(ast)]


def unresolved_scalars(ast: Any,
                       scalars: Optional[Mapping[str, Any]] = None) -> List[str]:
    """The declared scalars this tree names that have NO usable value here.

    🔴 THIS EXISTS BECAUSE A COMPARISON EATS THE HOLE, AND THAT IS MEASURED
    RATHER THAN FEARED. ``_cmp`` answers **0** when either side is NaN --
    *"A COMPARISON AGAINST NaN IS 0, NOT NaN ... the one place JS and Python
    agree by luck"* -- and that rule is correct for a bar warmup (the crossing
    did not happen) and PINNED by the frozen cross-lane digests in
    ``tests/fixtures/ast/conformance_log.json``. Applied to a scalar it is the
    ``scan_volume._job`` bug at the leaf: with no market cap,

        interpret(market_cap > 1e9)        -> [0.0, 0.0, ...]   a confident False
        interpret(market_cap)              -> [None, None, ...] the honest hole

    So the hole is visible at the LEAF and invisible one node up, and a sweep
    that read the column would count a symbol it knows nothing about as a symbol
    that did not match. ⛔ THE ANSWER IS NOT TO CHANGE `_cmp` — but NOT for the
    reason this docstring used to give.

    ⚰️ IT SAID *"PINNED BY 17 FROZEN CROSS-LANE DIGESTS"* AND *"propagating NaN
    through comparisons would move EVERY digest in the conformance log"*. Both
    halves are wrong, and the second is the expensive one. The count went stale
    the first time a case was added (point at the log, which owns the number, and
    write none here); the COST was measured by W9a at **270 of 53,847 rows,
    0.501%**, and the rows that move are exactly the warm-up prefix. ⛔ A WRONG
    COST ESTIMATE THAT DISCOURAGES A CHEAP FIX IS ITS OWN DEFECT CLASS — this
    branch has already paid for it once, on a security fix priced at *"~40 rows in
    an unowned file"* and measured at ONE.

    ⭐ THE RULING IS UNCHANGED AND IT RESTS ON THE OTHER HALF: answering 0 against
    NaN is CORRECT for a bar warm-up — the crossing did not happen — so changing
    it would change what a warm-up MEANS on every chart. The member-facing hole is
    closed by asking THIS question BEFORE evaluating, which is why it is a
    function and not a comment.

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


def _usable_at(column: List[MaybeNum], at: int) -> bool:
    """Is there a real number at ``at``? An out-of-range bar is NOT usable.

    ⛔ OUT OF RANGE IS A HOLE, NEVER A SKIP. ``close > vwap()[900]`` on 400 bars
    reads a bar that does not exist; answering "usable" there is the confident-0
    the whole pre-pass exists to refuse, one index further left.
    """
    if not (-len(column) <= at < len(column)):
        return False
    v = column[at]
    return _is_number(v) and math.isfinite(float(v))


def _bar_reader_reads(ast: Any) -> Dict[str, List[tuple]]:
    """name -> [(call node, {bars of backward offset above it})].

    ⭐ THE OFFSETS ON THE PATH, NOT JUST THE NODE. ``vwap()[3]`` reads the bar
    THREE BACK from the one the caller names, so a pre-pass that asked about the
    caller's bar would be asking about a different bar than the walker answers
    from -- the exact defect ``index`` and ``opts`` are threaded through to avoid,
    one axis over. The set is a SET because one node may be reached at two depths
    (``vwap()[1] > vwap()[5]`` where the parser shares the subtree), and every
    position it is read at has to be answerable.

    ⚠️ NOT REACHABLE TODAY, AND WRITTEN ANYWAY. Two unrelated guards happen to
    cover it: a ``lookback: "session"`` entry cannot be wrapped in an offset at
    all (``budget.maxLookback`` is ``sessionMaxBars``, so ``avwap()[40]`` refuses
    ``budget:lookback``), and for a windowed entry ``unresolved_lookback`` is
    non-zero exactly while the offset bar is inside the warm-up prefix. A guard
    that is correct because two other guards happen to overlap it is correct by
    luck, and the first anchored entry with a small declared lookback breaks both.

    ⛔ ITERATIVE, for the same reason ``node_count`` is: this runs BEFORE the
    walker and must not need the walker to be safe first.
    """
    reads: Dict[str, List[tuple]] = {}
    seen: Dict[int, set] = {}
    stack: List[tuple] = [(ast, 0)]
    while stack:
        node, back = stack.pop()
        if not isinstance(node, dict):
            continue
        kind = node.get("type")
        if kind == "call" and node.get("name") in BAR_READERS:
            if id(node) not in seen:
                seen[id(node)] = set()
                reads.setdefault(node["name"], []).append((node, seen[id(node)]))
            seen[id(node)].add(back)
        deeper = back + (_offset_bars(node) if kind == "offset" else 0)
        for arg in node.get("args") or ():
            stack.append((arg, deeper))
    return reads


def unresolved_inputs(ast: Any,
                      scalars: Optional[Mapping[str, Any]] = None,
                      bars: Optional[List[dict]] = None,
                      index: Optional[int] = None,
                      opts: Optional[Mapping[str, Any]] = None) -> List[str]:
    """Every declared INPUT this tree names that has no usable value HERE.

    ⛔ THE SET IS ``BAR_READERS`` ∪ THE DECLARED SCALARS. SAY IT PLAINLY,
    BECAUSE IT IS NARROWER THAN "EVERY INPUT THAT CAN BE A HOLE" AND THE NAME OF
    THIS FUNCTION DOES NOT SAY SO. ``unresolved_scalars`` asks *"which declared
    SCALARS does this tree name that have no value on this row?"*; this adds
    *"...and which entries declaring ``reads: "bars"`` cannot answer at the bar we
    are about to read?"* Those two, and nothing else. What that leaves open is
    written out below rather than left for a later lane to rediscover.

    ⭐ WHY EXACTLY THAT SET, AND WHY IT IS DERIVED. A ``reads: "bars"`` entry
    answers from a property of the BARS that neither neighbouring question can
    express: ``vwap()`` refuses the whole column when a bar's ``t`` is not a real
    instant (``VWAP_MIN_INSTANT``), and ``avwap(anchor)`` refuses it when no bar
    precedes the anchor and blanks the tail past ``SESSION_MAX_BARS``. Those are
    facts about ONE SYMBOL'S BARS, which is what makes them a per-row question at
    all. So the set is ``BAR_READERS`` -- read off ``closedTable.json`` by
    ``ast_table.bar_readers``, exactly as the walker's own dispatch is -- and a
    third such entry is covered the day it lands, with no edit here and none in
    the rail. (``obvN`` landed from a parallel lane while this was being written
    and was covered with no edit to either.)

    ⛔⛔ WHAT THIS DOES NOT COVER, MEASURED AND NAMED. An earlier draft claimed
    every other entry's holes came from its arguments or its declared
    ``lookback``. **THAT WAS FALSE TWICE OVER**. One of the two is now CLOSED
    somewhere else; the other is still open and is still an ordinary member
    spelling that returns NOTHING or THE ENTIRE UNIVERSE at full reported
    coverage.

    (1) ⚰️ A DECLARED ARGUMENT DOMAIN (``closedTable.json::_functions_domain``)
    -- **CLOSED 2026-08-27 AT THE RESOLVE PASS, NOT HERE, WHICH IS WHY THIS ENTRY
    IS KEPT.** ``macd(close, 26, 12)`` -- ``fast > slow``, a transposition of the
    canonical 12/26 pair -- was an all-NaN column in BOTH walkers by declaration,
    and on 400 bars::

        interpret(close > macd(close, 26, 12))  -> [0.0, ...]   every bar
        interpret(!(close > macd(close,26,12))) -> [1.0, ...]   every bar

    ...with ``unresolved_inputs() == []``, ``unresolved_lookback() == 0`` and
    ``assert_scannable`` calling it a ``bool`` tree. ⭐ THE RULING WAS THAT
    ``fast > slow`` is a FORMULA defect -- true of that tree on every bar, for
    every symbol, forever -- so it belongs where the formula is ADMITTED, exactly
    as ``_fn_avwap`` refuses a sub-1990 anchor BY NAME (``resolve:window``) while
    leaving "no bar precedes the anchor" a quiet per-row column, *"and the
    asymmetry is the point"*. Answering it HERE would have made a question asked
    3,742 times a night carry a decision one look at the tree settles. It is now
    ``resolve:domain`` in ``max_lookback`` / ``maxLookback``, so the tree does not
    resolve and nothing reaches this function at all -- **this set did not grow.**

    (2) ⭐ A DATA-DEPENDENT HOLE IN AN ORDINARY FUNCTION -- and this one is NOT a
    formula defect, so the argument above does not cover it. ``valuewhen`` holes
    wherever its condition has not been true inside its window. Measured on 60
    daily bars, ``valuewhen(close < 15, close, 10)``::

        holes at bars 14..59      ← NOT a leading prefix. Values at the FRONT,
                                     holes to the END -- the INVERSE of a warmup.
        close > valuewhen(...)    -> 0.0 at the last bar, every symbol ANSWERED
        unresolved_inputs         -> []      (it is not a bar reader)
        unresolved_lookback       -> 0       (60 bars, declared window 10)

    ⛔⛔ AND THE MANIFEST CANNOT CURRENTLY TELL IT FROM ``sma``. Both declare
    ``lookback: "argN"`` and ``yields: "num"``; the 57 entries carry only
    ``args``/``argRoles``/``lookback``/``yields``/``sentence`` plus ``recurrence``
    (1), ``reads`` (3), ``cadence`` (2) and ``forward`` (1). **There is no
    declaration that separates "holes only inside its declared window" from "can
    hole at any bar"**, so widening this set correctly needs a NEW DECLARATION in
    ``closedTable.json`` -- not a name added here, which is the list-that-rots
    shape this whole function was written against. ``barssince`` is NOT in the
    class: it declares a fallback and answers its period rather than a hole.

    ⛔ BOTH GAPS ARE PINNED AS TESTS, NOT AS THIS PARAGRAPH.
    ``tests/test_scan_not_computable_inputs.py`` carries one case per gap, each
    going RED the day its fix lands and naming the comments that go stale with
    it. The manifest note this function sits under already carried a ⚰️
    correction promising *"this paragraph cannot rot again"* -- and it rotted.
    Prose that declares itself rot-proof is still prose.

    ⛔ AND THE VERDICT IS THE BINDING'S, NOT A SECOND COPY OF ITS RULES. This
    asks the entry by EVALUATING IT -- the same ``interpret`` the sweep is about
    to run -- and reports it unresolved when the value at the bar the caller will
    read is not a finite number. Restating ``VWAP_MIN_INSTANT`` or ``avwap``'s two
    refusals here would be a second authority over one value: the rules would then
    live in two places and the first thing to diverge would be the one this
    function exists to catch.

    🔴 MEASURED, WHICH IS WHY THIS IS A FUNCTION AND NOT A COMMENT. On bars
    built exactly as ``scan_evaluator._read_bars`` builds them for ``tf="D"`` --
    the store's ``ts`` is a ``YYYYMMDD`` int, so the unit gate refuses::

        interpret(vwap())                  -> [None, ...]   the honest hole
        interpret(close > vwap())          -> [0.0, ...]    a confident NO
        interpret(!(close > vwap()))       -> [1.0, ...]    a confident YES

    ⛔ BOTH POLARITIES, AND THAT IS THE WHOLE DEFECT. The screen returns NOTHING
    at full reported coverage, or THE ENTIRE UNIVERSE at full reported coverage,
    and ``scan_evaluator``'s own ``math.isfinite`` test never fires because ``0.0``
    and ``1.0`` are perfectly finite. Tracked as X23.

    ⚠️ ``bars is None`` ASKS THE SCALAR HALF ONLY, and says so rather than
    pretending the bar half was clean. A caller that has bars and does not pass
    them gets a question that cannot fail, which is why
    ``tests/test_scan_not_computable_inputs.py`` rails the sweep's call site by
    AST rather than trusting the signature.

    ⚠️ ``index`` IS THE BAR THE ANSWER WILL BE READ FROM, and the two readings
    are not the same question. With an ``index`` this asks *"is there a value AT
    THAT BAR"* -- which is what a screen needs, and the only reading that catches
    ``avwap``'s blanked tail past ``SESSION_MAX_BARS``. With ``index=None`` it
    asks the weaker *"is there a value ANYWHERE in this column"*, for a caller
    that has no single bar in mind. ``scan_evaluator`` passes the index it is
    about to read; the AST rail above is what keeps that true.

    ⚠️ PYTHON-ONLY, DECLARED RATHER THAN FORGOTTEN -- inherited from
    ``unresolved_scalars`` and still TRUE after this widening. Its consumer is the
    server-side universe sweep, which owes a member a coverage receipt; a browser
    evaluates ONE symbol, holds its own bars, and DRAWS a hole as a gap in the
    line. There is no receipt to protect there, so a mirrored JS export would be
    a callable nothing calls.

    Returns a STABLE order so a member's detail line reads the same way every
    night: the scalars in the manifest's own order (``unresolved_scalars``'s), then
    the bar readers ALPHABETICALLY -- ``ast_table.bar_readers`` returns
    ``tuple(sorted(...))``, and calling that "the manifest's order" would be a
    claim this function does not make good on.
    """
    out = list(unresolved_scalars(ast, scalars))
    if bars is None:
        return out
    reads = _bar_reader_reads(ast)
    for name in BAR_READERS:
        for node, backs in reads.get(name, ()):
            # ⛔ THE SAME SCALARS AND THE SAME CLOCK THE ANSWER WILL BE COMPUTED
            # UNDER. Latent today -- no declared bar reader takes a ``series``
            # argument, so no scalar can reach one -- but a pre-pass evaluating a
            # subtree under a DIFFERENT environment than the walker is a second
            # authority over one value, and it would silently break the "covered
            # the day it lands" promise for the first bar reader that takes one.
            column = interpret(node, bars, scalars=scalars, opts=opts)
            if index is None:
                usable = any(_is_number(v) and math.isfinite(float(v))
                             for v in column)
            else:
                usable = all(_usable_at(column, index - back) for back in backs)
            if not usable:
                out.append(name)
                break
    return out


def unresolved_lookback(ast: Any, bars: Optional[List[dict]]) -> int:
    """How many bars SHORT this series is of what the tree declares it reads.
    ``0`` means the history is sufficient.

    🔴 THIS EXISTS FOR THE SAME REASON ``unresolved_scalars`` DOES, ONE AXIS
    OVER — and it was measured, not feared. ``_cmp`` answers **0** when either
    side is NaN, which is correct for a warmup on the chart (the crossing did not
    happen) and is pinned by the frozen cross-lane digests in
    ``tests/fixtures/ast/conformance_log.json``. Applied to a tree the
    series is too SHORT to answer, it is a confident False forever. Evaluated on
    200 real AAPL bars:

        interpret(sma(close, 300))          -> 200 x None      the honest hole
        interpret(close > sma(close, 300))  -> 200 x 0.0       a confident "no"

    and ``ema(close, 200)`` on exactly 200 bars produces ONE value at index 199,
    which is the SMA200 SEED, not an EMA — so ``close > ema(close, 200)`` returned
    ``1.0`` and an alert fired on a number that is not the indicator it names.

    ⛔ THE ANSWER IS NOT TO CHANGE ``_cmp`` — and ⚰️ THIS SAID *"pinned by 17
    frozen cross-lane digests"* AND *"propagating NaN through comparisons would
    move EVERY conformance digest"*. Neither is true: the count went stale the
    first time a corpus case was added (the log owns the number; none is written
    here), and W9a MEASURED the cost at **270 of 53,847 rows, 0.501%**, all of
    them in the warm-up prefix. A cost estimate that overstates a cheap fix in a
    sentence written to stop anyone from checking is a deterrent, not a reason.
    ⭐ THE RULING STANDS ON THE OTHER HALF ALONE: 0 against NaN is CORRECT for a
    warm-up, so changing it would change what a warm-up MEANS on every chart. The
    answer is to ask THIS question BEFORE evaluating — which is why it is a
    function and not a comment, and why it is shaped exactly like
    ``unresolved_scalars``.

    ⚠️ ``max_lookback`` is the tree's OWN declaration — the same number the
    budget and the repaint linter read — so this cannot disagree with them about
    how much past a formula needs.
    """
    have = len(bars) if isinstance(bars, list) else 0
    return max(0, max_lookback(ast) - have)


def _bind_names() -> frozenset:
    """Recurrence bind names (``self``, today), read off the manifest."""
    return frozenset(
        spec["binds"] for spec in RECURRENCES.values()
        if isinstance(spec, Mapping) and isinstance(spec.get("binds"), str))


def structural_maps(root: Any) -> tuple:
    """Structural identity for every node in a tree → ``(id_of, free_of, distinct)``.

    ⭐⭐ A FAITHFUL PORT OF ``interpret.js::structuralMaps``, AND THE PORT IS THE
    POINT. ``node_count`` thresholds on ``distinct`` and ``interpret`` MEMOISES on
    ``id_of``, so the number a member is charged and the work this lane actually
    does cannot drift apart — which is exactly how they HAD drifted from the JS
    lane: one declared cap of 128, measured as 43 there and 163 here, so a formula
    the builder accepted was refused the moment it was saved.

    ⛔ IDS, NOT NESTED KEY STRINGS. Keying a node on a string containing its
    children's keys is quadratic in depth; interning a short shape into an integer
    is O(1) per node. The JS side records paying for that mistake once already.

    ⛔ EXPLICIT POST-ORDER WITH ITS OWN STACK, not ``_flatten`` reversed — this has
    to be correct without depending on another function's emission order, and
    iterative so it survives a tree deep enough to overflow a recursive walk.

    ⚠️ ``free_of`` IS WHAT MAKES THE MEMO SAFE. A subtree that reads a recurrence
    bind (``self``) means something different on every bar, so it is never
    memoised. Everything else in a single ``interpret`` call is evaluated against
    ONE bar set — the ``tf`` and ``sym`` arms recurse into a fresh ``interpret``,
    which builds its own maps, so a memo can never cross a bar-set boundary.
    """
    binds = _bind_names()
    id_of: dict = {}
    free_of: dict = {}
    by_shape: dict = {}

    def intern(shape: str) -> int:
        got = by_shape.get(shape)
        if got is None:
            got = len(by_shape)
            by_shape[shape] = got
        return got

    stack = [(root, False)]
    while stack:
        node, expanded = stack.pop()
        key = id(node)
        if key in id_of:
            continue
        if not isinstance(node, dict):
            id_of[key] = intern("lit\x01%r" % (node,))
            free_of[key] = True
            continue
        args = node.get("args") if isinstance(node.get("args"), list) else []
        if not expanded:
            stack.append((node, True))
            for a in args:
                stack.append((a, False))
            continue
        free = not (node.get("type") == "series" and node.get("name") in binds)
        child_ids = []
        for a in args:
            # ⛔⛔ RAISE, NEVER INVENT A KEY. The JS side's first draft pushed a
            # placeholder for a missing child, and a 128-deep chain collapsed to
            # TWO shapes — `node_count` answered 2. A silent fallback UNDER-counts,
            # and under-counting is the one direction that turns a budget into a
            # guard that has stopped guarding.
            if id(a) not in id_of:
                raise AssertionError(
                    "structural_maps: a child was keyed after its parent — "
                    "the post-order is broken")
            child_ids.append(id_of[id(a)])
            if not free_of[id(a)]:
                free = False
        # ⚠️ DELIMITED. Without separators `op`+`u-`+`` and `op`+`u`+`-` produce
        # one shape, and a collision under-counts exactly like the fallback did.
        name = node.get("name")
        value = node.get("value")
        id_of[key] = intern("%s\x01%s\x01%s\x01%s" % (
            node.get("type"),
            "" if name is None else name,
            "" if value is None else value,
            ",".join(str(c) for c in child_ids)))
        free_of[key] = free

    return id_of, free_of, len(by_shape)


def flat_node_count(ast: Any) -> int:
    """EVERY node, counting repeats — the total, not the budget number.

    ⚰️ THIS EXISTS BECAUSE `node_count` CHANGED MEANING AND A THIRD CONSUMER WAS
    ASKING IT THE OTHER QUESTION. `tools/ast_conformance.py` decodes the tree the
    JS lane sends and checks nothing was dropped in transit by comparing against
    the number of ROWS SENT — a total. When `node_count` began answering DISTINCT
    subtrees it started reporting 4001 against 8001 rows and read as a decoder
    losing half the tree.
    ⛔ TWO QUESTIONS, TWO NAMES. "How much will this cost to evaluate?" is
    `node_count` and is answered in distinct subtrees because the interpreter
    memoises them. "Did every node survive the crossing?" is this one and can only
    be answered in totals.
    """
    return len(_flatten(ast))


def node_count(ast: Any) -> int:
    """How many DISTINCT subtrees the tree has. The number ``budget:nodes`` thresholds.

    ⭐⭐ DISTINCT, NOT TOTAL, AND IT IS HONEST ONLY BECAUSE ``interpret`` MEMOISES
    ON THE SAME IDS. A translated script INLINES rather than names — the closed
    table cannot bind an intermediate — so one script's ATR term can appear eight
    times in a single column, and counting the flattened tree charged a member
    eight times for a thing the engine computes once.

    ⚰️ THIS RETURNED ``len(_flatten(ast))`` AND THE JS LANE RETURNED THE DISTINCT
    COUNT, against ONE declared cap of 128. Measured on a tree repeating one
    subtree forty times: 43 there, 163 here — so the builder accepted a formula the
    backend then refused at ``budget:nodes``. Each number was honest about its own
    lane's real cost; the fix was to give this lane the memo, not to pick a number.

    ⛔ THE TWO MOVE TOGETHER. Counting the DAG WITHOUT the memo is the opposite
    error and a far worse one — a budget under-reporting real cost. If the memo is
    ever narrowed, narrow this with it.

    ⚠️ STILL ITERATIVE, so it survives the 8,001-node tree that makes ``interpret``
    itself raise ``RecursionError``. That asymmetry is the point: a budget guard
    runs BEFORE the walker and must not need the walker to be safe first.
    """
    return structural_maps(ast)[2]


# --------------------------------------------------------------------------- #
# interpret
# --------------------------------------------------------------------------- #

def _reads_clock(ast: Any) -> bool:
    """Does this tree read any name the manifest declares as a clock entry?

    ⛔ ITERATIVE, like ``node_count`` and ``max_lookback`` and for the same
    recorded reason: the escape corpus's deepest case is 8,001 nodes and Python's
    recursion limit is ~1,000. A measurement that dies inside the guard is not a
    measurement.

    ⛔ IT ASKS THE MANIFEST WHICH NAMES ARE CLOCK NAMES rather than listing them,
    so a fourteenth entry is covered the day it lands.
    """
    names = TABLE.get(CLOCK_SECTION) or {}
    stack = [ast]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        if node.get("type") == "series" and node.get("name") in names:
            return True
        args = node.get("args")
        if isinstance(args, list):
            stack.extend(args)
    return False


def interpret(ast: Any, bars: List[dict],
              inputs: Optional[Mapping[str, Any]] = None,
              budget: Optional[Mapping[str, Any]] = None,
              scalars: Optional[Mapping[str, Any]] = None,
              opts: Optional[Mapping[str, Any]] = None) -> List[MaybeNum]:
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
    :param opts:   what the CALLER knows that the tree and the bars do not.
                   Today that is one key, ``tf`` — the timeframe these bars are
                   — and the clock's four timeframe booleans are its only
                   readers.
    :returns:      a list exactly ``len(bars)`` long, ``None`` where not computable

    Raises ``TableRefusal`` for anything the table refuses. Everything else — a
    ``RecursionError`` from a tree deep enough to exhaust the stack, say — is NOT
    a refusal and must never be caught and relabelled as one.

    ⭐⭐ ``opts`` IS OPTIONAL AND TRAILING, AND IT IS THE WHOLE tableVersion-2
    INTERFACE CHANGE. Every caller written before it is unaffected — the
    signature is the cross-lane interface and the JS lane grew the SAME sixth
    argument on the same day. ⛔ AND ITS ABSENCE FAILS CLOSED: with no ``tf``,
    ``isintraday`` and its three siblings are NOT COMPUTABLE, never 0 and never
    a guessed default. A caller that has a timeframe and drops it therefore
    produces a visibly unanswered column rather than a confident wrong one,
    which is what makes the two threading hand-backs (``nativeRegistry.js`` and
    ``scan_evaluator.py``) safe to land separately from this.
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
    # ⛔ THE TREE-SHAPE RULE FOR `sym`, asked once per tree rather than per bar.
    # Same helper `max_lookback` calls, so the gate that runs before the sweep and
    # the gate that answers inside it cannot disagree.
    _assert_sym_placement(ast)
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

    # ⭐ THE CLOCK (tableVersion 2). Seeded from ``compute_clock`` exactly the
    # way the indicator functions bind to ``compute_rsi_raw``: not one line of
    # calendar arithmetic lives in this file, because a private one would be a
    # second authority over values the two lanes are held equal on at 1e-9.
    #
    # ⛔ THE MANIFEST DECIDES WHICH NAMES EXIST; ``compute_clock`` DECIDES WHAT
    # EACH ONE MEANS; A DISAGREEMENT RAISES BY NAME. Seeding a NaN column for a
    # declared name the maths has no column for would be a clock that reads "not
    # computable" on every bar of every symbol forever, with nothing red
    # anywhere — the exact silence this table's floors exist to break. A
    # ``ValueError`` because it is a WIRING defect (somebody edited the manifest
    # without the maths), not a formula the table refuses.
    #
    # ⚠️ COMPUTED EAGERLY, LIKE THE SERIES COLUMNS, AND THAT COSTS SOMETHING
    # HONEST: thirteen columns per call, for a formula that may name none of
    # them. It is not made conditional on the tree because ``scope`` is also
    # what the shadow check reads and what ``resolve:name`` lists — a clock name
    # seeded only when it is used would let an input named ``hour`` shadow it on
    # every OTHER formula, silently.
    #
    # ⛔ THE COST IS TENS OF PERCENT OF ONE ``interpret`` CALL, ON **BOTH** BAR
    # KINDS -- daily is NOT free. ⚠⚠ IT IS A RANGE AND IT IS WRITTEN AS ONE ON
    # PURPOSE: four careful A/B runs against this same module with the ``clock``
    # section removed read 9-38%, with per-configuration min..max spreads of
    # 1.8-7.0 ms on consecutive runs. This box is noisy. A single figure here
    # would invite the next engineer to read a 2x drift as a regression, so the
    # ORDER is the claim and the direction is the finding.
    #
    # ⚠⚠ THE UNIT GATE SHORT-CIRCUITS THE **ZONE** WORK, NOT THE **SEEDING**,
    # which is why daily cannot be free: ``compute_clock`` allocates thirteen
    # ``[None] * n`` columns BEFORE the gate and the loop below maps over all
    # thirteen whichever branch it takes. An earlier note read the daily case as
    # free on the strength of a -0.07 ms delta -- noise standing in for a
    # measurement, and a NEGATIVE delta for purely ADDED work is the tell.
    # The trade still holds in the units that decide it: even at the top of the
    # range, 3,700 symbols is well under a second per nightly sweep.
    # ⛔⛔ SEEDED ONLY WHEN THE TREE ACTUALLY READS A CLOCK NAME. The mirror of
    # ``interpret.js``, and it matters MORE on this lane: the nightly sweep runs
    # every definition against every symbol, and this seed is not just thirteen
    # allocations but thirteen PYTHON-LEVEL list comprehensions per call.
    #
    # ⚠️ MEASURED ON THE JS LANE, where the same waste is easier to time: across
    # the 167 columns the committed corpora translate, exactly ZERO read any of the
    # thirteen clock names, and an A/B over 30 of them at 5,000 bars read 454ms with
    # the calendar maths against 54ms without. The paragraph above already called a
    # lazy seed "the first thing to reach for if this shows in a profile".
    #
    # ⭐ A TREE THAT DOES READ THE CLOCK IS UNCHANGED: same ``compute_clock``, same
    # thirteen columns, same validation. What is skipped is skipped only when the
    # answer could not have depended on it.
    if _reads_clock(ast):
        clock_cols = compute_clock(bars, (opts or {}).get("tf"))
        for name in TABLE.get(CLOCK_SECTION) or {}:
            col = clock_cols.get(name)
            if col is None:
                raise ValueError(
                    f"interpret: the table declares the clock name {name!r} and "
                    f"`indicator_compute.compute_clock` produces no such column "
                    f"(it produces {', '.join(sorted(clock_cols))}). The manifest is "
                    "the authority over WHICH clock names exist and the maths over "
                    "what each MEANS; seeding NaN here would make a declared name "
                    "read `not computable` on every bar forever.")
            scope[name] = [NAN if v is None else float(v) for v in col]

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
                f"{_declared(TABLE.get(CLOCK_SECTION) or {})}, "
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

    #: Structural identity for this tree, computed ONCE per ``interpret`` call.
    #:
    #: ⚰️⚰️ THE MEMO IS WHY THIS LANE'S BUDGET NUMBER WAS HONEST AND ITS COST WAS
    #: NOT. ``node_count`` charges a member for DISTINCT subtrees, because a
    #: translated script INLINES rather than names — the closed table cannot bind an
    #: intermediate, so one script's ATR term appears eight times in a single
    #: column. The JS lane has memoised on these ids for as long as it has counted
    #: them; this lane counted the flattened tree and evaluated every repeat.
    #: Against ONE declared cap of 128 that measured 43 there and 163 here, so a
    #: formula the builder accepted was refused the moment it was saved.
    #:
    #: ⛔ SCOPED TO ONE CALL, AND THAT IS WHAT MAKES IT SAFE. Every node here is
    #: evaluated against ONE bar set; the ``tf`` and ``sym`` arms recurse into a
    #: FRESH ``interpret``, which builds its own maps, so a memoised column can
    #: never be handed to a different set of bars.
    _id_of, _free_of, _ = structural_maps(ast)
    _memo: dict = {}

    def eval_node(n: Any) -> Any:
        # ⚠️ ``free_of`` DECIDES, NOT THE SHAPE ALONE. A subtree reading a
        # recurrence bind (``self``) means something different on every bar of the
        # step loop, so it is never memoised — the same rule the JS lane applies,
        # and the reason this is a port rather than an invention.
        _key = id(n)
        _slot = _id_of.get(_key) if _free_of.get(_key) else None
        if _slot is not None and _slot in _memo:
            return _memo[_slot]
        _value = _eval_raw(n)
        if _slot is not None:
            _memo[_slot] = _value
        return _value

    def _eval_raw(n: Any) -> Any:
        # ⚠️ THE FINAL `else` BELOW *IS* THE GUARD, and it has to be REACHABLE for
        # the mutation that deletes it to be lethal. A validating pre-pass would
        # make it unreachable, which is how a guard becomes an equivalent mutant.
        if not isinstance(n, dict):
            return _refuse("interpret:node", f"got {n!r}")
        kind = n.get("type")
        if kind in ("op", "call", "offset", "tf", "sym", "tf_live") and not isinstance(n.get("args"), list):
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
        if kind in ("tf", "tf_live"):
            code = str(n.get("value"))
            _assert_resamplable(code)
            # \u26d4 STRICTLY ABOVE THE BASE, and only when the caller SAID what the
            # base is. `opts["tf"]` is what the caller knows and the bars do not;
            # absent, this check cannot run and does not pretend to \u2014 the same
            # fail-closed-but-say-so rule `compute_clock` states for `isdaily`.
            base = (opts or {}).get("tf")
            if base is not None:
                rb, rc = _tf_rank(base), _tf_rank(code)
                if rb is not None and rc is not None and rc <= rb:
                    _refuse("interpret:timeframe",
                            "%r is not above %r \u2014 a higher-timeframe read can only "
                            "look UP from the bars it was handed, and %r cannot be "
                            "resampled out of %r."
                            % (code, str(base), code, str(base)))

            # Every base bar\u2019s bucket, by the SAME keys the resampler groups on.
            iso = [_iso_day(b.get("t")) for b in bars]
            keys = [(_tf_bucket(d, code) if d else None) for d in iso]
            order: List[Any] = []
            at: Dict[Any, int] = {}
            for k in keys:
                if k is not None and k not in at:
                    at[k] = len(order)
                    order.append(k)

            # \u2b50 THE RESAMPLER IS THE OWNER OF WHAT A HIGHER-TIMEFRAME BAR IS.
            # `bars_fetch._resample_weekly_iso` carries the stable-Friday-key
            # rationale; a private aggregation here would be a second authority on
            # it, which `screener/candles.py` already says in as many words.
            from api.services import bars_fetch                      # noqa: PLC0415
            resample = (bars_fetch._resample_weekly_iso if code == "W"
                        else bars_fetch._resample_monthly_iso)
            htf = resample([dict(b, t=d) for b, d in zip(bars, iso) if d])

            # \u26d4 AND THE TWO MUST AGREE. This function decides WHICH resampled bar
            # a base bar reads, using its own bucketing; the resampler decides what
            # those bars ARE. If they ever group differently the column is silently
            # off by a period \u2014 so the disagreement is a refusal, not a shrug.
            if len(htf) != len(order):
                _refuse("interpret:timeframe",
                        "the %s resample produced %d bars for %d buckets \u2014 this "
                        "engine\u2019s bucketing and the resampler\u2019s have diverged, and a "
                        "column built across that gap would be off by a period."
                        % (code, len(htf), len(order)))

            # \u2b50 THE CHILD IS EVALUATED ON THE HIGHER-TIMEFRAME BARS, which is the
            # whole value of the node: `tf(sma(close, 20), "W")` is the 20-WEEK
            # average, not the 20-day average sampled weekly. `opts.tf` becomes the
            # HTF code so a nested clock or `tf` reads the right base.
            child = _to_column(
                interpret(n["args"][0], htf, inputs=inputs, budget=budget,
                          scalars=scalars, opts=dict(opts or {}, tf=code)),
                len(htf))

            # \u26d4\u26d4 THE LAST *CLOSED* BAR, AND THIS LINE IS THE REPAINT STORY. A base
            # bar in bucket `b` reads bucket `b - 1`. Reading `b` would hand a
            # Monday its own week\u2019s eventual close \u2014 every backtest using `tf`
            # would then be reading the future and still drawing a confident line.
            # Bucket 0 has no closed predecessor, so it is NOT COMPUTABLE: NaN,
            # never 0.0 and never the bar\u2019s own value, exactly as `offset` states
            # for its left edge.
            # ⛔⛔ ONE LINE SEPARATES THESE TWO NODES, AND IT IS THE WHOLE REPAINT
            # STORY. `tf` reads bucket `b - 1` — the last CLOSED period. `tf_live`
            # reads bucket `b`, the one the base bar is INSIDE, which is still
            # forming: its value CHANGES as the period fills in, so a backtest of
            # it saw a number no live trader could have had.
            #
            # ⭐ SO IT IS A SEPARATE NODE TYPE RATHER THAN A FLAG ON `tf`, and the
            # reason is the BADGE. `ast_lint.mode_from_reach` reads FORWARD reach:
            # `tf` contributes none and stays `non-repainting`; `tf_live` reaches
            # into the rest of its own period and comes out `preview-repaints`. A
            # flag would have had to be threaded into the linter by hand; a node
            # type is asked about by every walker that already exists.
            #
            # ⚠️ AND THE FIRST BUCKET IS COMPUTABLE HERE, unlike `tf`'s. Bucket 0
            # has no closed predecessor, so `tf` must answer NaN there; the
            # forming bucket 0 is perfectly readable, and pretending otherwise
            # would be an artificial hole rather than an honest one.
            live = (kind == "tf_live")
            out = _nan_col(length)
            for i, k in enumerate(keys):
                if k is None:
                    continue
                b = at[k]
                if live:
                    out[i] = child[b]
                elif b > 0:
                    out[i] = child[b - 1]
            return out
        if kind == "sym":
            ticker = str(n.get("value")).strip().upper()
            supplied = (opts or {}).get("symbols") or {}
            series = supplied.get(ticker)

            # ⛔⛔ THE INTERPRETER DOES NOT FETCH — THE CALLER SUPPLIES. Giving this
            # function IO would put a network call inside the evaluator, on the
            # request path, once per symbol: precisely the class the 2026-07-01
            # launch-hardening pass spent a day removing. It would also make the
            # JS mirror impossible, because a browser has no `bars_fetch`.
            #
            # ⛔ SO AN UNSUPPLIED SERIES IS NOT COMPUTABLE, AND NOTHING ELSE. Falling
            # back to `bars` — the instrument being scanned — would answer
            # CONFIDENTLY ABOUT THE WRONG COMPANY, which is worse than answering
            # nothing. The sweep already has a `not_computable` bucket and
            # `CoverageLine` already reports it as its own count.
            if not series:
                return _nan_col(length)

            child = _to_column(
                interpret(n["args"][0], series, inputs=inputs, budget=budget,
                          scalars=scalars, opts=dict(opts or {})),
                len(series))

            # ⭐ ALIGNED ON THE BAR’S OWN `t`, EXACT MATCH, NEVER FORWARD-FILLED.
            #
            # ⚠️ THE KEY IS `t` AND NOT THE ISO DAY, and the first draft had it
            # wrong. `sym` reads the SAME timeframe as the bars in hand, so two
            # bars correspond exactly when they ARE the same bar time — whereas an
            # ISO-day key silently maps EVERY five-minute bar of a session onto the
            # benchmark’s FIRST bar of that day. The conformance corpus runs on
            # 579 intraday 5-minute bars, which is what surfaced it.
            #
            # ⛔ AND NO FORWARD FILL. A benchmark with no bar at that time (a halt,
            # a one-sided holiday, a feed gap) is NaN there. Carrying the previous
            # value forward would present a STALE PRICE AS THIS BAR’S — and a halt
            # is exactly the bar where that lie would matter most.
            #
            # ⚠️ MISMATCHED UNITS FAIL CLOSED BY CONSTRUCTION: daily `t` is
            # `YYYYMMDD` and intraday `t` is unix seconds, so a daily benchmark
            # handed to an intraday chart matches NOTHING and yields
            # not-computable, rather than inventing a rule nobody has stated.
            at = {}
            for j, b in enumerate(series):
                key = b.get("t") if isinstance(b, dict) else None
                if key is not None and not isinstance(key, bool) and key not in at:
                    at[key] = j
            out = _nan_col(length)
            for i, b in enumerate(bars):
                key = b.get("t") if isinstance(b, dict) else None
                if key is None or isinstance(key, bool):
                    continue
                j = at.get(key)
                if j is not None:
                    out[i] = child[j]
            return out
        if kind == "op":
            return apply_op(n, [eval_node(a) for a in n["args"]])
        if kind == "call":
            spec = _fn_spec(n.get("name"))
            _assert_arity(n, spec)
            # ⛔ AFTER THE ARITY AND BEFORE THE RECURRENCE ARM. The role check
            # indexes ``n["args"]``, so it needs the arity settled first; and it
            # sits above the early return so a recurrence entry that ever
            # declares a condition role is covered without this line moving.
            _assert_arg_roles(n, spec)
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
            # ⭐ THE SECOND ARM THE MANIFEST DECIDES. An entry declaring
            # ``reads: "bars"`` is handed THESE bars -- the real instants -- and
            # not a pack of argument columns whose ``t`` is a bar index. The
            # question asked is "does this entry declare it", never "is this call
            # ``vwap``", so a third such entry needs no edit here.
            if n["name"] in _BAR_FN:
                return _bar_column(n["name"], bars, args, length)
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

        #: How many bars of its OWN past this body reads. 0 is the classic one-lag
        #: form. A dict because ``plan`` writes it from an inner scope.
        lag: Dict[str, int] = {"max": 0}

        # Which nodes of the body read the running value. Memoised over node
        # IDENTITY, so a tree that shares a subtree object answers once.
        reads_cache: Dict[int, bool] = {}

        def reads(x: Any) -> bool:
            key = id(x)
            if key in reads_cache:
                return reads_cache[key]
            answer = is_bind(x)
            # ⭐⭐ ``self`` BINDS TO THE NEAREST ENCLOSING RECURRENCE, and this is the
            # whole of that rule -- mirrored line for line from the JS lane. A
            # NESTED recurrence brings its own ``self``, so the walk must not
            # descend into one and count that inner ``self`` as a read of the
            # OUTER's running value.
            #
            # ⛔ THE PAYOFF IS THE PARTITION BELOW, UNCHANGED. A subtree that does
            # not read this recurrence's bind is already evaluated ONCE as an
            # ordinary column; stopping here lets a nested ``accum`` be one of
            # those. It computes over every bar on its own, exactly as it would
            # standing alone, and the outer step loop reads its finished column.
            nested = (isinstance(x, dict) and x.get("type") == "call"
                      and x.get("name") in RECURRENCES)
            if not answer and not nested and isinstance(x, dict) and isinstance(x.get("args"), list):
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
                # ⭐⭐ ``self[k]`` IS THE SECOND-ORDER CASE — the keystone that makes a
                # 2-pole filter (Butterworth / SuperSmoother / every Ehlers design)
                # expressible at all. Mirrors the JS lane exactly; the parity corpus
                # is what holds the two together.
                #
                # ⛔ ONLY WHEN THE OFFSET'S CHILD IS THE BIND ITSELF. ``(self + close)[1]``
                # asks for a past value of an EXPRESSION the step loop never computed.
                if is_bind((x.get("args") or [None])[0]):
                    if x.get("value", 0) > MAX_SELF_LAG:
                        _refuse("interpret:recurrence",
                                f"— `{bind}[{x.get('value')}]` looks back {x.get('value')} "
                                f"steps and the ceiling is {MAX_SELF_LAG}. The history is "
                                f"carried per step, so a deep one is paid on every bar of "
                                f"every symbol.")
                    lag["max"] = max(lag["max"], int(x.get("value", 0)))
                    return
                _refuse("interpret:recurrence",
                        f"— `{bind}` sits under a bar offset in {node['name']}(…) applied "
                        f"to an expression rather than to `{bind}` itself. A past value of "
                        f"the running value is held; a past value of a formula containing "
                        f"it was never computed.")
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

        def step(x: Any, j: int, history: list) -> float:
            got = columns.get(id(x), _MISSING)
            if got is not _MISSING:
                return got[j] if _is_column(got) else got
            if is_bind(x):
                return history[0]
            # ``self[k]`` -- resolved HERE, not by the generic offset arm, which
            # walks whole columns and cannot see a value that lives in this loop.
            if x.get("type") == "offset" and is_bind((x.get("args") or [None])[0]):
                return history[int(x.get("value", 0))]
            values = [step(child, j, history) for child in x["args"]]
            if x["type"] == "op":
                return apply_op_step(x, values)
            return _POINTWISE[x["name"]](*values)

        seed = _to_column(eval_node(node["args"][rec["seed"]]), length)
        out = _nan_col(length)
        for i in range(warmup, length):
            # ⭐ THE SEED FILLS EVERY LAG. Before a single step has run there is no
            # "two bars ago", and the seed is the only defined value in scope -- the
            # initial condition Pine spells by hand as ``nz(x[1], x)``. ⛔ NOT zero:
            # a filter seeded at 0 spends its warm-up climbing back to price and
            # reports that climb as signal.
            history = [seed[i - warmup]] * (lag["max"] + 1)
            for j in range(i - warmup + 1, i + 1):
                nxt = step(body, j, history)
                for k in range(lag["max"], 0, -1):
                    history[k] = history[k - 1]
                history[0] = nxt
            out[i] = history[0]
        return out

    column = _to_column(eval_node(ast), length)
    # ⚠️ THE ONE CONVERSION, AT THE ONE BOUNDARY. NaN inside, `None` on the wire —
    # `indicator_compute`'s alignment rule and spec §4's format, and the same
    # mapping `tools/ast_conformance.py` applies to the JS lane's NaN.
    return [None if math.isnan(v) else v for v in column]


def interpret_trees(trees: Any, bars: List[dict], *,
                    inputs: Optional[Mapping[str, Any]] = None,
                    scalars: Optional[Mapping[str, Any]] = None,
                    budget: Optional[Mapping[str, Any]] = None,
                    opts: Optional[Mapping[str, Any]] = None) -> Dict[str, List[MaybeNum]]:
    """One column PER PLOT — ``{plotKey: interpret(tree, …)}`` over sorted keys.

    A map over ``interpret`` and nothing more: the same inputs, the same budget,
    the same scalars and the same ``opts`` for every tree, so a definition's
    plots are evaluated here exactly the way the JS binder evaluates them
    (``nativeRegistry.astColumnsFor``, which calls ``interpret(trees[key], bars,
    inputs, def.compute.budget, undefined, { tf })`` per plot). ⛔ EVERY ONE OF
    THOSE FOUR IS THREADED, and each for its own reason:

      ``budget``  is the DOCUMENT's, so one cap covers every tree. A map that
                  dropped it would run every plot uncapped — the cap would still
                  read as present in the stored blob and nothing would say so.
      ``opts``    carries what the CALLER knows and the tree cannot (today:
                  ``tf``). With no ``tf`` the four clock booleans are NOT
                  COMPUTABLE — never 0 — so dropping it does not crash, it makes
                  a member's session filter silently never fire. That is the
                  quietest failure in this lane, which is why it is threaded
                  rather than defaulted.
      ``inputs`` / ``scalars`` are the instance's knobs and the symbol's values;
                  one definition has one set of both, and evaluating two plots of
                  one document under two different maps would be two answers to
                  one question.

    ⛔ THE KEYWORDS ARE KEYWORD-ONLY ON PURPOSE. ``interpret`` orders its
    optionals ``inputs, budget, scalars, opts`` and this function orders them
    ``inputs, scalars, budget, opts``; a positional call would therefore mean two
    different things in the two functions, and the pair it would swap — a budget
    and a scalar map — are both plain mappings, so nothing downstream would
    raise. Making the ambiguity unreachable is cheaper than documenting it.

    ⛔ A MISSING OR EMPTY MAPPING IS THE **CALLER'S** ERROR (``TypeError``), NEVER
    A ``TableRefusal``. A refusal is a sentence about the FORMULA a member wrote;
    "you handed me no trees" is a sentence about the caller, and dressing it as a
    refusal shows a member that their formula was rejected when no formula was
    involved. ``tools/ast_conformance.py`` also recognises a refusal BY TYPE, so a
    caller error wearing that type would be counted as the table saying no.

    :returns: ``{plotKey: column}``, one entry per key, each exactly ``len(bars)``
              long — insertion-ordered by SORTED key, which is the order
              ``trees.js::assertTrees`` returns and the order every consumer uses.

    🔴 NO PRODUCTION CALLER TODAY — MEASURED, AND SAID HERE RATHER THAN ONLY IN
    A REPORT. Grepped across ``api/``, ``tools/`` and ``app/src``: the only callers
    are ``tests/test_ast_multi_tree_parity.py`` and
    ``tests/test_user_definitions_v2.py``. A public function with no caller and no
    explanation is indistinguishable from dead code
    (``lesson_built_tested_green_and_unreachable``), so this paragraph is the
    explanation and it is kept honest by naming a specific caller-to-be rather than
    a vague future.

    ⭐ WHAT IT IS: the PYTHON HALF OF A MIRRORED PAIR. ``nativeRegistry.astColumnsFor``
    is the JS half and it is fully wired — it is what a member's chart runs for
    every plot of a multi-tree definition. This side exists so the two lanes can be
    held to one answer for a WHOLE DOCUMENT rather than one tree at a time, which is
    what ``tests/test_ast_multi_tree_parity.py`` does with it today against the
    shared ``tests/fixtures/ast/multi_tree_parity.json``.

    ⛔ AND THE CALLER IT IS FOR IS NAMED, WITH THE GAP IT WOULD CLOSE.
    ``alert_user_series._gate_cross_lane`` is the admission door that proves the two
    lanes agree at 1e-9 before an alert may ever fire, and it calls
    ``cross_lane_report(compute.get("ast"), ...)`` — the SCAN tree, ALONE. An alert
    armed on ``u_<id>.macd`` of a multi-plot document is therefore admitted on a
    proof taken against a tree it does not evaluate: ``_make_value_fn`` runs
    ``compute.trees["macd"]`` and nothing has ever compared THAT column across the
    lanes. Threading this function (or its per-key equivalent) into that gate is the
    wiring this exists for. It is deliberately NOT done here: widening an admission
    gate can refuse definitions that pass today, so it is a ruling with its own
    rails, not a fix-round edit.
    """
    if not isinstance(trees, Mapping) or not trees:
        raise TypeError(
            "interpret_trees(trees, bars): trees must be a non-empty mapping of "
            f"plotKey -> tree, got {'an empty mapping' if isinstance(trees, Mapping) else type(trees).__name__}")
    return {key: interpret(trees[key], bars, inputs=inputs, budget=budget,
                           scalars=scalars, opts=opts)
            for key in sorted(trees)}


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
