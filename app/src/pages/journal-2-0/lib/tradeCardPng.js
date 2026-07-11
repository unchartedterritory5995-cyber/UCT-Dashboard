// app/src/pages/journal-2-0/lib/tradeCardPng.js
//
// Journal 2.0 P5 (Milestone B, Task B1) — trade-card PNG export.
//
// renderTradeCardPng(trade) -> Promise<Blob>
//
// Hand-draws a branded dark/gold shareable card of a SINGLE closed trade onto
// an offscreen <canvas> and returns it as a PNG Blob. Dependency-free
// (canvas-draw only — no html2canvas/dom-to-image), mirroring the brand-drawing
// style of components/chart/chartScreenshot.js::composeScreenshot (same
// #c9a84c gold, "UCT INTELLIGENCE" wordmark, tagline footer).
//
// PURE / deterministic given a trade: no Date.now / new Date() in the drawing,
// so the same trade always renders byte-identically. Every value routes through
// the shared Journal 2.0 formatters, which render "—" for null/NaN, so a trade
// missing pnl / setup / dates never throws or draws "undefined".

import { money, moneySigned, percent, rMultiple, dateShort } from '../../../lib/journal-2-0'

// Shareable OG-ish 1200×630.
const W = 1200
const H = 630
const PAD = 64

// Brand palette (mirrors chartScreenshot.js + the trade page CSS tokens).
const GOLD = '#c9a84c'
const BG = '#0b0b0d'
const PANEL = '#101013'
const TEXT = '#e8e6e1'
const MUTED = '#8a8a8a'
const GREEN = '#22c55e'
const RED = '#ef4444'

// Instrument Sans is the app's brand face; fall back through the system stack
// for any environment that hasn't loaded the webfont.
const FACE = '"Instrument Sans", -apple-system, system-ui, "Segoe UI", sans-serif'

const DASH = '—'

/** Net-P&L convention used across the trade page: net wins over gross. */
function netPnlOf(trade) {
  return trade?.pnlDollarNet ?? trade?.pnlDollar ?? null
}

/** Hold-time label — mirrors tradePageModel.holdLabelFor (kept inline so this
 *  module stays dependency-light: it imports only the pure formatters). */
function holdLabelOf(trade) {
  const n = trade?.holdDays
  if (n == null || !Number.isFinite(n)) return DASH
  if (n <= 0) return 'Same day'
  return `${n} day${n === 1 ? '' : 's'}`
}

/** Green for a positive number, red for negative, neutral text otherwise. */
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

/**
 * Draw the whole card. Separated from the Blob plumbing so the drawing is a
 * pure ctx-mutation (trivially assertable in a jsdom unit test with a stub 2d
 * context). Never throws on missing fields — every value is dash-guarded.
 */
function drawCard(ctx, trade) {
  const t = trade || {}

  // ── Background + top accent bar ─────────────────────────────────────────
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = PANEL
  ctx.fillRect(0, 0, W, 118)              // header band
  ctx.fillStyle = GOLD
  ctx.fillRect(0, 0, W, 6)                // gold top rule

  // ── Header: brand wordmark (left) + closed-date (right) ─────────────────
  drawText(ctx, 'UCT INTELLIGENCE', PAD, 46, {
    font: `700 22px ${FACE}`,
    color: GOLD,
  })
  drawText(ctx, `Closed ${dateShort(t.exitDate)}`, W - PAD, 50, {
    font: `500 18px ${FACE}`,
    color: MUTED,
    align: 'right',
  })

  // ── Symbol + side + result ──────────────────────────────────────────────
  const symFont = `800 92px ${FACE}`
  const sym = t.symbol || DASH
  drawText(ctx, sym, PAD, 150, { font: symFont, color: TEXT })
  const symW = textWidth(ctx, sym, symFont)

  let cursorX = PAD + symW + 30
  const side = (t.side || '').toUpperCase()
  if (side) {
    const sideFont = `800 30px ${FACE}`
    const sideColor = t.side === 'Long' ? GREEN : RED
    drawText(ctx, side, cursorX, 210, { font: sideFont, color: sideColor })
    cursorX += textWidth(ctx, side, sideFont) + 22
  }
  if (t.result) {
    const resFont = `700 26px ${FACE}`
    const resColor =
      t.result === 'Win' ? GREEN : t.result === 'Loss' ? RED : MUTED
    drawText(ctx, t.result, cursorX, 212, { font: resFont, color: resColor })
  }

  // ── Net P&L (hero) + P&L % ──────────────────────────────────────────────
  const net = netPnlOf(t)
  const pct = t.pnlPercent ?? null
  const netColor = pnlColor(net)
  drawText(ctx, 'NET P&L', PAD, 288, {
    font: `600 17px ${FACE}`,
    color: MUTED,
  })
  const netFont = `800 74px ${FACE}`
  const netText = moneySigned(net)
  drawText(ctx, netText, PAD, 314, { font: netFont, color: netColor })
  const netW = textWidth(ctx, netText, netFont)
  drawText(ctx, percent(pct, { dp: 2, signed: true }), PAD + netW + 32, 344, {
    font: `700 34px ${FACE}`,
    color: pnlColor(pct),
  })

  // ── Stat row (R · Entry→Exit · Setup · Hold) ────────────────────────────
  const statsY = 470
  const cellW = (W - PAD * 2) / 4
  const cells = [
    { label: 'R-MULTIPLE', value: rMultiple(t.rMultiple ?? null), color: GOLD },
    { label: 'ENTRY → EXIT', value: `${money(t.entryPrice)} → ${money(t.exitPrice)}`, color: TEXT },
    { label: 'SETUP', value: t.setup || DASH, color: TEXT },
    { label: 'HOLD', value: holdLabelOf(t), color: TEXT },
  ]
  cells.forEach((c, i) => {
    const x = PAD + cellW * i
    drawText(ctx, c.label, x, statsY, { font: `600 14px ${FACE}`, color: MUTED })
    drawText(ctx, c.value, x, statsY + 24, { font: `700 26px ${FACE}`, color: c.color })
  })

  // ── Footer: hairline + brand + tagline + domain ─────────────────────────
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
 * Render the branded trade card to a PNG Blob.
 *
 * @param {object} trade  the closed-trade payload (symbol, side, entryPrice,
 *   exitPrice, pnlDollar/pnlDollarNet, pnlPercent, rMultiple, setup, holdDays,
 *   exitDate, result). Missing fields render as "—".
 * @returns {Promise<Blob>} PNG image blob.
 */
export function renderTradeCardPng(trade) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'))
  drawCard(ctx, trade)
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
