// ⭐⭐ HISTORY PARITY — the rails of `tvRunStart` (docs/pine/HISTORY-PARITY.md).
//
// Every number the helper names is re-derived here from TradingView's own captures
// (`__fixtures__/tvRunStartCaptures.json`: bar COUNTS and bar TIMES of exhausted captures, no prices),
// and every capture row is replayed: a series with the row's shape (the vendor's deeper history, then
// the row's first chunk, then the bars after it) must start where TradingView's run started.
// The capture rows place bars contiguously at the timeframe's step; the rule reads only which chunk a
// bar falls in and how many bars are newer, so the shape is what decides it. The timezone, cap-edge,
// ambiguity and weekend rails below build the cases the captures cannot distinguish.
// Mutants: ci/mutants/hp1-tv-run-start.json.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  tvRunStart, TV_INTRADAY_CAP, TV_INTRADAY_CAP_BOUNDS, DATE_TF_MAX_WITNESSED_BARS, TV_CHUNK_BY_TF,
} from '../tvRunStart.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = JSON.parse(fs.readFileSync(path.join(HERE, '..', '__fixtures__', 'tvRunStartCaptures.json'), 'utf8'))
const utc = (s) => Date.parse(`${s.replace(' ', 'T')}:00Z`) / 1000
const DAY = 86400
const MAX_CHUNK_DAYS = { week: 7, month: 31, year: 366 }

// An implementation of "which chunk" that shares no code with the helper: the capture rows' shapes are
// checked with it before they are replayed, so a fixture that does not test what it claims fails loud.
function chunkOfIndependent(tSec, chunk, tz) {
  const [y, m, d] = new Date(tSec * 1000).toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number)
  if (chunk === 'year') return `${y}`
  if (chunk === 'month') return `${y}-${m}`
  const dt = new Date(Date.UTC(y, m - 1, d))
  const back = (dt.getUTCDay() + 6) % 7
  return new Date(dt.getTime() - back * DAY * 1000).toISOString().slice(0, 10)
}

/** The row's series: `prefix` deeper vendor bars, then the first chunk, then the bars after it. */
function seriesOf(row, prefix) {
  const step = Number(row.tf) * 60
  const first = utc(row.firstBarUTC)
  const c0 = row.bars - row.barsAfterFirstChunk
  const out = []
  const gap = MAX_CHUNK_DAYS[row.chunk] * DAY
  for (let i = prefix; i >= 1; i--) out.push(first - gap - i * step)
  for (let i = 0; i < c0; i++) out.push(first + i * step)
  const afterStart = first + gap + step
  for (let i = 0; i < row.barsAfterFirstChunk; i++) out.push(afterStart + i * step)
  return { times: out, first, c0, lastOfChunk: first + (c0 - 1) * step, afterStart }
}

const capRows = FIX.intraday.filter((r) => r.case === 'cap')
const wholeRows = FIX.intraday.filter((r) => r.case === 'whole-history')

describe('the numbers are derived from the captures, never restated', () => {
  it('the cap range is [max(bars after the first chunk) + 1, min(bars held at the cap)]', () => {
    const lo = Math.max(...capRows.map((r) => r.barsAfterFirstChunk)) + 1
    const hi = Math.min(...capRows.map((r) => r.bars))
    expect([lo, hi]).toEqual([...TV_INTRADAY_CAP_BOUNDS])
    // the whole-history rows never reached the cap: each is below it
    expect(Math.max(...wholeRows.map((r) => r.bars))).toBeLessThan(lo)
    expect(TV_INTRADAY_CAP).toBeGreaterThanOrEqual(lo)
    expect(TV_INTRADAY_CAP).toBeLessThanOrEqual(hi)
  })

  it('the D/W/M depth claimed is the deepest a capture witnessed', () => {
    expect(Math.max(...FIX.date.map((r) => r.bars))).toBe(DATE_TF_MAX_WITNESSED_BARS)
  })

  it('every capture timeframe has the chunk the capture shows', () => {
    for (const r of FIX.intraday) expect(TV_CHUNK_BY_TF[r.tf], `${r.tf} ${r.symbol}`).toBe(r.chunk)
  })

  it('a study\'s run starts at the capped first bar, not at the chart\'s loaded first bar', () => {
    const w = FIX.studyStartsBeforeLoaded
    // 6,343 bars loaded, bar_index 14,433 on the first loaded bar: the run held at least the cap
    expect(w.studyBarIndexAtFirstLoadedBar).toBeGreaterThan(0)
    expect(w.loadedBars + w.studyBarIndexAtFirstLoadedBar).toBeGreaterThanOrEqual(TV_INTRADAY_CAP_BOUNDS[0])
  })
})

describe('every TradingView capture row, replayed', () => {
  it.each(capRows.map((r) => [`${r.tf} ${r.symbol} ${r.captureDate} (${r.bars} bars)`, r]))(
    'cap row %s: the run starts on TradingView\'s first bar',
    (_, row) => {
      const P = 500
      const s = seriesOf(row, P)
      // the shape is what the row says (checked by the independent chunk code)
      expect(chunkOfIndependent(s.lastOfChunk, row.chunk, row.exchangeTz)).toBe(chunkOfIndependent(s.first, row.chunk, row.exchangeTz))
      expect(chunkOfIndependent(s.afterStart, row.chunk, row.exchangeTz)).not.toBe(chunkOfIndependent(s.first, row.chunk, row.exchangeTz))
      expect(chunkOfIndependent(s.times[P - 1], row.chunk, row.exchangeTz)).not.toBe(chunkOfIndependent(s.first, row.chunk, row.exchangeTz))
      const r = tvRunStart(row.tf, s.times, row.exchangeTz)
      expect(r).toMatchObject({ index: P, rule: 'cap-chunk', chunk: row.chunk, proven: true, ambiguous: false })
      expect(s.times[r.index]).toBe(s.first)
    })

  it.each(wholeRows.map((r) => [`${r.tf} ${r.symbol} ${r.captureDate} (${r.bars} bars)`, r]))(
    'whole-history row %s: the run starts on the vendor\'s first bar, proven only with the listing statement',
    (_, row) => {
      const s = seriesOf(row, 0)
      expect(tvRunStart(row.tf, s.times, row.exchangeTz, { startsAtListing: true }))
        .toMatchObject({ index: 0, rule: 'whole-history', proven: true })
      expect(tvRunStart(row.tf, s.times, row.exchangeTz)).toMatchObject({ index: 0, proven: false })
    })

  it('the boundary moves a whole chunk when the bars after the first chunk reach the cap (SPY 5m, 11-16 -> 11-17)', () => {
    const [a, b] = ['2026-11-16', '2026-11-17'].map((d) => capRows.find((r) => r.symbol === 'AMEX:SPY' && r.tf === '5' && r.captureDate === d))
    expect(a.firstBarUTC).toBe('2026-06-15 08:00')
    expect(b.firstBarUTC).toBe('2026-06-22 08:00')
    for (const row of [a, b]) {
      const s = seriesOf(row, 300)
      expect(s.times[tvRunStart('5', s.times).index]).toBe(utc(row.firstBarUTC))
    }
  })
})

describe('the cap-th newest bar, exactly (small cap, so the edge is visible)', () => {
  // 5m bars Mon..Fri 2026-06-15..19 and Mon 2026-06-22.., 10 a day from 14:00Z
  const days = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-22', '2026-06-23']
  const times = days.flatMap((d) => Array.from({ length: 10 }, (_, i) => utc(`${d} 14:00`) + i * 300))
  const afterWeek1 = times.filter((t) => t >= utc('2026-06-22 00:00')).length // 20
  const opts = (cap) => ({ cap, capBounds: [cap, cap], startsAtListing: false })
  it('with exactly `cap` bars after the first chunk, the cap-th newest bar is the next chunk\'s first', () => {
    expect(afterWeek1).toBe(20)
    expect(tvRunStart('5', times, undefined, opts(20)).index).toBe(50)
  })
  it('one bar more in the cap, and the start is a whole chunk earlier', () => {
    expect(tvRunStart('5', times, undefined, opts(21)).index).toBe(0)
  })
  it('a series one bar shorter than the cap starts at its first bar (whole history)', () => {
    expect(tvRunStart('5', times, undefined, opts(times.length + 1))).toMatchObject({ index: 0, rule: 'whole-history' })
    expect(tvRunStart('5', times, undefined, opts(times.length))).toMatchObject({ index: 0, rule: 'cap-chunk' })
  })
  it('the start is the first HELD bar of the chunk, not the cap-th bar', () => {
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15] }).index).toBe(50)
  })
})

describe('the chunk is a calendar chunk in the EXCHANGE\'s timezone', () => {
  // Winter: 19:30 ET is 00:30Z the next day. Fri 2025-01-31 19:30/19:45 ET is February in UTC, January in New York.
  const t15 = [
    utc('2025-01-30 14:30'), utc('2025-01-31 14:30'), utc('2025-02-01 00:30'), utc('2025-02-01 00:45'),
    ...Array.from({ length: 8 }, (_, i) => utc('2025-02-03 09:00') + i * 900),
  ]
  it('15m month: New York puts Fri 19:30 ET in January, so February starts Monday', () => {
    const r = tvRunStart('15', t15, 'America/New_York', { cap: 6, capBounds: [6, 6] })
    expect(r.index).toBe(4)
    expect(r.proven).toBe(true)
  })
  it('the same bars in UTC put those two bars in February', () => {
    expect(tvRunStart('15', t15, 'Etc/UTC', { cap: 6, capBounds: [6, 6] }).index).toBe(2)
  })
  it('60m year: New Year in New York is 05:00Z', () => {
    const t60 = [utc('2023-12-29 20:00'), utc('2024-01-01 02:00'), utc('2024-01-01 04:00'),
      ...Array.from({ length: 6 }, (_, i) => utc('2024-01-02 09:00') + i * 3600)]
    expect(tvRunStart('60', t60, 'America/New_York', { cap: 4, capBounds: [4, 4] }).index).toBe(3)
    expect(tvRunStart('60', t60, 'Etc/UTC', { cap: 4, capBounds: [4, 4] }).index).toBe(1)
  })
})

describe('never called exact when it is not', () => {
  const week = (d0, n) => Array.from({ length: n }, (_, i) => utc(d0) + i * 300)
  it('a cap range that straddles a chunk boundary is ambiguous', () => {
    const times = [...week('2026-06-15 14:00', 10), ...week('2026-06-22 14:00', 10)]
    const r = tvRunStart('5', times, undefined, { cap: 10, capBounds: [9, 11], startsAtListing: true })
    expect(r).toMatchObject({ ambiguous: true, proven: false })
    expect(tvRunStart('5', times, undefined, { cap: 10, capBounds: [10, 10], startsAtListing: true }).proven).toBe(true)
  })
  it('the tolerance widens the range DOWN (fewer bars: the cap-th bar moves a chunk later)', () => {
    // weeks of 10, 10, 10 bars; cap 15 is in week 2; cap 10 (15 - 5) reaches week 3, cap 20 (15 + 5) stays in week 2
    const times = [...week('2026-06-08 14:00', 10), ...week('2026-06-15 14:00', 10), ...week('2026-06-22 14:00', 10)]
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15] })).toMatchObject({ index: 10, proven: true })
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15], toleranceBars: 4 })).toMatchObject({ index: 10, proven: true })
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15], toleranceBars: 5 }))
      .toMatchObject({ ambiguous: true, proven: false })
  })
  it('the tolerance widens the range UP (more bars: the cap-th bar moves a chunk earlier)', () => {
    // weeks of 10, 10, 9 bars; cap 15 is in week 2; cap 10 stays in week 2, cap 20 reaches week 1
    const times = [...week('2026-06-08 14:00', 10), ...week('2026-06-15 14:00', 10), ...week('2026-06-22 14:00', 9)]
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15], toleranceBars: 4 })).toMatchObject({ index: 10, proven: true })
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15], toleranceBars: 5 }))
      .toMatchObject({ ambiguous: true, proven: false })
  })
  it('a held history that begins inside TradingView\'s first chunk is not proven (the vendor may hold more of it)', () => {
    const times = [...week('2026-06-17 14:00', 10), ...week('2026-06-22 14:00', 10)]
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15] })).toMatchObject({ index: 0, proven: false })
    expect(tvRunStart('5', times, undefined, { cap: 15, capBounds: [15, 15], startsAtListing: true }).proven).toBe(true)
  })
  it('a week chunk on a symbol that trades at the weekend is unmeasured (crypto 5m)', () => {
    const times = Array.from({ length: 24 * 12 * 10 }, (_, i) => utc('2026-06-13 00:00') + i * 300) // Sat 06-13 .. Mon 06-22
    const r = tvRunStart('5', times, 'Etc/UTC', { cap: 12 * 24 * 3, capBounds: [12 * 24 * 3, 12 * 24 * 3] })
    expect(times[r.index]).toBe(utc('2026-06-15 00:00'))
    expect(r.proven).toBe(false)
  })
  it('a timeframe no capture measured has no rule', () => {
    for (const tf of ['2', '3', '10', '1S', '180']) {
      expect(tvRunStart(tf, [1, 2, 3])).toMatchObject({ index: null, rule: 'unmeasured-timeframe', proven: false })
    }
  })
  it('a series out of order, or without times, has no rule', () => {
    expect(tvRunStart('5', [3, 2, 1]).index).toBe(null)
    expect(tvRunStart('5', [{ t: 1 }, { t: null }]).index).toBe(null)
    expect(tvRunStart('5', []).rule).toBe('empty')
  })
  it('bars as {t}, seconds or milliseconds answer the same', () => {
    const s = week('2026-06-15 14:00', 30)
    const a = tvRunStart('5', s, undefined, { cap: 10, capBounds: [10, 10] })
    expect(tvRunStart('5', s.map((t) => ({ t })), undefined, { cap: 10, capBounds: [10, 10] })).toEqual(a)
    expect(tvRunStart('5', s.map((t) => t * 1000), undefined, { cap: 10, capBounds: [10, 10] })).toEqual(a)
  })
})

describe('D / W / M: the whole vendor history', () => {
  const daily = (n) => Array.from({ length: n }, (_, i) => `d${i}`)
  it('proven from bar 0 when the series starts at the listing and is no deeper than any capture witnessed', () => {
    for (const tf of ['D', '1D', 'W', 'M']) {
      expect(tvRunStart(tf, daily(674), undefined, { startsAtListing: true })).toMatchObject({ index: 0, proven: true })
    }
    expect(tvRunStart('D', daily(DATE_TF_MAX_WITNESSED_BARS), undefined, { startsAtListing: true }).proven).toBe(true)
  })
  it('not proven without the listing statement', () => {
    expect(tvRunStart('D', daily(674))).toMatchObject({ index: 0, proven: false })
  })
  it('not proven deeper than any capture witnessed (a cap there is unknown)', () => {
    expect(tvRunStart('D', daily(DATE_TF_MAX_WITNESSED_BARS + 1), undefined, { startsAtListing: true }).proven).toBe(false)
  })
})
