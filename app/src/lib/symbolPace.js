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
// symbol when it lands. So a reader behind the gate (`useRestGate(key)` for its `isPaused`,
// or `useRestedSWR` in place of `useSWR`) follows the cadence of its own key:
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
// ⛔ THIS MODULE STAYS OUT OF THE APP'S FIRST BYTES. The generic hooks (name and sector, the
// listing date, delisted, the leveraged family, the snapshot) are read on pages that load no
// chart; they take an optional `isPaused` and import nothing from here. The chart supplies
// it at its own call sites (components/chart/restedReaders.js). Importing this file from a
// hook put 1.5 KB into every page's first open and broke the Notebook's byte budget by 89 B.
//
// Per-browser switch: localStorage['uct.restgate.off'] = '1' (read once per page load).
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR, { unstable_serialize, useSWRConfig } from 'swr'

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
/** After a raced key has been stayed on, its ask waits this long: every reader of the key has stopped being paused by then. */
export const ASK_AFTER_MS = 32
const _asked = new Map()   // key id -> when a rested reader asked for it

// The cache and `mutate` of the SWR scope this reader is in. A host that has replaced `swr` with
// a default-only stand-in (several chart suites do) has no such export: the gate then pauses
// and asks for nothing itself, and the stand-in's own reads are whatever the suite made them.
const NO_SWR = Object.freeze({ cache: null, mutate: null })
function useScopedSWR() {
  try { return useSWRConfig() || NO_SWR } catch { return NO_SWR }
}

/**
 * The gate for one reader: SWR's `isPaused` for its key, and the ask once a raced key has
 * been stayed on (if nothing is held for it by then).
 *
 * ⛔ THE ASK IS A REVALIDATION OF THE KEY, AND SWR HANDS THAT TO THE FIRST READER MOUNTED ON
 * IT. Two readers of one key each keep their own cadence, and their holds can end a few
 * milliseconds apart; a revalidation sent while the first-mounted one was still paused would
 * be dropped by it. So the ask waits `ASK_AFTER_MS`, by which time both have stopped.
 *
 * @param {*} key the reader's SWR key (a string, SWR's array form, or null for none)
 * @returns {() => boolean} for the reader's `isPaused` option
 */
export function useRestGate(key) {
  const rest = useKeyRest(key)
  const { cache, mutate } = useScopedSWR()
  const latest = useRef(null)
  latest.current = { key, cache, mutate }
  useEffect(() => {
    if (!rest.tick) return undefined
    const t = setTimeout(() => {
      const cur = latest.current
      const id = _idOf(cur.key)
      if (!id || !cur.cache || !cur.mutate) return
      const held = cur.cache.get(id)
      if (held && held.data !== undefined) return          // a pre-loaded row, or an answer that landed meanwhile
      const now = Date.now()
      if (now - (_asked.get(id) || -Infinity) < ASK_ONCE_MS) return
      if (_asked.size > 256) _asked.clear()
      _asked.set(id, now)
      try { cur.mutate(cur.key) } catch { /* the reader asks again on its next visit */ }
    }, ASK_AFTER_MS)
    return () => clearTimeout(t)
  }, [rest.tick])
  return rest.isPaused
}

/**
 * `useSWR`, for a read keyed by the symbol on screen: same arguments, same return.
 * The request waits while the key is racing; the cache answers at once throughout.
 *
 * ⛔ NOT FOR A READ THAT POLLS: the polling rail (hooks/pollingSites.rail.test.js) counts
 * `useSWR` call sites. Such a reader keeps its own `useSWR` and takes `isPaused` from
 * `useRestGate` (as the chart's readers do, components/chart/restedReaders.js).
 */
export function useRestedSWR(key, fetcher, options) {
  const isPaused = useRestGate(key)
  return useSWR(key, fetcher, { ...options, isPaused })
}

/** Test seam: a new page load (the switch is read again, no remembered asks). */
export function __resetRestGate() {
  _off = null
  _asked.clear()
}
