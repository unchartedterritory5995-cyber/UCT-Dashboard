// app/src/content/rs/teaching.js
//
// THE ONE AUTHORED SOURCE FOR THE RS TEACHING CONTENT (Phase 4, unit 4-02).
//
// The glossary, the misconceptions, the five first-add tour cards and the readout
// cards are written once and read by both lanes (the words themselves sit in
// `teachingData.js`, engine-free, and are re-exported here; unit 4-06):
//   - the web app imports this module (the tour, the chip; the public glossary
//     page reads `teachingData.js` directly, so it never loads the engine);
//   - Python reads `api/data/rs_teaching.json`, which `tools/export_rs_teaching.mjs`
//     writes from `buildTeachingExport()` below.
//
// ⛔ PYTHON NEVER READS `app/src`. `api/data` ships in the web image; `app/src` is
// not a runtime input. That is the whole reason the JSON exists. The vitest rail
// (`teaching.export.test.js`) regenerates the export in memory and diffs it with
// the committed file, so editing anything here without re-exporting goes red.
//
// ⛔ THE READOUT CARDS ARE NOT RETYPED. `CARD_KEYS` and `CARDS` are read from the
// `rsLine` definition's `readout` (every row that carries a `card`), so the
// definition stays the one authority for the card copy and a rewrite of the cards
// flows here on the next export. Nothing in this file names a card.
//
// ⭐ U9 (RS split, 2026-11-09): THE SLIM UCT RS LINE'S READOUT, UNDER BOTH BUILD
// FLAGS. `nativeRegistry.js` registers one of two `rsLine` definitions by
// `VITE_RS_SPLIT_ENABLED` (map §(a) U7); the export must not depend on which one a
// build registered, or the committed JSON goes stale on the flag flip and Python
// (Compass, `rs_read_tools.explain_term`) would teach a Reading the chart no
// longer draws. So the cards are read from `RS_LINE_SLIM_RAW`, the definition that
// survives U10: the benchmark, the rating, the line against its average, the RS
// high, the gold dot, the red-day dot and the four checks. V5's extra cards
// (Mansfield, Rotation, Quality, VARS, Agreement, Regime, the fast rating and the
// rating Reading) describe readings that leave the chart with the split and are not
// member teaching copy any more; the terms live on in the glossary.
//
// Voice (plan v4 §3): declarative, present tense, no exclamation marks, no emoji,
// no "buy" or "sell", no "guarantee", none of the banned phrases. RS is the stock
// against the market. RSI is a different measure and appears only to say so.
//
// Evidence rule (D8): nothing tagged [S] or [U] in `03-evidence.md` is member copy.
// So the tour drops IBD's "87" (no published sample), the glossary drops the
// "3 to 5 points of MarketSurge" figure (v4 §18) and the clockwise-rotation claim,
// and "RS new high before price" carries IBD's own words, not a hit rate.

import { RS_LINE_SLIM_RAW } from '../../components/chart/engine/nativeRegistry.js'
// The words (tagline, glossary, misconceptions, tour) are authored in
// `teachingData.js`, which imports nothing, so the public glossary page can read
// them without the chart engine. Re-exported below unchanged.
import { GLOSSARY, MISCONCEPTIONS, TAGLINE, TOUR } from './teachingData.js'

/** Bump when the export's SHAPE changes (not when copy changes). */
export const TEACHING_VERSION = 1

/** The definition whose readout cards this module exports. */
export const RS_DEF_ID = 'rsLine'

export { GLOSSARY, MISCONCEPTIONS, TAGLINE, TOUR }

// ─── the readout cards, read from the definition (never retyped) ────────────────

/** The card fields the export carries; `null` when the definition omits one. */
export const CARD_FIELDS = Object.freeze(['label', 'what', 'origin', 'evidence'])

/**
 * Every readout row that carries a `card`, as `{key: {label, what, origin, evidence}}`,
 * in the definition's reading order. Generic: no card is named here.
 * @param {object[]} readout a definition's `readout` array
 */
export function cardsFromReadout(readout) {
  const out = {}
  for (const row of readout || []) {
    if (!row || !row.card || typeof row.card !== 'object') continue
    if (Object.prototype.hasOwnProperty.call(out, row.key)) {
      throw new Error(`teaching: readout card key "${row.key}" appears twice`)
    }
    out[row.key] = {
      label: row.label ?? null,
      what: row.card.what ?? null,
      origin: row.card.origin ?? null,
      evidence: row.card.evidence ?? null,
    }
  }
  return out
}

/** The slim UCT RS Line's readout (U9: the same rows whichever `rsLine` the build registered). */
export function rsTeachingReadout() {
  const def = RS_LINE_SLIM_RAW
  if (!def || def.id !== RS_DEF_ID || !Array.isArray(def.readout)) {
    throw new Error(`teaching: definition "${RS_DEF_ID}" has no readout`)
  }
  return def.readout
}
const rsReadout = rsTeachingReadout

export const CARDS = Object.freeze(cardsFromReadout(rsReadout()))
export const CARD_KEYS = Object.freeze(Object.keys(CARDS))

// ─── the export (one shape for `api/data/rs_teaching.json`) ─────────────────────

/** The export as a plain object: `{version, glossary, misconceptions, tour, cards}`. */
export function buildTeachingExport() {
  return {
    version: TEACHING_VERSION,
    glossary: GLOSSARY.map((t) => ({ ...t })),
    misconceptions: MISCONCEPTIONS.map((m) => ({ ...m })),
    tour: TOUR.map((c) => ({ ...c })),
    cards: Object.fromEntries(CARD_KEYS.map((k) => [k, { ...CARDS[k] }])),
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k])
    return out
  }
  return value
}

/** Deterministic text: keys sorted at every level, two-space indent, LF, one trailing newline. */
export function serializeTeachingExport(obj = buildTeachingExport()) {
  return `${JSON.stringify(sortKeys(obj), null, 2)}\n`
}
