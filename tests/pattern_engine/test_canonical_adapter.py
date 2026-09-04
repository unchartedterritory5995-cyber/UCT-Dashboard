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
    build_scanner_summary,
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


def test_anchor_role_labeling_never_mutates_the_original_geometry_dict():
    assert HTF_DETECTIONS
    _, detection = HTF_DETECTIONS[0]
    import copy
    snapshot = copy.deepcopy(detection)
    adapted = adapt_high_tight_flag(detection)
    assert detection == snapshot  # original untouched
    assert "anchor_roles" not in detection["geometry"]  # only the ADAPTED copy gained it
    assert "anchor_roles" in adapted["geometry"]


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
