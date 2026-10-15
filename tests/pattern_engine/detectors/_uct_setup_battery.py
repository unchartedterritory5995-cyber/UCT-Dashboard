"""Shared battery for the four INTERNAL UCT trader-setup detectors.

Each family's test module calls `make_tests(...)` so the four batteries are
one implementation, not four copies that can drift.
"""
import glob
import os

import pytest

from api.services.pattern_engine.detectors.registry import INTERNAL_PATTERN_IDS, is_internal
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

_FIX_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "fixtures")


def _ctx(f):
    return f.context if f.context is not None else build_context(f.bars, sym="TEST")


def make_tests(pattern_id, detect, required_extras, rule_fixtures, directions=("bullish",)):
    fixtures = load_all_fixtures(pattern_id, include_internal=False)

    @pytest.mark.parametrize("fixture", fixtures, ids=lambda f: f.source_filename)
    def test_fixture(fixture):
        out = detect(fixture.bars, _ctx(fixture))
        if fixture.expected_fires:
            assert out, f"{fixture.name!r} expected to fire, produced nothing"
            d = max(out, key=lambda x: x["confidence"])
            assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence
            if fixture.expected_geometry_shape:
                assert d["geometry"]["shape"] == fixture.expected_geometry_shape
            assert d["pattern_id"] == pattern_id
        else:
            assert not out, f"{fixture.name!r} expected NOT to fire, got {out[0]['confidence']}"

    def test_minimum_coverage():
        pos = [f for f in fixtures if f.category == "positive"]
        neg = [f for f in fixtures if f.category == "negative"]
        edge = [f for f in fixtures if f.category == "edge"]
        assert len(pos) >= 5 and len(neg) >= 8 and len(edge) >= 2, (len(pos), len(neg), len(edge))
        # non-vacuity: positives fire and negatives are judged by the same detector
        assert all(f.expected_fires for f in pos) and not any(f.expected_fires for f in neg)

    def test_named_rule_fixtures_exist():
        """The adjudicated rules each have a real near-miss pinned by name, so a
        regeneration that loses one cannot pass silently."""
        d = os.path.join(_FIX_ROOT, pattern_id)
        for stem in rule_fixtures:
            assert glob.glob(os.path.join(d, stem + "*.json")), f"missing fixture {stem}* for {pattern_id}"

    def _first_detection():
        for f in fixtures:
            if f.category == "positive":
                out = detect(f.bars, _ctx(f))
                assert out
                return f, out[0]
        raise AssertionError("no positive fixture")

    def test_detection_shape_and_narrative():
        f, d = _first_detection()
        assert d["category"] == "uct" and d["direction"] in directions
        assert d["status"] == "triggered"
        n = d["narrative"]
        assert len(n["headline"]) >= 90, n["headline"]
        for k in ("what_it_is", "why_it_matters", "what_to_watch_for", "failure_signal"):
            assert len(n[k]) >= 700, (k, len(n[k]))
        g = d["geometry"]
        assert g["shape"] == "candle_mark"
        assert len(g["anchors"]) == len(g["anchor_roles"]) >= 1
        for key in required_extras + ("variant", "label_variants", "trigger_bars_ago", "internal"):
            assert key in g["extras"], f"missing geometry.extras.{key}"
        assert g["extras"]["internal"] is True

    def test_confidence_is_canonical():
        _, d = _first_detection()
        q = d["quality_components"]
        assert q["historical_score"] == 50.0
        assert d["confidence"] == round(0.40 * q["geometry_score"] + 0.25 * q["volume_score"]
                                        + 0.20 * q["context_score"] + 0.15 * q["historical_score"], 2)
        assert d["confidence"] >= 50.0

    def test_levels_are_consistent():
        for f in fixtures:
            if not f.expected_fires:
                continue
            d = detect(f.bars, _ctx(f))[0]
            lv = d["levels"]
            if d["direction"] == "bullish":
                assert lv["stop"] < lv["entry"] < lv["target_primary"] < lv["target_secondary"]
            else:
                assert lv["stop"] > lv["entry"] > lv["target_primary"] > lv["target_secondary"]

    def test_is_internal_and_not_in_member_catalog():
        from api.routers.patterns import _PATTERN_METADATA
        assert is_internal(pattern_id) and pattern_id in INTERNAL_PATTERN_IDS
        assert pattern_id not in _PATTERN_METADATA

    def test_never_raises_on_short_or_degenerate_input():
        assert detect([], {}) == []
        f = fixtures[0]
        assert detect(f.bars[:5], _ctx(f)) == []
        flat = [{**b, "o": 10.0, "h": 10.0, "l": 10.0, "c": 10.0, "v": 0.0} for b in f.bars]
        detect(flat, _ctx(f))

    return {name: fn for name, fn in locals().items() if name.startswith("test_")}
