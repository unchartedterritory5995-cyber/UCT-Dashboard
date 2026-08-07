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

// ⚠️ THE LABEL IS READ OUT OF `SCANS`, NOT TYPED. `6e974ef7` renamed the volume
// presets ("Highest Volume (1-Year)" -> "Highest Volume In 1-Year (HV1)") and left
// this test asserting the OLD name, so it went red on master the moment it landed.
// A typed display string is a second authority over a label the picker already
// owns; deriving it means the next rename moves the test with the source instead
// of against it. The KEY stays typed on purpose — `highest-volume-1y` is the wire
// contract with `/api/scans/highest-volume-1y`, and a rename of THAT must fail here.
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
