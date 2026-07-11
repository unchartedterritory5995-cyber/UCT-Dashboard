// app/src/pages/journal-2-0/lib/edgeCardPng.js
//
// Journal 2.0 P5 (Milestone B, Task B2) — Edge-Score card PNG export.
//
// renderEdgeCardPng(edgeScore) -> Promise<Blob>
//
// Hand-draws a branded dark/gold shareable card of the weekly Edge Score onto an
// offscreen <canvas> and returns it as a PNG Blob. Dependency-free (canvas-draw
// only — no html2canvas/dom-to-image), mirroring the brand-drawing style of
// lib/tradeCardPng.js (Task B1) + components/chart/chartScreenshot.js — same
// #c9a84c gold, "UCT INTELLIGENCE" wordmark, tagline footer.
//
// tradeCardPng.js keeps its canvas helpers (drawText/textWidth/palette) MODULE-
// PRIVATE (nothing exported to reuse), so this is the sanctioned parallel file
// mirroring B1's structure rather than duplicating a would-be shared export.
//
// PURE / deterministic given an edgeScore: no Date.now / new Date() in the
// drawing, so the same input always renders byte-identically. Every value is
// dash-guarded (renders "—" for null/NaN), so a partial/absent edgeScore never
// throws or draws "undefined". A null score (n<10 / no R-multiples) draws an
// honest "not enough data" card rather than a fabricated number.

// Shareable OG-ish 1200×630 (matches tradeCardPng.js).
const W = 1200
const H = 630
const PAD = 64

// Brand palette (mirrors tradeCardPng.js + chartScreenshot.js + the card CSS).
const GOLD = '#c9a84c'
const GOLD_BRIGHT = '#e8d18c'
const BG = '#0b0b0d'
const PANEL = '#101013'
const TEXT = '#e8e6e1'
const MUTED = '#8a8a8a'

// Instrument Sans is the app's brand face; fall back through the system stack
// for any environment that hasn't loaded the webfont.
const FACE = '"Instrument Sans", -apple-system, system-ui, "Segoe UI", sans-serif'

const DASH = '—'

// ── formatters ──────────────────────────────────────────────────────────────
// Mirror EdgeScoreCard.jsx's on-screen formatters so the PNG reads identically
// to the card, and dash-guard null/NaN so a missing component never draws
// "undefined"/"null".
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const fmtScore = (v) => (isNum(v) ? v.toFixed(3) : DASH)
const fmtPct1 = (v) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : DASH)
const fmtPct0 = (v) => (isNum(v) ? `${(v * 100).toFixed(0)}%` : DASH)
const fmtPF = (v) => (isNum(v) ? (v >= 5 ? '5.0+' : v.toFixed(2)) : DASH)
const fmtInt = (v) => (isNum(v) ? String(v) : DASH)

function drawText(ctx, text, x, y, { font, color, align = 'left', baseline = 'top' }) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.fillText(text, x, y)
}

/**
 * Draw the whole card. Separated from the Blob plumbing so the drawing is a
 * pure ctx-mutation (trivially assertable in a jsdom unit test with a stub 2d
 * context). Never throws on missing fields — every value is dash-guarded.
 */
function drawCard(ctx, edgeScore) {
  const e = edgeScore || {}
  const c = e.components || {}
  const score = e.score
  const hasScore = isNum(score)

  // ── Background + header band + gold top rule ────────────────────────────
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = PANEL
  ctx.fillRect(0, 0, W, 118)              // header band
  ctx.fillStyle = GOLD
  ctx.fillRect(0, 0, W, 6)                // gold top rule

  // ── Header: brand wordmark (left) + eyebrow (right) ─────────────────────
  drawText(ctx, 'UCT INTELLIGENCE', PAD, 46, {
    font: `700 22px ${FACE}`,
    color: GOLD,
  })
  drawText(ctx, 'WEEKLY EDGE SCORE', W - PAD, 50, {
    font: `700 16px ${FACE}`,
    color: MUTED,
    align: 'right',
  })

  // ── Title ───────────────────────────────────────────────────────────────
  drawText(ctx, 'Weekly Edge Score', PAD, 156, {
    font: `800 40px ${FACE}`,
    color: TEXT,
  })

  // ── Hero score (big) ────────────────────────────────────────────────────
  if (hasScore) {
    drawText(ctx, fmtScore(score), PAD, 214, {
      font: `800 108px ${FACE}`,
      color: GOLD_BRIGHT,
    })
    // ── Formula line ──────────────────────────────────────────────────────
    drawText(ctx, '= Win Rate  ×  Profit Factor  ×  R-Consistency', PAD, 348, {
      font: `600 22px ${FACE}`,
      color: MUTED,
    })
  } else {
    // Null score (n<10 or no R-multiples): honest "not enough data" card —
    // a dim em-dash + the requirement copy, NOT a fabricated number.
    drawText(ctx, DASH, PAD, 214, {
      font: `800 108px ${FACE}`,
      color: MUTED,
    })
    drawText(ctx, 'Not enough data yet', PAD, 348, {
      font: `700 22px ${FACE}`,
      color: TEXT,
    })
    drawText(ctx, 'Need 10+ trades with R-multiples to compute an Edge Score.', PAD, 380, {
      font: `500 18px ${FACE}`,
      color: MUTED,
    })
  }

  // ── Component row (Win Rate · Profit Factor · R-Consistency · Trades) ────
  const statsY = 468
  const cellW = (W - PAD * 2) / 4
  const cells = [
    { label: 'WIN RATE', value: fmtPct1(c.winRate), color: TEXT },
    { label: 'PROFIT FACTOR', value: fmtPF(c.profitFactor), color: TEXT },
    { label: 'R-CONSISTENCY', value: fmtPct0(c.rConsistency), color: TEXT },
    { label: 'TRADES', value: fmtInt(c.tradeCount), color: GOLD },
  ]
  cells.forEach((cell, i) => {
    const x = PAD + cellW * i
    drawText(ctx, cell.label, x, statsY, { font: `600 14px ${FACE}`, color: MUTED })
    drawText(ctx, cell.value, x, statsY + 24, { font: `700 30px ${FACE}`, color: cell.color })
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
 * Render the branded Edge-Score card to a PNG Blob.
 *
 * @param {object} edgeScore  the Edge composite: `{ score, components: {
 *   winRate, profitFactor, rConsistency, tradeCount } }`. A null `score` renders
 *   the honest "not enough data" card; any missing component renders as "—".
 * @returns {Promise<Blob>} PNG image blob.
 */
export function renderEdgeCardPng(edgeScore) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'))
  drawCard(ctx, edgeScore)
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
