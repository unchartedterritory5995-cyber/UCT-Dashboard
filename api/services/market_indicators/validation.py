"""THE GOLDEN MATRIX — a reusable harness for proving a derived indicator matches a reference.

⭐⭐ WHY THIS IS A MODULE AND NOT A TEST. The rule this project ships under is
*accuracy before branding*: UCT may not expose NYMO / NYSI / NAMO / NASI until its
calculation reproduces an established implementation to a documented tolerance across a
substantial historical matrix. That is a gate we will have to re-run against DIFFERENT
inputs later — ours, once Breadth V2 finalises the exchange universes — so the harness has
to outlive the one fixture it is first pointed at.

⛔⛔ TWO DIFFERENT CLAIMS, AND THE HARNESS MUST NOT CONFLATE THEM:

  FORMULA FIDELITY  — given the reference's OWN advances and declines, do we reproduce
                      the reference's oscillator and summation? This can and must be
                      EXACT. It is a statement about arithmetic.

  INPUT FIDELITY    — do OUR advances and declines equal the reference's? This can never
                      be exact and is not a defect: the exchanges do not publish
                      advance/decline data, every vendor computes its own from its own
                      census, and McClellan treats Barron's/Dow Jones as the final word.

A harness that demands equality end-to-end will fail forever and teach nothing. One that
reports a single blended number hides which half moved. So `run_matrix` takes the inputs
it is given and reports formula fidelity; `compare_inputs` reports input fidelity; and
the caller says which claim it is making.
"""
from __future__ import annotations

import csv
import math
import os
from dataclasses import dataclass, field
from typing import Optional, Sequence

from api.services.market_indicators import mcclellan as mc


#: Formula fidelity is EXACT-equal in intent; this is float slack, not a tolerance on the
#: mathematics. The measured max |diff| over the 179-session reference replay is 0.0.
EXACT_TOLERANCE = 1e-9

#: What a comparison against DIFFERENT inputs (our universe vs theirs) is allowed to be
#: before it stops being "the same indicator over a different population" and starts
#: being a defect. Deliberately a placeholder until we have both series to measure —
#: `run_matrix` never applies it unless the caller passes it.
STRUCTURAL_TOLERANCE = None


@dataclass
class MatrixRow:
    date: str
    universe: str
    advances: Optional[float]
    declines: Optional[float]
    normalised: Optional[float]
    ema19: Optional[float]
    ema39: Optional[float]
    oscillator: Optional[float]
    summation: Optional[float]
    ref_oscillator: Optional[float] = None
    ref_summation: Optional[float] = None
    osc_abs_diff: Optional[float] = None
    summ_abs_diff: Optional[float] = None
    passed: Optional[bool] = None

    def as_dict(self) -> dict:
        return {
            "date": self.date, "universe": self.universe,
            "advances": self.advances, "declines": self.declines,
            "normalised": self.normalised,
            "ema19": self.ema19, "ema39": self.ema39,
            "oscillator": self.oscillator, "summation": self.summation,
            "ref_oscillator": self.ref_oscillator, "ref_summation": self.ref_summation,
            "osc_abs_diff": self.osc_abs_diff, "summ_abs_diff": self.summ_abs_diff,
            "pass": self.passed,
        }


@dataclass
class MatrixReport:
    rows: list[MatrixRow] = field(default_factory=list)
    universe: str = ""
    methodology: str = ""
    tolerance: float = EXACT_TOLERANCE
    compared: int = 0
    failures: list[MatrixRow] = field(default_factory=list)
    max_osc_diff: float = 0.0
    max_summ_diff: float = 0.0

    @property
    def ok(self) -> bool:
        """⛔ A REPORT WITH NOTHING COMPARED IS NOT A PASS. A fixture that silently failed
        to load would otherwise read as green, which is the one failure mode a gate must
        never have."""
        return self.compared > 0 and not self.failures

    def summary(self) -> str:
        return (f"{self.universe} · {self.methodology} · compared={self.compared} "
                f"failures={len(self.failures)} "
                f"max|osc diff|={self.max_osc_diff:.10f} "
                f"max|summ diff|={self.max_summ_diff:.10f}")

    def to_csv(self, path: str) -> str:
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(MatrixRow("", "", None, None, None, None,
                                                            None, None, None).as_dict().keys()))
            w.writeheader()
            for r in self.rows:
                w.writerow(r.as_dict())
        return path


def _diff(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None:
        return None
    if not (math.isfinite(a) and math.isfinite(b)):
        return None
    return abs(float(a) - float(b))


def run_matrix(dates: Sequence[str],
               advances: Sequence[Optional[float]],
               declines: Sequence[Optional[float]],
               universe: str,
               method: mc.Methodology = mc.RATIO_ADJUSTED,
               anchor: Optional[mc.Anchor] = None,
               seed_state: Optional[mc.TrendState] = None,
               ref_oscillator: Optional[Sequence[Optional[float]]] = None,
               ref_summation: Optional[Sequence[Optional[float]]] = None,
               tolerance: float = EXACT_TOLERANCE,
               unchanged: Optional[Sequence[Optional[float]]] = None) -> MatrixReport:
    """Compute the family over `dates` and, where a reference is supplied, grade it.

    `seed_state` is how the FORMULA-FIDELITY claim is made honestly: the reference series
    is a rolling window whose EMAs carry in from before it starts, so replaying it from a
    cold seed would compare our warm-up against their steady state and report a defect
    that is really a difference of starting conditions. Seeding from the reference's own
    published trends removes that variable and leaves only the arithmetic under test.
    """
    res = mc.compute(dates, advances, declines, unchanged=unchanged,
                     method=method, anchor=anchor, state=seed_state)
    rep = MatrixReport(universe=universe,
                       methodology=f"{method.variant}/{method.version}",
                       tolerance=tolerance)
    for i, d in enumerate(dates):
        row = MatrixRow(
            date=d, universe=universe,
            advances=advances[i], declines=declines[i],
            normalised=res.normalised[i],
            ema19=res.ema19[i], ema39=res.ema39[i],
            oscillator=res.oscillator[i], summation=res.summation[i],
            ref_oscillator=(ref_oscillator[i] if ref_oscillator is not None else None),
            ref_summation=(ref_summation[i] if ref_summation is not None else None),
        )
        row.osc_abs_diff = _diff(row.oscillator, row.ref_oscillator)
        row.summ_abs_diff = _diff(row.summation, row.ref_summation)
        graded = [x for x in (row.osc_abs_diff, row.summ_abs_diff) if x is not None]
        if graded:
            rep.compared += 1
            row.passed = all(x <= tolerance for x in graded)
            if not row.passed:
                rep.failures.append(row)
            rep.max_osc_diff = max(rep.max_osc_diff, row.osc_abs_diff or 0.0)
            rep.max_summ_diff = max(rep.max_summ_diff, row.summ_abs_diff or 0.0)
        rep.rows.append(row)
    return rep


def compare_inputs(dates: Sequence[str],
                   ours_adv: Sequence[Optional[float]], ours_dec: Sequence[Optional[float]],
                   ref_adv: Sequence[Optional[float]], ref_dec: Sequence[Optional[float]]) -> dict:
    """INPUT fidelity — how far OUR census of a market is from the reference's.

    ⚠️ REPORTS A DISTRIBUTION, NEVER A PASS/FAIL. There is no threshold at which "our
    common-stock-only NYSE" becomes "the NYSE composite"; the useful output is a number a
    member can be told, not a boolean nobody can act on.
    """
    diffs_a, diffs_d, diffs_net = [], [], []
    for i in range(len(dates)):
        a, d, ra, rd = ours_adv[i], ours_dec[i], ref_adv[i], ref_dec[i]
        if None in (a, d, ra, rd):
            continue
        diffs_a.append(float(a) - float(ra))
        diffs_d.append(float(d) - float(rd))
        diffs_net.append((float(a) - float(d)) - (float(ra) - float(rd)))
    if not diffs_a:
        return {"compared": 0}

    def _stats(xs):
        xs = sorted(xs)
        n = len(xs)
        return {"mean": sum(xs) / n, "min": xs[0], "max": xs[-1],
                "median": xs[n // 2], "mean_abs": sum(abs(x) for x in xs) / n}
    return {"compared": len(diffs_a), "advances": _stats(diffs_a),
            "declines": _stats(diffs_d), "net_advances": _stats(diffs_net)}


# ── The bundled reference fixture ────────────────────────────────────────────

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..",
                            "tests", "fixtures", "mcclellan_nyse_reference.csv")


def load_reference_fixture(path: Optional[str] = None) -> list[dict]:
    """The published McClellan NYSE series, as rows.

    ⛔ SKIPS `#` COMMENT LINES RATHER THAN ASSUMING A HEADER POSITION. The provenance
    block at the top of that file is the reason it is safe to keep, so a loader that
    breaks when somebody extends it is a loader that invites its deletion.
    """
    p = os.path.abspath(path or FIXTURE_PATH)
    rows = []
    with open(p, newline="", encoding="utf-8") as f:
        lines = [ln for ln in f if not ln.lstrip().startswith("#")]
    for r in csv.DictReader(lines):
        rows.append({
            "date": r["date"],
            "advances": float(r["advances"]),
            "declines": float(r["declines"]),
            "ref_trend_10pct": float(r["ref_trend_10pct"]),
            "ref_trend_5pct": float(r["ref_trend_5pct"]),
            "ref_oscillator": float(r["ref_oscillator"]),
            "ref_summation": float(r["ref_summation"]),
        })
    return rows
