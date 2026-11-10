// WATCHLIST EXECUTION, group A (pl-exec, agent/pl/exec-watchlist; Lead decisions 2026-11-09): watchlist.showList — what ONE
// Watchlist widget shows, written exactly as its own picker writes it (opts.watchKey / watchName / watchTab), only on an explicit
// request; the receipt names the list or the mode; Undo restores the previous watchKey exactly. Through the REAL panel on the fixture
// board; the fixture server answers the picker's own catalogue endpoints. Held-out: agentWatchlistShowHeldOut (committed first).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): native Windows Node v24, jsdom, scripted plans.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { SHOW_HELD_OUT, SHOW_REFUSE_HELD_OUT, SHOW_TWO_WIDGETS_HELD_OUT } from './agentWatchlistShowHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const OWN = [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'AMD'] }, { id: 'w2', name: 'Swing Ideas', symbols: ['TSLA'] }]
const CATALOG = {
  prebuilt: [{ id: 'p1', name: 'Leaders', category: 'UCT Lists', item_count: 20 }, { id: 'p2', name: 'Semis Watch', category: 'UCT Lists', item_count: 12 }],
  community: [{ id: 'c1', name: 'Breakout Club', item_count: 9 }, { id: 'c2', name: 'Value Hunters', item_count: 15 }],
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which (?:Watchlist|watchlist|widget)|Did you mean/.test(transcript())
const chart = { id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: { settings: bareSettings() } }
const wl = (id, x, opts = { watchKey: 'user:w2', watchName: 'Swing Ideas', watchTab: 'mine' }) => ({ id, type: 'watchlist', x, y: 0, w: 6, h: 20, color: 'N', opts })
function mountBoard(widgets = [chart, wl('wa', 12)]) {
  const m = p.mount(widgets, { 'N:c': 'NVDA' }, { watchlists: OWN, catalog: CATALOG })
  return m
}
const optsOf = (board, id = 'wa') => board.state.widgets.find(w => w.id === id).opts
const plan = (args, widget = 'wa') => (body) => p.env('apply', [{ action: 'watchlist.showList', target: 'board', args: { widget, ...args } }])
const keyFor = ({ source, name }) => {
  if (source === 'mine') return `user:${OWN.find(l => l.name === name).id}`
  if (source === 'prebuilt') return `community:${CATALOG.prebuilt.find(l => l.name === name).id}`
  if (source === 'community') return `community:${CATALOG.community.find(l => l.name === name).id}`
  if (source === 'flagged') return 'flagged'
  return null
}

describe('watchlist.showList: what one Watchlist widget shows, as its picker writes it', () => {
  it.each(SHOW_HELD_OUT.map(c => [c.text, c]))('held-out "%s": the widget shows it; the receipt names it; Undo restores the previous watchKey exactly', async (t, c) => {
    const { say, board } = mountBoard()
    const before = JSON.stringify(optsOf(board))
    p.st.envelopes.push(plan(c.args))
    const out = await say(t)
    expect(optsOf(board).watchKey ?? null, out).toBe(keyFor(c.args))
    if (c.args.source === 'picker') expect(out).toMatch(/picker/i)
    else expect(out).toContain(c.args.name || 'Flagged')
    expect(optsOf(board).watchTab, out).toBe(c.args.source === 'picker' ? 'mine' : c.args.source === 'flagged' ? 'mine' : c.args.source)
    await say('undo')
    expect(JSON.stringify(optsOf(board))).toBe(before)
  }, 40000)

  it.each(SHOW_REFUSE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": REFUSED — nothing changes; the reason (or the near names) is said', async (t, c) => {
    const { say, board } = mountBoard()
    const before = JSON.stringify(optsOf(board))
    p.st.envelopes.push(plan(c.args))
    const out = await say(t)
    expect(JSON.stringify(optsOf(board)), out).toBe(before)
    expect(out).toMatch(c.refuse)
  }, 40000)

  it('already showing that list: nothing changes and nothing changed is said', async () => {
    const { say, board } = mountBoard()
    const before = JSON.stringify(optsOf(board))
    p.st.envelopes.push(plan({ source: 'mine', name: 'Swing Ideas' }))
    const out = await say('show Swing Ideas in the watchlist')
    expect(JSON.stringify(optsOf(board))).toBe(before)
    expect(out).toMatch(/already/i)
  }, 40000)

  it('a widget showing a list UCT chose or a followed list is not switched (as the open action\'s rule)', async () => {
    const { say, board } = mountBoard([chart, wl('wa', 12, { source: { kind: 'scan', key: 'x' } })])
    const before = JSON.stringify(optsOf(board))
    p.st.envelopes.push(plan({ source: 'prebuilt', name: 'Leaders' }))
    const out = await say('show the Leaders list')
    expect(JSON.stringify(optsOf(board)), out).toBe(before)
  }, 40000)
})

describe('two Watchlist widgets: the one meant, or asked', () => {
  it.each(SHOW_TWO_WIDGETS_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (t, c) => {
    const { say, board } = mountBoard([chart, wl('wa', 12), wl('wb', 18)])
    const before = [JSON.stringify(optsOf(board, 'wa')), JSON.stringify(optsOf(board, 'wb'))]
    const args = c.args || { source: 'prebuilt', name: 'Leaders' }
    // a plan that names NO widget (null): the one the words name, or asked — never guessed
    p.st.envelopes.push(plan(args, null))
    const out = await say(t)
    if (!c.which) {
      expect([JSON.stringify(optsOf(board, 'wa')), JSON.stringify(optsOf(board, 'wb'))], out).toEqual(before)
      expect(out).toMatch(/which one/i)
      return
    }
    const id = c.which === 'left' ? 'wa' : 'wb', other = c.which === 'left' ? 'wb' : 'wa'
    expect(optsOf(board, id).watchKey, out).toBe(keyFor(args))
    expect(JSON.stringify(optsOf(board, other))).toBe(before[other === 'wa' ? 0 : 1])
  }, 40000)
})
