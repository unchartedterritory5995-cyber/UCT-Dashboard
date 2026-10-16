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
import { useEffect, useRef, useState, useCallback } from 'react'
import TrendlinePair from './patternShapes/TrendlinePair'
import Neckline from './patternShapes/Neckline'
import CupCurve from './patternShapes/CupCurve'
import Rectangle from './patternShapes/Rectangle'
import CandleMark from './patternShapes/CandleMark'
import HorizontalLine from './patternShapes/HorizontalLine'
import BaseBox from './patternShapes/BaseBox'
import LevelSegment from './patternShapes/LevelSegment'
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
 * Which detections draw, given the server's per-row policy and the viewer's toggles.
 * Pure — exported for tests.
 */
export function selectDrawable(detections, { tf, showExperimental = true, showLevels = false, lastPrice = null } = {}) {
  const dateTf = tf == null ? false : isDateTf(tf)
  const structures = []
  const levels = []
  for (const d of detections || []) {
    if (!d) continue
    if (d.display_tier === 'hidden') continue
    if (d.display_tier === 'experimental' && !showExperimental) continue
    if (dateTf && d.intraday_only) continue
    if (d.display_layer === 'levels') levels.push(d)
    else structures.push(d)
  }
  if (!showLevels || !levels.length) return structures
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

  if (!enabled || !chart || !series || !detections?.length) return null

  const drawable = selectDrawable(detections, { tf, showExperimental, showLevels, lastPrice })
  if (!drawable.length) return null

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
      {drawable.map((d) => {
        const shape = d?.geometry?.shape
        const Renderer = SHAPE_RENDERERS[shape]
        const secondary = Array.isArray(d?.geometry?.secondary) ? d.geometry.secondary : []
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
