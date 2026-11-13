// app/src/lib/symbolPace.js
//
// ─── A SYMBOL THE MEMBER IS RACING PAST ASKS THE SERVER FOR NOTHING ──────────
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-13 (bench member, the arrow key held through 40
// charts of a list, then released). The browser sent 246 requests in 11.5 s; 121 were
// in flight at once and 117 were still open when the key was released. Six small reads
// per chart passed (delisted, split basis, snapshot, listing date, leveraged family,
// name and sector), each started the moment the chart showed a symbol the member left
// a quarter of a second later. The pod took 4 to 6 s to answer any of them, and the
// chart the member stopped on drew its RS lines 5.4 to 6.0 s after its candles, even
// when the server had them cached (a 1 ms answer took 5.5 s to come back).
//
// A read keyed by the symbol is worth starting only if the member will still be on the
// symbol when it lands. So a reader that goes through `useRestedSWR` (in place of
// `useSWR`, same arguments) follows the cadence of its own key:
//
//   - a key the member arrives on and stays on is asked for at once, as before;
//   - while keys change faster than `RACE_MS` apart, nothing new is asked for;
//   - the key the member stops on is asked for once it has stayed 1.3 x the step.
//
// ⭐ WHAT THE BROWSER ALREADY HOLDS IS SHOWN AT ONCE, RACING OR NOT. The key is never
// withheld: SWR's cache (a pre-loaded row, an earlier visit) answers on the first
// render. Only the REQUEST waits (SWR's own `isPaused`).
//
// ⛔ ONLY FOR A READ THAT IS KEYED BY THE SYMBOL ON SCREEN. A reader whose key never
// changes is never racing and behaves exactly as `useSWR`.
//
// Per-browser switch: localStorage['uct.restgate.off'] = '1' (read once per page load).
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR, { unstable_serialize } from 'swr'

/** Steps closer together than this are a member racing through symbols, not reading them. */
export const RACE_MS = 400
/** "Stopped" is this many times the step with no further step ... */
export const REST_FACTOR = 1.3
/** ... never under this ... */
export const REST_MIN_MS = 40
/** ... and never over this. */
export const REST_MAX_MS = 500
/** Calls this close together are one step (two announcements of the same move). */
export const SAME_STEP_MS = 16
export const REST_GATE_OFF_KEY = 'uct.restgate.off'

let _off = null
export function restGateDisabled() {
  if (_off === null) {
    try { _off = localStorage.getItem(REST_GATE_OFF_KEY) === '1' } catch { _off = false }
  }
  return _off
}

/**
 * The cadence of ONE stream of steps (a pane's symbol changes; a list's announcements).
 * The pace is the faster of the last two steps: one slow step in a run of fast ones is
 * still a run. `rested()` ends the run: the next step is judged from nothing.
 */
export function createPace() {
  let at = null
  let gap = Infinity
  let prev = Infinity
  const racing = () => Math.min(gap, prev) < RACE_MS
  return {
    /** A step at `now` (ms). @returns {boolean} whether the stream is racing */
    step(now) {
      if (at !== null && now - at < SAME_STEP_MS) return racing()
      prev = gap
      gap = at === null ? Infinity : now - at
      at = now
      return racing()
    },
    racing,
    /** How long with no further step means the member has stopped (0 when not racing). */
    restMs() {
      const fast = [gap, prev].filter((g) => g < RACE_MS)
      if (!fast.length) return 0
      return Math.min(REST_MAX_MS, Math.max(REST_MIN_MS, Math.round(REST_FACTOR * Math.max(...fast))))
    },
    /** The member stopped: the next step starts a new run. */
    rested() { gap = Infinity; prev = Infinity },
    /** As if no step had ever been taken (a new page load). */
    forget() { at = null; gap = Infinity; prev = Infinity },
  }
}

const _idOf = (key) => {
  if (key == null || key === false) return ''
  if (typeof key === 'string') return key
  try { return unstable_serialize(key) || '' } catch { return '' }
}

/**
 * The cadence of this reader's own key.
 *
 * @returns {{ isPaused: () => boolean, tick: number }} `isPaused` for SWR's option of
 *   that name; `tick` counts the times a raced key was then stayed on.
 */
export function useKeyRest(key) {
  const id = _idOf(key)
  const ref = useRef(null)
  if (ref.current === null) ref.current = { pace: createPace(), id: '', racing: false, hold: 0 }
  const st = ref.current
  const [tick, setTick] = useState(0)
  if (id && st.id !== id) {
    // The step is noted in the render that shows the key: SWR reads `isPaused` in that
    // same render and in the effect after it, and both must see this key's answer.
    st.id = id
    st.racing = !restGateDisabled() && st.pace.step(Date.now())
    st.hold = st.racing ? st.pace.restMs() : 0
  }
  useEffect(() => {
    if (!id || !st.racing) return undefined
    const t = setTimeout(() => {
      st.racing = false
      st.pace.rested()
      setTick((n) => n + 1)
    }, st.hold)
    return () => clearTimeout(t)
  }, [id, st])
  const isPaused = useCallback(() => st.racing, [st])
  return { isPaused, tick }
}

// Two readers of one key stop in the same moment (the name and sector are read by the
// pane and by the chart): the second finds the first's ask and sends none.
const ASK_ONCE_MS = 2000
const _asked = new Map()   // key id -> when a rested reader asked for it

/**
 * Once a raced key has been stayed on, ask for it if nothing is held for it.
 *
 * @param {{tick: number}} rest from `useKeyRest`
 * @param {*} key the reader's SWR key
 * @param {*} data the reader's current data (`undefined` = nothing held)
 * @param {() => any} mutate the reader's bound `mutate` (revalidates the key)
 */
export function useAskWhenRested(rest, key, data, mutate) {
  const latest = useRef({ key, data, mutate })
  latest.current = { key, data, mutate }
  useEffect(() => {
    if (!rest.tick) return
    const cur = latest.current
    const id = _idOf(cur.key)
    if (!id || cur.data !== undefined) return
    const now = Date.now()
    if (now - (_asked.get(id) || -Infinity) < ASK_ONCE_MS) return
    if (_asked.size > 256) _asked.clear()
    _asked.set(id, now)
    try { cur.mutate() } catch { /* the reader asks again on its next visit */ }
  }, [rest.tick])
}

/**
 * `useSWR`, for a read keyed by the symbol on screen: same arguments, same return.
 * The request waits while the key is racing; the cache answers at once throughout.
 */
export function useRestedSWR(key, fetcher, options) {
  const rest = useKeyRest(key)
  const swr = useSWR(key, fetcher, { ...options, isPaused: rest.isPaused })
  useAskWhenRested(rest, key, swr.data, swr.mutate)
  return swr
}

/** Test seam: a new page load (the switch is read again, no remembered asks). */
export function __resetRestGate() {
  _off = null
  _asked.clear()
}
