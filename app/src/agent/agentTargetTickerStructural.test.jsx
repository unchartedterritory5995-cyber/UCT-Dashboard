// AUDIT held-out probe 34 (11-13) — the target-ticker rule is STRUCTURAL: any ticker the change words carry (whatever its
// position, verb or punctuation; in capitals, or not in capitals when the client knows it as a ticker) that is not on the chart
// the plan writes → asked, 0 writes. Through the REAL panel (panelHarness; its ticker search answers from the fixture table, as
// the backend does), scripted plans on the SPY chart:
//   TARGET     6 positions × 4 punctuation (colon, comma, dash, none) × 3 casings (AMD / amd / Amd) × 3 boards → asked, 0 writes
//   VALUE      the carve-out: "switch to T", "make this one T", "load T here instead", "replace SPY with T", "change SPY to T"
//              × 3 casings × 3 boards → the symbol change runs
//   ON-BOARD   the ticker IS the written chart ("SPY: weekly", "take spy to weekly", …) × 3 boards → the change runs
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, fixture ticker search, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { _resetGrounding } from './nl/tickers'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { _resetGrounding(); p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const mount = (syms, sel) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean/i.test(transcript())
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const symOf = (b, id) => b.state.groupSyms[`N:${id}`]
const snapshot = (b, ids) => ids.map(id => [stored(b, id), symOf(b, id)])
const ids = (syms) => syms.map((_, i) => `w${i}`)
const spyRef = (body) => body.context.charts.find(c => c.label === 'Chart (SPY)').ref
const weekly = (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: spyRef(body), args: { timeframe: 'W' } }])

const BOARDS = [['one chart', ['SPY'], null], ['SPY clicked', ['SPY', 'NVDA'], 'w0'], ['three charts', ['SPY', 'NVDA', 'QQQ'], null]]
const CASINGS = [['upper', (t) => t.toUpperCase()], ['lower', (t) => t.toLowerCase()], ['mixed', (t) => t[0].toUpperCase() + t.slice(1).toLowerCase()]]
const PUNCT = [['colon', ':'], ['comma', ','], ['dash', ' -'], ['none', '']]
// positions: where the ticker stands and what joins it (P = the punctuation under test)
const POSITIONS = [
  ['subject first', (T, P) => `${T}${P} weekly please`],
  ['after "take"', (T, P) => `take ${T}${P} to weekly`],
  ['after "bump … up"', (T, P) => `bump ${T} up${P} to weekly`],
  ['subject + modal', (T, P) => `${T}${P} should be on weekly`],
  ['object at the end', (T, P) => `weekly${P} for ${T}`],
  ['with an exclusion', (T, P) => `change ${T} to weekly${P} leave nvda alone`],
]

describe('TARGET (structural): any ticker not on the written chart → asked, 0 writes', () => {
  const CASES = []
  for (const [pos, say] of POSITIONS) for (const [pn, P] of PUNCT) for (const [cn, cased] of CASINGS) for (const [bn, syms, sel] of BOARDS) {
    CASES.push([say(cased('amd'), P), `${pos} · ${pn} · ${cn} · ${bn}`, syms, sel])
  }
  it('generated: 6 positions × 4 punctuation × 3 casings × 3 boards', () => expect(CASES).toHaveLength(216))
  it.each(CASES)('"%s" (%s)', async (t, label, syms, sel) => {
    const m = mount(syms, sel)
    const before = snapshot(m.board, ids(syms))
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, ids(syms)), transcript()).toEqual(before)
  }, 60000)
})

describe('VALUE carve-out: the ticker is the value of the symbol change → it runs, in every casing', () => {
  const VALUE = [(T) => `switch to ${T}`, (T) => `make this one ${T}`, (T) => `load ${T} here instead`, (T) => `replace SPY with ${T}`, (T) => `change SPY to ${T}`]
  const CASES = []
  for (const say of VALUE) for (const [cn, cased] of CASINGS) for (const [bn, syms, sel] of BOARDS) CASES.push([say(cased('amd')), `${cn} · ${bn}`, syms, sel || (syms.length > 1 ? 'w0' : null)])
  it('generated: 5 shapes × 3 casings × 3 boards', () => expect(CASES).toHaveLength(45))
  it.each(CASES)('"%s" (%s) → the SPY chart shows AMD', async (t, label, syms, sel) => {
    const m = mount(syms, sel)
    const others = ids(syms).filter(id => id !== 'w0')
    const before = snapshot(m.board, others)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: spyRef(body), args: { symbol: 'AMD' } }]))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(symOf(m.board, 'w0'), transcript()).toBe('AMD')
    expect(snapshot(m.board, others)).toEqual(before)
  }, 60000)
})

describe('ON-BOARD subject: the ticker IS the written chart → the change runs', () => {
  const ON = ['SPY: weekly', 'spy on weekly please', 'Take SPY to weekly', 'Spy, weekly', 'take spy to weekly', 'SPY - weekly']
  const CASES = ON.flatMap(t => BOARDS.map(([bn, syms, sel]) => [t, bn, syms, sel]))
  it.each(CASES)('"%s" (%s) → weekly on SPY only', async (t, bn, syms, sel) => {
    const m = mount(syms, sel)
    const others = ids(syms).filter(id => id !== 'w0')
    const before = snapshot(m.board, others)
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(m.board.state.widgets[0].opts.tf, transcript()).toBe('W')
    expect(snapshot(m.board, others)).toEqual(before)
  }, 60000)
})

describe('no false ask: ordinary words and acronyms in capitals', () => {
  it.each([['make ALL charts weekly', ['SPY', 'NVDA']], ['make it WEEKLY now', ['SPY']], ['add the RSI and the 20 EMA', ['SPY']], ['set the EMA20 to weekly', ['SPY']],
    ['OK put it on weekly', ['SPY']], ['put THIS one on weekly', ['SPY', 'NVDA']]])('"%s" (SPY clicked when several) → runs', async (t, syms) => {
    const m = mount(syms, syms.length > 1 ? 'w0' : null)
    const spy0 = JSON.stringify(m.board.state.widgets[0])
    p.st.envelopes.push((body) => p.env('apply', /all charts/i.test(t)
      ? body.context.charts.map(c => ({ action: 'chart.setTimeframe', target: c.ref, args: { timeframe: 'W' } }))
      : [{ action: 'chart.setTimeframe', target: spyRef(body), args: { timeframe: 'W' } }]))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(JSON.stringify(m.board.state.widgets[0]), transcript()).not.toBe(spy0)   // (some go the instant way: the change is theirs)
  }, 60000)
})
