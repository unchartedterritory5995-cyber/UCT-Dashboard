// EXCLUSION OBJECTS through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the board writer). The two
// production holes (pl-relfu report, AUDIT 11-23 T2), on a 2×2 of 1 weekly + 3 daily charts (SPY weekly; QQQ, NVDA, AAPL daily),
// per family (chart.setTimeframe, indicator.add), apply AND propose:
//   (1) "set every chart to monthly but not the daily ones" with a model plan on all 4 APPLIED to all 4 → now nothing is applied
//       or carded on a daily chart, and no question offers one; a plan on exactly the weekly chart is applied.
//   (2) "set all to weekly except SPY, QQQ and NVDA" offered QQQ and NVDA → no excluded chart is applied, carded or offered; a
//       plan on exactly AAPL is applied.
// …and their classes: a conjunction of descriptions ("leave the daily ones and the weekly one alone"), "apart from the dailies",
// "leave the ones on daily alone", a 3-item list with "or" / "&", a mixed description + ticker list.
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
const TFS = ['W', null, null, null]                                  // SPY weekly; the rest daily
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
    tf: 'M',
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'M' } }))),
    changed: (b) => b.state.widgets.filter(x => x.opts?.tf === 'M').map(x => x.id),
    verb: { monthly: 'set every chart to monthly', weekly: 'set all to monthly' },
  },
  'indicator.add': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'indicator.add', target: body.context.indicatorEdits.find(c => c.chart === `Chart (${id})`).ref, args: { defId: 'rsi', inputs: null } }))),
    changed: (b) => IDS.filter(id => p.instancesOn(b, id).some(i => i.defId === 'rsi')),
    verb: { monthly: 'add RSI to every chart', weekly: 'add RSI to all' },
  },
}
// [the exclusion words (after the verb), the charts they exclude]
const CASES = [
  [' but not the daily ones', ['TR', 'BL', 'BR']],                                            // hole (1)
  [', but leave the daily ones and the weekly one alone', IDS],                               // hole (1), conjunction
  [' except SPY, QQQ and NVDA', ['TL', 'TR', 'BL']],                                          // hole (2)
  [' apart from the dailies', ['TR', 'BL', 'BR']],
  [', but leave the ones on daily alone', ['TR', 'BL', 'BR']],
  [' except SPY, QQQ or NVDA', ['TL', 'TR', 'BL']],
  [' except QQQ, NVDA & AAPL', ['TR', 'BL', 'BR']],
  [' other than the weekly one and AAPL', ['TL', 'BR']],
  [', not the daily charts', ['TR', 'BL', 'BR']],
]
const ROWS = Object.entries(FAMILIES).flatMap(([fam, f]) => CASES.map(([x, ex], i) => [fam, `${f.verb[i % 2 ? 'weekly' : 'monthly']}${x}`, ex, f]))

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

describe('a model plan on exactly the other charts is honoured', () => {
  const EXACT = [
    ['chart.setTimeframe', 'set every chart to monthly but not the daily ones', ['TL']],
    ['chart.setTimeframe', 'set all to monthly except SPY, QQQ and NVDA', ['BR']],
    // (indicator.add's own F5 rule asks "which charts?" for an "every chart" plan left with ONE chart: two or more here)
    ['indicator.add', 'add RSI to every chart but not the weekly one', ['BL', 'BR', 'TR']],
    ['indicator.add', 'add RSI to all except SPY, QQQ or the weekly one', ['BL', 'BR']],
    ['indicator.add', 'add RSI to every chart, but leave the ones on weekly and AAPL alone', ['BL', 'TR']],
  ]
  it.each(EXACT)('%s · "%s" → applied on %j only', async (fam, t, rest) => {
    const f = FAMILIES[fam]
    const m = mount()
    p.st.envelopes.push(f.plan('apply', rest))
    await m.say(t)
    expect(f.changed(m.board).sort(), transcript()).toEqual(rest)
  }, 60000)
})
