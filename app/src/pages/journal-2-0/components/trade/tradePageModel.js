/**
 * tradePageModel — pure helpers for the unified closed-trade detail page
 * (/journal-2-0/trade/:id). No React, no I/O: every function is a pure
 * transform of the Task-1 trade payload so they're trivially unit-tested.
 *
 * Three exports:
 *   outcomeModel(trade)          → the outcome-header view-model
 *   buildTradeMarkers(trade, tf) → LW-charts markers + price lines for THIS
 *                                  trade only (useJ2ChartMarkers builds them
 *                                  for EVERY trade in a symbol, so it can't be
 *                                  reused for a single-trade page)
 *   neighborIds(trades, filters, currentId) → { prevId, nextId } honoring the
 *                                  SAME filters the table linked with
 */

import { rMultiple as fmtR } from '../../../../lib/journal-2-0'
import { applyFilters } from '../../hooks/useJ2Filters'
import { computeBarTime } from '../../../../components/chart/barTime'

const COLOR_GREEN = '#22c55e'
const COLOR_RED = '#ef4444'
const COLOR_BE = '#eab308'

const EMPTY_MARKERS = { markers: [], priceLines: [] }

/**
 * The R-multiple is undefined when no stop was ever logged. The Task-1 payload
 * signals this as `rMultiple == null` AND `originalStop === entryPrice` (broker
 * imports store the entry as a placeholder stop). Distinct from "R just isn't
 * computed" — a real stop with a null R still shows a plain dash.
 */
export function isNoStop(trade) {
  return (
    trade.rMultiple == null &&
    Number(trade.originalStop) === Number(trade.entryPrice)
  )
}

function holdLabelFor(trade) {
  const n = trade.holdDays
  if (n == null || !Number.isFinite(n)) return '—'
  if (n <= 0) return 'Same day'
  return `${n} day${n === 1 ? '' : 's'}`
}

/**
 * Outcome-header view-model. `netPnl` uses the UI's Net convention
 * (`pnlDollarNet ?? pnlDollar`); `pnlPct` stays the raw FRACTION (the caller
 * formats via percent() with the ratio convention).
 *
 * `exitEfficiency` + the `mfeR`/`maeR`/`missedR`/`dataQuality` display fields
 * come from the OPTIONAL P2 excursion dict (nightly intraday excursion
 * analysis, camelCase from `excursions_store._row_to_dict`). When no excursion
 * is passed (or it's null / not yet computed) every excursion field is null so
 * the header can render its honest "pending" / "N/A" states. PURE.
 *
 * @param {object} trade
 * @param {object|null} [excursion]  {exitEfficiency, mfeR, maeR, missedR,
 *   dataQuality, ...} or null
 * @returns {{netPnl:number|null, pnlPct:number|null, r:number|null,
 *   rLabel:string, holdLabel:string, noStop:boolean,
 *   exitEfficiency:number|null, mfeR:number|null, maeR:number|null,
 *   missedR:number|null, dataQuality:string|null}}
 */
export function outcomeModel(trade, excursion = null) {
  const t = trade || {}
  const ex = excursion || {}
  const netPnl = t.pnlDollarNet ?? t.pnlDollar ?? null
  const pnlPct = t.pnlPercent ?? null
  const r = t.rMultiple ?? null
  const noStop = isNoStop(t)
  const rLabel = noStop ? 'R: — (no stop logged)' : `R: ${fmtR(r)}`
  return {
    netPnl,
    pnlPct,
    r,
    rLabel,
    holdLabel: holdLabelFor(t),
    noStop,
    exitEfficiency: ex.exitEfficiency ?? null,
    mfeR: ex.mfeR ?? null,
    maeR: ex.maeR ?? null,
    missedR: ex.missedR ?? null,
    trueR: ex.trueR ?? null,
    dataQuality: ex.dataQuality ?? null,
  }
}

// ── Chart markers (single trade) ────────────────────────────────────────────

function markerTimeFor(tf, isoDate) {
  if (!isoDate) return null
  const d = new Date(isoDate)
  const sec = Math.floor(d.getTime() / 1000)
  if (!Number.isFinite(sec)) return null
  return computeBarTime(tf, sec)
}

function compareTime(a, b) {
  const aIsStr = typeof a.time === 'string'
  const bIsStr = typeof b.time === 'string'
  if (aIsStr && bIsStr) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
  if (!aIsStr && !bIsStr) return a.time - b.time
  const aMs = aIsStr ? new Date(a.time).getTime() : Number(a.time) * 1000
  const bMs = bIsStr ? new Date(b.time).getTime() : Number(b.time) * 1000
  return aMs - bMs
}

/**
 * Markers (entry + exit arrows) and price lines (entry green, original stop
 * red) for a SINGLE closed trade on the given timeframe. Exit arrow colored by
 * result (Win green / Loss red / BE yellow). The stop line is omitted when no
 * real stop was logged (originalStop == entryPrice) so it doesn't overdraw the
 * entry line. Shapes mirror useJ2ChartMarkers.js.
 *
 * When a real P2 `excursion` is passed, two extra DOTTED horizontal lines are
 * drawn — MFE (best price reached, green) + MAE (worst price reached, red) —
 * distinct from the DASHED entry/stop lines. Gracefully skipped for the
 * insufficient tier (null prices) or when no excursion is passed.
 *
 * @param {object} trade
 * @param {string} tf  "1"|"5"|"15"|"30"|"60"|"D"|"W"|"M"
 * @param {object|null} [excursion]  {mfePrice, maePrice, ...} or null
 * @returns {{ markers: Array, priceLines: Array }}
 */
export function buildTradeMarkers(trade, tf, excursion = null) {
  if (!trade || !tf) return EMPTY_MARKERS
  const isLong = trade.side === 'Long'
  const markers = []
  const priceLines = []

  const entryTime = markerTimeFor(tf, trade.entryDate)
  if (entryTime != null) {
    markers.push({
      time: entryTime,
      position: isLong ? 'belowBar' : 'aboveBar',
      color: isLong ? COLOR_GREEN : COLOR_RED,
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `${isLong ? 'BUY' : 'SHORT'}${trade.shares != null ? ` ${trade.shares}` : ''}`,
      size: 2,
    })
  }

  const exitTime = markerTimeFor(tf, trade.exitDate)
  if (exitTime != null) {
    const exitColor =
      trade.result === 'Win' ? COLOR_GREEN
        : trade.result === 'Loss' ? COLOR_RED
          : COLOR_BE
    markers.push({
      time: exitTime,
      position: isLong ? 'aboveBar' : 'belowBar',
      color: exitColor,
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `${isLong ? 'SELL' : 'COVER'}${trade.result ? ` ${trade.result}` : ''}`,
      size: 2,
    })
  }

  const entryPrice = Number(trade.entryPrice)
  if (Number.isFinite(entryPrice) && entryPrice > 0) {
    priceLines.push({
      price: entryPrice,
      color: COLOR_GREEN,
      lineWidth: 1,
      lineStyle: 2,               // dashed
      axisLabelVisible: true,
      title: 'Entry',
    })
  }

  const stop = Number(trade.originalStop)
  if (Number.isFinite(stop) && stop > 0 && stop !== entryPrice) {
    priceLines.push({
      price: stop,
      color: COLOR_RED,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: 'Stop',
    })
  }

  // P2 excursion overlay — MFE (best) green + MAE (worst) red, DOTTED so they
  // read as distinct from the DASHED entry/stop lines. Only real records carry
  // finite prices (the insufficient tier stores null → skipped).
  const mfe = Number(excursion?.mfePrice)
  if (Number.isFinite(mfe) && mfe > 0) {
    priceLines.push({
      price: mfe,
      color: COLOR_GREEN,
      lineWidth: 1,
      lineStyle: 1,               // dotted
      axisLabelVisible: true,
      title: 'MFE',
    })
  }
  const mae = Number(excursion?.maePrice)
  if (Number.isFinite(mae) && mae > 0) {
    priceLines.push({
      price: mae,
      color: COLOR_RED,
      lineWidth: 1,
      lineStyle: 1,               // dotted
      axisLabelVisible: true,
      title: 'MAE',
    })
  }

  markers.sort(compareTime)
  return { markers, priceLines }
}

// ── Prev/next neighbors ─────────────────────────────────────────────────────

/**
 * Previous/next trade ids for the header ‹ › nav + j/k/arrow keys. Applies the
 * SAME URL filters the table linked with so the page walks the exact set the
 * user was looking at, in array order. Nulls at the ends and when the current
 * id isn't in the filtered set (e.g. an option id, or a filtered-out trade).
 *
 * @param {Array<object>} trades   equity trades from useJ2Trades
 * @param {object} filters         a useJ2Filters filter object
 * @param {string} currentId
 * @returns {{ prevId: string|null, nextId: string|null }}
 */
export function neighborIds(trades, filters, currentId) {
  const list = applyFilters(trades || [], filters)
  const i = list.findIndex((t) => t.id === currentId)
  if (i === -1) return { prevId: null, nextId: null }
  return {
    prevId: i > 0 ? list[i - 1].id : null,
    nextId: i < list.length - 1 ? list[i + 1].id : null,
  }
}
