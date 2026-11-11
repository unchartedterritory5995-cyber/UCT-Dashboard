// NEGATED ANCHOR + relation target (#988; AUDIT probe-3 regression on 3b593d4a47, built as the FAMILY — not AUDIT's sentence):
// "leave this alone and make the one under it weekly" / "make the one under this weekly but leave this one alone". An imperative
// negation on the click or a pronoun for it (leave … alone / keep … as it is / don't touch / don't change / not this one) ALWAYS
// EXCLUDES it: a plan on the click is never applied, never proposed, never offered in a question; the relation's chart is the
// target. Both clause orders; "this / this one / this chart / the clicked one / it"; 2×2, 2×3 and 3×3 boards.
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
const at = (g, r, c) => BOARDS[g].find(x => x.r === r && x.c === c)?.id || null
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const cardText = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const asked = () => /Which chart|Did you mean|Which charts|Pick one|You said not/i.test(transcript())
const mount = (g, sel) => {
  const widgets = BOARDS[g].map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: label })
  p.select(sel)
  return m
}
const changed = (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id).sort()
const mk = (disp) => (...ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))
const planOn = mk('apply'), proposeOn = mk('propose')

// negations of the click (imperatives), the click's names, the relation (from the click), both orders
const NEG = [
  (x) => `leave ${x} alone`, (x) => `keep ${x} as it is`, (x) => `don't touch ${x}`, (x) => `don't change ${x}`, (x) => `not ${x} though`,
]
const NAMES = ['this', 'this one', 'this chart', 'the clicked one']
const REL = [['under', 'below', 1, 0], ['to the right of', 'right', 0, 1], ['above', 'above', -1, 0], ['to the left of', 'left', 0, -1]]
const F = []
for (const g of Object.keys(BOARDS)) BOARDS[g].forEach((c, i) => {
  REL.forEach(([word, , dr, dc], ri) => {
    const to = at(g, c.r + dr, c.c + dc)
    if (!to) return
    const neg = NEG[(i + ri) % NEG.length]
    const name = NAMES[(i + 2 * ri) % NAMES.length]
    // order A: the negation first, the target by a pronoun for the click ("… and make the one under it weekly")
    F.push({ g, sel: c.id, to, text: `${neg(name)} and make the one ${word} it weekly` })
    // order B: the target first, the negation after ("make the one under this weekly but leave this one alone")
    F.push({ g, sel: c.id, to, text: `make the one ${word} this weekly but ${neg(name === 'this' ? 'this one' : name)}` })
  })
})
const pick = (list, k) => list.filter((x, i) => i % k === 0)

describe('a negated anchor is always excluded; the relation\'s chart is the target', () => {
  it('the family covers both orders, every negation and every name', () => {
    expect(F.length).toBeGreaterThan(60)
    for (const n of ['leave', 'keep', "don't touch", "don't change", 'not ']) expect(F.some(f => f.text.includes(n))).toBe(true)
  })
  it.each(pick(F, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): a plan or proposal on the click is never applied, carded or offered', async (t, g, sel, f) => {
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount(g, f.sel)
      p.st.envelopes.push(plan(f.sel))
      await m.say(t)
      expect(changed(m.board), transcript()).not.toContain(f.sel)
      expect(cardText(), transcript()).not.toContain(`Chart (${f.sel})`)
      expect(offered(), transcript()).not.toContain(f.sel)
    }
  }, 40000)
  it.each(pick(F, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): the relation\'s chart runs, nothing asked', async (t, g, sel, f) => {
    const m = mount(g, f.sel)
    p.st.envelopes.push(planOn(f.to))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([f.to])
    expect(asked(), transcript()).toBe(false)
  }, 40000)
})

// a negated RELATION ("leave the ones around it alone", "don't touch the one below it") is an EXCLUSION SET; the click is the target
describe('a negated relation is an exclusion set; the click acts', () => {
  const NR = []
  for (const g of Object.keys(BOARDS)) BOARDS[g].forEach((c, i) => {
    const around = BOARDS[g].filter(x => x.id !== c.id && Math.abs(x.r - c.r) <= 1 && Math.abs(x.c - c.c) <= 1 && (x.r === c.r || x.c === c.c)).map(x => x.id)
    const below = at(g, c.r + 1, c.c)
    if (around.length) NR.push({ g, sel: c.id, ex: around, text: ['weekly on this one, leave the charts around it alone', 'put this chart on weekly and keep the ones around it as they are'][i % 2] })
    if (below) NR.push({ g, sel: c.id, ex: [below], text: ["make this one weekly but don't touch the one below it", 'switch this chart to weekly, not the one under it'][i % 2] })
  })
  it.each(pick(NR, 3).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): the click acts; the excluded charts never run, are never carded or offered', async (t, g, sel, f) => {
    let m = mount(g, f.sel)
    p.st.envelopes.push(planOn(f.sel))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([f.sel])
    expect(asked(), transcript()).toBe(false)
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      m = mount(g, f.sel)
      p.st.envelopes.push(plan(f.sel, ...f.ex))
      await m.say(t)
      for (const id of f.ex) {
        expect(changed(m.board), transcript()).not.toContain(id)
        expect(cardText(), transcript()).not.toContain(`Chart (${id})`)
        expect(offered(), transcript()).not.toContain(id)
      }
    }
  }, 40000)
})

// pl-auto u14-g3-05 shape (written as a family): an exclusion that IS the click, the instant path and the model path — no card,
// no apply, no question ever lists the excluded click
describe('an exclusion that is the click: never applied, carded or offered, on the instant path too', () => {
  const XC = []
  for (const g of Object.keys(BOARDS)) BOARDS[g].forEach((c, i) => {
    const row = BOARDS[g].filter(x => x.r === c.r).map(x => x.id)
    if (row.length < 2) return
    XC.push({ g, sel: c.id, rest: row.filter(id => id !== c.id), text: [`log on this row except the ${SYMS[i]} one`, `weekly on this row except the ${SYMS[i]} one`][i % 2] })
  })
  it.each(pick(XC, 2).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s)', async (t, g, sel, f) => {
    for (const plan of [null, planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount(g, f.sel)
      if (plan) p.st.envelopes.push(plan(...f.rest, f.sel))
      await m.say(t)
      expect(changed(m.board), transcript()).not.toContain(f.sel)
      expect(cardText(), transcript()).not.toContain(`Chart (${f.sel})`)
      expect(offered(), transcript()).not.toContain(f.sel)
      const scaled = m.board.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id)
      expect(scaled, transcript()).not.toContain(f.sel)
    }
  }, 40000)
})

// TWO charts: "the other one" with the click negated — the other chart is the target, the click never runs or is offered
describe('two charts: a negated click and "the other one"', () => {
  const TWO = [{ id: 'L', x: 0, y: 0, w: 12, h: 20 }, { id: 'R', x: 12, y: 0, w: 12, h: 20 }]
  const mount2 = (sel) => {
    const widgets = TWO.map(c => ({ ...c, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
    const m = p.mount(widgets, { 'N:L': 'NVDA', 'N:R': 'AMD' }, { decorate: label })
    p.select(sel)
    return m
  }
  const T = []
  for (const sel of ['L', 'R']) for (const [i, text] of [
    'leave this alone, weekly on the other one', "switch the other chart to weekly and don't touch this one",
    'keep this one as it is and put the other one on weekly', 'weekly on the other chart, not this one',
  ].entries()) T.push({ sel, other: sel === 'L' ? 'R' : 'L', text, i })
  it.each(T.map(f => [f.text, f.sel, f]))('"%s" (clicked %s): the other chart runs; a plan on the click never runs and the click is never offered', async (t, sel, f) => {
    let m = mount2(f.sel)
    p.st.envelopes.push(planOn(f.other))
    await m.say(t)
    expect(changed(m.board), transcript()).toEqual([f.other])
    expect(asked(), transcript()).toBe(false)
    cleanup(); p = setupPanel()
    m = mount2(f.sel)
    p.st.envelopes.push(planOn(f.sel))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain(f.sel)
    expect(offered(), transcript()).not.toContain(f.sel)
  }, 40000)
})
