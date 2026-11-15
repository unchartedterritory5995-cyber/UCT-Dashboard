// ⚠️ LOCAL PREVIEW ONLY (owner 11-13: "add fake % changes, price and volume so I can see what it
// looks like live"). The local dev server has no market feed, so every quote is blank. In Vite's
// development mode ONLY, this fills each ticker that has NO real quote with a made-up one that
// drifts every couple of seconds. Never part of a production build (the import is behind
// `import.meta.env.MODE === 'development'`), never in tests, never over a real quote.
// Off switch for this browser: localStorage.setItem('uct.dev.fakeQuotes', '0').
import { useEffect, useMemo, useState } from 'react'

const TICK_MS = 2000

function seed(sym) {
  let h = 2166136261
  for (const ch of String(sym)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}
function rand01(h, n) {
  const x = Math.sin(h * 0.0001 + n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function devFakeQuotesOn() {
  try { return localStorage.getItem('uct.dev.fakeQuotes') !== '0' } catch { return true }
}

/** A made-up quote for `sym` at tick `t`: stable per symbol, drifting with t. */
export function fakeQuote(sym, t) {
  const h = seed(sym)
  const prev = 8 + rand01(h, 1) * 420                       // previous close: $8 – $428
  const drift = (rand01(h, 2) - 0.5) * 6                     // the day's lean: −3% … +3%
  const wiggle = Math.sin((t + rand01(h, 3) * 50) / 3) * 0.6 + (rand01(h, t + 7) - 0.5) * 0.35
  const chg = Math.round((drift + wiggle) * 100) / 100
  const price = Math.round(prev * (1 + chg / 100) * 100) / 100
  const volume = Math.round((0.2 + rand01(h, 4) * 40) * 1e6 * (1 + t * 0.002))
  return {
    price,
    change_pct: chg,
    prev_close: Math.round(prev * 100) / 100,
    day_open: Math.round(prev * (1 + drift / 300) * 100) / 100,
    day_high: Math.round(Math.max(price, prev) * 1.006 * 100) / 100,
    day_low: Math.round(Math.min(price, prev) * 0.994 * 100) / 100,
    volume,
    // Extended session (preview): a made-up after-hours print a little off the close, so
    // the Watchlist's Pre/After-Hours columns have something to show locally.
    day_close: price,
    ext_session: 'post_market',
    // The live feed's additive session fields (owner 11-14), as an after-hours session.
    market_session: 'post_market',
    ext_fresh: true,
    ext_volume: Math.round(volume * (0.01 + rand01(h, 7) * 0.06)),
    rth_close: price,
    rth_volume: volume,
    ext_price: Math.round(price * (1 + ((rand01(h, 5) - 0.5) * 4 + Math.sin((t + rand01(h, 6) * 40) / 4) * 0.3) / 100) * 100) / 100,
    updated_at: new Date().toISOString(),
    _devFake: true,
  }
}

/** Overlay made-up quotes on the tickers the real feed left blank. */
export function useDevFakeOverlay(real, tickers) {
  const [t, setT] = useState(0)
  const on = devFakeQuotesOn()
  useEffect(() => {
    if (!on) return undefined
    const id = setInterval(() => setT((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [on])
  const key = Array.isArray(tickers) ? tickers.join(',') : ''
  return useMemo(() => {
    if (!on || !real) return real
    const prices = { ...(real.prices || {}) }
    for (const sym of (Array.isArray(tickers) ? tickers : [])) {
      if (!sym || prices[sym]?.price != null) continue
      prices[sym] = fakeQuote(sym, t)
    }
    return { ...real, prices, isLoading: false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, key, t, on])
}

// ── LOCAL PREVIEW ONLY: made-up Theme Tracker data (owner 11-13: preview the Theme Tracker
// redesign — the local server has almost no theme data). Same shape as /api/theme-performance.
const FAKE_THEMES = [
  ['AI Infrastructure', 'AIIN', ['NVDA', 'AVGO', 'VRT', 'ANET', 'SMCI', 'DELL']],
  ['Nuclear & Uranium', 'NUKE', ['CCJ', 'OKLO', 'SMR', 'LEU', 'BWXT']],
  ['Semiconductors', 'SEMI', ['AMD', 'TSM', 'MU', 'INTC', 'QCOM', 'MRVL']],
  ['Quantum Computing', 'QNTM', ['IONQ', 'RGTI', 'QBTS', 'QUBT']],
  ['Space & Satellites', 'SPCE', ['RKLB', 'ASTS', 'LUNR', 'PL']],
  ['Cybersecurity', 'CYBR', ['CRWD', 'PANW', 'ZS', 'FTNT', 'NET']],
  ['Biotech Large Cap', 'BIOL', ['AMGN', 'GILD', 'VRTX', 'REGN']],
  ['Solar', 'SOLR', ['FSLR', 'ENPH', 'RUN', 'SEDG']],
  ['Homebuilders', 'HOME', ['DHI', 'LEN', 'PHM', 'TOL']],
  ['Crypto Miners', 'MINE', ['MARA', 'RIOT', 'CLSK', 'CORZ', 'HUT']],
]
const PERIOD_KEYS = ['1d', '1w', '1m', '3m', '1y', 'ytd']
const SCALE = { '1d': 3, '1w': 7, '1m': 14, '3m': 28, '1y': 70, ytd: 55 }
export function devFakeThemes(data) {
  if (import.meta.env.MODE !== 'development' || !devFakeQuotesOn()) return data
  const real = Array.isArray(data?.themes) ? data.themes : []
  const hasReal = real.some((t) => Object.values(t?.group_return || {}).some((v) => v != null))
  if (hasReal) return data
  // Fill the member's REAL themes (their own sets included) with made-up returns, so edits show;
  // pad a near-empty list with the sample themes so the widget has something to look at.
  const fakeReturns = (sym, lean) => Object.fromEntries(PERIOD_KEYS.map((k, i) => [k, Math.round((lean + (rand01(seed(sym), i + 1) - 0.5) * 0.9) * SCALE[k] * 100) / 100]))
  const fill = (t) => {
    const lean = rand01(seed(t.name || t.ticker || ''), 9) - 0.42
    const holdings = (t.holdings || []).map((h) => ({ ...h, returns: fakeReturns(h.sym, lean) }))
    const group_return = Object.fromEntries(PERIOD_KEYS.map((k) => [k, holdings.length ? Math.round(holdings.reduce((a, x) => a + x.returns[k], 0) / holdings.length * 100) / 100 : null]))
    return { ...t, holdings, group_return }
  }
  const filled = real.map(fill)
  const names = new Set(filled.map((t) => t.name))
  const pad = filled.filter((t) => t.holdings.length).length < 3
    ? FAKE_THEMES.filter(([name]) => !names.has(name)).map(([name, ticker, syms]) => fill({ name, ticker, etf_name: '', holdings: syms.map((sym) => ({ sym, name: sym, source: 'owner', ref_prices: {} })) }))
    : []
  return { ...(data || {}), themes: [...filled, ...pad], status: 'ok' }
}

// ⚠️ LOCAL PREVIEW ONLY (owner 11-13): a made-up Trade Exchange feed for the News widget, so the
// redesign can be seen "live" on the dev server (the local backend has no news stream). Invented
// headlines, spread back from now; a new one arrives every ~25 s. Dev mode only; never ships.
const FAKE_NEWS = [
  ['NVDA', 'News', 'NVDA - Nvidia unveils next-generation networking platform for AI data centers; says the new switches double bandwidth per port and will ship to cloud customers early next year, with several hyperscalers already committed to initial deployments'],
  ['', 'Macro', 'US initial jobless claims come in slightly below expectations as continuing claims hold near recent levels; economists say the labor market is cooling gradually rather than sharply'],
  ['AAPL', 'News', 'AAPL - Apple expands manufacturing partnership with suppliers in India'],
  ['TSLA', 'Price', 'TSLA - Tesla shares extend gains in the afternoon session'],
  ['MSFT', 'News', 'MSFT - Microsoft announces new Azure region in Northern Europe'],
  ['AMD', 'Earnings', 'AMD - Advanced Micro Devices to report third-quarter results next Tuesday'],
  ['', 'Macro', 'Fed officials signal patience on further rate moves, minutes show; several members noted that inflation progress has been uneven across categories and that policy should remain data dependent through the end of the year, while a few saw room to ease sooner if hiring slows'],
  ['PLTR', 'News', 'PLTR - Palantir awarded multi-year contract extension with US Army covering data integration and analytics services across several commands'],
  ['CRWD', 'Press Release', 'CRWD - CrowdStrike launches new identity protection module'],
  ['SPY', 'Options', 'SPY - Heavy call buying in December contracts this morning'],
  ['META', 'News', 'META - Meta rolls out new AI assistant features across Facebook, Instagram and WhatsApp, including image editing and real-time translation in more than a dozen languages'],
  ['', 'Macro', '10-year Treasury yield slips as bond buyers return'],
  ['AVGO', 'Filing', 'AVGO - Broadcom files Form 8-K: changes to board of directors'],
  ['SMCI', 'Price', 'SMCI - Super Micro trading halted, volatility pause'],
  ['AMZN', 'News', 'AMZN - Amazon opens new same-day delivery hubs in three states'],
  ['COIN', 'News', 'COIN - Coinbase adds support for new staking products'],
  ['', 'Macro', 'Oil steadies after two-day decline as traders weigh weekly inventory data against signs of softer demand in Asia and ongoing supply discipline from major producers'],
  ['HOOD', 'Earnings', 'HOOD - Robinhood monthly metrics: funded customers rise'],
  ['GOOGL', 'News', 'GOOGL - Alphabet unveils updated Gemini models for developers'],
  ['MU', 'Press Release', 'MU - Micron begins volume shipments of new high-bandwidth memory'],
  ['', 'Other', 'Markets open: indexes little changed in early trade'],
  ['UBER', 'News', 'UBER - Uber expands autonomous ride partnership to new cities'],
  ['NFLX', 'Options', 'NFLX - Unusual put activity in weekly contracts'],
  ['JPM', 'News', 'JPM - JPMorgan raises quarterly dividend and announces a new share repurchase program after clearing its annual capital review; CEO says the bank remains well positioned heading into next year'],
]
let fakeNewsCache = null
function fakeNewsItems() {
  const now = Date.now()
  const born = Math.floor(now / 25000)                       // one more headline every 25 s
  if (fakeNewsCache && fakeNewsCache.born === born) return fakeNewsCache.items
  const items = []
  const total = FAKE_NEWS.length + 6
  for (let k = 0; k < total; k++) {
    const [sym, category, content] = FAKE_NEWS[(born + k) % FAKE_NEWS.length]
    const seq = born * 100 - k
    items.push({ seq, id: `devnews-${born - k}-${k}`, source: 'TX-News', content, category,
      tickers: sym ? [sym] : [], mentions: [], received_at_ms: (born - k) * 25000 - k * 95000 })
  }
  items.reverse()                                          // the stream keeps oldest first
  fakeNewsCache = { born, items }
  return items
}
/** The feed state, with made-up headlines when the real stream is unavailable on the dev server. */
export function devFakeNewsFeed(feed) {
  if (import.meta.env.MODE !== 'development' || !devFakeQuotesOn()) return feed
  if (feed?.status === 'live' && feed.items?.length) return feed
  const items = fakeNewsItems()
  return { ...(feed || {}), status: 'live', items, lastHeadlineAt: items[items.length - 1].received_at_ms, coverage: null, truncated: false, provisional: false }
}
/** The day view over the fake feed: the filtered live rows, newest first, as "Today". */
export function devFakeNewsDay(day, shown, feedWasFake) {
  if (!feedWasFake) return day
  return { ...day, rows: shown, total: shown.length, dayTotal: shown.length, hidden: 0, loading: false, loadingMore: false,
    error: null, hasOlder: false, hasNewer: false, live: true, isToday: true, allHistory: false }
}
/** A hook that re-renders every 25 s so the fake feed grows while you watch. */
export function useDevFakeNewsTick() {
  const [n, setN] = useState(0)
  const on = import.meta.env.MODE === 'development' && devFakeQuotesOn()
  useEffect(() => {
    if (!on) return undefined
    const id = setInterval(() => setN((n) => n + 1), 25000)
    return () => clearInterval(id)
  }, [on])
  return n
}

// ⚠️ LOCAL PREVIEW ONLY (owner 11-13): a made-up saved-headlines library for the News widget's
// Saved view (the local backend runs with the news library switched off). Dev mode only.
const FAKE_COLLECTIONS = [{ id: 'dev-c1', name: 'Trade ideas', count: 3 }, { id: 'dev-c2', name: 'Macro', count: 2 }, { id: 'dev-c3', name: 'Earnings', count: 2 }]
const FAKE_SAVED = [
  [0, ['dev-c1'], 'Watch the networking names for follow-through.'],
  [6, ['dev-c2'], ''],
  [23, [], ''],
  [9, ['dev-c1'], 'Calls stacked at the round number.'],
  [5, ['dev-c3'], 'Report date — size down beforehand.'],
  [11, ['dev-c2'], ''],
  [17, ['dev-c3', 'dev-c1'], ''],
]
function fakeSavedItems() {
  const now = Date.now()
  return FAKE_SAVED.map(([i, cols, note], k) => {
    const [sym, category, content] = FAKE_NEWS[i % FAKE_NEWS.length]
    return { seq: 9000 - k, id: `devsaved-${k}`, source: 'TX-News', content, category, tickers: sym ? [sym] : [], mentions: [],
      received_at_ms: now - (k + 1) * 3.7 * 3600_000, bookmark: { note, collection_ids: cols, saved_at_ms: now - k * 3600_000 } }
  })
}
let fakeLibState = null
/** The library snapshot, made up on the dev server when the real one could not load. */
export function devFakeLibrary(lib) {
  if (import.meta.env.MODE !== 'development' || !devFakeQuotesOn()) return lib
  if (lib?.status === 'ready' || lib?.status === 'loading' || lib?.status === 'idle') return lib
  if (!fakeLibState) {
    const items = fakeSavedItems()
    fakeLibState = { status: 'ready', ids: new Set(items.map((x) => x.id)), collections: FAKE_COLLECTIONS, limits: null, error: null, version: 1 }
  }
  return fakeLibState
}
/** library.fetchItems over the made-up library: search, ticker and collection filters work. */
export async function devFakeFetchItems({ q = '', ticker = '', collection = '' } = {}) {
  const ql = q.toLowerCase()
  const items = fakeSavedItems().filter((it) => (!ql || it.content.toLowerCase().includes(ql) || it.bookmark.note.toLowerCase().includes(ql))
    && (!ticker || it.tickers.includes(ticker)) && (!collection || it.bookmark.collection_ids.includes(collection)))
  return { ok: true, items, total: items.length }
}

// ── LOCAL PREVIEW: the chart's ▾ symbol menu (leveraged ETFs / top holdings) ──────────
// The local backend has no reference data, so both lists come back empty and the ▾ never
// shows. Dev only, only when the real answer is empty; made-up funds (tickers + names).
const DEV_FAKE_ETFS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'SOXX', 'XLK', 'XLF', 'XLE', 'XLV', 'ARKK', 'IBIT', 'GLD', 'TLT', 'KWEB', 'XBI']
export function devFakeEtfSymbols(data) {
  if (import.meta.env.MODE !== 'development' || !devFakeQuotesOn()) return data
  return data?.symbols?.length ? data : { ...(data || {}), symbols: DEV_FAKE_ETFS }
}
export function devFakeLevFamily(url, data) {
  if (import.meta.env.MODE !== 'development' || !devFakeQuotesOn()) return data
  if (data?.long?.length || data?.short?.length) return data
  const sym = decodeURIComponent(String(url).split('/').pop() || '').toUpperCase()
  if (!sym || DEV_FAKE_ETFS.includes(sym)) return data
  const h = seed(sym)
  const row = (ticker, factor, side, n) => ({ ticker, factor, name: `Preview ${factor}x ${side} ${sym} ETF`, avg_dollar_vol: Math.round(2e6 + rand01(h, n) * 9e7) })
  const long = [row(`${sym}U`, 2, 'Long', 1), row(`${sym}X`, 1.5, 'Long', 2)]
  const short = [row(`${sym}D`, 2, 'Short', 3)]
  return { underlying: sym, long, short, best_long: long[0].ticker, best_short: short[0].ticker }
}

// ── LOCAL PREVIEW: the Notebook widget (the local account has no notes or folders) ─────
// Dev only, only while the real answers are empty. Made-up notes; their ids start with
// 'dev-' and the widget never saves them (update is a no-op for a fake id).
const P = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const H = (text) => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] })
const T = (text, checked) => ({ type: 'taskItem', attrs: { checked }, content: [P(text)] })
const DEV_NB_FOLDERS = [
  { id: 'dev-f-plan', name: 'Daily plans', parentId: null, sortOrder: 0 },
  { id: 'dev-f-mb', name: 'Model Books', parentId: null, sortOrder: 1 },
  { id: 'dev-f-mb26', name: '2026', parentId: 'dev-f-mb', sortOrder: 0 },
  { id: 'dev-f-mb25', name: '2025', parentId: 'dev-f-mb', sortOrder: 1 },
  { id: 'dev-f-rules', name: 'Setups & rules', parentId: null, sortOrder: 2 },
  { id: 'dev-f-rev', name: 'Weekly reviews', parentId: null, sortOrder: 3 },
]
const d = (daysAgo, h = 9) => { const t = new Date(); t.setDate(t.getDate() - daysAgo); t.setHours(h, 12, 0, 0); return t.toISOString() }
const DEV_NB_NOTES = [
  ['dev-n1', 'dev-f-plan', 'Plan for Friday', 0, 'Watching the semis into the open. Two names near pivots, half size until the first hour settles.'],
  ['dev-n2', 'dev-f-plan', 'Plan for Thursday', 1, 'Gap-and-go only if volume confirms in the first 5 minutes. No new longs after 3 PM.'],
  ['dev-n3', 'dev-f-plan', 'Plan for Wednesday', 2, 'Index under the 21-day; defense first, cash is a position.'],
  ['dev-n4', 'dev-f-mb26', 'ZXTR — base breakout', 5, 'Seven-week flat base, volume dry-up on the last pullback, broke out on 3x average volume.'],
  ['dev-n5', 'dev-f-mb26', 'QLMN — earnings gap', 15, 'Gap held the opening range all day, closed in the top 10% of the range.'],
  ['dev-n6', 'dev-f-mb25', 'HVRA — cup with handle', 250, 'Handle in the upper third, shakeout under the 50-day before the move.'],
  ['dev-n7', 'dev-f-rules', 'Entry checklist', 31, 'Market in an uptrend, group in the top 20, tight action, defined risk under 7%.'],
  ['dev-n8', 'dev-f-rules', 'Sell rules', 47, 'Sell into strength at 20-25%, cut at -7% with no exceptions.'],
  ['dev-n9', 'dev-f-rev', 'Week 45 review', 6, 'Overtraded Tuesday. Best trade came from the watchlist built on Sunday.'],
  ['dev-n10', null, 'Book notes — position sizing', 87, 'Risk a fixed fraction per trade; let winners add the size, not the entries.'],
].map(([id, folderId, title, ago, bodyPlain]) => ({ id, folderId, title, bodyPlain, createdAt: d(ago + 1), updatedAt: d(ago) }))
const nbOn = () => import.meta.env.MODE === 'development' && devFakeQuotesOn()
export const isDevFakeNote = (id) => typeof id === 'string' && id.startsWith('dev-')
export function devFakeNoteFolders(real) {
  return nbOn() && !(real && real.length) ? DEV_NB_FOLDERS : real
}
export function devFakeNotes(real, q) {
  if (!nbOn() || (real && real.length)) return real
  const s = String(q || '').trim().toLowerCase()
  return s ? DEV_NB_NOTES.filter((n) => (n.title + ' ' + n.bodyPlain).toLowerCase().includes(s)) : DEV_NB_NOTES
}
export function devFakeNote(id) {
  const n = DEV_NB_NOTES.find((x) => x.id === id)
  if (!n) return null
  const content = id === 'dev-n1'
    ? [P('Market is in a confirmed uptrend. Full size only on A+ setups.'), H('Watchlist'),
       P('ZXTR: pivot 48.20, stop under the 21-day. QLMN needs a tighter week first.'), H('Rules for today'),
       { type: 'taskList', content: [T('Review overnight news and earnings', true), T('Half size until 10:30', false), T('Log every entry in the Journal', false)] }]
    : [P(n.bodyPlain)]
  return { ...n, bodyJson: { type: 'doc', content } }
}

// ── LOCAL PREVIEW: Calendar earnings (the local backend's earnings lists are empty) ─────
// Dev only, only for a week with no earnings at all. Real tickers, MADE-UP numbers.
const DEV_CAL_SYMS = ['NVDA', 'AMAT', 'WMT', 'HD', 'TGT', 'LOW', 'TJX', 'PANW', 'INTU', 'SNOW', 'ROST', 'ADI', 'DE', 'CSCO', 'ZM', 'WDAY', 'DELL', 'MRVL', 'CRM', 'NTAP']
export function devFakeCalendarWeek(data) {
  if (!nbOn() || !data?.days) return data
  const days = Object.values(data.days)
  if (days.some((d) => (d.bmo?.length || 0) + (d.amc?.length || 0) + (d.tbd?.length || 0) > 0)) return data
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const out = { ...data, days: {} }
  Object.entries(data.days).forEach(([iso, d], i) => {
    const past = iso < today
    const mk = (sym, n) => {
      const h = seed(sym + iso)
      const epsE = +(0.3 + rand01(h, n) * 4).toFixed(2), revE = Math.round(400 + rand01(h, n + 1) * 30000)
      const beat = rand01(h, n + 2) - 0.35
      return { sym, eps_est: epsE, rev_est: revE, ...(past ? { eps_act: +(epsE * (1 + beat * 0.2)).toFixed(2), rev_act: Math.round(revE * (1 + beat * 0.05)) } : {}) }
    }
    const pick = (k, n) => Array.from({ length: n }, (_, j) => DEV_CAL_SYMS[(i * 4 + k * 3 + j * 2) % DEV_CAL_SYMS.length])
    const uniq = (a) => [...new Set(a)]
    out.days[iso] = { ...d, bmo: uniq(pick(0, 5 + (i % 3))).map((s, j) => mk(s, j)), amc: uniq(pick(1, 4 + (i % 4))).map((s, j) => mk(s, j + 9)), tbd: i % 2 ? uniq(pick(2, 3)).map((s, j) => mk(s, j + 20)) : [] }
  })
  return out
}
export function devFakeImpliedMoves(map, day) {
  if (!nbOn() || (map && Object.keys(map).length) || !day) return map
  const out = {}
  ;[...(day.bmo || []), ...(day.amc || []), ...(day.tbd || [])].forEach((c) => { out[c.sym] = +(2 + rand01(seed(c.sym), 31) * 9).toFixed(1) })
  return Object.keys(out).length ? out : map
}
