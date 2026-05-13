// app/src/components/chart/PatternOverlay.jsx — SVG overlay for engine-detected chart patterns.
//
// Task 2 (Phase 5): dispatches each detection to a shape-specific renderer based on
// `detection.geometry.shape`. The shape renderers live in ./patternShapes/ — one file per geometry
// type (trendline_pair, neckline, cup_curve, rectangle, candle_mark, horizontal_line).
//
// Peer layer to ChartDrawingOverlay — both live inside the StockChart `wrapper` (position: relative)
// and are sized to overlay the chart's `containerRef` div. The SVG opts out of pointer events at the
// root so user drawings/clicks underneath are unaffected; individual <g> hit targets opt back in.
//
// Subscribes to lightweight-charts v5 timeScale events (visible-time + visible-logical) so shapes
// reproject on scroll/zoom. Coordinate conversion is `chart.timeScale().timeToCoordinate(t)` and
// `series.priceToCoordinate(price)` — both return null when the point is off-screen, which the
// renderers treat as a skip-render condition.
import { useEffect, useRef, useState, useCallback } from 'react'
import TrendlinePair from './patternShapes/TrendlinePair'
import Neckline from './patternShapes/Neckline'
import CupCurve from './patternShapes/CupCurve'
import Rectangle from './patternShapes/Rectangle'
import CandleMark from './patternShapes/CandleMark'
import HorizontalLine from './patternShapes/HorizontalLine'

const SHAPE_RENDERERS = {
  trendline_pair: TrendlinePair,
  neckline: Neckline,
  cup_curve: CupCurve,
  rectangle: Rectangle,
  candle_mark: CandleMark,
  horizontal_line: HorizontalLine,
}

/**
 * Props:
 *   chart:             lightweight-charts IChartApi (already created in parent)
 *   series:            ISeriesApi — the candle series, used for priceToCoordinate
 *   containerRef:      ref to the chart's DOM container (sizing source for the SVG)
 *   detections:        Detection[] from /api/patterns/{sym}
 *   enabled:           boolean — when false the overlay returns null
 *   onDetectionClick:  (detection) => void — fired when a shape is clicked
 */
export default function PatternOverlay({
  chart,
  series,
  containerRef,
  detections,
  enabled,
  onDetectionClick,
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

  // Coordinate helpers — lightweight-charts caches internally so re-creating these per render is cheap.
  const tToX = (t) => {
    try { return chart.timeScale().timeToCoordinate(t) } catch { return null }
  }
  const priceToY = (price) => {
    try { return series.priceToCoordinate(price) } catch { return null }
  }

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
      {detections.map((d) => {
        const shape = d?.geometry?.shape
        const Renderer = SHAPE_RENDERERS[shape]
        if (!Renderer) return null
        return (
          <Renderer
            key={d.id}
            detection={d}
            tToX={tToX}
            priceToY={priceToY}
            onClick={onDetectionClick}
          />
        )
      })}
    </svg>
  )
}
