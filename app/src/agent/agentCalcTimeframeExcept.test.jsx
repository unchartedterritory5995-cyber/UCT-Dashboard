// calc-TF family × the #1143 / #1148 exception rails: "calculate the RSI on weekly on every chart except mine / except NVDA /
// except NVDA's" through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the REAL Indicators interface on
// each chart's stored settings). The scripted model plan ALSO names the excluded chart: that chart must stay byte-for-byte
// untouched (never applied, never carded, never offered); the others get the weekly frame or the request is asked — never the
// excluded one. Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { withInstances } from '../components/chart/engine/instanceControls'
import * as registry from '../components/chart/engine/nativeRegistry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const ACTION = 'indicatorStyle.setCalcTimeframe'
const W = 12, H = 10
const IDS = ['TL', 'TR', 'BL', 'BR']
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AMD']
const withRsi = () => {
  const base = bareSettings()
  const list = [...(base.indicatorInstances || []), { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false }]
  return JSON.parse(JSON.stringify({ ...withInstances(base, list, registry), indicators: { ...(base.indicators || {}), rsi: { enabled: true } } }))
}
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const mount = (sel) => {
  const widgets = IDS.map((id, i) => ({ id, x: (i % 2) * W, y: Math.floor(i / 2) * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: withRsi() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
  p.select(sel)
  return m
}
const settingsOf = (b, id) => JSON.stringify(b.state.widgets.find(x => x.id === id).opts?.settings ?? null)
const weekly = (b) => IDS.filter(id => p.instancesOn(b, id).find(i => i.instanceId === 'inst:rsi:1')?.calculationTimeframe === 'W')
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cardText = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const asked = () => /Which chart|Did you mean|Which charts|Pick one|You said not/i.test(transcript())
// the model's plan: the action on these charts (by the label the panel shows it)
const planOn = (disp, ...ids) => (body) => p.env(disp, ids.map(id => ({ action: ACTION, target: body.context.indicatorEdits.find(c => c.chart === `Chart (${id})`).ref, args: { instance: 'inst:rsi:1', timeframe: 'W' } })))

// [phrasing, clicked chart, the chart it excludes]
const CASES = [
  ['calculate the rsi on weekly bars on every chart except mine', 'TL', 'TL'],
  ['put the rsi on a weekly calculation on every chart except mine', 'BR', 'BR'],
  ['calculate the rsi on weekly on every chart except my chart', 'TR', 'TR'],
  ['calculate the rsi on weekly bars on every chart except NVDA', 'TL', 'BL'],
  ['compute the rsi from weekly bars on all charts except the NVDA one', 'TR', 'BL'],
  // possessive exclusions: the click's ("my own one") and a ticker's ("NVDA's")
  ['calculate the rsi on weekly on every chart except my own one', 'BL', 'BL'],
  ["calculate the rsi on weekly on every chart except NVDA's", 'TL', 'BL'],
]

describe('every chart EXCEPT one: the excluded chart is never touched, even when the model plans it', () => {
  it.each(CASES.map(c => [c[0], c[1], c[2]]))('"%s" (clicked %s, excludes %s): a plan including it is never applied, carded or offered', async (t, sel, ex) => {
    for (const disp of ['apply', 'propose']) {
      cleanup(); p = setupPanel()
      const m = mount(sel)
      const before = settingsOf(m.board, ex)
      p.st.envelopes.push(planOn(disp, ...IDS))
      await m.say(t)
      expect(settingsOf(m.board, ex), transcript()).toBe(before)
      expect(weekly(m.board), transcript()).not.toContain(ex)
      expect(cardText(), transcript()).not.toContain(`Chart (${ex})`)
      expect(offered(), transcript()).not.toContain(ex)
    }
  }, 60000)
  it.each(CASES.map(c => [c[0], c[1], c[2]]))('"%s" (clicked %s): the plan on the OTHER charts runs, or is asked — never the excluded one', async (t, sel, ex) => {
    const m = mount(sel)
    const others = IDS.filter(id => id !== ex)
    p.st.envelopes.push(planOn('apply', ...others))
    await m.say(t)
    const ran = weekly(m.board)
    expect(ran, transcript()).not.toContain(ex)
    expect(ran.length === 0 ? asked() || cardText().length > 0 : ran.join() === [...others].sort((a, b) => IDS.indexOf(a) - IDS.indexOf(b)).join(), transcript()).toBe(true)
  }, 60000)
  it('control: with no exception the same plan changes every chart (so the rail above is not passing on a dead path)', async () => {
    const m = mount('TL')
    p.st.envelopes.push(planOn('apply', ...IDS))
    await m.say('calculate the rsi on weekly bars on every chart')
    expect(weekly(m.board), transcript()).toEqual(IDS)
  }, 60000)
})

// the reader beneath the rails: a BARE ticker possessive is that ticker's chart; anything that could re-aim it stays unplaced
import { excludedCharts, UNPLACED } from './spatialCheck'
describe('excludedCharts: a ticker possessive ("except NVDA\'s")', () => {
  const B = [{ ref: 'a', symbol: 'SPY', position: 'top-left' }, { ref: 'b', symbol: 'QQQ', position: 'top-right' },
    { ref: 'c', symbol: 'NVDA', position: 'bottom-left' }, { ref: 'd', symbol: 'AMD', position: 'bottom-right' }]
  it.each([["calculate the rsi on weekly on every chart except NVDA's", 'c'], ["make every chart weekly except NVDA's chart", 'c'],
    ["make every chart weekly apart from AMD's one", 'd'], ["make every chart weekly other than QQQ's", 'b']])('"%s" → that chart', (t, ref) => {
    expect([...excludedCharts(t, B, 'a')]).toEqual([ref])
  })
  it.each([["every chart except SPY's neighbour goes weekly"], ["make every chart weekly except TSLA's"]])('"%s" → unplaced (asked), as before', (t) => {
    expect([...excludedCharts(t, B, 'a')]).toEqual([UNPLACED])
  })
  it.each([["make every chart weekly except Apple's earnings day"]])('"%s" → nothing (not a chart)', (t) => {
    expect([...excludedCharts(t, B, 'a')]).toEqual([])
  })
})
