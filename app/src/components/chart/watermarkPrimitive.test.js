import { describe, it, expect } from 'vitest'
import { composeWatermarkLines, watermarkFontPx, computeWatermarkRect, createWatermarkPrimitive, reservedBlock, wrapToRows } from './watermarkPrimitive'

describe('composeWatermarkLines', () => {
  const meta = { name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' }
  const texts = (arr) => arr.map((l) => l.text)
  it('all lines on → 4 lines in order', () => {
    expect(texts(composeWatermarkLines('TSLA', meta, { ticker: true, company: true, sector: true, industry: true })))
      .toEqual(['TSLA', 'Tesla Inc', 'Consumer Cyclical', 'Auto Manufacturers'])
  })
  it('skips disabled and null lines', () => {
    expect(texts(composeWatermarkLines('TSLA', { name: null, sector: 'X', industry: null },
      { ticker: true, company: true, sector: true, industry: true })))
      .toEqual(['TSLA', 'X'])
  })
  it('ticker always available even with null meta', () => {
    expect(texts(composeWatermarkLines('TSLA', { name: null, sector: null, industry: null },
      { ticker: true, company: true, sector: true, industry: true }))).toEqual(['TSLA'])
  })
  it('all toggles off → empty', () => {
    expect(composeWatermarkLines('TSLA', meta, { ticker: false, company: false, sector: false, industry: false }))
      .toEqual([])
  })
  it('appends the UCT theme as a 5th line when enabled and present', () => {
    const m = { name: 'SolarEdge Technologies, Inc.', sector: 'Technology', industry: 'Solar', theme: 'Clean Energy' }
    expect(texts(composeWatermarkLines('SEDG', m, { ticker: true, company: true, sector: true, industry: true, theme: true })))
      .toEqual(['SEDG', 'SolarEdge Technologies, Inc.', 'Technology', 'Solar', 'Clean Energy'])
  })
  it('skips theme line when toggled off or theme is null', () => {
    const m = { name: 'X', sector: 'S', industry: 'I', theme: null }
    expect(texts(composeWatermarkLines('AAA', m, { ticker: true, company: false, sector: false, industry: false, theme: true })))
      .toEqual(['AAA'])
    expect(texts(composeWatermarkLines('AAA', { ...m, theme: 'T' }, { ticker: true, company: false, sector: false, industry: false, theme: false })))
      .toEqual(['AAA'])
  })
  it('font size is per-role, not per-position — company stays small when ticker is off', () => {
    const m = { name: 'Big Company Name', sector: 'S', industry: 'I' }
    const withTicker = composeWatermarkLines('TSLA', m, { ticker: true, company: true, sector: false, industry: false })
    const noTicker = composeWatermarkLines('TSLA', m, { ticker: false, company: true, sector: false, industry: false })
    expect(withTicker[0].size).toBe(54)                // ticker is the hero
    expect(withTicker[1].size).toBe(20)                // company small
    expect(noTicker[0].size).toBe(20)                  // company DOES NOT balloon to 54
  })
})

describe('watermarkFontPx', () => {
  it('sizes by the line role, scaled by sizeScale', () => {
    expect(watermarkFontPx({ text: 'X', size: 54 }, 1)).toBe(54)
    expect(watermarkFontPx({ text: 'X', size: 20 }, 1)).toBe(20)
    expect(watermarkFontPx({ text: 'X', size: 54 }, 2)).toBe(108)
    expect(watermarkFontPx({ text: 'X', size: 13 }, 1)).toBe(13)
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
  it('hardCenterXPx pins the block CENTRE to a fixed px offset regardless of block/pane width — no edge clamp', () => {
    // Two blocks of very different widths → identical centre at the px offset.
    const wide = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 300, h: 120 }, 24, 24, 150)
    const narrow = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 80, h: 120 }, 24, 24, 150)
    expect(wide.x + wide.w / 2).toBe(150)
    expect(narrow.x + narrow.w / 2).toBe(150)
    // Same px offset holds on a much WIDER pane (a fraction would drift right).
    const widePane = computeWatermarkRect({ x: 0, y: 0 }, { width: 2400, height: 400 }, { w: 80, h: 120 }, 24, 24, 150)
    expect(widePane.x + widePane.w / 2).toBe(150)
    // Even a block wide enough to overflow the gutter stays centred (not shifted).
    const huge = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 400, h: 120 }, 24, 24, 150)
    expect(huge.x + huge.w / 2).toBe(150)
    expect(huge.x).toBeLessThan(24)         // deliberately no left clamp
    // Vertical still top-pins with padTop.
    expect(wide.y).toBe(24)
  })
})

// A canvas stub whose text width is a fixed px-per-char — enough to exercise the
// wrap/ellipsize maths deterministically.
function ctxStub(perChar = 10) {
  return { measureText: (t) => ({ width: String(t).length * perChar }) }
}

describe('wrapToRows', () => {
  const ctx = ctxStub()
  it('keeps a short line on one row', () => {
    expect(wrapToRows(ctx, 'Micron Technology, Inc.', 400, 2)).toEqual(['Micron Technology, Inc.'])
  })
  it('wraps a long company name onto two rows instead of widening it', () => {
    const rows = wrapToRows(ctx, 'State Street SPDR Dow Jones Industrial Average ETF Trust', 300, 2)
    expect(rows).toHaveLength(2)
    rows.forEach((r) => expect(r.length * 10).toBeLessThanOrEqual(300))
    expect(rows.join(' ')).toBe('State Street SPDR Dow Jones Industrial Average ETF Trust')
  })
  it('ellipsizes what still will not fit rather than spilling outside the box', () => {
    const rows = wrapToRows(ctx, 'one two three four five six seven eight nine ten', 80, 2)
    expect(rows).toHaveLength(2)
    expect(rows[1].endsWith('…')).toBe(true)
    rows.forEach((r) => expect(r.length * 10).toBeLessThanOrEqual(80))
  })
  it('leaves an unbreakable word intact', () => {
    expect(wrapToRows(ctx, 'Supercalifragilistic', 50, 1)).toEqual(['Supercalifragilistic'])
  })
  it('empty text → no rows', () => {
    expect(wrapToRows(ctx, '', 200, 2)).toEqual([])
  })
})

describe('reservedBlock', () => {
  const ALL = { ticker: true, company: true, sector: true, industry: true, theme: true }
  it('reserves rows for every ENABLED field, so height is ticker-independent', () => {
    // ticker 54 + company 2x20 + sector 14 + industry 13 + theme 13 = 134, 6 rows → 5 gaps
    expect(reservedBlock(ALL, 1)).toBe(134 + 5 * 6)
  })
  it('scales with the size scale', () => {
    expect(reservedBlock(ALL, 2)).toBe(268 + 5 * 12)
  })
  it('drops the rows of disabled fields', () => {
    expect(reservedBlock({ ticker: true, company: true }, 1)).toBe(54 + 40 + 2 * 6)
    expect(reservedBlock({ ticker: true }, 1)).toBe(54)
  })
  it('unknown fields → 0 (caller falls back to measured content height)', () => {
    expect(reservedBlock(null, 1)).toBe(0)
    expect(reservedBlock({}, 1)).toBe(0)
  })
})

describe('watermark box stability (draw → getRect)', () => {
  const ALL = { ticker: true, company: true, sector: true, industry: true, theme: true }
  // Canvas stub: width = chars x 10 x (font px / 20), so bigger fonts measure wider.
  function drawCtx() {
    return {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      globalAlpha: 1,
      _px: 20,
      set _font(v) { /* noop */ },
      measureText(t) {
        const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || '20')
        return { width: String(t).length * 10 * (px / 20) }
      },
      save() {}, restore() {}, fillText() {}, beginPath() {}, arc() {}, fill() {},
      clip() {}, drawImage() {}, setLineDash() {}, strokeRect() {},
    }
  }
  const drawWith = (ctrl, media = { width: 1400, height: 800 }) => {
    ctrl.primitive.paneViews()[0].renderer().draw({
      useMediaCoordinateSpace: (fn) => fn({ context: drawCtx(), mediaSize: media }),
    })
    return ctrl.getRect()
  }
  const make = (meta, sym) => createWatermarkPrimitive({
    lines: composeWatermarkLines(sym, meta, ALL, '1D'),
    fields: ALL,
    boxW: 380,
    opacity: 0.5,
    x: 0.25,
    y: 0.3,
    align: 'left',
    custom: true,
  })

  it('a long-named ETF and a short-named stock land in the IDENTICAL rect', () => {
    const dia = drawWith(make({ name: 'State Street SPDR Dow Jones Industrial Average ETF Trust' }, 'DIA'))
    const mu = drawWith(make({ name: 'Micron Technology, Inc.', sector: 'Technology', industry: 'Semiconductors', theme: 'Memory & HBM' }, 'MU'))
    expect(dia).toEqual(mu)
    // ...and it is the configured box, not the text's own extent.
    expect(dia.w).toBe(380)
    expect(dia.h).toBe(reservedBlock(ALL, 1))
  })

  it('a ticker with NO sector/industry keeps the same top edge (no creep into the legend)', () => {
    const bare = drawWith(make({ name: 'Acme' }, 'ACME'))
    const full = drawWith(make({ name: 'Acme', sector: 'Tech', industry: 'Software', theme: 'AI' }, 'ACME'))
    expect(bare.y).toBe(full.y)
  })

  it('the box never spills past the pane on a narrow widget', () => {
    const r = drawWith(make({ name: 'Micron Technology, Inc.' }, 'MU'), { width: 300, height: 400 })
    expect(r.x).toBeGreaterThanOrEqual(14)
    expect(r.x + r.w).toBeLessThanOrEqual(300 - 14)
  })
})
