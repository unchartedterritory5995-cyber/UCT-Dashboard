// Wave 8 (Task 8.15): the builder at 390 px. The preview is a one-line sticky summary that opens on tap and is not
// drawn while the keyboard is open, and a picker pushes in place inside the ONE sheet (never a second one).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS, KEYBOARD_RATIO } from './WidgetBuilderSheet'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer, payload } from './__fixtures__/builderFixtures'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => true, useIsTouch: () => true, useIsTablet: () => false, useIsDesktop: () => false,
  useHasCoarsePointer: () => true, useHasNoHover: () => true,
}))

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

/** A visualViewport the test can resize (jsdom has none). */
function installViewport(height) {
  const listeners = new Set()
  const vv = {
    height,
    addEventListener: (type, fn) => { if (type === 'resize') listeners.add(fn) },
    removeEventListener: (type, fn) => listeners.delete(fn),
    resize(h) { this.height = h; listeners.forEach((fn) => fn()) },
  }
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
  return vv
}

let vv
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ routes } = installFetch())
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  vv = installViewport(844)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.visualViewport
})

async function openBuilder() {
  const onClose = vi.fn()
  render(<WidgetBuilderSheet uid="u1" onClose={onClose} />)
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
  return { onClose }
}

describe('WidgetBuilderSheet at 390 px', () => {
  it('the sticky summary reads "<name> · <count> trades · <first value>" and opens the preview', async () => {
    await openBuilder()
    const bar = screen.getByTestId('builder-summary-bar')
    expect(bar).toHaveTextContent('Net P&L, last 90 days · 47 trades · +$2,140.00')
    expect(bar).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('builder-preview-view')).toBeNull()
    expect(screen.queryByTestId('builder-preview')).toBeNull()       // no side pane on a phone
    fireEvent.click(bar)
    expect(bar).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('builder-preview-view')).toBeInTheDocument()
  })

  it('the summary hides while the keyboard is open', async () => {
    await openBuilder()
    expect(screen.getByTestId('builder-summary-bar')).toBeInTheDocument()
    act(() => vv.resize(Math.floor(844 * KEYBOARD_RATIO) - 1))       // the keyboard takes the bottom of the screen
    expect(screen.queryByTestId('builder-summary-bar')).toBeNull()
    expect(screen.getByTestId('builder-phone-preview')).not.toBeVisible()
    // The live region stays outside the hidden part: it can still speak.
    expect(screen.getByTestId('builder-live')).toBeVisible()
    act(() => vv.resize(844))
    expect(screen.getByTestId('builder-summary-bar')).toBeInTheDocument()
  })

  it('I-3a: the Android shape (resizes-content: the WINDOW shrinks too) also reads as the keyboard open', async () => {
    await openBuilder()
    expect(screen.getByTestId('builder-summary-bar')).toBeInTheDocument()
    act(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
      vv.height = 400
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.queryByTestId('builder-summary-bar')).toBeNull()
    act(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
      vv.resize(844)
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('builder-summary-bar')).toBeInTheDocument()
  })

  it('I-3b: the panel carries the visual viewport height (--vvh) and the keyboard inset (--vv-inset)', async () => {
    await openBuilder()
    const panel = document.querySelector('[data-sheet-panel]')
    expect(panel.style.getPropertyValue('--vvh')).toBe('844px')
    expect(panel.style.getPropertyValue('--vv-inset')).toBe('0px')
    act(() => vv.resize(500))                                       // iOS: the window stays, the keyboard covers 344
    expect(panel.style.getPropertyValue('--vvh')).toBe('500px')
    expect(panel.style.getPropertyValue('--vv-inset')).toBe('344px')
  })

  it('I-4: on sample data the sticky summary starts "Sample data ·"', async () => {
    routes.unshift(['POST', (u) => u.endsWith('/preview'), () => answer(payload({ sample: true }))])
    await openBuilder()
    expect(screen.getByTestId('builder-summary-bar')).toHaveTextContent(/^Sample data · Net P&L, last 90 days · 47 trades/)
  })

  it('a picker pushes in place: exactly one sheet in the DOM, with a Back control', async () => {
    await openBuilder()
    expect(document.querySelectorAll('[data-sheet-panel]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    expect(screen.getByRole('heading', { name: 'Date range' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-sheet-panel]')).toHaveLength(1)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    // The sections are still there, only hidden, so Back returns to the very control that opened the picker.
    expect(screen.queryByRole('heading', { name: 'Which ones' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back to the widget/ }))
    expect(screen.getByRole('heading', { name: 'Which ones' })).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Date range/ }))
    // A deeper picker (a filter's values) is still the same one sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    await flush()
    expect(document.querySelectorAll('[data-sheet-panel]')).toHaveLength(1)
  })
})
