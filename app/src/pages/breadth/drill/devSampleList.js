// ⛔ DEV ONLY (owner 2026-11-19). The local production copy holds no drill lists, so on localhost
// a list that fails or comes back empty is replaced by an INVENTED one, so the sector mix and the
// Focus / Grid / Table views can be judged. Invented tickers, sectors, prices, moves and volumes;
// nothing here is a real quote.
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
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

function rng(seed) {
  let h = 2166136261
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000 }
}

/** `count` invented rows (capped at 60), stable for one `seed` (the list's URL). */
export function devSampleList({ seed = 'x', count = 30, down = false } = {}) {
  const r = rng(seed)
  const n = Math.max(8, Math.min(60, Math.round(Number.isFinite(count) && count > 0 ? count : 30)))
  const seen = new Set()
  const items = []
  while (items.length < n) {
    const len = 3 + Math.floor(r() * 2)
    let t = ''
    for (let i = 0; i < len; i++) t += LETTERS[Math.floor(r() * LETTERS.length)]
    if (seen.has(t)) continue
    seen.add(t)
    const [sector, inds] = SECTORS[Math.floor(Math.pow(r(), 1.6) * SECTORS.length)]
    const move = 4 + Math.pow(r(), 2) * 30
    items.push({
      t,
      n: `Sample ${t} Holdings`,
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
