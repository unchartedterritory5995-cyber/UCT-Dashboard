// app/src/data/deviceStore/switch.js — the per-browser switch of the on-device bar store.
//
// localStorage 'uct.deviceStore': '1' on, '0' off (a member's own choice always wins); absent = the DEFAULT below.
// Read once per BarStore (the app's store is created once per page), so a change takes effect on the next load.
// ⭐ The SERVER's kill switch (CHART_SPEED_ENABLED, lib/chartSpeed.js) wins over everything here: killed,
// the store is off in every browser, a local '1' included.
//
// ⭐⭐ DEFAULT ON FOR DESKTOP ONLY (owner, 2026-11-21): desktop browsers and the desktop app. A phone, a touch-tier
// tablet (≤ 1024 px: styles/breakpoints MQ.desktop is false) and a metered connection (navigator.connection's
// saveData, a cellular type, or a slow-2g/2g/3g effectiveType where the browser reports it) stay OFF: the seed is
// ~80 MB of packs per browser (measured 2026-11-22: 79.96 MB over the six timeframes). It needs POSITIVE evidence of a desktop (the desktop app's bridge, or MQ.desktop matching):
// a browser that cannot say (no matchMedia) stays off.
//
// Tiny on purpose: persist.js imports this statically; everything else of the device store is loaded
// lazily (source.js → client.js → the worker), so first-open bytes do not move. Its two imports import nothing.

import { chartSpeedKilled } from '../../lib/chartSpeed'
import { isDesktopApp } from '../../lib/desktopBridge'
import { MQ } from '../../styles/breakpoints'

export const DEVICE_STORE_KEY = 'uct.deviceStore'
/** The default is ON, for the browsers `deviceStoreDefaultOn` admits (desktop only); OFF everywhere else. */
export const DEVICE_STORE_DEFAULT_ON = true

/** Connection types that are metered or too slow for a ~80 MB seed. */
const METERED_EFFECTIVE = new Set(['slow-2g', '2g', '3g'])

/** Does the default turn the device store ON in this browser? Desktop only, never on a metered connection.
 *  Never throws; anything it cannot read answers OFF. */
export function deviceStoreDefaultOn() {
  if (!DEVICE_STORE_DEFAULT_ON) return false
  try {
    const c = typeof navigator !== 'undefined' ? navigator.connection : null
    if (c && (c.saveData === true || c.type === 'cellular' || METERED_EFFECTIVE.has(String(c.effectiveType || '')))) return false
    if (isDesktopApp()) return true                       // the desktop app, whatever its window's width
    const mm = typeof window !== 'undefined' ? window.matchMedia : null
    return typeof mm === 'function' && mm.call(window, MQ.desktop).matches === true
  } catch {
    return false
  }
}

/** Is the on-device bar store switched on in this browser? Never throws. */
export function deviceStoreEnabled() {
  if (chartSpeedKilled()) return false
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(DEVICE_STORE_KEY)
    if (v === '1') return true
    if (v === '0') return false
    return deviceStoreDefaultOn()
  } catch {
    return false
  }
}
