// app/src/data/deviceStore/switch.js — the per-browser switch of the on-device bar store.
//
// localStorage 'uct.deviceStore', THE RULE (review of #2537 L1, made explicit by the review of #2549):
//   '1'                      on
//   '0'                      off
//   ANY other stored value   off ('true', 'off', '', ' 1': not a choice, and never read as one)
//   no key at all            the default (`_defaultOn`: the desktop rule below)
// ⛔ A stored value that is not a choice is OFF, not "the default": now that the default can be ON (#2537's desktop
// default), a member who typed 'off' or 'false' to switch the store off must not be switched ON by it.
// ⭐⭐ THE DEFAULT IS ON FOR DESKTOPS ONLY (owner, 2026-11-21; #2537), and it decides ONLY when no key is stored
// (`_defaultOn` -> `deviceStoreDefaultOn`): ON when the browser gives POSITIVE evidence of a desktop (the desktop app's
// bridge, lib/desktopBridge.isDesktopApp; or styles/breakpoints MQ.desktop, `(min-width: 1025px)`, matching) AND the
// connection is not metered (navigator.connection: saveData, a cellular type, or a slow-2g / 2g / 3g effectiveType,
// where the browser reports one; it is read FIRST, so the desktop app on a metered connection is off too). Anything else
// (a phone, a touch-tier tablet, a narrow or zoomed window, no matchMedia) reads OFF with the reason 'default-off',
// which KEEPS the packs (source.js): the default moves with the window and the connection from load to load, and a
// narrow window today must not cost a download tomorrow. The seed is ~80 MB of packs per browser (79.96 MB measured
// 2026-11-22), downloaded after the first chart paint, at idle. `DEVICE_STORE_DEFAULT_ON` is the one switch for all of
// this: false and no browser defaults on.
// ⭐ ONE DECISION PER PAGE LOAD (review of #2537, M3). It is read when the BarStore is created (persist.js), at the
// symbol handoff's module scope (hooks/useSymbolHandoff.js) and by the handoff's diagnostics on every switch
// (source.deviceSource), moments apart. The FIRST answer is the page's answer, so those reads can never disagree: the
// handoff never trusts a device rule its store does not have, and the diagnostics never start the client (the
// worker, the 80 MB ingest, the all-day minute feed) for a page whose bar store decided OFF. A change of the key
// takes effect on the next load.
// ⭐ The SERVER's kill switches win over everything here, on EVERY read (they are read first, never cached here):
// CHART_SPEED_ENABLED (both chart speed switches) and DEVICE_STORE_ENABLED (this store ALONE, review of #2537 M9), both
// lib/chartSpeed.js. Killed, the store is off in every browser, a local '1' included.
// ⭐ WHY IT IS OFF DECIDES WHETHER THE PACKS GO (review of #2563, MEDIUM-1 / MEDIUM-2). deviceStoreOffReason names it,
// once per page load like the answer itself, and source.deviceSource acts on it:
//   'device-purge'      the server's purge (`uct_device_store=purge`)          -> the packs are DELETED
//   'member-off'        the member's own key, exactly '0'                      -> DELETED ('0' is the off switch; no UI)
//   'default-off'       no key, and the default reads OFF (a phone, a touch-tier tablet, a narrow window, a metered
//                       connection: it changes from load to load)              -> KEPT, unused; deleted only once the
//                                                                                 store has not run here for 30 days
//                                                                                 (two off loads 24 h apart, residue.js)
//   'chart-speed-kill'  CHART_SPEED_ENABLED (an incident lever for other features too) -> KEPT
//   'device-kill'       `uct_device_store=0`                                    -> KEPT (lifting it costs no download)
//   'not-a-choice'      any other stored value                                  -> KEPT
//   'unreadable'        localStorage threw                                      -> KEPT
//
// Tiny on purpose: persist.js imports this statically (through source.js); everything else of the device store is
// loaded lazily (source.js → client.js → the worker), so first-open bytes do not move. Its three imports import nothing
// (lib/chartSpeed, lib/desktopBridge, styles/breakpoints; switch.default.test.js pins it).

import { chartSpeedKilled, deviceStoreKilled, deviceStorePurge } from '../../lib/chartSpeed'
import { isDesktopApp } from '../../lib/desktopBridge'
import { MQ } from '../../styles/breakpoints'

export const DEVICE_STORE_KEY = 'uct.deviceStore'
/** THE switch for "default on for desktop" (#2537): true, the default is ON for the browsers `deviceStoreDefaultOn`
 *  admits (desktop, unmetered) and OFF everywhere else; false, no browser defaults on. */
export const DEVICE_STORE_DEFAULT_ON = true

/** Effective connection types that are metered or too slow for a ~80 MB seed. */
const METERED_EFFECTIVE = new Set(['slow-2g', '2g', '3g'])

/** Does the default turn the store ON in this browser (see the header)? Desktop only, never on a metered connection.
 *  Never throws; anything it cannot read answers OFF. Read once per page load, through `_defaultOn`. */
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

/** This page load's answer (null: not read yet). */
let _decided = null
/** This page load's key: 'on' ('1') | 'off' ('0') | 'not-a-choice' | 'absent' | 'unreadable' (null: not read yet). */
let _key = null
/** Tests: force the default (null: computed, deviceStoreDefaultOn). */
let _defaultForTests = null

/** The answer when no key is stored: the desktop rule (or a test's forced value). */
function _defaultOn() { return _defaultForTests ?? deviceStoreDefaultOn() }

function _readKey() {
  try {
    if (typeof localStorage === 'undefined') return 'absent'
    const v = localStorage.getItem(DEVICE_STORE_KEY)
    if (v === null) return 'absent'
    return v === '1' ? 'on' : v === '0' ? 'off' : 'not-a-choice'
  } catch {
    return 'unreadable'
  }
}

/** This page load's key state (read once, see `_key`). */
export function deviceStoreKeyState() {
  if (_key === null) _key = _readKey()
  return _key
}

function _read() {
  const k = deviceStoreKeyState()
  if (k === 'absent') return _defaultOn()   // no key at all: the default
  return k === 'on'                         // '1' on; '0' and ANY other stored value off; unreadable off
}

/** Is the on-device bar store switched on in this browser, for this page load? Never throws. */
export function deviceStoreEnabled() {
  if (chartSpeedKilled() || deviceStoreKilled()) return false
  if (_decided === null) _decided = _read()
  return _decided
}

/** Why is the store off on this page load (see the header): null exactly when deviceStoreEnabled() is true. */
export function deviceStoreOffReason() {
  if (deviceStoreEnabled()) return null
  if (deviceStorePurge()) return 'device-purge'
  const k = deviceStoreKeyState()
  if (k === 'off') return 'member-off'
  if (chartSpeedKilled()) return 'chart-speed-kill'
  if (deviceStoreKilled()) return 'device-kill'
  if (k === 'not-a-choice' || k === 'unreadable') return k
  return 'default-off'
}

/** Tests: forget this page load's answer (a new page load). */
export function __resetDeviceStoreSwitchForTests() { _decided = null; _key = null }

/** Tests: the default this page load uses when no key is stored (true / false; null: computed). */
export function __setDeviceStoreDefaultForTests(on) { _defaultForTests = on == null ? null : on === true; _decided = null }
