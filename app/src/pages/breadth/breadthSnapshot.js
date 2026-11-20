// app/src/pages/breadth/breadthSnapshot.js
//
// The Breadth Monitor's "Snapshot…" (owner 11-19): rasterize ONLY the sheet — the column headers
// plus the rows in view, across the FULL width of every visible column (even the ones scrolled
// off to the side) — with a slim "UCT Breadth · <Universe> · <date>" strip under it. No app chrome,
// no nav, no top bar: the capture root is a clone of the sheet's own <table>, never the page.
//
// ⛔ LAZY. Loaded with `import('./breadthSnapshot')` by BreadthSnapshotPopover when the popover
// opens; modern-screenshot (and the /charts workspace-shot helpers it shares) come with it, so
// neither the entry chunk nor the Breadth page pays for it until someone asks for a snapshot.
//
// WHY A CLONE (not the live scroll container): the live `.tableWrap` is scrolled both ways (up to
// ~150k px down), carries `contain: layout paint`, and its <table> holds two tall virtualization
// spacer rows plus ~14 overscan rows each side. Rasterizing it directly paints the wrong window,
// clips the side-scrolled columns, and doubles the sticky header / Date column. So the <table> is
// cloned, the spacer + off-screen rows are dropped, the sticky header and Date column become plain
// `position: relative` (relative, NOT static: the FTD tag is absolutely positioned off its Date
// cell, and the Date cell's z-index keeps that tag over the next column), and the clone is laid
// out OFF-SCREEN INSIDE THE PAGE, beside the live sheet — the page element is where the --br-*
// theme roles are defined, so every colour and shade resolves exactly as on screen.
//
// Fonts: modern-screenshot inlines the document's @font-face rules (Instrument Sans is self-hosted
// in index.html), so the PNG is never in fallback fonts.

import { shotScale, SHOT_STYLE_PROPS, boardBackground, copyPng, downloadBlob } from '../charts/workspaceShot'

export { copyPng, downloadBlob }

// 1×1 transparent PNG for any image that cannot be read (none expected in the sheet).
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
// The workspace shot's pixel-changing properties, plus `content` for the sheet's ::after marks.
const STYLE_PROPS = Object.freeze([...SHOT_STYLE_PROPS, 'content'])

const pad2 = (n) => String(n).padStart(2, '0')
const slug = (s, fallback) => String(s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback

/** `uct-breadth-<universe>-<YYYY-MM-DD>.png` — the universe id and the top row's session date
 *  (today, local, when the sheet has no date yet). */
export function breadthSnapshotFilename(universe, topDate, when = new Date()) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(topDate || '')
    ? topDate
    : `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`
  return `uct-breadth-${slug(universe, 'uct')}-${d}.png`
}

/** "UCT Breadth · Nasdaq · 2026-11-18" — the strip under the sheet. */
export function breadthSnapshotFooter(universeLabel, topDate) {
  return ['UCT Breadth', universeLabel, topDate].filter(Boolean).join(' · ')
}

/** Indexes (into the live <tbody>'s rows) of the rows a reader can see right now: below the
 *  sticky header and above the scroll container's bottom edge. Spacer rows never count. */
export function visibleRowIndexes(wrap, table) {
  const body = table.tBodies?.[0]
  if (!body) return []
  const wr = wrap.getBoundingClientRect()
  const headBottom = table.tHead ? table.tHead.getBoundingClientRect().bottom : wr.top
  const top = Math.max(wr.top, headBottom)
  const bottom = wr.top + (wrap.clientHeight || wr.height)
  const out = []
  Array.from(body.rows).forEach((tr, i) => {
    if (tr.hasAttribute('data-snapshot-skip')) return
    const r = tr.getBoundingClientRect()
    // At least a third of the row showing: a sliver at either edge is not "in view".
    const shown = Math.min(r.bottom, bottom) - Math.max(r.top, top)
    if (shown > Math.max(1, r.height / 3)) out.push(i)
  })
  return out
}

/** Build the off-screen clone (table + footer strip) inside `host`. Returns { holder, rows }. */
export function buildSnapshotClone(wrap, { footer = '' } = {}) {
  const table = wrap?.querySelector?.('table')
  if (!table) throw new Error('no sheet to capture')
  const keep = new Set(visibleRowIndexes(wrap, table))
  const clone = table.cloneNode(true)
  const body = clone.tBodies?.[0]
  if (body) {
    Array.from(body.rows).forEach((tr, i) => { if (!keep.has(i)) tr.remove() })
  }
  // Sticky → relative: no doubled header / Date column, and the FTD tag keeps its anchor.
  clone.querySelectorAll('thead, th, td').forEach((n) => {
    if (n.tagName === 'THEAD' || /dateCol|dateCell/.test(n.className || '')) n.style.position = 'relative'
  })
  clone.querySelectorAll('[data-snapshot-skip], [role="tooltip"]').forEach((n) => n.remove())
  clone.removeAttribute('aria-label')
  // The live table is `min-width: 100%` of the window; off-screen it is its columns' own width.
  clone.style.minWidth = '0'
  clone.style.margin = '0'

  const bg = boardBackground(wrap)
  const holder = document.createElement('div')
  holder.setAttribute('aria-hidden', 'true')
  holder.setAttribute('data-breadth-snapshot', '')
  holder.style.cssText = [
    'position:fixed', 'left:-100000px', 'top:0', 'z-index:-1', 'pointer-events:none',
    'contain:none', 'display:inline-block', 'width:max-content', `background:${bg}`,
  ].join(';')
  holder.appendChild(clone)
  if (footer) {
    const strip = document.createElement('div')
    strip.textContent = footer
    strip.style.cssText = [
      'box-sizing:border-box', 'height:30px', 'padding:0 16px', 'display:flex', 'align-items:center',
      'border-top:1px solid var(--br-line, var(--border))', 'font-family:var(--font-sans)',
      'font-size:11.5px', 'font-weight:500', 'letter-spacing:0.01em',
      'color:var(--br-rest, var(--text-muted))', `background:${bg}`, 'white-space:nowrap',
    ].join(';')
    holder.appendChild(strip)
  }
  // Inside the page (the live sheet's parent) so the --br-* roles and the wide-screen sizes resolve.
  ;(wrap.parentElement || document.body).appendChild(holder)
  return { holder, rows: keep.size, background: bg }
}

/** Capture the sheet → { blob, width, height, filename, rows }. Throws on a total failure. */
export async function captureBreadthSheet(wrap, { universe, universeLabel, topDate, now = new Date() } = {}) {
  if (!wrap || typeof wrap.getBoundingClientRect !== 'function') throw new Error('no sheet to capture')
  const lib = await import('modern-screenshot')
  const { holder, rows, background } = buildSnapshotClone(wrap, { footer: breadthSnapshotFooter(universeLabel, topDate) })
  try {
    const rect = holder.getBoundingClientRect()
    const width = Math.ceil(rect.width)
    const height = Math.ceil(rect.height)
    if (!(width > 0 && height > 0)) throw new Error('the sheet has no size')
    const scale = shotScale(width, height)
    const blob = await lib.domToBlob(holder, {
      type: 'image/png',
      width, height, scale,
      dpi: 96 * scale,
      backgroundColor: background,
      includeStyleProperties: STYLE_PROPS,
      timeout: 10000,
      fetch: { placeholderImage: BLANK_PNG },
    })
    if (!blob || !blob.size) throw new Error('empty capture')
    return {
      blob, rows,
      width: Math.round(width * scale), height: Math.round(height * scale),
      filename: breadthSnapshotFilename(universe, topDate, now),
    }
  } finally {
    holder.remove()
  }
}
