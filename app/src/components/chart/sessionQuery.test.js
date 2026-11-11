// 2026-11-10: the chart's session is a first-class /api/bars input (W-G).
import { describe, it, expect } from 'vitest'
import {
  seriesCacheTf, logicTfOf, barsSessionQuery, barsGridQuery, barsSessionFor,
  isOnSixtyMinGrid, computeBarTime, toChartTime,
} from './barTime'
import { liveStreamSession, bucketEndUnix } from './liveBuckets'
import { classifyLiveBar } from './liveBarClassify'

const et = (d, h, m) => Date.UTC(2026, 10, d, h + 5, m) / 1000   // November: EST

describe('cache identity: only 60m on the clock grid splits', () => {
  it('60m extended is 60e; everything else is its own tf on both sessions', () => {
    expect(seriesCacheTf('60', true)).toBe('60e')
    expect(seriesCacheTf('60', false)).toBe('60')
    for (const tf of ['1', '5', '15', '30', 'D', 'W', 'M']) {
      expect(seriesCacheTf(tf, true)).toBe(tf)
      expect(seriesCacheTf(tf, false)).toBe(tf)
    }
    expect(logicTfOf('60e')).toBe('60')
    expect(logicTfOf('5')).toBe('5')
  })
  it('session query on every intraday tf, grid query only where bars differ', () => {
    expect(barsSessionFor(true)).toBe('eth')
    expect(barsSessionQuery('5', false)).toBe('&session=rth')
    expect(barsSessionQuery('60', true)).toBe('&session=eth')
    expect(barsSessionQuery('D', true)).toBe('')
    expect(barsGridQuery('60', true)).toBe('&session=eth')
    expect(barsGridQuery('60', false)).toBe('')
    expect(barsGridQuery('5', true)).toBe('')
  })
})

describe('live stream + grid guard follow the served grid', () => {
  it('extended view streams eth and accepts clock hours; RTH view streams rth', () => {
    expect(liveStreamSession(true)).toBe('eth')
    expect(liveStreamSession(false)).toBe('rth')
    expect(isOnSixtyMinGrid(et(10, 10, 0), true)).toBe(true)
    expect(isOnSixtyMinGrid(et(10, 10, 30), true)).toBe(false)
    expect(isOnSixtyMinGrid(et(10, 10, 30), false)).toBe(true)
    expect(isOnSixtyMinGrid(et(10, 10, 0), false)).toBe(false)
  })
  it('callers that name no session keep the default (served) session grid', () => {
    expect(computeBarTime('60', et(10, 10, 45))).toBe(toChartTime(et(10, 10, 30)))
  })
})

describe('classifyLiveBar buckets 60m on the view grid', () => {
  it('eth: a 10:45 tick updates the 10:00 bar and an 11:05 tick opens 11:00', () => {
    const last = { time: toChartTime(et(10, 10, 0)), close: 1 }
    expect(classifyLiveBar({ tf: '60', last, tickSec: et(10, 10, 45), session: 'eth' }).kind).toBe('update')
    expect(classifyLiveBar({ tf: '60', last, tickSec: et(10, 11, 5), session: 'eth' }))
      .toEqual({ kind: 'new', time: toChartTime(et(10, 11, 0)) })
  })
  it('rth: a 10:45 tick on a 09:30 tail opens the 10:30 bucket', () => {
    const last = { time: toChartTime(et(10, 9, 30)), close: 1 }
    expect(classifyLiveBar({ tf: '60', last, tickSec: et(10, 10, 45), session: 'rth' }))
      .toEqual({ kind: 'new', time: toChartTime(et(10, 10, 30)) })
  })
})

describe('liveBuckets defaults to the SERVED grid, not the policy extended view', () => {
  it('bucketEndUnix with no grid ends the 09:30 bar at 10:30 (session grid)', () => {
    expect(bucketEndUnix(et(10, 9, 30), 60)).toBe(et(10, 10, 30))
    expect(bucketEndUnix(et(10, 9, 0), 60)).toBe(et(10, 9, 30))
    expect(bucketEndUnix(et(10, 9, 0), 60, { grid: 'clock' })).toBe(et(10, 10, 0))
  })
})
