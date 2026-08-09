/**
 * The routing decision behind every drillable cell. It sits in its own module
 * because two surfaces read it, and a cell that drills a live list in the table
 * while drilling yesterday's in the tiles is drift nothing would report.
 */
import { describe, it, expect } from 'vitest'
import { drillTarget } from './liveDrill'

const LIVE = { date: '2026-08-07', _live: true }
const STORED = { date: '2026-08-06' }

const up4 = { key: 'up_4pct_today', drillKey: 'up_4pct_today_list' }
const atr = { key: 'atr_ext_7', drillKey: 'atr_ext_7_list' }
const score = { key: 'breadth_score' }          // no drillKey — never drillable

const live = (over = {}) => ({
  carried: new Set(['atr_ext_7', 'naaim', 'vix']),
  carriedFrom: '2026-08-06',
  ...over,
})

describe('drillTarget', () => {
  it('sends a settled row to its own date, unchanged', () => {
    expect(drillTarget(STORED, up4, live())).toEqual({
      url: '/api/breadth-monitor/2026-08-06/drill/up_4pct_today_list',
      date: '2026-08-06', live: false,
    })
  })

  it('sends a live-measured metric to the live endpoint', () => {
    expect(drillTarget(LIVE, up4, live())).toEqual({
      url: '/api/breadth-monitor/live/drill/up_4pct_today_list',
      date: '2026-08-07', live: true,
    })
  })

  // atr_ext_7's live value IS the prior session's — it needs intraday high/low.
  // Opening today's list for it would caption yesterday's names as today's.
  it('sends a carried metric to the session it was carried from', () => {
    expect(drillTarget(LIVE, atr, live())).toEqual({
      url: '/api/breadth-monitor/2026-08-06/drill/atr_ext_7_list',
      date: '2026-08-06', live: false,
    })
  })

  it('marks a carried target as NOT live, so the modal dates it', () => {
    expect(drillTarget(LIVE, atr, live()).live).toBe(false)
  })

  it('leaves a carried metric inert when there is no date to attribute it to', () => {
    expect(drillTarget(LIVE, atr, live({ carriedFrom: null }))).toBeNull()
  })

  it('never offers a cell that declares no drillKey', () => {
    expect(drillTarget(LIVE, score, live())).toBeNull()
    expect(drillTarget(STORED, score, live())).toBeNull()
  })

  // The tiles render before the live payload resolves.
  it('treats a live row with no live meta yet as live-measured', () => {
    expect(drillTarget(LIVE, up4, null).live).toBe(true)
    expect(drillTarget(LIVE, up4, {}).live).toBe(true)
  })

  it('is null for no row at all', () => {
    expect(drillTarget(null, up4, live())).toBeNull()
  })
})
