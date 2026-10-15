// app/src/pages/journal-2-0/lib/screenshotRead.test.js
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('./smartChipsApi', () => ({ tickersIn: vi.fn(async () => [{ symbol: 'NVDA', tier: 'exact' }]) }))
import { tickersIn } from './smartChipsApi'
import { POLL_DELAYS_MS, REQUEST_TIMEOUT_MS, readScreenshot } from './screenshotRead'

const URL_ = '/api/j2/notes/n1/images/a.png'
const res = (body) => ({ ok: true, json: async () => body })
const noSleep = async () => {}

function server(statuses, text = 'NVDA · 1D · NASDAQ') {
  let i = 0
  return vi.fn(async (url) => {
    if (url.endsWith('/documents')) {
      const status = statuses[Math.min(i++, statuses.length - 1)]
      return res({ documents: [{ id: 'd1', attachmentUrl: URL_, status, pagesWithText: status === 'ready' ? 1 : 0 }] })
    }
    if (url.includes('/pages/1/text')) return res({ text, available: true })
    throw new Error(`unexpected ${url}`)
  })
}

describe('readScreenshot', () => {
  it('waits for OCR, reads the header, confirms the ticker', async () => {
    const f = server(['pending', 'pending', 'ready'])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep }))
      .toEqual({ symbol: 'NVDA', timeframe: { tf: 'D', label: 'Daily' }, alt: 'NVDA daily chart' }) // the alt rides on the offer (I5)
    expect(tickersIn).toHaveBeenCalledWith('NVDA · 1D · NASDAQ', f)
  })
  it('gives up after the bounded schedule', async () => {
    const f = server(['pending'])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep })).toBeNull()
    expect(f.mock.calls.filter(([u]) => u.endsWith('/documents'))).toHaveLength(POLL_DELAYS_MS.length)
  })
  it('no text, or OCR off, is no offer', async () => {
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: server(['no_text']), sleep: noSleep })).toBeNull()
  })
  it('an aborted read stops at once and says nothing', async () => {
    const ctrl = new AbortController(); ctrl.abort()
    const f = server(['ready'])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep, signal: ctrl.signal })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('two tickers in the header: no offer', async () => {
    tickersIn.mockResolvedValueOnce([{ symbol: 'NVDA', tier: 'exact' }, { symbol: 'AMD', tier: 'exact' }])
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: server(['ready']), sleep: noSleep })).toBeNull()
  })
})

describe('readScreenshot is bounded and never throws', () => {
  afterEach(() => { vi.useRealTimers() })

  it('an abort while a list request is in flight stops the poll at once (real sleep)', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    const f = vi.fn(async (url) => {
      ctrl.abort()
      return res({ documents: [{ id: 'd1', attachmentUrl: URL_, status: 'pending' }] })
    })
    const p = readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0])
    expect(await p).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('an abort during a sleep resolves promptly (real sleep)', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    const f = server(['ready'])
    const p = readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(100)
    ctrl.abort()
    expect(await p).toBeNull()      // no timer advanced past the 1.5 s sleep
    expect(f).not.toHaveBeenCalled()
  })
  it('a request that never answers is cut off at the per-request timeout', async () => {
    vi.useFakeTimers()
    const f = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const p = readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * (POLL_DELAYS_MS.length + 1))
    expect(await p).toBeNull()
    expect(f).toHaveBeenCalledTimes(POLL_DELAYS_MS.length)
  })
  it('a non-JSON answer is no offer', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } }))
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep })).toBeNull()
  })
  it('a network throw is no offer', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep })).toBeNull()
    expect(f).toHaveBeenCalledTimes(POLL_DELAYS_MS.length)
  })
  it('documents that is not an array is no offer', async () => {
    for (const documents of ['oops', 7, { id: 'd1' }, true]) {
      const f = vi.fn(async () => res({ documents }))
      expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep })).toBeNull()
    }
  })
  it('a missing document is no offer', async () => {
    const f = vi.fn(async () => res({ documents: [{ id: 'dX', attachmentUrl: '/api/j2/notes/n1/images/other.png', status: 'ready' }] }))
    expect(await readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: f, sleep: noSleep })).toBeNull()
    expect(f).toHaveBeenCalledTimes(POLL_DELAYS_MS.length)
  })
  it('a ticker check that never answers is cut off at the timeout', async () => {
    vi.useFakeTimers()
    tickersIn.mockImplementationOnce(() => new Promise(() => {}))
    const p = readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: server(['ready']), sleep: noSleep })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    expect(await p).toBeNull()
  })
  it('an abort while the ticker check is pending resolves promptly', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    tickersIn.mockImplementationOnce(() => new Promise(() => {}))
    const p = readScreenshot({ noteId: 'n1', url: URL_, fetchImpl: server(['ready']), sleep: noSleep, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(100)      // well inside the 8 s timeout
    expect(tickersIn).toHaveBeenCalled()
    ctrl.abort()
    expect(await p).toBeNull()
  })
})
