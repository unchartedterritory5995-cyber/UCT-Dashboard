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
import { render, screen, fireEvent, act } from '@testing-library/react'
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

describe('CallSection — a recap claim links back to the passage it came from', () => {
  // The Quartr idea, and the trust mechanism: a reader can check the words in
  // one click. It only works because the recap and the transcript are separate
  // components sharing a parent — which is what Phase 0 made true.
  const GROUNDED = {
    ticker: 'DIS',
    recap: {
      headline: 'Record quarter',
      sentiment: 'positive',
      bullets: [],
      quotes: [],
      guidance: 'raised',
      qa_highlights: [],
      forward_looking: [{
        topic: 'Margins',
        horizon: 'full_year',
        detail: 'Management expects margin expansion.',
        // Verbatim from segment 0 of the mocked transcript above.
        quote: 'We now expect double-digit earnings growth for the full year.',
        speaker: 'Hugh Johnston',
        segment: 0,
      }],
    },
    webcast_url: null,
    rating_changes: [],
  }

  it('clicking the source link opens the transcript at that turn', async () => {
    recapData = GROUNDED
    const user = userEvent.setup()
    renderCall()

    // The transcript is collapsed and the passage is not on screen yet.
    expect(screen.queryByText(/When will ESPN/)).toBeNull()

    await user.click(screen.getByRole('button', { name: /in transcript/i }))

    // The panel opened itself and the cited turn is rendered.
    expect(
      screen.getAllByText(/double-digit earnings growth for the full year/i).length,
    ).toBeGreaterThan(1)   // once in the recap, once in the transcript
    expect(screen.getByText(/When will ESPN/)).toBeTruthy()
  })

  it('renders the forward-looking commentary the recap carries', () => {
    recapData = GROUNDED
    renderCall()
    expect(screen.getByText(/FORWARD-LOOKING COMMENTARY/i)).toBeTruthy()
    expect(screen.getByText(/Management expects margin expansion/)).toBeTruthy()
    expect(screen.getByText(/FULL YEAR/)).toBeTruthy()
  })

  it('shows no source link for a claim with no located passage', () => {
    // An ungrounded item should never have reached the client, but if `segment`
    // is absent the UI must not offer a link that goes nowhere.
    recapData = {
      ...GROUNDED,
      recap: { ...GROUNDED.recap,
        forward_looking: [{ ...GROUNDED.recap.forward_looking[0], segment: null }] },
    }
    renderCall()
    expect(screen.getByText(/Management expects margin expansion/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /in transcript/i })).toBeNull()
  })
})

describe('CallSection — the recap and the transcript always describe ONE call', () => {
  // The bug: TranscriptPanel owned the quarter internally, so stepping back to
  // an older call swapped the transcript while a recap of THIS quarter stayed
  // above it — silently mismatched, and worse than having no selector at all.
  const askedFor = []

  beforeEach(() => {
    askedFor.length = 0
    global.fetch = vi.fn(url => {
      if (String(url).includes('transcript-quarters')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          quarters: [{ quarter: '2026Q3' }, { quarter: '2019Q2' }] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) })
    })
  })

  it('asks the recap endpoint for the quarter the reader selected', async () => {
    vi.doMock('../../../hooks/useCallRecap', () => ({
      default: (sym, quarter) => { askedFor.push(quarter); return { data: recapData } },
    }))
    const { default: Fresh } = await import('./CallSection?quarterwire')
    const user = userEvent.setup()
    render(<Fresh sym="DIS" row={{ sym: 'DIS' }} lifecycle="PRINTED" />)

    await user.click(screen.getByRole('button', { name: /full transcript/i }))
    await act(async () => { await Promise.resolve() })
    fireEvent.change(screen.getByLabelText('Transcript quarter'), { target: { value: '2019Q2' } })

    // Latest first, then the explicitly chosen quarter — never stuck on latest.
    expect(askedFor[0]).toBeNull()
    expect(askedFor).toContain('2019Q2')
    vi.doUnmock('../../../hooks/useCallRecap')
  })

  it('names the quarter it has no recap for, instead of reading as a failure', () => {
    recapData = { ticker: 'DIS', recap: null, webcast_url: null, rating_changes: [] }
    renderCall()
    expect(screen.getByText(/no call recap yet/i)).toBeTruthy()
    expect(screen.queryByText(/No recap for 2019Q2/)).toBeNull()
  })
})
