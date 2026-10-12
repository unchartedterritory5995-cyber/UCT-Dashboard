import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import lazyChunk, { chunkRetry } from '../../../lib/lazyChunk'
import { RELOAD_FLAG } from '../../../../../utils/lazyWithRetry'
import { loadStyle } from './lazyStyles'

// Notebook P1 round 3 (re-review N-I1): the journal-styles surfaces share ONE module (StyleSurfaces), whose
// pieces are named exports. lazyChunk's in-place retry used to keep a retried module only if it had a
// `default`, so a chunk blip on this module never healed in place and went straight to the page reload (and,
// offline, to the browser's offline page). loadStyle keeps the in-place retry for a named piece.
const realLocation = window.location
const realImportUrl = chunkRetry.importUrl
const ORIGIN = 'https://uctintelligence.com'
const chromeError = () => new TypeError(`Failed to fetch dynamically imported module: ${ORIGIN}/assets/StyleSurfaces-Abc123.js`)

beforeEach(() => {
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, origin: ORIGIN, reload: vi.fn(), href: `${ORIGIN}/journal/notebook` },
  })
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
  chunkRetry.importUrl = realImportUrl
})

const Piece = () => <p>the piece rendered</p>

describe('loadStyle', () => {
  it('a chunk blip is retried in place: the surface renders and the page is NOT reloaded', async () => {
    const load = vi.fn().mockRejectedValue(chromeError())
    chunkRetry.importUrl = vi.fn().mockResolvedValue({ Piece, Other: () => null })
    const Lazy = lazyChunk(() => loadStyle('Piece', load))
    render(<Suspense fallback={<span>loading</span>}><Lazy /></Suspense>)
    expect(await screen.findByText('the piece rendered', {}, { timeout: 5000 })).toBeTruthy()
    expect(chunkRetry.importUrl).toHaveBeenCalledTimes(1)
    expect(new URL(chunkRetry.importUrl.mock.calls[0][0]).pathname).toBe('/assets/StyleSurfaces-Abc123.js')
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('a retried module that does not hold the piece is not guessed at: the original failure stands', async () => {
    const load = vi.fn().mockRejectedValue(chromeError())
    chunkRetry.importUrl = vi.fn().mockResolvedValue({ SomethingElse: Piece })
    await expect(loadStyle('Piece', load)).rejects.toThrow(/Failed to fetch dynamically imported module/)
  })

  // Re-review 2, N-M6: the piece loads through lazyChunk, which retries too. Two layers of retry meant a THIRD
  // fetch whose success was thrown away (the raw module has no `default`) before the page reloaded. One in-place
  // retry in total, then the reload.
  it('N-M6: a failed retry is not asked for again: one in-place retry, then the page reload', async () => {
    const load = vi.fn().mockRejectedValue(chromeError())
    chunkRetry.importUrl = vi.fn()
      .mockRejectedValueOnce(chromeError())
      .mockResolvedValue({ Piece })                       // a THIRD fetch would have succeeded, and been discarded
    const Lazy = lazyChunk(() => loadStyle('Piece', load))
    render(<Suspense fallback={<span>loading</span>}><Lazy /></Suspense>)
    await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1), { timeout: 5000 })
    expect(chunkRetry.importUrl).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('the piece rendered')).toBeNull()
  })

  it('a healthy load resolves the named piece as the default export, with one import', async () => {
    const load = vi.fn().mockResolvedValue({ Piece })
    await expect(loadStyle('Piece', load)).resolves.toEqual({ default: Piece })
    expect(load).toHaveBeenCalledTimes(1)
  })
})
