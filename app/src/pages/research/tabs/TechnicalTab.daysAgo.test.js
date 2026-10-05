import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../components/StockChart', () => ({ default: () => null }))

// TECH -- "N days ago" is a difference of ET calendar dates, not a rounded
// millisecond gap from UTC midnight.
describe('TechnicalTab daysAgo', () => {
  it('a verdict dated today is 0 days old all day in ET, including the evening', async () => {
    const { daysAgo } = await import('./TechnicalTab')
    // 2026-10-05 15:00 ET (19:00Z) -- the old math rounded 19h to "1 day ago".
    expect(daysAgo('2026-10-05', Date.parse('2026-10-05T19:00:00Z'))).toBe(0)
    // 2026-10-05 23:30 ET is 03:30Z on Oct 6 -- still today in ET.
    expect(daysAgo('2026-10-05', Date.parse('2026-10-06T03:30:00Z'))).toBe(0)
  })

  it('counts whole ET days back, and rejects junk', async () => {
    const { daysAgo } = await import('./TechnicalTab')
    expect(daysAgo('2026-10-02', Date.parse('2026-10-05T14:00:00Z'))).toBe(3)
    expect(daysAgo('', Date.now())).toBeNull()
    expect(daysAgo('not-a-date', Date.now())).toBeNull()
  })
})
