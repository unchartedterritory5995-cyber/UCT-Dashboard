// SPATIAL CONSTRAINT CHECK (#988, AUDIT probe 17 families, written from the FAMILIES — no probe phrasing):
//   (F-a) a WHOLE absolute line as the target ("the top row", "the left column"): only cells IN that line; a plan aimed outside
//         it (the click among them) is asked, never applied; the whole line planned runs on every cell of it.
//   (F-b) a relation from an ABSOLUTELY named anchor ("beside / next to / above / below / left of / right of the <place> chart")
//         with that anchor clicked: the anchor is never the target; the neighbour's plan runs; ambiguity is asked without it.
//   (C)   the checker itself (spatialCheck.checkSpatialConstraints) fed RANDOM violating plans (seeded) across the families
//         already on #988 (places in a line, whole lines, named-anchor relations, click-anchored relations, counts): every
//         violation is asked with only satisfying cells (never an anchor); every satisfying plan passes.
//   Negatives: a line or place in a clause that says it is fine / left alone / a comparison names no target: the click acts.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): native Windows Node v24, jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability, getTargetKind } from './capabilities'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { checkSpatialConstraints } from './spatialCheck'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
const grid = (rows) => rows.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H, r, c })))
const BOARDS = {
  '2x2': grid([['TL', 'TR'], ['BL', 'BR']]),
  '2x3': grid([['TL', 'TM', 'TR'], ['BL', 'BM', 'BR']]),
  '3x3': grid([['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]),
}
const cellOf = (g, id) => BOARDS[g].find(c => c.id === id)
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts|Pick one/.test(transcript())
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  if (sel) p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const planOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))

// ── the families, generated from the boards ──
const ROW_W = { top: 0, bottom: -1, first: 0, last: -1, middle: 'm' }
const COL_W = { left: 0, right: -1, first: 0, last: -1, middle: 'm' }
function lineCells(g, axis, word) {
  const cells = BOARDS[g]
  const keys = [...new Set(cells.map(c => (axis === 'row' ? c.r : c.c)))].sort((a, b) => a - b)
  const w = (axis === 'row' ? ROW_W : COL_W)[word]
  const k = w === 'm' ? (keys.length >= 3 && keys.length % 2 ? keys[(keys.length - 1) / 2] : null) : keys.at(w)
  return k == null ? null : cells.filter(c => (axis === 'row' ? c.r : c.c) === k).map(c => c.id)
}
const LINE_SAY = [
  (w, a) => `could you put the ${w} ${a} on the weekly view for me`,
  (w, a) => `switch the ${w} ${a} over to weekly please`,
  (w, a) => `I want the ${w} ${a} on weekly`,
]
const FA = Object.keys(BOARDS).flatMap(g => [['row', ROW_W], ['column', COL_W]].flatMap(([axis, words]) => Object.keys(words).flatMap((w, i) => {
  const line = lineCells(g, axis, w)
  const outside = line && BOARDS[g].map(c => c.id).find(id => !line.includes(id))
  return line && outside ? [{ g, axis, w, line, outside, text: LINE_SAY[i % LINE_SAY.length](w, axis) }] : []
})))

const POS_NAME = (g, id) => {
  const c = cellOf(g, id), rows = Math.max(...BOARDS[g].map(x => x.r)) + 1, cols = Math.max(...BOARDS[g].map(x => x.c)) + 1
  const v = c.r === 0 ? 'top' : c.r === rows - 1 ? 'bottom' : 'middle'
  const h = c.c === 0 ? 'left' : c.c === cols - 1 ? 'right' : 'middle'
  return v === 'middle' && h === 'middle' ? 'middle' : `${v}-${h}`
}
const REL = [
  ['beside', ['left', 'right']], ['next to', ['left', 'right']], ['above', ['above']], ['below', ['below']],
  ['to the left of', ['left']], ['to the right of', ['right']],
]
function sideCells(g, id, side) {
  const a = cellOf(g, id)
  const dr = side === 'above' ? -1 : side === 'below' ? 1 : 0, dc = side === 'left' ? -1 : side === 'right' ? 1 : 0
  return BOARDS[g].filter(c => c.r === a.r + dr && c.c === a.c + dc).map(c => c.id)
}
const FB = Object.keys(BOARDS).flatMap(g => BOARDS[g].flatMap((a, ai) => REL.map(([word, sides], ri) => {
  const meant = sides.flatMap(s => sideCells(g, a.id, s))
  const noun = (ai + ri) % 2 ? 'chart' : 'one'
  const text = (ai + ri) % 3 === 0 ? `could you make the chart ${word} the ${POS_NAME(g, a.id)} ${noun} weekly for me`
    : (ai + ri) % 3 === 1 ? `put the one ${word} the ${POS_NAME(g, a.id)} ${noun} on the weekly view please` : `I want the chart ${word} the ${POS_NAME(g, a.id)} ${noun} on weekly`
  return { g, anchor: a.id, word, meant, text }
})))
// a fixed spread through the panel (by index, never by outcome)
const FA_PANEL = FA.filter((f, i) => i % 3 === 0)
const FB_PANEL = FB.filter((f, i) => i % 5 === 0)

describe('(F-a) a whole absolute line as the target: only cells in that line', () => {
  it('the family is generated from the boards (rows and columns, every line word)', () => {
    expect(FA.length).toBeGreaterThan(15)
    expect(new Set(FA.map(f => f.axis))).toEqual(new Set(['row', 'column']))
  })
  it.each(FA_PANEL.map(f => [f.text, f.g, f]))('"%s" (%s), click OUTSIDE the line: a plan on the click is asked, never applied; only line cells offered', async (t, g, f) => {
    const m = mount(g, f.outside)
    p.st.envelopes.push(planOn(f.outside))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([])
    expect(asked(), transcript()).toBe(true)
    expect(offered().every(id => f.line.includes(id)), transcript()).toBe(true)
  }, 40000)
  it.each(FA_PANEL.map(f => [f.text, f.g, f]))('"%s" (%s): the whole line planned runs on every cell of it', async (t, g, f) => {
    const m = mount(g, f.outside)
    p.st.envelopes.push(planOn(...f.line))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([...f.line].sort())
  }, 40000)
})

describe('(F-b) a relation from a NAMED anchor that is the click: the anchor is never the target', () => {
  it('the family is generated from the boards (every cell as the anchor, six relation words)', () => {
    expect(FB.length).toBeGreaterThan(80)
  })
  it.each(FB_PANEL.map(f => [f.text, f.g, f.anchor, f]))('"%s" (%s, clicked = the anchor %s): a plan on the anchor never runs; it is never offered', async (t, g, _a, f) => {
    const m = mount(g, f.anchor)
    p.st.envelopes.push(planOn(f.anchor))
    await m.say(t)
    // (the instant path may read the words itself and change the neighbour they mean: that is the right chart)
    expect(changed(m.board), transcript()).not.toContain(f.anchor)
    expect(changed(m.board).every(id => f.meant.includes(id)), transcript()).toBe(true)
    expect(offered(), transcript()).not.toContain(f.anchor)
  }, 40000)
  it.each(FB_PANEL.filter(f => f.meant.length === 1).map(f => [f.text, f.g, f]))('"%s" (%s): the one neighbour\'s plan runs, nothing asked', async (t, g, f) => {
    const m = mount(g, f.anchor)
    p.st.envelopes.push(planOn(f.meant[0]))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual(f.meant)
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})

// ── (C) the checker against random violating plans ──
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }
// [words, board, clicked, cells that satisfy the words, anchors (never satisfy)]
const CASES = [
  ...FA.map(f => [f.text, f.g, f.outside, f.line, []]),
  ...FB.filter(f => f.meant.length).map(f => [f.text, f.g, f.anchor, f.meant, [f.anchor]]),
  ['could you set the middle one of the top row to the weekly view for me', '3x3', 'TL', ['TM'], []],
  ['please put the bottom row\'s last chart on weekly', '2x3', 'TL', ['BR'], []],
  ['could you make the first one in the right column weekly for me', '3x3', 'MM', ['TR'], []],
  ['could you put the chart above this one on weekly for me', '3x3', 'MM', ['TM'], ['MM']],
  ['make the one to the left of this weekly please, thanks', '2x3', 'BR', ['BM'], ['BR']],
  ['could you make the chart below it weekly', '2x2', 'TR', ['BR'], ['TR']],
]
describe('(C) the constraint check: random violating plans are asked; satisfying plans pass', () => {
  it.each(CASES.map(c => [c[0], c[1], c]))('"%s" (%s)', (t, g, [, , sel, okIds, anchors]) => {
    const { h } = mount(g, sel)
    const all = BOARDS[g].map(c => c.id)
    const bad = all.filter(id => !okIds.includes(id))
    const r = rng(t.length * 7919 + all.length)
    const op = (id) => ({ action: 'chart.setTimeframe', target: id, args: { timeframe: 'W' } })
    const check = (ids) => checkSpatialConstraints({ host: h, ops: ids.map(op), text: t, getTargetKind, getCapability })
    // every satisfying single target passes
    for (const id of okIds) expect(check([id]), `${t}: ${id} satisfies`).toBeNull()
    // 6 random violating plans: one bad cell alone, or a bad cell beside a good one; the anchor and the click among them
    const pool = [...new Set([...anchors, ...(bad.includes(sel) ? [sel] : []), ...bad])]
    for (let i = 0; i < 6 && pool.length; i++) {
      const b = pool[i < 2 ? i % pool.length : Math.floor(r() * pool.length)]
      const ids = i % 2 && okIds.length ? [okIds[Math.floor(r() * okIds.length)], b] : [b]
      const res = check(ids)
      expect(res?.ask, `${t}: [${ids}] violates`).toBeTruthy()
      const offeredIds = res.ask.choices.map(c => c.ref)
      for (const a of anchors) expect(offeredIds, `${t}: anchor ${a} offered`).not.toContain(a)
      expect(offeredIds.every(id => okIds.includes(id)), `${t}: offered ${offeredIds}`).toBe(true)
    }
  })
})

describe('negatives: a line or place the words do not aim at — the click acts', () => {
  const ACT = [
    ['this one to weekly please, the middle of the bottom row looks fine', '3x3', 'TL'],
    ['leave the left column alone and put this chart on weekly', '2x3', 'TR'],
    ['make this chart weekly like the top row', '2x3', 'BM'],
    ['put this one on weekly, the top row can stay as it is', '3x3', 'MM'],
  ]
  it.each(ACT)('"%s" (%s, clicked %s): the plan on the click runs there', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([sel])
  }, 40000)
})
