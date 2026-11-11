// #988 follow-up (LOCAL / SIMULATED, BROWSER-MOCK-MODEL): a TRAILING NEGATION of one chart — "<change>, not <chart>",
// "<change> except <chart>", "<change> on everything but <chart>", "<change>, but not on <chart>" — leaves that chart out and
// means the charts it leaves. On 9e79f5efc0 the excluded chart was never touched (#988), but with the model's plan on the chart
// that is left the member was still asked "Which chart?" (two charts: there is only one chart it can be), and one form asked
// "Did you mean <the excluded chart>?" while offering only the other one.
// The family, by how the chart is named (ticker with or without a chart noun, position, order) × the four forms (plus two more
// exclusion operators) × where the model aimed × the click (none, on the excluded chart, on the other one):
//   (a) model on the chart that is left → applied there, no question
//   (b) a question never NAMES the excluded chart in its text, and never offers it
//   (c) model on the excluded chart → never applied, carded or offered (asked or refused)
//   (d) controls: ", not <a value>" is no chart exclusion — applied on the click
// Phrasings are pl-neg's own.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, w) => ({ id, type: 'chart', x, y: 0, w, h: 20, color: 'N', opts: { settings: bareSettings() } })
// 1×2: cl (NVDA, left) · cr (AMD, right) — 1×3: c0 (NVDA) · c1 (AMD) · c2 (TSLA)
const B12 = { w: [cell('cl', 0, 12), cell('cr', 12, 12)], s: { 'N:cl': 'NVDA', 'N:cr': 'AMD' } }
const B13 = { w: [cell('c0', 0, 8), cell('c1', 8, 8), cell('c2', 16, 8)], s: { 'N:c0': 'NVDA', 'N:c1': 'AMD', 'N:c2': 'TSLA' } }
const SYM = (board, id) => board.s[`N:${id}`]

const choices = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const carded = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const hidden = (b) => b.state.widgets.filter(w => w.opts?.settings?.volume?.visible === false).map(w => w.id).sort()
const logged = (b) => b.state.widgets.filter(w => w.opts?.settings?.logScale).map(w => w.id).sort()
// the reply's own words: the choice buttons' labels taken out
const words = (out) => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].reduce((s, b) => s.split(b.textContent).join(' '), out)
const mount = (board, click) => {
  const m = p.mount(board.w, board.s)
  if (click) p.select(click)
  return m
}
const volOn = (id) => (body) => p.env('apply', [{ action: 'volume.setState', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { state: 'hidden' } }])
const scaleOn = (id) => (body) => p.env('apply', [{ action: 'chart.setScale', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { scale: 'log' } }])

// the excluded chart is the LEFT one (NVDA) on the 1×2, named every way the family has
const NAMES = ['the NVDA chart', 'NVDA', 'the NVDA one', 'the left chart', 'the left one', 'the first chart']
const FORMS = [(x) => `hide volume, not ${x}`, (x) => `hide volume except ${x}`, (x) => `hide volume on everything but ${x}`,
  (x) => `hide volume, but not on ${x}`, (x) => `hide the volume other than on ${x}`, (x) => `hide volume excluding ${x}`]
const SAYS = FORMS.flatMap(f => NAMES.map(n => f(n)))
const CLICKS = [null, 'cl', 'cr']

describe('two charts: a trailing negation of one means the other', () => {
  it.each(CLICKS.flatMap(c => SAYS.map(t => [t, c])))('"%s" (click %s) — the model on the chart that is left: applied, no question', async (t, click) => {
    const m = mount(B12, click)
    p.st.envelopes.push(volOn('AMD'))
    const out = await m.say(t)
    expect(hidden(m.board), out).toEqual(['cr'])
    expect(choices(), out).toEqual([])
  }, 40000)
  it.each(CLICKS.flatMap(c => SAYS.map(t => [t, c])))('"%s" (click %s) — the model on the excluded chart: never applied, carded, offered or named', async (t, click) => {
    const m = mount(B12, click)
    p.st.envelopes.push(volOn('NVDA'))
    const out = await m.say(t)
    expect(hidden(m.board), out).not.toContain('cl')
    expect(carded(), out).not.toContain('NVDA')
    expect(choices(), out).not.toContain('NVDA')
    expect(words(out).replace(t, ' '), out).not.toMatch(/NVDA/)
  }, 40000)
})

// three charts: the words leave two, so a plan on one of them is the click's (when it is clicked) or asked — never the excluded one
const FORMS3 = [(x) => `hide volume, not ${x}`, (x) => `hide volume except ${x}`, (x) => `hide volume, but not on ${x}`]
const NAMES3 = ['the NVDA chart', 'the left one']
describe('three charts: a trailing negation of one', () => {
  const SAYS3 = FORMS3.flatMap(f => NAMES3.map(n => f(n)))
  it.each(SAYS3)('"%s" (AMD clicked, model on AMD) — applied there, no question', async (t) => {
    const m = mount(B13, 'c1')
    p.st.envelopes.push(volOn('AMD'))
    const out = await m.say(t)
    expect(hidden(m.board), out).toEqual(['c1'])
    expect(choices(), out).toEqual([])
  }, 40000)
  it.each(CLICKS.map(c => (c === 'cl' ? 'c0' : c === 'cr' ? 'c1' : null)).flatMap(c => SAYS3.map(t => [t, c])))('"%s" (click %s, model on TSLA) — never the excluded chart offered or named', async (t, click) => {
    const m = mount(B13, click)
    p.st.envelopes.push(volOn('TSLA'))
    const out = await m.say(t)
    expect(hidden(m.board), out).not.toContain('c0')
    expect(choices(), out).not.toContain('NVDA')
    expect(words(out).replace(t, ' '), out).not.toMatch(/NVDA/)
    if (click === 'c1') expect(hidden(m.board), out).toEqual([])            // the click is not TSLA: the plan is asked, never run
  }, 40000)
  it.each(SAYS3)('"%s" (NVDA clicked, model on NVDA) — never applied', async (t) => {
    const m = mount(B13, 'c0')
    p.st.envelopes.push(volOn('NVDA'))
    const out = await m.say(t)
    expect(hidden(m.board), out).toEqual([])
    expect(choices(), out).not.toContain('NVDA')
    expect(words(out).replace(t, ' '), out).not.toMatch(/NVDA/)
  }, 40000)
})

// (d) controls: a value after "not" is a contrast on the change, never a chart left out — applied on the click
const NOT_VALUE = ['put this one on log scale, not linear', 'log scale on this chart, not daily', 'make it log, not linear',
  'log scale here, not the 200', 'put this chart on log scale, not the 50']
describe('control: ", not <a value>" still applies on the click', () => {
  it.each(CLICKS.slice(1).flatMap(c => NOT_VALUE.map(t => [t, c])))('"%s" (click %s)', async (t, click) => {
    const m = mount(B12, click)
    p.st.envelopes.push(scaleOn(SYM(B12, click)))
    const out = await m.say(t)
    expect(logged(m.board), out).toEqual([click])
    expect(choices(), out).toEqual([])
  }, 40000)
})
