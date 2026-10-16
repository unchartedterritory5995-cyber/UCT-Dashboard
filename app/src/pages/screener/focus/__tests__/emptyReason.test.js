import { expect, test } from 'vitest'
import { PRESENCE_MIN, presenceKeys, presenceSpec, emptyReason, reasonHead, reasonBody, REASON_SHORT } from '../emptyReason'

const META = { filters: [
  { key: 'rvol_live', label: 'Rel Volume (by now)', type: 'range', live_only: true },
  { key: 'vol_ratio', label: 'Volume Ratio', type: 'range' },
  { key: 'gap_pct', label: 'Gap %', type: 'range' },
  { key: 'implied_move_pct', label: 'Implied Move', type: 'range' },
  { key: 'above_50sma', label: 'Above 50 SMA', type: 'bool' },
  { key: 'sector', label: 'Sector', type: 'enum' },
] }
const SURGE = { filters: [
  { key: 'rvol_live', op: 'gte', min: 2 }, { key: 'above_50sma', op: 'eq', value: 1 },
  { key: 'sector', op: 'in', values: ['Tech'] }, { key: 'universe', op: 'eq', value: 'uct' },
] }
// Gap Movers' shape: live volume in the session, last session's otherwise
const GAP = { filters: [{ key: 'gap_pct', op: 'gte', min: 8 }], logic: { any: [
  { key: 'rvol_live', op: 'gte', min: 3 },
  { all: [{ none: [{ key: 'rvol_live', op: 'gte', min: 0 }] }, { key: 'vol_ratio', op: 'gte', min: 3 }] },
] } }

test('only range columns the screen REQUIRES are probed; an any-of alternative is not', () => {
  expect(presenceKeys(SURGE, META)).toEqual(['rvol_live'])
  expect(presenceKeys(GAP, META)).toEqual(['gap_pct'])
  expect(presenceKeys({ filters: [], logic: { all: [{ key: 'rvol_live', op: 'gte', min: 2 }] } }, META)).toEqual(['rvol_live'])
  expect(presenceKeys({ filters: [{ key: 'gap_pct', op: 'gte', min: 3 }, { key: 'rvol_live', op: 'gte', min: 1 }] }, META, { liveOnly: true })).toEqual(['rvol_live'])
  expect(presenceKeys(SURGE, null)).toEqual([])
})
test('a presence probe matches exactly the rows that hold a value', () => {
  expect(presenceSpec('rvol_live')).toEqual({ filters: [{ key: 'rvol_live', op: 'gte', min: PRESENCE_MIN }] })
  expect(PRESENCE_MIN).toBeLessThan(-1e12)
})
test('a zero caused by a live-only column with no value yet is "live during the session"', () => {
  const r = emptyReason({ spec: SURGE, meta: META, presence: { rvol_live: 0 } })
  expect(r).toEqual({ kind: 'live', labels: ['Rel Volume (by now)'] })
  expect(REASON_SHORT[r.kind]).toBe('live during the session')
  expect(reasonHead(r)).toMatch(/live during the session/)
  expect(reasonBody(r)).toMatch(/Rel Volume \(by now\) fills in from the live tape during the session/)
})
test('in the session the same zero is an ordinary zero', () => {
  expect(emptyReason({ spec: SURGE, meta: META, presence: { rvol_live: 812 } })).toBeNull()
})
test('until every probe answers the reason is unknown, never a guess', () => {
  expect(emptyReason({ spec: SURGE, meta: META, presence: {} })).toBeUndefined()
})
test('Gap Movers after the close is a real zero: its live column is only one alternative', () => {
  expect(emptyReason({ spec: GAP, meta: META, presence: { gap_pct: 11000 } })).toBeNull()
})
test('a non-live column nobody holds is "not available yet"', () => {
  const spec = { filters: [{ key: 'implied_move_pct', op: 'gte', min: 0 }] }
  const r = emptyReason({ spec, meta: META, presence: { implied_move_pct: 0 } })
  expect(r).toEqual({ kind: 'missing', labels: ['Implied Move'] })
  expect(REASON_SHORT[r.kind]).toBe('not available yet')
  expect(reasonBody(r)).toMatch(/No stock has a value for Implied Move yet/)
})
test('a coverage receipt where no row could be checked is "not available yet"', () => {
  const coverage = { evaluated: 11230, answered: 0, not_computable: 11230, dropped: 0 }
  const r = emptyReason({ spec: { filters: [] }, meta: META, presence: {}, coverage })
  expect(r).toEqual({ kind: 'missing', labels: [] })
  expect(reasonBody(r, coverage)).toMatch(/None of the 11,230 stocks has a value for every filter/)
  // some rows checked: an ordinary zero
  expect(emptyReason({ spec: { filters: [] }, meta: META, coverage: { evaluated: 100, not_computable: 40 } })).toBeNull()
})
