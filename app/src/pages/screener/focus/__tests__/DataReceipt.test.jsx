import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test } from 'vitest'
import DataReceipt from '../DataReceipt'

// 2026-10-14 is a Wednesday; ET is UTC-4 in October.
const wedEvening = Date.parse('2026-10-14T17:00:00-04:00')
test('P7: a snapshot one session behind reads plainly', () => {
  render(<DataReceipt snapshotDate="2026-10-13" now={wedEvening} />)
  expect(screen.getByRole('button', { name: /Oct 13 close/ })).not.toHaveTextContent('stale')
})
test('P7: a snapshot more than one session old is amber and says stale', () => {
  render(<DataReceipt snapshotDate="2026-10-12" now={wedEvening} />)
  const btn = screen.getByRole('button', { name: /Oct 12 close · stale/ })
  expect(btn.querySelector('[class*="staleTag"]')).not.toBeNull()
  fireEvent.click(btn)
  expect(screen.getByRole('region', { name: 'About this data' })).toHaveTextContent('more than one session old')
})
test('P7: a weekend does not make Friday stale on Monday morning', () => {
  render(<DataReceipt snapshotDate="2026-10-09" now={Date.parse('2026-10-12T08:00:00-04:00')} />)
  expect(screen.getByRole('button', { name: /Oct 9 close/ })).not.toHaveTextContent('stale')
})
