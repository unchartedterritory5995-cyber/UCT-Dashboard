import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AiSearchWidget from './AiSearchWidget'

// Plain JSON mock — has no .body stream, so run() falls back to the
// single-shot endpoint (which this same mock also serves).
function mockFetchOnce(status, body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

function sseBody(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

function mockStreamFetch(events) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: sseBody(events) })
}

const GOOD = {
  answer: 'The move is real[1]. **Key driver**: [Nvidia]($NVDA) demand.',
  citations: ['https://www.wsj.com/article-one'],
  related_questions: ['What about margins?'],
}

describe('AiSearchWidget', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { delete global.fetch })

  it('renders the empty state with example questions', () => {
    render(<AiSearchWidget />)
    expect(screen.getByText('Ask the markets anything')).toBeTruthy()
    expect(screen.getByText('Why is SMCI moving today?')).toBeTruthy()
  })

  it('Enter runs a search; answer renders with copy button, cite link, and disclaimer', async () => {
    mockFetchOnce(200, GOOD)
    const { container } = render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'why is NVDA up' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/The move is real/)).toBeTruthy())
    // conversation flow: question moved down into the header, input cleared
    expect(container.querySelector('[class*="askedText"]').textContent).toBe('why is NVDA up')
    expect(box.value).toBe('')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    // [1] became a superscript link to the source
    const cite = screen.getByRole('link', { name: '1' })
    expect(cite.getAttribute('href')).toBe('https://www.wsj.com/article-one')
    // compliance line present
    expect(screen.getByText(/verify before trading/i)).toBeTruthy()
  })

  it('429 shows the friendly limit notice, not the red error', async () => {
    mockFetchOnce(429, { detail: "You've hit today's research limit — it resets at midnight ET." })
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/research limit/i)).toBeTruthy())
  })

  it('keeps the previous answer visible (dimmed) while the next search loads', async () => {
    mockFetchOnce(200, GOOD)
    const { container } = render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'first question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/The move is real/)).toBeTruthy())

    // Second ask: leave the fetch pending so loading state is observable.
    let resolveFetch
    global.fetch = vi.fn().mockReturnValue(new Promise((res) => { resolveFetch = res }))
    fireEvent.change(box, { target: { value: 'second question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    // New question dropped into the body immediately; input cleared;
    // old answer still on screen, marked stale.
    expect(container.querySelector('[class*="askedText"]').textContent).toBe('second question')
    expect(box.value).toBe('')
    expect(screen.getByText(/The move is real/)).toBeTruthy()
    expect(container.querySelector('[class*="answerStale"]')).toBeTruthy()
    resolveFetch({ ok: true, status: 200, json: async () => GOOD })
    await waitFor(() => expect(container.querySelector('[class*="answerStale"]')).toBeFalsy())
  })

  it('streams: deltas render progressively, final applies citations', async () => {
    mockStreamFetch([
      { type: 'delta', text: 'SMCI is ' },
      { type: 'delta', text: 'ripping on AI capex[1].' },
      { type: 'final', answer: 'SMCI is ripping on AI capex[1].', citations: ['https://reuters.com/x'], related_questions: [] },
    ])
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'why is SMCI moving' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/ripping on AI capex/)).toBeTruthy())
    // final state: [1] became a source link, only the stream endpoint was hit
    const cite = screen.getByRole('link', { name: '1' })
    expect(cite.getAttribute('href')).toBe('https://reuters.com/x')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe('/api/ai-search/stream')
  })

  it('falls back to the single-shot endpoint when the stream errors', async () => {
    let call = 0
    global.fetch = vi.fn().mockImplementation(() => {
      call += 1
      if (call === 1) {
        return Promise.resolve({ ok: true, status: 200, body: sseBody([{ type: 'error', error: 'stream failed' }]) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GOOD })
    })
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/The move is real/)).toBeTruthy())
    expect(global.fetch.mock.calls[0][0]).toBe('/api/ai-search/stream')
    expect(global.fetch.mock.calls[1][0]).toBe('/api/ai-search')
  })

  it('sends conversation history on the next ask so follow-ups resolve references', async () => {
    mockFetchOnce(200, GOOD)
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'first question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/The move is real/)).toBeTruthy())
    // first ask carried empty history
    const firstBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(firstBody.history).toEqual([])

    fireEvent.change(box, { target: { value: 'how did it react?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => {
      const calls = global.fetch.mock.calls
      const lastBody = JSON.parse(calls[calls.length - 1][1].body)
      expect(lastBody.history).toEqual([{ q: 'first question', a: GOOD.answer }])
    })
  })

  it('a failed ask restores the question to the input for retry', async () => {
    mockFetchOnce(500, { detail: 'boom' })
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'my question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy())
    expect(box.value).toBe('my question')
  })

  it('renders "## Section" markdown as a styled subhead without the hashes', async () => {
    mockFetchOnce(200, { ...GOOD, answer: '## Main catalyst\n- Analyst upgrade cycle.' })
    const { container } = render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Main catalyst')).toBeTruthy())
    const sub = container.querySelector('[class*="subhead"]')
    expect(sub.textContent).toBe('Main catalyst')
    expect(sub.textContent).not.toContain('#')
  })

  it('renders a ticker / % nested inside a **bold** lead line, not raw markdown', async () => {
    // The system prompt asks for a bolded lead line with bolded tickers, so this
    // is the most common answer shape — renderRich must recurse into the bold.
    mockFetchOnce(200, { ...GOOD, answer: '**[Nvidia]($NVDA) is the cleaner setup; up +2.1% today.**' })
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'compare' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    // The bolded ticker becomes a clickable button…
    const btn = await waitFor(() => screen.getByRole('button', { name: 'Nvidia' }))
    expect(btn).toBeTruthy()
    // …and the raw [Nvidia]($NVDA) markdown must NOT leak as visible text.
    expect(screen.queryByText(/\(\$NVDA\)/)).toBeFalsy()
  })

  it('shows a Stop control while in flight; cancelling restores the question', async () => {
    // fetch that only settles when its AbortSignal fires (mirrors a slow search).
    global.fetch = vi.fn((_url, opts) => new Promise((_res, reject) => {
      opts?.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'a slow question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    // While loading the Ask button is replaced by Stop.
    const stopBtn = await waitFor(() => screen.getByRole('button', { name: /stop/i }))
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeFalsy()
    fireEvent.click(stopBtn)
    // Cancel restores the question (no error, no single-shot fallback) and Ask returns.
    await waitFor(() => expect(box.value).toBe('a slow question'))
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy()
  })

  it('copy strips ticker-link markdown before writing to the clipboard', async () => {
    mockFetchOnce(200, GOOD)
    const writeText = vi.fn().mockResolvedValue()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'q' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('The move is real[1]. Key driver: Nvidia demand.')
  })
})
