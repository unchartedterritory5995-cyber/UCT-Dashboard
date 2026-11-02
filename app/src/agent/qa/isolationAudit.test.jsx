// agent-qa — ADR-005 ADVERSARIAL ISOLATION AUDIT, browser half (Sprint 2 task 1).
//
// COMPOSITION: the screener's catalog carries the SAME UCT-derived values the `ratings` kind isolates
// (`uct_composite`, `rating_*`, `sponsorship`, `accdis`, `rs_rank` — built by api/services/screener/enrich.py from
// the ratings store). screener.run is NOT isolated. Through the REAL panel, a scripted model plans a screen sorted
// by `uct_composite`; the scan rows carry SENTINEL composite values. Each test pins what reaches the next model
// request:
//   PROVEN  the raw values (outcome text, context, memory, title, telemetry, traces)
//   OPEN    the RANKING (memory.forModel `symbols_in_order`) and the COUNT (outcome text + context `lastScreen.matches`)
//           — derived numbers that reconstruct the protected value (a one-name `within` screen at `>= X`, repeated,
//           bisects a stock's composite). STRICT pins: they fail the day the owner changes the policy.
// No model call, no network: panelHarness-style fetch stubs. The fix is a policy decision (owner / agent-lead).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from '../builtins'
import { loadAgentConfig, _resetAgentConfig } from '../agentClient'
import { _resetScreenerCache, loadMeta } from '../capabilities/screener'
import { _resetTurns } from '../trace'
import { makeBoard } from '../__fixtures__/board'

vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from '../AgentPanel'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../../..')
const META = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/scores/screener-fields.json'), 'utf8'))
const VALUES = ['987.654', '135.79', '246.81']                         // sentinel composites, never real 1–99 values
const ORDER = ['ZZQA', 'ZZQB', 'ZZQC']                                  // the screen's rows, ranked by composite
const leaks = (o) => VALUES.filter(v => JSON.stringify(o ?? null).includes(v))

let envelopes, turnBodies, records, scans
beforeEach(async () => {
  envelopes = []; turnBodies = []; records = []; scans = []
  _resetAgentConfig(); _resetScreenerCache(); _resetTurns()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: false, scan: false })
    if (u === '/api/agent/turn') { turnBodies.push(body); const e = envelopes.shift(); return json({ conversationId: 'c1', envelope: typeof e === 'function' ? e(body) : e, usage: {} }) }
    if (u === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
    if (u.startsWith('/api/screener/fields')) return json(u.includes('options') ? { options: {} } : { fields: META.fields })
    if (u === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (u.startsWith('/api/screener/scan')) {
      scans.push(body)
      return json({ total: 3, snapshot_date: '2026-10-31', snapshot: {},
        rows: ORDER.map((t, i) => ({ ticker: t, price: 10 + i, uct_composite: Number(VALUES[i]), chg_pct_1d: 0 })) })
    }
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
  await loadAgentConfig(); await loadMeta()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); _resetTurns() })

const plan = (ops) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops })
const answer = { disposition: 'answer', reply: 'Noted.', question: null, unsupported_category: null, ops: [] }
const RUN = { filters: [{ field: 'uct_composite', op: 'gte', value: 90, max: null, values: null }],
  sort_field: 'uct_composite', sort_dir: 'desc', mode: 'new', show: null, as: null, within: null }

async function screenThenAsk() {
  const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  envelopes.push((b) => plan([{ action: 'screener.run', target: b.context.screener?.[0]?.ref, args: RUN }]))
  await say('could you dig up whichever names currently carry the strongest uct composite scores for me')
  await waitFor(() => expect(scans).toHaveLength(1), { timeout: 6000 })
  await waitFor(() => expect(records.some(r => r.outcomeData?.kind === 'answered')).toBe(true), { timeout: 6000 })
  envelopes.push(answer)
  await say('thanks, which of those would you look at first?')
  await waitFor(() => expect(turnBodies).toHaveLength(2), { timeout: 6000 })
  return records.find(r => r.outcomeData?.kind === 'answered')
}

describe('agent-qa isolation audit: COMPOSITION through the (non-isolated) screener', () => {
  it('non-vacuity: the real catalog carries UCT-derived ratings fields, and the scan really sorted by the composite', async () => {
    const keys = new Set(META.fields.map(f => f.key))
    for (const k of ['uct_composite', 'rating_eps', 'rating_growth', 'rating_value', 'rating_smr', 'sponsorship', 'accdis', 'rs_rank']) expect(keys.has(k), k).toBe(true)
    await screenThenAsk()
    expect(scans[0].sort).toEqual({ key: 'uct_composite', dir: 'desc' })
    expect(turnBodies[0].context.screener?.[0]?.ref, 'the plan targeted the real screener entry').toBeTruthy()
  }, 30000)

  it('PROVEN: no raw composite value reaches the next model request (text, context, memory, title, telemetry, traces)', async () => {
    const row = await screenThenAsk()
    expect(leaks(row.outcomeData?.views ?? row.outcomeData).length, 'CONTROL: the member DID see the values (stored views)').toBeGreaterThan(0)
    expect(leaks(row.outcome), 'outcome text (replayed for a non-local row)').toEqual([])
    turnBodies.forEach((b, i) => expect(leaks(b), `turn body ${i + 1}`).toEqual([]))
    records.forEach(r => expect(leaks(r.telemetry), 'telemetry').toEqual([]))
    expect(leaks(globalThis.window.__uctAgentTurns()), 'trace turns').toEqual([])
  }, 30000)

  it('OPEN (strict pin): the composite RANKING reaches the model — memory.symbols_in_order, in composite order', async () => {
    await screenThenAsk()
    const mem = turnBodies[1].context?.conversation_memory
    const set = mem?.recent_results?.[0]
    expect(set, JSON.stringify(mem)).toBeTruthy()
    expect(set.symbols_in_order).toEqual(ORDER)
    expect(turnBodies[1].context.screener?.[0]?.lastScreen?.sort).toBe('uct_composite desc')   // and what it is ranked BY
  }, 30000)

  it('OPEN (strict pin): the COUNT above a member-chosen composite threshold reaches the model — outcome text AND context', async () => {
    const row = await screenThenAsk()
    expect(row.outcome).toMatch(/\b3 stocks match/)                                    // replayed next turn (non-local row)
    expect(turnBodies[1].context.screener?.[0]?.lastScreen).toMatchObject({ matches: 3 })
    expect(JSON.stringify(turnBodies[1].context.screener[0].lastScreen.filters)).toMatch(/UCT Composite/)
  }, 30000)
})

// ── F-12: stock.compare's UCT composite, its OWN row (owner: DISPLAY-ONLY iff server-enforced isolation holds) ──
describe('agent-qa isolation audit: F-12 stock.compare composite', () => {
  async function compareThenAsk() {
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => (String(url).startsWith('/api/research/compare/')
      ? new Response(JSON.stringify({ a: { fundamentals: {}, ratings: { composite: Number(VALUES[0]) } },
        b: { fundamentals: {}, ratings: { composite: Number(VALUES[1]) } } }), { status: 200, headers: { 'content-type': 'application/json' } })
      : realFetch(url, init)))
    const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
    envelopes.push((b) => plan([{ action: 'stock.compare', target: b.context.stockData?.[0]?.ref, args: { symbols: ['NVDA', 'AMD'] } }]))
    await say('roughly how would you weigh the fundamentals of nvda against amd, in your view?')
    await waitFor(() => expect(records.some(r => r.outcomeData?.kind === 'answered')).toBe(true), { timeout: 6000 })
    envelopes.push(answer)
    await say('and which one has the better margin?')
    await waitFor(() => expect(turnBodies).toHaveLength(2), { timeout: 6000 })
    return records.find(r => r.outcomeData?.kind === 'answered')
  }

  it('FIXED: the rating is omitted even from the member display (stored views), while the payload carried it', async () => {
    const row = await compareThenAsk()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).startsWith('/api/research/compare/')),
      'CONTROL: the payload carrying the sentinel composite WAS served').toBe(true)
    expect(row.outcomeData.views, 'non-vacuity: the comparison table was stored').toBeTruthy()
    expect(leaks(row.outcomeData.views), 'views').toEqual([])
    expect(leaks(row.outcome), 'outcome text').toEqual([])
  }, 30000)

  it('tool result / history / summaries / memory / traces / telemetry: no value in any of them TODAY', async () => {
    const row = await compareThenAsk()
    expect(leaks(row.outcome), 'outcome text = what the server replays (tool result + history)').toEqual([])
    turnBodies.forEach((b, i) => expect(leaks(b), `turn body ${i + 1} (context, memory, pending)`).toEqual([]))
    expect(leaks(turnBodies[1].context?.conversation_memory), 'memory').toEqual([])
    records.forEach(r => expect(leaks(r.telemetry), 'telemetry').toEqual([]))
    expect(leaks(globalThis.window.__uctAgentTurns()), 'trace turns').toEqual([])
    expect(leaks(globalThis.window.__uctAgentTrace()), 'apply traces').toEqual([])
  }, 30000)

  it('FIXED (source rail): stock.js reads no rating off the research payload and promises none in its summary', () => {
    const src = fs.readFileSync(path.join(REPO, 'app/src/agent/capabilities/stock.js'), 'utf8')
    expect(src, 'non-vacuity: it still serves the compare payload').toMatch(/\/api\/research\/compare\//)
    expect(src).not.toMatch(/ratings\s*\?\.\s*composite|\.ratings\b|composite rating/i)
    expect(src).not.toMatch(/marketdata\/client/)             // and it never reads an isolated kind instead
  })
})
