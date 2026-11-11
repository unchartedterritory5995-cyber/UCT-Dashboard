// Tier 2 fix round 1 (review Important 4): a DEBUG-ONLY layout-shift logger, to find the source of the 12 s phone
// shift on production. OFF by default: it does nothing unless this device's localStorage holds
// `uct.debug.layoutShift` = '1' (set it from DevTools). No member-visible UI, no network, no other storage.
// When on: each layout shift is logged to the console with its sources' boxes before and after, and kept on
// `window.__uctLayoutShifts` (the last 50) for a probe to read.
export const CLS_DEBUG_KEY = 'uct.debug.layoutShift'

const describe = (n) => {
  if (!n || n.nodeType !== 1) return String(n && n.nodeName)
  const id = n.id ? `#${n.id}` : ''
  return `${n.tagName.toLowerCase()}${id}.${String(n.className || '').split(' ').slice(0, 2).join('.')}`
}

export function installLayoutShiftDebug(win = typeof window !== 'undefined' ? window : null) {
  let on = false
  try { on = win?.localStorage?.getItem(CLS_DEBUG_KEY) === '1' } catch { on = false }
  if (!on || typeof win.PerformanceObserver !== 'function') return false
  const log = (win.__uctLayoutShifts = win.__uctLayoutShifts || [])
  try {
    new win.PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue
        const row = {
          value: +e.value.toFixed(4), t: Math.round(e.startTime), path: win.location?.pathname,
          sources: (e.sources || []).map((s) => ({
            node: describe(s.node), before: [Math.round(s.previousRect.y), Math.round(s.previousRect.height)],
            after: [Math.round(s.currentRect.y), Math.round(s.currentRect.height)],
            prev: describe(s.node?.previousElementSibling),
          })),
        }
        log.push(row)
        if (log.length > 50) log.shift()
        win.console?.info?.('[uct layout-shift]', row)
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch { return false }
  return true
}
