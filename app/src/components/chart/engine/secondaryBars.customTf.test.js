// ⭐⭐ (e95, 2026-11-22) A CUSTOM TIMEFRAME'S OTHER-SYMBOL BARS ARE BUILT THE WAY THE CHART BUILDS ITS OWN.
// ⚰️ Production 2026-11-22: Fred RS's legend was absent on a 4h chart; `/api/bars/SPX?tf=240` answers `bars: []` (the
// route serves native timeframes only), and this lane asked it for the custom code. Rails: the fetch goes to the
// native base (`fetchTf`) at depth x ratio; the rows are `resampleForSpec`'s, so their times are the chart's own grid;
// the forming tail; the page-depth rule; a symbol off the US equity session refused by name, never resampled.
import { afterEach, describe, expect, it } from 'vitest'
import {
  SOURCE_STATUS, baseAskOf, cachedBars, clearSecondaryBars, fetchSecondaryBars, offSessionRowOf, primeSecondaryBars,
  refreshSecondaryTail, secondaryFetchOf,
} from './secondaryBars'
import { BARS_ASK_MAX } from './otherSymbols'
import { fetchTf, resampleSpec } from '../timeframes'
import { resampleForSpec } from '../../../utils/resampleBars'
import fs from 'node:fs'
import path from 'node:path'

afterEach(() => clearSecondaryBars())

// Mon 2026-11-16 .. Fri 2026-11-20 (EST: 09:30 ET = 14:30Z)
const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + (h + 5) * 3600 + m * 60
}
/** Regular-session rows of `step` minutes (the route's RTH grid for 60, the eth-clock grid's RTH part otherwise). */
function rows(step, days = DAYS, base = 100) {
  const out = []
  let k = 0
  for (const d of days) {
    for (let m = 570; m < 960; m += step) {
      const p = base + k++
      out.push({ t: at(d, `${Math.floor(m / 60)}:${m % 60}`), o: p, h: p + 1, l: p - 1, c: p + 0.5, v: 10 })
    }
  }
  return out
}
const dailyRows = (days) => days.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1 }))

/** A fake route: answers the URL's tf with the given rows, newest `bars`; records every URL asked. */
function routeOf(byTf, extra = {}) {
  const asked = []
  const get = (url) => {
    asked.push(url)
    const q = new URL(url, 'http://x').searchParams
    const all = byTf[q.get('tf')] || []
    return Promise.resolve({ bars: all.slice(-Number(q.get('bars'))), ...extra })
  }
  return { get, asked }
}

describe('a custom timeframe is fetched at its native base and resampled by the chart’s own rule', () => {
  it.each([
    ['240', '60', 4],
    ['120', '60', 2],
    ['45', '15', 3],
  ])('%s: the wire asks tf=%s at depth x %i, never the custom code', async (tf, base, per) => {
    const wire = secondaryFetchOf('SPX', tf, 50)
    expect(wire.url).toContain(`tf=${tf}&bars=50`)                // the cache key stays the custom code
    expect(wire.fetchUrl).toContain(`tf=${base}&bars=${50 * per}`)
    expect(fetchTf(tf)).toBe(base)
    const r = routeOf({ [base]: rows(Number(base)) })
    const entry = await fetchSecondaryBars('SPX', tf, 50, r.get)
    expect(r.asked).toEqual([wire.fetchUrl])
    expect(r.asked.some((u) => u.includes(`tf=${tf}&`))).toBe(false)  // ⛔ the mutant: the raw code sent again
    expect(entry.status).toBe(SOURCE_STATUS.AVAILABLE)
    const want = resampleForSpec(rows(Number(base)), resampleSpec(tf))
    expect(entry.bars).toEqual(want)                               // the store's whole depth: nothing trimmed
    expect(cachedBars('SPX', tf, 50)).toBe(entry)
  })

  it('2D: daily base, N-day windows, the same rule as the chart', async () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10']
    const r = routeOf({ D: dailyRows(days) })
    const entry = await fetchSecondaryBars('SPX', '2D', 10, r.get)
    expect(r.asked[0]).toContain('tf=D&bars=20')
    expect(entry.bars).toEqual(resampleForSpec(dailyRows(days), resampleSpec('2D')))
  })

  it('the other symbol’s 4h rows sit on the chart’s own 4h grid (exact-time projection)', async () => {
    const stock = resampleForSpec(rows(60, DAYS, 50), resampleSpec('240'))   // what the chart draws for its stock
    const r = routeOf({ 60: rows(60, DAYS, 5000) })
    const spx = await fetchSecondaryBars('SPX', '240', 50, r.get)
    expect(spx.bars.map((b) => b.t)).toEqual(stock.map((b) => b.t))
    expect(spx.bars.map((b) => b.t)).toEqual(DAYS.flatMap((d) => [at(d, '9:30'), at(d, '13:30')]))
  })
})

describe('the page-depth rule on a resampled page', () => {
  it('a base page that FILLED its ask drops its first (maybe partial) bucket and names its own row count', async () => {
    const all = rows(60)                                           // 35 rows; ask 6 x 4 = 24 → filled
    const r = routeOf({ 60: all })
    const entry = await fetchSecondaryBars('SPX', '240', 6, r.get)
    const full = resampleForSpec(all.slice(-24), resampleSpec('240'))
    expect(entry.bars).toEqual(full.slice(1))
    expect(entry.askedBars).toBe(entry.bars.length)
  })

  it('a page holding the store’s whole depth names no ask (nothing deeper is coming)', async () => {
    const r = routeOf({ 60: rows(60) })                            // 35 rows < 200 x 4
    const entry = await fetchSecondaryBars('SPX', '240', 200, r.get)
    expect(entry.askedBars).toBeUndefined()
  })

  it('an ask at the route’s limit names no ask either (a deeper page cannot exist)', () => {
    expect(baseAskOf('240', 50000)).toBe(BARS_ASK_MAX)
    expect(secondaryFetchOf('SPX', '240', 50000).fetchUrl).toContain(`bars=${BARS_ASK_MAX}`)
  })

  it('the literal limit here equals the run’s (`otherSymbols.BARS_ASK_MAX`)', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/chart/engine/secondaryBars.js'), 'utf8')
    expect(src).toContain(`const BASE_ASK_MAX = ${BARS_ASK_MAX}`)
  })
})

describe('the forming tail of a custom timeframe', () => {
  it('re-reads the base’s newest rows, resamples, drops the first bucket, and merges onto the held rows', async () => {
    // ten sessions: the tail's 40 base rows begin at 11:30 of a session, INSIDE its 09:30 bucket (a partial bucket)
    const TEN = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', ...DAYS]
    const held = rows(60, TEN.slice(0, 9))
    const r1 = routeOf({ 60: held })
    await fetchSecondaryBars('SPX', '240', 200, r1.get)
    const grown = rows(60, TEN)                                     // Friday arrives, its newest bar forming
    expect(new Date(grown[grown.length - 40].t * 1000).toISOString()).toBe('2026-11-13T16:30:00.000Z')   // 11:30 ET
    const r2 = routeOf({ 60: grown }, { newest_bar_is_forming: true })
    expect(refreshSecondaryTail('SPX', '240', 200, r2.get)).toBe(true)
    await new Promise((res) => setTimeout(res, 0))
    await new Promise((res) => setTimeout(res, 0))
    expect(r2.asked[0]).toContain('tf=60&bars=40')                 // TAIL_BARS x 4 at the base
    const after = cachedBars('SPX', '240', 200)
    expect(after.bars).toEqual(resampleForSpec(grown, resampleSpec('240')))
    expect(after.newestBarIsForming).toBe(true)
  })
})

describe('the other symbol’s own session (coordinator ruling 2026-11-22): refused by name when it is not the US one', () => {
  const crypto = [{ t: at('2026-11-21', '10:00'), o: 1, h: 1, l: 1, c: 1, v: 1 }]           // a Saturday
  const clockHours = [{ t: at('2026-11-16', '9:00'), o: 1, h: 1, l: 1, c: 1, v: 1 }]       // off the 09:30 grid
  const overnight = [{ t: at('2026-11-16', '2:30'), o: 1, h: 1, l: 1, c: 1, v: 1 }]        // futures hours

  it.each([['a weekend bar', crypto], ['a clock-hour bar', clockHours], ['an overnight bar', overnight]])(
    '%s: UNSUPPORTED with a note naming it, no rows', async (_name, base) => {
      const r = routeOf({ 60: base })
      const entry = await fetchSecondaryBars('BTCUSD', '240', 50, r.get)
      expect(entry.status).toBe(SOURCE_STATUS.UNSUPPORTED)
      expect(entry.bars).toEqual([])
      expect(entry.note).toMatch(/BTCUSD's 240 bars are not built here: its own session is not the US equity session/)
    })

  it('a daily base with a weekend day is refused for an N-day window', async () => {
    const r = routeOf({ D: dailyRows(['2026-11-20', '2026-11-21']) })
    const entry = await fetchSecondaryBars('BTCUSD', '2D', 10, r.get)
    expect(entry.status).toBe(SOURCE_STATUS.UNSUPPORTED)
    expect(entry.note).toMatch(/Saturday/)
  })

  it('the US session on every native base grid passes (RTH 60m; the eth-clock 5 / 15 / 30 grids from 04:00)', () => {
    expect(offSessionRowOf(rows(60), resampleSpec('240'))).toBeNull()
    const eth = () => [{ t: at('2026-11-16', '4:00') }, { t: at('2026-11-16', '19:30') }].map((b) => ({ ...b }))
    for (const [tf, step] of [['10', 5], ['45', 15], ['90', 30]]) {
      expect(resampleSpec(tf).base).toBe(String(step))
      expect(offSessionRowOf(eth(), resampleSpec(tf))).toBeNull()
    }
  })
})

describe('what does not change', () => {
  it('a native timeframe fetches its own URL, unresampled, exactly as before', async () => {
    const wire = secondaryFetchOf('SPX', '60', 50)
    expect(wire.fetchUrl).toBe(wire.url)
    expect(wire.spec).toBeNull()
    const r = routeOf({ 60: rows(60) })
    const entry = await fetchSecondaryBars('SPX', '60', 50, r.get)
    expect(entry.bars).toEqual(rows(60).slice(-50))
  })

  it('a custom timeframe is never primed from a payload of unknown shape', () => {
    expect(primeSecondaryBars('SPX', '240', 50, { bars: rows(60) })).toBeNull()
    expect(cachedBars('SPX', '240', 50)).toBeNull()
  })
})
