/**
 * VIS-5 (audit 2026-11-05, visual issue 20): ONE COLOUR LANGUAGE FOR A PLAN. Entry is gold, the stop is
 * `--loss`, the target is `--gain` -- everywhere a plan is drawn or listed: the note's chart embed (its
 * role-tagged lines), the plan panel's replay, the Setups board, the trade-plan canvas and the trade page.
 *
 * ⚰️ Five hand-written maps disagreed: in the note all three lines were gold, the board drew the stop
 * #f87171 and the target #4ade80, the plan panel's replay used the retired legacy gold #c9a84c, the canvas
 * drew the entry BLUE (#4f8cff), and the trade page had a fifth copy. A member saw the same plan in two
 * colour languages on two screens.
 *
 * The values ARE the tokens: a chart canvas cannot read `var()`, so `planRoleColor` reads the live token
 * off <html> (a theme island or the light theme moves it with everything else) and falls back to the
 * default theme's value. planColors.test.js pins the fallbacks to tokens.css's :root, so they cannot drift.
 */
export const PLAN_ROLE_TOKEN = Object.freeze({ entry: '--ut-gold', stop: '--loss', target: '--gain' })

/** The default (:root) value of each token -- the fallback when no document can be read. */
export const PLAN_ROLE_FALLBACK = Object.freeze({ entry: '#dcbb5e', stop: '#df4646', target: '#2faf68' })

/** For CSS: `var(--ut-gold)` and friends. */
export const PLAN_ROLE_VAR = Object.freeze(Object.fromEntries(
  Object.entries(PLAN_ROLE_TOKEN).map(([role, token]) => [role, `var(${token})`]),
))

/** The colour a plan line of `role` is drawn in, or null for a line with no plan role. */
export function planRoleColor(role) {
  const token = PLAN_ROLE_TOKEN[role]
  if (!token) return null
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      const live = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      if (live) return live
    }
  } catch { /* no document to read: the default theme's value */ }
  return PLAN_ROLE_FALLBACK[role]
}

/** For a CHART (a canvas, which cannot paint `var()`): a plan role's colour, or the muted ink for a line with no plan
 *  role (the canvas's plain "Level"). Always a real colour value -- review Critical 1, rail planColors.canvas.test.js. */
export const MUTED_FALLBACK = '#cfcac0' // tokens.css :root --text-muted (pinned by planColors.canvas.test.js)
export function planLineColor(role) {
  const plan = planRoleColor(role)
  if (plan) return plan
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      const live = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim()
      if (live) return live
    }
  } catch { /* no document to read */ }
  return MUTED_FALLBACK
}

/** A chart embed's annotations with every plan-role line in its role's colour. Unchanged (the same array)
 *  when none carries a role, so a chart without a plan re-renders nothing. */
export function colorPlanAnnotations(annotations) {
  if (!Array.isArray(annotations) || !annotations.some((a) => PLAN_ROLE_TOKEN[a?.role])) return annotations
  return annotations.map((a) => (PLAN_ROLE_TOKEN[a?.role] ? { ...a, color: planRoleColor(a.role) } : a))
}
