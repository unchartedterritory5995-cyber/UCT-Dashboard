import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test } from 'vitest'
import DataReceipt from '../DataReceipt'

// 2026-10-14 is a Wednesday; ET is UTC-4 in October. Stamps are BUILD dates (03:00 ET nightly).
const thuMorning = Date.parse('2026-10-15T10:00:00-04:00')
test('P7: the receipt names the session the build describes, not the build date', () => {
  render(<DataReceipt snapshotDate="2026-10-15" now={thuMorning} />)
  const btn = screen.getByRole('button', { name: /Oct 14 close/ })
  expect(btn).not.toHaveTextContent('stale')
})
test('P7: one missed nightly is amber and says stale', () => {
  render(<DataReceipt snapshotDate="2026-10-14" now={thuMorning} />)
  const btn = screen.getByRole('button', { name: /Oct 13 close · stale/ })
  expect(btn.querySelector('[class*="staleTag"]')).not.toBeNull()
  fireEvent.click(btn)
  expect(screen.getByRole('region', { name: 'About this data' })).toHaveTextContent('more than one session old')
})
test('P7: a weekend does not make the Saturday build stale on Monday morning', () => {
  render(<DataReceipt snapshotDate="2026-10-10" now={Date.parse('2026-10-12T08:00:00-04:00')} />)
  expect(screen.getByRole('button', { name: /Oct 9 close/ })).not.toHaveTextContent('stale')
})

// The live overlay (query.py live_screen_state): 14:47 ET on Thu 2026-10-15 = 18:47Z.
const liveAt = (iso, columns = ['price', 'chg_pct_1d', 'gap_pct']) =>
  ({ state: 'live', as_of: Date.parse(iso) / 1000, columns })
const thuAfternoon = Date.parse('2026-10-15T14:50:00-04:00')

test('live: the button leads with the live time, and a fresh nightly adds nothing', () => {
  render(<DataReceipt snapshotDate="2026-10-15" live={liveAt('2026-10-15T14:47:00-04:00')} now={thuAfternoon} />)
  const btn = screen.getByRole('button', { name: /^Live · 2:47 PM/ })
  expect(btn).not.toHaveTextContent('stale')
  expect(btn).not.toHaveTextContent('close')
  expect(btn).not.toHaveTextContent('nightly')
})
test('live: an overdue nightly is named in amber after the live time, never as "stale" for the whole screen', () => {
  render(<DataReceipt snapshotDate="2026-10-14" live={liveAt('2026-10-15T14:47:00-04:00')} now={thuAfternoon} />)
  const btn = screen.getByRole('button', { name: /Live · 2:47 PM · nightly Oct 13/ })
  expect(btn).not.toHaveTextContent('stale')
  expect(btn.querySelector('[class*="staleTag"]')).toHaveTextContent('nightly Oct 13')
  fireEvent.click(btn)
  const region = screen.getByRole('region', { name: 'About this data' })
  expect(region).toHaveTextContent('Live, updated 2:47 PM ET: Price, Change today, Gap')
  expect(region).toHaveTextContent('is from the Oct 13 close')
  expect(region).toHaveTextContent('nightly update has not landed')
})
test('control: a screen with no live rows keeps the nightly label it always had', () => {
  render(<DataReceipt snapshotDate="2026-10-14" live={{ state: 'nightly', columns: [] }} now={thuAfternoon} />)
  expect(screen.getByRole('button', { name: /Oct 13 close · stale/ })).not.toHaveTextContent('Live')
})
test('live with no reported time says Live and invents no clock', () => {
  render(<DataReceipt snapshotDate="2026-10-15" live={{ state: 'live', as_of: null, columns: ['price'] }} now={thuAfternoon} />)
  const btn = screen.getByRole('button', { name: /^Live/ })
  expect(btn.textContent).not.toMatch(/\d:\d\d/)
})
