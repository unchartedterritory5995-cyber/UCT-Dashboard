// app/src/components/chart/chartIq/chartIqPlan.js — Chart IQ payload -> what to draw (pure; no DOM, no chart).
//
// GET /api/chart-iq/{sym} answers the engine's read of a DAILY chart (api/services/chart_iq). This turns it into three
// lists the overlay renders: `segments` (levels, zones, trendlines, bases: two anchored points, a colour, a dash, a label),
// `markers` (key candles, cycle stages, buy days: one bar, above or below it) and `hlines` (the setting-up trigger and stop).
// The drawing rules are the ones the engine was reviewed and tuned on (the lab's review pages), so a member sees the chart
// the engine was judged on: levels red above / green below, zones as top + bottom lines, trendlines (the auto-trendline port
// in blue), bases as a purple top + dotted low + cyan dashed buy point, double bottoms as a dotted W + a dashed pivot.
//
// Dates are 'YYYY-MM-DD' (the daily series' own key). `clip` holds a date inside the loaded bars: before the first bar ->
// the first bar, after the last -> the last (a level that started off-screen still draws across what is on screen).

export const LAYERS = Object.freeze([
  { id: 'levels', label: 'Support & resistance', on: true },
  { id: 'lines', label: 'Trendlines', on: true },
  { id: 'bases', label: 'Bases & patterns', on: true },
  { id: 'candles', label: 'Key candles', on: true },
  { id: 'cycle', label: 'Cycle', on: true },
  { id: 'buys', label: 'Buy days', on: true },
  { id: 'watch', label: 'Setting up (trigger / stop)', on: true },
  { id: 'gaps', label: 'Unfilled gaps', on: false },
])

export function defaultLayers() {
  return Object.fromEntries(LAYERS.map((l) => [l.id, l.on]))
}

const RED = '#f87171'
const GREEN = '#34d399'
const BLUE = '#38bdf8'
const AUTO_TL = '#60a5fa'
const PURPLE = '#a78bfa'
const CYAN = '#22d3ee'
const GOLD = '#facc15'
const RECENT = 30          // a marker's text shows only on the last RECENT bars (older marks are dots: no pile-up)
const FRESH = 10           // a plain buy day is named only this close to today (the best buy day is always named)

function colorOf(o) {
  if (o.color) return o.color
  const p = o.ptype || ''
  if (o.role === 'Resistance' || /Resistance|Swing high/.test(p)) return RED
  if (o.kind === 'zone' || /Support|hold|Swing low|Gap/.test(p)) return GREEN
  return BLUE
}

const fx = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null)

export function buildPlan(payload, barTimes, layers = defaultLayers()) {
  const out = { segments: [], markers: [], hlines: [] }
  if (!payload || !Array.isArray(barTimes) || !barTimes.length) return out
  const first = barTimes[0]
  const last = barTimes[barTimes.length - 1]
  const idx = new Map(barTimes.map((t, k) => [t, k]))
  const clip = (d) => {
    if (typeof d !== 'string') return null
    if (d < first) return first
    if (d > last) return last
    if (idx.has(d)) return d
    let lo = 0, hi = barTimes.length - 1                  // the last bar on or before d (a holiday / missing bar)
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (barTimes[mid] <= d) lo = mid; else hi = mid - 1 }
    return barTimes[lo]
  }
  const recent = (d) => idx.has(d) && idx.get(d) >= barTimes.length - RECENT
  const fresh = (d) => idx.has(d) && idx.get(d) >= barTimes.length - FRESH
  const seg = (t1, p1, t2, p2, color, dash, label, extra) => {
    const a = clip(t1), b = clip(t2)
    if (a == null || b == null || fx(p1) == null || fx(p2) == null) return
    out.segments.push({ t1: a, p1, t2: b, p2, color, dash: dash || null, label: label || '', ...extra })
  }
  const along = (o, t) => {                             // a trendline's price on bar t (by bar index, like the engine)
    const d1 = clip(o.d1), d2 = clip(o.d2)
    const k1 = idx.get(d1), k2 = idx.get(d2), k = idx.get(t)
    if (k1 == null || k2 == null || k == null || k1 === k2) return o.p2
    return o.p1 + (o.p2 - o.p1) * (k - k1) / (k2 - k1)
  }

  for (const o of payload.clean || []) {
    const label = o.nolabel ? '' : (o.ptype || '')
    if (o.kind === 'hline' && layers.levels) {
      seg(o.start || first, o.price, last, o.price, colorOf(o), o.dash, label, { kind: 'level' })
    } else if (o.kind === 'zone' && layers.levels) {
      const end = o.end && idx.has(o.end) ? o.end : last
      seg(o.start || first, o.top, end, o.top, colorOf(o), o.dash, label, { kind: 'zone' })
      seg(o.start || first, o.bot, end, o.bot, colorOf(o), o.dash, '', { kind: 'zone' })
    } else if (o.kind === 'trendline' && layers.lines) {
      const c = /dojiemoji/.test(o.src || '') ? AUTO_TL : colorOf(o)
      const d2 = clip(o.d2)
      let t2 = o.d2, p2 = o.p2
      if (o.extend && d2 !== last) {
        t2 = o.ext_to && idx.has(o.ext_to) ? o.ext_to : last
        p2 = along(o, t2)
      }
      seg(o.d1, o.p1, t2, p2, c, o.dash, '', { kind: 'trendline' })
    } else if (o.kind === 'base' && layers.bases) {
      const top = fx(o.line) != null ? o.line : o.buy_point
      seg(o.line_start || o.start, top, o.end || last, top, PURPLE, null, o.ptype || 'Base', { kind: 'base' })
      if (fx(o.low) != null) seg(o.start, o.low, o.end || last, o.low, PURPLE, 'dotted', '', { kind: 'base' })
      if (fx(o.buy_point) != null) seg(o.line_start || o.start, o.buy_point, last, o.buy_point, CYAN, 'dashed', `Buy ${o.buy_point.toFixed(2)}`, { kind: 'buypoint' })
    } else if (o.kind === 'double_bottom' && layers.bases) {
      const s = o.start || o.low1_date
      seg(s, o.pivot, o.low1_date, o.low1, GREEN, 'dotted', '', { kind: 'base' })
      seg(o.low1_date, o.low1, o.low2_date, o.low2, GREEN, 'dotted', '', { kind: 'base' })
      if (fx(o.pivot) != null) seg(o.low1_date, o.pivot, last, o.pivot, CYAN, 'dashed', `${o.ptype || 'Double bottom'} ${o.pivot.toFixed(2)}`, { kind: 'buypoint' })
    } else if (o.kind === 'candle' && layers.candles && o.pts?.length && idx.has(o.pts[0].d)) {
      out.markers.push({
        t: o.pts[0].d, pos: o.at === 'low' ? 'below' : 'above', color: o.color || GOLD, shape: 'circle',
        size: o.dot ? 1 : 2, text: o.text != null ? o.text : (o.ptype || ''), why: o.why || '', kind: 'candle',
      })
    }
  }
  if (layers.cycle) {
    for (const c of payload.cycle || []) {
      if (!c.shown || !idx.has(c.d)) continue
      if (out.markers.some((m) => m.t === c.d && m.text && m.text.startsWith(c.stage))) continue   // the drawn chart already names it
      out.markers.push({ t: c.d, pos: c.bear ? 'above' : 'below', color: c.bear ? '#f97316' : '#f59e0b', shape: c.bear ? 'down' : 'up',
        size: 1, text: recent(c.d) ? c.stage : '', why: c.why || '', kind: 'cycle' })
    }
  }
  if (layers.buys) {
    for (const b of payload.buydays || []) {
      if (!(b.held || b.best) || !idx.has(b.d)) continue
      const name = String(b.name || '').split(' ·')[0]
      out.markers.push({ t: b.d, pos: 'below', color: b.best ? CYAN : '#67e8f9', shape: 'up', size: b.best ? 2 : 1,
        text: b.best ? `BEST BUY · ${name}` : (fresh(b.d) ? `BUY · ${name}` : ''),
        why: b.held ? `held, +${b.run}% since` : `failed: closed under its low ${b.failed_on || ''}`, kind: 'buy' })
    }
  }
  if (layers.watch) {
    for (const w of payload.watches || []) {
      if (fx(w.trigger) != null) out.hlines.push({ price: w.trigger, color: '#22c55e', dash: 'dashed', label: `Trigger ${w.trigger}`, kind: 'trigger', why: w.kind })
      if (fx(w.stop) != null) out.hlines.push({ price: w.stop, color: '#ef4444', dash: 'solid', label: `Stop ${w.stop}`, kind: 'stop', why: w.kind })
    }
  }
  if (layers.gaps) {
    for (const g of payload.gaps || []) {
      const c = g.state === 'untested' ? '#9ca3af' : g.up ? GREEN : RED
      seg(g.d, g.top, last, g.top, c, 'dotted', '', { kind: 'gap', width: 1 })
      seg(g.d, g.bot, last, g.bot, c, 'dotted', '', { kind: 'gap', width: 1 })
    }
  }
  out.markers.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
  return out
}
