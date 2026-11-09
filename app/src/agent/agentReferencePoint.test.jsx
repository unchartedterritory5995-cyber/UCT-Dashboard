// GRAMMATICAL anchor rules (AUDIT / pl-auto unseen10-11 on #988, SIMULATED) that do not depend on a word list:
//   R1  a REFERENCE-POINT anchor: "this / this one / this chart / here / the selected chart / the one I clicked" as the object of a
//       preposition or relational head after a CHART reference ("the chart … from / of / than / as / beside / opposite / across /
//       next to / near / beyond / past / around / below / above / under / over … this") is never the target: never applied, never
//       offered.
//   R2  NEVER REDIRECT: a plan on a non-anchor chart is never moved onto the click when the words hold a reference-point anchor; it
//       keeps its target when the relation resolves to it, otherwise it is asked about without the anchor.
//   R3  an ANCHORLESS relation on a chart reference ("the chart next door", "the other end of the row") with no target deictic: the
//       click is the implicit anchor, never applied or offered.
//   Plurals: "both neighbours / either side / both … to the right" are a set, asked or applied as a set, never collapsed to one.
// Negatives (AUDIT): a non-chart noun, S2-B, verb particles act on the click. Built from the family. Evidence: LOCAL native
// Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans through the real panel).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const w = (id, x, y) => ({ id, x, y, w: 8, h: 10 })
// 2×3: top TL TM TR, bottom BL BM BR
const G = [w('TL', 0, 0), w('TM', 8, 0), w('TR', 16, 0), w('BL', 0, 10), w('BM', 8, 10), w('BR', 16, 10)]
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts/.test(transcript())
const mount = (sel) => {
  const widgets = G.map(c => ({ ...c, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  if (sel) p.select(sel)
  return m
}
const tfs = (b) => Object.fromEntries(b.state.widgets.map(x => [x.id, x.opts?.tf || 'D']))
const changed = (b) => Object.entries(tfs(b)).filter(([, v]) => v === 'W').map(([k]) => k)
const planOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))
function anchorSafe(sel) {
  expect(transcript(), 'the anchor named in a headline').not.toContain(`Did you mean Chart (${sel})?`)
  const offered = [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim())
  expect(offered, 'the anchor offered').not.toContain(`Chart (${sel})`)
}
const ANCHORS = ['this one', 'this chart', 'here', 'the selected chart', 'the one I clicked']
const RELS = ['furthest from', 'closest to', 'on the far side of', 'just past', 'right beyond', 'around', 'two over from', 'the same row as',
  'diagonally away from', 'one row up from', 'across the board from', 'nearest to']

describe('R1: a reference-point anchor is never applied and never offered (prepositions × anchors)', () => {
  const ROWS = RELS.map((rel, i) => [`make the chart ${rel} ${ANCHORS[i % ANCHORS.length]} weekly`, ['BM', 'TL', 'BR', 'TM'][i % 4]])
  it.each(ROWS)('"%s" (clicked %s): a plan on the click never runs; the anchor never offered', async (t, sel) => {
    const m = mount(sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    anchorSafe(sel)
  }, 40000)
})

describe('R2: never redirect an honest plan onto the click', () => {
  // [text, clicked, the chart an honest planner names]
  const HONEST = [
    ['make the chart directly up one row from this one weekly', 'BM', 'TM'],
    ['the chart furthest from this one, weekly', 'TL', 'BR'],
    ['make the other side of the top row from this one weekly', 'TL', 'TR'],
    ['set the chart one column over from here to weekly', 'TM', 'TR'],
    ['the chart below this one should be weekly', 'TR', 'BR'],
    ['make the chart beside the one I clicked weekly', 'BL', 'BM'],
  ]
  it.each(HONEST)('"%s" (clicked %s, plan on %s): the click is never changed; the plan keeps its chart or is asked about', async (t, sel, meant) => {
    const m = mount(sel)
    p.st.envelopes.push(planOn(meant))
    await m.say(t)
    const ch = changed(m.board)
    expect(ch, transcript()).not.toContain(sel)
    expect(ch.every(id => id === meant), JSON.stringify(ch)).toBe(true)
    if (!ch.length) expect(asked(), transcript()).toBe(true)
    anchorSafe(sel)
  }, 40000)
})

describe('R3: an anchorless relation on a chart reference — the click is the implicit anchor', () => {
  const ROWS = [
    ['make the chart next door weekly', 'TL', 'TM'],          // one neighbour in the row from a corner
    ['make the other end of the row weekly', 'TL', 'TR'],
    ['make the chart at the far end of the row weekly', 'BR', 'BL'],
    ['make the neighbouring chart weekly', 'TR', 'TM'],
  ]
  it.each(ROWS)('"%s" (clicked %s): a plan on the click never runs; the anchor never offered', async (t, sel) => {
    const m = mount(sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    anchorSafe(sel)
  }, 40000)
  it.each(ROWS)('"%s" (clicked %s, plan on %s): the meant chart runs, or it is asked about — never the click', async (t, sel, meant) => {
    const m = mount(sel)
    p.st.envelopes.push(planOn(meant))
    await m.say(t)
    const ch = changed(m.board)
    expect(ch, transcript()).not.toContain(sel)
    expect(ch.every(id => id === meant)).toBe(true)
  }, 40000)
})

describe('plurals: a set, never collapsed to one chart, never the anchor', () => {
  const ROWS = [
    ['make both neighbours of this one weekly', 'TM', ['TL', 'TR']],
    ['make both charts on either side of this one weekly', 'BM', ['BL', 'BR']],
    ['make both charts to the right of this one weekly', 'TL', ['TM', 'TR']],
  ]
  it.each(ROWS)('"%s" (clicked %s): the plan on the set runs on exactly that set', async (t, sel, set) => {
    const m = mount(sel)
    p.st.envelopes.push(planOn(...set))
    await m.say(t)
    expect(changed(m.board).sort(), transcript()).toEqual([...set].sort())
    anchorSafe(sel)
  }, 40000)
  it.each(ROWS)('"%s" (clicked %s): a plan on ONE of the set is not run as if it were the set', async (t, sel, set) => {
    const m = mount(sel)
    p.st.envelopes.push(planOn(set[0]))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    expect(changed(m.board).length === set.length || asked(), transcript()).toBe(true)
    anchorSafe(sel)
  }, 40000)
})

describe('negatives (AUDIT): the click is acted on', () => {
  const ACT = [
    'pull up weekly on this one', 'this one to weekly, the level I drew next to it is support', 'make this chart weekly; the 50-day is above the 200',
    'make this one weekly, the alert below the price can stay', 'put this chart on weekly and the MA over the candles too',
    'switch this one to weekly', 'make it weekly',
  ]
  it.each(ACT)('"%s" (TM clicked): the plan on the click runs there', async (t) => {
    const m = mount('TM')
    p.st.envelopes.push(planOn('TM'))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual(['TM'])
  }, 40000)
})
