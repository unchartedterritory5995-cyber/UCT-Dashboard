// agent-qa — F-16 FINAL RULING rails, browser half, INDEPENDENT of agent-sc's list (QA's own 33 names below).
// Through the REAL panel with the REAL field registry (__fixtures__/program/scores/screener-fields.json, which still
// carries every field: hiding them is the Agent's job, not the member Screener's).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from '../builtins'
import { loadAgentConfig, _resetAgentConfig } from '../agentClient'
import { _resetScreenerCache, loadMeta, loadSaved } from '../capabilities/screener'
import { RATINGS_REFUSAL, FLOW_REFUSAL } from '../capabilities/scanHidden'
import { _resetTurns } from '../trace'
import { makeBoard } from '../__fixtures__/board'
vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from '../AgentPanel'

registerBuiltins()
const QA_PROHIBITED = ['uct_composite', 'rating_eps', 'rating_growth', 'rating_value', 'rating_smr', 'sponsorship', 'accdis', 'rs_rank',
  'rs_return', 'dp_notional_1d', 'dp_prints_1d', 'dp_notional_5d', 'dp_level_dist_pct', 'opt_net_premium_1d', 'opt_bull_pct_1d',
  'opt_net_premium_5d', 'candle_score', 'earnings_setup_grade', 'pattern_engine_id', 'pattern_engine_conf', 'pattern_engine_dir',
  'pattern_engine_vcp', 'pattern_engine_flat_base', 'in_uct20', 'sector_rs_pct', 'pattern_entry_dist_pct', 'pattern_stop_dist_pct',
  'pattern_expectancy_r', 'archive_calls_n', 'base_structure', 'base_relation_count', 'hvc_52w', 'theme']
const REPO = path.resolve(__dirname, '../../../..')
const META = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/scores/screener-fields.json'), 'utf8'))
const named = (s) => QA_PROHIBITED.filter(k => new RegExp(`(^|[^a-z0-9_])${k}([^a-z0-9_]|$)`).test(s))
const SAVED = { saved: [{ id: 7, name: 'Composite leaders', spec: { filters: [{ key: 'uct_composite', op: 'gte', min: 90 }] } },
  { id: 8, name: 'Big caps', spec: { filters: [{ key: 'market_cap', op: 'gte', min: 1e10 }] } }], starters: [] }

let envelopes, bodies, scans, records
beforeEach(async () => {
  envelopes = []; bodies = []; scans = []; records = []
  _resetAgentConfig(); _resetScreenerCache(); _resetTurns()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: false, scan: false })
    if (u === '/api/agent/turn') { const b = JSON.parse(init.body); bodies.push(init.body); const e = envelopes.shift(); return json({ conversationId: 'c1', envelope: typeof e === 'function' ? e(b) : e, usage: {} }) }
    if (u === '/api/agent/record') { records.push(JSON.parse(init.body)); return json({ conversationId: 'c1' }) }
    if (u.startsWith('/api/screener/fields')) return json(u.includes('options') ? { options: {} } : { fields: META.fields })
    if (u === '/api/screener/saved-screens') return json(SAVED)
    if (u.startsWith('/api/screener/scan')) { scans.push(JSON.parse(init.body || 'null')); return json({ total: 2, snapshot_date: '2026-10-31', snapshot: {}, rows: [{ ticker: 'AAA', price: 10, market_cap: 5e10 }, { ticker: 'BBB', price: 9, market_cap: 4e10 }] }) }
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
  await loadAgentConfig(); await loadMeta(); await loadSaved()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); _resetTurns() })

const plan = (ops) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops })
const answer = { disposition: 'answer', reply: 'Noted.', question: null, unsupported_category: null, ops: [] }
const run = (over) => ({ filters: [], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, ...over })
const f = (field, value = 1) => ({ field, op: 'gte', value, max: null, values: null })
async function mount() {
  const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  return async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
}
async function planned(op, text = 'could you put together a screen along those lines for me please') {
  const say = await mount()
  envelopes.push((b) => plan([{ ...op, target: b.context.screener?.[0]?.ref }]))
  await say(text)
  await waitFor(() => expect(records.some(r => r.outcomeData)).toBe(true), { timeout: 6000 })
  return records.find(r => r.outcomeData)
}

describe('F-16 browser (1): nothing prohibited reaches the model', () => {
  it('non-vacuity: the member registry DOES carry all 33 (so their absence below is the Agent hiding them)', () => {
    expect(named(JSON.stringify(META.fields))).toEqual(QA_PROHIBITED.filter(k => named(JSON.stringify(META.fields)).includes(k)))
    expect(named(JSON.stringify(META.fields)).length).toBe(33)
  })
  for (const text of ['find me stocks with strong ratings, momentum and sector leadership, any screen is fine',
    'in your own words what is the market mood lately?']) {
    it(`no prohibited name anywhere in the model-bound body: "${text.slice(0, 40)}…"`, async () => {
      const say = await mount()
      envelopes.push(answer)
      await say(text)
      await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 6000 })
      const b = JSON.parse(bodies[0])
      const fields = b.context.screener?.[0]?.fields
      expect(fields, 'non-vacuity: the catalog was sent').toBeTruthy()
      // the catalog, entry by entry ("key:Label(unit)" or "key"): no prohibited KEY at all, `theme` included
      const keys = String(fields).split(/[;,]/).map(e => e.split(':')[0].trim())
      expect(keys.length, 'non-vacuity: the catalog has entries').toBeGreaterThan(50)
      expect(keys.filter(k => QA_PROHIBITED.includes(k))).toEqual([])
      // the whole body: no distinctive prohibited name anywhere (`theme` is also the app's COLOUR theme, so it is
      // checked as a catalog key above, not as a word)
      expect(named(bodies[0]).filter(k => k !== 'theme')).toEqual([])
    }, 30000)
  }
})

describe('F-16 browser (2): every Agent attempt is REFUSED clearly, never silently dropped', () => {
  const cases = [['filter on a rating', run({ filters: [f('uct_composite', 90)] }), RATINGS_REFUSAL],
    ['filter on dark-pool flow', run({ filters: [f('dp_notional_1d', 1e6)] }), FLOW_REFUSAL],
    ['filter on the UCT theme', { ...run({}), filters: [{ field: 'theme', op: 'in', value: null, max: null, values: ['AI'] }] }, RATINGS_REFUSAL],
    ['sort by RS rank', run({ filters: [f('price', 5)], sort_field: 'rs_rank', sort_dir: 'desc' }), RATINGS_REFUSAL],
    ['sort by the archive count', run({ filters: [f('price', 5)], sort_field: 'archive_calls_n', sort_dir: 'desc' }), RATINGS_REFUSAL]]
  for (const [label, args, sentence] of cases) {
    it(`${label}: the clear sentence, and NO scan was run`, async () => {
      const row = await planned({ action: 'screener.run', args })
      expect(scans, 'nothing reached the Screener').toHaveLength(0)
      expect(JSON.stringify(row)).toContain(sentence.slice(0, 40))
    }, 30000)
  }
  it('a SAVED screen that uses a rating is refused, never run with the rating stripped', async () => {
    const row = await planned({ action: 'screener.runSaved', args: { screen: '7', show: null } }, 'please run my saved composite leaders screen for me')
    expect(scans).toHaveLength(0)
    expect(JSON.stringify(row)).toContain(RATINGS_REFUSAL.slice(0, 40))
  }, 30000)
  it('CONTROL: the saved screen on public fields DOES run', async () => {
    await planned({ action: 'screener.runSaved', args: { screen: '8', show: null } }, 'please run my saved big caps screen for me')
    expect(scans).toHaveLength(1)
  }, 30000)
  it('a FOLLOW-UP refine that adds a rating to a public screen is refused, and the first screen ran', async () => {
    const say = await mount()
    envelopes.push((b) => plan([{ action: 'screener.run', target: b.context.screener?.[0]?.ref, args: run({ filters: [f('price', 5)] }) }]))
    await say('could you put together a screen of stocks over five dollars for me please')
    await waitFor(() => expect(scans).toHaveLength(1), { timeout: 6000 })
    envelopes.push((b) => plan([{ action: 'screener.run', target: b.context.screener?.[0]?.ref, args: run({ filters: [f('sector_rs_pct', 80)], mode: 'refine' }) }]))
    await say('and now narrow those down to the ones leading their sector please')
    await waitFor(() => expect(records.filter(r => r.outcomeData).length).toBeGreaterThanOrEqual(2), { timeout: 6000 })
    expect(scans, 'the refine never reached the Screener').toHaveLength(1)
    expect(JSON.stringify(records.at(-1))).toContain(RATINGS_REFUSAL.slice(0, 40))
  }, 30000)
})

describe('F-16 browser (3): "strongest" is refused locally, and the market-cap default is disclosed', () => {
  it('"show me my strongest stocks": 0 model turns, no scan, the refusal sentence', async () => {
    const say = await mount()
    await say('show me my strongest stocks')
    await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
    expect(bodies, 'no model call').toHaveLength(0)
    expect(scans, 'no scan').toHaveLength(0)
    expect(JSON.stringify(records)).toContain(RATINGS_REFUSAL.slice(0, 40))
  }, 30000)
  it('a screen with no order asked is sorted by market cap, and the receipt says so', async () => {
    const row = await planned({ action: 'screener.run', args: run({ filters: [f('price', 5)] }) })
    expect(scans).toHaveLength(1)
    expect(scans[0].sort).toEqual({ key: 'market_cap', dir: 'desc' })
    expect(String(row.outcome || '')).toMatch(/market cap/i)
  }, 30000)
})
