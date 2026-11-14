// PRODUCTION (owner, 11-13): Left SPY daily, Right NVDA daily — "Change SPY to the 1-hour timeframe, add a 20 EMA to it, but leave my
// NVDA chart alone." ASKED "Which chart do you mean?". The pronoun "it" made the request DEICTIC (deixis.pointsAtChart), and the
// deictic resolver (deixis.resolveDeictic) read a chart only from a click, a relation, a position or "the SPY chart" — never from a
// bare ticker the same words had already named ("Change SPY to …"), so with no click it asked. The same request without "it" ran.
// Through the REAL panel (panelHarness: AgentPanel + useAgent + the board writer + Undo), the scripted model plan as stated:
//   COMPOUND   every op of a compound on the ticker's chart lands there, the other chart is byte-identical, one Undo restores both
//              — generated: op pairs × anaphor ("it" / "that chart" / "that one" / none) × exclusion phrasing × board side
//   AMBIGUITY  never loosened: the ticker on two charts asks; a ticker not on the board writes nothing; "leave my SPY alone" while
//              the plan acts on SPY asks; a click on the OTHER chart with "it" still asks (the click is never silently overruled)
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const transcript = () => screen.getByTestId('agent-transcript').textContent
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
// N charts in one row (w0, w1, …), labelled "Chart (<symbol>)" by the harness; the daily timeframe STORED (an Undo writes it back
// explicitly, so a chart that stored none would differ only by `tf: "D"`)
const mount = (syms, sel = null) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const chartRef = (body, sym) => body.context.charts.find(c => c.label === `Chart (${sym})`).ref
const ixeRef = (body, sym) => body.context.indicatorEdits.find(x => x.symbol === sym).ref
const OPS = {
  timeframe: (b, s) => ({ action: 'chart.setTimeframe', target: chartRef(b, s), args: { timeframe: '60' } }),
  ema: (b, s) => ({ action: 'indicator.add', target: ixeRef(b, s), args: { defId: 'ema', inputs: [{ key: 'period', value: 20 }] } }),
  bars: (b, s) => ({ action: 'chart.setType', target: chartRef(b, s), args: { type: 'bars' } }),
  log: (b, s) => ({ action: 'chart.setScale', target: chartRef(b, s), args: { scale: 'log' } }),
}
const plan = (names, sym) => (body) => p.env('apply', names.map(k => OPS[k](body, sym)))
const asked = () => /Which chart|Did you mean/i.test(transcript())
const snapshot = (b, n) => Array.from({ length: n }, (_, i) => stored(b, `w${i}`))

// the op pairs as the member says them: the first clause names the ticker, the second refers back to it (or says nothing)
const PAIRS = [
  ['timeframe+ema', ['timeframe', 'ema'], (S, a) => `Change ${S} to the 1-hour timeframe, add a 20 EMA${a.to}`],
  ['ema+timeframe', ['ema', 'timeframe'], (S, a) => `Add a 20 EMA to ${S} and switch${a.obj} to the 1-hour timeframe`],
  ['bars+timeframe', ['bars', 'timeframe'], (S, a) => `Switch ${S} to bars and put${a.obj} on the 1-hour timeframe`],
  ['log+timeframe', ['log', 'timeframe'], (S, a) => `Put ${S} on a log scale and make${a.obj} 1-hour`],
]
const ANAPHORS = [
  { name: 'it', to: ' to it', obj: ' it' },
  { name: 'that chart', to: ' to that chart', obj: ' that chart' },
  { name: 'that one', to: ' to that one', obj: ' that one' },
  { name: 'none', to: '', obj: '' },
]
const EXCLUSIONS = [
  (O) => `, but leave my ${O} chart alone.`,
  (O) => `, but leave my ${O} alone.`,
  (O) => `. Don't touch ${O}.`,
  (O) => `, but not ${O}.`,
  (O) => `. ${O} stays as is.`,
]
const wordsFor = (pair, ana, S, O, e) => pair[2](S, ana) + EXCLUSIONS[e](O)
const effect = {
  timeframe: (b, id) => tfOf(b, id) === '60',
  ema: (b, id) => p.brief(b, id).includes('movingAverage(20 ema)'),
  bars: (b, id) => /"chartType":"bars"/.test(stored(b, id)),
  log: (b, id) => /"logScale":true/.test(stored(b, id)),
}
// the member says "undo" (the panel has no Undo button): the newest change, once per op of the compound at most
const undo = async (m, done) => { for (let i = 0; i < 3 && !done(); i++) await m.say('undo') }

describe('PRODUCTION: the owner\'s exact ask — SPY left, NVDA right', () => {
  it('"Change SPY to the 1-hour timeframe, add a 20 EMA to it, but leave my NVDA chart alone." → 1h + EMA 20 on SPY only; NVDA untouched; Undo exact', async () => {
    const m = mount(['SPY', 'NVDA'])
    const spy0 = stored(m.board, 'w0'), nvda0 = stored(m.board, 'w1')
    p.st.envelopes.push(plan(['timeframe', 'ema'], 'SPY'))
    await m.say('Change SPY to the 1-hour timeframe, add a 20 EMA to it, but leave my NVDA chart alone.')
    expect(asked(), transcript()).toBe(false)
    expect(tfOf(m.board, 'w0'), transcript()).toBe('60')
    expect(p.brief(m.board, 'w0')).toEqual(['movingAverage(20 ema)'])
    expect(stored(m.board, 'w1')).toBe(nvda0)
    expect(p.turns()).toBe(1)
    await undo(m, () => stored(m.board, 'w0') === spy0)
    expect(stored(m.board, 'w0'), transcript()).toBe(spy0)
    expect(stored(m.board, 'w1')).toBe(nvda0)
  }, 60000)
})

// ── COMPOUND: generated — every op lands on the named ticker's chart, the excluded chart never changes, one Undo restores ───
const GRID = []
for (const pair of PAIRS) for (const ana of ANAPHORS) for (let e = 0; e < EXCLUSIONS.length; e++) for (const side of ['left', 'right']) {
  GRID.push([wordsFor(pair, ana, 'SPY', 'NVDA', e), side, pair[1]])
}
describe('COMPOUND × anaphor × exclusion: both ops on the ticker\'s chart, the exclusion holds for every op', () => {
  it('the grid is generated: 4 op pairs × 4 anaphors × 5 exclusions × 2 sides', () => expect(GRID).toHaveLength(160))
  it.each(GRID)('"%s" (SPY on the %s)', async (t, side, ops) => {
    const m = mount(side === 'left' ? ['SPY', 'NVDA'] : ['NVDA', 'SPY'])
    const spyId = side === 'left' ? 'w0' : 'w1', nvdaId = side === 'left' ? 'w1' : 'w0'
    const spy0 = stored(m.board, spyId), nvda0 = stored(m.board, nvdaId)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    for (const k of ops) expect(effect[k](m.board, spyId), `${k}: ${transcript()}`).toBe(true)
    expect(stored(m.board, nvdaId)).toBe(nvda0)
    await undo(m, () => stored(m.board, spyId) === spy0)
    expect(stored(m.board, spyId), transcript()).toBe(spy0)
    expect(stored(m.board, nvdaId)).toBe(nvda0)
  }, 60000)
})

// ── ANAPHORA alone: the exclusion's "one left" cannot stand in — no exclusion at all, or THREE charts (two left after it) ──────
// (on two charts, "leave NVDA alone" leaves exactly SPY, which already identifies the chart; these isolate the antecedent rule)
const ANA_GRID = []
for (const pair of PAIRS) for (const ana of ANAPHORS) {
  ANA_GRID.push([`${pair[2]('SPY', ana)}.`, ['SPY', 'NVDA'], pair[1]])
  ANA_GRID.push([`${pair[2]('SPY', ana)}.`, ['NVDA', 'SPY'], pair[1]])
  for (let e = 0; e < EXCLUSIONS.length; e++) ANA_GRID.push([wordsFor(pair, ana, 'SPY', 'NVDA', e), ['NVDA', 'SPY', 'QQQ'], pair[1]])
}
describe('ANAPHORA: "it" / "that chart" / "that one" is the chart the ticker named — with no exclusion, and on three charts', () => {
  it('the grid is generated: 4 op pairs × 4 anaphors × (2 two-chart boards + 5 exclusions on three charts)', () => expect(ANA_GRID).toHaveLength(112))
  it.each(ANA_GRID)('"%s" on %j', async (t, syms, ops) => {
    const m = mount(syms)
    const ids = syms.map((_, i) => `w${i}`), spyId = ids[syms.indexOf('SPY')]
    const others = ids.filter(id => id !== spyId).map(id => [id, stored(m.board, id)])
    const spy0 = stored(m.board, spyId)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    for (const k of ops) expect(effect[k](m.board, spyId), `${k}: ${transcript()}`).toBe(true)
    for (const [id, s0] of others) expect(stored(m.board, id)).toBe(s0)
    await undo(m, () => stored(m.board, spyId) === spy0)
    expect(stored(m.board, spyId), transcript()).toBe(spy0)
  }, 60000)
})

// ── AMBIGUITY: never loosened ─────────────────────────────────────────────────────────────────────────────────────────────
const SAMPLE = PAIRS.flatMap(pair => ANAPHORS.map(ana => [pair, ana]))
describe('AMBIGUITY: genuine ambiguity still asks and writes nothing', () => {
  it.each(SAMPLE.map(([pair, ana]) => [wordsFor(pair, ana, 'SPY', 'NVDA', 0), pair[1]]))('"%s" with SPY on TWO charts: asked, nothing changed', async (t, ops) => {
    const m = mount(['SPY', 'NVDA', 'SPY'])
    const before = snapshot(m.board, 3)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, 3)).toEqual(before)
  }, 60000)
  // the words ALSO point at a chart no click names ("this one", "the selected chart"): "it" is not settled by the ticker alone
  it.each(SAMPLE.filter(([, ana]) => ana.name === 'it' || ana.name === 'that chart').flatMap(([pair, ana]) => ['and do the same on this one', 'and the selected chart too']
    .map(x => [`${pair[2]('SPY', ana)}, ${x}.`, pair[1]])))('"%s" (no click): asked, nothing changed', async (t, ops) => {
    const m = mount(['SPY', 'NVDA'])
    const before = snapshot(m.board, 2)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, 2)).toEqual(before)
  }, 60000)
  it.each(SAMPLE.flatMap(([pair, ana]) => [0, 1, 2, 3, 4].map(e => [wordsFor(pair, ana, 'AMD', 'NVDA', e), pair[1]])))('"%s" with AMD not on the board (the plan on SPY): asked, nothing changed', async (t, ops) => {
    const m = mount(['SPY', 'NVDA'])
    const before = snapshot(m.board, 2)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, 2), transcript()).toEqual(before)
  }, 60000)
  it.each(SAMPLE.flatMap(([pair, ana]) => [0, 1, 2, 3, 4].map(e => [wordsFor(pair, ana, 'SPY', 'SPY', e), pair[1]])))('"%s" (excludes the very chart it names; the plan on SPY): asked, nothing changed', async (t, ops) => {
    const m = mount(['SPY', 'NVDA'])
    const before = snapshot(m.board, 2)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, 2)).toEqual(before)
  }, 60000)
  it.each(SAMPLE.flatMap(([pair, ana]) => [0, 1, 2, 3, 4].map(e => [wordsFor(pair, ana, 'SPY', 'NVDA', e), pair[1]])))('"%s" — the plan ALSO changes NVDA: the NVDA chart never changes', async (t, ops) => {
    const m = mount(['SPY', 'NVDA'])
    const nvda0 = stored(m.board, 'w1')
    p.st.envelopes.push((body) => p.env('apply', [...ops.map(k => OPS[k](body, 'SPY')), ...ops.map(k => OPS[k](body, 'NVDA'))]))
    await m.say(t)
    expect(stored(m.board, 'w1'), transcript()).toBe(nvda0)
  }, 60000)
  // ("that one" is not deictic: a ticker the words name outranks the click there, as on master — not this rail)
  it.each(SAMPLE.filter(([, ana]) => ana.name === 'it' || ana.name === 'that chart').map(([pair, ana]) => [`${pair[2]('SPY', ana)}.`, pair[1]]))('"%s" with the NVDA chart CLICKED: the click is not overruled — asked, nothing changed', async (t, ops) => {
    const m = mount(['SPY', 'NVDA'], 'w1')
    const before = snapshot(m.board, 2)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, 2)).toEqual(before)
  }, 60000)
})
