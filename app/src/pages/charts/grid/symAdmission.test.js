import { describe, it, expect } from 'vitest'
import { chartKeys, admittedSym } from './symAdmission'

describe('symAdmission', () => {
  it('chartKeys skips empty cells and encodes id::sym', () => {
    const cells = [{ id: 'a', sym: 'NVDA' }, { id: 'b', sym: null }, { id: 'c', sym: 'AMD' }]
    expect(chartKeys(cells)).toEqual(['a::NVDA', 'c::AMD'])
  })

  it('shows target sym once admitted', () => {
    const cell = { id: 'a', sym: 'RKLB' }
    const mounted = new Set(['a::RKLB'])
    expect(admittedSym(cell, mounted, {})).toEqual({ sym: 'RKLB', admitted: true })
  })

  it('holds the previous sym while the new one awaits admission (no remount)', () => {
    const cell = { id: 'a', sym: 'RKLB' }       // just swapped from SPY
    const mounted = new Set()                   // RKLB not admitted yet
    const prev = { a: 'SPY' }                    // SPY was admitted before
    expect(admittedSym(cell, mounted, prev)).toEqual({ sym: 'SPY', admitted: false })
  })

  it('null on first-ever mount (skeleton)', () => {
    expect(admittedSym({ id: 'a', sym: 'RKLB' }, new Set(), {})).toEqual({ sym: null, admitted: false })
  })
})
