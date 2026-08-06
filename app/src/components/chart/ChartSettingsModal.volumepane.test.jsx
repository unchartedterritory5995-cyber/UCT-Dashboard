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
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))

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
