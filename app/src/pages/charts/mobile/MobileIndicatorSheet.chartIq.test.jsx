/* Chart IQ's touch door. On phones and tablets the desktop toolbar (and its Chart IQ button) is not rendered, so the
 * Indicators sheet carries the switch. It must appear ONLY for a viewer the server allows (auth `chart_iq_enabled`, the same
 * predicate as the toolbar and the route) and write the SAME setting the desktop button writes (`showChartIq`). */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { AuthContext } from '../../../context/AuthContext'
import MobileIndicatorSheet from './MobileIndicatorSheet'

function renderSheet(auth, cs = {}) {
  const onWrite = vi.fn()
  render(
    <AuthContext.Provider value={auth}>
      <MobileIndicatorSheet open onClose={vi.fn()} cs={cs} onWrite={onWrite} onBrowseLibrary={vi.fn()} onOpenSettings={vi.fn()} />
    </AuthContext.Provider>,
  )
  return onWrite
}

const ALLOWED = { user: { id: 'a' }, chartIqEnabled: true }

test('hidden unless the server allows Chart IQ for this viewer', () => {
  renderSheet({ user: { id: 'm' }, chartIqEnabled: false })
  expect(screen.queryByTestId('chart-iq-mobile-toggle')).toBeNull()
})

test('the switch writes the same showChartIq setting as the desktop button, both ways', async () => {
  const onWrite = renderSheet(ALLOWED, { foo: 1 })
  const sw = screen.getByTestId('chart-iq-mobile-toggle')
  expect(sw.getAttribute('aria-checked')).toBe('false')
  await userEvent.click(sw)
  expect(onWrite).toHaveBeenCalledWith({ foo: 1, showChartIq: true, preset: 'custom' })
})

test('shows ON when the setting is on, and switches it off', async () => {
  const onWrite = renderSheet(ALLOWED, { showChartIq: true })
  const sw = screen.getByTestId('chart-iq-mobile-toggle')
  expect(sw.getAttribute('aria-checked')).toBe('true')
  await userEvent.click(sw)
  expect(onWrite).toHaveBeenCalledWith({ showChartIq: false, preset: 'custom' })
})

test('showChartIq survives the settings merge (an undeclared key is dropped, which left the switch stuck OFF)', async () => {
  const { mergeChartSettings } = await import('../../../components/chart/chartDefaults')
  expect(mergeChartSettings({ showChartIq: true }).showChartIq).toBe(true)
  expect('showChartIq' in mergeChartSettings({})).toBe(false)   // off = no key at all: every other chart merges as before
  expect('showChartIq' in mergeChartSettings({ showChartIq: 'yes' })).toBe(false)
})
