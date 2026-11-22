// Test helper (P3-S1): run a chart acceptance suite under BOTH values of the BARSTORE switch.
//
// The switch is READ ONCE AT MODULE LOAD (components/chart/barStoreSwitch.js), so a suite cannot
// flip it between tests — it re-imports the module graph instead: `vi.resetModules()`, set the
// per-browser key, import. The suite's `vi.mock` registrations survive the reset (only the
// module registry is cleared), so both graphs see the same mocks; the switch value each graph
// actually holds is returned and asserted by the caller (a mode that silently fell back to the
// other source would otherwise pass as a second copy of the first).
import { vi } from 'vitest'

export const BARSTORE_STORAGE_KEY = 'uct.barStore'   // the exact key barStoreSwitch.js reads
export const BARSTORE_MODES = Object.freeze([false, true])

/**
 * @template T
 * @param {boolean} on
 * @param {() => Promise<T>} load  imports the module(s) under test (inside the fresh registry)
 * @returns {Promise<T & {__barStore: boolean}>}
 */
export async function loadWithBarStore(on, load) {
  vi.resetModules()
  try { globalThis.localStorage?.setItem(BARSTORE_STORAGE_KEY, on ? '1' : '0') } catch { /* jsdom has it */ }
  try {
    const mod = await load()
    const sw = await import('../components/chart/barStoreSwitch')
    return Object.assign(Object.create(null), mod, { __barStore: sw.BARSTORE })
  } finally {
    try { globalThis.localStorage?.removeItem(BARSTORE_STORAGE_KEY) } catch { /* ignore */ }
  }
}
