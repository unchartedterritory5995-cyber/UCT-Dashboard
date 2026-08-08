import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import ScannerWidget from './ScannerWidget'
import { PRESET_SCANS } from './ScannerPicker'

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

// ⚠️ THE LABEL IS READ OUT OF `PRESET_SCANS`, NOT TYPED — and the history is the
// argument. That preset was named "Highest Volume (1-Year)", then "Highest Volume
// In 1-Year (HV1)" (`6e974ef7`), then "Highest Volume In 1-Year" (`f2700efa`) —
// THREE names in one evening. A typed assertion went red on master twice, and both
// times the repair was to retype the new string, which reloads the trap for the
// next rename. The picker owns the display copy; a test that retypes it is a second
// authority over one label.
//
// Resolved at the merge in favour of deriving. The KEY stays typed ON PURPOSE:
// `highest-volume-1y` is the wire contract with `/api/scans/highest-volume-1y`, so
// a silent rename of THAT must fail here — `name` and `key` are different kinds of
// thing and this test now treats them differently.
test('lists the first volume preset and selecting it sets scanKey', () => {
  const preset = PRESET_SCANS.find(s => s.key === 'highest-volume-1y')
  expect(preset, 'no highest-volume-1y preset in PRESET_SCANS — this test has no subject').toBeTruthy()
  const onOptsChange = vi.fn()
  render(<ScannerWidget opts={{}} onOptsChange={onOptsChange} />)
  const row = screen.getByRole('button', { name: new RegExp(preset.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
  expect(row).toBeInTheDocument()
  fireEvent.click(row)
  expect(onOptsChange).toHaveBeenCalledWith(
    expect.objectContaining({ scanKey: 'highest-volume-1y', scanName: preset.name }),
  )
})
