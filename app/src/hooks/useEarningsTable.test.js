import { describe, it, expect, vi, afterEach } from 'vitest'
import { earningsRefreshInterval } from './useEarningsTable'

const FAST = 60 * 1000
const SLOW = 5 * 60 * 1000

afterEach(() => vi.useRealTimers())

function freeze(iso) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe('earningsRefreshInterval', () => {
  it('slow poll with no data or no quarterly rows', () => {
    expect(earningsRefreshInterval(undefined)).toBe(SLOW)
    expect(earningsRefreshInterval({})).toBe(SLOW)
    expect(earningsRefreshInterval({ quarterly: [] })).toBe(SLOW)
  })

  it('fast poll when an unreported quarter reports today', () => {
    freeze('2026-08-05T14:00:00Z')
    const data = { quarterly: [
      { label: '2026 Q2', reported: true },
      { label: '2026 Q3', reported: false, report_date: '2026-08-05' },
    ] }
    expect(earningsRefreshInterval(data)).toBe(FAST)
  })

  it('fast poll the day after the scheduled report (post-print window)', () => {
    freeze('2026-08-06T14:00:00Z')
    const data = { quarterly: [{ reported: false, report_date: '2026-08-05' }] }
    expect(earningsRefreshInterval(data)).toBe(FAST)
  })

  it('slow poll when the report is weeks away', () => {
    freeze('2026-08-05T14:00:00Z')
    const data = { quarterly: [{ reported: false, report_date: '2026-09-20' }] }
    expect(earningsRefreshInterval(data)).toBe(SLOW)
  })

  it('reported rows and dateless forward rows never trigger fast poll', () => {
    freeze('2026-08-05T14:00:00Z')
    const data = { quarterly: [
      { reported: true, report_date: '2026-08-05' },
      { reported: false, report_date: null },
    ] }
    expect(earningsRefreshInterval(data)).toBe(SLOW)
  })
})
