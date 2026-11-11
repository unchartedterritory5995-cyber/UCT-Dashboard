// W1.1 repair-b R-05 (live LT-8 / LT-11, 2026-11-03) — F-16 hidden-field PHRASES through the REAL panel.
//
// Live: "now only the ones with rs rank over 90" went to the planner, which re-mapped "rs rank" to the PUBLIC
// `rs_line_trend` field ("the RS Line vs SPY values couldn't be read right now") — a silent substitution. Now the
// screener's fast path claims a screen-shaped request whose own words name a hidden field BEFORE the planner:
// 0 model calls, no scan, the F-16 sentence + the public alternative. "show me my strongest stocks" (live LT-11) gets
// the alternative too. Mutation: removing the phrase detector sends these to the planner (bodies.length 1) → red.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
/* global __dirname */
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
const REPO = path.resolve(__dirname, '../../../..')
const META = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/scores/screener-fields.json'), 'utf8'))
const SAVED = { saved: [], starters: [] }

let bodies, scans, records
beforeEach(async () => {
  bodies = []; scans = []; records = []
  _resetAgentConfig(); _resetScreenerCache(); _resetTurns()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: false, scan: false })
    if (u === '/api/agent/turn') { bodies.push(init.body); return json({ conversationId: 'c1', envelope: { disposition: 'answer', reply: 'Noted.', question: null, unsupported_category: null, ops: [] }, usage: {} }) }
    if (u === '/api/agent/record') { records.push(JSON.parse(init.body)); return json({ conversationId: 'c1' }) }
    if (u.startsWith('/api/screener/fields')) return json(u.includes('options') ? { options: {} } : { fields: META.fields })
    if (u === '/api/screener/saved-screens') return json(SAVED)
    if (u.startsWith('/api/screener/scan')) { scans.push(JSON.parse(init.body || 'null')); return json({ total: 1, snapshot_date: '2026-10-31', snapshot: {}, rows: [{ ticker: 'AAA', price: 10, market_cap: 5e10 }] }) }
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
  await loadAgentConfig(); await loadMeta(); await loadSaved()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); _resetTurns() })

async function mount() {
  const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  return async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
}

const RATED = [
  'now only the ones with rs rank over 90', 'stocks with an rs rating above 95', 'show me stocks with rs over 90',
  'only names with relative strength rank 90 or better', 'show me the rs leaders', 'sort them by uct composite',
  'just the ones with a uct score above 80', 'filter to composite over 85', 'stocks with an eps rating of 90+',
  'only an smr rating of a', 'names with sponsorship grade b or better', 'the ones with acc/dis a',
  'which stocks have an accumulation distribution grade of a', 'keep only setup score over 70',
  'stocks with an earnings setup grade of a', 'find stocks in the uct 20', 'rank them by pattern engine confidence',
]
const FLOW = ['find stocks with dark pool prints over 10m', 'only names with bullish options flow', 'stocks with net premium over 5m']

describe('F-16 phrases (R-05): a hidden-field phrase in a screen-shaped request never reaches the planner', () => {
  for (const text of RATED) {
    it(`"${text}": 0 model calls, no scan, the ratings sentence + a public alternative`, async () => {
      const say = await mount()
      await say(text)
      await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
      expect(bodies, 'no model call (mutation: without the detector this goes to the planner)').toHaveLength(0)
      expect(scans, 'no scan').toHaveLength(0)
      const all = JSON.stringify(records)
      expect(all).toContain(RATINGS_REFUSAL.slice(0, 40))
      expect(all).toContain('A public alternative:')
      expect(all).not.toContain('rs_line_trend')
    }, 30000)
  }
  for (const text of FLOW) {
    it(`"${text}": the flow sentence + the volume alternative, no planner`, async () => {
      const say = await mount()
      await say(text)
      await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
      expect(bodies).toHaveLength(0)
      expect(scans).toHaveLength(0)
      const all = JSON.stringify(records)
      expect(all).toContain(FLOW_REFUSAL.slice(0, 40))
      expect(all).toContain('A public alternative: volume vs its 30-day average')
    }, 30000)
  }
  it('LT-11: "show me my strongest stocks" carries the public alternative too (3-month price change)', async () => {
    const say = await mount()
    await say('show me my strongest stocks')
    await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
    expect(bodies).toHaveLength(0)
    expect(scans).toHaveLength(0)
    const all = JSON.stringify(records)
    expect(all).toContain(RATINGS_REFUSAL.slice(0, 40))
    expect(all).toContain('A public alternative: 3-month price change (chg_pct_3m)')
  }, 30000)
  for (const text of ['what is rs rank', 'where do i see the uct composite', 'show dark pool levels on this chart']) {
    it(`not a screen — the planner still sees it: "${text}"`, async () => {
      const say = await mount()
      await say(text)
      await waitFor(() => expect(records.length + bodies.length).toBeGreaterThan(0), { timeout: 6000 })
      expect(JSON.stringify(records)).not.toContain(RATINGS_REFUSAL.slice(0, 40))
      expect(JSON.stringify(records)).not.toContain(FLOW_REFUSAL.slice(0, 40))
    }, 30000)
  }
})
