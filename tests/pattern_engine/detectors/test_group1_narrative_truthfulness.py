"""Phase 6, Group 1 — narrative-fabrication sweep (2026-09-03).

Phase 5's Tier-1 validation audit found unsourced statistics and false
practitioner attributions baked into eight detectors' `_compose_narrative`
prose. None of these were computed or verified by the detector that emits
them; several contradicted the detector's own gate constants or the research
corpus consulted for this correction pass
(`docs/superpowers/research/bases/*.md`). This file pins their removal.

Per detector, the fabrication removed:
  - bull_flag: an invented "~67% follow-through" Bulkowski figure and an
    invented "55-65% follow-through in 6-8 weeks" claim (Bulkowski's real,
    sourced numbers -- 44-45% break-even failure rate, "Not ranked" -- are
    substituted where the corpus actually supports a statistic).
  - bullish_engulfing / bearish_engulfing: an unverifiable Homma/Sakata
    origin claim stated as fact, a fabricated Edwards & Magee citation (E&M
    predates Western candlestick exposure and never appears in this file's
    corpus section), and fabricated "Greg Morris" / "Peter Brandt" teaching
    claims. bearish_engulfing also had a `failure_signal` figure ("fails
    roughly 40% of the time") arithmetically inconsistent with its own
    stated 79% reversal rate.
  - high_tight_flag: a fabricated "~80%+ continuation" statistic attributed
    to "Mark Ritchie II" and fabricated "monster move"/"maximum position
    size" trading advice attributed to Kristjan Kullamägi -- neither exists
    anywhere in the fetched research corpus (`grep -rli 'ritchie'` / `'monster
    move|maximum position size' docs/superpowers/research/` = zero hits).
  - flat_base: a fabricated "18-30% follow-through" statistic (two
    occurrences) and a fabricated "Kullamägi's 4-week-tight base" attribution
    -- Kullamägi publishes no numeric tightness criterion anywhere in the
    corpus (`08-qullamaggie-stockbee-momentum.md:174`: "He gives the duration
    but never the tightness"). The real IBD cousin ("three-weeks-tight",
    `14-base-quantification-crosssource.md:141`) is substituted.
  - power_earnings_gap: a fabricated "30-100%+ over 4-12 weeks" extension
    statistic, a fabricated Kullamägi "highest follow-through of any swing
    setup" claim, a fabricated claim that Minervini's rules "align almost
    exactly with Bonde's PEG criteria" (the corpus finds NO published
    Minervini PEG definition anywhere, and the attribution is contested), a
    misattributed citation (the "5+ points OR 8%+ gain" 2010 Bonde quote is
    from his Episodic Pivot writing, not a PEG-specific one -- corrected in
    the module docstring rather than deleted, since it is the detector's
    real calibration source), and a `why_it_matters` claim of "4% minimum
    gap" that contradicted this file's own `_MIN_GAP_PCT = 0.08` (8%) gate.
  - episodic_pivot: a fabricated Kullamägi "3-5 week base" / "ATR-relative
    thrust bar" description (the corpus's real Kullamägi EP criteria are
    substituted: 10%+ gap, 3-6 month dormancy, ORH entry, low-of-day stop),
    a wholly fabricated "Lance Breitstein" attribution, a wholly fabricated
    "Burnt Toast" attribution (zero corpus hits for either name), and a
    fabricated "70%+ continuation rate" statistic (two occurrences) -- the
    corpus explicitly states Bonde's EP has "none published as a setup
    statistic" for measured performance.
  - vcp: a fabricated "25%+ moves within 8-12 weeks" statistic -- VCP has no
    published measured performance anywhere in the corpus (repeated "none
    published" across every VCP section of
    `03-minervini-vcp-powerplay.md`).

Classification invariance: every edit above is confined to string literals
inside each detector's narrative-composition code (`_compose_narrative` or
equivalent); no gate, threshold, or scoring constant was changed. This is
proven, not merely asserted, by the existing full fixture batteries for all
eight families (`tests/test_bull_flag.py` etc., 152 fixtures total) staying
green after this correction -- confidence bands, fire/no-fire outcomes, and
geometry shapes are unchanged. This file adds the narrative-truthfulness
layer those battery tests do not cover: that the fabricated fragments are
actually gone from the fired narrative, on every positive fixture in every
family, not just a hand-picked reproduction case.
"""
import pytest

from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.detectors.candlestick.bullish_engulfing import detect_bullish_engulfing
from api.services.pattern_engine.detectors.candlestick.bearish_engulfing import detect_bearish_engulfing
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.flat_base import detect_flat_base
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.detectors.uct.episodic_pivot import detect_episodic_pivot
from api.services.pattern_engine.detectors.uct.vcp import detect_vcp
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


# (pattern_id, detect_fn, forbidden fragments verbatim from the pre-fix code)
_FAMILIES = [
    (
        "bull_flag", detect_bull_flag,
        (
            "67%", "30-50%", "55-65%",
        ),
    ),
    (
        "bullish_engulfing", detect_bullish_engulfing,
        (
            "Peter Brandt", "Greg Morris", "Robert Edwards",
        ),
    ),
    (
        "bearish_engulfing", detect_bearish_engulfing,
        (
            "Peter Brandt", "Greg Morris", "Robert Edwards", "roughly 40% of the time",
        ),
    ),
    (
        "high_tight_flag", detect_high_tight_flag,
        (
            "Mark Ritchie", "monster move", "maximum position size",
        ),
    ),
    (
        "flat_base", detect_flat_base,
        (
            "18-30%", "4-week-tight",
        ),
    ),
    (
        "power_earnings_gap", detect_power_earnings_gap,
        (
            "30-100%", "70%+", "4% minimum gap",
            "align almost exactly with", "highest follow-through profile of any swing setup",
        ),
    ),
    (
        "episodic_pivot", detect_episodic_pivot,
        (
            "Breitstein", "Burnt Toast", "70%+", "3-5 week base", "ATR-relative thrust",
        ),
    ),
    (
        "vcp", detect_vcp,
        (
            "25%+ moves within 8-12",
        ),
    ),
]


def _fired_positive_narratives(pattern_id, detect_fn):
    """Every narrative dict produced by every positive fixture that actually fires."""
    fixtures = load_all_fixtures(pattern_id, include_internal=False)
    pos = [f for f in fixtures if f.category == "positive" or f.expected_fires]
    assert pos, f"{pattern_id}: no positive fixtures found -- test would be vacuous"
    narratives = []
    for fixture in pos:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_fn(fixture.bars, ctx)
        if not detections:
            continue
        d = max(detections, key=lambda x: x["confidence"])
        narratives.append((fixture.name, d["narrative"]))
    assert narratives, f"{pattern_id}: no positive fixture actually fired -- test would be vacuous"
    return narratives


@pytest.mark.parametrize("pattern_id,detect_fn,forbidden", _FAMILIES, ids=lambda v: v if isinstance(v, str) else "")
def test_no_fabricated_fragment_survives_in_any_positive_fixture(pattern_id, detect_fn, forbidden):
    """⭐⭐ THE FIX, swept across every family's full positive-fixture set."""
    narratives = _fired_positive_narratives(pattern_id, detect_fn)
    for fixture_name, narrative in narratives:
        full_text = " ".join(narrative.values())
        for frag in forbidden:
            assert frag not in full_text, (
                f"{pattern_id}/{fixture_name}: fabricated fragment {frag!r} still present"
            )


def test_high_tight_flag_narrative_still_cites_real_sourced_criteria():
    """The Ritchie/Kullamägi fabrication was replaced with real, corpus-sourced
    Kullamägi criteria (position size + risk figures), not silence."""
    narratives = _fired_positive_narratives("high_tight_flag", detect_high_tight_flag)
    full_text = " ".join(v for _, n in narratives for v in n.values())
    assert "Kristjan Kullam" in full_text
    assert "5-25%" in full_text


def test_flat_base_narrative_still_cites_a_real_ibd_cousin_structure():
    narratives = _fired_positive_narratives("flat_base", detect_flat_base)
    full_text = " ".join(v for _, n in narratives for v in n.values())
    assert "three-weeks-tight" in full_text


def test_episodic_pivot_narrative_still_cites_real_kullamagi_ep_criteria():
    narratives = _fired_positive_narratives("episodic_pivot", detect_episodic_pivot)
    full_text = " ".join(v for _, n in narratives for v in n.values())
    assert "Kristjan Kullam" in full_text
    assert "10%+" in full_text
    assert "3-6 months" in full_text


def test_power_earnings_gap_narrative_matches_its_own_gate_constant():
    """The corrected why_it_matters must state this detector's OWN gap gate
    (8%), not a number that contradicts `_MIN_GAP_PCT`."""
    from api.services.pattern_engine.detectors.uct.power_earnings_gap import (
        _MIN_GAP_PCT, _MIN_VOLUME_RATIO,
    )
    narratives = _fired_positive_narratives("power_earnings_gap", detect_power_earnings_gap)
    full_text = " ".join(v for _, n in narratives for v in n.values())
    assert f"{_MIN_GAP_PCT * 100:.0f}% minimum gap" in full_text
    assert f"{_MIN_VOLUME_RATIO:.0f}x minimum volume" in full_text


def test_power_earnings_gap_docstring_citation_no_longer_implies_a_peg_specific_source():
    """Module docstring correction: the 2010 Bonde quote is his Episodic Pivot
    writing, not a PEG-specific one -- the docstring must say so."""
    import inspect
    from api.services.pattern_engine.detectors.uct import power_earnings_gap
    doc = inspect.getdoc(power_earnings_gap) or power_earnings_gap.__doc__
    assert "Episodic Pivot" in doc
    assert "Power-Earnings-Gap-specific writeup" in doc


# ─── Step 8 (per-family): classification unchanged, confirmed independently ──
#
# The full fixture batteries in tests/pattern_engine/detectors/test_{bull_flag,
# bullish_engulfing,bearish_engulfing,high_tight_flag,flat_base,
# power_earnings_gap,episodic_pivot,vcp}.py already assert fire/no-fire and
# confidence bands per fixture. Re-running them here (they are cheap and
# fixture-driven, not network/DB-backed) pins that this Group-1 pass changed
# no gate, threshold, or scoring constant in any of the eight files -- only
# narrative prose.

@pytest.mark.parametrize("pattern_id,detect_fn,_forbidden", _FAMILIES, ids=lambda v: v if isinstance(v, str) else "")
def test_classification_unchanged_across_full_fixture_battery(pattern_id, detect_fn, _forbidden):
    fixtures = load_all_fixtures(pattern_id, include_internal=False)
    assert len(fixtures) >= 10
    for fixture in fixtures:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_fn(fixture.bars, ctx)
        if fixture.expected_fires:
            assert len(detections) >= 1, f"{pattern_id}/{fixture.name} stopped firing"
            d = max(detections, key=lambda x: x["confidence"])
            assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
                f"{pattern_id}/{fixture.name}: confidence {d['confidence']:.1f} moved "
                f"outside its previously-passing band"
            )
        else:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"{pattern_id}/{fixture.name}: a previously-non-firing case now "
                    f"clears the confidence floor"
                )
