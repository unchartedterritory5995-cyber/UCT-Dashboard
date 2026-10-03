import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CALENDAR_DEPTH_KEYS, readCalendarDepth } from './calendarDepthFlags'

// The Python tuple is the authority; this rail reads it instead of restating it.
function pythonKeys() {
  const src = readFileSync(resolve(__dirname, '../../../../../api/routers/auth.py'), 'utf8')
  const block = src.split('_CALENDAR_DEPTH_SURFACES = (')[1].split('\n)')[0]
  return [...block.matchAll(/\("([a-z_]+)",\s*"[a-z_]+"\)/g)].map(m => m[1])
}

describe('calendar depth flags', () => {
  it('mirrors the server tuple exactly', () => {
    expect(pythonKeys().length).toBeGreaterThan(0)
    expect([...CALENDAR_DEPTH_KEYS].sort()).toEqual(pythonKeys().sort())
  })

  it('reads === true only: absent, missing payload and truthy strings are all off', () => {
    expect(readCalendarDepth(null)).toEqual({
      earnings_date_status_enabled: false,
      index_rebalance_events_enabled: false,
      calendar_order_explain_enabled: false,
    })
    expect(readCalendarDepth({ earnings_date_status_enabled: 'true' }).earnings_date_status_enabled).toBe(false)
    expect(readCalendarDepth({ index_rebalance_events_enabled: true }).index_rebalance_events_enabled).toBe(true)
  })
})
