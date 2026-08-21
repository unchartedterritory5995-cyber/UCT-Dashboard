// app/src/pages/journal-2-0/lib/monthCardPng.js
//
// Journal 2.0 — month-recap card PNG export. Completes the share-card family
// (tradeCardPng / edgeCardPng / dayCardPng): same 1200×630 dark/gold brand,
// module-private canvas helpers by the family's convention.
//
// renderMonthCardPng(monthLabel, days, totals) -> Promise<Blob>
//
// PURE / deterministic given its inputs (no Date.now / new Date()); every
// value dash-guarded — an empty month never throws or draws "undefined".

import { moneySigned } from '../../../lib/journal-2-0'

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

function drawCard(ctx, monthLabel, days, totals) {
  const t = totals || {}
  const traded = (days || []).filter((d) => (d.tradeCount || 0) > 0)
  const green = traded.filter((d) => (d.pnlDollar || 0) > 0)
  const best = traded.length
    ? traded.reduce((a, b) => ((b.pnlDollar || 0) > (a.pnlDollar || 0) ? b : a))
    : null

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = PANEL
  ctx.fillRect(0, 0, W, 118)
  ctx.fillStyle = GOLD
  ctx.fillRect(0, 0, W, 6)

  drawText(ctx, 'UCT INTELLIGENCE', PAD, 46, { font: `700 22px ${FACE}`, color: GOLD })
  drawText(ctx, 'MONTH RECAP', W - PAD, 50, {
    font: `600 18px ${FACE}`, color: MUTED, align: 'right',
  })

  drawText(ctx, monthLabel || DASH, PAD, 150, { font: `800 56px ${FACE}`, color: TEXT })

  const net = t.netPnlDollar ?? t.pnlDollar ?? null
  drawText(ctx, 'NET P&L', PAD, 246, { font: `600 17px ${FACE}`, color: MUTED })
  const netFont = `800 84px ${FACE}`
  const netText = moneySigned(net)
  drawText(ctx, netText, PAD, 272, { font: netFont, color: pnlColor(net) })
  const netW = textWidth(ctx, netText, netFont)
  const wl = (t.winners || 0) + (t.losers || 0)
  if (wl > 0) {
    drawText(ctx, `${((t.winners / wl) * 100).toFixed(0)}% win rate`, PAD + netW + 36, 310, {
      font: `700 32px ${FACE}`, color: TEXT,
    })
  }

  // ── Day heat strip — one square per TRADED day, in date order ───────────
  const stripY = 400
  if (traded.length) {
    const size = Math.min(26, Math.floor((W - PAD * 2) / traded.length) - 4)
    traded.forEach((d, i) => {
      ctx.fillStyle = (d.pnlDollar || 0) > 0 ? GREEN
        : (d.pnlDollar || 0) < 0 ? RED : MUTED
      ctx.globalAlpha = 0.85
      ctx.fillRect(PAD + i * (size + 4), stripY, size, size)
      ctx.globalAlpha = 1
    })
    drawText(ctx, `${green.length} green day${green.length === 1 ? '' : 's'} of ${traded.length}`,
      PAD, stripY - 26, { font: `600 15px ${FACE}`, color: MUTED })
  }

  const statsY = 470
  const cellW = (W - PAD * 2) / 4
  const cells = [
    { label: 'TRADES', value: t.tradeCount != null ? String(t.tradeCount) : DASH, color: TEXT },
    {
      label: 'WINNERS / LOSERS',
      value: (t.winners != null && t.losers != null) ? `${t.winners} / ${t.losers}` : DASH,
      color: TEXT,
    },
    {
      label: 'GREEN DAYS',
      value: traded.length ? `${green.length} / ${traded.length}` : DASH,
      color: GOLD,
    },
    {
      label: 'BEST DAY',
      value: best ? `${moneySigned(best.pnlDollar ?? null)} (${best.date})` : DASH,
      color: best ? pnlColor(best.pnlDollar) : TEXT,
    },
  ]
  cells.forEach((c, i) => {
    const x = PAD + cellW * i
    drawText(ctx, c.label, x, statsY, { font: `600 14px ${FACE}`, color: MUTED })
    drawText(ctx, c.value, x, statsY + 24, { font: `700 24px ${FACE}`, color: c.color })
  })

  ctx.fillStyle = 'rgba(201,168,76,0.35)'
  ctx.fillRect(PAD, H - 92, W - PAD * 2, 1)
  drawText(ctx, 'UCT INTELLIGENCE', PAD, H - 76, { font: `700 18px ${FACE}`, color: GOLD })
  drawText(ctx, 'Navigate the market, effectively.', PAD, H - 50, {
    font: `italic 500 15px ${FACE}`, color: MUTED,
  })
  drawText(ctx, 'uctintelligence.com', W - PAD, H - 60, {
    font: `600 15px ${FACE}`, color: MUTED, align: 'right',
  })
}

/**
 * Render the branded month-recap card to a PNG Blob.
 * @param {string} monthLabel e.g. "August 2026"
 * @param {Array}  days       calendar days ({date, pnlDollar, tradeCount})
 * @param {object} totals     month totals ({netPnlDollar, tradeCount, winners, losers})
 */
export function renderMonthCardPng(monthLabel, days, totals) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'))
  drawCard(ctx, monthLabel, days, totals)
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
