// "THE OTHER ONE" IN ONE CLAUSE (pl-exec, AUDIT priority interrupt 2026-11-07). On a board of TWO with a chart clicked, a plain
// "the other one" / "the other chart" names the chart that is NOT the click, and the click is EXCLUDED: a plan on the other chart
// runs; a plan on the click is asked about, never run. pl-teach's guide-side rule holds: "one" as the verb's object after a thing it
// can stand for ("two lines … delete the other one") is that thing, not a chart. Own phrasings, paired in both directions.
// Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { screenUnnamedTargets } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x) => ({ id, type: 'chart', x, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const TWO = [cell('a', 0), cell('b', 12)]
const SYMS = { 'N:a': 'SPY', 'N:b': 'QQQ' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const w = (b, id) => b.state.widgets.find(x => x.id === id)
const tfOf = (b, id) => w(b, id).opts?.tf || 'D'
const indOn = (b, id) => (w(b, id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted)
const tfPlan = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])
const indPlan = (id, defId) => (body) => p.env('apply', [{ action: 'indicator.add', target: (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`).ref, args: { defId } }])
const mount = (clicked) => { const m = p.mount(TWO, SYMS, { decorate: label }); p.select(clicked); return m }

const TF = ['switch the other one to weekly', 'the other chart should be on the weekly', 'can you put the other one on a weekly timeframe']
const IND = [['stick a MACD on the other one', 'macd'], ['give the other chart an RSI', 'rsi'], ['the other one needs a stochastic', 'stoch']]

describe('"the other one" excludes the click (two charts, one clause)', () => {
  it.each(TF.flatMap(t => [[t, 'a', 'b'], [t, 'b', 'a']]))('%s (clicked %s): the plan on the other chart (%s) runs', async (t, clicked, other) => {
    const { say, board: b } = mount(clicked)
    p.st.envelopes.push(tfPlan(other))
    const out = await say(t)
    expect(tfOf(b, other), out).toBe('W')
    expect(tfOf(b, clicked)).toBe('D')
  }, 30000)
  it.each(TF)('NEGATIVE %s (clicked a): a plan on the click is asked about, nothing changes', async (t) => {
    const { say, board: b } = mount('a')
    p.st.envelopes.push(tfPlan('a'))
    const out = await say(t)
    expect(`${tfOf(b, 'a')}${tfOf(b, 'b')}`, out).toBe('DD')
    expect(out).toMatch(/Which chart do you mean|check this first/)
  }, 30000)
  it.each(IND)('%s (clicked a): the plan on the other chart runs', async (t, defId) => {
    const { say, board: b } = mount('a')
    p.st.envelopes.push(indPlan('b', defId))
    const out = await say(t)
    expect(indOn(b, 'b'), out).toBe(true)
    expect(indOn(b, 'a')).toBe(false)
  }, 30000)
  it.each(IND)('NEGATIVE %s (clicked a): a plan on the click is asked about, nothing is added', async (t, defId) => {
    const { say, board: b } = mount('a')
    p.st.envelopes.push(indPlan('a', defId))
    const out = await say(t)
    expect(indOn(b, 'a'), out).toBe(false)
    expect(indOn(b, 'b')).toBe(false)
  }, 30000)
})

describe('the screen itself: "one" standing for a thing named before it is not a chart (pl-teach T1e/T1f)', () => {
  const host = (sel) => ({ charts: { list: () => [{ ref: 'a', label: 'A' }, { ref: 'b', label: 'B' }], selected: () => sel } })
  const kind = { list: () => [{ ref: 'a' }, { ref: 'b' }] }
  const screen = (text, onRef) => screenUnnamedTargets({ host: host('a'), ops: [{ action: 'x', target: onRef }], text, getCapability: () => ({ target: 'chart' }), getTargetKind: () => ({ ...kind, name: 'chart' }) })
  it('"the other one" alone: the other chart passes, the click is asked', () => {
    expect(screen('make the other one weekly', 'b')).toBe(null)
    const r = screen('make the other one weekly', 'a'); expect(r?.ask || r?.propose, JSON.stringify(r)).toBeTruthy()
  })
  it('"two lines … delete the other one": the one is a line; the click answers as before', () => {
    expect(screen('I drew two lines here, delete the other one', 'a')).toBe(null)
    expect(screen('I drew two lines here, delete the other one', 'b')?.ask).toBeTruthy()
  })
  it('"this one and the other one" (two clauses): both charts are named', () => {
    expect(screen('weekly on this one and on the other one', 'a')).toBe(null)
    expect(screen('weekly on this one and on the other one', 'b')).toBe(null)
  })
})
