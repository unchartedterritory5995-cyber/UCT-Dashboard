/* Tiny haptics helper — wraps navigator.vibrate with conventional patterns.
 * No-ops where vibration is unsupported (desktop, iOS Safari). Use sparingly:
 * on commit/selection, never on scroll or every tap.
 */
const canVibrate = () =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

function fire(pattern) {
  if (!canVibrate()) return false
  try { return navigator.vibrate(pattern) } catch { return false }
}

export const tap = () => fire(10)          // light selection/toggle
export const impact = () => fire(18)       // swipe-action / long-press open
export const success = () => fire([10, 40, 12])
export const warn = () => fire([22, 60, 22])

export default { tap, impact, success, warn }
