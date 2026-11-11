// WATCHLIST EXECUTION, group D (pl-exec; Lead decisions 2026-11-09): watchlist.exportList — the list menu's own Copy / Export
// through the Watchlist widget's door (Watchlists.listout.test.jsx proves the door reaches exactly the menu's handlers). Here,
// through the REAL panel: "Copied" only once the write resolved (a refused write is said, with the menu item); CSV runs at once;
// Excel spends a quota, so it is ALWAYS a proposal first; export on the member's own lists only; two widgets: named or asked.
// C3-090 colour tags: not on /charts — fixed words, nothing changed. Held-out: agentWatchlistOutHeldOut (committed first).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, a stand-in door that records the menu handler calls.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { publishWidgetDoor } from '../pages/charts/widgetDoors'
import { OUT_HELD_OUT, OUT_REFUSE_HELD_OUT, TAG_HELD_OUT } from './agentWatchlistOutHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
const cleanups = []
beforeEach(() => { p = setupPanel() })
afterEach(() => { while (cleanups.length) cleanups.pop()(); vi.restoreAllMocks(); cleanup() })

const OWN = [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'AMD'] }, { id: 'w2', name: 'Swing Ideas', symbols: ['TSLA'] }]
const chart = { id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: { settings: bareSettings() } }
const wl = (id, x, name = 'Momentum', key = 'user:w1') => ({ id, type: 'watchlist', x, y: 0, w: 6, h: 20, color: 'N', opts: { watchKey: key, watchName: name, watchTab: 'mine' } })
// a stand-in for the Watchlist widget's door: the menu's handlers, recorded; the write resolves or is refused as the test says
function door({ name = 'Momentum', own = true, xlsx = true, refuse = false } = {}) {
  const d = {
    calls: [],
    listOut: () => ({ name, own, csv: own, xlsx: xlsx && own, quota: xlsx ? { remaining: 2 } : null }),
    copyList: () => { d.calls.push(['copy']); return refuse ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve() },
    exportList: (f) => { d.calls.push(['export', f]); if (!own) return null; return f === 'csv' ? true : Promise.resolve(true) },
  }
  return d
}
const publish = (id, d) => { cleanups.push(publishWidgetDoor(id, () => d)); return d }
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cards = () => screen.queryAllByTestId('agent-proposal').length
const plan = (format, widget = 'wa') => () => p.env('apply', [{ action: 'watchlist.exportList', target: 'board', args: { widget, format } }])
const mountBoard = (widgets = [chart, wl('wa', 12)]) => p.mount(widgets, { 'N:c': 'NVDA' }, { watchlists: OWN })

describe('watchlist.exportList: the list menu\'s own Copy / Export', () => {
  it.each(OUT_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (t, c) => {
    const { say } = mountBoard([chart, wl('wa', 12, c.list, c.list === 'Momentum' ? 'user:w1' : 'user:w2')])
    const d = publish('wa', door({ name: c.list }))
    p.st.envelopes.push(plan(c.args.format))
    const out = await say(t)
    if (c.propose) {
      // ⛔ Excel spends an export from the quota: shown first, nothing downloaded before Apply
      expect(cards(), out).toBe(1)
      expect(out).toMatch(/quota/)
      expect(d.calls, out).toEqual([])
      return
    }
    expect(d.calls, out).toEqual(c.args.format === 'clipboard' ? [['copy']] : [['export', c.args.format]])
    expect(out).toMatch(c.args.format === 'clipboard' ? new RegExp(`Copied “${c.list}” to your clipboard`) : new RegExp(`Downloaded a CSV of “${c.list}”`))
    expect(cards()).toBe(0)
  }, 40000)

  it('Excel: Apply downloads through the menu\'s handler, once', async () => {
    const { say, click } = mountBoard()
    const d = publish('wa', door())
    p.st.envelopes.push(plan('xlsx'))
    await say('export Momentum to Excel')
    expect(cards()).toBe(1)
    const out = await click('Apply')
    expect(d.calls, out).toEqual([['export', 'xlsx']])
    expect(transcript()).toMatch(/Downloaded an Excel file of “Momentum”/)
  }, 40000)

  it('a REFUSED clipboard write is never "copied": it is said, with the menu item', async () => {
    const { say } = mountBoard()
    publish('wa', door({ refuse: true }))
    p.st.envelopes.push(plan('clipboard'))
    const out = await say('copy the Momentum list to my clipboard')
    expect(out).not.toMatch(/Copied/)
    expect(out).toMatch(/Copy list to clipboard/)
  }, 40000)

  it.each(OUT_REFUSE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": export is the member\'s own lists only — refused, nothing called', async (t, c) => {
    const { say } = mountBoard([chart, wl('wa', 12, c.shows === 'flagged' ? 'Flagged' : "Ravi's Board", c.shows === 'flagged' ? 'flagged' : 'community:cw1')])
    const d = publish('wa', door({ name: c.shows === 'flagged' ? 'Flagged' : "Ravi's Board", own: false }))
    p.st.envelopes.push(plan(c.args.format))
    const out = await say(t)
    expect(d.calls, out).toEqual([])
    expect(out).toMatch(c.refuse)
    expect(cards()).toBe(0)
  }, 40000)

  it('no export quota: Excel refused in words (CSV offered), nothing called', async () => {
    const { say } = mountBoard()
    const d = publish('wa', door({ xlsx: false }))
    p.st.envelopes.push(plan('xlsx'))
    const out = await say('download the Momentum list as an excel file')
    expect(d.calls).toEqual([])
    expect(out).toMatch(/no export quota/)
  }, 40000)

  it('two Watchlist widgets and none named: asked, nothing called', async () => {
    const { say } = mountBoard([chart, wl('wa', 12), wl('wb', 18, 'Swing Ideas', 'user:w2')])
    const a = publish('wa', door()), b = publish('wb', door({ name: 'Swing Ideas' }))
    p.st.envelopes.push(plan('csv', null))
    const out = await say('export this watchlist as a csv file please')
    expect([...a.calls, ...b.calls], out).toEqual([])
    expect(out).toMatch(/which one/i)
  }, 40000)
})

describe('C3-090: colour tags are not on /charts — said in fixed words, nothing changed', () => {
  it.each(TAG_HELD_OUT.map(c => [c.text]))('held-out "%s": no model call; the Journal\'s ticker tags named; nothing changed', async (t) => {
    const { say, board } = mountBoard()
    const before = JSON.stringify(board.state.widgets)
    const out = await say(t)
    expect(p.turns(), out).toBe(0)
    expect(out).toMatch(/can't be set from the Charts watchlist widget/)
    expect(out).toMatch(/Journal/)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
})
