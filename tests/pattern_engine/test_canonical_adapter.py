"""Phase 8, Packages 8A/8B — canonical adapter parity + shadow-population
tests.

Runs the REAL detectors against REAL fixtures, adapts the resulting
Detection objects, and proves two things per the authorization's own Gate-1
requirements:

  1. PARITY — every field that existed before adaptation is byte-identical
     after it. The adapter must never change classification, confidence,
     status, geometry, levels, narrative, or context.
  2. CORRECT SHADOW POPULATION — the new `eligibility`/`event`/`gate_trace`
     sections are populated (or correctly, deliberately absent) per family,
     and their values are independently recomputable from the detector's own
     public constants and the fixture's own bars/context — not just "some
     dict got attached."

Nothing here touches `memory.py`/`pattern_db.py`/`main.py` — the adapter is
exercised purely in-memory, matching its own "shadow mode only" scope.
"""
import time

import pytest

from api.services.pattern_engine import memory
from api.services.pattern_engine.canonical_adapter import (
    ADAPTER_VERSION,
    adapt_high_tight_flag,
    adapt_power_earnings_gap,
    compute_default_eligibility,
)
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.power_earnings_gap import (
    _GAP_FILL_THRESHOLD,
    _MAX_POST_GAP_TIGHTNESS,
    _MIN_GAP_PCT,
    _MIN_VOLUME_RATIO,
    detect_power_earnings_gap,
)
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _fired_detections(family, detect_fn):
    """Every positive fixture's best (highest-confidence) real Detection."""
    out = []
    for fx in load_all_fixtures(family, include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_fn(fx.bars, ctx)
        if detections:
            out.append((fx.name, max(detections, key=lambda d: d["confidence"])))
    return out


HTF_DETECTIONS = _fired_detections("high_tight_flag", detect_high_tight_flag)
PEG_DETECTIONS = _fired_detections("power_earnings_gap", detect_power_earnings_gap)


def _assert_parity(original: dict, adapted: dict, new_keys: set[str]):
    """Every pre-existing key must be unchanged; only `new_keys` may differ."""
    for key in original:
        assert key in adapted, f"adapter dropped existing key {key!r}"
        assert adapted[key] == original[key], (
            f"adapter changed existing key {key!r}: {original[key]!r} -> {adapted[key]!r}"
        )
    for key in new_keys:
        assert key not in original, f"fixture setup error: {key!r} already present"


# ─── High Tight Flag: eligibility-only, event/criteria/gate_trace absent ──

@pytest.mark.parametrize("name,detection", HTF_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_high_tight_flag(detection)
    _assert_parity(detection, adapted, {"eligibility"})


@pytest.mark.parametrize("name,detection", HTF_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_adapter_omits_event_and_criteria(name, detection):
    """HTF's own file defers criteria/provenance to base_catalog.py and has
    no event concept — these keys must be genuinely ABSENT, not null/empty."""
    adapted = adapt_high_tight_flag(detection)
    assert "event" not in adapted
    assert "criteria" not in adapted
    assert "gate_trace" not in adapted


@pytest.mark.parametrize("name,detection", HTF_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_adapter_eligibility_shape(name, detection):
    adapted = adapt_high_tight_flag(detection)
    elig = adapted["eligibility"]
    assert elig["eligibility_scope"] == "system_default"
    assert elig["eligibility_version"] == ADAPTER_VERSION
    assert elig["active_window_secs"] == memory.ACTIVE_WINDOW_SECS
    # HTF has no per-family freshness gate (Phase-7 recon) — both must be None,
    # not a fabricated number.
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    # A just-detected fixture (detected_at == build time) is within the window
    # and status is always "ready" for this detector -> eligible.
    assert elig["eligible"] is True
    assert any("within active window" in r for r in elig["eligibility_reasons"])


def test_htf_adapter_eligible_false_once_outside_active_window():
    assert HTF_DETECTIONS, "need at least one firing HTF fixture"
    _, detection = HTF_DETECTIONS[0]
    stale = dict(detection)
    stale["detected_at"] = int(time.time()) - memory.ACTIVE_WINDOW_SECS - 3600
    adapted = adapt_high_tight_flag(stale)
    assert adapted["eligibility"]["eligible"] is False
    assert any("outside active window" in r for r in adapted["eligibility"]["eligibility_reasons"])


def test_htf_adapter_does_not_mutate_its_input():
    assert HTF_DETECTIONS
    _, detection = HTF_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_high_tight_flag(detection)
    assert detection == snapshot


# ─── Power Earnings Gap: eligibility + event + reconstructed gate_trace ───

@pytest.mark.parametrize("name,detection", PEG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_power_earnings_gap(detection)
    _assert_parity(detection, adapted, {"eligibility", "event", "gate_trace"})


@pytest.mark.parametrize("name,detection", PEG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_adapter_event_matches_geometry_extras(name, detection):
    """event.* must agree with the Phase-6 Group-3 fields already sitting in
    geometry.extras -- the adapter promotes them, it must not reinterpret them."""
    adapted = adapt_power_earnings_gap(detection)
    extras = detection["geometry"]["extras"]
    event = adapted["event"]
    assert event["days_from_event"] == extras.get("days_to_earnings")
    if extras.get("days_to_earnings") is None:
        assert event["verification_status"] == "unavailable"
    elif extras.get("earnings_linkage_verified"):
        assert event["verification_status"] == "verified"
    else:
        assert event["verification_status"] == "contradicted"


@pytest.mark.parametrize("name,detection", PEG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_adapter_gate_trace_all_pass_and_recompute_correctly(name, detection):
    """Every gate in a SURVIVING detection's trace must independently
    recompute to 'pass' against the detector's own real constants -- if this
    ever fails, either the adapter's reconstruction or the detector's own
    output has drifted."""
    adapted = adapt_power_earnings_gap(detection)
    trace = adapted["gate_trace"]
    ids = {g["criterion_id"] for g in trace}
    assert ids == {
        "peg_gap_pct_floor", "peg_volume_ratio_floor", "peg_gap_holding",
        "peg_post_gap_tightness", "peg_post_gap_bar_count",
    }
    for gate in trace:
        assert gate["result"] == "pass", f"{gate['criterion_id']} did not pass on a firing detection: {gate}"
        for required_key in ("observed_value", "expected_value", "operator", "role", "required"):
            assert required_key in gate

    extras = detection["geometry"]["extras"]
    by_id = {g["criterion_id"]: g for g in trace}
    assert by_id["peg_gap_pct_floor"]["expected_value"] == _MIN_GAP_PCT
    assert by_id["peg_volume_ratio_floor"]["expected_value"] == _MIN_VOLUME_RATIO
    assert by_id["peg_gap_holding"]["expected_value"] == _GAP_FILL_THRESHOLD
    assert by_id["peg_post_gap_tightness"]["expected_value"] == _MAX_POST_GAP_TIGHTNESS
    assert abs(by_id["peg_gap_pct_floor"]["observed_value"] - extras["gap_pct"] / 100.0) < 1e-6
    assert by_id["peg_post_gap_bar_count"]["observed_value"] == extras["post_gap_bars"]


def test_peg_adapter_does_not_mutate_its_input():
    assert PEG_DETECTIONS
    _, detection = PEG_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_power_earnings_gap(detection)
    assert detection == snapshot


def test_fixture_coverage_is_nonzero():
    """A silent zero-fixture run would make every test above vacuously pass —
    guard against that."""
    assert len(HTF_DETECTIONS) >= 3, "expected several firing HTF fixtures"
    assert len(PEG_DETECTIONS) >= 3, "expected several firing PEG fixtures"


# ─── compute_default_eligibility: family-agnostic freshness-gate path ─────

def test_compute_default_eligibility_respects_family_freshness_gate():
    assert HTF_DETECTIONS
    _, detection = HTF_DETECTIONS[0]
    now = detection["detected_at"]

    within = compute_default_eligibility(
        detection, now=now, freshness_bars=3, freshness_window_bars=5
    )
    assert within["eligible"] is True
    assert within["freshness_bars"] == 3
    assert within["freshness_window_bars"] == 5

    outside = compute_default_eligibility(
        detection, now=now, freshness_bars=6, freshness_window_bars=5
    )
    assert outside["eligible"] is False
    assert any("exceeded family window" in r for r in outside["eligibility_reasons"])
