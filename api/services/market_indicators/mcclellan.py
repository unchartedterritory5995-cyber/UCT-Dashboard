"""THE McCLELLAN ENGINE — one implementation, every universe, both variants.

⭐⭐ THIS MODULE IS PURE. It takes advances and declines and returns numbers. It knows
nothing about universes, symbols, stores, charts or UCT. That is what makes it testable
against McClellan Financial's own published series, which is the only evidence that
entitles us to the family's names at all.

⛔⛔ THE ARITHMETIC IS NOT "EMA19 − EMA39" AND STOPPING THERE IS HOW YOU SHIP A
DIFFERENT INDICATOR UNDER A FAMOUS NAME. Three additional semantics are load-bearing,
all sourced from mcoscillator.com's own learning centre (2026-09-20):

  1. RATIO ADJUSTMENT excludes UNCHANGED issues from the denominator, deliberately:
     *"One could add in the number of Unchanged issues, but this number is usually very
     small … so we do not bother."* Including them compresses every value.

  2. THE CLASSIC SUMMATION INDEX IS NEUTRAL AT +1000, not zero: *"For the NYSE and
     Nasdaq, we use the +1000 level as neutral, since that was the convention introduced
     by my parents back in 1970."* The RATIO-ADJUSTED summation (RASI) is neutral at
     ZERO, with ±500 as the meaningful band. A series that mixes the two bases is wrong
     by 1000 points and looks perfectly plausible.

  3. THE SMOOTHERS ARE DEFINED BY THEIR TRACKING RATE, not by a day count. McClellan
     writes them as `10%T(today) = 0.9 × 10%T(yesterday) + 0.1 × Price(today)`. The
     "19-day"/"39-day" spelling is the 2/(n+1) translation of exactly that, which is why
     ALPHA_19 == 0.10 and ALPHA_39 == 0.05 EXACTLY rather than approximately.

⭐ VERIFIED: replaying McClellan's own published NYSE advances/declines through
`oscillator_series` + `summation_series`, seeded from their published trends, reproduces
their published Oscillator and Summation Index with a maximum absolute difference of
0.000000000 across 179 sessions. The fixture and the harness are
`tests/fixtures/mcclellan_nyse_reference.csv` and
`tests/test_market_indicators_mcclellan.py`. That test is the licence to use the names.

⚠️ AND IT ONLY LICENSES THE ARITHMETIC. Two correct implementations over two different
censuses of "the NYSE" produce two different numbers, permanently — the exchanges do not
publish advance/decline data, every vendor computes its own, and McClellan treats
Barron's/Dow Jones as the final word. So this engine may be pointed at UCT's own
universes and its output is honest; it is NOT thereby $NYMO. Naming is `naming.py`'s job.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

# ── The two smoothing constants, as McClellan defines them ───────────────────
#
# ⛔ WRITTEN AS THE TRACKING RATE AND ASSERTED AGAINST THE SPAN FORM, because the two
# spellings are the thing most likely to drift apart in a future edit. 2/(19+1) is 0.10
# and 2/(39+1) is 0.05 with no floating-point slack at all — these are exact binary
# fractions — so the equality below is a real check and not a tolerance dance.
ALPHA_19 = 0.10      # the "10% Trend"
ALPHA_39 = 0.05      # the "5% Trend"
assert ALPHA_19 == 2.0 / (19 + 1)
assert ALPHA_39 == 2.0 / (39 + 1)

#: The two normalisation variants. They are NOT interchangeable and a series must
#: declare which one it is — see `Methodology.variant`.
VARIANT_RATIO_ADJUSTED = "ratio_adjusted"   # RANA → RAMO / RASI
VARIANT_CLASSIC = "classic"                 # raw A−D → the 1969 oscillator / summation

#: The neutral level each variant's Summation Index is calibrated to.
SUMMATION_BASE = {
    VARIANT_RATIO_ADJUSTED: 0.0,
    VARIANT_CLASSIC: 1000.0,
}

#: The ratio adjustment's scale factor — *"we are adjusting the data to pretend that
#: there are always exactly 1000 issues traded"*.
RANA_SCALE = 1000.0

#: How the two trends are started when there is no carried-in state.
#:
#: ⛔⛔ THE SEED IS NOT A DETAIL — IT SETS HOW LONG THE SERIES IS WRONG FOR. The error
#: against a correctly-warmed series decays as `0.95^t × δ39(0)`, so the burn-in a
#: universe needs is decided entirely by how far the seed puts the 5% Trend from its
#: true value. Measured against McClellan's own published series (see
#: `tests/test_market_indicators_mcclellan.py::test_seed_mode_convergence_is_measured`):
#:
#:                                    |osc error| vs the published series after
#:     seed mode                        40 obs    80 obs   120 obs   140 obs
#:     SEED_ZERO   (default)             7.877     1.111     0.144     0.052
#:     SEED_SMA                         14.780     3.066     0.411     0.148
#:     SEED_FIRST                      153.539    21.856     ~1.5      ~0.6
#:
#:     SEED_ZERO   both trends start at 0, then take their first step normally.
#:                 ⭐ THE DEFAULT, AND ON A PRINCIPLE RATHER THAN A SCORE: this input
#:                 family is zero-mean BY CONSTRUCTION — every advance is somebody
#:                 else's decline — so 0 is the unconditional expectation of both
#:                 trends and therefore the best seed available without peeking at the
#:                 data. The measurement above is the confirmation, not the argument.
#:     SEED_SMA    seed each trend with the simple average of its own first window
#:                 (19 and 39 observations); the textbook EMA start, and what
#:                 StockCharts documents. Self-adapting, but on this window it starts
#:                 ~2.7x further from the truth than zero does, because the first 39
#:                 sessions were a one-sided decline. It also leaves the oscillator
#:                 UNDEFINED for 38 observations, which is honest but awkward.
#:     SEED_FIRST  both trends start at the first observation. WORST conditioned by a
#:                 wide margin — one session's net advances can sit 1300 points from
#:                 the smoothed level and the 5% Trend needs ~185 sessions to forget
#:                 it. Kept only so the comparison stays reproducible.
SEED_ZERO = "zero"
SEED_SMA = "sma"
SEED_FIRST = "first"

#: The seed every producer gets unless it says otherwise.
DEFAULT_SEED_MODE = SEED_ZERO

#: How many OBSERVATIONS the trends must see before their output is trusted.
#:
#: ⭐ MEASURED, NOT CHOSEN — and re-measured after the seed mode changed, because the
#: first figure written here was taken from a differently-seeded loop and was wrong for
#: the engine as built. The rail that pins it is
#: `test_the_burn_in_constant_bounds_the_permanent_summation_offset`, which fails if
#: the number here stops describing the code.
#:
#: ⭐⭐ 120 IS DERIVED FROM WHAT IT BUYS THE SUMMATION, NOT FROM WHEN THE OSCILLATOR
#: "LOOKS CONVERGED". The oscillator's residual decays as `0.95^t`, so the summation
#: inherits the GEOMETRIC SUM of that residual — about `20 x err(burn_in)` forever.
#: Measured against the published series with the default zero seed:
#:
#:     burn_in   |osc err| at the epoch   permanent summation offset
#:        40            7.877                    +158 points
#:        80            1.111                     +21 points
#:       120            0.144                      +3 points
#:       140            0.052                      +1 point
#:
#: 120 puts the permanent level error at roughly 3 points on an index that ranges over
#: thousands — 0.2% — while costing only ~6 months at the front of a 2008 history.
#:
#: ⛔⛔ AND THE OSCILLATOR'S CONVERGENCE IS NOT THE SUMMATION'S. The summation is a
#: cumulative sum of those errors, so it does NOT converge — a cold replay of the
#: reference accrues a permanent multi-hundred-point offset and never recovers. That is
#: why `summation_series` refuses to run without an explicit epoch and base, and why
#: this constant exists at all: the burn-in is what makes the first ACCUMULATED
#: oscillator value trustworthy, and therefore what makes the level mean anything.
DEFAULT_BURN_IN = 120


@dataclass(frozen=True)
class Methodology:
    """Everything that decides what the numbers MEAN, carried with them.

    ⛔ A SERIES MUST NOT BE ABLE TO EXIST WITHOUT ONE. Two McClellan series that differ
    only in `variant` are 2.7x apart in amplitude on the same session and both look
    correct on a chart; the only way a consumer can tell them apart is if the producer
    says which it is. `version` is bumped whenever any of these change so a stored series
    can be told from a recomputed one.
    """
    variant: str = VARIANT_RATIO_ADJUSTED
    #: Unchanged issues in the ratio denominator. McClellan says no. Kept as a field so
    #: the refusal is a recorded decision rather than an omission in the arithmetic.
    unchanged_in_denominator: bool = False
    burn_in: int = DEFAULT_BURN_IN
    version: str = "mcclellan-v1"

    def __post_init__(self):
        if self.variant not in SUMMATION_BASE:
            raise ValueError(f"unknown McClellan variant {self.variant!r}")
        if self.burn_in < 0:
            raise ValueError("burn_in must not be negative")

    @property
    def summation_base(self) -> float:
        """The neutral level this variant's Summation Index is calibrated to."""
        return SUMMATION_BASE[self.variant]


CLASSIC = Methodology(variant=VARIANT_CLASSIC)
RATIO_ADJUSTED = Methodology(variant=VARIANT_RATIO_ADJUSTED)


# ── Normalisation ────────────────────────────────────────────────────────────

def raw_net_advances(adv: float, dec: float) -> Optional[float]:
    """The 1969 input: advances minus declines, unmodified."""
    if adv is None or dec is None:
        return None
    return float(adv) - float(dec)


def ratio_adjusted_net_advances(adv: float, dec: float,
                                unchanged: float = 0.0,
                                include_unchanged: bool = False) -> Optional[float]:
    """RANA = (A − D) / (A + D) × 1000.

    ⛔ `include_unchanged` DEFAULTS FALSE AND SHOULD STAY FALSE. It exists so the
    decision is visible and testable, not so it can be flipped casually: McClellan
    excludes unchanged issues on purpose, and including them shrinks every reading
    toward zero by the unchanged share.

    ⚠️ A ZERO DENOMINATOR IS A NON-VALUE, NOT A ZERO. A session on which nothing
    advanced and nothing declined tells us nothing about breadth; publishing 0.0 would
    read as "perfectly balanced", which is a claim we did not measure.
    """
    if adv is None or dec is None:
        return None
    a, d = float(adv), float(dec)
    denom = a + d + (float(unchanged or 0.0) if include_unchanged else 0.0)
    if denom <= 0:
        return None
    return (a - d) / denom * RANA_SCALE


def normalise(adv, dec, unchanged=0.0, method: Methodology = RATIO_ADJUSTED) -> Optional[float]:
    """The one entry point a producer calls — picks the variant's input transform."""
    if method.variant == VARIANT_CLASSIC:
        return raw_net_advances(adv, dec)
    return ratio_adjusted_net_advances(
        adv, dec, unchanged, include_unchanged=method.unchanged_in_denominator)


# ── The two trends and the oscillator ────────────────────────────────────────

#: SMA seeding needs the longer window before BOTH trends exist.
_SMA_WINDOW_19 = 19
_SMA_WINDOW_39 = 39


@dataclass
class TrendState:
    """The EMAs carried between sessions — the whole of the oscillator's memory.

    ⭐ EXPOSED AS A VALUE, NOT HIDDEN IN A LOOP, because incremental append and full
    recompute MUST produce identical numbers, and the only way to prove that is to hand
    the same state to both. `test_incremental_append_equals_full_recompute` is that
    proof — and under SMA seeding the warm-up buffer is part of the state for exactly
    that reason, not as an optimisation.

    ⚠️ CONSTRUCTING IT WITH `ema19`/`ema39` SET IS THE "WARM CARRY-IN" CASE and bypasses
    seeding entirely. That is how a reference-seeded validation run works, and how a
    future incremental producer resumes.
    """
    ema19: Optional[float] = None
    ema39: Optional[float] = None
    n: int = 0                                    # observations folded in so far
    seed_mode: str = DEFAULT_SEED_MODE
    buf: list = field(default_factory=list)       # warm-up window, SMA seeding only

    def step(self, x: float) -> Optional[float]:
        """Fold one normalised value in and return that session's oscillator.

        ⛔ RETURNS `None` WHILE THE TRENDS ARE STILL BEING SEEDED under SMA mode. An
        oscillator that does not exist yet must not be reported as a number — that is
        the whole difference between "warming up" and "flat".
        """
        self.n += 1
        if self.seed_mode == SEED_SMA and (self.ema19 is None or self.ema39 is None):
            self.buf.append(x)
            if self.ema19 is None and len(self.buf) >= _SMA_WINDOW_19:
                self.ema19 = sum(self.buf[:_SMA_WINDOW_19]) / _SMA_WINDOW_19
            elif self.ema19 is not None:
                self.ema19 = (1.0 - ALPHA_19) * self.ema19 + ALPHA_19 * x
            if len(self.buf) >= _SMA_WINDOW_39:
                self.ema39 = sum(self.buf[:_SMA_WINDOW_39]) / _SMA_WINDOW_39
                self.buf = []                      # both trends live; drop the window
            if self.ema19 is None or self.ema39 is None:
                return None
            return self.ema19 - self.ema39

        if self.ema19 is None or self.ema39 is None:
            if self.seed_mode == SEED_ZERO:
                self.ema19 = (1.0 - ALPHA_19) * 0.0 + ALPHA_19 * x
                self.ema39 = (1.0 - ALPHA_39) * 0.0 + ALPHA_39 * x
            else:                                  # SEED_FIRST
                self.ema19 = x
                self.ema39 = x
        else:
            self.ema19 = (1.0 - ALPHA_19) * self.ema19 + ALPHA_19 * x
            self.ema39 = (1.0 - ALPHA_39) * self.ema39 + ALPHA_39 * x
        return self.ema19 - self.ema39

    def copy(self) -> "TrendState":
        return TrendState(self.ema19, self.ema39, self.n, self.seed_mode, list(self.buf))


def oscillator_series(values: Iterable[Optional[float]],
                      state: Optional[TrendState] = None,
                      seed_mode: str = DEFAULT_SEED_MODE) -> tuple[list[Optional[float]], TrendState]:
    """Normalised inputs → (oscillator per session, final trend state).

    ⚠️ A `None` INPUT DOES NOT ADVANCE THE TRENDS. A session with no measurable breadth
    is a hole, and folding a zero in would pull both EMAs toward zero as though the
    market had been perfectly balanced. The output carries `None` at that index and the
    state is untouched, so the next real session continues from where the last one left.
    """
    st = state.copy() if state is not None else TrendState(seed_mode=seed_mode)
    out: list[Optional[float]] = []
    for v in values:
        if v is None:
            out.append(None)
            continue
        out.append(st.step(float(v)))
    return out, st


# ── The Summation Index ──────────────────────────────────────────────────────

class SummationNotAnchored(ValueError):
    """Raised when a Summation Index is asked for without a defined starting level.

    ⛔⛔ THIS IS A DELIBERATE REFUSAL, NOT A MISSING DEFAULT. A Summation Index is a
    cumulative sum: its ABSOLUTE LEVEL is entirely determined by where you started and
    what the oscillator was doing while the EMAs were still warming up. Measured against
    McClellan's own series, a cold start is off by +698 points forever. Defaulting to
    "start at zero on whatever the first row happens to be" would produce a number that
    is plausible, reproducible, and meaningless — the worst of the three.
    """


@dataclass(frozen=True)
class Anchor:
    """Where a Summation Index starts, and why.

    Exactly one of the two strategies:

      EPOCH + BASE  — `at` is the first session the summation is DEFINED on and `value`
                      is the level it takes there. Used when no external reference for
                      this universe exists (UCT's own universes), so the level is ours by
                      declaration. Honest, deterministic, and NOT comparable to a vendor's
                      series — which is the point.

      REFERENCE      — `at` is a session on which an established publisher's value is
                      known and `value` is that value. Used for NYSE/Nasdaq once the
                      inputs exist, so the level is comparable. `source` records who.

    ⚠️ `at` MUST BE A SESSION THE OSCILLATOR IS ALREADY TRUSTWORTHY ON — i.e. at least
    `burn_in` sessions after the inputs begin. `summation_series` enforces it.
    """
    at: str                      # 'YYYY-MM-DD'
    value: float
    source: str = "declared"     # 'declared' | 'reference:<publisher>'

    def __post_init__(self):
        if not self.at or len(str(self.at)) != 10:
            raise ValueError("anchor date must be an ISO 'YYYY-MM-DD'")


def summation_series(dates: Sequence[str],
                     oscillator: Sequence[Optional[float]],
                     anchor: Anchor,
                     method: Methodology = RATIO_ADJUSTED,
                     burn_in_ok: bool = True) -> list[Optional[float]]:
    """Accumulate the oscillator into a Summation Index anchored at `anchor`.

    The series is `None` before the anchor date (it is not defined there), takes
    `anchor.value` ON the anchor date, and thereafter adds each session's oscillator:

        SUMM(t) = SUMM(t−1) + OSC(t)

    ⛔ THE ANCHOR DATE'S OWN OSCILLATOR IS NOT ADDED. The anchor states the level AT that
    session, so adding that session's change again would double-count it. This is the
    single easiest off-by-one in the whole family and the reason the fixture test
    compares the anchor row itself and not only the rows after it.

    ⚠️ A HOLE IS CARRIED, NOT SKIPPED. If a session's oscillator is `None` the summation
    holds its previous level rather than ending — the level is a stock, not a flow, and
    it does not cease to exist because one session could not be measured.
    """
    if len(dates) != len(oscillator):
        raise ValueError("dates and oscillator must be the same length")
    try:
        start = list(dates).index(anchor.at)
    except ValueError:
        raise SummationNotAnchored(
            f"anchor date {anchor.at} is not in the session list — a Summation Index "
            f"cannot be positioned relative to a session that does not exist")
    if not burn_in_ok:
        raise SummationNotAnchored(
            f"anchor date {anchor.at} is inside the {method.burn_in}-session burn-in; "
            f"the oscillator is not yet trustworthy there, so the level it would fix "
            f"is an artifact of the seed rather than of the market")

    out: list[Optional[float]] = [None] * len(dates)
    level = float(anchor.value)
    out[start] = level
    for i in range(start + 1, len(dates)):
        osc = oscillator[i]
        if osc is not None:
            level = level + float(osc)
        out[i] = level
    return out


def first_trustworthy_index(oscillator: Sequence[Optional[float]],
                            method: Methodology = RATIO_ADJUSTED) -> Optional[int]:
    """The index of the first session on which `burn_in` real observations precede it.

    ⭐ COUNTS REAL OBSERVATIONS, NOT ROWS. A stretch of holes does not warm an EMA, so a
    calendar-based burn-in would declare a series trustworthy that had seen twenty
    samples. This is what `summation_series`' epoch should be derived from.
    """
    seen = 0
    for i, v in enumerate(oscillator):
        if v is not None:
            seen += 1
        if seen > method.burn_in:
            return i
    return None


# ── The whole computation, in one call ───────────────────────────────────────

@dataclass
class McClellanResult:
    dates: list[str]
    normalised: list[Optional[float]]
    ema19: list[Optional[float]]
    ema39: list[Optional[float]]
    oscillator: list[Optional[float]]
    summation: list[Optional[float]]
    method: Methodology
    anchor: Optional[Anchor]
    state: TrendState


def compute(dates: Sequence[str],
            advances: Sequence[Optional[float]],
            declines: Sequence[Optional[float]],
            unchanged: Optional[Sequence[Optional[float]]] = None,
            method: Methodology = RATIO_ADJUSTED,
            anchor: Optional[Anchor] = None,
            state: Optional[TrendState] = None,
            seed_mode: str = DEFAULT_SEED_MODE) -> McClellanResult:
    """The full pipeline for one universe: normalise → trends → oscillator → summation.

    `anchor` is optional so the oscillator can be produced on its own — which is exactly
    the shipping order this project uses, because the oscillator is provable today and
    the summation needs a methodology decision first.
    """
    n = len(dates)
    if len(advances) != n or len(declines) != n:
        raise ValueError("dates, advances and declines must be the same length")
    unch = list(unchanged) if unchanged is not None else [0.0] * n

    norm = [normalise(advances[i], declines[i], unch[i], method) for i in range(n)]

    st = state.copy() if state is not None else TrendState(seed_mode=seed_mode)
    e19: list[Optional[float]] = []
    e39: list[Optional[float]] = []
    osc: list[Optional[float]] = []
    for v in norm:
        if v is None:
            e19.append(None)
            e39.append(None)
            osc.append(None)
            continue
        o = st.step(float(v))
        # ⚠️ While SMA seeding is still filling its window the trends do not exist yet.
        # Reporting 0.0 there would draw a flat line that looks like a balanced market.
        e19.append(st.ema19 if o is not None else None)
        e39.append(st.ema39 if o is not None else None)
        osc.append(o)

    summ: list[Optional[float]] = [None] * n
    if anchor is not None:
        idx = first_trustworthy_index(osc, method)
        try:
            anchor_pos = list(dates).index(anchor.at)
        except ValueError:
            raise SummationNotAnchored(
                f"anchor date {anchor.at} is not in the session list")
        ok = idx is not None and anchor_pos >= idx
        # ⚠️ A REFERENCE anchor is exempt from the burn-in gate ON PURPOSE. When an
        # established publisher tells us the level on a date, that level is a fact about
        # the market rather than an artifact of our warm-up, and it CORRECTS the seed
        # rather than inheriting it. A declared anchor has no such backstop.
        if anchor.source.startswith("reference:"):
            ok = True
        summ = summation_series(list(dates), osc, anchor, method, burn_in_ok=ok)

    return McClellanResult(list(dates), norm, e19, e39, osc, summ, method, anchor, st)
