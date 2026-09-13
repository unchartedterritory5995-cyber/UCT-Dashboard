/**
 * Wave K — did this browser actually RECEIVE the capability flags?
 *
 * ⛔⛔ WHY THIS EXISTS, AND WHY THE RIG CANNOT ANSWER IT. K-1 flips
 * `OFFLINE_DEFAULT_ON` to `false` so an unreachable auth payload fails to OFF
 * instead of ON. Its precondition is a **config-served rate of 100% over the K
 * window, measured by identity, rig and owner-browser excluded** — and the rig
 * can only ever report on the rig. Nothing in the product recorded whether a
 * MEMBER's browser got the keys, so the rate had no numerator and no
 * denominator; "measure it" was not a thing anyone could do.
 *
 * ⭐ ONE EVENT CARRIES BOTH. `served: true` is the numerator and every report is
 * the denominator, so a rate is a division over one population rather than a
 * join across two. That matters because the failure it guards against is
 * precisely a browser that never reported at all.
 *
 * ⛔ ABSENT IS NOT OFF, and this is the whole point of the measurement. A pod
 * that predates K returns no `notebook_*` keys, the client falls back to the
 * compile-time constant — which is ON — and the kill switch reaches that member
 * not at all. `served: false` is exactly that state, and it is the one K-1 must
 * never be flipped in front of.
 *
 * ⛔ PER TAB, NOT PER BROWSER — deliberately different from
 * `offlineOptInEvent.js`, which remembers in `localStorage` that it has
 * reported. A persistent memory is right for "this member opted in", which is a
 * fact about a person and is true once forever. It is WRONG for a rate over a
 * WINDOW: a browser that reported last week would fall silent during the window
 * and the rate would be computed over whoever happened not to have visited
 * before it started. Module state resets with the tab, so every session in the
 * window contributes, and the sampler divides by identity.
 *
 * ⛔ NEVER NOTE CONTENT. Two enumerated fields, and `telemetry.js`'s rails pin
 * the key set as a SET — "there is no body key" is satisfied by a payload that
 * ships the title instead.
 */
import { postJ2Telemetry } from './telemetry'

/** ⛔ Must also be present in `_J2_TELEMETRY_EVENTS` (api/routers/journal_two.py). */
export const CONFIG_SERVED_EVENT = 'notebook_config_served'

/** Latency is reported in buckets, not milliseconds. A precise wait time is a
 *  fingerprint and buys nothing: the only question is whether the answer came
 *  in promptly, late, or never. */
export const WAIT_BUCKET_MS = 250

let reportedThisTab = false

/** ⭐ Test seam. The tab-scoped memory is module state, and a rail that cannot
 *  reset it can only ever drive the first case. */
export function __resetConfigServedReport() {
  reportedThisTab = false
}

/**
 * ⛔ PURE. The decision is separable from the transport so a rail can drive it
 * without a network, which is the shape every event in this directory uses.
 *
 * @returns the props to send, or `null` when this tab has already reported.
 */
export function configServedReport({ served, waitedMs }) {
  if (reportedThisTab) return null
  const ms = Number.isFinite(waitedMs) && waitedMs >= 0 ? waitedMs : 0
  return {
    served: !!served,
    waited_bucket_ms: Math.min(4, Math.floor(ms / WAIT_BUCKET_MS)) * WAIT_BUCKET_MS,
  }
}

/**
 * Best-effort, never throws into a caller, at most once per tab.
 *
 * @returns the props actually sent, or `null` if this tab had already reported.
 */
export async function reportConfigServed({ served, waitedMs }, { post } = {}) {
  const props = configServedReport({ served, waitedMs })
  if (!props) return null
  // ⛔ Latched BEFORE the await, not after. Two components resolving in the same
  // tick would both see `false` and both report, which is the duplicate this
  // flag exists to prevent — and a duplicate inflates a rate's denominator
  // exactly where it is least visible.
  reportedThisTab = true
  await (post || postJ2Telemetry)(CONFIG_SERVED_EVENT, props)
  return props
}
