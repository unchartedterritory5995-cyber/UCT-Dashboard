// ─── THE SECOND MARKER-TOGGLE SURFACE ────────────────────────────────────────
//
// `cs.markers.*` is written from TWO places: ChartSettingsModal's Markers tab
// (covered by ChartSettingsModal.markers.test.jsx) and this toolbar's inline
// settings panel, whose checkboxes are hand-written one per category. Adding a
// category to only one of them ships a toggle the user cannot find from wherever
// they happen to open settings — which is exactly what the Desk-mention category
// did until review caught it (the modal's list-driven row was added; this panel's
// hand-written row was not).
//
// So the first test here is a PARITY test derived from the modal's own list, not a
// retyped copy of it: a future category added to EVENT_MARKERS and forgotten here
// reds automatically. The rest assert the write contract each checkbox owes.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { AuthContext } from '../../context/AuthContext'
import ChartToolbar from './ChartToolbar'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// The one thing this file may restate: the two surfaces word two categories
// differently, so a modal label has to be translated to a toolbar label. The SET of
// categories is never restated — it is read off the rendered modal below, so a new
// one appears here automatically and reds if this panel didn't get it.
const TOOLBAR_LABEL = {
  Earnings: 'Earnings',
  Splits: 'Splits',
  Dividends: 'Dividends',
  News: 'News markers',
  'Desk mentions': 'Desk mentions',
}

const mount = (onUpdateSettings, initial = mergeChartSettings(JSON.stringify({}))) => {
  function Harness() {
    const [cs, setCs] = useState(initial)
    return (
      <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
        <ChartToolbar activeTool="cursor" setActiveTool={() => {}}
          chartSettings={cs}
          onUpdateSettings={(next) => { onUpdateSettings(next); setCs(next) }} />
      </AuthContext.Provider>
    )
  }
  const r = render(<Harness />)
  fireEvent.click(screen.getByTitle('Chart Settings'))
  return r
}
const box = (label) => screen.getByLabelText(label)
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]

describe('ChartToolbar — the inline panel\'s marker checkboxes', () => {
  it('offers every category the settings modal offers (no surface drifts behind)', () => {
    // Derive the category set from the MODAL ITSELF — render it, open its Markers tab
    // and read the Event-markers section's switches. A hand-typed copy of that list
    // would agree with nothing; this reds the moment a category exists in one surface
    // and not the other, which is the defect the review found.
    render(<ChartSettingsModal open settings={mergeChartSettings(JSON.stringify({}))} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Markers' }))
    const section = screen.getByText('Event markers').parentElement
    const modalLabels = within(section).getAllByRole('switch').map(s => s.getAttribute('aria-label'))
    expect(modalLabels.length).toBeGreaterThanOrEqual(5)   // the extraction found rows
    expect(modalLabels).toContain('Desk mentions')         // …including the new one
    cleanup()

    mount(vi.fn())
    for (const label of modalLabels) {
      const mapped = TOOLBAR_LABEL[label]
      expect(mapped, `the modal offers "${label}" but no toolbar label is mapped for it`).toBeTruthy()
      expect(box(mapped), `"${label}" is missing from the toolbar's marker panel`).toBeTruthy()
    }
  })

  it('Desk mentions is unchecked by default and writes markers.desk without disturbing siblings', () => {
    const onChange = vi.fn()
    mount(onChange)
    const cb = box('Desk mentions')
    expect(cb.checked).toBe(false)          // opt-in, like News

    fireEvent.click(cb)
    const next = lastCall(onChange)
    expect(next.markers.desk).toBe(true)
    expect(next.markers.news).toBe(false)       // sibling intact
    expect(next.markers.earnings).toBe(false)   // sibling intact
    expect(next.preset).toBe('custom')
  })

  it('a saved markers.desk renders checked here too, and un-checks back to false', () => {
    const onChange = vi.fn()
    mount(onChange, mergeChartSettings(JSON.stringify({ markers: { desk: true } })))
    const cb = box('Desk mentions')
    expect(cb.checked).toBe(true)
    fireEvent.click(cb)
    expect(lastCall(onChange).markers.desk).toBe(false)
  })

  it('the pre-existing categories still write their own key', () => {
    const onChange = vi.fn()
    mount(onChange)
    fireEvent.click(box('Earnings'))
    expect(lastCall(onChange).markers.earnings).toBe(true)
    expect(lastCall(onChange).markers.desk ?? false).toBe(false)
  })
})
