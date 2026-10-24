// app/src/components/chart/PatternOverlay.jsx — SVG overlay for engine-detected chart patterns.
//
// Task 2 (Phase 5): dispatches each detection to a shape-specific renderer based on
// `detection.geometry.shape`. The shape renderers live in ./patternShapes/ — one file per geometry
// type (trendline_pair, neckline, cup_curve, rectangle, candle_mark, horizontal_line, base_box).
//
// Peer layer to ChartDrawingOverlay — both live inside the StockChart `wrapper` (position: relative)
// and are sized to overlay the chart's `containerRef` div. The SVG opts out of pointer events at the
// root so user drawings/clicks underneath are unaffected; individual <g> hit targets opt back in.
//
// Subscribes to lightweight-charts v5 timeScale events (visible-time + visible-logical) so shapes
// reproject on scroll/zoom. Coordinate conversion is `chart.timeScale().timeToCoordinate(t)` and
// `series.priceToCoordinate(price)` — both return null when the point is off-screen, which the
// renderers treat as a skip-render condition.
//
// ⛔ ANCHOR TIMES ARE CONVERTED BEFORE timeToCoordinate (auto-structures, 2026-10-16). The engine
// emits YYYYMMDD ints on D/W/M and UTC epoch seconds intraday; the series is keyed 'YYYY-MM-DD'
// and ET-shifted seconds. Unconverted, every daily anchor resolved null and nothing drew.
// `patternTime.anchorToBarTime` converts once and snaps onto a bar the series holds. When `tf` is
// not given the overlay assumes its caller already holds chart-format times (legacy callers).
//
// ⭐ WHAT IS DRAWN is decided per row by the server (registry.display_policy, ONE authority):
//   display_tier 'hidden' never draws; 'experimental' draws only with `showExperimental`
//   (admins), visibly distinct (dotted, quieter, "exp"); `display_layer: 'levels'` (the
//   ubiquitous support_resistance / volume_profile_nodes) draws only with `showLevels`, and
//   then only the LEVELS_NEAREST levels nearest `lastPrice`; `intraday_only` rows never draw on
//   D/W/M. `geometry.secondary` (uct_* setups) and a trusted detector's `levels.entry`
//   (`draw_entry`) draw as bounded LevelSegments beside the primary shape.
//
// ⭐ THE LEARNED AUTO-DRAWER (`drawn`, admin + AUTO_STRUCTURES_ENABLED, D/W/M): its trendlines and
//   levels draw through LearnedDrawn, styled apart and tagged "learned". While it is present its
//   `suppress` map (server-owned: registry DISPLAY_LEARNED_HIDES / _REPLACES) leaves those
//   detectors undrawn — volume_profile_nodes hidden by default, swing_pivots replaced by learned.
//   Whether `drawn` is present is the SERVER's call (admins only; withheld from members while
//   auto_structures.MEMBER_LEARNED_LINES_ROUND is None).
//
// ⭐ TEAM DRAWING SET (owner direction 2026-10-17; registry.DISPLAY_TEAM_SET = the trusted tier):
//   `trustedOnly` draws it (members always; admins by default, "All" shows everything). Its
//   display-only extras: `draw_pivot` (a base's breakout / pivot line, solid, extended right),
//   `draw_box: false` (line only, no box), `draw_handle` (a cup's capped handle), `draw_rim_ref` (cup
//   round 9: the rim as a faint, labelled reference when the pivot is the handle high), `stale` (a base
//   that broke down: not drawn), and for the MA pullback `draw_ema.kind` / `draw_ema.tag` (the
//   tagged EMA/SMA curve and the tag-bar marker; its flat `tagged_ma` secondary is then skipped)
//   and `draw_stop` (round 5: the stop secondary re-anchored to start at the tag bar).
//   uct_flat_top_breakout: `draw_flat_top` (lab flattop_draw_v2) draws ONE solid "flat top" line
//   plus a hollow circle on each touch, and nothing else of that row (`flatTopDrawing`).
//   bc:base (a structures row): `draw_base` (lab base_draw) draws a light region over the base, a
//   solid "pivot" line on its top and a dashed "base low" line, and nothing else (`baseDrawing`).
//   draw:inside-day (a structures row): `draw_inside_day` (lab id_draw_v2) draws a light box over the
//   inside day and the bar it sits inside, a solid "trigger" line at the inside day's high extended
//   past the last bar, and a dashed "stop" line at its low, and nothing else (`insideDayDrawing`).
//   draw:saucer / draw:ascending-base / draw:double-bottom / draw:ipo-base (structures rows, lab
//   base_shapes; the double bottom is member-released at round 2, the other three stay ADMIN-ONLY;
//   a double bottom whose breakout is too old arrives `stale` and is skipped): `draw_shape` (api/services/pattern_engine/
//   shape_draw.py) draws a light region over the base, a solid "pivot" line from the shape's own pivot
//   point, a dashed "base low", a dot on each of the shape's points and, for the W and the staircase, a
//   dotted path through them -- and nothing else (`shapeDrawing`).
//
// ⭐ uct_trendline_break (internal, experimental => admins only) carries its tested FALLING line
//   in `extras.trendline` = {t1, p1, t2, p2, t_end, p_end, drawn_asof_t} (real bar times; the
//   line is linear in price over bar index). `geometry.secondary` draws horizontals only, so
//   the line is re-dispatched through TrendlinePair's `single_trendline` path from the first
//   anchor to the break bar, with a dot on each anchor high. Malformed => nothing drawn.
import { useEffect, useRef, useState, useCallback } from 'react'
import TrendlinePair from './patternShapes/TrendlinePair'
import Neckline from './patternShapes/Neckline'
import CupCurve from './patternShapes/CupCurve'
import Rectangle from './patternShapes/Rectangle'
import CandleMark from './patternShapes/CandleMark'
import HorizontalLine from './patternShapes/HorizontalLine'
import BaseBox from './patternShapes/BaseBox'
import LevelSegment from './patternShapes/LevelSegment'
import LearnedDrawn from './patternShapes/LearnedDrawn'
import SupportResistanceLayer from './patternShapes/SupportResistanceLayer'
import { hasLevelsSr } from './patternShapes/srLevelsGeometry'
import { LabelLayoutContext } from './patternShapes/labelLayoutContext'
import { computeLabelLayout } from './patternLabelLayout'
import EmaSegment from './patternShapes/EmaSegment'
import PoleSegment from './patternShapes/PoleSegment'
import { anchorToBarTime, isDateTf } from './patternTime'
import { getColor, getOpacity, FLAGGING_TIER } from './patternShapes/style'

const SHAPE_RENDERERS = {
  trendline_pair: TrendlinePair,
  neckline: Neckline,
  cup_curve: CupCurve,
  rectangle: Rectangle,
  candle_mark: CandleMark,
  horizontal_line: HorizontalLine,
  base_box: BaseBox,
}

// How many levels-layer lines (support/resistance, volume nodes) may draw at once.
export const LEVELS_NEAREST = 2

function levelPrice(d) {
  const a = d?.geometry?.anchors || []
  if (!a.length) return null
  return a.length >= 2 ? (a[0].price + a[1].price) / 2 : a[0].price
}

/**
 * The geometry the chart DRAWS for one detection (pure — exported for tests).
 *
 * The blind tier round v2 (lab/geometry_eval REPORT_TIERS_V2.md, 2026-10-17) found drawing
 * defects that the server now corrects as DISPLAY-ONLY extras
 * (api/services/pattern_engine/display.py): `extras.draw_anchors` replaces `anchors` when
 * present — double_bottom / double_top / head_shoulders snapped to each leg's true extreme,
 * flat_base / bc:flat-base / bc:square-box capped to the consolidation. For a base_box the
 * drawn top/floor follow the capped extent. Rows stored before the fix carry no extras and
 * draw exactly as before.
 */
export function drawGeometry(d) {
  const g = d?.geometry
  const da = g?.extras?.draw_anchors
  if (!g || !Array.isArray(da) || !da.length) return d
  let extras = g.extras
  if (g.shape === 'base_box' && da.length >= 2) {
    extras = {
      ...extras,
      top: Math.max(da[0].price, da[1].price),
      floor: Math.min(da[0].price, da[1].price),
    }
  }
  return { ...d, geometry: { ...g, anchors: da, extras } }
}

export const TRENDLINE_BREAK_ID = 'uct_trendline_break'
export const FLAT_TOP_ID = 'uct_flat_top_breakout'
export const BASE_DRAW_ID = 'bc:base'
export const INSIDE_DAY_DRAW_ID = 'draw:inside-day'
// The named base-shape drawing rows (auto_structures.SHAPE_DRAW_IDS -- keep the two lists equal).
export const SHAPE_DRAW_IDS = ['draw:saucer', 'draw:ascending-base', 'draw:double-bottom', 'draw:ipo-base',
  'draw:cup-no-handle', 'draw:htf']

const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * The "flat top" ceiling a uct_flat_top_breakout detection draws (lab flattop_draw_v2, blind-confirmed
 * as drawn): `extras.draw_flat_top` = {price, start_t, end_t, touches: [{t, price}], label}, stamped by
 * the server only on a fire that meets the v2 conditions. Returns null for any other row or a malformed
 * stamp; when it returns a drawing, that line and its touch markers are ALL the row draws (no candle
 * mark, no secondary levels), because that is the drawing the judges scored. Pure — exported for tests.
 */
export function flatTopDrawing(d) {
  if (d?.pattern_id !== FLAT_TOP_ID) return null
  const ft = d?.geometry?.extras?.draw_flat_top
  if (!ft || typeof ft !== 'object') return null
  const price = Number(ft.price)
  if (!Number.isFinite(price) || ft.start_t == null || ft.end_t == null) return null
  const touches = (Array.isArray(ft.touches) ? ft.touches : [])
    .filter((t) => t && t.t != null && Number.isFinite(Number(t.price)))
    .map((t) => ({ t: t.t, price: Number(t.price) }))
  return { price, start_t: ft.start_t, end_t: ft.end_t, touches, label: ft.label || 'flat top' }
}

/**
 * The BASE a bc:base structures row draws (lab base_draw, blind-confirmed as drawn):
 * `extras.draw_base` = {pivot, start_t, end_t, low, low_t, label, low_label}. Returns null for any
 * other row or a malformed stamp (a pivot that is not above the low, a missing span). When it returns
 * a drawing, the row draws exactly what the judges scored and nothing else: a light region over the
 * base, a solid pivot line on its top extended past the last bar, and a dashed line at its low.
 * Pure — exported for tests.
 */
export function baseDrawing(d) {
  if (d?.pattern_id !== BASE_DRAW_ID) return null
  const bd = d?.geometry?.extras?.draw_base
  if (!bd || typeof bd !== 'object') return null
  const pivot = Number(bd.pivot)
  const low = Number(bd.low)
  if (!Number.isFinite(pivot) || !Number.isFinite(low) || !(pivot > low)) return null
  if (bd.start_t == null || bd.end_t == null) return null
  // a base STATE (api: base_draw.state_drawing): a known state, or none at all (the judged base)
  const state = BASE_STATES.includes(bd.state) ? bd.state : null
  if (bd.state != null && !state) return null
  // a breakout-state base ends at base_end_t (its own bars); its pivot line runs on to end_t
  const baseEnd = (state === 'breakout' || state === 'extended') && bd.base_end_t != null ? bd.base_end_t : bd.end_t
  const out = {
    pivot, low, start_t: bd.start_t, end_t: bd.end_t,
    label: bd.label || 'pivot', lowLabel: bd.low_label || 'base low',
  }
  // a row without a state draws exactly what it drew before the states existed
  return state ? { ...out, state, base_end_t: baseEnd } : out
}

/** The base STATES a bc:base row may carry (`draw_base.state`; the server serves each to a member only once
 *  its own blind packets confirmed it). */
export const BASE_STATES = ['breakout', 'extended', 'forming', 'tight']
/** The first printed line of a breakout-state base. */
export const BASE_STATE_TEXT = { breakout: 'Breakout, in buy zone', extended: 'Extended' }

/**
 * The label of a base STATE row, or null for a row without a known state: "Base forming, pivot X" and
 * "3 weeks tight, pivot X" (X = the drawn pivot line; no buy-zone text), and for a breakout state its state
 * line on top of the base's own number lines (`numbers`). Pure — exported for tests.
 */
export function baseStateLines(d, numbers) {
  const bd = d?.geometry?.extras?.draw_base
  const state = bd && BASE_STATES.includes(bd.state) ? bd.state : null
  if (!state) return null
  const pivot = Number(bd.pivot)
  if (!Number.isFinite(pivot)) return null
  if (state === 'forming') return [`Base forming, pivot ${pivot.toFixed(2)}`]
  if (state === 'tight') return [`3 weeks tight, pivot ${pivot.toFixed(2)}`]
  return [BASE_STATE_TEXT[state], ...(numbers || [])]
}

/**
 * The BASE METRICS a base row carries (`extras.metrics`, server-computed under
 * AUTO_STRUCTURES_METRICS_ENABLED; api/services/base_metrics.py), as the two short lines printed above
 * its pivot line: ["Pivot 81.98 · 12% deep · 5.2 wks · stage 2 (est.)", "BZ to 86.08 · +3.1% vs pivot"].
 * Returns null when the row has no metrics or they are malformed (pivot, depth, length and buy zone must
 * all be finite); a missing stage is simply omitted (the server never guesses one), and the stage is
 * always labelled an estimate. Pure — exported for tests.
 */
export function baseMetricsLines(d) {
  if (d?.pattern_id === BASE_DRAW_ID && d?.geometry?.extras?.draw_base?.state != null) {
    return baseStateLines(d, baseNumberLines(d))
  }
  return baseNumberLines(d)
}

function baseNumberLines(d) {
  const tb = textbookMetricsLines(d)
  if (tb) return tb
  const m = d?.geometry?.extras?.metrics
  if (!m || typeof m !== 'object') return null
  const pivot = Number(m.pivot)
  const depth = Number(m.depth_pct)
  const weeks = Number(m.length_weeks)
  const bz = Number(m.buy_zone_top)
  if (![pivot, depth, weeks, bz].every(Number.isFinite) || m.pivot == null || m.depth_pct == null
      || m.length_weeks == null || m.buy_zone_top == null) return null
  const first = [`Pivot ${pivot.toFixed(2)}`, `${Math.round(depth)}% deep`, `${weeks.toFixed(1)} wks`]
  const stage = Number(m.stage)
  if (m.stage != null && Number.isInteger(stage) && stage >= 1) first.push(`stage ${stage} (est.)`)
  const second = [`BZ to ${bz.toFixed(2)}`]
  const pfp = Number(m.pct_from_pivot)
  if (m.pct_from_pivot != null && Number.isFinite(pfp)) {
    second.push(`${pfp >= 0 ? '+' : '−'}${Math.abs(pfp).toFixed(1)}% vs pivot`)
  }
  return [first.join(' · '), second.join(' · ')]
}

const signedPct = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`

/**
 * The TEXTBOOK numbers a base row carries (`extras.metrics_textbook`, server-computed only under
 * AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED; api/services/textbook_numbers.py): the IBD-style buy point
 * (the base's pivot HIGH + $0.10), its buy zone and the close against it, plus the base count and the
 * volume when the server could read them. The drawn line does not move; these lines say "Buy point" so the
 * two prices are never confused. Two or three lines:
 *   "Buy point 43.12 · 12% deep · 5.2 wks · stage 2"
 *   "Buy zone to 45.28 · −1.3% from buy point"       (" · extended" past the buy zone)
 *   "Vol +62% vs 50d avg"                             (" · light volume" on a breakout under 40%)
 * Returns null when the row has no textbook numbers or they are malformed. Pure — exported for tests.
 */
export function textbookMetricsLines(d) {
  const m = d?.geometry?.extras?.metrics_textbook
  if (!m || typeof m !== 'object') return null
  const req = [m.buy_point, m.depth_pct, m.length_weeks, m.buy_zone_top, m.pct_from_buy_point]
  if (req.some((v) => v == null)) return null
  const [bp, depth, weeks, bz, pfb] = req.map(Number)
  if (![bp, depth, weeks, bz, pfb].every(Number.isFinite)) return null
  const first = [`Buy point ${bp.toFixed(2)}`, `${Math.round(depth)}% deep`, `${weeks.toFixed(1)} wks`]
  const stage = Number(m.stage)
  if (m.stage != null && Number.isInteger(stage) && stage >= 1) first.push(`stage ${stage}`)
  const second = [`Buy zone to ${bz.toFixed(2)}`, `${signedPct(pfb)} from buy point`]
  if (m.extended === true) second.push('extended')
  const lines = [first.join(' · '), second.join(' · ')]
  const vol = m.volume
  const vp = Number(vol?.vol_pct)
  if (vol && typeof vol === 'object' && vol.vol_pct != null && Number.isFinite(vp)) {
    const third = [`Vol ${vp >= 0 ? '+' : '−'}${Math.abs(Math.round(vp))}% vs 50d avg`]
    if (vol.breakout === true && vol.light === true) third.push('light volume')
    lines.push(third.join(' · '))
  }
  return lines
}

// The metrics text: two (or three) lines LEFT-aligned to the base's own left edge, set just above the box
// top (or just inside it, whichever covers fewer candles; labelLayout.placeMetricsBlock decides). It used to
// sit right-aligned to the pivot line's extended tip, i.e. at the right price edge, where it printed over
// the latest candles and the learned levels' labels (WDAY daily, 2026-10-23). Text only: the box, the pivot
// line and every number are unchanged.
function BaseMetricsText({ d, lines, place }) {
  if (!lines || !place) return null
  return (
    <text data-role="base-metrics" data-metrics-side={place.side} x={place.x} y={place.y} textAnchor="start"
      fontSize="10" fontWeight="600" fill={getColor(d)} opacity={getOpacity(d)} style={{ pointerEvents: 'none' }}>
      {lines.map((s, i) => <tspan key={i} x={place.x} dy={i === 0 ? '0' : '12'}>{s}</tspan>)}
    </text>
  )
}

/**
 * The INSIDE DAY a draw:inside-day structures row draws (lab id_draw_v2, blind-confirmed as drawn):
 * `extras.draw_inside_day` = {trigger, stop, mother_high, mother_low, start_t, inside_t, end_t, label,
 * stop_label}. Returns null for any other row or a malformed stamp (a trigger not above the stop, a stop
 * or trigger outside the mother range, a missing span). When it returns a drawing, the row draws exactly
 * what the judges scored and nothing else: a light box over the mother bar through the inside day, a
 * solid trigger line at the inside day's high extended past the last bar, and a dashed stop line at its
 * low. Pure — exported for tests.
 */
export function insideDayDrawing(d) {
  if (d?.pattern_id !== INSIDE_DAY_DRAW_ID) return null
  const x = d?.geometry?.extras?.draw_inside_day
  if (!x || typeof x !== 'object') return null
  const trigger = Number(x.trigger)
  const stop = Number(x.stop)
  const motherHigh = Number(x.mother_high)
  const motherLow = Number(x.mother_low)
  if (![trigger, stop, motherHigh, motherLow].every(Number.isFinite)) return null
  if (!(trigger > stop && motherHigh >= trigger && stop >= motherLow)) return null
  if (x.start_t == null || x.inside_t == null || x.end_t == null) return null
  return {
    trigger, stop, motherHigh, motherLow, start_t: x.start_t, inside_t: x.inside_t, end_t: x.end_t,
    label: x.label || 'trigger', stopLabel: x.stop_label || 'stop',
  }
}

/**
 * The named base shape a draw:<shape> structures row draws (lab base_shapes; admin-only until its round is
 * blind-confirmed): `extras.draw_shape` = {pivot, low, start_t, end_t, pivot_from_t?, top?, marks: [{t, price,
 * kind}], path?, label, low_label}. Returns null for any other row or a malformed stamp (a pivot not above the
 * low, a missing span, a mark without a finite price). When it returns a drawing, the row draws the region
 * (start_t .. end_t, low .. max(top, pivot)), the pivot line from pivot_from_t, the base low, one dot per mark
 * and -- only when `path` is true -- a dotted line through the marks. Pure — exported for tests.
 */
export function shapeDrawing(d) {
  if (!SHAPE_DRAW_IDS.includes(d?.pattern_id)) return null
  const x = d?.geometry?.extras?.draw_shape
  if (!x || typeof x !== 'object') return null
  const pivot = Number(x.pivot)
  const low = Number(x.low)
  if (!Number.isFinite(pivot) || !Number.isFinite(low) || !(pivot > low)) return null
  if (x.start_t == null || x.end_t == null) return null
  const top = Number.isFinite(Number(x.top)) ? Math.max(Number(x.top), pivot) : pivot
  const marks = Array.isArray(x.marks) ? x.marks : []
  if (!marks.every((m) => m && m.t != null && Number.isFinite(Number(m.price)))) return null
  return {
    pivot, low, top, start_t: x.start_t, end_t: x.end_t,
    pivot_from_t: x.pivot_from_t != null ? x.pivot_from_t : x.start_t,
    marks: marks.map((m) => ({ t: m.t, price: Number(m.price), kind: String(m.kind || '') })),
    path: x.path === true,
    label: x.label || 'pivot', lowLabel: x.low_label || 'base low',
  }
}

// The shelf-pivot row (auto_structures.SHELF_PIVOT_ID): ONE purple horizontal level.
export const SHELF_PIVOT_ID = 'draw:shelf-pivot'
export const SHELF_PIVOT_COLOR = '#7b2cbf'

/**
 * The ONE level a draw:shelf-pivot structures row draws: `extras.draw_shelf` = {price, start_t, end_t, label,
 * cleared, tooltip}. The line runs from the first bar that reached the level to the last bar (and a little
 * past it); the label reads "Shelf pivot 15.70", plus " (cleared)" when the close is above the line, and sits
 * to the RIGHT of the line's end so it never covers the latest candles. Returns null for any other row or a
 * malformed stamp. Pure — exported for tests.
 */
export function shelfPivotDrawing(d) {
  if (d?.pattern_id !== SHELF_PIVOT_ID) return null
  const x = d?.geometry?.extras?.draw_shelf
  if (!x || typeof x !== 'object') return null
  const price = Number(x.price)
  if (!Number.isFinite(price) || x.start_t == null || x.end_t == null) return null
  const label = `${x.label || 'Shelf pivot'} ${price.toFixed(2)}${x.cleared ? ' (cleared)' : ''}`
  return { price, start_t: x.start_t, end_t: x.end_t, label, tooltip: typeof x.tooltip === 'string' ? x.tooltip : '' }
}

/**
 * The sloped line a uct_trendline_break detection draws, as a `single_trendline` sub-detection
 * (anchors: first high, second high, value on the break bar), or null when the row is another
 * detector or its `extras.trendline` is missing / malformed. Pure — exported for tests.
 */
export function trendlineBreakLine(d) {
  if (d?.pattern_id !== TRENDLINE_BREAK_ID) return null
  const tl = d?.geometry?.extras?.trendline
  if (!tl || typeof tl !== 'object') return null
  const { t1, p1, t2, p2, t_end: tEnd, p_end: pEnd } = tl
  if (![t1, p1, t2, p2, tEnd, pEnd].every(finiteNum)) return null
  if (!(p1 > 0 && p2 > 0 && pEnd > 0) || !(t1 < t2 && t2 <= tEnd)) return null
  return {
    ...d,
    id: `${d.id}:trendline`,
    pattern_name: 'Trendline',
    confidence: null,
    geometry: {
      shape: 'trendline_pair',
      semantic_subtype: 'single_trendline',
      anchors: [{ t: t1, price: p1 }, { t: t2, price: p2 }, { t: tEnd, price: pEnd }],
    },
  }
}

/**
 * The bull_flag "flagging" tier (lab flag_vocab, 2026-10-18). The server keeps such a flag `stale`
 * (the strict round stopped it) and stamps its own key, `extras.flagging` {tier, draw_round,
 * draw_lanes, draw_anchors?}. This returns the row as it DRAWS -- not stale, its own lanes, tagged
 * `flag_tier: 'flagging'` (style.js draws it dotted, faint and labelled "flagging") and with NO entry
 * line, because its geometry measured at chance against the team's lines -- or null for any row
 * that is not exactly that. The server is the gate for members (auto_structures.member_rows).
 * Pure — exported for tests.
 */
export function flaggingView(d) {
  if (d?.pattern_id !== 'bull_flag') return null
  const g = d?.geometry
  const ex = g?.extras
  const stamp = ex?.flagging
  if (!ex?.stale || !stamp || typeof stamp !== 'object' || stamp.tier !== FLAGGING_TIER) return null
  // draw_entry false is the ONE guard against an entry line (the overlay draws one only with it)
  const extras = { ...ex, stale: false, draw_lanes: stamp.draw_lanes === true }
  if (Array.isArray(stamp.draw_anchors) && stamp.draw_anchors.length) extras.draw_anchors = stamp.draw_anchors
  return { ...d, flag_tier: FLAGGING_TIER, draw_entry: false, geometry: { ...g, extras } }
}

/**
 * Which detections draw, given the server's per-row policy and the viewer's toggles.
 * Pure — exported for tests.
 */
export function selectDrawable(detections, { tf, showExperimental = true, showLevels = false, lastPrice = null, suppress = null, trustedOnly = false } = {}) {
  const dateTf = tf == null ? false : isDateTf(tf)
  const structures = []
  const levels = []
  for (const row of detections || []) {
    if (!row) continue
    const d = flaggingView(row) || row
    if (suppress && Object.prototype.hasOwnProperty.call(suppress, d.pattern_id)) continue
    if (d.display_tier === 'hidden') continue
    if (d.geometry?.extras?.stale) continue
    // A member (AUTO_STRUCTURES_MEMBERS_ENABLED) draws the trusted tier ONLY; a row with no
    // tier is not trusted. The server already filtered; this never widens what it sent.
    if (trustedOnly && d.display_tier !== 'trusted') continue
    if (d.display_tier === 'experimental' && !showExperimental) continue
    if (dateTf && d.intraday_only) continue
    if (d.display_layer === 'levels') levels.push(d)
    else structures.push(d)
  }
  if (trustedOnly || !showLevels || !levels.length) return structures
  let chosen = levels
  if (Number.isFinite(lastPrice)) {
    chosen = [...levels]
      .filter((d) => levelPrice(d) != null)
      .sort((a, b) => Math.abs(levelPrice(a) - lastPrice) - Math.abs(levelPrice(b) - lastPrice))
  }
  return [...structures, ...chosen.slice(0, LEVELS_NEAREST)]
}

/**
 * Everything one drawable row derives before it draws (the drawing extras it carries, the levels it
 * adds, the metrics it prints). Shared by the render and by the label-collision pass so the two can
 * never disagree about which labels exist. Pure.
 */
export function rowView(row) {
  const d = drawGeometry(row)
  const shape = d?.geometry?.shape
  const ex = d?.geometry?.extras || {}
  // A pullback names an EMA: draw that EMA over the pullback window, not a flat line.
  const hasEma = Array.isArray(ex.draw_ema?.points) && ex.draw_ema.points.length >= 2
  // A flag whose lanes cross, diverge or overlap a better flag draws pole + entry only.
  const lanesOff = ex.draw_lanes === false
  // A team-set base whose box did not hold up draws its pivot line only.
  const boxOff = ex.draw_box === false
  // The flat-top ceiling replaces the detector's candle mark and secondary levels outright.
  const flatTop = flatTopDrawing(d)
  // The base drawing (bc:base) is its own geometry: region + pivot + low, nothing else.
  const base = baseDrawing(d)
  // The inside-day drawing (draw:inside-day) is its own geometry: box + trigger + stop, nothing else.
  const insideDay = insideDayDrawing(d)
  // A named base shape (draw:<shape>) is its own geometry: region + pivot + low + its points.
  const shapeDraw = shapeDrawing(d)
  // The shelf pivot (draw:shelf-pivot) is its own geometry: one labelled level, nothing else.
  const shelf = shelfPivotDrawing(d)
  const Renderer = (flatTop || base || insideDay || shapeDraw || shelf) ? null : (hasEma ? EmaSegment : ((lanesOff || boxOff) ? null : SHAPE_RENDERERS[shape]))
  const pivot = ex.draw_pivot && Number.isFinite(Number(ex.draw_pivot.price)) ? ex.draw_pivot : null
  const handle = ex.draw_handle && Number.isFinite(Number(ex.draw_handle.top)) ? ex.draw_handle : null
  // Cup round 9: a right side that stalled under the rim pivots at the HANDLE HIGH; the rim stays
  // as a faint, separately labelled reference so the two lines are never read as one.
  const rimRef = pivot && ex.draw_rim_ref && Number.isFinite(Number(ex.draw_rim_ref.price)) ? ex.draw_rim_ref : null
  // The curve replaces the flat MA level; the stop level stays. Round 5: `draw_stop` moves
  // the stop to start at the TAG bar (the detector's own stop secondary runs from the
  // 10-session high, far left) — same price, same label, display only.
  const drawStop = ex.draw_stop && Number.isFinite(Number(ex.draw_stop.price)) ? ex.draw_stop : null
  const secondary = (Array.isArray(d?.geometry?.secondary) && !flatTop && !base && !insideDay && !shapeDraw && !shelf ? d.geometry.secondary : [])
    .filter((sec) => !(hasEma && sec?.role === 'tagged_ma'))
    .map((sec) => (drawStop && sec?.role === 'stop'
      ? {
          ...sec,
          draw_stop: true,
          anchors: [
            { t: drawStop.start_t, price: Number(drawStop.price) },
            { t: drawStop.end_t, price: Number(drawStop.price) },
          ],
        }
      : sec))
  // Round 6 (bull_flag): `draw_entry_price` moves the DRAWN entry off a single wick /
  // spike over the flag onto its body highs. Display only — levels.entry is untouched.
  const drawnEntry = Number(ex.draw_entry_price)
  const entry = d?.draw_entry
    ? (ex.draw_entry_price != null && Number.isFinite(drawnEntry) ? drawnEntry : Number(d?.levels?.entry))
    : NaN
  const anchors = d?.geometry?.anchors || []
  const tlBreak = trendlineBreakLine(d)
  // base metrics print only beside a pivot line that actually draws (the base's own, or draw_pivot)
  const metricsLine = base ? { start_t: base.start_t, end_t: base.end_t, price: base.pivot } : pivot
  const metricsLines = metricsLine ? baseMetricsLines(d) : null
  return { d, shape, ex, hasEma, lanesOff, boxOff, flatTop, base, insideDay, shapeDraw, shelf, Renderer, pivot, handle, rimRef, drawStop, secondary, drawnEntry, entry, anchors, tlBreak, metricsLine, metricsLines }
}

/**
 * Props:
 *   chart:             lightweight-charts IChartApi (already created in parent)
 *   series:            ISeriesApi — the candle series, used for priceToCoordinate
 *   containerRef:      ref to the chart's DOM container (sizing source for the SVG)
 *   detections:        Detection[] from /api/patterns/{sym} (+ `structures` when requested)
 *   enabled:           boolean — when false the overlay returns null
 *   onDetectionClick:  (detection) => void — fired when a shape is clicked
 *   tf:                the chart's timeframe code ('D','W','M','1','5',…) — drives anchor conversion
 *   barTimes:          the candle series' times, ascending — anchors snap onto these
 *   showExperimental:  draw experimental-tier detectors (admins); default true
 *   showLevels:        draw the levels layer (nearest LEVELS_NEAREST to lastPrice); default false
 *   lastPrice:         the latest close, for choosing the nearest levels
 *   drawn:             the learned auto-drawer block (`drawn` on the response) or null
 *   trustedOnly:       draw ONLY display_tier 'trusted' rows (the team set) and no levels layer; default false
 *   showLabels:        draw the base metrics text (buy point / depth / stage / volume); default true
 *   showLearned:       draw the `drawn` block when present (admin "Learned levels" toggle); default true
 *   showDealStatus:    show the deal-status notice even while `enabled` is false; default false
 *   (The UCT Intelligence indicator, uctIntelligence.js, drives the last three. A released support /
 *    resistance or candlestick layer is gated there by the payload key's presence.)
 *   levelsSr:          the textbook support / resistance block (`levels_sr` on the response, server-gated by
 *                      AUTO_STRUCTURES_SR_ENABLED + MEMBER_SR_ROUND) or null
 *   showLevelsSr:      draw `levelsSr`; default true. The UCT Intelligence indicator's "Support & resistance"
 *                      toggle drives this (uctIntelligence effectiveLayers().supportResistance)
 *   setupDraws:        the setup-drawing rows (`setup_draws` on the response: remount / undercut & rally /
 *                      donchian lines, server-gated by AUTO_STRUCTURES_G4_SETUPS_ENABLED) or null
 *   showSetupDraws:    draw `setupDraws`; default false. The UCT Intelligence indicator's "Setups" toggle drives
 *                      this (effectiveLayers().setups). Like the S/R layer it draws with Auto patterns off too.
 */
export const DEAL_STATUS_LABEL = 'Pending acquisition — pattern drawings hidden'

/** Where the deal-status notice sits: BOTTOM-LEFT of the price pane, stacked on the
 *  3M/6M/YTD/1Y/5Y/Origin lookback bar.
 *  ⚰️ IT WAS BORN AT `top: 34, left: 8` — exactly the OHLC readout row and the EMA/SMA
 *  legend under it (`.legend` is `top: 28px + --price-pane-top`, `left: 8px`), so it hid
 *  the numbers a member reads first. The top-left corner belongs to the legend.
 *  ⭐ `--lookback-bottom` is published on the chart wrapper by StockChart's chrome sampler,
 *  the same number it writes to the lookback bar's `style.bottom`; the notice sits one
 *  bar-height (LOOKBACK_BAR_PX) plus a gap above it. The fallback is `.rangeBar`'s own CSS
 *  fallback, for the frames before the sampler runs. */
export const LOOKBACK_BAR_PX = 26
export const DEAL_NOTICE_GAP_PX = 4
export const DEAL_NOTICE_BOTTOM =
  `calc(var(--lookback-bottom, calc(22% + 32px)) + ${LOOKBACK_BAR_PX + DEAL_NOTICE_GAP_PX}px)`

/** The one line a chart shows when the stock is pending acquisition. The label is the server's
 *  (one authority); DEAL_STATUS_LABEL is only the fallback when a payload carries none. */
function DealStatusNotice({ dealStatus }) {
  const label = (typeof dealStatus?.label === 'string' && dealStatus.label) || DEAL_STATUS_LABEL
  return (
    <div
      role="status"
      data-testid="pattern-deal-status"
      style={{
        position: 'absolute',
        bottom: DEAL_NOTICE_BOTTOM,
        left: 8,
        zIndex: 5,
        pointerEvents: 'none',
        padding: '3px 8px',
        borderRadius: 4,
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        color: 'var(--text-muted)',
        fontSize: 11,
        lineHeight: 1.3,
        maxWidth: 'calc(100% - 16px)',
      }}
    >
      {label}
    </div>
  )
}

export default function PatternOverlay({
  chart,
  series,
  containerRef,
  detections,
  enabled,
  onDetectionClick,
  tf = null,
  barTimes = null,
  showExperimental = true,
  showLevels = false,
  lastPrice = null,
  drawn = null,
  trustedOnly = false,
  dealStatus = null,
  candles = null,
  showLabels = true,
  showLearned = true,
  showDealStatus = false,
  levelsSr = null,
  showLevelsSr = true,
  setupDraws = null,
  showSetupDraws = false,
}) {
  const svgRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [, setRedrawTick] = useState(0)

  // Force a re-render so coordinate conversions re-run with the chart's latest visible range.
  const forceRedraw = useCallback(() => {
    setRedrawTick((t) => (t + 1) % 1_000_000)
  }, [])

  // Resize observer + chart visible-range subscriptions
  useEffect(() => {
    if (!chart || !containerRef?.current) return

    const el = containerRef.current
    const updateSize = () => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    }
    updateSize()

    const ro = new ResizeObserver(updateSize)
    ro.observe(el)

    const timeScale = chart.timeScale()
    timeScale.subscribeVisibleTimeRangeChange(forceRedraw)
    timeScale.subscribeVisibleLogicalRangeChange(forceRedraw)

    return () => {
      ro.disconnect()
      try { timeScale.unsubscribeVisibleTimeRangeChange(forceRedraw) } catch {}
      try { timeScale.unsubscribeVisibleLogicalRangeChange(forceRedraw) } catch {}
    }
  }, [chart, containerRef, forceRedraw])

  // Pending acquisition (server deal_status, DEAL_STATUS_ENABLED): the server withheld every
  // drawing and buy-point label; say why instead of drawing nothing silently.
  // `showDealStatus` (the UCT Intelligence indicator is on): the notice shows even while the drawings
  // layer itself is off, so a member who added the indicator always learns why nothing is drawn.
  if ((enabled || showDealStatus) && dealStatus?.pending) return <DealStatusNotice dealStatus={dealStatus} />

  // `showLearned` (admin panel toggle; default true = today's behaviour) withholds the learned block.
  // `enabled` is the pattern drawings' switch (Auto patterns); the support / resistance layer has its own
  // (`showLevelsSr`, the UCT Intelligence "Support & resistance" toggle), so it draws with Auto patterns off too.
  const hasDrawn = enabled && showLearned && !!drawn && ((drawn.trendlines?.length || 0) + (drawn.horizontals?.length || 0)) > 0
  const hasSr = showLevelsSr && hasLevelsSr(levelsSr)
  // The setup-drawing layer (`showSetupDraws`, the UCT Intelligence "Setups" toggle): the server sends it on
  // daily charts only, and a pending-acquisition chart has already returned its notice above.
  const setupRows = showSetupDraws && Array.isArray(setupDraws)
    ? setupDraws.filter((d) => d && d.geometry?.shape === 'horizontal_line' && d.geometry?.anchors?.length)
    : []
  const hasSetups = setupRows.length > 0
  if (!chart || !series || (!enabled && !hasSr && !hasSetups)
      || (!detections?.length && !hasDrawn && !hasSr && !hasSetups)) return null

  const drawable = enabled ? selectDrawable(detections, {
    tf, showExperimental, showLevels, lastPrice, suppress: hasDrawn ? drawn.suppress : null, trustedOnly,
  }) : []
  if (!drawable.length && !hasDrawn && !hasSr && !hasSetups) return null

  // Coordinate helpers — lightweight-charts caches internally so re-creating these per render is cheap.
  const tToX = (t) => {
    const ct = tf == null ? t : anchorToBarTime(t, tf, barTimes)
    if (ct == null) return null
    try { return chart.timeScale().timeToCoordinate(ct) } catch { return null }
  }
  const priceToY = (price) => {
    try { return series.priceToCoordinate(price) } catch { return null }
  }
  // Package 8D: an APPROXIMATE candle half-width in pixels, for CandleMark's
  // new candle-emphasis outline (the white-outline requirement) — not exact
  // candle-body geometry. lightweight-charts' timeScale barSpacing option is
  // read defensively (same try/catch convention as tToX/priceToY above); a
  // failure or unexpected shape falls back to a small fixed default rather
  // than throwing. Recomputed every render, same as tToX/priceToY, so it
  // tracks zoom changes via the existing forceRedraw subscription.
  let barHalfWidthPx = 4
  try {
    const spacing = chart.timeScale().options()?.barSpacing
    if (typeof spacing === 'number' && spacing > 0) barHalfWidthPx = spacing / 2
  } catch { /* keep the default */ }

  // `showLabels` false (the panel's "Pattern labels & numbers" toggle): the drawings stay, the buy point /
  // depth / stage / volume text block does not, and the label layout reserves no room for it.
  const views = showLabels ? drawable.map(rowView) : drawable.map((d) => ({ ...rowView(d), metricsLines: null }))
  // Candle extents in px, only when a metrics block needs placing (a base row with metrics) -- read lazily.
  let candlePx = null
  const readCandles = () => {
    if (candlePx) return candlePx
    candlePx = []
    if (!Array.isArray(candles)) return candlePx
    const ts = chart.timeScale()
    for (const c of candles) {
      if (!c || c.high == null || c.low == null) continue
      let x = null
      try { x = ts.timeToCoordinate(c.time) } catch { x = null }
      if (x == null) continue
      const yHigh = priceToY(c.high)
      const yLow = priceToY(c.low)
      if (yHigh == null || yLow == null) continue
      candlePx.push({ x, yHigh: Math.min(yHigh, yLow), yLow: Math.max(yHigh, yLow) })
    }
    return candlePx
  }
  const labelLayout = computeLabelLayout({
    views, drawn: hasDrawn ? drawn : null, tToX, priceToY,
    pane: { w: size.width, h: size.height }, candles: readCandles, halfW: barHalfWidthPx,
    levelsSr: hasSr ? levelsSr : null,
  })

  return (
    <LabelLayoutContext.Provider value={labelLayout}>
    <svg
      ref={svgRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size.width,
        height: size.height,
        pointerEvents: 'none', // children opt-in via pointerEvents: 'auto'
        zIndex: 5,             // above candles, below chart toolbar
      }}
    >
      <defs>
        {/* Soft glow applied to "recent" detections (detected_at within last 5 minutes). */}
        <filter id="patternGlow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {hasDrawn && (
        <LearnedDrawn drawn={drawn} tToX={tToX} priceToY={priceToY} droppedLabels={labelLayout.droppedLearned} />
      )}
      {hasSr && (
        <SupportResistanceLayer levelsSr={levelsSr} tToX={tToX} priceToY={priceToY} dy={labelLayout.srDy} />
      )}
      {hasSetups && setupRows.map((d) => (
        <g key={`setup:${d.id}`} data-setup-draw={d.pattern_id}>
          <HorizontalLine detection={d} tToX={tToX} priceToY={priceToY} onClick={onDetectionClick} />
        </g>
      ))}
      {views.map((v) => {
        const { d, ex, flatTop, base, insideDay, shapeDraw, shelf, Renderer, pivot, handle, rimRef, secondary, entry, anchors, tlBreak, metricsLines } = v
        return (
          <g key={d.id} data-detection={d.pattern_id} data-flag-tier={d.flag_tier}>
            {Renderer && (
              <Renderer
                detection={d}
                tToX={tToX}
                priceToY={priceToY}
                barHalfWidthPx={barHalfWidthPx}
                onClick={onDetectionClick}
              />
            )}
            {pivot && (
              <LevelSegment
                detection={{
                  ...d,
                  id: `${d.id}:pivot`,
                  confidence: null,
                  geometry: {
                    shape: 'horizontal_line',
                    label: rimRef
                      ? `Pivot ${Number(pivot.price).toFixed(2)} · handle high`
                      : `Pivot ${Number(pivot.price).toFixed(2)}`,
                    anchors: [
                      { t: pivot.start_t, price: Number(pivot.price) },
                      { t: pivot.end_t, price: Number(pivot.price) },
                    ],
                  },
                }}
                tToX={tToX}
                priceToY={priceToY}
                onClick={onDetectionClick}
                extendRight={40}
                dashed={false}
                role="pivot"
              />
            )}
            {flatTop && (
              <g data-role="flat-top">
                <LevelSegment
                  detection={{
                    ...d,
                    id: `${d.id}:flat-top`,
                    confidence: null,
                    geometry: {
                      shape: 'horizontal_line',
                      label: flatTop.label,
                      anchors: [
                        { t: flatTop.start_t, price: flatTop.price },
                        { t: flatTop.end_t, price: flatTop.price },
                      ],
                    },
                  }}
                  tToX={tToX}
                  priceToY={priceToY}
                  onClick={onDetectionClick}
                  extendRight={40}
                  dashed={false}
                  role="flat-top-line"
                />
                {flatTop.touches.map((tch, i) => {
                  const x = tToX(tch.t)
                  const y = priceToY(tch.price)
                  if (x == null || y == null) return null
                  return (
                    <circle key={i} data-role="flat-top-touch" cx={x} cy={y} r={4}
                      fill="none" stroke={getColor(d)} strokeWidth={1.4} opacity={getOpacity(d)}
                      style={{ pointerEvents: 'none' }} />
                  )
                })}
              </g>
            )}
            {base && (() => {
              const x1 = tToX(base.start_t)
              // the region and the low line end at the base's own end (a breakout state's base_end_t)
              const baseEndT = base.base_end_t ?? base.end_t
              const x2 = tToX(baseEndT)
              const forming = base.state === 'forming'
              const yP = priceToY(base.pivot)
              const yL = priceToY(base.low)
              const region = [x1, x2, yP, yL].every((v) => v != null) ? (
                <rect data-role="base-region" x={Math.min(x1, x2)} y={Math.min(yP, yL)}
                  width={Math.max(1, Math.abs(x2 - x1))} height={Math.max(1, Math.abs(yL - yP))}
                  fill={getColor(d)} fillOpacity={getOpacity(d) * (forming ? 0.05 : 0.08)} stroke="none"
                  style={{ pointerEvents: 'none' }} />
              ) : null
              const level = (suffix, price, label, extra, endT = baseEndT) => (
                <LevelSegment
                  detection={{
                    ...d,
                    id: `${d.id}:${suffix}`,
                    confidence: null,
                    geometry: {
                      shape: 'horizontal_line',
                      label,
                      anchors: [{ t: base.start_t, price }, { t: endT, price }],
                    },
                  }}
                  tToX={tToX}
                  priceToY={priceToY}
                  onClick={onDetectionClick}
                  {...extra}
                />
              )
              return (
                <g data-role="base-draw" data-base-state={base.state || undefined}>
                  {region}
                  {level('base-pivot', base.pivot, base.label,
                    { extendRight: 40, dashed: forming, role: 'base-pivot' }, base.end_t)}
                  {level('base-low', base.low, base.lowLabel, { dashed: true, role: 'base-low' })}
                </g>
              )
            })()}
            {shapeDraw && (() => {
              const x1 = tToX(shapeDraw.start_t)
              const x2 = tToX(shapeDraw.end_t)
              const yT = priceToY(shapeDraw.top)
              const yL = priceToY(shapeDraw.low)
              const region = [x1, x2, yT, yL].every((v) => v != null) ? (
                <rect data-role="shape-region" x={Math.min(x1, x2)} y={Math.min(yT, yL)}
                  width={Math.max(1, Math.abs(x2 - x1))} height={Math.max(1, Math.abs(yL - yT))}
                  fill={getColor(d)} fillOpacity={getOpacity(d) * 0.08} stroke="none"
                  style={{ pointerEvents: 'none' }} />
              ) : null
              const level = (suffix, price, label, fromT, extra) => (
                <LevelSegment
                  detection={{
                    ...d,
                    id: `${d.id}:${suffix}`,
                    confidence: null,
                    geometry: {
                      shape: 'horizontal_line',
                      label,
                      anchors: [{ t: fromT, price }, { t: shapeDraw.end_t, price }],
                    },
                  }}
                  tToX={tToX}
                  priceToY={priceToY}
                  onClick={onDetectionClick}
                  {...extra}
                />
              )
              const pts = shapeDraw.marks
                .map((m) => [tToX(m.t), priceToY(m.price)])
                .filter(([px, py]) => px != null && py != null)
              return (
                <g data-role="shape-draw">
                  {region}
                  {shapeDraw.path && pts.length >= 2 && (
                    <polyline data-role="shape-path" points={pts.map((p) => p.join(',')).join(' ')}
                      fill="none" stroke={getColor(d)} strokeWidth={1} strokeDasharray="2,3"
                      opacity={getOpacity(d)} style={{ pointerEvents: 'none' }} />
                  )}
                  {pts.map(([px, py], i) => (
                    <circle key={i} data-role="shape-mark" cx={px} cy={py} r={3}
                      fill={getColor(d)} opacity={getOpacity(d)} style={{ pointerEvents: 'none' }} />
                  ))}
                  {level('shape-pivot', shapeDraw.pivot, shapeDraw.label, shapeDraw.pivot_from_t,
                    { extendRight: 40, dashed: false, role: 'shape-pivot' })}
                  {level('shape-low', shapeDraw.low, shapeDraw.lowLabel, shapeDraw.start_t,
                    { dashed: true, role: 'shape-low' })}
                </g>
              )
            })()}
            {shelf && (() => {
              const x1 = tToX(shelf.start_t)
              const x2 = tToX(shelf.end_t)
              const y = priceToY(shelf.price)
              if (x1 == null || x2 == null || y == null) return null
              const xEnd = Math.max(x1, x2) + 40
              return (
                <g data-role="shelf-pivot" data-shape="shelf-pivot" onClick={() => onDetectionClick?.(d)}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
                  {shelf.tooltip && <title>{shelf.tooltip}</title>}
                  <line x1={Math.min(x1, x2)} y1={y} x2={xEnd} y2={y} stroke={SHELF_PIVOT_COLOR}
                    strokeWidth={1.75} />
                  <text data-role="shelf-pivot-label" x={xEnd + 4} y={y + 3 + (labelLayout.dy[`${d.id}:shelf`] || 0)} fontSize="10" fontWeight="600"
                    fill={SHELF_PIVOT_COLOR} textAnchor="start" style={{ pointerEvents: 'none' }}>
                    {shelf.label}
                  </text>
                </g>
              )
            })()}
            {insideDay && (() => {
              const x1 = tToX(insideDay.start_t)
              const x2 = tToX(insideDay.inside_t)
              const yH = priceToY(insideDay.motherHigh)
              const yL = priceToY(insideDay.motherLow)
              // the box covers the mother bar through the inside day: half a bar either side
              const box = [x1, x2, yH, yL].every((v) => v != null) ? (
                <rect data-role="inside-day-box" x={Math.min(x1, x2) - barHalfWidthPx}
                  y={Math.min(yH, yL)} width={Math.max(1, Math.abs(x2 - x1) + 2 * barHalfWidthPx)}
                  height={Math.max(1, Math.abs(yL - yH))}
                  fill={getColor(d)} fillOpacity={getOpacity(d) * 0.08} stroke="none"
                  style={{ pointerEvents: 'none' }} />
              ) : null
              const level = (suffix, price, label, extra) => (
                <LevelSegment
                  detection={{
                    ...d,
                    id: `${d.id}:${suffix}`,
                    confidence: null,
                    geometry: {
                      shape: 'horizontal_line',
                      label,
                      anchors: [{ t: insideDay.start_t, price }, { t: insideDay.end_t, price }],
                    },
                  }}
                  tToX={tToX}
                  priceToY={priceToY}
                  onClick={onDetectionClick}
                  {...extra}
                />
              )
              return (
                <g data-role="inside-day-draw">
                  {box}
                  {level('inside-day-trigger', insideDay.trigger, insideDay.label,
                    { extendRight: 40, dashed: false, role: 'inside-day-trigger' })}
                  {level('inside-day-stop', insideDay.stop, insideDay.stopLabel,
                    { dashed: true, role: 'inside-day-stop' })}
                </g>
              )
            })()}
            {rimRef && (
              <LevelSegment
                detection={{
                  ...d,
                  id: `${d.id}:rim-ref`,
                  confidence: null,
                  geometry: {
                    shape: 'horizontal_line',
                    label: `Rim ${Number(rimRef.price).toFixed(2)}`,
                    anchors: [
                      { t: rimRef.start_t, price: Number(rimRef.price) },
                      { t: rimRef.end_t, price: Number(rimRef.price) },
                    ],
                  },
                }}
                tToX={tToX}
                priceToY={priceToY}
                onClick={onDetectionClick}
                extendRight={40}
                faint
                role="rim-ref"
              />
            )}
            {handle && (
              <Rectangle
                detection={{
                  ...d,
                  id: `${d.id}:handle`,
                  pattern_name: 'Handle',
                  confidence: null,
                  geometry: {
                    shape: 'rectangle',
                    anchors: [
                      { t: handle.start_t, price: Number(handle.top) },
                      { t: handle.end_t, price: Number(handle.floor) },
                    ],
                  },
                }}
                tToX={tToX}
                priceToY={priceToY}
                onClick={onDetectionClick}
              />
            )}
            {tlBreak && (
              <g data-role="trendline-break">
                <TrendlinePair detection={tlBreak} tToX={tToX} priceToY={priceToY} onClick={() => onDetectionClick?.(d)} />
                {tlBreak.geometry.anchors.slice(0, 2).map((a, i) => {
                  const x = tToX(a.t)
                  const y = priceToY(a.price)
                  if (x == null || y == null) return null
                  return (
                    <circle key={i} data-role="anchor-high" cx={x} cy={y} r={3}
                      fill={getColor(d)} opacity={getOpacity(d)} style={{ pointerEvents: 'none' }} />
                  )
                })}
              </g>
            )}
            {Array.isArray(ex.draw_pole) && (
              <PoleSegment detection={d} tToX={tToX} priceToY={priceToY} onClick={onDetectionClick} />
            )}
            {secondary.map((sec, i) => {
              if (!sec || !Array.isArray(sec.anchors) || !sec.anchors.length) return null
              const sub = {
                ...d,
                id: `${d.id}:sec${i}`,
                pattern_name: sec.label || sec.role || d.pattern_name,
                confidence: null,
                geometry: { shape: sec.shape, anchors: sec.anchors, label: sec.label },
              }
              if (sec.shape === 'rectangle') {
                return <Rectangle key={sub.id} detection={sub} tToX={tToX} priceToY={priceToY} onClick={onDetectionClick} />
              }
              // a re-anchored stop usually starts ON the last bar: extend it right like the pivot
              return <LevelSegment key={sub.id} detection={sub} tToX={tToX} priceToY={priceToY} onClick={onDetectionClick}
                extendRight={sec.draw_stop ? 40 : 0} />
            })}
            {Number.isFinite(entry) && anchors.length > 0 && (
              <LevelSegment
                detection={{
                  ...d,
                  id: `${d.id}:entry`,
                  confidence: null,
                  geometry: {
                    shape: 'horizontal_line',
                    label: `Entry ${entry.toFixed(2)}`,
                    anchors: [
                      { t: anchors[0].t, price: entry },
                      { t: anchors[anchors.length - 1].t, price: entry },
                    ],
                  },
                }}
                tToX={tToX}
                priceToY={priceToY}
                onClick={onDetectionClick}
                extendRight={40}
              />
            )}
            {metricsLines && (
              <BaseMetricsText d={d} lines={metricsLines} place={labelLayout.metrics[d.id]} />
            )}
          </g>
        )
      })}
    </svg>
    </LabelLayoutContext.Provider>
  )
}
