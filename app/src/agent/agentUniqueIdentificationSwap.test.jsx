// ⛔ H14 · AUDIT held-out probe 52a (2026-11-15): on the SOLE chart, an ordinary swap form ("swap SPY for AAPL", "put AAPL where SPY
// is", "make SPY into AAPL", "SPY to AAPL", "take SPY off and put AAPL on") re-symbols the chart — the shown ticker is the OBJECT OF
// A CHANGE, never one the member asked to SEE. A shown ticker counts as asked-to-see only when a see verb GOVERNS it ("show / open /
// pull up / see SPY and AAPL" keeps SPY: 52b). STRUCTURAL (chartRail tickerAskedToSee / tickerChanged), generated over classes:
//   RELATION  relation word (for / where / into / to / off / replace / instead / in place of) × ticker order × casing → licensed
//   NEUTRAL   a shown ticker mentioned with no see verb ("SPY is boring, AAPL please") → licensed (a see verb is REQUIRED)
//   SEE       see verb × coordination × order → the final board keeps both: a plan dropping SPY is refused
//   SEVERAL   with two charts the identification rules are unchanged (the named chart, else ask)
//   DOTTED    a dotted ticker (BRK.B) is matched literally — its "." is never a wildcard
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal, tickerAskedToSee, tickerChanged } from './chartRail'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const settings = () => ({ settings: mergeChartSettings(null) })
const boardOf = (syms) => makeBoard(syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * Math.floor(24 / syms.length), y: 0, w: Math.floor(24 / syms.length), h: 20, color: 'N', opts: settings() })),
  Object.fromEntries(syms.map((s, i) => [`N:c${i + 1}`, s])))
const resym = (b, ref, to) => planOps(collectTargets(b.host, ['chart']), [{ action: 'chart.setSymbol', target: ref, args: { symbol: to } }], {}, { surface: 'charts' })
const rail = (syms, ref, to, words) => {
  const b = boardOf(syms)
  const p = resym(b, ref, to)
  expect(p.ok).toBe(true)
  return chartRailRefusal(p, { words, host: b.host, mode: 'apply' })
}
const CASES = { upper: (s) => s.toUpperCase(), lower: (s) => s.toLowerCase(), mixed: (s) => s[0] + s.slice(1).toLowerCase() }
const fill = (tpl, X, Y) => tpl.replace(/\{X\}/g, X).replace(/\{Y\}/g, Y)
const PAIRS = [['SPY', 'AAPL'], ['QQQ', 'NVDA'], ['IWM', 'AMD']]

// ── RELATION: the shown ticker (X) is the object of a change relation — each relation word, in both ticker orders ──
const RELATION = {
  for: ['swap {X} for {Y}', 'trade {X} for {Y}', 'swap in {Y} for {X}', 'exchange {X} for {Y} please'],
  where: ['put {Y} where {X} is', 'where {X} is, put {Y}', 'show {Y} where {X} is', 'open {Y} where {X} was'],
  into: ['make {X} into {Y}', 'turn {X} into {Y}', 'convert {X} into {Y}', 'can you make {X} into {Y}'],
  to: ['{X} to {Y}', '{X} chart to {Y}', 'flip {X} to {Y}', 'show {X} changed to {Y}', 'see {X} switched to {Y}'],
  off: ['take {X} off and put {Y} on', '{X} off and {Y} on', '{Y} on, {X} off', 'pull {X} off and show {Y}'],
  replace: ['replace {X} with {Y}', '{Y} replacing {X}', 'show {Y}, replacing {X}', 'swap out {X} for {Y}'],
  instead: ['show {Y} instead of {X}', '{Y} instead of {X}', 'open {Y} in place of {X}', 'pull up {Y} rather than {X}', 'see {Y} over {X}'],
}
const REL_CASES = []
for (const [rel, forms] of Object.entries(RELATION)) for (const tpl of forms) for (const [cname, cs] of Object.entries(CASES)) for (const [X, Y] of PAIRS.slice(0, 2)) {
  REL_CASES.push([rel, cname, fill(tpl, cs(X), cs(Y)), X, Y])
}
describe(`RELATION · on the sole chart a change relation licenses the re-symbol (${REL_CASES.length} cases): relation × order × casing`, () => {
  it.each(REL_CASES)('%s · %s · "%s"', (_rel, _c, words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toBeNull()
  })
})

// ── NEUTRAL: a shown ticker mentioned with no see verb governing it is not asked to see (the see verb is REQUIRED) ──
const NEUTRAL = ['{X} is boring, {Y} please', 'done with {X}, {Y} now', 'enough {X} — {Y}', '{X} bores me; {Y}', '{X} looks weak, {Y} now']
const NEU_CASES = NEUTRAL.flatMap(tpl => PAIRS.map(([X, Y]) => [fill(tpl, X, Y), X, Y]))
describe(`NEUTRAL · a shown ticker with no see verb is not asked to see (${NEU_CASES.length} cases)`, () => {
  it.each(NEU_CASES)('"%s" → the sole chart switches', (words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toBeNull()
  })
})

// ── SEE: a see verb governing the shown ticker, coordinated with the new one → both must stay on the board ──
const SEE_VERBS = ['show', 'show me', 'open', 'pull up', 'bring up', 'see', 'view', 'display', 'can I see', 'please open']
const COORD = ['{A} and {B}', '{A} & {B}', '{A}, {B}', '{A} plus {B}', 'both {A} and {B}', '{A} and also {B}', '${A} and ${B}']
const SEE_CASES = []
for (const verb of SEE_VERBS) for (const co of COORD) for (const order of ['shown first', 'new first']) for (const [X, Y] of PAIRS.slice(0, 2)) {
  const [A, B] = order === 'shown first' ? [X, Y] : [Y, X]
  SEE_CASES.push([verb, order, `${verb} ${co.replace(/\{A\}/g, A).replace(/\{B\}/g, B)}`, X, Y])
}
describe(`SEE · a see verb governs the shown ticker → a plan dropping it is refused (${SEE_CASES.length} cases): verb × coordination × order`, () => {
  it.each(SEE_CASES)('%s · %s · "%s"', (_v, _o, words, X, Y) => {
    // (an "also" coordination is refused one rule earlier, as an ADD — either way SPY is never re-symbolled away)
    expect(rail([X], 'c1', Y, words), words).toMatch(new RegExp(`would leave ${X} off your board|you asked for more charts`))
  })
  it.each(PAIRS)('control: "show %s" alone (the shown ticker NOT named) → the sole chart switches', (X, Y) => {
    expect(rail([X], 'c1', Y, `show ${Y}`)).toBeNull()
  })
})

// ── SEVERAL: with two charts the existing identification rules are unchanged ──
describe('SEVERAL · two charts: the named chart changes; another chart, or no chart named, is refused / asked', () => {
  const forms = Object.values(RELATION).flat().filter(t => t.includes('{X}'))
  it.each(forms.map(t => [fill(t, 'SPY', 'AAPL')]))('"%s" re-symbolling the SPY chart → licensed', (words) => {
    expect(rail(['SPY', 'QQQ'], 'c1', 'AAPL', words), words).toBeNull()
  })
  // (an exclusion phrase — "instead of SPY", "rather than SPY" — leaves QQQ by the existing ELIMINATION rule, unchanged here)
  const others = forms.filter(t => !/instead of|rather than/.test(t))
  it.each(others.map(t => [fill(t, 'SPY', 'AAPL')]))('"%s" re-symbolling the QQQ chart → refused or asked', (words) => {
    expect(rail(['SPY', 'QQQ'], 'c2', 'AAPL', words), words).toBeTruthy()
  })
  it.each([['AAPL'], ['show AAPL'], ['make it AAPL']])('"%s" with neither chart named → asked which', (words) => {
    expect(rail(['SPY', 'QQQ'], 'c1', 'AAPL', words)).toMatch(/^Which chart should change to AAPL\?/)
  })
})

// ── DOTTED: the ticker is matched literally — "BRK.B" never matches "BRKXB" ──
describe('DOTTED · a dotted ticker is escaped in every per-ticker pattern', () => {
  it('"swap BRK.B for AAPL" on the sole BRK.B chart → licensed; "open BRK.B and AAPL" → refused (BRK.B kept)', () => {
    expect(rail(['BRK.B'], 'c1', 'AAPL', 'swap BRK.B for AAPL')).toBeNull()
    expect(rail(['BRK.B'], 'c1', 'AAPL', 'open BRK.B and AAPL')).toMatch(/would leave BRK\.B off your board/)
  })
  it('a relation on ANOTHER ticker that only a wildcard would match never marks BRK.B as changed', () => {
    for (const words of ['open BRK.B and AAPL, BRKXB to MSFT', 'show BRK.B and AAPL, replace BRK1B', 'show BRK.B and AAPL; BRKZB off']) {
      expect(tickerChanged(words, 'BRK.B', ['AAPL', 'MSFT', 'BRKXB', 'BRK1B', 'BRKZB']), words).toBe(false)
      expect(tickerAskedToSee(words, 'BRK.B', ['AAPL', 'MSFT', 'BRKXB', 'BRK1B', 'BRKZB']), words).toBe(true)
    }
    expect(rail(['BRK.B'], 'c1', 'AAPL', 'open BRK.B and AAPL, brk-b off')).toMatch(/would leave BRK\.B off your board/)
  })
})

// ── the REAL panel: AUDIT's 52a forms and 52b, end to end ──
describe('PANEL · 52a swap forms switch the sole SPY chart; 52b "open SPY and AAPL" keeps SPY', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  const chart = (id) => ({ id, type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: bareSettings() } })
  const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol || 'empty'})` } : s)
  const symOf = (m) => m.h.charts.read('c0')?.symbol || ''
  it.each([['swap SPY for AAPL', 'AAPL'], ['put AAPL where SPY is', 'AAPL'], ['SPY to AAPL', 'AAPL'], ['take SPY off and put AAPL on', 'AAPL'],
    ['open SPY and AAPL', 'SPY'], ['show SPY and AAPL', 'SPY']])('"%s" → the chart shows %s', async (words, want) => {
    const m = p.mount([chart('c0')], { 'N:c0': 'SPY' }, { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'AAPL' } }]))
    const out = await m.say(words)
    expect(symOf(m), out).toBe(want)
  }, 40000)
})
