"""Phase 8, Package 8F — canonical internal response contract (admin-only,
shadow proof; not reachable by ordinary users).

Combines a REAL, DB-READ-BACK canonical Detection's geometry and structured
explanation into one response, proving the persistence boundary is actually
crossed (ChatGPT relay review, 2026-09-04): "the admin proof response should
originate from the canonical DB/read path after the row has been written,
not from the original in-memory Detection retained from detect_all()."
This module reads ONLY from `patterns.db` via `memory.get_detection_by_id` —
it never accepts or renders an in-memory Detection object handed to it by a
caller, so it cannot accidentally prove detector → renderer while skipping
detector → persistence → scanner/read → renderer.

ONE canonical read object feeds BOTH projections, per the relay's own
required invariant:

    persisted detection -> canonical read object -> geometry projection
                                                   -> explanation projection

`event`/`gate_trace` are reconstructed from the read-back `geometry.extras`
via `canonical_adapter.reconstruct_persisted_evidence` — the SAME shared
helper `pattern_join.read_pattern_fields_canonical_shadow` uses, so there is
one implementation of that reconstruction, not two that could drift.
`eligibility` is included only when the row actually carries it (written
only when the live writer's canonical-adapt step ran on that row) — never
fabricated.

Never re-derives geometry, never recomputes detector conditions, never
invents eligibility or confidence — this module composes already-persisted,
already-tested pieces; it is a serializer, not a second detector.
"""
from __future__ import annotations

from typing import Optional

from api.services.pattern_engine import memory
from api.services.pattern_engine.canonical_adapter import reconstruct_persisted_evidence
from api.services.pattern_engine.explanation_builder import build_explanation

DETAIL_CONTRACT_VERSION = "phase8.8f.1"


def build_canonical_detail(detection_id: str) -> Optional[dict]:
    """Read one Detection back from patterns.db (never an in-memory object)
    and build the combined geometry + structured-explanation response.

    Returns None if `detection_id` doesn't exist in patterns.db — the
    caller (the admin router) turns that into a 404, never a fabricated
    empty payload.
    """
    detection = memory.get_detection_by_id(detection_id)
    if detection is None:
        return None

    extras = detection.get("geometry", {}).get("extras", {})
    reconstructed = reconstruct_persisted_evidence(detection["pattern_id"], extras)
    # A NEW dict — never mutates the object memory.py just handed back, the
    # same non-mutation discipline canonical_adapter.py's own adapters use.
    enriched = {**detection, **reconstructed}

    explanation = build_explanation(enriched)

    return {
        "detection_id": enriched["id"],
        "sym": enriched["sym"],
        "tf": enriched["tf"],
        "pattern_id": enriched["pattern_id"],
        "pattern_name": enriched["pattern_name"],
        "direction": enriched["direction"],
        "status": enriched["status"],
        "confidence": enriched["confidence"],
        "detected_at": enriched["detected_at"],
        "last_seen_at": enriched["last_seen_at"],
        "geometry": enriched["geometry"],
        "levels": enriched["levels"],
        "context": enriched["context"],
        "quality_components": enriched["quality_components"],
        # NotRequired sections: present only when actually available on this
        # persisted row — never coerced to a default/fabricated value.
        "eligibility": enriched.get("eligibility"),
        "event": enriched.get("event"),
        "gate_trace_available": "gate_trace" in enriched,
        "explanation": explanation,
        "source": "canonical_db_read",
        "contract_version": DETAIL_CONTRACT_VERSION,
    }
