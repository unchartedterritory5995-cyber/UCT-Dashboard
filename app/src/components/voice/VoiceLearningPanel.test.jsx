import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VoiceLearningPanel from './VoiceLearningPanel'

// Packet AD CP3 — Active Learning panel. Mocks global.fetch and routes by
// URL + method, mirroring AiSearchInsightsPanel.test.jsx's convention.

const GAP = { slot: 'risk_per_trade', category: 'risk management', question: "What's your usual risk per trade?" }
const OBSESSION = {
  symbol: 'NVDA',
  mentions: 12,
  suggested_fact: 'frequently discusses NVDA',
  suggested_question: "You've brought up NVDA 12 times recently — want me to remember why it's on your radar?",
}

function mockFetch({ gaps = [GAP], obsessions = [OBSESSION], consolidateResponse, consolidateOk = true } = {}) {
  const postCalls = []
  global.fetch = vi.fn((url, opts) => {
    const u = String(url)
    if (opts && opts.method === 'POST' && u.includes('/api/voice/learning/consolidate')) {
      postCalls.push(u)
      if (!consolidateOk) return Promise.resolve({ ok: false, status: 500 })
      return Promise.resolve({
        ok: true,
        json: async () => consolidateResponse || { duplicates_merged: 2, stale_flagged: 3, summaries_compressed: 5 },
      })
    }
    if (u.includes('/api/voice/learning/gaps')) {
      return Promise.resolve({ ok: true, json: async () => ({ gaps }) })
    }
    if (u.includes('/api/voice/learning/ticker-obsessions')) {
      return Promise.resolve({ ok: true, json: async () => ({ obsessions }) })
    }
    return Promise.resolve({ ok: false, status: 404 })
  })
  return postCalls
}

describe('VoiceLearningPanel (Packet AD CP3)', () => {
  afterEach(() => { delete global.fetch })

  it('renders knowledge gaps and ticker obsessions', async () => {
    mockFetch()
    render(<VoiceLearningPanel />)

    await waitFor(() => expect(screen.getByText('risk management')).toBeInTheDocument())
    expect(screen.getByText("What's your usual risk per trade?")).toBeInTheDocument()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('12 mentions')).toBeInTheDocument()
    expect(screen.getByText(/want me to remember why it's on your radar/)).toBeInTheDocument()
  })

  it('shows empty-state copy for both sections when there is nothing to surface', async () => {
    mockFetch({ gaps: [], obsessions: [] })
    render(<VoiceLearningPanel />)

    await waitFor(() => expect(
      screen.getByText('No knowledge gaps — every tracked category has a saved fact.')
    ).toBeInTheDocument())
    expect(
      screen.getByText('No frequently-mentioned tickers without a saved fact.')
    ).toBeInTheDocument()
  })

  it('runs consolidation on click and renders the honest, non-"compressed" wording for summaries_compressed', async () => {
    const postCalls = mockFetch({
      consolidateResponse: { duplicates_merged: 4, stale_flagged: 1, summaries_compressed: 7 },
    })
    const user = userEvent.setup()
    render(<VoiceLearningPanel />)

    await waitFor(() => expect(screen.getByRole('button', { name: /run consolidation now/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /run consolidation now/i }))

    await waitFor(() => expect(postCalls).toEqual(['/api/voice/learning/consolidate']))
    expect(await screen.findByText(/4 duplicate facts merged/)).toBeInTheDocument()
    expect(screen.getByText(/1 stale fact flagged for review/)).toBeInTheDocument()
    expect(screen.getByText(/7 old summaries flagged for future compression/)).toBeInTheDocument()

    // THE non-negotiable assertion: the backend does not actually compress
    // yet (voice_active_learning.py's own comment: "just count how many
    // we'd compress") — the word "compressed" (past tense — something that
    // already happened) must NEVER appear anywhere on the page. Checked
    // against the whole document, not one element, so no phrasing of the
    // dishonest wording can slip past.
    expect(document.body.textContent).not.toMatch(/\bcompressed\b/i)
  })

  it('surfaces an error and never claims compression happened when the consolidate call fails', async () => {
    mockFetch({ consolidateOk: false })
    const user = userEvent.setup()
    render(<VoiceLearningPanel />)

    await waitFor(() => expect(screen.getByRole('button', { name: /run consolidation now/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /run consolidation now/i }))

    expect(await screen.findByText(/consolidation failed/i)).toBeInTheDocument()
    expect(screen.queryByText(/flagged for future compression/)).toBeNull()
  })
})
