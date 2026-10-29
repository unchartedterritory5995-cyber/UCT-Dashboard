// ── UCT Agent PRODUCT GUIDE: finding the REAL control a step points at ──────────────────────────────────────
//
// A target is one of:
//   'chart.timeframe'                         a `data-guide` id the control carries
//   { within: 'chartSettings', aria: '…' }    a control's own accessible name inside a registered container (used
//                                             where the control belongs to another team's surface and needs no
//                                             attribute of ours — e.g. Indicators' search box)
//   { widgetType: 'watchlist' }               a board cell of that widget type (data-widget-type)
//
// `chart.*` targets are looked for inside the chart being talked about (`[data-widget-id="<chart>"]`, the board cell
// the chart ref names), then anywhere (a menu the chart opened may be portalled). A target counts only when the
// member can SEE it — present is not visible (the Notebook tour's own `isOnScreen`, reused as-is: a box, on screen,
// not clipped away). Nothing here clicks, focuses or changes anything.

import { isOnScreen } from '../../pages/journal-2-0/components/notebook/onboarding/tourAnchorVisibility'

const esc = (s) => String(s).replace(/["\\]/g, '\\$&')
const cellOf = (chartRef) => {
  if (!chartRef || typeof document === 'undefined') return null
  const id = String(chartRef).split('~')[0]
  return document.querySelector(`[data-widget-id="${esc(id)}"]`)
}
const visible = (els) => [...els].find(el => { try { return isOnScreen(el) } catch { return false } }) || null

/** The element a target means right now, visible to the member — or null. */
export function findTarget(target, { chartRef = null } = {}) {
  if (typeof document === 'undefined' || !target) return null
  if (typeof target === 'object' && target.widgetType) {
    return visible(document.querySelectorAll(`[data-widget-type="${esc(target.widgetType)}"]`))
  }
  if (typeof target === 'object' && target.within) {
    const boxes = document.querySelectorAll(`[data-guide="${esc(target.within)}"]`)
    for (const box of boxes) {
      const hit = visible(box.querySelectorAll(`[aria-label="${esc(target.aria)}"]`))
      if (hit) return hit
    }
    return null
  }
  const id = String(target)
  const sel = `[data-guide="${esc(id)}"]`
  if (id.startsWith('chart.')) {
    const cell = cellOf(chartRef)
    const inChart = cell ? visible(cell.querySelectorAll(sel)) : null
    if (inChart) return inChart
    // with a chart named, a control on ANOTHER chart is not this one — except what that chart opened (a menu)
    if (cell && !/Menu$/.test(id)) return null
  }
  return visible(document.querySelectorAll(sel))
}

// the nearest ancestor that clips what overflows it (a toolbar row with overflow: hidden) — the highlight never reaches past
// what the member can see of the control
function clipOf(el) {
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    let o = ''
    try { const cs = getComputedStyle(p); o = `${cs.overflowX} ${cs.overflow}` } catch { o = '' }
    if (/hidden|clip/.test(o)) return p.getBoundingClientRect()
  }
  return null
}
/** The rectangle to highlight, in viewport coordinates (with a little room around the control), clipped to what shows. */
export function rectOf(el, pad = 4) {
  if (!el?.getBoundingClientRect) return null
  const r = el.getBoundingClientRect()
  const c = typeof document === 'undefined' ? null : clipOf(el)
  const left = c && c.width > 0 ? Math.max(r.left, c.left) : r.left
  const right = c && c.width > 0 ? Math.min(r.right ?? r.left + r.width, c.right) : (r.right ?? r.left + r.width)
  return { top: r.top - pad, left: left - pad, width: Math.max(0, right - left) + pad * 2, height: r.height + pad * 2 }
}

/** Bring a target that is below the fold into view (never sideways, never a smooth jump that hides it). */
export function reveal(el) {
  try { el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) } catch { /* not scrollable */ }
}
