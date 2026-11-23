// H-RDR-1 follow-up through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the board writer): an
// exclusion named RELATIVE TO ANOTHER CHART ("…except the one left of QQQ", "leave the chart below the SPY one alone",
// "everything but the one next to AMD", "…except the one next to it" after an earlier change). Per family:
//   NEVER ACTED ON   the scripted plan ALSO names the excluded chart (apply and propose): it stays byte-for-byte as it was, is
//                    never carded and never offered — and the ANCHOR is no exclusion (master excluded it instead).
//   HONOURED EXACTLY the plan on the other charts (the anchor among them) runs without a question.
//   FAIL SAFE        an anchor the board cannot place exactly (a ticker on two charts, a ticker it lacks, nothing on that side,
//                    no earlier chart for "it"): asked, nothing applied, no candidate offered.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const W = 12, H = 10
const IDS = ['TL', 'TR', 'BL', 'BR']
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AMD']
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const mount = (sel, syms = SYMS) => {
  const widgets = IDS.map((id, i) => ({ id, x: (i % 2) * W, y: Math.floor(i / 2) * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
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
    changed: (b) => IDS.filter(id => p.instancesOn(b, id).some(i => i.defId === 'rsi')),
    verb: 'add RSI to every chart',
  },
  'chart.setTimeframe (weekly)': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }))),
    changed: (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id),
    verb: 'set every chart to weekly',
  },
}
// [the exclusion, clicked chart, the chart it excludes] — the 2×2 is SPY QQQ / NVDA AMD
const EXCL = [
  ['except the one left of QQQ', null, 'TL'],
  ['but leave the chart below the SPY one alone', null, 'BL'],
  ['but the one next to AMD', null, 'BL'],
  ["but don't touch the one above the bottom-right one", null, 'TR'],
  ['apart from the chart under chart 2', null, 'BR'],
  ['except the one to NVDA\'s right', 'TL', 'BR'],                       // a click elsewhere never re-anchors it
  ['but skip the one below SPY', 'BR', 'BL'],
]
const CASES = Object.entries(FAMILIES).flatMap(([fam, f]) => EXCL.map(([x, sel, ex]) => [fam, `${f.verb} ${x}`, sel, ex, f]))

describe('never acted on: a plan that names the chart excluded relative to another', () => {
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

describe('fail safe: an anchor the board cannot place exactly is asked, nothing applied', () => {
  it.each(Object.entries(FAMILIES).flatMap(([fam, f]) => [
    [fam, `${f.verb} except the one below SPY`, ['SPY', 'SPY', 'NVDA', 'AMD'], ['BL', 'BR'], f],     // two SPY charts
    [fam, `${f.verb} except the one left of TSLA`, SYMS, [], f],                                    // no TSLA here
    [fam, `${f.verb} except the one above SPY`, SYMS, [], f],                                       // nothing above SPY
    [fam, `${f.verb} except the one next to it`, SYMS, [], f],                                      // nothing clicked, no earlier chart
  ]))('%s · "%s"', async (_fam, t, syms, never, f) => {
    const m = mount(null, syms)
    const before = IDS.map(id => stored(m.board, id))
    p.st.envelopes.push(f.plan('apply', IDS))
    await m.say(t)
    expect(IDS.map(id => stored(m.board, id)), transcript()).toEqual(before)
    expect(f.changed(m.board), transcript()).toEqual([])
    for (const id of never) expect(offered(), transcript()).not.toContain(id)
  }, 60000)
})

describe('earlier turn: "the one next to it" after a change on one chart (session memory), nothing clicked', () => {
  it.each(Object.entries(FAMILIES))('%s: turn 1 changes SPY (TL); "…except the one next to it" never changes QQQ (TR)', async (_fam, f) => {
    const m = mount(null)
    // turn 1: a change on the SPY chart alone (a different family, so turn 2's change is observable on its own)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicator.add', target: body.context.indicatorEdits.find(c => c.chart === 'Chart (TL)').ref, args: { defId: 'macd', inputs: null } }]))
    await m.say('add MACD to the SPY chart')
    expect(p.instancesOn(m.board, 'TL').some(i => i.defId === 'macd'), transcript()).toBe(true)
    const before = stored(m.board, 'TR')
    p.st.envelopes.push(f.plan('apply', IDS))
    await m.say(`${f.verb} except the one next to it`)
    expect(stored(m.board, 'TR'), transcript()).toBe(before)
    expect(f.changed(m.board), transcript()).not.toContain('TR')
    expect(offered(), transcript()).not.toContain('TR')
  }, 60000)
})
