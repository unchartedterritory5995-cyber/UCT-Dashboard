/**
 * THE BARS EVERY CALCULATION TIMEFRAME ON THIS CHART NEEDS — fetched once each.
 *
 * ⭐⭐ NOT A SECOND BARS SYSTEM. A calculation frame is a (symbol, timeframe)
 * window of canonical `/api/bars` data, which is exactly what `secondaryBars`
 * already fetches, caches, dedupes in flight and retries — for `sym:QQQ` sources.
 * This hook asks that same cache, keyed by the same URL. So four indicators on a
 * 5m QQQ chart that all calculate on `1D` share ONE daily request: the window's
 * depth is chosen per (symbol, frame) for the whole chart, never per indicator,
 * which is what makes their URLs identical.
 *
 * ⛔ FIRST PAINT IS NOT BLOCKED. Nothing here gates the chart's own bars; an
 * indicator whose frame has not landed is simply not computable yet (the binder
 * skips it — no series, no stale value), and it draws when the frame arrives.
 *
 * ⛔ A FRAME IS REFRESHED ONLY WHEN IT IS PROVEN BEHIND. `mtfProjection` reports
 * `stale` when the chart shows a period the snapshot does not know has closed;
 * `refreshFrame` below is the one answer, throttled per window by `secondaryBars`.
 */

import { useCallback, useEffect, useState } from 'react'
import { ensureSecondaryBars, refreshSecondaryBars, subscribe } from './secondaryBars'
import { orderByDependency, sourceInputsOf, parseSource } from './sourceRef'
import { resolveInstanceFrames } from './calcTimeframeCapability'
import { etDateOf, frameKey } from './mtfProjection'

export { frameKey }

/** The depths a frame window may have. A LADDER, not a computed number, so a chart
 *  whose history grows by a few bars keeps asking for the same URL. */
export const FRAME_DEPTHS = Object.freeze([300, 600, 1200, 2500, 5000, 10000])
/** Bars of warm-up allowed for above the span the chart shows (SMA 200 on 1D, a
 *  26/12/9 MACD, a 14 RSI's smoothing — 400 covers every shipped default). */
export const FRAME_WARMUP = 400

const DAY = 86400

function epochOf(t) {
  if (typeof t === 'number' && Number.isFinite(t)) {
    if (t >= 19000101 && t <= 21001231) return epochOf(etDateOf(t))
    return t > 1e11 ? t / 1000 : t
  }
  const iso = etDateOf(t)
  if (!iso) return NaN
  const ms = Date.parse(`${iso}T12:00:00Z`)
  return Number.isFinite(ms) ? ms / 1000 : NaN
}

/** How many `frame` bars cover the span `chartBars` shows, plus warm-up, rounded UP
 *  to the ladder. */
export function frameDepthFor(frame, chartBars) {
  const bars = Array.isArray(chartBars) ? chartBars : []
  let span = 0
  if (bars.length > 1) {
    const a = epochOf(bars[0] && bars[0].t)
    const b = epochOf(bars[bars.length - 1] && bars[bars.length - 1].t)
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) span = b - a
  }
  const days = span / DAY
  let periods
  if (frame === 'D') periods = days * (5 / 7)
  else if (frame === 'W') periods = days / 7
  else if (frame === 'M') periods = days / 30.4
  else {
    const minutes = Number(frame) || 60
    // Extended hours included (04:00–20:00), so the window is never short.
    periods = days * (5 / 7) * (960 / minutes)
  }
  const need = Math.ceil(periods) + FRAME_WARMUP
  return FRAME_DEPTHS.find((d) => d >= need) || FRAME_DEPTHS[FRAME_DEPTHS.length - 1]
}

/**
 * Every (frame, symbol) this chart's instances need: the chart's own symbol at each
 * higher calculation frame, plus any `sym:` source an instance at that frame reads.
 */
export function framesNeeded(instances, defOf, sym, chartTf) {
  const list = Array.isArray(instances) ? instances.filter((i) => i && typeof i === 'object' && i.deleted !== true) : []
  if (!list.length || !sym) return []
  const { ordered } = orderByDependency(list, defOf)
  const frames = resolveInstanceFrames(ordered, defOf, String(chartTf))
  const out = new Map()
  for (const inst of ordered) {
    const f = frames.get(inst.instanceId)
    if (!f || !f.frame) continue
    out.set(frameKey(f.frame, sym), { frame: f.frame, symbol: String(sym).toUpperCase() })
    const def = defOf(inst.defId)
    for (const [, value] of (def ? sourceInputsOf(def, inst) : [])) {
      const p = parseSource(value)
      if (p && p.kind === 'symbol') out.set(frameKey(f.frame, p.symbol), { frame: f.frame, symbol: p.symbol })
    }
  }
  return [...out.values()]
}

function sameEntries(a, b) {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

const EMPTY = Object.freeze({ key: '', map: null })

/**
 * @returns {{frames: Map<string, {bars, status, newestBarIsForming?, depth}>|null,
 *            refreshFrame: (frame: string, symbol: string) => void}}
 */
export function useCalcFrames(instances, defOf, sym, chartTf, chartBars, fetcher, revalidate) {
  const [state, setState] = useState(EMPTY)
  const needed = framesNeeded(instances ? instances() : null, defOf, sym, chartTf)
  const plan = needed.map((n) => ({ ...n, depth: frameDepthFor(n.frame, chartBars) }))
  const planKey = plan.map((p) => `${p.frame}|${p.symbol}|${p.depth}`).join(',')

  useEffect(() => {
    let alive = true
    const apply = () => {
      if (!alive) return
      if (!plan.length) {
        setState((prev) => (prev.map === null ? prev : EMPTY))
        return
      }
      const map = new Map()
      for (const p of plan) {
        const entry = ensureSecondaryBars(p.symbol, p.frame, p.depth, fetcher)
        if (entry) map.set(frameKey(p.frame, p.symbol), entry)
      }
      setState((prev) => (prev.key === planKey && sameEntries(prev.map, map) ? prev : { key: planKey, map }))
    }
    apply()
    if (!plan.length) return () => { alive = false }
    const unsub = subscribe(apply)
    return () => { alive = false; unsub() }
    // ⛔ `planKey` IS the plan's identity; `plan` itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, fetcher, revalidate])

  const refreshFrame = useCallback((frame, symbol) => {
    const p = plan.find((x) => x.frame === frame && x.symbol === String(symbol || '').toUpperCase())
    if (p) refreshSecondaryBars(p.symbol, p.frame, p.depth, fetcher)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, fetcher])

  return { frames: state.map, refreshFrame }
}

export default useCalcFrames
