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
import { match, answerFromBars, answerDailyBars, barsFor, windowFor, CAPABILITY, SESSIONS_52W } from './capabilities/marketDataBars'
import { resolveEnvelope } from './marketdata/__fixtures__/fakeResolve'

let TURN = 't-bars'
vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => TURN }))
registerBuiltins()

const here = dirname(fileURLToPath(import.meta.url))
const DOC = readFileSync(resolve(here, '../../../docs/agent/program/contracts/MD-1-phrasings.md'), 'utf8')
// MD-1-phrasings §3 (MD-1 §4.7 format): | # | phrasing | intent | candidates | outcome |
const ROWS = DOC.split('\n').filter(l => /^\| P\d\d \|/.test(l)).map(l => l.split('|').map(s => s.trim()))
  .map(c => ({ id: c[1], phrase: c[2], intent: c[3].split(' ')[0], n: Number((c[3].match(/n=(\d+)/) || [])[1]) || null,
    cand: c[4] === '—' ? null : [...c[4].matchAll(/`([^`]+)`/g)][0][1].split(' ')[0], outcome: c[5] }))
const BAR_ROWS = ROWS.filter(r => r.intent.startsWith('bars.'))
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
    expect(new Set(BAR_ROWS.map(r => r.intent))).toEqual(new Set(Object.keys(MEASURE)))
    for (const id of ['P18', 'P21', 'P26', 'P39']) expect(ROWS.find(r => r.id === id).outcome).toBe('model')
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
    expect(barsFor('session')).toBe(1)
    expect(barsFor('range', 5)).toBe(5)
    expect(barsFor('range', null, { month: true })).toBe(23)
  })
})

// ── W1-B (BOARD B-02): point-in-time phrasing — "close last Friday", "high on 2026-10-15", "range last week" ──
describe('stock.dailyBars point in time (W1-B): one read ending at the asked day, named honestly', () => {
  const d = (to, word = to, extra = {}) => ({ to, word, ...extra })
  it('lastClose on the day itself: the close "on <day>" (no "last completed session" claim); on a weekend: the last completed session on or before it', () => {
    const e = barsEnv([bar('2026-10-29', 140), bar('2026-10-30', 142.1)])
    expect(says(answerFromBars(e, { symbol: 'NVDA', measure: 'lastClose', date: d('2026-10-30') })).split('\n')[0])
      .toBe('NVDA closed at $142.10 on Fri, Oct 30: +$2.10 (+1.50%) vs the previous close of $140.00 on Thu, Oct 29.')
    expect(says(answerFromBars(e, { symbol: 'NVDA', measure: 'lastClose', date: d('2026-10-31', 'saturday') })).split('\n')[0])
      .toBe('NVDA closed at $142.10 on Fri, Oct 30, the last completed session on or before saturday (Sat, Oct 31): +$2.10 (+1.50%) vs the previous close of $140.00 on Thu, Oct 29.')
    expect(says(answerFromBars(e, { symbol: 'NVDA', measure: 'lastClose', date: d('2026-10-30', 'last friday') })).split('\n')[0]).toMatch(/^NVDA closed at \$142\.10 on Fri, Oct 30: /)
  })
  it('session: one day\'s open / high / low / close, its range and volume — and the completed-sessions line', () => {
    const e = barsEnv([bar('2026-10-15', 180, { open: 176.5, high: 183.25, low: 175, volume: 41234567 })])
    const t = says(answerFromBars(e, { symbol: 'aapl', measure: 'session', date: d('2026-10-15'), name: 'Apple Inc.' }))
    expect(t.split('\n')).toEqual([
      'AAPL (Apple Inc.) on Thu, Oct 15: open $176.50, high $183.25, low $175.00, close $180.00 (a $8.25 range); volume 41,234,567.',
      "From UCT's daily bars: completed sessions only, today's session is not included.",
    ])
    const out = answerFromBars(e, { symbol: 'AAPL', measure: 'session', date: d('2026-10-15') })
    expect(out.present.items.map(i => i.label)).toEqual(['Open', 'High', 'Low', 'Close', 'Volume'])
  })
  it('range over a week: the window named by the member\'s word, its first and last session, the high and low with their dates', () => {
    const ds = sessions(5, '2026-10-30')                          // Mon Oct 26 … Fri Oct 30
    const bars = ds.map((x, i) => bar(x, 100 + i))
    bars[1] = bar(ds[1], 101, { high: 109.5 })
    bars[3] = bar(ds[3], 103, { low: 97.25 })
    const t = says(answerFromBars(barsEnv(bars), { symbol: 'TSLA', measure: 'range', sessions: 5, date: d('2026-10-30', 'last week', { sessions: 5 }) }))
    expect(t.split('\n')[0]).toBe('TSLA over the 5 completed sessions of last week ending Fri, Oct 30, from Mon, Oct 26: high $109.50 on Tue, Oct 27, low $97.25 on Thu, Oct 29. Close $104.00 on Fri, Oct 30.')
    // fewer held than the window: said, nothing extrapolated
    const short = says(answerFromBars(barsEnv(bars.slice(2), { status: 'partial' }), { symbol: 'TSLA', measure: 'range', sessions: 5, date: d('2026-10-30', 'last week', { sessions: 5 }) }))
    expect(short).toMatch(/^TSLA over the 3 completed sessions held \(you asked for 5\) of last week ending Fri, Oct 30/)
    expect(short).toContain('Only 3 completed sessions are held')
  })
  it('range over a calendar month: the read ends at the month\'s last day and only that month\'s bars count', () => {
    const ds = sessions(23, '2026-10-31')                         // reaches back into September
    const bars = ds.map((x, i) => bar(x, 50 + (i % 5)))
    const sep = bars.filter(b => b.date < '2026-10-01')
    expect(sep.length).toBeGreaterThan(0)
    sep[0].high = 999                                              // a September high must NOT win
    const t = says(answerFromBars(barsEnv(bars), { symbol: 'NVDA', measure: 'range', date: d('2026-10-31', 'last month', { month: '2026-10' }) }))
    const oct = bars.filter(b => b.date >= '2026-10-01')
    expect(t.split('\n')[0]).toMatch(new RegExp(`^NVDA in October 2026 \\(${oct.length} completed sessions, Thu, Oct 1 to Fri, Oct 30\\): high \\$55\\.00 on `))
    expect(t).not.toContain('$999')
    expect(says(answerFromBars(barsEnv(sep), { symbol: 'NVDA', measure: 'range', date: d('2026-10-31', 'last month', { month: '2026-10' }) }))).toBe('No completed sessions are held for NVDA in October 2026. No price is stated.')
  })
  it('change / range52w as of a date say so; a store that ends before the asked session says which session it has', () => {
    const ds = sessions(6, '2026-10-15')
    const t = says(answerFromBars(barsEnv(ds.map((x, i) => bar(x, 100 + i * 2))), { symbol: 'NVDA', measure: 'change', sessions: 5, date: d('2026-10-15') }))
    expect(t).toContain('NVDA over the 5 completed sessions ending Thu, Oct 15: +10.00% (+$10.00), from a close of $100.00 on Thu, Oct 8 to $110.00 on Thu, Oct 15.')
    const y = says(answerFromBars(barsEnv(sessions(252, '2026-10-15').map(x => bar(x, 3))), { symbol: 'NVDA', measure: 'range52w', date: d('2026-10-17', 'oct 17') }))
    expect(y).toMatch(/^NVDA 52-week range as of Thu, Oct 15 \(the last completed session on or before oct 17 \(Sat, Oct 17\)\) \(the 252 completed sessions, /)
    const e = barsEnv([bar('2026-10-13', 140), bar('2026-10-14', 141)], { stale: true })
    e.data.latest_completed_session = '2026-10-15'
    const c = says(answerFromBars(e, { symbol: 'NVDA', measure: 'lastClose', date: d('2026-10-15') }))
    expect(c).toContain("Note: UCT's bars for NVDA end Wed, Oct 14, but the last completed session on or before Thu, Oct 15 was Thu, Oct 15, so this is an earlier session than asked.")
  })
  it('the window from the member\'s words: an unreadable or future date is refused in words, never guessed; "last week" brings its own session count', () => {
    expect(windowFor('lastClose', null, 'the earnings day').why).toMatch(/couldn't read “the earnings day” as a date/)
    expect(windowFor('lastClose', null, '2999-01-05').why).toMatch(/hasn't happened yet — UCT's daily bars cover completed sessions only/)
    const w = windowFor('range', null, 'last week')
    expect(w.sessions).toBe(5)
    expect(w.date).toMatchObject({ sessions: 5, word: 'last week' })
    expect(windowFor('range', 10, 'last week').sessions).toBe(10)          // the member's own count wins
    expect(windowFor('range', null, '2026-10-15')).toMatchObject({ date: { to: '2026-10-15' }, sessions: null })
    expect(windowFor('lastClose', null, null)).toEqual({ date: null, sessions: null })
  })
  it('never live/now wording on the new measures; only { text, present } leave', () => {
    for (const [e, a] of [
      [barsEnv([bar('2026-10-15', 1, { open: 1, high: 2, low: 0.5, volume: 10 })]), { measure: 'session', date: d('2026-10-15') }],
      [barsEnv(sessions(5).map(x => bar(x, 3))), { measure: 'range', sessions: 5, date: d('2026-10-30', 'last week', { sessions: 5 }) }],
    ]) {
      const out = answerFromBars(e, { symbol: 'NVDA', ...a })
      expect(Object.keys(out).every(k => ['text', 'present'].includes(k))).toBe(true)
      expect(out.text).not.toMatch(/\b(live|now|right now|real-time)\b/i)
      expect(out.text).toContain('completed sessions only')
    }
  })
})

function wire({ data, kinds }) {
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (u.endsWith('/api/agent/config')) return json({ stream: false, nl1: false, data, scan: false, ...(kinds ? { data_kinds: kinds } : {}) })
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body)
      if (b.kind === 'instrument.resolve') return json(resolveEnvelope(b.params))
      // the adapter's own `to`: the window ends at the newest completed session on or before it
      return json(barsEnv(sessions(b.params.bars, b.params.to || '2026-10-30').map((d, i) => bar(d, 100 + i))))
    }
    return json({}, 404)
  })
}
const posts = () => globalThis.fetch.mock.calls.filter(c => c[0] === '/api/agent/data').map(c => JSON.parse(c[1].body))

describe('stock.dailyBars on the real fast path, served and dark', () => {
  beforeEach(() => { _resetAgentConfig(); _resetForTest(); vi.restoreAllMocks(); TURN = 't-bars' })

  it.each(BAR_ROWS)('served: $id "$phrase" is claimed with its word as typed', async (r) => {
    wire({ data: true, kinds: ['instrument.resolve', 'bars.daily', 'quote', 'quotes'] })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const m = match(r.phrase)
    const f = fastParse(r.phrase, {})
    const text = r.cand.slice(0, r.cand.lastIndexOf(':'))
    expect(m).toEqual({ action: CAPABILITY, params: { symbol: text, measure: MEASURE[r.intent], sessions: r.n, date: null, from: null } })   // W2-B2: `from`
    expect(f?.ops?.map(o => o.action)).toEqual([CAPABILITY])                 // the sole claimant among every builtin
  })

  it.each(['P21', 'P26'])('served: %s (a bars-shaped sentence for the model) gets no market-data claim', async (id) => {
    wire({ data: true, kinds: ['instrument.resolve', 'bars.daily', 'quote', 'quotes'] })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const f = fastParse(ROWS.find(r => r.id === id).phrase, {})
    expect(f?.ops?.some(o => o.action === CAPABILITY || o.action === QUOTE) ?? false).toBe(false)
  })

  it('served: one bars.daily read per question, sized per measure, zero model turns, never /api/live-prices', async () => {
    wire({ data: true, kinds: ['instrument.resolve', 'bars.daily'] })
    await loadAgentConfig()
    expect(registerMarketDataCapabilities()).toBe(false)                     // its return value is about stock.quote (#624)…
    expect(allCapabilityNames()).toContain(CAPABILITY)                       // …and stock.dailyBars is registered
    expect(allCapabilityNames()).not.toContain(QUOTE)                       // quote not activated: not registered
    for (const [s, name] of [['AAPL close', 'Apple Inc.'], ["NVDA's 5-day change", 'NVIDIA Corporation'], ['NVDA 52-week high', 'NVIDIA Corporation']]) {
      const f = fastParse(s, {})
      const out = await getCapability(CAPABILITY).answer(null, f.ops[0].args)
      expect(says(out)).toMatch(/completed sessions only/)
      expect(says(out)).toContain(`(${name})`)                                // the security is named
    }
    expect(posts().map(p => [p.kind, p.params.bars ?? null, p.purpose, p.turn_id])).toEqual([
      ['instrument.resolve', null, 'answer', 't-bars'], ['bars.daily', 2, 'answer', 't-bars'],
      ['instrument.resolve', null, 'answer', 't-bars'], ['bars.daily', 6, 'answer', 't-bars'],
      ['instrument.resolve', null, 'answer', 't-bars'], ['bars.daily', 252, 'answer', 't-bars']])
    const urls = globalThis.fetch.mock.calls.map(c => String(c[0]))
    expect(urls.filter(u => u !== '/api/agent/config').every(u => u === '/api/agent/data')).toBe(true)
  })

  it.each([[false, ['instrument.resolve', 'bars.daily']], [true, null], [true, []], [true, ['quote', 'quotes']], [true, ['bars.daily']]])('dark (data %s, kinds %j): no claim, nothing registered, no read', async (data, kinds) => {
    wire({ data, kinds })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(match('AAPL close')).toBeNull()
    expect(fastParse('AAPL close', {})?.ops?.some(o => o.action === CAPABILITY) ?? false).toBe(false)
    expect(says(await answerDailyBars({ symbol: 'AAPL', measure: 'lastClose', sessions: null }))).toBe("UCT's daily bars aren't available to the Agent here.")
    expect(posts()).toEqual([])
  })

  it('W1-B: a dated question is ONE bars.daily read with the adapter\'s `to`, sized for the measure — never a second read', async () => {
    wire({ data: true, kinds: ['instrument.resolve', 'bars.daily'] })
    await loadAgentConfig()
    registerMarketDataCapabilities()
    const ask = (args) => getCapability(CAPABILITY).answer(null, { sessions: null, date: null, ...args })
    expect(says(await ask({ symbol: 'NVDA', measure: 'lastClose', date: '2026-10-30' }))).toMatch(/^NVDA \(NVIDIA Corporation\) closed at \$101\.00 on Fri, Oct 30: /)
    expect(says(await ask({ symbol: 'AAPL', measure: 'session', date: '2026-10-15' }))).toMatch(/^AAPL \(Apple Inc\.\) on Thu, Oct 15: open /)
    expect(says(await ask({ symbol: 'TSLA', measure: 'range', date: 'last week' }))).toMatch(/^TSLA \(.+\) over the 5 completed sessions of last week ending \w{3}, \w{3} \d+/)
    expect(says(await ask({ symbol: 'NVDA', measure: 'change', sessions: 5, date: '2026-10-15' }))).toMatch(/over the 5 completed sessions ending Thu, Oct 15/)
    const lastFri = windowFor('range', null, 'last week').date.to
    expect(posts().filter(p => p.kind === 'bars.daily').map(p => [p.params.bars, p.params.to])).toEqual([[2, '2026-10-30'], [1, '2026-10-15'], [5, lastFri], [6, '2026-10-15']])
    // refused in words, nothing read
    const before = posts().length
    expect(await ask({ symbol: 'NVDA', measure: 'lastClose', date: 'the earnings day' })).toMatch(/couldn't read “the earnings day” as a date/)
    expect(await ask({ symbol: 'NVDA', measure: 'range', date: null })).toMatch(/Over which window\?/)
    expect(posts().length).toBe(before)
  })

  it('no turn id: no read', async () => {
    wire({ data: true, kinds: ['instrument.resolve', 'bars.daily'] })
    await loadAgentConfig()
    TURN = null
    expect(await answerDailyBars({ symbol: 'AAPL', measure: 'lastClose', sessions: null })).toMatch(/needs the Agent's turn/)
    expect(posts()).toEqual([])
  })
})
