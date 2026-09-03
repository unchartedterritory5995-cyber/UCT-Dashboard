import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scanForTickers, addChartEmbed, revertChartEmbed } from './enrichment'

describe('scanForTickers', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs the note ids and returns the server response verbatim', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ id: 'n1', title: 'A', tickers: ['NVDA'] }], scanned: 3, truncated: false,
    })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await scanForTickers(['n1', 'n2', 'n3'])

    // Assertion OUTSIDE the mock callback, on the recorded call.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/j2/notes/enrichment/scan')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ noteIds: ['n1', 'n2', 'n3'] })
    expect(result).toEqual({ candidates: [{ id: 'n1', title: 'A', tickers: ['NVDA'] }], scanned: 3, truncated: false })
  })

  it('short-circuits with no request at all when there are no note ids', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await scanForTickers([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ candidates: [], scanned: 0, truncated: false })
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(scanForTickers(['n1'])).rejects.toThrow(/500/)
  })
})

describe('addChartEmbed', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs a live chart widgetEmbed attrs payload for the given symbol', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      note: { id: 'n1', bodyJson: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'widgetEmbed', attrs: { widgetId: 'chart' } }] } },
    })))
    vi.stubGlobal('fetch', fetchMock)

    const bodyAfter = await addChartEmbed('n1', 'nvda')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/j2/notes/n1/embeds')
    expect(opts.method).toBe('POST')
    const sent = JSON.parse(opts.body)
    expect(sent.attrs.widgetId).toBe('chart')
    expect(sent.attrs.params.symbol).toBe('NVDA') // normalized upper-case by the registry
    expect(sent.attrs.mode).toBe('live')
    expect(bodyAfter.content).toHaveLength(2)
    expect(bodyAfter.content[1].type).toBe('widgetEmbed')
  })

  it('throws a readable error, surfacing the server detail, on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'note not found' }), { status: 404 })))
    await expect(addChartEmbed('missing', 'NVDA')).rejects.toThrow(/note not found/)
  })
})

describe('revertChartEmbed', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('PUTs the doc with exactly its own last content node removed', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ note: {} })))
    vi.stubGlobal('fetch', fetchMock)
    const bodyAfterAppend = {
      type: 'doc',
      content: [{ type: 'paragraph' }, { type: 'widgetEmbed', attrs: { widgetId: 'chart' } }],
    }

    await revertChartEmbed('n1', bodyAfterAppend)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/j2/notes/n1')
    expect(opts.method).toBe('PUT')
    const sent = JSON.parse(opts.body)
    expect(sent.bodyJson.content).toEqual([{ type: 'paragraph' }])
  })

  it('throws on a failed undo rather than pretending it worked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(revertChartEmbed('n1', { type: 'doc', content: [] })).rejects.toThrow(/could not undo/)
  })
})
