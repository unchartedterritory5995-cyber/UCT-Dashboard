import { getDefinition } from './nativeRegistry'
import { isInstanceTombstone } from '../chartDefaults'

/**
 * WHERE AN INDICATOR DRAWS — the one place that decides it.
 *
 * ⭐ THIS MODULE EXISTS BECAUSE FOUR PLACES USED TO DECIDE IT SEPARATELY: the
 * migrator (`instances.js`), `instanceControls.placementFor`, `placement.js`'s
 * overlay branch, and `StockChart`'s `volOverlaySet`. Each read
 * `cs.volumeOverlayIndicators` and each drew its own conclusion, and the comment
 * on `placementFor` said out loud that it was "duplicating the rule rather than
 * exporting the migrator's" with a byte-identity test to catch them drifting. A
 * test that catches drift is a test that expects drift. One function instead.
 *
 * ⛔⛔ THE PRECEDENCE, AND IT IS THE WHOLE CONTRACT:
 *
 *     1. an explicit `instance.placement.target`   — the canonical, new answer
 *     2. else `cs.volumeOverlayIndicators`          — the legacy answer, READ ONLY
 *     3. else the definition's declared target      — what the indicator is for
 *
 * ⚠️ LEGACY IS READ, NEVER REWRITTEN. Loading an old chart resolves through (2)
 * and stores nothing; the blob is byte-identical after a load that never touched
 * the placement UI. Only an explicit user action writes (1) — see
 * `setInstanceDisplayTarget`. "Migrate on load" would mean every user's stored
 * settings silently change shape the first time they open a chart, and the one
 * thing worse than two formats is two formats plus a rewrite nobody asked for.
 */

/** The targets a user can currently CHOOSE. `price` is resolvable but is not
 *  offered by the UI yet — only what is fully working gets a menu entry. */
export const DISPLAY_TARGETS = Object.freeze(['pane', 'volume'])

/**
 * The effective target for one instance.
 *
 * @param {object} instance   an entry from `cs.indicatorInstances`
 * @param {object} cs         chart settings (read for the legacy list only)
 * @param {string} [defTarget] the definition's declared target; looked up when omitted
 */
export function resolveDisplayTarget(instance, cs, defTarget) {
  if (!instance || typeof instance !== 'object') return null
  const defId = instance.defId
  if (typeof defId !== 'string' || !defId) return null

  const declared = typeof defTarget === 'string' && defTarget
    ? defTarget
    : getDefinition(defId)?.placement?.target
  if (typeof declared !== 'string' || !declared) return null

  // (1) The canonical answer. An instance that says where it goes goes there —
  // including back to its own pane, which is why `setInstanceDisplayTarget`
  // DELETES the key for `pane` rather than writing it: absent means "the
  // definition's own answer", and there is exactly one spelling of the default.
  const explicit = instance.placement && instance.placement.target
  if (typeof explicit === 'string' && explicit) return explicit

  // (2) The legacy answer. Only a PANE oscillator can be overlaid onto volume —
  // a price overlay listed there (which nothing writes, but data is data) keeps
  // its declared target rather than being moved somewhere it cannot draw.
  if (declared === 'pane' && Array.isArray(cs?.volumeOverlayIndicators)
      && cs.volumeOverlayIndicators.includes(defId)) {
    return 'volume'
  }

  // (3) What the indicator is for.
  return declared
}

/**
 * Every definition id currently drawing INSIDE the volume pane.
 *
 * ⚠️ KEYED BY DEFINITION, NOT BY INSTANCE, and that is a real constraint rather
 * than an oversight: the volume pane's left axis is ONE scale, and `placement.js`
 * keys its overlay branch by `def.id`. Two RSI instances overlaid onto volume
 * therefore share that axis — fine while they share a range, and the same
 * per-definition boundary `placement.js` already documents for `'bands'` mode.
 *
 * ⛔ HIDDEN AND TOMBSTONED INSTANCES ARE SKIPPED, for the reason `orderedPaneKeys`
 * skips them: this set is subtracted from the pane stack, so counting an
 * instance that draws nothing would exclude a pane that nothing else fills.
 */
export function volumeOverlayKeys(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (tombstone || inst.hidden === true) continue
    if (resolveDisplayTarget(inst, cs) === 'volume') out.add(inst.defId)
  }
  // ⭐ AND THE LEGACY LIST STILL COUNTS ON ITS OWN. A chart can name an
  // oscillator in `volumeOverlayIndicators` that has no instance yet — the
  // toolbar checkbox writes the list directly and always has. Dropping those
  // would move a user's overlay back into its own pane on upgrade, which is the
  // one thing "read legacy, do not rewrite it" is supposed to prevent.
  if (Array.isArray(cs?.volumeOverlayIndicators)) {
    const live = new Set()
    for (const inst of (Array.isArray(instances) ? instances : [])) {
      if (inst && typeof inst === 'object' && typeof inst.defId === 'string') live.add(inst.defId)
    }
    for (const id of cs.volumeOverlayIndicators) {
      if (typeof id === 'string' && id && !live.has(id)) out.add(id)
    }
  }
  return out
}
