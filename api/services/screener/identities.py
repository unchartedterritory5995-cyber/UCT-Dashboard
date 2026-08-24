"""Internal arithmetic identities over the screener snapshot — the free oracle.

WHY THIS MODULE EXISTS
======================
The 2026-08-23 accuracy audit asked the question ~9,600 green tests never ask —
*is the number TRUE?* — and found roughly thirty wrong columns. Not one existing
test could have failed on any of them, because every test asserts what the code
DOES and every defect is what the number SAYS.

A third of that list was catchable for free. Many columns must agree with each
other **by definition**: operating expenses are non-negative, so a gross margin
cannot sit below its own operating margin; equity is never larger than assets,
so a positive ROE cannot sit below a positive ROA; a 20-day high is inside a
52-week window, so the distance to it can never be the further of the two. A
violation of one of these is *proof* of an error — no vendor, no API key, no
seventeen-ticker sample, and it runs on **every row**.

⭐ THIS MODULE PREVENTS THE DEFECT CLASS. It does not patch one instance. Adding
the next identity is ONE ENTRY in a table, never a new function.

WHAT IT IS NOT
==============
⛔ It is NOT wired into the nightly build. That is the controller's call and
another module's file. `run_over_snapshot()` and the `__main__` CLI make it
runnable and reportable today; see the lane report for the argued wiring.

THE ONE RULE THAT MATTERS MOST
==============================
⛔ A row where either side is NULL is **NOT CHECKABLE**. It is never a pass and
never a violation, and the receipt counts it separately. Folding "we could not
look" into "we looked and it was fine" is how a coverage number becomes a lie —
the same reason `CoverageLine` refuses to collapse its four counts, and the same
reason `scan_store` gives `not_computable` its own column. A `0` meaning "we do
not know" is invisible, it **sorts**, and it **filters**.

Every identity therefore splits the population five ways and the arithmetic must
close, or the receipt refuses to exist:

    rows_seen = checkable + skipped_null + skipped_nonfinite + skipped_gate
    checkable = satisfied + violated

`skipped_nonfinite` is its own bucket on purpose. A NaN in a REAL column is not
an absence — it is a defect, and one that a plain `is None` test reports as
healthy.

TOLERANCES CARRY A REASON, NOT A GUESS
======================================
⭐ **A ratio whose true value sits near 1.0 needs an ABSOLUTE tolerance, because
a relative band around unity is meaningless.** "Within 5%" of a quantity that is
supposed to be 1.0 is 0.95–1.05, which says nothing about the two definitions
that might have produced it. Every `Tol` below carries a `why` string, and where
the honest tolerance is a function of the row — because the operands are stored
rounded and the rounding error propagates differently at different magnitudes —
`Tol.per_row` takes a callable instead of a constant.

That is not a theoretical nicety. Measured on the 2026-08-23 snapshot, the
`atr_ext_sma50` identity reports **34 violations against a guessed constant
0.0005 and 0 against the propagated 2-dp rounding bound** over the same 3,706
rows. The constant would have sent someone hunting a phantom.

HOW TO ADD ONE
==============
Append an `Identity(...)` inside `build_identities()`. It needs:

  name       stable snake_case id (used by tests and by any future refusal)
  family     grouping for the rollup
  statement  the claim, in words a member would recognise
  why        the PROOF — why it cannot be false when everything is right
  columns    every column the predicate reads. A row missing ANY of them is
             NOT CHECKABLE. This is the honest-None gate and it is automatic.
  excess     row -> float. <= 0 means satisfied exactly. A positive number is
             how far the row sits on the wrong side, IN THE IDENTITY'S OWN
             UNITS. Violation is `excess > tolerance`.
  tol        a `Tol` — value or per_row callable, plus its justification
  gate       optional extra checkability predicate (NOT a pass/fail test — a
             row it rejects is counted as not-checkable, with `gate_why`)
  severity   "proof"    the identity cannot be false; a violation IS a bug
             "advisory" defensible sources could legitimately disagree; a
                        violation is a question, not a verdict

⛔ DO NOT hand-type a list another artifact already owns. The percent-column
family below is derived from `filters.FILTERS`'s own `unit == "%"` declaration,
so a column that gains that unit tomorrow is covered tomorrow with no edit here.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import os
import sqlite3
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, Sequence

SCHEMA = "screener.identities/1"

_INF = float("inf")


class IdentityReceiptError(RuntimeError):
    """The receipt's arithmetic did not close.

    Mirrors `scan_evaluator._assert_coverage_closes`: a receipt whose counts do
    not add up is worse than no receipt, because it reads as measurement. We
    refuse to emit one rather than publish a number nobody can reconcile.
    """


# ─────────────────────────────────────────────────────────────────────────────
#  The two data shapes
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Tol:
    """A tolerance and the reason it is that number.

    Exactly one of `value` / `per_row` must be given. `per_row` exists for the
    identities whose honest bound is a function of the operands — typically
    because the snapshot stores a value `round(x, 2)` and the propagated
    rounding error scales with the magnitude of the terms.
    """

    why: str
    value: float | None = None
    per_row: Callable[[Mapping[str, Any]], float] | None = None

    def __post_init__(self):
        if (self.value is None) == (self.per_row is None):
            raise ValueError(
                f"Tol needs exactly one of value/per_row (why={self.why!r})")
        if not self.why:
            raise ValueError("a tolerance without a justification is a guess")

    def for_row(self, row: Mapping[str, Any]) -> float:
        return float(self.per_row(row)) if self.per_row else float(self.value)

    def describe(self) -> dict:
        return {
            "kind": "per-row" if self.per_row else "constant",
            "value": None if self.per_row else self.value,
            "why": self.why,
        }


@dataclass(frozen=True)
class Identity:
    name: str
    family: str
    statement: str
    why: str
    columns: tuple[str, ...]
    excess: Callable[[Mapping[str, Any]], float]
    tol: Tol
    severity: str = "proof"
    gate: Callable[[Mapping[str, Any]], bool] | None = None
    gate_why: str = ""

    def __post_init__(self):
        if self.severity not in ("proof", "advisory"):
            raise ValueError(f"{self.name}: severity must be proof|advisory")
        if not self.columns:
            raise ValueError(f"{self.name}: an identity reads at least one column")
        if self.gate is not None and not self.gate_why:
            raise ValueError(f"{self.name}: a gate must say why it excludes a row")

    def describe(self) -> dict:
        return {
            "name": self.name,
            "family": self.family,
            "statement": self.statement,
            "why": self.why,
            "severity": self.severity,
            "columns": list(self.columns),
            "tolerance": self.tol.describe(),
            "gate": self.gate_why or None,
        }


# ─────────────────────────────────────────────────────────────────────────────
#  Constructors — the shapes an identity comes in. Each returns an `Identity`,
#  so a new entry is one call, never a new evaluation path.
# ─────────────────────────────────────────────────────────────────────────────

def _n(row: Mapping[str, Any], col: str) -> float:
    return float(row[col])


def at_least(name, family, a, b, statement, why, tol, *, severity="proof",
             gate=None, gate_why="", extra_columns=()):
    """`a >= b`. Excess is how far `a` fell BELOW `b`."""
    return Identity(
        name=name, family=family, statement=statement, why=why,
        columns=tuple([a, b]) + tuple(extra_columns),
        excess=lambda r, a=a, b=b: _n(r, b) - _n(r, a),
        tol=tol, severity=severity, gate=gate, gate_why=gate_why)


def band(name, family, col, lo, hi, statement, why, tol, *, severity="proof",
         gate=None, gate_why=""):
    """`lo <= col <= hi`. Excess is the distance outside the nearer edge."""
    return Identity(
        name=name, family=family, statement=statement, why=why,
        columns=(col,),
        excess=lambda r, c=col, lo=lo, hi=hi: max(lo - _n(r, c), _n(r, c) - hi),
        tol=tol, severity=severity, gate=gate, gate_why=gate_why)


def equals(name, family, columns, lhs, rhs, statement, why, tol, *,
           severity="proof", gate=None, gate_why=""):
    """`lhs(row) == rhs(row)`. Excess is the absolute difference."""
    return Identity(
        name=name, family=family, statement=statement, why=why,
        columns=tuple(columns),
        excess=lambda r, l=lhs, s=rhs: abs(l(r) - s(r)),
        tol=tol, severity=severity, gate=gate, gate_why=gate_why)


def implies(name, family, columns, antecedent, consequent, statement, why, *,
            severity="proof", gate=None, gate_why=""):
    """`antecedent(row) => consequent(row)`.

    Excess is 1.0 or 0.0 and the tolerance is 0: there is no such thing as
    being slightly wrong about an implication. Where rounding could make the
    antecedent fire spuriously, put the epsilon INSIDE the antecedent, where a
    reader can see what it is protecting.
    """
    return Identity(
        name=name, family=family, statement=statement, why=why,
        columns=tuple(columns),
        excess=lambda r, a=antecedent, c=consequent: (
            1.0 if (a(r) and not c(r)) else 0.0),
        tol=Tol(value=0.0, why="an implication is true or it is not; there is "
                               "no partial credit. Any rounding slack belongs "
                               "inside the antecedent where it is visible."),
        severity=severity, gate=gate, gate_why=gate_why)


# ─────────────────────────────────────────────────────────────────────────────
#  Tolerances used more than once, so the reason is written down once
# ─────────────────────────────────────────────────────────────────────────────

# `technicals._pct` returns `round(x, 2)`, so every `chg_pct_*`, `pct_vs_*` and
# `dist_*` column is stored to the hundredth of a percentage point. Two such
# numbers compared can differ by one ULP of that rounding and nothing more.
_TOL_2DP_PCT = Tol(
    value=0.011,
    why="`technicals._pct` stores `round(x, 2)`, so a comparison between two "
        "stored percents admits exactly one 2-dp ULP (0.01) plus a float hair. "
        "A RELATIVE band would be wrong here: `chg_pct_1d = 0.01` is a real "
        "value near zero and 5% of it is meaningless.")

# `candles.single_candle` stores `round(x, 4)` on all four fractions.
_TOL_4DP_SUM3 = Tol(
    value=0.0002,
    why="`candles.single_candle` stores `round(x, 4)`; a comparison across "
        "three such values admits at most 3 x 0.00005 of rounding, so 0.0002 "
        "is the closure bound and anything past it is a real disagreement. "
        "ABSOLUTE, because the compared quantity is a fraction on [0, 1] where "
        "a relative band collapses at the zero edge.")

_TOL_4DP_ONE = Tol(
    value=0.0001,
    why="`candles.single_candle` stores `round(x, 4)`, so one stored fraction "
        "sits within 0.00005 of its true value; 0.0001 is one ULP of that "
        "storage. ABSOLUTE — the band's edges (0 and 1) are hard, and a "
        "relative tolerance at the 0 edge is undefined.")

_TOL_PCT_POINT_HAIR = Tol(
    value=0.01,
    why="`fundamentals_bulk.value_for` applies no rounding — it scales the "
        "provider float by 100 — so the only slack an INEQUALITY between two "
        "margins can need is float noise. 0.01 percentage points is far below "
        "anything rendered (1-2 dp) and far above IEEE-754 noise. An ABSOLUTE "
        "band, not a relative one: a margin near zero makes relative error "
        "meaningless (see the fundamentals lane's LCID and GBLI cases).")


def _tol_atr_ext(row: Mapping[str, Any]) -> float:
    """Propagated 2-dp rounding for the `atr_ext_sma50` closure.

    LHS is `atr_ext_sma50 x atr_pct/100`. Both operands are stored `round(x, 2)`,
    so each carries +/-0.005. First-order:

        d(LHS) <= 0.005 * atr_pct/100  +  |atr_ext| * 0.005/100

    RHS is a function of `pct_vs_sma50` (also 2-dp), contributing ~5e-5. The
    trailing 1e-4 covers that plus float noise.

    ⭐ MEASURED, NOT ASSUMED: on the 2026-08-23 snapshot this bound gives 0
    violations over 3,706 checkable rows, where a guessed constant 0.0005 gives
    34. The 34 are all rounding at small `atr_pct`, not disagreement — which is
    exactly the phantom a constant tolerance manufactures.
    """
    return (0.005 * abs(row["atr_pct"]) / 100.0
            + abs(row["atr_ext_sma50"]) * 0.005 / 100.0
            + 1e-4)


# ─────────────────────────────────────────────────────────────────────────────
#  Derived column lists — never hand-typed beside the artifact that owns them
# ─────────────────────────────────────────────────────────────────────────────

def percent_columns() -> list[str]:
    """Every snapshot column the FILTER REGISTRY declares as a percent.

    ⭐ Derived from `filters.FILTERS[...]["unit"] == "%"`, which is the artifact
    the frontend already renders from. A column that gains that unit tomorrow is
    covered tomorrow with no edit here; a column that loses it stops being
    checked, correctly. Retyping the list would put a second authority on "which
    columns are percents", which is this repo's most repeated defect.

    ⚠️ KNOWN GAP, AND NOT THIS MODULE'S TO FIX: at 2026-08-23 `pct_vs_sma50`,
    `pct_vs_sma200` and `dist_20d_low_pct` are stored as percents and carry NO
    `unit` in the registry, so they fall outside this family. The fix is one
    keyword in `filters.py` — recorded in the lane report as a requirement,
    because widening the derivation to compensate would rebuild the second
    authority this function exists to avoid.
    """
    from api.services.screener import filters  # local: keep import graph thin
    cols = {spec["column"] for spec in filters.FILTERS.values()
            if spec.get("unit") == "%" and spec.get("column")}
    return sorted(cols)


# A percent whose magnitude is past this is not a market fact, it is a unit
# error — the 1e2 / 1e6 factor class. Deliberately loose: the widest real value
# in the 2026-08-23 population is `chg_pct_1y = 3,494.77` (a 35-bagger), so a
# 100,000% ceiling has ~28x of headroom above the most extreme true value and
# cannot false-flag a market move.
_PCT_MAGNITUDE_CEILING = 1e5

# ⛔ A TIGHT PER-COLUMN BAND IS DELIBERATELY NOT INVENTED HERE. "Margins live in
# [-100, 100]" is false (LCID's net margin is -263.7 and correct). "Returns live
# in [-100, 1000]" is false (a 35-bagger exists in this very snapshot). Every
# tight band is an owner decision about that column's plausible range, and
# guessing one would ship a refusal that fires on correct data — the exact
# failure mode a good gate must not have. The loose ceiling above is a
# UNIT-ERROR catch-net and is described as one.


# Columns that are a SHARE OF A WHOLE and therefore cannot leave [0, 100].
# Each entry carries its own reason: this is a set of per-column claims, not a
# restatement of a list some other artifact owns.
_SHARE_OF_TOTAL = {
    "float_pct": "the free float as a percentage of shares outstanding; the "
                 "float is a subset of the shares by definition",
    "inst_pct": "institutional ownership as a percentage of shares outstanding",
    "insider_own_pct": "insider ownership as a percentage of shares outstanding",
    "short_float_pct": "shares short as a percentage of the float; a value past "
                       "100 means more shares are short than exist to borrow",
    "opt_bull_pct_1d": "bullish premium as a share of classified premium; the "
                       "flow lane verified the [0,100] bound holds on 231/231",
    "sector_rs_pct": "a percentile rank of the symbol within its sector; a "
                     "percentile is a share of the population below it and "
                     "cannot leave [0, 100] under any ranking convention",
}

# ⛔ `payout_ratio` IS DELIBERATELY ABSENT from `_SHARE_OF_TOTAL`, and the
# omission is the interesting part. It looks like a share of a whole and is not:
# a REIT distributes more than GAAP earnings as a matter of course, and the
# fundamentals lane measured O at 226.88% against yfinance's 236.42% — both
# correct. Banding it at 100 would flag every REIT in the universe as broken.
# Same reasoning excludes `insider_trans_pct` / `inst_trans_pct`, which are NET
# transaction percentages against a prior holding and can legitimately exceed
# 100 in either direction.

# Columns that cannot be negative, each with the construction that guarantees it.
_NON_NEGATIVE = {
    "price": "a traded price",
    "avg_volume_30d": "a mean of share counts",
    "dollar_vol_30d": "price x volume, both non-negative",
    "adr_pct": "a mean of (high - low)/close over 21 sessions; high >= low",
    "adr_pct_1w": "the same mean over a 5-session window",
    "atr_pct": "Wilder true range as a percentage of price; true range >= 0",
    "close_cv_pct": "a standard deviation over a mean; both non-negative",
    "avg_body_pct_5": "a mean of |close - open| / range",
    "pullback_depth_pct": "(20-bar high - close)/high; the window's high is at "
                          "least the last bar's high, which is at least its close",
    "pole_pct": "trough-to-peak gain where the trough precedes the peak",
    "vol_ratio": "today's volume over a mean of prior volumes",
    "dp_notional_1d": "a sum of price x size over executed prints",
    "dp_notional_5d": "the same sum over five sessions",
    "dp_prints_1d": "a count of prints",
    "market_cap": "price x share count",
    "shares_outstanding": "a share count",
    "float_shares": "a share count",
    "upgrades_30d": "a count of rating upgrades",
    "downgrades_30d": "a count of rating downgrades",
}

# Fractions stored on [0, 1] by construction in `candles.single_candle`.
_UNIT_FRACTION = {
    "body_pct": "|close - open| / (high - low); the body is inside the range",
    "upper_wick_pct": "(high - max(open, close)) / (high - low)",
    "lower_wick_pct": "(min(open, close) - low) / (high - low)",
    "close_position": "(close - low) / (high - low); the close is inside the range",
    "avg_body_pct_5": "a mean of five values each on [0, 1]",
}


# ─────────────────────────────────────────────────────────────────────────────
#  THE TABLE
# ─────────────────────────────────────────────────────────────────────────────

def build_identities(*, percent_cols: Sequence[str] | None = None
                     ) -> tuple[Identity, ...]:
    """Assemble the identity table. Injectable so tests can pin the derivation."""
    out: list[Identity] = []

    # ── window nesting ────────────────────────────────────────────────────
    # A shorter lookback window is a SUBSET of a longer one, so its extreme is
    # never more extreme. These three run on every row and need nothing but the
    # snapshot; the technicals lane measured all three clean on 3,707+ rows,
    # which is what makes them a trustworthy standing rail rather than a guess.
    out.append(at_least(
        "dist_20d_high_ge_52w_high", "windows",
        "dist_20d_high_pct", "dist_52w_high_pct",
        "the distance to the 20-day high is never further below than the "
        "distance to the 52-week high",
        "the 20-session window is contained in the 252-session window, so its "
        "maximum high is <= the year's maximum high, so the (negative) distance "
        "from today's close to it is >= the distance to the year's high",
        _TOL_2DP_PCT))
    out.append(at_least(
        "dist_52w_high_ge_ath", "windows",
        "dist_52w_high_pct", "dist_ath_pct",
        "the distance to the 52-week high is never further below than the "
        "distance to the all-time high",
        "the 252-session window is contained in the full stored series, so the "
        "same containment argument applies one level up",
        _TOL_2DP_PCT))
    out.append(at_least(
        "dist_52w_low_ge_20d_low", "windows",
        "dist_52w_low_pct", "dist_20d_low_pct",
        "the rise above the 52-week low is never smaller than the rise above "
        "the 20-day low",
        "containment again, mirrored: the year's minimum low is <= the "
        "20-session minimum low, so today's close sits at least as far above it",
        _TOL_2DP_PCT))
    out.append(band(
        "dist_52w_high_not_positive", "windows", "dist_52w_high_pct", -_INF, 0.0,
        "the close is never above the 52-week high",
        "the 52-week high is a maximum over bar HIGHS including today's, and "
        "today's close is <= today's high",
        _TOL_2DP_PCT))
    out.append(band(
        "dist_52w_low_not_negative", "windows", "dist_52w_low_pct", 0.0, _INF,
        "the close is never below the 52-week low",
        "the 52-week low is a minimum over bar LOWS including today's, and "
        "today's close is >= today's low",
        _TOL_2DP_PCT))
    out.append(band(
        "dist_20d_high_not_positive", "windows", "dist_20d_high_pct", -_INF, 0.0,
        "the close is never above the 20-day high",
        "same containment argument on the 20-session window",
        _TOL_2DP_PCT))
    out.append(band(
        "dist_ath_not_positive", "windows", "dist_ath_pct", -_INF, 0.0,
        "the close is never above the all-time high",
        "the all-time high is a maximum over every stored bar high including "
        "today's",
        _TOL_2DP_PCT))

    # `new_52w_high` / `new_ath` compare today's HIGH to the window maximum
    # while `dist_*` compares today's CLOSE. The implication therefore runs ONE
    # WAY ONLY: closing at the high proves a new high was made, but making a new
    # high intraday and closing below it is ordinary. ⛔ Asserting the converse
    # would flag every intraday-high-then-fade as a bug.
    out.append(implies(
        "close_at_52w_high_implies_flag", "windows",
        ("dist_52w_high_pct", "new_52w_high"),
        lambda r: r["dist_52w_high_pct"] >= -0.0001,
        lambda r: bool(r["new_52w_high"]),
        "if the close IS the 52-week high then the new-high flag is set",
        "`new_52w_high` tests today's HIGH against the window maximum; a close "
        "at the maximum means the high reached it too. The converse is NOT "
        "asserted: an intraday new high that fades is ordinary."))
    out.append(implies(
        "close_at_ath_implies_flag", "windows",
        ("dist_ath_pct", "new_ath"),
        lambda r: r["dist_ath_pct"] >= -0.0001,
        lambda r: bool(r["new_ath"]),
        "if the close IS the all-time high then the new-ATH flag is set",
        "same one-way argument as the 52-week pair"))

    # ── return arithmetic ─────────────────────────────────────────────────
    # ⭐ THIS ONE PROVES A UNIT. If `gap_pct` or `chg_from_open_pct` were stored
    # as fractions rather than percents, the product would miss 1 + chg/100 by
    # orders of magnitude on every row. The technicals lane measured it closing
    # on all 3,707 rows, which is the proof that all three are percents — a fact
    # that is published nowhere a member can reach.
    out.append(equals(
        "gap_times_intraday_is_daily", "returns",
        ("gap_pct", "chg_from_open_pct", "chg_pct_1d"),
        lambda r: (1 + r["gap_pct"] / 100.0) * (1 + r["chg_from_open_pct"] / 100.0),
        lambda r: 1 + r["chg_pct_1d"] / 100.0,
        "the overnight gap compounded with the intraday move equals the daily "
        "change",
        "close/prev_close = (open/prev_close) x (close/open). An algebraic "
        "identity with no room for a definition to differ",
        Tol(value=2e-4,
            why="three operands each stored `round(x, 2)`; the product's "
                "first-order error is ~1e-4 at ordinary magnitudes. ABSOLUTE, "
                "because the compared quantity sits at 1.0 and a relative band "
                "around unity is meaningless.")))
    out.append(equals(
        "daily_change_matches_prev_close", "returns",
        ("chg_pct_1d", "price", "prev_day_close"),
        lambda r: (r["price"] / r["prev_day_close"] - 1) * 100.0,
        lambda r: r["chg_pct_1d"],
        "the daily change equals price over the previous close",
        "definitional; the snapshot carries both operands, so the published "
        "percentage can be recomputed from the row itself with no external "
        "source",
        _TOL_2DP_PCT,
        gate=lambda r: r["prev_day_close"] > 0,
        gate_why="a non-positive previous close has no percentage change"))

    # ── moving-average agreement ──────────────────────────────────────────
    out.append(implies(
        "above_50sma_agrees_with_pct", "moving-averages",
        ("above_50sma", "pct_vs_sma50"),
        lambda r: abs(r["pct_vs_sma50"]) > 0.005,
        lambda r: bool(r["above_50sma"]) == (r["pct_vs_sma50"] > 0),
        "the above-50SMA flag agrees with the sign of the distance to the 50SMA",
        "both derive from the same `price > sma50` comparison. The antecedent "
        "excludes |pct| <= 0.005 because `round(x, 2)` can print 0.00 for a "
        "price genuinely above the average, where the flag is correct and the "
        "sign test is not."))
    out.append(implies(
        "ma_stack_full_bull_is_above_all", "moving-averages",
        ("ma_stack", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200"),
        lambda r: r["ma_stack"] == "full-bull",
        lambda r: (r["pct_vs_sma20"] > -0.005 and r["pct_vs_sma50"] > -0.005
                   and r["pct_vs_sma200"] > -0.005),
        "a full-bull stack means the close is above all three averages",
        "`technicals` sets full-bull only when price > sma20 > sma50 > sma200, "
        "so price exceeds all three. The -0.005 admits the 2-dp rounding that "
        "can print 0.00 for a genuinely positive distance."))
    out.append(implies(
        "ma_stack_bear_is_below_all", "moving-averages",
        ("ma_stack", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200"),
        lambda r: r["ma_stack"] == "bear",
        lambda r: (r["pct_vs_sma20"] < 0.005 and r["pct_vs_sma50"] < 0.005
                   and r["pct_vs_sma200"] < 0.005),
        "a bear stack means the close is below all three averages",
        "`technicals` sets bear only when price < sma20 < sma50 < sma200, so "
        "price is under all three. Mirror of the full-bull case, including the "
        "0.005 that admits a 2-dp print of 0.00 for a genuinely negative "
        "distance."))
    out.append(equals(
        "atr_extension_closes_with_sma50_distance", "moving-averages",
        ("atr_ext_sma50", "atr_pct", "pct_vs_sma50"),
        lambda r: r["atr_ext_sma50"] * (r["atr_pct"] / 100.0),
        lambda r: ((r["pct_vs_sma50"] / 100.0)
                   / (1.0 + r["pct_vs_sma50"] / 100.0)),
        "extension above the 50SMA in ATR units, times ATR as a fraction of "
        "price, equals the fractional gap between price and the 50SMA",
        "atr_ext = (close - sma50)/atr and atr_pct = atr/close x 100, so their "
        "product is (close - sma50)/close, which is also pct_vs_sma50 rewritten "
        "over the close instead of over the average. Two columns computed from "
        "different intermediates must land on the same number",
        Tol(per_row=_tol_atr_ext,
            why="PER-ROW, because the honest bound is propagated 2-dp storage "
                "rounding and it scales with the operands (see `_tol_atr_ext`). "
                "MEASURED: 0 violations over 3,706 rows, where a guessed "
                "constant 0.0005 gives 34 — all of them rounding at small "
                "`atr_pct`, i.e. phantoms a constant tolerance manufactures."),
        gate=lambda r: r["atr_pct"] > 0,
        gate_why="a zero ATR makes the product identically zero and the "
                 "identity vacuous"))

    # ── candle structure ──────────────────────────────────────────────────
    # 🔴 THIS PAIR FOUND A DEFECT NO LANE REPORTED IN THIS SHAPE. See the lane
    # report: `candles.py` divides by `max(high - low, 1e-9)`, so a bar whose
    # high equals its low but whose open differs from its close publishes a
    # `body_pct` of 5.82 BILLION (EWCZ) and 10 MILLION (MCW), each mirrored by
    # an equally absurd negative `lower_wick_pct`, both labelled `marubozu`.
    # A member sorting the Candles view by body descending gets them first.
    out.append(equals(
        "candle_parts_close_to_one", "candles",
        ("body_pct", "upper_wick_pct", "lower_wick_pct"),
        lambda r: r["body_pct"] + r["upper_wick_pct"] + r["lower_wick_pct"],
        lambda r: 1.0,
        "body plus upper wick plus lower wick is the whole bar",
        "body = |close - open|, upper = high - max(open, close), lower = "
        "min(open, close) - low. They sum to high - low by construction, so "
        "dividing all three by the range must give 1",
        _TOL_4DP_SUM3))
    out.append(Identity(
        name="close_position_inside_body_and_lower_wick",
        family="candles",
        statement="the close sits between the bottom of the bar and the top of "
                  "the body",
        why="close_position = (close - low)/range. When close >= open that is "
            "lower_wick + body; when close < open it is exactly lower_wick. "
            "Either way it lies in [lower_wick, lower_wick + body] — an "
            "identity that needs no knowledge of the bar's direction",
        columns=("close_position", "lower_wick_pct", "body_pct"),
        excess=lambda r: max(
            r["lower_wick_pct"] - r["close_position"],
            r["close_position"] - (r["lower_wick_pct"] + r["body_pct"])),
        tol=_TOL_4DP_SUM3))

    for col, why in sorted(_UNIT_FRACTION.items()):
        out.append(band(
            f"fraction_band__{col}", "candles", col, 0.0, 1.0,
            f"`{col}` is a fraction of the bar's range and lies in [0, 1]",
            why, _TOL_4DP_ONE))

    # ── previous-session OHLC ─────────────────────────────────────────────
    out.append(Identity(
        name="prev_day_ohlc_ordered",
        family="bars",
        statement="the previous session's high is the highest of its four "
                  "prices and its low the lowest",
        why="a session's high and low bound every trade in it, so they bound "
            "the open and the close. A row that breaks this carries a corrupt "
            "bar, and every technical computed from that bar inherits it",
        columns=("prev_day_open", "prev_day_high", "prev_day_low",
                 "prev_day_close"),
        excess=lambda r: max(
            max(r["prev_day_open"], r["prev_day_close"]) - r["prev_day_high"],
            r["prev_day_low"] - min(r["prev_day_open"], r["prev_day_close"])),
        tol=Tol(value=1e-6,
                why="prices are stored unrounded; the only slack is float "
                    "representation. ABSOLUTE in dollars because the quantity "
                    "compared is a price difference, not a ratio.")))

    # ── indicator ranges ──────────────────────────────────────────────────
    out.append(band(
        "rsi_in_range", "indicators", "rsi14", 0.0, 100.0,
        "RSI is a percentage on [0, 100]",
        "RSI is 100 x avg_gain/(avg_gain + avg_loss) with both terms "
        "non-negative, so it cannot leave the interval under any smoothing "
        "convention (Wilder's or Cutler's)",
        Tol(value=0.011,
            why="stored `round(x, 2)`; one 2-dp ULP. ABSOLUTE, because a "
                "relative band at the 0 endpoint is undefined.")))
    out.append(band(
        "uct_composite_in_range", "indicators", "uct_composite", 0.0, 99.0,
        "the UCT composite is a 0-99 score",
        "the range is stated by `filters.py`'s own unit convention docstring — "
        "a published claim, not one invented here",
        Tol(value=0.0, why="an integer score has no tolerance")))
    out.append(band(
        "rs_rank_in_range", "indicators", "rs_rank", 0.0, 99.0,
        "the RS rank is a 0-99 score",
        "same published unit convention in `filters.py`",
        Tol(value=0.0, why="an integer score has no tolerance")))
    # ⛔ `rating_eps`/`rating_growth`/`rating_value`/`rating_smr` are NOT banded.
    # They ship as `_open_range` filters with no published scale, so any band
    # would be invented — and a refusal built on an invented range fires on
    # correct data. Recorded in the lane report as an owner decision.

    # ── size and share counts ─────────────────────────────────────────────
    out.append(equals(
        "dollar_volume_is_price_times_volume", "size",
        ("dollar_vol_30d", "price", "avg_volume_30d"),
        lambda r: r["dollar_vol_30d"],
        lambda r: r["price"] * r["avg_volume_30d"],
        "30-day dollar volume equals price times 30-day average volume",
        "that is the formula the builder uses. ⚠️ It is also the formula the "
        "surface lane found DISAGREES with the column's own published sentence "
        "(`mean(price x volume)`); this identity certifies the code, not the "
        "sentence, and the mismatch is that lane's finding",
        Tol(value=None, per_row=lambda r: 0.01 * abs(r["price"] * r["avg_volume_30d"]),
            why="RELATIVE 1% is right here and absolute would be absurd: the "
                "quantity spans 1e3 to 1e11 dollars, and both operands are "
                "stored rounded so their product cannot close absolutely.")))
    out.append(at_least(
        "shares_outstanding_ge_float", "size",
        "shares_outstanding", "float_shares",
        "the free float never exceeds shares outstanding",
        "the float is shares outstanding minus closely-held shares, a "
        "non-negative subtraction",
        Tol(value=0.0,
            why="two share counts from the same provider row; there is no "
                "vintage difference to absorb and no rounding is applied.")))
    out.append(equals(
        "float_pct_matches_share_counts", "size",
        ("float_pct", "float_shares", "shares_outstanding"),
        lambda r: r["float_pct"],
        lambda r: r["float_shares"] / r["shares_outstanding"] * 100.0,
        "float percentage equals float shares over shares outstanding",
        "definitional, and the snapshot carries all three, so a divergence "
        "means two authorities over one value",
        Tol(value=0.5,
            why="0.5 percentage points ABSOLUTE. The provider rounds the "
                "published percentage and the two share counts independently; "
                "a relative band would be meaningless for a float near 100%."),
        gate=lambda r: r["shares_outstanding"] > 0,
        gate_why="no percentage of a zero share count"))
    out.append(equals(
        "market_cap_is_price_times_shares", "size",
        ("market_cap", "price", "shares_outstanding"),
        lambda r: r["market_cap"],
        lambda r: r["price"] * r["shares_outstanding"],
        "market cap equals price times shares outstanding",
        "definitional for a single-class issuer",
        Tol(value=None,
            per_row=lambda r: 0.05 * abs(r["price"] * r["shares_outstanding"]),
            why="RELATIVE 5%. Share-count vintage (a 10-Q cover page vs the "
                "latest 8-K) moves a real market cap 1-2% — the fundamentals "
                "lane measured PLD at -2.24% and called it correct — so 5% is "
                "vintage headroom, not laxity."),
        severity="advisory",
        gate=lambda r: r["shares_outstanding"] > 0,
        gate_why="no product against a zero share count"))
    # ⚠️ WHY `market_cap_is_price_times_shares` IS ADVISORY AND NOT PROOF.
    # A DUAL-CLASS issuer can publish a class-specific share count beside an
    # all-class market cap; the fundamentals lane warned that yfinance's
    # `sharesOutstanding` for BRK-B is the B class only (1.408B) against a true
    # $1.061T cap, so a naive check flags a CORRECT row. Our count comes from
    # Finviz, not yfinance, and it could NOT be measured on this box (0 non-null
    # rows — no `FINVIZ_API_KEY`). Until a production run says otherwise, a
    # violation here is a question, not a verdict.

    # ── fundamentals: the two the audit's identities caught ───────────────
    out.append(at_least(
        "gross_margin_ge_op_margin", "fundamentals",
        "gross_margin", "op_margin",
        "gross margin is never below operating margin",
        "operating income = gross profit - operating expenses, and operating "
        "expenses are non-negative. Dividing both by the same positive revenue "
        "preserves the inequality. ⭐ This is what caught PLD publishing a "
        "29.05% gross margin against its own 38.43% operating margin — "
        "arithmetically impossible, provable with no external source",
        _TOL_PCT_POINT_HAIR))
    out.append(at_least(
        "roe_ge_roa_when_both_positive", "fundamentals",
        "roe", "roa",
        "a positive return on equity is never below the return on assets",
        "assets = liabilities + equity with liabilities >= 0, so equity <= "
        "assets; dividing the same positive net income by the smaller "
        "denominator gives the larger ratio. ⭐ This is what caught GBLI at "
        "0.019% ROE against its own 1.99% ROA — wrong by 248x",
        _TOL_PCT_POINT_HAIR,
        gate=lambda r: r["roa"] > 0 and r["roe"] > 0,
        gate_why="the inequality REVERSES for a loss-maker (a negative net "
                 "income over the smaller denominator is MORE negative) and "
                 "flips sign entirely for a company with negative book value. "
                 "Both are ordinary, so both are excluded from the population "
                 "rather than counted as violations — this gate is the "
                 "difference between a rail and a false-positive generator."))
    out.append(Identity(
        name="insider_plus_institutional_within_100",
        family="fundamentals",
        statement="insider ownership plus institutional ownership does not "
                  "exceed the shares outstanding",
        why="both are percentages of the same denominator. ⚠️ ADVISORY, not "
            "proof: the two categories can genuinely OVERLAP where a 13F filer "
            "is also a 10% owner, so a row slightly past 100 may be honest "
            "double-counting rather than an error. A row far past it is a unit "
            "error or a broken denominator",
        columns=("insider_own_pct", "inst_pct"),
        excess=lambda r: r["insider_own_pct"] + r["inst_pct"] - 100.0,
        tol=Tol(value=5.0,
                why="5 percentage points ABSOLUTE, sized to the overlap the "
                    "categories genuinely admit. A relative band on a sum that "
                    "sits near 100 would be meaningless."),
        severity="advisory"))
    out.append(equals(
        "price_target_upside_matches_target", "fundamentals",
        ("pt_upside_pct", "pt_target", "price"),
        lambda r: r["pt_upside_pct"],
        lambda r: (r["pt_target"] - r["price"]) / r["price"] * 100.0,
        "analyst upside equals the target over the price",
        "definitional, and both operands are in the row — so a divergence "
        "means the upside was computed against a different price than the one "
        "published beside it, which is the two-authorities-over-one-value "
        "defect this audit found on `price` vs `market_cap`",
        _TOL_2DP_PCT,
        gate=lambda r: r["price"] > 0,
        gate_why="no percentage against a zero price"))
    out.append(Identity(
        name="days_to_earnings_matches_date",
        family="events",
        statement="the earnings countdown equals the gap between the snapshot "
                  "date and the next earnings date",
        why="two representations of one fact, both published in the same row. "
            "A divergence means the countdown was computed on a different day "
            "than the row claims to describe — the stale-as-of class the audit "
            "found on `price` vs `market_cap`",
        columns=("days_to_earnings", "next_earnings_date", "snapshot_date"),
        excess=lambda r: abs(
            (_parse_ymd(r["next_earnings_date"]) - _parse_ymd(r["snapshot_date"])).days
            - float(r["days_to_earnings"])),
        tol=Tol(value=0.0,
                why="a whole number of days; there is no fractional day to "
                    "tolerate."),
        gate=lambda r: (_parse_ymd(r["next_earnings_date"]) is not None
                        and _parse_ymd(r["snapshot_date"]) is not None),
        gate_why="a date this module cannot parse is not evidence of anything"))

    # ── flow ──────────────────────────────────────────────────────────────
    out.append(at_least(
        "dp_5d_notional_ge_1d", "flow",
        "dp_notional_5d", "dp_notional_1d",
        "five sessions of block notional is never less than one",
        "the one-day window is contained in the five-day window and every "
        "print contributes a non-negative notional, so the longer sum "
        "dominates. ⭐ This is the containment half of the audit's "
        "`dp_notional <= close x volume` ceiling and, unlike that one, it needs "
        "nothing but the snapshot — 482 checkable rows on this box",
        Tol(value=1.0,
            why="one dollar ABSOLUTE. Both sides are sums of the same "
                "price x size decimals, so there is no measurement noise; the "
                "dollar absorbs float accumulation over thousands of prints.")))
    out.append(Identity(
        name="dp_notional_within_session_tape",
        family="flow",
        statement="one session of dark-pool notional never exceeds that "
                  "session's total dollar volume",
        why="block prints are consolidated-tape trades and therefore a STRICT "
            "SUBSET of the session's dollar volume, by construction. ⚠️ THIS "
            "IDENTITY IS NOT CHECKABLE FROM THE SNAPSHOT ALONE: `screener_rows` "
            "carries `avg_volume_30d`, a thirty-session mean, and a spike day "
            "can legitimately exceed it. It needs the SESSION's own dollar "
            "volume, which the nightly builder holds and the snapshot discards. "
            "Supply it as `session_dollar_vol` on the row and this rail arms "
            "itself; until then the receipt reports it as not-checkable, which "
            "is the honest answer and a standing reminder",
        columns=("dp_notional_1d", "session_dollar_vol"),
        excess=lambda r: (r["dp_notional_1d"] / r["session_dollar_vol"]) - 1.15,
        tol=Tol(value=0.0,
                why="the 0.15 cushion is INSIDE the predicate, where a reader "
                    "can see it. It is ABSOLUTE ON THE RATIO because the true "
                    "value sits just under 1.0 and a relative band around unity "
                    "says nothing: the only legitimate slack is that the "
                    "denominator is priced at the CLOSE while the prints "
                    "executed at intraday prices, worth ~10% against VWAP. The "
                    "flow lane measured a max ratio of 0.734 over 476 tickers, "
                    "so 1.15 has real headroom and still refuses the "
                    "impossible."),
        gate=lambda r: r["session_dollar_vol"] > 0,
        gate_why="a zero-volume session has no ceiling to be under"))
    out.append(implies(
        "bull_share_agrees_with_net_premium", "flow",
        ("opt_bull_pct_1d", "opt_net_premium_1d"),
        lambda r: True,
        lambda r: (r["opt_bull_pct_1d"] > 50) == (r["opt_net_premium_1d"] > 0),
        "a bullish share above half means net premium is positive",
        "the share and the net are two views of the same classified premium "
        "split; above half bullish IS net-positive. The flow lane measured "
        "agreement on 231/231"))

    # ── generated families ────────────────────────────────────────────────
    for col, why in sorted(_SHARE_OF_TOTAL.items()):
        out.append(band(
            f"share_band__{col}", "shares-of-a-whole", col, 0.0, 100.0,
            f"`{col}` is a share of a whole and lies in [0, 100]",
            why,
            Tol(value=0.05,
                why="0.05 percentage points ABSOLUTE. Providers publish these "
                    "to 2 dp; the band's edges are hard, so the only slack is "
                    "the published rounding. Relative would be undefined at the "
                    "0 edge.")))

    for col, why in sorted(_NON_NEGATIVE.items()):
        # The per-column noun is short because the claim is; the shared clause
        # carries the argument, so the reason is composed rather than padded.
        out.append(band(
            f"non_negative__{col}", "non-negative", col, 0.0, _INF,
            f"`{col}` is never negative",
            f"it is {why}. A quantity of that construction has no negative "
            f"value, so a negative here is not a small error — it is a corrupt "
            f"input or a sign bug, and it sorts to the TOP of an ascending "
            f"screen where a member will act on it first",
            Tol(value=0.0,
                why="a negative value here is not a small error, it is a "
                    "different quantity; there is nothing to tolerate.")))

    for col in (percent_cols if percent_cols is not None else percent_columns()):
        out.append(band(
            f"pct_magnitude__{col}", "percent-unit-sanity", col,
            -_PCT_MAGNITUDE_CEILING, _PCT_MAGNITUDE_CEILING,
            f"`{col}` is stored as a percent and its magnitude is not a unit "
            f"error",
            "the filter registry declares this column's unit as '%'. This is a "
            "UNIT-ERROR catch-net (the 1e2 / 1e6 factor class), NOT a "
            "plausibility band: the widest true value in the 2026-08-23 "
            "population is a 3,494% one-year return, so the ceiling has ~28x of "
            "headroom above any real market move",
            Tol(value=0.0,
                why="the ceiling is already ~28x above the most extreme true "
                    "value measured; adding slack on top of that would only "
                    "blunt it.")))

    _assert_unique(out)
    return tuple(out)


def _assert_unique(items: Sequence[Identity]) -> None:
    seen: dict[str, int] = {}
    for it in items:
        seen[it.name] = seen.get(it.name, 0) + 1
    dupes = sorted(n for n, c in seen.items() if c > 1)
    if dupes:
        raise ValueError(f"duplicate identity names: {dupes}")


def _parse_ymd(v: Any):
    """`YYYY-MM-DD` (or `YYYYMMDD`) -> date, else None. Never raises."""
    if v is None:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return _dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


IDENTITIES: tuple[Identity, ...] = build_identities()


# ─────────────────────────────────────────────────────────────────────────────
#  The runner
# ─────────────────────────────────────────────────────────────────────────────

def _cell(row: Mapping[str, Any], col: str):
    """Return (state, value) where state is 'absent' | 'null' | 'nonfinite' | 'ok'."""
    if col not in row:
        return "absent", None
    v = row[col]
    if v is None:
        return "null", None
    if isinstance(v, str):
        return ("null", None) if not v.strip() else ("ok", v)
    if isinstance(v, bool):
        return "ok", v
    if isinstance(v, (int, float)):
        return ("ok", v) if math.isfinite(float(v)) else ("nonfinite", v)
    return "ok", v


def _label(row: Mapping[str, Any], index: int) -> str:
    t = row.get("ticker")
    return str(t) if t else f"row#{index}"


@dataclass
class _Tally:
    checkable: int = 0
    skipped_null: int = 0
    skipped_nonfinite: int = 0
    skipped_gate: int = 0
    satisfied: int = 0
    violated: int = 0
    errors: int = 0
    worst: list = field(default_factory=list)
    max_over: float = 0.0
    missing_columns: set = field(default_factory=set)
    null_by_column: dict = field(default_factory=dict)


def run(rows: Iterable[Mapping[str, Any]], *, worst_n: int = 5,
        identities: Sequence[Identity] | None = None,
        meta: Mapping[str, Any] | None = None) -> dict:
    """Evaluate every identity over `rows` and return the structured receipt.

    PURE over the rows it is handed — no I/O, no database, no clock beyond the
    `generated_at` stamp. That is what makes it testable against fixtures and
    reusable by whatever eventually wires it into the build.
    """
    ids = tuple(identities) if identities is not None else IDENTITIES
    tallies: dict[str, _Tally] = {i.name: _Tally() for i in ids}
    available: set[str] = set()
    rows_seen = 0
    # ⛔ THE AS-OF IS COUNTED, NEVER SAMPLED. Reading `snapshot_date` off the
    # first row and printing it as the receipt's header is exactly the defect
    # the audit found on `price` vs `market_cap`: a page whose rows disagree
    # about what day it is, published under one date. `_served_anchor_date`
    # already refuses to name an anchor a mixed page does not share, and so
    # does this — the receipt reports the MIX and leaves the single value null.
    asof_mix: dict[str, dict[Any, int]] = {
        "snapshot_date": {}, "bars_asof": {}}

    for idx, row in enumerate(rows):
        rows_seen += 1
        available |= set(row.keys())
        for k, counts in asof_mix.items():
            v = row.get(k)
            if v is not None:
                counts[v] = counts.get(v, 0) + 1
        for ident in ids:
            t = tallies[ident.name]
            state = "ok"
            offender = None
            for col in ident.columns:
                st, _v = _cell(row, col)
                if st == "absent":
                    t.missing_columns.add(col)
                if st in ("absent", "null"):
                    state, offender = "null", col
                    break
                if st == "nonfinite":
                    state, offender = "nonfinite", col
                    break
            if state == "null":
                t.skipped_null += 1
                t.null_by_column[offender] = t.null_by_column.get(offender, 0) + 1
                continue
            if state == "nonfinite":
                t.skipped_nonfinite += 1
                t.null_by_column[offender] = t.null_by_column.get(offender, 0) + 1
                continue
            if ident.gate is not None:
                try:
                    passes = bool(ident.gate(row))
                except Exception:
                    passes = False
                if not passes:
                    t.skipped_gate += 1
                    continue
            t.checkable += 1
            try:
                exc = float(ident.excess(row))
                tol = ident.tol.for_row(row)
            except Exception as e:  # a predicate that cannot run is a defect,
                t.errors += 1       # not a pass — surface it, never swallow it.
                t.violated += 1
                t.worst.append({
                    "ticker": _label(row, idx), "error": f"{type(e).__name__}: {e}",
                    "over_tolerance": _INF,
                    "values": {c: row.get(c) for c in ident.columns},
                })
                continue
            over = exc - tol
            if over > 0:
                t.violated += 1
                t.max_over = max(t.max_over, over)
                t.worst.append({
                    "ticker": _label(row, idx),
                    "excess": exc, "tolerance": tol, "over_tolerance": over,
                    "values": {c: row.get(c) for c in ident.columns},
                })
            else:
                t.satisfied += 1

    results = []
    for ident in ids:
        t = tallies[ident.name]
        total = (t.checkable + t.skipped_null + t.skipped_nonfinite
                 + t.skipped_gate)
        if total != rows_seen or t.checkable != t.satisfied + t.violated:
            raise IdentityReceiptError(
                f"{ident.name}: receipt does not close — rows_seen={rows_seen} "
                f"checkable={t.checkable} null={t.skipped_null} "
                f"nonfinite={t.skipped_nonfinite} gate={t.skipped_gate} "
                f"satisfied={t.satisfied} violated={t.violated}")
        t.worst.sort(key=lambda w: -w["over_tolerance"])
        d = ident.describe()
        d.update({
            "rows_seen": rows_seen,
            "checkable": t.checkable,
            "skipped_null": t.skipped_null,
            "skipped_nonfinite": t.skipped_nonfinite,
            "skipped_gate": t.skipped_gate,
            "satisfied": t.satisfied,
            "violated": t.violated,
            "predicate_errors": t.errors,
            "violation_rate": (t.violated / t.checkable) if t.checkable else None,
            "max_over_tolerance": t.max_over if t.violated else None,
            "columns_absent_from_data": sorted(t.missing_columns),
            "null_by_column": dict(sorted(t.null_by_column.items())),
            "worst": t.worst[:worst_n],
        })
        results.append(d)

    by_family: dict[str, dict] = {}
    for r in results:
        f = by_family.setdefault(r["family"], {
            "identities": 0, "checkable": 0, "violated": 0, "violating": 0})
        f["identities"] += 1
        f["checkable"] += r["checkable"]
        f["violated"] += r["violated"]
        f["violating"] += 1 if r["violated"] else 0

    receipt = {
        "schema": SCHEMA,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(
            timespec="seconds"),
        "rows_seen": rows_seen,
        "columns_seen": len(available),
        "identity_count": len(ids),
        "violations_total": sum(r["violated"] for r in results),
        "identities_violated": sorted(
            r["name"] for r in results if r["violated"]),
        "identities_violated_proof": sorted(
            r["name"] for r in results
            if r["violated"] and r["severity"] == "proof"),
        "identities_not_checkable_here": sorted(
            r["name"] for r in results if r["checkable"] == 0),
        "by_family": dict(sorted(by_family.items())),
        "results": results,
    }
    for key, counts in asof_mix.items():
        ordered = dict(sorted(counts.items(), key=lambda kv: (-kv[1], str(kv[0]))))
        # One shared value -> name it. More than one -> name NONE of them and
        # publish the split, so nobody quotes a majority as "the" as-of.
        receipt[key] = next(iter(ordered)) if len(ordered) == 1 else None
        receipt[f"{key}_mix"] = {str(k): v for k, v in ordered.items()}
    if meta:
        receipt.update(dict(meta))
    return receipt


# ─────────────────────────────────────────────────────────────────────────────
#  Reading the built snapshot
# ─────────────────────────────────────────────────────────────────────────────

def read_snapshot_rows(db_path: str | None = None, *, limit: int | None = None
                       ) -> list[dict]:
    """Read `screener_rows` as plain dicts.

    Opens READ-ONLY through a `file:...?mode=ro` URI. ⛔ On this box `/data`
    resolves to `C:\\data`, the owner's LIVE store — a module that can be run by
    hand must not be able to create a journal sidecar there, so the read-only
    URI is not politeness, it is the guard.
    """
    if db_path is None:
        from api.services.screener import snapshot_db
        db_path = snapshot_db.get_db_path()
    uri = f"file:{os.path.abspath(db_path).replace(os.sep, '/')}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30)
    try:
        conn.row_factory = sqlite3.Row
        sql = "SELECT * FROM screener_rows"
        if limit:
            sql += f" LIMIT {int(limit)}"
        return [dict(r) for r in conn.execute(sql)]
    finally:
        conn.close()


def run_over_snapshot(db_path: str | None = None, *, worst_n: int = 5,
                      limit: int | None = None) -> dict:
    rows = read_snapshot_rows(db_path, limit=limit)
    return run(rows, worst_n=worst_n, meta={"db_path": db_path or "(default)"})


# ─────────────────────────────────────────────────────────────────────────────
#  Reporting
# ─────────────────────────────────────────────────────────────────────────────

def _fmt(v, width=None):
    if isinstance(v, float):
        if v != v or v in (_INF, -_INF):
            return str(v)
        s = f"{v:,.4g}"
    else:
        s = str(v)
    return s.rjust(width) if width else s


def format_report(receipt: Mapping[str, Any], *, verbose: bool = True) -> str:
    """Human-readable receipt. The counts come from the receipt, never retyped."""
    L: list[str] = []
    L.append("SCREENER INTERNAL IDENTITIES")
    L.append("=" * 78)
    L.append(f"generated   {receipt['generated_at']}")
    if receipt.get("db_path"):
        L.append(f"database    {receipt['db_path']}")
    for key in ("snapshot_date", "bars_asof"):
        mix = receipt.get(f"{key}_mix") or {}
        if not mix:
            continue
        if receipt.get(key) is not None:
            L.append(f"{key:11s} {receipt[key]}")
        else:
            top = "  ".join(f"{k}:{v:,}" for k, v in list(mix.items())[:4])
            more = "" if len(mix) <= 4 else f"  (+{len(mix) - 4} more)"
            L.append(f"{key:11s} MIXED across {len(mix)} values — {top}{more}")
    L.append(f"rows        {receipt['rows_seen']:,}   "
             f"columns {receipt['columns_seen']}")
    L.append(f"identities  {receipt['identity_count']}   "
             f"violations {receipt['violations_total']:,}   "
             f"identities violated {len(receipt['identities_violated'])}   "
             f"not checkable here {len(receipt['identities_not_checkable_here'])}")
    L.append("")
    hdr = (f"{'identity':46s} {'sev':>4s} {'check':>7s} {'null':>7s} "
           f"{'gate':>6s} {'viol':>6s}")
    L.append(hdr)
    L.append("-" * len(hdr))
    for r in receipt["results"]:
        sev = "P" if r["severity"] == "proof" else "adv"
        mark = "  " if not r["violated"] else "!!"
        L.append(f"{mark}{r['name'][:44]:44s} {sev:>4s} {r['checkable']:>7,} "
                 f"{r['skipped_null'] + r['skipped_nonfinite']:>7,} "
                 f"{r['skipped_gate']:>6,} {r['violated']:>6,}")
    L.append("")

    viol = [r for r in receipt["results"] if r["violated"]]
    if viol:
        L.append("VIOLATIONS — worst offenders by name")
        L.append("=" * 78)
        for r in viol:
            L.append(f"\n[{r['severity'].upper()}] {r['name']}  "
                     f"({r['violated']:,} of {r['checkable']:,} checkable)")
            L.append(f"    claim     {r['statement']}")
            L.append(f"    tolerance {r['tolerance']['kind']} "
                     f"{'' if r['tolerance']['value'] is None else r['tolerance']['value']}"
                     f" — {r['tolerance']['why']}")
            for w in r["worst"]:
                vals = "  ".join(f"{k}={_fmt(v)}" for k, v in w["values"].items())
                if "error" in w:
                    L.append(f"    {w['ticker']:8s} PREDICATE ERROR {w['error']}"
                             f"   {vals}")
                else:
                    L.append(f"    {w['ticker']:8s} over tolerance by "
                             f"{_fmt(w['over_tolerance'])}   {vals}")
    else:
        L.append("No violations.")

    nc = receipt["identities_not_checkable_here"]
    if nc and verbose:
        L.append("")
        L.append("NOT CHECKABLE ON THIS DATA — zero rows had every operand")
        L.append("=" * 78)
        L.append("⛔ This is NOT a pass. These identities were never evaluated.")
        by_name = {r["name"]: r for r in receipt["results"]}
        for name in nc:
            r = by_name[name]
            absent = r["columns_absent_from_data"]
            nulls = ", ".join(f"{k}:{v:,}" for k, v in
                              list(r["null_by_column"].items())[:4])
            reason = (f"column absent from the data: {', '.join(absent)}"
                      if absent else f"NULL on every row ({nulls})")
            L.append(f"  {name:52s} {reason}")
    return "\n".join(L)


# ─────────────────────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────────────────────

def main(argv: Sequence[str] | None = None) -> int:
    """Run the identities over a snapshot and print the receipt.

    Exit codes: 0 clean · 1 at least one PROOF identity violated · 2 could not
    read the snapshot. `--fail-on advisory` widens 1 to include advisories;
    `--fail-on none` reports without ever failing.
    """
    p = argparse.ArgumentParser(
        prog="python -m api.services.screener.identities",
        description="Internal arithmetic identities over the screener snapshot.")
    p.add_argument("--db", default=None,
                   help="path to screener.db (default: snapshot_db.get_db_path())")
    p.add_argument("--json", default=None, metavar="PATH",
                   help="also write the structured receipt here")
    p.add_argument("--worst", type=int, default=5,
                   help="offenders to name per identity (default 5)")
    p.add_argument("--limit", type=int, default=None,
                   help="evaluate only the first N rows (smoke runs)")
    p.add_argument("--fail-on", choices=("proof", "advisory", "none"),
                   default="proof",
                   help="which severities make the exit code non-zero")
    p.add_argument("--quiet", action="store_true",
                   help="omit the not-checkable section")
    a = p.parse_args(list(argv) if argv is not None else None)

    # The report quotes the identity table's own prose, which carries the
    # house's ⭐/⛔/⚠️ markers. A Windows console defaults to cp1252 and dies on
    # them — and a tool that crashes while PRINTING a clean receipt reads as a
    # failed run. Ask for UTF-8; fall back silently if the stream cannot.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass

    try:
        receipt = run_over_snapshot(a.db, worst_n=a.worst, limit=a.limit)
    except sqlite3.Error as e:
        print(f"could not read the snapshot: {e}", file=sys.stderr)
        return 2

    print(format_report(receipt, verbose=not a.quiet))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(receipt, fh, indent=2, default=str)
        print(f"\nreceipt written to {a.json}")

    if a.fail_on == "none":
        return 0
    if a.fail_on == "proof":
        return 1 if receipt["identities_violated_proof"] else 0
    return 1 if receipt["identities_violated"] else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
