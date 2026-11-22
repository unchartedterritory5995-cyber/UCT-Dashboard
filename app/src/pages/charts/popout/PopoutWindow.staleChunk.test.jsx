// A stale chunk failing inside a popped-out window must not take the window down.
// Real PopoutWindow + real RouteErrorBoundary + a lazy child whose import fails.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PopoutWindow, { __resetAppClosingForTests } from './PopoutWindow'
import RouteErrorBoundary from '../../../components/RouteErrorBoundary'
import lazyWithRetry, { lazyDeferrable } from '../../../utils/lazyWithRetry'
import { hasOpenPopouts } from '../../../lib/popoutRegistry'
import { __resetReloadGuardForTests, isUpdateAnnounced } from '../../../lib/reloadGuard'

vi.mock('../../../components/AppErrorFallback', () => ({ default: () => <div data-testid="fallback">error screen</div> }))

function makeFakeWindow() {
  const doc = document.implementation.createHTMLDocument('popup')
  const listeners = {}
  return {
    document: doc,
    closed: false,
    KeyboardEvent: window.KeyboardEvent,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn) },
    history: { replaceState: vi.fn() },
    close: vi.fn(function () { this.closed = true }),
  }
}

const MESSAGES = [
  'Failed to fetch dynamically imported module: /assets/x.js',
  'Unable to preload CSS for /assets/x.css',
  "Expected a JavaScript module script but the server responded with a MIME type of 'text/html'",
]

let fake
let openSpy
beforeEach(() => {
  __resetReloadGuardForTests()
  fake = makeFakeWindow()
  openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  __resetAppClosingForTests()
})

describe.each([['lazyWithRetry', lazyWithRetry], ['lazyDeferrable', lazyDeferrable]])('%s inside a popped window', (_name, make) => {
  it.each(MESSAGES)('keeps the window open and shows the stub: %s', async (msg) => {
    const Child = make(() => Promise.reject(new Error(msg)))
    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <PopoutWindow onClose={() => {}}>
            <Suspense fallback="loading"><Child /></Suspense>
          </PopoutWindow>
        </RouteErrorBoundary>
      </MemoryRouter>,
    )
    await waitFor(() => expect(fake.document.querySelector('[data-testid="update-required-notice"]')).not.toBeNull())
    expect(hasOpenPopouts()).toBe(true)
    expect(fake.closed).toBe(false)
    expect(fake.close).not.toHaveBeenCalled()
    expect(screen.queryByTestId('fallback')).toBeNull()
    expect(isUpdateAnnounced()).toBe(true)
  })
})

describe('control: no pop-out open, lazyDeferrable rethrows to the boundary', () => {
  it('shows the error screen exactly as plain lazy() would', async () => {
    const Child = lazyDeferrable(() => Promise.reject(new Error(MESSAGES[0])))
    render(
      <MemoryRouter>
        <RouteErrorBoundary><Suspense fallback="loading"><Child /></Suspense></RouteErrorBoundary>
      </MemoryRouter>,
    )
    await screen.findByTestId('fallback')
    expect(openSpy).not.toHaveBeenCalled()
  })
})
