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
  // "the other chart": read by deixis's exported saysOtherChart (round 6), never a copy
  it.each(AMBIGUOUS.slice(1))('%s (clicked %s)', (q, clicked) => { expect(ask(q, clicked)).toMatch(/which/i) })
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

// AUDIT T1b (2026-11-07): "the other chart" / "a different chart" — read by deixis's exported saysOtherChart, never a copy.
// Exactly ONE other chart → that chart; several → asked; NEVER the click.
import { saysOtherChart } from './deixis'
describe('T1b: the other chart, a different chart', () => {
  const TWO = [FOUR[0], FOUR[1]]   // top-left SPY, top-right QQQ
  const askOn = (q, charts, clicked) => {
    const show = getCapability('guide.show')
    const a = show.fast({ raw: q, host: { surface: 'charts' } })
    return show.answer(null, { feature: a.feature, detail: a.detail ?? null }, { surface: 'charts', charts: { list: () => charts, selected: () => clicked } })
  }
  it.each([
    ['how do I add RSI to the other chart', TWO, 'tl', 'tr'],
    ['how do I add RSI to a different chart', TWO, 'tl', 'tr'],
    ['how do I change the timeframe on not this chart but the other one', TWO, 'tl', 'tr'],
  ])('%s (two charts, clicked %s) → the one other chart', (q, charts, clicked, want) => {
    const said = askOn(q, charts, clicked)
    expect(said).toContain(FOUR.find(c => c.ref === want).label)
    expect(said).not.toMatch(/Which/)
  })
  it.each([
    ['how do I change the timeframe on the other chart', 'bl'],
    ['how do I add RSI to a different chart', 'tl'],
  ])('%s (four charts, clicked %s) → asked, never the click', (q, clicked) => {
    const said = askOn(q, FOUR, clicked)
    expect(said).toMatch(/Which/)
    expect(said).not.toContain(label(clicked) + ' —')
    for (const c of FOUR.filter(x => x.ref !== clicked)) expect(said).toContain(c.label)
  })
  // T2 for these words: deixis's reading decides; the guide agrees and never returns the click
  it.each([
    ['how do I add RSI to the other chart', 2, 'tl'], ['how do I add RSI to a different chart', 2, 'tr'],
    ['how do I change the timeframe on the other chart', 4, 'bl'], ['how do I add RSI to another chart', 4, 'br'],
  ])('agreement: %s (%i charts, clicked %s)', (q, n, clicked) => {
    const charts = n === 2 ? TWO : FOUR
    expect(saysOtherChart(q)).toBe(true)
    const guide = namedChart(q, charts, clicked)
    expect(guide?.chart?.ref ?? null).not.toBe(clicked)
    if (charts.length === 2) expect(guide?.chart?.ref).toBe(charts.find(c => c.ref !== clicked).ref)
    else { expect(guide?.chart ?? null).toBeNull(); expect(guide?.say).toMatch(/Which/) }
  })
})

// AUDIT T1c (2026-11-07): a bare "another one" is another drawing / indicator / alert on the chart already meant, never a chart.
// "another one" / "the other one" / "one other" name a chart only beside a chart word in the same clause.
describe('T1c: "another one" is not "another chart"', () => {
  const TWO = [FOUR[0], FOUR[1]]
  const board2 = (clicked) => ({ surface: 'charts', charts: { list: () => TWO, selected: () => clicked } })
  const said2 = (q, clicked) => { const show = getCapability('guide.show'); const a = show.fast({ raw: q, host: { surface: 'charts' } }); return a ? show.answer(null, { feature: a.feature, detail: a.detail ?? null }, board2(clicked)) : null }
  it.each([
    'how do I draw another one', 'how do I add another one', 'show me another one',
    'add another moving average to this chart', 'put another RSI on this one', 'add another indicator',
  ])('%s: the click stands (no other chart named)', (q) => {
    expect(saysOtherChart(q)).toBe(false)
    expect(namedChart(q, TWO, 'tl')?.chart?.ref ?? null).not.toBe('tr')
  })
  it.each(['how do I draw another one', 'how do I add another one'])('%s walks on the clicked chart (TWO, left clicked)', (q) => {
    const said = said2(q, 'tl')
    if (said && /highlighted|can’t see/.test(said)) { expect(said).not.toContain(FOUR[1].label) }
  })
  it.each([
    ['how do I add RSI to another chart', true], ['how do I add RSI to a different chart', true], ['how do I add RSI to some other chart', true],
    ['how do I add RSI to another one of my charts', true], ['how do I add RSI to the other chart', true],
  ])('%s still names a chart that is not the click', (q, yes) => { expect(saysOtherChart(q)).toBe(yes) })
  // T2: the same phrasings through deixis's reading and the guide agree — the click stands
  it.each(['how do I draw another one', 'how do I add another one', 'show me another one'])('agreement: %s', (q) => {
    const exec = [...chartsNamedBy(q, TWO, 'tl')]
    const guide = namedChart(q, TWO, 'tl')
    expect(exec).toEqual([])
    expect(guide?.chart ?? null).toBeNull()
  })
})

// AUDIT T1d / T1e (2026-11-07): the guide matches execution's OTHER_CHART. A chart word that is the click itself ("this chart")
// never makes "another one" a chart; the DEFINITE "the other one" is the other chart, as execution reads it.
describe('T1d / T1e: "this chart" is the click; "the other one" is the other chart', () => {
  const TWO = [FOUR[0], FOUR[1]]
  it.each([
    ['how do I draw another one on this chart', null],                // T1d: the click stands
    ['how do I add RSI to the other one', 'tr'],                      // T1e: the other chart, as execution reads it
    ['how do I change the timeframe on the other one', 'tr'],         // T1e
    ['how do I add RSI to another one of my charts', 'tr'],           // plural chart word: still a chart
  ])('%s (TWO, clicked tl) → %s', (q, want) => {
    const guide = namedChart(q, TWO, 'tl')
    expect(guide?.chart?.ref ?? null).toBe(want)
  })
  it('a definite "the other one" that stands for a named thing is not a chart', () => {
    expect(saysOtherChart('I drew two lines, how do I delete the other one')).toBe(false)
  })
  // T2: execution's own reading of the definite "the other one" (OTHER_CHART, via saysOtherChart) and the guide agree
  it.each(['how do I add RSI to the other one', 'how do I change the timeframe on the other one'])('agreement: %s', (q) => {
    expect(saysOtherChart(q)).toBe(true)
    expect(namedChart(q, TWO, 'tl')?.chart?.ref).toBe('tr')
  })
  it('agreement: draw another one on this chart — execution names the click only, the guide picks no other chart', () => {
    const exec = [...chartsNamedBy('how do I draw another one on this chart', TWO, 'tl')]
    expect(exec.filter(r => r !== 'tl')).toEqual([])
    expect(namedChart('how do I draw another one on this chart', TWO, 'tl')?.chart ?? null).toBeNull()
  })
})

// AUDIT T1f (2026-11-07): after a preposition, "the other one" is the LOCATION — the other chart, whatever object the sentence
// names. Only as the verb's object, with a thing of that kind named BEFORE it, does "one" stand for that thing.
describe('T1f: "on / to the other one" is the other chart', () => {
  const TWO = [FOUR[0], FOUR[1]]
  const ROWS = [
    'how do I add an indicator to the other one',
    'how do I change the colors on the other one',
    'how do I draw a trendline on the other one',
    'how do I set an alert on the other one',
  ]
  it.each(ROWS)('%s (TWO, clicked tl) → the other chart', (q) => {
    expect(namedChart(q, TWO, 'tl')?.chart?.ref).toBe('tr')
  })
  // T2: execution's reading (OTHER_CHART, the definite "the other one") and the guide agree
  it.each(ROWS)('agreement with execution: %s', (q) => {
    expect(saysOtherChart(q)).toBe(true)
    expect(namedChart(q, TWO, 'tl')?.chart?.ref).toBe(TWO.find(c => c.ref !== 'tl').ref)
  })
  // the object exception (not guide requests today: namedChart unit tests)
  it.each([
    'I drew two lines, how do I delete the other one',
    'I have two alerts, edit the other one',
  ])('%s: "one" is that thing, not a chart (the click stands)', (q) => {
    expect(saysOtherChart(q)).toBe(false)
    expect(namedChart(q, TWO, 'tl')?.chart ?? null).toBeNull()
  })
})
