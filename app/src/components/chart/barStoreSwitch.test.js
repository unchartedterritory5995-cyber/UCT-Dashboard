// P3-S1 — the BARSTORE switch: build const + the per-browser key `uct.barStore`, read once.
import { describe, it, expect } from 'vitest'
import { resolveBarStoreSwitch, BARSTORE_STORAGE_KEY, BARSTORE } from './barStoreSwitch'
import { BARSTORE_STORAGE_KEY as HELPER_KEY } from '../../testing/barStoreModes'

describe('BARSTORE switch', () => {
  it('the exact key is uct.barStore (and the test helper uses the same one)', () => {
    expect(BARSTORE_STORAGE_KEY).toBe('uct.barStore')
    expect(HELPER_KEY).toBe(BARSTORE_STORAGE_KEY)
  })

  it('DEFAULT OFF: no build const and no key → the legacy source (the owner approves the live switch)', () => {
    expect(resolveBarStoreSwitch({})).toBe(false)
    expect(resolveBarStoreSwitch({ buildConst: undefined, read: () => null })).toBe(false)
    expect(resolveBarStoreSwitch({ buildConst: '', read: () => null })).toBe(false)
    expect(resolveBarStoreSwitch({ buildConst: '0', read: () => null })).toBe(false)
  })

  it('build const VITE_BARSTORE=1 turns it on; the per-browser key wins either way', () => {
    expect(resolveBarStoreSwitch({ buildConst: '1', read: () => null })).toBe(true)
    expect(resolveBarStoreSwitch({ buildConst: '1', read: () => '0' })).toBe(false)
    expect(resolveBarStoreSwitch({ buildConst: undefined, read: () => '1' })).toBe(true)
    // anything else in the key is not an instruction
    expect(resolveBarStoreSwitch({ buildConst: undefined, read: () => 'yes' })).toBe(false)
  })

  it('a throwing storage (private mode, blocked site data) falls back to the build const', () => {
    const read = () => { throw new Error('SecurityError') }
    expect(resolveBarStoreSwitch({ buildConst: undefined, read })).toBe(false)
    expect(resolveBarStoreSwitch({ buildConst: '1', read })).toBe(true)
  })

  it('the module constant is a boolean read at load (this suite runs with neither set → off)', () => {
    expect(typeof BARSTORE).toBe('boolean')
    expect(BARSTORE).toBe(false)
  })
})
