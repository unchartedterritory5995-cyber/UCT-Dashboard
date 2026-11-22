// AUDIT probe-19 FAMILIES (#988; families only, my own phrasings), on ticker-labelled 2×2, 2×3 and 3×3 boards. One structure:
// COUNT + DIRECTION + ANCHOR (+ an EXCLUSION set):
//   (H1) counted plural relations from the click — "the <n> charts <direction> of this one", "the other <n> in this row": the line
//        that way; a count the board does not have is ASKED
//   (H2) an exclusion by count and side — "everything except the <n> on the <side>": a plan that includes an excluded chart is
//        never applied and never carded (apply AND proposal paths)
//   (H3) a plural relation to a whole LINE — "the charts under this row", "the pair above this row": the adjacent line; the
//        click's line is the anchor, never the target
//   (H4) two-axis diagonals — "diagonally below and to the right of this": that cell, or said to be off the board (never wrapped)
//   (H5) negatives — "this chart …, the chart below it already is", "…, the two to its right are fine": the click acts, nothing asked
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
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
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AMD', 'TSLA', 'META', 'AAPL', 'MSFT', 'AVGO']
const grid = (rows) => rows.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H, r, c })))
const BOARDS = {
  '2x2': grid([['TL', 'TR'], ['BL', 'BR']]),
  '2x3': grid([['TL', 'TM', 'TR'], ['BL', 'BM', 'BR']]),
  '3x3': grid([['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]),
}
const N = ['zero', 'one', 'two', 'three', 'four']
const at = (g, r, c) => BOARDS[g].find(x => x.r === r && x.c === c)?.id || null
const cell = (g, id) => BOARDS[g].find(c => c.id === id)
const rows = (g) => Math.max(...BOARDS[g].map(c => c.r)) + 1
const cols = (g) => Math.max(...BOARDS[g].map(c => c.c)) + 1
const DIR = { right: [0, 1], left: [0, -1], below: [1, 0], above: [-1, 0] }
const walk = (g, id, d) => { const a = cell(g, id), out = []; let r = a.r + DIR[d][0], c = a.c + DIR[d][1]; while (at(g, r, c)) { out.push(at(g, r, c)); r += DIR[d][0]; c += DIR[d][1] } return out }

const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts|Pick one|isn't|there (?:are|is) only|no chart/i.test(transcript())
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const cards = () => document.querySelectorAll('[data-testid="agent-proposal"]').length
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: label })
  if (sel) p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const mk = (disp) => (...ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))
const planOn = mk('apply'), proposeOn = mk('propose')
const pick = (list, k) => list.filter((x, i) => i % k === 0)

// ── the families, generated ──
const H1 = [], H2 = [], H3 = [], H4 = [], H5 = []
const SIDE_WORD = { right: 'to the right of', left: 'to the left of', below: 'below', above: 'above' }
for (const g of Object.keys(BOARDS)) BOARDS[g].forEach((c, i) => {
  for (const d of Object.keys(DIR)) {
    const line = walk(g, c.id, d)
    for (const n of [2, 3]) {
      const say = i % 2 ? `could you put the ${N[n]} charts ${SIDE_WORD[d]} this one on weekly` : `the ${N[n]} ones ${SIDE_WORD[d]} this chart to weekly please`
      H1.push({ g, sel: c.id, text: say, meant: line.length === n ? line : null, avail: line })
    }
  }
  for (const axis of ['row', 'column']) {
    const rest = BOARDS[g].filter(x => (axis === 'row' ? x.r === c.r : x.c === c.c) && x.id !== c.id).map(x => x.id)
    for (const n of [1, 2]) H1.push({ g, sel: c.id, text: `switch the other ${N[n]} in this ${axis} to weekly please`, meant: rest.length === n ? rest : null, avail: rest })
  }
  // H3: the adjacent row / column, from the click's line
  for (const [word, axis, dr, dc] of [['under', 'row', 1, 0], ['above', 'row', -1, 0], ['to the right of', 'column', 0, 1], ['to the left of', 'column', 0, -1]]) {
    const line = BOARDS[g].filter(x => (axis === 'row' ? x.r === c.r + dr : x.c === c.c + dc)).map(x => x.id)
    const noun = line.length === 2 && i % 2 ? 'pair' : 'charts'
    H3.push({ g, sel: c.id, text: `could you put the ${noun} ${word} this ${axis} on weekly`, meant: line.length ? line : null, line: BOARDS[g].filter(x => (axis === 'row' ? x.r === c.r : x.c === c.c)).map(x => x.id) })
  }
  // H4: two-axis diagonals (never wrapped)
  for (const [v, h, dr, dc] of [['below', 'right', 1, 1], ['below', 'left', 1, -1], ['above', 'right', -1, 1], ['above', 'left', -1, -1]]) {
    const to = at(g, c.r + dr, c.c + dc)
    H4.push({ g, sel: c.id, text: `make the chart diagonally ${v} and to the ${h} of this one weekly`, meant: to ? [to] : null })
  }
  // H5: negatives
  const below = at(g, c.r + 1, c.c)
  if (below) H5.push({ g, sel: c.id, text: 'put this chart on weekly, the chart below it already is' })
  if (walk(g, c.id, 'right').length === 2) H5.push({ g, sel: c.id, text: 'this one to weekly please, the two to its right are fine' })
})
// H2: everything except the <n> on a side (the extreme line on that side)
for (const g of Object.keys(BOARDS)) {
  for (const [side, axis, k] of [['left', 'c', 0], ['right', 'c', cols(g) - 1], ['top', 'r', 0], ['bottom', 'r', rows(g) - 1]]) {
    const ex = BOARDS[g].filter(x => x[axis] === k).map(x => x.id)
    const sel = BOARDS[g].find(x => !ex.includes(x.id)).id
    H2.push({ g, sel, ex, meant: BOARDS[g].map(x => x.id).filter(id => !ex.includes(id)), text: `could you put everything except the ${N[ex.length]} on the ${side} on weekly` })
  }
}

describe('(H1) counted plural relations from the click: the line that way, or asked when the board has not that many', () => {
  it('the family is generated', () => { expect(H1.length).toBeGreaterThan(80) })
  it.each(pick(H1, 5).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s)', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    // a count the board has not: the plan on what IS there (or on the click) never runs — asked, never the anchor
    p.st.envelopes.push(planOn(...(f.meant || (f.avail.length ? f.avail : [f.sel]))))
    await m.say(t)
    if (f.meant) { expect(changed(m.board), transcript()).toEqual([...f.meant].sort()); expect(asked(), transcript()).toBe(false) }
    else { expect(changed(m.board), transcript()).toEqual([]); expect(offered(), transcript()).not.toContain(f.sel) }
  }, 40000)
})

describe('(H2) an exclusion by count and side: never applied, never carded', () => {
  it.each(H2.map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s)', async (t, g, sel, f) => {
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount(g, f.sel)
      p.st.envelopes.push(plan(...f.meant, ...f.ex))
      await m.say(t)
      for (const id of f.ex) expect(changed(m.board), transcript()).not.toContain(id)
      expect(cards(), transcript()).toBe(0)
      for (const id of f.ex) expect(offered(), transcript()).not.toContain(id)
    }
  }, 40000)
})

describe('(H3) a plural relation to a whole line: the adjacent line; the click\'s line is the anchor', () => {
  it.each(pick(H3, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): a plan on the click never runs', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(f.sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(f.sel)
    expect(offered(), transcript()).not.toContain(f.sel)
  }, 40000)
  it.each(pick(H3.filter(f => f.meant), 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): the adjacent line runs', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(...f.meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([...f.meant].sort())
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})

describe('(H4) two-axis diagonals: that cell, or off the board (never wrapped)', () => {
  it.each(pick(H4, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s)', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    const wrong = BOARDS[g].map(x => x.id).find(id => id !== f.sel && !(f.meant || []).includes(id))
    p.st.envelopes.push(planOn(...(f.meant || [wrong])))
    await m.say(t)
    if (f.meant) { expect(changed(m.board), transcript()).toEqual(f.meant); expect(asked(), transcript()).toBe(false) }
    else { expect(changed(m.board), transcript()).toEqual([]); expect(offered(), transcript()).not.toContain(f.sel) }
  }, 40000)
})

describe('(H5) negatives: an inert clause names no target — the click acts', () => {
  it.each(pick(H5, 2).map(f => [f.text, f.g, f.sel]))('"%s" (%s, clicked %s): the plan on the click runs, nothing asked', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([sel])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})

// pl-auto unseen14 / unseen15 on 2fbda4c317 exposed these STRUCTURES (written as families; no unseen phrasing): an exclusion that
// IS the click; a whole-line exclusion by position ("everything but the middle column"); two-axis diagonals said other ways; and
// fine / already clauses about a chart named by ticker or around the click. Resolved on the board → ACT (no over-ask); a question
// never offers an excluded chart or the anchor.
describe('structures from pl-auto unseen14 / unseen15, as families', () => {
  const X = []
  for (const g of Object.keys(BOARDS)) for (const c of BOARDS[g]) {
    const row = BOARDS[g].filter(x => x.r === c.r).map(x => x.id)
    if (row.length >= 2) X.push({ g, sel: c.id, ex: [c.id], meant: row.filter(id => id !== c.id), text: `could you put this row except the ${SYMS[BOARDS[g].indexOf(c)]} one on weekly` })
  }
  it.each(pick(X, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s = the excluded chart): never applied, carded or offered; the rest acts', async (t, g, sel, f) => {
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount(g, f.sel)
      p.st.envelopes.push(plan(...f.meant, f.sel))
      await m.say(t)
      expect(changed(m.board), transcript()).not.toContain(f.sel)
      expect([...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' '), transcript()).not.toContain(`Chart (${f.sel})`)
      expect(offered(), transcript()).not.toContain(f.sel)
    }
    cleanup(); p = setupPanel()
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(...f.meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([...f.meant].sort())
    expect(asked(), transcript()).toBe(false)
  }, 40000)

  const L = []
  for (const g of Object.keys(BOARDS)) for (const [which, axis, k] of [['middle', 'c', 1], ['top', 'r', 0], ['bottom', 'r', rows(g) - 1], ['left', 'c', 0]]) {
    if (which === 'middle' && cols(g) !== 3) continue
    const ex = BOARDS[g].filter(x => x[axis] === k).map(x => x.id)
    const sel = BOARDS[g].find(x => !ex.includes(x.id)).id
    const name = axis === 'c' ? 'column' : 'row'
    L.push({ g, sel, ex, meant: BOARDS[g].map(x => x.id).filter(id => !ex.includes(id)), text: L.length % 2 ? `everything but the ${which} ${name} on weekly please` : `could you put all the charts except the ${which} ${name} on weekly` })
  }
  it.each(L.map(f => [f.text, f.g, f.sel, f]))('"%s" (%s): the board minus that line ACTS; a plan with the line is never applied or carded', async (t, g, sel, f) => {
    let m = mount(g, f.sel)
    p.st.envelopes.push(planOn(...f.meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([...f.meant].sort())
    expect(asked(), transcript()).toBe(false)
    cleanup(); p = setupPanel()
    m = mount(g, f.sel)
    p.st.envelopes.push(proposeOn(...f.meant, ...f.ex))
    await m.say(t)
    for (const id of f.ex) expect(changed(m.board), transcript()).not.toContain(id)
    expect(cards(), transcript()).toBe(0)
  }, 40000)

  const D = []
  for (const g of Object.keys(BOARDS)) for (const c of BOARDS[g]) {
    const dr = at(g, c.r + 1, c.c + 1), ur = at(g, c.r - 1, c.c + 1)
    if (dr) D.push({ g, sel: c.id, meant: [dr], text: 'weekly on the chart diagonally below and to the right of this' })
    if (ur) D.push({ g, sel: c.id, meant: [ur], text: 'weekly on the chart up and to the right diagonally from this' })
  }
  it.each(pick(D, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): that cell acts, nothing asked', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(...f.meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual(f.meant)
    expect(asked(), transcript()).toBe(false)
  }, 40000)

  const F = []
  for (const g of Object.keys(BOARDS)) BOARDS[g].forEach((c, i) => {
    const r = at(g, c.r, c.c + 1)
    if (!r) return
    const sym = SYMS[BOARDS[g].findIndex(x => x.id === r)]
    F.push({ g, sel: c.id, text: [`make this one weekly, the ${sym} chart next to it is fine`, `weekly here, the chart beside it already is`, `put this on weekly; the ones around it already have it`, `this one to weekly, the ${sym} chart to the right of it is fine`][i % 4] })
  })
  it.each(pick(F, 2).map(f => [f.text, f.g, f.sel]))('"%s" (%s, clicked %s): the click acts; nothing asked or offered', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([sel])
    expect(asked(), transcript()).toBe(false)
    expect(offered(), transcript()).toEqual([])
  }, 40000)
})
