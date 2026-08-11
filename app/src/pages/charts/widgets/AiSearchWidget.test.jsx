import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
// ShareToFloor fetches /api/community/status on mount — stub it so it doesn't
// add fetch calls the assertions don't expect. Rendered as a real, findable
// element (not null) so tests can assert its presence/absence per entry.
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <button>Share to Floor</button> }))
// The ⚙ appearance settings read prefs; stub the hook so it doesn't add a
// /api/auth/preferences fetch that would shift the fetch-call assertions below.
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (v, d) => d }))
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

// A manually-driven SSE stream: unlike sseBody (all events queued upfront —
// they land on the very first render, so a transient state like the
// personal-waiting-line can never be observed), this lets a test push one
// event, let React commit, assert, then push the next.
function controllableSseStream() {
  let ctrl
  const enc = new TextEncoder()
  const stream = new ReadableStream({ start(c) { ctrl = c } })
  return {
    stream,
    push: (ev) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)),
    close: () => ctrl.close(),
  }
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
    // non-personal answer: no regression — ShareToFloor + the retention
    // disclaimer both still render exactly as before.
    expect(screen.getByRole('button', { name: /share to floor/i })).toBeTruthy()
    expect(screen.getByText(/retained de-identified/i)).toBeTruthy()
  })

  it('personal answer: position-aware waiting state, no ShareToFloor, no retention disclaimer', async () => {
    const s = controllableSseStream()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: s.stream })
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'am i overexposed' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    // meta arrives first — position-aware waiting line shown before any delta/final.
    s.push({ type: 'meta', personal: true })
    expect(await screen.findByText(/your positions/i)).toBeTruthy()
    s.push({ type: 'delta', text: 'Your NVDA position is up 4% today.' })
    s.push({ type: 'final', personal: true, answer: 'Your NVDA position is up 4% today.', citations: [] })
    s.close()
    await waitFor(() => expect(screen.getByText(/Your NVDA position is up 4%/)).toBeTruthy())
    // No community-share affordance and no de-identified-retention claim on a
    // personal, position-aware turn.
    expect(screen.queryByRole('button', { name: /share to floor/i })).toBeNull()
    expect(screen.queryByText(/retained de-identified/i)).toBeNull()
  })

  it('429 shows the friendly limit notice, not the red error', async () => {
    mockFetchOnce(429, { detail: "You've hit today's research limit — it resets at midnight ET." })
    render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/research limit/i)).toBeTruthy())
  })

  it('keeps prior turns in the thread while the next search loads', async () => {
    mockFetchOnce(200, GOOD)
    const { container } = render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'first question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/The move is real/)).toBeTruthy())

    // Second ask: leave the fetch pending so the loading turn is observable.
    let resolveFetch
    global.fetch = vi.fn().mockReturnValue(new Promise((res) => { resolveFetch = res }))
    fireEvent.change(box, { target: { value: 'second question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    // Both questions are on screen (the thread grows), the first answer stays
    // visible, and the input clears for the next ask.
    const qs = [...container.querySelectorAll('[class*="askedText"]')].map((n) => n.textContent)
    expect(qs).toContain('first question')
    expect(qs).toContain('second question')
    expect(box.value).toBe('')
    expect(screen.getByText(/The move is real/)).toBeTruthy()
    resolveFetch({ ok: true, status: 200, json: async () => GOOD })
    // Second answer lands → now two answers in the thread.
    await waitFor(() => expect(screen.getAllByText(/The move is real/).length).toBeGreaterThanOrEqual(2))
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

  it('Save persists an answer that reappears under Saved on a fresh mount', async () => {
    localStorage.clear()
    mockFetchOnce(200, GOOD)
    const { unmount } = render(<AiSearchWidget />)
    const box = screen.getByLabelText('Ask anything about the markets')
    fireEvent.change(box, { target: { value: 'why is NVDA up' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const saveBtn = await waitFor(() => screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(saveBtn)
    expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeTruthy()
    unmount()
    // Fresh mount (empty thread) → the saved question shows in the recall list.
    render(<AiSearchWidget />)
    expect(screen.getByRole('button', { name: 'why is NVDA up' })).toBeTruthy()
    localStorage.clear()
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

  // ── scope + chrome: the earnings modal's Ask AI section ────────────────────
  // Both props exist so ONE widget can serve /charts, /ai-search AND a
  // company-scoped panel. The load-bearing pair of assertions is "scoped mode
  // changes X" AND "unscoped mode still does X" — without the second, a scoping
  // bug that leaked into the default path would go unnoticed.
  describe('scope + chrome', () => {
    const SCOPE = { sym: 'AAPL', suggestions: ["How did AAPL's print go?", 'Is AAPL extended here?'] }

    it('scoped: names the company, offers ITS starters, and says so in the ask box', () => {
      render(<AiSearchWidget scope={SCOPE} chrome={false} />)
      expect(screen.getByText('Ask AI about AAPL')).toBeTruthy()
      for (const q of SCOPE.suggestions) expect(screen.getByText(q)).toBeTruthy()
      expect(screen.getByLabelText('Ask anything about AAPL')).toBeTruthy()
      // The general examples belong to the workspace widget, not a company panel.
      expect(screen.queryByText('Why is SMCI moving today?')).toBeNull()
      expect(screen.queryByText('Ask the markets anything')).toBeNull()
    })

    it('chrome=false hides the ⚙ appearance settings', () => {
      render(<AiSearchWidget scope={SCOPE} chrome={false} />)
      expect(screen.queryByLabelText('AI Search settings')).toBeNull()
    })

    it('the DEFAULT path is untouched — no props means the widget /charts ships', () => {
      // The control. If scoping ever leaks into the unscoped branch, this reds
      // while every scoped test above stays green.
      render(<AiSearchWidget />)
      expect(screen.getByText('Ask the markets anything')).toBeTruthy()
      expect(screen.getByText('Why is SMCI moving today?')).toBeTruthy()
      expect(screen.getByLabelText('Ask anything about the markets')).toBeTruthy()
      expect(screen.getByLabelText('AI Search settings')).toBeTruthy()
    })

    it('clicking a scoped starter asks THAT question', async () => {
      mockFetchOnce(200, GOOD)
      render(<AiSearchWidget scope={SCOPE} chrome={false} />)
      fireEvent.click(screen.getByText("How did AAPL's print go?"))
      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      const sent = JSON.parse(global.fetch.mock.calls[0][1].body)
      expect(sent.query).toBe("How did AAPL's print go?")
    })

    it('hands a finished thread back, and restores one on a later mount', async () => {
      // How the modal survives its own GATE c: it unmounts inactive panels, so
      // leaving Ask AI and returning is a remount. The widget stays the only
      // thing that BUILDS a turn — the caller only stores what it was handed.
      mockFetchOnce(200, GOOD)
      const onThread = vi.fn()
      const { unmount } = render(<AiSearchWidget scope={SCOPE} chrome={false} onThread={onThread} />)
      fireEvent.change(screen.getByLabelText('Ask anything about AAPL'), { target: { value: 'why?' } })
      fireEvent.keyDown(screen.getByLabelText('Ask anything about AAPL'), { key: 'Enter' })
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy())

      const handed = onThread.mock.calls.at(-1)[0]
      expect(handed).toHaveLength(1)
      expect(handed[0].q).toBe('why?')
      unmount()

      // Restored WITHOUT a fetch — this is a replay, not a re-ask.
      global.fetch = vi.fn()
      render(<AiSearchWidget scope={SCOPE} chrome={false} initialThread={handed} />)
      expect(screen.getByText('why?')).toBeTruthy()
      expect(global.fetch).not.toHaveBeenCalled()
      // The empty state is gone, so the restore actually reached the render.
      expect(screen.queryByText('Ask AI about AAPL')).toBeNull()
    })

    it('a restored turn does not collide with the next one on React keys', async () => {
      // `++idRef.current` from 0 against a restored thread would hand turn 2 the
      // key React already has on turn 1 — two turns, one rendered.
      mockFetchOnce(200, GOOD)
      const onThread = vi.fn()
      render(<AiSearchWidget
        scope={SCOPE} chrome={false} onThread={onThread}
        initialThread={[{ id: 7, q: 'earlier', answer: 'prior answer', citations: [], related: [] }]}
      />)
      fireEvent.change(screen.getByLabelText('Ask anything about AAPL'), { target: { value: 'and now?' } })
      fireEvent.keyDown(screen.getByLabelText('Ask anything about AAPL'), { key: 'Enter' })
      // Wait on the COMMITTED turn, not the in-flight question label — the
      // pending question renders at the tail while the answer is still loading.
      await waitFor(() => expect(onThread.mock.calls.at(-1)[0]).toHaveLength(2))

      const thread = onThread.mock.calls.at(-1)[0]
      expect(new Set(thread.map(t => t.id)).size).toBe(2)
      // Both turns on screen — a key collision renders two entries as one.
      expect(screen.getByText('earlier')).toBeTruthy()
      expect(screen.getByText('and now?')).toBeTruthy()
    })
  })
})
