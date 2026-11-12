// A POSSESSIVE for the click is the click (AUDIT #1030 T2: a probe-24-class wrong target, root cause in master's
// spatialCheck.negatedClick): "leave mine alone", "don't touch my chart", "keep my own one as it is", "my chart is fine" — with a
// chart selected, each EXCLUDES the clicked chart exactly as "leave this one alone" does. Written as a FAMILY in the Lead's own
// phrasings (not the probe's sentence). Controls: a possessive that is NOT a chart ("my watchlist", "my settings", "my layout")
// excludes nothing, and a possessive that is the change ("make my chart weekly") is not a negation.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { negatedClick } from './spatialCheck'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const POSS = ['mine', 'my chart', 'my one', 'my own one', 'my own chart', 'my cell', 'my pane']
const NEG = [
  (x) => `leave ${x} alone`, (x) => `keep ${x} as it is`, (x) => `don't touch ${x}`, (x) => `don't change ${x}`,
  (x) => `never touch ${x}`, (x) => `not ${x} though`, (x) => `let ${x} be`,
]

describe('negatedClick: a possessive chart phrase is the click', () => {
  it.each(POSS.flatMap(x => NEG.map(n => [n(x)])))('"%s" excludes the click', (t) => {
    expect(negatedClick(t).excludes).toBe(true)
  })
  it.each([['mine is fine as it is'], ['my chart is good'], ['my own one stays daily'], ['my chart can stay as it is']])(
    'a stative clause about it ("%s") keeps it as it is: excluded', (t) => {
      expect(negatedClick(t).excludes).toBe(true)
    })
  it.each([
    ['leave my watchlist alone'], ['keep my settings as they are'], ["don't touch my layout"], ['not my alerts though'],
    ["don't change my default timeframe"], ['leave my drawings alone'],
  ])('a possessive that is NOT a chart ("%s") excludes nothing', (t) => {
    expect(negatedClick(t).excludes).toBe(false)
  })
  it.each([['make my chart weekly'], ['put mine on log scale'], ['my chart should be weekly'], ['switch my one to the hourly']])(
    'a possessive that is the change ("%s") is not a negation', (t) => {
      expect(negatedClick(t).excludes).toBe(false)
    })
  it('the clause is blanked (positions kept) so the relation readers never read it as a target', () => {
    const t = 'leave mine alone and make the one below it weekly'
    const r = negatedClick(t)
    expect(r.text.length).toBe(t.length)
    expect(r.text).not.toMatch(/mine/)
    expect(r.text).toMatch(/the one below it weekly/)
  })
})

// ── end to end on WORKSPACE charts: the excluded click never runs, is never carded or offered; the relation's chart runs ──
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AMD', 'TSLA', 'META']
const grid = (rows) => rows.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H, r, c })))
const BOARDS = { '2x2': grid([['TL', 'TR'], ['BL', 'BR']]), '2x3': grid([['TL', 'TM', 'TR'], ['BL', 'BM', 'BR']]) }
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

const REL = [['below', 1, 0], ['to the right of', 0, 1], ['above', -1, 0], ['to the left of', 0, -1]]
const F = []
for (const g of Object.keys(BOARDS)) BOARDS[g].forEach((c, i) => {
  REL.forEach(([word, dr, dc], ri) => {
    const to = at(g, c.r + dr, c.c + dc)
    if (!to) return
    const poss = POSS[(i + ri) % POSS.length]
    const neg = NEG[(i + 2 * ri) % NEG.length]
    F.push({ g, sel: c.id, to, text: `${neg(poss)} and make the one ${word} it weekly` })
    F.push({ g, sel: c.id, to, text: `make the one ${word} this weekly but ${neg(poss)}` })
  })
})
const pick = (list, k) => list.filter((x, i) => i % k === 0)

describe('a possessive negation of the click, through the real panel (workspace charts)', () => {
  it('the family covers every possessive and both orders', () => {
    expect(F.length).toBeGreaterThan(30)
    for (const x of POSS) expect(F.some(f => f.text.includes(x))).toBe(true)
  })
  it.each(pick(F, 2).map(f => [f.text, f.g, f.sel, f]))('"%s" (%s, clicked %s): a plan or proposal on the click is never applied, carded or offered', async (t, g, sel, f) => {
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
  it('a non-chart possessive leaves the click targetable: "leave my watchlist alone and make this one weekly" runs on the click', async () => {
    const m = mount('2x2', 'TL')
    p.st.envelopes.push(planOn('TL'))
    await m.say('leave my watchlist alone and make this one weekly')
    expect(changed(m.board), transcript()).toEqual(['TL'])
  }, 40000)
})

// ── (AUDIT #1143 T2) a WHOLE-BOARD quantifier with an exception whose object is the click by ANY name ──────────────────────
// quantifier × connective × pointer form, the Lead's own phrasings. A plan that includes the click never runs (applied, carded
// or offered); the plan on the others runs. Control: the excepted object is a NAMED chart (its ticker) — excluded as before.
import { excludedCharts } from './spatialCheck'
const QUANT = [(v) => `make every chart ${v}`, (v) => `switch everything to ${v}`, (v) => `turn them all ${v}`, (v) => `put all of them on ${v}`]
const CONN = ['except', 'but', 'apart from', 'other than', 'excluding']
const PTR = ['this one', 'the one I clicked', 'the chart I am on', 'mine', 'my chart', 'my own one']
const XQ = []
QUANT.forEach((q, qi) => CONN.forEach((c, ci) => PTR.forEach((x, xi) => {
  if ((qi + ci + xi) % 3) return                                       // a spread, not the full product
  XQ.push(`${q('weekly')} ${c} ${x}`)
})))
describe('a whole-board quantifier excepting the click (any name) excludes it', () => {
  const B = [{ ref: 'a', symbol: 'SPY', position: 'top-left' }, { ref: 'b', symbol: 'QQQ', position: 'top-right' },
    { ref: 'c', symbol: 'NVDA', position: 'bottom-left' }, { ref: 'd', symbol: 'AMD', position: 'bottom-right' }]
  it('the family covers every quantifier, connective and pointer form', () => {
    for (const c of CONN) expect(XQ.some(t => t.includes(` ${c} `))).toBe(true)
    for (const x of PTR) expect(XQ.some(t => t.endsWith(x))).toBe(true)
  })
  it.each(XQ.map(t => [t]))('reader: "%s" → the click', (t) => {
    expect([...excludedCharts(t, B, 'a')]).toEqual(['a'])
  })
  it.each([['make every chart weekly but the QQQ one', 'b'], ['switch everything to weekly except the NVDA one', 'c'], ['turn them all weekly apart from the AMD chart', 'd']])(
    'control, a NAMED chart: "%s" → that chart', (t, ref) => {
      expect([...excludedCharts(t, B, 'a')]).toEqual([ref])
    })
  it.each([['make everything weekly but keep the log scale'], ['make everything weekly but not yet'], ['make every chart weekly except my watchlist'], ['make every chart weekly, but my settings stay'], ['make it weekly but the 50 day too']])(
    'control, not a chart: "%s" → nothing', (t) => {
      expect([...excludedCharts(t, B, 'a')]).toEqual([])
    })
  const E2E = XQ.filter((t, i) => i % 2 === 0)
  it.each(E2E.map(t => [t]))('panel: "%s" — a plan including the click never runs; the plan on the others runs', async (t) => {
    const others = BOARDS['2x2'].map(x => x.id).filter(id => id !== 'TL')
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount('2x2', 'TL')
      p.st.envelopes.push(plan('TL', ...others))
      await m.say(t)
      expect(changed(m.board), transcript()).not.toContain('TL')
      expect(cardText(), transcript()).not.toContain('Chart (TL)')
      expect(offered(), transcript()).not.toContain('TL')
    }
    cleanup(); p = setupPanel()
    const m = mount('2x2', 'TL')
    p.st.envelopes.push(planOn(...others))
    await m.say(t)
    const ran = changed(m.board)
    expect(ran, transcript()).not.toContain('TL')
    // MUST RUN: an explicit board quantifier (every chart / everything) excepting the click by "this one" or a possessive.
    // Otherwise ("them all" / "all of them", or the click named by the act — "the one I clicked", "the chart I am on") the
    // right plan may still be ASKED or CARDED first, exactly as on master fc564e7096 (measured; never worse): fail-closed, the
    // click untouched. Making those run is a separate over-caution follow-up, not this exclusion fix.
    const mustRun = /^(?:make every chart|switch everything)/.test(t) && /(?:this one|mine|my chart|my own one)$/.test(t)
    if (mustRun) expect(ran, transcript()).toEqual([...others].sort())
    else expect(ran.length === 0 ? asked() || cardText().length > 0 : ran.join() === [...others].sort().join(), transcript()).toBe(true)
  }, 60000)
  // (master fc564e7096 measured) "turn them all weekly but this one" with the plan on the OTHER three changed ONLY the clicked
  // chart — the member's exclusion turned into the target. Fixed here (SEP_BUT): the click is never the one that changes.
  it('"turn them all weekly but this one": the clicked chart is never the one changed', async () => {
    const others = BOARDS['2x2'].map(x => x.id).filter(id => id !== 'TL')
    const m = mount('2x2', 'TL')
    p.st.envelopes.push(planOn(...others))
    await m.say('turn them all weekly but this one')
    expect(changed(m.board), transcript()).not.toContain('TL')
  }, 60000)
})

// ── (AUDIT #1143 T2, round 2) SUBJECT position: "<quantifier> except <the click> <predicate> …" — the exception's capture runs
// on into the verb, so the click is read from its leading reference. Own phrasings; all three pointer families. Controls in the
// same position: a NAMED chart (still that chart) and "my <non-chart noun>" (nothing).
const SUBJ_Q = ['everything except', 'every chart except', 'all of them except', 'everything apart from', 'every chart other than']
const SUBJ_X = ['this one', 'this chart', 'the one I clicked', "the one I'm on", 'the chart I am on', 'the one I tapped', 'the one I picked',
  'the chart I chose', 'mine', 'my chart', 'my own one']
// (round 3) predicates chosen to be in NO verb list anywhere in spatialCheck — the click is read from the phrase's START
const SUBJ_P = ['flips to weekly', 'rolls over to weekly', 'jumps to the weekly', 'ends up on weekly', 'hops over to weekly',
  'slides to weekly', 'drops back to weekly', 'gets bumped to weekly', 'flips weekly', 'goes weekly', 'should be weekly']
const XS = []
SUBJ_Q.forEach((q, qi) => SUBJ_X.forEach((x, xi) => XS.push(`${q} ${x} ${SUBJ_P[(qi + xi) % SUBJ_P.length]}`)))
describe('subject position: "<all> except <the click> <verb> …" excludes the click', () => {
  const B = [{ ref: 'a', symbol: 'SPY', position: 'top-left' }, { ref: 'b', symbol: 'QQQ', position: 'top-right' },
    { ref: 'c', symbol: 'NVDA', position: 'bottom-left' }, { ref: 'd', symbol: 'AMD', position: 'bottom-right' }]
  it.each(XS.map(t => [t]))('reader: "%s" → the click', (t) => {
    expect([...excludedCharts(t, B, 'a')]).toEqual(['a'])
  })
  it.each([['everything except the QQQ one goes weekly', 'b'], ['every chart except the NVDA chart switches to weekly', 'c'], ['all of them except AMD should be weekly', 'd']])(
    'control, a NAMED chart in subject position: "%s" → that chart', (t, ref) => {
      expect([...excludedCharts(t, B, 'a')]).toEqual([ref])
    })
  it.each([['everything except my watchlist goes weekly'], ['every chart except my settings stays the same'], ['all of them except my alerts should be weekly'], ['weekly, not daily'], ['log, not linear']])(
    'control, not a chart: "%s" → nothing', (t) => {
      expect([...excludedCharts(t, B, 'a')]).toEqual([])
    })
  it.each(XS.filter((t, i) => i % 3 === 0).map(t => [t]))('panel: "%s" — a plan including the click is never applied, carded or offered', async (t) => {
    const others = BOARDS['2x2'].map(x => x.id).filter(id => id !== 'TL')
    for (const plan of [planOn, proposeOn]) {
      cleanup(); p = setupPanel()
      const m = mount('2x2', 'TL')
      p.st.envelopes.push(plan('TL', ...others))
      await m.say(t)
      expect(changed(m.board), transcript()).not.toContain('TL')
      expect(cardText(), transcript()).not.toContain('Chart (TL)')
      expect(offered(), transcript()).not.toContain('TL')
    }
  }, 60000)
})

// (SEP_BUT gate) WITHOUT a whole-board quantifier a "but <chart>" is a CONTRAST between two changes, never an exception:
// "make the QQQ one weekly but this one daily" changes both; nothing is excluded.
describe('a "but" between two charts with no whole-board quantifier excludes nothing', () => {
  const B = [{ ref: 'a', symbol: 'SPY', position: 'top-left' }, { ref: 'b', symbol: 'QQQ', position: 'top-right' },
    { ref: 'c', symbol: 'NVDA', position: 'bottom-left' }, { ref: 'd', symbol: 'AMD', position: 'bottom-right' }]
  it.each([['make the QQQ one weekly but this one daily'], ['put the NVDA chart on log but mine on linear'], ['switch AMD to weekly but my chart to monthly'], ['set the top right to hourly but the one I clicked to daily']])(
    '"%s" → nothing excluded', (t) => {
      expect([...excludedCharts(t, B, 'a')]).toEqual([])
    })
})

// ── (AUDIT #1143 T2, round 3) the RE-AIM guard: a click name followed by a possessive or a relation names ANOTHER chart. It must
// never exclude the click (the neighbour would then be the one changed); which chart it is, this reader cannot say, so it is
// UNPLACED and a plan is ASKED, never applied — the click is never changed by such a sentence on the strength of this reader.
import { UNPLACED } from './spatialCheck'
describe('the re-aim guard: "<click name> next to / beside / \'s …" never excludes the click', () => {
  const B = [{ ref: 'a', symbol: 'SPY', position: 'top-left' }, { ref: 'b', symbol: 'QQQ', position: 'top-right' },
    { ref: 'c', symbol: 'NVDA', position: 'bottom-left' }, { ref: 'd', symbol: 'AMD', position: 'bottom-right' }]
  const RE = ['everything except mine next to it flips to weekly', 'every chart except this one beside QQQ rolls over to weekly',
    'all of them except my chart above NVDA goes weekly', 'everything except the one I clicked to the left of AMD slides to weekly',
    'every chart except this chart across from SPY ends up on weekly', 'everything except my own one below it hops to weekly']
  it.each(RE.map(t => [t]))('reader: "%s" → never the click; unplaced', (t) => {
    const ex = [...excludedCharts(t, B, 'a')]
    expect(ex).not.toContain('a')
    expect(ex).toContain(UNPLACED)
  })
  it.each(RE.filter((t, i) => i % 2 === 0).map(t => [t]))('panel: "%s" — a plan including the click is never applied', async (t) => {
    const others = BOARDS['2x2'].map(x => x.id).filter(id => id !== 'TL')
    const m = mount('2x2', 'TL')
    p.st.envelopes.push(planOn('TL', ...others))
    await m.say(t)
    expect(changed(m.board), transcript()).not.toContain('TL')
  }, 60000)
})
