// Dev-only header stat placeholders (owner 11-17): stable, plausible per type, only where the real value is missing.
import { describe, it, expect } from 'vitest'
import { devStatValue, withDevStatFill } from './devStatFill'

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
