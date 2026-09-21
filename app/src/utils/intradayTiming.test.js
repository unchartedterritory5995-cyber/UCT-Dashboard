/**
 * Latency and freshness, recorded together — and the expectation model behind the
 * freshness half.
 *
 * ⛔ THE ACCEPTANCE RULE THIS ENCODES: `T2 = 180 ms` is not success if the newest
 * completed bar is three hours old. Every metric the product already had reports
 * only the left-hand number, which is how a fast stale chart passed for a fast one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectedLatestCompletedBar, expectedFormingBar } from './marketSession'
import { timingStart, timingMark, timingReport, timingClear, freshnessLag } from './intradayTiming'

const at = (iso) => new Date(iso).getTime()
const etLabel = (sec) => new Date(sec * 1000).toLocaleString('en-US', {
  timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })

describe('expectedLatestCompletedBar', () => {
  // Tue 2026-09-15 13:17 ET — the clock from the report.
  const T = at('2026-09-15T17:17:00Z')

  it('⭐ 13:17 on 5m expects the 13:10 bar completed and 13:15 forming', () => {
    expect(etLabel(expectedLatestCompletedBar('5', T))).toBe('13:10')
    expect(etLabel(expectedFormingBar('5', T))).toBe('13:15')
  })

  it('tf=60 is SESSION-ANCHORED, matching the server bucketer', () => {
    expect(etLabel(expectedLatestCompletedBar('60', T))).toBe('12:00')
    // …and the opening hour anchors at 09:30, not 09:00.
    expect(etLabel(expectedLatestCompletedBar('60', at('2026-09-15T14:05:00Z')))).toBe('09:30')
  })

  it.each([['1', '13:16'], ['15', '13:00'], ['30', '12:30']])('tf=%s → %s', (tf, want) => {
    expect(etLabel(expectedLatestCompletedBar(tf, T))).toBe(want)
  })

  it('after the close the last RTH bucket is the expectation, and nothing forms', () => {
    const after = at('2026-09-15T20:30:00Z')      // 16:30 ET
    expect(etLabel(expectedLatestCompletedBar('5', after))).toBe('15:55')
    expect(expectedFormingBar('5', after)).toBeNull()
  })

  it('⛔ returns null rather than inventing an expectation', () => {
    expect(expectedLatestCompletedBar('5', at('2026-09-20T17:00:00Z'))).toBeNull()  // Sunday
    expect(expectedLatestCompletedBar('5', at('2026-09-15T13:31:00Z'))).toBeNull()  // 09:31, no bucket closed
    expect(expectedLatestCompletedBar('bogus', T)).toBeNull()
  })

  it('extended-hours mode expects bars outside RTH; RTH mode does not', () => {
    const pre = at('2026-09-15T12:00:00Z')        // 08:00 ET
    expect(expectedLatestCompletedBar('5', pre, { session: 'extended' })).not.toBeNull()
    expect(expectedLatestCompletedBar('5', pre)).toBeNull()
  })
})

describe('freshness lag', () => {
  const T = at('2026-09-15T17:17:00Z')
  const etToday = (h, m) => Math.floor(Date.UTC(2026, 8, 15, h + 4, m) / 1000)

  it('⭐ the reported failure: a 10:00 tail at 13:17 is ~3h behind', () => {
    const lag = freshnessLag(etToday(10, 0), '5', T)
    expect(lag).toBeGreaterThan(3 * 3600 - 700)
    expect(lag).toBeLessThan(3 * 3600 + 700)
  })

  it('a tail AT the expected completed bar has zero lag', () => {
    expect(freshnessLag(etToday(13, 10), '5', T)).toBe(0)
  })

  it('a tail ahead of expectation (the forming bar) never reports negative', () => {
    expect(freshnessLag(etToday(13, 15), '5', T)).toBe(0)
  })

  it('no expectation → no lag, rather than a fabricated one', () => {
    expect(freshnessLag(etToday(10, 0), '5', at('2026-09-20T17:00:00Z'))).toBeNull()
  })
})

describe('T0-T4 recording', () => {
  beforeEach(() => {
    timingClear()
    try { localStorage.setItem('uct.chartTiming', '1') } catch { /* ignore */ }
  })
  afterEach(() => { try { localStorage.removeItem('uct.chartTiming') } catch { /* ignore */ } })

  it('records the four phases against one load', () => {
    const id = timingStart('AAPL', '5', { session: 'rth', cache: 'cold' })
    expect(id).toBeTruthy()
    timingMark(id, 'T1'); timingMark(id, 'T2')
    timingMark(id, 'T3', { tailEnd: 1_789_000_000 })
    timingMark(id, 'T4', { formingAt: 1_789_000_300 })
    const [row] = timingReport()
    expect(row.sym).toBe('AAPL')
    expect(row['T0→T1']).not.toBeNull()
    expect(row['T0→T4']).not.toBeNull()
    expect(row.tailEnd).toBe(1_789_000_000)
  })

  it('first write per phase wins — a re-render cannot restate T2', () => {
    const id = timingStart('AAPL', '5')
    timingMark(id, 'T2')
    const first = timingReport()[0]['T0→T2']
    timingMark(id, 'T2')
    expect(timingReport()[0]['T0→T2']).toBe(first)
  })

  it('⛔ every row carries freshness beside latency — there is no latency-only view', () => {
    const id = timingStart('AAPL', '5')
    timingMark(id, 'T2')
    const row = timingReport()[0]
    expect(row).toHaveProperty('freshnessLagSec')
    expect(row).toHaveProperty('expectedLatest')
  })

  it('is INERT when the flag is off, so production pays nothing', () => {
    try { localStorage.removeItem('uct.chartTiming') } catch { /* ignore */ }
    expect(timingStart('AAPL', '5')).toBeNull()
    expect(timingReport()).toEqual([])
  })

  it('is bounded — a scanning session cannot grow it without limit', () => {
    for (let i = 0; i < 260; i++) timingStart(`S${i}`, '5')
    expect(timingReport().length).toBeLessThanOrEqual(200)
  })
})
