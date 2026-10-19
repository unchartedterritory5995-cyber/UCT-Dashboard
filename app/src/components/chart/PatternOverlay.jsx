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
//   Whether `drawn` is present is the SERVER's call (admins; members only with the team set on).
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
  return {
    pivot, low, start_t: bd.start_t, end_t: bd.end_t,
    label: bd.label || 'pivot', lowLabel: bd.low_label || 'base low',
  }
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
 */
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

  const hasDrawn = !!drawn && ((drawn.trendlines?.length || 0) + (drawn.horizontals?.length || 0)) > 0
  if (!enabled || !chart || !series || (!detections?.length && !hasDrawn)) return null

  const drawable = selectDrawable(detections, {
    tf, showExperimental, showLevels, lastPrice, suppress: hasDrawn ? drawn.suppress : null, trustedOnly,
  })
  if (!drawable.length && !hasDrawn) return null

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

  return (
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
      {hasDrawn && <LearnedDrawn drawn={drawn} tToX={tToX} priceToY={priceToY} />}
      {drawable.map((row) => {
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
        const Renderer = (flatTop || base) ? null : (hasEma ? EmaSegment : ((lanesOff || boxOff) ? null : SHAPE_RENDERERS[shape]))
        const pivot = ex.draw_pivot && Number.isFinite(Number(ex.draw_pivot.price)) ? ex.draw_pivot : null
        const handle = ex.draw_handle && Number.isFinite(Number(ex.draw_handle.top)) ? ex.draw_handle : null
        // Cup round 9: a right side that stalled under the rim pivots at the HANDLE HIGH; the rim stays
        // as a faint, separately labelled reference so the two lines are never read as one.
        const rimRef = pivot && ex.draw_rim_ref && Number.isFinite(Number(ex.draw_rim_ref.price)) ? ex.draw_rim_ref : null
        // The curve replaces the flat MA level; the stop level stays. Round 5: `draw_stop` moves
        // the stop to start at the TAG bar (the detector's own stop secondary runs from the
        // 10-session high, far left) — same price, same label, display only.
        const drawStop = ex.draw_stop && Number.isFinite(Number(ex.draw_stop.price)) ? ex.draw_stop : null
        const secondary = (Array.isArray(d?.geometry?.secondary) && !flatTop && !base ? d.geometry.secondary : [])
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
              const x2 = tToX(base.end_t)
              const yP = priceToY(base.pivot)
              const yL = priceToY(base.low)
              const region = [x1, x2, yP, yL].every((v) => v != null) ? (
                <rect data-role="base-region" x={Math.min(x1, x2)} y={Math.min(yP, yL)}
                  width={Math.max(1, Math.abs(x2 - x1))} height={Math.max(1, Math.abs(yL - yP))}
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
                      anchors: [{ t: base.start_t, price }, { t: base.end_t, price }],
                    },
                  }}
                  tToX={tToX}
                  priceToY={priceToY}
                  onClick={onDetectionClick}
                  {...extra}
                />
              )
              return (
                <g data-role="base-draw">
                  {region}
                  {level('base-pivot', base.pivot, base.label, { extendRight: 40, dashed: false, role: 'base-pivot' })}
                  {level('base-low', base.low, base.lowLabel, { dashed: true, role: 'base-low' })}
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
          </g>
        )
      })}
    </svg>
  )
}
