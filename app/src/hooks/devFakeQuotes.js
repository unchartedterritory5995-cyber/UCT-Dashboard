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
