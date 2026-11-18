// app/src/components/chart/engine/__tests__/boxTableSizes.test.js
//
// ─── ⭐⭐ A BOX'S TEXT AND A TABLE CELL ARE THE SIZE TRADINGVIEW DRAWS THEM (Q-LB3, 2026-11-17) ───
//
// Measured: probe vw-lb3-box-table-sizes.pine on NYSE:RDDT 1D, TradingView's own `fillText` traced
// read-only (`__fixtures__/boxTableSizes.tradingview.json`, NUMBERS ONLY): tiny 8, small 10, normal 14,
// large 20, huge 36 px, the same for a box and a cell. ⚰️ The engine's own were 8 / 10 / 12 / 16 / 22.
// The Pine reference equates the size words with exactly these points (`POINT_SIZE_ANCHORS.boxTable`),
// so a v6 int size and its word draw alike.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { paintObjects, textSizePx, TEXT_SIZE_PX, POINT_SIZE_ANCHORS } from '../objectCanvas'

const TV = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'src/components/chart/engine/__tests__/__fixtures__/boxTableSizes.tradingview.json'), 'utf8'))
const SIZES = ['tiny', 'small', 'normal', 'large', 'huge']
const mapping = { timeToX: (t) => t, priceToY: (p) => 500 - p, width: 1000, height: 500 }

function boxFont(text_size) {
  const fonts = []
  const calls = []
  const base = {}
  for (const m of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect',
    'strokeRect', 'strokeText', 'arc', 'setLineDash']) base[m] = () => {}
  base.fillText = (...a) => calls.push(a)
  base.measureText = (s) => ({ width: s.length * 6 })
  const ctx = new Proxy(base, { set(t, k, v) { if (k === 'font') fonts.push(v); t[k] = v; return true } })
  paintObjects(ctx, { boxes: [{ id: 1, left: 100, right: 300, top: 400, bottom: 200, bgcolor: '#00f4', border_color: '#00f',
    border_width: 1, border_style: 'solid', text: 'B', text_color: '#111', text_size }] }, mapping)
  expect(calls, 'the box text was drawn').toHaveLength(1)
  return fonts[fonts.length - 1]
}

describe('⭐⭐ a box\'s text, per size word (TradingView: 8 / 10 / 14 / 20 / 36 px)', () => {
  it.each(SIZES)('%s', (size) => {
    expect(boxFont(size)).toMatch(new RegExp(`(^|\\s)${TV.box[size]}px `))
  })
  it('a v6 int size draws as the word the reference equates it with (14 points = normal = 14 px)', () => {
    expect(boxFont(14)).toMatch(/(^|\s)14px /)
  })
})

describe('⭐⭐ a table cell, per size word (the DOM table reads the same table)', () => {
  it.each(SIZES)('%s', (size) => {
    expect(textSizePx(size, 'boxTable')).toBe(TV.tableCell[size])
    expect(TEXT_SIZE_PX[size]).toBe(TV.tableCell[size])
  })
  it('the measured pixels ARE the reference\'s points for boxes and tables', () => {
    for (const w of SIZES) expect(TV.box[w]).toBe(POINT_SIZE_ANCHORS.boxTable[w])
  })
  it('⚠️ auto is not measured, and keeps the engine\'s 12', () => {
    expect(TEXT_SIZE_PX.auto).toBe(12)
  })
})
