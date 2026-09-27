// Wave 8 final review, fix I-2, end to end: the REAL Notebook, with onboarding on and a
// member the tour is for, whose tour chunk cannot be loaded. Before the fix the tour rode
// `lazyChunk` in a bare <Suspense>: its failure reloaded the page (offline: the browser's
// offline page) or, with the session's reload spent, replaced the Notebook with the route's
// error screen. Now the Notebook stays, and nothing reloads.
//
// The chunk's failure is the module itself refusing to load (vi.mock's factory throws), so
// the gate's real `import('./NotebookTour')` is what rejects -- nothing here stubs the gate.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../components/notebook/onboarding/NotebookTour', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/NotebookTour-abc123.js')
})

import NotebookTab from './NotebookTab'
import { installFetch, latchWave8Flags, Providers } from '../a11y/fixtures'
import { RELOAD_FLAG } from '../../../utils/lazyWithRetry'

const realLocation = window.location
let errorSpy

beforeEach(() => {
  // a member with no notes at all: the first-run screen, the one the tour is for
  installFetch([[/^\/api\/j2\/notes$/, { notes: [], total: 0 }]])
  latchWave8Flags(true)
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, reload: vi.fn(), href: String(realLocation.href) },
  })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
  errorSpy.mockRestore()
})

describe('the Notebook survives a tour chunk that cannot load', () => {
  it('the first-run screen stays, and the page is never reloaded', async () => {
    render(<Providers route="/journal/notebook"><NotebookTab /></Providers>)
    expect(await screen.findByRole('heading', { name: 'Welcome to your Notebook' })).toBeInTheDocument()
    // the gate asked for the chunk (the tour is for this member) and its boundary caught the failure
    await waitFor(() => expect(errorSpy.mock.calls.some(([m]) => String(m).includes('[NotebookTourGate]'))).toBe(true))
    // ...and the Notebook is still there, doors and all
    expect(screen.getByRole('heading', { name: 'Welcome to your Notebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start a note/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.reload).not.toHaveBeenCalled()
  })
})
