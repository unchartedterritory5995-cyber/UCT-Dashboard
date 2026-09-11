import { getDefinition } from './nativeRegistry'
import { isInstanceTombstone } from '../chartDefaults'
import { derivedTargetFor, parsePaneOfTarget } from './sourceRef'

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

/** The targets a user can currently CHOOSE for a definition that declares
 *  `pane`. A DERIVED instance is offered more than this — see below. */
export const DISPLAY_TARGETS = Object.freeze(['pane', 'volume'])

/**
 * Is `t` a target a user may WRITE?
 *
 * ⭐⭐ SOURCE AND DISPLAY TARGET ARE SEPARABLE, AND THIS IS THE SENTENCE THAT
 * SAYS SO. `MA(RSI)` DEFAULTS into RSI's pane; it is not welded there. So the
 * writable set has to include the two things the fixed list could never express:
 *
 *   `'@rsi'`  — "wherever RSI is", the derived default said out loud. Writing it
 *               is how "put it back with its source" is spelled, and
 *               `setInstanceDisplayTarget` then DELETES the key because it
 *               equals the default. One spelling of the default, as ever.
 *   `'price'` — resolvable since the first pass (`placement.js`) and now
 *               reachable: a moving average of RSI drawn on the candles is a
 *               strange chart, but it is the user's chart, and refusing it here
 *               would mean the pane is a property of the SOURCE rather than a
 *               default.
 */
export function isWritableDisplayTarget(t) {
  if (typeof t !== 'string' || !t) return false
  return DISPLAY_TARGETS.includes(t) || t === 'price' || !!parsePaneOfTarget(t)
}

/**
 * The effective target for one instance.
 *
 * @param {object} instance   an entry from `cs.indicatorInstances`
 * @param {object} cs         chart settings (read for the legacy list only)
 * @param {string} [defTarget] the definition's declared target; looked up when omitted
 */
export function resolveDisplayTarget(instance, cs, defTarget, depth = 0) {
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
  // ⛔⛔ A TARGET THAT RESTATES THE DEFINITION IS NOT AN OVERRIDE. The migrator
  // and `addInstance` both write `placement: { target: <the declared one> }` on
  // every instance they create — harmless while every target was static, and
  // fatal to the first one that is not: `MA(RSI)` belongs in RSI's pane, and a
  // `target: 'price'` stored at ADD time (copied straight from the definition,
  // expressing no user intent at all) outranked that forever. Measured live — the
  // MA computed a perfect average of RSI and drew it on the candles' scale.
  //
  // ⚠️ NOTHING IS REWRITTEN, AND NO USER INTENT IS LOST. An explicit write that
  // DIFFERS still wins, and `setInstanceDisplayTarget` never stores a value equal
  // to the default anyway — it deletes the key instead. This only stops a copy of
  // the definition's own answer from masquerading as a decision.
  const explicit = instance.placement && instance.placement.target
  if (typeof explicit === 'string' && explicit && explicit !== declared) return explicit

  // (2) The legacy answer. Only a PANE oscillator can be overlaid onto volume —
  // a price overlay listed there (which nothing writes, but data is data) keeps
  // its declared target rather than being moved somewhere it cannot draw.
  if (declared === 'pane' && Array.isArray(cs?.volumeOverlayIndicators)
      && cs.volumeOverlayIndicators.includes(defId)) {
    return 'volume'
  }

  // (2.5) ⭐⭐ A DERIVED INDICATOR DEFAULTS TO ITS SOURCE'S PANE. `MA(RSI)` into
  // RSI's pane, `MA(Volume)` into the volume pane, `MA(Close)` onto the candles —
  // the answer a trader expects, and the one that makes those three feel like one
  // feature. It sits BELOW the explicit placement above, so moving it later is an
  // ordinary write that outranks this: a default, never a weld.
  //
  // ⚠️ RESOLVED THROUGH THIS SAME FUNCTION, so a follower of a follower gets the
  // right answer and a source that is itself overlaid on Volume takes its
  // follower with it. Depth is bounded by the recursion guard below.
  if (cs && depth < 8) {
    const def = getDefinition(defId)
    const derived = derivedTargetFor(
      instance, def,
      Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [],
      getDefinition,
      (other) => resolveDisplayTarget(other, cs, undefined, depth + 1),
    )
    if (derived) return derived
  }

  // (3) What the indicator is for.
  return declared
}

/**
 * The DEFINITION whose pane an instance draws in, or null for a shared pane.
 *
 * ⭐ THE ONE TRANSLATION FROM "SEMANTIC OWNER" TO "PANE KEY", and every consumer
 * takes it from here — `placement.js` to find the index, `paneLayout` to decide
 * who gets a pane of their own, `StockChart` to decide what sits above Price.
 * Four modules each translating it themselves is exactly the drift
 * `displayTarget.js` was created to end for Volume; this is the dynamic case of
 * the same rule.
 *
 * ⛔ IT ANSWERS A DEFINITION ID, NEVER A PANE INDEX. `computePaneLayout` keys
 * panes by definition id, and an index is a fact about the current stack that
 * changes when anything above it moves. A stored index would break the first time
 * RSI went above Price; a stored definition id cannot.
 */
export function paneOwnerOf(instance, cs) {
  const target = resolveDisplayTarget(instance, cs)
  if (!target || target === 'price' || target === 'volume') return null
  const owner = parsePaneOfTarget(target)
  if (owner) return owner
  return instance && typeof instance.defId === 'string' ? instance.defId : null
}

/**
 * Where this instance would go if nobody had moved it — its SOURCE's home, or
 * null when it has no source reference at all.
 *
 * ⭐ IT ANSWERS A UNITS QUESTION, not only a position one. A guest in a shared
 * pane whose target came from HERE is reading the same numbers the host is:
 * `MA(Volume)` in the volume pane is in shares, and belongs on volume's own
 * ladder. A guest that was PARKED there — RSI dragged onto Volume — is not, and
 * needs an axis of its own. `placement.js` asks this to tell them apart, which is
 * why the distinction stays metadata rather than a list of indicator names.
 */
export function derivedTargetOf(instance, cs) {
  if (!instance || !cs) return null
  return derivedTargetFor(
    instance,
    getDefinition(instance.defId),
    Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [],
    getDefinition,
    (other) => resolveDisplayTarget(other, cs),
  )
}

/** Definition ids that FOLLOW somebody else's pane rather than owning one. */
export function paneFollowerKeys(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || inst.hidden === true) continue
    const target = resolveDisplayTarget(inst, cs)
    const owner = parsePaneOfTarget(target)
    if (owner && owner !== inst.defId) out.add(inst.defId)
  }
  return out
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

/**
 * Definition ids that must KEEP a pane even though their own instance is hidden.
 *
 * ⭐⭐ BECAUSE SOMETHING VISIBLE IS DRAWING IN IT. Hiding RSI is a statement about
 * RSI's ink, and `orderedPaneKeys` correctly gives a hidden instance no pane —
 * but `MA(RSI)` is still visible and still computing, and its pane is RSI's. With
 * no pane to join it resolved to nothing and vanished too, which turns the eye
 * icon into a delete button for everything downstream of it.
 *
 * ⚠️ ONLY FOR A VISIBLE FOLLOWER. Hide both and the pane goes, which is right:
 * an empty rectangle is the thing `orderedPaneKeys` skips hidden instances to
 * avoid in the first place.
 */
export function paneOwnersNeeded(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || inst.hidden === true) continue
    const owner = parsePaneOfTarget(resolveDisplayTarget(inst, cs))
    if (owner && owner !== inst.defId) out.add(owner)
  }
  return out
}
