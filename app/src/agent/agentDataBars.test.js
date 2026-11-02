// stock.dailyBars (Sprint 2 C, owner agent-md): the bars rows of docs/agent/program/contracts/MD-1-phrasings.md (read
// from the doc), completed-session answers for the three measures, honest stale / short windows, fixed no-bars words,
// one `bars.daily` read sized per measure, the real fast path with every builtin registered, and dark by default.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { allCapabilityNames, getCapability } from './capabilities'
import { registerMarketDataCapabilities, _resetForTest, CAPABILITY as QUOTE } from './capabilities/marketDataQuote'
import { match, answerFromBars, answerDailyBars, barsFor, CAPABILITY, SESSIONS_52W } from './capabilities/marketDataBars'

let TURN = 't-bars'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
registerBuiltins()

const here = dirname(fileURLToPath(import.meta.url))
const DOC = readFileSync(resolve(here, '../../../docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
const ROWS = DOC.split('\n').filter(l => /^\| P\d\d \|/.test(l)).map(l => l.split('|').map(s => s.trim()))
  .map(c => ({ id: c[1], phrase: c[2], handling: c[3], ap: c[4] }))
const BAR_ROWS = ROWS.filter(r => /`bars\./.test(r.ap))
const MEASURE = { 'bars.lastClose': 'lastClose', 'bars.change': 'change', 'bars.range52w': 'range52w' }

// ── fixtures: completed trading days (weekdays) ending on a date ────────────────────────────────────────────────────
function sessions(n, end = '2026-10-30') {
  const out = []
  const d = new Date(`${end}T12:00:00Z`)
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const bar = (date, close, o = {}) => ({ date, open: close - 1, high: close + 1, low: close - 2, close, volume: 1000, ...o })
function barsEnv(bars, o = {}) {
  const through = bars.length ? bars[bars.length - 1].date : null
  return { contract: 'MD-1.0', kind: 'bars.daily', params_echo: { symbol: 'NVDA' }, status: 'ok', freshness: 'historical',
    as_of: through ? `${through}T20:00:00Z` : null, fetched_at: '2026-11-02T16:00:00Z', delay_s: null, stale: false,
    source: 'uct-bars', coverage: null, provider_calls: 0,
    notes: ["completed sessions only — the current session's developing bar is never included"],
    data: { symbol: 'NVDA', bars, through, latest_completed_session: through }, ...o }
}
const says = (a) => (typeof a === 'string' ? a : a.text)
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

describe('MD-1 phrasings: the bars rows', () => {
  it('the doc has bars rows of every measure, plus the two bars-shaped sentences that go to the model', () => {
    expect(new Set(BAR_ROWS.map(r => r.ap.match(/`(bars\.[a-zA-Z0-9]+)`/)[1]))).toEqual(new Set(Object.keys(MEASURE)))
    expect(ROWS.find(r => r.id === 'P21').handling).toBe('model')
    expect(ROWS.find(r => r.id === 'P26').handling).toBe('model')
  })
})

describe('stock.dailyBars answers (completed sessions only)', () => {
  it('lastClose: the close, its date, and the change vs the session before', () => {
    const t = says(answerFromBars(barsEnv([bar('2026-10-29', 140), bar('2026-10-30', 142.1)]), { symbol: 'aapl', measure: 'lastClose' }))
    expect(t.split('\n')).toEqual([
      'AAPL closed at $142.10 on Fri, Oct 30, its last completed session: +$2.10 (+1.50%) vs the previous close of $140.00 on Thu, Oct 29.',
      "From UCT's daily bars: completed sessions only, today's session is not included.",
    ])
  })

  it('lastClose, store behind: says it is not the latest close, naming both dates', () => {
    const e = barsEnv([bar('2026-10-27', 140), bar('2026-10-28', 141)], { stale: true })
    e.data.latest_completed_session = '2026-10-30'
    const t = says(answerFromBars(e, { symbol: 'NVDA', measure: 'lastClose' }))
    expect(t).toContain("Note: UCT's bars for NVDA end Wed, Oct 28, but the most recent completed session was Fri, Oct 30, so this is not the latest close.")
  })

  it('change: close to close over exactly n sessions, with both dates', () => {
    const ds = sessions(6)
    const t = says(answerFromBars(barsEnv(ds.map((d, i) => bar(d, 100 + i * 2))), { symbol: 'NVDA', measure: 'change', sessions: 5 }))
    expect(t).toContain('NVDA over the last 5 completed sessions: +10.00% (+$10.00), from a close of $100.00 on Fri, Oct 23 to $110.00 on Fri, Oct 30.')
  })

  it('change: fewer sessions held than asked — the covered window is stated, nothing extrapolated', () => {
    const ds = sessions(3)
    const t = says(answerFromBars(barsEnv(ds.map((d, i) => bar(d, 100 + i)), { status: 'partial' }), { symbol: 'NVDA', measure: 'change', sessions: 10 }))
    expect(t).toContain('NVDA over the last 2 completed sessions held (you asked for 10): +2.00% (+$2.00)')
  })

  it('change with a single bar: no change is given', () => {
    const t = says(answerFromBars(barsEnv([bar('2026-10-30', 100)], { status: 'partial' }), { symbol: 'NVDA', measure: 'change', sessions: 5 }))
    expect(t).toContain('Only one completed session is held for NVDA (Fri, Oct 30, close $100.00), so no change over 5 sessions can be given.')
  })

  it('range52w, full year: the highest high and lowest low, each with its date (and the year when it differs)', () => {
    const ds = sessions(SESSIONS_52W)
    const bars = ds.map((d, i) => bar(d, 100 + (i % 7)))
    bars[10] = bar(ds[10], 120, { high: 160.5 })      // the highest HIGH…
    bars[30] = bar(ds[30], 150, { high: 151 })        // …is not on the highest CLOSE (150): the range reads highs/lows
    bars[200] = bar(ds[200], 95, { low: 80.25 })      // the lowest LOW…
    bars[220] = bar(ds[220], 82, { low: 81 })         // …is not on the lowest CLOSE (82)
    const t = says(answerFromBars(barsEnv(bars), { symbol: 'NVDA', measure: 'range52w' }))
    expect(t).toMatch(/^NVDA 52-week range \(the last 252 completed sessions, \w{3}, \w{3} \d+, 2025 to Fri, Oct 30\): high \$160\.50 on \w{3}, \w{3} \d+, 2025, low \$80\.25 on \w{3}, \w{3} \d+\. Last close/)
  })

  it('range52w, short history: says it is less than a full 52 weeks', () => {
    const ds = sessions(40)
    const t = says(answerFromBars(barsEnv(ds.map(d => bar(d, 50)), { status: 'partial' }), { symbol: 'NEWCO', measure: 'range52w' }))
    expect(t).toMatch(/^NEWCO range over the 40 completed sessions held \(.+\), less than a full 52 weeks: high \$51\.00/)
  })

  it.each([
    ['refused', "I couldn't answer that for NVDA: that request wasn't allowed for this question, so its daily bars are not available. No price is stated."],
    ['unavailable', "I couldn't answer that for NVDA: its completed daily bars are not available from UCT's market data. No price is stated."],
  ])('%s: fixed words, no number, never the note', (status, want) => {
    const e = { ...barsEnv([]), status, data: null, notes: ['this turn already made 8 data reads'] }
    expect(says(answerFromBars(e, { symbol: 'NVDA', measure: 'lastClose' }))).toBe(want)
  })

  it('never live/now wording, and only { text, present } leave — no envelope keys', () => {
    const cases = [
      [barsEnv([bar('2026-10-29', 1), bar('2026-10-30', 2)]), { measure: 'lastClose' }],
      [barsEnv(sessions(6).map(d => bar(d, 3))), { measure: 'change', sessions: 5 }],
      [barsEnv(sessions(252).map(d => bar(d, 3))), { measure: 'range52w' }],
    ]
    for (const [e, a] of cases) {
      const out = answerFromBars(e, { symbol: 'NVDA', ...a })
      expect(Object.keys(out).every(k => ['text', 'present'].includes(k))).toBe(true)
      expect(out.text).not.toMatch(/\b(live|now|right now|real-time)\b/i)
      const s = JSON.stringify(out)
      for (const leak of ['provider_calls', 'params_echo', 'MD-1.0', 'fetched_at', 'latest_completed_session', 'uct-bars']) expect(s).not.toContain(leak)
    }
  })

  it('the read is sized per measure', () => {
    expect(barsFor('lastClose')).toBe(2)
    expect(barsFor('change', 5)).toBe(6)
    expect(barsFor('change', 10)).toBe(11)
    expect(barsFor('range52w')).toBe(252)
    expect(barsFor('change', 9999)).toBe(251)          // capped below the kind's 500
  })
})

function wire({ data, kinds }) {
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (u.endsWith('/api/agent/config')) return json({ stream: false, nl1: false, data, scan: false, ...(kinds ? { data_kinds: kinds } : {}) })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      return json(barsEnv(sessions(b.params.bars).map((d, i) => bar(d, 100 + i))))
    }
    return json({}, 404)
  })
}
const posts = () => globalThis.fetch.mock.calls.filter(c => c[0] === '/api/agent/data').map(c => JSON.parse(c[1].body))

describe('stock.dailyBars on the real fast path, served and dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); vi.restoreAllMocks(); TURN = 't-bars' })

  it.each(BAR_ROWS)('served: $id "$phrase" → $handling', async (r) => {
    wire({ data: true, kinds: ['bars.daily', 'quote', 'quotes'] })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const m = match(r.phrase)
    const f = fastParse(r.phrase, {})
    if (r.handling !== 'fast') { expect(m).toBeNull(); expect(f?.ops?.some(o => o.action === CAPABILITY) ?? false).toBe(false); return }
    const intent = r.ap.match(/`(bars\.[a-zA-Z0-9]+)`/)[1]
    const sym = (r.ap.split('→')[1].match(/\b[A-Z][A-Z0-9]*\b/g) || [])[0]
    const n = (r.ap.match(/\bn: (\d+)/) || [])[1]
    expect(m).toEqual({ action: CAPABILITY, params: { symbol: sym, measure: MEASURE[intent], sessions: n ? Number(n) : null } })
    expect(f?.ops?.map(o => o.action)).toEqual([CAPABILITY])                 // the sole claimant among every builtin
  })

  it.each(['P21', 'P26'])('served: %s (a bars-shaped sentence for the model) gets no market-data claim', async (id) => {
    wire({ data: true, kinds: ['bars.daily', 'quote', 'quotes'] })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const f = fastParse(ROWS.find(r => r.id === id).phrase, {})
    expect(f?.ops?.some(o => o.action === CAPABILITY || o.action === QUOTE) ?? false).toBe(false)
  })

  it('served: one bars.daily read per question, sized per measure, zero model turns, never /api/live-prices', async () => {
    wire({ data: true, kinds: ['bars.daily'] })
    await loadAgentConfig()
    expect(registerMarketDataCapabilities()).toBe(false)                     // its return value is about stock.quote (#624)…
    expect(allCapabilityNames()).toContain(CAPABILITY)                       // …and stock.dailyBars is registered
    expect(allCapabilityNames()).not.toContain(QUOTE)                       // quote not activated: not registered
    for (const s of ['how did AAPL close yesterday', "NVDA's 5-day change", 'NVDA 52-week high']) {
      const f = fastParse(s, {})
      const out = await getCapability(CAPABILITY).answer(null, f.ops[0].args)
      expect(says(out)).toMatch(/completed sessions only/)
    }
    expect(posts().map(p => [p.kind, p.params.bars, p.purpose, p.turn_id])).toEqual([
      ['bars.daily', 2, 'answer', 't-bars'], ['bars.daily', 6, 'answer', 't-bars'], ['bars.daily', 252, 'answer', 't-bars']])
    const urls = globalThis.fetch.mock.calls.map(c => String(c[0]))
    expect(urls.filter(u => u !== '/api/agent/config').every(u => u === '/api/agent/data')).toBe(true)
  })

  it.each([[false, ['bars.daily']], [true, null], [true, []], [true, ['quote', 'quotes']]])('dark (data %s, kinds %j): no claim, nothing registered, no read', async (data, kinds) => {
    wire({ data, kinds })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(match('how did AAPL close yesterday')).toBeNull()
    expect(fastParse('how did AAPL close yesterday', {})?.ops?.some(o => o.action === CAPABILITY) ?? false).toBe(false)
    expect(says(await answerDailyBars({ symbol: 'AAPL', measure: 'lastClose', sessions: null }))).toBe("UCT's daily bars aren't available to the Agent here.")
    expect(posts()).toEqual([])
  })

  it('no turn id: no read', async () => {
    wire({ data: true, kinds: ['bars.daily'] })
    await loadAgentConfig()
    TURN = null
    expect(await answerDailyBars({ symbol: 'AAPL', measure: 'lastClose', sessions: null })).toMatch(/needs the Agent's turn/)
    expect(posts()).toEqual([])
  })
})
