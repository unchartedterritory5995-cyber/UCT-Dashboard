// app/src/components/chart/PatternOverlay.jsx — SVG overlay for engine-detected chart patterns.
//
// Task 1 (Phase 5): foundation only. Renders placeholder debug markers (circles + ticker labels) at
// each detection's first anchor. Task 2 will dispatch to real shape renderers per pattern_id.
//
// Peer layer to ChartDrawingOverlay — both live inside the StockChart `wrapper` (position: relative)
// and are sized to overlay the chart's `containerRef` div. The SVG opts out of pointer events at the
// root so user drawings/clicks underneath are unaffected; individual <g> hit targets opt back in.
//
// Subscribes to lightweight-charts v5 timeScale events (visible-time + visible-logical) so shapes
// reproject on scroll/zoom. Coordinate conversion is `chart.timeScale().timeToCoordinate(t)` and
// `series.priceToCoordinate(price)` — both return null when the point is off-screen, which we treat
// as a skip-render condition.
import { useEffect, useRef, useState, useCallback } from 'react'

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

  // Task 1: debug placeholder markers. Task 2 will swap this for per-pattern shape renderers.
  if (typeof window !== 'undefined' && detections.length) {
    // One-shot console signal so developers can confirm the overlay is wired up during smoke tests.
    console.debug(
      '[PatternOverlay] rendering',
      detections.length,
      'detections:',
      detections.map((d) => `${d.pattern_id}:${d.direction || 'neutral'}@${d.confidence ?? '?'}`).join(', ')
    )
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
      {detections.map((d) => {
        const first = d.geometry?.anchors?.[0]
        if (!first) return null
        const x = tToX(first.t)
        const y = priceToY(first.price)
        if (x == null || y == null) return null

        const color =
          d.direction === 'bullish'
            ? '#10b981'
            : d.direction === 'bearish'
            ? '#ef4444'
            : '#c9a84c'
        const opacity = Math.max(0.4, (d.confidence || 50) / 100)

        return (
          <g
            key={d.id}
            onClick={() => onDetectionClick?.(d)}
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
          >
            <circle cx={x} cy={y} r={8} fill={color} opacity={opacity} />
            <text x={x + 12} y={y + 4} fontSize="11" fill={color}>
              {d.pattern_id}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
