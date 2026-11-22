// CLICK-LINE families (#988, pl-auto unseen12 shapes, written from the FAMILIES — no unseen phrasing):
//   (R) "the rest of / the other charts in / everything else in this row | column": the click's line MINUS the click (a set)
//   (O) "the other chart in this row | column" (one): that line minus the click — one chart → it; several → asked, never the click
//   (S) "same <axis>, other <axis>" (comma / colon forms) and "same row, far end from this one"
//   (E) "the other side of the <row> from this one", "the <top|bottom> corner on the same side as this one",
//       "step one <column|row> <direction> from this chart"
//   (A) negative: "… on this one, the <ordinal> chart in its row" where that IS the click: the click (an appositive, no other chart)
// For each: the plan on the chart(s) meant runs with nothing asked; a plan on the click (when it is not meant) never runs, and no
// picker ever lists the anchor. Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
const grid = (rows) => rows.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H, r, c })))
const BOARDS = {
  FOUR: grid([['TL', 'TR'], ['BL', 'BR']]),
  SIX: grid([['TL', 'TM', 'TR'], ['BL', 'BM', 'BR']]),
  NINE: grid([['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]),
}
const cell = (g, id) => BOARDS[g].find(c => c.id === id)
const at = (g, r, c) => BOARDS[g].find(x => x.r === r && x.c === c)?.id || null
const lineOf = (g, id, axis) => { const a = cell(g, id); return BOARDS[g].filter(c => (axis === 'row' ? c.r === a.r : c.c === a.c)).map(c => c.id) }
const nRows = (g) => Math.max(...BOARDS[g].map(c => c.r)) + 1
const nCols = (g) => Math.max(...BOARDS[g].map(c => c.c)) + 1

const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts|Pick one/.test(transcript())
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT'][i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const planOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))

// ── the families, generated: [words, board, clicked, meant (a set) | null (asked: no single reading)] ──
const REST = ['could you put the rest of this {axis} on the weekly view', 'switch the other charts in this {axis} to weekly please', 'everything else in this {axis} to weekly, thanks']
const OTHER_ONE = ['could you put the other chart in this {axis} on weekly', 'switch the other one in this {axis} to weekly please']
const SAME_OTHER = ['same {a}, other {b}: weekly please', 'could you do the same {a} but the other {b} on weekly']
const R = [], O = [], S = [], E = []
for (const g of Object.keys(BOARDS)) for (const c of BOARDS[g]) {
  for (const axis of ['row', 'column']) {
    const rest = lineOf(g, c.id, axis).filter(id => id !== c.id)
    if (rest.length) R.push([REST[(c.r + c.c + (axis === 'row' ? 0 : 1)) % REST.length].replace('{axis}', axis), g, c.id, rest])
    O.push([OTHER_ONE[(c.r + c.c) % OTHER_ONE.length].replace('{axis}', axis), g, c.id, rest.length === 1 ? rest : null])
  }
  // same column, other row → the other cells of the click's column; same row, other column → of its row
  for (const [a, b] of [['column', 'row'], ['row', 'column']]) {
    const meant = lineOf(g, c.id, a).filter(id => id !== c.id)
    S.push([SAME_OTHER[(c.r + c.c) % SAME_OTHER.length].replace('{a}', a).replace('{b}', b), g, c.id, meant.length === 1 ? meant : null])
  }
  // same row, far end: the cell at the other end of the click's row (only when the click is at one end)
  const row = lineOf(g, c.id, 'row')
  if (row.length >= 2 && (c.c === 0 || c.c === nCols(g) - 1)) S.push(['same row, far end from this one: weekly please', g, c.id, [c.c === 0 ? row[row.length - 1] : row[0]]])
  // the other side of the row the click is in, from it (the click at one end)
  if (row.length >= 2 && (c.c === 0 || c.c === nCols(g) - 1)) {
    const rw = c.r === 0 ? 'top' : c.r === nRows(g) - 1 ? 'bottom' : null
    if (rw) E.push([`could you put the chart on the other side of the ${rw} row from this one on weekly`, g, c.id, [c.c === 0 ? row[row.length - 1] : row[0]]])
  }
  // the top / bottom corner on the same side as the click (the click on a side column, not that corner itself)
  if (c.c === 0 || c.c === nCols(g) - 1) {
    for (const v of ['top', 'bottom']) {
      const corner = at(g, v === 'top' ? 0 : nRows(g) - 1, c.c)
      if (corner && corner !== c.id) E.push([`could you put the ${v} corner on the same side as this one on weekly`, g, c.id, [corner]])
    }
  }
  // one step from the click
  for (const [dir, dr, dc, unit] of [['right', 0, 1, 'column'], ['left', 0, -1, 'column'], ['down', 1, 0, 'row'], ['up', -1, 0, 'row']]) {
    const to = at(g, c.r + dr, c.c + dc)
    if (to) E.push([`step one ${unit} ${dir} from this chart and make it weekly`, g, c.id, [to]])
  }
}
// a fixed spread (by index, never by outcome)
const pick = (list, k) => list.filter((x, i) => i % k === 0)
const PANEL = [...pick(R, 3), ...pick(O, 3), ...pick(S, 2), ...pick(E, 3)]   // (R alternates row / column per cell: a step of 3 takes both)

describe('click-line families: the chart(s) meant run; the click (the anchor) never runs and is never offered', () => {
  it('the families are generated from the boards', () => {
    for (const f of [R, O, S, E]) expect(f.length).toBeGreaterThan(10)
  })
  it.each(PANEL.filter(f => f[3]).map(f => [f[0], f[1], f[2], f[3]]))('"%s" (%s, clicked %s → %j): that plan runs, nothing asked', async (t, g, sel, meant) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(...meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([...meant].sort())
    expect(asked(), transcript()).toBe(false)
  }, 40000)
  it.each(PANEL.map(f => [f[0], f[1], f[2]]))('"%s" (%s, clicked %s): a plan on the click never runs; no picker lists it', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    expect(offered(), transcript()).not.toContain(sel)
  }, 40000)
  it.each(PANEL.filter(f => !f[3]).map(f => [f[0], f[1], f[2]]))('"%s" (%s, clicked %s): no single reading — asked, never the click', async (t, g, sel) => {
    const m = mount(g, sel)
    const other = BOARDS[g].map(c => c.id).find(id => id !== sel)
    p.st.envelopes.push(planOn(other))
    await m.say(t)
    expect(offered(), transcript()).not.toContain(sel)
  }, 40000)
})

describe('(A) negative: "this one" plus an appositive that describes the SAME chart is the click', () => {
  const ACT = []
  for (const g of Object.keys(BOARDS)) for (const c of BOARDS[g]) {
    const row = lineOf(g, c.id, 'row'), col = lineOf(g, c.id, 'column')
    if (row[0] === c.id) ACT.push([`weekly on this one, the first chart in its row`, g, c.id])
    if (row[row.length - 1] === c.id && row.length > 1) ACT.push([`put this one on weekly, the last chart in its row`, g, c.id])
    if (col[0] === c.id && col.length > 1) ACT.push([`weekly for this chart, the top one in its column`, g, c.id])
  }
  it.each(pick(ACT, 2))('"%s" (%s, clicked %s): the plan on the click runs there, nothing asked', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([sel])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})

// pl-auto V2 (fb6170315e, unseen12 #22 — written as the family): a back-reference after a STEP or a relation from the click ("…
// from this chart and make it | that | that one | the one there weekly") is the chart REACHED; no question ever names the anchor
describe('back-references after a step: the reached chart, never the click', () => {
  const REFS = ['it', 'that', 'that one', 'the one there']
  const B = []
  for (const g of Object.keys(BOARDS)) for (const c of BOARDS[g]) {
    for (const [dir, dr, dc, unit] of [['right', 0, 1, 'column'], ['left', 0, -1, 'column'], ['down', 1, 0, 'row'], ['up', -1, 0, 'row']]) {
      const to = at(g, c.r + dr, c.c + dc)
      if (to) B.push([`step one ${unit} ${dir} from this chart and make ${REFS[(c.r + c.c + dr + dc + 4) % REFS.length]} weekly`, g, c.id, to])
    }
  }
  it.each(pick(B, 4))('"%s" (%s, clicked %s → %s): that plan runs, nothing asked', async (t, g, sel, to) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(to))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([to])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
  it.each(pick(B, 4))('"%s" (%s, clicked %s): a plan on the click never runs; no question names it', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(sel)
    expect(offered(), transcript()).not.toContain(sel)
    expect(transcript(), transcript()).not.toMatch(new RegExp(`Did you mean Chart \(${sel}\)`))
  }, 40000)
})
