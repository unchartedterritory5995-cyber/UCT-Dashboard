import { describe, it, expect } from 'vitest'
import pkg from '../../../package.json'
import lwcPkg from 'lightweight-charts/package.json'

describe('renderer pin', () => {
  it('declares an EXACT lightweight-charts version (no range)', () => {
    const v = pkg.dependencies['lightweight-charts']
    expect(v).toBe('5.2.0')
    expect(v).not.toMatch(/[\^~*x]/)   // a range makes parity baselines unenforceable
  })

  it('has 5.2.0 actually installed', () => {
    expect(lwcPkg.version).toBe('5.2.0')
  })
})
