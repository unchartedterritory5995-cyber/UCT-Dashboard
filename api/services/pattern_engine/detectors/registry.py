"""Detector registry.

Detectors register themselves with `register("pattern_id", fn)`. The engine
entrypoint (`detect_all`) iterates the registry; consumers can scope a single
detector via `detect_one`.
"""
from __future__ import annotations

from typing import Callable, Dict


DetectorFn = Callable[[list, dict], list[dict]]


_REGISTRY: Dict[str, DetectorFn] = {}


def register(pattern_id: str, fn: DetectorFn) -> None:
    """Add a detector to the registry. Overwrites if already present."""
    _REGISTRY[pattern_id] = fn


def get_detector(pattern_id: str) -> DetectorFn:
    """Return the detector function for `pattern_id`. Raises KeyError if missing."""
    if pattern_id not in _REGISTRY:
        raise KeyError(f"no detector registered for pattern_id={pattern_id!r}")
    return _REGISTRY[pattern_id]


def list_pattern_ids() -> list[str]:
    """Return all registered pattern_ids, sorted."""
    return sorted(_REGISTRY.keys())


# ---------------------------------------------------------------------------
# INTERNAL / ADMIN-ONLY detectors
# ---------------------------------------------------------------------------
#: Detectors whose output is computed and stored like any other (admins read
#: it) but must NEVER reach a member. Hardcoded on purpose: a flag that could
#: be flipped by an env var is a door; this is the capability itself. Every
#: member-facing read path filters these ids out (pattern_join, the raw
#: /api/patterns/{sym} branch for non-admins, memory.get_active_detections by
#: default, the voice and Compass pattern tools, the pattern backtest). An
#: internal id must also stay out of the member catalog (`_PATTERN_METADATA`).
#:
#: The first four trader-setup detectors (uct_kicker,
#: uct_oops_reversal, uct_slingshot, uct_hve) shipped here first; the owner
#: ruled them PUBLIC on 2026-10-15 (visible to every member and every tool).
#: The set and its call sites stay as the kill switch for any future internal
#: detector: add an id here and every member path drops it, no other edit.
#: Rail: tests/test_uct_internal_detectors_gate.py proves the gate with a
#: synthetic id, and that the four are visible on each member path.
INTERNAL_PATTERN_IDS: frozenset = frozenset({
    # Second trader-setup set (2026-10-16): launch pad, gap support,
    # capitulation, go signal. Lab-measured and independently blind-adjudicated
    # (86-92% precision); internal until the owner rules them public.
    "uct_launch_pad", "uct_gap_support", "uct_capitulation", "uct_go_signal",
    # Detector recall v2 (2026-10-16): undercut & reclaim and episodic pivot v2,
    # NEW ids beside u_and_r / episodic_pivot (which are unchanged). Lab-measured
    # recall gains and a blind random-day review; experimental, internal until
    # the owner rules them public.
    "uct_undercut_reclaim", "uct_episodic_pivot_v2",
})


def is_internal(pattern_id) -> bool:
    """True when `pattern_id` is an internal/admin-only detector."""
    return str(pattern_id or "") in INTERNAL_PATTERN_IDS


def list_public_pattern_ids() -> list[str]:
    """Registered pattern_ids a member may see, sorted (internal ids removed)."""
    return [pid for pid in list_pattern_ids() if pid not in INTERNAL_PATTERN_IDS]


# ---------------------------------------------------------------------------
# DISPLAY POLICY — how a detection is DRAWN on a chart (display-only)
# ---------------------------------------------------------------------------
#: ⛔ ONE AUTHORITY. Every chart surface reads a detection's drawing tier from
#: here, served per row by `display_policy()` on GET /api/patterns/{sym}; the
#: client never keeps its own copy of these lists. Nothing here changes what a
#: detector FIRES on, its confidence, HIST_SCORE or `confirmed_only` — it only
#: decides whether and how the geometry is drawn.
#:
#: Source: lab/geometry_eval/REPORT.md (2026-10-16, "Trustworthy vs noise"):
#: 1,092 trader-stated trigger/entry levels across 785 calls, each detector's
#: levels scored against a random-price control (U), a shifted-level control (S)
#: and the posted-day open (O), both halves required.
#:   trusted      — beat U and S in BOTH halves, specific (~2x fire rate on call
#:                  days), not ubiquitous: bull_flag, pullback_to_10ema,
#:                  holy_grail; plus double_bottom, whose levels.entry (not its
#:                  neckline points) beat U, S and O in both halves.
#:   hidden       — noise: matched no better than chance, or fired LESS before
#:                  calls (bear_flag), and the three named base relations.
#:   experimental — everything else (borderline, underpowered, or too rare to
#:                  judge); drawn for admins with a visual distinction only.
#: Members (later flip) see `trusted` only.
DISPLAY_TRUSTED: frozenset = frozenset({
    "bull_flag", "pullback_to_10ema", "holy_grail", "double_bottom",
})
DISPLAY_HIDDEN: frozenset = frozenset({
    "inverse_head_shoulders", "triple_top", "triple_bottom", "u_and_r",
    "symmetrical_triangle", "descending_triangle", "bear_flag",
    # base_catalog relations (the chart's base-box layer keys them "bc:<key>")
    "bc:ugly-double-bottom", "bc:green-line-breakout", "bc:darvas-box",
})
#: Ubiquitous level emitters (REPORT.md: support_resistance fires on ~95% of
#: random stock-days, volume_profile_nodes on 100%). They recognise nothing as
#: structure, so they are NOT drawn with the structures: they live in a
#: separate, default-off LEVELS layer that draws only the 1-2 levels nearest
#: price.
DISPLAY_LEVELS_LAYER: frozenset = frozenset({
    "support_resistance", "volume_profile_nodes",
})
#: Detectors whose own logic is an intraday session concept but which still
#: fire on DAILY bars in the daily detect_all pass (REPORT.md fix 8). Firing is
#: untouched; the overlay just never draws them on D/W/M.
DISPLAY_INTRADAY_ONLY: frozenset = frozenset({
    "opening_range_breakout", "opening_range_breakdown", "lance_opening_drive",
})
#: Detectors whose `levels.entry` (the breakout pivot) is the drawn level that
#: measured best (REPORT.md: bull_flag and double_bottom entry beat O).
DISPLAY_DRAW_ENTRY: frozenset = frozenset({"bull_flag", "double_bottom"})


def display_policy(pattern_id) -> dict:
    """The drawing policy for one detection (or base-box key "bc:<key>")."""
    pid = str(pattern_id or "")
    if pid in DISPLAY_LEVELS_LAYER:
        tier, layer = "experimental", "levels"
    elif pid in DISPLAY_HIDDEN:
        tier, layer = "hidden", "structures"
    elif pid in DISPLAY_TRUSTED:
        tier, layer = "trusted", "structures"
    else:
        tier, layer = "experimental", "structures"
    return {
        "display_tier": tier,
        "display_layer": layer,
        "intraday_only": pid in DISPLAY_INTRADAY_ONLY,
        "draw_entry": pid in DISPLAY_DRAW_ENTRY,
    }


def drop_internal(rows, key: str = "pattern_id") -> list:
    """Filter a list of detection dicts/rows, removing internal pattern ids."""
    out = []
    for r in rows or []:
        try:
            pid = r[key]
        except (KeyError, IndexError, TypeError):
            pid = None
        if pid not in INTERNAL_PATTERN_IDS:
            out.append(r)
    return out
