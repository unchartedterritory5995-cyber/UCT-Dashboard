/**
 * drillLook — small pure helpers for the drill's round-17 look (owner's batch-16 verdicts, 2026-11-04).
 *
 *  barStats(bars)  the facts a trader reads off a chart before answering: % off the window's high, % from the
 *                  20- and 50-bar simple averages, the 20-bar average daily range. Arithmetic over the bars in hand,
 *                  nothing fetched, nothing modelled ("Dont need the bar count, if anything have % down from highs
 *                  and % extended from MAs in a table").
 */

function sma(closes, n) {
  if (closes.length < n) return null
  let s = 0
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i]
  return s / n
}

const pct = (a, b) => (b == null || !b ? null : ((a - b) / b) * 100)
const fmt = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`)

/** @returns {{ id: string, label: string, value: string, tone: 'up'|'down'|'flat', num: number }[]} */
export function barStats(bars) {
  const list = Array.isArray(bars) ? bars.filter((b) => b && Number.isFinite(b.c)) : []
  if (list.length < 5) return []
  const closes = list.map((b) => b.c)
  const last = closes[closes.length - 1]
  const high = Math.max(...list.map((b) => (Number.isFinite(b.h) ? b.h : b.c)))
  const offHigh = pct(last, high)
  const m20 = pct(last, sma(closes, 20))
  const m50 = pct(last, sma(closes, 50))
  const tail = list.slice(-20).filter((b) => Number.isFinite(b.h) && Number.isFinite(b.l) && b.l > 0)
  const adr = tail.length ? tail.reduce((s, b) => s + ((b.h - b.l) / b.l) * 100, 0) / tail.length : null
  const tone = (v) => (v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat')
  const out = [{ id: 'high', label: 'Off high', value: fmt(offHigh), tone: tone(offHigh), num: offHigh }]
  if (m20 != null) out.push({ id: 'ma20', label: 'vs 20 MA', value: fmt(m20), tone: tone(m20), num: m20 })
  if (m50 != null) out.push({ id: 'ma50', label: 'vs 50 MA', value: fmt(m50), tone: tone(m50), num: m50 })
  if (adr != null) out.push({ id: 'adr', label: 'ADR 20', value: `${adr.toFixed(1)}%`, tone: 'flat', num: adr })
  return out.filter((s) => s.value)
}
