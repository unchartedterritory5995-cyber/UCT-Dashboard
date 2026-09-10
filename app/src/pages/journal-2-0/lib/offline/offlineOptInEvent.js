/**
 * Wave Q1 — HOW MANY BROWSERS ACTUALLY TURNED THE OFFLINE LAYER ON.
 *
 * ⛔⛔ WHY THIS EXISTS. The flag-flip gate's condition is "zero
 * `notebook_blocked_no_baseline` events across the instrument clock". With
 * `OFFLINE_DEFAULT_ON` false, that event can only fire from a browser that has
 * opted in — so a week of zeros over ZERO opted-in browsers is not evidence of
 * anything at all. It is the same shape as a green browser matrix over a mount
 * path nobody covered, which is exactly how this wave got its incident. The
 * count below is the denominator that makes the numerator mean something.
 *
 * ⛔ THERE IS NO OPT-IN UI TO INSTRUMENT. The flag is a `localStorage` key a
 * person sets by hand (that is deliberate — certification has to run against the
 * real production build in a real browser). So the transition is DETECTED, not
 * intercepted: this remembers the last state it reported and fires when the key
 * has become `'1'` and the last reported state was not `'1'`.
 *
 *   unset → '1'   fires        (the opt-in)
 *   '0'   → '1'   fires        (a genuine re-opt-in, and worth counting)
 *   '1'   → '1'   silent       (a reload, or any later mount)
 *   '1'   → '0'   silent       (records the opt-out, so a later '1' counts)
 *   unset → unset silent       (production's state: it can never fire here)
 *
 * ⛔ NO MEMBER CONTENT. A per-session id, the flag state, a timestamp. The
 * session id is a random per-tab value from `useDurableNote`, not member data.
 */
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { flagState, postJ2Telemetry } from './telemetry'
import { SESSION_ID } from './useDurableNote'

/** ⛔ Must also be present in `_J2_TELEMETRY_EVENTS` (api/routers/journal_two.py). */
export const OPT_IN_EVENT = 'notebook_offline_opt_in'

/** Where the last REPORTED state is remembered. Separate from the flag itself:
 *  writing the flag is the member's act, and an instrument must never edit the
 *  thing it observes. */
export const OPT_IN_REPORTED_KEY = 'uct.j2.offline.optInReported'

const read = (storage, key) => {
  try { return storage?.getItem(key) ?? null } catch { return null }
}

/**
 * ⛔ PURE. The decision is separable from the transport so a rail can drive
 * every transition without a network, and so the wire has exactly one condition
 * rather than one here and another at the call site.
 */
export function shouldReportOptIn(storage = globalThis.localStorage) {
  const key = read(storage, OFFLINE_FLAG_KEY)
  const lastReported = read(storage, OPT_IN_REPORTED_KEY)
  return key === '1' && lastReported !== '1'
}

export function optInProps({ sessionId = SESSION_ID, now = () => new Date().toISOString(), storage } = {}) {
  return { sessionId, flag: flagState(storage), at: now() }
}

/**
 * Observe the current flag state, report a transition into `'1'` at most once,
 * and remember what was observed either way.
 *
 * ⛔ The marker is written even when nothing is sent. Without that, an opt-out
 * would leave `lastReported === '1'` forever and a genuine later opt-in would
 * be invisible — the count would silently under-report exactly the population
 * it exists to size.
 *
 * @returns the props if it reported, else null
 */
export async function reportOptIn({ storage, post = postJ2Telemetry, sessionId, now, fetchImpl } = {}) {
  const store = storage || globalThis.localStorage
  const fire = shouldReportOptIn(store)
  const key = read(store, OFFLINE_FLAG_KEY)
  let props = null
  if (fire) {
    props = optInProps({ sessionId, now, storage: store })
    await post(OPT_IN_EVENT, props, { fetchImpl })
  }
  try {
    // `null` cannot be stored, and it must not read back as the string "null" —
    // remove the marker instead, so unset stays unset.
    if (key === null) store?.removeItem(OPT_IN_REPORTED_KEY)
    else store?.setItem(OPT_IN_REPORTED_KEY, key)
  } catch { /* private mode: the next mount simply re-decides */ }
  return props
}
