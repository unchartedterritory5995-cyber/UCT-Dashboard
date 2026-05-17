import { describe, it, expect } from 'vitest'
import { composeWatermarkLines, watermarkFontPx, computeWatermarkRect } from './watermarkPrimitive'

describe('composeWatermarkLines', () => {
  const meta = { name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' }
  it('all lines on → 4 lines in order', () => {
    expect(composeWatermarkLines('TSLA', meta, { ticker: true, company: true, sector: true, industry: true }))
      .toEqual(['TSLA', 'Tesla Inc', 'Consumer Cyclical', 'Auto Manufacturers'])
  })
  it('skips disabled and null lines', () => {
    expect(composeWatermarkLines('TSLA', { name: null, sector: 'X', industry: null },
      { ticker: true, company: true, sector: true, industry: true }))
      .toEqual(['TSLA', 'X'])
  })
  it('ticker always available even with null meta', () => {
    expect(composeWatermarkLines('TSLA', { name: null, sector: null, industry: null },
      { ticker: true, company: true, sector: true, industry: true })).toEqual(['TSLA'])
  })
  it('all toggles off → empty', () => {
    expect(composeWatermarkLines('TSLA', meta, { ticker: false, company: false, sector: false, industry: false }))
      .toEqual([])
  })
})

describe('watermarkFontPx', () => {
  it('line 0 largest, decreasing, scaled by sizeScale', () => {
    expect(watermarkFontPx(0, 1)).toBe(54)
    expect(watermarkFontPx(1, 1)).toBe(20)
    expect(watermarkFontPx(0, 2)).toBe(108)
    expect(watermarkFontPx(3, 1)).toBe(13)
  })
})

describe('computeWatermarkRect', () => {
  it('centers block on normalized pos, clamps inside bounds', () => {
    // centered anchor: x = 0.5*1000 - 200/2 = 400 ; y = 0.5*400 - 120/2 = 140
    const r = computeWatermarkRect({ x: 0.5, y: 0.5 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r).toEqual({ x: 400, y: 140, w: 200, h: 120 })
  })
  it('clamps so block never leaves the pane', () => {
    const r = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    const r2 = computeWatermarkRect({ x: 1, y: 1 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r2.x).toBe(800)
    expect(r2.y).toBe(280)
  })
})
