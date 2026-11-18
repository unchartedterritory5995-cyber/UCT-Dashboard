// A chart named DIAGONALLY relative to the clicked one (pl-auto unseen9 P1, SIMULATED): FOUR board, top-left clicked, "make the
// chart diagonally opposite this one weekly" changed the CLICKED top-left with a success receipt. Expected: the bottom-right.
// "diagonally opposite", "across from" and "kitty-corner" relate a chart to the click (the click is the ANCHOR, never the target);
// with no unique diagonal cell the request is refused naming the real charts, never run on the click. Through the REAL panel on
// the fixture board; a plan on the meant chart is scripted in case the model is asked. Evidence: LOCAL native Windows Node v24,
// jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { relativeChart } from './deixis'
import { DIAGONAL_HELD_OUT } from './agentDiagonalChartHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// 2×2: c0 TL, c1 TR, c2 BL, c3 BR
const cell = (id, x, y, w = 12) => ({ id, type: 'chart', x, y, w, h: 10, color: 'N', opts: { settings: bareSettings() } })
const FOUR = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const FOUR_SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
// one row of three: no diagonal exists
const THREE = [cell('t0', 0, 0, 8), cell('t1', 8, 0, 8), cell('t2', 16, 0, 8)]
const THREE_SYMS = { 'N:t0': 'SPY', 'N:t1': 'QQQ', 'N:t2': 'NVDA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const planOn = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])

describe('relativeChart: the diagonal of the click', () => {
  const at = (ref, x, y) => ({ ref, cell: { x, y, w: 12, h: 10 } })
  const C = [at('c0', 0, 0), at('c1', 12, 0), at('c2', 0, 10), at('c3', 12, 10)]
  const hit = (t, sel) => relativeChart(t, C, sel)?.hits.map(c => c.ref) ?? null
  it.each([
    ['the chart diagonally opposite this one', 'c0', ['c3']], ['the one diagonally across from this', 'c3', ['c0']],
    ['the chart kitty-corner from this one', 'c1', ['c2']], ['the one across from this chart', 'c2', ['c1']],
  ])('%s (clicked %s) → %j', (t, sel, want) => expect(hit(t, sel)).toEqual(want))
})

describe('P1: "make the chart diagonally opposite this one weekly" (FOUR, top-left clicked)', () => {
  it('changes the bottom-right, never the clicked top-left', async () => {
    const m = p.mount(FOUR, FOUR_SYMS, { decorate: label })
    p.select('c0')
    p.st.envelopes.push(planOn('c3'))
    const out = await m.say('make the chart diagonally opposite this one weekly')
    expect(tfOf(m.board, 'c0'), out).toBe('D')
    expect(tfOf(m.board, 'c3'), out).toBe('W')
    expect(['c1', 'c2'].map(id => tfOf(m.board, id))).toEqual(['D', 'D'])
  }, 40000)
  it.each(DIAGONAL_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (_t, c) => {
    const m = p.mount(FOUR, FOUR_SYMS, { decorate: label })
    p.select(c.clicked)
    p.st.envelopes.push(planOn(c.meant))
    const out = await m.say(c.text)
    expect(tfOf(m.board, c.meant), out).toBe('W')
    expect(tfOf(m.board, c.clicked), out).toBe('D')
  }, 40000)
  it('NEGATIVE no diagonal cell (one row of three): asked with the real chart names; nothing changes, never the click', async () => {
    const m = p.mount(THREE, THREE_SYMS, { decorate: label })
    p.select('t0')
    p.st.envelopes.push(planOn('t0'))                         // even a plan on the click is never run for a diagonal reference
    await m.say('make the chart diagonally opposite this one weekly')
    expect(THREE.map(w => tfOf(m.board, w.id))).toEqual(['D', 'D', 'D'])
    expect(asked()).toBe(true)
    expect(transcript()).toMatch(/Chart \(t1\)/)
    expect(transcript()).toMatch(/Chart \(t2\)/)
  }, 40000)
})

// AUDIT GO (2)(3): the RELATION family, not one phrasing. When "this / this one / it / the selected one" is the ANCHOR of a relation
// (diagonal, opposite corner, across from, above / below / beside / left / right of …), the clicked chart is NEVER the target:
// the meant chart runs, a plan on the anchor is asked about (this guards the model path), and a relation that resolves to no single
// chart is asked about with the real names. Phrasings are this branch's own; AUDIT's probes are separate.
const NINE = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => ({ id: `g${r}${c}`, type: 'chart', x: c * 8, y: r * 10, w: 8, h: 10, color: 'N', opts: { settings: bareSettings() } })))
const NINE_SYMS = Object.fromEntries(NINE.map((w, i) => [`N:${w.id}`, ['SPY', 'QQQ', 'IWM', 'DIA', 'NVDA', 'AMD', 'TSLA', 'AAPL', 'MSFT'][i]]))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart do you mean|Did you mean/.test(transcript())
const runOn = async (widgets, syms, clicked, plan, text) => {
  const m = p.mount(widgets, syms, { decorate: label })
  p.select(clicked)
  if (plan) p.st.envelopes.push(planOn(plan))
  await m.say(text)
  return m.board
}
const tfsOf = (b, ws) => ws.map(w => tfOf(b, w.id)).join('')
describe('the anchor of a relation is never the target (the family)', () => {
  // [text, clicked, meant] on FOUR (c0 TL, c1 TR, c2 BL, c3 BR)
  const MEANT = [
    ['make the chart in the opposite corner from this one weekly', 'c1', 'c2'],
    ['the one directly across from it should be weekly', 'c3', 'c0'],
    ['make the chart diagonally opposite weekly', 'c0', 'c3'],                      // anchorless: the click is the anchor
    ['weekly on the cell kitty corner to the selected chart', 'c2', 'c1'],
  ]
  it.each(MEANT)('%s (clicked %s): the plan on %s runs there; the clicked chart is unchanged', async (t, clicked, meant) => {
    const b = await runOn(FOUR, FOUR_SYMS, clicked, meant, t)
    expect(tfOf(b, meant), transcript()).toBe('W')
    expect(tfOf(b, clicked)).toBe('D')
  }, 40000)
  it.each(MEANT)('%s (clicked %s): a plan on the CLICKED chart (the anchor) is asked about, nothing changes', async (t, clicked) => {
    const b = await runOn(FOUR, FOUR_SYMS, clicked, clicked, t)
    expect(tfsOf(b, FOUR), transcript()).toBe('DDDD')
    expect(asked()).toBe(true)
  }, 40000)
  it('a 3×3 grid: from a corner the diagonally opposite chart is the far corner; from the centre four fit, so it asks with their names', async () => {
    let b = await runOn(NINE, NINE_SYMS, 'g00', 'g22', 'make the chart diagonally opposite this one weekly')
    expect(tfOf(b, 'g22'), transcript()).toBe('W')
    expect(tfOf(b, 'g00')).toBe('D')
    cleanup(); p = setupPanel()
    b = await runOn(NINE, NINE_SYMS, 'g11', 'g11', 'make the chart diagonally opposite this one weekly')
    expect(tfsOf(b, NINE), transcript()).toBe('DDDDDDDDD')
    expect(asked()).toBe(true)
    for (const id of ['g00', 'g02', 'g20', 'g22']) expect(transcript()).toContain(`Chart (${id})`)
  }, 60000)
  it('NEGATIVE a relation word UCT cannot place ("facing", "on the far side of") never falls back to the anchor: asked, nothing changes', async () => {
    for (const t of ['make the chart facing this one weekly', 'make the one on the far side of this chart weekly']) {
      cleanup(); p = setupPanel()
      const b = await runOn(FOUR, FOUR_SYMS, 'c0', 'c0', t)
      expect(tfsOf(b, FOUR), `${t} | ${transcript()}`).toBe('DDDD')
      expect(asked(), t).toBe(true)
    }
  }, 60000)
  it('a bare "this" with no relation still means the clicked chart (unchanged rule)', async () => {
    const b = await runOn(FOUR, FOUR_SYMS, 'c1', 'c1', 'make this one weekly')
    expect(tfsOf(b, FOUR)).toBe('DWDD')
  }, 40000)
})

// AUDIT #988 HOLD: the relation as a MODIFIER BEFORE the noun ("the <relation> chart"), anchorless: the click is the anchor, never
// the target. The family × the nouns, built here rather than listed (no single phrasing is the point).
const MODIFIERS = ['opposite-corner', 'opposite corner', 'diagonal', 'diagonally-opposite', 'diagonally opposite', 'kitty-corner', 'kitty corner',
  'catty-corner', 'catty corner', 'far-corner', 'far corner']
const NOUNS = ['chart', 'one', 'cell', 'panel']
const VERBS = [(np) => `make ${np} weekly`, (np) => `switch ${np} to weekly`, (np) => `put ${np} on the weekly`]
describe('the relation as a modifier before the noun ("the <relation> chart"), anchored on the click', () => {
  const at = (ref, x, y) => ({ ref, cell: { x, y, w: 12, h: 10 } })
  const C = [at('c0', 0, 0), at('c1', 12, 0), at('c2', 0, 10), at('c3', 12, 10)]
  const OPP = { c0: 'c3', c1: 'c2', c2: 'c1', c3: 'c0' }
  const CASES = MODIFIERS.flatMap(mod => NOUNS.map(n => `the ${mod} ${n}`))
  it.each(CASES)('relativeChart("%s"): the click\'s diagonal, from every corner', (np) => {
    for (const sel of ['c0', 'c1', 'c2', 'c3']) expect(relativeChart(`make ${np} weekly`, C, sel)?.hits.map(c => c.ref), `${np} from ${sel}`).toEqual([OPP[sel]])
  })
  // through the panel: each modifier once (nouns and verbs rotate), clicked c2, meant c1
  const PANEL = MODIFIERS.map((mod, i) => VERBS[i % VERBS.length](`the ${mod} ${NOUNS[i % NOUNS.length]}`))
  it.each(PANEL)('"%s" (c2 clicked): the plan on the diagonal runs there; the click is unchanged', async (t) => {
    const b = await runOn(FOUR, FOUR_SYMS, 'c2', 'c1', t)
    expect(tfOf(b, 'c1'), transcript()).toBe('W')
    expect(tfOf(b, 'c2')).toBe('D')
  }, 40000)
  it.each(PANEL)('"%s" (c2 clicked): a plan on the CLICKED chart is asked about, nothing changes', async (t) => {
    const b = await runOn(FOUR, FOUR_SYMS, 'c2', 'c2', t)
    expect(tfsOf(b, FOUR), transcript()).toBe('DDDD')
    expect(asked()).toBe(true)
  }, 40000)
  it('NEGATIVE the modifier on a non-chart noun is no chart relation ("the diagonal line", "the opposite corner of the candle")', () => {
    for (const t of ['delete the diagonal line', 'draw a box in the opposite corner of the candle']) expect(relativeChart(t, C, 'c2'), t).toBeNull()
  })
})

// AUDIT (4), for the record: "across from this" on one row of two resolves to NO chart (they share the row) and asks
describe('across from this on a 1×2 row', () => {
  const TWO = [cell('a0', 0, 0), cell('a1', 12, 0)]
  const TWO_SYMS = { 'N:a0': 'SPY', 'N:a1': 'QQQ' }
  it('resolves to none and asks; nothing changes, never the click', async () => {
    const b = await runOn(TWO, TWO_SYMS, 'a0', 'a0', 'make the chart across from this one weekly')
    expect(tfsOf(b, TWO), transcript()).toBe('DD')
    expect(asked()).toBe(true)
  }, 40000)
})
