// app/src/components/chart/engine/flipState.js
//
// ─── WHICH DEFINITIONS THE ENGINE IS CURRENTLY DRAWING ──────────────────────
//
// READ-ONLY, and deliberately so. Nothing here writes a settings blob or an
// instance: that is Task 9's `instanceControls.js`, and this module must not
// grow into it. What lives here is the one QUESTION two different readers ask —
// StockChart's render pass, and any control that needs to know whether it still
// controls anything.
//
// It exists at all because `ChartToolbar` is the second reader. The toolbar is
// rendered BY `StockChart`, so `StockChart` cannot export the answer to it
// without an import cycle, and a hand-copied second list of migrated ids is
// exactly the defect this branch has already fixed twice (`7b28e5d8`, and the
// legend slot rail in this same fix round). One list, two importers.

import { normalizeInstances } from './instances'
import { getDefinition, listDefinitions } from './nativeRegistry'

/**
 * A collection that REFUSES a write, which `Object.freeze` does not give you.
 *
 * ⛔ `Object.freeze(new Set([…]))` DOES NOT FREEZE THE SET. `Object.isFrozen`
 * answers `true` and `.add()` / `.delete()` still succeed — a Set's contents
 * live in an internal slot, not in own properties, so `freeze` seals the wrapper
 * and nothing else. Measured directly, not assumed:
 *
 *     isFrozen: true · add() SUCCEEDED · delete() SUCCEEDED
 *
 * ⭐ B5 TASK 13 — ITS ORIGINAL SUBJECTS ARE GONE AND THIS PARAGRAPH IS IN THE
 * PAST TENSE. It was written for the two flip sets: each membership was a SHIPPED
 * decision with a pixel number behind it, and an
 * `ENGINE_MIGRATED_DEF_IDS.add('stoch')` at module scope created the stranded
 * category (`docs/decisions/2026-08-03-…` §4.1) for real, at runtime, invisibly to
 * every static rail on this branch. Both sets are DELETED — membership is
 * `engineOwnsDefId`, a registry lookup, and a runtime `.add()` has nothing to add
 * to. What still uses `sealed` is `EMPTY` / `EMPTY_INPUTS`, the two shared
 * immutable returns below: a caller that mutated one would corrupt every OTHER
 * caller's answer, which is the same class of bug in a smaller blast radius.
 * Shadowing the mutators and THEN freezing makes such a write throw where it
 * happens rather than one screen away.
 */
function sealed(collection, mutators) {
  for (const op of mutators) {
    collection[op] = () => {
      throw new TypeError(
        `flipState: ${op}() on a flip set. Membership is a shipped decision with a parity ` +
        'number behind it, not runtime state — edit the literal and re-run the gate.',
      )
    }
  }
  return Object.freeze(collection)
}

const sealedSet = (ids) => sealed(new Set(ids), ['add', 'delete', 'clear'])
const sealedMap = (entries) => sealed(new Map(entries), ['set', 'delete', 'clear'])

const EMPTY = sealedSet([])
const EMPTY_INPUTS = sealedMap([])

/**
 * ⭐⭐ B5 TASK 13 — `ENGINE_MIGRATED_DEF_IDS` AND `ENGINE_FLIPPED_DEF_IDS` ARE
 * DELETED, AND THIS ONE MEMBERSHIP TEST IS WHAT REPLACED THEM.
 *
 * They were two hand-written fourteen-id literals, and by B5 Task 8 they had
 * become EQUAL — to each other, and to `listDefinitions().map(d => d.id)`. Three
 * copies of one fact is the shape this whole phase has been retiring, and the
 * ledger carried both of them as `phase`-fated rows: *"they describe a state that
 * ends when the migration does"*. The migration ended. A `phase` row whose phase
 * has arrived is a control that rots green — it goes on passing while the thing it
 * described stopped existing — so the rows are DELETED rather than re-fated.
 *
 * ⛔ WHAT THE TWO SETS GUARANTEED, AND WHAT REPLACES IT. `ENGINE_MIGRATED` said
 * "the engine is the authority for this definition" and `ENGINE_FLIPPED` said "and
 * its hand-written render block is GONE"; the pair made the double-draw impossible
 * to reach by accident, because a definition in the second set without the first
 * meant an indicator drawn by NOBODY. Neither guarantee is expressible as a list
 * any more, because the thing they were lists OF is empty: `StockChart.jsx`
 * contains no hand-written indicator render block and imports zero `compute*`
 * functions, which `enumerationSites.test.js` asserts BEHAVIOURALLY (a
 * format-exact regex could not catch a re-added import with no caller). So the
 * successor guarantee is structural rather than enumerated: **a definition is
 * engine-drawn iff the registry knows it**, and the day somebody adds a
 * hand-written block back, the zero-`compute*`-imports rail is what fails.
 *
 * ⚠️ A `.has()` FACADE, NOT A `Set`. Every consumer asked `X.has(defId)`, and the
 * point of this change is that the answer now comes from the REGISTRY on each
 * call. Freezing a derived Set would re-create the copy — a snapshot taken at
 * import, which a late `registerDefinition` would silently contradict. It also
 * enumerates NOTHING on purpose: a caller that wants the ids has to ask
 * `listDefinitions()`, which is the authority, and a caller that wanted `.size`
 * wanted `engineDrawsAnything()`.
 *
 * ⭐ AND `volumeProfile` IS EXCLUDED STRUCTURALLY RATHER THAN BY OMISSION. It was
 * absent from both literals because nobody typed it; it is absent from this
 * because it has no definition — it is a settings key with no compute, no plots
 * and no inputs, and `validateDefinition` never saw it. The two look identical
 * from the outside and only one of them survives somebody adding a fifteenth
 * indicator.
 */
export function engineOwnsDefId(defId) {
  return typeof defId === 'string' && !!getDefinition(defId)
}

/**
 * The reader every former flip-set consumer takes — `has`, `size` and iteration,
 * every one of them ANSWERED BY THE REGISTRY AT THE MOMENT IT IS ASKED.
 *
 * ⛔ NOT A `Set`, AND THAT IS THE POINT. A derived `new Set(listDefinitions()…)`
 * is a COPY taken at import time: it reads exactly like this from every call site
 * and silently contradicts the registry the moment a definition is registered
 * after this module loads. The two shapes are indistinguishable in a green test
 * suite, which is how the branch got two fourteen-id literals in the first place.
 * `size` and `[Symbol.iterator]` are getters over `listDefinitions()`.
 */
export const ENGINE_OWNED = Object.freeze({
  has: engineOwnsDefId,
  get size() { return listDefinitions().length },
  [Symbol.iterator]() {
    return listDefinitions().map((d) => d && d.id)[Symbol.iterator]()
  },
})

/** Is the engine drawing ANYTHING — the successor to `ENGINE_FLIPPED_DEF_IDS.size
 *  > 0`, which StockChart reads to decide whether to run the binder at all. A
 *  registry with no definitions is not a state this app can reach; the call is
 *  kept because "the engine is active" is a question with an answer, and a
 *  constant `true` written inline is a claim nobody can find later. */
export function engineDrawsAnything() {
  return listDefinitions().length > 0
}

/**
 * The migrated definitions this settings blob hands to the engine.
 *
 * "Hands to the engine", not "paints this frame": a HIDDEN instance is still the
 * engine's, because the legacy block stays stood down for it and re-showing it
 * draws from the instance. A control asking "am I still connected to anything?"
 * wants that answer, not the paint one.
 *
 * Normalised, not read raw — an instance the validator drops (a tombstone, an
 * undeclared input, an unknown definition) owns nothing and is drawn by nobody,
 * so a control that greyed itself out for one would be lying in the other
 * direction. Same rule, same function, as the render pass.
 *
 * @param {object} cs        merged chart settings
 * @param {object} registry  the engine registry (`getDefinition`/`listDefinitions`)
 * @returns {Set<string>} frozen-empty when the engine is off or holds nothing
 */
export function engineDrawnDefIds(cs, registry) {
  const byId = engineDrawnInputs(cs, registry)
  return byId.size ? new Set(byId.keys()) : EMPTY
}

/**
 * …and WHAT each of them is drawing with.
 *
 * The second question the toolbar has to ask. Greying a control out was only
 * half the honesty fix: the greyed box still showed `cs.indicators.rsi.period`,
 * so a user on an `?instances=` chart could read a disabled **14** in the
 * settings panel while the legend printed **RSI(7)** in a colour the panel's
 * swatch did not show. Two numbers for one line, and the tooltip explaining that
 * the field is not the authority sat right next to the value that is not the
 * authority either.
 *
 * Same walk, same normalisation, same migrated-id filter as `engineDrawnDefIds`
 * — derived from this one so the two can never disagree about which definitions
 * the engine holds.
 *
 * **FIRST instance of a definition wins.** More than one instance of the same
 * definition is legal (that is the point of the engine), but a settings row is
 * per-DEFINITION and can only show one. First-in-list is the binder's own draw
 * order, so the row shows the first line the user sees. When B4 gives instances
 * their own rows this function stops being needed; until then it is strictly
 * better than showing a value nothing renders.
 *
 * @returns {Map<string, object>} defId → that instance's normalised `inputs`.
 *          Empty map when the engine is off or holds nothing.
 */
export function engineDrawnInputs(cs, registry) {
  // ⭐ B5 Task 4. The flag is DELETED, not flipped (docs/decisions/2026-08-04-
  // engine-enabled-deleted.md). It was read from the STORED BLOB, so it was false
  // for every user alive and flipping the default could not have healed one; and
  // its only remaining job was to distinguish migrated-but-un-flipped from
  // flipped, a state B5 never creates because it flips in the same commit it
  // migrates. A guard on a key that no longer exists is a guard that reads as
  // live logic, which is why it is gone rather than left `?? true`.
  //
  // 🔑 WHAT THE GUARD ACTUALLY COST, since it is the only one whose deletion a
  // user could have SEEN: this function returned EMPTY on a flag-off chart, so
  // `ChartToolbar` fell back to the legacy MIRROR — and the flag was off for
  // EVERYONE, so the fallback was the shipped path rather than the edge case. It
  // is now unconditional: the panel shows what the engine is drawing with.
  if (!cs) return EMPTY_INPUTS
  const raw = cs.indicatorInstances
  if (!Array.isArray(raw) || raw.length === 0) return EMPTY_INPUTS
  const out = new Map()
  for (const inst of normalizeInstances(raw, registry).kept) {
    // ⭐ B5 TASK 13: a REGISTRY lookup, where a hand-written set stood. It is
    // belt-and-braces either way -- `normalizeInstances` already drops an
    // instance whose defId the registry does not know -- and it stays because
    // the two answers are the same answer now and this is where a reader looks
    // for it.
    if (!engineOwnsDefId(inst.defId)) continue
    if (out.has(inst.defId)) continue
    out.set(inst.defId, inst.inputs || {})
  }
  return out.size ? out : EMPTY_INPUTS
}
