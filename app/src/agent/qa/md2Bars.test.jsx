// agent-qa — MD-2 harness for `stock.dailyBars` (MD-1 v1.5 §4.6), browser half. The envelopes come from the REAL
// bars.daily adapter with the clock frozen (tests/test_uct_agent_qa_md2_bars.py → md2/bars-scenarios.json); the
// phrasings and read sizes are parsed from the contract. No model call, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from '../testing/panelHarness'
import { registerBuiltins } from '../builtins'
import { _resetAgentConfig } from '../agentClient'
import { _resetTurns } from '../trace'
import { answerFromBars, CAPABILITY, _resetBarsForTest } from '../capabilities/marketDataBars'
import { _resetForTest as resetQuote, CAPABILITY as QUOTE } from '../capabilities/marketDataQuote'

registerBuiltins()
const REPO = path.resolve(__dirname, '../../../..')
const SC = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/md2/bars-scenarios.json'), 'utf8')).scenarios
const MD = fs.readFileSync(path.join(REPO, 'docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
const ROWS = MD.split(/\r?\n/).map(l => l.match(/^\|\s*(P\d\d)\s*\|\s*(.+?)\s*\|\s*(fast|model|clarify)\s*\|\s*(.+?)\s*\|/)).filter(Boolean)
  .map(([, id, text, handling, act]) => ({ id, text, handling, act }))
const BARS_FAST = ROWS.filter(r => r.handling === 'fast' && /`bars\./.test(r.act))
const BARS_MODEL = ROWS.filter(r => ['P21', 'P26'].includes(r.id))
/** §4.6 read sizes: lastClose → 2, change n → n+1, range52w → 252. n from the row (`n: 10`), the symbol from the row. */
function expectedRead(r) {
  const sym = (r.act.match(/symbol:\s*([A-Z.]+)/) || r.act.match(/→\s*`?([A-Z.]+)`?\s*$/) || [])[1]
  const n = Number((r.act.match(/n:\s*(\d+)/) || [])[1])
  const bars = /bars\.lastClose/.test(r.act) ? 2 : /bars\.range52w/.test(r.act) ? 252 : n + 1
  return { kind: 'bars.daily', params: { symbol: sym, bars } }
}
const LIVE = /\b(live|now|right now|real-time)\b/i
const TAIL = "From UCT's daily bars: completed sessions only, today's session is not included."

describe('MD-2 dailyBars (1): §4.6 rules on REAL adapter envelopes', () => {
  it('non-vacuity: 9 scenarios, 6 fast bars rows (P18–P20, P22–P24), P21 and P26 go to the model', () => {
    expect(Object.keys(SC)).toHaveLength(9)
    expect(BARS_FAST.map(r => r.id)).toEqual(['P18', 'P19', 'P20', 'P22', 'P23', 'P24'])
    expect(BARS_MODEL.map(r => r.handling)).toEqual(['model', 'model'])
  })
  for (const [name, s] of Object.entries(SC)) {
    it(`${name}: only {text, present}; never live/now/real-time; no envelope internals; usable reads end with the completed-sessions line`, () => {
      const out = answerFromBars(s.envelope, s.args)
      expect(Object.keys(out).every(k => ['text', 'present'].includes(k))).toBe(true)
      expect(LIVE.test(out.text), out.text).toBe(false)
      const blob = JSON.stringify(out)
      for (const k of ['params_echo', 'provider_calls', 'fetched_at', 'latest_completed_session', '"coverage"']) expect(blob).not.toContain(k)
      for (const n of s.envelope.notes || []) expect(out.text, `note echoed: ${n}`).not.toContain(n)
      if (['ok', 'partial'].includes(s.envelope.status)) expect(out.text.trim().endsWith(TAIL), out.text).toBe(true)
    })
  }
  it('lastClose: the last COMPLETED session (today\'s developing bar in the store is excluded) vs the previous close', () => {
    const t = answerFromBars(SC.last_close.envelope, SC.last_close.args).text
    expect(t).toMatch(/^AAPL closed at \$142\.10 on Fri, Oct 30, its last completed session: \+\$2\.10 \(\+1\.50%\) vs the previous close of \$140\.00 on Thu, Oct 29\./)
    expect(t).not.toContain('999')
  })
  it('change over 5 sessions: from the first to the last close of the window', () => {
    expect(answerFromBars(SC.change_5.envelope, SC.change_5.args).text)
      .toMatch(/^NVDA over the last 5 completed sessions: \+10\.00% \(\+\$10\.00\), from a close of \$100\.00 on Fri, Oct 23 to \$110\.00 on Fri, Oct 30\./)
  })
  it('52-week range: high and low come from the bars\' HIGHS and LOWS, never from closes', () => {
    const t = answerFromBars(SC.range_52w.envelope, SC.range_52w.args).text
    expect(t).toMatch(/^NVDA 52-week range \(the last 252 completed sessions, .+\): high \$175\.25 on .+, low \$90\.50 on /)
  })
  it('stale store: names BOTH dates and says it is not the latest close', () => {
    expect(answerFromBars(SC.stale_last_close.envelope, SC.stale_last_close.args).text)
      .toMatch(/Note: UCT's bars for NVDA end .*Oct 28.*, but the most recent completed session was .*Oct 30.*, so this is not the latest close\./)
  })
  it('short window: states what is covered and never extrapolates', () => {
    expect(answerFromBars(SC.partial_change.envelope, SC.partial_change.args).text).toMatch(/the last 2 completed sessions held \(you asked for 10\)/)
    expect(answerFromBars(SC.partial_range.envelope, SC.partial_range.args).text).toMatch(/the 40 completed sessions held.*less than a full 52 weeks/)
    expect(answerFromBars(SC.single_bar_change.envelope, SC.single_bar_change.args).text).toMatch(/no change over 5 sessions can be given/)
  })
  it('no usable bars: fixed words keyed on status, no digits, no note', () => {
    for (const k of ['unavailable', 'refused']) {
      const t = answerFromBars(SC[k].envelope, SC[k].args).text
      expect(t, t).toMatch(/not available/)
      expect(t, t).not.toMatch(/\d/)
    }
    expect(SC.refused.envelope.notes[0], 'CONTROL: the refusal note carries a number').toMatch(/\d/)
  })
})

describe('MD-2 dailyBars (2): the real panel', () => {
  let p, reads, config
  beforeEach(() => {
    _resetAgentConfig(); _resetTurns(); _resetBarsForTest(); resetQuote(); reads = []
    p = setupPanel()
    const harness = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url)
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u === '/api/agent/config') return json(config)
      if (u === '/api/agent/data') { const b = JSON.parse(init.body); reads.push(b); return json(SC.change_5.envelope) }
      return harness(url, init)
    })
  })
  afterEach(() => { _resetTurns(); _resetBarsForTest(); resetQuote(); vi.restoreAllMocks() })
  const run = async (text) => { const { say } = p.mount(...ONE()); await say(text); return { turns: p.turns(), reads: [...reads] } }

  for (const r of BARS_FAST) {
    it(`${r.id} "${r.text}" (served): 0 model turns, exactly 1 bars.daily read of the §4.6 size`, async () => {
      config = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['bars.daily'] }
      const got = await run(r.text)
      expect(got.turns).toBe(0)
      expect(got.reads).toHaveLength(1)
      expect(got.reads[0]).toMatchObject({ ...expectedRead(r), purpose: 'answer' })
      expect(typeof got.reads[0].turn_id).toBe('string')
    }, 30000)
  }
  for (const r of BARS_MODEL) {
    it(`${r.id} "${r.text}": not claimed by the fast path (no read)`, async () => {
      config = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['bars.daily'] }
      expect((await run(r.text)).reads).toHaveLength(0)
    }, 30000)
  }
  const dark = [['data off', { data: false, data_kinds: ['bars.daily'] }], ['data_kinds null', { data: true, data_kinds: null }],
    ['data_kinds []', { data: true, data_kinds: [] }], ['without bars.daily', { data: true, data_kinds: ['quote', 'quotes'] }]]
  for (const [label, c] of dark) {
    it(`gate dark (${label}): P19 reads nothing and stock.dailyBars is absent from the model's manifest`, async () => {
      config = { stream: false, nl1: false, scan: false, ...c }
      const bodies = []
      const inner = globalThis.fetch
      globalThis.fetch = vi.fn(async (url, init = {}) => { if (String(url) === '/api/agent/turn') bodies.push(JSON.parse(init.body)); return inner(url, init) })
      const got = await run(BARS_FAST.find(r => r.id === 'P19').text)
      expect(got.reads.filter(r => r.kind === 'bars.daily')).toHaveLength(0)
      const names = (bodies[0]?.capabilities || []).map(x => x.name)
      expect(names.length, 'non-vacuity: a manifest was sent').toBeGreaterThan(0)
      expect(names).not.toContain(CAPABILITY)
      if (!(c.data_kinds || []).includes('quote')) expect(names).not.toContain(QUOTE)
    }, 30000)
  }
})
