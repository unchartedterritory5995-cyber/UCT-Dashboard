"""Phase 6, Group 3 — high-touch semantic/event-definition corrections
(2026-09-03).

Two correctness defects, both confirmed by Phase 5's audit and by a
pre-registered full-universe scan against real market data
(docs/uct-scanner-intelligence/tier1_validation/data/
phase6_group3_prereg_full_2026-09-03.json, 3693 symbols, run BEFORE any
Group 3 code change):

  1. episodic_pivot.py extracted `ep_open` but never used it — the
     pattern's own namesake requires a GAP, and the code never computed
     one. Measured live: 23 of 26 currently-firing cases (88.5%) had
     gap_pct from -0.10% to +6.3%, all below any published EP gap
     threshold (Bonde 8%/4%, Kullamägi 10%+) — these were same-day
     range-expansion breakouts, not gap events, despite firing under the
     "Episodic Pivot" name. A real gap gate (>=8%, sourced from Bonde's
     own 2010 EP post) is now enforced.

  2. Neither power_earnings_gap.py nor episodic_pivot.py read the
     earnings-date context field the engine schema carries —
     `context.py::build_context` hardcoded `days_to_earnings: None`
     unconditionally. It is now real when a caller supplies
     `days_to_earnings_hint` (mirroring the existing `regime_hint`
     precedent) and honestly `None` otherwise — `build_context` stays a
     pure, synchronous function on purpose; see context.py's module
     docstring for why a direct DB/network lookup inside it would risk
     the exact "unbounded external call in a hot loop" outage class this
     codebase has already been burned by once. power_earnings_gap.py now
     states, per candidate, whether earnings linkage is VERIFIED,
     CONTRADICTED, or UNAVAILABLE — never silently implied.

Classification invariance for (2): threshold/gate logic is unchanged;
only narrative text and geometry.extras gained new fields. (1) is a real
gate addition and DOES change fire behavior by design — that is the
correction Group 3 authorizes.
"""
import json
import pathlib

import pytest

from api.services.pattern_engine.detectors.uct.episodic_pivot import (
    detect_episodic_pivot, _MIN_GAP_PCT as EP_MIN_GAP_PCT,
)
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

FIXTURES_DIR = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "episodic_pivot"


def _load(name):
    with open(FIXTURES_DIR / f"{name}.json", encoding="utf-8") as f:
        fx = json.load(f)
    return fx["bars"], fx.get("context")


# ─── episodic_pivot: the gap gate ─────────────────────────────────────────

def test_a_geometrically_perfect_ep_with_zero_gap_is_refused():
    """⭐⭐ THE FIX, reproduced directly: same range/volume/close-strength/
    breakout geometry that fired pre-fix, only missing the gap."""
    bars, ctx = _load("no_gap_range_expansion_only")
    detections = detect_episodic_pivot(bars, ctx or build_context(bars, sym="TEST"))
    assert detections == []


def test_a_genuine_gap_ep_still_fires():
    bars, ctx = _load("clean_textbook")
    detections = detect_episodic_pivot(bars, ctx or build_context(bars, sym="TEST"))
    assert detections
    assert detections[0]["geometry"]["extras"]["gap_pct"] >= EP_MIN_GAP_PCT * 100.0 - 0.01


def test_gap_pct_is_exposed_in_geometry_extras():
    bars, ctx = _load("clean_textbook")
    d = detect_episodic_pivot(bars, ctx or build_context(bars, sym="TEST"))[0]
    extras = d["geometry"]["extras"]
    assert "gap_pct" in extras
    assert "ep_open" in extras
    assert "prior_close" in extras
    computed = (extras["ep_open"] - extras["prior_close"]) / extras["prior_close"] * 100.0
    assert abs(computed - extras["gap_pct"]) < 0.5


def test_narrative_states_the_gap_not_just_the_range_expansion():
    bars, ctx = _load("clean_textbook")
    d = detect_episodic_pivot(bars, ctx or build_context(bars, sym="TEST"))[0]
    full_text = " ".join(d["narrative"].values())
    assert "gap" in full_text.lower()
    assert "%" in d["narrative"]["headline"]


def test_classification_unchanged_for_every_case_that_already_had_a_real_gap():
    """The gap gate must not disturb fixtures whose EP bar already gapped —
    only the newly-added no-gap negative fixture should change outcome."""
    fixtures = load_all_fixtures("episodic_pivot", include_internal=False)
    assert len(fixtures) >= 15
    for fixture in fixtures:
        if fixture.name == "no_gap_range_expansion_only":
            continue  # this one is EXPECTED to flip negative by design
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_episodic_pivot(fixture.bars, ctx)
        if fixture.expected_fires:
            assert len(detections) >= 1, f"{fixture.name} stopped firing"
            d = max(detections, key=lambda x: x["confidence"])
            assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence
        else:
            for d in detections:
                assert d["confidence"] < 50.0


# ─── context.py: the earnings hint ────────────────────────────────────────

def test_days_to_earnings_defaults_to_none_without_a_hint():
    bars = [{"t": i, "o": 50.0, "h": 50.5, "l": 49.5, "c": 50.0, "v": 1000.0} for i in range(60)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["days_to_earnings"] is None


def test_days_to_earnings_is_real_when_a_caller_supplies_a_hint():
    bars = [{"t": i, "o": 50.0, "h": 50.5, "l": 49.5, "c": 50.0, "v": 1000.0} for i in range(60)]
    ctx = build_context(bars, sym="TEST", days_to_earnings_hint=-1)
    assert ctx["days_to_earnings"] == -1


# ─── power_earnings_gap: earnings-linkage disclosure ──────────────────────

def _peg_positive_fixture():
    root = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "power_earnings_gap"
    with open(root / "clean_textbook.json", encoding="utf-8") as f:
        fx = json.load(f)
    return fx["bars"], fx.get("context")


def test_peg_narrative_honestly_states_unverified_without_earnings_data():
    bars, ctx = _peg_positive_fixture()
    ctx = ctx or build_context(bars, sym="TEST")
    d = detect_power_earnings_gap(bars, ctx)[0]
    assert "UNVERIFIED" in d["narrative"]["what_it_is"]
    assert d["geometry"]["extras"]["earnings_linkage_verified"] is False
    assert d["geometry"]["extras"]["days_to_earnings"] is None


def test_peg_narrative_states_verified_when_a_recent_report_is_supplied():
    bars, ctx = _peg_positive_fixture()
    bars_ctx = build_context(bars, sym="TEST", days_to_earnings_hint=-1)
    d = detect_power_earnings_gap(bars, bars_ctx)[0]
    assert "actually earns this" in d["narrative"]["what_it_is"] or "UNVERIFIED" not in d["narrative"]["what_it_is"]
    assert d["geometry"]["extras"]["earnings_linkage_verified"] is True
    assert d["geometry"]["extras"]["days_to_earnings"] == -1


def test_peg_narrative_states_contradicted_when_the_known_report_is_far_away():
    bars, ctx = _peg_positive_fixture()
    bars_ctx = build_context(bars, sym="TEST", days_to_earnings_hint=45)
    d = detect_power_earnings_gap(bars, bars_ctx)[0]
    assert "does NOT verify" in d["narrative"]["what_it_is"]
    assert d["geometry"]["extras"]["earnings_linkage_verified"] is False
    assert d["geometry"]["extras"]["days_to_earnings"] == 45


def test_peg_classification_unchanged_by_earnings_disclosure():
    """Adding the honest disclosure must not change fire/no-fire or
    confidence — it's a narrative/extras-only addition."""
    fixtures = load_all_fixtures("power_earnings_gap", include_internal=False)
    assert len(fixtures) >= 15
    for fixture in fixtures:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_power_earnings_gap(fixture.bars, ctx)
        if fixture.expected_fires:
            assert len(detections) >= 1, f"{fixture.name} stopped firing"
            d = max(detections, key=lambda x: x["confidence"])
            assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence
        else:
            for d in detections:
                assert d["confidence"] < 50.0
