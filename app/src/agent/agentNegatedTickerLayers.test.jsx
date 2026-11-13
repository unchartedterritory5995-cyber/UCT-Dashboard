// HOTFIX (negated-ticker targeting) — PER-LAYER rails. The exclusion is enforced in several layers; each rail below exercises
// ONE layer with the others STUBBED OUT, so disabling that one layer alone turns its own rail red (proved by a mutant per
// layer, run and reverted; see the hotfix report). Layer 1, the reader, is agentNegatedTickerReader.test.js (pure unit).
//   L2  spatial last net        spatialCheck.checkSpatialConstraints: a plan on the excluded chart is asked, never run
//   L3  spatial options filter  checkSpatialConstraints' choices: never an excluded chart nor one an unplaced exclusion may mean
//   L4  plan-exclusion step     useAgent.execute's excluded-chart gate (withoutExcludedCharts): the excluded op is dropped
//   L5  approval gate           useAgent.execute on an APPROVED card: a card carrying the excluded chart is refused
//   L6  question filter         useAgent's dropExcluded: a screen's "Which chart?" never offers the excluded chart
// LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel; L2 / L3 unit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'

// each flag stubs one layer OUT (a pass-through that enforces nothing)
const off = { spatial: false, gate: false, set: false }
vi.mock('./spatialCheck', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    checkSpatialConstraints: (args) => (off.spatial ? null : real.checkSpatialConstraints(args)),
    withoutExcludedCharts: (ops, ...rest) => (off.gate ? { ops, dropped: 0 } : real.withoutExcludedCharts(ops, ...rest)),
    everyExceptSet: (...a) => (off.set ? null : real.everyExceptSet(...a)),
  }
})
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const real = await vi.importActual('./spatialCheck')
const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()

let p
const reset = () => { off.spatial = false; off.gate = false; off.set = false }
beforeEach(() => { p = setupPanel(); reset() })
afterEach(() => { reset(); vi.restoreAllMocks(); cleanup() })

// ── L2 / L3: the spatial last net, unit (no panel, no useAgent) ──
const CELL = (i) => ({ x: (i % 2) * 8, y: Math.floor(i / 2) * 10, w: 8, h: 10 })
const board = (syms) => syms.map((s, i) => ({ ref: `c${i}`, label: `Chart (${s}${i})`, symbol: s, cell: CELL(i), position: ['top-left', 'top-right', 'bottom-left', 'bottom-right'][i] }))
const hostOf = (charts) => ({ charts: { list: () => charts, selected: () => null } })
const KIND = (charts) => ({ name: 'chart', list: () => charts.map(c => ({ ref: c.ref, label: c.label })) })
const unitCheck = (charts, text, targets) => real.checkSpatialConstraints({
  host: hostOf(charts), text, ops: targets.map(t => ({ action: 'chart.setTimeframe', target: t, args: { timeframe: 'W' } })),
  getCapability: () => ({ target: 'chart' }), getTargetKind: () => KIND(charts),
})
describe('L2 spatial last net: a plan on the excluded chart is asked (never run)', () => {
  const B = board(['SPY', 'QQQ', 'NVDA', 'AMD'])
  it.each([["set all charts to weekly, but leave NVDA's alone"], ['all charts weekly; dont touch NVDA'], ['Set every chart to weekly. Not the NVDA chart though.'],
    ['hands off the NVDA chart, set all charts to weekly'], ['Set every chart to weekly. Leave NVDA out of it.']])('"%s"', (t) => {
    const r = unitCheck(B, t, ['c0', 'c1', 'c2', 'c3'])
    expect(r?.ask).toBeTruthy()
    expect(r.violation.bad).toContain('c2')
    expect(r.ask.choices.map(c => c.ref)).not.toContain('c2')
    expect(unitCheck(B, t, ['c0', 'c1', 'c3'])).toBeNull()               // control: the plan without NVDA passes
  })
})
describe('L3 spatial options filter: never a chart an unplaced exclusion may mean', () => {
  const T = board(['SPY', 'TSLA', 'NVDA', 'TSLA'])
  it.each([['set every chart to weekly; dont touch TSLA'], ["set all charts to weekly, but leave TSLA's alone"], ['set every chart to weekly except the TSLA one']])('"%s"', (t) => {
    const r = unitCheck(T, t, ['c0', 'c1', 'c2', 'c3'])
    expect(r?.ask).toBeTruthy()
    expect(r.ask.choices.map(c => c.ref).sort()).toEqual(['c0', 'c2'])
  })
})

// ── L4 / L5 / L6: useAgent's layers through the real panel, the spatial net (and the set question) stubbed out ──
const W = 8, H = 10
const IDS = [['TL', 0, 0], ['TR', 0, 1], ['BL', 1, 0], ['BR', 1, 1]]
const transcript = () => screen.getByTestId('agent-transcript').textContent
const mount = () => {
  const widgets = IDS.map(([id, r, c]) => ({ id, x: c * W, y: r * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  return p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'NVDA', 'AMD'][i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
}
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const tfPlan = (ids, disp = 'apply') => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: refOf(body, id), args: { timeframe: 'W' } })))
const weekly = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const carded = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent).filter(t => /Chart \(/.test(t)).join(' | ')
const ALL = ['TL', 'TR', 'BL', 'BR']
// (phrasings an earlier screen does not already ask about, so the plan reaches execute: the layer under test is the only one)
const WORDS = ["set all charts to weekly, but leave NVDA's alone", 'all charts weekly; dont touch NVDA', 'switch every chart to weekly — hands off the NVDA one']

describe('L4 plan-exclusion step (execute\'s gate), the spatial net and the set question stubbed out', () => {
  it.each(WORDS.map(t => [t]))('"%s": the plan on all four never changes NVDA; the rest is only proposed, NVDA not on the card', async (t) => {
    const m = mount()
    off.spatial = true; off.set = true
    p.st.envelopes.push(tfPlan(ALL))
    await m.say(t)
    expect(weekly(m.board), transcript()).not.toContain('BL')
    expect(carded(), transcript()).not.toContain('Chart (BL)')
    expect(carded(), transcript()).toContain('Chart (TL)')
  }, 40000)
})

describe('L5 approval gate: an approved card that carries the excluded chart is refused', () => {
  it.each(WORDS.map(t => [t]))('"%s": a card forced to carry NVDA (every proposal-time check off) is refused on Apply', async (t) => {
    const m = mount()
    off.spatial = true; off.set = true; off.gate = true                 // the card is made with every proposal-time check off
    p.st.envelopes.push(tfPlan(ALL, 'propose'))
    await m.say(t)
    off.gate = false                                                      // …the approval-time re-check is the layer under test
    expect(carded(), `the forced card must carry NVDA: ${transcript()}`).toContain('Chart (BL)')
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1))
    await p.idle()
    expect(weekly(m.board), transcript()).toEqual([])
    expect(transcript()).toMatch(/excludes/)
  }, 40000)
})

describe('L6 question filter (useAgent dropExcluded), the spatial net stubbed out', () => {
  it.each([["switch to weekly, but leave NVDA's alone", ['TL']], ['make it weekly. Hands off the NVDA chart', ['TR']], ['make it weekly. Leave NVDA out of it.', ['BL']]])(
    '"%s" (plan on %j, no click): the screen\'s question never offers NVDA', async (t, plan) => {
      const m = mount()
      off.spatial = true
      p.st.envelopes.push(tfPlan(plan))
      await m.say(t)
      expect(offered(), transcript()).toMatch(/Chart \(/)
      expect(offered(), transcript()).not.toContain('Chart (BL)')
      expect(weekly(m.board)).toEqual([])
    }, 40000)
  it.each([['switch to weekly; dont touch TSLA'], ["switch to weekly, but leave TSLA's alone"]])(
    '"%s" (TSLA on two charts, plan on SPY, no click): neither TSLA chart is offered', async (t) => {
      const widgets = IDS.map(([id, r, c]) => ({ id, x: c * W, y: r * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
      const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'TSLA', 'NVDA', 'TSLA'][i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
      off.spatial = true
      p.st.envelopes.push(tfPlan(['TL']))
      await m.say(t)
      expect(offered(), transcript()).toMatch(/Chart \(/)
      expect(offered(), transcript()).not.toMatch(/Chart \((?:TR|BR)\)/)
      expect(weekly(m.board)).toEqual([])
    }, 40000)
})
