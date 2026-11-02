// agent-qa — MD-2 harness, panel half: the 30 MD-1 phrasings through the REAL AgentPanel (panelHarness), wired as
// agent-lead's #632/#633 wire it (registerServerGatedBuiltins after /api/agent/config). Measured per phrasing:
// model turns (requests to /api/agent/turn) and gateway reads (/api/agent/data). No model call, no network.
//   data on + data_kinds ⊇ {quote, quotes}: every FAST quote row = 0 model turns and exactly 1 read of the right
//     kind and symbols; every model/clarify row reads nothing on the fast path.
//   every other config shape: no read at all, and stock.quote is absent from the manifest the model is sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from '../testing/panelHarness'
import { registerBuiltins } from '../builtins'
import { _resetAgentConfig } from '../agentClient'
import { _resetTurns } from '../trace'
import { _resetForTest as resetQuote, CAPABILITY } from '../capabilities/marketDataQuote'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../../..')
const SC = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/md2/scenarios.json'), 'utf8')).scenarios
const MD = fs.readFileSync(path.join(REPO, 'docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
const ROWS = MD.split(/\r?\n/).map(l => l.match(/^\|\s*(P\d\d)\s*\|\s*(.+?)\s*\|\s*(fast|model|clarify)\s*\|\s*(.+?)\s*\|/)).filter(Boolean)
  .map(([, id, text, handling, act]) => {
    const a = act.match(/`([a-zA-Z.]+)`\s*→\s*`?([^`]*)`?/)
    return { id, text, handling, action: a ? a[1] : null,
      symbols: a ? (a[2].replace(/symbol(s)?:|bars:\s*\d+|n:\s*\d+/g, '').match(/[A-Z][A-Z0-9.]{0,9}/g) || []) : [] }
  })
const FAST_QUOTE = ROWS.filter(r => r.handling === 'fast' && /^quote\./.test(r.action))

let p, dataReads, turnBodies, config
async function run(text) {
  const { say } = p.mount(...ONE())
  await say(text)
  return { turns: p.turns(), reads: [...dataReads], bodies: [...turnBodies] }
}
beforeEach(() => {
  _resetAgentConfig(); _resetTurns(); resetQuote()
  dataReads = []; turnBodies = []
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json(config)
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body); dataReads.push(b)
      return json(b.kind === 'quotes' ? SC.partial_quotes.envelope : SC.live_regular.envelope)
    }
    if (u === '/api/agent/turn') turnBodies.push(JSON.parse(init.body))
    return harness(url, init)
  })
})
afterEach(() => { _resetTurns(); resetQuote(); vi.restoreAllMocks() })

describe('MD-2 panel: quote served (data on, data_kinds ⊇ {quote, quotes})', () => {
  beforeEach(() => { config = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['quote', 'quotes'] } })

  it('non-vacuity: 16 fast quote rows parsed from the contract (P01–P10, P12, P13, P15–P17, P25)', () => { expect(FAST_QUOTE.map(r => r.id)).toEqual(['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P12','P13','P15','P16','P17','P25']) })

  for (const r of FAST_QUOTE) {
    it(`${r.id} "${r.text}": 0 model turns, exactly 1 read of the right kind and symbols`, async () => {
      const got = await run(r.text)
      expect(got.turns, 'model turns').toBe(0)
      expect(got.reads).toHaveLength(1)
      const want = r.symbols.length === 1 ? { kind: 'quote', params: { symbol: r.symbols[0] } } : { kind: 'quotes', params: { symbols: r.symbols } }
      expect(got.reads[0]).toMatchObject({ ...want, purpose: 'answer' })
      expect(typeof got.reads[0].turn_id).toBe('string')
    }, 30000)
  }

  for (const r of ROWS.filter(x => x.handling !== 'fast')) {
    it(`${r.id} "${r.text}" (${r.handling}): the fast path does not read market data`, async () => {
      const got = await run(r.text)
      expect(got.reads, 'no gateway read from the fast path').toHaveLength(0)
    }, 30000)
  }
})

describe('MD-2 panel: every other config shape stays dark', () => {
  const shapes = [['data off', { data: false, data_kinds: ['quote', 'quotes'] }], ['no data_kinds (older server)', { data: true }],
    ['quote not activated', { data: true, data_kinds: ['bars.daily'] }], ['quotes missing', { data: true, data_kinds: ['quote'] }]]
  for (const [label, c] of shapes) {
    it(`${label}: P01 makes no gateway read, and stock.quote is not in the model's manifest`, async () => {
      config = { stream: false, nl1: false, scan: false, ...c }
      const got = await run(FAST_QUOTE[0].text)
      expect(got.reads).toHaveLength(0)
      expect(got.turns, 'with the quote path dark, the sentence goes to the model (today\'s behaviour)').toBe(1)
      const names = (got.bodies[0]?.capabilities || []).map(x => x.name)
      expect(names.length, 'non-vacuity: a manifest was sent').toBeGreaterThan(0)
      expect(names).not.toContain(CAPABILITY)
    }, 30000)
  }
})
