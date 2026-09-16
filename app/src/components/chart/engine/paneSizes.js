// app/src/components/chart/engine/paneSizes.js
//
// ─── THE ONE AUTHORITY FOR *USER-CHOSEN* PANE HEIGHT ────────────────────────
//
// ⚰️⚰️ THERE WAS NO AUTHORITY AT ALL, AND THAT IS THE WHOLE BUG. Pane height
// flowed ONE WAY — `computePaneLayout → paneStretchPlan → setStretchFactor →
// lightweight-charts` — so a member's separator drag lived only inside the
// library until the next binder sync recomputed the default and wrote over it.
// Measured, with the member having dragged QQQ from 81 to 270:
//
//     current (post-drag):      [270, 330, 100]
//     plan (what gets applied): [ 81, 463, 154]      ← 270 → 81, the snap-back
//
// ⭐⭐ SIZE IS NOT ORDER, AND THE TWO STAY APART. `paneOrder` is a LIST of pane
// keys; this is a MAP from pane key to a share of the stack. Nothing here can
// reorder a pane and nothing in `paneOrder` can resize one — which is what lets
// a member drag a separator without their arrangement shifting underneath them.
//
// ⛔ FRACTIONS, NOT PIXELS. `setStretchFactor` is already a relative weight, so
// storing a SHARE means the member's intent survives the chart widget changing
// height: 30% of a 900px stack and 30% of a 450px stack are the same choice.
// A stored `273` would be a third of one chart and two-thirds of the other.
//
// ⛔⛔ KEYED BY PANE KEY, NEVER BY PHYSICAL INDEX. Track A lets panes reorder, so
// a size attached to "whatever is at index 0" would jump to a different pane the
// moment the member rearranged. `price`, `volume` and instance-host ids are the
// same identities `paneOrder` uses, so a resized pane carries its height with it.
//
// ⚠️ ABSENT MEANS "WHATEVER THE LAYOUT COMPUTES", and that is the entire
// backward-compatibility story. A blob with no `paneSizes` resolves to today's
// defaults exactly; nothing is written until a member actually drags something,
// and only the panes they actually changed get an entry.

/** Where the member's chosen sizes live on the settings blob. */
export const PANE_SIZES_KEY = 'paneSizes'

/** Below this share a pane is unreadable; the stack refuses to starve one. */
const MIN_SHARE = 0.04
/** Above this, one pane has effectively eaten the chart. */
const MAX_SHARE = 0.90
/**
 * How far a pane must sit from its computed default before the drag counts as
 * INTENT. Pane heights settle a fraction of a percent off the plan through
 * rounding, and storing that noise would turn every repaint into a preference.
 */
export const INTENT_EPSILON = 0.01

const isKey = (k) => typeof k === 'string' && k.length > 0
const isShare = (v) => Number.isFinite(v) && v > 0 && v < 1

/** The member's stored sizes, cleaned — or `{}` when there are none. */
export function storedPaneSizes(cs) {
  const raw = cs && cs[PANE_SIZES_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const k of Object.keys(raw)) {
    const v = raw[k]
    if (isKey(k) && isShare(v)) out[k] = v
  }
  return out
}

/** Does this chart carry any explicit sizing at all? */
export function hasPaneSizes(cs) {
  return Object.keys(storedPaneSizes(cs)).length > 0
}

/**
 * Write one pane's chosen share.
 *
 * ⛔ THE ONE WRITER, like `setPaneOrder` next door. A share outside the readable
 * band is REFUSED rather than clamped-and-stored: a stored 0.98 would be a
 * preference the member can never see past, and silently storing something other
 * than what they did is worse than storing nothing.
 */
export function setPaneSize(cs, key, share) {
  if (!cs || typeof cs !== 'object' || !isKey(key)) return cs
  if (!isShare(share) || share < MIN_SHARE || share > MAX_SHARE) return cs
  const next = { ...storedPaneSizes(cs), [key]: +share.toFixed(4) }
  return { ...cs, [PANE_SIZES_KEY]: next, preset: 'custom' }
}

/** Write several at once — one settings object per gesture, not per pane. */
export function setPaneSizes(cs, entries) {
  if (!cs || typeof cs !== 'object' || !entries) return cs
  const next = { ...storedPaneSizes(cs) }
  let changed = false
  for (const k of Object.keys(entries)) {
    const v = entries[k]
    if (!isKey(k) || !isShare(v) || v < MIN_SHARE || v > MAX_SHARE) continue
    const rounded = +v.toFixed(4)
    if (next[k] !== rounded) { next[k] = rounded; changed = true }
  }
  if (!changed) return cs
  return { ...cs, [PANE_SIZES_KEY]: next, preset: 'custom' }
}

/**
 * Forget one pane's size, or all of them.
 *
 * ⭐ THIS IS "RETURN TO AUTOMATIC". Removing the entry is the whole reset: the
 * layout's computed default is what absent has always meant, so there is no
 * separate default to restore and no second code path to keep in step.
 */
export function clearPaneSize(cs, key) {
  if (!cs || typeof cs !== 'object') return cs
  const cur = storedPaneSizes(cs)
  if (!isKey(key)) {
    if (!Object.keys(cur).length) return cs
    return { ...cs, [PANE_SIZES_KEY]: {}, preset: 'custom' }
  }
  if (!(key in cur)) return cs
  const next = { ...cur }
  delete next[key]
  return { ...cs, [PANE_SIZES_KEY]: next, preset: 'custom' }
}

/**
 * Drop sizes for panes that are no longer on the chart.
 *
 * ⚠️ CALLED WHEN A PANE IS REMOVED, not on every read. A key for a pane that is
 * merely HIDDEN must survive — the member still placed it — which is the same
 * rule `setPaneOrder` applies to latent keys. Only a genuine deletion prunes.
 */
export function prunePaneSizes(cs, liveKeys) {
  const cur = storedPaneSizes(cs)
  const keys = Object.keys(cur)
  if (!keys.length) return cs
  const live = liveKeys instanceof Set ? liveKeys : new Set(liveKeys || [])
  const next = {}
  let dropped = false
  for (const k of keys) {
    if (live.has(k)) next[k] = cur[k]
    else dropped = true
  }
  if (!dropped) return cs
  return { ...cs, [PANE_SIZES_KEY]: next, preset: 'custom' }
}

/**
 * Apply the member's shares to a computed stretch plan.
 *
 * @param {number[]} plan        `paneStretchPlan`'s output — weights by slot
 * @param {Map<number,string>|Array<[number,string]>} keyByIndex slot → pane key
 * @param {object} sizes         `storedPaneSizes(cs)`
 * @returns {number[]} a new plan; the SAME numbers when nothing is stored
 *
 * ⭐⭐ THE PANES THE MEMBER DID NOT TOUCH ABSORB THE REMAINDER, IN PROPORTION.
 * A separator drag is a statement about two panes, not about the whole stack, so
 * the rest keep their relative sizes and simply share what is left. That is what
 * makes "resize QQQ" leave RSI's own choice alone, and what makes adding a pane
 * rebalance rather than discard.
 *
 * ⛔ TOTAL-PRESERVING BY CONSTRUCTION. The sum going out equals the sum coming
 * in, because the sum IS the stack and a plan that does not add up is the
 * blank-chart shape `paneLayout`'s header records.
 */
export function applyPaneSizes(plan, keyByIndex, sizes) {
  const base = Array.isArray(plan) ? plan.slice() : []
  const stored = (sizes && typeof sizes === 'object') ? sizes : {}
  if (!base.length || !Object.keys(stored).length) return base

  const map = keyByIndex instanceof Map ? keyByIndex : new Map(keyByIndex || [])
  const total = base.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0)
  if (!(total > 0)) return base

  // Which slots the member has an opinion about, and what share they asked for.
  const pinned = []
  for (const [idx, key] of map) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= base.length) continue
    const share = stored[key]
    if (isShare(share)) pinned.push({ idx, share })
  }
  if (!pinned.length) return base

  const pinnedIdx = new Set(pinned.map((p) => p.idx))
  const others = []
  let othersTotal = 0
  for (let i = 0; i < base.length; i++) {
    if (pinnedIdx.has(i)) continue
    const v = Number.isFinite(base[i]) && base[i] > 0 ? base[i] : 0
    others.push(i)
    othersTotal += v
  }

  // ⛔ THE PINNED SHARES MAY NOT EAT THE STACK. If they sum past the ceiling the
  // whole set is scaled down together, which keeps their RELATIVE sizes — the
  // member's actual intent — while leaving the others something to live in.
  //
  // ⚰️⚰️ AND "SOMETHING TO LIVE IN" USED TO MEAN ONE MIN_SHARE FOR THE WHOLE
  // REMAINDER, WHICH STARVED A NEW PANE. Measured live 2026-09-15: a member
  // enlarged Volume while a QQQ series was guesting inside it (`{price .443,
  // volume .557}` — a pinned sum of 1.0), then sent QQQ back to its own pane. The
  // newcomer is UNPINNED, so it got `1 - 0.96` of the stack — a four-percent
  // sliver — while the two pinned panes kept essentially everything.
  //
  // ⭐⭐ SO THE RESERVATION IS THE UNPINNED PANES' OWN CANONICAL DEFAULT. `base` is
  // `paneStretchPlan`'s computed answer, which already knows an auxiliary pane is
  // compact (~12% of a three-pane stack), so reserving THAT is what gives a new
  // host the size the layout would have given it — no pixel constant, no "if this
  // is a new pane", and no opinion about which pane it is. The pinned panes are
  // scaled down together, so the member's RATIO between the panes they actually
  // dragged is preserved exactly.
  // ⛔ THE CONDITION IS "THE STORED SHARES ARE A COMPLETE PARTITION", not merely
  // "they are large". A member who deliberately grows ONE pinned pane must keep
  // what they asked for, and the unpinned panes shrinking proportionally below
  // their default is the correct answer there. What is NOT correct is a stored
  // set that already accounts for the WHOLE stack being applied to a stack that
  // has since gained a pane — there is nothing left to distribute, and the
  // newcomer is clamped to a sliver.
  const othersBase = total > 0 ? othersTotal / total : 0
  const pinnedSum = pinned.reduce((s, p) => s + p.share, 0)
  const stalePartition = others.length > 0 && pinnedSum >= 1 - MIN_SHARE
  const reserve = stalePartition ? Math.min(0.9, Math.max(MIN_SHARE * others.length, othersBase)) : MIN_SHARE
  const ceiling = 1 - reserve
  let sum = pinnedSum
  if (sum > ceiling) {
    const k = ceiling / sum
    for (const p of pinned) p.share *= k
    sum = ceiling
  }

  const out = base.slice()
  for (const p of pinned) out[p.idx] = p.share * total

  const remainder = total * (1 - sum)
  if (others.length) {
    if (othersTotal > 0) {
      for (const i of others) {
        const v = Number.isFinite(base[i]) && base[i] > 0 ? base[i] : 0
        out[i] = (v / othersTotal) * remainder
      }
    } else {
      // Nothing to scale — split what is left evenly rather than leave zeros,
      // because a zero-weight pane is one the renderer collapses.
      for (const i of others) out[i] = remainder / others.length
    }
  }
  return out
}

/**
 * The shares a member's CURRENT chart is showing, as a map keyed by pane.
 *
 * ⭐ THE CAPTURE SIDE. Read the renderer's own stretch factors back, turn them
 * into shares, and keep only the panes that differ from what the layout would
 * have computed — so a drag on one separator records the two panes it moved and
 * says nothing about the rest. `INTENT_EPSILON` is what separates a gesture from
 * rounding noise.
 */
export function sizesFromStretch(observed, computed, keyByIndex, epsilon = INTENT_EPSILON) {
  const obs = Array.isArray(observed) ? observed : []
  const cmp = Array.isArray(computed) ? computed : []
  const map = keyByIndex instanceof Map ? keyByIndex : new Map(keyByIndex || [])
  const obsTotal = obs.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0)
  const cmpTotal = cmp.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0)
  if (!(obsTotal > 0) || !(cmpTotal > 0)) return {}

  const out = {}
  for (const [idx, key] of map) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= obs.length) continue
    if (!isKey(key)) continue
    const o = (Number.isFinite(obs[idx]) && obs[idx] > 0 ? obs[idx] : 0) / obsTotal
    const c = idx < cmp.length && Number.isFinite(cmp[idx]) && cmp[idx] > 0 ? cmp[idx] / cmpTotal : null
    if (c === null) continue
    if (Math.abs(o - c) < epsilon) continue          // rounding, not intent
    if (o < MIN_SHARE || o > MAX_SHARE) continue     // unreadable — refuse it
    out[key] = +o.toFixed(4)
  }
  return out
}
