import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ScannerWidget from './ScannerWidget'

// The picker reads the app theme off usePreferences; a bare default is enough.
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn() }),
  parsePref: (_v, d) => d,
}))
// These picker tests never open a scan, so stub the heavy Watchlists table that
// ScannerResults pulls in (keeps the test focused + fast).
vi.mock('../../Watchlists', () => ({ default: () => null }))

test('renders the scanner picker (title + preset section)', () => {
  render(<ScannerWidget opts={{}} onOptsChange={() => {}} />)
  expect(screen.getByText('Add a Scanner')).toBeInTheDocument()
  expect(screen.getByText('Preset Scanners')).toBeInTheDocument()
})

test('"Create your own scan" is present but disabled', () => {
  render(<ScannerWidget opts={{}} onOptsChange={() => {}} />)
  const btn = screen.getByRole('button', { name: /create your own scan/i })
  expect(btn).toBeInTheDocument()
  expect(btn).toBeDisabled()
})

test('exposes a settings gear', () => {
  render(<ScannerWidget opts={{}} onOptsChange={() => {}} />)
  expect(screen.getByTitle('Scanner settings')).toBeInTheDocument()
})

test('lists the Highest Volume (1-Year) preset and selecting it sets scanKey', () => {
  const onOptsChange = vi.fn()
  render(<ScannerWidget opts={{}} onOptsChange={onOptsChange} />)
  const row = screen.getByRole('button', { name: /highest volume \(1-year\)/i })
  expect(row).toBeInTheDocument()
  fireEvent.click(row)
  expect(onOptsChange).toHaveBeenCalledWith(
    expect.objectContaining({ scanKey: 'highest-volume-1y', scanName: 'Highest Volume (1-Year)' }),
  )
})
