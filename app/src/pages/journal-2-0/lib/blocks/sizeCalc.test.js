// Wave 10 Task 10.20: the position size calculator's arithmetic (W10-R8). Pure, so every reason is asserted by its
// exact sentence and every number by its value.
import { describe, it, expect } from 'vitest'
import { sizeFor, pctOf, RISK_PCT_MAX, REASONS } from './sizeCalc'

const ok = { entry: 100, stop: 97, riskPct: 1, accountSize: 10000 }

describe('sizeFor', () => {
  it('floor_shares_long_and_short', () => {
    // 10,000 x 1% = $100 of risk over $3 a share = 33.3, rounded DOWN to 33 (never over the risk the member set)
    expect(sizeFor(ok)).toEqual({ ok: true, shares: 33, riskDollars: 99, positionValue: 3300, positionPct: 33, side: 'long' })
    // a stop above the entry is a short; |entry - stop| sizes it the same way
    expect(sizeFor({ entry: 20, stop: 21, riskPct: 2, accountSize: 10000 }))
      .toEqual({ ok: true, shares: 200, riskDollars: 200, positionValue: 4000, positionPct: 40, side: 'short' })
    // float noise (1.10 - 1.00 is 0.10000000000000009) never costs a share the arithmetic says fits exactly
    expect(sizeFor({ entry: 1.1, stop: 1, riskPct: 1, accountSize: 1000 }).shares).toBe(100)
    // numbers typed as text are read as numbers
    expect(sizeFor({ entry: '100', stop: '97', riskPct: '1', accountSize: '10000' }).shares).toBe(33)
  })

  it('each reason is its exact sentence', () => {
    expect(REASONS).toEqual({
      levels: 'Enter an entry and a stop.',
      same: "Entry and stop can't be the same.",
      risk: 'Enter the risk per trade, up to 10%.',
      account: 'Set your account size, or enter one for this note.',
      underOne: 'Your risk is smaller than one share at this stop.',
    })
    const reason = (p) => sizeFor({ ...ok, ...p })
    for (const p of [{ entry: undefined }, { stop: undefined }, { entry: '' }, { stop: 0 }, { entry: -5 }, { stop: 'abc' }]) {
      expect(reason(p), JSON.stringify(p)).toEqual({ ok: false, reason: 'Enter an entry and a stop.' })
    }
    expect(reason({ stop: 100 })).toEqual({ ok: false, reason: "Entry and stop can't be the same." })
    for (const riskPct of [undefined, '', 0, -1, 10.01, 50, Infinity, 'x']) {
      expect(reason({ riskPct }), String(riskPct)).toEqual({ ok: false, reason: 'Enter the risk per trade, up to 10%.' })
    }
    for (const accountSize of [undefined, null, '', 0, -100, NaN]) {
      expect(reason({ accountSize }), String(accountSize)).toEqual({ ok: false, reason: 'Set your account size, or enter one for this note.' })
    }
    expect(reason({ accountSize: 100, riskPct: 1 })).toEqual({ ok: false, reason: 'Your risk is smaller than one share at this stop.' })
  })

  it('under_one_share_sentence_never_zero', () => {
    // $1 of risk over a $3 stop: less than one share. The answer is the sentence, never "0 shares".
    const r = sizeFor({ entry: 100, stop: 97, riskPct: 1, accountSize: 100 })
    expect(r).toEqual({ ok: false, reason: 'Your risk is smaller than one share at this stop.' })
    expect(r.shares).toBeUndefined()
    expect(JSON.stringify(r)).not.toMatch(/0 shares|"shares":0/)
    // exactly one share is a size
    expect(sizeFor({ entry: 100, stop: 97, riskPct: 3, accountSize: 100 })).toMatchObject({ ok: true, shares: 1 })
  })

  it('risk_pct_cap_10', () => {
    expect(RISK_PCT_MAX).toBe(10)
    expect(sizeFor({ ...ok, riskPct: 10 })).toMatchObject({ ok: true, shares: 333 })
    expect(sizeFor({ ...ok, riskPct: 10.000001 })).toEqual({ ok: false, reason: 'Enter the risk per trade, up to 10%.' })
    expect(sizeFor({ ...ok, riskPct: 0.25 })).toMatchObject({ ok: true, shares: 8 })      // $25 / $3
  })

  it('pctOf rounds to two places and refuses a missing whole', () => {
    expect(pctOf(99, 10000)).toBe(0.99)
    expect(pctOf(1, 3)).toBe(33.33)
    expect(pctOf(5, 0)).toBeNull()
    expect(pctOf(5, undefined)).toBeNull()
  })
})
