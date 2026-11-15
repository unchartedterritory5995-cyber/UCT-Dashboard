// AUDIT #1027 (one mutant per rule of agent/whichWidget.js): the rules the F1 rails did not reach on their own, pinned here over the
// module directly (pure, a fake host). Written after the per-rule mutation run showed these mutants surviving the F1 rails,
// watchlistTarget.rail and agentWatchlistShow / Out (+ held-out): see docs/agent/program/evidence/exec-widget-actions/.
//   LINKED TICKER: a widget's linked ticker names it only when it is the ONLY widget of its type on that ticker.
// LOCAL, vitest (node). Data is invented fixture data.
import { describe, it, expect } from 'vitest'
import { whichWidget, listSwitchable } from './whichWidget'

const wl = (id, x, color) => ({ id, type: 'watchlist', x, y: 0, w: 6, h: 20, color, opts: { watchKey: 'user:w1', watchName: 'Momentum', watchTab: 'mine' } })
const host = (widgets, groupSyms) => ({ widgets: { snapshot: () => ({ raw: widgets, groupSyms }) } })
const show = (widget) => ({ widget, source: 'prebuilt', name: 'Leaders' })
const how = { type: 'watchlist', can: listSwitchable }

describe('LINKED TICKER names a widget (unique on its ticker)', () => {
  // two Watchlist widgets showing the same list, side by side, linked to different tickers
  const H = host([wl('L', 12, 'A'), wl('R', 18, 'B')], { A: 'SPY', B: 'NVDA' })
  it('"put Leaders in the NVDA watchlist" (plan picked the left one): aimed at the one linked to NVDA, no question', () => {
    expect(whichWidget(show('L'), H, 'put Leaders in the NVDA watchlist', how)).toEqual({ args: show('R') })
  })
  it('the plan already on it: acted as planned, no question', () => {
    expect(whichWidget(show('R'), H, 'put Leaders in the NVDA watchlist', how)).toBe(null)
  })
  it('control: a ticker neither widget is linked to names none: asked', () => {
    expect(whichWidget(show('L'), H, 'put Leaders in the AMD watchlist', how)?.ask).toBeTruthy()
  })
})

describe('LINKED TICKER shared by both is no name (it never adds a second candidate)', () => {
  // both linked to SPY: "SPY" names neither, so "left" alone decides
  const H = host([wl('L', 12, 'A'), wl('R', 18, 'A')], { A: 'SPY' })
  it('"put Leaders in the left SPY watchlist" (plan picked the right one): aimed left, no question', () => {
    expect(whichWidget(show('R'), H, 'put Leaders in the left SPY watchlist', how)).toEqual({ args: show('L') })
  })
  it('"put Leaders in the SPY watchlist": the ticker names neither: asked', () => {
    expect(whichWidget(show('L'), H, 'put Leaders in the SPY watchlist', how)?.ask).toBeTruthy()
  })
})

describe('FAIL CLOSED: no words at all is no name', () => {
  const H = host([wl('L', 12, 'A'), wl('R', 18, 'B')], { A: 'SPY', B: 'NVDA' })
  it.each([[undefined], [null], ['']])('words %s with two Watchlist widgets: asked, never the planner\'s pick', (words) => {
    const r = whichWidget(show('L'), H, words, how)
    expect(r?.ask, 'a question').toBeTruthy()
    expect(r.ask.choices.map(c => c.ref)).toEqual(['L', 'R'])
  })
  it('control: one Watchlist widget and no words: nothing to ask', () => {
    expect(whichWidget(show('L'), host([wl('L', 12, 'A')], { A: 'SPY' }), undefined, how)).toBe(null)
  })
})

describe('APPROVED: a proposal the member approved is not asked again', () => {
  const H = host([wl('L', 12, 'A'), wl('R', 18, 'B')], { A: 'SPY', B: 'NVDA' })
  it('approved, words name none: runs on the widget it carries (no question)', () => {
    expect(whichWidget(show('L'), H, 'yes', { ...how, approved: true })).toBe(null)
  })
  it('control: the same words, not approved: asked', () => {
    expect(whichWidget(show('L'), H, 'yes', how)?.ask).toBeTruthy()
  })
})

describe('NEVER ACROSS TYPES: a widget set aside that is the only one of its type is refused, never re-aimed at another type', () => {
  const scan = { id: 'S', type: 'scanner', x: 0, y: 0, w: 6, h: 20, color: 'A', opts: { scanKey: 'ipo-1y', scanName: 'IPOs' } }
  const H = host([scan, wl('W', 12, 'A')], { A: 'SPY' })
  const logos = { widget: 'W', key: 'showLogos', value: false }
  it('"hide the logos, but don\'t touch the watchlist" (plan: the Watchlist): refused in words; no other widget is asked about or aimed at', () => {
    const r = whichWidget(logos, H, 'hide the logos, but don\'t touch the watchlist')
    expect(r?.refuse, 'refused').toMatch(/leave the Watchlist alone/)
    expect(r.ask).toBeUndefined()
    expect(r.args).toBeUndefined()
  })
  // AUDIT #1027 (post-#1029): the refusal names both widgets, or says why it won't guess (fail closed: never a silent "no")
  it('the refusal says it won\'t guess; a widget the words never name (the Scanner) is not named in it', () => {
    const r = whichWidget(logos, H, 'hide the logos, but don\'t touch the watchlist')
    expect(r?.refuse).toMatch(/won.t guess/)
    expect(r?.refuse).not.toMatch(/Scanner/)
  })
  it('the words name a widget of another type ("…, just reload the scanner"): the refusal names it too, and still won\'t guess', () => {
    const r = whichWidget(logos, H, 'don\'t touch the watchlist, just reload the scanner')
    expect(r?.refuse).toMatch(/leave the Watchlist alone/)
    expect(r?.refuse).toMatch(/Scanner/)
    expect(r?.refuse).toMatch(/won.t guess/)
    expect(r.args).toBeUndefined()
  })
  it('control: the same op without the negation acts on the Watchlist, no question', () => {
    expect(whichWidget(logos, H, 'hide the logos in the watchlist')).toBe(null)
  })
})

describe('`can`: a Watchlist widget bound to a source cannot switch lists, so it is no candidate for showList / exportList', () => {
  const bound = { ...wl('L', 12, 'A'), opts: { source: { kind: 'scan', key: 'ipo-1y' } } }
  const H = host([bound, wl('R', 18, 'B')], { A: 'SPY', B: 'NVDA' })
  it.each([['R'], [null]])('plan widget %s, words name none: the one switchable widget, no question', (widget) => {
    const r = whichWidget(show(widget), H, 'show Leaders in the watchlist', how)
    expect(r?.ask).toBeUndefined()
    expect(r === null || r.args?.widget === 'R', JSON.stringify(r)).toBe(true)
  })
  it('control: with no `can` (a setOption on the same board), both are candidates: asked', () => {
    expect(whichWidget({ widget: 'R', key: 'showLogos', value: false }, H, 'hide the logos in the watchlist')?.ask).toBeTruthy()
  })
})

describe('u18-cols-06 (over-ask found by the static count): "right after" / "right before" is not a place', () => {
  // the DATA2 board's shape: a chart on the left, two Watchlist widgets stacked on the right (Momentum above, Swing below)
  const chartW = { id: 'C', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'A', opts: {} }
  const stack = (id, y, name) => ({ id, type: 'watchlist', x: 16, y, w: 8, h: 10, color: 'A', opts: { watchKey: `user:${id}`, watchName: name, watchTab: 'mine' } })
  const H = host([chartW, stack('m1', 0, 'Momentum'), stack('s1', 10, 'Swing')], { A: 'SPY' })
  const text = 'on the Swing list, move volume right after symbol'
  it('the view of Swing (the plan is right): acted on, no question', () => {
    expect(whichWidget({ widget: 's1' }, H, text)).toBe(null)
  })
  it('the plan aimed at Momentum: re-aimed at Swing, no question', () => {
    expect(whichWidget({ widget: 'm1' }, H, text)).toEqual({ args: { widget: 's1' } })
  })
  it('control: "the right one" side by side is still a place', () => {
    const side = host([{ ...stack('m1', 0, 'Momentum'), x: 12, h: 20 }, { ...stack('s1', 0, 'Momentum'), x: 18, h: 20 }], { A: 'SPY' })
    expect(whichWidget({ widget: 'm1' }, side, 'move volume after symbol in the right one')).toEqual({ args: { widget: 's1' } })
  })
})
