// Wave 4 (lane A): CATH's day — YYYY-MM-DD or MM/DD, Eastern time, never in the future.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, applyArgs } from './args'
import { BY_CODE } from './functions'
import parseCommand from './parseCommand'

const ctx = { today: '2026-10-09' }
const p = (t) => ARG_KINDS.etDate.parse(t, ctx)

describe('etDate', () => {
  it('takes YYYY-MM-DD and MM/DD (this year, or last year when this year\'s is still ahead)', () => {
    expect(p('2026-10-01')).toBe('2026-10-01')
    expect(p('10/01')).toBe('2026-10-01')
    expect(p('10/9')).toBe('2026-10-09')
    expect(p('12/24')).toBe('2025-12-24')
  })
  it('refuses a future day, an impossible day and anything else', () => {
    expect(p('2026-10-10')).toBeNull()
    expect(p('2026-02-30')).toBeNull()
    expect(p('13/01')).toBeNull()
    expect(p('TODAY')).toBeNull()
    expect(p('NVDA')).toBeNull()
  })
  it('CATH declares it, and applies it as the page\'s `date` prop', () => {
    const r = applyArgs(BY_CODE.CATH.market, ['10/01'], ctx)
    expect(r.props).toEqual({ date: '2026-10-01' })
    expect(r.applied).toEqual(['day 2026-10-01'])
    expect(applyArgs(BY_CODE.CATH.market, ['2099-01-01'], ctx).ignored).toEqual(['2099-01-01'])
  })
  it('the parser reads `CATH 2026-10-01` as CATH with a day, not a ticker', () => {
    expect(parseCommand('CATH 2026-10-01')).toMatchObject({ ok: true, code: 'CATH', sym: null, args: ['2026-10-01'] })
    expect(parseCommand('cath 10/01')).toMatchObject({ ok: true, code: 'CATH', sym: null, args: ['10/01'] })
  })
})
