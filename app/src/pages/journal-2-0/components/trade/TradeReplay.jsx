/**
 * TradeReplay — bar-by-bar playback of ONE closed trade (v1).
 *
 * ⭐ Since wave 13 lane 13H-2 the engine is `../notebook/BarReplay.jsx` — the one replay
 * engine, generalised from this file so a note chart's "what happened next" could reuse it
 * rather than grow a second one. What stays here is only what is particular to a TRADE: the
 * window around entry..exit, the entry/exit markers, and the running P&L. The invariants that
 * made this its own chart are BarReplay's now and unchanged: its own lightweight-charts
 * instance, NEVER a mode of StockChart (whose single-writer invariant a replay writer would
 * break — `singleWriterIndex.test.js`), created on open, destroyed on close, bars from the same
 * `/api/bars` rail.
 *
 * Timeframe: 5-minute bars when the hold is short and recent enough for the intraday window to
 * cover it, else daily — stated in the header, never silently substituted. Entry/exit markers
 * appear only when playback REACHES them; the running P&L reads from each bar's close
 * (side-aware), realized at exit.
 */

import { useCallback } from 'react'
import BarReplay, { barTs } from '../notebook/BarReplay'
import { money, moneySigned } from '../../../../lib/journal-2-0'

const PAD_BEFORE = 20        // context bars before entry
const PAD_AFTER = 10

function tsOf(iso) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

export default function TradeReplay({ trade, onClose }) {
  const entryTs = tsOf(trade.entryDate)
  const exitTs = tsOf(trade.exitDate)
  // 5m intraday history reaches ~55 trading days back on the bars rail;
  // outside that (or long holds) the honest tier is daily.
  const ageDays = entryTs ? (Date.now() / 1000 - entryTs) / 86400 : Infinity
  const tf = (trade.holdDays != null && trade.holdDays <= 5 && ageDays <= 55) ? '5' : 'D'

  // Daily bars anchor at NOON UTC of their day, so timestamp compares must be DAY-floored on
  // the daily tier — an entry at 14:30Z otherwise lands PAST its own day's bar and the entry
  // marker slips a day late (the same bug class the excursion engine's contract window hit).
  const cmpTs = useCallback((ts) => {
    if (ts == null || tf !== 'D') return ts
    return ts - (ts % 86400)
  }, [tf])

  // First bar at-or-after a timestamp, inside a window.
  const indexAt = useCallback((bars, ts) => {
    if (ts == null) return -1
    const t0 = cmpTs(ts)
    for (let i = 0; i < bars.length; i++) {
      if (barTs(bars[i].t) >= t0) return i
    }
    return bars.length - 1
  }, [cmpTs])

  const windowBars = useCallback((all) => {
    const lo = cmpTs(entryTs ?? 0)
    const hi = (cmpTs(exitTs) ?? lo) + (tf === 'D' ? 86400 : 0)
    let start = all.findIndex((b) => barTs(b.t) >= lo)
    if (start < 0) start = all.length
    let end = all.length - 1
    for (let i = all.length - 1; i >= 0; i--) {
      if (barTs(all[i].t) <= hi) { end = i; break }
    }
    const w = all.slice(Math.max(0, start - PAD_BEFORE), Math.min(all.length, end + 1 + PAD_AFTER))
    if (w.length < 3) return { error: 'No bar history covers this trade’s window.' }
    return { bars: w, startIdx: 0 }
  }, [cmpTs, entryTs, exitTs, tf])

  const markersAt = useCallback((idx, bars) => {
    const entryIdx = indexAt(bars, entryTs)
    const exitIdx = indexAt(bars, exitTs)
    const marks = []
    if (entryIdx >= 0 && idx > entryIdx) {
      marks.push({
        time: bars[entryIdx].t, position: 'belowBar', color: '#22c55e',
        shape: 'arrowUp', text: `${trade.side === 'Short' ? 'SHORT' : 'BUY'} ${money(trade.entryPrice)}`,
      })
    }
    if (exitIdx >= 0 && idx > exitIdx) {
      marks.push({
        time: bars[exitIdx].t, position: 'aboveBar', color: '#ef4444',
        shape: 'arrowDown', text: `EXIT ${money(trade.exitPrice)}`,
      })
    }
    return marks
  }, [indexAt, entryTs, exitTs, trade.side, trade.entryPrice, trade.exitPrice])

  // Running P&L off the last revealed close, side-aware; realized past exit.
  const statusAt = useCallback((idx, bars) => {
    if (idx === 0) return { label: 'Waiting…', value: null, tone: null }
    const entryIdx = indexAt(bars, entryTs)
    const exitIdx = indexAt(bars, exitTs)
    const last = bars[Math.min(idx, bars.length) - 1]
    if (entryIdx < 0 || idx <= entryIdx) return { label: 'Before entry', value: null, tone: null }
    const sign = trade.side === 'Short' ? -1 : 1
    let pnl
    let label
    let done = false
    if (exitIdx >= 0 && idx > exitIdx) {
      pnl = sign * (trade.exitPrice - trade.entryPrice) * (trade.shares || 0)
      label = 'Closed'
      done = true
    } else {
      pnl = sign * (last.c - trade.entryPrice) * (trade.shares || 0)
      label = 'In trade'
    }
    return { label, value: `${moneySigned(pnl)}${done ? ' realized' : ''}`, tone: pnl >= 0 ? 'pos' : 'neg' }
  }, [indexAt, entryTs, exitTs, trade.side, trade.exitPrice, trade.entryPrice, trade.shares])

  const priceLines = [{ price: trade.entryPrice, color: '#c9a84c', title: 'entry' }]
  if (trade.exitPrice != null) priceLines.push({ price: trade.exitPrice, color: '#8a8a8a', title: 'exit' })

  return (
    <BarReplay
      symbol={trade.symbol}
      tf={tf}
      title={`Replay · ${trade.symbol}`}
      tfNote={tf === '5' ? '5-minute bars' : 'daily bars'}
      windowBars={windowBars}
      priceLines={priceLines}
      markersAt={markersAt}
      statusAt={statusAt}
      autoplay
      onClose={onClose}
    />
  )
}
