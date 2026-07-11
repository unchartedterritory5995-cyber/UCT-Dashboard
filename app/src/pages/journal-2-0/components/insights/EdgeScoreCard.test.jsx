import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────
// EdgeScoreCard reads the live Scope via useScope (for the shareable link only —
// it does not fetch). Mock it to return a deterministic scope with ONE active
// facet so we can assert the sc_* param rides into the shared URL. Keeping the
// real A6 codec (scope.js) un-mocked verifies the actual serialization.
let scope
vi.mock('../../hooks/useScope', () => ({
  default: () => ({ scope }),
}))

// The `tradePng` feature flag gates ONLY the image actions (Copy link is always
// available). `vi.hoisted` gives a mutable holder the mock reads at call time.
const flag = vi.hoisted(() => ({ png: true }))
vi.mock('../../featureFlags', () => ({
  useFeatureFlag: () => flag.png,
}))

// The canvas PNG render + the download/clipboard helpers are mocked so the
// image actions can be asserted without a real canvas backend.
const mocks = vi.hoisted(() => ({
  renderEdgeCardPng: vi.fn(),
  downloadBlob: vi.fn(),
  copyBlobToClipboard: vi.fn(),
}))
vi.mock('../../lib/edgeCardPng', () => ({
  renderEdgeCardPng: mocks.renderEdgeCardPng,
}))
vi.mock('../../../../components/chart/chartScreenshot', () => ({
  downloadBlob: mocks.downloadBlob,
  copyBlobToClipboard: mocks.copyBlobToClipboard,
}))

import EdgeScoreCard from './EdgeScoreCard'

const FAKE_BLOB = new Blob(['png'], { type: 'image/png' })

const EDGE = {
  score: 1.234,
  components: { winRate: 0.55, profitFactor: 1.8, rConsistency: 0.62, tradeCount: 42 },
  trend: [],
}

// score null (n<10) — the honest "need 10+" state; some components still exist.
const NULL_EDGE = {
  score: null,
  components: { winRate: 0.5, profitFactor: null, rConsistency: null, tradeCount: 6 },
}

function setClipboard(value) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })
}

beforeEach(() => {
  scope = { acct: null, from: null, to: null, symbol: null, sides: [], setups: ['VCP'], tags: [] }
  flag.png = true
  mocks.renderEdgeCardPng.mockReset().mockResolvedValue(FAKE_BLOB)
  mocks.downloadBlob.mockReset()
  mocks.copyBlobToClipboard.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  // Restore a benign clipboard so a later test's absence-check is explicit.
  setClipboard({ writeText: vi.fn().mockResolvedValue() })
})

describe('EdgeScoreCard', () => {
  it('renders the score + all 4 components from mocked edge data', () => {
    render(<EdgeScoreCard edge={EDGE} />)
    expect(screen.getByText('1.234')).toBeInTheDocument()
    // The 4 component labels.
    expect(screen.getByText('Win Rate')).toBeInTheDocument()
    expect(screen.getByText('Profit Factor')).toBeInTheDocument()
    expect(screen.getByText('R Consistency')).toBeInTheDocument()
    expect(screen.getByText('Trades')).toBeInTheDocument()
    // At least one component value renders (win rate).
    expect(screen.getByText('55.0%')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('null score → the dim "need 10+" state (no fake number), components still shown', () => {
    render(<EdgeScoreCard edge={NULL_EDGE} />)
    // No fabricated score — the honest requirement copy is shown.
    expect(screen.queryByText('0.000')).not.toBeInTheDocument()
    expect(screen.getByText(/Need 10\+ trades with R-multiples/i)).toBeInTheDocument()
    // The big score slot renders a dim em-dash, not a number.
    const dash = screen.getByTestId('edge-score-null')
    expect(dash.textContent).toContain('—')
    expect(dash.className).toMatch(/dim/i)
    // Progress still visible: trade count component renders "6".
    expect(screen.getByText('Trades')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('Copy link → writeText gets a scoped URL (j2tab=analytics + ins=edge + sc_setup) and shows "Copied!"', async () => {
    const writeText = vi.fn().mockResolvedValue()
    setClipboard({ writeText })
    render(<EdgeScoreCard edge={EDGE} />)

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const url = writeText.mock.calls[0][0]
    expect(url).toContain('/journal?')
    expect(url).toContain('j2tab=analytics')
    expect(url).toContain('ins=edge')
    // Active scope rides along via the A6 codec.
    expect(url).toContain('sc_setup=VCP')

    expect(await screen.findByText(/copied/i)).toBeInTheDocument()
  })

  it('builds a shareable URL even with an empty (inactive) scope', async () => {
    scope = { acct: null, from: null, to: null, symbol: null, sides: [], setups: [], tags: [] }
    const writeText = vi.fn().mockResolvedValue()
    setClipboard({ writeText })
    render(<EdgeScoreCard edge={EDGE} />)

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    const url = writeText.mock.calls[0][0]
    expect(url).toContain('j2tab=analytics')
    expect(url).toContain('ins=edge')
    // No scope facet → no sc_ params.
    expect(url).not.toContain('sc_')
    expect(await screen.findByText(/copied/i)).toBeInTheDocument()
  })

  it('clipboard-absent path does not crash and shows a "copy failed" hint', async () => {
    setClipboard(undefined)
    render(<EdgeScoreCard edge={EDGE} />)
    // Should not throw when clicking with no clipboard API.
    expect(() => fireEvent.click(screen.getByRole('button', { name: /copy link/i }))).not.toThrow()
    expect(await screen.findByText(/copy failed|couldn't copy|copy the link/i)).toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = render(<EdgeScoreCard edge={EDGE} />)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  // ── Image actions (tradePng flag) ──────────────────────────────────────────

  it('flag ON + score present → "Save as image" downloads the rendered PNG', async () => {
    flag.png = true
    render(<EdgeScoreCard edge={EDGE} />)

    const saveBtn = screen.getByRole('button', { name: /save the edge score card as an image/i })
    expect(saveBtn).toBeInTheDocument()
    fireEvent.click(saveBtn)

    await waitFor(() => expect(mocks.renderEdgeCardPng).toHaveBeenCalledWith(EDGE))
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(FAKE_BLOB, 'edge-score.png'))
  })

  it('flag ON → "Copy image" copies the rendered PNG blob to the clipboard', async () => {
    flag.png = true
    render(<EdgeScoreCard edge={EDGE} />)

    fireEvent.click(screen.getByRole('button', { name: /copy the edge score card image/i }))

    await waitFor(() => expect(mocks.renderEdgeCardPng).toHaveBeenCalledWith(EDGE))
    await waitFor(() => expect(mocks.copyBlobToClipboard).toHaveBeenCalledWith(FAKE_BLOB))
  })

  it('image render failure surfaces an inline error, does not crash', async () => {
    flag.png = true
    mocks.renderEdgeCardPng.mockRejectedValue(new Error('boom'))
    render(<EdgeScoreCard edge={EDGE} />)

    fireEvent.click(screen.getByRole('button', { name: /save the edge score card as an image/i }))
    expect(await screen.findByText(/couldn't create the image/i)).toBeInTheDocument()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it('flag OFF → no image actions, but Copy link stays available', () => {
    flag.png = false
    render(<EdgeScoreCard edge={EDGE} />)

    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save the edge score card as an image/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /copy the edge score card image/i })).toBeNull()
  })

  it('null score → image actions hidden even with the flag ON (nothing to share)', () => {
    flag.png = true
    render(<EdgeScoreCard edge={NULL_EDGE} />)

    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save the edge score card as an image/i })).toBeNull()
  })
})
