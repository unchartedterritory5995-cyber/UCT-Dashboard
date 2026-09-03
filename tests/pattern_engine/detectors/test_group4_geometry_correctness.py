"""Phase 6, Group 4 — geometry correctness (2026-09-03).

⛔⛔ THE CONFIRMED DEFECT (high_tight_flag.py). `_build_detection` stamped
BOTH the flag_low anchor (`anchors[2]`) and the flag_high anchor
(`anchors[3]`) with `last_bar["t"]` -- the same timestamp for two anchors
that are supposed to mark two different price extremes. `flag_low_idx` (the
absolute bar index of the flag's low) was already computed and used
elsewhere in the file, but the symmetric `flag_high_idx` was never computed
at all, so there was nothing correct to fall back on for the flag_high
anchor either -- both anchors silently defaulted to the last bar instead.

This reaches the chart. `geometry.shape == "trendline_pair"` and the live
consumer, `app/src/components/chart/patternShapes/TrendlinePair.jsx`,
renders `anchors[2]` -> `anchors[3]` as one straight line (its "lower
line"). With both points sharing one timestamp, that line collapses to a
zero-width vertical segment pinned to the chart's rightmost bar -- not a
line spanning the flag's actual low-to-high structure. `pivot_ts` had the
same shape problem one level up: its third entry was `last_bar["t"]`
standing in for BOTH flag extremes, discarding the flag_high timestamp
entirely.

The fix: `flag_high_idx` is now computed (mirroring the existing
`flag_low_idx` loop) and both `anchors[2]`/`anchors[3]` and `pivot_ts` are
stamped from the bars where those price extremes actually occurred.

Classification invariance: this correction touches only geometry
construction in `_build_detection` (the anchors/pivot_ts lists) -- no gate,
threshold, or scoring formula changed. Proven by the full 16-fixture
high_tight_flag battery (tests/pattern_engine/detectors/test_high_tight_flag.py)
staying green (fire/no-fire + confidence bands unchanged).
"""
import json
import pathlib

from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag

FIXTURES_DIR = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "high_tight_flag"


def _load(name):
    with open(FIXTURES_DIR / f"{name}.json", encoding="utf-8") as f:
        fx = json.load(f)
    return fx["bars"], fx["context"]


def _fire(name):
    bars, ctx = _load(name)
    dets = detect_high_tight_flag(bars, ctx)
    assert dets, f"{name}: fixture must fire for this test to mean anything"
    return max(dets, key=lambda x: x["confidence"]), bars


# ─── the defect, reproduced and fixed ────────────────────────────────────

def test_flag_low_and_flag_high_anchors_are_not_collapsed_onto_the_same_bar():
    """⭐⭐ THE FIX. anchors[2] (flag_low) and anchors[3] (flag_high) must
    reference different bars whenever the flag's low and high genuinely
    occur on different bars -- clean_textbook's synthetic flag does."""
    d, bars = _fire("clean_textbook")
    anchors = d["geometry"]["anchors"]
    assert len(anchors) == 4
    flag_low_anchor, flag_high_anchor = anchors[2], anchors[3]
    assert flag_low_anchor["t"] != flag_high_anchor["t"], (
        "flag_low and flag_high anchors are still stamped with the same "
        "timestamp -- TrendlinePair.jsx would render a degenerate "
        "zero-width line"
    )


def test_flag_low_anchor_matches_the_bar_where_the_flag_low_actually_occurred():
    d, bars = _fire("clean_textbook")
    anchors = d["geometry"]["anchors"]
    flag_low_price = d["geometry"]["extras"]["flag_low"]
    flag_low_anchor = anchors[2]
    matching_bars = [b for b in bars if round(b["l"], 2) == round(flag_low_price, 2)]
    assert matching_bars, "reproduction assumption broken: no bar has the flag_low price"
    assert flag_low_anchor["t"] in {b["t"] for b in matching_bars}, (
        f"flag_low anchor t={flag_low_anchor['t']} does not match any bar "
        f"whose low is the detected flag_low price {flag_low_price}"
    )
    assert flag_low_anchor["t"] != bars[-1]["t"] or bars[-1]["t"] in {b["t"] for b in matching_bars}, (
        "flag_low anchor still silently defaults to the last bar"
    )


def test_flag_high_anchor_matches_the_bar_where_the_flag_high_actually_occurred():
    d, bars = _fire("clean_textbook")
    anchors = d["geometry"]["anchors"]
    flag_high_price = d["geometry"]["extras"]["flag_high"]
    flag_high_anchor = anchors[3]
    matching_bars = [b for b in bars if round(b["h"], 2) == round(flag_high_price, 2)]
    assert matching_bars, "reproduction assumption broken: no bar has the flag_high price"
    assert flag_high_anchor["t"] in {b["t"] for b in matching_bars}, (
        f"flag_high anchor t={flag_high_anchor['t']} does not match any bar "
        f"whose high is the detected flag_high price {flag_high_price}"
    )


def test_pivot_ts_carries_all_four_distinct_geometric_timestamps():
    """pivot_ts previously discarded the flag_high timestamp entirely
    (3 entries, the 3rd doing double duty for both flag extremes via
    last_bar["t"]). It must now carry all 4 distinct anchor timestamps."""
    d, _ = _fire("clean_textbook")
    pivot_ts = d["pivot_ts"]
    anchors = d["geometry"]["anchors"]
    assert len(pivot_ts) == 4
    assert pivot_ts == [a["t"] for a in anchors]
    assert len(set(pivot_ts)) == len(pivot_ts), (
        f"pivot_ts has duplicate timestamps: {pivot_ts}"
    )


def test_pole_anchors_unaffected_by_the_flag_anchor_fix():
    """The pole_base/pole_top anchors (anchors[0]/anchors[1]) were never
    part of this defect -- confirm the fix didn't touch them."""
    d, bars = _fire("clean_textbook")
    anchors = d["geometry"]["anchors"]
    extras = d["geometry"]["extras"]
    assert anchors[0]["price"] == extras["pole_base_price"]
    assert anchors[1]["price"] == extras["pole_top_price"]


# ─── classification unchanged across the full fixture battery ───────────

def test_classification_unchanged_across_full_fixture_battery():
    from api.services.pattern_engine.primitives.context import build_context
    from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

    fixtures = load_all_fixtures("high_tight_flag", include_internal=False)
    assert len(fixtures) >= 15
    for fixture in fixtures:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_high_tight_flag(fixture.bars, ctx)
        if fixture.expected_fires:
            assert len(detections) >= 1, f"{fixture.name} stopped firing"
            d = max(detections, key=lambda x: x["confidence"])
            assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
                f"{fixture.name}: confidence {d['confidence']:.1f} moved "
                f"outside its previously-passing band"
            )
        else:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"{fixture.name}: a previously-non-firing case now "
                    f"clears the confidence floor"
                )
