// SAT-1 F-SAT-3 — a screener message typed while the field catalog is still loading must not fall through to
// the planner (a paid model call). The real panel (panelHarness); the catalog's arrival is controlled per test.
// Owner: agent-sc. Spec: agent-lead 2026-11-01 (bounded wait ≤ 3 s; failure/timeout = a local answer; after
// init, unchanged). No model call: `p.turns()` counts every request that WOULD have reached the model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE, MODEL_SENTINEL } from './testing/panelHarness'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, META_UNAVAILABLE, META_WAIT_MS, screenerKind, savedScreensNow } from './capabilities/screener'
import { _resetAgentConfig } from './agentClient'
import { _resetTurns } from './trace'

registerBuiltins()

const META = { fields: [{ key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '' }, { key: 'price', label: 'Price', type: 'range', unit: '$' }] }
const SAVED = { saved: [{ id: 7, name: 'Leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 80 }] } }], starters: [] }

let p, fields, saved, scans
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
// The message is SENT while the gate is closed (so the fast path decides with nothing loaded), and only then
// is the gate opened: no timer race with the harness's idle wait.
async function sayBeforeLoad(say, text, gate) {
  const pending = say(text)
  // open the gate only once the member's line is IN the transcript (the message has been dispatched)
  for (let i = 0; i < 200 && !(p.transcript() || '').includes(text); i++) await new Promise(r => setTimeout(r, 10))
  expect(p.transcript()).toContain(text)
  // proof the fast path decided with NOTHING loaded: the gate is still closed at dispatch
  expect(gate === fields.gate ? screenerKind.read(null, 'screener').ready : !!savedScreensNow()).toBe(false)
  gate.resolve()
  return pending
}
beforeEach(() => {
  _resetScreenerCache(); _resetAgentConfig(); _resetTurns()
  scans = []
  fields = { mode: 'ok', gate: null }        // ok | fail | hang
  saved = { gate: null }
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: false, scan: false })
    if (u.startsWith('/api/screener/fields')) {
      if (fields.gate) await fields.gate.promise
      if (fields.mode === 'hang') return new Promise(() => {})
      if (fields.mode === 'fail') return json({ detail: 'boom' }, 500)
      return json(u.includes('options') ? { options: {} } : (fields.meta || META))
    }
    if (u === '/api/screener/saved-screens') { if (saved.gate) await saved.gate.promise; return json(SAVED) }
    if (u === '/api/screener/scan') { scans.push(JSON.parse(init.body)); return json({ total: 3, rows: [{ ticker: 'AAA', price: 1, rs_rank: 99 }], snapshot_date: '2026-10-31', snapshot: {} }) }
    return harness(url, init)
  })
})
afterEach(() => { _resetTurns(); vi.restoreAllMocks() })

describe('F-SAT-3: a screener message typed before the field catalog loads', () => {
  it('waits for the catalog and takes the fast path: 0 model turns', async () => {
    fields.gate = deferred()
    const { say } = p.mount(...ONE())
    const out = await sayBeforeLoad(say, 'show me my strongest stocks', fields.gate)   // catalog arrives AFTER the send
    expect(p.turns()).toBe(0)
    expect(out).not.toContain(MODEL_SENTINEL)
    expect(out).toContain('3 stocks match')
    expect(scans).toHaveLength(1)
    expect(scans[0].sort).toEqual({ key: 'rs_rank', dir: 'desc' })
  }, 30000)

  it('a catalog that FAILS to load is a local answer: no model turn, no scan, nothing applied', async () => {
    fields.mode = 'fail'
    const { say } = p.mount(...ONE())
    const out = await say('show me my strongest stocks')
    expect(p.turns()).toBe(0)
    expect(out).toContain(META_UNAVAILABLE)
    expect(scans).toEqual([])
    expect(p.summaries()).toEqual([])                       // no receipt
  }, 30000)

  it(`a catalog that never arrives times out (≤ ${META_WAIT_MS} ms) into the same local answer`, async () => {
    fields.mode = 'hang'
    const { say } = p.mount(...ONE())
    const t0 = Date.now()
    const out = await say('show me my strongest stocks')
    expect(Date.now() - t0).toBeLessThan(META_WAIT_MS + 4000)
    expect(p.turns()).toBe(0)
    expect(out).toContain(META_UNAVAILABLE)
    expect(scans).toEqual([])
  }, 30000)

  it('a saved screen named before the saved list loads is resolved by name: 0 model turns', async () => {
    saved.gate = deferred()
    const { say } = p.mount(...ONE())
    const out = await sayBeforeLoad(say, 'run my leaders screen', saved.gate)
    expect(p.turns()).toBe(0)
    expect(out).toContain('Leaders: 3 stocks match')
    expect(scans[0].filters).toEqual([{ key: 'rs_rank', op: 'gte', min: 80 }])
  }, 30000)

  it('an unknown saved-screen name before the list loads is a local sentence naming the real screens', async () => {
    saved.gate = deferred()
    const { say } = p.mount(...ONE())
    const out = await sayBeforeLoad(say, 'run my zebra screen', saved.gate)
    expect(p.turns()).toBe(0)
    expect(out).toContain("I couldn't find one saved screen called “zebra” (your screens: Leaders)")
    expect(scans).toEqual([])
  }, 30000)
})

describe('F-SAT-3: after the catalog has loaded, behaviour is unchanged', () => {
  const ready = () => new Promise(r => setTimeout(r, 400))

  it('non-screener text still goes to the planner', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    await say('what do you think about the market today')
    expect(p.turns()).toBe(1)
  }, 30000)

  it('with the catalog loaded but no RS Rank field, the strongest phrase is the planner\'s, as before', async () => {
    fields.meta = { fields: [{ key: 'price', label: 'Price', type: 'range', unit: '$' }] }
    const { say } = p.mount(...ONE())
    await ready()
    await say('show me my strongest stocks')
    expect(p.turns()).toBe(1)
    expect(scans).toEqual([])
  }, 30000)

  it('"show me AAPL" before the saved list loads is NOT claimed as a saved screen', async () => {
    saved.gate = deferred()
    const { say } = p.mount(...ONE())
    const out = await say('show me AAPL')
    saved.gate.resolve()
    expect(out).not.toMatch(/saved screen/)
    expect(scans).toEqual([])
  }, 30000)
})
