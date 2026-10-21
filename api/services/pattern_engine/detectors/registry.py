"""Detector registry.

Detectors register themselves with `register("pattern_id", fn)`. The engine
entrypoint (`detect_all`) iterates the registry; consumers can scope a single
detector via `detect_one`.
"""
from __future__ import annotations

from typing import Callable, Dict, Optional


DetectorFn = Callable[[list, dict], list[dict]]


_REGISTRY: Dict[str, DetectorFn] = {}

#: The daily scan's history depth: every detector that declares no minimum
#: receives exactly this many trailing bars, as it did before minimums existed.
SCAN_BASE_DEPTH = 200

#: Detectors that need MORE history than the scan's base depth declare it at
#: registration (`register(pid, fn, min_bars=N)`). The scan fetches enough for
#: the deepest declaration and hands each declaring detector its own N trailing
#: bars; nothing else sees the extra history.
_MIN_BARS: Dict[str, int] = {}

#: Detectors with a per-symbol rule (uct_pullback_ma_v5's fund exclusion)
#: declare `wants_sym=True`; `detect_all(..., sym=X)` then hands ONLY them a
#: context copy carrying `sym`. Every other detector's context, and therefore
#: every detection it embeds that context in, is unchanged.
_WANTS_SYM: set = set()


def register(pattern_id: str, fn: DetectorFn, min_bars: Optional[int] = None,
             wants_sym: bool = False) -> None:
    """Add a detector to the registry. Overwrites if already present.

    `min_bars`: optional minimum daily history this detector needs, used only
    when it exceeds the caller's base depth (see `bars_for`).
    `wants_sym`: the detector reads `context["sym"]` (see `context_for`)."""
    _REGISTRY[pattern_id] = fn
    if min_bars is None:
        _MIN_BARS.pop(pattern_id, None)
    else:
        _MIN_BARS[pattern_id] = int(min_bars)
    if wants_sym:
        _WANTS_SYM.add(pattern_id)
    else:
        _WANTS_SYM.discard(pattern_id)


def wants_sym(pattern_id: str) -> bool:
    return pattern_id in _WANTS_SYM


def context_for(pattern_id: str, context: dict, sym) -> dict:
    """The context a detector receives: `context` itself, or for a detector
    that declared `wants_sym`, a copy with `sym` (upper-cased) added."""
    if pattern_id in _WANTS_SYM and sym:
        return {**(context or {}), "sym": str(sym).strip().upper()}
    return context


def min_bars_for(pattern_id: str) -> Optional[int]:
    """The declared minimum history for `pattern_id`, or None."""
    return _MIN_BARS.get(pattern_id)


def scan_depth(base_depth: int = SCAN_BASE_DEPTH) -> int:
    """How many bars a scan must fetch so every registered detector gets the
    history it declared: max(base_depth, every registered declaration)."""
    declared = [n for pid, n in _MIN_BARS.items() if pid in _REGISTRY]
    return max([int(base_depth)] + declared)


def bars_for(pattern_id: str, bars: list, base_depth: int) -> list:
    """The trailing slice a detector receives under a scan of `base_depth`:
    its declared minimum when larger than the base, else exactly `base_depth`
    trailing bars (the pre-minimum behaviour, byte for byte)."""
    n = max(int(base_depth), _MIN_BARS.get(pattern_id) or 0)
    return bars[-n:] if n > 0 else bars


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
    # Detector recall v2, pullback v5 (2026-10-17): a NEW id beside the four
    # pullback_to_* detectors (unchanged). Lab test half recall 20.1% at lift
    # 3.74 vs production 1.94; blind fresh-packet review 19 yes / 1 no / 5
    # ambiguous. Experimental, internal until the owner rules it public.
    "uct_pullback_ma_v5",
    # Team setup recognition rules: inside day and flat-top breakout, NEW ids
    # beside inside_bar_breakout / nr7 / flat_base (unchanged). Lab-frozen rules,
    # each confirmed by two independent blind packets (pooled precision of
    # decided 90.5% and 82.4%). Experimental, internal until the owner rules them
    # public; NOT in the team drawing set.
    "uct_inside_day", "uct_flat_top_breakout",
    # Team setup recognition rules, second pair: the flag / high tight flag
    # rule WITH the lab's shared guard (falling 200 SMA overhead or a pinned
    # post-gap tape), and the MA reclaim rule. NEW ids beside bull_flag /
    # high_tight_flag / pennant / remount (unchanged). Each confirmed by two
    # independent blind packets (pooled precision of decided 79.5% and 82.9%).
    # Experimental, internal until the owner rules them public; NOT in the team
    # drawing set.
    "uct_flag_htf", "uct_ma_reclaim",
    # Team setup recognition rule, third port: a close through the top-1
    # falling line of a FROZEN copy of the learned drawer (vendored in the
    # detector module, never the display drawer). NEW id, no existing detector
    # changed. Confirmed by two independent blind packets shown the tested line
    # (pooled precision of decided 86.8%). Experimental, internal until the
    # owner rules it public; NOT in the team drawing set.
    "uct_trendline_break",
    # Same port: the launch pad v4 rule (a close just above a tight 8/21/50
    # cluster, no falling 200 overhead). NEW id beside uct_launch_pad, which is
    # a different, earlier rule and is unchanged. Confirmed by two independent
    # blind packets (pooled precision of decided 82.4%). Experimental, internal;
    # NOT in the team drawing set.
    "uct_launch_pad_v4",
    # Detector recall v4 (2026-10-18): the flat-top breakout rule widened by a
    # gated second branch (the same frozen decision at a 25- or 60-session
    # ceiling, only when the ceiling is mature, not nested in a larger base,
    # and the 200 SMA is rising). NEW id beside uct_flat_top_breakout, which
    # is unchanged. Lab test-half recall 27.0% vs the base rule's 23.0%; two
    # blind packets (12/15, 13/15 of decided); a pre-registered new-only
    # confirmation 28/32. Experimental, internal; NOT in the team drawing set.
    "uct_flat_top_breakout_ftb4",
    # Detector recall v4 (2026-10-18): the inside-day rule widened by a gated
    # second branch (close above a rising 21 EMA, range <= 1.0 ATR, only with
    # the 50 SMA rising and the close above the 200 SMA). NEW id beside
    # uct_inside_day, which is unchanged. Lab test-half recall 42.8% vs the
    # base rule's 23.5%; two fresh blind packets (21/21 and 15/17 of decided);
    # the new-branch fires alone 12/14. Experimental, internal; NOT in the team
    # drawing set.
    "uct_inside_day_id4",
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
#: Members (behind AUTO_STRUCTURES_MEMBERS_ENABLED) see DISPLAY_MEMBER_SET only (below).
#:
#: v3 re-judge (lab/geometry_eval REPORT_TIERS_V3.md, 2026-10-17): the same
#: blind rule over 13 detectors whose DRAWING changed, n=10 fresh charts each.
#:   flat_base    0.30 -> 1.60: hidden -> EXPERIMENTAL (its capped base box).
#:   bc:flat-base 1.60 -> 1.20: experimental -> HIDDEN (boxes still spanning
#:                the chart, or stale after a breakdown).
#:   rsi_bearish_divergence 2.30 (80% >=2) met the trusted rule but stays
#:                EXPERIMENTAL: its charts were judged WITHOUT an RSI panel, so
#:                only the price-extreme line was judged, never the divergence
#:                itself (CI low 1.80). Re-test with the RSI panel first.
#:   double_bottom / double_top / head_shoulders stay hidden (their misses are
#:   now DETECTION: mismatched extremes).
#:
#: TEAM DRAWING SET (owner direction, 2026-10-17). The chart's auto-drawings
#: show what the TEAM actually draws, not what scored best on generic shapes:
#:   * flags        bull_flag: the pole + the flag's lanes (v2/v3 lane fixes);
#:   * bases        flat_base, bc:flat-base, bc:cup-with-handle: the breakout /
#:                  pivot line (`extras.draw_pivot`, pattern_engine.display);
#:                  a box only where its geometry held up (flat_base's capped
#:                  box, the cup's capped handle); bc:flat-base draws the pivot
#:                  line ONLY (its box judged 1.20 in v3);
#:   * pullbacks    uct_pullback_ma_v5: the tagged moving average as a curve
#:                  (21 EMA / 50 SMA) plus the tag-bar marker;
#:   * key levels + trendlines: the learned drawer (`drawn`, auto_draw.py,
#:                  trained on the traders' own drawn lines) -- served beside
#:                  the rows, not a pattern id.
#: Donchian / rectangle are NOT what the team uses: they left the trusted set
#: and draw as experimental (admins' "show all"). DISPLAY_TRUSTED IS this set.
#: Members do NOT get this whole set: they get DISPLAY_MEMBER_SET below, the
#: types that passed the blind check as drawn. uct_pullback_ma_v5 is INTERNAL
#: (INTERNAL_PATTERN_IDS); the member set is the only path that serves it.
DISPLAY_TEAM_SET: frozenset = frozenset({
    "bull_flag",
    "flat_base", "bc:flat-base", "bc:cup-with-handle",
    "uct_pullback_ma_v5",
    "uct_flat_top_breakout",
    "bc:base",
    "draw:inside-day",
})
DISPLAY_TRUSTED: frozenset = DISPLAY_TEAM_SET
#: MEMBER SET (owner-approved 2026-10-17): the part of the team set a PAID member
#: is drawn while AUTO_STRUCTURES_MEMBERS_ENABLED is on. Each type here passed two
#: independent blind packets at 331774fc5a (lab/geometry_eval
#: REPORT_TEAM_SET_R4_CONFIRM.md, _R5.md, _R5_CONFIRM.md): flat_base and the MA
#: pullback v5 (as drawn: the tagged MA curve, tag-bar marker and stop). The learned
#: drawer's levels + trendlines (`drawn`, auto_draw.py) passed the same check; they
#: are served beside the rows, not as a pattern id, so they are not listed here.
#: bc:flat-base (owner-approved 2026-10-17) passed its own two blind packets AS
#: DRAWN -- the PIVOT LINE ONLY, box off (auto_structures._team_pivot): R5c 2.40
#: [2.10, 2.67] at 331774fc5a and bcflat-c2 2.30 [2.03, 2.57] at 1dccf110ff
#: (lab/geometry_eval REPORT_BCFLAT_C2.md). It reaches a member as a base box in
#: `structures`, and auto_structures.member_rows serves it only while it carries
#: that pivot line with the box off, so a member is drawn exactly what was judged.
#: bull_flag (owner-approved 2026-10-17) passed two independent blind packets AS
#: DRAWN BY THE ROUND-9 CODE (8d033ec7d2): team_bf9a 2.43 [2.13, 2.73] and team_bf9b
#: 2.40 [2.17, 2.63] (lab/geometry_eval REPORT_BULLFLAG_R9.md). The confirmation
#: covers that drawing code only, so auto_structures.member_rows serves a bull_flag
#: only while it is not stale and carries extras.draw_round equal to the confirmed
#: round: a row stored by older drawing code, or one whose verdicts never finished,
#: is dropped (an admin still sees it).
#: NOT confirmed, so admin-only (Team/All) and never served to a member: every other id. Admins'
#: tiers are unchanged:
#: DISPLAY_TRUSTED above still stamps the whole team set `trusted`.
#: uct_pullback_ma_v5 stays INTERNAL everywhere else; the member route serves its
#: rows ONLY through this set (api/routers/patterns.py, member branch).
#: uct_flat_top_breakout (lab flattop_draw_v2, 2026-10-18) passed two fresh blind packets AS DRAWN
#: -- the "flat top" ceiling plus its touch markers, only under the v2 draw conditions: A 2.60
#: [2.30, 2.83] and B 2.57 [2.30, 2.80]. auto_structures.member_rows serves it only while it carries
#: extras.draw_round == MEMBER_FLAT_TOP_ROUND beside a well-formed draw_flat_top (fail closed). Its
#: trusted tier is per ROW (DISPLAY_TRUSTED_WHEN_STAMPED / row_display_policy): an unstamped
#: flat-top row keeps the experimental tier it always had, for admins too.
#: bc:base (lab base_draw, 2026-10-18) is the shape-agnostic BASE drawing -- the base's extent, its
#: pivot on the top cluster of the candle bodies and its low (api/services/pattern_engine/base_draw.py).
#: It passed its pre-registered team-axis pivot test on the held-out half (14 of 17 charts; a naive
#: 20-bar highest-body line hits 13 of 17, so its value is WHEN it draws and the extent, not the pivot
#: price) and two fresh blind packets AS DRAWN: A 2.70 [2.47, 2.90] and B 2.80 [2.60, 2.97], 100% of
#: charts >= 2 in both. The extent test was NOT validated against extents the team drew (the team's
#: base there is derived by the lab's own span rule; one comparison against team boxes). A member is
#: served it only where no incumbent base drawing covers the same base
#: (auto_structures.member_base_precedence). A bc:base row
#: exists only beside a drawing (auto_structures.base_draw_row), and auto_structures.member_rows
#: serves it only while it carries draw_round == MEMBER_BASE_ROUND beside a well-formed draw_base. While
#: the drawing code is on a later round (round 2, lab base_draw_v2), the member is served the round-1
#: drawing that every row carries in extras.draw_member (auto_structures._base_member_row).
#: bc:cup-with-handle (lab cup_tier_v2 + cup_draw_v4, 2026-10-18) reaches a member ONLY as the cup
#: recognition tier draws it (pattern_engine/cup_tier.py): recognition 28 of 33 = 84.8% on two fresh
#: blind packets (live detector alone 14.3%), and drawing round 4 on two fresh pre-registered packets,
#: two judges each: d1 2.42 [2.20, 2.62] 96% >= 2, d2 2.50 [2.28, 2.72] 88% >= 2.
#: auto_structures.member_rows serves it only while it carries extras.cup_tier with draw_round ==
#: MEMBER_CUP_TIER_ROUND, not withheld, and then draws the tier's pivot / handle / rim reference in place
#: of the admin rounds' drawing. An unstamped cup row stays admin-only. Served population (lab, measured):
#: the admin display rounds mark 63.6% of the 1,402 tier fires stale before the stamp runs and round 4
#: withholds 169 more, so a member is served 341 of 1,402 = 24.3%; the 21 judged charts a member can be
#: served score 2.36 [2.10, 2.62], 85.7% >= 2 (post hoc); served recognition 8 of 8 decided. Where a
#: stamped cup is served, bc:flat-base (member_cup_precedence) and bc:base (member_base_precedence) near
#: its pivot or overlapping its span are dropped for members: the cup is the confirmed, judged drawing.
#: draw:inside-day (lab id_draw_v2, 2026-10-19) is the member INSIDE-DAY drawing over the served
#: uct_inside_day_id4 recognition (which itself stays INTERNAL): a light box over the inside day and
#: the bar it sits inside, a solid "trigger" line at the inside day's high and a dashed "stop" at its
#: low, withheld unless the stock rests near the top of its 60-session range and the inside day is
#: clearly narrower than its mother bar. It passed two fresh pre-registered blind packets, two judges
#: each, AS DRAWN: A2 2.56 [2.36, 2.74] 96% >= 2 and B2 2.44 [2.28, 2.60] 100% >= 2 (the previous
#: round failed its second packet, 1.98). The team axis was too thin to test. A row exists only beside
#: a drawing (auto_structures.inside_day_draw_row); member_rows serves it only while it carries
#: draw_round == MEMBER_INSIDE_DAY_ROUND beside a well-formed draw_inside_day, and
#: member_inside_day_precedence keeps it to daily charts and drops it under an incumbent breakout line.
DISPLAY_MEMBER_SET: frozenset = frozenset({
    "flat_base", "uct_pullback_ma_v5", "bc:flat-base", "bull_flag",
    "uct_flat_top_breakout", "bc:base", "bc:cup-with-handle", "draw:inside-day",
})
assert DISPLAY_MEMBER_SET <= DISPLAY_TEAM_SET, "a member type must be in the team set"
#: Team-set ids that are trusted ROW BY ROW: a row is `trusted` only while it carries the stamp
#: named here (the extras key the blind-confirmed drawing code writes, display.draw_geometry). Every
#: other row of that id keeps the tier it had before the id joined the team set (`experimental`),
#: so an admin's chart draws it exactly as before and the member gate never sees it trusted.
#: Served per row by `row_display_policy`; `display_policy(id)` alone answers for the stamped row.
DISPLAY_TRUSTED_WHEN_STAMPED: dict = {"uct_flat_top_breakout": "draw_flat_top"}
assert set(DISPLAY_TRUSTED_WHEN_STAMPED) <= DISPLAY_TEAM_SET
#: Ids that fire in BOTH directions under one id while the chart draws them as a LONG setup: a row of
#: the id whose own `direction` is the one named here is `hidden` (never drawn), per ROW in
#: `row_display_policy`. donchian_breakout emits its 20/55-bar LOW breaks (Turtle shorts) under the same
#: id as its long breakouts, and half of a gold-set slice of what the overlay drew was downside breaks.
#: The detector, its firing, confidence, HIST_SCORE, `confirmed_only` and the screener's id list are
#: untouched: only the drawing of the short side stops. A row with no direction keeps the id's tier.
DISPLAY_HIDDEN_WHEN_DIRECTION: dict = {"donchian_breakout": "bearish"}
DISPLAY_HIDDEN: frozenset = frozenset({
    # v2 blind round (2026-10-17): mean < 1.5
    "double_bottom", "double_top", "head_shoulders", "vcp",
    "higher_low_continuation", "inverse_cup_handle", "qullamaggie_setup",
    "range_detection", "bc:vcp", "bc:base-on-base",
    # v3 re-judge (REPORT_TIERS_V3.md, 2026-10-17) hid bc:flat-base (box 1.20);
    # it left again 2026-10-17 for the team set, drawn as its pivot line only.
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


def row_display_policy(row) -> dict:
    """`display_policy` for one detection ROW: the same, except that a row of an id in
    DISPLAY_TRUSTED_WHEN_STAMPED is `trusted` only while its geometry.extras carries that id's stamp
    as a dict; otherwise it is `experimental`, the tier it had before the id joined the team set. A row
    of an id in DISPLAY_HIDDEN_WHEN_DIRECTION whose own `direction` is the named one is `hidden`."""
    r = row if isinstance(row, dict) else {}
    pid = r.get("pattern_id")
    pol = display_policy(pid)
    hide_dir = DISPLAY_HIDDEN_WHEN_DIRECTION.get(str(pid or ""))
    if hide_dir is not None and str(r.get("direction") or "").lower() == hide_dir:
        return {**pol, "display_tier": "hidden"}
    stamp = DISPLAY_TRUSTED_WHEN_STAMPED.get(str(pid or ""))
    if stamp is not None and pol["display_tier"] == "trusted":
        geom = r.get("geometry")
        ex = geom.get("extras") if isinstance(geom, dict) else None
        if not (isinstance(ex, dict) and isinstance(ex.get(stamp), dict)):
            pol = {**pol, "display_tier": "experimental"}
    return pol


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
