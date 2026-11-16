// ─── ⭐⭐ RS RATING L9 — OUR STORE'S CLASS REACHES THE HARNESS CTX, SO AN ETF KEYS THE L3 ROW ──────
//
// On a member's chart `securityType` is our store's instrument class (`ticker_meta.security_type`,
// `StockChart.jsx`), and `bind.js::classificationWith` serves TradingView's string from a witnessed
// `by_class` row keyed by it (the ETF row: 'Investment Trusts/Mutual Funds' / 'Miscellaneous',
// Q-RS4). The harness had no such field, so an ETF capture could never key that row. Now a recorded
// supply's `store.securityType` (`{value, source}`) feeds it (`ourSide.js::recordedStoreOf`). It is
// OUR fact, never the vendor's: a capture carries TradingView's `type`, which is not our class.
// Rails over the committed Q-RS4 probe's bars (RDDT): a refusal per malformed record, and a control.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recordedSupplyOf, runOurSide, HARNESS_SUPPLY_SCHEMA, __setSupplyDirForTests } from './ourSide'
import { loadCapture, HARNESS_DIR } from './harness'

vi.setConfig({ testTimeout: 120000 })

const PROBE = 'rs-syminfo-industry-rddt-1d-2026-11-15'
const probe = () => loadCapture(path.join(HARNESS_DIR, `${PROBE}.json`)).capture
// The probe's own source is refused whole at the door, so the run rails use its bars with the L3
// accept shape: a plot that folds on `syminfo.industry`.
const MICRO = '//@version=5\nindicator("l9 class")\n'
  + 'isFund = syminfo.industry == "Investment Trusts/Mutual Funds"\n'
  + 'plot(isFund ? close : open, "fund")\nplot(close, "close")\nplot(open, "open")\n'
const micro = () => { const c = probe(); return { ...c, source: { ...c.source, text: MICRO } } }
const SOURCE = 'rail: a stated class, to prove the row is keyed (not a measurement of our store)'

function dirWith(rec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l9-store-'))
  fs.writeFileSync(path.join(dir, `${PROBE}.json`), JSON.stringify({ schema: HARNESS_SUPPLY_SCHEMA, capture: PROBE, ...rec }))
  return dir
}
const storeOf = (securityType) => ({ store: { securityType } })
/** Our side's column for a plot title (null when refused). */
const col = (ours, title) => {
  const p = (ours.plots || []).find((x) => x.title === title)
  return p ? p.column : undefined
}

afterEach(() => __setSupplyDirForTests(null))

describe('L9 — recordedSupplyOf reads `store.securityType` only as our store\'s class', () => {
  it('⛔ a value outside Stock / ADR / ETF is refused (TradingView\'s `fund` is not our class)', () => {
    const dir = dirWith(storeOf({ value: 'fund', source: SOURCE }))
    expect(() => recordedSupplyOf(probe(), dir)).toThrow(/must be one of Stock \/ ADR \/ ETF/)
  })

  it('⛔ a class that does not say where it was read is refused', () => {
    expect(() => recordedSupplyOf(probe(), dirWith(storeOf({ value: 'ETF' })))).toThrow(/where our store's class was read/)
  })

  it('⛔ a class cited as a vendor value is refused', () => {
    const dir = dirWith(storeOf({ value: 'ETF', source: SOURCE, vendorValueFrom: 'capture.symbol.type' }))
    expect(() => recordedSupplyOf(probe(), dir)).toThrow(/never a vendor value/)
  })

  it('⛔ any other store field is refused', () => {
    expect(() => recordedSupplyOf(probe(), dirWith({ store: { exchange: { value: 'NYSE', source: SOURCE } } })))
      .toThrow(/not a store field the bind reads/)
  })
})

describe('L9 — the class reaches the ctx and keys the witnessed row', () => {
  it('CONTROL: with no class, nothing is invented: the industry plot is refused by name, nothing declared', () => {
    const ours = runOurSide(micro())
    expect(ours.ok, String(ours.refusal)).toBe(true)
    expect(ours.notes.join(' ')).not.toMatch(/symbol class/)
    expect(ours.ctx.symbol.securityType).toBeUndefined()
    expect(col(ours, 'fund')).toBeNull()
    expect(ours.plots.find((x) => x.title === 'fund').missingReason).toContain('interpret:bind-time-text')
    expect(ours.substituted).toEqual([])
  })

  it('an ETF class serves TradingView\'s ETF string from the L3 row, untagged (nothing substituted)', () => {
    __setSupplyDirForTests(dirWith(storeOf({ value: 'ETF', source: SOURCE })))
    const ours = runOurSide(micro())
    expect(ours.ok, String(ours.refusal)).toBe(true)
    expect(ours.notes.join(' ')).toMatch(/symbol class ETF: our store's, recorded beside the capture/)
    expect(ours.ctx.symbol.securityType).toBe('ETF')
    expect(col(ours, 'fund')).toEqual(col(ours, 'close'))           // the fund branch was taken
    expect(col(ours, 'fund')).not.toEqual(col(ours, 'open'))
    expect(ours.substituted).toEqual([])
  })

  it('a Stock class keys no row (the table has none), so the industry plot is still refused', () => {
    __setSupplyDirForTests(dirWith(storeOf({ value: 'Stock', source: SOURCE })))
    const ours = runOurSide(micro())
    expect(ours.ok, String(ours.refusal)).toBe(true)
    expect(ours.notes.join(' ')).toMatch(/symbol class Stock/)
    expect(ours.ctx.symbol.securityType).toBe('Stock')
    expect(col(ours, 'fund')).toBeNull()
  })
})
