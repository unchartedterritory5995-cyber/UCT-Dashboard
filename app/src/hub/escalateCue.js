// ⛔⛔ THE COMMIT CUE — ONE implementation, for BOTH doors, with a VISUAL fallback where there is
// no vibration hardware to speak to. That last clause is the whole reason this file exists.
//
// ── THE DEFECT IT CLOSES ───────────────────────────────────────────────────────────────────────
// §C2's escalation says: an action that leads to a surface asking the member to COMMIT — a confirm
// sheet, a stop sheet, a close form — gets `warn()` instead of `impact()`. That cue is the product
// telling a thumb "this one is different" before it is different.
//
// `components/mobile/haptics.js:5-11` no-ops without `navigator.vibrate`, **which iOS Safari does
// not expose at all**. So on every iPhone, the cue for the most destructive actions in the hub —
// journal.close among them — has always been silence, indistinguishable from an ordinary fire.
// The haptic was never the point; the DIFFERENCE was. Where the device cannot buzz, the difference
// has to be seen.
//
// ── WHY A JS-TIMED STATIC CLASS AND NOT AN ANIMATION ───────────────────────────────────────────
// ⛔ `styles/tokens.css` zeroes `animation-duration` AND `transition-duration` app-wide with
// `!important` under `prefers-reduced-motion: reduce`. A CSS animation or transition would
// therefore be REMOVED for exactly the members most likely to be relying on a non-haptic cue — the
// silent-failure shape this repo keeps paying for. A class that is added, held by a timer, and
// removed changes a static colour; it is neither a transition nor an animation, so the reset
// cannot reach it.
//
// ── WHAT IT REFUSES TO ASSUME ──────────────────────────────────────────────────────────────────
// ⭐ `haptics.warn()` RETURNS whether it fired, and this consults that return value rather than
// guessing from the platform. Sniffing `navigator.vibrate` here would be a SECOND authority over a
// question `haptics.js` already answers, and the two would disagree the day one of them changes
// (`lesson_a_second_authority_over_one_value`). A `false` means "no vibration happened" whatever
// the reason — no hardware, iOS, a browser that refused, a throw inside the helper.
import haptics from '../components/mobile/haptics.js'

/** How long the visual cue is held, in ms. ⚠️ Not a taste value: short enough not to read as a
 *  state change, long enough to cross a 60fps frame budget several times over. */
export const ESCALATE_CUE_MS = 180

/**
 * Fire the commit cue for one action, on either door.
 *
 * @param {{escalate?: boolean}|null|undefined} action The action about to run.
 * @param {object} [opts]
 * @param {Element|null} [opts.el] The element to flash when there is no vibration — the hub root,
 *   whose knob the class paints. Omitted (or null) means haptic-only, which is what every caller
 *   did before this file existed, so an unwired caller degrades to the old behaviour rather than
 *   throwing.
 * @param {string} [opts.className] The CSS-module class to hold. Passed IN rather than imported:
 *   `hub.module.css` hashes its names, and a module that reached for the stylesheet itself would
 *   be a second place that decides what the cue looks like.
 * @param {boolean} [opts.hapticsEnabled] The member's own haptics preference. False means no
 *   vibration is ATTEMPTED — and the visual cue still fires, because "I don't want buzzing" is not
 *   "I don't want to be told this action commits something".
 * @param {(fn: Function, ms: number) => any} [opts.setTimeoutFn] Injected for tests.
 * @returns {{escalate: boolean, haptic: boolean, visual: boolean}} What actually happened —
 *   reported, never assumed, so a caller's test can assert the cue rather than the intent.
 */
export function escalateCue(action, opts = {}) {
  const {
    el = null,
    className = '',
    hapticsEnabled = true,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  } = opts

  const escalate = action?.escalate === true

  // ⛔ THE NON-ESCALATING PATH IS STILL THIS FUNCTION'S JOB. If it only handled `escalate`, every
  // caller would keep its own `else haptics.impact()` branch and the two copies this file was
  // written to delete would simply move one line down.
  const haptic = hapticsEnabled ? (escalate ? haptics.warn() : haptics.impact()) : false

  if (!escalate) return { escalate: false, haptic: Boolean(haptic), visual: false }
  // A device that CAN buzz has already said the thing. Painting as well would make the escalation
  // louder on the platform that never lost it, which is not the defect being fixed.
  if (haptic) return { escalate: true, haptic: true, visual: false }
  if (!el || !className) return { escalate: true, haptic: false, visual: false }

  el.classList.add(className)
  setTimeoutFn(() => el.classList.remove(className), ESCALATE_CUE_MS)
  return { escalate: true, haptic: false, visual: true }
}

export default escalateCue
