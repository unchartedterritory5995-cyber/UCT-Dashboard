import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import TranscriptSearchAll, { parseSnippet } from './TranscriptSearchAll'

describe('parseSnippet — server highlights without server markup execution', () => {
  it('splits the match out of the surrounding text', () => {
    expect(parseSnippet('a <mark>tariff</mark> b')).toEqual([
      { text: 'a ', hit: false },
      { text: 'tariff', hit: true },
      { text: ' b', hit: false },
    ])
  })

  it('handles several hits in one snippet', () => {
    const parts = parseSnippet('<mark>x</mark> and <mark>y</mark>')
    expect(parts.filter(p => p.hit).map(p => p.text)).toEqual(['x', 'y'])
  })

  it('leaves any OTHER markup as literal text, never as elements', () => {
    // Transcript text is third-party. Rendered through dangerouslySetInnerHTML
    // a <script> or <img onerror> in a transcript would execute; parsed this
    // way it can only ever be characters on the page.
    const parts = parseSnippet('<script>alert(1)</script> <mark>hit</mark>')
    expect(parts[0]).toEqual({ text: '<script>alert(1)</script> ', hit: false })
    expect(parts.some(p => p.hit && p.text === 'hit')).toBe(true)
  })

  it('survives an empty or missing snippet', () => {
    expect(parseSnippet('')).toEqual([])
    expect(parseSnippet(undefined)).toEqual([])
  })
})

describe('TranscriptSearchAll', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  const respond = (body) => {
    // Both the search and the trend call resolve from this stub; the trend
    // simply finds no `months` and renders nothing, which is the correct
    // behaviour for a term with no history.
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => body }))
  }

  it('does not query on every keystroke', async () => {
    respond({ hits: [], total: 0 })
    render(<TranscriptSearchAll />)
    const input = screen.getByLabelText(/Search every indexed/i)
    fireEvent.change(input, { target: { value: 't' } })
    fireEvent.change(input, { target: { value: 'ta' } })
    fireEvent.change(input, { target: { value: 'tar' } })
    expect(global.fetch).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    // One debounce cycle now issues TWO requests — the search and its trend,
    // fired together on purpose. Count the cycles, not the calls: three
    // keystrokes must still produce exactly one search.
    const searches = global.fetch.mock.calls
      .filter(([u]) => String(u).includes('transcript-search'))
    const trends = global.fetch.mock.calls
      .filter(([u]) => String(u).includes('transcript-trend'))
    expect(searches).toHaveLength(1)
    expect(trends).toHaveLength(1)
  })

  it('renders a hit with its company, quarter and highlighted snippet', async () => {
    respond({ total: 1, hits: [{ symbol: 'AAPL', year: 2026, quarter: 3,
                                 date: '2026-08-01',
                                 snippet: 'on <mark>tariff</mark> costs' }] })
    render(<TranscriptSearchAll />)
    fireEvent.change(screen.getByLabelText(/Search every indexed/i),
                     { target: { value: 'tariff' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    expect(screen.getByText('AAPL')).toBeTruthy()
    expect(document.body.textContent).toContain('Q3 2026')
    expect(document.querySelector('mark').textContent).toBe('tariff')
  })

  it('says the index is the limit, rather than implying nobody said it', async () => {
    respond({ total: 0, hits: [] })
    render(<TranscriptSearchAll />)
    fireEvent.change(screen.getByLabelText(/Search every indexed/i),
                     { target: { value: 'zzzz' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    expect(document.body.textContent).toMatch(/index covers recent calls only/i)
  })

  it('a failed search reports itself instead of looking like no results', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    render(<TranscriptSearchAll />)
    fireEvent.change(screen.getByLabelText(/Search every indexed/i),
                     { target: { value: 'tariff' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    expect(document.body.textContent).toMatch(/search failed/i)
  })

  it('clicking a symbol hands it to the caller', async () => {
    respond({ total: 1, hits: [{ symbol: 'MSFT', year: 2026, quarter: 4,
                                 date: '2026-08-02', snippet: '<mark>ai</mark>' }] })
    const onOpen = vi.fn()
    render(<TranscriptSearchAll onOpenSymbol={onOpen} />)
    fireEvent.change(screen.getByLabelText(/Search every indexed/i),
                     { target: { value: 'ai' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    expect(screen.getByText('MSFT')).toBeTruthy()
    fireEvent.click(screen.getByText('MSFT'))
    expect(onOpen).toHaveBeenCalledWith('MSFT')
  })
})
