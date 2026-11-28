// The source hands the bar store `wholeFrom` (zero-network PR 3.2): the first bar's time of a copy the engine says is
// the symbol's WHOLE served series (engine.js `whole`, the full-depth daily pack), else null. persist.deviceWhole reads it.
import { describe, it, expect } from 'vitest'
import { createDeviceSource } from './source'

const cols = (whole) => {
  const t = Float64Array.of(1_700_000_000, 1_700_086_400, 1_700_172_800)
  const c = { t, o: t.map(() => 1), h: t.map(() => 2), l: t.map(() => 0.5), c: t.map(() => 1.5), v: t.map(() => 10), through: 1_700_200_000 }
  if (whole) c.whole = true
  return Object.freeze(c)
}

describe('source: wholeFrom', () => {
  it('a whole copy names its first bar; any other copy names nothing', async () => {
    for (const [whole, want] of [[true, 1_700_000_000], [false, null]]) {
      const client = { peekBars: () => cols(whole), getBars: async () => cols(whole) }
      const src = createDeviceSource({ load: async () => client, current: () => client })
      expect(src.peek('AAA', 'D').wholeFrom).toBe(want)
      expect((await src.read('AAA', 'D')).wholeFrom).toBe(want)
    }
  })
})
