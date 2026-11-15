// ⛔ H14 · AUDIT held-out probes 52a / 52b / 53a / 53b (2026-11-15). STRUCTURAL (chartRail tickerChanged / tickerAskedToSee, the
// CHANGE_* and SEE_VERBS word sets — the ONE place; every form below is GENERATED from those exports, never retyped here):
//   52a  on the SOLE chart an ordinary swap form ("swap SPY for AAPL", "put AAPL where SPY is", "SPY to AAPL", …) re-symbols it —
//        the shown ticker is the OBJECT OF A CHANGE, never one the member asked to SEE
//   52b  a shown ticker counts as asked-to-see only when a see verb GOVERNS it ("show / open SPY and AAPL" keeps SPY)
//   53a  on 2 / 3 / 4 charts a change relation names the TARGET: "AAPL instead of SPY" never re-symbols another chart (the
//        exclusion / elimination reading never applies to a changed ticker — spatialCheck excludedCharts, tickerSetAside)
//   53b  …and the SPY chart's own re-symbol is APPLIED (no over-refusal), every other chart unchanged
//   DOTTED  a dotted ticker (BRK.B) is matched literally — its "." is never a wildcard
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal, tickerAskedToSee, tickerChanged, tickerSetAside, CHANGE_TAKE, CHANGE_TO, CHANGE_BACK, CHANGE_OFF, SEE_VERBS } from './chartRail'
import { excludedCharts } from './spatialCheck'
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

// ── the relation forms, GENERATED from the word sets: each word in its position, the ticker order it states, a lead-in or none ──
const FORMS = [
  ...CHANGE_TO.flatMap(r => [[`to · ${r}`, `swap {X} ${r} {Y}`], [`to · ${r}`, `{X} ${r} {Y}`], [`to · ${r}`, `change {X} ${r} {Y}`], [`to · ${r}`, `{X} chart ${r} {Y}`]]),
  ...CHANGE_BACK.flatMap(r => [[`back · ${r}`, `{Y} ${r} {X}`], [`back · ${r}`, `put {Y} ${r} {X} now`], [`back · ${r}`, `show {Y} ${r} {X}`]]),
  ...CHANGE_TAKE.flatMap(r => [[`take · ${r}`, `${r} {X} with {Y}`], [`take · ${r}`, `{Y}, ${r} {X}`]]),
  ...CHANGE_OFF.flatMap(r => [[`off · ${r}`, `{X} ${r} and {Y} on`], [`off · ${r}`, `{Y} on, {X} ${r}`], [`off · ${r}`, `take {X} ${r} and put {Y} on`]]),
]

// ── 52a RELATION: on the sole chart every change relation licenses the re-symbol — relation × order × casing ──
const REL_CASES = []
for (const [rel, tpl] of FORMS) for (const [cname, cs] of Object.entries(CASES)) for (const [X, Y] of PAIRS.slice(0, 2)) REL_CASES.push([rel, cname, fill(tpl, cs(X), cs(Y)), X, Y])
describe(`52a RELATION · on the sole chart a change relation licenses the re-symbol (${REL_CASES.length} cases): relation × order × casing`, () => {
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

// ── 52b SEE: a see verb governing the shown ticker, coordinated with the new one → both must stay on the board ──
const LEADS = ['', 'can I ', 'please ', 'now ']
const COORD = ['{A} and {B}', '{A} & {B}', '{A}, {B}', '{A} plus {B}', 'both {A} and {B}', 'me {A} and {B}', '${A} and ${B}']
const SEE_CASES = []
for (const verb of SEE_VERBS) for (const co of COORD) for (const order of ['shown first', 'new first']) {
  const [X, Y] = PAIRS[SEE_CASES.length % 2]
  const [A, B] = order === 'shown first' ? [X, Y] : [Y, X]
  SEE_CASES.push([verb, order, `${LEADS[SEE_CASES.length % LEADS.length]}${verb} ${co.replace(/\{A\}/g, A).replace(/\{B\}/g, B)}`, X, Y])
}
describe(`52b SEE · a see verb governs the shown ticker → a plan dropping it is refused (${SEE_CASES.length} cases): verb × coordination × order`, () => {
  it.each(SEE_CASES)('%s · %s · "%s"', (_v, _o, words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toMatch(new RegExp(`would leave ${X} off your board`))
  })
  it.each(PAIRS)('control: "show %s" alone (the shown ticker NOT named) → the sole chart switches', (X, Y) => {
    expect(rail([X], 'c1', Y, `show ${Y}`)).toBeNull()
  })
})

// ── 53a / 53b: on 2, 3 and 4 charts, the changed ticker first / middle / last — the X chart switches, no other chart ever ──
const OTHERS = ['QQQ', 'IWM', 'DIA']
const BOARDS = []
for (const n of [2, 3, 4]) for (const [pname, at] of [['first', 0], ['middle', Math.floor((n - 1) / 2) || 0], ['last', n - 1]]) {
  if (n === 2 && pname === 'middle') continue
  const syms = OTHERS.slice(0, n - 1)
  syms.splice(at, 0, 'SPY')
  BOARDS.push([`${n} charts · SPY ${pname}`, syms, at])
}
const NAMED = { upper: (s) => s.toUpperCase(), dollar: (s) => `$${s.toLowerCase()}` }      // (a ticker said as a NAME: caps or $)
const POS53 = [], NEG53 = []
for (const [rel, tpl] of FORMS) for (const [bname, syms, at] of BOARDS) {
  for (const [cname, cs] of Object.entries(NAMED)) POS53.push([rel, bname, cname, fill(tpl, cs('SPY'), cs('AAPL')), syms, at])
  for (const [cname, cs] of Object.entries(CASES)) NEG53.push([rel, bname, cname, fill(tpl, cs('SPY'), cs('AAPL')), syms, at])
}
describe(`53b · the chart showing the changed ticker switches (${POS53.length} cases): relation × board × position × casing`, () => {
  it.each(POS53)('%s · %s · %s · "%s"', (_r, _b, _c, words, syms, at) => {
    expect(rail(syms, `c${at + 1}`, 'AAPL', words), words).toBeNull()
  })
})
describe(`53a · no OTHER chart is ever changed by these words (${NEG53.length} cases): relation × board × position × casing`, () => {
  it.each(NEG53)('%s · %s · %s · "%s"', (_r, _b, _c, words, syms, at) => {
    const charts = syms.map((s, i) => ({ ref: `c${i + 1}`, symbol: s }))
    expect(excludedCharts(words, charts, null).has(`c${at + 1}`), `excluded: ${words}`).toBe(false)
    expect(tickerSetAside(words, 'SPY'), `set aside: ${words}`).toBe(false)
    for (let i = 0; i < syms.length; i++) if (i !== at) expect(rail(syms, `c${i + 1}`, 'AAPL', words), `${words} → c${i + 1} (${syms[i]})`).toBeTruthy()
  })
})
describe('53 · controls: a genuine exclusion is still an exclusion, and still set aside', () => {
  const two = [{ ref: 'c1', symbol: 'SPY' }, { ref: 'c2', symbol: 'QQQ' }]
  it.each([['make all charts weekly except SPY'], ['switch the others to AAPL, not SPY'], ['change everything to AAPL but leave SPY alone'], ["don't touch SPY, switch the rest to AAPL"]])('"%s" → SPY excluded', (words) => {
    expect(excludedCharts(words, two, null).has('c1'), words).toBe(true)
  })
  it.each([['switch to AAPL, but not SPY'], ['AAPL except SPY'], ['leave SPY, AAPL please'], ['AAPL, keep SPY']])('"%s" → SPY set aside', (words) => {
    expect(tickerSetAside(words, 'SPY'), words).toBe(true)
  })
  it('"switch to AAPL, but not SPY" on SPY + QQQ → the QQQ chart changes (elimination), SPY stays excluded', () => {
    expect(rail(['SPY', 'QQQ'], 'c2', 'AAPL', 'switch to AAPL, but not SPY')).toBeNull()
    expect(excludedCharts('switch to AAPL, but not SPY', [{ ref: 'c1', symbol: 'SPY' }, { ref: 'c2', symbol: 'QQQ' }], null).has('c1')).toBe(true)
  })
  it.each([['AAPL'], ['show AAPL'], ['make it AAPL']])('"%s" with no chart named on SPY + QQQ → asked which', (words) => {
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

// ── the REAL panel, end to end: AUDIT's 52a / 52b sentences on the sole chart; 53a / 53b on every board × position ──
describe('PANEL · the real Agent panel', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol || 'empty'})` } : s)
  const mountOf = (syms) => {
    const w = Math.floor(24 / syms.length)
    const widgets = syms.map((_, i) => ({ id: `c${i}`, type: 'chart', x: i * w, y: 0, w, h: 20, color: 'N', opts: { settings: bareSettings() } }))
    return p.mount(widgets, Object.fromEntries(syms.map((s, i) => [`N:c${i}`, s])), { decorate })
  }
  const symsOf = (m, n) => Array.from({ length: n }, (_, i) => m.h.charts.read(`c${i}`)?.symbol || '')
  const sayWith = async (syms, target, words) => {
    const m = mountOf(syms)
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[target].ref, args: { symbol: 'AAPL' } }]))
    const out = await m.say(words)
    return [symsOf(m, syms.length), out]
  }
  it.each([['swap SPY for AAPL', 'AAPL'], ['put AAPL where SPY is', 'AAPL'], ['make SPY into AAPL', 'AAPL'], ['trade SPY for AAPL', 'AAPL'], ['SPY to AAPL', 'AAPL'],
    ['take SPY off and put AAPL on', 'AAPL'], ['open SPY and AAPL', 'SPY'], ['show SPY and AAPL', 'SPY']])('sole chart · "%s" → the chart shows %s', async (words, want) => {
    const [got, out] = await sayWith(['SPY'], 0, words)
    expect(got, out).toEqual([want])
  }, 40000)
  // every relation word (one form each) on a board in turn, and one word per relation CLASS on every board × position: the plan on
  // the SPY chart applies, every other chart unchanged (53b)…  (the full relation × board × position × casing matrix is the rail's, above)
  const ONE = [...new Map(FORMS.map(([rel, tpl]) => [rel, tpl])).entries()]
  const CLASS1 = [...new Map(ONE.map(([rel, tpl]) => [rel.split(' · ')[0], [rel, tpl]])).values()]
  const PANEL = [...ONE.map(([rel, tpl], i) => [rel, ...BOARDS[i % BOARDS.length], tpl]), ...CLASS1.flatMap(([rel, tpl]) => BOARDS.map(b => [rel, ...b, tpl]))]
    .map(([rel, bname, syms, at, tpl]) => [rel, bname, fill(tpl, 'SPY', 'AAPL'), syms, at])
  it.each(PANEL)('53b · %s · %s · "%s" → the SPY chart becomes AAPL, the rest unchanged', async (_r, _b, words, syms, at) => {
    const [got, out] = await sayWith(syms, at, words)
    expect(got, out).toEqual(syms.map((s, i) => (i === at ? 'AAPL' : s)))
  }, 40000)
  it('control · "switch to AAPL, but not SPY" on SPY + QQQ with a plan on SPY → SPY never changes', async () => {
    const [got, out] = await sayWith(['SPY', 'QQQ'], 0, 'switch to AAPL, but not SPY')
    expect(got[0], out).toBe('SPY')
  }, 40000)
  // …and a plan aimed at ANOTHER chart never applies (53a)
  it.each(PANEL)('53a · %s · %s · "%s" → a plan on another chart changes nothing', async (_r, _b, words, syms, at) => {
    const other = at === 0 ? 1 : 0
    const [got, out] = await sayWith(syms, other, words)
    expect(got, out).toEqual(syms)
  }, 40000)
})
