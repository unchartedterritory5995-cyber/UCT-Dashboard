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
