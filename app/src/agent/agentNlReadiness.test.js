// NL READINESS (agent-lead, overnight architecture review 2026-11-02). Deterministic, no model, no cost.
//
// For a conversation to work, the planner must at least be SHOWN the capability group each turn needs. This
// measures that, turn by turn, for the legacy path (word routing, production today) and for NL-1's hybrid
// selection (fixed core + soft words, dark). It measures exposure only — whether the model then understands
// the request is the paid evaluation's question, not this file's.
//
// The phrasings are the owner's example conversation (intent examples, not phrases to hard-code) plus a
// small set of unfamiliar wordings written for this review. Nothing here is tuned to pass: the expectations
// that fail on the legacy path are recorded as measured gaps, not hidden.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { routeManifest, groupOfAction } from './routing'
import { selectNl1 } from './nl1/selection'

registerBuiltins()
const FULL = manifestFor({ surface: 'charts', createIndicator: true })
const OPTS = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }

const legacyGroups = (text) => {
  const r = routeManifest(FULL, text, OPTS)
  return r.routing ? r.routing.selected : [...new Set(FULL.map(c => groupOfAction(c.name)).filter(Boolean))]
}
const nl1Groups = (text) => selectNl1(FULL, { text }).selected

// [phrase, the group the request cannot be served without]
export const OWNER_CONVERSATION = [
  ['Find me some stocks that are looking really strong today.', 'screener'],
  ['Maybe ones with good volume that are still above their 20-day.', 'screener'],
  ['Actually, remove anything under $10.', 'screener'],
  ['Which ones are showing the strongest relative strength?', 'screener'],
  ['Why is NVDA moving today?', 'data'],
  ['Compare it with AMD.', 'data'],
  ['Put the strongest five on my watchlist.', 'lists'],
]
export const UNFAMILIAR = [
  ['anything ripping on huge volume rn', 'screener'],
  ['which names r breaking out of a base this week', 'screener'],
  ['cut it down to just the big caps', 'screener'],
  ['scrap the price filter', 'screener'],
  ['whats going on w tesla', 'data'],
  ['how did amd do on earnings', 'data'],
  ['is msft cheaper than googl on forward pe', 'data'],
  ['stick the top 3 in my momentum list', 'lists'],
  ['make a new list called overnight holds with those', 'lists'],
  ['ping me if nvda loses 120', 'alerts'],
  ['flip the chart to 15 min', 'charts'],
  ['throw a 50 day on it', 'indicators'],
  ['what does a cup and handle look like', null],
  ['explain relative volume like im new', null],
]

function measure(rows, pick) {
  return rows.map(([q, need]) => ({ q, need, shown: need === null ? true : pick(q).includes(need) }))
}

describe('NL readiness: is the planner shown what each turn needs?', () => {
  it('reports exposure for the owner conversation and an unfamiliar set (legacy vs NL-1)', () => {
    const table = []
    for (const [label, rows] of [['owner', OWNER_CONVERSATION], ['unfamiliar', UNFAMILIAR]]) {
      const legacy = measure(rows, legacyGroups)
      const nl1 = measure(rows, nl1Groups)
      rows.forEach(([q, need], i) => table.push({ set: label, q, need: need || '(answer)', legacy: legacy[i].shown, nl1: nl1[i].shown }))
    }
    console.log('\nNL READINESS (first-call exposure)\n' + table.map(r =>
      `${r.set.padEnd(10)} ${String(r.need).padEnd(10)} legacy=${r.legacy ? 'Y' : 'N'} nl1=${r.nl1 ? 'Y' : 'N'}  ${r.q}`).join('\n'))
    const count = (k, set) => table.filter(r => r.set === set && r[k]).length
    console.log(`owner: legacy ${count('legacy', 'owner')}/${OWNER_CONVERSATION.length}, nl1 ${count('nl1', 'owner')}/${OWNER_CONVERSATION.length}; ` +
      `unfamiliar: legacy ${count('legacy', 'unfamiliar')}/${UNFAMILIAR.length}, nl1 ${count('nl1', 'unfamiliar')}/${UNFAMILIAR.length}`)
    expect(table.length).toBe(OWNER_CONVERSATION.length + UNFAMILIAR.length)
  })

  it('NL-1 always carries the core groups whatever the words (the structural fix for word routing)', () => {
    for (const [q] of [...OWNER_CONVERSATION, ...UNFAMILIAR]) {
      const g = nl1Groups(q)
      for (const core of ['charts', 'indicators', 'screener']) expect(g, `${core} for "${q}"`).toContain(core)
    }
  })
})
