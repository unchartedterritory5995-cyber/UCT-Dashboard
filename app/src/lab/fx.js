// Small motion helpers the challenge modes share (round 10).
import { useEffect, useMemo, useState } from 'react'

/** The chart RUNS ON after Check: the forward bars are appended one at a time, so the follow-through is watched
 *  rather than dumped. Returns the bars to show. Resets when `on` goes false. */
export function useRunOn(base, forward, on, stepMs = 70) {
  const [k, setK] = useState(0)
  const [was, setWas] = useState(on)
  if (on !== was) { setWas(on); setK(0) }
  useEffect(() => {
    if (!on || !forward?.length) return undefined
    let i = 0
    const t = setInterval(() => { i += 1; setK(i); if (i >= forward.length) clearInterval(t) }, stepMs)
    return () => clearInterval(t)
  }, [on, forward, stepMs])
  return useMemo(() => (on && base ? [...base, ...(forward || []).slice(0, k)] : base), [base, forward, on, k])
}

/** A slow breath for things the drawings layer cannot animate on its own: cycles 0..frames-1 every `ms`. The
 *  annotations are rebuilt per phase, so a halo swells and settles ("candles slightly animated to show which
 *  selections are choosable"). */
export function useBreath(frames = 4, ms = 320, on = true) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!on) return undefined
    const t = setInterval(() => setP((v) => (v + 1) % frames), ms)
    return () => clearInterval(t)
  }, [frames, ms, on])
  return on ? p : 0
}

/** A counter that climbs to `target` while `on`. */
export function useCountUp(target, on, ms = 30) {
  const [v, setV] = useState(0)
  const [was, setWas] = useState(on)
  if (on !== was) { setWas(on); setV(0) }
  useEffect(() => {
    if (!on) return undefined
    let i = 0
    const step = Math.max(1, Math.ceil(target / 40))
    const t = setInterval(() => { i = Math.min(target, i + step); setV(i); if (i >= target) clearInterval(t) }, ms)
    return () => clearInterval(t)
  }, [target, on, ms])
  return on ? v : 0
}

/** The run-on TO A POINT (round 21; the owner, batch 21: "why only do like 5-10 days continuation, we should do to the
 *  full culmination or maximization of the trade"). Appends `forward` one bar at a time until `count` bars have arrived:
 *  the first `slowN` at `slowMs` (batch 10: "show the next candles a bit slower"), the rest at `fastMs`, so a 40-bar
 *  run still lands in seconds. `count` may grow while it runs (more forward bars arrive after the reveal). Under
 *  prefers-reduced-motion every bar arrives at once. Returns { bars, k } where k is how many have arrived. */
export function useRunOnTo(base, forward, count, on, { slowMs = 330, fastMs = 140, slowN = 5 } = {}) {
  const [k, setK] = useState(0)
  const [was, setWas] = useState(on)
  if (on !== was) { setWas(on); setK(0) }
  const target = Math.max(0, Math.min(count || 0, forward?.length || 0))
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  useEffect(() => {
    if (!on || still || k >= target) return undefined
    const t = setTimeout(() => setK((v) => v + 1), k < slowN ? slowMs : fastMs)
    return () => clearTimeout(t)
  }, [on, k, target, still, slowMs, fastMs, slowN])
  const shown = still ? target : Math.min(k, target)
  const bars = useMemo(() => (on && base ? [...base, ...(forward || []).slice(0, shown)] : base), [base, forward, on, shown])
  return { bars, k: on ? shown : 0 }
}

/** THE RUN-ON, TICK BY TICK (2026-11-08; the owner: "tick by tick so each day has multiuple ticks like using each 30 min
 *  or hourly close to show how everyday moved essentially" · "in between the main lesson days can be a bit faster of a
 *  speed through on the tick by tick"). Like useRunOnTo, but a forward day that has its intraday bars (`ticks[k]`, from
 *  challenges/replayTicks.alignTicks) GROWS through them: the day's candle is drawn after each 30-minute (or hourly)
 *  close (`develop(day, ticks, j)`) until it is the daily candle. The key sessions (`keys`, 1 = the first day after the
 *  signal) play slowly through every close; the days between run quickly through at most `fastTicks` of them; a day
 *  without bars lands whole, as before. Under
 *  prefers-reduced-motion everything arrives at once. Returns { bars, k, clock }: k = whole days arrived, clock =
 *  { session, t, next } while a day is growing (t = the unix second of the bar just shown, next = the day's next bar), else
 *  null. */
export function useRunOnTicks(base, forward, count, on, {
  ticks = null, keys = null, develop = null, slowMs = 330, fastMs = 140, slowN = 5, tickSlowMs = 150, tickFastMs = 40, fastTicks = 4,
  holdAt = null,  // the replay stops and asks (ui/ReplayPause): a Set of whole-day counts it waits at, until the caller drops them
} = {}) {
  const [pos, setPos] = useState({ k: 0, j: 0 })
  const [was, setWas] = useState(on)
  if (on !== was) { setWas(on); setPos({ k: 0, j: 0 }) }
  const target = Math.max(0, Math.min(count || 0, forward?.length || 0))
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  const { k, j } = pos
  useEffect(() => {
    if (!on || still || k >= target || (j === 0 && holdAt?.has(k))) return undefined
    const day = ticks?.[k]
    const m = develop && Array.isArray(day) && day.length > 1 ? day.length : 0
    const key = keys ? keys.has(k + 1) : k < slowN
    const ms = m ? (key ? tickSlowMs : tickFastMs) : (key ? slowMs : fastMs)
    // a key day draws every close; a day between draws at most `fastTicks` of them (still several a day, half the redraws)
    const stride = m && !key ? Math.max(1, Math.ceil(m / fastTicks)) : 1
    const t = setTimeout(() => setPos((p) => {
      if (m && p.j < m) return { k: p.k, j: Math.min(m, p.j + stride) }
      return { k: p.k + 1, j: 0 }
    }), ms)
    return () => clearTimeout(t)
  }, [on, k, j, target, still, holdAt, ticks, keys, develop, slowMs, fastMs, slowN, tickSlowMs, tickFastMs, fastTicks])
  const shown = still ? target : Math.min(k, target)
  const day = !still && k < target ? ticks?.[k] : null
  const growing = !!(develop && Array.isArray(day) && day.length > 1 && j > 0)
  const bars = useMemo(() => {
    if (!on || !base) return base
    const out = [...base, ...(forward || []).slice(0, shown)]
    if (growing) out.push(develop(forward[shown], day, j - 1))
    return out
  }, [base, forward, on, shown, growing, develop, day, j])
  const clock = on && growing ? { session: shown + 1, t: day[j - 1].t, next: day[j]?.t ?? null } : null
  return { bars, k: on ? shown : 0, clock }
}
