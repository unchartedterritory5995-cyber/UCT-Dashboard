// ABSOLUTE line ordinals (#988, AUDIT GO run 23b99fc0a1, the one unsafe case of 86 — written from the FAMILY, not that case):
//   "<first|second|third|last|middle|leftmost|rightmost|top|bottom> <one|chart> <of|in|on> the <top|bottom|middle|first|last|
//   left|right> <row|column>", and the same with the line first ("the top row's middle chart"). The words name ONE cell with no
//   anchor: the clicked chart is never applied unless it IS that cell, wherever the click is — inside the named line, outside
//   it, or on the cell itself. The resolved chart's own plan runs with nothing asked. "this row" (the click's line) is
//   agentLineRelations' rail and is unchanged.
// Two levels: deixis.ordinalChart over EVERY combination on 1×3, 2×3 and 3×3 (fast, the whole family), and the real panel on
// a fixed spread of them (click inside the line / outside it / on the cell; a plan on the click and a plan on the cell).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): native Windows Node v24, jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { ordinalChart } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
const grid = (rows) => rows.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H, r, c })))
const BOARDS = {
  '1x3': grid([['L', 'M', 'R']]),
  '2x3': grid([['TL', 'TM', 'TR'], ['BL', 'BM', 'BR']]),
  '3x3': grid([['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]),
}
// the board's lines, by the words that name each one (absolute: never "this")
function lines(cells) {
  const rows = [...new Set(cells.map(c => c.r))].sort(), cols = [...new Set(cells.map(c => c.c))].sort()
  const named = (keys, axis, words) => keys.flatMap((k, i) => {
    const ws = []
    if (i === 0) ws.push(words[0], 'first')
    if (i === keys.length - 1) ws.push(words[1], 'last')
    if (keys.length % 2 === 1 && i === (keys.length - 1) / 2 && keys.length >= 3) ws.push('middle')
    if (i === 1 && keys.length >= 3) ws.push('second')
    const line = cells.filter(c => (axis === 'row' ? c.r : c.c) === k).sort((a, b) => (axis === 'row' ? a.c - b.c : a.r - b.r))
    return ws.map(w => ({ axis, which: w, line }))
  })
  return [...named(rows, 'row', ['top', 'bottom']), ...named(cols, 'column', ['left', 'right'])]
}
// the places in a line, by the words that name each one
function places(axis, line) {
  const n = line.length, out = []
  const add = (w, i) => out.push({ pos: w, cell: line[i] })
  add('first', 0); add('last', n - 1)
  if (n >= 2) add('second', 1)
  if (n >= 3) add('third', 2)
  if (n >= 3 && n % 2 === 1) add('middle', (n - 1) / 2)
  if (axis === 'row') { add('leftmost', 0); add('rightmost', n - 1) } else { add('top', 0); add('bottom', n - 1) }
  return out
}
const NOUNS = ['one', 'chart'], PREPS = ['of', 'in', 'on']
// every phrasing of a (place, line): the ordinal first (noun x preposition), and the line first ("the top row's middle chart")
const phrasings = (pos, which, axis) => [
  ...NOUNS.flatMap(n => PREPS.map(pr => `the ${pos} ${n} ${pr} the ${which} ${axis}`)),
  `the ${which} ${axis}'s ${pos} chart`, `the ${which} ${axis}'s ${pos} one`,
]
const FAMILY = Object.entries(BOARDS).flatMap(([g, cells]) => lines(cells).flatMap(({ axis, which, line }) =>
  // (a one-chart line names no place in it but itself — "the top one of the left column" on 1×3 still names that cell)
  places(axis, line).map(({ pos, cell }) => ({ g, axis, which, pos, meant: cell.id, line: line.map(c => c.id) }))))
const charts = (g) => BOARDS[g].map(c => ({ ref: c.id, label: `Chart (${c.id})`, cell: { x: c.x, y: c.y, w: c.w, h: c.h } }))

describe('the family resolves to one cell, with no anchor (deixis.ordinalChart, every combination)', () => {
  it('the family is the boards\' own lines and places (not a hand-picked list)', () => {
    expect(FAMILY.length).toBeGreaterThan(80)
    expect(FAMILY.some(f => f.g === '1x3' && f.axis === 'row' && f.pos === 'middle' && f.meant === 'M')).toBe(true)
  })
  it.each(FAMILY.map(f => [`${f.pos} … ${f.which} ${f.axis}`, f.g, f]))('%s (%s)', (_, g, f) => {
    for (const t of phrasings(f.pos, f.which, f.axis)) {
      const r = ordinalChart(`make ${t} weekly`, charts(g))
      expect(r?.ref, `${t} on ${g}`).toBe(f.meant)
    }
  })
})

// ── through the real panel ──
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts|Pick one/.test(transcript())
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  if (sel) p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id)
const planOn = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])

// A fixed spread over the family: every board and both axes, each phrasing shape, the click INSIDE the named line (the AUDIT
// case), OUTSIDE it, and ON the cell. Picked by index (deterministic), never by which case passes.
const clickInside = (f) => f.line.find(id => id !== f.meant) || null
const clickOutside = (f) => BOARDS[f.g].map(c => c.id).find(id => !f.line.includes(id)) || null
// Each in two wordings: one the instant path reads itself, and one only the model plans (the plan the test scripts is what runs
// or is screened — the AUDIT case was a MODEL plan; `model` cases assert the model really was asked).
const SPREAD = FAMILY.filter((f, i) => i % 8 === 0).flatMap((f, i) => {
  const ph = phrasings(f.pos, f.which, f.axis)[i % 8]
  return [{ ...f, text: `make ${ph} weekly` }, { ...f, text: `could you put ${ph} on the weekly view for me, thanks`, model: true }]
})
const AUDIT = { g: '3x3', axis: 'row', which: 'top', pos: 'middle', meant: 'TM', line: ['TL', 'TM', 'TR'], text: 'set the middle one of the top row to weekly' }
const AUDIT_M = { ...AUDIT, text: 'could you set the middle one of the top row to the weekly view for me', model: true }
const PANEL = [AUDIT, AUDIT_M, { ...AUDIT_M, g: '1x3', meant: 'M', line: ['L', 'M', 'R'] }, { ...AUDIT_M, g: '2x3' }, ...SPREAD]

describe('through the panel: the clicked chart is applied only when it IS the named cell', () => {
  it('the spread covers every board, both axes and both phrasing shapes', () => {
    expect(new Set(PANEL.map(f => f.g))).toEqual(new Set(['1x3', '2x3', '3x3']))
    expect(new Set(PANEL.map(f => f.axis))).toEqual(new Set(['row', 'column']))
    expect(PANEL.some(f => /'s /.test(f.text))).toBe(true)
  })
  it.each(PANEL.filter(f => clickInside(f)).map(f => [f.text, f.g, f]))('"%s" (%s), click INSIDE the line: a plan on the click never runs', async (t, g, f) => {
    const sel = clickInside(f)
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    if (f.model) expect(p.turns(), transcript()).toBeGreaterThan(0)
    expect(changed(m.board), transcript()).not.toContain(sel)
  }, 40000)
  it.each(PANEL.filter(f => clickInside(f)).map(f => [f.text, f.g, f]))('"%s" (%s), click INSIDE the line: the named cell\'s plan runs, nothing asked', async (t, g, f) => {
    const m = mount(g, clickInside(f))
    p.st.envelopes.push(planOn(f.meant))
    await m.say(t)
    if (f.model) expect(p.turns(), transcript()).toBeGreaterThan(0)
    expect(changed(m.board), transcript()).toEqual([f.meant])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
  it.each(PANEL.filter(f => clickOutside(f)).map(f => [f.text, f.g, f]))('"%s" (%s), click OUTSIDE the line: a plan on the click never runs; the cell\'s does', async (t, g, f) => {
    const sel = clickOutside(f)
    let m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    if (f.model) expect(p.turns(), transcript()).toBeGreaterThan(0)
    expect(changed(m.board), transcript()).not.toContain(sel)
    cleanup(); p = setupPanel()
    m = mount(g, sel)
    p.st.envelopes.push(planOn(f.meant))
    await m.say(t)
    if (f.model) expect(p.turns(), transcript()).toBeGreaterThan(0)
    expect(changed(m.board), transcript()).toEqual([f.meant])
  }, 40000)
  it.each([AUDIT, PANEL[1], PANEL[2]].map(f => [f.text, f.g, f]))('"%s" (%s), click ON the named cell: it runs there', async (t, g, f) => {
    const m = mount(g, f.meant)
    p.st.envelopes.push(planOn(f.meant))
    await m.say(t)
    if (f.model) expect(p.turns(), transcript()).toBeGreaterThan(0)
    expect(changed(m.board), transcript()).toEqual([f.meant])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})
