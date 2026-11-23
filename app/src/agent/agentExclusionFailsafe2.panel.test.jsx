// EXCLUSION FAIL-SAFE 2 through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the board writer), on the
// AUDIT 2×2 (SPY weekly; QQQ, NVDA, AAPL daily), per family (chart.setTimeframe, indicator.add), apply AND propose:
//   (1) an UNKNOWN attribute ("except the ETFs"), (2) a STATED keep that fits no chart ("the monthly ones stay as they are",
//   "chart 6 stays as it is"), the GENERIC fallback ("except Apple and Microsoft") — a model plan on every chart applies, cards and
//   offers NOTHING (asked, no chart offered);
//   (3) the NEW cues ("bar", "barring", "instead of") — no excluded chart is applied, carded or offered; a plan on exactly the other
//   charts is applied;
//   controls: "instead of daily, use weekly" (a replacement) applies on every chart as before.
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
// [the exclusion words (after the verb), the charts no plan may touch]
const CASES = [
  [' except the ETFs', IDS],                                        // (1) unknown attribute: every chart may be meant
  [', but leave the tech stocks alone', IDS],
  [' other than the large caps', IDS],
  [', the ETFs stay as they are', IDS],                              // (2) stated keep, unknown attribute
  [', chart 6 stays as it is', IDS],                                 // (2) stated keep, a position the board cannot place
  [' except Apple and Microsoft', IDS],                              // generic fallback
  [', bar the daily ones', ['TR', 'BL', 'BR']],                      // (3) new cues
  [' barring SPY and QQQ', ['TL', 'TR']],
  [' instead of the weekly one', ['TL']],
  [' rather than NVDA', ['BL']],
  // (AUDIT T2 r2) relative-clause objects: the described set, exactly
  [" except whatever's on daily", ['TR', 'BL', 'BR']],
  [' apart from the ones that are on daily', ['TR', 'BL', 'BR']],
  [" except what's on the weekly", ['TL']],
  [" except anything that's daily", ['TR', 'BL', 'BR']],
  [' but not those which are daily', ['TR', 'BL', 'BR']],
  // (AUDIT T2 r2) mixed lists: a non-chart item never ends the list — asked, no chart offered
  [' except volume and the ETFs', IDS],
  [' other than RSI and the daily ones', IDS],
  [' except the 50 day and SPY', IDS],
]
const ROWS = Object.entries(FAMILIES).flatMap(([fam, f]) => CASES.map(([x, ex]) => [fam, `${f.verb}${x}`, ex, f]))

describe('a model plan on every chart: no excluded or uncertain chart is applied, carded or offered', () => {
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

describe('a model plan on exactly the other charts is honoured (the new cues are exact)', () => {
  const EXACT = [
    // (", bar X" after a comma is split off as a second step by the multi-step reader: safe — proposed, never applied off-plan)
    ['chart.setTimeframe', 'set every chart to monthly barring the daily ones', ['TL']],
    ['indicator.add', 'add RSI to every chart barring SPY', ['BL', 'BR', 'TR']],
    ['indicator.add', 'add RSI to every chart instead of the weekly one', ['BL', 'BR', 'TR']],
    ['chart.setTimeframe', "set every chart to monthly except whatever's on daily", ['TL']],
    ['indicator.add', "add RSI to every chart except what's on the weekly", ['BL', 'BR', 'TR']],
  ]
  it.each(EXACT)('%s · "%s" → applied on %j only', async (fam, t, rest) => {
    const f = FAMILIES[fam]
    const m = mount()
    p.st.envelopes.push(f.plan('apply', rest))
    await m.say(t)
    expect(f.changed(m.board).sort(), transcript()).toEqual(rest)
  }, 60000)
})

describe('controls: a replacement is no exclusion', () => {
  it.each(['instead of daily, use weekly on every chart', 'set every chart to weekly instead of daily'])('"%s" → applied on every chart', async (t) => {
    const f = FAMILIES['chart.setTimeframe']
    const m = mount()
    p.st.envelopes.push(f.plan('apply', IDS, 'W'))
    await m.say(t)
    expect(f.changed(m.board, 'W').sort(), transcript()).toEqual([...IDS].sort())
  }, 60000)
})
