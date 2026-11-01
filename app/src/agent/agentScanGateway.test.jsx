// SC-1 — the Agent's screener capability reading through the MD-1 gateway (owner: agent-sc).
// Flags are ON in this file only (a fake GET /api/agent/config). The fake POST /api/agent/data enforces
// the server's one-scan-per-turn rule so budget accounting is visible end to end; the real budget is
// railed server-side in tests/test_uct_agent_scan_*.py. No model, no provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability } from './capabilities'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, loadMeta, loadSaved } from './capabilities/screener'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'

registerBuiltins()

const META = { fields: [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '' },
  { key: 'price', label: 'Price', type: 'range', unit: '$' },
] }
const SAVED = { saved: [{ id: 7, name: 'Leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 80 }] } }],
  starters: [{ id: 'starter_uct_50', name: 'UCT 50', spec: { filters: [{ key: 'price', op: 'gte', min: 5 }] } }] }

const envelope = (kind, params, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: params, status: 'ok', freshness: 'periodic', as_of: '2026-10-30T20:00:00Z',
  fetched_at: '2026-11-01T15:00:00Z', delay_s: null, stale: false, source: 'uct-screener',
  coverage: { evaluated: 3600, answered: 3600, dropped: 0, not_computable: 0 }, provider_calls: 0,
  notes: ['Screener snapshot — values as of the 2026-10-30 close (nightly), not live.'], data: null, ...over,
})
const refused = (kind, params, note) => envelope(kind, params, { status: 'refused', freshness: 'unavailable', as_of: null, coverage: null, data: null, notes: [note] })

let calls, scansByTurn, scanFlag, nextScan
beforeEach(async () => {
  _resetScreenerCache(); _resetAgentConfig()
  calls = []; scansByTurn = new Map(); scanFlag = true; nextScan = null
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/config') return json({ stream: false, nl1: false, data: scanFlag, scan: scanFlag })
    if (url === '/api/screener/fields') return json(META)
    if (url === '/api/screener/saved-screens') return json(SAVED)
    if (url === '/api/screener/scan') return json({ total: 2, rows: [{ ticker: 'LEG', price: 1 }], snapshot_date: '2026-10-31', snapshot: {} })
    if (url === '/api/agent/data') {
      const { kind, params, turn_id: turn } = body
      const n = scansByTurn.get(turn) || 0
      if (n >= 1) return json(refused(kind, params, 'this turn already ran 1 scan'))
      scansByTurn.set(turn, n + 1)
      if (nextScan) { const r = nextScan(kind, params); nextScan = null; return json(r) }
      if (kind === 'screen.saved') {
        return json(envelope(kind, params, { coverage: { evaluated: 2, answered: 1, dropped: 0, not_computable: 1 }, status: 'partial',
          data: { screens: [{ id: 7, name: 'Leaders', spec: {}, runnable: true }, { id: 8, name: 'EMA cross', spec: {}, runnable: false, reason: "indicator-condition scans aren't available to the Agent yet" }] } }))
      }
      if (params.saved_id != null && params.saved_id !== 7) return json(refused(kind, params, 'you have no saved screen with that id'))
      return json(envelope(kind, params, { status: 'partial', coverage: { evaluated: 3600, answered: 3590, dropped: 4, not_computable: 6 },
        data: { spec: params.spec || {}, rows: [{ symbol: 'AAA', price: 50, rs_rank: 99, chg_pct_1d: 1.5 }, { symbol: 'BBB', price: 20, rs_rank: 95, chg_pct_1d: -0.5 }], total_matches: 42, fields: [], excluded: [], origin: { source: params.saved_id ? 'saved' : 'spec' } } }))
    }
    return json({})
  })
  await loadAgentConfig()
  await loadMeta()
})
afterEach(() => { vi.restoreAllMocks() })

const ARGS = { filters: [{ field: 'rs_rank', op: 'gte', value: 80, max: null, values: null }], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: null }
const run = (args = ARGS, ctx = { surface: 'charts', turnId: 'turn-1' }) => getCapability('screener.run').answer(null, args, null, ctx)
const dataCalls = () => calls.filter(c => c[0] === '/api/agent/data')
const screenerRouteScans = () => calls.filter(c => c[0] === '/api/screener/scan')

describe('SC-1 gateway path for the screener capability', () => {
  it('reads one screen.run envelope (never /api/screener/scan) and shows its rows, coverage and the data\'s own time', async () => {
    const a = await run()
    expect(screenerRouteScans()).toEqual([])
    expect(dataCalls()).toHaveLength(1)
    const [, body] = dataCalls()[0]
    expect(body).toMatchObject({ kind: 'screen.run', purpose: 'answer', turn_id: 'turn-1' })
    expect(body.params.spec.filters).toEqual([{ key: 'rs_rank', op: 'gte', min: 80 }])
    expect(body.params.limit).toBe(10)
    expect(a.text).toMatch(/^42 stocks match \(RS Rank ≥ 80\)\. Showing the first 2 by RS Rank/)
    expect(a.text).toContain('Checked 3,600 stocks: 3,590 could be decided, 6 had a missing value, 4 were excluded for stopped price history.')
    expect(a.text).toContain('values as of the 2026-10-30 close (nightly), not live.')
    expect(a.text).not.toMatch(/\blive prices\b|\bright now\b/)
    expect(a.table.rows.map(r => r.ticker)).toEqual(['AAA', 'BBB'])
  })

  it('DISABLED FLAGS: with the server not serving scans, the capability is exactly the existing path (no /api/agent/data)', async () => {
    _resetAgentConfig(); scanFlag = false; await loadAgentConfig()
    const a = await run()
    expect(dataCalls()).toEqual([])
    expect(screenerRouteScans()).toHaveLength(1)
    expect(a.text).toMatch(/^2 stocks match/)
  })

  it('MALFORMED CRITERIA: the gateway\'s refusal sentence is shown and nothing is presented as results', async () => {
    nextScan = (kind, params) => refused(kind, params, "the Screener has no field 'nope'")
    const a = await run()
    expect(a).toBe("I didn't run it: the Screener has no field 'nope'.")
  })

  it('ZERO MATCHES reads as "no names matched", dated by the screen\'s universe, with no table', async () => {
    nextScan = (kind, params) => envelope(kind, params, { data: { spec: {}, rows: [], total_matches: 0, origin: { source: 'spec' } },
      notes: ['No names matched. Screener snapshot as of the 2026-10-30 close (nightly), not live.'] })
    const a = await run()
    expect(a.text).toMatch(/^0 stocks match/)
    expect(a.text).toContain('No names matched. Screener snapshot as of the 2026-10-30 close (nightly), not live.')
    expect(a.table).toBeNull()
  })

  it('STALE data is said in words', async () => {
    nextScan = (kind, params) => envelope(kind, params, { stale: true, data: { spec: {}, rows: [{ symbol: 'AAA', price: 1, rs_rank: 90 }], total_matches: 1 },
      notes: ['Screener snapshot — values as of the 2026-10-27 close (nightly), not live.', 'This snapshot is 3 sessions behind the last close.'] })
    const a = await run()
    expect(a.text).toContain('This data is stale.')
    expect(a.text).toContain('3 sessions behind')
  })

  it('BUDGET: a second scan in the same turn is refused by the gateway; the next turn scans again', async () => {
    await run()
    const second = await run(ARGS, { surface: 'charts', turnId: 'turn-1' })
    expect(second).toBe("I didn't run it: this turn already ran 1 scan.")
    const third = await run(ARGS, { surface: 'charts', turnId: 'turn-2' })
    expect(third.text).toMatch(/^42 stocks match/)
  })

  it('NO TURN, NO SCAN: without the member\'s turn id it refuses and sends nothing (never mints its own id)', async () => {
    const a = await run(ARGS, { surface: 'charts' })
    expect(a).toMatch(/^I didn't run it: this screen needs the Agent's turn/)
    expect(dataCalls()).toEqual([])
    expect(screenerRouteScans()).toEqual([])
  })

  it('SAVED-SCREEN ISOLATION: the member\'s own screen is sent by id only (the server resolves it among THEIR screens); a starter by its spec', async () => {
    await loadSaved()
    const own = await getCapability('screener.runSaved').answer(null, { screen: '7', show: null }, null, { turnId: 't-own' })
    const [, b1] = dataCalls()[0]
    expect(b1.params).toEqual({ saved_id: 7, limit: 10 })
    expect(own.text).toMatch(/^Leaders: 42 stocks match/)
    await getCapability('screener.runSaved').answer(null, { screen: 'starter_uct_50', show: null }, null, { turnId: 't-starter' })
    const [, b2] = dataCalls()[1]
    expect(b2.params.saved_id).toBeUndefined()
    expect(b2.params.spec.filters).toEqual([{ key: 'price', op: 'gte', min: 5 }])
  })

  it('SAVED-SCREEN ISOLATION: an id the server does not find among the member\'s screens is refused, never run', async () => {
    nextScan = (kind, params) => refused(kind, params, 'you have no saved screen with that id')
    const a = await run(ARGS, { turnId: 't-x' })
    expect(a).toBe("I didn't run it: you have no saved screen with that id.")
  })

  it('listSaved reads screen.saved and names a screen the Agent cannot run, with the reason (never hidden)', async () => {
    const a = await getCapability('screener.listSaved').answer(null, {}, null, { turnId: 't-list' })
    expect(dataCalls()[0][1]).toMatchObject({ kind: 'screen.saved', turn_id: 't-list' })
    expect(a).toBe("Your screens: Leaders, EMA cross (can't run here: indicator-condition scans aren't available to the Agent yet)")
  })

  it('produce() (a list fill up to 1,000 symbols) stays on the Screener\'s own route — above SC-1\'s 50-row cap', async () => {
    await getCapability('screener.run').produce(ARGS, null)
    expect(dataCalls()).toEqual([])
    expect(screenerRouteScans().length).toBeGreaterThan(0)
  })
})
