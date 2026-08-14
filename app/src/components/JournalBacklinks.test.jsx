// Backlinks rails — the app seeing its own journal.
//
// The load-bearing one is the FETCH GATE: this chip's biggest host is
// TickerPopup, which renders a hover preview on every ticker chip in the
// app. A backlinks fetch that isn't gated on "the surface is actually open"
// fires one request per mouse-over, app-wide.
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SWRConfig } from 'swr'
import JournalBacklinks from './JournalBacklinks'

const H = { calls: [], payload: null }

beforeEach(() => {
  H.calls = []
  H.payload = {
    symbol: 'AMD',
    count: 3,
    notes: [
      { id: 'n1', title: 'AMD post-mortem', updatedAt: '2026-08-13T12:00:00Z', refs: 2, widgetIds: ['chart'] },
      { id: 'n2', title: 'Weekly review', updatedAt: '2026-08-10T12:00:00Z', refs: 1, widgetIds: ['chart'] },
    ],
  }
  vi.stubGlobal('fetch', vi.fn((url) => {
    H.calls.push(String(url))
    return Promise.resolve({ ok: true, json: () => Promise.resolve(H.payload) })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const draw = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <JournalBacklinks symbol="AMD" {...props} />
  </SWRConfig>,
)

describe('JournalBacklinks', () => {
  it('shows the count and clicks through to the entries', async () => {
    draw({ enabled: true })
    // The accessible name is the button's TEXT ("3 entries"); the longer
    // title is supplementary, so assert both rather than confusing them.
    const chip = await screen.findByRole('button', { name: /3 entries/i })
    expect(chip).toHaveAttribute('title', 'AMD appears in 3 journal entries')
    await userEvent.setup().click(chip)
    const link = await screen.findByText('AMD post-mortem')
    expect(link.closest('a').getAttribute('href')).toBe('/journal/journal?seg=notebook&note=n1')
    // count > rows returned → say so rather than silently truncating.
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('⛔ does NOT fetch until the host surface is open (the hover trap)', async () => {
    draw({ enabled: false })
    await waitFor(() => expect(H.calls).toEqual([]))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders NOTHING for a ticker with no entries — no "0 entries" noise', async () => {
    H.payload = { symbol: 'TSLA', count: 0, notes: [] }
    const { container } = draw({ enabled: true })
    await waitFor(() => expect(H.calls.length).toBe(1))
    expect(container.textContent).toBe('')
  })

  it('asks about the symbol it was handed', async () => {
    draw({ enabled: true, symbol: 'nvda' })
    await waitFor(() => expect(H.calls[0]).toContain('symbol=NVDA'))
  })
})
