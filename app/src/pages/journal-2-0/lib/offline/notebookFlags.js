/**
 * Wave K — the Notebook's capability flags, LATCHED for the life of the tab.
 *
 * ⛔⛔ FRESH ON THE SERVER, FROZEN PER TAB, AND THE TWO ARE NOT IN TENSION.
 *
 * The SERVER re-reads every Railway variable on every request, so a flip needs
 * no redeploy — that is the whole reason the flags ride `_access_payload`
 * (`api/routers/auth.py`) instead of a boot-read endpoint.
 *
 * The CLIENT must not let the answer move underneath a running tab. Wave Q1's
 * `SESSION_ID`, its sync Web Lock and its in-flight marker all belong to a tab
 * that has ALREADY DECIDED it may write. If the flag flipped mid-session:
 *
 *   · a drain could be holding the sync lock for a wave that is now off;
 *   · an in-flight marker could be raised with nothing left that will lower it;
 *   · `offlineEnabled()` could answer "no" between a PUT going out and its ack
 *     coming back — which is "am I allowed to write" changing DURING a write.
 *
 * ⛔ §21 is the rule this protects: switching the wave off STOPS PROCESSING and
 * has never been permission to alter what a member already wrote. A mid-session
 * flip is not a gentler version of that — it is the one shape where the layer is
 * half-on, and half-on is the state nothing was designed for.
 *
 * ⭐ SO: the FIRST payload that carries these keys wins, for this tab, for ever.
 * A later poll that disagrees is recorded and ignored. The flip still reaches a
 * new tab, a reload, and every other member immediately.
 *
 * ⛔ THE LATCH IS NOT A CACHE. A cache would refresh; this deliberately does not,
 * and `latchedAt` exists so an operator can see WHEN the answer was fixed rather
 * than assume it is current.
 */

/** The compile-time fallbacks — the value used until a payload arrives, and for
 *  ever if one never does. ⛔ Polarity per capability: the Q1 wave is a KILL
 *  switch over a shipped feature (absent ⇒ ON), the Q2 keys are enablement gates
 *  over dark ones (absent ⇒ OFF). */
export const FLAG_FALLBACKS = Object.freeze({
  notebook_offline_default_on: null,   // ⇒ defer to OFFLINE_DEFAULT_ON, §6
  notebook_offline_read_on: false,
  notebook_conflict_ux_on: false,
  notebook_attachments_on: false,
  notebook_ask_insert_on: false,       // G-064 enablement gate — absent ⇒ OFF
  notebook_writing_help_enabled: false, // wave 7 H2 enablement gate — absent ⇒ OFF
  notebook_door_guard: 'full',         // ⛔ a MODE, not a boolean — see below
})

/**
 * ⛔⛔ THE DOOR GUARD'S MODE. Q1 fix 6 makes the append route safe at the
 * WRITER; the guard is the mitigation that has stood in front of it. Proving
 * fix 6 on production needs the rig to REACH that route, and the guard defers
 * every cell — so "prove it, then release the guard" is circular unless the
 * mode can move without a deploy.
 *
 *   full          the shipped behaviour: defer on dirty, on queued, and on a
 *                 store that cannot be read
 *   unknown-only  defer ONLY when the answer is genuinely not known
 *
 * ⛔ THE DEFAULT IS THE SAFE MODE, here as on the server, and an unrecognised
 * value takes it. Both ends must agree, and they are railed to.
 */
export const DOOR_GUARD_FULL = 'full'
export const DOOR_GUARD_UNKNOWN_ONLY = 'unknown-only'
export const DOOR_GUARD_MODES = Object.freeze([DOOR_GUARD_FULL, DOOR_GUARD_UNKNOWN_ONLY])

/** ⛔ ONE PLACE THAT KNOWS WHICH KEYS ARE MODES. Without it the `typeof ===
 *  'boolean'` tests below answer "absent" for every value a mode could ever
 *  carry — so a payload containing ONLY the mode would never latch, and the
 *  mode would never arrive. */
const MODE_KEYS = Object.freeze({ notebook_door_guard: DOOR_GUARD_MODES })

const flagPresent = (payload, k) => (MODE_KEYS[k]
  ? typeof payload?.[k] === 'string' && payload[k].trim() !== ''
  : typeof payload?.[k] === 'boolean')

const flagValue = (payload, k) => {
  const allowed = MODE_KEYS[k]
  if (!allowed) return typeof payload?.[k] === 'boolean' ? payload[k] : FLAG_FALLBACKS[k]
  const v = typeof payload?.[k] === 'string' ? payload[k].trim().toLowerCase() : null
  // ⛔ UNRECOGNISED TAKES THE DEFAULT, which is the SAFE mode. A typo degrades
  // to more guarding, never to less.
  return allowed.includes(v) ? v : FLAG_FALLBACKS[k]
}

let latched = null
let latchedAt = null
let ignoredDisagreements = 0

/**
 * Feed a payload in. The first one carrying ANY of these keys latches them all.
 *
 * ⛔ It never throws: this runs inside `AuthContext`'s auth paths, and a flag
 * read must never be able to fail a sign-in.
 */
export function latchNotebookFlags(payload) {
  try {
    if (latched) {
      // ⭐ RECORDED, NOT APPLIED. A disagreement is real information — it means
      // somebody flipped the switch while this tab was open — and it is exactly
      // what `notebookFlagsDebug()` exists to show. It is still not applied.
      for (const k of Object.keys(FLAG_FALLBACKS)) {
        if (payload && flagPresent(payload, k) && flagValue(payload, k) !== latched[k]) {
          ignoredDisagreements += 1
        }
      }
      return latched
    }
    if (!payload) return null
    const has = Object.keys(FLAG_FALLBACKS).some((k) => flagPresent(payload, k))
    // ⛔ A payload with none of these keys is an OLDER BACKEND, not a decision.
    // Latching `false` from it would kill the wave on every member the moment a
    // stale pod answered one request.
    if (!has) return null
    const next = {}
    for (const k of Object.keys(FLAG_FALLBACKS)) {
      next[k] = flagValue(payload, k)
    }
    latched = next
    latchedAt = Date.now()
    return latched
  } catch {
    return latched
  }
}

/** The latched value for one capability, or `null` when nothing has latched yet. */
export function notebookFlag(key) {
  if (!latched) return null
  const v = latched[key]
  return typeof v === 'boolean' ? v : null
}

/**
 * The door guard's latched mode.
 *
 * ⛔ NOTHING LATCHED ⇒ THE SAFE MODE, never null and never the permissive one.
 * A tab that has not yet heard from the server is a tab that must keep
 * guarding: the cost of a false defer is one "try again in a moment"; the cost
 * of a false pass is the member's words.
 */
export function doorGuardMode() {
  const v = latched ? latched.notebook_door_guard : null
  return DOOR_GUARD_MODES.includes(v) ? v : DOOR_GUARD_FULL
}

/** Has ANY payload latched? The first-render gate asks this. */
export const notebookFlagsReady = () => latched !== null

/** What an operator needs to tell a stale answer from a current one. */
export const notebookFlagsDebug = () => ({
  latched: latched ? { ...latched } : null,
  latchedAt,
  ignoredDisagreements,
})

/** Rails only — the latch is module state and each test wants its own. */
export function __resetNotebookFlags() {
  latched = null
  latchedAt = null
  ignoredDisagreements = 0
}
