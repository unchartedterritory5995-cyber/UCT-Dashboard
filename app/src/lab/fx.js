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
