// Wave 7 lane I, fix round 1 (review M-5): the Notebook's on-demand views retry a failed chunk
// once in place, and only a SECOND failure reaches the app's stale-chunk reload.
//
// Location mocking follows StalledLoadFallback.test.jsx: under vitest's jsdom environment
// `window.location` is a configurable property of the global, so it is swapped and restored.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Component, Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import lazyChunk, {
  CHUNK_RETRY_PARAM, chunkRetry, failedChunkUrl, importWithOneRetry, lazyLeaf, retrySpecifier,
} from './lazyChunk'
import { RELOAD_FLAG } from '../../../utils/lazyWithRetry'

const realLocation = window.location
const realImportUrl = chunkRetry.importUrl
// Safari names no URL, so its retry is `load()` again -- the path the rails below this block were
// written for. The URL-bearing errors (Chromium, Firefox) take the specifier path (wave-8 walk W7).
const chunkError = () => new TypeError('Importing a module script failed.')
const ORIGIN = 'https://uctintelligence.com'
const chromeError = () => new TypeError(
  `Failed to fetch dynamically imported module: ${ORIGIN}/assets/NoteTasksView-BrXPNdrU.js`)

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
  chunkRetry.importUrl = realImportUrl
})

// ⛔ Wave-8 walk W7: in a real Chromium the retry-by-`load()` made NO second request -- a failed
// dynamic import is remembered for its URL -- and the page reloaded 595 ms later with the chosen
// view lost. The retry now imports the named chunk under a specifier the module map never saw.
describe('the retry specifier (the chunk the error names, under a new query)', () => {
  it('reads the chunk URL out of Chromium’s and Firefox’s messages, same-origin only', () => {
    expect(failedChunkUrl(chromeError(), ORIGIN)?.href).toBe(`${ORIGIN}/assets/NoteTasksView-BrXPNdrU.js`)
    const firefox = new TypeError(`error loading dynamically imported module: ${ORIGIN}/assets/NoteGraphView-x1.js`)
    expect(failedChunkUrl(firefox, ORIGIN)?.pathname).toBe('/assets/NoteGraphView-x1.js')
    const relative = new TypeError('Failed to fetch dynamically imported module: /assets/NoteBoardView-q.js')
    expect(failedChunkUrl(relative, ORIGIN)?.href).toBe(`${ORIGIN}/assets/NoteBoardView-q.js`)
    // no URL (Safari), another origin, and a dev-server .jsx are not retried by specifier
    expect(failedChunkUrl(chunkError(), ORIGIN)).toBeNull()
    expect(failedChunkUrl(new TypeError('Failed to fetch dynamically imported module: https://evil.example/a.js'), ORIGIN)).toBeNull()
    expect(failedChunkUrl(new TypeError('error loading dynamically imported module: http://localhost:5173/src/X.jsx'), 'http://localhost:5173')).toBeNull()
  })

  it('adds a query the module map has never seen, keeping the path', () => {
    const spec = retrySpecifier(chromeError(), 1234, ORIGIN)
    const url = new URL(spec)
    expect(url.pathname).toBe('/assets/NoteTasksView-BrXPNdrU.js')
    expect(url.searchParams.get(CHUNK_RETRY_PARAM)).toBe('1234')
  })
})

describe('importWithOneRetry, when the error names the chunk (Chromium, Firefox)', () => {
  const at = (origin) => Object.defineProperty(window, 'location', {
    configurable: true, value: { ...realLocation, origin, reload: vi.fn(), href: `${origin}/journal/notebook` },
  })

  it('imports the chunk under the retry specifier, and never calls load() a second time', async () => {
    at(ORIGIN)
    const mod = { default: () => null }
    const load = vi.fn().mockRejectedValue(chromeError())
    chunkRetry.importUrl = vi.fn().mockResolvedValue(mod)
    await expect(importWithOneRetry(load, 0)).resolves.toBe(mod)
    expect(load).toHaveBeenCalledTimes(1)
    const [spec] = chunkRetry.importUrl.mock.calls[0]
    expect(new URL(spec).pathname).toBe('/assets/NoteTasksView-BrXPNdrU.js')
    expect(new URL(spec).searchParams.has(CHUNK_RETRY_PARAM)).toBe(true)
  })

  it('a module with no default export keeps the ORIGINAL failure (a mapping loader is never guessed at)', async () => {
    at(ORIGIN)
    const original = chromeError()
    const load = vi.fn().mockRejectedValue(original)
    chunkRetry.importUrl = vi.fn().mockResolvedValue({ Named: () => null })
    await expect(importWithOneRetry(load, 0)).rejects.toBe(original)
  })

  it('rendered: the view appears with NO page reload (the walk’s W7, in jsdom)', async () => {
    at(ORIGIN)
    const load = vi.fn().mockRejectedValue(chromeError())
    chunkRetry.importUrl = vi.fn().mockResolvedValue({ default: () => <p>tasks view</p> })
    const View = lazyChunk(load, 0)
    render(<Suspense fallback={<p>loading</p>}><View /></Suspense>)
    expect(await screen.findByText('tasks view')).toBeTruthy()
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('rendered: when the retry fails too, the one-per-session reload still takes over', async () => {
    at(ORIGIN)
    const load = vi.fn().mockRejectedValue(chromeError())
    chunkRetry.importUrl = vi.fn().mockRejectedValue(chromeError())
    const View = lazyChunk(load, 0)
    render(<Suspense fallback={<p>loading</p>}><View /></Suspense>)
    await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1))
    expect(chunkRetry.importUrl).toHaveBeenCalledTimes(1)
  })
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

// ⛔ Ruling D-I2 (frontend re-review R-2): a view that sits inside its OWN error boundary loads
// through `lazyLeaf` -- one in-place retry, then the error goes to that boundary. NEVER a page
// reload: a reload to heal one PDF preview or one chart embed replaces a working editor, and
// offline it lands on the browser's offline page. The re-review's leaf probe, kept: lazyChunk here
// measured reloadCalls 1 with the leaf's fallback never shown.
class LeafBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p>leaf fallback</p> : this.props.children }
}
const inLeaf = (View) => (
  <LeafBoundary><Suspense fallback={<p>loading</p>}><View /></Suspense></LeafBoundary>
)

describe('lazyLeaf (a view inside its OWN error boundary)', () => {
  let errorSpy
  beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errorSpy.mockRestore() })

  it('one failed import followed by success renders the view with NO page reload', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValueOnce({ default: () => <p>chart embed</p> })
    render(inLeaf(lazyLeaf(load, 0)))
    expect(await screen.findByText('chart embed')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('two failed imports: NO page reload, and the leaf’s own fallback is shown', async () => {
    const load = vi.fn().mockRejectedValue(chunkError())
    render(inLeaf(lazyLeaf(load, 0)))
    expect(await screen.findByText('leaf fallback')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    expect(window.location.reload).not.toHaveBeenCalled()
    expect(screen.queryByText('loading')).toBeNull()
  })

  it('a module that throws while it evaluates is not retried; the leaf’s fallback, no reload', async () => {
    const load = vi.fn().mockRejectedValue(new ReferenceError("Can't find variable: Iterator"))
    render(inLeaf(lazyLeaf(load, 0)))
    expect(await screen.findByText('leaf fallback')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('CONTROL — the same two failures through lazyChunk DO reload (the difference is the point)', async () => {
    const load = vi.fn().mockRejectedValue(chunkError())
    render(inLeaf(lazyChunk(load, 0)))
    await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('leaf fallback')).toBeNull()
  })
})
