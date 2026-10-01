// app/src/components/chart/__tests__/volumeProfileAdd.test.jsx
//
// ⛔⛔ VOLUME PROFILE "+ Add" FROM THE ADD-INDICATOR DOOR (2026-10-01).
//
// Volume Profile is a CARVED-OUT canvas overlay: it has no engine definition, and
// its existence IS its settings slice (`cs.indicators.volumeProfile.enabled`).
// `ChartSettingsIndicators.addRow` routed every non-built-in row to
// `addInstance`, which refuses an id with no definition by returning the blob
// unchanged — so clicking + Add on Volume Profile did nothing at all. The fix
// routes a carved-out row through `toggledRow`, its own existing writer.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import ChartSettingsModal from '../ChartSettingsModal'
import { mergeChartSettings } from '../chartDefaults'

function Host({ initial, seen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open settings={cs}
      onChange={(next) => { seen.cs = next; setCs(next) }}
      onClose={() => {}}
    />
  )
}

afterEach(() => cleanup())

describe('Volume Profile + Add', () => {
  it('turns the canvas overlay ON through its own settings slice', () => {
    const seen = { cs: null }
    const start = mergeChartSettings(JSON.stringify({}))
    expect(start.indicators.volumeProfile.enabled, 'precondition: off by default').toBe(false)
    render(<Host initial={start} seen={seen} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'volume profile' } })
    const row = screen.getAllByRole('option').find((o) => /Volume Profile/.test(o.textContent))
    expect(row, 'Volume Profile is not offered').toBeTruthy()
    fireEvent.click(row)
    expect(seen.cs, 'the click wrote nothing').toBeTruthy()
    expect(seen.cs.indicators.volumeProfile.enabled).toBe(true)
    // ⛔ and it did NOT become an engine instance — it stays a canvas overlay.
    expect((seen.cs.indicatorInstances || []).some((i) => i && i.defId === 'volumeProfile')).toBe(false)
  })
})
