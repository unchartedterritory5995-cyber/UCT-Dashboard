// AUDIT RULING (11-13) — a ticker the words name as the TARGET outranks the only chart, the click and "the one left"
// (deixis.targetTickerConflict, wired in useAgent after the spatial net). Through the REAL panel (panelHarness), scripted plans:
//   TARGET-SHAPED  "Change AMD to the 1-hour timeframe", "add a 20 EMA to AMD", "make the AMD chart weekly" … while the plan writes
//                  the SPY chart: asked, nothing changes — on a one-chart board, with SPY clicked, and on two charts with an exclusion.
//   VALUE-SHAPED   (the mandatory carve-out) "change this chart to AMD", "switch to AMD", "put AMD on this chart", "replace SPY with
//                  AMD", "show AMD instead", "change SPY to AMD": the symbol change runs — on a one-chart board, with the chart
//                  clicked, and on several charts with the target named. A ticker that is a VALUE of the plan is never a target.
//   DEICTIC        "this chart" / "it" with no target ticker keeps the click rule.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { targetTickers } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const mount = (syms, sel = null) => {
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
const spyRef = (body) => body.context.charts.find(c => c.label === 'Chart (SPY)').ref
const OPS = {
  timeframe: (b) => ({ action: 'chart.setTimeframe', target: spyRef(b), args: { timeframe: '60' } }),
  ema: (b) => ({ action: 'indicator.add', target: b.context.indicatorEdits.find(x => x.symbol === 'SPY').ref, args: { defId: 'ema', inputs: [{ key: 'period', value: 20 }] } }),
  log: (b) => ({ action: 'chart.setScale', target: spyRef(b), args: { scale: 'log' } }),
  bars: (b) => ({ action: 'chart.setType', target: spyRef(b), args: { type: 'bars' } }),
}
const TICKERS = ['AMD', 'TSLA', 'AAPL']

// ── TARGET-SHAPED: asked, nothing written ─────────────────────────────────────────────────────────────────────────────────
const TARGET_SAYS = [
  [(T) => `Change ${T} to the 1-hour timeframe`, 'timeframe'],
  [(T) => `Add a 20 EMA to ${T}`, 'ema'],
  [(T) => `Put ${T} on a log scale`, 'log'],
  [(T) => `Make the ${T} chart hourly`, 'timeframe'],
  [(T) => `Switch ${T} to bars`, 'bars'],
]
const TARGET_CTX = [
  ['one chart', ['SPY'], null, ''],
  ['one chart, an exclusion', ['SPY'], null, ', but not NVDA'],
  ['SPY clicked', ['SPY', 'NVDA'], 'w0', ''],
  ['SPY clicked, an exclusion', ['SPY', 'NVDA'], 'w0', ', but leave my NVDA alone'],
  ['two charts, an exclusion', ['SPY', 'NVDA'], null, ". Don't touch NVDA"],
]
const TARGET_CASES = TICKERS.flatMap(T => TARGET_SAYS.flatMap(([say, op]) => TARGET_CTX.map(([ctx, syms, sel, tail]) => [`${say(T)}${tail}.`, ctx, syms, sel, op])))
describe('TARGET-SHAPED: a ticker named as the chart being changed, the plan on a chart showing another → asked, nothing written', () => {
  it('generated: 3 tickers × 5 phrasings × 5 board/click contexts', () => expect(TARGET_CASES).toHaveLength(75))
  it.each(TARGET_CASES)('"%s" (%s)', async (t, ctx, syms, sel, op) => {
    const m = mount(syms, sel)
    const ids = syms.map((_, i) => `w${i}`)
    const before = snapshot(m.board, ids)
    p.st.envelopes.push((body) => p.env('apply', [OPS[op](body)]))
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, ids), transcript()).toEqual(before)
  }, 60000)
})

// ── VALUE-SHAPED (carve-out): the symbol change runs ──────────────────────────────────────────────────────────────────────
const VALUE_DEICTIC = [(T) => `change this chart to ${T}`, (T) => `switch to ${T}`, (T) => `put ${T} on this chart`, (T) => `replace SPY with ${T}`,
  (T) => `show ${T} instead`, (T) => `change SPY to ${T}`]
const VALUE_NAMED = [(T) => `change the SPY chart to ${T}`, (T) => `change SPY to ${T}`, (T) => `replace SPY with ${T}`, (T) => `switch the left chart to ${T}`,
  (T) => `put ${T} on the left chart`, (T) => `on the SPY chart, show ${T} instead`]
const VALUE_CASES = TICKERS.flatMap(T => [
  ...VALUE_DEICTIC.map(say => [say(T), 'one chart', ['SPY'], null, T]),
  ...VALUE_DEICTIC.map(say => [say(T), 'SPY clicked', ['SPY', 'NVDA'], 'w0', T]),
  ...VALUE_NAMED.map(say => [say(T), 'three charts, the target named', ['SPY', 'NVDA', 'QQQ'], null, T]),
])
describe('VALUE-SHAPED carve-out: a ticker that is the VALUE of a symbol change is no target — the change runs', () => {
  it('generated: 3 tickers × (6 one-chart + 6 clicked + 6 named on three charts)', () => expect(VALUE_CASES).toHaveLength(54))
  it.each(VALUE_CASES)('"%s" (%s) → the SPY chart shows the new ticker', async (t, ctx, syms, sel, T) => {
    const m = mount(syms, sel)
    const others = syms.map((_, i) => `w${i}`).filter(id => id !== 'w0')
    const before = snapshot(m.board, others)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: spyRef(body), args: { symbol: T } }]))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(symOf(m.board, 'w0'), transcript()).toBe(T)
    expect(snapshot(m.board, others)).toEqual(before)
  }, 60000)
})

// ── KNOWN, UNCHANGED (master): "instead of SPY" is read as an EXCLUSION of SPY (spatialCheck NEG_EXCEPT), so "show AMD instead of
// SPY" on several charts asks which of the others is meant. Safe (nothing written) and not this ruling's to change — recorded here.
describe('KNOWN: "show T instead of SPY" on several charts asks (master behaviour, unchanged)', () => {
  it.each(TICKERS)('"show %s instead of SPY": asked, nothing written', async (T) => {
    const m = mount(['SPY', 'NVDA', 'QQQ'])
    const ids = ['w0', 'w1', 'w2'], before = snapshot(m.board, ids)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: spyRef(body), args: { symbol: T } }]))
    await m.say(`show ${T} instead of SPY`)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, ids)).toEqual(before)
  }, 60000)
})

// ── DEICTIC with no target ticker: the click rule as before ──────────────────────────────────────────────────────────────
describe('DEICTIC words with no target ticker keep the click rule', () => {
  it.each([['add a 20 EMA to this chart', 'ema'], ['make it hourly', 'timeframe'], ['put this one on a log scale', 'log'], ['switch this chart to bars, but not NVDA', 'bars']])(
    '"%s" with SPY clicked → applied on SPY', async (t, op) => {
      const m = mount(['SPY', 'NVDA'], 'w0')
      const nvda0 = stored(m.board, 'w1'), spy0 = stored(m.board, 'w0')
      p.st.envelopes.push((body) => p.env('apply', [OPS[op](body)]))
      await m.say(t)
      expect(asked(), transcript()).toBe(false)
      expect(stored(m.board, 'w0'), transcript()).not.toBe(spy0)
      expect(stored(m.board, 'w1')).toBe(nvda0)
    }, 60000)
})

describe('targetTickers: where a ticker stands for the chart being changed', () => {
  it.each([
    ['Change AMD to the 1-hour timeframe', ['AMD']],
    ['add a 20 EMA to AMD', ['AMD']],
    ['make the AMD chart weekly', ['AMD']],
    ['change SPY to AMD', ['SPY', 'AMD']],                   // AMD is dropped as the plan's VALUE by targetTickerConflict
    ['switch to AMD', ['AMD']],                              // likewise
    ['show AMD instead', []],
    ['replace SPY with AMD', []],
    ['add the RSI and MACD to it', []],
    ['put the TTM squeeze on this chart', []],
    ['change SPY to hourly, but leave my NVDA alone', ['SPY']],
    ["Change SPY to hourly. Don't touch AMD.", ['SPY']],
    ['CHANGE AMD TO HOURLY', []],
  ])('"%s" → %j', (t, want) => expect(targetTickers(t)).toEqual(want))
})
