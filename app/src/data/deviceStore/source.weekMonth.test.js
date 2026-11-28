// @vitest-environment node
// W AND M FROM THE DEVICE, ONLY FROM A WHOLE D COPY WHOSE PERIOD IN PROGRESS IS KNOWN (zero-network PR 3.3, tfs.js
// DEVICE_WM_FROM_FULL_D). H1 of #2537 kept them off the device because they were derived from a ~350-session D window
// that, on a weekday, held no bar for today: shallow, the period in progress dropped, yet read current. Both are facts
// the copy now carries. Here, the device's own doors:
//   WS1 the page's list holds W / M; the WORKER's does not (a W / M read never reaches the worker: P2-L2 of #2549)
//   WS2 the source asks the client for the D copy, never for W / M, and answers a W / M only from a WHOLE D copy
//   WS3 the period in progress must be known: today's row in the copy, or no session begun since its last row
//   WS4 the derivation keeps the oldest bucket of a whole series, and marks a period not yet ended as forming
//   WS5 the page's client still sends the worker nothing for W or M
import { describe, it, expect, vi } from 'vitest'
import { SERVED_TFS, STORED_TFS, WORKER_SERVED_TFS, DEVICE_WM_FROM_FULL_D } from './tfs'
import { createDeviceSource } from './source'
import { createDeviceClient } from './client'
import { deriveServed, periodKnown } from './resample'

const DAY = 86400
const dayUnix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
/** Weekday D columns from `first` to `last` (inclusive), each row's values from its index; holidays ignored here. */
function dailyCols(first, last, { whole = true } = {}) {
  const t = []
  for (let x = dayUnix(first); x <= dayUnix(last); x += DAY) { const wd = new Date(x * 1000).getUTCDay(); if (wd && wd !== 6) t.push(x) }
  const n = t.length
  const cols = { t: Float64Array.from(t), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) }
  for (let i = 0; i < n; i++) { cols.o[i] = 10 + i; cols.h[i] = 12 + i; cols.l[i] = 9 + i; cols.c[i] = 11 + i; cols.v[i] = 100 + i }
  cols.through = t[n - 1] + DAY
  if (whole) cols.whole = true
  return cols
}
// ET clock helpers (November: EST, UTC-5)
const et = (iso, hh, mm = 0) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hh + 5, mm)

describe('WS1 the lists', () => {
  it('the page asks W / M of the device; the worker answers the stored timeframes only', () => {
    expect(DEVICE_WM_FROM_FULL_D).toBe(true)
    expect([...SERVED_TFS].sort()).toEqual([...STORED_TFS, 'W', 'M'].sort())
    expect([...WORKER_SERVED_TFS].sort()).toEqual([...STORED_TFS].sort())
  })
})

describe('WS2 the source derives W / M from the D copy, and only from a whole one', () => {
  it('asks the client for D; a whole copy answers W / M with wholeFrom; a shallow one answers null (why: wm-shallow)', async () => {
    const now = () => et('2026-11-21', 12)                                 // a Saturday: the week ended Friday
    for (const [whole, wantRows] of [[true, true], [false, false]]) {
      const d = Object.freeze(dailyCols('2026-08-03', '2026-11-20', { whole }))
      const client = { peekBars: vi.fn(() => d), getBars: vi.fn(async () => d), why: vi.fn(async () => 'seed-only:no-overlay') }
      const src = createDeviceSource({ load: async () => client, current: () => client, now })
      for (const tf of ['W', 'M']) {
        const p = src.peek('AAA', tf)
        const r = await src.read('AAA', tf, { urgent: true })
        expect(!!p).toBe(wantRows)
        expect(!!r).toBe(wantRows)
        if (wantRows) { expect(p.wholeFrom).toBe(p.rows[0].t); expect(r.n).toBe(p.n) }
        expect(await src.why('AAA', tf)).toBe(wantRows ? 'ok' : 'wm-shallow')
      }
      expect(client.peekBars.mock.calls.every((c) => c[1] === 'D')).toBe(true)
      expect(client.getBars.mock.calls.every((c) => c[1] === 'D')).toBe(true)
      expect(client.why.mock.calls.every((c) => c[1] === 'D')).toBe(true)
    }
  })
})

describe('WS3 the period in progress must be known', () => {
  const thruFri = dailyCols('2026-08-03', '2026-11-20')                    // the Friday-night seed
  const cases = [
    ['Saturday noon, the copy ends Friday', et('2026-11-21', 12), thruFri, true],
    ['Monday 03:59 ET, no session begun yet', et('2026-11-23', 3, 59), thruFri, true],
    ['Monday 04:00 ET, the session has begun: Monday is missing', et('2026-11-23', 4), thruFri, false],
    ['Monday mid-session without Monday\'s row', et('2026-11-23', 11), thruFri, false],
    ['Monday mid-session with Monday\'s (forming) row', et('2026-11-23', 11), dailyCols('2026-08-03', '2026-11-23'), true],
    ['Tuesday 02:00 ET, the copy ends Monday', et('2026-11-24', 2), dailyCols('2026-08-03', '2026-11-23'), true],
    ['Tuesday 02:00 ET, the copy ends Friday (a night missed)', et('2026-11-24', 2), thruFri, false],
    ['Thanksgiving (no session), the copy ends Wednesday', et('2026-11-26', 12), dailyCols('2026-08-03', '2026-11-25'), true],
  ]
  for (const [label, nowMs, cols, want] of cases) {
    it(`${label}: ${want ? 'known' : 'NOT known'}`, () => {
      expect(periodKnown(cols, nowMs)).toBe(want)
      expect(deriveServed(cols, 'W', nowMs).why).toBe(want ? 'ok' : 'wm-period')
    })
  }
})

describe('WS4 the derivation', () => {
  it('keeps the oldest bucket of a whole series (a listing on a Wednesday: its first week is the server\'s first week)', () => {
    const d = dailyCols('2026-09-02', '2026-11-20')                        // listed Wed 2026-09-02
    const { cols } = deriveServed(d, 'W', et('2026-11-21', 12))
    expect(cols.t[0]).toBe(dayUnix('2026-09-04'))                          // its ISO Friday
    expect(cols.o[0]).toBe(10)                                             // the listing day's open
    expect(cols.l[0]).toBe(9)
    expect(cols.forming).toBeUndefined()                                   // Saturday: the week has ended
  })

  it('a week not yet ended is the developing bar (forming), built from every day of it so far', () => {
    const d = dailyCols('2026-08-03', '2026-11-24')                        // through Tuesday's row
    const { cols } = deriveServed(d, 'W', et('2026-11-25', 2))             // Wednesday 02:00 ET
    const m = cols.t.length
    expect(cols.t[m - 1]).toBe(dayUnix('2026-11-27'))
    expect(cols.forming).toBe('W')
    const n = d.t.length
    expect(cols.o[m - 1]).toBe(d.o[n - 2])                                 // Monday's open
    expect(cols.c[m - 1]).toBe(d.c[n - 1])                                 // Tuesday's close
    expect(cols.v[m - 1]).toBe(d.v[n - 2] + d.v[n - 1])
    const mo = deriveServed(d, 'M', et('2026-11-25', 2)).cols
    expect(mo.forming).toBe('M')
    expect(mo.t[0]).toBe(dayUnix('2026-08-01'))                            // the whole series' first month kept
  })
})

describe('WS5 the page\'s client sends the worker nothing for W or M', () => {
  it('getBars / warm / peekBars of W or M: no message at all', async () => {
    const w = { onmessage: null, onerror: null, posted: [], terminate: vi.fn(), postMessage(m) { this.posted.push(m) } }
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {} })
    const asked = []
    for (const tf of ['W', 'M']) {
      asked.push(c.getBars('AAA', tf), c.getBars('AAA', tf, { urgent: true }), c.warm(['AAA', 'BBB'], tf))
      expect(c.peekBars('AAA', tf)).toBeNull()
    }
    expect(w.posted).toEqual([])
    expect(await Promise.all(asked)).toEqual([null, null, 0, null, null, 0])
  })
})
