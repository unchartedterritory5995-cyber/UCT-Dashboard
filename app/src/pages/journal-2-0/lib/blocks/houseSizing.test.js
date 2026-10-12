import { describe, it, expect } from 'vitest'
import TABLE from '../../../../constants/houseSizing.json'
import {
  houseSize, accountSizeFor, roundPct, SIZE_CEILING_PCT, MAX_ACCOUNT_RISK_PCT, REGIME_OF, PLACEHOLDER_ACCOUNT_SIZE,
  PREFERRED_ACCOUNT_RISK_PCT,
} from './houseSizing'

describe('the house table (R-P2-5; app/src/constants/houseSizing.json, railed by tests/test_house_sizing_table.py)', () => {
  it('carries every cell the spec names', () => {
    expect(SIZE_CEILING_PCT.GREEN['A+']).toBe(25)
    expect(SIZE_CEILING_PCT.YELLOW['A+']).toBe(15)
    expect(SIZE_CEILING_PCT.ORANGE['A+']).toBe(8)
    expect(SIZE_CEILING_PCT.ORANGE.B).toBe(0)
    expect(MAX_ACCOUNT_RISK_PCT).toBe(2)
    expect(REGIME_OF.amber).toBe('YELLOW')
  })
  it('every export is READ from the one table, never restated (IR-S10)', () => {
    expect(SIZE_CEILING_PCT).toEqual(TABLE.ceilingPct)
    expect(REGIME_OF).toEqual(TABLE.regimeWords)
    expect(MAX_ACCOUNT_RISK_PCT).toBe(TABLE.maxAccountRiskPct)
    expect(PLACEHOLDER_ACCOUNT_SIZE).toBe(TABLE.placeholderAccountSize)
  })
})

describe('houseSize', () => {
  it('the regime ceiling binds when the stop is tight', () => {
    const r = houseSize({ entry: 100, stop: 95, accountSize: 100000, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, stopPct: 5, sizePct: 25, riskPct: 1.25, shares: 250, riskDollars: 1250, boundBy: 'regime' })
  })
  it('the 2% cap binds when the stop is wide', () => {
    const r = houseSize({ entry: 100, stop: 90, accountSize: 100000, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ stopPct: 10, sizePct: 20, riskPct: 2, shares: 200, boundBy: 'risk' })
  })
  it('a short sizes the same way', () => {
    expect(houseSize({ entry: 50, stop: 52.5, accountSize: 10000, grade: 'A', regime: 'YELLOW' }))
      .toMatchObject({ ok: true, stopPct: 5, sizePct: 12 })
  })
  it('wrong-side, equal and skip cases size nothing and say why', () => {
    expect(houseSize({ entry: 100, stop: 100, accountSize: 1e5, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false, reason: 'Entry and stop are the same price.' })
    expect(houseSize({ entry: 100, stop: -1, accountSize: 1e5, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'B', regime: 'ORANGE' }))
      .toMatchObject({ ok: false, skip: true, reason: 'The house rules skip a B setup in an ORANGE market.' })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'A+', regime: 'RED' })).toMatchObject({ skip: true })
  })
  it('no account size or no regime: not sized, and says what is missing', () => {
    expect(houseSize({ entry: 100, stop: 95, accountSize: null, grade: 'A', regime: 'GREEN' })).toMatchObject({ ok: false, reason: 'Set your account size in Settings.' })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'A', regime: null })).toMatchObject({ ok: false, reason: 'The market regime is not known yet.' })
  })
  it('never a negative or fractional share count', () => {
    const r = houseSize({ entry: 333.33, stop: 320, accountSize: 777, grade: 'A', regime: 'GREEN' })
    expect(Number.isInteger(r.shares) && r.shares >= 0).toBe(true)
  })
})

describe('houseSize at the edges (integrator ruling: rounding is explicit and tested)', () => {
  const A = 100000
  it('EXACTLY 2% risk is allowed: both limits meet, and the size is the ceiling', () => {
    // 25% x 8% = 2.00%: the regime ceiling and the 2% cap are the same size here.
    const r = houseSize({ entry: 100, stop: 92, accountSize: A, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, stopPct: 8, sizePct: 25, shares: 250, riskDollars: 2000, riskPct: 2, plannedRiskPct: 2, boundBy: 'regime' })
  })
  it('JUST OVER 2% at the ceiling: the 2% cap binds and the risk stays at or under 2%', () => {
    // 25% x 8.01% = 2.0025% > 2%, so the size drops to 2 / 8.01 = 24.968...%
    const r = houseSize({ entry: 100, stop: 91.99, accountSize: A, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, stopPct: 8.01, sizePct: 24.97, shares: 249, riskDollars: 1994.49, riskPct: 1.99, plannedRiskPct: 2, boundBy: 'risk' })
    expect(r.riskDollars).toBeLessThanOrEqual(A * 0.02)
  })
  it('a stop distance that ROUNDS to 8.00% but is 8.004% is still over the line: the cap uses the real distance', () => {
    // 25% x 8.004% = 2.001%: sizing off the shown 8.00% would put $2,001 at risk on $100,000.
    const r = houseSize({ entry: 100, stop: 91.996, accountSize: A, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, stopPct: 8, boundBy: 'risk', shares: 249 })
    expect(r.riskDollars).toBeLessThanOrEqual(A * 0.02)
  })
  it('a stop distance of 0 is refused with a sentence; nothing is divided by it', () => {
    const r = houseSize({ entry: 100, stop: 100, accountSize: A, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: false, code: 'same', reason: 'Entry and stop are the same price.' })
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  })
  it('a stop distance too small to show (0.00%) still sizes from the real distance, never Infinity', () => {
    const r = houseSize({ entry: 1000, stop: 999.999, accountSize: A, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, stopPct: 0, sizePct: 25, shares: 25, boundBy: 'regime' })
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  })
  it('a zero or negative entry or stop is refused with a sentence', () => {
    for (const [entry, stop] of [[0, 95], [100, 0], [-100, 95], [100, -95], ['', 95], [100, undefined], [NaN, 95]]) {
      expect(houseSize({ entry, stop, accountSize: A, grade: 'A', regime: 'GREEN' }), `${entry}/${stop}`)
        .toMatchObject({ ok: false, code: 'prices', reason: 'Enter an entry and a stop above zero.' })
    }
  })
  it('floating-point noise never costs a share at exactly 2%: 1.10 - 1.00 is 0.10, not 0.1000000000000001', () => {
    // 2,000 risk dollars / 0.10 a share = 20,000 shares exactly; a bare float divide gives 19,999.
    const r = houseSize({ entry: 1.1, stop: 1, accountSize: A, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, shares: 20000, riskDollars: 2000, riskPct: 2, boundBy: 'risk' })
  })
  it('the risk NEVER exceeds 2% of the account, across a sweep of prices, stops, grades and regimes', () => {
    let checked = 0
    for (const regime of ['GREEN', 'YELLOW', 'ORANGE']) {
      for (const grade of ['A+', 'A', 'B']) {
        for (const entry of [0.37, 1.1, 7.77, 19.99, 100, 333.33, 1234.5]) {
          for (const stopFrac of [0.001, 0.013, 0.05, 0.0801, 0.12, 0.3, 0.9]) {
            for (const dir of [-1, 1]) {
              const stop = entry * (1 + dir * stopFrac)
              const r = houseSize({ entry, stop, accountSize: 54321, grade, regime })
              if (!r.ok) continue
              checked += 1
              expect(r.riskDollars, `${regime} ${grade} ${entry}/${stop}`).toBeLessThanOrEqual(54321 * 0.02 + 1e-6)
              expect(r.positionDollars).toBeLessThanOrEqual(54321 * SIZE_CEILING_PCT[regime][grade] / 100 + 1e-6)
              expect(Number.isInteger(r.shares) && r.shares > 0).toBe(true)
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300)                                       // non-vacuity
  })
  it('a size smaller than one share is not a size: it says so', () => {
    const r = houseSize({ entry: 333.33, stop: 320, accountSize: 777, grade: 'A', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: false, code: 'tooSmall', shares: 0, reason: 'At this size the account buys less than one share.' })
  })
  it('a skip is known before any price is entered, and its sentence reads as English', () => {
    expect(houseSize({ grade: 'B', regime: 'ORANGE' })).toMatchObject({ ok: false, skip: true, code: 'skip' })
    expect(houseSize({ grade: 'A+', regime: 'RED' }).reason).toBe('The house rules skip an A+ setup in a RED market.')
    expect(houseSize({ grade: 'A', regime: 'RED' }).reason).toBe('The house rules skip an A setup in a RED market.')
  })
  it('R-M2-1 (e): `label` words the regime in a sentence; the table key still decides the size', () => {
    expect(houseSize({ grade: 'B', regime: 'ORANGE', label: 'Orange' }).reason)
      .toBe('The house rules skip a B setup in an Orange market.')
    expect(houseSize({ entry: 100, stop: 95, accountSize: 1e5, grade: 'A+', regime: 'GREEN', label: 'Green' }))
      .toMatchObject({ ok: true, sizePct: 25 })
  })
  it('I-1: positionPct is what the WHOLE shares hold, beside the house size (a $7,000 account, one $1,000 share)', () => {
    const r = houseSize({ entry: 1000, stop: 950, accountSize: 7000, grade: 'A+', regime: 'GREEN' })
    expect(r).toMatchObject({ ok: true, sizePct: 25, shares: 1, positionDollars: 1000, positionPct: 14.29 })
    expect(houseSize({ entry: 100, stop: 95, accountSize: 50000, grade: 'A+', regime: 'GREEN' }).positionPct).toBe(25)
  })
  it('the preferred risk (under 1%) is read from the one table', () => {
    expect(PREFERRED_ACCOUNT_RISK_PCT).toBe(TABLE.preferredAccountRiskPct)
    expect(PREFERRED_ACCOUNT_RISK_PCT).toBe(1)
  })
  it('an unknown grade asks for one', () => {
    expect(houseSize({ entry: 100, stop: 95, accountSize: A, grade: 'C', regime: 'GREEN' })).toMatchObject({ ok: false, code: 'grade', reason: 'Pick a setup grade.' })
  })
  it('roundPct rounds half UP at two places, in decimal (1.005 -> 1.01, not 1.00)', () => {
    expect(roundPct(1.005)).toBe(1.01)
    expect(roundPct(24.968789)).toBe(24.97)
    expect(roundPct(2)).toBe(2)
    expect(roundPct(0.004)).toBe(0)
  })
})

describe('accountSizeFor (IR-S9)', () => {
  it('the default account size is not an account size', () => {
    expect(accountSizeFor({ params: {}, settings: { accountSize: PLACEHOLDER_ACCOUNT_SIZE } })).toBeNull()
    expect(accountSizeFor({ params: {}, settings: {} })).toBeNull()
  })
  it('a size the member set in Settings counts; a size typed into this note wins', () => {
    expect(accountSizeFor({ params: {}, settings: { accountSize: 25000 } })).toBe(25000)
    expect(accountSizeFor({ params: { accountSize: 100000 }, settings: { accountSize: PLACEHOLDER_ACCOUNT_SIZE } })).toBe(100000)
  })
  it('settings not loaded, a zero, a negative, a string or a non-number is not an account size', () => {
    for (const settings of [undefined, null, { accountSize: 0 }, { accountSize: -5 }, { accountSize: 'abc' }, { accountSize: Infinity }]) {
      expect(accountSizeFor({ params: {}, settings }), JSON.stringify(settings)).toBeNull()
    }
    expect(accountSizeFor({ params: { accountSize: -1 }, settings: { accountSize: 30000 } })).toBe(30000)
  })
})
