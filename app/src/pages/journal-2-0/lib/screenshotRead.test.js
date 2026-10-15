// app/src/pages/journal-2-0/lib/screenshotRead.test.js
import { describe, expect, it, vi } from 'vitest'
vi.mock('./smartChipsApi', () => ({ tickersIn: vi.fn(async () => [{ symbol: 'NVDA', tier: 'exact' }]) }))
import { tickersIn } from './smartChipsApi'
import { POLL_DELAYS_MS, readScreenshot } from './screenshotRead'

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
      .toEqual({ symbol: 'NVDA', timeframe: { tf: 'D', label: 'Daily' } })
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
