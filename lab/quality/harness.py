"""Reusable recognition-evaluation harness for pattern_engine detectors.

Point this at any (pattern_id -> detector function) pair that already has a
fixture directory under tests/fixtures/<pattern_id>/ (the existing
tests/pattern_engine/detectors/fixture_loader.py fixture format) and it will:

  1. Run every fixture through the REAL detector function (no synthetic data,
     no mocking).
  2. Compute a recall proxy (fraction of "positive" fixtures that fire) and a
     false-positive proxy (fraction of "negative" fixtures that incorrectly
     fire above the confidence floor), against the EXISTING fixture corpus.
  3. Run a lightweight geometry sanity check on every detection that fires:
     do the anchors/pivots/start_t/end_t reference real timestamps and prices
     that actually occur in the fixture's own bars?

This is deliberately NOT a replacement for the existing fixture-battery unit
tests (tests/pattern_engine/detectors/test_*.py) -- those already assert
fires/confidence-band/geometry-shape per fixture and are the correctness
gate. This harness answers a different question: "of the fixtures that
already exist, what does the aggregate recall/false-positive picture look
like, and is there any real negative-fixture coverage at all?" -- which no
existing test aggregates or reports.

Usage (see run_evaluation.py for the concrete cohort):

    from lab.quality.harness import run_family, DETECTOR_REGISTRY

    report = run_family("hammer")
    print(report.summary_line())
"""
from __future__ import annotations

import importlib
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

# Make the repo root importable regardless of CWD (this file lives at
# <repo_root>/lab/quality/harness.py).
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from api.services.pattern_engine.primitives.context import build_context  # noqa: E402
from tests.pattern_engine.detectors.fixture_loader import Fixture, load_all_fixtures  # noqa: E402


# ---------------------------------------------------------------------------
# Registry: pattern_id -> (module path, function name)
#
# Deliberately explicit rather than convention-guessed from the subpackage
# name -- a wrong guess here would silently evaluate the wrong detector.
# Extend this dict to point the harness at more families later; nothing else
# in this file needs to change.
# ---------------------------------------------------------------------------
DETECTOR_REGISTRY: dict[str, tuple[str, str]] = {
    "hammer": ("api.services.pattern_engine.detectors.candlestick.hammer", "detect_hammer"),
    "bull_flag": ("api.services.pattern_engine.detectors.classical.bull_flag", "detect_bull_flag"),
    "ascending_triangle": (
        "api.services.pattern_engine.detectors.classical.ascending_triangle",
        "detect_ascending_triangle",
    ),
    "vcp": ("api.services.pattern_engine.detectors.uct.vcp", "detect_vcp"),
    "pullback_to_50sma": (
        "api.services.pattern_engine.detectors.uct.pullback_to_50sma",
        "detect_pullback_to_50sma",
    ),
    "power_earnings_gap": (
        "api.services.pattern_engine.detectors.uct.power_earnings_gap",
        "detect_power_earnings_gap",
    ),
}


def get_detector(pattern_id: str) -> Callable:
    """Import and return the detect_* function for a registered pattern_id."""
    if pattern_id not in DETECTOR_REGISTRY:
        raise KeyError(
            f"{pattern_id!r} is not in DETECTOR_REGISTRY. "
            f"Known: {sorted(DETECTOR_REGISTRY)}"
        )
    module_path, func_name = DETECTOR_REGISTRY[pattern_id]
    mod = importlib.import_module(module_path)
    return getattr(mod, func_name)


# ---------------------------------------------------------------------------
# Geometry sanity check
# ---------------------------------------------------------------------------
@dataclass
class GeometrySanity:
    ok: bool
    issues: list[str] = field(default_factory=list)


def check_geometry_sanity(detection: dict, bars: list[dict]) -> GeometrySanity:
    """Spot-check that a detection's anchors/pivots/timestamps are real
    positions inside the fixture's own bar series -- not exhaustive proof of
    correctness, just a guard against a detector emitting anchors that don't
    correspond to anything in the input.
    """
    issues: list[str] = []
    if not bars:
        return GeometrySanity(ok=False, issues=["fixture has no bars"])

    bar_ts = [b["t"] for b in bars]
    t_min, t_max = min(bar_ts), max(bar_ts)
    price_lo = min(b["l"] for b in bars)
    price_hi = max(b["h"] for b in bars)
    # Small tolerance for float/rounding noise in derived prices (e.g. entry
    # computed as high * 1.001 can legitimately sit a hair above price_hi).
    price_lo_tol = price_lo * 0.98
    price_hi_tol = price_hi * 1.05

    start_t = detection.get("start_t")
    end_t = detection.get("end_t")
    if start_t is None or end_t is None:
        issues.append("missing start_t/end_t")
    else:
        if not (t_min <= start_t <= t_max):
            issues.append(f"start_t={start_t} outside bar range [{t_min}, {t_max}]")
        if not (t_min <= end_t <= t_max):
            issues.append(f"end_t={end_t} outside bar range [{t_min}, {t_max}]")
        if start_t > end_t:
            issues.append(f"start_t={start_t} > end_t={end_t}")

    pivot_ts = detection.get("pivot_ts") or []
    for pt in pivot_ts:
        if not (t_min <= pt <= t_max):
            issues.append(f"pivot_ts entry {pt} outside bar range [{t_min}, {t_max}]")

    geometry = detection.get("geometry") or {}
    anchors = geometry.get("anchors") or []
    if not anchors:
        issues.append("geometry.anchors is empty")
    for a in anchors:
        at = a.get("t")
        ap = a.get("price")
        if at is None or ap is None:
            issues.append(f"anchor missing t/price: {a!r}")
            continue
        if not (t_min <= at <= t_max):
            issues.append(f"anchor t={at} outside bar range [{t_min}, {t_max}]")
        if not (price_lo_tol <= ap <= price_hi_tol):
            issues.append(
                f"anchor price={ap} outside sane bar price range "
                f"[{price_lo_tol:.2f}, {price_hi_tol:.2f}]"
            )

    return GeometrySanity(ok=(len(issues) == 0), issues=issues)


# ---------------------------------------------------------------------------
# Per-fixture / per-family results
# ---------------------------------------------------------------------------
@dataclass
class FixtureResult:
    name: str
    category: str
    expected_fires: bool
    fired: bool
    top_confidence: Optional[float]
    min_confidence: float
    max_confidence: float
    confidence_in_band: Optional[bool]
    correct: bool
    geometry_sane: Optional[bool]
    geometry_issues: list[str]
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "category": self.category,
            "expected_fires": self.expected_fires,
            "fired": self.fired,
            "top_confidence": self.top_confidence,
            "confidence_in_band": self.confidence_in_band,
            "correct": self.correct,
            "geometry_sane": self.geometry_sane,
            "geometry_issues": self.geometry_issues,
            "notes": self.notes,
        }


@dataclass
class FamilyReport:
    pattern_id: str
    results: list[FixtureResult]

    @property
    def positives(self) -> list[FixtureResult]:
        return [r for r in self.results if r.category == "positive"]

    @property
    def negatives(self) -> list[FixtureResult]:
        return [r for r in self.results if r.category == "negative"]

    @property
    def edges(self) -> list[FixtureResult]:
        return [r for r in self.results if r.category == "edge"]

    @property
    def recall_proxy(self) -> Optional[float]:
        pos = self.positives
        if not pos:
            return None
        return sum(1 for r in pos if r.fired) / len(pos)

    @property
    def false_positive_rate_proxy(self) -> Optional[float]:
        neg = self.negatives
        if not neg:
            return None
        # A "false positive" here = fired AND confidence >= 50 (the shared
        # confidence floor every one of these detectors enforces before
        # emitting a Detection at all -- see each module's _CONFIDENCE_FLOOR).
        return sum(1 for r in neg if r.fired) / len(neg)

    @property
    def has_negative_fixtures(self) -> bool:
        return len(self.negatives) > 0

    def geometry_sanity_summary(self) -> tuple[int, int]:
        """Returns (n_checked, n_sane) over fixtures that actually fired."""
        checked = [r for r in self.results if r.fired and r.geometry_sane is not None]
        sane = [r for r in checked if r.geometry_sane]
        return len(checked), len(sane)

    def summary_line(self) -> str:
        n_checked, n_sane = self.geometry_sanity_summary()
        rp = self.recall_proxy
        fp = self.false_positive_rate_proxy
        rp_s = f"{rp*100:.0f}%" if rp is not None else "n/a"
        fp_s = f"{fp*100:.0f}%" if fp is not None else "NO NEGATIVE FIXTURES"
        return (
            f"{self.pattern_id}: n={len(self.results)} "
            f"(pos={len(self.positives)}, neg={len(self.negatives)}, edge={len(self.edges)}) | "
            f"recall_proxy={rp_s} | false_positive_proxy={fp_s} | "
            f"geometry_sane={n_sane}/{n_checked}"
        )

    def to_dict(self) -> dict:
        return {
            "pattern_id": self.pattern_id,
            "n_total": len(self.results),
            "n_positive": len(self.positives),
            "n_negative": len(self.negatives),
            "n_edge": len(self.edges),
            "recall_proxy": self.recall_proxy,
            "false_positive_rate_proxy": self.false_positive_rate_proxy,
            "has_negative_fixtures": self.has_negative_fixtures,
            "geometry_sanity": {
                "checked": self.geometry_sanity_summary()[0],
                "sane": self.geometry_sanity_summary()[1],
            },
            "mismatches": [r.name for r in self.results if not r.correct],
            "fixtures": [r.to_dict() for r in self.results],
        }


def _evaluate_one(fixture: Fixture, detect_fn: Callable) -> FixtureResult:
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_fn(fixture.bars, ctx)
    fired = bool(detections)

    top_confidence: Optional[float] = None
    confidence_in_band: Optional[bool] = None
    geometry_sane: Optional[bool] = None
    geometry_issues: list[str] = []
    correct: bool
    notes = ""

    if fired:
        top = max(detections, key=lambda d: d["confidence"])
        top_confidence = top["confidence"]
        sanity = check_geometry_sanity(top, fixture.bars)
        geometry_sane = sanity.ok
        geometry_issues = sanity.issues

    if fixture.expected_fires:
        correct = fired
        if fired:
            confidence_in_band = fixture.min_confidence <= top_confidence <= fixture.max_confidence
            correct = correct and confidence_in_band
            if fixture.expected_geometry_shape:
                shape = detections[0]["geometry"]["shape"]
                if shape != fixture.expected_geometry_shape:
                    correct = False
                    notes = f"geometry.shape={shape!r} != expected {fixture.expected_geometry_shape!r}"
        else:
            notes = "expected to fire but produced 0 detections"
    else:
        # Expected NOT to fire. The fixture battery's own convention treats a
        # detection with confidence < 50 as an acceptable near-miss (matches
        # tests/pattern_engine/detectors/test_*.py); anything firing >= 50 is
        # a genuine false positive against this fixture's own label.
        if fired and top_confidence is not None and top_confidence >= 50.0:
            correct = False
            notes = f"expected NOT to fire, fired at confidence={top_confidence:.1f}"
        else:
            correct = True

    return FixtureResult(
        name=fixture.name,
        category=fixture.category,
        expected_fires=fixture.expected_fires,
        fired=fired,
        top_confidence=top_confidence,
        min_confidence=fixture.min_confidence,
        max_confidence=fixture.max_confidence,
        confidence_in_band=confidence_in_band,
        correct=correct,
        geometry_sane=geometry_sane,
        geometry_issues=geometry_issues,
        notes=notes,
    )


def run_family(pattern_id: str) -> FamilyReport:
    """Run every real fixture for pattern_id through its real detector."""
    detect_fn = get_detector(pattern_id)
    fixtures = load_all_fixtures(pattern_id, include_internal=False)
    results = [_evaluate_one(f, detect_fn) for f in fixtures]
    return FamilyReport(pattern_id=pattern_id, results=results)


def run_families(pattern_ids: list[str]) -> dict[str, FamilyReport]:
    return {pid: run_family(pid) for pid in pattern_ids}
