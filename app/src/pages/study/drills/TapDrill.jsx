/**
 * TapDrill — type 14 (spec §4.3, §13.7 D10, D18): point at the wick, the pivot,
 * the gap, the 50-day, the base low on the chart.
 *
 * Touch borrows the drawing overlay's tap-tap model: one tap places a dot and
 * a soft halo at the anchor, a second tap MOVES it, never a drag. A HUD chip
 * at the bottom centre of the chart reads "Tap the pivot" and then "Tap Check,
 * or tap again to move". On reveal the accepted region prints as a dashed
 * ring on the same chart. Keyboard: a bar cursor (Left / Right one bar, Home /
 * End, Enter places) with a live region reading the bar under it.
 *
 * The player owns the chart; this module is the reducer (`onChartTap`), the
 * drawings (`annotationsFor`) and the HUD (`ChartOverlay`). The tap point
 * arrives from the player as {time, price, barIndex}.
 *
 * prompt_json: { question, target: 'the pivot', price_from?: 'h' | 'l' | 'c' }
 * Answer: {bar_index, price, time}
 */
import { useCallback, useEffect, useState } from 'react'
import { barsWord } from './types'
import styles from './drills.module.css'

const DOT_BARS = 1
const DOT_PCT = 0.004
const HALO_BARS = 3
const HALO_PCT = 0.015
const GOLD = '#dcbb5e'
const GOLD_SOFT = 'rgba(220, 187, 94, 0.55)'

export function targetOf(item) {
  return item?.prompt_json?.target || 'the spot'
}

export function hudText(state, locked) {
  if (locked) return 'Placed'
  if (state?.barIndex == null) return `Tap ${targetOf({ prompt_json: { target: state?.target } })}`
  return 'Tap Check, or tap again to move'
}

export function framingOf(item) {
  const p = item?.prompt_json || {}
  if (p.framing) return p.framing
  const n = barsOf(item).length
  return n ? `Daily chart, ${barsWord(n)}. Tap ${targetOf(item)}.` : `Daily chart. Tap ${targetOf(item)}.`
}

export function barsOf(item) {
  const b = item?.bars
  if (Array.isArray(b)) return b
  if (Array.isArray(b?.bars)) return b.bars
  return []
}

function priceFor(bar, item) {
  const from = item?.prompt_json?.price_from
  if (from && bar?.[from] != null) return Number(bar[from])
  const t = targetOf(item).toLowerCase()
  if (/low|bottom|support/.test(t) && bar?.l != null) return Number(bar.l)
  if (/high|wick|pivot|top|resistance/.test(t) && bar?.h != null) return Number(bar.h)
  return Number(bar?.c ?? bar?.h ?? 0)
}

/** Pure reducer: a tap places or moves the single anchor. */
export function onChartTap(state, point, item, bars) {
  const list = bars || barsOf(item)
  let idx = point?.barIndex
  if (idx == null && point?.time != null) idx = list.findIndex((b) => String(b.t) === String(point.time))
  if (idx == null || idx < 0) return state
  idx = Math.max(0, Math.min(list.length - 1, idx))
  const bar = list[idx]
  const price = Number.isFinite(point?.price) ? point.price : priceFor(bar, item)
  return { ...(state || {}), barIndex: idx, time: bar?.t ?? point?.time ?? null, price, placedAt: Date.now() }
}

function circleBetween(list, i0, i1, lo, hi, extra) {
  const a = list[Math.max(0, i0)]
  const b = list[Math.min(list.length - 1, i1)]
  if (!a || !b) return null
  return { type: 'circle', points: [{ time: a.t, price: lo }, { time: b.t, price: hi }], ...extra }
}

/** Drawings for the ONE chart: dot + halo at the anchor; a dashed ring on reveal. */
export function annotationsFor(state, item, reveal, bars) {
  const list = bars || barsOf(item)
  const out = []
  if (state?.barIndex != null && list.length) {
    const i = state.barIndex
    const p = state.price
    const dot = circleBetween(list, i - DOT_BARS, i + DOT_BARS, p * (1 - DOT_PCT), p * (1 + DOT_PCT),
      { id: 'study-tap-dot', color: GOLD, lineWidth: 3, lineStyle: 'solid' })
    const halo = circleBetween(list, i - HALO_BARS, i + HALO_BARS, p * (1 - HALO_PCT), p * (1 + HALO_PCT),
      { id: 'study-tap-halo', color: GOLD_SOFT, lineWidth: 1, lineStyle: 'solid' })
    if (dot) out.push(dot)
    if (halo) out.push(halo)
  }
  const key = reveal?.answer
  if (key && list.length) {
    let from, to, lo, hi
    if (key.bar_from != null || key.bar_to != null) {
      from = key.bar_from ?? 0
      to = key.bar_to ?? list.length - 1
    } else if (key.bar_index != null) {
      const tol = Number(key.bar_tol) || 0
      from = key.bar_index - tol
      to = key.bar_index + tol
    }
    if (key.price_lo != null || key.price_hi != null) {
      lo = key.price_lo ?? key.price_hi
      hi = key.price_hi ?? key.price_lo
    } else if (key.price != null) {
      const tolPct = (Number(key.price_tol_pct) || 1) / 100
      lo = key.price * (1 - tolPct)
      hi = key.price * (1 + tolPct)
    } else if (from != null) {
      const slice = list.slice(Math.max(0, from), Math.min(list.length, to + 1))
      lo = Math.min(...slice.map((b) => Number(b.l ?? b.c)))
      hi = Math.max(...slice.map((b) => Number(b.h ?? b.c)))
    }
    if (from != null && lo != null) {
      const ring = circleBetween(list, from - 1, to + 1, lo * (1 - DOT_PCT), hi * (1 + DOT_PCT),
        { id: 'study-tap-ring', color: GOLD, lineWidth: 2, lineStyle: 'dashed' })
      if (ring) out.push(ring)
    }
  }
  return out
}

function describeBar(bar, idx, total) {
  if (!bar) return 'No bar'
  return `Bar ${idx + 1} of ${total}, ${bar.t}: open ${bar.o}, high ${bar.h}, low ${bar.l}, close ${bar.c}`
}

/** The HUD chip and the keyboard bar cursor, rendered inside the chart box. */
export function ChartOverlay({ item, state, setState, locked, bars }) {
  const list = bars || barsOf(item)
  const [cursor, setCursor] = useState(() => (state?.barIndex ?? Math.max(0, list.length - 1)))
  const [announce, setAnnounce] = useState('')
  useEffect(() => { if (state?.barIndex != null) setCursor(state.barIndex) }, [state?.barIndex])

  const onKeyDown = useCallback((e) => {
    if (locked || !list.length) return
    let next = null
    if (e.key === 'ArrowRight') next = Math.min(list.length - 1, cursor + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, cursor - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      setState(onChartTap(state, { barIndex: cursor }, item, list))
      setAnnounce(`Placed on ${describeBar(list[cursor], cursor, list.length)}`)
      return
    }
    if (next == null) return
    e.preventDefault()
    e.stopPropagation()
    setCursor(next)
    setAnnounce(describeBar(list[next], next, list.length))
  }, [cursor, item, list, locked, setState, state])

  const text = locked ? 'Placed' : state?.barIndex == null ? `Tap ${targetOf(item)}` : 'Tap Check, or tap again to move'
  return (
    <>
      <div className={`${styles.hud} ${state?.barIndex != null ? styles.hudDone : ''}`} data-testid="tap-hud" aria-hidden="true">
        {text}
      </div>
      <button
        type="button"
        className={styles.srOnly}
        onKeyDown={onKeyDown}
        aria-label={`Keyboard: Left and Right move one bar, Enter places the marker on ${targetOf(item)}`}
        data-testid="tap-keyboard-cursor"
        disabled={locked}
      >
        {describeBar(list[cursor], cursor, list.length)}
      </button>
      <div className={styles.srOnly} aria-live="polite" data-testid="tap-live">{announce}</div>
    </>
  )
}

export function Body({ item, state }) {
  const list = barsOf(item)
  const bar = state?.barIndex != null ? list[state.barIndex] : null
  return (
    <p className={styles.hint} data-testid="tap-status">
      {bar ? `Marker on ${bar.t} at ${Number(state.price).toFixed(2)}.` : `Tap ${targetOf(item)} on the chart.`}
    </p>
  )
}

export function answerFromState(state) {
  return { bar_index: state?.barIndex ?? null, price: state?.price ?? null, time: state?.time ?? null }
}

export function isAnswerable(state) {
  return state?.barIndex != null
}

export default { Body, ChartOverlay, answerFromState, isAnswerable, framingOf, annotationsFor, onChartTap }
