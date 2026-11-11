// W9-T4-F1 — the member door hands the broker the symbol's WITNESSED minimum contract.
//
// ⛔ TEST-ONLY WORLD, stated once: this file replaces two inputs the product reads from data files,
// and nothing else:
//   - `symbolScope.json::min_contract` gains SYNTHETIC rows: `NYSE` = 1 and `NYSE Arca` = 0.001 (a
//     made-up fractional answer on an exchange whose tick and listing rows ARE witnessed, so the run
//     reaches the sizing). `NASDAQ` keeps no row and is the unknown case. The committed table serves
//     NO row (no capture exists); `symbolScopeMinContract.test.js` rails that;
//   - `brokerPins.js::pinned` answers true for every rule (the test pin; the committed ledger pins none).
// Everything between — the door, `runtimeColumns.js`, the front end's fold, `vm.js`, `broker.js` — is the
// product's own code, unchanged.
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../../ast/symbolScope.json', async (importOriginal) => {
  const orig = await importOriginal()
  const base = orig.default || orig
  const row = (value, witness) => ({ value, witnesses: [witness], captured: 'TEST', how: 'synthetic test row',
    captures: ['(synthetic)'] })
  return {
    default: {
      ...base,
      min_contract: { ...base.min_contract, NYSE: row(1, 'NYSE:RDDT'), 'NYSE Arca': row(0.001, 'AMEX:SPY') },
    },
  }
})
vi.mock('../brokerPins.js', async (importOriginal) => ({ ...(await importOriginal()), pinned: () => true }))

const { computeRuntimeColumns } = await import('../runtimeColumns.js')
const { registerStrategyBrokerGate } = await import('../../strategyBrokerGateRegistry.js')
const { symbolConstants, minContractOf } = await import('../../ast/bind.js')

const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 }))
/** rising: open 100+i, high +1.5, low -1, close +0.5 (the W9-T4 rails' UP bars) */
const UP = barsOf(Array.from({ length: 30 }, (_, i) => [100 + i, 101.5 + i, 99 + i, 100.5 + i]))
const ctxFor = (symbol) => ({ tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol, historyWindowBars: 30 })
let seq = 0
const doc = (source) => ({ id: `w9mc-${seq += 1}`, meta: { runtimeHistory: 'strategy-window' },
  compute: { kind: 'runtime', fn: `runtime:w9mc-${seq}`, outputs: { p: 0, m: 1 }, source } })
const HEAD = { cash: 'default_qty_type = strategy.cash, default_qty_value = 10000',
  pct: 'default_qty_type = strategy.percent_of_equity, default_qty_value = 10' }
const src = (head, readsMin) => `//@version=5\nstrategy("t", ${head})\nif bar_index == 3\n`
  + '    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n'
  + (readsMin ? 'plot(syminfo.mincontract)\n' : '')
const run = (text, symbol, extra = {}) => {
  registerStrategyBrokerGate(() => true)
  try { return { cols: computeRuntimeColumns(doc(text), UP, { ...ctxFor(symbol), ...extra }) } } catch (err) { return { err } }
}
const col = (cols, key) => Array.from(cols[key] || [])
const RDDT = { ticker: 'RDDT', exchange: 'NYSE' }
const AAPL = { ticker: 'AAPL', exchange: 'NASDAQ' }

describe('W9-T4-F1 the member door: minContract is the symbol\'s witnessed value', () => {
  afterEach(() => registerStrategyBrokerGate(() => false))

  it('an equity on a witnessed exchange (NYSE:RDDT, mincontract 1) sizes: cash 96, percent 966', () => {
    // sized at bar 3's close 103.5: cash floor(10,000 / 103.5) = floor(96.6) = 96;
    // percent 10 of the 1,000,000 default capital: floor(100,000 / 103.5) = floor(966.2) = 966
    for (const [head, want] of [[HEAD.cash, 96], [HEAD.pct, 966]]) {
      const { cols, err } = run(src(head, false), RDDT)
      expect(err, err && err.message).toBeUndefined()
      expect(col(cols, 'p')[4]).toBe(want)
    }
  })
  it('the value a script reads from `syminfo.mincontract` is the value the broker sized with', () => {
    const { cols, err } = run(src(HEAD.cash, true), RDDT)
    expect(err, err && err.message).toBeUndefined()
    const m = col(cols, 'm')
    expect(m.length).toBe(30)
    expect(m.every((v) => v === 1)).toBe(true)
    expect(col(cols, 'p')[4]).toBe(96)
    expect(minContractOf(symbolConstants(RDDT))).toBe(1)
  })
  it('an exchange with no min_contract row (NASDAQ:AAPL): cash and percent sizing refuse Q-S1a BY NAME', () => {
    for (const head of [HEAD.cash, HEAD.pct]) {
      const { err } = run(src(head, false), AAPL)
      expect(err && err.guard).toBe('runtime:strategy-unsettled')
      expect(err.message).toMatch(/Q-S1a/)
      expect(err.message).toMatch(/minimum contract is not known to this run \(`syminfo\.mincontract` is stated only/)
    }
  })
  it('...and a script reading `syminfo.mincontract` there refuses by name (never a guessed 1)', () => {
    const { err } = run(src(HEAD.cash, true), AAPL)
    expect(err && err.guard).toBe('interpret:bind-time-text')
    expect(err.message).toMatch(/did not settle syminfo\.mincontract/)
  })
  for (const [what, symbol] of [
    ['a crypto pair our store gives no exchange', { ticker: 'BTCUSD', exchange: '' }],
    ['an unwitnessed exchange (OTC)', { ticker: 'AITX', exchange: 'OTC' }],
  ]) {
    it(`${what}: refused BY NAME before any size is taken (its tick is unsettled too)`, () => {
      const { err, cols } = run(src(HEAD.cash, false), symbol)
      expect(cols).toBeUndefined()
      expect(err && err.guard).toBe('interpret:bind-time-text')
      expect(err.message).toMatch(/did not settle syminfo\./)
    })
  }
  it('a fractional answer (synthetic NYSE Arca 0.001) refuses, called fractional', () => {
    const { err } = run(src(HEAD.cash, false), { ticker: 'SPY', exchange: 'NYSE Arca' })
    expect(err && err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/minimum contract is 0\.001, not 1 \(a fractional symbol/)
  })
  it('a caller cannot state it: ctx.minContract = 1 on an exchange with no row is ignored', () => {
    const { err } = run(src(HEAD.cash, false), AAPL, { minContract: 1 })
    expect(err && err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/not known to this run/)
  })
})
