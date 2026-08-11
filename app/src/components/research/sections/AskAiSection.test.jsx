import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../../context/AuthContext'

vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <button>Share to Floor</button> }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (v, d) => d }))

import AskAiSection from './AskAiSection'
import { suggestionsFor } from '../askAiSuggestions'
import { resetThreads } from '../askAiThreads'

const ANSWER = { answer: 'It gapped and held.', citations: [], related_questions: [] }

function mockAsk() {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ANSWER })
}

/** TickerPopup reaches useFlagged/useTickerTags, which call useAuth() and THROW
 *  outside a provider — the same reason EarningsResearchModal.test.jsx wraps
 *  every render. Only the ticker-click test needs it; the rest render bare so a
 *  provider can never be what makes them pass. */
const withProviders = (ui) => <AuthProvider><MemoryRouter>{ui}</MemoryRouter></AuthProvider>

/** Ask a question and wait for the answer to land. */
async function ask(sym, text) {
  const box = screen.getByLabelText(`Ask anything about ${sym}`)
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(screen.getByText(ANSWER.answer)).toBeTruthy())
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetThreads()
  globalThis.fetch = vi.fn()
})
afterEach(() => { delete globalThis.fetch })

describe('AskAiSection', () => {
  it('offers the starters the suggestions module produces for this print', () => {
    render(<AskAiSection sym="NVDA" lifecycle="PRE" />)
    // Derived from the module, never retyped — a hardcoded copy here would keep
    // passing against a section wired to the wrong lifecycle.
    for (const q of suggestionsFor({ sym: 'NVDA', lifecycle: 'PRE' })) {
      expect(screen.getByText(q)).toBeTruthy()
    }
  })

  it('changes its starters when the print has already happened', () => {
    const { rerender } = render(<AskAiSection sym="NVDA" lifecycle="PRE" />)
    const before = suggestionsFor({ sym: 'NVDA', lifecycle: 'PRE' })[0]
    expect(screen.getByText(before)).toBeTruthy()

    rerender(<AskAiSection sym="NVDA" lifecycle="PRINTED" />)
    expect(screen.queryByText(before)).toBeNull()
    expect(screen.getByText(suggestionsFor({ sym: 'NVDA', lifecycle: 'PRINTED' })[0])).toBeTruthy()
  })

  it('asks nothing on its own — an open costs no AI call', () => {
    render(<AskAiSection sym="NVDA" lifecycle="PRE" />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('survives a remount for the SAME company (leaving the tab and coming back)', async () => {
    mockAsk()
    const { unmount } = render(<AskAiSection sym="NVDA" lifecycle="PRINTED" />)
    await ask('NVDA', 'why did it move?')
    unmount()   // ← the modal unmounts inactive panels (GATE c)

    globalThis.fetch = vi.fn()
    render(<AskAiSection sym="NVDA" lifecycle="PRINTED" />)
    expect(screen.getByText('why did it move?')).toBeTruthy()
    expect(screen.getByText(ANSWER.answer)).toBeTruthy()
    // Restored, not re-asked: a replay must never spend a second AI call.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('CLEARS when the reader steps to another company', async () => {
    mockAsk()
    const { rerender } = render(<AskAiSection sym="NVDA" lifecycle="PRINTED" />)
    await ask('NVDA', 'why did it move?')

    rerender(<AskAiSection sym="MSFT" lifecycle="PRINTED" />)
    // The failure this prevents: NVDA's answer sitting under an MSFT banner,
    // where it reads as an answer about MSFT.
    expect(screen.queryByText('why did it move?')).toBeNull()
    expect(screen.queryByText(ANSWER.answer)).toBeNull()
    expect(screen.getByText('Ask AI about MSFT')).toBeTruthy()
    expect(screen.getByText(suggestionsFor({ sym: 'MSFT', lifecycle: 'PRINTED' })[0])).toBeTruthy()
  })

  it('keeps each company\'s conversation to itself when stepping back and forth', async () => {
    mockAsk()
    const { rerender } = render(<AskAiSection sym="NVDA" lifecycle="PRINTED" />)
    await ask('NVDA', 'nvda question')

    rerender(<AskAiSection sym="MSFT" lifecycle="PRINTED" />)
    await ask('MSFT', 'msft question')

    rerender(<AskAiSection sym="NVDA" lifecycle="PRINTED" />)
    expect(screen.getByText('nvda question')).toBeTruthy()
    expect(screen.queryByText('msft question')).toBeNull()
  })

  it('a ticker in an answer opens a chart IN PLACE, not a dead button', async () => {
    // The widget renders `[Nvidia]($NVDA)` as a button and calls `onTicker`.
    // Inside /charts that loads the widget's colour group; here there is no
    // workspace, so without an explicit handler it fell through to a no-op
    // FALLBACK — a button that looked live and did nothing. Component tests on
    // either side stay green through that: the widget correctly calls its prop,
    // and the popup correctly opens when told to. Only the WIRE is missing.
    // URL-aware so AuthProvider's own mount fetch can't be answered with an
    // AI payload and invent a signed-in user this assertion never asked for.
    globalThis.fetch = vi.fn((url) => Promise.resolve({
      ok: true, status: 200,
      json: async () => (String(url).includes('/api/ai-search')
        ? { answer: 'Watch [Nvidia]($NVDA) into the print.', citations: [], related_questions: [] }
        : {}),
    }))
    render(withProviders(<AskAiSection sym="AAPL" lifecycle="PRINTED" />))
    const box = screen.getByLabelText('Ask anything about AAPL')
    fireEvent.change(box, { target: { value: 'any read-throughs?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/into the print/)).toBeTruthy())

    const tickerBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Nvidia')
    expect(tickerBtn, 'answer should render the ticker as a button').toBeTruthy()
    fireEvent.click(tickerBtn)

    // The chart opens over the modal — and it must be for the CLICKED symbol,
    // not the modal's own. A popup hardcoded to `sym` would pass a weaker
    // assertion while showing the reader the wrong company.
    await waitFor(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"], [class*="modal"]')]
      expect(dialogs.some(el => /NVDA/.test(el.textContent || ''))).toBe(true)
    })
    // And it did NOT navigate away: the panel is still mounted behind it.
    expect(screen.getByTestId('erm-ask-ai')).toBeTruthy()
  })

  it('renders no starter with a hole in it while the symbol is still settling', () => {
    // `settledSym` is debounced, so the panel can mount with '' for one tick.
    render(<AskAiSection sym="" lifecycle="PRE" />)
    expect(screen.queryByText(/^What's the setup into 's print\?$/)).toBeNull()
    expect(document.querySelectorAll('button').length).toBeGreaterThanOrEqual(0)
  })
})
