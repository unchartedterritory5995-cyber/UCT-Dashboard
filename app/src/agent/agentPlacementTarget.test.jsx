// PLACEMENT target (pl-auto u12 on 9828b67c6e, SIMULATED: FOUR, BR clicked, an adversary plan on BR, "put rsi on the corner opposite
// here" was APPLIED to the click). Generalised: the chart a placement preposition (on / onto / to / into / for) introduces is the
// TARGET noun phrase; a thing named BEFORE that preposition (an indicator, an alert, an MA) is what is placed, never part of the
// chart reference. So "<thing> <prep> <chart NP with a relation to an anchor>" makes the click the anchor: never applied, never
// offered, the chart meant resolved from the grid where it can be. Built from the family: thing × placement preposition × chart
// reference × relation × anchor, plus the possessive form, on two grids. Negatives: a thing placed RELATIVE TO the click's own
// content ("stick the stochastic below this one", "on the side of this chart", "on the price pane of this one") acts on the click.
// Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans through the real panel).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const w = (id, x, y) => ({ id, x, y, w: 12, h: 10 })
// 2×2 (AUDIT's FOUR shape): TL TR / BL BR
const FOUR = [w('TL', 0, 0), w('TR', 12, 0), w('BL', 0, 10), w('BR', 12, 10)]
const w8 = (id, x, y) => ({ id, x, y, w: 8, h: 10 })
// 2×3: TL TM TR / BL BM BR
const SIX = [w8('TL', 0, 0), w8('TM', 8, 0), w8('TR', 16, 0), w8('BL', 0, 10), w8('BM', 8, 10), w8('BR', 16, 10)]
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const mount = (grid, sel) => {
  const widgets = grid.map(c => ({ ...c, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  if (sel) p.select(sel)
  return m
}
const withInd = (b) => b.state.widgets.filter(x => (x.opts?.settings?.indicatorInstances || []).some(i => !i.deleted)).map(x => x.id)
const indPlan = (defId, ...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'indicator.add', target: (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`).ref, args: { defId } })))
function anchorSafe(sel) {
  expect(transcript(), 'the anchor named in a headline').not.toContain(`Did you mean Chart (${sel})?`)
  const offered = [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim())
  expect(offered, 'the anchor offered').not.toContain(`Chart (${sel})`)
}

const THINGS = [['rsi', 'rsi'], ['a MACD', 'macd'], ['the stochastic', 'stoch']]
const PREPS = ['put {T} on', 'add {T} to', 'stick {T} onto', 'throw {T} up on']
// [chart reference with a relation to an anchor, grid, clicked, meant]
const REFS = [
  ['the corner opposite here', FOUR, 'BR', 'TL'],                       // pl-auto u12's sentence
  ['the chart to the left of this one', FOUR, 'BR', 'BL'],
  ['the one above this', FOUR, 'BR', 'TR'],
  ['the cell diagonally across from the selected chart', FOUR, 'TL', 'BR'],
  ['the chart right of the one I clicked', SIX, 'TM', 'TR'],
  ['its left neighbour', SIX, 'BR', 'BM'],                                // the possessive form
  // heads that are no chart word: the preposition, not the noun, makes them the chart reference
  ['the neighbour to the left of this one', FOUR, 'BR', 'BL'],
  ['the spot above this chart', FOUR, 'BR', 'TR'],
  ['the corner diagonally across from here', FOUR, 'TL', 'BR'],
  ['the slot right of the selected chart', SIX, 'TM', 'TR'],
  ['the square below this one', SIX, 'TR', 'BR'],
]
const ROWS = REFS.flatMap(([ref, grid, sel, meant], i) => PREPS.map((pre, j) => {
  const [T, defId] = THINGS[(i + j) % THINGS.length]
  return [`${pre.replace('{T}', T)} ${ref}`, grid === FOUR ? '2x2' : '2x3', sel, meant, defId]
}))
const gridOf = (g) => (g === '2x2' ? FOUR : SIX)

describe('placement target: a plan on the CLICK is never applied; the anchor is never offered', () => {
  it.each(ROWS)('"%s" (%s, clicked %s)', async (t, g, sel, meant, defId) => {
    const m = mount(gridOf(g), sel)
    p.st.envelopes.push(indPlan(defId, sel))
    await m.say(t)
    expect(withInd(m.board), transcript()).not.toContain(sel)
    anchorSafe(sel)
  }, 40000)
})

describe('placement target: the plan on the chart meant runs there, never on the click', () => {
  it.each(ROWS)('"%s" (%s, clicked %s, meant %s)', async (t, g, sel, meant, defId) => {
    const m = mount(gridOf(g), sel)
    p.st.envelopes.push(indPlan(defId, meant))
    await m.say(t)
    expect(withInd(m.board), transcript()).toEqual([meant])
    anchorSafe(sel)
  }, 40000)
})

describe('negatives: a thing placed on the click itself — the click is acted on', () => {
  const ACT = [
    ['stick the stochastic below this one', 'stoch'],
    ['put rsi on this chart', 'rsi'],
    ['add a MACD to the one I clicked', 'macd'],
    ['put rsi on the price pane of this chart', 'rsi'],
    ['put the stochastic on the side of this chart', 'stoch'],
    ['add rsi to this one, below the price', 'rsi'],
    ['put a MACD on the selected chart under the candles', 'macd'],
    // the preposition introduces a thing ON the click (a price, the volume), not a chart: still the click
    ['put rsi on the price above this one', 'rsi'],
    ['add a MACD to the volume below this one', 'macd'],
  ]
  it.each(ACT)('"%s" (2x2, BR clicked): the plan on the click runs there', async (t, defId) => {
    const m = mount(FOUR, 'BR')
    p.st.envelopes.push(indPlan(defId, 'BR'))
    await m.say(t)
    expect(withInd(m.board), transcript()).toEqual(['BR'])
  }, 40000)
})
