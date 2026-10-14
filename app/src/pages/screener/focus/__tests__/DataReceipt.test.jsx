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
