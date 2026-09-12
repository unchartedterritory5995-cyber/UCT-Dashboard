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
 * ⛔⛔ REWRITTEN AT THE FLIP (2026-09-12). It used to fire on the KEY becoming
 * `'1'`. After the flip the key is UNSET for every member and the layer is ON,
 * so that condition would have been false for the entire population — a
 * denominator of zero over a numerator of everyone, which is worse than no
 * denominator because it reads as a healthy zero. It now fires on the LAYER
 * BEING ACTIVE, which is the thing the count is a count OF.
 *
 *   active, not yet counted   fires        (unset-and-default-on, or an explicit '1')
 *   active, already counted   silent       (a reload, or any later mount)
 *   '0'                       silent       (records the opt-out, so a later on counts)
 *   '0' → active              fires        (a genuine re-opt-in, and worth counting)
 *
 * ⛔ THE MARKER RECORDS THE RESOLVED STATE, NOT THE KEY. It used to mirror the
 * key and REMOVE itself when the key was unset — which, once unset means ON,
 * would clear the dedupe on every load and fire once per page view instead of
 * once per browser. The payload still carries `key` and `byDefault`, so
 * "on by default" and "explicitly on" remain distinguishable
 * (`project_feature_flag_ledger`).
 *
 * ⛔ NO MEMBER CONTENT. A per-session id, the flag state, a timestamp. The
 * session id is a random per-tab value from `useDurableNote`, not member data.
 */
import { offlineEnabled } from './offlineFlag'
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
  // ⛔ ACTIVE, not `key === '1'`. `offlineEnabled()` is the same reader the
  // editor and the drain gate on, so the denominator counts exactly the
  // browsers that ran the layer — never a different population from the one
  // the numerator is drawn from.
  return offlineEnabled(storage) && read(storage, OPT_IN_REPORTED_KEY) !== '1'
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
  const active = offlineEnabled(store)
  let props = null
  if (fire) {
    props = optInProps({ sessionId, now, storage: store })
    await post(OPT_IN_EVENT, props, { fetchImpl })
  }
  try {
    // ⛔ THE RESOLVED STATE, ALWAYS WRITTEN. Mirroring the key meant REMOVING
    // this marker whenever the key was unset — harmless while unset meant OFF,
    // and a once-per-page-view event the moment unset meant ON.
    store?.setItem(OPT_IN_REPORTED_KEY, active ? '1' : '0')
  } catch { /* private mode: the next mount simply re-decides */ }
  return props
}
