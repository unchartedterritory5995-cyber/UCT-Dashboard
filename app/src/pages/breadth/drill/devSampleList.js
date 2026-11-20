// ⛔ DEV ONLY (owner 2026-11-19). The local production copy holds no drill lists, so on localhost
// a list that fails or comes back empty is replaced by a SAMPLE, so the sector mix, the Focus /
// Grid / Table views, Mark day and Replay can be judged. The SYMBOLS are real liquid tickers
// whose daily bars load on localhost (checked against the local bars store), so their charts
// draw; the % moves, prices and volumes in the list are INVENTED and the window labels the
// whole list "dev sample list".
//
// It is reached ONLY through `import()` inside an `import.meta.env.DEV` branch (Breadth.jsx), so a
// production build drops the branch and never emits this module (devSampleList.test.js reads the
// built bundle to prove it).

export const DEV_SAMPLE_LABEL = 'dev sample list'
const SECTORS = [
  ['Technology', ['Semiconductors', 'Software', 'Hardware']],
  ['Healthcare', ['Biotech', 'Medical devices']],
  ['Industrials', ['Machinery', 'Aerospace']],
  ['Consumer', ['Retail', 'Leisure']],
  ['Financials', ['Banks', 'Insurance']],
  ['Energy', ['Oil and gas', 'Solar']],
  ['Materials', ['Metals and mining']],
]
const THEMES = ['AI infrastructure', 'Space', 'GLP-1', 'Nuclear', 'Crypto miners', null, null]
// Real symbols with local daily bars (verified on the dev box's bars store, 2026-11-19).
export const DEV_SAMPLE_SYMBOLS = Object.freeze((
  'AAPL MSFT NVDA AMZN GOOGL META TSLA AMD AVGO NFLX CRM ORCL ADBE INTC QCOM MU PLTR SHOP UBER COIN ' +
  'SNOW CRWD PANW NOW ANET SMCI ARM MRVL LRCX AMAT KLAC TSM ASML JPM GS BAC WFC V MA PYPL XOM CVX OXY ' +
  'SLB LLY UNH JNJ PFE MRNA ABBV CAT DE BA GE HON LMT RTX NKE SBUX MCD COST WMT HD TGT DIS SOFI HOOD ' +
  'RKLB IONQ AFRM DKNG').split(' '))

function rng(seed) {
  let h = 2166136261
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000 }
}

/** `count` invented rows (capped at 60), stable for one `seed` (the list's URL). */
export function devSampleList({ seed = 'x', count = 30, down = false } = {}) {
  const r = rng(seed)
  const n = Math.max(8, Math.min(60, Math.round(Number.isFinite(count) && count > 0 ? count : 30)))
  // A seeded shuffle of the real symbols, so each list shows a different (stable) set.
  const pool = [...DEV_SAMPLE_SYMBOLS]
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  const items = []
  for (const t of pool.slice(0, n)) {
    const [sector, inds] = SECTORS[Math.floor(Math.pow(r(), 1.6) * SECTORS.length)]
    const move = 4 + Math.pow(r(), 2) * 30
    items.push({
      t,
      pct: Math.round((down ? -move : move) * 10) / 10,
      c: Math.round((3 + Math.pow(r(), 2) * 180) * 100) / 100,
      vr: Math.round((0.8 + r() * 4) * 10) / 10,
      v: Math.round(2e5 + Math.pow(r(), 2) * 2e7),
      sector,
      industry: inds[Math.floor(r() * inds.length)],
      theme: THEMES[Math.floor(r() * THEMES.length)],
      _devSample: true,
    })
  }
  return { items, devSample: true }
}

/** True on a local development host (never on a deployed one). */
export function isLocalDevHost(host = typeof location !== 'undefined' ? location.hostname : '') {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /\.localhost$/.test(host)
}
