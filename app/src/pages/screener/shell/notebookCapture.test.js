// G-040 ruling 1 — the Screener capture builder, driven directly.
import { describe, it, expect } from 'vitest'
import {
  buildScreenerCapture, screenerCriteria, screenerAsOf, screenerCellText, screenerPoolLabel,
} from './notebookCapture'
import { SCREENER_CAPTURE_ROW_CAP, normalizeParams, validateParams, isReconstructable } from '../../../widgets/registry'

const META = {
  filters: [
    { key: 'price', label: 'Price', unit: '$', presets: [{ label: 'Any' }] },
    { key: 'rs_rank', label: 'RS Rank', presets: [] },
  ],
}

describe('buildScreenerCapture', () => {
  const rows = [
    { ticker: 'NVDA', price: 180, chg_pct_1d: 1.234, rs_rank: 97 },
    { ticker: 'AMD', price: 150, chg_pct_1d: -2, rs_rank: null },
  ]
  const base = {
    meta: META,
    filters: { universe: { op: 'eq', value: 'uct', label: 'UCT Universe' }, price: { op: 'gte', min: 10 } },
    spec: { filters: { price: { op: 'gte', min: 10 } }, sort: { key: 'rs_rank', dir: 'desc' } },
    visibleColumns: ['ticker', 'price', 'chg_pct_1d', 'rs_rank'],
    displayRows: rows,
    livePrices: { NVDA: { price: 181.5, change_pct: 2.5 } },
    total: 57,
    snapshotDate: '2026-09-30',
    snapshot: null,
    scanReceipts: [],
  }

  it('freezes the rows AS SHOWN — display order, live cells, formatted values', () => {
    const c = buildScreenerCapture(base)
    expect(c.name).toBe('Screener — UCT Universe')
    expect(c.criteria).toEqual(['UCT Universe', 'Price: ≥ $10'])
    expect(c.columns).toEqual([
      { key: 'ticker', label: 'Ticker' }, { key: 'price', label: 'Price' },
      { key: 'chg_pct_1d', label: 'Chg%' }, { key: 'rs_rank', label: 'RS' },
    ])
    // NVDA's price and change are the LIVE stream's (what the table painted).
    expect(c.rows).toEqual([
      { ticker: 'NVDA', cells: ['NVDA', '$181.50', '+2.5%', '97'] },
      { ticker: 'AMD', cells: ['AMD', '$150.00', '-2.0%', '—'] },
    ])
    expect(c.total).toBe(57)
    expect(c.asOf).toBe('2026-09-30 03:00 ET (nightly build)')
    expect(c.coverage).toBeNull()
    // …and it survives the registry's normalize/validate as a renderable capture.
    const params = normalizeParams('screener', c)
    expect(validateParams('screener', params).ok).toBe(true)
    expect(isReconstructable('screener', params)).toBe(true)
  })

  it(`caps the frozen rows at ${SCREENER_CAPTURE_ROW_CAP} and keeps the TOTAL honest`, () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ticker: `T${i}`, price: i }))
    const c = buildScreenerCapture({ ...base, displayRows: many, total: 3745 })
    expect(c.rows).toHaveLength(SCREENER_CAPTURE_ROW_CAP)
    expect(c.rows[0].ticker).toBe('T0')
    expect(c.total).toBe(3745)
  })

  it('zero rows is carried as a fact, with the scan-filter coverage receipt whole', () => {
    const latest = { evaluated: 100, answered: 0, dropped: 0, not_computable: 100 }
    const c = buildScreenerCapture({
      ...base, displayRows: [], total: 0,
      scanReceipts: [{ def_hash: 'sha256:x', label: 'Pullback MA', latest }],
    })
    expect(c.rows).toEqual([])
    expect(c.total).toBe(0)
    expect(c.coverage).toEqual([{ label: 'Pullback MA', coverage: latest }])
    expect(isReconstructable('screener', normalizeParams('screener', c))).toBe(true)
  })

  it('nothing to describe before a result lands', () => {
    expect(buildScreenerCapture({ ...base, total: null })).toBeNull()
  })
})

describe('the pieces', () => {
  it('names the pool the way the Universe bar does', () => {
    expect(screenerPoolLabel({})).toBe('All Market')
    expect(screenerPoolLabel({ list: { label: 'My Leaders' } })).toBe('My Leaders')
  })

  it('criteria skip the pool keys after the first entry and fall back to the raw key', () => {
    expect(screenerCriteria(META, { list: { label: 'L' }, mystery: { op: 'eq', value: 'x' } }))
      .toEqual(['L', 'mystery: x'])
  })

  it('the as-of names the live tier when the seal does', () => {
    expect(screenerAsOf('2026-09-30', { live: { state: 'live', as_of_et: '10:42 AM' } }))
      .toBe('2026-09-30 10:42 AM ET (price-derived columns live; every other column from the 03:00 ET build)')
    expect(screenerAsOf(null, null)).toBe('date unknown 03:00 ET (nightly build)')
  })

  it('a formatter that throws degrades to the raw value, never a crash', () => {
    expect(screenerCellText({ ticker: 'X', chg_pct_1d: 'abc' }, 'chg_pct_1d', {})).toBe('abc')
    expect(screenerCellText({ ticker: 'X' }, 'unknown_col', {})).toBe('—')
  })
})
