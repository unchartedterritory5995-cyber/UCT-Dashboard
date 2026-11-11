// AUDIT #1027 F1 / F2 rails (pl-widget): WHICH widget a widget op acts on, decided by the member's WORDS (agent/whichWidget.js),
// through the REAL panel (useAgent execute, the planner scripted). Written BEFORE the shared module, and run red on a7d44da95a.
//   (a) u18-refresh-10  two Scanners, "refresh the scanner": asked, and NEITHER is refreshed (the doors' act is spied)
//   (d) u18-refresh-06  "don't touch the period sort, just reload the scanner", the plan aimed at the Period Sort: the excluded
//                       widget gets NO refetch (its door's act is spied), and nothing is claimed
//   over-asks           u18-show-05 / u18-export-04: "Swing" names the Watchlist widget that shows Swing, so it acts with no question
//   controls            a uniquely named widget, or the only one of its kind, acts with no question
// (b) u18-look-07 and (c) u18-cols-07 are over the real Watchlist widgets: qa/chartsOutcome/whichWatchlist.outcome.test.jsx.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, stand-in doors that record each call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { publishWidgetDoor } from '../pages/charts/widgetDoors'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

registerBuiltins()
let p
const cleanups = []
beforeEach(() => { p = setupPanel() })
afterEach(() => { while (cleanups.length) cleanups.pop()(); vi.restoreAllMocks(); cleanup() })

const OWN = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA', 'AMD'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }, { id: 'l1', name: 'Long Term', symbols: ['MSFT'] }]
const chart = { id: 'c', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'N', opts: { settings: bareSettings() } }
const wg = (id, type, y, opts) => ({ id, type, x: 8, y, w: 8, h: 10, color: 'N', opts })
const IPOS = { scanKey: 'ipo-1y', scanName: 'IPOs' }
const GAINERS = { scanKey: 'top-gainers-30d', scanName: 'Top Gainers 30D' }
const PS = { start: 20261001, end: 20261102 }
const wl = (id, y, name, key) => wg(id, 'watchlist', y, { watchKey: key, watchName: name, watchTab: 'mine' })
// stand-in doors: a Refresh button (act) and a list menu (listOut / exportList), each call recorded
const actDoor = () => { const d = { calls: [], act: (k) => { d.calls.push(k); return Promise.resolve(true) } }; return d }
const listDoor = (name) => {
  const d = { calls: [], listOut: () => ({ name, own: true, csv: true, xlsx: false, quota: null }), copyList: () => Promise.resolve(), exportList: (f) => { d.calls.push(['export', f]); return true } }
  return d
}
const publish = (id, d) => { cleanups.push(publishWidgetDoor(id, () => d)); return d }
const plan = (...ops) => () => p.env('apply', ops.map(([action, args]) => ({ action, target: 'board', args })))
const refresh = (widget) => ['widget.setOption', { widget, key: 'refresh', value: 'run' }]
const mount = (widgets) => p.mount([chart, ...widgets], { 'N:c': 'SPY' }, { watchlists: OWN })
const optsOf = (board, id) => board.state.widgets.find(w => w.id === id).opts

describe('(a) u18-refresh-10: two Scanners and no name: asked, nothing refreshed', () => {
  it('"refresh the scanner" (the plan picked the top one): asked which, and neither door is pressed', async () => {
    const { say } = mount([wg('sa', 'scanner', 0, IPOS), wg('sb', 'scanner', 10, GAINERS)])
    const a = publish('sa', actDoor()), b = publish('sb', actDoor())
    p.st.envelopes.push(plan(refresh('sa')))
    const out = await say('refresh the scanner')
    expect([...a.calls, ...b.calls], out).toEqual([])
    expect(out).toMatch(/which/i)
    expect(out).not.toMatch(/Refreshed/)
  }, 40000)
})

describe('(d) u18-refresh-06: an EXCLUDED widget is never acted on', () => {
  it('"don\'t touch the period sort, just reload the scanner", planned on the Period Sort: the Period Sort gets NO refetch, nothing is claimed', async () => {
    const { say } = mount([wg('sc', 'scanner', 0, IPOS), wg('ps', 'periodsort', 10, PS)])
    const s = publish('sc', actDoor()), ps = publish('ps', actDoor())
    p.st.envelopes.push(plan(refresh('ps')))
    const out = await say("don't touch the period sort, just reload the scanner")
    expect(ps.calls, out).toEqual([])                                         // the spy: the excluded widget's Refresh was never called
    expect(out).not.toMatch(/Refreshed/)
    expect(s.calls).toEqual([])                                               // never re-aimed across types
  }, 40000)
  // AUDIT #1027 (post-#1029): the refusal must name BOTH widgets, or say why it won't guess. Fail closed: it names the one left
  // alone, the one the words asked for, says it will not guess, and how to get it done.
  it('u18-refresh-06: the refusal names the Period Sort AND the Scanner, and says it won\'t guess', async () => {
    const { say } = mount([wg('sc', 'scanner', 0, IPOS), wg('ps', 'periodsort', 10, PS)])
    const s = publish('sc', actDoor()), ps = publish('ps', actDoor())
    p.st.envelopes.push(plan(refresh('ps')))
    const out = await say("don't touch the period sort, just reload the scanner")
    expect(ps.calls, out).toEqual([])
    expect(s.calls, out).toEqual([])
    expect(out, out).toMatch(/leave the Period Sort alone/)
    expect(out, out).toMatch(/Scanner/)
    expect(out, out).toMatch(/won.t guess/)
    expect(out, out).toMatch(/Nothing changed\./)
  }, 40000)
})

describe('over-asks (AUDIT 3): a widget named by the list it shows acts with no question', () => {
  it('u18-show-05 "put Long Term on the Swing watchlist widget": the Swing widget shows Long Term; the other is untouched; no question', async () => {
    const { say, board } = mount([wl('wa', 0, 'Momentum', 'user:m1'), wl('wb', 10, 'Swing', 'user:s1')])
    const before = JSON.stringify(optsOf(board, 'wa'))
    p.st.envelopes.push(plan(['watchlist.showList', { widget: 'wb', source: 'mine', name: 'Long Term' }]))
    const out = await say('put Long Term on the Swing watchlist widget')
    expect(optsOf(board, 'wb').watchKey, out).toBe('user:l1')
    expect(JSON.stringify(optsOf(board, 'wa'))).toBe(before)
    expect(out).not.toMatch(/which one/i)
  }, 40000)
  it('u18-export-04 "export the Swing watchlist as a csv file": the Swing widget\'s own Export CSV, no question', async () => {
    const { say } = mount([wl('wa', 0, 'Momentum', 'user:m1'), wl('wb', 10, 'Swing', 'user:s1')])
    const a = publish('wa', listDoor('Momentum')), b = publish('wb', listDoor('Swing'))
    p.st.envelopes.push(plan(['watchlist.exportList', { widget: 'wb', format: 'csv' }]))
    const out = await say('export the Swing watchlist as a csv file')
    expect(b.calls, out).toEqual([['export', 'csv']])
    expect(a.calls).toEqual([])
    expect(out).not.toMatch(/which one/i)
  }, 40000)
})

describe('controls (AUDIT 5): a uniquely named widget, or the only one of its kind, acts with no question', () => {
  it('"refresh the IPOs scanner" with two Scanners: that one only', async () => {
    const { say } = mount([wg('sa', 'scanner', 0, IPOS), wg('sb', 'scanner', 10, GAINERS)])
    const a = publish('sa', actDoor()), b = publish('sb', actDoor())
    p.st.envelopes.push(plan(refresh('sa')))
    const out = await say('refresh the IPOs scanner')
    expect(a.calls, out).toEqual(['refresh'])
    expect(b.calls).toEqual([])
    expect(out).not.toMatch(/which/i)
  }, 40000)
  it('"refresh the scanner" with ONE Scanner (and a Period Sort): it acts', async () => {
    const { say } = mount([wg('sc', 'scanner', 0, IPOS), wg('ps', 'periodsort', 10, PS)])
    const s = publish('sc', actDoor()), ps = publish('ps', actDoor())
    p.st.envelopes.push(plan(refresh('sc')))
    const out = await say('refresh the scanner')
    expect(s.calls, out).toEqual(['refresh'])
    expect(ps.calls).toEqual([])
  }, 40000)
})
