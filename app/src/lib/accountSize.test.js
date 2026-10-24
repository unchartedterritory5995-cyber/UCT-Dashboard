import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UNSET_ACCOUNT_SIZE, resolvedAccountSize } from './accountSize'
import { CHART_DEFAULTS, mergeChartSettings } from '../components/chart/chartDefaults'

// Round B fix 1: ONE unset account size on the client, pinned to the server's by
// tests/test_account_size_authority.py; every client default reads it.
describe('the one client unset account size', () => {
  it('is 100,000', () => {
    expect(UNSET_ACCOUNT_SIZE).toBe(100000)
  })

  it('is the chart position calculator default, for a member who never set the calculator', () => {
    expect(CHART_DEFAULTS.positionCalc.accountSize).toBe(UNSET_ACCOUNT_SIZE)
    expect(mergeChartSettings({}).positionCalc.accountSize).toBe(UNSET_ACCOUNT_SIZE)
    expect(mergeChartSettings({ positionCalc: { accountSize: 42000 } }).positionCalc.accountSize).toBe(42000)
  })

  it('the calculator panel has no second literal default', () => {
    const src = readFileSync(resolve(__dirname, '../components/StockChart.jsx'), 'utf8')
    const line = src.split('\n').find((l) => l.includes('accountSize={cs.positionCalc?.accountSize'))
    expect(line).toBeTruthy()                                       // control: the read is still here
    expect(line).toContain('CHART_DEFAULTS.positionCalc.accountSize')
    expect(line).not.toMatch(/\?\?\s*\d/)
  })
})

describe('resolvedAccountSize (OpenPositionsTab, TodayMarketLead)', () => {
  it("uses the server's answer: the default when unset, the member's own when set", () => {
    expect(resolvedAccountSize({ accountSize: 0, accountSizeIsDefault: true, defaultAccountSize: 100000 })).toBe(100000)
    expect(resolvedAccountSize({ accountSize: 100000, accountSizeIsDefault: true })).toBe(UNSET_ACCOUNT_SIZE)
    expect(resolvedAccountSize({ accountSize: 73000, accountSizeIsDefault: false })).toBe(73000)
  })
  it('a payload without the answer keeps the stored value; no settings is 0', () => {
    expect(resolvedAccountSize({ accountSize: 64000 })).toBe(64000)
    expect(resolvedAccountSize(undefined)).toBe(0)
  })
})
