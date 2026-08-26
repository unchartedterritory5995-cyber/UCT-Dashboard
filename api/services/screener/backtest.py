"""Screen backtesting — the ONE owner of the number, and PURE.

⭐ THE WHOLE FEATURE RESTS ON ONE MEASURED FACT, AND IT WAS MEASURED, NOT
ASSUMED. ``ast_interpret.interpret(tree, bars)`` returns a value **per bar** —
``len(col) == len(bars)`` — so a formula written in bar terms is *already* a time
series of true/false and we have simply never read the earlier entries.
Backtesting a bar-expressible screen is therefore not a new evaluator; it is
reading the part of the answer the screener throws away. Verified against this
module's own imports before a line of it was written::

    interpret(close > sma(close,3), 8 bars) -> [0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0]

⛔⛔ AND THE REFUSAL IS THE FEATURE, NOT A LIMITATION TO APOLOGISE FOR.
``screener_rows`` holds ONE row per ticker. There is no history of ``market_cap``,
``rs_rank``, ``pe_ttm``, ``pattern_engine_vcp`` or any other declared scalar, so
evaluating today's fundamentals at a 2024 bar screens the past using a fact from
the future. The failure is SILENT and it is the reason competitor curves of this
shape are untrustworthy — measured at the leaf, with no market cap::

    interpret(market_cap > 1e9, bars) -> [0.0, 0.0, 0.0, ...]   a confident False

Not a hole. A *confident False*, on every bar, forever. A backtester that ran
that would produce a beautiful, wrong equity curve the member cannot audit. So
this module asks ``unresolved_scalars`` BEFORE it evaluates anything and refuses
**by name** — *"this screen cannot be backtested: it reads `rs_rank`, and we hold
no history of it"* — the same ``refusal ≠ empty`` contract ``CoverageLine`` keeps.

⛔ ``unresolved_scalars`` IS CALLED, NEVER RE-DERIVED. It already enumerates the
declared scalars a tree names, in the manifest's own order. A second scan here
would be a second authority over one value and would drift the first time the
manifest grows a scalar.

───────────────────────────────────────────────────────────────────────────────
PURE, AND THAT IS A TESTABILITY DECISION. This module takes a tree, a symbol
list and a date range, and returns the receipt. No route logic, no DB, no clock,
no RNG — the only way bars reach it is the ``bars_for`` callable it is handed, so
every rule below is testable without a database and the same inputs always
produce the same receipt.

⛔ ``as_of`` IS THE LAST EVALUATED BAR DATE, NOT THE WALL CLOCK. A ``now()`` here
would make the receipt non-reproducible — the same question asked twice would
return two different answers and neither could be checked against the other.
Deriving it from the data also makes it a more useful fact: it says what the
backtest actually covers.

───────────────────────────────────────────────────────────────────────────────
🔴 THE FIVE RULES THAT MAKE THE NUMBER HONEST. Each is a requirement, and each
has a test with a control in ``tests/test_screener_backtest.py``.

1. A BASELINE IS MANDATORY, NEVER OPTIONAL — and it is STRUCTURAL. A 58% win
   rate means nothing until you know the same universe over the same dates did
   55%. ``HorizonResult`` takes ``strategy`` and ``baseline`` as two REQUIRED
   fields, so a strategy number cannot be constructed alone: omitting the
   baseline is a ``TypeError`` at the constructor, not a review comment.

2. FORWARD RETURNS MEASURE FROM THE NEXT BAR'S OPEN. A fill at the signal bar's
   close is a fill you could not have got, and it is the oldest way to flatter a
   backtest — the signal is only knowable once that bar has closed. Both legs are
   opens (``fill_open`` → ``exit_open``) so the basis is symmetric and both fills
   are ones a member could actually have taken.

3. COVERAGE COUNTS TRAVEL WITH THE RESULT, in the ``CoverageLine`` idiom, and the
   arithmetic CLOSES (``_assert_closes``) the way ``scan_evaluator`` makes it
   close. A symbol with no bars in the window is NOT TESTED and is counted as
   such — never dropped silently into the denominator or out of it. A NULL is
   never a zero.

   ⛔ AND THE BAR-GRAIN SUMS ARE DERIVED FROM **EVERY** SYMBOL THAT PRODUCED A
   TALLY, NOT ONLY THE TESTED ONES (``tallies``, not ``scans``). A symbol whose
   whole window is unanswerable — a data hole spanning the window, or nothing but
   warmup — is excluded from the horizon loop because it has no observation to
   contribute, and summing the bar counts over that same shortened list dropped
   its bars out of the calculation entirely. Forty unanswerable bars then
   reported as ``bars_not_computable: 0``, which does not merely omit a fact: it
   positively asserts *"no data holes"* about a window that was one big hole.
   ⚠️ ``_assert_closes("bars", …)`` CANNOT catch that — both sides of the
   identity lose the same symbol, so it closes. A closed identity proves the
   parts agree with the total it was handed, never that the total is everything;
   the guard against exclusion is
   ``test_a_symbol_whose_whole_window_is_unanswerable_keeps_its_bars_in_coverage``.

4. THE UNIVERSE IS TODAY'S MEMBERSHIP, AND THAT IS ITSELF SURVIVORSHIP BIAS. We
   hold no historical constituent lists, so this tests today's names against
   yesterday's prices. ⛔ It is stated IN THE PAYLOAD, because a caveat in a
   design doc is not a caveat the member sees, and this one changes how the
   number should be read.

5. A WINDOW WITH TOO FEW SIGNALS IS REFUSED, NOT REPORTED. A win rate over n=3 is
   noise wearing a percentage sign. The floor is STATED in the payload — in the
   refusal *and* in the accepted receipt, so "it cleared the floor" is a fact the
   member can see rather than an assumption. ``n`` is always reported; it is the
   RATE that is withheld, because the count is a fact and the rate is the thing
   that misleads.

   ⛔ AND "ALWAYS" INCLUDES THE WHOLE-WINDOW REFUSAL. That refusal fires *after*
   every horizon has been computed, so the per-horizon counts already exist; the
   first draft threw them away and restated one of them into a prose sentence
   ("the best horizon has 3 signal(s)"), which no consumer can parse and which
   put a second authority on a number the ``horizons`` tuple already owned. The
   computed results now ride on the refusal — rates withheld by ``below_floor``,
   which is what a refusal at this grain MEANS.

───────────────────────────────────────────────────────────────────────────────
⚠️ WHAT THIS ANSWERS, AND THE WORDING IS LOAD-BEARING. It answers *"did names
matching this screen tend to go up?"* — NOT *"what would I have made?"*. There is
no position sizing, no stop, no portfolio, no transaction cost (spec §6), and
observations are one per signal bar with OVERLAPPING forward windows left
un-deduplicated. Every one of those is stated in the receipt's ``method`` block
so the payload cannot blur the two questions.

⚠️ ``api/services/backtest_engine.py`` IS A DIFFERENT QUESTION AND NOT A SECOND
AUTHORITY OVER THIS ONE. That module walks a position lifecycle from entry/exit
SIGNALS and returns an equity curve — *"what would I have made"*, which spec §6
scopes out of v1. This one measures forward returns from a screen's own per-bar
truth column. Neither computes the other's number.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from api.services.ast_freshness import series_in
from api.services.ast_interpret import interpret, max_lookback, unresolved_scalars
from api.services.ast_table import TABLE, SERIES_SECTION

# ⭐ THE CONTROLS ARE IMPORTED, NEVER RESTATED. `candle_backtest` measured both on
# 18.8M bars and `docs/superpowers/research/candles/11-MEASURED-EDGE-2026-08-25.md`
# records why each exists. A second winsorising rule here (a percentile, say)
# would be a second authority over "what counts as an outlier" and would drift
# from the first the day either moved. `_clip` is private there on purpose — it
# is one number's rule — and this module names that dependency rather than
# copying the two lines.
from api.services.screener.candle_backtest import (
    MOVE_BUCKETS, WINSOR_PCT, _clip as winsorise, move_bucket)

BarsFor = Callable[[str], Optional[Sequence[Mapping[str, Any]]]]

#: The forward horizons a caller gets when it names none, in bars.
DEFAULT_HORIZONS: Tuple[int, ...] = (5, 10, 20)

#: How many signal observations a horizon needs before its win rate is reported.
#:
#: ⭐ STATED IN THE PAYLOAD, NEVER SILENTLY APPLIED — rule 5. A floor the member
#: cannot see is indistinguishable from a screen that found nothing, and the two
#: call for opposite actions (widen the window vs. change the screen).
DEFAULT_MIN_SIGNALS = 30

#: ⭐ THE DAILY-BAR SHAPE, AND IT IS WHAT MAKES §6's "no intraday backtests" A
#: PROPERTY OF THE CODE RATHER THAN A PROMISE. ``bars_fetch._fmt_sqlite_bars``
#: emits ``t`` as ``"YYYY-MM-DD"`` for D/W/M and as an epoch int for intraday, so
#: a non-matching ``t`` is an intraday feed arriving at a daily engine. Refused by
#: name rather than coerced: a guessed epoch→date conversion here would be a
#: second authority over what a bar's date is.
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: ⭐ ISO DATES COMPARE LEXICOGRAPHICALLY == CHRONOLOGICALLY, which is why this
#: module imports no ``datetime`` at all. No parsing, no timezone, no clock.

#: The refusal vocabulary. ⛔ PAIRWISE DISJOINT AND EACH ONE ACTIONABLE — two
#: refusals sharing a phrase let a test pass with the safety deleted, which has
#: happened in this repo before.
REFUSALS: Mapping[str, str] = {
    "scalar_no_history":
        "this screen cannot be backtested: it reads values we hold no history of",
    "not_a_condition":
        "this screen is not a true/false condition, so it has no signal to test",
    "non_daily_bars":
        "this engine backtests daily bars; these bars are not daily",
    "unordered_bars":
        "these bars are not in strictly increasing date order",
    "no_bars_in_window":
        "no symbol in this universe has bars in this window",
    "too_few_signals":
        "this window has too few signals to report a win rate",
    "empty_universe": "a backtest needs at least one symbol",
    "empty_horizons": "a backtest needs at least one forward horizon",
    "bad_horizon": "a forward horizon is a whole number of bars, at least 1",
    "bad_window": "the window starts after it ends",
    "bad_date": "a window bound is not a YYYY-MM-DD date",
}


class BacktestRefusal(Exception):
    """Raised only by the pure helpers; ``run_backtest`` returns a receipt instead.

    ⛔ A REFUSAL IS A RESULT, NOT AN ERROR, at this module's boundary. The
    member asked a legitimate question and the honest answer is "we cannot answer
    this, and here is exactly why" — which has to survive a JSON round trip and
    be rendered beside the screen, so ``run_backtest`` never raises it.
    """

    def __init__(self, reason: str, detail: str = "", **extra: Any) -> None:
        super().__init__(f"{REFUSALS[reason]} {detail}".strip())
        self.reason = reason
        self.detail = detail
        self.extra = extra


# --------------------------------------------------------------------------- #
# the receipt
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Stats:
    """One arm of one horizon.

    ⭐ ``n`` IS ALWAYS REPORTED AND THE RATE IS NOT. Below the floor every rate
    field is ``None`` — the count is a fact the member can act on ("widen the
    window"), the rate is the thing that misleads. A withheld rate is ``None``,
    never ``0``: rule 3's "a NULL is never a zero" reaches inside the stats too.
    """
    n: int
    win_rate: Optional[float] = None
    avg_pct: Optional[float] = None
    median_pct: Optional[float] = None
    best: Optional[float] = None
    worst: Optional[float] = None
    #: The mean of the SAME returns after `candle_backtest`'s clip (±WINSOR_PCT).
    #: ⭐ ON BOTH ARMS by construction (one dataclass): that module's rule is "the
    #: universe base rate is clipped by the SAME rule in the SAME pass" — a clipped
    #: strategy mean beside a raw baseline mean compares two unlike-treated
    #: populations. Withheld (`None`) whenever the rate is (rule 5).
    avg_pct_winsorised: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"n": self.n, "win_rate": self.win_rate, "avg_pct": self.avg_pct,
                "median_pct": self.median_pct, "best": self.best,
                "worst": self.worst,
                "avg_pct_winsorised": self.avg_pct_winsorised}


@dataclass(frozen=True)
class HorizonResult:
    """⭐⭐ RULE 1, MADE STRUCTURAL. ``strategy`` and ``baseline`` are BOTH
    required, so the strategy number is not constructible on its own — omitting
    the baseline is a ``TypeError`` at the constructor rather than a thing a
    reviewer has to notice. The two ship adjacent because they only mean anything
    together: 58% is a triumph against a 40% universe and a failure against a 70%
    one, and the bare number cannot tell you which.
    """
    horizon: int
    strategy: Stats
    baseline: Stats
    below_floor: bool
    coverage: Dict[str, int]
    #: The same-day-move control (W5a.2). Optional so a `HorizonResult` built by
    #: hand in a test is still constructible; the engine always fills it.
    same_day: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"horizon": self.horizon,
                "strategy": self.strategy.to_dict(),
                "baseline": self.baseline.to_dict(),
                "below_floor": self.below_floor,
                "coverage": dict(self.coverage),
                # ⛔ `is not None`, NOT TRUTHINESS. An empty dict is "computed and
                # empty"; `None` is "never computed". Collapsing the first into
                # the second is the same class of defect as a 0 that means
                # "unknown" — it sorts, it renders, and it is not true.
                "same_day": (dict(self.same_day)
                             if self.same_day is not None else None)}


@dataclass(frozen=True)
class Receipt:
    """What a backtest returns — answer or refusal, always the same type.

    ⛔ THE CAVEAT IS A REQUIRED FIELD (rule 4). ``universe`` carries the
    survivorship statement, and because it has no default a receipt cannot be
    built without it. That is the difference between a caveat the member sees and
    a caveat in a document nobody opens.
    """
    backtestable: bool
    universe: Dict[str, Any]
    method: Dict[str, Any]
    coverage: Dict[str, int]
    horizons: Tuple[HorizonResult, ...] = ()
    evaluated_dates: int = 0
    symbols_tested: int = 0
    signals: int = 0
    as_of: Optional[str] = None
    bars_source: Optional[str] = None
    window: Optional[Dict[str, str]] = None
    refused: Optional[str] = None
    names: Tuple[str, ...] = ()
    detail: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "backtestable": self.backtestable,
            "universe": dict(self.universe),
            "method": dict(self.method),
            "coverage": dict(self.coverage),
            "window": dict(self.window) if self.window else None,
            "bars_source": self.bars_source,
        }
        if self.backtestable:
            out.update({
                "evaluated_dates": self.evaluated_dates,
                "symbols_tested": self.symbols_tested,
                "signals": self.signals,
                "as_of": self.as_of,
                # ⛔ BOTH ARMS, ALWAYS, AND FROM ONE SOURCE. `forward_returns` and
                # `baseline` are two READINGS of the same `HorizonResult` tuple,
                # not two independently assembled maps — so they cannot come to
                # describe different horizons, and neither can be emitted without
                # the other having been computed.
                "forward_returns": {str(h.horizon): h.strategy.to_dict()
                                    for h in self.horizons},
                "baseline": {str(h.horizon): h.baseline.to_dict()
                             for h in self.horizons},
                "horizons": [h.to_dict() for h in self.horizons],
            })
        else:
            out.update({"refused": self.refused, "names": list(self.names),
                        "detail": self.detail})
            # ⛔ RULE 5 REACHES INTO THE REFUSAL. A refusal that fired AFTER the
            # horizons were computed carries them, so the member still gets the
            # per-horizon `n` — the count is a fact, and it is the only number
            # that says whether to widen the window or change the screen. Rates
            # are already `None` (that is what `below_floor` means), so nothing
            # withheld leaks out through this door.
            # ⚠️ The key is ABSENT, never `[]`, when nothing was computed: a
            # zero-length list would invite a consumer to render "0 horizons"
            # beside a refusal that never reached a bar, which is a different
            # fact from "every horizon came up short".
            if self.horizons:
                out["horizons"] = [h.to_dict() for h in self.horizons]
        return out


# --------------------------------------------------------------------------- #
# the caveats that ride along
# --------------------------------------------------------------------------- #

#: ⭐ RULE 4, IN THE MEMBER'S WORDS. "This tests today's names against
#: yesterday's prices" is the whole caveat in one sentence, and it has to be
#: readable beside the number rather than inferable from a field name.
_SURVIVORSHIP = (
    "This tests today's names against yesterday's prices. The universe is "
    "CURRENT membership — we hold no historical constituent lists, so names that "
    "were in this universe back then and have since delisted, been acquired or "
    "fallen out are absent, and every name here survived to today. That is "
    "survivorship bias and it flatters the result by an amount this backtest "
    "cannot measure."
)


def _universe_block(symbols: Sequence[str], membership: str) -> Dict[str, Any]:
    return {"membership": membership,
            "symbols_requested": len(symbols),
            "survivorship_bias": True,
            "caveat": _SURVIVORSHIP}


def _method_block(*, warmup: int, min_signals: int,
                  horizons: Sequence[int]) -> Dict[str, Any]:
    return {
        # ⭐ RULE 2, NAMED IN THE PAYLOAD so the member can see the fill they are
        # being quoted rather than trusting that it is the honest one.
        "fill": "next_bar_open",
        "exit": "open_of_the_bar_horizon_bars_after_the_fill",
        "return_pct": "(exit_open - fill_open) / fill_open * 100",
        "warmup_bars": warmup,
        "min_signals": min_signals,
        "horizons": list(horizons),
        "observations": ("one per signal bar; overlapping forward windows are "
                         "NOT de-duplicated, so nearby observations are "
                         "correlated and n overstates independent evidence"),
        # ⚠️ SPEC §6: the wording must not blur the two questions.
        "answers": ("did names matching this screen tend to go up? -- NOT what a "
                    "portfolio would have made. No sizing, stops, portfolio "
                    "construction or transaction costs are modelled."),
        # ⭐ THE CONTROLS, NAMED WHERE THE MEMBER CAN SEE THEM (spec §5.9). The
        # clip is `candle_backtest`'s (±50%; `gravestone-doji` read +6.0% at
        # t=1.48 raw and +0.93% at t=24.5 clipped). `winsor_pct` is READ off that
        # module so the payload cannot say 50 while the rule says something else.
        "winsorised": True,
        "winsor_pct": WINSOR_PCT,
        # ⭐ THE SECOND CONTROL, AND IT IS NOT THE FILL. `fill: next_bar_open` is
        # `candle_backtest`'s BID-ASK BOUNCE control; this is its DATE+MOVE
        # matching, which is what stopped every bearish label there reading
        # positive. The bucket EDGES are read off that module so the payload
        # cannot describe a partition the code does not use.
        "same_day_control": True,
        "same_day_buckets_atr": list(MOVE_BUCKETS),
        "atr_bars": ATR_BARS,
        "same_day_basis": ("each signal observation minus the mean winsorised "
                           "return of every answered bar on the same date in the "
                           "same ATR-scaled same-day-move bucket; a cell the "
                           "signals wholly occupy is unmatched, never zero. "
                           # ⚠️ THE CONDITIONING, STATED WHERE THE NUMBER IS.
                           # This is rendered beside a POOLED excess computed
                           # over 100% of the arm, so the reader has to be told
                           # that this one is not — and that the floor beneath it
                           # counts signals where `candle_backtest` counts cells.
                           "the mean is over the MATCHED observations alone -- a "
                           "conditioned subsample, systematically the dates this "
                           "screen was least selective -- and it is per "
                           "OBSERVATION, not per cell: `n_cells` says how many "
                           "(date, bucket) cells those observations came from, "
                           "and `min_signals` floors SIGNALS, not cells, so a "
                           "run concentrated on few dates can clear it"),
    }


# --------------------------------------------------------------------------- #
# bar-level helpers
# --------------------------------------------------------------------------- #

def bar_date(bar: Mapping[str, Any]) -> Optional[str]:
    """A bar's ``YYYY-MM-DD`` date, or ``None`` when it does not have one.

    ⛔ THE ONE OWNER OF "what date is this bar". Every window test in this module
    goes through here, so there is exactly one answer to that question.
    """
    t = bar.get("t") if isinstance(bar, Mapping) else None
    return t if isinstance(t, str) and _DATE.match(t) else None


def _finite_positive(v: Any) -> Optional[float]:
    """A tradeable price, or ``None``.

    ⛔ ``None``, NOT ``0.0``. A zero open is the vendor sentinel
    ``bars_sqlite.purge_impossible_bars`` exists to delete; dividing by it would
    be an infinite return, and substituting a zero for it would be a fabricated
    flat trade. Both are counted as not-computable instead.
    """
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) and f > 0 else None


def _assert_closes(label: str, total: int, parts: Mapping[str, int]) -> None:
    """🔴 THE CLOSED IDENTITY, ASSERTED ABOUT OURSELVES.

    ``scan_evaluator._assert_coverage_closes`` is the same guard one surface over,
    and its docstring lists the sweeps that lost symbols through a hole in exactly
    this arithmetic. A backtest that loses bars reports a smaller n and a
    confident win rate over it — the loss is invisible in the output, which is
    what makes the assertion necessary rather than tidy.

    ⛔ A ``raise``, NOT A BARE ``assert``: ``python -O`` strips ``assert`` and a
    guard that evaporates under an optimisation flag is a guard that is not there.
    """
    got = sum(parts.values())
    if got != total:
        raise AssertionError(
            f"{label} arithmetic broke: total={total} but "
            + " + ".join(f"{k}={v}" for k, v in parts.items()) + f" = {got}")


def _bar_fields(tree: Any) -> Tuple[str, ...]:
    """The BAR FIELDS this tree reads — ``('c',)`` for ``close > sma(close,3)``.

    ⛔ DERIVED THROUGH THE MANIFEST, NEVER A HAND MAP. ``series_in`` says which
    declared series the tree names and ``TABLE['series'][name]['field']`` says
    which bar key each one reads; a local ``{"close": "c"}`` here would be a
    second authority over the vocabulary and would rot the day the table grows a
    series.
    """
    decl = TABLE[SERIES_SECTION]
    return tuple(sorted(decl[n]["field"] for n in series_in(tree)))


def _unanswerable_bars(bars: Sequence[Mapping[str, Any]],
                       fields: Sequence[str], reach: int) -> set:
    """🔴 THE BARS THE SCREEN CANNOT HONESTLY ANSWER — AND THIS IS MEASURED,
    NOT PRECAUTIONARY.

    A hole in the tape is INVISIBLE AT THE TOP OF A CONDITION TREE. With
    ``bars[5]['c'] = None``::

        interpret(close, bars)             -> [..., None, ...]   the honest hole
        interpret(close > 0, bars)         -> [...,  0.0, ...]   a confident False
        interpret(close > sma(close,3))    -> [...,  0.0, ...]   and so does this

    ``_cmp`` answers **0** against NaN — the same rule, one axis over, that
    ``unresolved_scalars`` exists for. So reading ``None`` off the top of the
    column CANNOT find these bars: the first draft of this engine did exactly
    that and counted every hole as *"the screen did not match"*, which is a
    symbol quietly leaving the numerator while staying in the denominator. That
    is the defect this whole module is about, arriving through the other door.

    ⭐ THE POISON SPREADS, SO THE RADIUS IS THE TREE'S OWN DECLARED REACH. A hole
    at bar ``j`` also NaNs ``sma(close,3)`` at ``j+1`` and ``j+2``; nothing reads
    further back than ``max_lookback``, so marking ``[j, j+reach]`` covers the
    propagation. It is CONSERVATIVE by at most one bar (``sma``'s window is
    ``reach`` wide but reaches ``reach-1`` bars forward) and conservative in the
    only safe direction: it can count a usable bar as unanswerable, never a
    poisoned bar as a real "no".
    """
    blocked: set = set()
    n = len(bars)
    for j, bar in enumerate(bars):
        if all(_finite_number(bar.get(f)) for f in fields):
            continue
        for i in range(j, min(n, j + reach + 1)):
            blocked.add(i)
    return blocked


def _finite_number(v: Any) -> bool:
    """⛔ A ``bool`` IS NOT A PRICE. ``isinstance(True, int)`` is ``True`` in
    Python, so a value-level check alone would let one through — the same trap
    ``ast_interpret._is_number`` names."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return math.isfinite(float(v))


#: The lagged true-range window behind the same-day-move bucket, in bars.
#: ⚠️ `candle_backtest.scan_ticker` carries this as an inline literal
#: (`if len(trs) > 14`) and naming it there is W0's file, so it is named HERE
#: and `test_the_atr_window_is_the_candle_modules_own_number` reads that source
#: to pin the two equal. Move both or neither.
ATR_BARS = 14

#: Why ``same_day.excess_pct_winsorised`` is null, when it is. ⛔ NAMED, NOT
#: INFERRED — this lane's rule. The two states call for OPPOSITE actions and a
#: bare ``null`` cannot tell them apart: ``below_floor`` means "widen the window"
#: (rule 5 withheld the rate), ``no_unoccupied_cell`` means this screen WAS its
#: own cell on every date it fired, and widening will not help — loosen it, or
#: read the pooled arms instead. The precedence mirrors the expression that nulls
#: the value, so the reason can never disagree with the number beside it.
SAME_DAY_NULL_REASONS: Tuple[str, ...] = ("below_floor", "no_unoccupied_cell")


def _move_buckets(bars: Sequence[Mapping[str, Any]]) -> List[Optional[int]]:
    """Per bar, its same-day-move bucket — or ``None`` when it cannot be measured.

    ⭐ THE CONTROL `candle_backtest` FOUND IT NEEDED, PORTED NOT PARAPHRASED: the
    bar's day return in units of a LAGGED ATR (the ``ATR_BARS`` sessions BEFORE
    it — including the bar itself contaminates the control with the thing it is
    controlling for), bucketed by ``MOVE_BUCKETS``. ``None`` for the first bar
    (no previous close), for a bar with no true range on file yet, for a hole,
    and for a zero-ATR tape: an unmeasurable move is DROPPED from matching and
    COUNTED as unmatched, never pooled with moves it may not resemble.
    """
    out: List[Optional[int]] = []
    trs: List[float] = []
    for i, bar in enumerate(bars):
        prev = bars[i - 1] if i > 0 else None
        h, l, c = bar.get("h"), bar.get("l"), bar.get("c")
        pc = prev.get("c") if prev is not None else None
        # ⛔ ``h >= l`` IS THE OWNER'S SANITY CHECK, NOT A TIDY-UP
        # (`candle_backtest._usable`). An inverted bar is a vendor defect, and
        # its "true range" is NEGATIVE — which would pull the lagged ATR down,
        # inflate every |z| measured against it, and quietly move real bars into
        # buckets they do not belong in. The owner skips such a bar; so does this.
        usable = (all(_finite_number(v) for v in (h, l, c, pc))
                  and float(c) > 0 and float(pc) > 0 and float(h) >= float(l))
        if not usable:
            # ⛔ A bar with no measurable range still advances the tape; the TR
            # window is NOT extended past it, so the next bar's ATR is measured
            # on whatever real ranges preceded it.
            out.append(None)
            continue
        atr_pct = (sum(trs) / len(trs)) / float(c) * 100.0 if trs else 0.0
        day_ret = (float(c) - float(pc)) / float(pc) * 100.0
        out.append(move_bucket(day_ret, atr_pct))
        trs.append(max(float(h) - float(l), abs(float(h) - float(pc)),
                       abs(float(l) - float(pc))))
        if len(trs) > ATR_BARS:
            del trs[0]
    return out


def _same_day_excess(strat_obs: Sequence[Tuple[Optional[Tuple[str, int]], float]],
                     cells: Mapping[Tuple[str, int], List[float]], *,
                     withheld: bool) -> Dict[str, Any]:
    """Each signal observation against the mean WINSORISED return of every
    answered bar on the SAME DATE in the SAME bucket.

    ⛔ A CELL THE SIGNALS WHOLLY OCCUPY MEASURES NOTHING ABOUT THEM — the base
    rate would be the signals' own mean and the excess identically zero, which
    would drag every average toward 0 and understate a real effect. Such
    observations are counted UNMATCHED (`candle_backtest.summarize` drops the
    same cells). ``excess_pct_winsorised`` is ``None`` below the floor or with
    nothing matched: rule 5, a NULL is never a zero.

    ⛔⛔ THE OWNER CLUSTERS BY CELL AND THIS DOES NOT, SO THE CELL COUNT SHIPS.
    ``candle_backtest.summarize`` averages the per-CELL excesses — *"each date
    contributes once no matter how many tickers carried the label"* — and refuses
    a label under ``MIN_DATES`` cells, because 900 instances on eleven days is an
    effective sample of eleven. This engine averages per OBSERVATION, and its
    only floor is ``min_signals``, which counts SIGNALS. So thirty signals on ONE
    date in ONE bucket clear that floor here and would have been refused there.
    That difference is not hidden behind a comment: ``n_cells`` reports it the way
    the owner reports ``n_dates``, so a consumer can see a mean over 30
    observations in 1 cell for what it is. ⚠️ Porting the clustering itself would
    change what ``min_signals`` means for every existing horizon and is a
    different decision from adding the control; the count is what makes it
    visible rather than assumed.

    ⚠️ AND THE MEAN IS OVER A CONDITIONED SUBSAMPLE. Only the observations that
    HAD a peer are averaged — systematically the dates this screen was least
    selective. ``n_matched``/``n_unmatched`` size that conditioning; the caveat
    itself travels in ``method.same_day_basis``, beside the number, because a
    consumer renders this next to a pooled excess computed over 100% of the arm.
    """
    signals_in: Dict[Tuple[str, int], int] = {}
    for cell, _ in strat_obs:
        if cell is not None:
            signals_in[cell] = signals_in.get(cell, 0) + 1
    excess: List[float] = []
    matched_cells: set = set()
    unmatched = 0
    for cell, r in strat_obs:
        acc = cells.get(cell) if cell is not None else None
        if acc is None or acc[0] <= signals_in.get(cell, 0):
            unmatched += 1
            continue
        matched_cells.add(cell)
        excess.append(winsorise(r) - acc[1] / acc[0])
    n = len(excess)
    # ⛔ ONE EXPRESSION OWNS BOTH THE NULL AND ITS REASON, in this order, so the
    # two cannot come to disagree. `below_floor` first because it is the
    # engine-wide rule that would withhold the rate whatever the matching found.
    reason = ("below_floor" if withheld
              else ("no_unoccupied_cell" if n == 0 else None))
    return {"n_matched": n, "n_unmatched": unmatched,
            # ⭐ the owner's `n_dates`, one axis over: how many (date, bucket)
            # cells the matched observations actually came from.
            "n_cells": len(matched_cells),
            "excess_pct_winsorised": None if reason else sum(excess) / n,
            "excess_null_reason": reason}


def _stats(returns: Sequence[float], *, withheld: bool) -> Stats:
    """Summarise one arm. ⛔ THE RATE IS WITHHELD, THE COUNT NEVER IS (rule 5)."""
    n = len(returns)
    if withheld or n == 0:
        return Stats(n=n)
    wins = sum(1 for r in returns if r > 0)
    ordered = sorted(returns)
    mid = n // 2
    med = ordered[mid] if n % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    return Stats(n=n, win_rate=wins / n * 100, avg_pct=sum(returns) / n,
                 median_pct=med, best=ordered[-1], worst=ordered[0],
                 avg_pct_winsorised=sum(winsorise(r) for r in returns) / n)


# --------------------------------------------------------------------------- #
# one symbol
# --------------------------------------------------------------------------- #

@dataclass
class _SymbolScan:
    """What one symbol contributed. Mutable by design — it is a tally, not a
    result, and it never leaves this module."""
    in_window: int = 0
    warmup: int = 0
    not_computable: int = 0
    answered: int = 0
    signal_rows: List[int] = None          # bar indices where the screen was true
    answered_rows: List[int] = None        # bar indices the screen answered at all
    dates: Tuple[str, ...] = ()
    buckets: List[Optional[int]] = None     # per bar, aligned to `bars`; None = unmeasurable

    def __post_init__(self) -> None:
        if self.signal_rows is None:
            self.signal_rows = []
        if self.answered_rows is None:
            self.answered_rows = []
        if self.buckets is None:
            self.buckets = []


def _scan_symbol(tree: Any, bars: Sequence[Mapping[str, Any]], *,
                 frm: str, to: str, warmup: int,
                 fields: Sequence[str]) -> _SymbolScan:
    """Evaluate the tree over this symbol's bars and tally the window.

    ⭐ THE WHOLE ENGINE IS THIS FUNCTION PLUS ARITHMETIC. ``interpret`` already
    answered every bar; all that is left is to decide which of those answers we
    are entitled to read.

    ⛔ A BAR INSIDE THE WARMUP IS NOT A "NO". Below ``max_lookback`` the tree's
    own declaration says the maths has not got going yet, and ``_cmp`` answers a
    confident ``0.0`` there — the same shape as the missing-scalar defect, one
    axis over. ``max_lookback`` was measured to be a SAFE bound (never earlier
    than the first computable bar) for offsets, rolling windows, composed windows
    and EMA seeds alike, so it is derived from the tree rather than guessed.

    🔴 THE DATES MUST STRICTLY INCREASE, AND THAT IS A REFUSAL RATHER THAN A
    TIDY-UP. Every other malformation this module knows about is refused by name;
    misordered or duplicated rows were the one that produced a CONFIDENT WRONG
    NUMBER instead — measured on 60 rising bars through ``close > 0`` at h=5:

        sorted            -> win_rate 100.0, worst  +7.8%
        rotated b[30:]+b[:30] -> win_rate  90.7, worst -84.6%
        duplicated b+b    -> bars_answered 120, n 114 over 60 evaluated dates

    Both coverage identities CLOSE in all three, because every count is honest
    about the rows it was handed — the rows are the lie. ``_forward_return`` reads
    ``bars[i+1]`` and ``bars[i+1+h]`` positionally, so position must mean time;
    a duplicated tape double-counts every observation, and a rotated one measures
    a forward return across the seam. ⛔ SORTING HERE WOULD BE THE WRONG FIX: this
    module is handed bars, it does not own them, and quietly repairing a reader's
    output would hide the defect from the rail (``bars_reconciliation``) whose job
    it is. The check runs over ALL bars, not just in-window ones, because the
    forward legs reach past ``to``.
    """
    col = interpret(tree, list(bars))
    # ⭐ ASKED AT THE LEAF, BECAUSE THE TOP OF THE TREE CANNOT ANSWER IT — see
    # `_unanswerable_bars`. This is the honest hole; `col[i] is None` alone finds
    # it only for a tree that is a bare series.
    blocked = _unanswerable_bars(bars, fields, warmup)
    scan = _SymbolScan()
    # ⭐ THE BUCKET IS A PROPERTY OF THE BAR, NOT OF THE SIGNAL, so it is
    # measured over the WHOLE tape in this one pass — the same pass that decides
    # which bars are answerable. Computing it later, over a filtered list, would
    # shorten the lagged-ATR window and change the bucket a bar belongs to.
    scan.buckets = _move_buckets(bars)
    dates: List[str] = []
    prev: Optional[str] = None
    for i, bar in enumerate(bars):
        d = bar_date(bar)
        if d is None:
            raise BacktestRefusal(
                "non_daily_bars",
                f"— bar {i} carries t={bar.get('t')!r}; a daily bar's t is "
                f"YYYY-MM-DD. Intraday backtests are out of scope.")
        if prev is not None and d <= prev:
            raise BacktestRefusal(
                "unordered_bars",
                f"— bar {i} is {d}, and bar {i - 1} is {prev}: "
                + ("the same date twice." if d == prev else "the tape goes back.")
                + " Forward returns are read POSITIONALLY (bars[i+1], "
                  "bars[i+1+horizon]), so a duplicated row double-counts an "
                  "observation and an out-of-order row measures across the seam. "
                  "Both produce a confident, wrong curve rather than a gap, so "
                  "this is refused rather than sorted: these bars are not ours "
                  "to repair.")
        prev = d
        if d < frm or d > to:
            continue
        scan.in_window += 1
        if i < warmup:
            scan.warmup += 1
            continue
        v = col[i]
        if v is None or i in blocked:
            # ⭐ THE HONEST HOLE. Past warmup and still unanswerable means a gap
            # in this symbol's data, and it is NOT "the screen did not match".
            # ⛔ BOTH TESTS, AND NEITHER IS REDUNDANT: `v is None` catches a bare
            # series ("close") and anything else that propagates NaN to the top;
            # `blocked` catches the condition trees, where `_cmp` has already
            # turned the hole into a confident 0.0 one node up.
            scan.not_computable += 1
            continue
        if v not in (0.0, 1.0):
            raise BacktestRefusal(
                "not_a_condition",
                f"— it evaluated to {v!r} at {d}. A screen is a true/false "
                f"condition; a bare price or indicator has no signal to test.")
        scan.answered += 1
        scan.answered_rows.append(i)
        dates.append(d)
        if v == 1.0:
            scan.signal_rows.append(i)
    scan.dates = tuple(dates)
    _assert_closes(f"symbol bar", scan.in_window,
                   {"warmup": scan.warmup,
                    "not_computable": scan.not_computable,
                    "answered": scan.answered})
    return scan


def _forward_return(bars: Sequence[Mapping[str, Any]], i: int,
                    horizon: int) -> Optional[float]:
    """⭐⭐ RULE 2. The fill is the NEXT bar's open, never this bar's close.

    The signal is only knowable once bar ``i`` has closed, so the earliest price
    a member could actually have paid is ``bars[i+1]['o']``. Quoting
    ``bars[i]['c']`` books a fill nobody could have got, and on a screen that
    keys off a big close it books the best price of the move — which is the
    oldest way to flatter a backtest and the one that survives review because the
    curve looks plausible.

    ⚠️ THE EXIT IS AN OPEN TOO, so the basis is symmetric and both legs are
    fills a member could take. ``None`` when either leg is missing or is not a
    tradeable price; the caller COUNTS that rather than dropping it.
    """
    fill_i, exit_i = i + 1, i + 1 + horizon
    if exit_i >= len(bars):
        return None
    fill = _finite_positive(bars[fill_i].get("o"))
    exit_ = _finite_positive(bars[exit_i].get("o"))
    if fill is None or exit_ is None:
        return None
    return (exit_ - fill) / fill * 100


# --------------------------------------------------------------------------- #
# the entry point
# --------------------------------------------------------------------------- #

def run_backtest(tree: Any, symbols: Sequence[str], frm: str, to: str, *,
                 bars_for: BarsFor,
                 horizons: Sequence[int] = DEFAULT_HORIZONS,
                 min_signals: int = DEFAULT_MIN_SIGNALS,
                 membership: str = "current",
                 bars_source: Optional[str] = None) -> Receipt:
    """Backtest one screen. Returns a ``Receipt`` — an answer or a named refusal.

    :param tree:        a canonical AST (``parse.js::canonicalise``'s output)
    :param symbols:     the universe, as it stands TODAY (see rule 4)
    :param frm/to:      inclusive ``YYYY-MM-DD`` window bounds
    :param bars_for:    ``symbol -> bars`` — the ONLY way data enters this module
    :param horizons:    forward horizons in bars
    :param min_signals: the floor below which a win rate is withheld
    :param bars_source: a label for the receipt; this module never reads bars itself

    ⛔ NEVER RAISES FOR A REFUSAL. ``BacktestRefusal`` is caught and returned as a
    receipt, because "we cannot answer this, and here is why" is an ANSWER the
    member has to be able to see beside the screen. A ``TableRefusal`` from
    ``interpret`` is deliberately NOT caught: the table refusing a malformed tree
    is a different fact with its own established rendering, and relabelling it
    here would be the wrong-door defect the AST lane documents at length.
    """
    universe = _universe_block(symbols, membership)
    horizons = tuple(horizons)

    def refuse(reason: str, detail: str = "", names: Sequence[str] = (),
               *, warmup: int = 0, coverage: Optional[Dict[str, int]] = None,
               results: Sequence[HorizonResult] = ()) -> Receipt:
        """⛔ ``results`` IS HOW RULE 5's "n IS ALWAYS REPORTED" SURVIVES A
        REFUSAL. A refusal that fires before any bar is read has none and passes
        none; the whole-window ``too_few_signals`` refusal fires *after* every
        horizon is computed and passes what it computed, rather than restating
        one count into a prose sentence no consumer can parse."""
        return Receipt(
            backtestable=False, universe=universe,
            method=_method_block(warmup=warmup, min_signals=min_signals,
                                 horizons=horizons),
            coverage=coverage or {}, window={"from": frm, "to": to},
            bars_source=bars_source, refused=reason, names=tuple(names),
            horizons=tuple(results),
            detail=(f"{REFUSALS[reason]} {detail}".strip()))

    # ── the request itself ────────────────────────────────────────────────── #
    if not symbols:
        return refuse("empty_universe")
    if not horizons:
        return refuse("empty_horizons")
    for h in horizons:
        if isinstance(h, bool) or not isinstance(h, int) or h < 1:
            return refuse("bad_horizon", f"— got {h!r}")
    for label, d in (("from", frm), ("to", to)):
        if not isinstance(d, str) or not _DATE.match(d):
            return refuse("bad_date", f"— {label}={d!r}")
    if frm > to:
        return refuse("bad_window", f"— from={frm} to={to}")

    # ── ⛔⛔ THE HEADLINE REFUSAL, BEFORE A SINGLE BAR IS READ ──────────────── #
    # This is the whole point of the feature. `unresolved_scalars(tree, {})` asks
    # the tree which declared scalars it names; we hold NO history of any of them,
    # so an empty scalar dict is the honest state of the world at every past bar
    # and every name it returns is a name we cannot answer in the past.
    missing = unresolved_scalars(tree, {})
    if missing:
        return refuse(
            "scalar_no_history",
            "— it reads " + ", ".join(f"`{n}`" for n in missing)
            + (". We hold one row per ticker for these, with no history, so "
               "evaluating them at a past bar would screen the past using a fact "
               "from the future. That would produce a confident, wrong curve you "
               "could not audit, so we refuse instead."),
            names=missing)

    warmup = max_lookback(tree)
    fields = _bar_fields(tree)
    method = _method_block(warmup=warmup, min_signals=min_signals,
                           horizons=horizons)
    method["bar_fields_read"] = list(fields)

    # ── walk the universe ─────────────────────────────────────────────────── #
    # ⛔⛔ TWO LISTS, AND THE SPLIT IS THE WHOLE POINT (rule 3). `tallies` holds
    # EVERY symbol that produced a scan and is the ONE source of the bar-grain
    # counts; `scans` holds only the symbols with an observation to contribute
    # and drives the horizon loop. Summing the bar counts over `scans` — as the
    # first draft did — silently deleted the bars of any symbol whose whole
    # window was unanswerable, and reported `bars_not_computable: 0` for a window
    # that was nothing but holes. Deriving both from one list that nobody filters
    # is what makes that unrepeatable, rather than a comment asking for care.
    tallies: List[_SymbolScan] = []
    scans: List[Tuple[str, Sequence[Mapping[str, Any]], _SymbolScan]] = []
    missing_bars = 0        # the reader had nothing for this symbol -> NOT TESTED
    no_window_bars = 0      # bars, but none inside the window -> NOT TESTED
    unanswered_only = 0     # in-window bars, but the screen answered none of them
    try:
        for sym in symbols:
            bars = bars_for(sym)
            if not bars:
                missing_bars += 1
                continue
            bars = list(bars)
            scan = _scan_symbol(tree, bars, frm=frm, to=to, warmup=warmup,
                                fields=fields)
            tallies.append(scan)
            if scan.in_window == 0:
                no_window_bars += 1
                continue
            if scan.answered == 0:
                unanswered_only += 1
                continue
            scans.append((sym, bars, scan))
    except BacktestRefusal as r:
        return refuse(r.reason, r.detail, r.extra.get("names", ()), warmup=warmup)

    tested = len(scans)
    _assert_closes("universe", len(symbols),
                   {"tested": tested, "missing_bars": missing_bars,
                    "no_window_bars": no_window_bars,
                    "unanswered_only": unanswered_only})

    coverage: Dict[str, int] = {
        "symbols_requested": len(symbols),
        "symbols_tested": tested,
        # ⭐ RULE 3: three DIFFERENT reasons a symbol was not tested, kept apart.
        # Folding them together makes "we have no data for it" look like "it
        # never matched", and a member acts on the difference.
        "symbols_missing_bars": missing_bars,
        "symbols_no_bars_in_window": no_window_bars,
        "symbols_no_answer_in_window": unanswered_only,
        # ⛔ OVER `tallies`, NEVER OVER `scans` — see the walk above. A symbol
        # kept out of the horizon loop still had bars, and they are still part of
        # what this window looked like.
        "bars_in_window": sum(s.in_window for s in tallies),
        "bars_warmup": sum(s.warmup for s in tallies),
        "bars_not_computable": sum(s.not_computable for s in tallies),
        "bars_answered": sum(s.answered for s in tallies),
    }
    _assert_closes("bars", coverage["bars_in_window"],
                   {"warmup": coverage["bars_warmup"],
                    "not_computable": coverage["bars_not_computable"],
                    "answered": coverage["bars_answered"]})

    if tested == 0:
        return refuse("no_bars_in_window",
                      f"— {len(symbols)} symbols asked, {missing_bars} had no "
                      f"bars at all, {no_window_bars} none between {frm} and "
                      f"{to}, {unanswered_only} nothing the screen could answer.",
                      warmup=warmup, coverage=coverage)

    signal_bars = sum(len(s.signal_rows) for _, _, s in scans)
    all_dates = {d for _, _, s in scans for d in s.dates}

    # ── each horizon: the strategy arm and its baseline, together ─────────── #
    results: List[HorizonResult] = []
    for h in horizons:
        strat: List[float] = []
        base: List[float] = []
        # (date, bucket) -> [n, sum of winsorised returns] over EVERY answered
        # bar, signal or not — the same population the pooled baseline reads,
        # cut one axis finer.
        cells: Dict[Tuple[str, int], List[float]] = {}
        strat_obs: List[Tuple[Optional[Tuple[str, int]], float]] = []
        no_room = bad_price = 0
        for _, bars, scan in scans:
            signal_at = set(scan.signal_rows)
            for i in scan.answered_rows:
                if i + 1 + h >= len(bars):
                    no_room += 1
                    continue
                r = _forward_return(bars, i, h)
                if r is None:
                    bad_price += 1
                    continue
                # ⭐ THE BASELINE IS THE SAME UNIVERSE OVER THE SAME DATES WITH
                # NO FILTER — every bar the screen ANSWERED, whether it fired or
                # not. That is the population the member's 58% has to beat, and
                # computing it in this same loop is what makes the two numbers
                # describe identical bars by construction rather than by care.
                base.append(r)
                b = scan.buckets[i] if i < len(scan.buckets) else None
                cell = None if b is None else (bar_date(bars[i]), b)
                if cell is not None:
                    acc = cells.get(cell)
                    if acc is None:
                        acc = cells[cell] = [0, 0.0]
                    acc[0] += 1
                    acc[1] += winsorise(r)
                if i in signal_at:
                    strat.append(r)
                    strat_obs.append((cell, r))
        _assert_closes(f"horizon {h}", coverage["bars_answered"],
                       {"evaluated": len(base), "no_forward_room": no_room,
                        "unusable_fill_price": bad_price})
        below = len(strat) < min_signals
        results.append(HorizonResult(
            horizon=h,
            strategy=_stats(strat, withheld=below),
            baseline=_stats(base, withheld=below),
            below_floor=below,
            coverage={"evaluated": len(base), "signals": len(strat),
                      "no_forward_room": no_room,
                      "unusable_fill_price": bad_price},
            same_day=_same_day_excess(strat_obs, cells, withheld=below)))

    # ── rule 5, at the whole-window grain ─────────────────────────────────── #
    if all(r.below_floor for r in results):
        # ⛔ THE COMPUTED RESULTS RIDE ALONG; NO COUNT IS RESTATED HERE. This
        # sentence once read "the best horizon has {n} signal(s)" — a number the
        # `horizons` tuple already owned, copied into prose that no consumer can
        # parse, on the one path where the tuple was then thrown away. The floor
        # IS echoed because it is an INPUT the caller handed us, not a fact
        # derived from the data.
        return refuse(
            "too_few_signals",
            f"— no horizon reached the floor of {min_signals} signal(s); the "
            f"per-horizon counts are in `horizons`. A win rate over that many "
            f"observations is noise wearing a percentage sign. Widen the window "
            f"or loosen the screen.",
            warmup=warmup, coverage=coverage, results=results)

    return Receipt(
        backtestable=True, universe=universe, method=method, coverage=coverage,
        horizons=tuple(results),
        evaluated_dates=len(all_dates),
        symbols_tested=tested,
        signals=signal_bars,
        # ⛔ DERIVED FROM THE DATA, NEVER FROM A CLOCK — determinism (see header).
        as_of=max(all_dates) if all_dates else None,
        bars_source=bars_source,
        window={"from": frm, "to": to})
