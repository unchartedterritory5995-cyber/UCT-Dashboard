// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.supplyAttributed.test.js
//
// SUPPLY-ATTRIBUTED DIVERGENCE (coordinator ruling on #1541, 2026-11-17): a zero-lookback plot whose every
// steady divergence is a value on a date where OUR supply of another symbol differs from TradingView's
// committed witness of that symbol, and which agrees on every bar when our side runs on the witness's
// values, grades MATCH_SUBSTITUTED, naming the UCT source, the witness and N of M dates
// (`compare.mjs::attributableToSupply`, `supplyAttribution.js`). Measured on RS Rating NVDA 1D: the RS line
// is NVDA close / SP:SPX close * 3360 bit for bit against TradingView's own SP:SPX
// (rs-spx-daily-spy-1d-2026-11-15), and FMP ^GSPC differs from it on dates before 2023-12-05.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture, REPO } from './harness'
import { supplyAttributionOf } from './supplyAttribution'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { attributableToSupply, MATCH_SUBSTITUTED } from '../../../../../../../tools/vendor_harness/compare.mjs'

vi.setConfig({ testTimeout: 600000 })

const load = (id) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', `${id}.json`), 'utf8'))
const NVDA = 'rs-rating-fred6724-nvda-1d-2026-11-15'
const RDDT = 'rs-rating-fred6724-rddt-1d-2026-11-15'
const rsLineOf = (verdict) => verdict.plots.find((p) => p.title === 'RS Line')

describe('the rule (pure)', () => {
  const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10)
  const on = Date.UTC(2020, 0, 2, 14, 30) / 1000          // a differing date
  const off = Date.UTC(2020, 0, 3, 14, 30) / 1000         // an agreeing date
  const diffDays = new Set(['2020-01-02'])
  it('attributes value differences that all fall on differing dates of a zero-lookback plot', () => {
    expect(attributableToSupply({ lookback: 0, divergent: [{ time: on, kind: 'value' }], diffDays, dayOf })).toBe(true)
  })
  it('CONTROL: one difference on an agreeing date is not attributed', () => {
    expect(attributableToSupply({ lookback: 0, divergent: [{ time: on, kind: 'value' }, { time: off, kind: 'value' }], diffDays, dayOf })).toBe(false)
  })
  it('a windowed plot is never attributed, even when every difference is on a differing date', () => {
    expect(attributableToSupply({ lookback: 5, divergent: [{ time: on, kind: 'value' }], diffDays, dayOf })).toBe(false)
    expect(attributableToSupply({ lookback: null, divergent: [{ time: on, kind: 'value' }], diffDays, dayOf })).toBe(false)
  })
  it('an na or a colour difference is never attributed', () => {
    expect(attributableToSupply({ lookback: 0, divergent: [{ time: on, kind: 'na' }], diffDays, dayOf })).toBe(false)
    expect(attributableToSupply({ lookback: 0, divergent: [{ time: on, kind: 'color' }], diffDays, dayOf })).toBe(false)
  })
  it('nothing divergent, or no differing date, attributes nothing', () => {
    expect(attributableToSupply({ lookback: 0, divergent: [], diffDays, dayOf })).toBe(false)
    expect(attributableToSupply({ lookback: 0, divergent: [{ time: on, kind: 'value' }], diffDays: new Set(), dayOf })).toBe(false)
  })
})

describe('RS Rating NVDA 1D (real capture, real supply, real witness)', () => {
  it('finds the witness and the dates FMP differs from TradingView, inside the chart window only', () => {
    const sa = supplyAttributionOf(load(NVDA))
    expect(sa).not.toBe(null)
    expect(sa.record.symbol).toBe('SPX')
    expect(sa.record.source).toMatch(/FMP \^GSPC/)
    expect(sa.record.witness).toContain('rs-spx-daily-spy-1d-2026-11-15')
    expect(sa.record.datesDiffer).toBeGreaterThan(900)
    expect(sa.record.datesCompared).toBeGreaterThan(6900)
    expect([...sa.diffDays].every((d) => d < '2023-12-05')).toBe(true)
    // RDDT (from its 2024 listing): FMP agrees with TradingView on every date of the window
    expect(supplyAttributionOf(load(RDDT))).toBe(null)
  })

  it('the RS line grades MATCH_SUBSTITUTED, naming FMP, the witness and N of M dates', () => {
    const { verdict } = gradeCapture(load(NVDA))
    const p = rsLineOf(verdict)
    expect(p.verdict, p.reason).toBe(MATCH_SUBSTITUTED)
    expect(p.supplyAttributed.bars).toBe(1292)
    expect(p.supplyAttributed.witness).toContain('rs-spx-daily-spy-1d-2026-11-15')
    expect(p.reason).toMatch(/UCT's SPX \(FMP \^GSPC/)
    expect(verdict.supplyAttributed.plots).toEqual(['RS Line'])
    // no plot reads DIVERGE any more (the objects keep their own grade)
    expect(verdict.plots.filter((x) => x.verdict === 'DIVERGE')).toEqual([])
  })

  it('CONTROL: one engine-side mismatch on an agreeing date keeps the RS line DIVERGE', () => {
    const cap = load(NVDA)
    const id = cap.study.plots.find((x) => x.title === 'RS Line').id
    const col = cap.plotValues.fields.indexOf(id)
    const last = cap.plotValues.rows[cap.plotValues.rows.length - 1]   // 2026-11-13: FMP agrees there
    last[col] = last[col] * 1.01
    const p = rsLineOf(gradeCapture(sealCapture(cap)).verdict)
    expect(p.verdict).toBe('DIVERGE')
    expect(p.supplyAttributed).toBeUndefined()
  })

  it('CONTROL (rule 3): a difference on a differing date that the witness values do not explain keeps it DIVERGE', () => {
    const cap = load(NVDA)
    const id = cap.study.plots.find((x) => x.title === 'RS Line').id
    const col = cap.plotValues.fields.indexOf(id)
    // 1999-01-28 (bar 4, the RS line's first divergence): FMP 1243.17, TradingView 1243.19 (already differs)
    const row = cap.plotValues.rows.find((r) => r[0] === 917533800)
    expect(row && typeof row[col] === 'number').toBe(true)
    row[col] = row[col] * 1.01
    const p = rsLineOf(gradeCapture(sealCapture(cap)).verdict)
    expect(p.verdict).toBe('DIVERGE')
    expect(p.supplyAttributed).toBeUndefined()
  })
})
