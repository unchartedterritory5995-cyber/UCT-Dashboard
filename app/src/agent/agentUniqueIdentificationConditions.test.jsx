// ⛔ H14 · AUDIT's conditions on the two #1324 judgement calls (2026-11-15).
//   (a) a same-colour chart tab is the same chart — 1. a tab with no colour / on its own group is SEPARATE; 2. a same-colour tab
//       showing ANOTHER ticker now is SEPARATE; 3. a sole-chart re-symbol that moves linked tabs names them, Undo restores all
//   (b) a list REMOVE is identified by the symbol — 4. judged over ALL lists holding it (2+ → asked, the lists as choices);
//       5. a symbol in NO list → an honest refusal, nothing removed; 6. "remove AAPL" never closes / re-symbols an AAPL chart
//       (AAPL both a chart and a list row, the list not named → asked)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { chartsInScope, chartRailRefusal, identifiesChart } from './chartRail'
import { stateRailRefusal, stateRailDecision } from './stateRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const one = [{ ref: 'c0', symbol: 'SPY', position: null }]
const host = (widgets, listed = one) => ({ layout: () => ({ widgets }), charts: { list: () => listed, read: (r) => listed.find(c => c.ref === r), selected: () => null } })
const chartW = (tabs) => ({ id: 'c0', type: 'chart', color: 'A', opts: { chartTabs: tabs } })

describe('(a) chart tabs — a same-colour tab showing the same ticker is the same chart; anything else is another chart', () => {
  it.each([
    ['1 · a tab with NO link colour', [{ id: 't1' }], 2],
    ['1 · a tab on ANOTHER link colour (its own group)', [{ id: 't1', color: 'B' }], 2],
    ['2 · a same-colour tab showing another ticker now (stale link state)', [{ id: 't1', color: 'A', symbol: 'QQQ' }], 2],
    ['a same-colour tab showing the same ticker', [{ id: 't1', color: 'A', symbol: 'SPY' }], 1],
    ['a same-colour timeframe tab (no ticker of its own)', [{ id: 't1', color: 'A' }], 1],
  ])('%s → %i chart(s) in scope', (_n, tabs, n) => {
    const h = host([chartW(tabs)])
    expect(chartsInScope(h).count).toBe(n)
    const e = { type: 'symbol', ref: 'c0', symbol: 'SPY', to: 'AMD', position: null }
    expect(!!identifiesChart('show AMD', e, h, { sole: chartsInScope(h).count === 1 })).toBe(n === 1)
  })
})

describe('(a) 3 · a sole-chart re-symbol that moves the charts linked with it: the receipt names them, Undo restores all', () => {
  it('two charts on ONE link colour (one object): "show AMD" moves both; the receipt names both; Undo restores both', async () => {
    const widgets = [{ id: 'c0', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: { settings: bareSettings() } }, { id: 'c1', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'A', opts: { settings: bareSettings() } }]
    // (the real host counts the widgets on the chart's link colour — host.buildChartSource linkedCount; the fixture reports 0)
    const m = p.mount(widgets, { A: 'SPY' }, { decorate: (x) => (x ? { ...x, label: `Chart (${x.symbol})`, linkedCount: 1 } : x) })
    p.select('c0')                                                    // (the earlier unnamed-chart screen asks without a click)
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'AMD' } }]))
    const out = await m.say('show AMD')
    const syms = () => m.board.state.widgets.map(w => m.h.charts.read(w.id).symbol)
    expect(syms(), out).toEqual(['AMD', 'AMD'])
    expect(out).toMatch(/AMD/)
    if (process.env.DUMP) console.log('RCPT>>', out)
    expect(out, 'the receipt names the linked chart that moved with it').toMatch(/(and 1 linked widget)/)
    await m.say('undo')
    expect(syms(), p.transcript()).toEqual(['SPY', 'SPY'])
  }, 40000)
})

// ── (b) list removes ──
const LISTS = (aaplIn) => [{ ref: 'wl1', name: 'Tech', symbols: aaplIn.includes('Tech') ? ['AAPL', 'MSFT'] : ['MSFT'] }, { ref: 'wl2', name: 'Swing', symbols: aaplIn.includes('Swing') ? ['AAPL', 'NVDA'] : ['NVDA'] }]
const removePlan = { ok: true, plans: [{ kind: 'watchlist', ref: 'wl1', before: { name: 'Tech', items: [{ sym: 'AAPL' }, { sym: 'MSFT' }] }, patch: { remove: [{ sym: 'AAPL' }] } }] }
describe('(b) 4 · "remove AAPL": uniqueness over EVERY list holding it', () => {
  it('AAPL on Tech AND Swing, the list not named → asked, both lists as choices', () => {
    const d = stateRailDecision(removePlan, { words: 'remove AAPL', scope: { watchlists: 2, lists: LISTS(['Tech', 'Swing']) } })
    expect(d?.text).toMatch(/AAPL is on “Tech” and “Swing” — which list should I remove it from\? Nothing was changed\./)
    expect(d?.ask).toMatchObject({ kind: 'lists', lists: [{ ref: 'wl1' }, { ref: 'wl2' }] })
  })
  it('the list named ("remove AAPL from Tech") → licensed', () => {
    expect(stateRailRefusal(removePlan, { words: 'remove AAPL from Tech', scope: { watchlists: 2, lists: LISTS(['Tech', 'Swing']) } })).toBeNull()
  })
  it('AAPL on Tech only → the symbol identifies the row: licensed', () => {
    expect(stateRailRefusal(removePlan, { words: 'remove AAPL', scope: { watchlists: 2, lists: LISTS(['Tech']) } })).toBeNull()
  })
  it('the member\'s pick from the lists asked licenses exactly that list', () => {
    expect(stateRailRefusal(removePlan, { words: 'remove AAPL', picked: new Set(['list:wl1']), scope: { watchlists: 2, lists: LISTS(['Tech', 'Swing']) } })).toBeNull()
  })
})

describe('(b) 5 · a symbol in NO list → an honest refusal, nothing removed', () => {
  it('"remove AAPL from Tech" when Tech does not hold it: refused, Tech unchanged', async () => {
    const m = p.mount([{ id: 'c0', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: bareSettings() } }], { 'N:c0': 'SPY' }, { watchlists: [{ id: 'wl1', name: 'Tech', symbols: ['MSFT'] }] })
    p.st.envelopes.push(b => {
      const list = Object.values(b.context || {}).flat().find(e => /Tech/.test(String(e?.label || e?.name || '')))
      return p.env('apply', [{ action: 'watchlist.remove', target: list.ref, args: { symbols: ['AAPL'] } }])
    })
    const out = await m.say('please drop the stock AAPL off my Tech list')
    const l = m.board.state.server.lists.find(x => x.id === 'wl1')
    expect((l?.items || []).map(i => i.sym), out).toEqual(['MSFT'])
    expect(out).toMatch(/AAPL/)
    expect(out).toMatch(/isn.t|not on|no AAPL|nothing|didn.t/i)
  }, 40000)
})

// a board plan that closes the AAPL chart (c0) beside SPY (c1)
const closeAapl = { ok: true, plans: [{ kind: 'board', ref: 'board', before: { board: [{ id: 'c0', type: 'chart' }, { id: 'c1', type: 'chart' }] }, after: { board: [{ id: 'c1', type: 'chart' }] },
  snap: { charts: new Map([['c0', { ref: 'c0', symbol: 'AAPL' }], ['c1', { ref: 'c1', symbol: 'SPY' }]]) } }] }
const twoHost = { charts: { list: () => [{ ref: 'c0', symbol: 'AAPL', position: 'left' }, { ref: 'c1', symbol: 'SPY', position: 'right' }], selected: () => null } }
describe('(b) 6 · "remove AAPL" never closes or re-symbols a chart showing AAPL', () => {
  it('AAPL is a chart AND a row in Tech, the list not named → asked which', () => {
    expect(chartRailRefusal(closeAapl, { words: 'remove AAPL', host: twoHost, mode: 'apply', lists: [{ name: 'Tech', symbols: ['AAPL'] }] })).toMatch(/^Do you mean AAPL in your “Tech” list, or the AAPL chart\? Nothing was changed/)
  })
  it('AAPL only a chart → still never closed by the bare symbol: refused, said how', () => {
    expect(chartRailRefusal(closeAapl, { words: 'remove AAPL', host: twoHost, mode: 'apply', lists: [] })).toMatch(/^I didn’t change anything: “AAPL” alone doesn’t say to close a chart/)
  })
  it('control: "close the AAPL chart" → the chart closes', () => {
    expect(chartRailRefusal(closeAapl, { words: 'close the AAPL chart', host: twoHost, mode: 'apply', lists: [{ name: 'Tech', symbols: ['AAPL'] }] })).toBeNull()
  })
  it('a re-symbol of the sole AAPL chart under "remove AAPL" is never licensed (not even by the sole-chart rule)', () => {
    const h = { charts: { list: () => [{ ref: 'c0', symbol: 'AAPL', position: null }], selected: () => null } }
    expect(identifiesChart('remove AAPL', { type: 'symbol', ref: 'c0', symbol: 'AAPL', to: 'SPY' }, h, { sole: true })).toBeNull()
  })
})
