// HOTFIX (negated-ticker targeting) — through the REAL panel (panelHarness: AgentPanel + useAgent + the board writer), the
// scripted model plan as stated per case. Three rails:
//   OPTIONS   a "Which chart do you mean?" question's options (the actual buttons the member can press) NEVER include the
//             chart the member excluded; pressing each offered button never changes it either.
//   FAIL CLOSED  an exclusion naming a ticker the board cannot place (on two charts, a relation from it) ASKS, nothing applies,
//             and the question offers none of the charts it may mean.
//   BASELINE  the over-capture controls behave EXACTLY as on master 75c5165f65 (outcomes recorded there with this very file's
//             cases: what was applied, which charts were offered).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const W = 8, H = 10
const IDS = [['TL', 0, 0], ['TR', 0, 1], ['BL', 1, 0], ['BR', 1, 1]]
const QUAD = ['SPY', 'QQQ', 'NVDA', 'AMD']
const transcript = () => screen.getByTestId('agent-transcript').textContent
const mount = (syms = QUAD, sel = null) => {
  const widgets = IDS.map(([id, r, c]) => ({ id, x: c * W, y: r * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, syms[i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
  if (sel) p.select(sel)
  return m
}
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const tfPlan = (ids, disp = 'apply') => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: refOf(body, id), args: { timeframe: 'W' } })))
const weekly = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
// the ACTUAL option data of the question: every chart a button in the transcript names (a set choice names several)
const optionButtons = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].filter(b => /Chart \(/.test(b.textContent))
const offered = () => [...new Set(optionButtons().flatMap(b => b.textContent.match(/Chart \((\w+)\)/g) || []).map(t => t.slice(7, -1)))].sort()
const carded = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')

// ── OPTIONS: the question never offers the excluded chart; pressing any offered button never changes it ─────────────────
const OPTION_CASES = [
  // [words, plan, clicked] — the reviewer's "asks but OFFERS the excluded chart" families and their neighbours (own words)
  ["switch to weekly, but leave NVDA's alone", ['TL'], null],
  ["switch to weekly, but leave NVDA's alone", ['BL'], null],                      // master WROTE NVDA here
  ['make it weekly. Hands off the NVDA chart', ['TL'], null],
  ['make it weekly. Hands off the NVDA chart', ['BL'], 'TL'],
  ['make it weekly. Leave NVDA out of it.', ['BL'], null],
  ['make it weekly. Leave out the NVDA one.', ['TR'], null],
  ['weekly please; dont touch NVDA', ['BL', 'TL'], null],                         // master CARDED NVDA here
  ['weekly please. Not the NVDA chart though.', ['TL'], null],
  ['weekly please — do not touch NVDA', ['BL'], null],
  ['weekly please, skip the NVDA one', ['TR'], null],
]
describe('OPTIONS rail: the question\'s options never contain the chart the member excluded', () => {
  it.each(OPTION_CASES)('"%s" (plan on %j, clicked %s): asked, NVDA never offered, never changed', async (t, plan, sel) => {
    const m = mount(QUAD, sel)
    const before = stored(m.board, 'BL')
    p.st.envelopes.push(tfPlan(plan))
    await m.say(t)
    expect(offered().length, `asked with options: ${transcript()}`).toBeGreaterThan(0)
    expect(offered(), transcript()).not.toContain('BL')
    expect(carded()).not.toContain('Chart (BL)')
    expect(stored(m.board, 'BL')).toBe(before)
    // press each offered option in turn (a fresh board each time): the excluded chart never changes
    const names = optionButtons().map(b => b.textContent)
    for (const name of names) {
      cleanup(); p = setupPanel()
      const m2 = mount(QUAD, sel)
      const b0 = stored(m2.board, 'BL')
      p.st.envelopes.push(tfPlan(plan))
      await m2.say(t)
      const btn = optionButtons().find(b => b.textContent === name)
      fireEvent.click(btn)
      await p.idle()
      if (screen.queryAllByRole('button', { name: 'Apply' }).length) { fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)); await p.idle() }
      expect(stored(m2.board, 'BL'), `pressed "${name}": ${transcript()}`).toBe(b0)
    }
  }, 120000)
  it('the plan on every chart: the set choice names every chart but NVDA; taking it changes exactly those three', async () => {
    const m = mount()
    p.st.envelopes.push(tfPlan(['TL', 'TR', 'BL', 'BR']))
    await m.say("set all charts to weekly, but leave NVDA's alone")
    expect(offered()).toEqual(['BR', 'TL', 'TR'])
    fireEvent.click(optionButtons()[0])
    await p.idle()
    if (screen.queryAllByRole('button', { name: 'Apply' }).length) { fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)); await p.idle() }
    expect(weekly(m.board), transcript()).toEqual(['BR', 'TL', 'TR'])
  }, 60000)
})

// ── FAIL CLOSED: an exclusion the board cannot place is asked; nothing runs; none of the charts it may mean is offered ─────
describe('FAIL CLOSED: an unplaceable negated ticker asks, and never offers what it may mean', () => {
  const TWICE = ['SPY', 'TSLA', 'NVDA', 'TSLA']                                   // TSLA on TR and BR
  it.each([['set every chart to weekly; dont touch TSLA'], ["set all charts to weekly, but leave TSLA's alone"], ['Set every chart to weekly. Not the TSLA chart though.'],
    ['hands off the TSLA one and set every chart to weekly']])('"%s" (TSLA on two charts): nothing applied; neither TSLA chart offered', async (t) => {
    const m = mount(TWICE)
    p.st.envelopes.push(tfPlan(['TL', 'TR', 'BL', 'BR']))
    await m.say(t)
    expect(weekly(m.board), transcript()).toEqual([])
    expect(offered(), transcript()).not.toContain('TR')
    expect(offered(), transcript()).not.toContain('BR')
    expect(carded()).not.toMatch(/Chart \((?:TR|BR)\)/)
  }, 60000)
  it.each([["set every chart to weekly, but leave SPY's neighbour alone"], ["set every chart to weekly, skip Apple's"], ['set every chart to weekly; hands off the one beside NVDA']])(
    '"%s": nothing applied (asked)', async (t) => {
      const m = mount()
      p.st.envelopes.push(tfPlan(['TL', 'TR', 'BL', 'BR']))
      await m.say(t)
      expect(weekly(m.board), transcript()).toEqual([])
    }, 60000)
})

// ── BASELINE: the over-capture controls, exactly as on master 75c5165f65 ─────────────────────────────────────────────────
// [words, plan, clicked, applied, offered] — recorded on master with these cases
const BASELINE = [
  ['leave it on weekly', ['BL'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ['keep the RSI', ['BL'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ["don't touch the axis", ['BL'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ['skip to the next bar', ['BL'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ['make it weekly, not the chart I meant', ['TL'], 'BL', [], ['BL', 'BR', 'TL', 'TR']],
  ["make SPY's neighbour weekly", ['TR'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ["show Apple's earnings", ['BL'], 'BL', ['BL'], []],
  ["put NVDA's chart on weekly", ['BL'], null, ['BL'], []],
  ['put the NVDA chart on weekly and leave it there', ['BL'], null, ['BL'], []],
  ['make NVDA weekly and leave it there', ['BL'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ["switch NVDA's chart to weekly and leave it there", ['BL'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ['weekly for NVDA, keep the RSI as it is', ['BL'], null, [], ['BL', 'BR', 'TL', 'TR']],
  ['keep NVDA on weekly', ['BL'], null, ['BL'], []],
]
describe('BASELINE: no over-capture — the controls behave exactly as on master', () => {
  it.each(BASELINE)('"%s" (plan on %j, clicked %s) → applied %j, offered %j', async (t, plan, sel, applied, opts) => {
    const m = mount(QUAD, sel)
    p.st.envelopes.push(tfPlan(plan))
    await m.say(t)
    expect(weekly(m.board), transcript()).toEqual(applied)
    expect(offered(), transcript()).toEqual(opts)
  }, 60000)
  it('"<feature> on every chart" beside an unrelated "Apple\'s earnings are next week" runs on all four', async () => {
    const m = mount()
    p.st.envelopes.push((body) => p.env('apply', ['TL', 'TR', 'BL', 'BR'].map(id => ({ action: 'chartFeatures.earningsStrip', target: refOf(body, id), args: { op: 'open' } }))))
    await m.say("put the earnings strip on every chart, Apple's earnings are next week")
    expect(m.board.state.widgets.filter(w => w.opts?.dock?.strip).map(w => w.id).sort(), transcript()).toEqual(['BL', 'BR', 'TL', 'TR'])
  }, 60000)
})
