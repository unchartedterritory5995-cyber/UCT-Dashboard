/**
 * Wave R — the switch that keeps this release's capture tools dark.
 *
 * ⚰️ WHY IT EXISTS. Wave R shipped four new doors into a member's notes: the
 * Scanner's "Send to Journal", the ticker menu's "Send chart to note", and the
 * Indexes / Market Context widgets that exist to be captured INTO a note. They
 * were built correct and railed — and they were built with NO gate at all, so
 * merging the branch would have put all four in front of every member the
 * moment the pod swapped.
 *
 * ⛔ THAT IS NOT WHAT THE RELEASE SAYS. The member-impact paragraph for this
 * deploy reads "the new Notebook capture tools in this release are switched off
 * until a later update turns them on." A paragraph the code does not honour is
 * the defect this wave has already paid for twice (a published claim read off a
 * call site instead of the wire). This module is what makes that sentence TRUE.
 *
 * ⛔ WHAT "OFF" MEANS, PRECISELY — and it is narrower than it sounds:
 *
 *   · the two widgets stay REGISTERED. `WIDGET_REGISTRY` still describes them,
 *     so a notebook that already stores such an embed still renders and still
 *     search-indexes. Turning a door off has never been permission to stop
 *     honouring what a member already saved.
 *   · what goes away is the ENTRY POINTS: the add-widget menu, the add-tab
 *     menu, the phone sheet, the slash menu and the insert palette all stop
 *     OFFERING them, and the two capture buttons stop rendering.
 *
 * ⛔ AND THE OPT-IN IS PER BROWSER, NOT PER DEPLOY — same reasoning, same key
 * shape, as `offlineFlag.js`: the canary has to exercise the REAL production
 * build, and a build-time-only flag forces the choice between a sandbox (which
 * is not the product) and turning it on for everyone at once (which is the gate
 * this exists to respect).
 *
 *     localStorage.setItem('uct.nb.capture.enabled', '1')   // this browser only
 *     localStorage.removeItem('uct.nb.capture.enabled')     // back to the default
 *
 * ⚠️ The menu arrays are derived once at module import, so a localStorage change
 * reaches the menus on the NEXT PAGE LOAD, not the current one. The two buttons
 * call `captureEnabled()` at render and so follow immediately. That asymmetry is
 * deliberate and stated rather than papered over.
 *
 * ⛔ This module has NO imports, so `registry.js` keeps the property its own
 * header claims: any surface can read the registry without pulling widget code.
 */

/** The release switch. Flip to `true` in ONE commit when the wave is cleared. */
export const WAVE_R_CAPTURE_ON = false

export const CAPTURE_FLAG_KEY = 'uct.nb.capture.enabled'

/**
 * The widget ids Wave R added. ⭐ Listed here rather than marked inside the
 * registry entries so the release decision lives in ONE file and a reader can
 * see the whole blast radius at once — the registry describes what EXISTS, this
 * describes what is RELEASED.
 */
export const UNRELEASED_CAPTURE_WIDGETS = Object.freeze(['indexes', 'marketcontext'])

export function captureEnabled(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(CAPTURE_FLAG_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* private mode: fall through to the default */ }
  return WAVE_R_CAPTURE_ON
}

/**
 * Filter a menu roster down to what this release actually offers.
 * `on` is injectable so a rail can drive BOTH directions without reloading the
 * module — a gate only proved in one direction is not a gate.
 */
export function releasedTypes(ids, on = captureEnabled()) {
  if (on) return ids
  return ids.filter(id => !UNRELEASED_CAPTURE_WIDGETS.includes(id))
}
