/* CREATE INDICATOR IS THE FIRST ROW OF THE PHONE'S INDICATORS SHEET (Studio plan H2 / X1).
 *
 * Measured on production 2026-11-17: on a phone, creating an indicator was three taps deep and
 * below the fold (this sheet, scroll to "More", "Browse indicator library…", Create Indicator).
 * The desktop Indicators window has "Create indicator" in its header; this sheet now leads with it.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import MobileIndicatorSheet from './MobileIndicatorSheet'
import APP_SRC from './MobileChartsApp.jsx?raw'

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function renderSheet(props = {}) {
  const onClose = vi.fn()
  render(
    <MobileIndicatorSheet open onClose={onClose} cs={{}} onWrite={vi.fn()}
      onBrowseLibrary={vi.fn()} onOpenSettings={vi.fn()} {...props} />,
  )
  return { onClose }
}

describe('Create indicator on the phone sheet', () => {
  it('is the first row, above the moving averages', () => {
    renderSheet({ onCreateIndicator: vi.fn() })
    const row = screen.getByTestId('mobile-create-indicator')
    expect(row.textContent).toContain('Create indicator')
    const first = screen.getByText('Moving averages')
    expect(row.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons.indexOf(row)).toBeLessThan(buttons.indexOf(screen.getByText('Browse indicator library…').closest('button')))
  })

  it('one tap closes the sheet and opens the door, once each', async () => {
    const onCreateIndicator = vi.fn()
    const { onClose } = renderSheet({ onCreateIndicator })
    await userEvent.click(screen.getByTestId('mobile-create-indicator'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreateIndicator).toHaveBeenCalledTimes(1)
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onCreateIndicator.mock.invocationCallOrder[0])
  })

  it('CONTROL: a host with no such door shows no row, and the rest of the sheet is as it was', () => {
    renderSheet()
    expect(screen.queryByTestId('mobile-create-indicator')).toBeNull()
    expect(screen.getByText('Moving averages')).toBeTruthy()
    expect(screen.getByText('Browse indicator library…')).toBeTruthy()
  })

  it('the phone shell gives it the chart’s own Create Indicator door, and the library where that does not open (source rail)', () => {
    const a = code(APP_SRC)
    expect(a).toMatch(/opened = toolbarApiRef\.current\?\.openCreateIndicator\?\.\(\) === true/)
    expect(a).toMatch(/if \(!opened\) toolbarApiRef\.current\?\.openIndicatorLibrary\?\.\(\)/)
    expect(a).toMatch(/onCreateIndicator=\{createIndicator\}/)
  })
})
