import { describe, it, expect, beforeEach } from 'vitest'
import {
  runJ2LocalStorageMigrations,
  J2_MIGRATION_FLAG,
} from './localStorageMigrate'

const FLAG = 'uct.j2.migrated.v4'

function snapshot() {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    out[k] = localStorage.getItem(k)
  }
  return out
}

beforeEach(() => {
  localStorage.clear()
})

describe('runJ2LocalStorageMigrations', () => {
  it('exports the flag key constant matching the v4 literal', () => {
    expect(J2_MIGRATION_FLAG).toBe(FLAG)
  })

  it('sets the v4 migrated flag on first run', () => {
    expect(localStorage.getItem(FLAG)).toBeNull()
    runJ2LocalStorageMigrations()
    expect(localStorage.getItem(FLAG)).toBe('1')
  })

  it('runs exactly once — first call migrates, second call is a no-op', () => {
    expect(runJ2LocalStorageMigrations()).toBe(true) // performed the migration
    expect(runJ2LocalStorageMigrations()).toBe(false) // already migrated → no-op
    expect(runJ2LocalStorageMigrations()).toBe(false)
  })

  it('is idempotent — running twice leaves localStorage in the same state', () => {
    runJ2LocalStorageMigrations()
    const after1 = snapshot()
    runJ2LocalStorageMigrations()
    const after2 = snapshot()
    expect(after2).toEqual(after1)
  })

  it('does NOT delete or clobber existing J2 keys', () => {
    // The keys that must keep resolving under the new P4 shell (same components).
    const seed = {
      'uct.j2.selectedAccountId': 'acc-123',
      'uct.j2.openPositions.columns': JSON.stringify({ order: ['symbol'], hidden: [] }),
      'uct.j2.tradeJournal.columns': JSON.stringify({ order: ['symbol'], hidden: [] }),
      'uct.j2.calendar.mode': 'month',
      'uct.j2.analytics.section.edge': 'open',
      'uct.j2.holdings.sort': 'symbol:asc',
      'uct.j2.nudges.dismissed.acc-123': '["n1"]',
    }
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)

    runJ2LocalStorageMigrations()

    // Every seeded key survives byte-for-byte…
    for (const [k, v] of Object.entries(seed)) {
      expect(localStorage.getItem(k)).toBe(v)
    }
    // …and the migration flag is set.
    expect(localStorage.getItem(FLAG)).toBe('1')
  })

  it('a no-op second run still preserves existing keys', () => {
    localStorage.setItem('uct.j2.selectedAccountId', 'acc-9')
    runJ2LocalStorageMigrations()
    runJ2LocalStorageMigrations()
    expect(localStorage.getItem('uct.j2.selectedAccountId')).toBe('acc-9')
  })

  it('treats an already-set flag as fully migrated (no-op, keys untouched)', () => {
    localStorage.setItem(FLAG, '1')
    localStorage.setItem('uct.j2.selectedAccountId', 'acc-7')
    expect(runJ2LocalStorageMigrations()).toBe(false)
    expect(localStorage.getItem('uct.j2.selectedAccountId')).toBe('acc-7')
  })
})
