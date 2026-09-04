"""Phase 8, Packages 8A/8B — canonical Detection adapter (SHADOW MODE ONLY).

Converts an already-emitted `Detection` (unchanged) into the same object plus
the Phase-7 additive canonical sections (`eligibility`, `event`, `criteria`,
`gate_trace` — see types.py). This module is NOT wired into any production
code path: no detector calls it, `memory.store_detection` does not call it,
and no scheduled job calls it. It exists to prove the canonical extension is
correct against real detector output before anything becomes authoritative
(Phase-7 spec, migration Stage A/B).

⛔ NOT YET PERSISTED. `pattern_db.py`'s `pattern_detections` table has 5
dedicated JSON columns (quality/geometry/levels/context/narrative) — there is
no column for `eligibility`/`event`/`criteria`/`gate_trace`. Populating them
here does not make them survive a round-trip through storage; that is real
schema work for a later, explicitly-authorized stage, not implied by this
module's existence.

Adapters here are read-only with respect to their input: each returns a NEW
dict (`dict(detection)`, a shallow copy) with new top-level keys added.
Every existing key/value is left untouched — this is the parity guarantee
Package 8B's tests check.

Two representative families were adapted first (per Phase-7 §33's own
recommendation and this authorization's "materially different architecture"
requirement):

  - `high_tight_flag` — a geometry-rich structure family whose own file
    explicitly, deliberately defers criteria/provenance to
    `base_catalog.py`'s parallel Structure engine (see that file's own
    header STOP comment) and has no per-family freshness gate. Its adapter
    therefore emits ONLY `eligibility` — `event`/`criteria`/`gate_trace` are
    correctly, deliberately ABSENT. This exercises the "a family should not
    look broken because a section legitimately does not apply" requirement
    (Phase-7 §17) at its most minimal end.

  - `power_earnings_gap` — a gap/event family that already has real,
    partial event-provenance data (Phase 6 Group 3's `days_to_earnings`/
    `earnings_linkage_verified`, currently living in `geometry.extras`) and a
    set of NAMED gates whose thresholds are public module constants. Its
    adapter populates `eligibility`, `event`, AND a reconstructed
    `gate_trace` — exercising the fully-populated end of the same spectrum.

KNOWN, DISCLOSED LIMITATION: because this adapter runs AFTER a Detection
already exists (post-hoc, on the single surviving candidate a detector ever
returns), it can only reconstruct gate evaluations for gates that candidate
PASSED — it has no visibility into candidates a detector rejected before a
Detection object was ever built (those leave no trace anywhere in the current
detectors' own output, per Phase-7 §8/§26). `gate_trace` here is therefore a
"why did this survive" record, not a "what was tried" record. Extending
`gate_trace` to include the near-miss candidates a detector considered would
require instrumenting the detector itself — explicitly out of scope
("Phase 8 does not authorize... broad refactoring", "do not tune detectors").
"""
from __future__ import annotations

import time
from typing import Optional

from api.services.pattern_engine import memory as _memory
from api.services.pattern_engine.detectors.uct import power_earnings_gap as _peg
from api.services.pattern_engine.types import Detection, Eligibility, EventProvenance, GateEvaluation

ADAPTER_VERSION = "phase8.8b.1"


def compute_default_eligibility(
    detection: Detection,
    *,
    now: Optional[int] = None,
    freshness_bars: Optional[int] = None,
    freshness_window_bars: Optional[int] = None,
) -> Eligibility:
    """The one real, shared, engine-level eligibility gate every family
    already gets today (`memory.get_active_detections`'s `ACTIVE_WINDOW_SECS`
    filter) — reconstructed here as inspectable data instead of something a
    caller must re-derive from `detected_at` by hand each time.

    `freshness_bars`/`freshness_window_bars` are family-specific and must be
    supplied by the caller when a family has its own per-detector age gate
    (e.g. episodic_pivot's `_MAX_EP_AGE`, vcp's `_MAX_FINAL_LOW_AGE`) — left
    `None` for a family with no such gate, which is an honestly-reported
    state (4 of the 7 audited families have none), not a missing value.
    Neither family adapted in this package has one — see module docstring.
    """
    now = now if now is not None else int(time.time())
    active_window_secs = _memory.ACTIVE_WINDOW_SECS

    within_window = (now - detection["detected_at"]) <= active_window_secs
    status_ok = detection["status"] not in ("completed", "failed", "expired")

    reasons = [
        "within active window" if within_window else "outside active window",
        f"status={detection['status']}",
    ]

    fresh_ok = True
    if freshness_bars is not None and freshness_window_bars is not None:
        fresh_ok = freshness_bars <= freshness_window_bars
        reasons.append(
            f"freshness {freshness_bars}/{freshness_window_bars} bars "
            f"({'within' if fresh_ok else 'exceeded'} family window)"
        )

    return {
        "eligible": within_window and status_ok and fresh_ok,
        "evaluated_at": now,
        "eligibility_scope": "system_default",
        "eligibility_version": ADAPTER_VERSION,
        "eligibility_reasons": reasons,
        "freshness_bars": freshness_bars,
        "freshness_window_bars": freshness_window_bars,
        "active_window_secs": active_window_secs,
    }


def adapt_high_tight_flag(detection: Detection, *, now: Optional[int] = None) -> Detection:
    """High Tight Flag: eligibility only. `event`/`criteria`/`gate_trace` are
    deliberately absent — this family has no event concept, and its own file
    (see the STOP comment at the top of high_tight_flag.py) explicitly names
    `base_catalog.py` as the criteria/provenance-carrying engine for this
    pattern name, not itself.
    """
    out: Detection = dict(detection)  # type: ignore[assignment]
    out["eligibility"] = compute_default_eligibility(detection, now=now)
    return out


def adapt_power_earnings_gap(detection: Detection, *, now: Optional[int] = None) -> Detection:
    """Power Earnings Gap: eligibility + event provenance + a reconstructed
    gate trace for the 4 named, sourced gates in `power_earnings_gap.py`'s
    own `_try_extract` that this surviving candidate cleared. Thresholds are
    imported from the detector module itself (never restated as duplicate
    literals — the exact drift class Phase-7 §13 flags), so if the detector's
    own constant ever changes, this adapter's gate_trace changes with it.
    """
    out: Detection = dict(detection)  # type: ignore[assignment]
    out["eligibility"] = compute_default_eligibility(detection, now=now)

    extras = detection["geometry"]["extras"]
    days = extras.get("days_to_earnings")
    verified = extras.get("earnings_linkage_verified")
    event: EventProvenance = {
        "event_id": None,          # PEG's extras carry no addressable calendar-row
                                    # id today — honestly left absent, not guessed
        "event_type": "earnings",
        "event_timestamp": None,   # extras carry days_from_event, not the report's
                                    # own timestamp — same reasoning
        "ingested_at": None,
        "days_from_event": days,
        "verification_status": (
            "unavailable" if days is None
            else "verified" if verified
            else "contradicted"
        ),
        "source": "context.days_to_earnings_hint",
    }
    out["event"] = event
    out["gate_trace"] = _peg_gate_trace(extras)
    return out


def _peg_gate_trace(extras: dict) -> list[GateEvaluation]:
    gap_pct = extras["gap_pct"] / 100.0  # extras stores this *100 for narrative display
    volume_ratio = extras["gap_volume_ratio"]
    post_gap_bars = extras["post_gap_bars"]
    gap_open = extras["gap_open"]
    post_gap_low = extras["post_gap_low"]
    # avg_post_gap_range / gap_range == post_gap_range_pct / gap_range_pct exactly,
    # since both extras fields are normalized by the same gap_close divisor.
    tightness_ratio = (
        extras["post_gap_range_pct"] / extras["gap_range_pct"]
        if extras["gap_range_pct"] else None
    )
    holding_ratio = post_gap_low / gap_open if gap_open else None

    def _gate(criterion_id, name, observed, expected, operator, unit, role, passed):
        return {
            "criterion_id": criterion_id,
            "criterion_name": name,
            "observed_value": observed,
            "expected_value": expected,
            "operator": operator,
            "unit": unit,
            "role": role,
            "required": True,
            "result": "pass" if passed else "fail",
            "criterion_ref": None,
            "definition_version": None,
        }

    return [
        _gate(
            "peg_gap_pct_floor", "gap percentage vs. floor",
            round(gap_pct, 4), _peg._MIN_GAP_PCT, ">=", "fraction", "identity",
            gap_pct >= _peg._MIN_GAP_PCT,
        ),
        _gate(
            "peg_volume_ratio_floor", "gap-bar volume vs. 20-bar average",
            round(volume_ratio, 3), _peg._MIN_VOLUME_RATIO, ">=", "ratio", "identity",
            volume_ratio >= _peg._MIN_VOLUME_RATIO,
        ),
        _gate(
            "peg_gap_holding", "post-gap low held above gap-fill threshold",
            round(holding_ratio, 4) if holding_ratio is not None else None,
            _peg._GAP_FILL_THRESHOLD, ">", "fraction_of_gap_open", "identity",
            holding_ratio is not None and holding_ratio > _peg._GAP_FILL_THRESHOLD,
        ),
        _gate(
            "peg_post_gap_tightness", "post-gap average range vs. gap-bar range",
            round(tightness_ratio, 4) if tightness_ratio is not None else None,
            _peg._MAX_POST_GAP_TIGHTNESS, "<", "ratio", "quality",
            tightness_ratio is not None and tightness_ratio < _peg._MAX_POST_GAP_TIGHTNESS,
        ),
        _gate(
            "peg_post_gap_bar_count", "post-gap bar count within detection window",
            post_gap_bars, [_peg._MIN_POST_GAP_BARS, _peg._MAX_POST_GAP_BARS],
            "within_range", "bars", "eligibility",
            _peg._MIN_POST_GAP_BARS <= post_gap_bars <= _peg._MAX_POST_GAP_BARS,
        ),
    ]
