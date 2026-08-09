// app/src/pages/calendar/useCalendarData.test.js
import { describe, it, expect } from 'vitest'
import { buildWeekDates, mergeEnrichment, isMine } from './useCalendarData'

describe('calendar helpers', () => {
  it('buildWeekDates returns 5 weekday ISO strings', () => {
    const out = buildWeekDates('2026-06-01')
    expect(out).toEqual(['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05'])
  })

  it('mergeEnrichment attaches move + history onto entries', () => {
    const entry = { sym: 'CRWD' }
    const enr = { CRWD: { expected_move: { pct: 9.1 }, beat_history: [{ beat: true }] } }
    const out = mergeEnrichment(entry, enr)
    expect(out.expected_move.pct).toBe(9.1)
    expect(out.beat_history).toHaveLength(1)
  })

  it('isMine respects selected sources', () => {
    const sets = { watchlist: ['AAPL'], flagged: ['NVDA'], positions: [], uct20: [] }
    expect(isMine('AAPL', sets, ['watchlist'])).toBe(true)
    expect(isMine('NVDA', sets, ['watchlist'])).toBe(false)
    expect(isMine('NVDA', sets, ['watchlist','flagged'])).toBe(true)
  })
})

describe('a symbol the enrichment never covered', () => {
  // The calendar feed carries symbols the overlay does not — every ticker in a
  // far-future week. Left unmarked, the modal reads the empty row as the CLAIM
  // "No reported quarters yet" (live 2026-08-08: DOCN).
  it('is marked unresolved rather than left silently empty', () => {
    const out = mergeEnrichment({ sym: 'DOCN' }, { OTHER: { beat_history: [] } })
    expect(out.history_unresolved).toBe(true)
  })

  it('still reports an enriched row honestly as answered', () => {
    const out = mergeEnrichment({ sym: 'JAZZ' }, { JAZZ: { beat_history: [] } })
    expect(out.history_unresolved).toBe(false)
  })
})
