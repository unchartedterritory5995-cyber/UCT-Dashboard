// agent-qa — MD-2 harness, panel half (MD-1 §4.7): EVERY row of MD-1-phrasings.md through the REAL AgentPanel, its
// OUTCOME column checked end to end. instrument.resolve is answered by the REAL server classifier over QA's OWN index
// (md2/resolve-qa-index.json, tests/test_uct_agent_qa_quote_outcome.py), never by agent-md's fixture.
//   price   0 model turns · instrument.resolve, then ONE quote/quotes read of the resolved symbols
//   bars    0 model turns · instrument.resolve, then ONE bars.daily read
//   ask:SYM 0 model turns · instrument.resolve only · "Did you mean SYM …"
//   limit   0 model turns · instrument.resolve only · the §4.7.3 limit sentence
//   model   the sentence goes to the model · no market-data read
// And every dark config shape (§4.7.4 adds instrument.resolve to the activation): no read, stock.quote absent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from '../testing/panelHarness'
import { registerBuiltins } from '../builtins'
import { _resetAgentConfig } from '../agentClient'
import { _resetTurns } from '../trace'
import { _resetForTest as resetQuote, CAPABILITY } from '../capabilities/marketDataQuote'
import IDX from '../__fixtures__/program/md2/resolve-qa-index.json'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../../..')
const SC = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/md2/scenarios.json'), 'utf8')).scenarios
const MD = fs.readFileSync(path.join(REPO, 'docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
const ROWS = MD.split(/\r?\n/).map(l => l.match(/^\|\s*(P\d\d)\s*\|\s*(.+?)\s*\|\s*(quote|none|bars\.[a-zA-Z0-9]+(?: n=\d+)?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/))
  .filter(Boolean).map(([, id, text, intent, , outcome]) => ({ id, text, intent, outcome }))
const SERVED = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['quote', 'quotes', 'bars.daily', 'instrument.resolve'] }

let p, reads, config
beforeEach(() => {
  _resetAgentConfig(); _resetTurns(); resetQuote()
  reads = []
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json(config)
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body); reads.push(b)
      if (b.kind === 'instrument.resolve') {
        const results = b.params.symbols.map(c => IDX.entries[`${c.text}|${c.form}`])
        if (results.some(r => !r)) throw new Error(`QA index fixture lacks ${JSON.stringify(b.params.symbols)}`)
        return json({ ...IDX.shell, params_echo: b.params, data: { results, all_symbols: results.every(r => r.class === 'symbol') } })
      }
      return json(b.kind === 'quotes' ? SC.partial_quotes.envelope : SC.live_regular.envelope)
    }
    return harness(url, init)
  })
})
afterEach(() => { _resetTurns(); resetQuote(); vi.restoreAllMocks() })
const run = async (text) => { const { say } = p.mount(...ONE()); const said = await say(text); return { turns: p.turns(), reads: [...reads], said: String(said || '') } }

describe('MD-2 panel: every MD-1-phrasings row, outcome column end to end (served)', () => {
  beforeEach(() => { config = SERVED })
  it('non-vacuity: 42 rows parsed; every outcome kind is present', () => {
    expect(ROWS).toHaveLength(42)
    const kinds = new Set(ROWS.map(r => r.outcome.split(':')[0]))
    for (const k of ['price', 'bars', 'ask', 'limit', 'model']) expect(kinds.has(k), k).toBe(true)
  })
  for (const r of ROWS) {
    it(`${r.id} "${r.text}" → ${r.outcome}`, async () => {
      const got = await run(r.text)
      const kinds = got.reads.map(x => x.kind)
      const [kind, sym] = r.outcome.split(':')
      if (kind === 'model') {
        expect(got.turns, 'goes to the model').toBe(1)
        expect(kinds).toEqual([])
        return
      }
      expect(got.turns, '0 model turns').toBe(0)
      expect(kinds[0], 'resolved before anything else').toBe('instrument.resolve')
      if (kind === 'price') {
        expect(kinds.slice(1).length, 'exactly one price read').toBe(1)
        expect(['quote', 'quotes']).toContain(kinds[1])
        expect(got.reads[1].purpose).toBe('answer')
      } else if (kind === 'bars') {
        expect(kinds.slice(1)).toEqual(['bars.daily'])
      } else {
        expect(kinds, `${kind}: no price or bars read`).toEqual(['instrument.resolve'])
        if (kind === 'ask') expect(got.said).toContain(`Did you mean ${sym}`)
        if (kind === 'limit') expect(got.said).toMatch(/isn't one I can price here/)
      }
    }, 30000)
  }
})

describe('MD-2 panel: every other config shape stays dark (§4.7.4)', () => {
  const shapes = [['data off', { data: false, data_kinds: SERVED.data_kinds }], ['no data_kinds (older server)', { data: true }],
    ['quote not activated', { data: true, data_kinds: ['bars.daily'] }], ['quotes missing', { data: true, data_kinds: ['quote', 'instrument.resolve'] }],
    ['instrument.resolve missing', { data: true, data_kinds: ['quote', 'quotes'] }]]
  for (const [label, c] of shapes) {
    it(`${label}: P01 makes no gateway read, and stock.quote is not in the model's manifest`, async () => {
      config = { stream: false, nl1: false, scan: false, ...c }
      const bodies = []
      const inner = globalThis.fetch
      globalThis.fetch = vi.fn(async (url, init = {}) => { if (String(url) === '/api/agent/turn') bodies.push(JSON.parse(init.body)); return inner(url, init) })
      const got = await run(ROWS[0].text)
      expect(got.reads).toHaveLength(0)
      expect(got.turns, 'the sentence goes to the model, as today').toBe(1)
      const names = (bodies[0]?.capabilities || []).map(x => x.name)
      expect(names.length, 'non-vacuity: a manifest was sent').toBeGreaterThan(0)
      expect(names).not.toContain(CAPABILITY)
    }, 30000)
  }
})
