// @vitest-environment node
// M1 (review of #2537): THE FORMING MARKER TRAVELS. A device copy may end with the bucket in progress (forming.js
// DEVICE_FORMING_INTRADAY, live.js: relative to the newest minute the device applied, `through`), and says so
// (`forming`). The source dropped that word, so the store judged the bucket by the wall clock alone: read just after
// the bucket's end, before its last minute's frame had landed, it was filed as a CLOSED bar one minute short. The
// source now hands the store the TIME of the bar the marker describes (`formingT`), or null.
import { describe, it, expect, vi } from 'vitest'
import { createDeviceSource } from './source'

const T0 = 1_795_000_200
const colsOf = (n, extra = {}) => ({
  t: Float64Array.from({ length: n }, (_, i) => T0 + i * 300), o: new Float64Array(n).fill(2), h: new Float64Array(n).fill(3),
  l: new Float64Array(n).fill(1), c: new Float64Array(n).fill(2), v: new Float64Array(n).fill(9), build: '20261121T2359Z', through: T0 + n * 300, ...extra,
})
const sourceOver = (cols) => {
  const client = { peekBars: vi.fn(() => cols), getBars: vi.fn(async () => cols) }
  return createDeviceSource({ load: async () => client, current: () => client })
}

describe('M1 the device copy\'s forming marker reaches the store', () => {
  it('a copy ending with the bucket in progress names it, by its time (peek and read)', async () => {
    for (const forming of ['intraday', 'D']) {
      const cols = colsOf(4, { forming })
      expect(sourceOver(cols).peek('AAA', '5').formingT).toBe(T0 + 3 * 300)
      expect((await sourceOver(cols).read('AAA', '5')).formingT).toBe(T0 + 3 * 300)
    }
  })

  it('a copy of complete buckets only names none', async () => {
    const cols = colsOf(4)
    expect(sourceOver(cols).peek('AAA', '5').formingT).toBeNull()
    expect((await sourceOver(cols).read('AAA', '5')).formingT).toBeNull()
  })
})
