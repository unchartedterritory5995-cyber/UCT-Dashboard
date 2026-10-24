import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Task 7.2: the template catalog (`notebookTemplates.js`) loads on demand through ONE memoised,
// retried dynamic import. A fresh module copy per test keeps the memo from leaking between cases.
let loader
beforeEach(async () => {
  vi.resetModules()
  loader = await import('./templatesLoader')
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('templatesLoader', () => {
  it('loadTemplates_imports_once: two concurrent calls resolve ONE module object and import once', async () => {
    const spy = vi.spyOn(loader.templatesLoaders, 'catalog')
    const [a, b] = await Promise.all([loader.loadTemplates(), loader.loadTemplates()])
    expect(a).toBe(b)
    expect(typeof a.getTemplate).toBe('function')
    expect(spy).toHaveBeenCalledTimes(1)
    await loader.loadTemplates()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('getTemplateAsync_unknown_is_null', async () => {
    expect(await loader.getTemplateAsync('nope')).toBeNull()
  })

  it('getTemplateAsync resolves a real template by its key', async () => {
    const tpl = await loader.getTemplateAsync('thesis')
    expect(tpl?.key).toBe('thesis')
  })

  it('a failed first import is not remembered: the next call asks again', async () => {
    const real = loader.templatesLoaders.catalog
    let n = 0
    loader.templatesLoaders.catalog = () => {
      n += 1
      return n === 1 ? Promise.reject(new Error('boom')) : real()
    }
    await expect(loader.loadTemplates()).rejects.toThrow('boom')
    const mod = await loader.loadTemplates()
    expect(typeof mod.getTemplate).toBe('function')
    expect(n).toBe(2)
  })

  // The in-place retry imports the failed chunk under a new specifier; jsdom cannot fetch a chunk, so the
  // importer is swapped. The failed URL must be same-origin for the retry to name a specifier at all.
  async function failFirstThenAnswer(second) {
    const { chunkRetry } = await import('./lazyChunk')
    const err = new TypeError(`Failed to fetch dynamically imported module: ${globalThis.location.origin}/assets/notebookTemplates-abc.js`)
    loader.templatesLoaders.catalog = () => Promise.reject(err)
    vi.spyOn(chunkRetry, 'importUrl').mockResolvedValue(second)
    vi.useFakeTimers()
    const settled = loader.loadTemplates().then((m) => ({ m }), (e) => ({ e }))
    await vi.advanceTimersByTimeAsync(1000)
    return { ...(await settled), err }
  }

  it('the retry ACCEPTS a module that carries the named getTemplate export (it has no default)', async () => {
    const mod = { getTemplate: () => null }
    const out = await failFirstThenAnswer(mod)
    expect(out.m).toBe(mod)
  })

  it('the retry REFUSES a module without getTemplate: the original failure stands', async () => {
    const out = await failFirstThenAnswer({ default: () => null })
    expect(out.m).toBeUndefined()
    expect(out.e).toBe(out.err)
  })

  it('preloadTemplates schedules the load once the browser is idle and never throws', async () => {
    const spy = vi.spyOn(loader.templatesLoaders, 'catalog')
    const idle = vi.fn((cb) => { cb(); return 1 })
    vi.stubGlobal('requestIdleCallback', idle)
    try {
      loader.preloadTemplates()
      expect(idle).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally { vi.unstubAllGlobals() }
  })

  it('preloadTemplates falls back to a 1500 ms timer where there is no idle callback', async () => {
    const spy = vi.spyOn(loader.templatesLoaders, 'catalog')
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    try {
      loader.preloadTemplates()
      expect(spy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1499)
      expect(spy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally { vi.unstubAllGlobals() }
  })
})
