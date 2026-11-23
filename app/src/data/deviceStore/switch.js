// app/src/data/deviceStore/switch.js — the per-browser switch of the on-device bar store.
//
// localStorage 'uct.deviceStore': '1' on, '0' off, absent = DEVICE_STORE_DEFAULT_ON. Only those two values are a
// choice: anything else ('true', 'off', '') reads exactly as an absent key (review of #2537, L1).
// ⭐ DEFAULT OFF in the PR that adds the store, so it can be measured before it is turned on: flipping
// the default is this one constant.
// ⭐ ONE DECISION PER PAGE LOAD (review of #2537, M3). It is read when the BarStore is created (persist.js), at the
// symbol handoff's module scope (hooks/useSymbolHandoff.js) and by the handoff's diagnostics on every switch
// (source.deviceSource), moments apart. The FIRST answer is the page's answer, so those reads can never disagree: the
// handoff never trusts a device rule its store does not have, and the diagnostics never start the client (the
// worker, the 80 MB ingest, the all-day minute feed) for a page whose bar store decided OFF. A change of the key
// takes effect on the next load.
// ⭐ The SERVER's kill switch (CHART_SPEED_ENABLED, lib/chartSpeed.js) wins over everything here, on EVERY read (it
// is read first, never cached here): killed, the store is off in every browser, a local '1' included.
//
// Tiny on purpose: persist.js imports this statically (through source.js); everything else of the device store is
// loaded lazily (source.js → client.js → the worker), so first-open bytes do not move.

import { chartSpeedKilled } from '../../lib/chartSpeed'

export const DEVICE_STORE_KEY = 'uct.deviceStore'
export const DEVICE_STORE_DEFAULT_ON = false

/** This page load's answer (null: not read yet). */
let _decided = null

function _read() {
  try {
    if (typeof localStorage === 'undefined') return DEVICE_STORE_DEFAULT_ON
    const v = localStorage.getItem(DEVICE_STORE_KEY)
    if (v === '1') return true
    if (v === '0') return false
    return DEVICE_STORE_DEFAULT_ON   // absent, or anything that is not a choice
  } catch {
    return false
  }
}

/** Is the on-device bar store switched on in this browser, for this page load? Never throws. */
export function deviceStoreEnabled() {
  if (chartSpeedKilled()) return false
  if (_decided === null) _decided = _read()
  return _decided
}

/** Tests: forget this page load's answer (a new page load). */
export function __resetDeviceStoreSwitchForTests() { _decided = null }
