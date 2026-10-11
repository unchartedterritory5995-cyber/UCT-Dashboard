// app/src/components/chart/ChartSettingsModal.escape.test.jsx
//
// ─── ESCAPE IN A NAME FIELD CANCELS THE FIELD, NOT THE WHOLE MODAL ───────────
//
// The modal closes on Escape through a `window` keydown listener. A name field inside
// it (Templates → Save as Template, Indicators → Indicator templates → Save…) handles
// Escape itself — "cancel naming" — and calls `preventDefault()`. Before 2026-10-11 the
// window listener ignored that and closed Chart Settings too, so a member backing out of
// naming a template lost the whole panel. A handled Escape is now left alone.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => ({ rows: [], isLoading: false, error: null, refresh: () => {} }),
  useInstalledUserDefinitions: () => ({ installedIds: [], errors: [], generation: 0, isLoading: false, error: null }),
}))
vi.mock('../../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    default: () => ({ prefs: {}, setPref: vi.fn(async () => ({ ok: true })), setPrefMerged: vi.fn(async () => ({ ok: true })), isLoading: false }),
  }
})

const { default: ChartSettingsModal } = await import('./ChartSettingsModal')
const { mergeChartSettings } = await import('./chartDefaults')

afterEach(() => { cleanup() })

describe('Escape inside a template name field', () => {
  it('cancels naming and leaves Chart Settings open', () => {
    const onClose = vi.fn()
    render(<ChartSettingsModal open settings={mergeChartSettings(null)} onChange={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByTitle('Save the current chart settings as a reusable template'))
    const input = screen.getByLabelText('Template name')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('Template name')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('CONTROL — an unhandled Escape still closes it', () => {
    const onClose = vi.fn()
    render(<ChartSettingsModal open settings={mergeChartSettings(null)} onChange={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
