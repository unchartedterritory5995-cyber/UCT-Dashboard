// Shared TradingView/broker CSV → daily-bars parsing, used by Model Book
// (per-stock uploaded data) and the Setup Library (per-example uploaded data)
// so a delisted/renamed/foreign ticker the data providers can't cover still
// renders a chart from admin-supplied OHLCV.

// Normalize a TradingView/broker CSV cell to an ISO YYYY-MM-DD date string.
export function toIsoDate(s) {
  if (s == null) return null
  s = String(s).trim().replace(/^"|"$/g, '')
  if (!s) return null
  if (/^\d{9,11}$/.test(s)) return new Date(parseInt(s, 10) * 1000).toISOString().slice(0, 10)  // unix seconds
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`           // ISO date/datetime
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`  // MM/DD/YYYY
  const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10)
}

// Parse a TradingView-exported CSV (time,open,high,low,close,Volume[,indicators…])
// into daily bars [{t,o,h,l,c,v}]. Header-driven (extra indicator columns ignored).
export function parseBarsCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''))
  const find = (...names) => header.findIndex(h => names.includes(h))
  const oi = find('open'), hi = find('high'), li = find('low'), ci = find('close', 'close/last', 'price')
  const vi = find('volume', 'vol')
  let ti = find('time', 'date', 'datetime'); if (ti < 0) ti = 0
  const hasHeader = oi >= 0 && ci >= 0
  const out = []
  for (let r = hasHeader ? 1 : 0; r < lines.length; r++) {
    const cols = lines[r].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const t = toIsoDate(cols[ti]); if (!t) continue
    const num = i => { const v = parseFloat(cols[i]); return Number.isFinite(v) ? v : null }
    const o = num(oi), h = num(hi), l = num(li), c = num(ci)
    if (o == null || h == null || l == null || c == null) continue
    const v = vi >= 0 ? (parseFloat(cols[vi]) || 0) : 0
    out.push({ t, o, h, l, c, v })
  }
  return out
}

// Resample daily bars → weekly (Mon-anchored) for the W timeframe.
export function resampleWeekly(daily) {
  const weeks = new Map()
  for (const b of daily) {
    const d = new Date(b.t + 'T00:00:00Z')
    const dow = (d.getUTCDay() + 6) % 7            // Mon=0
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow)
    const key = mon.toISOString().slice(0, 10)
    const w = weeks.get(key)
    if (!w) weeks.set(key, { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
    else { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.v += (b.v || 0) }
  }
  return [...weeks.values()].sort((a, b) => a.t.localeCompare(b.t))
}
