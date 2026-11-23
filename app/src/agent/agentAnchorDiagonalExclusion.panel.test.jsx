// Anchor-relative DIAGONAL exclusions through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the board
// writer). AUDIT held-out e15: "set all to weekly except the one diagonal from AAPL" asked and OFFERED the excluded chart.
// Per family (indicator.add, chart.setTimeframe), on a 2×2 SPY QQQ / NVDA AAPL:
//   NEVER ACTED ON   the scripted plan ALSO names the excluded chart (apply and propose): it stays byte-for-byte as it was, is
//                    never carded and never offered.
//   HONOURED EXACTLY the plan on the other three charts (the anchor among them) runs without a question.
//   AMBIGUOUS        "across from" / "opposite" on a 2×2 (the row, the column or the diagonal?), the anchor on two charts, a one-row
//                    board: asked, nothing applied, no candidate offered.
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
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const mount = (sel, syms = SYMS, ids = IDS, cols = 2) => {
  const widgets = ids.map((id, i) => ({ id, x: (i % cols) * W, y: Math.floor(i / cols) * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, syms[i]])), { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
  if (sel) p.select(sel)
  return m
}
const stored = (b, id) => JSON.stringify(b.state.widgets.find(x => x.id === id))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cardText = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].flatMap(b => b.textContent.match(/Chart \((\w+)\)/g) || []).map(t => t.slice(7, -1))
const asked = () => /Which chart|Did you mean|Which charts|Pick one|You said not/i.test(transcript())

const FAMILIES = {
  'indicator.add (RSI)': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'indicator.add', target: body.context.indicatorEdits.find(c => c.chart === `Chart (${id})`).ref, args: { defId: 'rsi', inputs: null } }))),
    changed: (b, ids = IDS) => ids.filter(id => p.instancesOn(b, id).some(i => i.defId === 'rsi')),
    verb: 'add RSI to all of them',
    every: 'add RSI to every chart',
  },
  'chart.setTimeframe (weekly)': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }))),
    changed: (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id),
    verb: 'set all to weekly',                                            // the e15 words
    every: 'set every chart to weekly',
  },
}
// [the exclusion, clicked chart, the chart it excludes] — the 2×2 is SPY QQQ / NVDA AAPL
const EXCL = [
  ['except the one diagonal from AAPL', null, 'TL'],                       // e15
  ['except the one diagonal from AAPL', 'TR', 'TL'],                       // a click elsewhere never re-anchors it
  ['{every}, but leave the chart catty-corner to QQQ alone', null, 'BL'],   // (a bare "set all … but leave X alone" asks for any X)
  ['apart from the corner opposite NVDA', null, 'TR'],
  ["but don't touch the one kitty-corner from the top-left one", null, 'BR'],
  ['except the one diagonally opposite chart 2', 'BR', 'BL'],
]
const CASES = Object.entries(FAMILIES).flatMap(([fam, f]) => EXCL.map(([x, sel, ex]) => [fam, x.startsWith('{every}') ? x.replace('{every}', f.every) : `${f.verb} ${x}`, sel, ex, f]))

describe('never acted on: a plan that names the chart excluded diagonally from another', () => {
  it.each(CASES)('%s · "%s" (clicked %s, excludes %s)', async (_fam, t, sel, ex, f) => {
    for (const disp of ['apply', 'propose']) {
      cleanup(); p = setupPanel()
      const m = mount(sel)
      const before = stored(m.board, ex)
      p.st.envelopes.push(f.plan(disp, IDS))
      await m.say(t)
      expect(stored(m.board, ex), transcript()).toBe(before)
      expect(f.changed(m.board), transcript()).not.toContain(ex)
      expect(cardText(), transcript()).not.toContain(`Chart (${ex})`)
      expect(offered(), transcript()).not.toContain(ex)
    }
  }, 60000)
})

describe('honoured exactly: the plan on the other charts (its anchor among them) is never asked about', () => {
  it.each(CASES)('%s · "%s" (clicked %s, excludes %s)', async (_fam, t, sel, ex, f) => {
    const m = mount(sel)
    const others = IDS.filter(id => id !== ex)
    p.st.envelopes.push(f.plan('apply', others))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    const ran = f.changed(m.board).sort()
    if (ran.length) expect(ran, transcript()).toEqual([...others].sort())
    else for (const id of others) expect(cardText(), transcript()).toContain(`Chart (${id})`)
    expect(cardText(), transcript()).not.toContain(`Chart (${ex})`)
  }, 60000)
})

describe('ambiguous: asked, nothing applied, no candidate offered', () => {
  it.each(Object.entries(FAMILIES).flatMap(([fam, f]) => [
    [fam, `${f.verb} except the one across from SPY`, SYMS, ['TR', 'BL', 'BR'], f],                 // row, column or diagonal?
    [fam, `${f.verb} except the one opposite AAPL`, SYMS, ['TL', 'TR', 'BL'], f],
    [fam, `${f.verb} except the one diagonal from SPY`, ['SPY', 'QQQ', 'NVDA', 'SPY'], ['TL', 'BR'], f], // two SPY charts
  ]))('%s · "%s"', async (_fam, t, syms, never, f) => {
    for (const disp of ['apply', 'propose']) {
      cleanup(); p = setupPanel()
      const m = mount(null, syms)
      const before = IDS.map(id => stored(m.board, id))
      p.st.envelopes.push(f.plan(disp, IDS))
      await m.say(t)
      expect(IDS.map(id => stored(m.board, id)), transcript()).toEqual(before)
      expect(f.changed(m.board), transcript()).toEqual([])
      for (const id of never) {
        expect(offered(), transcript()).not.toContain(id)
        expect(cardText(), transcript()).not.toContain(`Chart (${id})`)
      }
    }
  }, 60000)
  it.each(Object.entries(FAMILIES))('%s · a one-row board has no diagonal: asked, nothing applied', async (_fam, f) => {
    const ids = ['L', 'M', 'R']
    const m = mount(null, ['SPY', 'QQQ', 'AAPL'], ids, 3)
    const before = ids.map(id => stored(m.board, id))
    p.st.envelopes.push(f.plan('apply', ids))
    await m.say(`${f.verb} except the one diagonal from AAPL`)
    expect(ids.map(id => stored(m.board, id)), transcript()).toEqual(before)
  }, 60000)
})
