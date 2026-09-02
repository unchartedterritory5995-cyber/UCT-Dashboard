import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BuzzRender from '../BuzzRender'

// ⚠️ DEVIATION FROM THE TASK BRIEF'S STEP-6 SNIPPET — disclosed in
// task-8-report.md. The brief's literal test text ("14 ppl", a separate
// 🔥-prefixed "heat line" reading "PLTR 6.3x") encodes the pre-reference
// Step-4 skeleton JSX, not the owner-reviewed v4 reference this component
// actually renders (which says "14 people", has NO emoji anywhere, and shows
// heat as a per-row "▲ 6.3×" marker using the multiplication sign, not the
// letter "x"). This file tests the REAL rendered behaviour instead.
const PAYLOAD = {
  window: 'open', label: 'since the open',
  rows: [{ ticker: 'NVDA', people: 14, mentions: 47, spark: [1, 2, 3] }],
  heat: [{ ticker: 'PLTR', ratio: 6.3 }],
  coverage: 'counted through 3:58p', asOf: 1,
}

const HOT_ROW_PAYLOAD = {
  window: 'open', label: 'since the open',
  rows: [
    { ticker: 'NVDA', people: 14, mentions: 47, spark: [1, 2, 3], hot: null },
    { ticker: 'PLTR', people: 5, mentions: 19, spark: [1, 2, 3], hot: 6.3 },
  ],
  heat: [{ ticker: 'PLTR', ratio: 6.3 }],
  coverage: 'counted through 3:58p', asOf: 1,
}

beforeEach(() => {
  window.__buzzReady = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) })))
})

describe('BuzzRender', () => {
  it('renders a row per ticker with people and mentions', async () => {
    render(<BuzzRender />)
    // NVDA legitimately appears twice once data lands: once in the prose
    // lead ("NVDA owned the room...") and once as the row symbol — the lead
    // names whichever ticker leads, by design, so this asserts presence
    // rather than a single unique match.
    await waitFor(() => expect(screen.getAllByText('NVDA').length).toBeGreaterThan(0))
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('14 people')).toBeInTheDocument()
  })

  it('shows the heat marker on a row the heat board flagged', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(HOT_ROW_PAYLOAD) })))
    render(<BuzzRender />)
    // '▲ 6.3×' is unique to the row-level heat marker (the prose lead's
    // mention of the same ratio has no ▲ glyph), so this is unambiguous.
    expect(await screen.findByText('▲ 6.3×')).toBeInTheDocument()
  })

  it('does not claim ready before data arrives', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<BuzzRender />)
    expect(window.__buzzReady).toBeUndefined()
  })

  it('renders "Unavailable" rather than a blank board on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })))
    render(<BuzzRender />)
    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
  })
})
