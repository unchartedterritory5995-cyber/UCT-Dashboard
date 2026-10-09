// REGM: the market regime call. Rails:
//   * the label, the band READ from the published vocabulary, its guidance, the signals and why;
//   * the classifier's "could not answer" sentinel shows no regime and no band;
//   * a vocabulary that cannot be read shows the label without guessing a band;
//   * a failed read is an error with Retry; a 402 says paid plan;
//   * the registry: `REGM` resolves to this panel, market-only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import RegimePanel, { BAND_GUIDANCE, REGIME_URL, VOCAB_URL, bandFor } from './RegimePanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'

const VOCAB = {
  version: 1, closed: true,
  regimes: [{ id: 'bull_trend', label: 'Bull trend', band: 'GREEN' }, { id: 'bear_trend', label: 'Bear trend', band: 'RED' },
    { id: 'chop', label: 'Chop', band: 'YELLOW' }],
  bands: ['GREEN', 'YELLOW', 'ORANGE', 'RED'], band_default: 'YELLOW', unknown: { id: 'unknown', label: 'Unknown', band: 'YELLOW' },
}
const BEAR = {
  regime: 'bear_trend', label: 'Bear trend', confidence: 0.62, reasons: ['18% above 50MA (broken)', 'VIX 31.2 (fear)'],
  signals: { pct_above_50ma: 18, pct_above_200ma: 29, new_highs: 4, new_lows: 210, vix: 31.2, distribution_days: 7,
    uct_exposure_rating: 12, market_phase: 'Correction' },
  narration: 'x', vocabulary_version: 1,
}

function serve({ regime = BEAR, vocab = VOCAB } = {}) {
  jsonFetcher.mockImplementation(async (url) => {
    const hit = url === REGIME_URL ? regime : url === VOCAB_URL ? vocab : undefined
    if (hit instanceof Error) throw hit
    return hit
  })
}
function renderPanel() {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><RegimePanel /></SWRConfig>)
}

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('REGM panel', () => {
  it('shows the call, its band from the vocabulary, the guidance and the signals', async () => {
    serve()
    renderPanel()
    expect((await screen.findByTestId('terminal-regime-call')).textContent).toContain('Bear trend')
    expect((await screen.findByTestId('terminal-regime-band')).textContent).toBe('RED band')
    expect(screen.getByTestId('terminal-regime-guidance').textContent).toBe(BAND_GUIDANCE.RED)
    const fields = screen.getByTestId('terminal-regime-fields').textContent
    for (const s of ['62%', '12 of 150', '18%', '4 / 210', '31.20', 'Correction', '7']) expect(fields).toContain(s)
    expect(screen.getByTestId('terminal-regime-reasons').textContent).toContain('VIX 31.2')
    expect(screen.getByTestId('terminal-regime-asof').textContent).toMatch(/Read at .* ET/)
  })

  it('the sentinel is not a regime: no label, no band', async () => {
    serve({ regime: { regime: 'unknown', label: 'Unknown', confidence: 0, reasons: [], signals: {}, error: 'boom' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-regime-unknown')).textContent).toContain('not available')
    expect(screen.queryByTestId('terminal-regime-band')).toBeNull()
  })

  it('a vocabulary that cannot be read gives no guessed band', async () => {
    serve({ vocab: Object.assign(new Error('v'), { status: 500 }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-regime-call')).textContent).toContain('Bear trend')
    expect(screen.queryByTestId('terminal-regime-band')).toBeNull()
    expect(screen.getByTestId('terminal-regime-guidance').textContent).toContain('could not be read')
  })

  it('a failed read is an error with Retry; a 402 says paid plan', async () => {
    serve({ regime: Object.assign(new Error('down'), { status: 503 }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-regime-error')).textContent).toContain('could not be read just now')
    serve()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-regime-call')).toBeTruthy()
    cleanup()
    serve({ regime: Object.assign(new Error('p'), { status: 402 }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-regime-error')).textContent).toContain('paid plan')
  })

  it('bandFor reads the vocabulary and nothing else', () => {
    expect(bandFor(VOCAB, 'chop')).toBe('YELLOW')
    expect(bandFor(VOCAB, 'distribution')).toBeNull()
    expect(bandFor(null, 'chop')).toBeNull()
  })
})

describe('REGM in the registry', () => {
  it('REGM opens the regime panel, market-only', async () => {
    expect(BY_CODE.REGM.group).toBe('Market')
    expect(variantFor('REGM', false).variant.panel).toBe('Regime')
    expect(BY_CODE.REGM.ticker).toBeUndefined()
    expect((await PANEL_IMPORTERS.Regime()).default).toBe(RegimePanel)
  })
})
