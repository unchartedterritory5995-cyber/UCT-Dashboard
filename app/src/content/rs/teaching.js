// app/src/content/rs/teaching.js
//
// THE ONE AUTHORED SOURCE FOR THE RS TEACHING CONTENT (Phase 4, unit 4-02).
//
// The glossary, the misconceptions, the five first-add tour cards and the readout
// cards are written here once and read by both lanes:
//   - the web app imports this module (the tour, the glossary page, the chip);
//   - Python reads `api/data/rs_teaching.json`, which `tools/export_rs_teaching.mjs`
//     writes from `buildTeachingExport()` below.
//
// ⛔ PYTHON NEVER READS `app/src`. `api/data` ships in the web image; `app/src` is
// not a runtime input. That is the whole reason the JSON exists. The vitest rail
// (`teaching.export.test.js`) regenerates the export in memory and diffs it with
// the committed file, so editing anything here without re-exporting goes red.
//
// ⛔ THE READOUT CARDS ARE NOT RETYPED. `CARD_KEYS` and `CARDS` are read from the
// registered `rsLine` definition's `readout` (every row that carries a `card`), so
// the definition stays the one authority for the card copy and a rewrite of the
// cards (v4: Rotation, Quality, VARS) flows here on the next export. Nothing in
// this file names a card.
//
// Voice (plan v4 §3): declarative, present tense, no exclamation marks, no emoji,
// no "buy" or "sell", no "guarantee", none of the banned phrases. RS is the stock
// against the market. RSI is a different measure and appears only to say so.
//
// Evidence rule (D8): nothing tagged [S] or [U] in `03-evidence.md` is member copy.
// So the tour drops IBD's "87" (no published sample), the glossary drops the
// "3 to 5 points of MarketSurge" figure (v4 §18) and the clockwise-rotation claim,
// and "RS new high before price" carries IBD's own words, not a hit rate.

import { getDefinition } from '../../components/chart/engine/nativeRegistry.js'

/** Bump when the export's SHAPE changes (not when copy changes). */
export const TEACHING_VERSION = 1

/** The definition whose readout cards this module exports. */
export const RS_DEF_ID = 'rsLine'

/** The tagline, unparaphrased. It appears exactly once: at the end of the last tour card. */
export const TAGLINE = 'Navigate the market, effectively.'

// ─── glossary: the 15 terms of 04 §c, in brand voice (v3 §18 wording, v4 §18 fix) ──
export const GLOSSARY = Object.freeze([
  { key: 'rsLine', term: 'RS line',
    definition: 'The stock\'s price divided by the benchmark\'s price, drawn as a line: up means the stock is beating the market, down means it is lagging. Only its direction and its own prior highs matter, not where it sits beside price.',
    aliases: ['relative strength line', 'price relative'] },
  { key: 'rsRating', term: 'RS Rating',
    definition: 'A 1 to 99 rank of the stock\'s price change over roughly the past year against every other stock in the universe; 90 means it beat 90% of them. Ours is IBD-style, and our measured difference is shown in the readout.',
    aliases: ['relative strength rating', 'IBD-style rating'] },
  { key: 'rsNewHigh', term: 'RS new high',
    definition: 'The RS line closes higher than at any point in its lookback. The stock is outperforming the market by the most it has in that window.',
    aliases: ['RS line new high', 'blue dot'] },
  { key: 'rsNewHighBeforePrice', term: 'RS new high before price',
    definition: 'The RS line makes a new high while price is still below its own high. IBD calls it more bullish, and not a precondition.',
    aliases: ['RS high before price', 'gold dot'] },
  { key: 'benchmark', term: 'Benchmark',
    definition: 'What the stock is compared against: the S&P 500, the equal-weight S&P 500, the Nasdaq 100, the Russell 2000, or the stock\'s sector or industry group. Change it and the question changes.' },
  { key: 'mansfieldRs', term: 'Mansfield RS',
    definition: 'Weinstein\'s version: the RS ratio measured against its own long average (52 weeks on his weekly charts), so it swings around zero. Above zero and rising means the stock is outperforming its own trend against the benchmark.',
    aliases: ['Mansfield relative strength'] },
  { key: 'rotationQuadrant', term: 'Rotation quadrant',
    definition: 'Leading (strong and gaining), Weakening (strong but fading), Lagging (weak and fading) or Improving (weak but gaining), read from the trend of the RS ratio and that trend\'s momentum. A map, not a system.',
    aliases: ['RRG quadrant'] },
  { key: 'momentum', term: 'Momentum',
    definition: 'How fast a price, or an RS line, is moving. In academic research it is also the name for relative strength itself.' },
  { key: 'relativeWeakness', term: 'Relative weakness',
    definition: 'The stock is losing ground to the market, even while its price rises. On the chart, the RS line falls.' },
  { key: 'leaderLaggard', term: 'Leader and laggard',
    definition: 'A leader beats the market and its group; a laggard trails them.',
    aliases: ['leader', 'laggard', 'leadership'] },
  { key: 'defensiveRs', term: 'Defensive RS',
    definition: 'RS that rises only because the stock fell less than a falling market. It can fade when the market recovers.' },
  { key: 'lookback', term: 'Lookback',
    definition: 'The window used for a rating or a new high, such as 52 weeks or 3 months. A shorter window reacts faster and flips more often.' },
  { key: 'percentileRank', term: 'Percentile rank',
    definition: 'Where a value sits in its group, read as "beat X% of the group". An RS Rating of 80 beat 80% of the names rated.' },
  { key: 'divergence', term: 'Divergence',
    definition: 'Price and the RS line disagree. Price at a new high without the RS line is a warning; the RS line rising while price falls is hidden strength.' },
  { key: 'rotation', term: 'Rotation',
    definition: 'Money moving from one group of stocks to another. The RS lines of the new group turn up while the old group\'s turn down.',
    aliases: ['sector rotation'] },
].map((t) => Object.freeze(t)))

// ─── misconceptions: the 8 of 04 §e, each with its one-line correction ──────────
export const MISCONCEPTIONS = Object.freeze([
  { key: 'rsIsNotRsi', myth: 'RS is RSI.',
    truth: 'They are different things. RS compares a stock with the market and has no fixed bounds; RSI measures only the stock\'s own recent momentum on a 0 to 100 scale.' },
  { key: 'risingMeansUp', myth: 'A rising RS line means the price is going up.',
    truth: 'It means the stock is doing better than the market; both can be falling.' },
  { key: 'fallingMeansDown', myth: 'A falling RS line means the stock is going down.',
    truth: 'The stock can be rising while the market rises faster.' },
  { key: 'fellLessIsLeader', myth: 'RS rose while the market fell, so the stock is a leader.',
    truth: 'It may only have fallen less. Defensive names often give that back when growth returns.' },
  { key: 'rating99IsTiming', myth: 'An RS Rating of 99 means now is the time to get in.',
    truth: 'RS is a filter, not a timing signal; a 99 after a near-vertical run is often extended.' },
  { key: 'anyBenchmark', myth: 'Any benchmark will do.',
    truth: 'A small-cap read against the S&P 500, or a stock against the wrong sector, misleads. Say what you compare against.' },
  { key: 'rsExcusesChart', myth: 'Good RS excuses a bad chart.',
    truth: 'RS is one read, not the whole chart. A strong RS line does not repair a broken base, and a neat base with a falling RS line is a warning.' },
  { key: 'highRsLowRisk', myth: 'High RS means low risk.',
    truth: 'It means outperforming, not protected. In a falling market a leader can simply fall less.' },
].map((m) => Object.freeze(m)))

// ─── tour: five cards, shown on the first add of UCT RS (D12, v4 §6.11) ─────────
// Card 3 has no "87" (no published sample, v4 §1.7). Card 4 is v4 §6.11 verbatim,
// its forward claim removed. Card 5 ends with the tagline, once.
export const TOUR = Object.freeze([
  { title: 'Beating the market, or just riding it?',
    body: 'RS compares your stock with the S&P 500. A stock can go up and still lose the race.' },
  { title: 'Read the slope, not the level',
    body: 'The RS line rises when the stock outperforms and falls when it lags. Where it sits beside price means nothing; it is not a moving average.' },
  { title: 'Watch for RS new highs',
    body: 'When the line tops its old high before price does, the stock is leading before the chart shows it.' },
  { title: 'Strong on a weak day',
    body: 'Stocks that close green while the market sells off are showing demand you can see.' },
  { title: 'RS says where to look, not when to act',
    body: `Combine it with a base, volume and your own stop. High RS after a long run can mean the stock is extended, not safe. ${TAGLINE}` },
].map((c) => Object.freeze(c)))

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

function rsReadout() {
  const def = getDefinition(RS_DEF_ID)
  if (!def || !Array.isArray(def.readout)) {
    throw new Error(`teaching: definition "${RS_DEF_ID}" has no readout`)
  }
  return def.readout
}

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
