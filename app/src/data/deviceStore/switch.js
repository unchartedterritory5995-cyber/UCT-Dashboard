// app/src/data/deviceStore/switch.js — the per-browser switch of the on-device bar store.
//
// localStorage 'uct.deviceStore', THE RULE (review of #2537 L1, made explicit by the review of #2549):
//   '1'                      on
//   '0'                      off
//   ANY other stored value   off ('true', 'off', '', ' 1': not a choice, and never read as one)
//   no key at all            the default (`_defaultOn`: DEVICE_STORE_DEFAULT_ON today)
// ⛔ A stored value that is not a choice is OFF, not "the default": once a default can be ON (#2537's desktop default),
// a member who typed 'off' or 'false' to switch the store off must not be switched ON by it.
// ⭐ DEFAULT OFF in the PR that adds the store, so it can be measured before it is turned on: flipping
// the default is this one constant (or, with #2537, its computation inside `_defaultOn`).
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
/** Tests: the default as a later one may compute it (null: DEVICE_STORE_DEFAULT_ON). */
let _defaultForTests = null

/** The answer when no key is stored. */
function _defaultOn() { return _defaultForTests ?? DEVICE_STORE_DEFAULT_ON }

function _read() {
  try {
    if (typeof localStorage === 'undefined') return _defaultOn()
    const v = localStorage.getItem(DEVICE_STORE_KEY)
    if (v === null) return _defaultOn()   // no key at all: the default
    return v === '1'                      // '1' on; '0' and ANY other stored value off
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

/** Tests: the default this page load uses when no key is stored (true / false; null: the constant). */
export function __setDeviceStoreDefaultForTests(on) { _defaultForTests = on == null ? null : on === true; _decided = null }
