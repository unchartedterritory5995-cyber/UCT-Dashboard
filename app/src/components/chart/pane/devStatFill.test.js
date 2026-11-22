// Dev-only header stat placeholders (owner 11-17): stable, plausible per type, only where the real value is missing.
import { describe, it, expect } from 'vitest'
import { devStatValue, withDevStatFill, compact } from './devStatFill'

// TERM-066: the placeholder ladder moved onto the shared formatter; held byte for byte to its
// pre-migration body (036cf2ff83), run in-process. ⛔ Do not "fix" the oracle.
const OLD_COMPACT = (n) => (n >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${(n / 1e3).toFixed(1)}K`)

describe('devStatFill', () => {
  it('is stable per symbol + stat key, and differs across symbols', () => {
    expect(devStatValue('AAA', 'chg', { signed: true })).toEqual(devStatValue('AAA', 'chg', { signed: true }))
    const vals = new Set(['AAA', 'BBB', 'CCC', 'DDD'].map((s) => devStatValue(s, 'mcap').value))
    expect(vals.size).toBeGreaterThan(1)
  })
  it('looks right per type', () => {
    expect(devStatValue('X', 'chg', { signed: true }).value).toMatch(/^[+-]\d+\.\d\d%$/)
    expect(devStatValue('X', 'price').value).toMatch(/^\$\d+\.\d\d$/)
    expect(devStatValue('X', 'mcap').value).toMatch(/^\d+(\.\d+)?[KMBT]$/)
    expect(devStatValue('X', 'earn').value).toMatch(/^\d{1,2}\/\d{1,2}\/20\d\d$/)
    expect(devStatValue('X', 'pe').value).toMatch(/^\d+(\.\d+)?$/)
    expect(typeof devStatValue('X', 'sector').value).toBe('string')
    expect(devStatValue('X', 'cx:c1', { custom: true }).value).toMatch(/^-?\d+\.\d\d$/)
  })
  it('the compact placeholder reads exactly as before (TERM-066)', () => {
    const grid = [0, 1, 49, 50, 999, 1000, 999_949, 999_950, 1e6, 999_949_999, 999_950_000, 1e9,
      2e9, 900e9, 999_949_999_999, 999_995_000_000, 1e12, 3.456e12]
    for (const n of grid) expect(compact(n), String(n)).toBe(OLD_COMPACT(n))
    for (const sym of ['AAA', 'NVDA', 'X', 'BRK.B']) {
      for (const key of ['mcap', 'vol', 'dolvol', 'avgvol', 'avgdv', 'float', 'shares']) {
        expect(devStatValue(sym, key).value).toMatch(/^\d+\.\d{1,2}[KMBT]$/)
      }
    }
  })

  it('fills only missing values; signed ones get a sign and its color', () => {
    const items = [{ key: 'mcap', value: '1.0B' }, { key: 'chg', value: null }, { key: 'pe', value: '—' }]
    const out = withDevStatFill(items, 'X', { isSigned: (it) => it.key === 'chg' })
    expect(out[0]).toBe(items[0])
    expect(out[1].value).toMatch(/%$/)
    expect(['pos', 'neg']).toContain(out[1].sign)
    expect(out[1].color).toBeTruthy()
    expect(out[2].value).not.toBe('—')
  })
})
