// Pre-market mode in the Focus screen (spec 2026-10-16 §2, plan Task 4): the empty state
// for a Morning prep screen outside 04:00-09:30 ET, the data label off the pre-market
// receipt, and the group the two starters land in.
import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test } from 'vitest'
import DataReceipt from '../DataReceipt'
import { emptyReason, reasonHead, reasonBody, REASON_SHORT, presenceKeys } from '../emptyReason'
import { groupOf, GROUPS } from '../screenGroups'

const META = { filters: [
  { key: 'premarket_chg_pct', label: 'Pre-mkt %', type: 'range', live_only: true, premarket_only: true },
  { key: 'rvol_live', label: 'Rel Volume (by now)', type: 'range', live_only: true },
  { key: 'dollar_vol_30d', label: 'Dollar Volume (30d)', type: 'range' },
] }
const GAPPERS = { filters: [
  { key: 'premarket_chg_pct', op: 'gte', min: 3 },
  { key: 'dollar_vol_30d', op: 'gte', min: 10_000_000 },
] }

test('a pre-market screen outside 04:00-09:30 says when it fills, never "none today"', () => {
  const r = emptyReason({ spec: GAPPERS, meta: META, presence: { premarket_chg_pct: 0 }, liveOnly: true })
  expect(r).toEqual({ kind: 'premarket', labels: ['Pre-mkt %'] })
  expect(reasonHead(r)).toBe('Extended-hours screens fill before the open and after the close')
  expect(reasonBody(r)).toMatch(/That is a gap in the data, not a quiet market/)
  expect(REASON_SHORT[r.kind]).toBeTruthy()
})
test('inside the window a zero is an ordinary zero', () => {
  expect(emptyReason({ spec: GAPPERS, meta: META, presence: { premarket_chg_pct: 41 }, liveOnly: true })).toBeNull()
})
test('control: the live-session reason is unchanged for a live-volume screen', () => {
  const spec = { filters: [{ key: 'rvol_live', op: 'gte', min: 2 }] }
  const r = emptyReason({ spec, meta: META, presence: { rvol_live: 0 }, liveOnly: true })
  expect(r.kind).toBe('live')
  expect(reasonHead(r)).toMatch(/live during the session/)
})
test('the pre-market column is probed like any live-only column', () => {
  expect(presenceKeys(GAPPERS, META, { liveOnly: true })).toEqual(['premarket_chg_pct'])
})

// Fri 2026-10-16, ET is UTC-4.
const at = iso => Date.parse(iso)
const pm = iso => ({ state: 'premarket', as_of: at(iso) / 1000 })

test('a fresh pre-market receipt at 8:42 labels the data "Pre-market · 8:42 AM"', () => {
  render(<DataReceipt snapshotDate="2026-10-16" premarket={pm('2026-10-16T08:42:00-04:00')}
    now={at('2026-10-16T08:43:00-04:00')} />)
  const btn = screen.getByRole('button', { name: /^Pre-market · 8:42 AM/ })
  fireEvent.click(btn)
  const region = screen.getByRole('region', { name: 'About this data' })
  expect(region).toHaveTextContent('Ext-hrs %')
  expect(region).toHaveTextContent('No pre-market volume is available')
})
test('at 9:31 the same receipt no longer labels the screen: the nightly label returns', () => {
  render(<DataReceipt snapshotDate="2026-10-16" premarket={pm('2026-10-16T09:29:30-04:00')}
    now={at('2026-10-16T09:31:00-04:00')} />)
  const btn = screen.getByRole('button', { name: /Oct 15 close/ })
  expect(btn).not.toHaveTextContent('Pre-market')
})
test('a receipt older than 180 s is not current', () => {
  render(<DataReceipt snapshotDate="2026-10-16" premarket={pm('2026-10-16T08:05:00-04:00')}
    now={at('2026-10-16T08:40:00-04:00')} />)
  expect(screen.getByRole('button')).not.toHaveTextContent('Pre-market')
})
test('outside pre-market the Live label is unchanged', () => {
  render(<DataReceipt snapshotDate="2026-10-16"
    live={{ state: 'live', as_of: at('2026-10-16T10:09:00-04:00') / 1000, columns: ['price'] }}
    now={at('2026-10-16T10:10:00-04:00')} />)
  expect(screen.getByRole('button', { name: /^Live · 10:09 AM/ })).not.toHaveTextContent('Pre-market')
})
test('the two starters land in Extended hours', () => {
  expect(GROUPS.find(g => g.key === 'premarket')?.label).toBe('Extended hours')
  expect(groupOf({ id: 'starter_premarket_gappers', group: 'Extended hours' })).toBe('premarket')
  expect(groupOf({ id: 'starter_premarket_setups', group: 'Extended hours' })).toBe('premarket')
})

// After hours (2026-10-17): the same columns, the evening window.
const ah = iso => ({ state: 'premarket', session: 'post', as_of: at(iso) / 1000 })

test('a fresh after-hours receipt at 5:05 PM labels the data "After hours"', () => {
  render(<DataReceipt snapshotDate="2026-10-15" premarket={ah('2026-10-16T17:05:00-04:00')}
    now={at('2026-10-16T17:06:00-04:00')} />)
  const btn = screen.getByRole('button', { name: /^After hours · 5:05 PM/ })
  fireEvent.click(btn)
  expect(screen.getByRole('region', { name: 'About this data' })).toHaveTextContent("against today's close")
})
test('on Saturday the held after-hours print is explained, never labelled live', () => {
  render(<DataReceipt snapshotDate="2026-10-17" premarket={ah('2026-10-16T19:59:00-04:00')}
    now={at('2026-10-17T11:00:00-04:00')} />)
  const btn = screen.getByRole('button', { name: /Oct 16 close/ })
  expect(btn).not.toHaveTextContent('After hours')
  fireEvent.click(btn)
  expect(screen.getByRole('region', { name: 'About this data' }))
    .toHaveTextContent(/the last after-hours trade, Fri 7:59 PM ET/)
})
test('control: an after-hours receipt never reads as pre-market in the morning', () => {
  render(<DataReceipt snapshotDate="2026-10-16" premarket={ah('2026-10-17T08:42:00-04:00')}
    now={at('2026-10-17T08:43:00-04:00')} />)
  expect(screen.getByRole('button')).not.toHaveTextContent('Pre-market')
})
