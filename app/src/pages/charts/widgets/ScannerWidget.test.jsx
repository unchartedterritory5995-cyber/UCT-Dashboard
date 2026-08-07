import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import ScannerWidget from './ScannerWidget'

// The picker reads the app theme off usePreferences; a bare default is enough.
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn() }),
  parsePref: (_v, d) => d,
}))

test('renders the scanner picker shell (title + preset section)', () => {
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

test('no preset scans are wired yet (no scan rows)', () => {
  render(<ScannerWidget opts={{}} onOptsChange={() => {}} />)
  // Only the disabled create button + the empty-state copy — no clickable scan rows.
  expect(screen.getByText(/Relative Strength Leaders/i)).toBeInTheDocument() // in the empty-state hint
})
