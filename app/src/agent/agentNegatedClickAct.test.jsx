// #988 (pl-grid's wrong-target find, LOCAL / SIMULATED): a NEGATED reference to the member's own click or selection made with a
// RELATIVE CLAUSE — "not the one I clicked", "not the chart I'm on", "other than the one I selected", "instead of the one I
// picked" — EXCLUDES the clicked chart, exactly as "not this one" / "not the clicked one" do. On c01bab958c "not the one I
// clicked" was no negation (NEG_POINTER only knew this / that / it / the clicked one); it read as a POINTER at the click, so a
// plan aimed at the clicked chart was APPLIED. The family: every negation operator × every click-act noun phrase, on 2×2, 2×3
// and 3×3 boards, the click top-left, the words naming the bottom-right chart. A model plan on the CLICK is never applied,
// carded or offered; a plan on the named chart is applied (no over-ask). LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom,
// scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
const SYMS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'META', 'MSFT', 'AAPL', 'GOOG']
const grid = (rows, cols) => Array.from({ length: rows * cols }, (_, i) => ({ id: `c${i}`, x: (i % cols) * W, y: Math.floor(i / cols) * H, w: W, h: H }))
const BOARDS = { '2x2': grid(2, 2), '2x3': grid(2, 3), '3x3': grid(3, 3) }

const transcript = () => screen.getByTestId('agent-transcript').textContent
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const carded = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const logged = (b) => b.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id).sort()
const mount = (shape) => {
  const widgets = BOARDS[shape].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
  p.select('c0')                                                     // the click: top-left
  return { ...m, br: widgets[widgets.length - 1].id }
}
const scaleOn = (id) => (body) => p.env('apply', [{ action: 'chart.setScale', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { scale: 'log' } }])

const CLICK_ACT = ['the one I clicked', 'the one I clicked on', 'the one I selected', 'the one I picked', 'the one I have selected',
  "the one I've got selected", 'the one I just clicked', 'the chart I clicked', "the chart I'm on", "the one I'm looking at", 'the chart that I selected']
const NEG = [(np) => `put the bottom-right one on log scale, not ${np}`, (np) => `put the bottom-right one on log scale instead of ${np}`,
  (np) => `put the bottom-right one on log scale rather than ${np}`, (np) => `log scale on a chart other than ${np}, the bottom-right one`]
const WORDS = NEG.flatMap(f => CLICK_ACT.map(np => f(np)))
const CASES = Object.keys(BOARDS).flatMap(shape => WORDS.map(t => [shape, t]))

describe('a negated click-act reference excludes the click', () => {
  it.each(CASES)('%s: "%s" — a model plan on the CLICK is never applied, carded or offered', async (shape, t) => {
    const m = mount(shape)
    p.st.envelopes.push(scaleOn('c0'))
    await m.say(t)
    expect(logged(m.board), `the click applied: ${transcript()}`).not.toContain('c0')
    expect(carded(), `the click carded: ${transcript()}`).not.toContain('Chart (c0)')
    expect(offered(), `the click offered: ${transcript()}`).not.toContain('c0')
  }, 40000)
  it.each(Object.keys(BOARDS).flatMap(shape => NEG.map(f => [shape, f('the one I clicked')])))('%s: "%s" — a plan on the named chart is applied', async (shape, t) => {
    const m = mount(shape)
    p.st.envelopes.push(scaleOn(m.br))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual([m.br])
  }, 40000)
})

// ── AUDIT probe 20 families (2×2: c0 TL, c1 TR, c2 BL, c3 BR) ──
const at = (sel) => { const m = mount('2x2'); p.select(sel); return m }
const scaleOnAll = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setScale', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { scale: 'log' } })))
// (a) a negated click-act reference with NO other named target: the rest of the board, never the click
const A_WORDS = CLICK_ACT.flatMap(np => [`other than ${np}, put the rest on log scale`, `put the rest on log scale, other than ${np}`,
  `except ${np}, put the others on log scale`, `log scale on all of them except ${np}`])
describe('(a) "other than the one I\'m looking at, put the rest on log": the click is excluded', () => {
  it.each(A_WORDS)('"%s" (c3 clicked) — a plan on the click is never applied', async (t) => {
    const m = at('c3')
    p.st.envelopes.push(scaleOnAll('c3'))
    await m.say(t)
    expect(logged(m.board), transcript()).not.toContain('c3')
    expect(offered(), transcript()).not.toContain('c3')
  }, 40000)
  it.each(A_WORDS.slice(0, 4))('"%s" (c3 clicked) — a plan on the rest is applied there', async (t) => {
    const m = at('c3')
    p.st.envelopes.push(scaleOnAll('c0', 'c1', 'c2'))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual(['c0', 'c1', 'c2'])
  }, 40000)
})
// (b) a STATIVE clause about the click ("the one I selected stays daily") keeps it as it is; the other clause names the target
const STAY = ['stays as it is', 'stays on a normal scale', 'stays the way it is', 'can stay as it is', 'should stay as it is', 'is fine as it is', 'remains as it is']
const B_WORDS = ['the one I selected', 'the one I clicked', "the chart I'm on", 'the one I have selected'].flatMap(np => STAY.flatMap(st => [
  `${np} ${st}; put the top-left on log scale`, `put the top-left on log scale; ${np} ${st}`, `${np} ${st}, put the top-left on log scale`]))
describe('(b) "the one I selected stays daily; make the top-left weekly": the click is left as it is', () => {
  it.each(B_WORDS)('"%s" (c3 clicked) — a plan on the click is never applied', async (t) => {
    const m = at('c3')
    p.st.envelopes.push(scaleOnAll('c3'))
    await m.say(t)
    expect(logged(m.board), transcript()).not.toContain('c3')
  }, 40000)
  it.each(B_WORDS.slice(0, 6))('"%s" (c3 clicked) — a plan on the top-left is applied', async (t) => {
    const m = at('c3')
    p.st.envelopes.push(scaleOnAll('c0'))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual(['c0'])
  }, 40000)
  // stative CONTROLS that act on the click: a want, not a "stays"
  it.each(['the one I selected should be on log scale', 'the one I clicked needs log scale', "the chart I'm on should use log scale"])('control: "%s" (c3 clicked) — a plan on the click is applied', async (t) => {
    const m = at('c3')
    p.st.envelopes.push(scaleOnAll('c3'))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual(['c3'])
  }, 40000)
})
// (c) a BARE negated position (no noun): "not the bottom-left" excludes that chart
const POSN = [['the bottom-left', 'c2'], ['the bottom left', 'c2'], ['bottom-left', 'c2'], ['the top-left', 'c0'], ['the bottom-right', 'c3'], ['the bottom right', 'c3']]
const C_CASES = POSN.flatMap(([w, ex]) => [[`put the one I have selected on log scale, not ${w}`, ex], [`not ${w} — put the one I have selected on log scale`, ex],
  [`put the one I clicked on log scale and not ${w}`, ex], [`log scale on the one I selected, not ${w}`, ex]])
describe('(c) "make the one I have selected weekly, not the bottom-left": a bare negated position is excluded', () => {
  it.each(C_CASES)('"%s" (c1 clicked) — a plan on %s is never applied', async (t, ex) => {
    const m = at('c1')
    p.st.envelopes.push(scaleOnAll(ex))
    await m.say(t)
    expect(logged(m.board), transcript()).not.toContain(ex)
    expect(offered(), transcript()).not.toContain(ex)
  }, 40000)
  it.each(C_CASES.slice(0, 4))('"%s" (c1 clicked) — a plan on the click is applied', async (t) => {
    const m = at('c1')
    p.st.envelopes.push(scaleOnAll('c1'))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual(['c1'])
  }, 40000)
})

// ── AUDIT controls (Lead, 11-10) ──
// NEG_EXCEPT ", not <X>" excludes a CHART or a POSITION only — never a value or a setting: these apply on the click (no exclusion, no ask)
const NOT_VALUE = ['put this one on log scale, not linear', 'log scale on this one, not linear', 'put it on log scale, not arithmetic',
  'log scale on this chart, not the 200', 'put the one I selected on log scale, not linear', 'make this one log, not linear',
  'log scale on this one, not daily', 'put this one on log scale, not weekly']
describe('control: ", not <a value or setting>" excludes nothing', () => {
  it.each(NOT_VALUE)('"%s" (c1 clicked) — a plan on the click is applied, no ask', async (t) => {
    const m = at('c1')
    p.st.envelopes.push(scaleOnAll('c1'))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual(['c1'])
    expect(offered(), transcript()).toEqual([])
  }, 40000)
})
// …while ", not <a chart>" still excludes it
const NOT_CHART = [['put this one on log scale, not the top-left one', 'c0'], ['log scale on this one, not the bottom-left one', 'c2'],
  ['put this one on log scale, not the bottom-right', 'c3'], ['put this one on log scale, not the left one', 'c0'], ['log scale on this one, not the left one', 'c2'],
  ['put this one on log scale, not the bottom ones', 'c3']]
describe('control: ", not <a chart>" excludes it', () => {
  it.each(NOT_CHART)('"%s" (c1 clicked) — a plan on %s is never applied', async (t, ex) => {
    const m = at('c1')
    p.st.envelopes.push(scaleOnAll(ex))
    await m.say(t)
    expect(logged(m.board), transcript()).not.toContain(ex)
    expect(offered(), transcript()).not.toContain(ex)
  }, 40000)
})
// STAY_CLICK never swallows a positive instruction: "make the one I selected stay on log scale" SETS it (applied), never an exclusion
const STAY_SET = ['make the one I selected stay on log scale', 'make the one I clicked stay on log scale', "have the chart I'm on stay on log scale",
  'set the one I selected to stay on log scale']
describe('control: an imperative to make the click STAY on a setting sets it', () => {
  it.each(STAY_SET)('"%s" (c3 clicked) — a plan on the click is applied', async (t) => {
    const m = at('c3')
    p.st.envelopes.push(scaleOnAll('c3'))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual(['c3'])
  }, 40000)
})
// …and a negated position that fits SEVERAL charts is no over-ask when the target is clear: the click (outside it) is applied
describe('control: "this one, not the left one" (click in the right column) applies on the click', () => {
  it.each([['put this one on log scale, not the left one', 'c1'], ['log scale on this one, not the left ones', 'c3'],
    ['put this one on log scale, not the bottom ones', 'c1'], ['log scale on the one I selected, not the left one', 'c3']])('"%s" (%s clicked) — applied there, no ask', async (t, sel) => {
    const m = at(sel)
    p.st.envelopes.push(scaleOnAll(sel))
    await m.say(t)
    expect(logged(m.board), transcript()).toEqual([sel])
    expect(offered(), transcript()).toEqual([])
  }, 40000)
})
