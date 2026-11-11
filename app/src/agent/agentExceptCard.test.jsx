// #988 (pl-auto u14-g3-05, GO bar 1): a chart the words EXCLUDE is never on a proposal CARD, never applied and never offered —
// "log on this row except the TSLA one" on a board where TSLA is on TWO charts: the excluded one is the TSLA chart in the
// click's row. Every path that can carry a plan to a card or an apply: the mock model's plan (apply → escalated to a card, and
// propose), the instant path (no plan), and a question's choice (the pick resumes the plan). The exclusion IS the click, and is
// NOT the click. A second block FORCES the constraint check off (a resolver regression): the card / apply gate in execute alone
// must still hold. LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

const forced = { on: false }
vi.mock('./spatialCheck', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, checkSpatialConstraints: (args) => (forced.on ? null : real.checkSpatialConstraints(args)) }
})
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel(); forced.on = false })
afterEach(() => { forced.on = false; vi.restoreAllMocks(); cleanup() })

const W = 8, H = 10
// pl-auto's NINE board: tickers repeat (SPY, QQQ, NVDA, TSLA twice)
const IDS = [['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]
const SYMS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD']
const BOARD = IDS.flatMap((ids, r) => ids.map((id, c) => ({ id, x: c * W, y: r * H, w: W, h: H, r })))
const rowOf = (id) => BOARD.filter(x => x.r === BOARD.find(c => c.id === id).r).map(x => x.id)
const symOf = (id) => SYMS[BOARD.findIndex(c => c.id === id)]

const transcript = () => screen.getByTestId('agent-transcript').textContent
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim()).filter(t => /^Chart \(/.test(t)).map(t => t.slice(7, -1))
const carded = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const logged = (b) => b.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id).sort()
const mount = (sel) => {
  const widgets = BOARD.map(({ id, x, y, w, h }) => ({ id, x, y, w, h, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, SYMS[i]])), { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }) })
  p.select(sel)
  return m
}
const scaleOn = (disp, ...ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setScale', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { scale: 'log' } })))

// [clicked, the excluded chart]: the exclusion IS the click (ML = TSLA in the middle row), and is NOT the click (the middle
// row's TSLA from MM; the bottom row's TSLA = BM from BL)
const SCOPES = [['ML', 'ML'], ['MM', 'ML'], ['BL', 'BM']]
const WORDS = ['log on this row except the TSLA one', 'put this row on log scale except the TSLA chart']
const CASES = SCOPES.flatMap(([sel, ex]) => WORDS.map(t => [t, sel, ex]))

const never = (m, ex) => {
  expect(logged(m.board), `${ex} applied: ${transcript()}`).not.toContain(ex)
  expect(carded(), `${ex} carded: ${transcript()}`).not.toContain(`Chart (${ex})`)
  expect(offered(), `${ex} offered: ${transcript()}`).not.toContain(ex)
}

for (const force of [false, true]) {
  describe(force ? 'the constraint check FORCED off: the card / apply gate alone holds' : 'every card / apply path, real resolvers', () => {
    it.each(CASES)('"%s" (clicked %s, %s excluded): the mock model plans the whole row, apply → card', async (t, sel, ex) => {
      forced.on = force
      expect(symOf(ex)).toBe('TSLA')
      const m = mount(sel)
      p.st.envelopes.push(scaleOn('apply', ...rowOf(sel)))
      await m.say(t)
      never(m, ex)
    }, 40000)
    it.each(CASES)('"%s" (clicked %s, %s excluded): the mock model PROPOSES the whole row', async (t, sel, ex) => {
      forced.on = force
      const m = mount(sel)
      p.st.envelopes.push(scaleOn('propose', ...rowOf(sel)))
      await m.say(t)
      never(m, ex)
    }, 40000)
    it.each(CASES)('"%s" (clicked %s, %s excluded): the instant path (no plan)', async (t, sel, ex) => {
      forced.on = force
      const m = mount(sel)
      await m.say(t)
      never(m, ex)
    }, 40000)
    it.each(CASES)('"%s" (clicked %s, %s excluded): a plan on the excluded chart alone → a question, and its choice', async (t, sel, ex) => {
      forced.on = force
      const m = mount(sel)
      p.st.envelopes.push(scaleOn('apply', ex))
      await m.say(t)
      never(m, ex)
      const choices = offered()
      if (choices.length) {
        p.st.envelopes.push(scaleOn('apply', ex))         // the model re-plans on the excluded chart again after the pick
        await m.click(`Chart (${choices[0]})`)
        never(m, ex)
      }
    }, 40000)
  })
}
