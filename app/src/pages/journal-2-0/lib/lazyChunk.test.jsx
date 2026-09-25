// Wave 7 lane I, fix round 1 (review M-5): the Notebook's on-demand views retry a failed chunk
// once in place, and only a SECOND failure reaches the app's stale-chunk reload.
//
// Location mocking follows StalledLoadFallback.test.jsx: under vitest's jsdom environment
// `window.location` is a configurable property of the global, so it is swapped and restored.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import lazyChunk, { importWithOneRetry } from './lazyChunk'
import { RELOAD_FLAG } from '../../../utils/lazyWithRetry'

const realLocation = window.location
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/NoteGraphView-abc123.js')

beforeEach(() => {
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, reload: vi.fn(), href: String(realLocation.href) },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
})

describe('importWithOneRetry', () => {
  it('asks again after one failed fetch, and returns the module the second ask brings', async () => {
    const mod = { default: () => null }
    const load = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce(mod)
    await expect(importWithOneRetry(load, 0)).resolves.toBe(mod)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not retry an error that is not a failed fetch', async () => {
    const load = vi.fn().mockRejectedValue(new ReferenceError('boom in the module body'))
    await expect(importWithOneRetry(load, 0)).rejects.toThrow('boom in the module body')
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('lazyChunk (a Notebook view, rendered)', () => {
  it('one failed import followed by success renders the view with NO page reload', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValueOnce({ default: () => <p>graph view</p> })
    const View = lazyChunk(load, 0)
    render(<Suspense fallback={<p>loading</p>}><View /></Suspense>)
    expect(await screen.findByText('graph view')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('two failed imports (a deploy since the tab loaded) hand over to the one-per-session reload', async () => {
    const load = vi.fn().mockRejectedValue(chunkError())
    const View = lazyChunk(load, 0)
    render(<Suspense fallback={<p>loading</p>}><View /></Suspense>)
    await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1))
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByText('loading')).toBeTruthy() // held on the fallback until the reload lands
  })
})
