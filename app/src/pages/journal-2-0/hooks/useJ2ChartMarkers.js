/**
 * useJ2ChartMarkers — produce lightweight-charts markers AND price lines
 * for the given symbol + timeframe from the user's Journal 2.0 positions
 * and trades.
 *
 * Returns:
 *   {
 *     markers:    triangle markers for entry/exit events
 *     priceLines: horizontal lines at entry (green) + active stop (red)
 *                 for each OPEN position in the current symbol
 *   }
 *
 * Markers are time-formatted via computeBarTime so they snap to the
 * correct bar on every timeframe (intraday through monthly).
 *
 * Silently returns empty results for unauth'd users (SWR fails quietly
 * on 401).
 */

import { useMemo } from 'react'
import useJ2Positions from './useJ2Positions'
import useJ2Trades from './useJ2Trades'
import { computeBarTime } from '../../../components/chart/barTime'

const COLOR_GREEN = '#22c55e'
const COLOR_RED = '#ef4444'
const COLOR_BE = '#eab308'

const EMPTY = { markers: [], priceLines: [] }

function markerTimeFor(tf, isoDate) {
  if (!isoDate) return null
  const d = new Date(isoDate)
  const sec = Math.floor(d.getTime() / 1000)
  if (!Number.isFinite(sec)) return null
  return computeBarTime(tf, sec)
}

function compareTime(a, b) {
  const aIsStr = typeof a.time === 'string'
  const bIsStr = typeof b.time === 'string'
  if (aIsStr && bIsStr) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
  if (!aIsStr && !bIsStr) return a.time - b.time
  const aMs = aIsStr ? new Date(a.time).getTime() : Number(a.time) * 1000
  const bMs = bIsStr ? new Date(b.time).getTime() : Number(b.time) * 1000
  return aMs - bMs
}

function activeStopFor(p) {
  return p.raiseToBreakeven && p.breakevenStop != null
    ? p.breakevenStop
    : p.stopPrice
}

/**
 * @param {string} symbol  — e.g. "NVDA"
 * @param {string} tf      — "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M"
 * @returns {{ markers: Array, priceLines: Array }}
 */
export default function useJ2ChartMarkers(symbol, tf) {
  const { positions } = useJ2Positions()
  const { trades } = useJ2Trades()

  return useMemo(() => {
    if (!symbol || !tf) return EMPTY
    const upper = symbol.toUpperCase()
    const markers = []
    const priceLines = []

    // ── Open-position markers + price lines ──
    for (const p of positions || []) {
      if (!p || (p.symbol || '').toUpperCase() !== upper) continue
      const isLong = p.side === 'Long'

      // Entry triangle
      const entryTime = markerTimeFor(tf, p.entryDate)
      if (entryTime != null) {
        markers.push({
          time: entryTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: isLong ? COLOR_GREEN : COLOR_RED,
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: `${isLong ? 'L' : 'S'} ${p.shares} @ $${Number(p.entryPrice).toFixed(2)}`,
          size: 2,
        })
      }

      // Entry price line (green, dashed)
      priceLines.push({
        price: Number(p.entryPrice),
        color: COLOR_GREEN,
        lineWidth: 1,
        lineStyle: 2,               // dashed
        axisLabelVisible: true,
        title: `${isLong ? 'L' : 'S'} Entry`,
      })

      // Stop price line (red, dashed). Shows activeStop — reflects
      // raise-to-BE toggle without changing the original stop.
      const stop = Number(activeStopFor(p))
      if (Number.isFinite(stop) && stop > 0) {
        const raisedToBe = p.raiseToBreakeven && p.breakevenStop != null
        priceLines.push({
          price: stop,
          color: raisedToBe ? COLOR_BE : COLOR_RED,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: raisedToBe ? 'BE Stop' : 'Stop',
        })
      }
    }

    // ── Closed-trade entry + exit markers ──
    // (No price lines for closed trades — they're historical and would
    // clutter the chart; markers alone convey entry/exit prices visually.)
    for (const t of trades || []) {
      if (!t || (t.symbol || '').toUpperCase() !== upper) continue
      const isLong = t.side === 'Long'

      const entryTime = markerTimeFor(tf, t.entryDate)
      if (entryTime != null) {
        markers.push({
          time: entryTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: isLong ? COLOR_GREEN : COLOR_RED,
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: `${isLong ? 'BUY' : 'SHORT'} ${t.shares}`,
          size: 2,
        })
      }

      const exitTime = markerTimeFor(tf, t.exitDate)
      if (exitTime != null) {
        const exitColor =
          t.result === 'Win' ? COLOR_GREEN : t.result === 'Loss' ? COLOR_RED : COLOR_BE
        markers.push({
          time: exitTime,
          position: isLong ? 'aboveBar' : 'belowBar',
          color: exitColor,
          shape: isLong ? 'arrowDown' : 'arrowUp',
          text: `${isLong ? 'SELL' : 'COVER'} ${t.result}`,
          size: 2,
        })
      }
    }

    markers.sort(compareTime)
    return { markers, priceLines }
  }, [positions, trades, symbol, tf])
}
