// EXCLUSION — NEGATED RELATIVE CLAUSES (pl-exclneg, AUDIT T2 b9) through the REAL panel (AgentPanel + useAgent + planner + policy +
// runtime + the board writer), on the AUDIT 2×2 (SPY weekly; QQQ, NVDA, AAPL daily), per family (chart.setTimeframe,
// indicator.add), apply AND propose:
//   - a negated relative ("except the ones that are NOT on daily", "apart from whatever isn't weekly") is the exact COMPLEMENT: a
//     model plan on every chart never applies, cards or offers an excluded chart; a plan on exactly the other charts is applied;
//   - a double negative / odd form ("aren't not daily", "unless they're not daily") is UNPLACED: nothing applied, nothing offered.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const W = 12, H = 10
const IDS = ['TL', 'TR', 'BL', 'BR']
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AAPL']
const TFS = ['W', null, null, null]
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const mount = () => {
  const widgets = IDS.map((id, i) => ({ id, x: (i % 2) * W, y: Math.floor(i / 2) * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings(), ...(TFS[i] ? { tf: TFS[i] } : {}) } }))
  return p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
}
const stored = (b, id) => JSON.stringify(b.state.widgets.find(x => x.id === id))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cardText = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const buttons = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent).filter(t => /Chart \(/.test(t))

const FAMILIES = {
  'chart.setTimeframe': {
    plan: (disp, ids, tf = 'M') => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: tf } }))),
    changed: (b, tf = 'M') => b.state.widgets.filter(x => x.opts?.tf === tf).map(x => x.id),
    verb: 'set every chart to monthly',
  },
  'indicator.add': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'indicator.add', target: body.context.indicatorEdits.find(c => c.chart === `Chart (${id})`).ref, args: { defId: 'rsi', inputs: null } }))),
    changed: (b) => IDS.filter(id => p.instancesOn(b, id).some(i => i.defId === 'rsi')),
    verb: 'add RSI to every chart',
  },
}
// [the exclusion words (after the verb), the charts no plan may touch, or offer]
const CASES = [
  [' except the ones that are not on daily', ['TL']],              // the AUDIT b9 sentence
  [" apart from whatever isn't weekly", ['TR', 'BL', 'BR']],
  [" except the ones that aren't daily", ['TL']],
  [' except the non-daily ones', ['TL']],
  [' except the ones that are anything but daily', ['TL']],
  [" except whatever's other than daily", ['TL']],
  [", but leave the ones that aren't SPY alone", ['TR', 'BL', 'BR']],
  [' excluding those not on weekly', ['TR', 'BL', 'BR']],
  // double negatives, odd forms, a negated list: UNPLACED — nothing applied, nothing offered
  [" except the ones that aren't not daily", IDS],
  [" unless they're not daily", IDS],
  [' except the ones that are nothing but daily', IDS],
  [" except the ones that aren't daily or weekly", IDS],
]
const ROWS = Object.entries(FAMILIES).flatMap(([fam, f]) => CASES.map(([x, ex]) => [fam, `${f.verb}${x}`, ex, f]))

describe('a model plan on every chart: no excluded chart is applied, carded or offered', () => {
  it.each(ROWS)('%s · "%s"', async (_fam, t, ex, f) => {
    for (const disp of ['apply', 'propose']) {
      cleanup(); p = setupPanel()
      const m = mount()
      const before = Object.fromEntries(IDS.map(id => [id, stored(m.board, id)]))
      p.st.envelopes.push(f.plan(disp, IDS))
      await m.say(t)
      for (const id of ex) expect(stored(m.board, id), `${disp} · ${id} changed\n${transcript()}`).toBe(before[id])
      expect(f.changed(m.board).filter(id => ex.includes(id)), `${disp}\n${transcript()}`).toEqual([])
      for (const id of ex) {
        expect(buttons().join(' '), `${disp} · ${id} offered\n${transcript()}`).not.toMatch(new RegExp(`Chart \\(${id}\\)`))
        expect(cardText(), `${disp} · ${id} carded\n${transcript()}`).not.toMatch(new RegExp(`Chart \\(${id}\\)`))
      }
    }
  }, 60000)
})

describe('a model plan on exactly the other charts is honoured (the complement is exact)', () => {
  const EXACT = [
    ['chart.setTimeframe', 'set every chart to monthly except the ones that are not on daily', ['BL', 'BR', 'TR']],
    // (a single-chart indicator.add under "every chart" is asked on this base whatever the exclusion: a pre-existing safe over-ask)
    ['indicator.add', "add RSI to every chart apart from whatever isn't daily", ['BL', 'BR', 'TR']],
    ['chart.setTimeframe', "set every chart to monthly apart from whatever isn't weekly", ['TL']],
    ['indicator.add', 'add RSI to every chart except the non-daily ones', ['BL', 'BR', 'TR']],
    ['chart.setTimeframe', "set every chart to monthly, but leave the ones that aren't SPY alone", ['TL']],
  ]
  it.each(EXACT)('%s · "%s" → applied on %j only', async (fam, t, rest) => {
    const f = FAMILIES[fam]
    const m = mount()
    p.st.envelopes.push(f.plan('apply', rest))
    await m.say(t)
    expect(f.changed(m.board).sort(), transcript()).toEqual(rest)
  }, 60000)
})
