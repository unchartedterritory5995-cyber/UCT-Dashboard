/**
 * Per-stock detail page models (Phase 3 of the RH Journal initiative).
 * Pure functions — no React, no fetch. RH semantics per the design spec:
 *   Your Position = Shares · Market value · Average cost · Portfolio
 *   diversity · Today's return · Total return; the Stats list is CLOSED;
 *   analyst buckets: Buy = strongBuy+buy, Sell = sell+strongSell.
 */
import { currentPriceFor, positionPnlDollar, money } from '../../../lib/journal-2-0'

const fin = (v) => (Number.isFinite(v) ? v : null)
const DASH = '—'

function prevCloseOf(snap) {
  if (!snap) return null
  if (Number.isFinite(snap.prev_close)) return snap.prev_close
  if (Number.isFinite(snap.price) && Number.isFinite(snap.change_pct)) {
    const pc = snap.price / (1 + snap.change_pct / 100)
    return Number.isFinite(pc) ? pc : null
  }
  return null
}

/** Volume display: 950 · 12.50K · 2.00M · 3.10B. Null → —. */
export function fmtVolume(v) {
  if (!Number.isFinite(v)) return DASH
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return String(Math.round(v))
}

/**
 * The six RH "Your Position" figures for an open J2 equity position.
 * Today's return uses the Phase-2 reference rule: fill price for same-day
 * entries, else prev close (derived from change_pct when the feed lacks it).
 */
export function yourPositionModel(position, snap, netLiq, todayIso) {
  if (!position) return null
  const prices = snap ? { [position.symbol]: snap } : {}
  const price = fin(currentPriceFor(position, prices))
  const signed = (position.side === 'Short' ? -1 : 1) * (position.shares || 0)
  // entryDate is a FULL ISO timestamp — date-part compare (see brokerLiveSummary).
  const openedToday =
    todayIso && position.entryDate && String(position.entryDate).slice(0, 10) === todayIso
  const ref = openedToday ? fin(position.entryPrice) : prevCloseOf(snap)
  const livePrice = fin(snap?.price)
  const todayDollar = livePrice != null && ref != null ? signed * (livePrice - ref) : null
  const marketValue = price == null ? null : Math.abs(position.shares || 0) * price
  const totalReturnDollar = price == null ? null : positionPnlDollar(position, price)
  const basis = (position.entryPrice || 0) * (position.shares || 0)
  return {
    shares: position.shares,
    side: position.side,
    marketValue,
    avgCost: fin(position.entryPrice),
    diversityPct: marketValue != null && Number.isFinite(netLiq) && netLiq
      ? marketValue / netLiq
      : null,
    todayDollar,
    todayPct: todayDollar != null && ref ? todayDollar / (Math.abs(signed) * ref) : null,
    totalReturnDollar,
    totalReturnPct: totalReturnDollar != null && basis ? totalReturnDollar / basis : null,
  }
}

/**
 * The CLOSED RH stats list, in RH order. `metrics` = research-snapshot
 * metrics; `dailyBars` = /api/bars tf=D (today = last bar; avg volume =
 * mean over the window). Missing values render as em-dashes.
 */
export function statsModel(metrics = {}, dailyBars = []) {
  const bars = (dailyBars || []).filter((b) => b && Number.isFinite(b.v))
  const today = bars.length ? bars[bars.length - 1] : null
  const avgVol = bars.length
    ? bars.reduce((s, b) => s + b.v, 0) / bars.length
    : null
  const m = metrics || {}
  const $ = (v) => (Number.isFinite(v) ? money(v) : DASH)
  const num = (v, suffix = '') => (Number.isFinite(v) ? `${v}${suffix}` : DASH)
  return [
    { label: 'Market cap', value: m.market_cap || DASH },
    { label: 'P/E ratio', value: num(m.pe_forward ?? m.pe_trailing) },
    { label: 'Div yield', value: num(m.div_yield_pct, '%') },
    { label: 'Avg volume', value: fmtVolume(avgVol) },
    { label: 'High today', value: $(today?.h) },
    { label: 'Low today', value: $(today?.l) },
    { label: 'Open', value: $(today?.o) },
    { label: 'Volume', value: fmtVolume(today?.v) },
    { label: '52wk high', value: $(m.week52_high) },
    { label: '52wk low', value: $(m.week52_low) },
  ]
}

/** RH analyst distribution from /api/earnings/analyst-grades consensus. */
export function analystModel(grades) {
  const c = grades?.consensus
  const total = c?.total
  if (!c || !Number.isFinite(total) || total <= 0) return null
  const buy = (c.strongBuy || 0) + (c.buy || 0)
  const sell = (c.sell || 0) + (c.strongSell || 0)
  return {
    total,
    buyPct: buy / total,
    holdPct: (c.hold || 0) / total,
    sellPct: sell / total,
    label: c.label || null,
  }
}
