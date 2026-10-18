"""Display-only annotations for detections (never read by any firing decision).

`end_t` on a detection is the last bar of the SCAN WINDOW for every geometry
detector (lab/geometry_eval REPORT.md fix 3), so a stored detection cannot say
whether its structure is live or ended weeks ago. It also feeds the memory
dedup hash and outcome tracking, so it is deliberately NOT changed here.

Instead `annotate(detections, bars)` adds, under `geometry.extras`:

  pattern_end_t     the newest bar time any of the detection's own anchors
                    (primary or `geometry.secondary`) sits on — the
                    structure's real last bar.
  pattern_age_bars  how many window bars came after it (0 = the structure is
                    on the last bar).

Both are derived from anchors the detector already emitted, after the fact, so
they cannot change what fires, its confidence or HIST_SCORE.

DRAWING GEOMETRY (lab/geometry_eval REPORT_TIERS_V2.md, 2026-10-17). The blind
v2 round judged whether the DRAWN shape is right and named five drawing
defects. `annotate` also stamps the display-only fixes for them, again under
`geometry.extras` and again never touching `anchors`, `levels`, `start_t`,
`end_t`, confidence or anything a firing decision reads:

  draw_anchors  the anchors the chart should DRAW in place of `anchors`.
                * double_bottom / double_top / head_shoulders: each anchor
                  snapped to the true extreme bar of its leg (the judges saw a
                  deeper low BETWEEN the two marked bottoms on most charts).
                  See `snap_to_extremes`.
                * flat_base: the base only (the prior-advance low no longer
                  stretches the box over the whole run-up), capped to the
                  consolidation by `consolidation_extent`.
  draw_ema      {period, points}: the EMA a pullback setup names
                (pullback_to_10ema / pullback_to_21ema / holy_grail's 20-EMA)
                over the pullback window, instead of one flat line.
  draw_pole     bull_flag: [pole base low, pole top high] -- the pole itself.
  draw_lanes    bull_flag: False when the flag's two lanes cross or diverge,
                or when a higher-confidence bull_flag of the same run already
                draws lanes over the same bars (`lanes_reason` says which).
  draw_round    bull_flag: BULL_FLAG_DRAW_ROUND, set only on a flag that came
                through every verdict and the overlap pass and is drawn. The
                member set reads it (auto_structures.member_rows); nothing draws
                from it.

v3 follow-ups (REPORT_TIERS_V3.md, 2026-10-17), still display-only:
  * draw_ema always spans at least PULLBACK_EMA_MIN_BARS bars ending on the
    last bar (a pullback bar that is itself the 10-bar swing high used to give
    < 2 points, so the overlay fell back to a flat line).
  * a capped base box ends AT its breakout / breakdown bar and is at most
    MAX_BOX_BARS wide (`consolidation_extent`).
  * the first anchor of a snapped chain never reaches back past the pattern's
    own start (`snap_to_extremes`), so it cannot land on an older deeper low.
  * `failed_breakout` names a box whose price closed above its top line and
    then back below it (a stale cup-with-handle; auto_structures drops it).

TEAM DRAWING SET (owner direction 2026-10-17; registry.DISPLAY_TEAM_SET), still
display-only:
  draw_pivot  {start_t, end_t, price}: a base's breakout / pivot line (the flat
              top), over the capped consolidation and ending at its breakout
              bar. flat_base here (price = the detector's base high, the level
              it fires above); bc:flat-base / bc:cup-with-handle in
              auto_structures.box_to_detection (price = base_catalog's pivot).
              `draw_box` False means draw the line only, not the box.
  stale       flat_base whose consolidation broke DOWN (closed out of the
              band below and never recovered): the overlay does not draw it.
  draw_ema    uct_pullback_ma_v5: the moving average it TAGGED (`kind` "ema"
              or "sma", from extras.tagged_ma), computed exactly as the
              detector computes it, plus `tag` {t, price}: the tag bar's low,
              drawn as a marker.

TEAM SET ROUND 2 (lab REPORT_TEAM_SET.md, 2026-10-17 blind check), still
display-only:
  bull_flag   a flag is drawn only when it is a PAUSE: no flag bar's high and
              neither lane end above the pole high (FLAG_POLE_TOL), and the
              channel's midline flat-to-down (rise <= FLAG_RISE_TOL x pole
              height). Otherwise `stale` (`stale_reason` past_pole_high /
              rising_channel): the judges saw rising channels past the pole
              high, a second leg, drawn as flags. Of the flags left over the
              same bars only the most confident is drawn at all (the others
              are `stale`, reason overlapped): one pole, one entry line.
  draw_pivot  a flat base's pivot line needs a real base under it
              (`pivot_base_verdict`: >= PIVOT_BASE_MIN_BARS closes within
              PIVOT_BASE_BAND_ATR ATR below the line) and the line within
              PIVOT_NEAR_ATR ATR of the last close; otherwise the base is
              `stale` (no_base / far_from_price) and not drawn.

TEAM SET ROUND 3 (lab REPORT_TEAM_SET_R2.md, 2026-10-17 blind check), still
display-only:
  bull_flag   draw_pole's top is the pole's TRUE swing high (`pole_top_index`:
              the highest high from the pole start to the flag start), not a
              lower or later pivot; the pause verdict reads the same bar.
  flat_base   the box (draw_anchors) and its pivot line span the CONTIGUOUS
              run of closes in the pivot band ending nearest the last bar
              (`band_run_extent`).
  bull_flag (round 7, lab REPORT_BULLFLAG_R6.md) -- draw_pole starts at the FINAL leg's swing
              low (`pole_draw_start`: after a deep mid-pole pullback, a sideways base or a
              long-wick start bar; always on a real bar low); a stair-step grind is `stale`
              (grind_pole); `draw_anchors` carries refitted lanes (`flag_draw_lanes`: a wide red
              first bar left out, a flat-bottomed wedge drawn parallel, a floating lane end
              pulled onto the bars) -- the detector's own anchors are untouched.
  bull_flag (round 8, lab REPORT_BULLFLAG_R7.md) -- DISPLAY SELECTION: the judges accepted the
              geometry and objected to which flags were drawn. A flag is `stale` (not drawn) when
              its pole tops out under a prior high (under_prior_high), climbs back out of a drop it
              just made (rebound_pole) or is a slow first leg then a thrust (two_step_pole) --
              `flag_context_verdict`; when the flag has fewer than FLAG_MIN_BARS (now 5) bars;
              when its lanes -- the detector's or the refitted DRAWN ones -- fan past
              LANE_DIVERGE_RATIO (now 1.45); and when its entry is set by a bar before the lanes
              start while the price sits far under it (entry_detached, `flag_entry_verdict`). The
              detector's firing, confidence and levels are untouched.
  bull_flag (round 9, lab REPORT_BULLFLAG_R8.md) -- DISPLAY SELECTION, as round 8. One impulse
              verdict (`pole_impulse_verdict`) now holds short_pole (the drawn pole under
              DRAWN_POLE_MIN_ATR), grind_pole (down share 0.35) and two_step_pole;
              under_prior_high reads LEAD_BARS = 90 bars; the drawn lanes must hold
              LANE_MIN_BODY_SHARE of the bodies they span (loose_lanes, `flag_lanes_verdict`).
  bc:flat-base / bc:cup-with-handle -- see auto_structures._team_pivot:
              `flat_shape_verdict` (stair_step / deep_v) and `pullback_handle`
              (round 6: the box is the pullback from the right side's peak; no_pullback / short /
              long / deep draw no box, the rim stays). Round 6 also adds the cup rim's
              spike_rim and tightens short_of_rim (`cup_reach_verdict`). Round 7: prior_peak
              (`prior_peak`: the right side never reaches the higher peak just before the cup's
              start), spike_rim without its crash half, and the handle box's top capped at the rim.
"""
from __future__ import annotations

import math
from bisect import bisect_right


def _anchor_times(geometry: dict) -> list:
    out = []
    for a in (geometry or {}).get("anchors") or []:
        t = a.get("t") if isinstance(a, dict) else None
        if isinstance(t, (int, float)):
            out.append(t)
    for sec in (geometry or {}).get("secondary") or []:
        if isinstance(sec, dict):
            out.extend(_anchor_times({"anchors": sec.get("anchors")}))
    return out


def pattern_end(detection: dict, bar_times: list):
    """(pattern_end_t, pattern_age_bars) or (None, None) when unknowable.

    Only anchor times that are REAL bar times of this window count, so a stray
    projected or index-shaped value can never masquerade as the pattern's end.
    """
    if not bar_times:
        return None, None
    present = set(bar_times)
    times = [t for t in _anchor_times(detection.get("geometry") or {}) if t in present]
    if not times:
        return None, None
    end_t = max(times)
    age = len(bar_times) - bisect_right(bar_times, end_t)
    return int(end_t), int(age)


def annotate(detections: list, bars: list) -> list:
    """Stamp pattern_end_t / pattern_age_bars and the drawing geometry in
    place. Never raises."""
    try:
        bar_times = [b["t"] for b in bars or []]
    except Exception:  # noqa: BLE001 -- display annotation must never break a scan
        return detections
    for d in detections or []:
        try:
            end_t, age = pattern_end(d, bar_times)
            if end_t is None:
                continue
            geom = d.setdefault("geometry", {})
            extras = geom.setdefault("extras", {})
            extras["pattern_end_t"] = end_t
            extras["pattern_age_bars"] = age
        except Exception:  # noqa: BLE001
            continue
    try:
        draw_geometry(detections, bars)
    except Exception:  # noqa: BLE001 -- display annotation must never break a scan
        pass
    return detections


# -- drawing geometry (REPORT_TIERS_V2.md, 2026-10-17) -----------------------

#: The extreme each anchor marks, in order. Alternating chains only.
EXTREME_CHAINS: dict = {
    "double_bottom": ("low", "high", "low"),
    "double_top": ("high", "low", "high"),
    "head_shoulders": ("high", "low", "high", "low", "high"),
}
#: Pullback setups and the EMA period each one names (holy_grail: the 20-EMA).
PULLBACK_EMA: dict = {"pullback_to_10ema": 10, "pullback_to_21ema": 21, "holy_grail": 20}
#: Bars before the pullback (touch) bar searched for the swing high it fell from.
PULLBACK_WINDOW_LOOKBACK = 10
#: The drawn EMA segment covers at least this many bars ending on the last bar
#: (v3: the swing-high window alone was often a 2-5 bar stub, or < 2 points).
PULLBACK_EMA_MIN_BARS = 15
#: The widest base box drawn, in bars, breakout / breakdown bar included (v3:
#: flat-base boxes still spanned the whole chart). base_catalog's own numbers
#: are untouched; only the drawn extent is capped.
MAX_BOX_BARS = 60
#: Box detections whose drawn extent is capped to the consolidation. The
#: bc:* boxes are capped in api/services/auto_structures.box_to_detection.
EXTENT_CAPPED = frozenset({"flat_base", "bc:flat-base", "bc:square-box"})
#: Team-set pullbacks that draw the MA they tagged: extras.tagged_ma -> (kind, period).
TAGGED_MA = {"e8": ("ema", 8), "e21": ("ema", 21), "s50": ("sma", 50), "s200": ("sma", 200)}
TEAM_PULLBACKS = frozenset({"uct_pullback_ma_v5"})
#: A flag's lanes "diverge" when the channel is more than this many times as
#: wide at its right end as at its left end. Round 8 (lab REPORT_BULLFLAG_R7.md: fanning lower lanes,
#: R7 case_891 at 1.74, R6 case_666): 2.0 -> 1.45, and read off the DRAWN lanes too; on the judged
#: drawn flags the gap is between 1.43 (kept) and 1.50 (removed).
LANE_DIVERGE_RATIO = 1.45
#: A flag (a pause) stays at or below its pole high: this relative tolerance.
FLAG_POLE_TOL = 0.002
#: A flag's channel midline may rise at most this fraction of the pole height.
FLAG_RISE_TOL = 0.10
#: A pivot line needs at least this many closes in the band just below it ...
PIVOT_BASE_MIN_BARS = 5
#: ... the band being this many ATR(14) deep (a close up to 0.1 ATR over the line counts) ...
PIVOT_BASE_BAND_ATR = 2.0
#: ... and the line must sit within this many ATR(14) of the last close.
PIVOT_NEAR_ATR = 3.0
#: Round 3: a flat base's closes must not trend -- the least-squares slope of the closes over the
#: base, in ATR(14) per bar, stays within this (a stair-step climb is not a flat base) ...
FLAT_MAX_SLOPE_ATR = 0.06
#: ... and the base's lowest low sits at most this many ATR(14) below the band
#: (PIVOT_BASE_BAND_ATR under the line): deeper is a V, not a base.
FLAT_MAX_DIP_ATR = 3.0
#: Round 3: a cup's handle box is drawn only with at least this many bars (round 6: from the right
#: side's peak to the end, `pullback_handle`). Round 3's "at most a third of the cup's length" and round
#: 4's "at most a third of the cup's depth" were retired in round 6 (see HANDLE_MAX_PULLBACK_BARS).
HANDLE_MIN_BARS = 3
#: Round 4: the flat_base box tolerates up to this many closes OUTSIDE the band inside its run ...
FLAT_RUN_GAP_BARS = 2
#: ... and the run must end within this many bars of the last bar.
FLAT_RUN_NEAR_BARS = 3
#: Round 4 (bc:flat-base): the line sits on the top CLUSTER of highs -- the highest high with at
#: least TOP_MIN_TOUCHES highs (itself included) within TOP_CLUSTER_ATR ATR at or below it, priced
#: at the median of that cluster -- not on one spike or failed-breakout wick above it.
TOP_CLUSTER_ATR = 0.25
TOP_MIN_TOUCHES = 2
#: Round 4 (bc:flat-base): a base whose high-to-low range is wider than this many ATR(14) is a
#: choppy range, not a flat base (calibrated on the round 1-3 judged bases: no base judged 3 was
#: wider than 4.7) ...
FLAT_MAX_RANGE_ATR = 4.8
#: ... and a base whose lowest low sits more than this fraction under the highest high of the
#: DRAWDOWN_LOOKBACK bars up to its start (the 52-week / available high) is a recovery from a deep
#: decline, not a base near the highs (no base judged 3 in rounds 1-3 sat more than 9% under).
FLAT_MAX_DRAWDOWN = 0.11
DRAWDOWN_LOOKBACK = 252
#: Round 4 (bull_flag): the pole rises at least POLE_MIN_ATR ATR(14) (the ATR of the bars up to
#: the pole start) in at most POLE_MAX_BARS bars -- a slow grind is not a pole. POLE_MAX_BARS is
#: the detector's own pole bound (bull_flag._MAX_POLE_BARS): on the round 1-3 judged flags the
#: bar count did not separate good poles from grinds (three poles judged 3 took 19 bars), the
#: rise in pre-pole ATR did (every pole judged 3 rose >= 5.3).
POLE_MIN_ATR = 5.0
POLE_MAX_BARS = 20
#: ... the flag (the bars its lanes cover) has at least FLAG_MIN_BARS bars, and its channel
#: midline does not rise (slope <= 0).
#: Round 8 (lab REPORT_BULLFLAG_R7.md: 3-5 bar flags read as barely formed): 4 -> 5; the judged drawn
#: 4-bar flags averaged 2.17, the 5-bar ones 2.35.
FLAG_MIN_BARS = 5
#: Round 4 (uct_pullback_ma_v5 tag): the tagged MA must RISE at least TAG_MIN_RISE_ATR ATR(14) over
#: TAG_SLOPE_BARS bars (at the tag bar and at the last bar) -- flat or rolling over otherwise; a
#: literal slope <= 0 never fires, the detector already requires a rising 21 EMA (on the round
#: 1-3 judged tags no tag judged 3 rose under 0.68, five of eight judged 1 rose under 0.4) -- and
#: the tag bar must reach within TAG_NEAR_ATR ATR(14) of it.
TAG_SLOPE_BARS = 10
TAG_MIN_RISE_ATR = 0.4
TAG_NEAR_ATR = 0.25
# -- Round 5 (lab REPORT_TEAM_SET_R4.md + _R4_CONFIRM.md, 2026-10-17). Every threshold marked
# "calibrated" was read off the rounds 1-4 JUDGED cases, which the round-5 blind sample excludes.
#: cup: the rim's left lip is at most this many bars before the last bar -- the chart's 200-bar
#: default zoom; an older lip leaves the rim floating above every visible bar.
RIM_MAX_AGE_BARS = 200
#: cup: a gap down of at least this many ATR(14) (the ATR before the gap) between the lip and the
#: cup's low makes the lip a pre-gap-down high over a crater, not a rim (calibrated).
CRATER_GAP_ATR = 2.5
#: cup: the right side's highest high since the cup's low must come within RIM_REACH_ATR ATR(14) of
#: the rim (round 6: was the larger of 2% of the rim and 1.0 ATR -- the 2% let 1.1 ATR shortfalls
#: through on low-volatility names; right sides 0.86-1.08 ATR short were judged 1-2 in rounds 4-5,
#: the most on a cup judged 3 was 0.63).
RIM_REACH_ATR = 0.8
#: bc:flat-base: the first bar whose high touches the line (within TOP_TOUCH_ATR) is at least
#: FRESH_HIGH_BARS bars before the last bar -- else the line is a fresh high with no base under it.
TOP_TOUCH_ATR = 0.3
FRESH_HIGH_BARS = 10
#: bc:flat-base: at least this fraction of the line's span closes in the band (calibrated) ...
BASE_MIN_FRAC = 0.40
#: ... and no close more than this many ATR(14) under the line (rounded / deep V; calibrated).
BASE_MAX_CLOSE_DEPTH_ATR = 4.4
#: flat_base: the box's highest high within this many bars of its end, while its closes still
#: rise faster than FLAT_MAX_SLOPE_ATR, is a still-rising advance.
FLAT_FRESH_HIGH_BARS = 3
#: bull_flag: the flag's lanes start at most this many bars after the pole's true top ...
FLAG_ADJACENT_BARS = 2
#: ... the flag retraces at most this fraction of the pole ...
FLAG_MAX_RETRACE = 0.5
#: ... and its midline falls no faster than this multiple of the pole's rise rate (calibrated).
FLAG_MAX_FALL_RATIO = 0.65
#: MA pullback: at least this many closes under the MA in the TAG_SLOPE_BARS bars before the tag,
#: while the MA rose less than TAG_FLAT_RISE_ATR ATR(14) over TAG_SLOPE_BARS bars, is price already
#: below a flattening MA (calibrated) ...
TAG_BELOW_CLOSES = 3
TAG_FLAT_RISE_ATR = 0.7
#: ... and a tag bar whose LOW sits more than this many ATR(14) above the MA never tagged it.
TAG_ABOVE_ATR = 0.18
# -- Round 6, bull_flag only (lab REPORT_TEAM_SET_R5_CONFIRM.md, 2026-10-17). Every threshold is
# calibrated on the bull_flag cases judged in team rounds 1-5 + the R5 confirm (80 cases), which the
# round-6 blind packets exclude.
#: crash_pole: the highest high of the CRASH_POLE_BARS bars up to the pole's low sits at least
#: CRASH_POLE_FRAC of the pole's height above that low -- the pole only climbs back out of a crash
#: (a V recovery from a gap-down / crash low), not a thrust out of a base (judged 1, 1, 2 at
#: 1.01-1.20; the next case down was 0.87).
CRASH_POLE_BARS = 5
CRASH_POLE_FRAC = 0.9
#: gap_detached: a true gap down (a bar's high under the bar before's low) of more than this many
#: ATR(14) -- the ATR of the 14 bars before the gap -- between the pole's top and the lanes' first
#: bar: the flag sits below a gap, not under the pole (judged 0, 1, 1, 2 at 0.58-1.33; the largest
#: such gap on a flag judged 3 was 0.25).
FLAG_GAP_ATR = 0.5
#: entry: when the flag's highest high pokes more than this many ATR(14) above the upper lane at
#: its bar -- a single wick / spike over the flag -- the entry line is set from the flag's BODY
#: highs instead (every entry-on-a-wick complaint was 0.84-1.79; no flag judged 3 was over 0.71).
ENTRY_SPIKE_ATR = 0.8
#: breaking_down: the last close sits more than this many ATR(14) under the lower lane at the last
#: bar (judged 1-2.5 at 0.32-1.13; the largest on a flag judged 3 was 0.25).
FLAG_BREAKDOWN_ATR = 0.3
# -- Round 7, bull_flag only (lab REPORT_BULLFLAG_R6.md, 2026-10-17). Every threshold is calibrated on
# the 95 bull_flag cases judged in team rounds 1-5, the R5 confirm and R6 packet A, which the round-7
# blind packets exclude. All display-only: the detector's pivot_ts / anchors / levels are untouched.
#: drawn pole start: the last bar of the pole whose high has a later pullback of at least
#: POLE_LEG_PULLBACK of the pole's height before the top starts a new leg; the drawn pole starts at
#: that leg's swing low (multi-leg poles judged 2 at 0.36-0.78; one pole judged 3 at 0.44 is kept
#: by the next rule) ...
POLE_LEG_PULLBACK = 0.35
#: ... only when that final leg is at least POLE_LEG_MIN_FRAC of the pole's height ...
POLE_LEG_MIN_FRAC = 0.6
#: ... a sideways base of at least POLE_BASE_BARS bars whose closes stay within POLE_BASE_BAND_ATR
#: ATR(14) (the ATR up to the pole's low), with at least POLE_BASE_AFTER_FRAC of the pole's height
#: still to come after it, moves the drawn start to the swing low after the base (no pole judged 3
#: has one) ...
POLE_BASE_BARS = 8
POLE_BASE_BAND_ATR = 1.5
POLE_BASE_AFTER_FRAC = 0.85
#: ... and a start bar whose lower wick is more than POLE_WICK_ATR ATR(14) AND POLE_WICK_FRAC of the
#: drawn pole's height, when the next bar's low is under its body, moves to the next bar (the pole
#: line overdraws the wick and reads as starting in empty space; judged at 1.27 / 0.24).
POLE_WICK_ATR = 1.2
POLE_WICK_FRAC = 0.2
#: grind_pole: the DRAWN pole's close-to-close efficiency (net close change / summed absolute close
#: changes) under GRIND_MAX_EFF while at least GRIND_MIN_DOWN of its bars close down is a stair-step
#: grind, not a pole (judged 1-1.5 at 0.45-0.53 with 0.41-0.50 down; poles judged 3 >= 0.52 had
#: <= 0.32 down).
GRIND_MAX_EFF = 0.54
GRIND_MIN_DOWN = 0.35   # round 9: 0.40 -> 0.35 (see the round-9 block)
#: lanes: a first flag bar whose red body is at least FIRST_WIDE_BODY_ATR ATR(14) and whose range is
#: at least FIRST_WIDE_RATIO x the median range of the other flag bars is left out of the lane fit
#: (judged 2 at 0.94-1.47; no first bar of a flag judged 3 over 0.86) ...
FIRST_WIDE_BODY_ATR = 0.9
FIRST_WIDE_RATIO = 1.4
#: ... lanes that converge (right width under WEDGE_CONV x the left) while the lower lane is flat
#: (|slope| <= WEDGE_FLAT_ATR ATR per bar) are drawn as a parallel channel (judged 2-2.5; none 3) ...
WEDGE_CONV = 0.8
WEDGE_FLAT_ATR = 0.04
#: ... and a lane END more than LANE_FLOAT_ATR ATR(14) beyond both its own bar and the next bar in
#: (under their lows for the lower lane, over their highs for the upper) is pulled onto them (judged
#: 1-2 at 0.41-1.38; the largest on a flag judged 3 was 0.37).
LANE_FLOAT_ATR = 0.4
# -- Round 8, bull_flag only (lab REPORT_BULLFLAG_R7.md, 2026-10-17). DISPLAY SELECTION: a flag whose
# context is wrong is `stale` (not drawn); the detector's firing, confidence and levels are untouched.
# Every threshold is calibrated on the 110 bull_flag cases judged in team rounds 1-5, the R5 confirm,
# R6 packet A and R7 packet A (73 of them drawn at the round-7 code), which the round-8 packets exclude.
#: under_prior_high: the pole's top more than LEAD_NEAR_ATR ATR(14) (the ATR up to the drawn pole start)
#: under the highest high of the LEAD_BARS bars ending at the top -- a rebound under a prior high, not
#: a leader at its high (judged 1.5-2.5 at 0.81-7.7; the largest on a drawn flag judged 3 was 0.48) ...
LEAD_NEAR_ATR = 0.6
#: ... rebound_pole: the highest high of the REBOUND_BARS bars up to the drawn pole start sits at least
#: REBOUND_FRAC of the drawn pole's height above its low -- the pole climbs back out of a drop just
#: made (judged 1.5-2.5 at 0.80-0.84; the largest on a flag judged 3 was 0.72) ...
REBOUND_BARS = 10
REBOUND_FRAC = 0.76
#: ... two_step_pole: a drawn pole of at least TWO_STEP_MIN_BARS bars that reaches half its height only
#: after TWO_STEP_LATE_FRAC of its bars -- a slow first leg, then the thrust (judged 2-2.5 at 0.67-0.85,
#: none 3; the latest on a long pole judged 3 was 0.50).
TWO_STEP_MIN_BARS = 12
TWO_STEP_LATE_FRAC = 0.65
#: entry_detached: the bar that sets the drawn entry (the flag's highest high) comes BEFORE the lanes'
#: first bar -- the flag dropped away from the pole top before the lanes start -- while the last close
#: sits more than ENTRY_STRANDED_ATR ATR(14) under the drawn entry (judged 2 at 1.70 and 2.07; no other
#: drawn judged flag has its entry bar before its lanes).
ENTRY_STRANDED_ATR = 1.5
# -- Round 9, bull_flag only (lab REPORT_BULLFLAG_R8.md, 2026-10-17). DISPLAY SELECTION, as round 8.
# Every threshold is calibrated on the 125 bull_flag cases judged in team rounds 1-5, the R5 confirm and
# R6-R8 packet A (60 of them drawn at the round-8 code), which the round-9 packets exclude.
#: under_prior_high reads LEAD_BARS = 90 bars (was 60): R8 case_831 and 041 topped out 3-7 ATR under a
#: high 61-90 bars back. Every drawn judged flag with a prior high > LEAD_NEAR_ATR in 61-90 bars was
#: judged <= 2; 100 bars would reach a flag judged 3 (5.1 ATR under a high 91-100 bars back).
LEAD_BARS = 90
#: short_pole: the DRAWN pole (from the start pole_draw_start moved it to) rises less than
#: DRAWN_POLE_MIN_ATR ATR(14) (the ATR up to that start). slow_pole measures the detector's pole from
#: its first bar; a drawn final leg can be a short spike off a moved start (R8 case_317, 3.8 ATR,
#: judged 1; R6 case_838 4.1, judged 2). The smallest drawn pole judged 3 rose 5.0. A plain minimum bar
#: count does not separate: R8 case_635, a 2-bar gap-up pole, was judged 3.
DRAWN_POLE_MIN_ATR = 4.5
#: grind_pole's down-close share 0.40 -> 0.35 (R8 case_041: efficiency 0.31, 37% down closes, judged 2;
#: the judged 3s under GRIND_MAX_EFF all had <= 0.25 down closes).
#: loose_lanes: the drawn lanes hold less than LANE_MIN_BODY_SHARE of the summed body length of the bars
#: they span (bodies clipped to the lanes; judged 1-2.5 at 0.36-0.56, the lowest on a flag judged 3 was
#: 0.60).
LANE_MIN_BODY_SHARE = 0.58
#: ... judged only when those bodies sum to at least LANE_MIN_BODY_ATR ATR(14): under it there is too
#: little body to judge (the smallest on a drawn judged flag was 1.07).
LANE_MIN_BODY_ATR = 0.5
#: The bull_flag drawing round this code IS. A bull_flag that came through draw_geometry whole -- every
#: verdict ran, the overlap pass kept it -- carries extras.draw_round = BULL_FLAG_DRAW_ROUND. Display
#: only: nothing draws differently. It exists for the member set (auto_structures.member_rows), which
#: serves a bull_flag only when its round is the one that passed the blind check, so a row stored by
#: older drawing code, or whose verdicts crashed part-way, never reaches a member. Bump it with every
#: new bull_flag drawing round.
BULL_FLAG_DRAW_ROUND = 9
# -- Cup round 6 (lab REPORT_TEAM_SET_R5.md, 2026-10-17). Calibrated on the 62 bc:cup-with-handle cases
# judged in team rounds 1-5 (35 of them drawn at the round-5 code); no threshold removes a cup judged 3.
#: cup handle: the box is the PULLBACK from the right side's peak (`pullback_handle`), at most this many
#: bars after the peak. The handles the judges asked to have boxed ran 3-18 bars after the peak; the
#: handle boxes they called long and loose ran 20-25 bars (R1-R3).
HANDLE_MAX_PULLBACK_BARS = 20
#: spike_rim: the rim's lip bar reaches more than SPIKE_RIM_ATR ATR(14) (the ATR up to the lip) above every
#: open and close within SPIKE_RIM_BARS bars of it. Round 6 required a crash after it as well (0.75 ATR +
#: a 5 ATR fall); round 7 (lab REPORT_CUP_R6.md: rims on a single wick spike with no crash after it,
#: R6 case_062 0.71 and case_532 0.62, both flagged by both judges) drops the crash half and lowers
#: 0.75 -> 0.6. On the 77 cups judged in rounds 1-6 the most on a cup judged 3 (or 2.5) is 0.42.
SPIKE_RIM_ATR = 0.6
SPIKE_RIM_BARS = 5
#: short_of_rim: RIM_REACH_ATR 1.0 -> 0.8 and no 2%-of-price allowance (see RIM_REACH_ATR).
# -- Cup round 7 (lab REPORT_CUP_R6.md, 2026-10-17). Calibrated on the 77 bc:cup-with-handle cases judged in
# team rounds 1-6 (46 of them drawn at the round-6 code); no threshold removes a cup judged 3 (or 2.5).
#: prior_peak: the highest high in the PRIOR_PEAK_BARS bars BEFORE the detector's cup start (the true left
#: peak when the cup's start fell after it) sits more than PRIOR_PEAK_REACH_ATR ATR(14) above the right
#: side's highest high since the cup's low -- a rim on that peak would be short_of_rim, so the lip drawn
#: is a secondary high on the decline (R6 975 / 989, R4 748 / 441, all judged 1). The rim is NOT moved
#: (lab REPORT_BCFLAT_R6.md: re-anchoring backfired); the cup is not drawn. Judged-3 most: 1.11 (R3 729);
#: every threshold 1.2-1.9 removes the same 11 judged cups (four 1s, seven 2s).
PRIOR_PEAK_BARS = 20
PRIOR_PEAK_REACH_ATR = 1.5


def _index(bars) -> dict:
    return {b["t"]: i for i, b in enumerate(bars)}


def snap_to_extremes(bars: list, idxs: list, kinds, start_idx=None) -> list:
    """Snap each anchor bar index to the true extreme bar of its leg.

    Anchors alternate (low, high, low, ...). Walking left to right, anchor i is
    re-placed on the lowest low (a "low" anchor) or highest high (a "high"
    anchor) of its leg: the bars after the previous SNAPPED anchor and before
    the next ORIGINAL anchor. The first anchor's leg reaches back half the
    distance to its neighbour but NEVER before the pattern's own start
    (`start_idx`; default the first anchor itself, which is where every
    EXTREME_CHAINS detector puts start_t) -- v3: the reach-back pulled the
    first anchor onto an older, deeper extreme outside the pattern. The last
    anchor's leg reaches forward half the distance to its neighbour (clipped
    to the window). The original
    bar is always inside its leg, so a snapped anchor is never less extreme
    than the one the detector drew, and the anchors keep their order. Ties
    keep the earliest bar. Returns the snapped indices.
    """
    n = len(bars)
    m = len(idxs)
    first = idxs[0] if idxs else 0
    floor_i = first if start_idx is None else min(int(start_idx), first)
    out: list = []
    for i, (idx, kind) in enumerate(zip(idxs, kinds)):
        if i == 0:
            lo = max(floor_i, idx - ((idxs[1] - idx) // 2 if m > 1 else 0))
        else:
            lo = out[-1] + 1
        if i == m - 1:
            hi = idx + ((idx - idxs[i - 1]) // 2 if m > 1 else 0)
        else:
            hi = idxs[i + 1] - 1
        lo, hi = max(0, min(lo, idx)), min(n - 1, max(hi, idx))
        best = lo
        for j in range(lo, hi + 1):
            if kind == "low":
                if bars[j]["l"] < bars[best]["l"]:
                    best = j
            elif bars[j]["h"] > bars[best]["h"]:
                best = j
        out.append(best)
    return out


def consolidation_extent(bars: list, start_t, end_t, top, floor):
    """The drawn extent of a base box, capped to its consolidation.

    The consolidation BAND is the upper half of the box: closes at or above
    mid = (top + floor) / 2. The drawn box runs from the first bar whose close
    is in the band to the last bar whose close is in the band. Bars before
    that are the advance INTO the base (the judges: "the left edge and floor
    take in the run-up bars"); bars after it broke out of the band downward
    (a rollover or breakdown the box should not swallow). A shakeout that
    closes below the band and recovers stays inside. The drawn top / floor
    are the highest high / lowest low over the CONSOLIDATION bars (the break
    bar's own range is not part of the base).

    v3 (REPORT_TIERS_V3.md): the drawn box ENDS AT its break bar -- the first
    close outside the band after the consolidation:
      breakout   the first close ABOVE `top` after the band starts;
      breakdown  otherwise, the bar after the last close in the band when the
                 span runs on below it (never recovered, so not a shakeout).
    It is also at most MAX_BOX_BARS wide, break bar included (the oldest bars
    are the ones dropped). `break` says which ("breakout" / "breakdown" /
    None). For base_catalog boxes `top` is the window's own highest high, so
    only a breakdown can occur there; the breakout branch serves callers whose
    top line is a level (a rim, a pivot).

    Returns {start_t, end_t, top, floor, break}, or None when the span is
    unknown or no close is in the band.
    """
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    if s is None or e is None or top is None or floor is None:
        return None
    if s > e:
        s, e = e, s
    top = float(top)
    mid = (top + float(floor)) / 2.0
    inside = [i for i in range(s, e + 1) if bars[i]["c"] >= mid]
    if not inside:
        return None
    i0 = inside[0]
    brk, kind = None, None
    for j in range(i0 + 1, e + 1):
        if bars[j]["c"] > top:
            brk, kind = j, "breakout"
            break
    if brk is None and inside[-1] < e:
        brk, kind = inside[-1] + 1, "breakdown"
    cons_end = e if brk is None else brk - 1
    end = e if brk is None else brk
    start = min(cons_end, max(i0, end - MAX_BOX_BARS + 1))
    span = bars[start:cons_end + 1]
    return {
        "start_t": bars[start]["t"],
        "end_t": bars[end]["t"],
        "top": float(max(b["h"] for b in span)),
        "floor": float(min(b["l"] for b in span)),
        "break": kind,
    }


def failed_breakout(bars: list, start_t, end_t, line) -> bool:
    """True when a close in [start_t, end_t] went ABOVE `line` and the span's
    last close is back at or below it: the breakout already happened and
    failed, so a box drawn under `line` is stale (v3: cup-with-handle boxes
    "stale after a failed breakout"). False when the span is unknown, never
    broke out, or is still above the line."""
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    if s is None or e is None or line is None or s > e:
        return False
    line = float(line)
    broke = any(bars[i]["c"] > line for i in range(s, e + 1))
    return bool(broke and bars[e]["c"] <= line)


def handle_extent(bars: list, start_t, end_t, lip):
    """The drawn extent of a cup's HANDLE: from its first bar up to (not
    including) the first bar that CLOSES above the lip (the cup rim). Handle
    bars past a breakout are not handle (the v2 judges: "the handle is drawn
    after the breakout, too long"). top / floor are recomputed over the drawn
    bars. Returns {start_t, end_t, top, floor}; None when the span is unknown
    or the very first handle bar already broke out (no handle to draw).
    """
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    if s is None or e is None or lip is None or s > e:
        return None
    last = e
    for i in range(s, e + 1):
        if bars[i]["c"] > float(lip):
            last = i - 1
            break
    if last < s:
        return None
    span = bars[s:last + 1]
    return {
        "start_t": bars[s]["t"],
        "end_t": bars[last]["t"],
        "top": float(max(b["h"] for b in span)),
        "floor": float(min(b["l"] for b in span)),
    }


def extent_anchors(ext: dict) -> list:
    """A capped extent as the two-corner anchors a box renderer reads."""
    return [{"t": ext["start_t"], "price": ext["top"]},
            {"t": ext["end_t"], "price": ext["floor"]}]


def ema_series(closes: list, period: int) -> list:
    """EMA seeded exactly as the pullback detectors seed theirs (an SMA of the
    first `period` closes, then the recursion), so its last value IS the level
    the detector drew. None before the seed bar."""
    out: list = [None] * len(closes)
    if len(closes) < period:
        return out
    k = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    out[period - 1] = ema
    for i in range(period, len(closes)):
        ema = closes[i] * k + ema * (1.0 - k)
        out[i] = ema
    return out


def _line_at(p1, p2, x, space):
    """The fitted line through (x1, price1), (x2, price2) at bar x."""
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2:
        return y1
    f = (x - x1) / (x2 - x1)
    if space == "log" and y1 > 0 and y2 > 0:
        return math.exp(math.log(y1) + (math.log(y2) - math.log(y1)) * f)
    return y1 + (y2 - y1) * f


def lane_verdict(bars: list, geometry: dict):
    """(draw_lanes, reason) for a flag's two lanes [u1, u2, l1, l2].

    Both lines are extended over the drawn span (first to last anchor bar),
    each in the space it was fitted in. 'crossing' when the upper lane is not
    above the lower one at either end; 'diverging' when the channel at the
    right end is more than LANE_DIVERGE_RATIO times as wide as at the left.
    """
    pos = _index(bars)
    a = geometry.get("anchors") or []
    if len(a) != 4:
        return True, None
    xs = [pos.get(p.get("t")) for p in a]
    if any(x is None for x in xs):
        return True, None
    spaces = list((geometry.get("extras") or {}).get("line_spaces") or []) + ["price", "price"]
    up = ((xs[0], a[0]["price"]), (xs[1], a[1]["price"]))
    dn = ((xs[2], a[2]["price"]), (xs[3], a[3]["price"]))
    left, right = min(xs), max(xs)
    w_left = _line_at(*up, left, spaces[0]) - _line_at(*dn, left, spaces[1])
    w_right = _line_at(*up, right, spaces[0]) - _line_at(*dn, right, spaces[1])
    if w_left <= 0 or w_right <= 0:
        return False, "crossing"
    if w_right > LANE_DIVERGE_RATIO * w_left:
        return False, "diverging"
    return True, None


def atr14(bars: list, n: int = 14):
    """Mean true range of the last `n` bars (fewer when the series is short); None when unknown."""
    if not bars:
        return None
    k = min(n, len(bars))
    trs = []
    for j in range(len(bars) - k, len(bars)):
        h, lo = float(bars[j]["h"]), float(bars[j]["l"])
        if j > 0:
            pc = float(bars[j - 1]["c"])
            trs.append(max(h, pc) - min(lo, pc))
        else:
            trs.append(h - lo)
    a = sum(trs) / len(trs)
    return a if a > 0 else None


def pivot_base_verdict(bars: list, start_t, end_t, price):
    """(draw, reason) for a base's pivot line at `price` over [start_t, end_t].

    Round-2 fix (REPORT_TEAM_SET.md: the pivot was pinned to the last bar's
    high with no base under it, or to a peak far above price):
      far_from_price  the line is more than PIVOT_NEAR_ATR ATR from the last close;
      no_base         fewer than PIVOT_BASE_MIN_BARS closes of the span sit in the
                      band [price - PIVOT_BASE_BAND_ATR ATR, price + 0.1 ATR].
    (True, None) otherwise; (True, None) when the span or ATR is unknown (the
    line draws as before rather than vanish on missing data)."""
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    at = atr14(bars)
    if s is None or e is None or price is None or not at:
        return True, None
    if s > e:
        s, e = e, s
    price = float(price)
    if abs(float(bars[-1]["c"]) - price) > PIVOT_NEAR_ATR * at:
        return False, "far_from_price"
    lo, hi = pivot_band(price, at)
    n_in = sum(1 for j in range(s, e + 1) if lo <= float(bars[j]["c"]) <= hi)
    if n_in < PIVOT_BASE_MIN_BARS:
        return False, "no_base"
    return True, None


def pivot_band(price, at):
    """(lo, hi): the flat-base band under a pivot line at `price` -- PIVOT_BASE_BAND_ATR ATR deep,
    a close up to 0.1 ATR over the line counting as in it. The one definition of "in the band"."""
    price = float(price)
    return price - PIVOT_BASE_BAND_ATR * at, price + 0.1 * at


def flat_shape_verdict(bars: list, start_t, end_t, price):
    """(draw, reason) for a flat base's SHAPE over [start_t, end_t] under a line at `price`.

    Round 3 (REPORT_TEAM_SET_R2.md: the bc:flat-base line still landed on a stair-step or a deep V):
      stair_step  the closes IN THE BAND (`pivot_band`) trend: the least-squares slope of those
                  closes against their bar index exceeds FLAT_MAX_SLOPE_ATR ATR per bar in size;
      deep_v      from the first in-band close to the span's end, the lowest low sits more than
                  FLAT_MAX_DIP_ATR ATR below the band, i.e. a V-shaped drop and recovery, not a base.
    Both are read from the first in-band close on, so the advance INTO a base (bars below the band
    before it starts) is neither a stair-step nor a V. (True, None) otherwise, and when the span or
    ATR is unknown or no close is in the band (pivot_base_verdict owns that case)."""
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    at = atr14(bars)
    if s is None or e is None or price is None or not at:
        return True, None
    if s > e:
        s, e = e, s
    band_lo, band_hi = pivot_band(price, at)
    inside = [j for j in range(s, e + 1) if band_lo <= float(bars[j]["c"]) <= band_hi]
    if not inside:
        return True, None
    xs = [float(j) for j in inside]
    ys = [float(bars[j]["c"]) for j in inside]
    if len(xs) >= 2:
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        den = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 0.0
        if abs(slope) > FLAT_MAX_SLOPE_ATR * at:
            return False, "stair_step"
    if band_lo - min(float(bars[j]["l"]) for j in range(inside[0], e + 1)) > FLAT_MAX_DIP_ATR * at:
        return False, "deep_v"
    return True, None


def pole_top_index(bars: list, b0: int, b1: int) -> int:
    """Round 3 (REPORT_TEAM_SET_R2.md: the pole's top sat on a lower or later high, so it missed the
    real peak): the pole's TRUE top, the highest high from the pole's first bar `b0` to the bar
    before the flag starts (`b1`, the detector's pole-top pivot; its flag begins at b1 + 1). Ties
    keep the earliest bar. Display-only: the detector's pivot_ts / levels are untouched."""
    top = b0
    for j in range(b0, b1 + 1):
        if float(bars[j]["h"]) > float(bars[top]["h"]):
            top = j
    return top


def flat_base_box(bars: list, base_start_t, base_end_t, base_bars=None, base_low=None):
    """Round 4 (REPORT_TEAM_SET_R3.md: round 3's contiguous run cut the flat_base box to a 4-10 bar
    pause with the real base to its left; some lines sat on the breakout bar's high or were already
    broken). Returns (box, None) or (None, reason) for the detector's base [base_start_t, base_end_t]:

      line   the base's top cluster (`robust_top`) over its bars EXCLUDING the last bar of the
             series -- never set by the (breakout) bar being read or by one spike wick;
      broken a close above the band (`pivot_band`) from the base start to the bar BEFORE the last:
             the line was already broken, the box is stale (a break on the last bar is the news);
      end    the latest bar within FLAT_RUN_NEAR_BARS of the last bar whose close is in the band,
             or the last bar itself when it closes above the band (the breakout bar, which ends the
             box but is not part of the base); none -> left_band;
      start  walking left from the end, the run of in-band closes tolerating up to
             FLAT_RUN_GAP_BARS closes outside the band (a shakeout, a gap), stopping at the next one
             or at a close above the band; never narrower than the detector's own base length
             `base_bars` (default: the base span), never wider than MAX_BOX_BARS. The band's
             floor is never under the detector's own `base_low` (when given), and a run reaching
             LEFT of the detector's base starts on a close in the base's upper half (over the
             midpoint of the line and `base_low`): the advance INTO the base is not the base.
             Round 5 (REPORT_TEAM_SET_R4.md): leading closes under the band that the next close
             rises from are trimmed off the left edge (the width floor yields to this).
      below_box     (round 5) the last close is under the box's floor: the base already failed;
      still_rising  (round 5) the box's closes rise faster than FLAT_MAX_SLOPE_ATR ATR per bar and
                    its highest high is in its last FLAT_FRESH_HIGH_BARS bars: an advance, not a base.

    box = {start_t, end_t, top (= the line), floor (lowest low of the base bars), price, break}."""
    pos = _index(bars)
    s, e = pos.get(base_start_t), pos.get(base_end_t)
    at = atr14(bars)
    if s is None or e is None or not at or len(bars) < 2:
        return None, "unknown"
    if s > e:
        s, e = e, s
    last = len(bars) - 1
    top_end = max(s, min(e, last - 1))
    line = robust_top(bars, s, top_end, at)
    lo, hi = pivot_band(line, at)
    mid = None
    if base_low is not None:
        lo = max(lo, float(base_low))
        mid = (line + float(base_low)) / 2.0
    for j in range(s, last):
        if float(bars[j]["c"]) > hi:
            return None, "broken"

    def inside(j):
        return lo <= float(bars[j]["c"]) <= hi

    breakout = float(bars[last]["c"]) > hi
    if breakout:
        end, run_end = last, last - 1
    else:
        end = next((j for j in range(last, max(s, last - FLAT_RUN_NEAR_BARS) - 1, -1) if inside(j)), None)
        if end is None:
            return None, "left_band"
        run_end = end
    r0, outside, j = run_end, 0, run_end
    while j - 1 >= 0:
        k = j - 1
        ck = float(bars[k]["c"])
        if ck > hi:
            break
        if lo <= ck:
            r0 = k
        else:
            outside += 1
            if outside > FLAT_RUN_GAP_BARS:
                break
        j = k
    while mid is not None and r0 < s and float(bars[r0]["c"]) < mid:
        r0 += 1                    # the run-up into the base is not the base
    width = int(base_bars) if base_bars else (e - s + 1)
    r0 = max(0, min(r0, run_end - width + 1))
    r0 = max(r0, end - MAX_BOX_BARS + 1)
    r0 = min(r0, run_end)
    # round 5: the left edge never takes in the run-up -- a leading close under the band that the
    # next close rises from is the advance INTO the base (the width floor above yields to this)
    band_lo = pivot_band(line, at)[0]
    while r0 < run_end - 1 and float(bars[r0]["c"]) < band_lo \
            and float(bars[r0 + 1]["c"]) > float(bars[r0]["c"]):
        r0 += 1
    floor = float(min(float(b["l"]) for b in bars[r0:run_end + 1]))
    if float(bars[last]["c"]) < floor:
        return None, "below_box"          # round 5: already back under the box
    if run_end - r0 >= 2:
        cl = [float(bars[j]["c"]) for j in range(r0, run_end + 1)]
        xs = list(range(len(cl)))
        mx, my = sum(xs) / len(xs), sum(cl) / len(cl)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, cl)) / sum((x - mx) ** 2 for x in xs)
        top_j = max(range(r0, run_end + 1), key=lambda j: (float(bars[j]["h"]), j))
        if slope > FLAT_MAX_SLOPE_ATR * at and run_end - top_j < FLAT_FRESH_HIGH_BARS:
            return None, "still_rising"   # round 5: an advance still making highs, not a base
    return {
        "start_t": bars[r0]["t"],
        "end_t": bars[end]["t"],
        "top": line,
        "floor": floor,
        "price": line,
        "break": "breakout" if breakout else None,
    }, None


def robust_top(bars: list, s: int, e: int, at):
    """Round 4 (REPORT_TEAM_SET_R3.md: the bc:flat-base line sat on the single highest wick, a
    spike or a failed-breakout wick above the true flat top): the base's top CLUSTER. Walking the
    highs of bars s..e from the highest down, the first high with at least TOP_MIN_TOUCHES highs
    (itself included) within TOP_CLUSTER_ATR ATR at or below it; the line is the (upper) median of
    that cluster -- always one bar's real high, never an invented price. The highest high when no
    cluster qualifies or ATR is unknown; None for an empty span."""
    hs = sorted((float(bars[j]["h"]) for j in range(s, e + 1)), reverse=True)
    if not hs:
        return None
    if not at:
        return hs[0]
    for h in hs:
        cl = [x for x in hs if h - TOP_CLUSTER_ATR * at <= x <= h]
        if len(cl) >= TOP_MIN_TOUCHES:
            cl.sort()
            return cl[len(cl) // 2]        # the (upper) median: always a real bar's high
    return hs[0]


def flat_range_verdict(bars: list, start_t, end_t, price):
    """(draw, reason) for a flat base's RANGE over [start_t, end_t] under a line at `price`.
    Round 4 (REPORT_TEAM_SET_R3.md: bc:flat-base still fired on wide choppy ranges and on
    recoveries from deep declines):
      wide_range     from the first in-band close (`pivot_band`) to the span's end, the highest high
                     minus the lowest low exceeds FLAT_MAX_RANGE_ATR ATR(14);
      deep_decline   the span's lowest low sits more than FLAT_MAX_DRAWDOWN under the highest high
                     of the DRAWDOWN_LOOKBACK bars up to the span's start (the 52-week / available
                     high): a recovery from a deep decline, not a base near the highs.
    (True, None) otherwise and when the span or ATR is unknown."""
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    at = atr14(bars)
    if s is None or e is None or price is None or not at:
        return True, None
    if s > e:
        s, e = e, s
    price = float(price)
    lo, hi = pivot_band(price, at)
    first = next((j for j in range(s, e + 1) if lo <= float(bars[j]["c"]) <= hi), s)
    span = bars[first:e + 1]
    if (max(float(b["h"]) for b in span) - min(float(b["l"]) for b in span)) > FLAT_MAX_RANGE_ATR * at:
        return False, "wide_range"
    prior = bars[max(0, s - DRAWDOWN_LOOKBACK + 1):s + 1]
    peak = max(float(b["h"]) for b in prior)
    if peak > 0 and min(float(b["l"]) for b in bars[s:e + 1]) < peak * (1.0 - FLAT_MAX_DRAWDOWN):
        return False, "deep_decline"
    return True, None


def gap_island(bars: list, s: int, e: int) -> bool:
    """True when the bars s..e hold the low of an ISLAND: a gap down (a bar whose high is under the
    prior bar's low) and, later, a gap up (a bar whose low is over the prior bar's high), the bars
    between them -- the cup's low among them -- all under both gap edges. Searched from s to the
    last bar (the gap up may come after the cup)."""
    if s is None or e is None or s > e:
        return False
    low_j = min(range(s, e + 1), key=lambda j: float(bars[j]["l"]))
    last = len(bars) - 1
    for j in range(max(1, s), low_j + 1):
        if not float(bars[j]["h"]) < float(bars[j - 1]["l"]):
            continue
        top = float(bars[j]["h"])
        for k in range(j + 1, last + 1):
            if k > low_j and float(bars[k]["l"]) > float(bars[k - 1]["h"]):
                if top < min(float(bars[j - 1]["l"]), float(bars[k]["l"])):
                    return True
            top = max(top, float(bars[k]["h"]))
            if top >= float(bars[j - 1]["l"]):
                break
    return False


def cup_shape_verdict(bars: list, cup_start_t, cup_end_t, rim):
    """(draw, reason) for a cup-with-handle's rim line. Round 4 (REPORT_TEAM_SET_R3.md: some cups
    were gap islands, some rims stale -- spiked through and fell back):
      gap_island   the cup's low sits on an island (`gap_island`);
      rim_broken   a close above the rim AFTER the cup's low and BEFORE the last bar: the rim was
                   already broken (a break on the last bar is the news, kept);
      ...          `cup_reach_verdict` (rim_too_old / gap_crater / spike_rim / short_of_rim);
      prior_peak   (round 7) the right side never reached the higher peak just before the cup's
                   start (`prior_peak`).
    (True, None) otherwise and when a span is unknown."""
    pos = _index(bars)
    cs, ce = pos.get(cup_start_t), pos.get(cup_end_t)
    if cs is None or ce is None or not rim or rim.get("price") is None:
        return True, None
    if cs > ce:
        cs, ce = ce, cs
    if gap_island(bars, cs, ce):
        return False, "gap_island"
    low_j = min(range(cs, ce + 1), key=lambda j: float(bars[j]["l"]))
    lip = float(rim["price"])
    for j in range(low_j + 1, len(bars) - 1):
        if float(bars[j]["c"]) > lip:
            return False, "rim_broken"
    ok, why = cup_reach_verdict(bars, pos, low_j, rim)
    if ok and prior_peak(bars, cs, low_j):
        return False, "prior_peak"
    return ok, why


def cup_reach_verdict(bars: list, pos: dict, low_j: int, rim: dict):
    """Round 5 (REPORT_TEAM_SET_R4.md: rims the right side never reached, a rim floating above every
    bar, a rim on a pre-gap-down high over a gap-down crater). (draw, reason) for the rim line, the
    cup's low at bar `low_j`:
      rim_too_old   the rim's left lip (rim.start_t) is more than RIM_MAX_AGE_BARS bars before the
                    last bar -- older than the chart's default zoom, so the line floats over every bar;
      gap_crater    a gap down (a bar's high under the prior bar's low) of at least CRATER_GAP_ATR
                    ATR(14) -- the ATR before the gap -- between the lip and the cup's low;
      short_of_rim  the highest high from the bar after the cup's low to the last bar sits further
                    under the rim than RIM_REACH_ATR x ATR(14) (round 6: no percent-of-price allowance);
      spike_rim     (round 6) the lip is a wick spike over the bodies around it (`spike_rim`; round 7:
                    no crash after it is required).
    (True, None) when the lip or ATR is unknown."""
    lip_j = pos.get(rim.get("start_t"))
    last = len(bars) - 1
    if lip_j is None or low_j is None or lip_j > low_j:
        return True, None
    if last - lip_j > RIM_MAX_AGE_BARS:
        return False, "rim_too_old"
    for j in range(max(1, lip_j + 1), low_j + 1):
        gap = float(bars[j - 1]["l"]) - float(bars[j]["h"])
        aj = atr14(bars[:j])
        if aj and gap >= CRATER_GAP_ATR * aj:
            return False, "gap_crater"
    if spike_rim(bars, lip_j):
        return False, "spike_rim"
    at = atr14(bars)
    if low_j < last and at:
        p = float(rim["price"])
        reach = max(float(b["h"]) for b in bars[low_j + 1:last + 1])
        if p - reach > RIM_REACH_ATR * at:
            return False, "short_of_rim"
    return True, None


def spike_rim(bars: list, lip_j: int) -> bool:
    """Round 6 (REPORT_TEAM_SET_R5.md case_165: "Rim uses the wick spike before a gap-down crash"), round 7
    (REPORT_CUP_R6.md: "rim anchored on a single wick spike that sits well above the surrounding bodies",
    no crash after it): True when the lip bar's high sits more than SPIKE_RIM_ATR ATR(14) -- the ATR up to
    the lip -- above every open and close within SPIKE_RIM_BARS bars of it (a wick above the bodies around
    it). Round 6 also required a crash after the lip; round 7 dropped that half. A fast decline from a lip
    that sits on its bodies is a real lip. False when the ATR is unknown."""
    if lip_j is None or not 0 <= lip_j < len(bars):
        return False
    at = atr14(bars[:lip_j + 1])
    if not at:
        return False
    hi = float(bars[lip_j]["h"])
    lo_j, hi_j = max(0, lip_j - SPIKE_RIM_BARS), min(len(bars) - 1, lip_j + SPIKE_RIM_BARS)
    body_top = max(max(float(bars[j]["o"]), float(bars[j]["c"])) for j in range(lo_j, hi_j + 1))
    return hi - body_top > SPIKE_RIM_ATR * at


def prior_peak(bars: list, cup_start_j: int, low_j: int) -> bool:
    """Round 7 (REPORT_CUP_R6.md: "Rim sits partway down the first decline instead of on the left-lip peak
    above it"; the lip is the highest high from the DETECTOR'S cup start, which can fall after the real
    peak): True when the highest high in the PRIOR_PEAK_BARS bars before `cup_start_j` sits more than
    PRIOR_PEAK_REACH_ATR ATR(14) above the right side's highest high (bar after the cup's low `low_j` to
    the last bar) -- the right side never reached the true left peak, so the drawn lip is a secondary high
    on the decline. A rejection, not a line move: the rim is never re-anchored. False when there is no
    bar before the cup's start, no bar after its low, or the ATR is unknown."""
    last = len(bars) - 1
    if cup_start_j is None or low_j is None or cup_start_j <= 0 or low_j >= last:
        return False
    at = atr14(bars)
    if not at:
        return False
    peak = max(float(b["h"]) for b in bars[max(0, cup_start_j - PRIOR_PEAK_BARS):cup_start_j])
    reach = max(float(b["h"]) for b in bars[low_j + 1:last + 1])
    return peak - reach > PRIOR_PEAK_REACH_ATR * at


def pullback_handle(bars: list, cup_start_t, cup_end_t, rim):
    """Round 6 (REPORT_TEAM_SET_R5.md: "the handle pullback is not boxed"): (box, reason) for a cup's HANDLE
    as the pullback a trader boxes -- from the right side's peak (the LATEST highest high after the cup's
    low) to the last bar, or to the bar before the first close above the rim (the breakout bar is not
    handle). box = {start_t, end_t, top, floor}, top/floor over the boxed bars, the top capped at the rim
    (round 7, REPORT_CUP_R6.md: a right-side peak whose wick pokes over the rim drew the box above the
    rim line). (None, reason) when:
      no_pullback  the peak is the last boxable bar (still rising: nothing to box);
      short        fewer than HANDLE_MIN_BARS bars from the peak to the end;
      long         more than HANDLE_MAX_PULLBACK_BARS bars after the peak;
      deep         the floor sits in the cup's lower half (under the midpoint of rim and cup low);
      unknown      a span or the rim is unknown.
    Replaces round 3-5's handle_verdict over the detector's last sub-box: that box began a fixed 5/10/15/20/25
    bars from the end, not at the peak, and its round-4 depth rule (a third of the cup's depth) withheld 23
    of the 35 judged cups' handles, most of them the pullbacks the judges asked to have boxed."""
    pos = _index(bars)
    cs, ce = pos.get(cup_start_t), pos.get(cup_end_t)
    rim_p = (rim or {}).get("price")
    if cs is None or ce is None or rim_p is None:
        return None, "unknown"
    if cs > ce:
        cs, ce = ce, cs
    rim_p = float(rim_p)
    low_j = min(range(cs, ce + 1), key=lambda j: float(bars[j]["l"]))
    end = len(bars) - 1
    for j in range(low_j + 1, len(bars)):
        if float(bars[j]["c"]) > rim_p:
            end = j - 1
            break
    if end <= low_j:
        return None, "no_pullback"
    pk = low_j + 1
    for j in range(low_j + 1, end + 1):
        if float(bars[j]["h"]) >= float(bars[pk]["h"]):
            pk = j
    if pk >= end:
        return None, "no_pullback"
    if end - pk + 1 < HANDLE_MIN_BARS:
        return None, "short"
    if end - pk > HANDLE_MAX_PULLBACK_BARS:
        return None, "long"
    span = bars[pk:end + 1]
    floor = min(float(b["l"]) for b in span)
    cup_low = float(bars[low_j]["l"])
    if floor < cup_low + (rim_p - cup_low) / 2.0:
        return None, "deep"
    return {"start_t": bars[pk]["t"], "end_t": bars[end]["t"],
            "top": max(floor, min(float(bars[pk]["h"]), rim_p)), "floor": floor}, None


def flat_top_verdict(bars: list, start_t, end_t, price):
    """Round 5 (REPORT_TEAM_SET_R4.md: a bc:flat-base line on the fresh high of a grinding uptrend
    over empty space, rounded / deep-V bases). (draw, reason) for a pivot line at `price` over
    [start_t, end_t]:
      fresh_high  the first bar of the span whose high reaches within TOP_TOUCH_ATR ATR of the line
                  is within FRESH_HIGH_BARS bars of the last bar -- no base was ever under it;
      thin_base   fewer than BASE_MIN_FRAC of the span's closes sit in the band (`pivot_band`);
      deep_base   the span's lowest close sits more than BASE_MAX_CLOSE_DEPTH_ATR ATR under the line.
    (True, None) when the span or ATR is unknown."""
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    at = atr14(bars)
    if s is None or e is None or price is None or not at:
        return True, None
    if s > e:
        s, e = e, s
    price = float(price)
    last = len(bars) - 1
    first = next((j for j in range(s, e + 1) if float(bars[j]["h"]) >= price - TOP_TOUCH_ATR * at), None)
    if first is not None and last - first < FRESH_HIGH_BARS:
        return False, "fresh_high"
    lo, hi = pivot_band(price, at)
    n_in = sum(1 for j in range(s, e + 1) if lo <= float(bars[j]["c"]) <= hi)
    if n_in < BASE_MIN_FRAC * (e - s + 1):
        return False, "thin_base"
    if price - min(float(bars[j]["c"]) for j in range(s, e + 1)) > BASE_MAX_CLOSE_DEPTH_ATR * at:
        return False, "deep_base"
    return True, None


def flag_shape_verdict(bars: list, pos: dict, d: dict):
    """(draw, reason) for a bull_flag's SHAPE. Round 4 (REPORT_TEAM_SET_R3.md: slow-grind poles,
    2-3 bar flags, flags sloping up):
      slow_pole    the pole (pole start low to its true top, `pole_top_index`) rises less than
                   POLE_MIN_ATR ATR(14) -- the ATR of the bars up to the pole start -- or takes more
                   than POLE_MAX_BARS bars;
      short_flag   the flag (the bars after the detector's pole-top pivot) has fewer than
                   FLAG_MIN_BARS bars;
      rising_flag  the flag channel's midline rises (slope > 0) over the drawn lanes.
    Round 5 (REPORT_TEAM_SET_R4.md: pole and flag on separate legs, steep deep drops, flags that
    retraced much of the pole):
      detached_flag  the lanes' first bar is more than FLAG_ADJACENT_BARS after the pole's top;
      steep_flag     the lanes' midline falls faster per bar than FLAG_MAX_FALL_RATIO x the pole's
                     rise per bar;
      deep_flag      the lowest low after the pole's top is more than FLAG_MAX_RETRACE of the pole
                     under the pole's top.
    (True, None) when the pole or flag bars are unknown."""
    pts = d.get("pivot_ts") or []
    b0 = pos.get(pts[0]) if len(pts) > 1 else None
    b1 = pos.get(pts[1]) if len(pts) > 1 else None
    if b0 is None or b1 is None or b0 > b1:
        return True, None
    last = pos.get(pts[-1]) if len(pts) > 2 else None
    last = len(bars) - 1 if last is None else last
    top = pole_top_index(bars, b0, b1)
    at = atr14(bars[:b0 + 1]) or atr14(bars)
    height = float(bars[top]["h"]) - float(bars[b0]["l"])
    if top - b0 > POLE_MAX_BARS or (at and height < POLE_MIN_ATR * at):
        return False, "slow_pole"
    if last - b1 < FLAG_MIN_BARS:
        return False, "short_flag"
    g = d.get("geometry") or {}
    a = g.get("anchors") or []
    xs = [pos.get(p.get("t")) for p in a] if len(a) == 4 else []
    if len(xs) == 4 and None not in xs:
        spaces = list((g.get("extras") or {}).get("line_spaces") or []) + ["price", "price"]
        up = ((xs[0], a[0]["price"]), (xs[1], a[1]["price"]))
        dn = ((xs[2], a[2]["price"]), (xs[3], a[3]["price"]))
        left, right = min(xs), max(xs)
        rise = ((_line_at(*up, right, spaces[0]) + _line_at(*dn, right, spaces[1]))
                - (_line_at(*up, left, spaces[0]) + _line_at(*dn, left, spaces[1])))
        if rise > 0:
            return False, "rising_flag"
        # round 5: pole and flag are ONE move -- the lanes start right after the pole's top
        if left - top > FLAG_ADJACENT_BARS:
            return False, "detached_flag"
        # round 5: a steep flag -- its midline falls faster than FLAG_MAX_FALL_RATIO x the pole rose
        pole_rate = height / max(1, top - b0)
        if right > left and pole_rate > 0 and \
                -(rise / 2.0) / (right - left) > FLAG_MAX_FALL_RATIO * pole_rate:
            return False, "steep_flag"
    # round 5: a deep flag -- it gave back more than FLAG_MAX_RETRACE of the pole
    if top < last and height > 0:
        flag_low = min(float(b["l"]) for b in bars[top + 1:last + 1])
        if float(bars[top]["h"]) - flag_low > FLAG_MAX_RETRACE * height:
            return False, "deep_flag"
    return True, None


def _flag_lanes(bars: list, pos: dict, d: dict):
    """(upper(x), lower(x), left, right) for a bull_flag's drawn lanes, or None when unknown."""
    g = d.get("geometry") or {}
    a = g.get("anchors") or []
    xs = [pos.get(p.get("t")) for p in a] if len(a) == 4 else []
    if len(xs) != 4 or None in xs:
        return None
    spaces = list((g.get("extras") or {}).get("line_spaces") or []) + ["price", "price"]
    up = ((xs[0], a[0]["price"]), (xs[1], a[1]["price"]))
    dn = ((xs[2], a[2]["price"]), (xs[3], a[3]["price"]))
    return (lambda x: _line_at(*up, x, spaces[0]), lambda x: _line_at(*dn, x, spaces[1]),
            min(xs), max(xs))


def _flag_bars(pos: dict, d: dict, n: int):
    """(b0, b1, last): the pole's first bar, the detector's pole-top pivot, the flag's last bar."""
    pts = d.get("pivot_ts") or []
    b0 = pos.get(pts[0]) if len(pts) > 1 else None
    b1 = pos.get(pts[1]) if len(pts) > 1 else None
    if b0 is None or b1 is None or b0 > b1:
        return None
    last = pos.get(pts[-1]) if len(pts) > 2 else None
    return b0, b1, (n - 1 if last is None else last)


def flag_edge_verdict(bars: list, pos: dict, d: dict):
    """(draw, reason) for a bull_flag. Round 6 (REPORT_TEAM_SET_R5_CONFIRM.md: a pole from a gap-down
    crash low, flag lanes below a gap down from the pole top, flags already breaking down):
      crash_pole    the highest high of the CRASH_POLE_BARS bars up to the pole's low is at least
                    CRASH_POLE_FRAC of the pole's height above that low: a V back out of a crash;
      gap_detached  a bar from the pole's top to the lanes' first bar opens a TRUE gap down (its high
                    under the prior bar's low) of more than FLAG_GAP_ATR ATR(14) -- `detached_flag`
                    counts bars, so a lane starting the bar after a gap down passed it;
      breaking_down the last close is more than FLAG_BREAKDOWN_ATR ATR(14) under the lower lane.
    (True, None) when the pole, flag or lanes are unknown."""
    fb = _flag_bars(pos, d, len(bars))
    if fb is None:
        return True, None
    b0, b1, last = fb
    top = pole_top_index(bars, b0, b1)
    height = float(bars[top]["h"]) - float(bars[b0]["l"])
    if height > 0:
        pre_hi = max(float(b["h"]) for b in bars[max(0, b0 - CRASH_POLE_BARS):b0 + 1])
        if pre_hi - float(bars[b0]["l"]) >= CRASH_POLE_FRAC * height:
            return False, "crash_pole"
    lanes = _flag_lanes(bars, pos, d)
    if lanes is None:
        return True, None
    upper, lower, left, _right = lanes
    for j in range(top + 1, min(left, last) + 1):
        at = atr14(bars[:j])
        if at and float(bars[j - 1]["l"]) - float(bars[j]["h"]) > FLAG_GAP_ATR * at:
            return False, "gap_detached"
    at = atr14(bars[:last + 1])
    if at and lower(last) - float(bars[last]["c"]) > FLAG_BREAKDOWN_ATR * at:
        return False, "breaking_down"
    return True, None


def flag_entry_line(bars: list, pos: dict, d: dict):
    """Round 6 (REPORT_TEAM_SET_R5_CONFIRM.md: the entry set on a reversal wick or spike high far
    above the flag): the DRAWN entry price, or None to keep the detector's levels.entry.

    The detector's entry is the flag's highest HIGH (x 1.001). When that high pokes more than
    ENTRY_SPIKE_ATR ATR(14) above the upper lane at its bar, it is a single wick / spike over the
    flag, and the line is drawn at the flag's highest BODY high (max of open, close) x 1.001
    instead. Display-only: levels.entry -- the alert / trigger -- is untouched."""
    fb = _flag_bars(pos, d, len(bars))
    lanes = _flag_lanes(bars, pos, d)
    if fb is None or lanes is None:
        return None
    _b0, b1, last = fb
    flag = range(b1 + 1, last + 1)
    if not flag:
        return None
    js = max(flag, key=lambda j: (float(bars[j]["h"]), -j))
    at = atr14(bars[:last + 1])
    if not at or float(bars[js]["h"]) - lanes[0](js) <= ENTRY_SPIKE_ATR * at:
        return None
    body = max(max(float(bars[j]["o"]), float(bars[j]["c"])) for j in flag)
    return round(body * 1.001, 4)


def pole_draw_start(bars: list, b0: int, top: int) -> int:
    """Round 7 (REPORT_BULLFLAG_R6.md: the pole ran from an early low through a deep mid-pole
    pullback, a red reversal bar or a sideways base; one started under a long wick in empty space):
    the bar the DRAWN pole starts on, always on a real bar low between b0 and the top.

      final leg  the last bar p whose high has a later pullback (before the top) of at least
                 POLE_LEG_PULLBACK of the pole height: the start moves to the lowest low after p,
                 when that leg is at least POLE_LEG_MIN_FRAC of the height;
      base       the last run of >= POLE_BASE_BARS bars whose closes stay within POLE_BASE_BAND_ATR
                 ATR: the start moves to the lowest low from its last bar on, when at least
                 POLE_BASE_AFTER_FRAC of the height is still above it;
      wick       a start bar whose lower wick is over POLE_WICK_ATR ATR and POLE_WICK_FRAC of the
                 drawn height moves to the next bar when that bar's low is under its body.
    Ties keep the LATER bar (the swing low nearest the thrust). Returns b0 when nothing applies."""
    if not 0 <= b0 < top < len(bars):
        return b0
    hi = float(bars[top]["h"])
    height = hi - float(bars[b0]["l"])
    if height <= 0:
        return b0
    at = atr14(bars[:b0 + 1]) or atr14(bars[:top + 1])
    s = b0

    def low_after(j):
        return min(range(j, top), key=lambda k: (float(bars[k]["l"]), -k))

    for p in range(top - 2, b0 - 1, -1):
        m = low_after(p + 1)
        if float(bars[p]["h"]) - float(bars[m]["l"]) >= POLE_LEG_PULLBACK * height:
            if hi - float(bars[m]["l"]) >= POLE_LEG_MIN_FRAC * height:
                s = m
            break
    if at:
        run_end = None
        for i in range(s, top):
            lo = hi_c = float(bars[i]["c"])
            j = i
            while j + 1 < top:
                c = float(bars[j + 1]["c"])
                if max(hi_c, c) - min(lo, c) > POLE_BASE_BAND_ATR * at:
                    break
                j += 1
                lo, hi_c = min(lo, c), max(hi_c, c)
            if j - i + 1 >= POLE_BASE_BARS:
                run_end = j
        if run_end is not None:
            m = low_after(run_end)
            if hi - float(bars[m]["l"]) >= POLE_BASE_AFTER_FRAC * (hi - float(bars[s]["l"])):
                s = m
        b = bars[s]
        wick = min(float(b["o"]), float(b["c"])) - float(b["l"])
        if s + 1 < top and wick > POLE_WICK_ATR * at and wick > POLE_WICK_FRAC * (hi - float(b["l"])) \
                and float(bars[s + 1]["l"]) < min(float(b["o"]), float(b["c"])):
            s += 1
    return s


def pole_impulse_verdict(bars: list, s: int, top: int):
    """(draw, reason) for the IMPULSE of the DRAWN pole from bar `s` to the top -- the one place a
    pole's thrust is judged (round 9 unified round 7's grind and round 8's two-step here):
      short_pole     the drawn pole rises less than DRAWN_POLE_MIN_ATR ATR(14) (the ATR up to `s`):
                     a spike off a moved start, not a pole (round 9; slow_pole measures the
                     detector's pole from its own first bar);
      grind_pole     its close-to-close efficiency (net close change over the summed absolute close
                     changes) is under GRIND_MAX_EFF while at least GRIND_MIN_DOWN of its bars close
                     down -- a staircase, not an impulse (round 7; down share 0.35 since round 9);
      two_step_pole  a pole of at least TWO_STEP_MIN_BARS bars reaches half its height only after
                     TWO_STEP_LATE_FRAC of its bars: a slow first leg, then the thrust (round 8).
    No single scalar separated all three on the judged set (a 2-bar gap-up pole and a 15-bar pole
    with 40% down closes were both judged 3), so they are three clauses of one verdict. Display
    selection only. (True, None) when the pole is unknown or a single bar."""
    if not 0 <= s < top < len(bars):
        return True, None
    hi = float(bars[top]["h"])
    lo = float(bars[s]["l"])
    height = hi - lo
    if height <= 0:
        return True, None
    at = atr14(bars[:s + 1]) or atr14(bars[:top + 1])
    if at and height < DRAWN_POLE_MIN_ATR * at:
        return False, "short_pole"
    path = sum(abs(float(bars[j]["c"]) - float(bars[j - 1]["c"])) for j in range(s + 1, top + 1))
    if path > 0:
        eff = (float(bars[top]["c"]) - float(bars[s]["c"])) / path
        down = sum(1 for j in range(s + 1, top + 1) if float(bars[j]["c"]) < float(bars[j - 1]["c"]))
        if eff < GRIND_MAX_EFF and down >= GRIND_MIN_DOWN * (top - s):
            return False, "grind_pole"
    n = top - s
    if n >= TWO_STEP_MIN_BARS:
        half = next(j for j in range(s, top + 1) if float(bars[j]["h"]) - lo >= 0.5 * height)
        if (half - s) / n >= TWO_STEP_LATE_FRAC:
            return False, "two_step_pole"
    return True, None


def flag_context_verdict(bars: list, s: int, top: int):
    """(draw, reason) for the CONTEXT of the drawn pole from bar `s` to the top. Round 8 (lab
    REPORT_BULLFLAG_R7.md: the judges accepted the geometry and objected to WHICH flags were drawn --
    rebounds under a prior high or out of a big drop, long two-step advances):
      under_prior_high  the pole's top sits more than LEAD_NEAR_ATR ATR(14) under the highest high
                        of the LEAD_BARS bars ending at the top: a recovery leg, not a leader at its
                        high;
      rebound_pole      the highest high of the REBOUND_BARS bars up to the pole's start is at least
                        REBOUND_FRAC of the pole's height above the start's low: the pole climbs back
                        out of a drop it just made;
    (two_step_pole moved to pole_impulse_verdict in round 9.)
    ATR(14) is the ATR up to the pole start. Display selection only. (True, None) when unknown."""
    if not 0 <= s < top < len(bars):
        return True, None
    hi = float(bars[top]["h"])
    lo = float(bars[s]["l"])
    height = hi - lo
    if height <= 0:
        return True, None
    at = atr14(bars[:s + 1]) or atr14(bars[:top + 1])
    lead = max(float(b["h"]) for b in bars[max(0, top - LEAD_BARS + 1):top + 1])
    if at and lead - hi > LEAD_NEAR_ATR * at:
        return False, "under_prior_high"
    pre = max(float(b["h"]) for b in bars[max(0, s - REBOUND_BARS):s + 1])
    if pre - lo >= REBOUND_FRAC * height:
        return False, "rebound_pole"
    return True, None


def flag_entry_verdict(bars: list, pos: dict, d: dict, entry, lanes=None):
    """(draw, reason) for a bull_flag's DRAWN entry. Round 8 (lab REPORT_BULLFLAG_R7.md case_284: the
    flag dropped two bars below the pole top before its lanes start, so the entry -- the flag's highest
    high -- is set at the pole top, far above the price):
      entry_detached  the bar that sets the entry (the flag's highest high) comes BEFORE the lanes'
                      first bar, while the last close is more than ENTRY_STRANDED_ATR ATR(14) under
                      the drawn `entry`.
    `lanes` is the drawn four-anchor list (extras.draw_anchors) when the lanes were refitted, else the
    detector's anchors are read. (True, None) when the flag, lanes or entry are unknown."""
    fb = _flag_bars(pos, d, len(bars))
    if fb is None or not isinstance(entry, (int, float)):
        return True, None
    _b0, b1, last = fb
    a = lanes if lanes else ((d.get("geometry") or {}).get("anchors") or [])
    xs = [pos.get(p.get("t")) for p in a] if len(a) == 4 else []
    if len(xs) != 4 or None in xs or last <= b1:
        return True, None
    left = min(xs)
    js = max(range(b1 + 1, last + 1), key=lambda j: (float(bars[j]["h"]), -j))
    at = atr14(bars[:last + 1])
    if js < left and at and float(entry) - float(bars[last]["c"]) > ENTRY_STRANDED_ATR * at:
        return False, "entry_detached"
    return True, None


def flag_lanes_verdict(bars: list, anchors: list):
    """(draw, reason) for a bull_flag's DRAWN lanes (`anchors` = the four drawn price-space anchors,
    [upper start, upper end, lower start, lower end]). Round 9 (lab REPORT_BULLFLAG_R8.md: lanes that
    leave much of the flag outside them, R8 case_055 / 831):
      loose_lanes  the lanes hold less than LANE_MIN_BODY_SHARE of the summed body length (|open -
                   close|) of the bars they span, each body clipped to the channel at its bar.
    Doji bodies weigh nothing. (True, None) when the lanes are unknown or the bodies sum to less than
    LANE_MIN_BODY_ATR ATR(14) (the ATR up to the lanes' last bar): too little body to judge."""
    pos = _index(bars)
    xs = [pos.get(p.get("t")) for p in anchors] if anchors and len(anchors) == 4 else []
    if len(xs) != 4 or None in xs:
        return True, None
    up = ((xs[0], float(anchors[0]["price"])), (xs[1], float(anchors[1]["price"])))
    dn = ((xs[2], float(anchors[2]["price"])), (xs[3], float(anchors[3]["price"])))
    inside = total = 0.0
    for j in range(min(xs), max(xs) + 1):
        o, c = float(bars[j]["o"]), float(bars[j]["c"])
        top_b, bot_b = max(o, c), min(o, c)
        u, lo = _line_at(*up, j, "price"), _line_at(*dn, j, "price")
        total += top_b - bot_b
        inside += max(0.0, min(top_b, u) - max(bot_b, lo))
    at = atr14(bars[:max(xs) + 1])
    if total <= 0 or not at or total < LANE_MIN_BODY_ATR * at:
        return True, None
    if inside / total < LANE_MIN_BODY_SHARE:
        return False, "loose_lanes"
    return True, None


def _lsq(xs, ys):
    """(slope, intercept) of the least-squares line -- the detector's own lane fit (price space)."""
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    m = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 0.0
    return m, my - m * mx


def flag_draw_lanes(bars: list, pos: dict, d: dict):
    """Round 7 (REPORT_BULLFLAG_R6.md: loose flags -- a wide first red bar deepening the flag, a flat
    lower lane drawn as a wedge, a lane end hanging off the bars): the four lane anchors to DRAW
    ([upper start, upper end, lower start, lower end], `extras.draw_anchors`), or None to draw the
    detector's own. The detector fits each lane by least squares on the flag's highs / lows; this
    refits the same way, then:
      wide first bar  a first bar with a red body >= FIRST_WIDE_BODY_ATR ATR and a range >=
                      FIRST_WIDE_RATIO x the other bars' median range is left out of the fit (kept
                      when leaving it out would make the lanes rise -- that is not a flag);
      flat wedge      lanes converging under WEDGE_CONV with a lower lane flatter than WEDGE_FLAT_ATR
                      ATR per bar become a parallel channel (one least-squares slope for both);
      floating end    a lane end more than LANE_FLOAT_ATR ATR beyond both its bar and the next bar in
                      is pulled onto the nearer of them.
    Only price-space lanes are refitted; None when lanes would cross or nothing changed."""
    g = d.get("geometry") or {}
    spaces = list((g.get("extras") or {}).get("line_spaces") or []) + ["price", "price"]
    lanes = _flag_lanes(bars, pos, d)
    fb = _flag_bars(pos, d, len(bars))
    if lanes is None or fb is None or spaces[0] != "price" or spaces[1] != "price":
        return None
    _b0, _b1, last = fb
    _u, _l, left, right = lanes
    at = atr14(bars[:last + 1])
    if not at or right - left < 2:
        return None
    H = [float(b["h"]) for b in bars]
    L = [float(b["l"]) for b in bars]
    changed = False
    xs = list(range(left, right + 1))
    f = bars[left]
    rest = sorted(H[j] - L[j] for j in xs[1:])
    med = rest[len(rest) // 2] if len(rest) % 2 else (rest[len(rest) // 2 - 1] + rest[len(rest) // 2]) / 2.0
    if len(xs) >= 4 and float(f["o"]) - float(f["c"]) >= FIRST_WIDE_BODY_ATR * at \
            and med > 0 and H[left] - L[left] >= FIRST_WIDE_RATIO * med:
        cut = xs[1:]
        mu, _ = _lsq(cut, [H[j] for j in cut])
        ml, _ = _lsq(cut, [L[j] for j in cut])
        if mu + ml <= 0:
            xs, changed = cut, True
    mu, cu = _lsq(xs, [H[j] for j in xs])
    ml, cl = _lsq(xs, [L[j] for j in xs])
    x0, x1 = xs[0], xs[-1]
    w0, w1 = (mu * x0 + cu) - (ml * x0 + cl), (mu * x1 + cu) - (ml * x1 + cl)
    if w0 > 0 and w1 < WEDGE_CONV * w0 and abs(ml) <= WEDGE_FLAT_ATR * at:
        # one least-squares slope for both lanes (highs and lows pooled about their own means)
        mx = sum(xs) / len(xs)
        den = 2 * sum((x - mx) ** 2 for x in xs)
        m = sum((x - mx) * (H[x] + L[x]) for x in xs) / den if den else 0.0
        mu = ml = m
        cu = sum(H[x] - m * x for x in xs) / len(xs)
        cl = sum(L[x] - m * x for x in xs) / len(xs)
        changed = True
    u = [mu * x0 + cu, mu * x1 + cu]
    lo = [ml * x0 + cl, ml * x1 + cl]
    for k, (x, nb) in enumerate(((x0, x0 + 1), (x1, x1 - 1))):
        floor = min(L[x], L[nb])
        if floor - lo[k] > LANE_FLOAT_ATR * at:
            lo[k], changed = floor, True
        ceil = max(H[x], H[nb])
        if u[k] - ceil > LANE_FLOAT_ATR * at:
            u[k], changed = ceil, True
    if not changed or u[0] <= lo[0] or u[1] <= lo[1]:
        return None
    t0, t1 = bars[x0]["t"], bars[x1]["t"]
    return [{"t": t0, "price": round(u[0], 6)}, {"t": t1, "price": round(u[1], 6)},
            {"t": t0, "price": round(lo[0], 6)}, {"t": t1, "price": round(lo[1], 6)}]


def ma_tag_verdict(bars: list, pos: dict, extras: dict):
    """(draw, reason) for an MA pullback's TAG (uct_pullback_ma_v5; display / tag filter only, the
    detector still fires). Round 4 (REPORT_TEAM_SET_R3.md: tags on flat or rolling-over MAs, tag
    bars whose low sat above the MA):
      ma_flat     the tagged MA (computed as the detector computes it) rises less than
                  TAG_MIN_RISE_ATR ATR(14) (the ATR at the tag bar) over TAG_SLOPE_BARS bars, at
                  the tag bar or at the last bar -- flat or rolling over;
      tag_off_ma  the tag bar's range never came within TAG_NEAR_ATR ATR(14) of the MA.
    Round 5 (REPORT_TEAM_SET_R4.md: closes already under a flattening MA, a tag bar well above it):
      tag_above_ma   the tag bar's LOW sits more than TAG_ABOVE_ATR ATR above the MA;
      below_flat_ma  at least TAG_BELOW_CLOSES of the TAG_SLOPE_BARS closes before the tag sat under
                     the MA while it rose less than TAG_FLAT_RISE_ATR ATR over TAG_SLOPE_BARS bars.
    (True, None) when the MA, the tag bar or ATR is unknown."""
    spec = TAGGED_MA.get(str((extras or {}).get("tagged_ma") or ""))
    tj = pos.get((extras or {}).get("tag_t"))
    if not spec or tj is None:
        return True, None
    from api.services.pattern_engine.detectors.uct import uct_setups_common as U
    kind, period = spec
    closes = [float(b["c"]) for b in bars]
    ma = U.ema(closes, period) if kind == "ema" else U.sma(closes, period)
    at = atr14(bars[:tj + 1])
    for j in (tj, len(bars) - 1):
        if not at or j - TAG_SLOPE_BARS < 0 or ma[j] is None or ma[j - TAG_SLOPE_BARS] is None:
            continue
        if ma[j] - ma[j - TAG_SLOPE_BARS] < TAG_MIN_RISE_ATR * at:
            return False, "ma_flat"
    m = ma[tj]
    if at and m is not None:
        lo_, hi_ = float(bars[tj]["l"]), float(bars[tj]["h"])
        dist = 0.0 if lo_ <= m <= hi_ else min(abs(lo_ - m), abs(hi_ - m))
        if dist > TAG_NEAR_ATR * at:
            return False, "tag_off_ma"
        # round 5: the tag bar's LOW well above the MA never tagged it (a premature triangle)
        if lo_ - m > TAG_ABOVE_ATR * at:
            return False, "tag_above_ma"
    # round 5: closes already under a flattening MA before the tag -- chop / breakdown, not a pullback
    if at and tj - TAG_SLOPE_BARS >= 0 and ma[tj] is not None and ma[tj - TAG_SLOPE_BARS] is not None:
        under = sum(1 for j in range(tj - TAG_SLOPE_BARS, tj)
                    if ma[j] is not None and float(bars[j]["c"]) < ma[j])
        if under >= TAG_BELOW_CLOSES and ma[tj] - ma[tj - TAG_SLOPE_BARS] < TAG_FLAT_RISE_ATR * at:
            return False, "below_flat_ma"
    return True, None


def stop_segment(bars: list, pos: dict, extras: dict):
    """Round 5 (REPORT_TEAM_SET_R4.md: the stop was drawn from the far left -- the 10-session high
    the pullback came off -- not from the tag bar): {start_t, end_t, price} = the tag bar's low from
    the TAG bar to the last bar, or None when the tag bar is unknown. Display only: levels.stop is
    the same price and is untouched."""
    tj = pos.get((extras or {}).get("tag_t"))
    if tj is None or not bars:
        return None
    return {"start_t": int(bars[tj]["t"]), "end_t": int(bars[-1]["t"]), "price": float(bars[tj]["l"])}


def flag_pause_verdict(bars: list, pos: dict, d: dict):
    """(is_pause, reason) for a bull_flag: its flag must be a PAUSE under the pole.

    past_pole_high  a flag bar's high, or either lane at either end, is above the
                    pole high (x (1 + FLAG_POLE_TOL)): a second leg, not a flag;
    rising_channel  the channel's midline rises more than FLAG_RISE_TOL x the
                    pole height over the drawn span.
    (True, None) when the pole or flag bars are unknown."""
    pts = d.get("pivot_ts") or []
    b0 = pos.get(pts[0]) if len(pts) > 1 else None
    b1 = pos.get(pts[1]) if len(pts) > 1 else None
    if b0 is None or b1 is None:
        return True, None
    last = pos.get(pts[-1]) if len(pts) > 2 else None
    last = len(bars) - 1 if last is None else last
    # the pole high is the pole's TRUE top (round 3, pole_top_index), the same bar draw_pole uses
    pole_hi = float(bars[pole_top_index(bars, b0, b1) if b0 <= b1 else b1]["h"])
    pole_h = pole_hi - float(bars[b0]["l"])
    ceiling = pole_hi * (1.0 + FLAG_POLE_TOL)
    flag = bars[b1 + 1:last + 1]
    if flag and max(float(b["h"]) for b in flag) > ceiling:
        return False, "past_pole_high"
    g = d.get("geometry") or {}
    a = g.get("anchors") or []
    xs = [pos.get(p.get("t")) for p in a] if len(a) == 4 else []
    if len(xs) == 4 and None not in xs:
        spaces = list((g.get("extras") or {}).get("line_spaces") or []) + ["price", "price"]
        up = ((xs[0], a[0]["price"]), (xs[1], a[1]["price"]))
        dn = ((xs[2], a[2]["price"]), (xs[3], a[3]["price"]))
        left, right = min(xs), max(xs)
        uL, uR = _line_at(*up, left, spaces[0]), _line_at(*up, right, spaces[0])
        lL, lR = _line_at(*dn, left, spaces[1]), _line_at(*dn, right, spaces[1])
        if max(uL, uR) > ceiling:
            return False, "past_pole_high"
        if pole_h > 0 and ((uR + lR) - (uL + lL)) / 2.0 > FLAG_RISE_TOL * pole_h:
            return False, "rising_channel"
    return True, None


def cup_rim_line(bars: list, cup_start_t, cup_end_t, end_t):
    """The cup's rim line at its LEFT LIP: {start_t, end_t, price}, or None.

    Round 2 (REPORT_TEAM_SET.md: the rim sat on a later spike instead of the
    left lip). The lip is the highest high from the cup's first bar up to its
    low -- the high before the cup's decline (ties keep the earliest bar). The
    line runs from the lip to the first close above it after the cup's low
    (the breakout), else to `end_t`."""
    pos = _index(bars)
    s, e = pos.get(cup_start_t), pos.get(cup_end_t)
    if s is None or e is None or s > e:
        return None
    low_j = s
    for j in range(s, e + 1):
        if bars[j]["l"] < bars[low_j]["l"]:
            low_j = j
    lip_j = s
    for j in range(s, low_j + 1):
        if bars[j]["h"] > bars[lip_j]["h"]:
            lip_j = j
    lip = float(bars[lip_j]["h"])
    last = pos.get(end_t)
    last = len(bars) - 1 if last is None else last
    end_j = last
    for j in range(low_j + 1, last + 1):
        if float(bars[j]["c"]) > lip:
            end_j = j
            break
    return {"start_t": bars[lip_j]["t"], "end_t": bars[end_j]["t"], "price": lip}


def pivot_line(ext, start_t, end_t, price) -> dict:
    """A base's breakout / pivot line: `price` from the capped consolidation's
    first bar to its breakout bar (or the box's own span when uncapped)."""
    s_t, e_t = (ext["start_t"], ext["end_t"]) if ext else (start_t, end_t)
    return {"start_t": int(s_t), "end_t": int(e_t), "price": float(price)}


def tagged_ma_segment(bars: list, pos: dict, extras: dict, d: dict):
    """{kind, period, points, tag} for a pullback that names the MA it tagged
    (extras.tagged_ma: e21 / s50 / ...), or None. The MA is computed by the
    detector's own helpers (uct_setups_common.ema / sma) over the same bars, so
    the point on the marked session IS extras.tagged_ma_value. The segment runs
    from the swing high the pullback came off (the detection's start) to the
    last bar, at least PULLBACK_EMA_MIN_BARS long; `tag` is the tag bar's low."""
    spec = TAGGED_MA.get(str(extras.get("tagged_ma") or ""))
    if not spec:
        return None
    from api.services.pattern_engine.detectors.uct import uct_setups_common as U
    kind, period = spec
    closes = [float(b["c"]) for b in bars]
    series = U.ema(closes, period) if kind == "ema" else U.sma(closes, period)
    n = len(bars)
    s0 = pos.get(d.get("start_t"))
    start = n - PULLBACK_EMA_MIN_BARS if s0 is None else min(s0, n - PULLBACK_EMA_MIN_BARS)
    start = max(0, start)
    points = [{"t": bars[j]["t"], "price": round(series[j], 4)}
              for j in range(start, n) if series[j] is not None]
    if len(points) < 2:
        return None
    out = {"kind": kind, "period": period, "points": points}
    tj = pos.get(extras.get("tag_t"))
    if tj is not None:
        out["tag"] = {"t": bars[tj]["t"], "price": float(bars[tj]["l"])}
    return out


def _bar_span(pos, d):
    idx = [pos.get(t) for t in (d.get("pivot_ts") or [])]
    idx = [i for i in idx if i is not None]
    return (min(idx), max(idx)) if idx else None


def draw_geometry(detections: list, bars: list) -> list:
    """Stamp the display-only drawing fixes (module docstring) in place.
    Each detection is independent: a failure skips that detection only."""
    if not bars:
        return detections
    pos = _index(bars)
    closes = None
    emas: dict = {}
    flags: list = []
    for d in detections or []:
        try:
            pid = d.get("pattern_id")
            geom = d.get("geometry")
            if not isinstance(geom, dict):
                continue
            anchors = geom.get("anchors") or []
            if pid in EXTREME_CHAINS:
                kinds = EXTREME_CHAINS[pid]
                idxs = [pos.get(a.get("t")) for a in anchors]
                if len(idxs) == len(kinds) and None not in idxs and idxs == sorted(idxs):
                    snapped = snap_to_extremes(bars, idxs, kinds,
                                               start_idx=pos.get(d.get("start_t")))
                    geom.setdefault("extras", {})["draw_anchors"] = [
                        {"t": bars[j]["t"],
                         "price": float(bars[j]["l"] if k == "low" else bars[j]["h"])}
                        for j, k in zip(snapped, kinds)
                    ]
            elif pid == "flat_base" and len(anchors) == 4:
                # [prior_advance_low, base_start@high, base_end@high, base_end@low]
                ext = consolidation_extent(bars, anchors[1]["t"], anchors[3]["t"],
                                           anchors[1]["price"], anchors[3]["price"])
                extras = geom.setdefault("extras", {})
                # Team set: the flat-top pivot line (the level it fires above).
                if ext and ext.get("break") == "breakdown":
                    extras["draw_anchors"] = extent_anchors(ext)
                    extras["stale"] = True
                    extras["stale_reason"] = "broke_down"
                else:
                    # round 4: the box spans the FULL base (gap-tolerant run, at least the
                    # detector's base length) under a line the breakout bar never sets
                    fb, why = flat_base_box(bars, anchors[1]["t"], anchors[2]["t"],
                                            extras.get("base_bars"), anchors[3]["price"])
                    if fb is None and why != "unknown":
                        extras["stale"] = True
                        extras["stale_reason"] = why
                        continue
                    box = fb or ext
                    extras["draw_anchors"] = (
                        extent_anchors(box) if box else [dict(anchors[1]), dict(anchors[3])])
                    pv = pivot_line(box, anchors[1]["t"], anchors[3]["t"],
                                    fb["price"] if fb else anchors[1]["price"])
                    ok, why = pivot_base_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
                    if ok and fb:   # round 4: the same flat-base shape rules as bc:flat-base
                        ok, why = flat_shape_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
                    if ok and fb:
                        ok, why = flat_range_verdict(bars, pv["start_t"], pv["end_t"], pv["price"])
                    if ok:
                        extras["draw_pivot"] = pv
                    else:   # round 2: no base under the line, or far from price
                        extras["stale"] = True
                        extras["stale_reason"] = why
            elif pid in TEAM_PULLBACKS:
                ex0 = geom.setdefault("extras", {})
                ok, why = ma_tag_verdict(bars, pos, ex0)
                if not ok:      # round 4: a flat / rolling-over MA, or a tag bar off the MA
                    ex0["stale"] = True
                    ex0["stale_reason"] = why
                    continue
                ema = tagged_ma_segment(bars, pos, ex0, d)
                if ema:
                    ex0["draw_ema"] = ema
                stop = stop_segment(bars, pos, ex0)
                if stop:        # round 5: the stop from the tag bar, at its low
                    ex0["draw_stop"] = stop
            elif pid in PULLBACK_EMA:
                period = PULLBACK_EMA[pid]
                pts = d.get("pivot_ts") or []
                pb = pos.get(pts[0]) if pts else None
                if pb is None:
                    continue
                if closes is None:
                    closes = [b["c"] for b in bars]
                if period not in emas:
                    emas[period] = ema_series(closes, period)
                series = emas[period]
                lo = max(0, pb - PULLBACK_WINDOW_LOOKBACK)
                start = lo
                for j in range(lo, pb + 1):
                    if bars[j]["h"] > bars[start]["h"]:
                        start = j
                # v3: never a stub -- at least the last PULLBACK_EMA_MIN_BARS bars.
                start = max(0, min(start, len(bars) - PULLBACK_EMA_MIN_BARS))
                points = [{"t": bars[j]["t"], "price": round(series[j], 4)}
                          for j in range(start, len(bars)) if series[j] is not None]
                if len(points) >= 2:
                    geom.setdefault("extras", {})["draw_ema"] = {"period": period, "points": points}
            elif pid == "bull_flag":
                extras = geom.setdefault("extras", {})
                pts = d.get("pivot_ts") or []
                b0 = pos.get(pts[0]) if len(pts) > 1 else None
                b1 = pos.get(pts[1]) if len(pts) > 1 else None
                s = top = None
                if b0 is not None and b1 is not None:
                    top = pole_top_index(bars, b0, b1) if b0 <= b1 else b1   # round 3: true swing high
                    # round 7: the drawn pole starts at the final leg's swing low (pole_draw_start)
                    s = pole_draw_start(bars, b0, top)
                    extras["draw_pole"] = [{"t": bars[s]["t"], "price": float(bars[s]["l"])},
                                           {"t": bars[top]["t"], "price": float(bars[top]["h"])}]
                ok, reason = lane_verdict(bars, geom)
                extras["draw_lanes"] = ok
                if reason:
                    extras["lanes_reason"] = reason
                pause, why = flag_pause_verdict(bars, pos, d)
                if pause:       # round 4: a fast pole, a real flag, a midline that does not rise
                    pause, why = flag_shape_verdict(bars, pos, d)
                if pause and reason == "diverging":    # round 5: a fanning flag is not drawn at all
                    pause, why = False, "diverging"
                if pause:       # round 6: a crash-low pole, a flag below a gap, a flag breaking down
                    pause, why = flag_edge_verdict(bars, pos, d)
                if pause and s is not None:   # rounds 7-9: a short spike, a grind, two steps
                    pause, why = pole_impulse_verdict(bars, s, top)
                if pause and s is not None:   # round 8: under a prior high, a rebound, two steps
                    pause, why = flag_context_verdict(bars, s, top)
                ep = None
                if pause:       # round 6: the entry off a wick / spike over the flag -> body highs
                    ep = flag_entry_line(bars, pos, d)
                    if ep is not None:
                        extras["draw_entry_price"] = ep
                lanes = None
                if pause and ok:   # round 7: lanes refitted (wide first bar, flat wedge, floating end)
                    lanes = flag_draw_lanes(bars, pos, d)
                    if lanes is not None:
                        extras["draw_anchors"] = lanes
                        # round 8: the DRAWN lanes must not fan either
                        if lane_verdict(bars, {**geom, "anchors": lanes})[1] == "diverging":
                            pause, why = False, "diverging"
                if pause and ok:   # round 9: the drawn lanes must hold the flag's bodies
                    drawn = lanes if lanes is not None else (geom.get("anchors") or [])
                    spaces = list(extras.get("line_spaces") or []) + ["price", "price"]
                    if lanes is not None or (spaces[0] == "price" and spaces[1] == "price"):
                        pause, why = flag_lanes_verdict(bars, drawn)
                if pause:       # round 8: an entry set at the pole top above a flag that dropped away
                    entry = ep if ep is not None else (d.get("levels") or {}).get("entry")
                    pause, why = flag_entry_verdict(bars, pos, d, entry, lanes)
                if not pause:   # round 2: a second leg past the pole, not a pause
                    extras["stale"] = True
                    extras["stale_reason"] = why
                    extras["draw_lanes"] = False
                flags.append(d)
        except Exception:  # noqa: BLE001 -- one detection's fix skips that one only
            continue
    # Overlapping bull_flags of one run: only the most confident is drawn at all
    # (round 2: one pole and one entry line per flag -- a lanes-off flag still
    # drew its pole and entry, so the run showed two of each).
    kept: list = []
    for d in sorted(flags, key=lambda x: -(x.get("confidence") or 0)):
        try:
            extras = d["geometry"]["extras"]
            if extras.get("stale"):
                continue
            span = _bar_span(pos, d)
            if span and any(k[0] <= span[1] and span[0] <= k[1] for k in kept):
                extras["draw_lanes"] = False
                extras["lanes_reason"] = "overlapped"
                extras["stale"] = True
                extras["stale_reason"] = "overlapped"
                continue
            if span:
                kept.append(span)
                # whole and kept: stamp the drawing round (BULL_FLAG_DRAW_ROUND; display only)
                extras["draw_round"] = BULL_FLAG_DRAW_ROUND
        except Exception:  # noqa: BLE001
            continue
    return detections
