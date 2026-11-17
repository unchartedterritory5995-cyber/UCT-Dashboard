// ── MY TRADES — Chart Settings → Markers → Your activity → My trades (owner 11-16, was Soon) ──
//
// While ON (`myTradeMarkers: true`, chartViewOptions.js; ABSENT = OFF = today's look — a /charts chart drew none of
// the member's trades before this row existed), the member's own executed fills on the chart's symbol are drawn as
// small series markers on the bars where they happened: a buy is an up-arrow below the bar, a sell a down-arrow
// above it. Hovering one shows "Bought 100 @ 12.34 · Mar 2, 2026, 10:31 AM" as the chart's tooltip; a bar with
// several fills shows "3 fills · net +200". READ-ONLY: nothing here creates, edits or deletes a trade.
//
// ⭐ NO NEW BACKEND. The fills come from the Journal's own reads, both owner-scoped and all-accounts:
//   GET /api/j2/trades?symbol=SYM   closed trades (entry + exit leg each). The journal's symbol filter is a PREFIX
//                                   match (NV finds NVDA and NVAX), so rows are kept exact here (as checkModel does).
//   GET /api/j2/positions           open positions (the still-open shares' entry leg; an estimated entry is skipped).
// A closed trade is two fills: the entry (Long → bought, Short → sold) and the exit (the opposite side). A partly
// closed position's closed shares are their own trade row and the position keeps only the open shares, so summing
// every leg gives the true net. Fetched only while the setting is ON (both SWR keys are null while OFF).
//
// ⭐ ONE MARKER OWNER. The markers are handed to StockChart's existing series-markers controller (the same one the
// BUY/SELL props, news, desk and flow markers use) — never a second `createSeriesMarkers` fighting it.
//
// PLACEMENT (the chart's own bar times, barTime.js — ET wall clock): an intraday fill goes on the loaded bar whose
// bucket holds `toChartTime(fill)` (any minute timeframe, 60m session or clock grid); with extended hours hidden a
// pre/post-market fill is skipped. Daily / multi-day / monthly bars are labelled by their first day, weekly bars by
// their Friday close, so a fill's ET date goes on the bar that covers it. A date-only journal entry (a bare date or
// exact UTC midnight — the journal's own convention) draws on daily-and-up bars only. A fill outside the loaded bars
// is skipped (lightweight-charts would otherwise snap it onto the nearest bar).
//
// ⭐ UCT Signature: the chart's own up / down candle colours at reduced strength — never gold.

import useSWR from 'swr'
import { useMemo } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import { toChartTime, etDateOf, isRthChartTime } from './barTime'
import { parseTf } from './timeframes'

export const MY_TRADES_POSITIONS_KEY = '/api/j2/positions'
export const MY_TRADE_ID_PREFIX = 'uct-mytrade:'
export const MY_TRADE_STRENGTH = 0.6
export const MY_TRADE_SIZE = 0.6
export const EMPTY_MY_TRADES = Object.freeze({ markers: Object.freeze([]), tips: Object.freeze({}), key: '' })

const _symU = (s) => String(s || '').trim().toUpperCase()

/** The journal trades read for `sym` (prefix-matched server side), or null. */
export function myTradesUrl(sym) {
  const s = _symU(sym)
  return s ? `/api/j2/trades?symbol=${encodeURIComponent(s)}` : null
}

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

/** A journal timestamp → { unix, date, dateOnly } (null when unreadable). Naive strings are UTC (the journal's rule). */
export function parseFillTime(raw) {
  if (typeof raw !== 'string' || !raw) return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { unix: null, date: s, dateOnly: true }
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const unix = Math.floor(ms / 1000)
  if (unix % 86400 === 0) return { unix: null, date: new Date(ms).toISOString().slice(0, 10), dateOnly: true }
  return { unix, date: etDateOf(unix), dateOnly: false }
}

const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }

/** Every fill of `sym` in the journal's answers: [{ side: 'buy'|'sell', qty, price, at: parseFillTime(...) }]. Pure. */
export function fillsFrom(tradesBody, positionsBody, sym) {
  const s = _symU(sym)
  const out = []
  if (!s) return out
  const push = (side, qty, price, raw) => {
    const at = parseFillTime(raw)
    if (!at || !(qty > 0) || !(price > 0)) return
    out.push({ side, qty, price, at })
  }
  const trades = Array.isArray(tradesBody?.trades) ? tradesBody.trades : []
  for (const t of trades) {
    if (!t || _symU(t.symbol) !== s) continue
    const long = t.side !== 'Short'
    const qty = _num(t.shares)
    push(long ? 'buy' : 'sell', qty, _num(t.entryPrice), t.entryDate)
    push(long ? 'sell' : 'buy', qty, _num(t.exitPrice), t.exitDate)
  }
  const positions = Array.isArray(positionsBody?.positions) ? positionsBody.positions : []
  for (const p of positions) {
    if (!p || _symU(p.symbol) !== s || p.entryEstimated) continue
    push(p.side === 'Short' ? 'sell' : 'buy', _num(p.shares), _num(p.entryPrice), p.entryDate)
  }
  return out
}

/** The member's fills on `sym` while `on` (else null, and nothing is fetched). */
export function useMyTradeFills(on, sym) {
  const url = on ? myTradesUrl(sym) : null
  const { data: tradesBody } = useSWR(url, fetcher, { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 30000 })
  const { data: positionsBody } = useMobileSWR(on && url ? MY_TRADES_POSITIONS_KEY : null, fetcher, {
    refreshInterval: 60000, marketHoursOnly: true, revalidateOnFocus: false, shouldRetryOnError: false,
  })
  return useMemo(
    () => (url ? fillsFrom(tradesBody, positionsBody, sym) : null),
    [url, tradesBody, positionsBody, sym],
  )
}

// ── fill → bar ──
const _dayNum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000)
const _monthNum = (d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1

/** Index of the last bar whose time ≤ t (bars ascending), or -1. */
function _lastAtOrBefore(bars, t) {
  let lo = 0, hi = bars.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].time <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

/**
 * The loaded bar time a fill belongs to on timeframe `tf`, or null (outside the loaded range, a gap, a date-only
 * fill on an intraday chart, or a pre/post-market fill while extended hours are hidden). `bars` = the candle
 * series' own data, ascending: chart-time numbers intraday, 'YYYY-MM-DD' strings daily and up. Pure.
 */
export function fillBarTime(at, bars, tf, { extended = true } = {}) {
  if (!at || !Array.isArray(bars) || !bars.length) return null
  const p = parseTf(tf)
  if (p.minutes != null) {
    if (at.dateOnly || at.unix == null || !(p.minutes > 0)) return null
    if (typeof bars[0].time !== 'number') return null
    const t = toChartTime(at.unix)
    if (!extended && !isRthChartTime(t)) return null
    const i = _lastAtOrBefore(bars, t)
    if (i < 0) return null
    return t - bars[i].time < p.minutes * 60 ? bars[i].time : null
  }
  if (typeof bars[0].time !== 'string') return null
  const d = at.date
  const count = p.count > 0 ? p.count : 1
  if (p.unit === 'weeks') {
    // Weekly bars are labelled by their Friday close: the first bar on or after the fill's date, within the week.
    const i = _lastAtOrBefore(bars, d)
    const j = i >= 0 && bars[i].time === d ? i : i + 1
    if (j >= bars.length) return null
    const gap = _dayNum(bars[j].time) - _dayNum(d)
    return gap >= 0 && gap < 7 * count ? bars[j].time : null
  }
  const i = _lastAtOrBefore(bars, d)
  if (i < 0) return null
  const bt = bars[i].time
  if (p.unit === 'months') return _monthNum(d) - _monthNum(bt) < count ? bt : null
  if (count === 1) return bt === d ? bt : null
  // Multi-day bars: the next bar starts the next block; past the last one, allow the block's calendar span.
  if (i + 1 < bars.length) return bt
  return _dayNum(d) - _dayNum(bt) < Math.ceil(count * 7 / 5) + 2 ? bt : null
}

// ── how it reads ──
const _ET_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
const _ET_DATETIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})
const _trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)
export const fmtQty = (q) => (Number.isInteger(q) ? String(q) : _trim(q.toFixed(4)))
export const fmtPrice = (p) => (p >= 1 ? p.toFixed(2) : _trim(p.toFixed(4)))
export function fmtFillWhen(at) {
  if (at.dateOnly) return _ET_DATE.format(new Date(`${at.date}T00:00:00Z`))
  return _ET_DATETIME.format(new Date(at.unix * 1000))
}

/** One fill: "Bought 100 @ 12.34 · Mar 2, 2026, 10:31 AM". */
export function fillTitle(f) {
  return `${f.side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(f.qty)} @ ${fmtPrice(f.price)} · ${fmtFillWhen(f.at)}`
}

/** A bar's fills as one line: the single fill's title, or "3 fills · net +200". */
export function barFillsTitle(fills) {
  if (fills.length === 1) return fillTitle(fills[0])
  const net = fills.reduce((s, f) => s + (f.side === 'buy' ? f.qty : -f.qty), 0)
  const r = Math.round(net * 10000) / 10000
  return `${fills.length} fills · net ${r > 0 ? '+' : r < 0 ? '-' : ''}${fmtQty(Math.abs(r))}`
}

/** `color` at `strength` alpha (hex / rgb() / rgba()); anything unreadable is returned as given. Pure. */
export function mutedTone(color, strength = MY_TRADE_STRENGTH) {
  const c = String(color || '').trim()
  let r, g, b, a = 1
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  } else if ((m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i))) {
    r = Math.round(+m[1]); g = Math.round(+m[2]); b = Math.round(+m[3]); a = m[4] != null ? +m[4] : 1
  } else return c
  const al = Math.round(a * strength * 1000) / 1000
  return `rgba(${r},${g},${b},${al})`
}

/**
 * The markers to draw: per bar, an up-arrow below it when it holds a buy and a down-arrow above it when it holds a
 * sell, each carrying an `id` the chart's hover reports (`tips[id]` is its tooltip). `key` names what is drawn, so the
 * chart can keep the same array while nothing changed. Pure.
 */
export function buildMyTradeMarkers(fills, bars, tf, { upColor, downColor, extended = true } = {}) {
  if (!Array.isArray(fills) || !fills.length || !Array.isArray(bars) || !bars.length) return EMPTY_MY_TRADES
  const byBar = new Map()
  for (const f of fills) {
    const t = fillBarTime(f.at, bars, tf, { extended })
    if (t == null) continue
    if (!byBar.has(t)) byBar.set(t, [])
    byBar.get(t).push(f)
  }
  if (!byBar.size) return EMPTY_MY_TRADES
  const up = mutedTone(upColor || '#2faf68')
  const down = mutedTone(downColor || '#df4646')
  const times = [...byBar.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const markers = []
  const tips = {}
  for (const t of times) {
    const fs = byBar.get(t)
    const title = barFillsTitle(fs)
    if (fs.some((f) => f.side === 'buy')) {
      const id = `${MY_TRADE_ID_PREFIX}${t}:b`
      markers.push({ time: t, position: 'belowBar', shape: 'arrowUp', color: up, size: MY_TRADE_SIZE, id })
      tips[id] = title
    }
    if (fs.some((f) => f.side === 'sell')) {
      const id = `${MY_TRADE_ID_PREFIX}${t}:s`
      markers.push({ time: t, position: 'aboveBar', shape: 'arrowDown', color: down, size: MY_TRADE_SIZE, id })
      tips[id] = title
    }
  }
  const key = markers.map((m) => `${m.id}|${m.color}|${tips[m.id]}`).join(',')
  return { markers, tips, key }
}

/** `next` unless it draws exactly what `prev` draws (then `prev`, so identity-guarded appliers skip). Pure. */
export const sameMyTrades = (prev, next) => (prev && next && prev.key === next.key ? prev : next)

/** The chart's existing markers plus these, ascending by time (what the one markers controller is handed). Pure. */
export function withMyTradeMarkers(markers, mine) {
  const all = [...(markers || []), ...(mine || [])]
  if (!mine || !mine.length) return all
  return all.sort((a, b) => {
    const ta = a?.time, tb = b?.time
    if (typeof ta === 'number' && typeof tb === 'number') return ta - tb
    return String(ta).localeCompare(String(tb))
  })
}
