import { expect, test } from 'vitest'
import { whyItsHere, archiveNote } from '../whyItsHere'

// Trader archive (2026-10-16): one evidence item, always a note, never a check.

const meta = [{ key: 'rs_rank', label: 'RS Rank', type: 'range', unit: null, presets: [] }]
const called = {
  ticker: 'ZZTA', rs_rank: 94, archive_calls_n: 7, archive_last_setup: 'kicker',
  archive_last_call_date: '2025-04-03', archive_last_r20: 12.04,
}

test('a called name gets ONE note naming the setup, date, outcome and count', () => {
  const { items } = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row: called })
  const team = items.filter(i => i.label.startsWith('Team:'))
  expect(team).toHaveLength(1)
  expect(team[0]).toEqual({ kind: 'note', label: 'Team: kicker called 2025-04-03 (r20 +12.0%) · 7 calls' })
})

test('it is never a check mark, even when it is the only item', () => {
  const { items } = whyItsHere({ row: called })
  expect(items).toEqual([{ kind: 'note', label: 'Team: kicker called 2025-04-03 (r20 +12.0%) · 7 calls' }])
  expect(items.some(i => i.kind === 'check')).toBe(false)
})

test('a name the team never called, or a row without the columns, adds nothing', () => {
  expect(archiveNote({ ticker: 'X', archive_calls_n: 0 })).toBeNull()
  expect(archiveNote({ ticker: 'X' })).toBeNull()                       // archive off: blank columns
  const { items } = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row: { ticker: 'X', rs_rank: 90 } })
  expect(items.some(i => i.label.startsWith('Team:'))).toBe(false)
})

test('an immature call reads without an outcome, and one call reads singular', () => {
  const n = archiveNote({ archive_calls_n: 1, archive_last_setup: 'flag_htf', archive_last_call_date: '2026-10-01', archive_last_r20: null })
  expect(n.label).toBe('Team: flag htf called 2026-10-01 · 1 call')
  const neg = archiveNote({ archive_calls_n: 3, archive_last_call_date: '2025-01-02', archive_last_r20: -4.5 })
  expect(neg.label).toBe('Team: called 2025-01-02 (r20 -4.5%) · 3 calls')
})
