// Breadth Monitor "Share" — turn the on-screen breadth sheet into a branded
// UCT Intelligence snapshot (PNG download / clipboard copy) + a deep-link URL.
//
// The sheet is a virtualized DOM <table>, so we rasterize it with
// modern-screenshot (the same engine the Journal note/embed export trusts —
// NOT the chart's canvas takeScreenshot, which only works for LWC charts), then
// compose it onto a branded card via a plain 2D canvas so the branding (logo,
// title, timestamp, footer) is fully under our control and never depends on the
// page's exact DOM.

import { domToCanvas } from 'modern-screenshot'
import compassMark from '../../components/intro/assets/compass-mark.png'

const BG = '#0c0d10'
const GOLD = '#c9a84c'
const HEAD = '#e7e9ea'
const MUTED = '#9aa0a6'
const SANS = "'Instrument Sans', system-ui, -apple-system, sans-serif"
const MONO = "'IBM Plex Mono', 'Courier New', monospace"

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Rasterize the breadth sheet element and wrap it in a branded UCT card.
 * Returns an HTMLCanvasElement, or null if capture failed.
 * `subtitle` is a short line (e.g. "Sep 1, 2026 · 4:39 PM ET") shown top-right.
 */
export async function buildBreadthSnapshotCanvas(tableEl, { subtitle = '' } = {}) {
  if (!tableEl) return null
  const scale = 2
  const inner = await domToCanvas(tableEl, { scale, backgroundColor: BG })
  if (!inner || !inner.width) return null

  const pad = 24 * scale
  const headerH = 68 * scale
  const footerH = 34 * scale
  const W = inner.width + pad * 2
  const H = inner.height + headerH + footerH + pad

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // ── Header: logo + wordmark + subtitle ────────────────────────────────────
  const logo = await loadImage(compassMark)
  let tx = pad
  if (logo) {
    const s = 42 * scale
    ctx.drawImage(logo, pad, pad + 2 * scale, s, s)
    tx = pad + s + 14 * scale
  }
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = GOLD
  ctx.font = `700 ${21 * scale}px ${SANS}`
  ctx.fillText('UCT Intelligence', tx, pad + 22 * scale)
  ctx.fillStyle = HEAD
  ctx.font = `600 ${14 * scale}px ${SANS}`
  ctx.fillText('Market Breadth Monitor', tx, pad + 44 * scale)
  if (subtitle) {
    ctx.fillStyle = MUTED
    ctx.font = `500 ${12.5 * scale}px ${MONO}`
    const tw = ctx.measureText(subtitle).width
    ctx.fillText(subtitle, W - pad - tw, pad + 36 * scale)
  }
  // gold hairline under the header
  ctx.strokeStyle = 'rgba(201,168,76,0.35)'
  ctx.lineWidth = Math.max(1, scale)
  ctx.beginPath()
  ctx.moveTo(pad, headerH - 8 * scale)
  ctx.lineTo(W - pad, headerH - 8 * scale)
  ctx.stroke()

  // ── The sheet ─────────────────────────────────────────────────────────────
  ctx.drawImage(inner, pad, headerH)

  // ── Footer ────────────────────────────────────────────────────────────────
  ctx.fillStyle = MUTED
  ctx.font = `500 ${11.5 * scale}px ${MONO}`
  ctx.fillText('uctintelligence.com', pad, H - footerH + 22 * scale)

  return c
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), 'image/png') } catch { resolve(null) }
  })
}

/** Build the snapshot and hand it to the browser as a PNG download. */
export async function downloadBreadthSnapshot(tableEl, subtitle) {
  const c = await buildBreadthSnapshotCanvas(tableEl, { subtitle })
  if (!c) return false
  const blob = await canvasToBlob(c)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `uct-breadth-${new Date().toISOString().slice(0, 10)}.png`
  a.click()
  URL.revokeObjectURL(url)
  return true
}

/** Build the snapshot and copy it to the clipboard as a PNG image. */
export async function copyBreadthSnapshot(tableEl, subtitle) {
  try {
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') return false
    const c = await buildBreadthSnapshotCanvas(tableEl, { subtitle })
    if (!c) return false
    const blob = await canvasToBlob(c)
    if (!blob) return false
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

/** A share URL for the Monitor that deep-links to the shown day (`?d=YYYY-MM-DD`). */
export function breadthShareUrl(topDate) {
  const u = new URL(window.location.href)
  u.pathname = '/breadth'
  u.hash = ''
  u.search = ''
  if (topDate && /^\d{4}-\d{2}-\d{2}$/.test(topDate)) u.searchParams.set('d', topDate)
  return u.toString()
}

/** Copy the share URL to the clipboard (best-effort). */
export async function copyBreadthShareUrl(topDate) {
  try {
    await navigator.clipboard?.writeText(breadthShareUrl(topDate))
    return true
  } catch {
    return false
  }
}
