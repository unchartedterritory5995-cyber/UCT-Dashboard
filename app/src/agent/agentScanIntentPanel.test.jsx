// SC-2 §7 H1 (owner: agent-sc) — the deterministic intent layer in the REAL panel (panelHarness), through screener.run's
// own fast claim. Agreed with agent-lead: dark unless config.scan + `screen.run` in data_kinds + the catalog is loaded;
// ask / refuse stay the planner's (H2 undecided); a follow-up never reuses a screen from another conversation.
// No model call: `p.turns()` counts every request that WOULD have reached the model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const counter = vi.hoisted(() => ({ n: 0 }))
vi.mock('./capabilities/scanIntent', async (orig) => {
  const real = await orig()
  return { ...real, intent: (...a) => { counter.n += 1; return real.intent(...a) } }
})
import { setupPanel, ONE } from './testing/panelHarness'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, intentArgs } from './capabilities/screener'
import { _resetAgentConfig } from './agentClient'
import { _resetTurns } from './trace'
import { AGENT_CONVERSATION_KEY } from './agentFlag'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../..')
const META = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/scores/screener-fields.json'), 'utf8'))
const opt = (values) => ({ values, with_value: values.length, total: values.length })
const OPTIONS = { industry: opt(['Semiconductors', 'Software - Application', 'Software - Infrastructure']), sector: opt(['Energy', 'Technology']) }
const ALL = ['screen.run', 'screen.count', 'screen.saved']
const LEAD = 'liquid semis above the 50-day with RS over 80 and volume picking up'

let p, cfg, reads
const envelope = (kind, params) => ({
  contract: 'MD-1.0', kind, params_echo: params, status: 'ok', freshness: 'periodic', as_of: '2026-10-30T20:00:00Z',
  fetched_at: '2026-11-01T15:00:00Z', delay_s: null, stale: false, source: 'uct-screener', provider_calls: 0,
  coverage: { evaluated: 3600, answered: 3600, dropped: 0, not_computable: 0 }, notes: [],
  data: { spec: params.spec || {}, rows: [{ symbol: 'AAA', price: 50, rs_rank: 99 }], total_matches: 7 },
})
beforeEach(() => {
  _resetScreenerCache(); _resetAgentConfig(); _resetTurns()
  counter.n = 0; reads = []
  cfg = { stream: false, nl1: false, data: true, scan: true, data_kinds: ALL }
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json(cfg)
    if (u.startsWith('/api/screener/fields')) return json(u.includes('options') ? { options: OPTIONS } : { fields: META.fields })
    if (u === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (u.startsWith('/api/screener/scan')) { reads.push(['route', JSON.parse(init.body)]); return json({ total: 7, rows: [{ ticker: 'AAA', price: 1 }], snapshot_date: '2026-10-31', snapshot: {} }) }
    if (u === '/api/agent/data') { const b = JSON.parse(init.body); reads.push(['gateway', b]); return json(envelope(b.kind, b.params)) }
    return harness(url, init)
  })
})
afterEach(() => { _resetTurns(); vi.restoreAllMocks() })

const ready = () => waitFor(() => expect(globalThis.fetch.mock.calls.some(c => String(c[0]).includes('/api/screener/fields?options') || String(c[0]).includes('options'))).toBe(true))
const keysOf = (spec) => (spec?.filters || []).map(f => f.key).sort()
const lastSpec = () => { const r = reads.filter(x => x[0] === 'gateway').pop(); return r ? r[1].params.spec : null }

describe('SC-2 H1: the intent layer through screener.run\'s fast claim', () => {
  it('FLAGS OFF: the intent layer is never consulted; the message goes to the planner as today', async () => {
    cfg = { stream: false, nl1: false, data: false, scan: false }
    const { say } = p.mount(...ONE())
    await ready()
    await say(LEAD)
    expect(counter.n).toBe(0)
    expect(p.turns()).toBe(1)
    expect(reads).toEqual([])
  }, 30000)

  it('KIND NOT LISTED (#639 gate): flags on without screen.run in data_kinds — never consulted', async () => {
    cfg = { ...cfg, data_kinds: ['screen.saved'] }
    const { say } = p.mount(...ONE())
    await ready()
    await say(LEAD)
    expect(counter.n).toBe(0)
    expect(p.turns()).toBe(1)
  }, 30000)

  it('FLAGS ON: a fully read screen runs with ZERO model turns, one gateway read, the intended spec', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    const out = await say(LEAD)
    expect(p.turns()).toBe(0)
    expect(reads.filter(r => r[0] === 'gateway')).toHaveLength(1)
    expect(keysOf(lastSpec())).toEqual(['above_50sma', 'dollar_vol_30d', 'industry', 'rs_rank', 'vol_ratio'])
    expect(out).toContain('7 stocks match')
  }, 30000)

  it('one word the layer does not read sends the message to the planner (no partial screen)', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    await say('liquid semis that look ready to break out')
    expect(p.turns()).toBe(1)
    expect(reads).toEqual([])
  }, 30000)

  it('a follow-up with no last screen is the planner\'s (ask is held for H2)', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    await say('only the ones near highs')
    expect(p.turns()).toBe(1)
  }, 30000)

  it('a follow-up in the SAME conversation refines the last screen with zero model turns', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    await say(LEAD)
    await say('only the ones near highs')
    expect(p.turns()).toBe(0)
    expect(keysOf(lastSpec())).toEqual(['above_50sma', 'dist_52w_high_pct', 'dollar_vol_30d', 'industry', 'rs_rank', 'vol_ratio'])
  }, 30000)

  it('⛔ a last screen from ANOTHER conversation is never reused: the follow-up goes to the planner', async () => {
    const { say } = p.mount(...ONE())
    await ready()
    await say(LEAD)
    await waitFor(() => expect(localStorage.getItem(AGENT_CONVERSATION_KEY)).toBe('ac_1'))   // the screen's own chat
    await new Promise(r => setTimeout(r, 120))                                               // adopted by lastEntry
    localStorage.setItem(AGENT_CONVERSATION_KEY, 'ac_other')      // New chat / another conversation
    await say('only the ones near highs')
    expect(p.turns()).toBe(1)
    expect(reads.filter(r => r[0] === 'gateway')).toHaveLength(1)                 // only the first screen read data
  }, 30000)

  it('⛔ a FRAGMENT is never a screen: a clause of a multi-clause message that was not fully read is refused', async () => {
    p.mount(...ONE())
    await ready()
    await waitFor(() => expect(intentArgs('large caps')).not.toBeNull())          // the gate is open (control)
    expect(intentArgs('semis above the 50-day and RS over 80 that look ready')).toBeNull()   // the whole: not fully read
    expect(intentArgs('RS over 80')).toBeNull()                                    // its clause, as the fast path splits it
    expect(intentArgs('semis above the 50-day')).toBeNull()
    expect(intentArgs('oversold large caps')).not.toBeNull()                       // a new message clears the memory
  }, 30000)
})
