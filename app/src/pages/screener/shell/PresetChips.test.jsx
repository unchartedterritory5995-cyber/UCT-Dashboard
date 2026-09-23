import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const starters = [
  { id: 's1', name: 'Leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }], view: 'overview' } },
  { id: 's2', name: 'Tight bases', spec: { filters: [{ key: 'base_structure', op: 'contains', value: ',tight,' }], view: 'bases' } },
]
vi.mock('../hooks/useSavedScreens', () => ({ default: () => ({ starters }) }))

// Real parsePref (PresetChips imports it), stubbed hook body.
let prefsValue = {}
const setPrefMerged = vi.fn()
vi.mock('../../../hooks/usePreferences', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, default: () => ({ prefs: prefsValue, setPrefMerged, setPref: vi.fn(), loading: false }) }
})

import PresetChips from './PresetChips'

beforeEach(() => { prefsValue = {}; setPrefMerged.mockClear() })

describe('PresetChips', () => {
  it('shows a chip per starter (all, when nothing is chosen) and applies on click', () => {
    const onApply = vi.fn()
    render(<PresetChips currentSpec={{ filters: [] }} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leaders' }))
    expect(onApply).toHaveBeenCalledWith(starters[0].spec)
    expect(screen.getByRole('button', { name: 'Tight bases' })).toBeInTheDocument()
  })

  it('marks a chip active when its conditions are on screen — POOL-BLIND', () => {
    const currentSpec = { filters: [
      { key: 'rs_rank', op: 'gte', min: 90 },
      { key: 'universe', op: 'eq', value: 'uct' },
    ], view: 'overview' }
    render(<PresetChips currentSpec={currentSpec} onApply={() => {}} />)
    expect(screen.getByRole('button', { name: 'Leaders' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tight bases' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows ONLY the chosen chips when a selection is saved', () => {
    prefsValue = { screener_preset_chips: JSON.stringify(['s1']) }
    render(<PresetChips currentSpec={{ filters: [] }} onApply={() => {}} />)
    expect(screen.getByRole('button', { name: 'Leaders' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tight bases' })).toBeNull()
  })

  it('the Edit popover toggles a scan in/out via the preference', () => {
    render(<PresetChips currentSpec={{ filters: [] }} onApply={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Choose which preset scans show/ }))
    // both listed as checkboxes; toggling one writes the preference
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tight bases' }))
    expect(setPrefMerged).toHaveBeenCalledWith('screener_preset_chips', expect.any(Function))
  })
})
