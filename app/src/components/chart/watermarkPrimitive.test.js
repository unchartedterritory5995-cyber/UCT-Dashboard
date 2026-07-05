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
  it('appends the UCT theme as a 5th line when enabled and present', () => {
    const m = { name: 'SolarEdge Technologies, Inc.', sector: 'Technology', industry: 'Solar', theme: 'Clean Energy' }
    expect(composeWatermarkLines('SEDG', m, { ticker: true, company: true, sector: true, industry: true, theme: true }))
      .toEqual(['SEDG', 'SolarEdge Technologies, Inc.', 'Technology', 'Solar', 'Clean Energy'])
  })
  it('skips theme line when toggled off or theme is null', () => {
    const m = { name: 'X', sector: 'S', industry: 'I', theme: null }
    expect(composeWatermarkLines('AAA', m, { ticker: true, company: false, sector: false, industry: false, theme: true }))
      .toEqual(['AAA'])
    expect(composeWatermarkLines('AAA', { ...m, theme: 'T' }, { ticker: true, company: false, sector: false, industry: false, theme: false }))
      .toEqual(['AAA'])
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
  it('clamps so block stays inside the pane with a 14px horizontal gutter', () => {
    // x=0 anchor → centered at 0 (left edge -100), clamped to the 14px gutter.
    const r = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r.x).toBe(14)
    expect(r.y).toBe(0)
    // x=1 anchor → would push right edge out; clamped to width - block - gutter.
    const r2 = computeWatermarkRect({ x: 1, y: 1 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r2.x).toBe(786)
    expect(r2.y).toBe(280)
  })
  it('hardCenterXFrac pins the block CENTRE to the fraction regardless of width — no edge clamp', () => {
    // Two blocks of very different widths on the same pane → identical centre.
    const wide = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 300, h: 120 }, 24, 24, 0.3)
    const narrow = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 80, h: 120 }, 24, 24, 0.3)
    expect(wide.x + wide.w / 2).toBe(300)   // 0.3 * 1000
    expect(narrow.x + narrow.w / 2).toBe(300)
    // Even a block wide enough to overflow the gutter stays centred (not shifted).
    const huge = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 700, h: 120 }, 24, 24, 0.3)
    expect(huge.x + huge.w / 2).toBe(300)
    expect(huge.x).toBeLessThan(24)         // deliberately no left clamp
    // Vertical still top-pins with padTop.
    expect(wide.y).toBe(24)
  })
})
