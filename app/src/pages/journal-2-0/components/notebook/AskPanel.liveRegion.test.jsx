import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskPanel from './AskPanel'

// ─────────────────────────────────────────────────────────────────────────
// The Ask answer must be ANNOUNCED, not merely rendered (screen-reader pass
// 2026-10-09, row 19, finding F1). NVDA 2026.2 on production: the DOM held
// "I couldn't find that in this note." in an aria-live element and nothing was
// spoken, because the element was mounted together with its text -- a live
// region announces a change inside a region that already exists, never a
// region that arrives full. These rails pin the shape that works:
//   - the polite region is in the DOM from the moment the panel opens, empty;
//   - the SAME node (identity, not a fresh mount) receives the finished answer;
//   - it receives it once, at done -- not the stream's partial words;
//   - the visible answer block no longer claims to be live (one announcement).
// ─────────────────────────────────────────────────────────────────────────

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

function mockStream(events) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: sse(events), json: async () => ({}) }))
}

const HEAD = {
  type: 'sources', scope: 'note', scopeLabel: 'This note', sources: [],
  coverageNotice: null, independentSources: 0, noAnswer: true,
}
const SENTENCE = "I couldn't find that in this note."

beforeEach(() => { vi.restoreAllMocks() })

describe('the Ask answer reaches a live region that already existed', () => {
  it('the polite region is present and empty before any question is asked', () => {
    render(<AskPanel scope="note" target="n1" autoOpen />)
    const live = screen.getByTestId('ask-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.textContent).toBe('')
    expect(screen.queryByTestId('ask-answer')).toBeNull()      // the visible block is still conditional
  })

  it('the SAME node carries the finished answer -- a change, not a mount', async () => {
    mockStream([HEAD, { type: 'delta', text: SENTENCE }, { type: 'final', answer: SENTENCE, cited: [], invalidCitations: [] }])
    render(<AskPanel scope="note" target="n1" autoOpen />)
    const before = screen.getByTestId('ask-live')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'What is the dividend?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    // the answer lands first, and the announcer is still empty at that instant: the write is
    // deferred past the focus move that happens when the answer lands (measured on production, NVDA
    // spoke neither the focus nor a same-instant live write; a write 600 ms later it did)
    const landed = await screen.findByTestId('ask-answer')
    await waitFor(() => expect(landed).toHaveAttribute('aria-busy', 'false'))
    expect(screen.getByTestId('ask-live').textContent).toBe('')
    await waitFor(() => expect(screen.getByTestId('ask-live').textContent).toBe(SENTENCE), { timeout: 3000 })
    expect(screen.getByTestId('ask-live')).toBe(before)
    // the visible block is rendered and is not a second live region
    const visible = await screen.findByTestId('ask-answer')
    expect(visible).not.toHaveAttribute('aria-live')
    expect(visible).toHaveAttribute('aria-busy', 'false')
    // and the announcer lets go of the words once the announcement has had its moment, so the
    // answer exists in the DOM once -- in the visible block -- from then on
    await waitFor(() => expect(screen.getByTestId('ask-live').textContent).toBe(''), { timeout: 5000 })
    expect(visible.textContent).toContain(SENTENCE)
  })

  it('CONTROL: a region rendered only with its answer is exactly the shape that failed', async () => {
    // The visible block has that shape by design (it is conditional). This pins that the
    // announcement does NOT depend on it: strip the live region's text and the visible block
    // alone would be a mount-with-content, which is what NVDA never spoke.
    mockStream([HEAD, { type: 'final', answer: SENTENCE, cited: [], invalidCitations: [] }])
    render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    const visible = await screen.findByTestId('ask-answer')
    expect(visible.textContent).toContain(SENTENCE)
    expect(document.querySelectorAll('[aria-live="polite"]').length).toBe(1)   // one announcer, not two
    await waitFor(() => expect(screen.getByTestId('ask-live').textContent).toBe(SENTENCE), { timeout: 3000 })
  })

  it('a mid-stream error leaves the live region empty (the alert speaks instead)', async () => {
    mockStream([HEAD, { type: 'delta', text: 'partial' }, { type: 'error', detail: 'Something went wrong answering that.' }])
    render(<AskPanel scope="note" target="n1" autoOpen />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByRole('alert')
    expect(screen.getByTestId('ask-live').textContent).toBe('')
  })
})
