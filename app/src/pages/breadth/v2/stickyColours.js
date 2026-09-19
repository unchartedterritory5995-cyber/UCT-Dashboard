/**
 * V2-2 · W2-5 — colour follows the ENTITY, never its rank.
 *
 * ⛔⛔ THE DEFECT THIS REPLACES IS LIVE IN V1 TODAY, AND IT WAS MEASURED, NOT ASSUMED.
 * `chartMetrics.resolveColors(selected)` walks the SELECTION and advances a per-tone
 * counter as it goes, so a metric's colour is a function of its POSITION in the current
 * selection. Measured 2026-09-17 on three real neutral-tone metrics:
 *
 *     selection [breadth_score, pct_above_50sma, pct_above_200sma]
 *        -> pct_above_50sma = #f59e0b
 *     deselect breadth_score
 *        -> pct_above_50sma = #60a5fa        ← the survivor was REPAINTED
 *
 * So unticking one metric changes the colour of the ones left behind. Colour is the
 * identity channel on this chart: a reader who has learned "amber is the 50-day" loses
 * that the moment they narrow the view, and — worse — amber is now a DIFFERENT metric.
 * The `dataviz` rule is explicit: *colour follows the entity, never its rank; a filter
 * that changes the series count must not repaint the survivors.*
 *
 * ⭐ THE FIX IS TO ASSIGN ONCE, OVER THE WHOLE REGISTRY, AT MODULE LOAD. Every metric
 * gets its colour from its position in `ALL_METRICS` — a fixed, source-ordered list that
 * does not depend on what anyone has selected. Selection then cannot enter the
 * computation at all, which is stronger than remembering not to let it: `stickyColour`
 * takes ONE key and has no way to see the rest.
 *
 * ⛔ ONE MAP. Not a map per panel, not a map per preset. Two maps over one value is the
 * second-authority defect this repo keeps paying for, and with colours it fails silently
 * — the two panels simply disagree and nothing is red.
 *
 * ⚠️ A ramp still wraps: more same-tone metrics than ramp entries and two of them share
 * a colour. That is inherited and unchanged — but it is now a STABLE collision (the same
 * two, always) rather than a moving one, and a stable collision is visible to a reader
 * and to a rail. `collisionsWithin` reports it for a given selection so a caller can
 * separate the pair by panel or by mark instead of by hue.
 */
import { ALL_METRICS, TONE_RAMP, toneOf } from '../chartMetrics'

/**
 * key -> colour, computed ONCE over the registry in source order.
 *
 * ⛔ Built from `ALL_METRICS`, never from a selection — that is the whole mechanism.
 */
const STICKY = (() => {
  const used = {}
  const out = {}
  for (const m of ALL_METRICS) {
    const tone = toneOf(m.key)
    const ramp = TONE_RAMP[tone] ?? TONE_RAMP.neutral
    used[tone] = used[tone] ?? 0
    out[m.key] = ramp[used[tone] % ramp.length]
    used[tone] += 1
  }
  return Object.freeze(out)
})()

/** The colour for one metric. ⭐ Takes a KEY, not a selection — it cannot see rank. */
export function stickyColour(key) {
  return STICKY[key] ?? TONE_RAMP.neutral[0]
}

/**
 * `{key: colour}` for a selection — a convenience for the chart, and deliberately a
 * plain lookup so it CANNOT drift from `stickyColour`.
 */
export function stickyColours(selected) {
  const out = {}
  for (const key of selected ?? []) out[key] = stickyColour(key)
  return out
}

/**
 * Colours shared by two or more of the SELECTED metrics.
 *
 * ⭐ Reported rather than fixed by re-assigning, because re-assigning is exactly the
 * rank-dependence this module exists to remove: resolving a collision by shuffling
 * whoever is on screen would repaint the survivors again, one level down.
 */
export function collisionsWithin(selected) {
  const byColour = {}
  for (const key of selected ?? []) {
    const c = stickyColour(key)
    ;(byColour[c] = byColour[c] ?? []).push(key)
  }
  return Object.entries(byColour)
    .filter(([, keys]) => keys.length > 1)
    .map(([colour, keys]) => ({ colour, keys }))
}

/** The whole map, frozen — for rails and for debugging, never to be mutated. */
export const STICKY_COLOURS = STICKY

/**
 * The colours a selection is DRAWN in: sticky while selected, and never two alike when
 * the ramp has room (02-design §4 Colour, A-13).
 *
 * ⚰️ THE REGISTRY MAP ALONE COLLIDED ON THE DEFAULT VIEW. `breadth_score` and
 * `pct_above_50sma` are both neutral and sit a whole ramp apart in `ALL_METRICS`, so
 * `stickyColour` gave them the SAME blue — and they share the percentage panel. Every
 * member opening V2 saw two identical lines (2026-09-18, owner's screenshot).
 *
 * ⭐ The rule that keeps what the module above was written for: a metric that stays
 * selected KEEPS its colour (`previous`), so removing one never repaints the survivors.
 * Only a NEWLY added metric chooses — its registry colour if nobody on screen holds it,
 * else the first colour of its tone's ramp that is free. Rank never enters it.
 *
 * @param selected  keys in pick order
 * @param previous  { key: colour } from the last call (the component keeps it)
 * @returns { key: colour }
 */
export function assignColours(selected, previous = {}) {
  const out = {}
  const used = new Set()
  for (const key of selected ?? []) {
    const kept = previous[key]
    if (kept && !used.has(kept)) { out[key] = kept; used.add(kept) }
  }
  for (const key of selected ?? []) {
    if (out[key]) continue
    const ramp = TONE_RAMP[toneOf(key)] ?? TONE_RAMP.neutral
    const own = stickyColour(key)
    const pick = !used.has(own) ? own : (ramp.find(c => !used.has(c)) ?? own)
    out[key] = pick
    used.add(pick)
  }
  return out
}
