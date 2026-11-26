// app/src/components/chart/engine/secondaryBars.idleRead.test.js
//
// ─── A DEEP CUSTOM-TIMEFRAME PAGE IS READ OFF ITS LANDING TASK, ONE ET DAY-SLICE PER IDLE CALLBACK (2026-11-26) ─────
//
// #2801's upgrade capture: the deep benchmark page (19,200 60m rows, the 4h ladder's top rung) was judged and resampled
// in ONE task in the fetch's continuation (362 ms on that build). `idleRead` (the deep lane asks with it) does the same
// two steps in whole-ET-day slices, one per idle callback, and lands only after the last:
//   I1 the SAME entry as the whole read (bars, status, askedBars), regular and extended specs, pages across DST and half
//      days, and a refused page (the same words, from the slice that holds the off-session row)
//   I2 off the landing task: when the fetch has landed and its microtasks are drained, nothing is cached; one idle
//      callback later nothing is either (the read is in slices); it lands after them, as one AVAILABLE entry
//   I3 a small page is read whole, in one idle callback
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureSecondaryBars, cachedBars, clearSecondaryBars, IDLE_READ_SLICE_ROWS, SOURCE_STATUS } from './secondaryBars'

const utc = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
/** Weekday base rows at the ET minutes `mins`, for `days` weekdays from `startIso`. */
function page(startIso, days, mins) {
  const out = []
  let k = 0
  for (let d = utc(startIso), n = 0; n < days; d += 86400) {
    const wd = new Date(d * 1000).getUTCDay()
    if (wd === 0 || wd === 6) continue
    n += 1
    const iso = new Date(d * 1000).toISOString().slice(0, 10)
    const y = Number(iso.slice(0, 4))
    const nth = (m, kk) => { const x = new Date(Date.UTC(y, m, 1)); return Date.UTC(y, m, 1 + ((7 - x.getUTCDay()) % 7) + 7 * (kk - 1)) }
    const off = Date.parse(`${iso}T12:00:00Z`) >= nth(2, 2) && Date.parse(`${iso}T12:00:00Z`) < nth(10, 1) ? 4 : 5
    for (const m of mins) {
      const p = 100 + (k % 97) * 0.25
      out.push({ t: d + off * 3600 + m * 60, o: p, h: p + 1, l: p - 1, c: p + 0.5, v: 10 + (k % 7) })
      k += 1
    }
  }
  return out
}
const range = (from, to, step) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step)
// the 60m session grid (the regular view's 60m answer): clock hours, the session from 09:30, clock hours again
const SESSION60 = [240, 300, 360, 420, 480, 540, 570, 630, 690, 750, 810, 870, 930, 960, 1020, 1080, 1140]
const CLOCK60 = range(240, 1200, 60)
const ALL15 = range(240, 1200, 15)
const fetcherOf = (bars) => () => Promise.resolve({ bars })
const strip = (e) => e && { bars: e.bars, status: e.status, askedBars: e.askedBars, note: e.note && e.note.replace(/^\w+'s /, '') }
const drainMicrotasks = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const settle = async () => { for (let i = 0; i < 200; i++) { await new Promise((r) => setTimeout(r, 0)) } }

afterEach(() => { clearSecondaryBars(); vi.unstubAllGlobals() })

describe('a deep custom-timeframe page is read off its landing task, one ET-day slice per idle callback', () => {
  it.each([
    ['regular 4h on the 60m session grid (clock hours beside the session)', '240', false, SESSION60, 220],
    ['extended 4h on the 60m clock grid', '240', true, CLOCK60, 220],
    ['regular 45m on 15m (extended rows beside the session)', '45', false, ALL15, 120],
    ['regular 195m on 15m', '195', false, ALL15, 120],
  ])('I1 %s: the same entry as the whole read', async (_name, tf, extended, mins, days) => {
    const base = page('2025-10-01', days, mins)                                 // Oct 2025 on: the Nov DST change, the half days
    expect(base.length, 'two slices or more').toBeGreaterThan(IDLE_READ_SLICE_ROWS + 100)
    ensureSecondaryBars('IDL', tf, 1200, fetcherOf(base), { extended, idleRead: true })
    ensureSecondaryBars('WHL', tf, 1200, fetcherOf(base), { extended })
    await settle()
    const idle = cachedBars('IDL', tf, 1200, { extended })
    const whole = cachedBars('WHL', tf, 1200, { extended })
    expect(whole && whole.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(whole.bars.length).toBeGreaterThan(100)
    expect(strip(idle)).toEqual(strip(whole))
  }, 60000)

  it('I1 a refused page: the same words, found in a later slice', async () => {
    const base = page('2025-10-01', 220, CLOCK60)
    const sat = utc('2026-05-09') + 4 * 3600 + 600 * 60                         // a Saturday 10:00 ET row, past the first slice
    const i = base.findIndex((b) => b.t > sat)
    expect(i).toBeGreaterThan(IDLE_READ_SLICE_ROWS)
    const bad = [...base.slice(0, i), { t: sat, o: 1, h: 1, l: 1, c: 1, v: 1 }, ...base.slice(i)]
    ensureSecondaryBars('IDL', '240', 1200, fetcherOf(bad), { extended: true, idleRead: true })
    ensureSecondaryBars('WHL', '240', 1200, fetcherOf(bad), { extended: true })
    await settle()
    const idle = cachedBars('IDL', '240', 1200, { extended: true })
    const whole = cachedBars('WHL', '240', 1200, { extended: true })
    expect(whole.status).toBe(SOURCE_STATUS.UNSUPPORTED)
    expect(whole.note).toContain('on a Sat')
    expect(strip(idle)).toEqual(strip(whole))
  }, 60000)

  it('I2 off the landing task, in slices: nothing lands until the last idle callback', async () => {
    const queue = []
    vi.stubGlobal('requestIdleCallback', (fn) => { queue.push(fn); return queue.length })
    const base = page('2025-10-01', 200, CLOCK60)                               // 3,200 rows: two slices
    expect(base.length).toBeGreaterThan(IDLE_READ_SLICE_ROWS + 16)
    expect(base.length).toBeLessThanOrEqual(2 * IDLE_READ_SLICE_ROWS)
    const slices = 2
    ensureSecondaryBars('IDL', '240', 1200, fetcherOf(base), { extended: true, idleRead: true })
    await drainMicrotasks()                                                       // the fetch has landed
    expect(cachedBars('IDL', '240', 1200, { extended: true }), 'nothing read on the landing task').toBe(null)
    expect(queue.length).toBe(1)
    let steps = 0
    while (queue.length) {
      const fn = queue.shift()
      fn({ timeRemaining: () => 10, didTimeout: false })
      steps += 1
      await drainMicrotasks()
      if (queue.length) expect(cachedBars('IDL', '240', 1200, { extended: true }), `still reading after ${steps}`).toBe(null)
    }
    expect(steps, 'one idle callback to start, then one per slice for the judgement and one per slice for the resample').toBe(1 + 2 * slices)
    expect(cachedBars('IDL', '240', 1200, { extended: true }).status).toBe(SOURCE_STATUS.AVAILABLE)
  })

  it('I3 a small page is read whole, in one idle callback', async () => {
    const queue = []
    vi.stubGlobal('requestIdleCallback', (fn) => { queue.push(fn); return queue.length })
    const base = page('2026-01-05', 20, CLOCK60)
    expect(base.length).toBeLessThanOrEqual(IDLE_READ_SLICE_ROWS)
    ensureSecondaryBars('IDL', '240', 200, fetcherOf(base), { extended: true, idleRead: true })
    await drainMicrotasks()
    expect(cachedBars('IDL', '240', 200, { extended: true })).toBe(null)
    queue.shift()({ timeRemaining: () => 10, didTimeout: false })
    await drainMicrotasks()
    expect(queue.length).toBe(0)
    expect(cachedBars('IDL', '240', 200, { extended: true }).status).toBe(SOURCE_STATUS.AVAILABLE)
  })
})
