// app/src/data/deviceStore/switch.js — the per-browser switch of the on-device bar store.
//
// localStorage 'uct.deviceStore': '1' on, '0' off, absent = DEVICE_STORE_DEFAULT_ON.
// ⭐ DEFAULT OFF in the PR that adds the store, so it can be measured before it is turned on: flipping
// the default is this one constant. Read once per BarStore (the app's store is created once per page),
// so a change takes effect on the next load.
// ⭐ The SERVER's kill switch (CHART_SPEED_ENABLED, lib/chartSpeed.js) wins over everything here: killed,
// the store is off in every browser, a local '1' included.
//
// Tiny on purpose: persist.js imports this statically; everything else of the device store is loaded
// lazily (source.js → client.js → the worker), so first-open bytes do not move.

import { chartSpeedKilled } from '../../lib/chartSpeed'

export const DEVICE_STORE_KEY = 'uct.deviceStore'
export const DEVICE_STORE_DEFAULT_ON = false

/** Is the on-device bar store switched on in this browser? Never throws. */
export function deviceStoreEnabled() {
  if (chartSpeedKilled()) return false
  try {
    if (typeof localStorage === 'undefined') return DEVICE_STORE_DEFAULT_ON
    const v = localStorage.getItem(DEVICE_STORE_KEY)
    if (v === '1') return true
    if (v === '0') return false
    return DEVICE_STORE_DEFAULT_ON
  } catch {
    return false
  }
}
