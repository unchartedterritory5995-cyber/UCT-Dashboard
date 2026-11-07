// AUDIT T1 / T2 (2026-11-07, teach-gen-1 @ e8c124d5c0): a walkthrough must ring the chart a RELATIVE or NEGATED reference
// means, never the clicked one. guide/namedChart.js reads names, positions, timeframes and ordinals, but returns null for
// "the chart below this one" or "every chart except this one", so the click stood.
//
// ✅ 2026-11-07: merged agent/pl/target-plus-multichart @ 30d1633b23; namedChart.js calls its exported relativeChart / negatedPointer.
// (Was PENDING.) The fix reuses deixis.js's relation/negation detector, which lives on agent/pl/target-plus-multichart
// (pl-exec). These tests are written NOW, in the guide's own phrasings, and skipped until that head is merged: then
// namedChart.js calls the exported detector and every `it.skip` here becomes `it`. Do not write a third detector to turn them.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { _resetGuide } from './guide/guideStore'
import { namedChart } from './guide/namedChart'
import { chartsNamedBy, relativeChart, negatedPointer } from './deixis'

beforeAll(() => { registerBuiltins() })
afterEach(() => { _resetGuide() })

const chart = (ref, symbol, position, x, y) => ({ ref, symbol, position, tf: 'D', label: `${position} chart (${symbol})`, cell: { x, y, w: 1, h: 1 } })
// a 2x2 board: SPY top-left, QQQ top-right, NVDA bottom-left, TSLA bottom-right
const FOUR = [chart('tl', 'SPY', 'top-left', 0, 0), chart('tr', 'QQQ', 'top-right', 1, 0), chart('bl', 'NVDA', 'bottom-left', 0, 1), chart('br', 'TSLA', 'bottom-right', 1, 1)]
const boardClicked = (ref) => ({ surface: 'charts', charts: { list: () => FOUR, selected: () => ref } })
const ask = (q, clicked) => {
  const show = getCapability('guide.show')
  const a = show.fast({ raw: q, host: { surface: 'charts' } })   // the panel's fast path may not see the board
  return show.answer(null, { feature: a.feature, detail: a.detail ?? null }, boardClicked(clicked))
}
const label = (ref) => FOUR.find(c => c.ref === ref).label
// the answer is about this chart and no other (highlighted on it, or "can't see" on it in jsdom)
const onlyAbout = (said, ref) => { expect(said).toContain(label(ref)); for (const c of FOUR.filter(x => x.ref !== ref)) expect(said).not.toContain(c.label) }

// relation → the neighbour of the clicked chart
export const RELATION = [
  ['how do I add RSI to the chart below this one', 'tl', 'bl'],
  ['how do I change the timeframe on the chart under this', 'tr', 'br'],
  ['how do I add RSI to the chart above this one', 'bl', 'tl'],
  ['show me how to change the timeframe on the one next to this', 'tl', 'tr'],
  ['how do I draw a trendline on the chart to the left of this one', 'br', 'bl'],
  ['how do I add a moving average to the stock beside this one', 'bl', 'br'],
]
// negation → never the clicked chart (several charts remain: asked or said, never walked on the click)
export const NEGATION = [
  ['how do I add RSI to every chart except this one', 'tl'],
  ['how do I change the timeframe on the charts other than this', 'br'],
  ['how do I hide volume on all but this chart', 'tr'],
]
// ambiguous → a question
export const AMBIGUOUS = [
  ['how do I add RSI to the chart next to this one', 'tl', 'diagonal-free 2x2: right or below is not said'],   // TL has a right AND a below neighbour; "next to" is horizontal by AUDIT's reading: see note
  ['how do I change the timeframe on the other chart', 'bl', 'three others'],
]
// bare "this" → the click
export const BARE_THIS = [
  ['how do I add RSI to this chart', 'tr'],
  ['how do I change the timeframe here', 'bl'],
]

describe('guide: a relative reference rings the neighbour (PENDING the deixis detector)', () => {
  it.each(RELATION)('%s (clicked %s) → %s', (q, clicked, want) => { onlyAbout(ask(q, clicked), want) })
})
describe('guide: a negated reference never rings the clicked chart (PENDING)', () => {
  it.each(NEGATION)('%s (clicked %s)', (q, clicked) => {
    const said = ask(q, clicked)
    expect(said).not.toContain(label(clicked))
    expect(said).toMatch(/\?|which|one chart at a time|each/i)
  })
})
describe('guide: an unclear relation is asked about (PENDING)', () => {
  // PENDING: deixis reads "the other chart" (OTHER_CHART) but does not export it; namedChart will call it once exported, never copy it
  it.skip.each(AMBIGUOUS.slice(1))('%s (clicked %s) — PENDING deixis export of OTHER_CHART', (q, clicked) => { expect(ask(q, clicked)).toMatch(/which/i) })
})
describe('guide: a bare "this" stays the click (holds today)', () => {
  it.each(BARE_THIS)('%s (clicked %s)', (q, clicked) => { onlyAbout(ask(q, clicked), clicked) })
})

// AUDIT T2: after the merge, guide/namedChart.js and deixis.js are ONE authority over which chart the words mean. Same probe
// set through both; they must agree. PENDING: the shared detector's export name lands with target-plus-multichart.
describe('one authority: the guide and execution read the same chart from the same words', () => {
  // the shared probe set: the relational, negated and bare phrasings above, and names and positions both read
  const PROBES = [
    ...RELATION.map(([q, c]) => [q, c]), ...NEGATION, ...BARE_THIS,
    ['how do I change the timeframe on the top right chart', 'bl'], ['how do I add RSI to the QQQ chart', 'tl'], ['how do I add RSI to the bottom left chart', 'tr'],
  ]
  it.each(PROBES)('%s (clicked %s): the same chart, or none, from both', (q, clicked) => {
    const exec = [...chartsNamedBy(q, FOUR, clicked)]
    const guide = namedChart(q, FOUR, clicked)
    const negated = !!negatedPointer(q) || !!relativeChart(q, FOUR, clicked)?.negated
    if (exec.length === 1) expect(guide?.chart?.ref, 'execution names one chart: the guide must ring that one').toBe(exec[0])
    else if (negated) { expect(guide?.chart ?? null).toBeNull(); expect(guide?.say).toBeTruthy() }   // never the click, never a pick
    else expect(guide?.chart ?? null, 'execution names none: the guide picks none either').toBeNull()
  })
})
