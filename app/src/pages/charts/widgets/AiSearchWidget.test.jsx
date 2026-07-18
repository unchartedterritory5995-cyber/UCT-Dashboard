import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AiSearchWidget from './AiSearchWidget'

function mockFetchOnce(status, body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
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
    // sticky header shows the asked question + copy affordance
    expect(container.querySelector('[class*="askedText"]').textContent).toBe('why is NVDA up')
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
    // Old answer still on screen, marked stale; spinner status is up.
    expect(screen.getByText(/The move is real/)).toBeTruthy()
    expect(container.querySelector('[class*="answerStale"]')).toBeTruthy()
    resolveFetch({ ok: true, status: 200, json: async () => GOOD })
    await waitFor(() => expect(container.querySelector('[class*="answerStale"]')).toBeFalsy())
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
