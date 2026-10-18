import { describe, it, expect } from 'vitest'
import { effectiveDayBasis, isBrokerAccount } from './dayBasis'

describe('effectiveDayBasis', () => {
  const broker = { balanceSource: 'snaptrade' }

  it('a manual account is always read on the closed basis, whatever the preference says', () => {
    expect(effectiveDayBasis({ balanceSource: 'manual' }, { j2_calendar_pnl_basis: JSON.stringify('account') })).toBe('closed')
  })

  it('no account (All Accounts) is the closed basis', () => {
    expect(effectiveDayBasis(null, { j2_calendar_pnl_basis: JSON.stringify('account') })).toBe('closed')
    expect(effectiveDayBasis(undefined, {})).toBe('closed')
  })

  it('an account with no balance source is not a broker account', () => {
    expect(effectiveDayBasis({}, { j2_calendar_pnl_basis: JSON.stringify('account') })).toBe('closed')
  })

  it('a broker account follows the member\'s basis preference (stored as JSON)', () => {
    expect(effectiveDayBasis(broker, { j2_calendar_pnl_basis: JSON.stringify('closed') })).toBe('closed')
    expect(effectiveDayBasis(broker, { j2_calendar_pnl_basis: JSON.stringify('account') })).toBe('account')
  })

  it('a broker account with no preference yet reads on the account basis', () => {
    expect(effectiveDayBasis(broker, {})).toBe('account')
    expect(effectiveDayBasis(broker, undefined)).toBe('account')
  })
})

describe('isBrokerAccount', () => {
  it('is true only for an account with a balance source other than manual', () => {
    expect(isBrokerAccount({ balanceSource: 'snaptrade' })).toBe(true)
    expect(isBrokerAccount({ balanceSource: 'manual' })).toBe(false)
    expect(isBrokerAccount({})).toBe(false)
    expect(isBrokerAccount(null)).toBe(false)
    expect(isBrokerAccount(undefined)).toBe(false)
  })
})
