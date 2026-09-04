"""Phase 8, Package 8F — canonical internal response contract tests.

Exercises the REAL SQLite write/read path end-to-end (detector fixture ->
[optional canonical_adapter] -> memory.store_detection -> real DB row ->
detail_response.build_canonical_detail), never an in-memory shortcut — the
whole point of this module (ChatGPT relay review, 2026-09-04) is that the
proof crosses persistence. Isolation comes from the repo-root conftest.py's
env redirect, the same mechanism every other pattern_engine DB test relies
on (see test_canonical_persistence.py).

Two write scenarios are exercised deliberately, because they behave
differently:

  - RAW (never adapted) rows, which is what `_scan_patterns_daily` writes
    TODAY (Package 8F's own finding: no adapter call exists in that loop
    without the new flag) — these have no `eligibility_json`, but PEG's
    `event`/`gate_trace` are STILL reconstructable, because the extras they
    need are detector-level fields, not adapter-added ones.
  - ADAPTED rows (what the new flag-gated write path produces) — these
    additionally carry real `eligibility_json`.
"""
import pytest

from api.services.pattern_engine import memory
from api.services.pattern_engine.canonical_adapter import (
    adapt_high_tight_flag,
    adapt_power_earnings_gap,
)
from api.services.pattern_engine.detail_response import (
    DETAIL_CONTRACT_VERSION,
    build_canonical_detail,
)
from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.pattern_db import init_db
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _one_firing_detection(family, detect_fn, sym, tf="D"):
    for fx in load_all_fixtures(family, include_internal=False):
        if not fx.expected_fires:
            continue
        ctx = fx.context if fx.context is not None else build_context(fx.bars, sym="TEST")
        detections = detect_fn(fx.bars, ctx)
        if detections:
            d = dict(max(detections, key=lambda x: x["confidence"]))
            d["sym"], d["tf"] = sym, tf
            return d
    raise AssertionError(f"no firing {family} fixture found")


def _sections(detail: dict) -> dict:
    return {s["section"]: s["facts"] for s in detail["explanation"]["sections"]}


@pytest.fixture(autouse=True)
def _init():
    init_db()


def test_returns_none_for_unknown_detection_id():
    assert build_canonical_detail("does-not-exist") is None


def test_htf_adapted_row_reads_back_from_db_with_semantic_geometry():
    d = _one_firing_detection("high_tight_flag", detect_high_tight_flag, "TESTHTF1")
    d = adapt_high_tight_flag(d)
    memory.store_detection(d)

    detail = build_canonical_detail(d["id"])
    assert detail is not None
    assert detail["detection_id"] == d["id"]
    assert detail["sym"] == "TESTHTF1"
    assert detail["pattern_id"] == "high_tight_flag"
    assert detail["contract_version"] == DETAIL_CONTRACT_VERSION
    assert detail["source"] == "canonical_db_read"

    # Semantic geometry labels survive the round trip because the adapter
    # ran BEFORE store_detection — this is the write-time-only piece.
    assert detail["geometry"]["anchor_roles"] == [
        "pole_base", "pole_top", "flag_low", "flag_high",
    ]
    # eligibility was computed pre-store, so it round-trips too.
    assert detail["eligibility"] is not None
    assert detail["eligibility"]["eligible"] is True

    facts = _sections(detail)
    assert "why_it_matched" in facts
    assert any(f["fact_id"] == "htf_pole_advance" for f in facts["why_it_matched"])
    assert "event" not in facts  # HTF has no event concept — must stay absent


def test_peg_raw_row_still_reconstructs_event_and_gate_trace_at_read_time():
    """The load-bearing finding this package's own investigation produced:
    gate_trace/event are reconstructable from detector-level extras alone,
    regardless of whether the write-time adapter ever ran. This is what
    `_scan_patterns_daily` writes TODAY (no flag flipped)."""
    d = _one_firing_detection("power_earnings_gap", detect_power_earnings_gap, "TESTPEG1")
    assert "eligibility" not in d and "event" not in d and "gate_trace" not in d
    memory.store_detection(d)

    detail = build_canonical_detail(d["id"])
    assert detail is not None
    assert detail["pattern_id"] == "power_earnings_gap"
    # Never adapted pre-store -> genuinely absent, not fabricated.
    assert detail["eligibility"] is None
    # But event/gate_trace ARE reconstructed from the persisted extras.
    assert detail["event"] is not None
    assert detail["event"]["event_type"] == "earnings"
    assert detail["gate_trace_available"] is True

    facts = _sections(detail)
    assert "why_it_matched" in facts
    assert len(facts["why_it_matched"]) == 5  # the 5 real PEG gates
    assert "event" in facts
    # No eligibility was ever computed for this row -> qualified, not a
    # fabricated eligible=True/False.
    elig_facts = facts["scanner_eligibility"]
    assert elig_facts[0]["fact_id"] == "eligibility_unavailable"
    assert elig_facts[0]["claim_type"] == "qualified"


def test_peg_adapted_row_carries_real_eligibility_alongside_reconstructed_event():
    d = _one_firing_detection("power_earnings_gap", detect_power_earnings_gap, "TESTPEG2")
    d = adapt_power_earnings_gap(d)
    memory.store_detection(d)

    detail = build_canonical_detail(d["id"])
    assert detail["eligibility"] is not None
    assert detail["event"] is not None
    facts = _sections(detail)
    verdict = next(f for f in facts["scanner_eligibility"] if f["fact_id"] == "eligibility_verdict")
    assert verdict["claim_type"] == "direct"


def test_out_of_scope_family_returns_base_fields_with_empty_explanation():
    d = _one_firing_detection("bull_flag", detect_bull_flag, "TESTBF1")
    memory.store_detection(d)

    detail = build_canonical_detail(d["id"])
    assert detail is not None
    assert detail["pattern_id"] == "bull_flag"
    assert detail["explanation"]["sections"] == []
    assert detail["event"] is None
    assert detail["eligibility"] is None


def test_response_is_deterministic_across_repeated_reads():
    d = _one_firing_detection("high_tight_flag", detect_high_tight_flag, "TESTHTF2")
    d = adapt_high_tight_flag(d)
    memory.store_detection(d)

    first = build_canonical_detail(d["id"])
    second = build_canonical_detail(d["id"])
    assert first == second


def test_never_mutates_the_object_returned_by_memory_get_detection_by_id():
    d = _one_firing_detection("power_earnings_gap", detect_power_earnings_gap, "TESTPEG3")
    memory.store_detection(d)

    raw_before = memory.get_detection_by_id(d["id"])
    build_canonical_detail(d["id"])
    raw_after = memory.get_detection_by_id(d["id"])
    assert "event" not in raw_after  # reconstruction must not leak into storage
    assert raw_before == raw_after
