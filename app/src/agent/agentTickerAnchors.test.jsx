// TICKER-NAMED anchors and exclusions (#988, AUDIT probe-18 FAMILIES — no probe phrasing), on 2×2, 2×3 and 3×3 boards whose
// charts show tickers:
//   (G1) a relation from a chart named by its SYMBOL ("next to / under / left of the <TICKER> chart"), the click elsewhere or ON
//        that chart: the anchor is never the target — the neighbour's plan runs, a plan on the anchor never does
//   (G2) a relation from an absolutely named chart ("above / beside the <corner> one")
//   (G3) an EXCLUSION by ticker inside a line ("everything in this row except <TICKER>"): a plan that includes the excluded chart is
//        never applied AND never offered as a proposal; the line minus it runs
//   (G4) mixed clauses: "the <TICKER> chart …, and the one to its right" — "its" is that ticker's chart, not the click
//   (G5) negatives: "this one …, the <TICKER> chart <relation> <TICKER> is fine" acts on the click
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
const symOf = (g, id) => SYMS[BOARDS[g].findIndex(c => c.id === id)]
const cell = (g, id) => BOARDS[g].find(c => c.id === id)
const at = (g, r, c) => BOARDS[g].find(x => x.r === r && x.c === c)?.id || null
const rowOf = (g, id) => BOARDS[g].filter(c => c.r === cell(g, id).r).map(c => c.id)
const colOf = (g, id) => BOARDS[g].filter(c => c.c === cell(g, id).c).map(c => c.id)

const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|Which charts|Pick one/.test(transcript())
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const proposedLines = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const syms = Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]]))
  const m = p.mount(widgets, syms, { decorate: label })
  if (sel) p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const planOn = (...ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))
const proposeOn = (...ids) => (body) => p.env('propose', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))

const SIDE = { 'next to': ['left', 'right'], beside: ['left', 'right'], under: ['below'], below: ['below'], above: ['above'], 'to the left of': ['left'], 'to the right of': ['right'] }
const step = (g, id, side) => { const a = cell(g, id); return at(g, a.r + (side === 'above' ? -1 : side === 'below' ? 1 : 0), a.c + (side === 'left' ? -1 : side === 'right' ? 1 : 0)) }
const meantOf = (g, id, word) => SIDE[word].map(s => step(g, id, s)).filter(Boolean)
const POS = (g, id) => {
  const c = cell(g, id), rows = Math.max(...BOARDS[g].map(x => x.r)) + 1, cols = Math.max(...BOARDS[g].map(x => x.c)) + 1
  const v = c.r === 0 ? 'top' : c.r === rows - 1 ? 'bottom' : 'middle', h = c.c === 0 ? 'left' : c.c === cols - 1 ? 'right' : 'middle'
  return v === 'middle' && h === 'middle' ? 'middle' : `${v}-${h}`
}

// ── the families ──
const G1 = [], G2 = [], G3 = [], G4 = [], G5 = []
for (const g of Object.keys(BOARDS)) BOARDS[g].forEach((a, i) => {
  Object.keys(SIDE).forEach((word, wi) => {
    const meant = meantOf(g, a.id, word)
    const say = (i + wi) % 2 ? `could you put the chart ${word} the ${symOf(g, a.id)} chart on weekly` : `I want the one ${word} the ${symOf(g, a.id)} one on the weekly view`
    // the click ON the anchor, and the click elsewhere (a cell that is neither the anchor nor meant)
    const away = BOARDS[g].map(c => c.id).find(id => id !== a.id && !meant.includes(id))
    G1.push({ g, text: say, anchor: a.id, meant, sel: (i + wi) % 3 ? a.id : away })
    if (wi % 3 === 0) G2.push({ g, text: `could you make the chart ${word} the ${POS(g, a.id)} one weekly for me`, anchor: a.id, meant, sel: a.id })
  })
  // G3: the click's row / column minus one ticker in it (not the click)
  for (const [axis, line] of [['row', rowOf(g, a.id)], ['column', colOf(g, a.id)]]) {
    const ex = line.find(id => id !== a.id)
    if (!ex) continue
    const say = (i % 2) ? `could you put everything in this ${axis} except ${symOf(g, ex)} on weekly` : `all the charts in this ${axis} but not the ${symOf(g, ex)} one to weekly please`
    G3.push({ g, text: say, sel: a.id, ex, meant: line.filter(id => id !== ex) })
  }
  // G4: a ticker target, then "the one to its right / below it" — from THAT chart (the click is elsewhere)
  for (const [rel, side] of [['the one to its right', 'right'], ['the one below it', 'below']]) {
    const n = step(g, a.id, side)
    const away = BOARDS[g].map(c => c.id).find(id => id !== a.id && id !== n)
    if (n && away) G4.push({ g, text: `could you put the ${symOf(g, a.id)} chart on weekly, and ${rel} too`, sel: away, meant: [a.id, n].sort() })
  }
  // G5: the click acts; a ticker relation in a clause that says it is fine
  const nb = step(g, a.id, 'right')
  if (nb) {
    const sel = BOARDS[g].map(c => c.id).find(id => id !== a.id && id !== nb)
    G5.push({ g, text: `put this one on weekly, the ${symOf(g, nb)} chart next to ${symOf(g, a.id)} is fine`, sel })
  }
})
const pick = (list, k) => list.filter((x, i) => i % k === 0)

describe('(G1 / G2) a relation from a ticker-named or absolutely named anchor: the anchor is never the target', () => {
  it('the families are generated from the boards', () => { expect(G1.length).toBeGreaterThan(60); expect(G2.length).toBeGreaterThan(10) })
  it.each([...pick(G1, 4), ...pick(G2, 2)].map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): a plan on the anchor never runs; it is never offered', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(f.anchor))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(f.anchor)
    expect(changed(m.board).every(id => f.meant.includes(id)), transcript()).toBe(true)
    expect(offered(), transcript()).not.toContain(f.anchor)
  }, 40000)
  it.each([...pick(G1, 4), ...pick(G2, 2)].filter(f => f.meant.length === 1).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): the one neighbour\'s plan runs, nothing asked', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(f.meant[0]))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual(f.meant)
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})

describe('(G3) an exclusion by ticker inside a line: never applied, never PROPOSED', () => {
  it.each(pick(G3, 2).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): a plan with the excluded chart is not applied and not offered as a proposal', async (t, g, sel, f) => {
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount(g, f.sel)
      p.st.envelopes.push(plan(...f.meant, f.ex))
      await m.say(t)
      expect(changed(m.board), transcript()).not.toContain(f.ex)
      expect(proposedLines(), transcript()).not.toContain(`Chart (${f.ex})`)
      expect(offered(), transcript()).not.toContain(f.ex)
    }
  }, 40000)
  it.each(pick(G3, 2).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): the line minus the excluded chart runs', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(...f.meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([...f.meant].sort())
  }, 40000)
})

describe('(G4) a ticker target then "its" relation: from that chart, never the click', () => {
  it.each(pick(G4, 2).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): both charts run; the click does not', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(...f.meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual(f.meant)
    expect(asked(), transcript()).toBe(false)
  }, 40000)
  it.each(pick(G4, 2).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): a plan with the click instead never runs', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(f.meant[0], f.sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(f.sel)
  }, 40000)
})

describe('(G5) negatives: a ticker relation in a clause that says it is fine — the click acts', () => {
  it.each(pick(G5, 2).map(f => [f.text, f.g, f.sel]))('"%s" (%s, clicked %s): the plan on the click runs there, nothing asked', async (t, g, sel) => {
    const m = mount(g, sel)
    p.st.envelopes.push(planOn(sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([sel])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})

// pl-auto unseen14 baseline (fb6170315e), written as families: a diagonal step IN from a named corner; "its" with no comma
// ("X weekly and the one to its right too", "on the X chart and on the one to its right"); exclusions over "all of these" /
// "this row except the X one" are ASKED when the plan includes the excluded chart (never a proposal card)
describe('pl-auto unseen14 shapes, as families', () => {
  const CORNERS = (g) => { const rows = Math.max(...BOARDS[g].map(c => c.r)), cols = Math.max(...BOARDS[g].map(c => c.c)); return [[0, 0, 'top-left'], [0, cols, 'top-right'], [rows, 0, 'bottom-left'], [rows, cols, 'bottom-right']].map(([r, c, w]) => ({ id: at(g, r, c), r, c, w })) }
  const DIAG = []
  for (const g of Object.keys(BOARDS)) for (const k of CORNERS(g)) {
    const rows = Math.max(...BOARDS[g].map(c => c.r)), cols = Math.max(...BOARDS[g].map(c => c.c))
    const to = at(g, k.r + (k.r === 0 ? 1 : -1), k.c + (k.c === 0 ? 1 : -1))
    if (to && rows >= 1 && cols >= 1) DIAG.push({ g, text: `could you make the chart one step in diagonally from the ${k.w} corner weekly`, anchor: k.id, meant: [to], sel: k.id })
  }
  it.each(DIAG.map(f => [f.text, f.g, f]))('"%s" (%s, clicked = the corner): the diagonal neighbour runs; the corner never runs or is offered', async (t, g, f) => {
    let m = mount(g, f.sel)
    p.st.envelopes.push(planOn(...f.meant))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual(f.meant)
    expect(asked(), transcript()).toBe(false)
    cleanup(); p = setupPanel()
    m = mount(g, f.sel)
    p.st.envelopes.push(planOn(f.anchor))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(f.anchor)
    expect(offered(), transcript()).not.toContain(f.anchor)
  }, 40000)
  const ITS = G4.map(f => ({ ...f, text: f.text.includes('to its right')
    ? (f.meant.length % 2 ? `weekly on the ${symOf(f.g, f.meant[0])} chart and on the one to its right` : `make the ${symOf(f.g, f.meant[0])} chart weekly and the one to its right too`)
    : f.text.replace(', and', ' and') }))
  it.each(pick(ITS, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): both charts run; nothing asked', async (t, g, sel, f) => {
    const anchor = BOARDS[g].find(c => f.text.includes(symOf(g, c.id)))?.id
    const m = mount(g, f.sel)
    const want = [...f.meant].sort()
    p.st.envelopes.push(planOn(...want))
    await m.say(t)
    expect(changed(m.board), `${transcript()} (anchor ${anchor})`).toEqual(want)
    expect(asked(), transcript()).toBe(false)
  }, 40000)
  const EX = []
  for (const g of Object.keys(BOARDS)) {
    const all = BOARDS[g].map(c => c.id)
    EX.push({ g, sel: all[0], ex: all[1], text: `could you put all of these except ${symOf(g, all[1])} on weekly`, meant: all.filter(id => id !== all[1]) })
    const row = rowOf(g, all[all.length - 1])
    EX.push({ g, sel: row[0], ex: row[1], text: `this row except the ${symOf(g, row[1])} one to weekly please`, meant: row.filter(id => id !== row[1]) })
  }
  it.each(EX.map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): a plan or a proposal with the excluded chart is ASKED, never carded', async (t, g, sel, f) => {
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount(g, f.sel)
      p.st.envelopes.push(plan(...f.meant, f.ex))
      await m.say(t)
      expect(changed(m.board), transcript()).not.toContain(f.ex)
      expect(document.querySelectorAll('[data-testid="agent-proposal"]').length, transcript()).toBe(0)
      expect(asked(), transcript()).toBe(true)
      expect(offered(), transcript()).not.toContain(f.ex)
    }
  }, 40000)
})
