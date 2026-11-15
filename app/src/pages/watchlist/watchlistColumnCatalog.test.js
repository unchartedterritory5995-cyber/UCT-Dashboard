import { describe, expect, it } from 'vitest'
import { FACT_COLUMNS, LIVE_COLUMNS, factFieldsFor, factValue, factText, COLUMN_PRESETS } from './watchlistColumnCatalog'
import { EXTRA_COLS, OPTIONAL_COLS } from './watchlistColumns'

const near = (a, b) => expect(Math.abs(a - b)).toBeLessThan(1e-9)

describe('factValue — the snapshot re-based on the live price', () => {
  it('a static field is shown as stored', () => {
    expect(factValue('rsrank', { rs_rank: 91 }, { price: 10 })).toBe(91)
  })
  it('YTD compounds today’s live move onto the snapshot change', () => {
    // +20% YTD at a 100 close; live 110 → 1.2 × 1.1 − 1 = +32%
    near(factValue('ytd', { chg_pct_ytd: 20, price: 100 }, { price: 110 }), 32)
  })
  it('% from the 50 SMA is re-measured from the recovered average', () => {
    // 10% above the SMA at 110 → SMA 100; live 105 → +5%
    near(factValue('sma50d', { pct_vs_sma50: 10, price: 110 }, { price: 105 }), 5)
  })
  it('% from the 52-week high clamps at 0 on a new high', () => {
    // 20% below the high at 80 → high 100; live 90 → −10%; live 120 → 0 (new high)
    near(factValue('h52', { dist_52w_high_pct: -20, price: 80 }, { price: 90 }), -10)
    expect(factValue('h52', { dist_52w_high_pct: -20, price: 80 }, { price: 120 })).toBe(0)
  })
  it('price-target upside uses the stored target vs the live price', () => {
    // +25% upside at 80 → target 100; live 90 → +11.11%
    near(factValue('ptup', { pt_upside_pct: 25, price: 80 }, { price: 90 }), (100 / 90 - 1) * 100)
  })
  it('no live price keeps the snapshot value; no snapshot row is null', () => {
    expect(factValue('sma50d', { pct_vs_sma50: 10, price: 110 }, {})).toBe(10)
    expect(factValue('sma50d', null, { price: 1 })).toBeNull()
  })
  it('text facts are capitalised for display', () => {
    expect(factText('mastack', factValue('mastack', { ma_stack: 'full-bull' }, {}))).toBe('Full-bull')
  })
})

describe('the catalog', () => {
  it('asks only for the fields the visible columns need (+ the close to re-base)', () => {
    expect(factFieldsFor(['rsrank'])).toEqual(['rs_rank'])
    expect(factFieldsFor(['ytd', 'price'])).toEqual(['chg_pct_ytd', 'price'])
  })
  it('Gap % is the open vs the previous close', () => {
    near(LIVE_COLUMNS.gap.value({ day_open: 105, prev_close: 100 }), 5)
  })
  it('every preset names only columns that exist and work', () => {
    const real = new Set([...OPTIONAL_COLS, ...EXTRA_COLS].map((c) => c.key))
    for (const p of COLUMN_PRESETS) for (const k of p.cols) expect(real.has(k), `${p.name}: ${k}`).toBe(true)
  })
  it('every new column is offered to the Agent too (EXTRA_COLS)', () => {
    const extra = new Set(EXTRA_COLS.map((c) => c.key))
    for (const k of [...Object.keys(FACT_COLUMNS), ...Object.keys(LIVE_COLUMNS)]) expect(extra.has(k), k).toBe(true)
  })
})
