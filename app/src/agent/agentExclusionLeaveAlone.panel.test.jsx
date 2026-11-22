// H-RDR-1 through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the board writer): "…, but leave <the
// chart> alone" and its class, the chart named by a ticker, a position, an ordinal or the click. Two directions, per family:
//   NEVER ACTED ON   the scripted plan ALSO names the excluded chart (apply and propose): it stays byte-for-byte as it was,
//                    is never carded and never offered.
//   HONOURED EXACTLY the plan on the other charts: no question is asked; exactly those charts change (applied, or carded with
//                    exactly them where the disposition proposes) — a recognized exclusion never degrades into a clarify.
//   FAIL SAFE        an exclusion the board cannot place: asked, nothing applied.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call. Phrasings are pl-hrdr1's own.
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
const mount = (sel) => {
  const widgets = IDS.map((id, i) => ({ id, x: (i % 2) * W, y: Math.floor(i / 2) * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
  if (sel) p.select(sel)
  return m
}
const stored = (b, id) => JSON.stringify(b.state.widgets.find(x => x.id === id))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cardText = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].flatMap(b => b.textContent.match(/Chart \((\w+)\)/g) || []).map(t => t.slice(7, -1))
const asked = () => /Which chart|Did you mean|Which charts|Pick one|You said not/i.test(transcript())

// the families: each a scripted plan builder and a reader of which charts it changed
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
// [the exclusion clause, clicked chart, the chart it excludes]
const EXCL = [
  ['but leave the SPY chart alone', null, 'TL'],                          // the reported form
  ['but leave the top-left one alone', null, 'TL'],
  ['but leave the second chart as it is', null, 'TR'],
  ["but don't touch the bottom left chart", null, 'BL'],
  ['skip chart four', null, 'BR'],
  ['but keep this one the same', 'TR', 'TR'],
  ['hands off the lower right one', 'TL', 'BR'],
]
const CASES = Object.entries(FAMILIES).flatMap(([fam, f]) => EXCL.map(([x, sel, ex]) => [fam, `${f.verb}, ${x}`.replace(', but', ' but'), sel, ex, f]))

describe('never acted on: a plan that names the excluded chart', () => {
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

describe('honoured exactly: the plan on the other charts is never asked about', () => {
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

describe('fail safe: an exclusion the board cannot place is asked, nothing applied', () => {
  it.each(Object.entries(FAMILIES).flatMap(([fam, f]) => [
    [fam, `${f.verb} but leave the middle one alone`, null, f],           // a 2×2 has no middle chart
    [fam, `${f.verb}, but leave this one alone`, null, f],                // nothing clicked
    [fam, `${f.verb} but skip the sixth chart`, null, f],                 // four charts
  ]))('%s · "%s"', async (_fam, t, sel, f) => {
    const m = mount(sel)
    const before = IDS.map(id => stored(m.board, id))
    p.st.envelopes.push(f.plan('apply', IDS))
    await m.say(t)
    expect(IDS.map(id => stored(m.board, id)), transcript()).toEqual(before)
    expect(f.changed(m.board), transcript()).toEqual([])
  }, 60000)
})

// (AUDIT follow-up) a NEGATED IMPERATIVE with a destination, the model planning exactly the forbidden op on the named chart (it
// was applied on master cdfa65c1b1 in each of these): the named chart never changes, with or without a click on it
const REMOVE = {
  plan: (disp, ids) => () => p.env(disp, ids.map(id => ({ action: 'widget.remove', target: 'board', args: { widget: id } }))),
  changed: (b) => IDS.filter(id => !b.state.widgets.some(x => x.id === id)),
}
const NEGATED = [
  ['indicator.add (RSI)', 'do not add RSI to the second chart', ['TR']], ['indicator.add (RSI)', "don't put RSI on the top-left chart", ['TL']],
  ['indicator.add (RSI)', 'never add an RSI to chart 4', ['BR']], ['indicator.add (RSI)', "don't add RSI to the NVDA chart", ['BL']],
  ['chart.setTimeframe (weekly)', "don't change the top-left one to weekly", ['TL']], ['chart.setTimeframe (weekly)', 'never set chart 3 to weekly', ['BL']],
  ['chart.setTimeframe (weekly)', "don't make the SPY chart weekly", ['TL']], ['chart.setTimeframe (weekly)', 'leave the bottom row as is but switch it to weekly', ['BL', 'BR']],
  ['widget.remove', 'do not close the second chart', ['TR']], ['widget.remove', "don't delete the top-left one", ['TL']],
  ['widget.remove', 'never remove the left chart', ['TL', 'BL']],
]
describe('a negated imperative is never executed on the chart it names (real panel)', () => {
  it.each(NEGATED.flatMap(([fam, t, named]) => [[fam, t, named, null], [fam, t, named, named[0]]]))('%s · "%s" (names %j, clicked %s)', async (fam, t, named, sel) => {
    const f = fam === 'widget.remove' ? REMOVE : FAMILIES[fam]
    const m = mount(sel)
    const before = named.map(id => stored(m.board, id))
    p.st.envelopes.push(f.plan('apply', named))
    await m.say(t)
    expect(named.map(id => stored(m.board, id)), transcript()).toEqual(before)
    expect(f.changed(m.board).filter(id => named.includes(id)), transcript()).toEqual([])
  }, 60000)
})
