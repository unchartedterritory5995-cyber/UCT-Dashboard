/**
 * Wave Q1 — the ONE way this wave talks to `POST /api/j2/telemetry`.
 *
 * Two events now ride this channel (`notebook_blocked_no_baseline`,
 * `notebook_offline_opt_in`) and a third would have been a third copy of the
 * same fetch, the same swallow, and the same "which fields are safe" judgement.
 * They live here once.
 *
 * ⛔ EVERY EVENT NAME MUST ALSO BE IN `_J2_TELEMETRY_EVENTS`
 * (`api/routers/journal_two.py`) or the POST is a 400 and the measurement is
 * silently nothing. Railed on the server side, and the rail reads the names out
 * of the client source rather than retyping them.
 *
 * ⛔ NEVER NOTE CONTENT. Not a title, not a body, not a patch. Callers pass ids,
 * counters and enumerated descriptions; the rails pin each event's key set as a
 * SET, because "there is no body key" is satisfied by a payload that ships the
 * title instead.
 */
import { OFFLINE_DEFAULT_ON, OFFLINE_FLAG_KEY, offlineEnabled } from './offlineFlag'

/**
 * What the flag was at the moment of the report — the state, AND how it got
 * there, because "off by default" and "explicitly off" are different facts
 * (`project_feature_flag_ledger`: OFF-and-unset is indistinguishable from
 * off-on-purpose unless something records which it was).
 */
export function flagState(storage = globalThis.localStorage) {
  let key = null
  try { key = storage?.getItem(OFFLINE_FLAG_KEY) ?? null } catch { key = null }
  return { key, enabled: offlineEnabled(storage), byDefault: key === null, def: OFFLINE_DEFAULT_ON }
}

/**
 * Best-effort, never throws into a caller. An instrument that can break the
 * thing it measures is worse than no instrument.
 *
 * @returns the props it tried to send, so a rail can read them
 */
export async function postJ2Telemetry(event, props, { fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch
  try {
    await f('/api/j2/telemetry', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, props }),
    })
  } catch { /* the thing being measured already happened */ }
  return props
}
