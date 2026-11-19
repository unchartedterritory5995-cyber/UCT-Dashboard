import { describe, it, expect } from 'vitest'
import { DEFAULT_COLUMNS, defaultsFor } from './defaultColumns'
import { COLS } from '../Breadth'

// The owner's core Default (2026-11-19), pinned by label so a renamed key fails here.
const LABELS = ['Health', 'UCT Exp', 'Up 4%+', 'Dn 4%+', '5D Ratio', '10D Ratio', 'Up20%/5d', 'Dn20%/5d',
  'Up25%/Qtr', 'Dn25%/Qtr', 'Up13%/34d', 'Dn13%/34d', 'Universe', 'SPY MA', 'QQQ MA', '>20SMA', '>50SMA', '>200SMA',
  'VIX', 'CNN F/G', 'Net NH-NL', 'A/D']

describe('the Monitor default columns', () => {
  const byKey = Object.fromEntries(COLS.map(c => [c.key, c]))
  it('every default key is a real metric, in the owner’s order', () => {
    expect(DEFAULT_COLUMNS.map(k => byKey[k]?.label)).toEqual(LABELS)
  })
  it('FTD is off the default but still a metric (Columns can turn it back on)', () => {
    expect(DEFAULT_COLUMNS).not.toContain('is_ftd')
    expect(byKey.is_ftd).toBeTruthy()
    const d = defaultsFor(COLS.map(c => c.key))
    expect(d.hidden).toContain('is_ftd')
  })
  it('defaultsFor hides everything else and keeps the rest after the core, in code order', () => {
    const keys = COLS.map(c => c.key)
    const d = defaultsFor(keys)
    expect(d.hidden.length + DEFAULT_COLUMNS.length).toBe(keys.length)
    expect(d.order.slice(0, DEFAULT_COLUMNS.length)).toEqual([...DEFAULT_COLUMNS])
    expect(new Set(d.order)).toEqual(new Set(keys))
  })
})
