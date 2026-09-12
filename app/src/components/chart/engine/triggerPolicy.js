// ─── WHEN DOES A TRUTH BECOME AN EVENT? ─────────────────────────────────────
//
// ⭐⭐ THE POLICY IS NAMED; THE MECHANISM IS THE ONE THAT ALREADY SHIPPED. A
// boolean column is `{0, 1}` numerically, so "became true" is a crossing of 0.5
// — and UCT's alert engine has judged crossings on closed bars since the cutover:
//
//     cross_above:  prev is not None and prev <= threshold and current > threshold
//
// With `threshold = 0.5` on a `{0, 1}` series that is EXACTLY `false → true`, and
// on the live closed lane `prev` is `series[i-1]` — the bar before, not whatever
// the previous 60-second poll happened to store. No new edge detection is written
// here and none should be: the shipped comparator already carries the fire-once
// key, the re-arm, the rev migration and four years of measurement.
//
// ⛔⛔ AND `0.5` IS NEVER SHOWN TO A MEMBER. "Alert me when RSI crosses above 0.5"
// is a sentence about our encoding, not about their idea. The member picks
// **Becomes True**; this module is the only place that knows what that compiles to,
// which is what keeps the UX honest and the engine unduplicated.
//
// ⚠️ AND UNKNOWN CANNOT FIRE, FOR FREE. `cross_above` begins `prev is not None`,
// and a warm-up bar has no value — so `unknown → true` cannot produce an edge. The
// property is the comparator's, not something asserted here, which is why it holds
// for every policy this vocabulary will ever gain.

/** The threshold that splits a `{0, 1}` column. Never rendered. */
export const BOOLEAN_MIDPOINT = 0.5

/**
 * The V1 vocabulary. One policy is exposed; the others are named so that adding
 * them later is a table entry rather than an `if` somewhere in the UI.
 *
 * ⛔ `exposed: false` IS NOT "NEARLY READY". `becomes_false` is a correct
 * compilation and still unexposed, because a member has not asked for it and an
 * option nobody chose is a surface to keep working. `while_true` and
 * `every_true_bar` are deliberately ABSENT rather than unexposed: on a level
 * reading they fire once per armed episode, which is not what either name
 * promises, and defining them properly is its own decision.
 */
export const TRIGGER_POLICIES = Object.freeze({
  becomes_true: Object.freeze({
    id: 'becomes_true',
    label: 'Becomes True',
    exposed: true,
    /** What the shipped engine is actually asked. */
    condition: 'cross_above',
    threshold: BOOLEAN_MIDPOINT,
    blurb: 'Fires on the bar where the condition turns true.',
  }),
  becomes_false: Object.freeze({
    id: 'becomes_false',
    label: 'Becomes False',
    exposed: false,
    condition: 'cross_below',
    threshold: BOOLEAN_MIDPOINT,
    blurb: 'Fires on the bar where the condition stops being true.',
  }),
})

export const DEFAULT_POLICY = 'becomes_true'

/** The policies a member may choose today. */
export const exposedPolicies = () =>
  Object.values(TRIGGER_POLICIES).filter((p) => p.exposed)

/**
 * A policy id → what the alert row must store.
 *
 * @returns {{condition: string, threshold: number} | null} `null` for a policy
 *   this vocabulary does not declare — never a guess, because a wrong comparator
 *   is an alert that fires on the wrong edge and says nothing about it.
 */
export function compilePolicy(policyId) {
  const p = TRIGGER_POLICIES[policyId]
  if (!p) return null
  return { condition: p.condition, threshold: p.threshold }
}

/**
 * The inverse — what a stored alert row means, in the member's words.
 *
 * ⚠️ IT MATCHES ON BOTH FIELDS. A `cross_above` at some OTHER threshold is a
 * numeric alert somebody built by hand on a numeric definition; calling that
 * "Becomes True" would relabel a real threshold as a boolean edge.
 */
export function policyOf(row) {
  if (!row) return null
  for (const p of Object.values(TRIGGER_POLICIES)) {
    if (row.condition === p.condition && Number(row.threshold) === p.threshold) return p
  }
  return null
}
