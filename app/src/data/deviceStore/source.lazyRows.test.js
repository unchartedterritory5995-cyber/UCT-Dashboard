// @vitest-environment node
// A device copy's ROWS are built only when somebody reads them (2026-11-22, the next-row press with the store on).
// The bar store asks the device source for a held key's copy on every warm of that key (persist.refreshDevice: the
// rows around the selection, the rows on screen, on every linked timeframe, on every press), and almost every time
// the copy is no newer than the one the key holds and is dropped after one look at its `through` stamp. `peek`
// built every row object first (columnsToRows: one object per bar, hundreds to thousands per key): measured on a
// D + 30m board, 20 ms more main-thread work in the 300 ms after a next-row press with the store on, and the
// press 4 ms slower (50.0 against 45.8 ms, devgates4).
import { describe, it, expect, vi } from 'vitest'
import { createDeviceSource } from './source'

/** Columns whose `o` column counts how often it is read (columnsToRows reads every column). */
function countingCols(n = 5) {
  const o = new Float64Array(n).fill(2)
  const c = { reads: 0, t: Float64Array.from({ length: n }, (_, i) => 1000 + i), h: new Float64Array(n).fill(3), l: new Float64Array(n).fill(1),
    c: new Float64Array(n).fill(2), v: new Float64Array(n).fill(9), build: '20261121T2359Z', through: 2000 }
  Object.defineProperty(c, 'o', { get() { c.reads++; return o } })
  return c
}
const sourceOver = (cols) => {
  const client = { peekBars: vi.fn(() => cols), getBars: vi.fn(async () => cols) }
  return createDeviceSource({ load: async () => client, current: () => client })
}

describe('a device copy builds its rows only when they are read', () => {
  it('peek: the count and the stamps cost no row; the rows are built once, on the first read of them', () => {
    const cols = countingCols(5)
    const hit = sourceOver(cols).peek('AAA', 'D')
    expect(hit.n).toBe(5)
    expect(hit.through).toBe(2000)
    expect(hit.savedAt).toBe(2000 * 1000)
    expect(cols.reads).toBe(0)                               // nothing was built to answer that
    const rows = hit.rows
    expect(rows).toHaveLength(5)
    expect(rows[4]).toEqual({ t: 1004, o: 2, h: 3, l: 1, c: 2, v: 9 })
    const built = cols.reads
    expect(built).toBeGreaterThan(0)
    expect(hit.rows).toBe(rows)                              // the same array: built once
    expect(cols.reads).toBe(built)
  })

  it('read: the same', async () => {
    const cols = countingCols(3)
    const hit = await sourceOver(cols).read('AAA', 'D')
    expect(hit.n).toBe(3)
    expect(cols.reads).toBe(0)
    expect(hit.rows).toHaveLength(3)
  })

  it('an empty copy is still no copy', () => {
    expect(sourceOver({ t: new Float64Array(0) }).peek('AAA', 'D')).toBeNull()
    expect(sourceOver(null).peek('AAA', 'D')).toBeNull()
  })
})
