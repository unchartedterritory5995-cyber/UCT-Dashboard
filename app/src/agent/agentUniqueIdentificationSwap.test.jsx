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
import { chartRailRefusal, tickerAskedToSee, tickerChanged, tickerSetAside, isAdditive, spokenTickers, CHANGE_TAKE, CHANGE_TO, CHANGE_BACK, CHANGE_OFF, SEE_VERBS, TAKE_OFF, PUT_ON } from './chartRail'
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
    // (the readers that know no plan read a ticker said as a NAME — caps or "$"; the rail reads the plan's own symbol in any casing)
    if (_c !== 'lower' && _c !== 'mixed') {
      expect(excludedCharts(words, charts, null).has(`c${at + 1}`), `excluded: ${words}`).toBe(false)
      expect(tickerSetAside(words, 'SPY'), `set aside: ${words}`).toBe(false)
    }
    for (let i = 0; i < syms.length; i++) if (i !== at) expect(rail(syms, `c${i + 1}`, 'AAPL', words), `${words} → c${i + 1} (${syms[i]})`).toBeTruthy()
  })
})
describe('53 · controls: a genuine exclusion is still an exclusion, and still set aside', () => {
  const two = [{ ref: 'c1', symbol: 'SPY' }, { ref: 'c2', symbol: 'QQQ' }]
  it.each([['make all charts weekly except SPY'], ['switch the others to AAPL, not SPY'], ['change everything to AAPL but leave SPY alone'], ["don't touch SPY, switch the rest to AAPL"], ['set every chart to weekly, hands off SPY'], ['hands off the SPY chart, set all charts to weekly'], ['log on this one rather than the SPY one'], ['make QQQ weekly rather than SPY']])('"%s" → SPY excluded', (words) => {
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

// ── N2 (AUDIT surviving mutant, 2026-11-15): the LOOSE back relation ("Y where X", "Y over X") is the ONLY reader that marks X as
// changed for the back words CHANGE_TAKE does not also hold — the same X said again under a stay cue ("… and X is fine", "X stays")
// is then excluded, and the elimination step would license the OTHER chart. The back line keeps X the target: the other chart is
// asked. (The shared words — instead of / in place of / rather than — are also read by CHANGE_TAKE "<word> X" and pass either way.)
// GENERATED: back word × relation shape (determiner, words between, lead-in) × stay clause (order, punctuation) × board × casing ──
const BACK_SHAPES = ['{Y} {r} {X}', 'put {Y} {r} the {X} chart now', 'show {Y} {r} my {X}', 'put {Y} up, please, {r} {X}', 'can you put {Y} {r} {X} is?']
const STAY = ['{R} and {X} is fine', '{R}; {X} stays', '{R}, {X} remains', '{X} is fine, but {R}', '{R}. {X} is ok']
const N2_BOARDS = [['SPY', ['SPY', 'QQQ']], ['SPY', ['QQQ', 'SPY']], ['BRK.B', ['BRK.B', 'QQQ']], ['BRK.B', ['IWM', 'BRK.B']]]
const N2_CASES = []
for (const r of CHANGE_BACK) for (const shape of BACK_SHAPES) for (const stay of STAY) for (const [X, syms] of N2_BOARDS) for (const [cname, cs] of [['upper', (s) => s], ['dollar', (s) => `$${s.toLowerCase()}`], ['lower', (s) => s.toLowerCase()]]) for (const Y of ['AAPL', 'BRK.A']) {
  const words = stay.replace('{R}', shape.replace('{r}', r)).replace(/\{X\}/g, cs(X)).replace(/\{Y\}/g, cs(Y))
  N2_CASES.push([r, cname, words, syms, X, Y])
}
describe(`N2 · "Y <back word> X … X is fine": X stays the target, the other chart is never licensed (${N2_CASES.length} cases): back word × shape × stay clause × board × casing`, () => {
  it.each(N2_CASES)('%s · %s · "%s"', (_r, cname, words, syms, X, Y) => {
    const at = syms.indexOf(X)
    if (cname !== 'lower') expect(excludedCharts(words, syms.map((s, i) => ({ ref: `c${i + 1}`, symbol: s })), null).has(`c${at + 1}`), `excluded: ${words}`).toBe(false)
    syms.forEach((s, i) => { if (i !== at) expect(rail(syms, `c${i + 1}`, Y, words), `${words} → c${i + 1} (${s})`).toBeTruthy() })
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

// ── AUDIT 53 condition: "Y instead of SPY" names the SPY chart only when EXACTLY ONE object in scope shows SPY (a link group is
// ONE object). Two independent SPY charts → asked, nothing changed; a linked SPY pair → applied (both follow) ──
const BACK_TAKE = FORMS.filter(([rel]) => /^(?:back|take)/.test(rel))
const DUPS = [['2 SPY charts', ['SPY', 'SPY']], ['SPY · QQQ · SPY', ['SPY', 'QQQ', 'SPY']], ['QQQ · SPY · IWM · SPY', ['QQQ', 'SPY', 'IWM', 'SPY']]]
const DUP_CASES = BACK_TAKE.flatMap(([rel, tpl]) => DUPS.map(([bname, syms]) => [rel, bname, fill(tpl, 'SPY', 'AAPL'), syms]))
describe(`53 · two INDEPENDENT charts show SPY → no plan on either is licensed (${DUP_CASES.length} cases): relation × board`, () => {
  it.each(DUP_CASES)('%s · %s · "%s"', (_r, _b, words, syms) => {
    syms.forEach((s, i) => { if (s === 'SPY') expect(rail(syms, `c${i + 1}`, 'AAPL', words), `${words} → c${i + 1}`).toBeTruthy() })
  })
})
// a linked SPY pair (one link colour) + an unlinked QQQ: ONE object shows SPY → the plan on it is licensed
const linkedBoard = () => makeBoard([
  { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
  { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
  { id: 'c3', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'N', opts: settings() }], { A: 'SPY', 'N:c3': 'QQQ' })
describe(`53 · a LINKED SPY pair is one object → applied (${BACK_TAKE.length} cases)`, () => {
  it.each(BACK_TAKE.map(([rel, tpl]) => [rel, fill(tpl, 'SPY', 'AAPL')]))('%s · "%s"', (_r, words) => {
    const b = linkedBoard()
    const p = resym(b, 'c1', 'AAPL')
    expect(p.ok).toBe(true)
    expect(chartRailRefusal(p, { words, host: b.host, mode: 'apply' }), words).toBeNull()
    expect(chartRailRefusal(resym(b, 'c3', 'AAPL'), { words, host: b.host, mode: 'apply' }), `${words} → QQQ`).toBeTruthy()
  })
})

// ── AUDIT 53 edge: the new symbol is ALREADY on the board ("QQQ instead of SPY" on SPY + QQQ) — the SPY chart changes, never QQQ ──
const QBOARDS = [['SPY · QQQ', ['SPY', 'QQQ']], ['QQQ · SPY', ['QQQ', 'SPY']], ['SPY · QQQ · IWM', ['SPY', 'QQQ', 'IWM']], ['IWM · QQQ · SPY', ['IWM', 'QQQ', 'SPY']]]
const Q_CASES = BACK_TAKE.flatMap(([rel, tpl]) => QBOARDS.map(([bname, syms]) => [rel, bname, fill(tpl, 'SPY', 'QQQ'), syms]))
describe(`53 · "QQQ instead of SPY" with QQQ on the board (${Q_CASES.length} cases): relation × board × order`, () => {
  it.each(Q_CASES)('%s · %s · "%s"', (_r, _b, words, syms) => {
    const at = syms.indexOf('SPY')
    // (the readers that know no plan: a SHOWN new symbol is read as the relation's DIRECT complement — "QQQ instead of SPY")
    if (/^back/.test(_r)) expect(excludedCharts(words, syms.map((x, i) => ({ ref: `c${i + 1}`, symbol: x })), null).has(`c${at + 1}`), words).toBe(false)
    expect(rail(syms, `c${at + 1}`, 'QQQ', words), words).toBeNull()
    syms.forEach((s, i) => { if (i !== at && s !== 'QQQ') expect(rail(syms, `c${i + 1}`, 'QQQ', words), `${words} → c${i + 1} (${s})`).toBeTruthy() })
  })
})
describe('53 · PANEL · two SPY charts ask; a linked pair applies; "QQQ instead of SPY" changes only the SPY chart', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol || 'empty'})` } : s)
  const mountOf = (syms, colors = null) => {
    const w = Math.floor(24 / syms.length)
    const widgets = syms.map((_, i) => ({ id: `c${i}`, type: 'chart', x: i * w, y: 0, w, h: 20, color: colors ? colors[i] : 'N', opts: { settings: bareSettings() } }))
    const gs = {}
    widgets.forEach((wd, i) => { gs[wd.color === 'N' ? `N:${wd.id}` : wd.color] = syms[i] })
    return p.mount(widgets, gs, { decorate })
  }
  const symsOf = (m, n) => Array.from({ length: n }, (_, i) => m.h.charts.read(`c${i}`)?.symbol || '')
  const say = async (m, target, to, words) => {
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[target].ref, args: { symbol: to } }]))
    return m.say(words)
  }
  it.each([['AAPL instead of SPY'], ['show AAPL rather than SPY'], ['put AAPL in place of SPY']])('two independent SPY charts · "%s" → nothing changes', async (words) => {
    const m = mountOf(['SPY', 'QQQ', 'SPY'])
    const out = await say(m, 0, 'AAPL', words)
    expect(symsOf(m, 3), out).toEqual(['SPY', 'QQQ', 'SPY'])
  }, 40000)
  it.each([['AAPL instead of SPY'], ['show AAPL rather than SPY']])('a linked SPY pair · "%s" → both SPY charts become AAPL, QQQ unchanged', async (words) => {
    const m = mountOf(['SPY', 'SPY', 'QQQ'], ['A', 'A', 'N'])
    const out = await say(m, 0, 'AAPL', words)
    expect(symsOf(m, 3), out).toEqual(['AAPL', 'AAPL', 'QQQ'])
  }, 40000)
  it.each(QBOARDS)('%s · "QQQ instead of SPY" → the SPY chart becomes QQQ; every other chart unchanged', async (_b, syms) => {
    const at = syms.indexOf('SPY')
    let m = mountOf(syms)
    let out = await say(m, at, 'QQQ', 'QQQ instead of SPY')
    expect(symsOf(m, syms.length), out).toEqual(syms.map((s, i) => (i === at ? 'QQQ' : s)))
    const other = syms.findIndex(s => s !== 'SPY' && s !== 'QQQ')
    if (other >= 0) {
      cleanup(); p = setupPanel()
      m = mountOf(syms)
      out = await say(m, other, 'QQQ', 'QQQ instead of SPY')
      expect(symsOf(m, syms.length), out).toEqual(syms)
    }
  }, 60000)
})

// ══ H14 FOLLOW-UPS (AUDIT non-blocking, 2026-11-15) — STRUCTURAL, every form GENERATED from the exported word sets ══════════
//   FU1  AUDIT RULING: a see verb that GOVERNS X wins over a change relation on X in the same request — on the sole chart "AAPL
//        where SPY and show me SPY and AAPL" keeps SPY: the plan dropping it is refused with the "add …" guidance, never applied
//   FU2  the see-verb gaps ("give me", "let me look at", "let me see", "put up", …) are SEE_VERBS (the ONE set): a plan dropping
//        the shown ticker they govern is refused; a change relation still switches the chart
//   FU3  "take off X … put on Y" (TAKE_OFF × PUT_ON, either order) is a swap on X's chart; "take off X" alone stays refused
//   FU4  "no more X, Y" (CHANGE_TAKE "no more" with another ticker named) is a swap on X's chart; "and also Y" stays additive
const TCASE = { upper: (s) => s, dollar: (s) => `$${s.toLowerCase()}` }
const SEE_CO = ['{A} and {B}', '{A} & {B}', '{A}, {B}', 'both {A} and {B}', 'me {A} plus {B}']
const leaves = (X) => new RegExp(`would leave ${X.replace('.', '\\.')} off your board[^]*add `)

// ── FU1 · AUDIT RULING: change relation (every FORM) × see clause (every verb, rotated) × order × ticker casing ──
const FU1 = []
for (const [rel, tpl] of FORMS) for (const order of ['change first', 'see first']) for (const [cname, cs] of Object.entries(TCASE)) {
  const i = FU1.length
  const [X, Y] = PAIRS[i % PAIRS.length]
  const verb = SEE_VERBS[i % SEE_VERBS.length]
  const [A, B] = i % 2 ? [Y, X] : [X, Y]
  const see = `${verb} ${SEE_CO[i % SEE_CO.length].replace('{A}', cs(A)).replace('{B}', cs(B))}`
  const change = fill(tpl, cs(X), cs(Y))
  FU1.push([rel, order, cname, order === 'change first' ? `${change} and ${see}` : `${see}, ${change}`, X, Y])
}
// …and every see verb on AUDIT's own shape ("Y where X and <verb> X and Y")
for (const verb of SEE_VERBS) for (const [X, Y] of PAIRS) FU1.push(['back · where', 'audit shape', 'upper', `${Y} where ${X} and ${verb} ${X} and ${Y}`, X, Y])
describe(`FU1 · AUDIT RULING · a see verb governing X wins over a change on X → the plan dropping X is refused (${FU1.length} cases): relation × see verb × order × casing`, () => {
  it.each(FU1)('%s · %s · %s · "%s"', (_r, _o, _c, words, X, Y) => {
    expect(tickerAskedToSee(words, X, [X, Y]), words).toBe(true)
    expect(rail([X], 'c1', Y, words), words).toMatch(leaves(X))
  })
  it.each(PAIRS)('the reading is per OCCURRENCE: "%s to %s" governed by nothing → still a change (the plan applies)', (X, Y) => {
    expect(rail([X], 'c1', Y, `${X} to ${Y}, and show me ${Y}`)).toBeNull()
  })
  // ⛔ STRICT (AUDIT 11-16, an intended stricter change): the governed occurrence ITSELF the operand of a CHANGE_TO / CHANGE_OFF
  // word ("show SPY for AAPL", "pull up SPY off and AAPL on") is STILL asked to see — refused, never written (master applied it)
  const OPERAND = SEE_VERBS.flatMap((v, i) => [...CHANGE_TO.map(r => `${v} {X} ${r} {Y}`), ...CHANGE_OFF.map(r => `${v} {X} ${r} and {Y} on`)]
    .map((tpl, j) => { const [X, Y] = PAIRS[(i + j) % PAIRS.length]; return [fill(tpl, X, Y), X, Y] }))
  it.each(OPERAND)('strict operand · "%s" → refused, the shown ticker stays', (words, X, Y) => {
    expect(tickerAskedToSee(words, X, [X, Y]), words).toBe(true)
    expect(rail([X], 'c1', Y, words), words).toMatch(leaves(X))
  })
})

// ── FU2 · every SEE verb × joiner × order × verb casing → a plan dropping the governed shown ticker is refused ──
const VCASE = { lower: (v) => v, title: (v) => v[0].toUpperCase() + v.slice(1), words: (v) => v.replace(/\b[a-z]/g, c => c.toUpperCase()) }
const FU2 = [], FU2_CTL = []
for (const verb of SEE_VERBS) for (const co of SEE_CO) for (const order of ['shown first', 'new first']) for (const [vname, vc] of Object.entries(VCASE)) {
  const [X, Y] = PAIRS[FU2.length % PAIRS.length]
  const [A, B] = order === 'shown first' ? [X, Y] : [Y, X]
  FU2.push([verb, order, vname, `${vc(verb)} ${co.replace('{A}', A).replace('{B}', B)}`, X, Y])
}
for (const verb of SEE_VERBS) for (const r of CHANGE_BACK) {
  const [X, Y] = PAIRS[FU2_CTL.length % PAIRS.length]
  FU2_CTL.push([verb, r, `${verb} ${Y} ${r} ${X}`, X, Y])
}
describe(`FU2 · SEE verb × joiner × order × casing → refused (${FU2.length} cases); controls: a change relation still switches (${FU2_CTL.length})`, () => {
  it.each(FU2)('%s · %s · %s · "%s"', (_v, _o, _c, words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toMatch(leaves(X))
  })
  it.each(FU2_CTL)('control · %s · %s · "%s" → the sole chart switches', (_v, _r, words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toBeNull()
  })
  it.each(SEE_VERBS.flatMap(v => PAIRS.map(([X, Y]) => [`${v} ${Y}`, X, Y])))('control · "%s" (the shown ticker NOT named) → the sole chart switches', (words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toBeNull()
  })
})

// (the GAPS AUDIT named are pinned HERE, not read from SEE_VERBS — a set that lost one would also lose its generated cases)
const GAPS = ['give me', 'let me look at', 'let me see', 'put up']
const FU2_GAP = []
for (const verb of GAPS) for (const co of SEE_CO) for (const order of ['shown first', 'new first']) for (const [vname, vc] of Object.entries(VCASE)) for (const [cname, cs] of Object.entries(TCASE)) {
  const [X, Y] = PAIRS[FU2_GAP.length % PAIRS.length]
  const [A, B] = order === 'shown first' ? [X, Y] : [Y, X]
  FU2_GAP.push([verb, order, vname, cname, `${vc(verb)} ${co.replace('{A}', cs(A)).replace('{B}', cs(B))}`, X, Y])
}
describe(`FU2 · AUDIT's see-verb gaps × joiner × order × verb casing × ticker casing → refused (${FU2_GAP.length} cases)`, () => {
  it.each(FU2_GAP)('%s · %s · %s · %s · "%s"', (_v, _o, _vc, _c, words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toMatch(leaves(X))
  })
})

// ── FU3 · TAKE_OFF × PUT_ON × "put Y on" form × order × joiner × board: X's chart switches, no other chart ever ──
const JOIN = [', ', ' and ', ' then ', '. ']
const ON_FORMS = PUT_ON.flatMap(p => { const [v, ...rest] = p.split(' '); return [`${p} {Y}`, `${v} {Y} ${rest.join(' ')}`] })
const FU3 = []
for (const off of TAKE_OFF) for (const on of ON_FORMS) for (const order of ['off first', 'on first']) {
  const i = FU3.length
  const j = JOIN[i % JOIN.length]
  const o = `${off} {X}`
  const [bname, syms, at] = [['sole', ['SPY'], 0], ...BOARDS][i % (BOARDS.length + 1)]
  FU3.push([off, on, order, fill(order === 'off first' ? `${o}${j}${on}` : `${on}${j}${o}`, 'SPY', 'AAPL'), bname, syms, at])
}
describe(`FU3 · "take off X … put on Y" is a swap on X's chart (${FU3.length} cases): take-off × put-on × form × order × joiner × board`, () => {
  it.each(FU3)('%s · %s · %s · "%s" · %s', (_off, _on, _o, words, _b, syms, at) => {
    expect(tickerChanged(words, 'SPY', ['AAPL']), words).toBe(true)
    expect(rail(syms, `c${at + 1}`, 'AAPL', words), words).toBeNull()
    syms.forEach((s, i) => { if (i !== at) expect(rail(syms, `c${i + 1}`, 'AAPL', words), `${words} → c${i + 1} (${s})`).toBeTruthy() })
  })
  // a GENUINE removal ("take off SPY" alone, or with an ADD) never re-symbols: refused on the sole chart, asked on several
  const GENUINE = TAKE_OFF.flatMap(off => [`${off} SPY`, `${off} the SPY chart`, `${off} SPY and add AAPL`, `${off} SPY, put on the RSI`])
  it.each(GENUINE)('control · "%s" → never re-symbols SPY', (words) => {
    expect(rail(['SPY'], 'c1', 'AAPL', words), words).toBeTruthy()
    expect(rail(['SPY', 'QQQ'], 'c1', 'AAPL', words), words).toBeTruthy()
  })
})

// ── FU4 · "no more X, Y" → a swap on X's chart; "and also Y" / "Y too" / "no more X" alone stay refused ──
const NO_MORE = ['no more {X}, {Y}', 'no more {X}; {Y} please', 'no more {X} — {Y}', '{Y}, no more {X}', 'no more {X}, {Y} instead', 'no more {X}. {Y} now']
const FU4 = [], FU4_NEG = []
for (const tpl of NO_MORE) for (const [bname, syms, at] of [['sole', ['SPY'], 0], ...BOARDS]) {
  for (const [cname, cs] of Object.entries(TCASE)) FU4.push([bname, cname, fill(tpl, cs('SPY'), cs('AAPL')), syms, at])
  if (syms.length === 1) FU4.push([bname, 'lower', fill(tpl, 'spy', 'aapl'), syms, at])
  for (const [cname, cs] of Object.entries(CASES)) FU4_NEG.push([bname, cname, fill(tpl, cs('SPY'), cs('AAPL')), syms, at])
}
describe(`FU4 · "no more X, Y" is a swap on X's chart (${FU4.length} cases), never another chart (${FU4_NEG.length} cases)`, () => {
  it.each(FU4)('%s · %s · "%s" → the X chart switches', (_b, _c, words, syms, at) => {
    expect(isAdditive(words, ['SPY', 'AAPL']), words).toBe(false)
    expect(rail(syms, `c${at + 1}`, 'AAPL', words), words).toBeNull()
  })
  it.each(FU4_NEG)('%s · %s · "%s" → no other chart', (_b, _c, words, syms, at) => {
    syms.forEach((s, i) => { if (i !== at) expect(rail(syms, `c${i + 1}`, 'AAPL', words), `${words} → c${i + 1} (${s})`).toBeTruthy() })
  })
  const STILL = ['and also {Y}', '{Y} as well', 'no more {X} and also {Y}', 'no more {X}, {Y} too', 'no more {X}', 'no more charts, {Y}']
  it.each(STILL.flatMap(t => PAIRS.map(([X, Y]) => [fill(t, X, Y), X, Y])))('control · "%s" → refused (additive / no new ticker named)', (words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toBeTruthy()
  })
})

// ── FU · the REAL panel, end to end ──
describe('FU · PANEL · the real Agent panel', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol || 'empty'})` } : s)
  const mountOf = (syms) => {
    const w = Math.floor(24 / syms.length)
    const widgets = syms.map((_, i) => ({ id: `c${i}`, type: 'chart', x: i * w, y: 0, w, h: 20, color: 'N', opts: { settings: bareSettings() } }))
    return p.mount(widgets, Object.fromEntries(syms.map((s, i) => [`N:c${i}`, s])), { decorate })
  }
  const sayWith = async (syms, target, words) => {
    const m = mountOf(syms)
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[target].ref, args: { symbol: 'AAPL' } }]))
    const out = await m.say(words)
    return [Array.from({ length: syms.length }, (_, i) => m.h.charts.read(`c${i}`)?.symbol || ''), out]
  }
  it.each([
    ['AAPL where SPY and show me SPY and AAPL', ['SPY'], 0, ['SPY']],
    ['give me SPY and AAPL', ['SPY'], 0, ['SPY']],
    ['let me look at SPY and AAPL', ['SPY'], 0, ['SPY']],
    ['put up SPY and AAPL', ['SPY'], 0, ['SPY']],
    ['take off SPY, put on AAPL', ['SPY'], 0, ['AAPL']],
    ['take off SPY, put on AAPL', ['SPY', 'QQQ'], 0, ['AAPL', 'QQQ']],
    ['take off SPY, put on AAPL', ['SPY', 'QQQ'], 1, ['SPY', 'QQQ']],
    ['take off SPY', ['SPY'], 0, ['SPY']],
    ['no more SPY, AAPL', ['SPY'], 0, ['AAPL']],
    ['no more SPY, AAPL', ['QQQ', 'SPY'], 1, ['QQQ', 'AAPL']],
    ['no more SPY, AAPL', ['QQQ', 'SPY'], 0, ['QQQ', 'SPY']],
    ['and also AAPL', ['SPY'], 0, ['SPY']],
  ])('"%s" on %j, the plan on chart %i → %j', async (words, syms, target, want) => {
    const [got, out] = await sayWith(syms, target, words)
    expect(got, out).toEqual(want)
  }, 40000)
})

// ══ SEEN STAYS (AUDIT probe 57, 2026-11-16 — a LIVE wrong write): on ANY board a SHOWN ticker a see verb GOVERNS is never
// re-symbolled away. Before, only the sole chart was checked by the rail; on several charts only the LOCAL side-by-side reader
// caught "show X and Y" — "pull up SPY and AAPL" / "I want to see SPY and AAPL" reached the model's plan and wrote.
// GENERATED: board (2 / 3 / 4 charts, SPY in each position, a linked SPY pair) × every SEE verb × joiner × order × casing ──
const linkedOf = (syms, pair) => makeBoard(syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * Math.floor(24 / syms.length), y: 0, w: Math.floor(24 / syms.length), h: 20, color: pair.includes(i) ? 'A' : 'N', opts: settings() })),
  Object.fromEntries(syms.map((s, i) => (pair.includes(i) ? ['A', s] : [`N:c${i + 1}`, s]))))
const SEEN_BOARDS = [...BOARDS.map(([bname, syms, at]) => [bname, syms, at, null]),
  ['linked SPY pair · QQQ', ['SPY', 'SPY', 'QQQ'], 0, [0, 1]], ['QQQ · linked SPY pair', ['QQQ', 'SPY', 'SPY'], 2, [1, 2]]]
const railOn = (syms, pair, ref, to, words) => {
  const b = pair ? linkedOf(syms, pair) : boardOf(syms)
  const p = resym(b, ref, to)
  expect(p.ok).toBe(true)
  return chartRailRefusal(p, { words, host: b.host, mode: 'apply' })
}
const SEEN_CASE = { upper: (s) => s, dollar: (s) => `$${s.toLowerCase()}`, lower: (s) => s.toLowerCase() }
const SEEN = []
for (const verb of SEE_VERBS) for (const co of SEE_CO) for (const order of ['shown first', 'new first']) for (const [cname, cs] of Object.entries(SEEN_CASE)) {
  const [bname, syms, at, pair] = SEEN_BOARDS[SEEN.length % SEEN_BOARDS.length]
  const [A, B] = order === 'shown first' ? ['SPY', 'AAPL'] : ['AAPL', 'SPY']
  SEEN.push([verb, order, cname, bname, `${verb} ${co.replace('{A}', cs(A)).replace('{B}', cs(B))}`, syms, at, pair])
}
// …and every board × every verb on AUDIT's own shape
for (const verb of [...SEE_VERBS, 'I want to see']) for (const [bname, syms, at, pair] of SEEN_BOARDS) SEEN.push([verb, 'audit', 'upper', bname, `${verb} SPY and AAPL`, syms, at, pair])
describe(`SEEN · on ANY board a plan re-symbolling the seen ticker's chart is refused (${SEEN.length} cases): board × SEE verb × joiner × order × casing`, () => {
  it.each(SEEN)('%s · %s · %s · %s · "%s"', (_v, _o, cname, _b, words, syms, at, pair) => {
    const got = railOn(syms, pair, `c${at + 1}`, 'AAPL', words)
    // (a ticker said as a NAME — caps or "$" — identifies the SPY chart, and the SEEN rule refuses; in lowercase the chart is not
    //  identified on several charts and the plan is ASKED first — either way nothing is written)
    if (cname === 'lower' && syms.length > 1) expect(got, words).toBeTruthy()
    else expect(got, words).toMatch(leaves('SPY'))
  })
})
// controls: the genuine change relations still switch the NAMED chart; the protection is per ticker (another seen ticker stays)
const SEEN_CTL = []
for (const [bname, syms, at, pair] of SEEN_BOARDS) {
  for (const words of ['AAPL instead of SPY', 'swap SPY for AAPL', 'replace SPY with AAPL', 'put AAPL where SPY is', 'take off SPY, put on AAPL', 'no more SPY, AAPL']) SEEN_CTL.push([bname, words, syms, at, pair])
  if (syms.includes('QQQ')) for (const verb of SEE_VERBS) SEEN_CTL.push([bname, `${verb} QQQ and AAPL, AAPL instead of SPY`, syms, at, pair])
}
describe(`SEEN · controls: a change relation still switches the named chart (${SEEN_CTL.length} cases)`, () => {
  it.each(SEEN_CTL)('%s · "%s" → the SPY chart switches', (_b, words, syms, at, pair) => {
    expect(railOn(syms, pair, `c${at + 1}`, 'AAPL', words), words).toBeNull()
  })
})
// LOWERCASE (AUDIT probe 57 (a)): the board's own symbols are the vocabulary — never a common word
describe('SEEN · lowercase: a board symbol in lowercase is read; a common word never is', () => {
  it.each([['SPY'], ['SPY', 'QQQ']])('"show spy and aapl" on %j (plan on SPY) → refused / asked, never written', (...syms) => {
    expect(rail(syms, 'c1', 'AAPL', 'show spy and aapl')).toBeTruthy()
  })
  it('"show spy and aapl" on the sole SPY chart → the final-board refusal names SPY', () => {
    expect(rail(['SPY'], 'c1', 'AAPL', 'show spy and aapl')).toMatch(leaves('SPY'))
  })
  // GENERATED: every SEE verb × joiner × order × lowercase / mixed casing on the sole chart, and the linked SPY pair (one object)
  const LOW = []
  for (const verb of SEE_VERBS) for (const co of SEE_CO) for (const order of ['shown first', 'new first']) for (const cs of [(s) => s.toLowerCase(), (s) => s[0] + s.slice(1).toLowerCase()]) {
    const [X, Y] = PAIRS[LOW.length % PAIRS.length]
    const [A, B] = order === 'shown first' ? [X, Y] : [Y, X]
    LOW.push([`${verb} ${co.replace('{A}', cs(A)).replace('{B}', cs(B))}`, X, Y])
  }
  it.each(LOW)('lowercase · sole chart · "%s" → refused, the shown ticker stays', (words, X, Y) => {
    expect(rail([X], 'c1', Y, words), words).toMatch(leaves(X))
  })
  // (on several charts a lowercase name does not IDENTIFY the SPY chart: the plan is asked first — never written)
  it.each(SEE_VERBS.map(v => [`${v} spy and aapl`]))('lowercase · linked SPY pair + QQQ · "%s" → asked / refused, never written', (words) => {
    expect(railOn(['SPY', 'SPY', 'QQQ'], [0, 1], 'c1', 'AAPL', words), words).toMatch(/would leave SPY off your board|^Which chart should change to AAPL\?/)
  })
  const COMMON = ['A', 'ALL', 'NOW', 'ON', 'IT', 'SEE', 'ONE', 'KEY', 'BIG', 'RUN']
  it.each(COMMON)('a board "%s" chart is never read from a common lowercase word', (sym) => {
    const words = `show me all of it now, see the one big key run on a chart — AAPL instead of ${sym}`
    expect(spokenTickers('show me all of it now, see the one big key run on a chart', [sym, 'SPY'])).toEqual([])
    expect(tickerAskedToSee('show me a chart of it now', sym, [sym])).toBe(false)
    expect(rail([sym, 'SPY'], 'c1', 'AAPL', words) || '', words).not.toMatch(/would leave/)
  })
})

// ── SEEN · the REAL panel, end to end (AUDIT probe 57 exactly, and every SEE verb on a rotating board) ──
describe('SEEN · PANEL · the real Agent panel', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol || 'empty'})` } : s)
  const mountOf = (syms, pair = null) => {
    const w = Math.floor(24 / syms.length)
    const widgets = syms.map((_, i) => ({ id: `c${i}`, type: 'chart', x: i * w, y: 0, w, h: 20, color: pair && pair.includes(i) ? 'A' : 'N', opts: { settings: bareSettings() } }))
    const gs = {}
    widgets.forEach((wd, i) => { gs[wd.color === 'N' ? `N:${wd.id}` : wd.color] = syms[i] })
    return p.mount(widgets, gs, { decorate })
  }
  const sayWith = async (syms, target, words, pair = null) => {
    const m = mountOf(syms, pair)
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[target].ref, args: { symbol: 'AAPL' } }]))
    const out = await m.say(words)
    return [Array.from({ length: syms.length }, (_, i) => m.h.charts.read(`c${i}`)?.symbol || ''), out]
  }
  it.each([['show SPY and AAPL'], ['pull up SPY and AAPL'], ['I want to see SPY and AAPL'], ['show spy and aapl']])('probe 57 · SPY · QQQ · "%s" with a plan on SPY → nothing changes', async (words) => {
    const [got, out] = await sayWith(['SPY', 'QQQ'], 0, words)
    expect(got, out).toEqual(['SPY', 'QQQ'])
  }, 40000)
  const PANEL_SEEN = SEE_VERBS.map((v, i) => [v, ...SEEN_BOARDS[i % SEEN_BOARDS.length]])
  it.each(PANEL_SEEN)('"%s SPY and AAPL" · %s → the SPY chart is never re-symbolled', async (verb, _b, syms, at, pair) => {
    const [got, out] = await sayWith(syms, at, `${verb} SPY and AAPL`, pair)
    expect(got, out).toEqual(syms)
  }, 40000)
  it.each([['AAPL instead of SPY'], ['swap SPY for AAPL']])('control · SPY · QQQ · "%s" → the SPY chart becomes AAPL', async (words) => {
    const [got, out] = await sayWith(['SPY', 'QQQ'], 0, words)
    expect(got, out).toEqual(['AAPL', 'QQQ'])
  }, 40000)
})

// ── SEEN · REMOVAL (AUDIT N6, 2026-11-16): a removal the words LICENSE ("close the QQQ chart …") passes the removal rail; when the
// plan closes the chart of a ticker the same words ask to SEE ("… and pull up SPY and AAPL"), only the SEEN-STAYS rule reads that
// the seen ticker leaves the board. GENERATED: removal form × every SEE verb × order × board (2 / 3 / 4 charts, SPY in each place):
// the plan closing the SPY chart is refused; the plan closing the chart the words name still applies ──
const rmPlan = (b, ref) => planOps(collectTargets(b.host, ['board', 'chart']), [{ action: 'widget.remove', target: 'board', args: { widget: ref } }], {}, { surface: 'charts' })
const railRm = (syms, ref, words) => {
  const b = boardOf(syms)
  const p = rmPlan(b, ref)
  expect(p.ok).toBe(true)
  return chartRailRefusal(p, { words, host: b.host, mode: 'apply' })
}
const RM_FORMS = ['close the {O} chart', 'remove the {O} chart', 'delete the {O} chart', 'get rid of the {O} chart', 'drop the {O} chart', 'close {O}’s chart']
const RM = []
for (const form of RM_FORMS) for (const verb of SEE_VERBS) for (const order of ['remove first', 'see first']) {
  const [bname, syms, at] = BOARDS[RM.length % BOARDS.length]
  const o = syms.findIndex((s, i) => i !== at)
  const rm = form.replace('{O}', syms[o])
  RM.push([form, verb, order, bname, order === 'remove first' ? `${rm} and ${verb} SPY and AAPL` : `${verb} SPY and AAPL, then ${rm}`, syms, at, o])
}
for (const form of RM_FORMS) for (const [bname, syms, at] of BOARDS) {
  const o = syms.findIndex((s, i) => i !== at)
  RM.push([form, 'pull up', 'remove first', bname, `${form.replace('{O}', syms[o])} and pull up SPY and AAPL`, syms, at, o])
}
describe(`SEEN · REMOVAL · a licensed removal never takes the seen ticker's last chart (${RM.length} cases): removal form × see verb × order × board`, () => {
  it.each(RM)('%s · %s · %s · %s · "%s"', (_f, _v, _o, _b, words, syms, at, o) => {
    expect(railRm(syms, `c${at + 1}`, words), `${words} → closes SPY`).toMatch(leaves('SPY'))
    expect(railRm(syms, `c${o + 1}`, words), `${words} → closes ${syms[o]}`).toBeNull()
  })
  // contradictory words ("remove the SPY chart and show me SPY and AAPL"): the SPY chart is never closed
  it.each(BOARDS.flatMap(([bname, syms, at]) => ['remove the SPY chart and show me SPY and AAPL', 'close the SPY chart, pull up SPY and AAPL'].map(w => [bname, w, syms, at])))('contradiction · %s · "%s" → refused', (_b, words, syms, at) => {
    expect(railRm(syms, `c${at + 1}`, words), words).toMatch(leaves('SPY'))
  })
})
describe('SEEN · REMOVAL · PANEL · the real Agent panel', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  const mountOf = (syms) => {
    const w = Math.floor(24 / syms.length)
    const widgets = syms.map((_, i) => ({ id: `c${i}`, type: 'chart', x: i * w, y: 0, w, h: 20, color: 'N', opts: { settings: bareSettings() } }))
    return p.mount(widgets, Object.fromEntries(syms.map((s, i) => [`N:c${i}`, s])), { decorate: (s) => (s ? { ...s, label: `Chart (${s.symbol || 'empty'})` } : s) })
  }
  const symsLeft = (m) => m.board.state.widgets.filter(w => w.type === 'chart').map(w => m.h.charts.read(w.id)?.symbol || '')
  it.each([[['SPY', 'QQQ'], 0], [['QQQ', 'SPY', 'IWM'], 1]])('%j · "close the QQQ chart and pull up SPY and AAPL", a plan closing the SPY chart → nothing closes', async (syms, at) => {
    const m = mountOf(syms)
    p.st.envelopes.push(() => p.env('apply', [{ action: 'widget.remove', target: 'board', args: { widget: `c${at}` } }]))
    const out = await m.say('close the QQQ chart and pull up SPY and AAPL')
    expect(symsLeft(m), out).toEqual(syms)
  }, 40000)
})
