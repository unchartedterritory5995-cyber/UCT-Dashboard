// SC-1 acceptance — the REAL Agent panel (panelHarness: AgentPanel + useAgent + trace turns) running the
// screener capability through the MD-1 gateway. Owner: agent-sc.
// Flags are ON in this file only (a fake GET /api/agent/config). The fake POST /api/agent/data enforces
// one scan per turn_id, as the server does (the server's own budget is railed in pytest). The harness's
// fetch is wrapped here, never edited. No model call: fast paths, or the harness's scripted envelopes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from './testing/panelHarness'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache } from './capabilities/screener'
import { _resetAgentConfig } from './agentClient'
import { _resetTurns } from './trace'

registerBuiltins()

const META = { fields: [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '' },
  { key: 'price', label: 'Price', type: 'range', unit: '$' },
] }
const SAVED = { saved: [{ id: 7, name: 'Leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 80 }] } }], starters: [] }

const envelope = (kind, params, over = {}) => ({
  contract: 'MD-1.0', kind, params_echo: params, status: 'ok', freshness: 'periodic', as_of: '2026-10-30T20:00:00Z',
  fetched_at: '2026-11-01T15:00:00Z', delay_s: null, stale: false, source: 'uct-screener', provider_calls: 0,
  coverage: { evaluated: 3600, answered: 3590, dropped: 4, not_computable: 6 },
  notes: ['Screener snapshot — values as of the 2026-10-30 close (nightly), not live.'], data: null, ...over,
})
const refused = (kind, params, note) => envelope(kind, params, { status: 'refused', freshness: 'unavailable', as_of: null, coverage: null, notes: [note] })
const ROWS = [{ symbol: 'AAA', price: 50, rs_rank: 99, chg_pct_1d: 1.5 }, { symbol: 'BBB', price: 20, rs_rank: 95, chg_pct_1d: -0.5 }]

let p, scanFlag, perTurn, nextScan, seen
beforeEach(() => {
  _resetScreenerCache(); _resetAgentConfig(); _resetTurns()
  scanFlag = true; perTurn = new Map(); nextScan = null; seen = []
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const body = init.body ? JSON.parse(init.body) : null
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: scanFlag, scan: scanFlag })
    if (u.startsWith('/api/screener/fields')) return json(u.includes('options') ? { options: {} } : META)
    if (u === '/api/screener/saved-screens') return json(SAVED)
    if (u === '/api/screener/scan') { seen.push(['route', body]); return json({ total: 2, rows: [{ ticker: 'ROUTE', price: 1, rs_rank: 1 }], snapshot_date: '2026-10-31', snapshot: {} }) }
    if (u === '/api/agent/data') {
      seen.push(['gateway', body])
      const { kind, params, turn_id: t } = body
      if ((perTurn.get(t) || 0) >= 1) return json(refused(kind, params, 'this turn already ran 1 scan'))
      perTurn.set(t, (perTurn.get(t) || 0) + 1)
      if (nextScan) { const r = nextScan(kind, params); nextScan = null; return json(r) }
      if (kind === 'screen.saved') return json(envelope(kind, params, { coverage: { evaluated: 1, answered: 1, dropped: 0, not_computable: 0 }, data: { screens: [{ id: 7, name: 'Leaders', spec: {}, runnable: true }] } }))
      if (params.saved_id != null && params.saved_id !== 7) return json(refused(kind, params, 'you have no saved screen with that id'))
      return json(envelope(kind, params, { status: 'partial', data: { spec: params.spec || {}, rows: ROWS, total_matches: 42, origin: { source: params.saved_id ? 'saved' : 'spec' } } }))
    }
    return harness(url, init)
  })
})
afterEach(() => { _resetTurns(); vi.restoreAllMocks() })

const gateway = () => seen.filter(s => s[0] === 'gateway').map(s => s[1])
const route = () => seen.filter(s => s[0] === 'route')
const screenOp = (b, args) => ({ action: 'screener.run', target: b.context.screener[0].ref,
  args: { filters: [], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, ...args } })
// the warmups (fields, saved screens) land before the first message is typed
const ready = () => waitFor(() => expect(globalThis.fetch.mock.calls.some(c => c[0] === '/api/screener/saved-screens')).toBe(true))

describe('SC-1 acceptance: the screener capability in the real panel, through the gateway', () => {
  it('a screen reads ONE envelope in the member\'s turn and says coverage and the data\'s own time — never "live"', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    const out = await say('show me my strongest stocks')
    expect(p.turns()).toBe(0)                                   // the fast path: no model
    expect(route()).toEqual([])
    expect(gateway()).toHaveLength(1)
    expect(gateway()[0]).toMatchObject({ kind: 'screen.run', purpose: 'answer' })
    expect(gateway()[0].turn_id).toMatch(/^t-/)
    expect(gateway()[0].params.spec.sort).toEqual({ key: 'rs_rank', dir: 'desc' })
    expect(out).toContain('42 stocks match')
    expect(out).toContain('Checked 3,600 stocks: 3,590 could be decided, 6 had a missing value, 4 were excluded for stopped price history.')
    expect(out).toContain('values as of the 2026-10-30 close (nightly), not live.')
    expect(out).not.toMatch(/live prices|right now/)
    expect(out).toContain('AAA')
  }, 30000)

  it('DISABLED FLAGS: with the server not serving scans the panel uses the Screener route, and nothing reaches the gateway', async () => {
    scanFlag = false
    const { say } = p.mount(...ONE())
    await ready()
    const out = await say('show me my strongest stocks')
    expect(gateway()).toEqual([])
    expect(route()).toHaveLength(1)
    expect(out).toContain('2 stocks match')
  }, 30000)

  it('MALFORMED CRITERIA: an unknown field is refused before any read; a spec the server refuses shows its sentence', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    p.st.envelopes.push(b => p.env('apply', [screenOp(b, { filters: [{ field: 'nope', op: 'gt', value: 1, max: null, values: null }] })]))
    const a = await say('screen for nope above 1')
    expect(a).toMatch(/no field “nope”/)
    expect(gateway()).toEqual([])
    nextScan = (kind, params) => refused(kind, params, 'the Screener refused this spec: RS Rank: that value is out of range')
    p.st.envelopes.push(b => p.env('apply', [screenOp(b, { filters: [{ field: 'rs_rank', op: 'gt', value: 999, max: null, values: null }] })]))
    const b2 = await say('rs rank above 999')
    expect(b2).toContain("I didn't run it: the Screener refused this spec: RS Rank: that value is out of range.")
    expect(b2).not.toContain('stocks match')
  }, 30000)

  it('ZERO MATCHES reads as "no names matched", dated, with no table', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    nextScan = (kind, params) => envelope(kind, params, { coverage: { evaluated: 3600, answered: 3600, dropped: 0, not_computable: 0 },
      data: { spec: {}, rows: [], total_matches: 0 }, notes: ['No names matched. Screener snapshot as of the 2026-10-30 close (nightly), not live.'] })
    const out = await say('show me my strongest stocks')
    expect(out).toContain('0 stocks match')
    expect(out).toContain('No names matched. Screener snapshot as of the 2026-10-30 close (nightly), not live.')
    expect(out).not.toContain('AAA')
  }, 30000)

  it('SAVED-SCREEN ISOLATION: "run my Leaders screen" sends only the id — the server resolves it among THIS member\'s screens', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    const out = await say('run my leaders screen')
    expect(gateway()).toHaveLength(1)
    expect(gateway()[0].params).toEqual({ saved_id: 7, limit: 10 })
    expect(out).toContain('Leaders: 42 stocks match')
  }, 30000)

  it('SAVED-SCREEN ISOLATION: an id the server does not find among the member\'s screens is refused, never run', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    nextScan = (kind, params) => refused(kind, params, 'you have no saved screen with that id')
    const out = await say('run my leaders screen')
    expect(out).toContain("I didn't run it: you have no saved screen with that id.")
    expect(out).not.toContain('stocks match')
  }, 30000)

  it('listing saved screens reads screen.saved through the gateway', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    const out = await say('my saved screens')
    expect(gateway().map(g => g.kind)).toEqual(['screen.saved'])
    expect(out).toContain('Your screens: Leaders')
  }, 30000)

  it('BUDGET: two screens in ONE message share one turn id — the second is refused; the next message gets a new turn and scans again', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    p.st.envelopes.push(b => p.env('apply', [screenOp(b, { sort_field: 'rs_rank', sort_dir: 'desc' }), screenOp(b, { sort_field: 'price', sort_dir: 'desc' })]))
    const out = await say('screen by RS rank, and separately by price')
    const g = gateway()
    expect(g).toHaveLength(2)
    expect(g[0].turn_id).toBe(g[1].turn_id)
    expect(out).toContain('42 stocks match')
    expect(out).toContain("I didn't run it: this turn already ran 1 scan.")
    await say('show me my strongest stocks')
    const g2 = gateway()
    expect(g2).toHaveLength(3)
    expect(g2[2].turn_id).not.toBe(g[0].turn_id)
    expect(perTurn.get(g2[2].turn_id)).toBe(1)
  }, 30000)
})
