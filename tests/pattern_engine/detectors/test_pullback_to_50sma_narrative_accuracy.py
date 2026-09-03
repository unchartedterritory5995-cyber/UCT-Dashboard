"""pullback_to_50sma narrative correctness (Phase 4A, 2026-09-03).

⛔⛔ THE CONFIRMED DEFECT. The detector's own computed facts (sma50, slope,
prior-advance %, volume ratios, entry/stop/target) were accurate; the PROSE
built from them claimed more than those facts support:

  1. "expanding-volume reclaim" language was UNCONDITIONAL, even though the
     gate's own floor is 0.9x -- BELOW average. At the floor, the narrative
     read "The expanding-volume reclaim at 94% of average..." -- a literal
     contradiction inside one sentence. Flagged (not fixed) in Phase 3A's
     decision-log as an "adjacent finding... recommend a follow-up narrative-
     wording pass."
  2. `why_it_matters` asserted "O'Neil's published data from IBD shows
     50-SMA tests ... deliver positive expectancy at hit rates in the 65-72%
     range" -- a specific statistic with NO citation anywhere in the research
     corpus, not computed by this detector, and a direct violation of this
     program's own base-rate discipline (docs/superpowers/research/bases/
     15-failure-modes-and-base-rates.md: "Never publish a hit rate without
     the unconditional base rate. This is the one non-negotiable.").
  3. `what_it_is` claimed "CAN SLIM's full pillar framework ... provides the
     broader fundamental context" as though all seven CAN SLIM pillars were
     verified -- this detector checks trend stage, MA stack, RS direction and
     the prior-advance/volume geometry only; `can_slim_grade`/`can_slim_score`
     are opaque external context, read only as a soft scoring bonus.
  4. `what_to_watch_for`/`failure_signal` asserted specific unpublished
     numbers ("IBD distribution day count >=5 in 25 sessions", "RS rating
     drops below 80", "quarterly EPS growth slows below 20%", "typically
     resolve within 10-30 bars", "typically run 40-60% of the first-base
     move") -- none computed by this detector, and the distribution-day count
     specifically is documented in this program's own research
     (docs/superpowers/research/bases/02-oneil-ibd-base-taxonomy.md:326) as
     a number O'Neil's own material never publishes.

Classification: A -- narrative-only overstatement. The detector's gates,
thresholds, and confidence scoring are BYTE-IDENTICAL before/after this fix
(see test_classification_unchanged_across_full_fixture_battery below) --
only `_compose_narrative`'s prose changed.
"""
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "pullback_to_50sma"))

import json
import pytest

from api.services.pattern_engine.detectors.uct.pullback_to_50sma import detect_pullback_to_50sma
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

FIXTURES_DIR = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "pullback_to_50sma"

#: Fabricated/unsourced strings that must never appear in the narrative,
#: regardless of fixture. Matched case-sensitively on the exact fragments
#: that were actually in the code (verbatim, captured before the fix).
_FORBIDDEN_FRAGMENTS = (
    "65-72%",
    "hit rates in the",
    "full CAN SLIM context is met",
    "distribution day count >=5",
    "RS rating drops below 80",
    "quarterly EPS growth slows below 20%",
    "typically resolve within 10-30 bars",
    "typically run 40-60% of the first-base move",
)


def _build_reclaim_below_average_fixture():
    """The exact reproduction case: reclaim_volume_ratio lands in [0.90, 1.00)
    -- inside the gate (>=0.9 required) but genuinely BELOW the 20-bar
    average, so "expanding" would be a literal contradiction if asserted."""
    sys.path.insert(0, str(FIXTURES_DIR))
    from _generate import _build_pullback_50sma, GOOD  # noqa: E402
    bars = _build_pullback_50sma(seed=1, reclaim_vol_ratio=0.95)
    return bars, GOOD


def _build_reclaim_expansion_fixture():
    """A genuine reclaim_volume_ratio >= 1.0 -- "expanding" is true here."""
    with open(FIXTURES_DIR / "clean_textbook.json", encoding="utf-8") as f:
        fx = json.load(f)
    return fx["bars"], fx["context"]


# ─── the controls, first ─────────────────────────────────────────────────

def test_the_reclaim_below_average_fixture_actually_fires_and_reproduces_the_ratio():
    """⛔ NON-VACUITY, and pins the exact reproduction geometry."""
    bars, ctx = _build_reclaim_below_average_fixture()
    dets = detect_pullback_to_50sma(bars, ctx)
    assert dets, "reproduction fixture must fire for this test to mean anything"
    ratio = dets[0]["geometry"]["extras"]["reclaim_volume_ratio"]
    assert 0.90 <= ratio < 1.00, (
        f"fixture drifted: reclaim_volume_ratio={ratio} is no longer inside "
        f"the gate-but-below-average band this test needs to isolate the "
        f"defect")


def test_the_expansion_fixture_actually_fires_with_a_genuine_expansion_ratio():
    bars, ctx = _build_reclaim_expansion_fixture()
    dets = detect_pullback_to_50sma(bars, ctx)
    assert dets
    assert dets[0]["geometry"]["extras"]["reclaim_volume_ratio"] >= 1.0


# ─── the defect, reproduced and fixed ────────────────────────────────────

def test_a_below_average_reclaim_is_never_called_expanding():
    """⭐⭐ THE FIX. At the gate's floor, the narrative must not claim
    'expanding' volume for a ratio that is below the 20-bar average."""
    bars, ctx = _build_reclaim_below_average_fixture()
    d = detect_pullback_to_50sma(bars, ctx)[0]
    for field in ("why_it_matters", "what_it_is"):
        text = d["narrative"][field]
        assert "expanding-volume reclaim" not in text, (
            f"{field} still labels a below-average reclaim as 'expanding'")


def test_a_genuine_expansion_reclaim_still_reads_as_expanding():
    """The other direction: don't overcorrect into never saying 'expanding'
    when the ratio genuinely is at or above the 20-bar average."""
    bars, ctx = _build_reclaim_expansion_fixture()
    d = detect_pullback_to_50sma(bars, ctx)[0]
    assert "expanding-volume reclaim" in d["narrative"]["why_it_matters"]


@pytest.mark.parametrize("fixture_name", [
    "clean_textbook", "strong_advance", "low_test_vol",
    "expanding_reclaim", "with_can_slim_a",
])
def test_no_fabricated_claim_appears_in_any_positive_fixture(fixture_name):
    """The fabricated hit-rate/CAN-SLIM-completeness/distribution-day/
    resolution-window claims must be gone from EVERY positive fixture's
    narrative, not just the one reproduction case."""
    with open(FIXTURES_DIR / f"{fixture_name}.json", encoding="utf-8") as f:
        fx = json.load(f)
    d = detect_pullback_to_50sma(fx["bars"], fx["context"])[0]
    full_text = " ".join(d["narrative"].values())
    for frag in _FORBIDDEN_FRAGMENTS:
        assert frag not in full_text, (
            f"{fixture_name}: fabricated fragment {frag!r} still present")


def test_the_hit_rate_gap_is_stated_honestly_instead_of_filled_with_a_number():
    """Replacing a fabrication with silence is not enough on its own -- the
    narrative should say WHY no rate is given, matching this program's
    established base-rate discipline."""
    bars, ctx = _build_reclaim_below_average_fixture()
    d = detect_pullback_to_50sma(bars, ctx)[0]
    text = d["narrative"]["why_it_matters"]
    assert "no measured hit rate" in text


# ─── genuinely-computed facts must survive the correction ────────────────

def test_genuinely_computed_facts_remain_in_the_narrative():
    bars, ctx = _build_reclaim_expansion_fixture()
    d = detect_pullback_to_50sma(bars, ctx)[0]
    extras = d["geometry"]["extras"]
    full_text = " ".join(d["narrative"].values())
    assert f"{extras['sma_50_value']:.2f}" in full_text or \
           f"${extras['sma_50_value']:.2f}" in d["narrative"]["what_it_is"] or \
           str(round(extras["sma_50_value"], 2)) in full_text
    assert f"{extras['prior_advance_pct']:.0f}%" in full_text
    assert d["levels"]["entry"] is not None
    assert d["levels"]["stop"] is not None
    assert d["levels"]["target_primary"] is not None


def test_the_still_grounded_7_8_percent_stop_rule_is_preserved():
    """This one IS sourced (docs/superpowers/research/bases/
    15-failure-modes-and-base-rates.md:178 + 07-morales-kacher-pocket-pivot-
    bgu.md) -- confirm the correction didn't strip a real, cited rule while
    removing the fabricated ones."""
    bars, ctx = _build_reclaim_expansion_fixture()
    d = detect_pullback_to_50sma(bars, ctx)[0]
    assert "7-8%" in d["narrative"]["failure_signal"]


# ─── Step 8: detector semantics unchanged ────────────────────────────────

def test_classification_unchanged_across_full_fixture_battery():
    """Every fixture's fire/no-fire result and confidence score must be
    byte-identical to before this fix -- proving this was a narrative-only
    correction, not a detector behavior change."""
    fixtures = load_all_fixtures("pullback_to_50sma", include_internal=False)
    assert len(fixtures) >= 15
    for fixture in fixtures:
        ctx = fixture.context if fixture.context is not None else \
            build_context(fixture.bars, sym="TEST")
        detections = detect_pullback_to_50sma(fixture.bars, ctx)
        if fixture.expected_fires:
            assert len(detections) >= 1, f"{fixture.name} stopped firing"
            d = max(detections, key=lambda x: x["confidence"])
            assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
                f"{fixture.name}: confidence {d['confidence']:.1f} moved "
                f"outside its previously-passing band")
        else:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"{fixture.name}: a previously-non-firing case now "
                    f"clears the confidence floor")
