// W2-B2 release gate (#734): NO REGRESSION for stock.dailyBars arg shapes that work today. The oracle is the capability
// exactly as at 27e228693e (capabilities/__fixtures__/marketDataBars.oracle-27e2286.js, its schema below). Every arg
// shape the old schema accepted (the old fast path's own outputs over every NL / MD-1 / scores corpus text, the scores
// fixtures' expected args, and a grid of model-style shapes) must still validate, and must answer identically, with the
// same gateway reads. The new `from` is optional (absentAsNull): a shape without it is `from: null`.
// Also: "range over the last N sessions" is the only N-session phrase whose meaning changed; a plain "change over the
// last N sessions" is still the old N-session change.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { registerCapability, shapeError, getCapability, manifestFor } from './capabilities'
import { registerMarketDataCapabilities, _resetForTest } from './capabilities/marketDataQuote'
import { match, answerDailyBars, CAPABILITY } from './capabilities/marketDataBars'
import * as oracle from './capabilities/__fixtures__/marketDataBars.oracle-27e2286.js'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'

let TURN = 't-compat'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
registerBuiltins()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ORACLE_SRC = fs.readFileSync(path.resolve(HERE, 'capabilities/__fixtures__/marketDataBars.oracle-27e2286.js'), 'utf8')
// 27e228693e's stock.dailyBars args, verbatim (pinned against the oracle source below)
const OLD_MEASURES = ['lastClose', 'change', 'range52w', 'session', 'range']
const OLD_ARGS = {
  type: 'object',
  properties: { symbol: { type: 'string' }, measure: { type: 'string', enum: OLD_MEASURES }, sessions: { type: ['integer', 'null'] }, date: { type: ['string', 'null'] } },
  required: ['symbol', 'measure', 'sessions', 'date'],
  additionalProperties: false,
}
const ORACLE = 'oracle.dailyBars'

// ── the corpus texts: every "text" in the NL-intent and program-scores fixtures, plus MD-1 phrasings rows ─────────────
function textsIn(node, acc) {
  if (Array.isArray(node)) node.forEach(n => textsIn(n, acc))
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === 'text' && typeof v === 'string') acc.add(v); else textsIn(v, acc) }
  return acc
}
const jsonFiles = (dir) => fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
const SCORES = jsonFiles(path.resolve(HERE, '__fixtures__/program/scores'))
const TEXTS = new Set()
for (const j of [...jsonFiles(path.resolve(HERE, '__fixtures__/nlIntent')), ...SCORES]) textsIn(j, TEXTS)
const MD1 = fs.readFileSync(path.resolve(HERE, '../../../docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
for (const l of MD1.split('\n').filter(l => /^\| P\d\d \|/.test(l))) TEXTS.add(l.split('|')[2].trim())
const EXTRA = ['TSLA change over the last 10 sessions', 'TSLA change over the past 10 days', 'NVDA 10-day change', 'tsla change last 10 sessions',
  'AAPL range last week', 'AAPL 52 week high', 'how did AAPL close yesterday', 'NVDA close last Friday']
EXTRA.forEach(t => TEXTS.add(t))

// the scores fixtures' expected stock.dailyBars args (as the old model-facing shape: all four keys)
function expectedShapes(node, acc) {
  if (Array.isArray(node)) node.forEach(n => expectedShapes(n, acc))
  else if (node && typeof node === 'object') {
    if (node.action === CAPABILITY && node.symbol) acc.push({ symbol: node.symbol, measure: node.measure, sessions: node.sessions ?? null, date: node.date ?? null })
    Object.values(node).forEach(v => expectedShapes(v, acc))
  }
  return acc
}

function grid() {
  const out = []
  for (const symbol of ['NVDA', 'aapl', '$TSLA', 'BRK.B'])
    for (const measure of OLD_MEASURES)
      for (const sessions of [null, 1, 5, 10, 250, 300])
        for (const date of [null, '2026-10-15', 'last friday', 'last week', 'last month', 'yesterday', 'oct 15', 'tomorrow', 'the earnings day']) out.push({ symbol, measure, sessions, date })
  return out
}
// shapes the old schema REFUSED (they must keep failing for the same keys; never newly accepted except `from`)
const REFUSED = [{}, { symbol: 'NVDA' }, { symbol: 'NVDA', measure: 'change', sessions: 5 }, { symbol: 'NVDA', measure: 'bogus', sessions: null, date: null },
  { symbol: 'NVDA', measure: 'change', sessions: '5', date: null }, { symbol: 'NVDA', measure: 'change', sessions: 5, date: null, extra: 1 },
  { symbol: 7, measure: 'lastClose', sessions: null, date: null }]

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
function sessionsEnding(n, end) {
  const out = []
  const d = new Date(`${end}T12:00:00Z`)
  while (out.length < n) { if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1) }
  return out
}
function wire() {
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (u.endsWith('/api/agent/config')) return json({ stream: false, nl1: false, data: true, scan: false, data_kinds: ['instrument.resolve', 'bars.daily'] })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      if (b.kind === 'instrument.resolve') return json(resolveEnvelope(b.params))
      const bars = sessionsEnding(b.params.bars || 5, b.params.to || '2026-10-30').map((date, i) => ({ date, open: 99 + i, high: 101 + i + (i % 3), low: 98 + i - (i % 2), close: 100 + i + (i % 4), volume: 1000 + i }))
      const through = bars[bars.length - 1].date
      return json({ contract: 'MD-1.0', kind: 'bars.daily', params_echo: b.params, status: 'ok', freshness: 'historical', as_of: `${through}T20:00:00Z`,
        fetched_at: '2026-11-02T16:00:00Z', delay_s: null, stale: false, source: 'uct-bars', coverage: null, provider_calls: 0,
        notes: ["completed sessions only — the current session's developing bar is never included"], data: { symbol: b.params.symbol, bars, through, latest_completed_session: through } })
    }
    return json({}, 404)
  })
}
const posts = () => globalThis.fetch.mock.calls.filter(c => c[0] === '/api/agent/data').map(c => JSON.parse(c[1].body))

let CORPUS = []
beforeAll(async () => {
  _resetAgentConfig(); _resetForTest(); wire()
  await loadAgentConfig()
  registerMarketDataCapabilities()
  registerCapability({ name: ORACLE, summary: 'the 27e228693e schema (test oracle)', target: 'market', query: true, answer: () => '', args: OLD_ARGS })
  const fromMatch = [...TEXTS].map(t => oracle.match(t)?.params).filter(Boolean)
  CORPUS = [...fromMatch, ...expectedShapes(SCORES, []), ...grid()]
})
beforeEach(() => { TURN = 't-compat' })

describe('stock.dailyBars: every arg shape accepted at 27e228693e still validates (from is optional)', () => {
  it('the oracle schema is 27e228693e\'s, verbatim, and the current schema only ADDS', () => {
    expect(ORACLE_SRC).toContain("const MEASURES = ['lastClose', 'change', 'range52w', 'session', 'range']")
    expect(ORACLE_SRC).toContain("required: ['symbol', 'measure', 'sessions', 'date'],")
    const now = getCapability(CAPABILITY)
    expect(now.absentAsNull).toEqual(['from', 'timeframe', 'symbols'])      // Phase 2 history added timeframe + symbols
    for (const [k, p] of Object.entries(OLD_ARGS.properties)) expect(now.args.properties[k].type).toEqual(p.type)
    expect(OLD_MEASURES.every(m => now.args.properties.measure.enum.includes(m))).toBe(true)
    // the manifest still sends a fully required object (the server's strict grammar drops anything else)
    const entry = manifestFor({ surface: 'charts' }).find(c => c.name === CAPABILITY)
    expect([...entry.args.required].sort()).toEqual(Object.keys(entry.args.properties).sort())
    expect(entry).not.toHaveProperty('absentAsNull')
  })

  it('the corpus is real: fast-path shapes, scores expectations and the model-style grid', () => {
    expect(CORPUS.length).toBeGreaterThan(1000)
    expect(CORPUS.filter(s => 'from' in s).length).toBe(0)          // none of the old shapes carries `from`
  })

  it('no new validation failures: old-valid ⇒ new-valid; old-refused shapes are still refused', () => {
    const failures = []
    let oldValid = 0
    for (const s of CORPUS) {
      if (shapeError(ORACLE, s) !== null) continue
      oldValid++
      const e = shapeError(CAPABILITY, s)
      if (e !== null) failures.push([s, e])
      expect(shapeError(CAPABILITY, { ...s, from: null })).toBeNull()
    }
    expect(oldValid).toBeGreaterThan(1000)
    expect(failures).toEqual([])
    for (const s of REFUSED) {
      expect(shapeError(ORACLE, s), JSON.stringify(s)).not.toBeNull()
      expect(shapeError(CAPABILITY, s), JSON.stringify(s)).not.toBeNull()
    }
    expect(shapeError(CAPABILITY, { symbol: 'NVDA', measure: 'range', sessions: null, date: 'oct 15', from: 7 })).not.toBeNull()
  })

  it('every old-valid shape answers identically to the oracle, with the same gateway reads', async () => {
    const seen = new Set()
    let compared = 0
    for (const s of CORPUS) {
      const key = JSON.stringify(s)
      if (seen.has(key) || shapeError(ORACLE, s) !== null) continue
      seen.add(key)
      const p0 = posts().length
      const was = await oracle.answerDailyBars(s)
      const p1 = posts().length
      const now = await answerDailyBars(s)
      const p2 = posts().length
      expect(now, key).toEqual(was)
      expect(posts().slice(p1, p2), key).toEqual(posts().slice(p0, p1))
      compared++
    }
    expect(compared).toBeGreaterThan(1000)
  }, 120000)
})

describe('stock.dailyBars fast path vs the oracle', () => {
  it('every corpus text claims what it claimed before; only the W2 phrases (range / pullbacks / off its high) differ', () => {
    const changed = []
    for (const t of TEXTS) {
      const was = oracle.match(t)
      const now = match(t)
      if (JSON.stringify(now) === JSON.stringify(was ? { ...was, params: { ...was.params, from: null } } : null)) continue
      changed.push(t)
      expect(now?.params?.measure, t).toMatch(/^(range|offHigh|pullbacks)$/)
      if (now.params.measure === 'range') expect(t).toMatch(/\brange\b/i)
    }
    // the corpus holds no W2-only phrasing except what the W2 tests own; the list is stated, never hidden
    expect(changed.every(t => /\b(range|pullbacks?|high)\b/i.test(t))).toBe(true)
  })

  it('"change over the last N sessions" is still the old N-session change; only "range over …" means a range', () => {
    // the fast-path N-session change phrasings: the same claim (an N-session change) as before
    for (const t of ['TSLA last 10 sessions', 'tsla change last 10 sessions', 'TSLA change last 10 days', 'TSLA 10 session change', 'NVDA 10-day change']) {
      const was = oracle.match(t)
      expect(was?.params?.measure, t).toBe('change')
      expect(match(t), t).toEqual({ ...was, params: { ...was.params, from: null } })
      expect(fastParse(t, {})?.ops?.map(o => [o.action, o.args.measure, o.args.sessions]), t).toEqual([[CAPABILITY, 'change', was.params.sessions]])
    }
    // "… over the last N sessions" without "range": unclaimed before (the model's), and still unclaimed — never a range
    for (const t of ['TSLA change over the last 10 sessions', 'TSLA % change over the last 10 sessions', 'TSLA over the last 10 sessions',
      'TSLA change over the past 10 days', 'how did TSLA do over the last 10 sessions', 'TSLA move over the last 10 sessions']) {
      expect(oracle.match(t), t).toBeNull()
      expect(match(t), t).toBeNull()
      expect(fastParse(t, {})?.ops?.some(o => o.action === CAPABILITY && o.args.measure === 'range') ?? false, t).toBe(false)
    }
    // only the range words take the new meaning
    expect(match('TSLA range over the last 10 sessions')?.params).toEqual({ symbol: 'TSLA', measure: 'range', sessions: 10, date: null, from: null })
  })
})
