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
    adapt_bearish_engulfing,
    adapt_bullish_engulfing,
    adapt_bull_flag,
    adapt_episodic_pivot,
    adapt_flat_base,
    adapt_high_tight_flag,
    adapt_power_earnings_gap,
    adapt_pullback_to_50sma,
    adapt_vcp,
    build_scanner_summary,
    compute_default_eligibility,
)
from api.services.pattern_engine.detectors.candlestick.bearish_engulfing import (
    detect_bearish_engulfing,
)
from api.services.pattern_engine.detectors.candlestick.bullish_engulfing import (
    detect_bullish_engulfing,
)
from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.detectors.uct.episodic_pivot import (
    _MAX_BASE_BARS,
    _MAX_BASE_DEPTH,
    _MIN_BASE_BARS,
    _MIN_CLOSE_STRENGTH,
    _MIN_GAP_PCT as _EP_MIN_GAP_PCT,
    _MIN_RANGE_RATIO,
    _MIN_VOLUME_RATIO as _EP_MIN_VOLUME_RATIO,
    detect_episodic_pivot,
)
from api.services.pattern_engine.detectors.uct.flat_base import detect_flat_base
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.power_earnings_gap import (
    _GAP_FILL_THRESHOLD,
    _MAX_POST_GAP_TIGHTNESS,
    _MIN_GAP_PCT,
    _MIN_VOLUME_RATIO,
    detect_power_earnings_gap,
)
from api.services.pattern_engine.detectors.uct.pullback_to_50sma import (
    _MIN_PRIOR_ADVANCE_PCT,
    detect_pullback_to_50sma,
)
from api.services.pattern_engine.detectors.uct.vcp import detect_vcp
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
BE_DETECTIONS = _fired_detections("bullish_engulfing", detect_bullish_engulfing)
BRE_DETECTIONS = _fired_detections("bearish_engulfing", detect_bearish_engulfing)
BULL_FLAG_DETECTIONS = _fired_detections("bull_flag", detect_bull_flag)
FLAT_BASE_DETECTIONS = _fired_detections("flat_base", detect_flat_base)
VCP_DETECTIONS = _fired_detections("vcp", detect_vcp)
P50_DETECTIONS = _fired_detections("pullback_to_50sma", detect_pullback_to_50sma)
EP_DETECTIONS = _fired_detections("episodic_pivot", detect_episodic_pivot)


_GEOMETRY_ENRICHMENT_KEYS = {"anchor_roles", "semantic_subtype"}


def _assert_parity(original: dict, adapted: dict, new_keys: set[str]):
    """Every pre-existing key must be unchanged; only `new_keys` may differ.

    Package 8D exception, precisely scoped rather than loosened generally:
    `geometry` itself may gain `anchor_roles`/`semantic_subtype` (Package 8D)
    as an ENRICHMENT -- but its `shape`/`anchors`/`extras` (what the detector
    actually supplied, this authorization's own §3 principle) must remain
    byte-identical, and nothing else inside it may change.
    """
    for key in original:
        assert key in adapted, f"adapter dropped existing key {key!r}"
        if key == "geometry":
            orig_geom, adapted_geom = original[key], adapted[key]
            for sub in ("shape", "anchors", "extras"):
                assert adapted_geom[sub] == orig_geom[sub], (
                    f"adapter changed geometry.{sub}: {orig_geom[sub]!r} -> {adapted_geom[sub]!r}"
                )
            extra_geom_keys = set(adapted_geom) - set(orig_geom)
            assert extra_geom_keys <= _GEOMETRY_ENRICHMENT_KEYS, (
                f"adapter added unexpected geometry keys: {extra_geom_keys}"
            )
            continue
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


# ─── Bullish Engulfing: eligibility-only, mirrors HTF's minimal shape ─────

@pytest.mark.parametrize("name,detection", BE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_be_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_bullish_engulfing(detection)
    _assert_parity(detection, adapted, {"eligibility"})


@pytest.mark.parametrize("name,detection", BE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_be_adapter_omits_event_and_criteria(name, detection):
    """A 2-bar candlestick reversal has no addressable calendar event -- these
    keys must be genuinely ABSENT, not null/empty, matching HTF's precedent."""
    adapted = adapt_bullish_engulfing(detection)
    assert "event" not in adapted
    assert "criteria" not in adapted
    assert "gate_trace" not in adapted


@pytest.mark.parametrize("name,detection", BE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_be_adapter_eligibility_shape(name, detection):
    adapted = adapt_bullish_engulfing(detection)
    elig = adapted["eligibility"]
    assert elig["eligibility_scope"] == "system_default"
    assert elig["eligibility_version"] == ADAPTER_VERSION
    assert elig["active_window_secs"] == memory.ACTIVE_WINDOW_SECS
    # Bullish Engulfing has no per-family freshness gate in-file -- both must
    # be None, not a fabricated number.
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    assert elig["eligible"] is True
    assert any("within active window" in r for r in elig["eligibility_reasons"])


def test_be_adapter_eligible_false_once_outside_active_window():
    assert BE_DETECTIONS, "need at least one firing Bullish Engulfing fixture"
    _, detection = BE_DETECTIONS[0]
    stale = dict(detection)
    stale["detected_at"] = int(time.time()) - memory.ACTIVE_WINDOW_SECS - 3600
    adapted = adapt_bullish_engulfing(stale)
    assert adapted["eligibility"]["eligible"] is False
    assert any("outside active window" in r for r in adapted["eligibility"]["eligibility_reasons"])


def test_be_adapter_does_not_mutate_its_input():
    assert BE_DETECTIONS
    _, detection = BE_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_bullish_engulfing(detection)
    assert detection == snapshot


@pytest.mark.parametrize("name,detection", BE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_be_anchor_roles_match_the_detectors_real_anchor_order(name, detection):
    """Re-verifies the exact anchor order bullish_engulfing.py::_build_detection
    emits (prior bar close, engulfing bar close) -- both real semantic points,
    unlike bull_flag's unanchored pole (a separate, still-open gap)."""
    adapted = adapt_bullish_engulfing(detection)
    geometry = adapted["geometry"]
    assert geometry["semantic_subtype"] == "engulfing_pair"
    assert geometry["anchor_roles"] == ["prior_bar_close", "engulfing_bar_close"]
    assert len(geometry["anchor_roles"]) == len(geometry["anchors"]) == 2


@pytest.mark.parametrize("name,detection", BE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_be_scanner_summary_separates_status_from_eligibility(name, detection):
    adapted = adapt_bullish_engulfing(detection)
    summary = build_scanner_summary(adapted)
    assert summary["status"] == adapted["status"] == "ready"
    assert summary["scanner_eligible"] is True
    assert summary["pattern_id"] == adapted["pattern_id"]
    assert summary["confidence"] == adapted["confidence"]
    assert summary["primary_reason"] == adapted["narrative"]["headline"]


@pytest.mark.parametrize("name,detection", BE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_be_scanner_summary_discloses_absent_sections_honestly(name, detection):
    adapted = adapt_bullish_engulfing(detection)
    summary = build_scanner_summary(adapted)
    assert "no gate-evaluation trace available for this family" in summary["warnings"]
    assert "no event provenance for this family" in summary["warnings"]
    assert "event_note" not in summary
    assert summary["freshness_note"] == "no family-specific freshness gate (shared active window only)"


# ─── Bearish Engulfing: eligibility-only, mirrors HTF/Bullish-Engulfing ───

@pytest.mark.parametrize("name,detection", BRE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_bearish_engulfing(detection)
    _assert_parity(detection, adapted, {"eligibility"})


@pytest.mark.parametrize("name,detection", BRE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_adapter_omits_event_and_criteria(name, detection):
    """A 2-bar candlestick reversal has no addressable calendar event -- these
    keys must be genuinely ABSENT, not null/empty, matching HTF/Bullish
    Engulfing's own precedent."""
    adapted = adapt_bearish_engulfing(detection)
    assert "event" not in adapted
    assert "criteria" not in adapted
    assert "gate_trace" not in adapted


@pytest.mark.parametrize("name,detection", BRE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_adapter_eligibility_shape(name, detection):
    adapted = adapt_bearish_engulfing(detection)
    elig = adapted["eligibility"]
    assert elig["eligibility_scope"] == "system_default"
    assert elig["eligibility_version"] == ADAPTER_VERSION
    assert elig["active_window_secs"] == memory.ACTIVE_WINDOW_SECS
    # Bearish Engulfing has no per-family freshness gate in-file -- both must
    # be None, not a fabricated number.
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    assert elig["eligible"] is True
    assert any("within active window" in r for r in elig["eligibility_reasons"])


def test_bre_adapter_eligible_false_once_outside_active_window():
    assert BRE_DETECTIONS, "need at least one firing Bearish Engulfing fixture"
    _, detection = BRE_DETECTIONS[0]
    stale = dict(detection)
    stale["detected_at"] = int(time.time()) - memory.ACTIVE_WINDOW_SECS - 3600
    adapted = adapt_bearish_engulfing(stale)
    assert adapted["eligibility"]["eligible"] is False
    assert any("outside active window" in r for r in adapted["eligibility"]["eligibility_reasons"])


def test_bre_adapter_does_not_mutate_its_input():
    assert BRE_DETECTIONS
    _, detection = BRE_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_bearish_engulfing(detection)
    assert detection == snapshot


@pytest.mark.parametrize("name,detection", BRE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_anchor_roles_match_the_detectors_real_anchor_order(name, detection):
    """Re-verifies the exact anchor order bearish_engulfing.py::_build_detection
    emits (prior bar close, engulfing bar close) -- the same order the
    owner-required semantic diff confirmed matches Bullish Engulfing's own
    (still-unmerged-here) adapter shape."""
    adapted = adapt_bearish_engulfing(detection)
    geometry = adapted["geometry"]
    assert geometry["semantic_subtype"] == "engulfing_pair"
    assert geometry["anchor_roles"] == ["prior_bar_close", "engulfing_bar_close"]
    assert len(geometry["anchor_roles"]) == len(geometry["anchors"]) == 2


@pytest.mark.parametrize("name,detection", BRE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_scanner_summary_separates_status_from_eligibility(name, detection):
    adapted = adapt_bearish_engulfing(detection)
    summary = build_scanner_summary(adapted)
    assert summary["status"] == adapted["status"] == "ready"
    assert summary["scanner_eligible"] is True
    assert summary["pattern_id"] == adapted["pattern_id"]
    assert summary["confidence"] == adapted["confidence"]
    assert summary["primary_reason"] == adapted["narrative"]["headline"]


@pytest.mark.parametrize("name,detection", BRE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bre_scanner_summary_discloses_absent_sections_honestly(name, detection):
    adapted = adapt_bearish_engulfing(detection)
    summary = build_scanner_summary(adapted)
    assert "no gate-evaluation trace available for this family" in summary["warnings"]
    assert "no event provenance for this family" in summary["warnings"]
    assert "event_note" not in summary
    assert summary["freshness_note"] == "no family-specific freshness gate (shared active window only)"


def test_bre_detections_all_carry_the_bearish_pattern_id_never_the_bullish_one():
    """⛔ CROSS-WIRE GUARD (owner Section 10). The two families share almost
    identical shapes -- this asserts the fixture battery's own real detector
    output never confuses the two, which is the ONE thing that would make
    every adapter test above pass for the wrong reason."""
    assert BRE_DETECTIONS
    for name, detection in BRE_DETECTIONS:
        assert detection["pattern_id"] == "bearish_engulfing", (
            f"fixture {name!r} produced pattern_id={detection['pattern_id']!r}"
        )
        assert detection["direction"] == "bearish"


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


# ─── Bull Flag: eligibility-only, event/criteria/gate_trace absent ────────
# (Package 8H) — same minimal shape as High Tight Flag: no event concept, no
# per-family freshness gate, no competing base_catalog Structure (verified
# against both standing two-engines regression rails — see canonical_adapter
# module docstring).

@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_bull_flag(detection)
    _assert_parity(detection, adapted, {"eligibility"})


@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_adapter_omits_event_and_criteria(name, detection):
    """Bull Flag is a pure price/volume continuation pattern with no event
    concept and no named public gate constants analogous to PEG's — these
    keys must be genuinely ABSENT, not null/empty."""
    adapted = adapt_bull_flag(detection)
    assert "event" not in adapted
    assert "criteria" not in adapted
    assert "gate_trace" not in adapted


@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_adapter_eligibility_shape(name, detection):
    adapted = adapt_bull_flag(detection)
    elig = adapted["eligibility"]
    assert elig["eligibility_scope"] == "system_default"
    assert elig["eligibility_version"] == ADAPTER_VERSION
    assert elig["active_window_secs"] == memory.ACTIVE_WINDOW_SECS
    # Bull Flag has no per-family freshness gate — both must be None, not a
    # fabricated number (its own staleness bound is re-scan aging past
    # bull_flag._MAX_FLAG_BARS, not a stored age field).
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    assert elig["eligible"] is True
    assert any("within active window" in r for r in elig["eligibility_reasons"])


def test_bull_flag_adapter_eligible_false_once_outside_active_window():
    assert BULL_FLAG_DETECTIONS, "need at least one firing bull_flag fixture"
    _, detection = BULL_FLAG_DETECTIONS[0]
    stale = dict(detection)
    stale["detected_at"] = int(time.time()) - memory.ACTIVE_WINDOW_SECS - 3600
    adapted = adapt_bull_flag(stale)
    assert adapted["eligibility"]["eligible"] is False
    assert any("outside active window" in r for r in adapted["eligibility"]["eligibility_reasons"])


def test_bull_flag_adapter_does_not_mutate_its_input():
    assert BULL_FLAG_DETECTIONS
    _, detection = BULL_FLAG_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_bull_flag(detection)
    assert detection == snapshot


@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_scanner_summary_separates_status_from_eligibility(name, detection):
    adapted = adapt_bull_flag(detection)
    summary = build_scanner_summary(adapted)
    assert summary["status"] == adapted["status"] == "ready"
    assert summary["scanner_eligible"] is True
    assert summary["pattern_id"] == adapted["pattern_id"]
    assert summary["confidence"] == adapted["confidence"]
    assert summary["primary_reason"] == adapted["narrative"]["headline"]


@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_scanner_summary_discloses_absent_sections_honestly(name, detection):
    adapted = adapt_bull_flag(detection)
    summary = build_scanner_summary(adapted)
    assert "no gate-evaluation trace available for this family" in summary["warnings"]
    assert "no event provenance for this family" in summary["warnings"]
    assert "event_note" not in summary
    assert summary["freshness_note"] == "no family-specific freshness gate (shared active window only)"


# ─── Flat Base: eligibility-only, event/criteria/gate_trace absent — same
#     minimal shape as HTF/Bull Flag, independently re-verified (not assumed)
#     from flat_base.py's own current code ─────────────────────────────────

@pytest.mark.parametrize("name,detection", FLAT_BASE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_flat_base(detection)
    _assert_parity(detection, adapted, {"eligibility"})


@pytest.mark.parametrize("name,detection", FLAT_BASE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_adapter_omits_event_and_criteria(name, detection):
    """flat_base.py's own header STOP comment defers criteria/provenance to
    base_catalog.py's parallel `flat-base` structure and has no event
    concept — these keys must be genuinely ABSENT, not null/empty."""
    adapted = adapt_flat_base(detection)
    assert "event" not in adapted
    assert "criteria" not in adapted
    assert "gate_trace" not in adapted


@pytest.mark.parametrize("name,detection", FLAT_BASE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_adapter_eligibility_shape(name, detection):
    adapted = adapt_flat_base(detection)
    elig = adapted["eligibility"]
    assert elig["eligibility_scope"] == "system_default"
    assert elig["eligibility_version"] == ADAPTER_VERSION
    assert elig["active_window_secs"] == memory.ACTIVE_WINDOW_SECS
    # Flat Base has no per-family freshness gate (re-verified by direct read
    # of flat_base.py — no `_MAX_.*AGE` constant in the file) — both must be
    # None, not a fabricated number.
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    assert elig["eligible"] is True
    assert any("within active window" in r for r in elig["eligibility_reasons"])


def test_flat_base_adapter_eligible_false_once_outside_active_window():
    assert FLAT_BASE_DETECTIONS, "need at least one firing Flat Base fixture"
    _, detection = FLAT_BASE_DETECTIONS[0]
    stale = dict(detection)
    stale["detected_at"] = int(time.time()) - memory.ACTIVE_WINDOW_SECS - 3600
    adapted = adapt_flat_base(stale)
    assert adapted["eligibility"]["eligible"] is False
    assert any("outside active window" in r for r in adapted["eligibility"]["eligibility_reasons"])


def test_flat_base_adapter_does_not_mutate_its_input():
    assert FLAT_BASE_DETECTIONS
    _, detection = FLAT_BASE_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_flat_base(detection)
    assert detection == snapshot


@pytest.mark.parametrize("name,detection", FLAT_BASE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_anchor_roles_match_the_detectors_real_anchor_order(name, detection):
    """Re-verifies the exact anchor order flat_base.py::_build_detection
    emits (prior_advance_low, base_start_high, base_end_high, base_end_low)
    -- if that ever changes, this label set would silently start describing
    the wrong points, and this test is what would catch it."""
    adapted = adapt_flat_base(detection)
    geometry = adapted["geometry"]
    assert geometry["semantic_subtype"] == "base_and_pivot"
    assert geometry["anchor_roles"] == [
        "prior_advance_low", "base_start_high", "base_end_high", "base_end_low",
    ]
    assert len(geometry["anchor_roles"]) == len(geometry["anchors"]) == 4
    prior_advance_low, base_start_high, base_end_high, base_end_low = geometry["anchors"]
    # A real prior-advance-low -> base-high transition: the base's own high
    # must genuinely sit above the prior swing low that preceded it.
    assert base_start_high["price"] > prior_advance_low["price"]
    # base_start_high and base_end_high are the SAME price (the base's own
    # high, both ends) but genuinely different bars in time.
    assert base_start_high["price"] == pytest.approx(base_end_high["price"])
    assert base_start_high["t"] != base_end_high["t"]
    # base_end_high and base_end_low share the same bar (the base's last bar)
    # but are genuinely different prices (a real range, not a collapsed point).
    assert base_end_high["t"] == base_end_low["t"]
    assert base_end_high["price"] > base_end_low["price"]


@pytest.mark.parametrize("name,detection", FLAT_BASE_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_flat_base_scanner_summary_separates_status_from_eligibility(name, detection):
    adapted = adapt_flat_base(detection)
    summary = build_scanner_summary(adapted)
    assert summary["status"] == adapted["status"] == "ready"
    assert summary["scanner_eligible"] is True
    assert summary["pattern_id"] == adapted["pattern_id"]
    assert summary["confidence"] == adapted["confidence"]
    assert summary["primary_reason"] == adapted["narrative"]["headline"]


# ─── VCP GEOMETRY SHAPE-CONTRACT + CANONICAL ADAPTATION: eligibility-only,
#     event/criteria/gate_trace absent (same minimal shape as HTF, and for
#     the same reason — see adapt_vcp's own docstring) ─────────────────────

@pytest.mark.parametrize("name,detection", VCP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_vcp_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_vcp(detection)
    _assert_parity(detection, adapted, {"eligibility"})


@pytest.mark.parametrize("name,detection", VCP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_vcp_adapter_omits_event_and_criteria(name, detection):
    """vcp.py's own file defers criteria/provenance to base_catalog.py's
    parallel `vcp` structure and has no event concept — these keys must be
    genuinely ABSENT, not null/empty."""
    adapted = adapt_vcp(detection)
    assert "event" not in adapted
    assert "criteria" not in adapted
    assert "gate_trace" not in adapted


@pytest.mark.parametrize("name,detection", VCP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_vcp_adapter_eligibility_shape(name, detection):
    adapted = adapt_vcp(detection)
    elig = adapted["eligibility"]
    assert elig["eligibility_scope"] == "system_default"
    assert elig["eligibility_version"] == ADAPTER_VERSION
    assert elig["active_window_secs"] == memory.ACTIVE_WINDOW_SECS
    # VCP DOES have a real per-family recency gate (_MAX_FINAL_LOW_AGE=15),
    # but its bar-index inputs do not survive into the persisted Detection —
    # both must honestly be None here, never a guessed bar count.
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    assert elig["eligible"] is True
    assert any("within active window" in r for r in elig["eligibility_reasons"])


def test_vcp_adapter_eligible_false_once_outside_active_window():
    assert VCP_DETECTIONS, "need at least one firing VCP fixture"
    _, detection = VCP_DETECTIONS[0]
    stale = dict(detection)
    stale["detected_at"] = int(time.time()) - memory.ACTIVE_WINDOW_SECS - 3600
    adapted = adapt_vcp(stale)
    assert adapted["eligibility"]["eligible"] is False
    assert any("outside active window" in r for r in adapted["eligibility"]["eligibility_reasons"])


def test_vcp_adapter_does_not_mutate_its_input():
    assert VCP_DETECTIONS
    _, detection = VCP_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_vcp(detection)
    assert detection == snapshot


# ─── Pullback to 50-SMA: eligibility-only, event/criteria/gate_trace absent
#     (same minimal shape as HTF, for a DIFFERENT reason — no base_catalog.py
#     counterpart exists at all, and no named gate constants to reconstruct
#     against; see adapt_pullback_to_50sma's own docstring) ────────────────

@pytest.mark.parametrize("name,detection", P50_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_pullback_to_50sma(detection)
    _assert_parity(detection, adapted, {"eligibility"})


@pytest.mark.parametrize("name,detection", P50_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_adapter_omits_event_and_criteria(name, detection):
    """pullback_to_50sma.py has no external-event concept (a technical MA
    touch is not a calendar event) and no parallel base_catalog.py structure
    to defer criteria/provenance to (grepped directly — zero hits, unlike
    VCP/HTF) — these keys must be genuinely ABSENT, not null/empty."""
    adapted = adapt_pullback_to_50sma(detection)
    assert "event" not in adapted
    assert "criteria" not in adapted
    assert "gate_trace" not in adapted


@pytest.mark.parametrize("name,detection", P50_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_adapter_eligibility_shape(name, detection):
    adapted = adapt_pullback_to_50sma(detection)
    elig = adapted["eligibility"]
    assert elig["eligibility_scope"] == "system_default"
    assert elig["eligibility_version"] == ADAPTER_VERSION
    assert elig["active_window_secs"] == memory.ACTIVE_WINDOW_SECS
    # Phase-7 spec (Section 140) classifies this family as having no
    # freshness/recency concept of its own at all — both must be None.
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    assert elig["eligible"] is True
    assert any("within active window" in r for r in elig["eligibility_reasons"])


def test_p50_adapter_eligible_false_once_outside_active_window():
    assert P50_DETECTIONS, "need at least one firing pullback_to_50sma fixture"
    _, detection = P50_DETECTIONS[0]
    stale = dict(detection)
    stale["detected_at"] = int(time.time()) - memory.ACTIVE_WINDOW_SECS - 3600
    adapted = adapt_pullback_to_50sma(stale)
    assert adapted["eligibility"]["eligible"] is False
    assert any("outside active window" in r for r in adapted["eligibility"]["eligibility_reasons"])


def test_p50_adapter_does_not_mutate_its_input():
    assert P50_DETECTIONS
    _, detection = P50_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_pullback_to_50sma(detection)
    assert detection == snapshot


# ─── Pullback to 50-SMA: the one-anchor geometry adjudication ──────────────

@pytest.mark.parametrize("name,detection", P50_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_geometry_is_exactly_one_anchor_labeled_honestly(name, detection):
    """Re-verifies pullback_to_50sma.py's own real anchor construction: ONE
    anchor at (last_bar.t, sma50) — never the touch bar, never a fabricated
    second point. If a future detector change ever adds real geometry, this
    is what would catch the mismatch (roles length must track anchors length
    via `_with_labeled_geometry`'s own cardinality check)."""
    adapted = adapt_pullback_to_50sma(detection)
    geometry = adapted["geometry"]
    assert geometry["shape"] == "horizontal_line"
    assert len(geometry["anchors"]) == 1
    assert geometry["semantic_subtype"] == "ma_reference_point"
    assert geometry["anchor_roles"] == ["current_sma_reading"]
    # The single anchor's price is the real SMA reading this same detection
    # reports in extras — not a placeholder, not re-derived independently.
    assert geometry["anchors"][0]["price"] == pytest.approx(
        geometry["extras"]["sma_50_value"], abs=1e-6
    )
    # And its timestamp is the real last/current bar, matching end_t exactly
    # — never the touch bar's timestamp (which sits in pivot_ts[0] instead).
    assert geometry["anchors"][0]["t"] == detection["end_t"]
    # Sanity: every firing detection really did clear this family's own
    # named prior-advance floor (a real threshold, unlike the two bare-
    # literal volume-ratio gates this adapter deliberately doesn't cite).
    assert geometry["extras"]["prior_advance_pct"] >= _MIN_PRIOR_ADVANCE_PCT * 100.0


@pytest.mark.parametrize("name,detection", P50_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_p50_touch_bar_timestamp_survives_on_the_raw_detection_but_is_not_promoted_into_anchors(name, detection):
    """The touch (pullback) bar's real timestamp is NOT lost by this
    detector — it survives in `pivot_ts[0]` — but this adapter deliberately
    does not promote it into `geometry.anchors`, since doing so would mean
    the ADAPTER inventing a second anchor the detector itself never emitted
    as geometry (see adapt_pullback_to_50sma's own docstring on why this is
    Category A, not a defect to silently fix here)."""
    adapted = adapt_pullback_to_50sma(detection)
    assert len(detection["pivot_ts"]) == 2
    touch_bar_t = detection["pivot_ts"][0]
    assert touch_bar_t != detection["end_t"], (
        "fixture setup error: touch bar and last bar must differ for this "
        "test to mean anything"
    )
    anchor_ts = [a["t"] for a in adapted["geometry"]["anchors"]]
    assert touch_bar_t not in anchor_ts


def test_p50_anchor_role_labeling_never_mutates_the_original_geometry_dict():
    assert P50_DETECTIONS
    _, detection = P50_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapted = adapt_pullback_to_50sma(detection)
    assert detection == snapshot
    assert "anchor_roles" not in detection["geometry"]
    assert "anchor_roles" in adapted["geometry"]


# ─── Episodic Pivot: eligibility + labeled geometry + reconstructed gate_trace;
#     event PRESENT but explicitly empty (Category C -- no event concept) ────

@pytest.mark.parametrize("name,detection", EP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_ep_adapter_preserves_every_existing_field(name, detection):
    adapted = adapt_episodic_pivot(detection)
    _assert_parity(detection, adapted, {"eligibility", "event", "gate_trace"})


@pytest.mark.parametrize("name,detection", EP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_ep_adapter_event_is_present_but_deliberately_empty(name, detection):
    """Category-C event-provenance adjudication: EP's detector carries no
    external-event data of any kind, so `event` must be present (not
    HTF-style entirely absent -- EP IS a gap/event family per Phase-7 §24/§26)
    but carry ONLY `verification_status='unavailable'` -- never a guessed
    `event_type`, never a fabricated `source`, never any PEG-style earnings
    field this detector never computes."""
    adapted = adapt_episodic_pivot(detection)
    assert adapted["event"] == {"verification_status": "unavailable"}


@pytest.mark.parametrize("name,detection", EP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_ep_adapter_gate_trace_all_pass_and_recompute_correctly(name, detection):
    """Every gate in a SURVIVING detection's trace must independently
    recompute to 'pass' against the detector's own real constants -- if this
    ever fails, either the adapter's reconstruction or the detector's own
    output has drifted."""
    adapted = adapt_episodic_pivot(detection)
    trace = adapted["gate_trace"]
    ids = {g["criterion_id"] for g in trace}
    assert ids == {
        "ep_gap_pct_floor", "ep_range_ratio_floor", "ep_volume_ratio_floor",
        "ep_close_strength_floor", "ep_base_depth_ceiling", "ep_base_bars_range",
        "ep_close_above_base_high",
    }
    for gate in trace:
        assert gate["result"] == "pass", f"{gate['criterion_id']} did not pass on a firing detection: {gate}"
        for required_key in ("observed_value", "expected_value", "operator", "role", "required"):
            assert required_key in gate

    extras = detection["geometry"]["extras"]
    by_id = {g["criterion_id"]: g for g in trace}
    assert by_id["ep_gap_pct_floor"]["expected_value"] == _EP_MIN_GAP_PCT
    assert by_id["ep_range_ratio_floor"]["expected_value"] == _MIN_RANGE_RATIO
    assert by_id["ep_volume_ratio_floor"]["expected_value"] == _EP_MIN_VOLUME_RATIO
    assert by_id["ep_close_strength_floor"]["expected_value"] == _MIN_CLOSE_STRENGTH
    assert by_id["ep_base_depth_ceiling"]["expected_value"] == _MAX_BASE_DEPTH
    assert by_id["ep_base_bars_range"]["expected_value"] == [_MIN_BASE_BARS, _MAX_BASE_BARS]
    assert abs(by_id["ep_gap_pct_floor"]["observed_value"] - extras["gap_pct"] / 100.0) < 1e-6
    assert by_id["ep_base_bars_range"]["observed_value"] == extras["base_bars"]
    assert by_id["ep_close_above_base_high"]["observed_value"] == extras["ep_close"]


@pytest.mark.parametrize("name,detection", EP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_ep_adapter_eligibility_freshness_left_none_despite_a_real_gate(name, detection):
    """`_MAX_EP_AGE=5` is a REAL per-family freshness gate (re-derived fresh
    from episodic_pivot.py, confirmed by the Phase-7 spec's own S26 matrix
    row) -- but it bounds WHICH bar can be tried as the EP-bar candidate
    (Pullback-shape: bounds the search), not a separate reject-if-stale
    check on an already-valid candidate (VCP-shape). It is not reconstructable
    post-hoc as an exact bar count from a persisted Detection (only Unix
    timestamps survive; converting a delta to a bar count needs the
    timeframe's bar spacing, which isn't reliably available). Same treatment
    as VCP's own `_MAX_FINAL_LOW_AGE`: both stay None."""
    adapted = adapt_episodic_pivot(detection)
    elig = adapted["eligibility"]
    assert elig["freshness_bars"] is None
    assert elig["freshness_window_bars"] is None
    assert elig["eligible"] is True


def test_ep_adapter_does_not_mutate_its_input():
    assert EP_DETECTIONS
    _, detection = EP_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapt_episodic_pivot(detection)
    assert detection == snapshot


def test_fixture_coverage_is_nonzero():
    """A silent zero-fixture run would make every test above vacuously pass —
    guard against that."""
    assert len(HTF_DETECTIONS) >= 3, "expected several firing HTF fixtures"
    assert len(PEG_DETECTIONS) >= 3, "expected several firing PEG fixtures"
    assert len(BE_DETECTIONS) >= 3, "expected several firing Bullish Engulfing fixtures"
    assert len(BRE_DETECTIONS) >= 3, "expected several firing Bearish Engulfing fixtures"
    assert len(BULL_FLAG_DETECTIONS) >= 3, "expected several firing bull_flag fixtures"
    assert len(FLAT_BASE_DETECTIONS) >= 3, "expected several firing Flat Base fixtures"
    assert len(VCP_DETECTIONS) >= 3, "expected several firing VCP fixtures"
    assert len(P50_DETECTIONS) >= 3, "expected several firing pullback_to_50sma fixtures"
    assert len(EP_DETECTIONS) >= 3, "expected several firing EP fixtures"


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


# ─── Package 8C: canonical scanner summary contract (identity vs eligibility,
#     honest warnings, event surfacing) — NOT wired into pattern_join.py ────

@pytest.mark.parametrize("name,detection", HTF_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_scanner_summary_separates_status_from_eligibility(name, detection):
    adapted = adapt_high_tight_flag(detection)
    summary = build_scanner_summary(adapted)
    # status (lifecycle) and scanner_eligible (eligibility) are two distinct
    # fields, never collapsed -- the Phase-7 §3C / this authorization's §7
    # requirement, checked directly rather than merely asserted in prose.
    assert summary["status"] == adapted["status"] == "ready"
    assert summary["scanner_eligible"] is True
    assert summary["pattern_id"] == adapted["pattern_id"]
    assert summary["confidence"] == adapted["confidence"]
    assert summary["primary_reason"] == adapted["narrative"]["headline"]


@pytest.mark.parametrize("name,detection", HTF_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_scanner_summary_discloses_absent_sections_honestly(name, detection):
    adapted = adapt_high_tight_flag(detection)
    summary = build_scanner_summary(adapted)
    assert "no gate-evaluation trace available for this family" in summary["warnings"]
    assert "no event provenance for this family" in summary["warnings"]
    assert "event_note" not in summary
    assert summary["freshness_note"] == "no family-specific freshness gate (shared active window only)"


@pytest.mark.parametrize("name,detection", PEG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_scanner_summary_surfaces_event_note_not_just_a_gap(name, detection):
    """The scanner summary must not reduce PEG to 'price gapped strongly' --
    the earnings-linkage verification status must be visible in the summary
    a scanner would actually display."""
    adapted = adapt_power_earnings_gap(detection)
    summary = build_scanner_summary(adapted)
    assert "event_note" in summary
    assert summary["event_note"] == f"earnings linkage: {adapted['event']['verification_status']}"
    assert "no event provenance for this family" not in summary["warnings"]
    assert "no gate-evaluation trace available for this family" not in summary["warnings"]


@pytest.mark.parametrize("name,detection", EP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_ep_scanner_summary_reports_event_unavailable_never_earnings(name, detection):
    """EP's event_note must read as a genuinely empty/unavailable linkage --
    never fall back to PEG's 'earnings linkage' wording (there is no
    event_type on EP's EventProvenance to format one from)."""
    adapted = adapt_episodic_pivot(detection)
    summary = build_scanner_summary(adapted)
    assert summary["event_note"] == "event linkage: unavailable"
    assert "earnings" not in summary["event_note"]
    assert "no event provenance for this family" not in summary["warnings"]
    assert "no gate-evaluation trace available for this family" not in summary["warnings"]


def test_scanner_summary_never_fabricates_eligibility_when_absent():
    """A Detection that never went through an adapter has no `eligibility`
    key at all -- the summary must report None, never guess True/False."""
    assert HTF_DETECTIONS
    _, raw_detection = HTF_DETECTIONS[0]  # NOT adapted
    summary = build_scanner_summary(raw_detection)
    assert summary["scanner_eligible"] is None


def test_package_8c_does_not_touch_the_real_scanner_data_path():
    """Package 8C traced api/services/screener/pattern_join.py directly and
    found it reads pattern_detections via raw SQL for exactly 5 existing
    columns (sym/pattern_id/direction/confidence/levels_json) -- no column
    exists for any canonical section. This test pins that pattern_join.py's
    SQL is UNCHANGED by this package (the persistence gate in the
    Package-8C authorization's §4 means it must not be), so a future editor
    who touches this file is told directly, not left to discover it by
    re-reading the module docstring."""
    import inspect
    from api.services.screener import pattern_join
    source = inspect.getsource(pattern_join.read_pattern_fields)
    assert "SELECT sym, pattern_id, direction, confidence, levels_json, detected_at" in source
    assert "eligibility" not in source
    assert "gate_trace" not in source
    assert "event_json" not in source


# ─── Package 8D: semantic geometry labels (anchor_roles / semantic_subtype) ─

@pytest.mark.parametrize("name,detection", HTF_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_htf_anchor_roles_match_the_detectors_real_anchor_order(name, detection):
    """Re-verifies the exact anchor order high_tight_flag.py::_build_detection
    emits (pole_base, pole_top, flag_low, flag_high) -- if that ever changes,
    this label set would silently start describing the wrong points, and
    this test is what would catch it."""
    adapted = adapt_high_tight_flag(detection)
    geometry = adapted["geometry"]
    assert geometry["semantic_subtype"] == "pole_and_flag"
    assert geometry["anchor_roles"] == ["pole_base", "pole_top", "flag_low", "flag_high"]
    assert len(geometry["anchor_roles"]) == len(geometry["anchors"]) == 4
    # anchors[0]->[1] is a REAL pole segment (re-verified against the source,
    # not assumed): price must actually increase base->top for a firing HTF.
    assert geometry["anchors"][1]["price"] > geometry["anchors"][0]["price"]


@pytest.mark.parametrize("name,detection", PEG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_peg_anchor_roles_match_the_detectors_real_anchor_order(name, detection):
    adapted = adapt_power_earnings_gap(detection)
    geometry = adapted["geometry"]
    assert geometry["semantic_subtype"] == "gap_event"
    assert geometry["anchor_roles"] == [
        "prior_close", "gap_open", "gap_close", "post_gap_high", "post_gap_low",
    ]
    assert len(geometry["anchor_roles"]) == len(geometry["anchors"]) == 5
    # gap_open and gap_close (the "gap candle" CandleMark's emphasis outline
    # keys off) share the same timestamp -- re-verified, not assumed.
    gap_open_anchor = geometry["anchors"][1]
    gap_close_anchor = geometry["anchors"][2]
    assert gap_open_anchor["t"] == gap_close_anchor["t"]


@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_anchor_roles_match_the_detectors_real_anchor_order(name, detection):
    """Re-verifies the exact anchor order bull_flag.py::_build_detection
    emits (upper_line.p1, upper_line.p2, lower_line.p1, lower_line.p2) —
    covering ONLY the flag channel, never the pole (a known, disclosed
    completeness gap in the detector itself — see canonical_adapter's own
    module docstring, not something this test papers over)."""
    adapted = adapt_bull_flag(detection)
    geometry = adapted["geometry"]
    assert geometry["semantic_subtype"] == "flag_channel"
    assert geometry["anchor_roles"] == [
        "flag_upper_start", "flag_upper_end", "flag_lower_start", "flag_lower_end",
    ]
    assert len(geometry["anchor_roles"]) == len(geometry["anchors"]) == 4


@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_anchors_do_not_all_land_on_one_point(name, detection):
    """The exact 'anchors collapse onto the final bar' class the owner's
    directive warned against (citing the PEG anchor-timestamp defect):
    proves — against every real firing fixture, not one hand-authored
    synthetic case — that this family's 4 flag-channel anchors do NOT all
    share one x-position. `upper_line`/`lower_line` are each fit from pivots
    spanning the WHOLE flag (trendlines.py::_fit_arithmetic: p1 = ts[0],
    p2 = ts[-1]), so the *_start anchors sit at the first flag bar and the
    *_end anchors at the last — genuinely different positions whenever the
    flag is more than one bar long, which `bull_flag._MIN_FLAG_BARS=3`
    guarantees for every real detection. (See the dedicated test below for
    what unit that x-position is actually IN — it is not what a naive read
    of this test alone would assume.)"""
    geometry = adapt_bull_flag(detection)["geometry"]
    anchors = geometry["anchors"]
    upper_start, upper_end, lower_start, lower_end = anchors
    assert upper_start["t"] < upper_end["t"]
    assert lower_start["t"] < lower_end["t"]
    assert upper_end["t"] == lower_end["t"]
    assert upper_start["t"] == lower_start["t"]


@pytest.mark.parametrize("name,detection", BULL_FLAG_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_bull_flag_flag_channel_anchor_t_is_now_a_real_unix_timestamp(name, detection):
    """⛔⛔ INTEGRATION-REHEARSAL INVERSION of a Package-8H regression pin.

    Package 8H itself discovered (but, per the owner's own gate, did NOT
    fix) a real correctness defect: `bull_flag._try_extract_pattern`'s own
    `upper_pivots`/`lower_pivots` (built inline, not via the shared
    `detect_pivots` primitive HTF/PEG use) set `"t"` to a BAR INDEX rather
    than a real unix-second timestamp, and `_build_detection` copied that
    straight into `geometry.anchors[].t` -- verified against a real fixture
    (`boundary_max_retrace`): anchor `.t` values of `31`/`37` against a real
    `bars[-1].t` of ~1.7e9. Package 8H's own test pinned this as a NAMED,
    visible, NOT-fixed-here fact, with its own docstring saying: "Delete/
    invert this test only when a separately authorized fix lands in
    `bull_flag.py` itself."

    That fix landed: `fix/bull-flag-anchor-timestamps` was independently
    authored (in parallel, from the same base commit as Package 8H) and,
    per this integration branch's own dependency-safe ordering (detector-
    correctness fixes before the canonical adapters that read the same
    family's geometry), is cherry-picked BEFORE this package in this
    branch. Re-verified directly, not assumed: every Bull Flag anchor's `t`
    is now a real bar timestamp, present in the fixture's own `bars[].t`
    set, and the flag channel's END anchors now correctly equal
    `detection["end_t"]` (the last bar, since `flag_bars` always runs to
    the end of the series -- Package 8H's own geometry-order finding, still
    true and unaffected by the timestamp fix)."""
    fixture_bars = next(
        fx.bars for fx in load_all_fixtures("bull_flag", include_internal=False) if fx.name == name
    )
    bar_ts = {int(b["t"]) for b in fixture_bars}
    geometry = adapt_bull_flag(detection)["geometry"]
    anchors = geometry["anchors"]
    upper_start, upper_end, lower_start, lower_end = anchors
    end_t = detection["end_t"]  # a REAL unix-second timestamp (bars[-1]["t"])

    for a in anchors:
        assert int(a["t"]) in bar_ts, (
            f"anchor t={a['t']!r} is not a real bar timestamp in this fixture's "
            "own bars -- the timestamp fix may have regressed"
        )
    # p2 (upper_end/lower_end) is always the LAST flag bar (Package 8H's own
    # geometry-order finding) -- now correctly equal to end_t, not a bar index.
    assert upper_end["t"] == end_t
    assert lower_end["t"] == end_t


@pytest.mark.parametrize("name,detection", EP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_ep_anchor_roles_match_the_detectors_real_anchor_order(name, detection):
    """Re-verifies the exact anchor order episodic_pivot.py::_build_detection
    emits (base_start, base_end, ep_bar). anchors[0]/[1] share the SAME price
    (base_high, a ceiling LEVEL across the whole base segment, not either
    bar's own high) -- re-verified directly, not assumed; anchors[2]'s price
    IS ep_bar's own close exactly."""
    adapted = adapt_episodic_pivot(detection)
    geometry = adapted["geometry"]
    assert geometry["semantic_subtype"] == "gap_breakout_bar"
    assert geometry["anchor_roles"] == ["base_ceiling_start", "base_ceiling_end", "ep_bar"]
    assert len(geometry["anchor_roles"]) == len(geometry["anchors"]) == 3
    assert geometry["anchors"][0]["price"] == geometry["anchors"][1]["price"]
    assert geometry["anchors"][2]["price"] == detection["geometry"]["extras"]["ep_close"]
    # the EP-bar anchor's timestamp must be a real bar timestamp AND, since
    # detect_episodic_pivot only searches the last _MAX_EP_AGE bars, must not
    # be older than the detection's own end_t.
    assert geometry["anchors"][2]["t"] <= detection["end_t"]


def test_anchor_role_labeling_never_mutates_the_original_geometry_dict():
    assert HTF_DETECTIONS
    _, detection = HTF_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapted = adapt_high_tight_flag(detection)
    assert detection == snapshot  # original untouched
    assert "anchor_roles" not in detection["geometry"]  # only the ADAPTED copy gained it
    assert "anchor_roles" in adapted["geometry"]


# ─── VCP: variable-length anchor_roles (the geometry shape-contract package's
#     own canonical-adaptation follow-up) ────────────────────────────────────

@pytest.mark.parametrize("name,detection", VCP_DETECTIONS, ids=lambda x: x if isinstance(x, str) else "")
def test_vcp_anchor_roles_match_the_detectors_real_variable_length_anchor_order(name, detection):
    """Re-verifies vcp.py::_build_detection's real anchor order — [start_high,
    low_0, ..., low_{n-1}, pivot] — for THIS fixture's own real contraction
    count, never assuming a fixed 4. If vcp.py's anchor construction ever
    changes shape, this is what would catch it."""
    adapted = adapt_vcp(detection)
    geometry = adapted["geometry"]
    n_anchors = len(geometry["anchors"])
    n_contractions = geometry["extras"]["n_contractions"]
    assert n_anchors == n_contractions + 2
    assert geometry["semantic_subtype"] == "contraction_sequence"
    assert geometry["anchor_roles"] == (
        ["start_high"] + ["contraction_low"] * n_contractions + ["pivot"]
    )
    assert len(geometry["anchor_roles"]) == n_anchors


def test_vcp_anchor_role_cardinality_genuinely_varies_across_real_fixtures():
    """The whole point of this package: VCP's anchor count is NOT fixed at 4
    like every other trendline_pair family. Prove at least two distinct
    anchor counts actually occur across the real fixture set — a suite that
    happened to sample only 2-contraction VCPs would let a regression to a
    fixed-4 assumption pass silently."""
    counts = {len(adapt_vcp(d)["geometry"]["anchors"]) for _, d in VCP_DETECTIONS}
    assert len(counts) >= 2, f"expected varying anchor counts across fixtures, got only {counts}"
    assert all(c >= 4 for c in counts)


def test_vcp_anchor_roles_are_never_reordered_from_the_detectors_own_construction_order():
    """The adapter must describe anchors by SEMANTIC (construction) order,
    never chronological order — vcp.py's own pivot anchor is chronologically
    EARLIER than the final contraction low that sits one position before it
    in the array (verified directly, not assumed), so a chronologically
    re-sorted role list would silently describe the wrong anchor."""
    assert VCP_DETECTIONS
    _, detection = VCP_DETECTIONS[0]
    adapted = adapt_vcp(detection)
    anchors = adapted["geometry"]["anchors"]
    roles = adapted["geometry"]["anchor_roles"]
    assert roles[0] == "start_high"
    assert roles[-1] == "pivot"
    # The real, on-record defect this geometry package fixed: the pivot
    # (last anchor) is chronologically BEFORE the final contraction low
    # (second-to-last anchor) — the adapter's role list must still describe
    # anchors[-1] as "pivot" by POSITION, not by time.
    assert anchors[-1]["t"] < anchors[-2]["t"]
    assert roles[-2] == "contraction_low"


def test_vcp_adapter_does_not_reconstruct_a_gate_trace_from_reconstructable_extras():
    """Several vcp.py gates ARE numerically reconstructable from
    geometry.extras.contraction_pcts alone (first/final contraction pct, the
    0.85 tightening ratio) — this test pins that adapt_vcp deliberately does
    NOT build a partial gate_trace from them, per its own docstring: a
    gate_trace naming only the reconstructable subset while several other
    real gates (prior-advance %, the volume-segment ratio, the Trend-Template
    precondition) cannot be reconstructed would look like a complete receipt
    while silently omitting real gates."""
    assert VCP_DETECTIONS
    _, detection = VCP_DETECTIONS[0]
    extras = detection["geometry"]["extras"]
    assert extras.get("contraction_pcts"), "fixture must carry reconstructable extras for this test to mean anything"
    adapted = adapt_vcp(detection)
    assert "gate_trace" not in adapted


def test_labeled_geometry_falls_back_cleanly_on_a_cardinality_mismatch():
    """If a future detector change ever desyncs anchor count from the role
    list, the adapter must skip labeling rather than emit a lying role
    array (Phase-7 spec §32's geometry-integrity requirement, exercised
    directly)."""
    from api.services.pattern_engine.canonical_adapter import _with_labeled_geometry
    fake_detection = {"geometry": {"shape": "trendline_pair", "anchors": [{"t": 1, "price": 1.0}], "extras": {}}}
    out = _with_labeled_geometry(fake_detection, ["a", "b", "c", "d"], "pole_and_flag")
    assert "anchor_roles" not in out
    assert "semantic_subtype" not in out
    assert out["anchors"] == fake_detection["geometry"]["anchors"]  # untouched
