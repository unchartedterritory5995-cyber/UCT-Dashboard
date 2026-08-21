// app/src/pages/journal-2-0/lib/dayCardPng.js
//
// Journal 2.0 — day-recap card PNG export (the calendar-day sibling of
// lib/tradeCardPng.js / lib/edgeCardPng.js).
//
// renderDayCardPng(dateLabel, metrics, trades) -> Promise<Blob>
//
// Hand-draws a branded dark/gold shareable card of ONE trading day onto an
// offscreen <canvas> and returns it as a PNG Blob. Dependency-free (canvas-draw
// only), mirroring tradeCardPng's structure — same #c9a84c gold, wordmark,
// tagline footer. tradeCardPng keeps its canvas helpers MODULE-PRIVATE by
// design, so this parallel file re-declares them rather than importing.
//
// PURE / deterministic given (dateLabel, metrics, trades): no Date.now /
// new Date() in the drawing — the same day always renders byte-identically.
// Every value is dash-guarded ("—" for null/NaN); a day with no metrics or an
// empty trade list never throws or draws "undefined".

import { moneySigned, rMultiple } from '../../../lib/journal-2-0'

const W = 1200
const H = 630
const PAD = 64

const GOLD = '#c9a84c'
const BG = '#0b0b0d'
const PANEL = '#101013'
const TEXT = '#e8e6e1'
const MUTED = '#8a8a8a'
const GREEN = '#22c55e'
const RED = '#ef4444'

const FACE = '"Instrument Sans", -apple-system, system-ui, "Segoe UI", sans-serif'
const DASH = '—'

function pnlColor(n) {
  if (!Number.isFinite(n)) return TEXT
  if (n > 0) return GREEN
  if (n < 0) return RED
  return MUTED
}

function drawText(ctx, text, x, y, { font, color, align = 'left', baseline = 'top' }) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.fillText(text, x, y)
}

function textWidth(ctx, text, font) {
  ctx.font = font
  const m = ctx.measureText(text)
  return (m && Number.isFinite(m.width)) ? m.width : 0
}

/** Top movers strip: up to 4 trades by |P&L| — the names people brag about. */
function topTrades(trades) {
  return [...(trades || [])]
    .filter((t) => t && t.symbol)
    .sort((a, b) => Math.abs(b.pnlDollar ?? 0) - Math.abs(a.pnlDollar ?? 0))
    .slice(0, 4)
}

function drawCard(ctx, dateLabel, metrics, trades) {
  const m = metrics || {}

  // ── Background + header band + gold rule ────────────────────────────────
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = PANEL
  ctx.fillRect(0, 0, W, 118)
  ctx.fillStyle = GOLD
  ctx.fillRect(0, 0, W, 6)

  drawText(ctx, 'UCT INTELLIGENCE', PAD, 46, {
    font: `700 22px ${FACE}`,
    color: GOLD,
  })
  drawText(ctx, 'DAY RECAP', W - PAD, 50, {
    font: `600 18px ${FACE}`,
    color: MUTED,
    align: 'right',
  })

  // ── Date title ──────────────────────────────────────────────────────────
  drawText(ctx, dateLabel || DASH, PAD, 150, {
    font: `800 56px ${FACE}`,
    color: TEXT,
  })

  // ── Net P&L (hero) + win rate beside it ─────────────────────────────────
  const net = m.netPnlDollar ?? null
  drawText(ctx, 'NET P&L', PAD, 252, { font: `600 17px ${FACE}`, color: MUTED })
  const netFont = `800 84px ${FACE}`
  const netText = moneySigned(net)
  drawText(ctx, netText, PAD, 278, { font: netFont, color: pnlColor(net) })
  const netW = textWidth(ctx, netText, netFont)
  const wr = m.winRate
  if (wr != null && Number.isFinite(wr)) {
    drawText(ctx, `${(wr * 100).toFixed(0)}% win rate`, PAD + netW + 36, 316, {
      font: `700 32px ${FACE}`,
      color: TEXT,
    })
  }

  // ── Stat row (Trades · W/L · R-sum · Best) ──────────────────────────────
  const best = topTrades(trades)[0]
  const statsY = 432
  const cellW = (W - PAD * 2) / 4
  const cells = [
    { label: 'TRADES', value: m.tradeCount != null ? String(m.tradeCount) : DASH, color: TEXT },
    {
      label: 'WINNERS / LOSERS',
      value: (m.winners != null && m.losers != null) ? `${m.winners} / ${m.losers}` : DASH,
      color: TEXT,
    },
    { label: 'R-SUM', value: rMultiple(m.rSum ?? null), color: GOLD },
    {
      label: 'BEST TRADE',
      value: best ? `${best.symbol} ${moneySigned(best.pnlDollar ?? null)}` : DASH,
      color: best ? pnlColor(best.pnlDollar) : TEXT,
    },
  ]
  cells.forEach((c, i) => {
    const x = PAD + cellW * i
    drawText(ctx, c.label, x, statsY, { font: `600 14px ${FACE}`, color: MUTED })
    drawText(ctx, c.value, x, statsY + 24, { font: `700 26px ${FACE}`, color: c.color })
  })

  // ── Footer (identical to the trade card) ────────────────────────────────
  ctx.fillStyle = 'rgba(201,168,76,0.35)'
  ctx.fillRect(PAD, H - 92, W - PAD * 2, 1)
  drawText(ctx, 'UCT INTELLIGENCE', PAD, H - 76, {
    font: `700 18px ${FACE}`,
    color: GOLD,
  })
  drawText(ctx, 'Navigate the market, effectively.', PAD, H - 50, {
    font: `italic 500 15px ${FACE}`,
    color: MUTED,
  })
  drawText(ctx, 'uctintelligence.com', W - PAD, H - 60, {
    font: `600 15px ${FACE}`,
    color: MUTED,
    align: 'right',
  })
}

/**
 * Render the branded day-recap card to a PNG Blob.
 *
 * @param {string} dateLabel  pre-formatted day title (e.g. "Thursday, August 21, 2026")
 * @param {object} metrics    day metrics (netPnlDollar, winRate, tradeCount,
 *   winners, losers, rSum). Missing fields render as "—".
 * @param {Array}  trades     the day's trades (symbol, pnlDollar) for the
 *   best-trade cell. Empty is fine.
 * @returns {Promise<Blob>} PNG image blob.
 */
export function renderDayCardPng(dateLabel, metrics, trades) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'))
  drawCard(ctx, dateLabel, metrics, trades)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('toBlob returned null'))
      },
      'image/png',
    )
  })
}
