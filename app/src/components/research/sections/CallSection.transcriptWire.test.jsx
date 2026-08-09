// The WIRE test for the Call panel.
//
// Every other suite in this folder mocks `CallRecapSection` so it can assert
// what CallSection HANDS it. That is the right shape for a props contract, and
// it is exactly why this defect shipped: with the child gutted to a stub, a
// transcript that is structurally unreachable still renders a green suite.
//
// So this file mocks ONLY the data hooks. The real CallSection, the real
// TranscriptPanel and the real recap component all mount, and the assertion is
// about what a user can actually reach on screen.
//
// The defect: the transcript panel lived INSIDE CallRecapSection, which
// CallSection renders only in its `recap` branch. The verbatim transcript is an
// independent source (FMP Ultimate — uncapped, cached 30d, no LLM), so binding
// its visibility to an LLM artifact meant any recap failure hid a working free
// data source. Measured against the reported case on 2026-08-08: DIS had 81
// quarters available and FY26Q3 published three days earlier, while the panel
// said "No transcript yet".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CallSection from './CallSection'

let recapData = { ticker: 'DIS', recap: null, webcast_url: null, rating_changes: [] }
let transcriptData = {
  symbol: 'DIS',
  quarter: '2026Q3',
  resolved: true,
  segments: [
    { speaker: 'Hugh Johnston', title: '', sentiment: null,
      content: 'We now expect double-digit earnings growth for the full year.' },
    { speaker: 'Benjamin Daniel Swinburne, C.F.A.', title: '', sentiment: null,
      content: 'When will ESPN direct-to-consumer materially boost traffic?' },
  ],
}

vi.mock('../../../hooks/useCallRecap', () => ({ default: () => ({ data: recapData }) }))
vi.mock('../../../hooks/useEarningsAudio', () => ({ default: () => ({ data: null }) }))
vi.mock('../../../hooks/useSentiment', () => ({
  default: () => ({ data: { score: 0.7, label: 'bullish', drivers: [] } }),
}))
vi.mock('../../../hooks/useTranscript', () => ({
  default: (_sym, { enabled } = {}) =>
    (enabled ? { data: transcriptData, isLoading: false } : { data: undefined, isLoading: false }),
}))

const renderCall = (props = {}) =>
  render(<CallSection sym="DIS" row={{ sym: 'DIS' }} lifecycle="PRINTED" {...props} />)

beforeEach(() => {
  recapData = { ticker: 'DIS', recap: null, webcast_url: null, rating_changes: [] }
})

describe('CallSection — the transcript is not gated on the recap', () => {
  it('reaches the verbatim transcript when NO recap has been generated', async () => {
    const user = userEvent.setup()
    renderCall()

    // The affordance exists at all — this is what "unreachable" means.
    const toggle = screen.getByRole('button', { name: /full transcript/i })
    await user.click(toggle)

    expect(
      screen.getByText(/double-digit earnings growth for the full year/i),
    ).toBeTruthy()
  })

  it('still reaches the transcript when a recap IS present', async () => {
    // The fix must not trade one branch for the other.
    recapData = {
      ticker: 'DIS',
      recap: { headline: 'Beat on adjusted EPS', sentiment: 'positive',
               bullets: ['Record Experiences revenue'], quotes: [],
               guidance: 'raised', qa_highlights: [] },
      webcast_url: null,
      rating_changes: [],
    }
    const user = userEvent.setup()
    renderCall()

    await user.click(screen.getByRole('button', { name: /full transcript/i }))
    expect(
      screen.getByText(/double-digit earnings growth for the full year/i),
    ).toBeTruthy()
  })

  it('never claims "no transcript" — the recap branch never checked for one', () => {
    renderCall()
    // "No call recap yet" is honest; the old hint asserted a fact about a
    // source this branch never queried.
    expect(screen.queryByText(/no transcript yet/i)).toBeNull()
  })
})
