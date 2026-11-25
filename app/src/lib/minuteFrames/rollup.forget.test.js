// @vitest-environment node
// THE ROLLUP FORGETS A SYMBOL ITS READER NO LONGER WANTS (`forgetRefused`, review of #2680: the page's minute feed
// follows the bar store's held keys, and a day's scan holds hundreds of symbols one after another; their minutes and
// buckets were kept until the day reset). OFF BY DEFAULT: the device store's rollup (a fixed seed) is unchanged.
//   R1 with the option, a symbol `accept` refuses holds no state after the next frame; without it, it is kept
//   R2 wanted again, it starts from nothing: its bucket holds only the minutes since, and a repeat is a new minute
//   R3 a forgotten symbol's open bucket is never closed to the sink; without the option it is (the control)
import { describe, it, expect } from 'vitest'
import { createMinuteRollup } from './rollup'
import { decodeFrame } from './codec'
import { writeFrame } from './testing/frameWriter'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 60000              // Tue 2026-11-10 09:30 ET, as a unix minute
const M = (n) => OPEN + n
const T = (n) => M(n) * 60
const rec = (sym, n) => ({ sym, o: 10 + n, h: 11 + n, l: 9 + n, c: 10.5 + n, v: 100 + n })

function world(opts = {}) {
  const want = new Set(['AAA', 'BBB'])
  const ups = []
  const sink = { upsert: (sym, tf, bar, final) => ups.push({ sym, tf, t: bar.t, v: bar.v, final }) }
  const r = createMinuteRollup({ sink, tfs: ['1', '15'], accept: (s) => want.has(s), ...opts })
  const frame = (n, rows = [rec('AAA', n), rec('BBB', n)]) => r.applyFrame(decodeFrame(writeFrame({ minute: M(n), blocks: [{ rows }] })))
  return { want, ups, r, frame }
}

describe('the rollup forgets a symbol its reader no longer wants', () => {
  it('R1 with forgetRefused a refused symbol holds no state after the next frame; by default it is kept', () => {
    for (const forgetRefused of [true, false]) {
      const w = world(forgetRefused ? { forgetRefused } : {})
      w.frame(30); w.frame(31)
      expect(w.r.stats().symbols).toBe(2)
      w.want.delete('BBB')
      w.frame(32)
      expect(w.r.stats().symbols).toBe(forgetRefused ? 1 : 2)
      expect(w.r.peek('BBB', '15') === null).toBe(forgetRefused)
      expect(w.r.peek('AAA', '15').cur).toMatchObject({ t: T(30), first: M(30), last: M(32) })
    }
  })

  it('R2 wanted again, it starts from nothing: only the minutes since, and a repeat of an old minute is a new one', () => {
    const w = world({ forgetRefused: true })
    w.frame(30); w.frame(31)
    w.want.delete('BBB')
    w.frame(32)
    w.want.add('BBB')
    w.frame(33)
    expect(w.r.peek('BBB', '15').cur).toMatchObject({ t: T(30), first: M(33), last: M(33), v: 133 })
    w.ups.length = 0
    w.r.applyMinute('BBB', M(31), 41, 42, 40, 41.5, 131)       // the same 10:01 bar again (a LATE repeat)
    expect(w.ups.filter((u) => u.sym === 'BBB' && u.tf === '1')).toEqual([{ sym: 'BBB', tf: '1', t: T(31), v: 131, final: true }])
  })

  it('R3 a forgotten symbol open bucket is never closed to the sink (by default it is)', () => {
    for (const forgetRefused of [true, false]) {
      const w = world(forgetRefused ? { forgetRefused } : {})
      w.frame(30); w.frame(31)
      w.want.delete('BBB')
      for (let n = 32; n <= 44; n++) w.frame(n)                   // 10:14 ends the 10:00 bucket
      const closed = (sym) => w.ups.filter((u) => u.sym === sym && u.tf === '15' && u.t === T(30) && u.final).length
      expect(closed('AAA')).toBe(1)
      expect(closed('BBB')).toBe(forgetRefused ? 0 : 1)
    }
  })
})
