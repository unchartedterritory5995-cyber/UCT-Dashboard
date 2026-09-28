// A8 — the frontend's reader of the ONE News & Catalyst vocabulary authority
// (TERM-075 / FB-A8-01).
//
// ⛔ THIS FILE HOLDS NO VOCABULARY. It reads `a8Taxonomy.json`, the same bytes
// `api/services/a8_taxonomy.py` reads, so the tile's chips and the engine's tags
// cannot drift. `a8Taxonomy.rail.test.js` fails BY NAME on a restated copy in
// app/src.
//
// A table that belongs to its component (a chip class, a card style) but is keyed
// by a vocabulary passes through `keyedBy`, which throws on a key set that is not
// exactly the vocabulary and otherwise returns the table unchanged.
import DOC from './a8Taxonomy.json'

/** The order the engine's `assign_tag()` tests the tags in. */
export const CATALYST_TAG_PRECEDENCE = Object.freeze([...DOC.catalyst_tags.precedence])

/** The order the tile renders its chips in. */
export const CATALYST_TAG_DISPLAY_ORDER = Object.freeze([...DOC.catalyst_tags.display_order])

/** Membership — the closed set. */
export const CATALYST_TAGS = Object.freeze([...CATALYST_TAG_PRECEDENCE])

/** Named members: `CATALYST_TAG.CATALYST === 'Catalyst'`. Derived, never typed. */
export const CATALYST_TAG = Object.freeze(
  Object.fromEntries(CATALYST_TAG_PRECEDENCE.map((t) => [t.toUpperCase(), t])),
)

/** The Catalyst Hunter's closed catalyst_type set. */
export const HUNTER_CATALYST_TYPES = Object.freeze([...DOC.hunter_catalyst_types.members])

/** Every vocabulary the rail polices, by name. */
export const VOCABULARIES = Object.freeze({
  catalyst_tags: CATALYST_TAGS,
  hunter_catalyst_types: HUNTER_CATALYST_TYPES,
})

/**
 * Return `table` unchanged after proving its keys are EXACTLY `vocabulary`.
 * Throws at module load on a missing or extra key, naming both.
 */
export function keyedBy(vocabulary, table) {
  const want = new Set(vocabulary)
  const have = new Set(Object.keys(table))
  const missing = [...want].filter((k) => !have.has(k)).sort()
  const extra = [...have].filter((k) => !want.has(k)).sort()
  if (missing.length || extra.length) {
    throw new Error(
      `keyedBy: table keys differ from the A8 vocabulary — missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`,
    )
  }
  return table
}
