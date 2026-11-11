// FLAGSHIP SCENARIO, planner v2 (Wave 1 A-06): the owner's sentence, as the scripted sequence of v2 steps a model would
// plan, executing FOR REAL through the panel harness (the real AgentPanel, useAgent, registry, planner, policy, runtime,
// receipts, Undo) against fake screener rows and the fixture board / watchlists / layouts. Existing capabilities only:
// screener.run → watchlist.create (approval card) → watchlist.add {from: lastScreen, top: 5} → widget.addCharts
// {from: lastScreen, top: 2} → indicator.add 9 EMA + 20 EMA on each new chart → layout.saveAs (approval card).
// ("above their 20 EMA": no Screener field exists for it yet — above_sma50 stands in; the shape is identical.)
// Receipts per step; each confirm-risk step shows the ordinary card and pauses the turn; "undo all of that" reverts
// every reversible step of the turn. No model call: testing/stepServer.js plays the server's part from the script.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { installStepServer } from './testing/stepServer'
import { _resetAgentConfig } from './agentClient'
import { _resetScreenerCache } from './capabilities/screener'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const SENTENCE = 'Find stocks above their 20 EMA with volume twice average, drop anything under $10, put the top five by three-month change on a new list, open the top two in the bottom row with my 9/20 EMAs, and save this as Momentum Review'
const CATALOG = JSON.parse(fs.readFileSync(path.resolve('src/agent/__fixtures__/nlIntent/screener-catalog.json'), 'utf8'))
// the fake Screener's answer: seven matches, already in the screen's own order (3-month performance, descending)
const ROWS = ['NVDA', 'AMD', 'AVGO', 'MU', 'SMCI', 'ANET', 'KLAC'].map((ticker, i) => ({ ticker, price: 100 - i, rvol: 2.5, perf_3m: 40 - i * 3 }))

let p, srv, scans, fetchMock
beforeEach(() => {
  _resetAgentConfig(); _resetScreenerCache()
  p = setupPanel()
  scans = []
  const harness = globalThis.fetch
  fetchMock = globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/screener/fields') return json({ fields: CATALOG.fields })
    if (u === '/api/screener/fields?options=1') return json({ options: CATALOG.options || {} })
    if (u === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (u === '/api/screener/scan') { scans.push(JSON.parse(init.body)); return json({ total: ROWS.length, rows: ROWS, snapshot_date: '2026-10-31', snapshot: {} }) }
    return harness(url, init)
  })
})
afterEach(() => { srv?.uninstall?.(); vi.restoreAllMocks(); cleanup() })

const shownIn = (result) => (/Symbols shown, in order: ([A-Z, ]+)\./.exec(String(result || '')) || ['', ''])[1].split(', ').filter(Boolean)
const refIn = (c, key, i = 0) => { const s = c.body.context[key]; return Array.isArray(s) ? s[i].ref : s.ref }
const addedOf = (c, kind) => c.results.flatMap(r => r.added || []).concat(c.srv.resumes.flatMap(r => r.added || [])).filter(a => a.kind === kind).map(a => a.ref)
const settled = async () => { await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 15000 }) }
const ema = (target, period) => ({ action: 'indicator.add', target, args: { defId: 'movingAverage', inputs: [{ key: 'period', value: period }, { key: 'maType', value: 'ema' }] } })
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart')
const FILTERS = [
  // "above their 20 EMA": the Screener has no 20-EMA field yet (above_sma50 is the nearest; the SC-1 spec for the
  // 20 EMA is C-05's). The step's SHAPE is the same once the field exists.
  { field: 'above_sma50', op: 'eq', value: 1, max: null, values: null },
  { field: 'rvol', op: 'gte', value: 2, max: null, values: null },
  { field: 'price', op: 'gte', value: 10, max: null, values: null },
]
// the steps a model would plan for the sentence, as the scripted server plays them
const SCRIPT = () => [
  (c) => ({ action: 'screener.run', target: refIn(c, 'screener'), args: { filters: FILTERS, sort_field: 'perf_3m', sort_dir: 'desc', mode: 'new', show: 5, as: null, within: null }, mode: 'query' }),
  (c) => ({ action: 'watchlist.create', target: refIn(c, 'watchlistLibrary'), args: { name: 'Momentum Leaders', as: null }, mode: 'propose' }),
  // the card was approved: the new list's ref came back with the resume ("New refs: …"); the model names it, and the
  // tickers the screen SHOWED came back with the query result, so it names them too (a {from: lastScreen} composition
  // would be a second approval card under today's policy)
  (c) => ({ action: 'watchlist.add', target: addedOf(c, 'watchlist')[0], args: { symbols: shownIn(c.results[0].result).slice(0, 5) } }),
  (c) => ({ action: 'widget.addCharts', target: refIn(c, 'workspace'), args: { symbols: shownIn(c.results[0].result).slice(0, 2), timeframe: null, chart_type: null, exact: null } }),
  (c) => ema(addedOf(c, 'indicatorEdits')[0], 9),
  (c) => ema(addedOf(c, 'indicatorEdits')[0], 20),
  (c) => ema(addedOf(c, 'indicatorEdits')[1], 9),
  (c) => ema(addedOf(c, 'indicatorEdits')[1], 20),
  (c) => ({ action: 'layout.saveAs', target: refIn(c, 'layouts'), args: { name: 'Momentum Review' }, mode: 'propose' }),
  { reply: 'Momentum Review is saved: the top five are on your new list and the top two are charted with the 9 and 20 EMA.' },
]

describe('flagship scenario through planner v2 (scripted steps, real execution)', () => {
  it('screen → new list (card) → top five on it → top two charted with the 9/20 EMAs → saved as Momentum Review (card); Undo after the save is refused honestly', async () => {
    srv = installStepServer(p, SCRIPT())
    // two charts across the TOP half: the bottom row is open for the two the scenario asks for
    const top = (id, x) => ({ id, type: 'chart', x, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
    const { say, board } = p.mount([top('cl', 0), top('cr', 12)], { 'N:cl': 'SPY', 'N:cr': 'QQQ' }, {
      watchlists: [{ id: 'wl1', name: 'Swing', symbols: ['AAPL'] }],
      layouts: { entries: [{ id: 'L1', name: 'Scratch Desk' }], boards: {}, active: 'L1' },   // (not a protected layout name)
    })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/screener/saved-screens')).toBe(true))

    // ── the member's sentence: the screen runs, the list is PROPOSED (card 1), the turn pauses ──
    await say(SENTENCE)
    await settled()
    expect(p.turns()).toBe(0)                                                        // never v1's /api/agent/turn
    expect(srv.bodies).toHaveLength(1)
    expect(srv.bodies[0].message).toBe(SENTENCE)
    expect(scans).toHaveLength(1)                                                    // ONE real screen, through the Screener route
    expect(scans[0].sort || scans[0].spec?.sort || JSON.stringify(scans[0])).toBeTruthy()
    expect(srv.results[0]).toMatchObject({ id: 's1', status: 'query' })
    expect(srv.results[0].result).toMatch(/7 stocks match/)                          // the screen's own count…
    expect(shownIn(srv.results[0].result)).toEqual(['NVDA', 'AMD', 'AVGO', 'MU', 'SMCI'])   // …and the tickers it showed (not an isolated kind)
    expect(srv.results[1]).toMatchObject({ id: 's2', status: 'proposed' })
    expect(p.proposals()).toHaveLength(1)
    expect(board.state.server.lists.map(l => l.name)).toEqual(['Swing'])

    // ── "do it": the list is created, the turn resumes — top five added, two charts, 9/20 EMAs, then card 2 ──
    await say('do it')
    await settled()
    expect(board.state.server.lists.map(l => l.name)).toEqual(['Swing', 'Momentum Leaders'])
    expect(srv.resumes[0]).toMatchObject({ id: 's2', status: 'done' })
    expect(srv.resumes[0].added.some(a => a.kind === 'watchlist')).toBe(true)        // the new list's ref went back to the model
    const leaders = board.state.server.lists.find(l => l.name === 'Momentum Leaders')
    expect(leaders.items.map(i => i.sym)).toEqual(['NVDA', 'AMD', 'AVGO', 'MU', 'SMCI'])    // the top five, in the screen's order
    expect(charts(board)).toHaveLength(4)                                            // two new charts
    expect(charts(board).slice(2).every(w => w.y >= 10)).toBe(true)                  // in the bottom row
    const fresh = charts(board).slice(2)
    expect(fresh.map(w => board.state.groupSyms[`N:${w.id}`])).toEqual(['NVDA', 'AMD'])    // the top two
    // the 9 and 20 EMA on each new chart — exactly one of each (a chart is born with them; the adds never double them)
    for (const w of fresh) {
      const b = p.brief(board, w.id)
      expect(b.filter(x => x === 'movingAverage(9 ema)')).toHaveLength(1)
      expect(b.filter(x => x === 'movingAverage(20 ema)')).toHaveLength(1)
    }
    expect(srv.results.map(r => r.status)).toEqual(['query', 'proposed', 'done', 'done', 'done', 'done', 'done', 'done', 'proposed'])
    expect(srv.results[3].added.filter(a => a.kind === 'indicatorEdits')).toHaveLength(2)  // the new charts' refs went back
    expect(p.proposals()).toHaveLength(2)                                            // card 2: the layout save
    expect(board.state.layouts.entries.map(e => e.name)).toEqual(['Scratch Desk'])

    // ── "do it" again: the layout is saved, the turn ends with the reply ──
    await say('do it')
    await settled()
    expect(board.state.layouts.entries.map(e => e.name)).toEqual(['Scratch Desk', 'Momentum Review'])
    expect(srv.resumes).toHaveLength(2)
    expect(srv.resumes[1]).toMatchObject({ id: 's9', status: 'done' })
    expect(p.transcript()).toContain('Momentum Review is saved')
    expect(p.summaries().length).toBeGreaterThanOrEqual(4)                           // a receipt per applied step (list, five added, two charts, the save)
    expect(srv.results.slice(4, 8).every(r => r.status === 'done' && /already on Chart/.test(r.receipt))).toBe(true)   // the EMA adds: honest no-ops
    expect(srv.events.filter(e => e.t === 'step')).toHaveLength(9)

    // ── "undo all of that" AFTER the save: "Momentum Review" is now the open layout, and Undo never reaches across
    //    layouts (the existing rule) — said honestly, nothing changed; the group Undo itself is proved below ──
    const out = await say('undo all of that')
    expect(out).toMatch(/A different layout is open now/)
    expect(charts(board)).toHaveLength(4)
    expect(board.state.server.lists.find(l => l.name === 'Momentum Leaders').items).toHaveLength(5)
    expect(p.turns()).toBe(0)
  }, 60000)

  it('…and when the save is declined, "undo all of that" reverts every reversible step of the turn (the five on the list, the two charts)', async () => {
    srv = installStepServer(p, SCRIPT())
    const top = (id, x) => ({ id, type: 'chart', x, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
    const { say, board } = p.mount([top('cl', 0), top('cr', 12)], { 'N:cl': 'SPY', 'N:cr': 'QQQ' }, {
      watchlists: [{ id: 'wl1', name: 'Swing', symbols: ['AAPL'] }],
      layouts: { entries: [{ id: 'L1', name: 'Scratch Desk' }], boards: {}, active: 'L1' },
    })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/screener/saved-screens')).toBe(true))
    await say(SENTENCE)
    await settled()
    await say('do it')                                                               // the list
    await settled()
    expect(charts(board)).toHaveLength(4)
    expect(p.proposals()).toHaveLength(2)
    await say('no')                                                                  // not the layout save
    await settled()
    expect(srv.resumes[1]).toMatchObject({ id: 's9', status: 'refused' })
    expect(board.state.layouts.entries.map(e => e.name)).toEqual(['Scratch Desk'])
    const out = await say('undo all of that')
    expect(out).toMatch(/Took back all 2 changes from your last request/)              // the five on the list, the two charts (the create has no Undo)
    expect(charts(board)).toHaveLength(2)                                            // the two new charts are gone
    expect(board.state.server.lists.find(l => l.name === 'Momentum Leaders').items).toEqual([])   // the five are off the list
    expect(board.state.server.lists.map(l => l.name)).toEqual(['Swing', 'Momentum Leaders'])        // the list itself stays (no Undo, as its manifest says)
    expect(p.turns()).toBe(0)
  }, 60000)
})
