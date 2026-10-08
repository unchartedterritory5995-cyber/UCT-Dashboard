// app/src/components/chart/engine/objectTableStack.js
//
// ─── ⭐ TABLES THAT SHARE A CORNER STACK; THEY DO NOT OVERLAP ────────────────
//
// ⚰️ MEASURED on prod 2026-10-08: two indicators each drawing a table at
// `top_right` (an RSI/EMA table and a position calculator) painted on top of each
// other — every table is `position: absolute` at its corner (`anchorStyle`), and
// each indicator owns its own table layer (`objectLayer.js`), so neither knew the
// other was there. Two tables of ONE program at the same corner collided the same way.
//
// THE RULE. Every table layer on one chart container registers here. After any
// layer's tables change (or its pane / scale moves), the tables of ALL live layers
// are grouped by (pane, position) and offset along the corner's vertical axis by
// the heights of the tables before them — in layer creation order, then the
// program's own table order — so the first table keeps the exact place it had,
// and the next one starts below it (above it, for a bottom corner).
//
// ⛔ NOTHING ELSE MOVES. The renderer (`objectTableDom.buildTable`) and the nine
// anchors (`anchorStyle`) are unchanged; a lone table is written exactly where it
// was. Heights are READ (`getBoundingClientRect`, which includes the phone-tier
// fit scale) and only the one offset property is written, and only when it changes.

import { TABLE_MARGIN } from './objectCanvas'

/** Space between two stacked tables, in CSS px. */
export const TABLE_STACK_GAP = 4

const registries = new WeakMap()
let seq = 0

/**
 * Register one layer's table root on its chart container.
 * @param {object} container  the element every layer of this chart appends to
 * @param {{root: object, paneKey: () => string}} entry
 * @returns {() => void}  unregister (and restack the rest)
 */
export function registerTableLayer(container, entry) {
  if (!container) return () => {}
  let reg = registries.get(container)
  if (!reg) { reg = new Set(); registries.set(container, reg) }
  const e = { ...entry, seq: (seq += 1) }
  reg.add(e)
  return () => {
    reg.delete(e)
    restackTables(container)
  }
}

const heightOf = (el) => {
  try {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null
    if (r && r.height > 0) return r.height
  } catch { /* detached */ }
  return Number(el.offsetHeight) || 0
}

const setIf = (el, prop, value) => {
  if (el.style && el.style[prop] !== value) el.style[prop] = value
}

const verticalOf = (position) => (
  String(position || '').startsWith('top') ? 'top'
    : String(position || '').startsWith('bottom') ? 'bottom' : 'middle')

/** Re-lay every table of every live layer on `container`. Returns the groups (tests). */
export function restackTables(container) {
  const reg = container ? registries.get(container) : null
  if (!reg) return []
  const groups = new Map()
  for (const e of [...reg].sort((a, b) => a.seq - b.seq)) {
    const root = e.root
    if (!root || typeof root.querySelectorAll !== 'function') continue
    const pane = typeof e.paneKey === 'function' ? String(e.paneKey() || '') : ''
    for (const el of root.querySelectorAll('[data-uct-object-table]')) {
      const position = (el.getAttribute && el.getAttribute('data-uct-table-position')) || 'top_right'
      const key = `${pane}|${position}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(el)
    }
  }
  const out = []
  for (const [key, els] of groups) {
    const position = key.slice(key.indexOf('|') + 1)
    const v = verticalOf(position)
    const heights = els.map(heightOf)
    if (v === 'middle') {
      // the group is centred as one block; each table is centred on its own slot
      const total = heights.reduce((a, b) => a + b, 0) + TABLE_STACK_GAP * (els.length - 1)
      let start = -total / 2
      els.forEach((el, i) => {
        const centre = Math.round(start + heights[i] / 2)
        setIf(el, 'top', els.length > 1 ? `calc(50% + ${centre}px)` : '50%')
        start += heights[i] + TABLE_STACK_GAP
      })
    } else {
      let offset = 0
      els.forEach((el, i) => {
        setIf(el, v, `${TABLE_MARGIN + Math.round(offset)}px`)
        offset += heights[i] + TABLE_STACK_GAP
      })
    }
    out.push({ key, count: els.length })
  }
  return out
}
