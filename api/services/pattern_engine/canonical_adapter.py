"""Phase 8, Packages 8A/8B/8C — canonical Detection adapter (SHADOW MODE ONLY
for ORDINARY users; see the 2026-09-06 correction below for the admin/pilot
exception that now exists).

Package 8C addition: `build_scanner_summary()` (below), the canonical
scanner-facing projection. Package 8C traced the REAL scanner data path
(`api/services/screener/pattern_join.py::read_pattern_fields`, still the
ONLY reader `snapshot_builder.py`'s universe-wide `screener_rows` snapshot
uses, unconditionally, for every user) directly and found it runs a raw SQL
projection of exactly 5 existing `pattern_detections` columns
(sym/pattern_id/direction/confidence/levels_json) — it does not even read the
4 OTHER existing JSON columns (geometry/context/quality/narrative), let alone
anything from a section this schema has no column for. That legacy path
still never reaches this module, by design (D6's confidence-scale doctrine
in `pattern_join.py`'s own module docstring). See
`docs/uct-scanner-intelligence/phase7_canonical_architecture_spec.md` for the
persistence-schema finding that produced.

⚰️ **THIS SAID `build_scanner_summary` "is not wired into `pattern_join.py`
… or any live request path."** That was true when written and is false now:
Package 8F added `pattern_join.read_pattern_fields_canonical_shadow`'s
widened SELECT (geometry/quality/narrative/eligibility_json, all real
columns) specifically to feed this function, and Package 8G-B wired the
result into a REAL, LIVE request path —
`apply_canonical_pilot_overlay` (`pattern_join.py`), called from
`api/services/screener/query.py:1303` inside `/api/screener/scan` itself.
It is narrowly gated (`PATTERN_CANONICAL_SCANNER_PILOT_ENABLED=1` + admin +
PEG-only legacy match — OFF/unset in production as of this writing) and
additive-only (never mutates an existing served key), so ordinary users are
still structurally unaffected by construction — but "not wired into any live
request path" is no longer an accurate description of this module. Verified
2026-09-06 by a narrow source-grounded review for the `pattern_join.py`
canonical persistence/serving gap (Package 8G-B's follow-on parallel work);
no code gap survived that review — both readers Package 8F/8G-A/8G-B built
(this shadow path + `detail_response.build_canonical_detail`, admin-only)
already reconstruct every Package-8C-persisted field. This paragraph is the
correction; do not re-derive the "not wired in" claim from the paragraph
above it.

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

Package 8F added a third family at HTF's own minimal end of the spectrum,
per a disciplined family-by-family selection pass (owner directive,
2026-09-06) that ranked all remaining candidates and picked the single
highest-readiness one — not the next alphabetically or most convenient:

  - `bullish_engulfing` — a 2-bar candlestick reversal with the CLEANEST
    geometry of any remaining candidate (both anchors are real semantic
    points — the engulfed bar's close and the engulfing bar's close — unlike
    e.g. `bull_flag`, whose own anchors never include the pole, a separate,
    still-open gap this package does not touch). No event concept (a
    candlestick has no addressable calendar event) and no per-family
    freshness gate — `event`/`criteria`/`gate_trace` are correctly,
    deliberately ABSENT, an exact mirror of HTF's own adapter shape.

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
from api.services.pattern_engine.types import (
    Detection, Eligibility, EventProvenance, GateEvaluation, ScannerSummary,
)

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


# Phase 8 Package 8D. `high_tight_flag._build_detection` (verified by direct
# read, not recon) emits exactly 4 anchors in this order — pole_base,
# pole_top, flag_low, flag_high — a REAL pole segment (anchors[0]->[1]) and a
# real flag-range diagonal (anchors[2]->[3]), not a placeholder. The Phase-7
# spec's "the pole is never anchored" finding was about a DIFFERENT family
# (bull_flag) — re-verified here rather than assumed, since this labeling
# would be silently wrong if it weren't true for HTF specifically.
_HTF_ANCHOR_ROLES = ["pole_base", "pole_top", "flag_low", "flag_high"]
_HTF_SEMANTIC_SUBTYPE = "pole_and_flag"

# power_earnings_gap._build_detection emits 5 anchors: prior_close, gap_open,
# gap_close, post_gap_high, post_gap_low (verified by direct read). gap_open
# and gap_close share the same bar timestamp -- together they ARE the gap
# candle's open/close, which is what CandleMark's new candle-emphasis outline
# (Package 8D) keys off.
_PEG_ANCHOR_ROLES = ["prior_close", "gap_open", "gap_close", "post_gap_high", "post_gap_low"]
_PEG_SEMANTIC_SUBTYPE = "gap_event"

# Phase 8 Package 8F. `bullish_engulfing._build_detection` (verified by direct
# read) emits exactly 2 anchors -- the prior (engulfed) bar's close and the
# engulfing bar's close, in that order. Both are real, already-honest
# semantic points (unlike bull_flag, whose own anchors never include the
# pole -- a separate, still-open geometry gap this package does not touch).
_BE_ANCHOR_ROLES = ["prior_bar_close", "engulfing_bar_close"]
_BE_SEMANTIC_SUBTYPE = "engulfing_pair"


def _with_labeled_geometry(detection: Detection, roles: list, subtype: str) -> dict:
    """Returns a NEW geometry dict (never mutates detection["geometry"] in
    place -- that dict is shared by reference after `dict(detection)`'s
    shallow copy, so an in-place write here would silently violate the
    adapter's own non-mutation guarantee, Package 8B's own tested contract)."""
    geometry = dict(detection["geometry"])
    if len(roles) == len(geometry.get("anchors", [])):
        geometry["anchor_roles"] = roles
        geometry["semantic_subtype"] = subtype
    return geometry


# Phase 8 Package 8G. `bearish_engulfing._build_detection` (verified by direct
# read) emits exactly 2 anchors -- the prior (engulfed) bar's close and the
# engulfing bar's close, in that order -- the SAME shape and order as
# `bullish_engulfing` (Package 8F). Confirmed by an owner-required semantic
# diff BEFORE this adapter was written (not assumed from the family's name):
# anchor count/order/shape, geometry shape, levels/quality/confidence
# structure, and the reversal-context gate concept are all a faithful mirror.
# The ONLY genuine differences are (a) 3 of the 12 `geometry.extras` keys are
# DIRECTIONALLY RENAMED, not merely re-signed -- `at_swing_high`/
# `above_50sma`/`recent_advance_pct` here vs `at_swing_low`/`below_50sma`/
# `recent_decline_pct` on the bullish side -- and (b) the DCR confirmation
# direction is INVERTED: a LOW `curr_bar_dcr` (close near the bar's own low)
# is this family's bullish-for-the-short-thesis signal, the opposite of
# bullish_engulfing's high-DCR signal. `dcr_strength()` itself is
# direction-unaware (a "weak" label just means DCR<=0.30, verified against
# its own docstring) -- reusing bullish_engulfing's "strong DCR = good"
# framing here would misdescribe the pattern.
_BEARISH_ENGULFING_ANCHOR_ROLES = ["prior_bar_close", "engulfing_bar_close"]
_BEARISH_ENGULFING_SEMANTIC_SUBTYPE = "engulfing_pair"


def adapt_high_tight_flag(detection: Detection, *, now: Optional[int] = None) -> Detection:
    """High Tight Flag: eligibility + (Package 8D) semantic geometry labels.
    `event`/`criteria`/`gate_trace` are deliberately absent — this family has
    no event concept, and its own file (see the STOP comment at the top of
    high_tight_flag.py) explicitly names `base_catalog.py` as the criteria/
    provenance-carrying engine for this pattern name, not itself.
    """
    out: Detection = dict(detection)  # type: ignore[assignment]
    out["eligibility"] = compute_default_eligibility(detection, now=now)
    out["geometry"] = _with_labeled_geometry(detection, _HTF_ANCHOR_ROLES, _HTF_SEMANTIC_SUBTYPE)
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
    out["geometry"] = _with_labeled_geometry(detection, _PEG_ANCHOR_ROLES, _PEG_SEMANTIC_SUBTYPE)

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


def adapt_bullish_engulfing(detection: Detection, *, now: Optional[int] = None) -> Detection:
    """Bullish Engulfing: eligibility + semantic geometry labels only --
    exactly HTF's shape (Package 8D precedent), for the same reason: this
    family has no event concept (a 2-bar candlestick reversal has no
    addressable calendar event) and no per-family freshness gate in-file
    (relies on the shared active-window check only). `event`/`criteria`/
    `gate_trace` are deliberately, honestly ABSENT.
    """
    out: Detection = dict(detection)  # type: ignore[assignment]
    out["eligibility"] = compute_default_eligibility(detection, now=now)
    out["geometry"] = _with_labeled_geometry(detection, _BE_ANCHOR_ROLES, _BE_SEMANTIC_SUBTYPE)
    return out


def adapt_bearish_engulfing(detection: Detection, *, now: Optional[int] = None) -> Detection:
    """Bearish Engulfing: eligibility + semantic geometry labels only --
    the same minimal shape as `adapt_bullish_engulfing` (Package 8F), because
    the two families are a verified faithful mirror on every dimension this
    adapter touches (see the module-level note above the anchor-role
    constants). No event concept (a 2-bar candlestick reversal has no
    addressable calendar event) and no per-family freshness gate in-file --
    `event`/`criteria`/`gate_trace` are deliberately, honestly ABSENT.
    """
    out: Detection = dict(detection)  # type: ignore[assignment]
    out["eligibility"] = compute_default_eligibility(detection, now=now)
    out["geometry"] = _with_labeled_geometry(
        detection, _BEARISH_ENGULFING_ANCHOR_ROLES, _BEARISH_ENGULFING_SEMANTIC_SUBTYPE
    )
    return out


def build_scanner_summary(detection: Detection) -> ScannerSummary:
    """Phase 8 Package 8C — the canonical scanner-facing projection (Phase-7
    spec §16 / this authorization's §6). Operates on an already-adapted
    Detection (post `adapt_high_tight_flag`/`adapt_power_earnings_gap`) and
    ONLY ever reads real fields off it — never fabricates a confidence,
    quality, or eligibility value the Detection doesn't actually carry.

    ⚰️ **This said "NOT WIRED INTO THE REAL SCANNER … `pattern_join.py`'s
    live SQL never reaches this function."** That was true at Package 8C;
    it is false as of Package 8G-B (2026-09-05), which wired
    `pattern_join.read_pattern_fields_canonical_shadow` → this function into
    `apply_canonical_pilot_overlay`, called from the real, live
    `query.py:1303` inside `/api/screener/scan`. Still never reaches the
    UNCONDITIONAL, universe-wide `read_pattern_fields`/`screener_rows` path
    every ordinary user's scan is built from — the overlay is admin+PEG-pilot
    gated and additive-only. Corrected 2026-09-06 (`pattern_join.py`
    canonical persistence/serving gap review); the sentence above is history,
    not current fact.

    Preserves the identity-vs-eligibility separation (§7): `status` (a
    Detection's own lifecycle field) and `scanner_eligible` (this
    detection's Eligibility.eligible, if computed) are reported as two
    distinct fields, never collapsed into one.
    """
    eligibility = detection.get("eligibility")
    event = detection.get("event")

    warnings: list[str] = []
    if eligibility is not None and not eligibility.get("eligible", True):
        warnings.extend(
            r for r in eligibility.get("eligibility_reasons", [])
            if "outside" in r or "exceeded" in r
        )
    if "gate_trace" not in detection:
        warnings.append("no gate-evaluation trace available for this family")
    if event is None:
        warnings.append("no event provenance for this family")

    freshness_note = "no family-specific freshness gate (shared active window only)"
    if eligibility is not None and eligibility.get("freshness_bars") is not None:
        freshness_note = (
            f"{eligibility['freshness_bars']}/{eligibility['freshness_window_bars']} bars"
        )

    out: ScannerSummary = {
        "pattern_id": detection["pattern_id"],
        "pattern_name": detection["pattern_name"],
        "direction": detection["direction"],
        "status": detection["status"],
        "scanner_eligible": eligibility.get("eligible") if eligibility is not None else None,
        "confidence": detection["confidence"],
        "quality_components": detection["quality_components"],
        "primary_reason": detection["narrative"]["headline"],
        "freshness_note": freshness_note,
        "warnings": warnings,
    }
    if event is not None:
        out["event_note"] = f"{event.get('event_type', 'event')} linkage: {event['verification_status']}"
    return out


def reconstruct_persisted_evidence(pattern_id: str, geometry_extras: dict) -> dict:
    """Phase 8 Package 8F (ChatGPT relay review, 2026-09-04): reconstructs
    the Phase-8 `event`/`gate_trace` sections from fields the DETECTOR
    ITSELF already writes into `geometry.extras` -- real for every
    persisted `power_earnings_gap` row ever written, adapted or not
    (Package 8C's own finding: these are detector-level fields, not
    adapter-added ones, so this reconstruction needs no new schema column
    and no new detector logic). This is the SAME reconstruction
    `pattern_join.read_pattern_fields_canonical_shadow` first established
    for `event` alone (Package 8C); this generalizes it to also cover
    `gate_trace` via this module's own `_peg_gate_trace`, and gives both
    readers ONE shared implementation instead of two that could drift.

    Returns `{}` for any family with no such reconstruction (HTF's own
    adapter never manufactures `gate_trace`/`event` -- see this module's
    docstring) or when a required extras key is genuinely absent (e.g. a
    row written before some field existed).
    """
    if pattern_id != _peg._PATTERN_ID:
        return {}

    out: dict = {}
    days = geometry_extras.get("days_to_earnings")
    verified = geometry_extras.get("earnings_linkage_verified")
    if days is not None or "earnings_linkage_verified" in geometry_extras:
        out["event"] = {
            "event_id": None,
            "event_type": "earnings",
            "event_timestamp": None,
            "ingested_at": None,
            "days_from_event": days,
            "verification_status": (
                "unavailable" if days is None
                else "verified" if verified
                else "contradicted"
            ),
            "source": "context.days_to_earnings_hint",
        }

    required_keys = (
        "gap_pct", "gap_volume_ratio", "post_gap_bars", "gap_open",
        "post_gap_low", "post_gap_range_pct", "gap_range_pct",
    )
    if all(k in geometry_extras for k in required_keys):
        out["gate_trace"] = _peg_gate_trace(geometry_extras)

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
