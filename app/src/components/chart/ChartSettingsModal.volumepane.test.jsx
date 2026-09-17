import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { listIndicators, VOLUME_PANE_SURFACE_FIXED } from './indicatorRegistry'
import { mergeChartSettings } from './chartDefaults'

// The charts workspace + the multi-chart grid pass StockChart's `volumeSeparatePane`
// and `volumePaneHeightPct`, and those props WIN over volume.separatePane /
// volume.paneHeightPct (StockChart ORs the flag and prefers the prop for the height).
// That forcing is deliberate — the workspace recipe tunes its price-scale margins for
// a separate pane, and its height comes from DRAGGING the separator into the
// charts_vol_pane_pct pref, not from this slider. So the contract those surfaces get
// is: the control is INERT AND SAYS SO. A silently-dead toggle is the one outcome
// these tests exist to prevent.

const settings = () => mergeChartSettings(JSON.stringify({ volume: { visible: true, separatePane: false } }))
const paneToggle = () => screen.getByRole('switch', { name: 'Separate pane' })

/** Open the tab AND select the volume row.
 *
 *  ⚰️ `openIndicators()` USED TO BE ENOUGH, because the tab rendered every row's
 *  fields at once. Then the tab collapsed to one row at a time and this clicked the
 *  row's own `aria-expanded` EXPANDER, because the form opened underneath it.
 *
 *  ⚰️⚰️ AND NOW THERE IS NO EXPANDER, because there is no accordion. The
 *  Inspector puts the form in the RIGHT COLUMN and the row's one interaction is
 *  CLICK TO SELECT — so the gesture is a click on the row itself. The CLAIMS below
 *  are untouched, twice over; only the gesture that reaches the control changed.
 *
 *  ⛔ AND IT IS STILL NOT A SHORTCUT PAST THE UI. Selecting through the row a
 *  member clicks is what a member does; a harness that rendered the fields some
 *  other way would pass over a tab whose only door was broken. */
const openIndicators = () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
  const volumeRow = document.body.querySelector('[data-row-id="volume"][data-structure-row]')
  expect(volumeRow, 'the volume pane is not in the ACTIVE list — it is always drawn').toBeTruthy()
  fireEvent.click(volumeRow)
}

describe('ChartSettingsModal — volume separate-pane on a surface that fixes it', () => {
  it('is live on a normal surface: clicking it writes volume.separatePane', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={settings()} onChange={onChange} />)
    openIndicators()

    expect(paneToggle()).not.toBeDisabled()
    fireEvent.click(paneToggle())
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)[0].volume.separatePane).toBe(true)
  })

  it('renders inert — and writes nothing — when the surface fixes the pane', () => {
    const onChange = vi.fn()
    render(
      <ChartSettingsModal
        open
        settings={settings()}
        onChange={onChange}
        volumePaneFixed={VOLUME_PANE_SURFACE_FIXED}
      />,
    )
    openIndicators()

    // Inert...
    expect(paneToggle()).toBeDisabled()
    // ...and the reason is on the control, not just implied by the grey.
    expect(paneToggle()).toHaveAttribute('title', VOLUME_PANE_SURFACE_FIXED)

    // The whole point: a click here must NOT persist a pref the chart will ignore.
    fireEvent.click(paneToggle())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('scopes the lock to volume — the other indicator toggles stay live', () => {
    const onChange = vi.fn()
    render(
      <ChartSettingsModal
        open
        settings={settings()}
        onChange={onChange}
        volumePaneFixed={VOLUME_PANE_SURFACE_FIXED}
      />,
    )
    openIndicators()

    const hvc = screen.getByRole('switch', { name: 'Highlight 52W volume highs' })
    expect(hvc).not.toBeDisabled()
    fireEvent.click(hvc)
    expect(onChange).toHaveBeenCalled()
  })
})

describe('indicatorRegistry — volumePaneFixed', () => {
  const volumeFields = (opts) =>
    listIndicators(settings(), opts).find((r) => r.id === 'volume').fields
  const field = (opts, key) => volumeFields(opts).find((f) => f.key === key)

  it('leaves separatePane live by default', () => {
    expect(field(undefined, 'separatePane').disabled).toBeUndefined()
  })

  it('marks separatePane disabled with the reason when asked', () => {
    expect(field({ volumePaneFixed: 'because' }, 'separatePane').disabled).toBe('because')
  })

  it('does not mutate the shared VOLUME_FIELDS constant', () => {
    // A naive in-place flag would leak the lock into every OTHER surface's modal
    // for the rest of the session (the descriptors are module-level constants).
    listIndicators(settings(), { volumePaneFixed: 'because' })
    expect(field(undefined, 'separatePane').disabled).toBeUndefined()
  })
})
