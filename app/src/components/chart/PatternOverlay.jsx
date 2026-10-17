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
//   `draw_box: false` (line only, no box), `draw_handle` (a cup's capped handle), `stale` (a base
//   that broke down: not drawn), and for the MA pullback `draw_ema.kind` / `draw_ema.tag` (the
//   tagged EMA/SMA curve and the tag-bar marker; its flat `tagged_ma` secondary is then skipped).
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

/**
 * Which detections draw, given the server's per-row policy and the viewer's toggles.
 * Pure — exported for tests.
 */
export function selectDrawable(detections, { tf, showExperimental = true, showLevels = false, lastPrice = null, suppress = null, trustedOnly = false } = {}) {
  const dateTf = tf == null ? false : isDateTf(tf)
  const structures = []
  const levels = []
  for (const d of detections || []) {
    if (!d) continue
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
        const Renderer = hasEma ? EmaSegment : ((lanesOff || boxOff) ? null : SHAPE_RENDERERS[shape])
        const pivot = ex.draw_pivot && Number.isFinite(Number(ex.draw_pivot.price)) ? ex.draw_pivot : null
        const handle = ex.draw_handle && Number.isFinite(Number(ex.draw_handle.top)) ? ex.draw_handle : null
        // The curve replaces the flat MA level; the stop level stays.
        const secondary = (Array.isArray(d?.geometry?.secondary) ? d.geometry.secondary : [])
          .filter((sec) => !(hasEma && sec?.role === 'tagged_ma'))
        const entry = d?.draw_entry ? Number(d?.levels?.entry) : NaN
        const anchors = d?.geometry?.anchors || []
        return (
          <g key={d.id} data-detection={d.pattern_id}>
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
                    label: `Pivot ${Number(pivot.price).toFixed(2)}`,
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
              return <LevelSegment key={sub.id} detection={sub} tToX={tToX} priceToY={priceToY} onClick={onDetectionClick} />
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
