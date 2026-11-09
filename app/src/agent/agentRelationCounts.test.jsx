// unseen9 P2 (SIMULATED): references UCT asked about although they are clear.
//   - a COUNTED relation: "the chart two to the left" (SIX, bottom-right clicked) is the bottom-left chart;
//   - a PLURAL relation: "both charts to the right of this one" (THREE, left clicked) is the middle AND the right chart;
//   - "all but the QQQ chart" is "every chart except the QQQ chart".
// Through the REAL panel on the fixture board; the meant plan is scripted in case the model is asked, and a plan on the click
// (the anchor) must never run. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { relativeChart } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel({ tickers: ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y, w = 8) => ({ id, type: 'chart', x, y, w, h: 10, color: 'N', opts: { settings: bareSettings() } })
// 3×2: top t0 t1 t2, bottom b0 b1 b2
const SIX = [cell('t0', 0, 0), cell('t1', 8, 0), cell('t2', 16, 0), cell('b0', 0, 10), cell('b1', 8, 10), cell('b2', 16, 10)]
const SIX_SYMS = Object.fromEntries(SIX.map((w, i) => [`N:${w.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'][i]]))
const THREE = [cell('r0', 0, 0), cell('r1', 8, 0), cell('r2', 16, 0)]
const THREE_SYMS = { 'N:r0': 'SPY', 'N:r1': 'QQQ', 'N:r2': 'IWM' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart do you mean|Did you mean|Which charts/.test(transcript())
const tf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const log = (b, id) => !!b.state.widgets.find(w => w.id === id).opts?.settings?.logScale
const rsi = (b, id) => (b.state.widgets.find(w => w.id === id).opts?.settings?.indicatorInstances || []).some(i => i.defId === 'rsi' && !i.deleted)
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const editsOf = (body, id) => (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`).ref
async function run(widgets, syms, clicked, plan, text) {
  const m = p.mount(widgets, syms, { decorate: label })
  if (clicked) p.select(clicked)
  if (plan) p.st.envelopes.push(plan)
  await m.say(text)
  return m.board
}

describe('relativeChart: counted and plural relations', () => {
  const at = (ref, x, y) => ({ ref, cell: { x, y, w: 8, h: 10 } })
  const S = [at('t0', 0, 0), at('t1', 8, 0), at('t2', 16, 0), at('b0', 0, 10), at('b1', 8, 10), at('b2', 16, 10)]
  const hit = (t, sel) => relativeChart(t, S, sel)?.hits.map(c => c.ref) ?? null
  it.each([
    ['add rsi to the chart two to the left', 'b2', ['b0']], ['the one two to the right of this', 't0', ['t2']],
    ['the chart one to the left of this one', 'b2', ['b1']], ['the chart two to the left of it', 'b1', []],      // nothing two to its left
    ['both charts to the right of this one', 't0', ['t1', 't2']], ['the two charts to the left of this', 'b2', ['b0', 'b1']],
    ['all the charts to the right of this one', 'b0', ['b1', 'b2']],
  ])('%s (clicked %s) → %j', (t, sel, want) => expect(hit(t, sel)).toEqual(want))
})

describe('through the panel', () => {
  it('"add rsi to the chart two to the left" (SIX, bottom-right clicked): RSI on the bottom-left only', async () => {
    const b = await run(SIX, SIX_SYMS, 'b2', (body) => p.env('apply', [{ action: 'indicator.add', target: editsOf(body, 'b0'), args: { defId: 'rsi', inputs: null } }]), 'add rsi to the chart two to the left')
    expect(SIX.map(w => rsi(b, w.id)), transcript()).toEqual([false, false, false, true, false, false])
    expect(asked()).toBe(false)
  }, 40000)
  it('NEGATIVE "add rsi to the chart two to the left" with a plan on the CLICK: never run there', async () => {
    const b = await run(SIX, SIX_SYMS, 'b2', (body) => p.env('apply', [{ action: 'indicator.add', target: editsOf(body, 'b2'), args: { defId: 'rsi', inputs: null } }]), 'add rsi to the chart two to the left')
    expect(SIX.map(w => rsi(b, w.id)), transcript()).toEqual([false, false, false, false, false, false])
  }, 40000)
  it('"both charts to the right of this one on log" (THREE, left clicked): the middle and the right go log, the click does not', async () => {
    const plan = (body) => p.env('apply', ['r1', 'r2'].map(id => ({ action: 'chart.setScale', target: refOf(body, id), args: { scale: 'log' } })))
    const b = await run(THREE, THREE_SYMS, 'r0', plan, 'both charts to the right of this one on log')
    expect(THREE.map(w => log(b, w.id)), transcript()).toEqual([false, true, true])
    expect(asked()).toBe(false)
  }, 40000)
  it('"all but the QQQ chart on the weekly" (SIX) does what "every chart except the QQQ chart on the weekly" does', async () => {
    const plan = (body) => p.env('apply', SIX.filter(w => w.id !== 't1').map(w => ({ action: 'chart.setTimeframe', target: refOf(body, w.id), args: { timeframe: 'W' } })))
    // the same outcome on both phrasings: the same charts changed, and the same kind of answer (applied, a card, or a question)
    const kind = () => (/Apply/.test(transcript()) && screen.queryAllByRole('button', { name: 'Apply' }).length ? 'card' : asked() ? 'asked' : 'applied')
    const a = await run(SIX, SIX_SYMS, null, plan, 'every chart except the QQQ chart on the weekly')
    const want = { tfs: SIX.map(w => tf(a, w.id)).join(''), kind: kind() }
    const wantText = transcript()
    cleanup(); p = setupPanel({ tickers: ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'] })
    const b = await run(SIX, SIX_SYMS, null, plan, 'all but the QQQ chart on the weekly')
    expect({ tfs: SIX.map(w => tf(b, w.id)).join(''), kind: kind() }, `except: ${wantText.slice(-300)} | all but: ${transcript().slice(-300)}`).toEqual(want)
    expect(want.kind, wantText.slice(-300)).not.toBe('asked')                      // "except" names its charts: nothing to ask
  }, 60000)
})
