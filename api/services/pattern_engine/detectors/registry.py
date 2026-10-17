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
#: Source: lab/geometry_eval/REPORT_TIERS_V2.md (2026-10-17, "Geometry tiers v2"):
#: a blind round over 41 drawable detectors, n=10 fresh charts each, judged on
#: whether the DRAWN SHAPE is right (0-3 placement rubric), under a rule
#: pre-registered before scoring: n<8 experimental; mean>=2.3 and >=70% scoring
#: >=2 trusted; mean<1.5 hidden; else experimental. It supersedes the first
#: round (lab/geometry_eval/REPORT.md, 2026-10-16), which measured something
#: different: whether a detector's LEVELS sat on trader-stated entries.
#:   trusted      — donchian_breakout 2.70, rectangle 2.70. support_resistance
#:                  (2.70) stays in the separate levels layer below.
#:                  bc:cup-with-handle stays EXPERIMENTAL: the primary judge's
#:                  2.30 averaged with a second blind judge's 1.80 (70% >=2) is
#:                  ~2.05, under the 2.3 bar; its defect is the handle (drawn
#:                  past the breakout, too long or too short), see
#:                  pattern_engine.display.handle_extent.
#:   hidden       — mean < 1.5 in v2 (double_bottom 0.55: its anchors skipped
#:                  the true low; double_top / head_shoulders 0.80; flat_base
#:                  0.30: its box wrapped the whole prior advance), plus the
#:                  round-1 noise set (matched no better than chance, or fired
#:                  LESS before calls: bear_flag) and its named base relations.
#:   experimental — everything else, including the round-1 trusted set that
#:                  failed AS DRAWN in v2 (bull_flag 1.50, pullback_to_10ema
#:                  1.90, holy_grail 1.80) and the RSI divergences, which never
#:                  rendered (no verdicts). Drawn for admins, visually distinct.
#: Members (later flip) see `trusted` only.
DISPLAY_TRUSTED: frozenset = frozenset({
    "donchian_breakout", "rectangle",
})
DISPLAY_HIDDEN: frozenset = frozenset({
    # v2 blind round (2026-10-17): mean < 1.5
    "double_bottom", "double_top", "head_shoulders", "flat_base", "vcp",
    "higher_low_continuation", "inverse_cup_handle", "qullamaggie_setup",
    "range_detection", "bc:vcp", "bc:base-on-base",
    # round 1 (2026-10-16): noise
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
#: measured best (REPORT.md: bull_flag entry beat O). double_bottom left this
#: set in v2 (REPORT_TIERS_V2.md, 2026-10-17): it is hidden until it is
#: re-judged as an entry line only.
DISPLAY_DRAW_ENTRY: frozenset = frozenset({"bull_flag"})

#: The learned auto-drawer (api/services/auto_draw.py; lab auto-draw study, model of
#: 2026-10-16, graded against trader-drawn lines). While its `drawn` block rides the
#: response (admin + AUTO_STRUCTURES_ENABLED), the overlay applies these two display
#: rules; nothing here changes firing, confidence, HIST_SCORE or `confirmed_only`.
#:   hidden by default  -- volume_profile_nodes matched drawn levels at exactly chance
#:                         (recall and precision indistinguishable from random prices).
#:   replaced by learned -- swing_pivots drew ~10 levels a chart at barely-above-chance
#:                         precision; the learned top 3 of the same pivots replace it.
DISPLAY_LEARNED_HIDES: frozenset = frozenset({"volume_profile_nodes"})
DISPLAY_LEARNED_REPLACES: frozenset = frozenset({"swing_pivots"})


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
