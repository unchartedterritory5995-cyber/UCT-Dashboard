// agent-qa — MD-2 ACCEPTANCE HARNESS for `stock.quote` (MD-1 v1.5 §4.5 + MD-1-phrasings.md), browser half.
//
// Independent of agent-md's own tests: the ENVELOPES are produced by the REAL quotes adapter with every clock frozen
// at one instant (tests/test_uct_agent_qa_md2.py → __fixtures__/program/md2/scenarios.json), and the PHRASINGS are
// parsed from the contract file, not retyped. Checks the §4.5 rules on every row, flags-off identity with
// stock.profile, the pure fast-path matcher, and whether the fast path is wired yet. No model call, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const flags = { data: false, kinds: null }
const reads = []
let nextEnvelope = null
vi.mock('../agentClient', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, serverServesData: () => flags.data, serverDataKinds: () => flags.kinds }
})
vi.mock('../marketdata/client', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, readData: vi.fn(async (kind, params, opts) => { reads.push({ kind, params, opts }); return nextEnvelope }) }
})

import { answerFromEnvelope, answerQuote, match, quoteServed, registerMarketDataCapabilities, _resetForTest, CAPABILITY } from '../capabilities/marketDataQuote'
import { answerProfile } from '../capabilities/stock'
import { getCapability } from '../capabilities'
import { turnStart, turnEnd, _resetTurns } from '../trace'

const REPO = path.resolve(__dirname, '../../../..')
const SC = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/md2/scenarios.json'), 'utf8')).scenarios
const PHRASES_MD = fs.readFileSync(path.join(REPO, 'docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')

/** The phrasings table, parsed from the contract: {id, text, handling, action, symbols}. */
function phrasings() {
  const out = []
  for (const line of PHRASES_MD.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(P\d\d)\s*\|\s*(.+?)\s*\|\s*(fast|model|clarify)\s*\|\s*(.+?)\s*\|/)
    if (!m) continue
    const [, id, text, handling, act] = m
    const a = act.match(/`([a-zA-Z.]+)`\s*→\s*`?([^`]*)`?/)
    const action = a ? a[1] : null
    const symbols = a ? (a[2].replace(/symbol(s)?:|bars:\s*\d+|n:\s*\d+/g, '').match(/[A-Z][A-Z0-9.]{0,9}/g) || []) : []
    out.push({ id, text, handling, action, symbols })
  }
  return out
}
const ALL = phrasings()
const LIVE_WORDS = /\b(live|now|right now)\b/i
const shown = (present) => JSON.stringify(present ?? null, (k, v) => (k === 'aka' ? undefined : v))   // aka = search aliases, not shown

beforeEach(() => { flags.data = false; flags.kinds = null; reads.length = 0; nextEnvelope = null; _resetTurns(); _resetForTest() })
afterEach(() => { vi.useRealTimers(); _resetTurns(); _resetForTest() })

describe('MD-2 (1): §4.5 rules on REAL adapter envelopes, one per answer row', () => {
  it('non-vacuity: every §4.5 row has a scenario, and the phrasings table parsed to 30 rows', () => {
    expect(Object.keys(SC).sort()).toEqual(['early_close_afterhours_live', 'historical_afterhours', 'holiday_close', 'live_premarket',
      'live_regular', 'overnight_ah_print', 'partial_quotes', 'refused_budget', 'regular_from_close', 'stale_regular', 'unavailable', 'weekend_close'])
    expect(ALL).toHaveLength(30)
  })

  for (const [name, s] of Object.entries(SC)) {
    it(`${name}: only {text, present} leave; "live/now" iff fresh live; no envelope internals`, () => {
      const env = s.envelope
      const out = answerFromEnvelope(env, s.symbols)
      expect(Object.keys(out).every(k => ['text', 'present'].includes(k)), Object.keys(out).join()).toBe(true)
      const fresh = env.freshness === 'live' && !env.stale
      expect(LIVE_WORDS.test(out.text), `text: ${out.text}`).toBe(fresh)
      expect(LIVE_WORDS.test(shown(out.present)), 'present (shown values and notes)').toBe(fresh)
      const blob = JSON.stringify(out)
      for (const k of ['params_echo', 'provider_calls', 'fetched_at', 'delay_s', 'contract', '"coverage"']) expect(blob, k).not.toContain(k)
      if (env.source) expect(blob, 'the source id').not.toContain(env.source)
      if (env.status === 'ok' || env.status === 'partial') for (const n of env.notes || []) expect(out.text, `note echoed: ${n}`).not.toContain(n)
    })
  }

  it('fresh live regular: price, change vs previous close, regular session, as-of in ET; labelled figures', () => {
    const out = answerFromEnvelope(SC.live_regular.envelope, ['NVDA'])
    expect(out.text).toMatch(/^NVDA \$142\.10, \+\$1\.23 \(\+0\.87%\) vs the previous close — live, regular session, as of \d{1,2}:\d\d (AM|PM) ET\./)
    expect(out.present.items.map(i => i.label)).toEqual(['Price', 'Change', 'Session', 'Freshness'])
  })
  it('stale regular: says stale in the sentence that carries the price, never live', () => {
    const line = answerFromEnvelope(SC.stale_regular.envelope, ['NVDA']).text.split('\n')[0]
    expect(line).toMatch(/\$142\.10.*stale, not a real-time price/)
  })
  it('premarket live: names extended hours and thin trading', () => {
    expect(answerFromEnvelope(SC.live_premarket.envelope, ['NVDA']).text).toMatch(/in premarket trading.*live, extended hours \(thin trading\)/)
  })
  it('after-hours past the 15-minute window: the last extended print with its time, not real-time', () => {
    expect(answerFromEnvelope(SC.historical_afterhours.envelope, ['NVDA']).text)
      .toMatch(/^NVDA last traded \$142\.10 at 4:30 PM ET \(after hours, no trade in the last 15 minutes\).*Not a real-time price\./)
  })
  it('overnight with an after-hours print: closed, last TRADE with its time', () => {
    expect(answerFromEnvelope(SC.overnight_ah_print.envelope, ['NVDA']).text)
      .toMatch(/^Market closed \(overnight\): NVDA last trade \$142\.10 \(7:59 PM ET\).*Not a real-time price\./)
  })
  it('weekend and holiday: closed, last CLOSE with its date', () => {
    expect(answerFromEnvelope(SC.weekend_close.envelope, ['NVDA']).text).toMatch(/^Market closed \(weekend or holiday\): NVDA last close \$142\.10 \(Fri, Nov 13\)/)
    expect(answerFromEnvelope(SC.holiday_close.envelope, ['NVDA']).text).toMatch(/^Market closed \(weekend or holiday\): NVDA last close \$142\.10 \(Wed, Nov 25\)/)
  })
  it('early close (2026-11-27, 13:00): 13:30 is after hours, live extended', () => {
    expect(answerFromEnvelope(SC.early_close_afterhours_live.envelope, ['NVDA']).text).toMatch(/in after-hours trading.*live, extended hours/)
  })
  it('regular session, row priced from a close: says so, not real-time', () => {
    expect(answerFromEnvelope(SC.regular_from_close.envelope, ['NVDA']).text).toMatch(/^NVDA: no current trade in the regular session — showing the day's close, \$142\.10/)
  })
  it('partial quotes: one line per priced symbol, then names what is missing', () => {
    const t = answerFromEnvelope(SC.partial_quotes.envelope, ['NVDA', 'NOPE']).text
    expect(t).toMatch(/^NVDA \$142\.10/)
    expect(t).toContain('Partial: no price for NOPE.')
  })
  it('as-of uses the read\'s own fetched_at, never the browser clock', () => {
    const a = answerFromEnvelope(SC.weekend_close.envelope, ['NVDA'])
    vi.useFakeTimers(); vi.setSystemTime(new Date('2031-06-15T12:00:00Z'))
    expect(answerFromEnvelope(SC.weekend_close.envelope, ['NVDA'])).toEqual(a)
  })
  it('unavailable: states no number and says the price is not available', () => {
    const t = answerFromEnvelope(SC.unavailable.envelope, ['NVDA']).text
    expect(t).toMatch(/not available/)
    expect(t).not.toMatch(/\d/)
  })
  it('F-20 OPEN (strict pin): a refusal\'s NOTE is echoed into the answer, so a budget refusal states a number', () => {
    // §4.5: "the envelope, its notes … never" leave the module, and an unavailable/refused answer has "no number at
    // all". answerFromEnvelope builds the refusal sentence from env.notes[0]. Owner: agent-md. Fails when fixed.
    const env = SC.refused_budget.envelope
    const t = answerFromEnvelope(env, ['NVDA']).text
    expect(t).toContain(env.notes[0])
    expect(t).toMatch(/\d/)
  })
})

describe('MD-2 (2): session from the DATA, never the member\'s words', () => {
  it('"what\'s NVDA trading at premarket?" during the regular session is answered as the regular session', async () => {
    flags.data = true; flags.kinds = ['quote', 'quotes']
    const p01 = ALL.find(r => r.id === 'P01')
    const m = match(p01.text)
    expect(m).toEqual({ action: CAPABILITY, params: { symbols: ['NVDA'] } })
    nextEnvelope = SC.live_regular.envelope
    turnStart('send')
    let out
    try { out = await answerQuote(m.params) } finally { turnEnd() }
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatchObject({ kind: 'quote', params: { symbol: 'NVDA' }, opts: { purpose: 'answer' } })
    expect(typeof reads[0].opts.turnId).toBe('string')
    expect(out.text).toMatch(/regular session/)
    expect(out.text).not.toMatch(/premarket/i)
  })
})

describe('MD-2 (3): flags off = today\'s stock.profile, byte for byte', () => {
  const states = [['data off', false, ['quote', 'quotes']], ['data on, no data_kinds accessor answer', true, null],
    ['data on, quote not activated', true, ['bars.daily']], ['data on, quotes missing', true, ['quote']]]
  for (const [label, data, kinds] of states) {
    it(`${label}: not served, registers nothing, matches nothing`, () => {
      flags.data = data; flags.kinds = kinds
      expect(quoteServed()).toBe(false)
      expect(registerMarketDataCapabilities()).toBe(false)
      expect(getCapability(CAPABILITY)).toBeNull()
      for (const r of ALL) expect(match(r.text), r.id).toBeNull()
    })
  }
  it('answerQuote with flags off returns answerProfile\'s answer exactly, with the same requests, and never reads the gateway', async () => {
    const seq = []
    const stub = vi.fn(async (url) => { seq.push(String(url)); return new Response(JSON.stringify({ symbol: 'NVDA', name: 'NVIDIA', price: 142.1, change_pct: 0.87 }), { status: 200, headers: { 'content-type': 'application/json' } }) })
    globalThis.fetch = stub
    const want = await answerProfile({ symbol: 'NVDA' })
    const wantSeq = [...seq]; seq.length = 0
    const got = await answerQuote({ symbols: ['NVDA'] })
    expect(JSON.stringify(got)).toBe(JSON.stringify(want))
    expect(seq).toEqual(wantSeq)
    expect(wantSeq.length, 'non-vacuity: the profile path made requests').toBeGreaterThan(0)
    expect(reads).toHaveLength(0)
  })
})

describe('MD-2 (4): the fast path (MD-1-phrasings.md, row by row)', () => {
  it('with quote served: every fast quote row matches exactly; every model/clarify row is null; match does no I/O', () => {
    flags.data = true; flags.kinds = ['quote', 'quotes']
    const spy = vi.fn(); globalThis.fetch = spy
    const quoteRows = ALL.filter(r => r.handling === 'fast' && /^quote\./.test(r.action))
    expect(quoteRows.length, 'non-vacuity').toBeGreaterThanOrEqual(15)
    for (const r of quoteRows) expect(match(r.text), `${r.id} ${r.text}`).toEqual({ action: CAPABILITY, params: { symbols: r.symbols } })
    for (const r of ALL.filter(r => r.handling !== 'fast')) expect(match(r.text), `${r.id} ${r.text}`).toBeNull()
    for (const r of ALL.filter(r => /^bars\./.test(r.action || ''))) expect(match(r.text), `${r.id}: a bars row is not stock.quote's`).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(reads).toHaveLength(0)
  })
  it('NOT WIRED YET (strict pin): nothing calls match() or registers stock.quote, so zero model turns cannot happen in the panel', () => {
    // agent-lead wires match() into fastPath.js behind the data flag. Until then every fast row costs a planner turn.
    // Fails when it is wired: then measure the 15 fast quote rows through panelHarness (0 turns each).
    const src = (f) => fs.readFileSync(path.join(REPO, 'app/src/agent', f), 'utf8')
    expect(src('fastPath.js')).not.toMatch(/marketDataQuote/)
    expect(src('builtins.js')).not.toMatch(/registerMarketDataCapabilities/)
  })
})
