import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'

import EarningsResearchModal from './EarningsResearchModal'
import { SECTIONS } from './railSections'
import { NOT_ADVICE } from '../../constants/disclaimer'
import { countGoldHighlights } from '../research-kit/testing/restraint'

vi.mock('../../hooks/useExpectedMove', () => ({
  default: () => ({ data: { live: null, history: [], history_since: null, grade: null },
                    isLoading: false }),
}))
// Section bodies are Tasks 7-10; the shell test owns the shell.
vi.mock('./sections/SetupSection', () => ({ default: () => <div data-testid="panel-setup" /> }))
vi.mock('./sections/EarningsHistorySection', () => ({ default: () => <div data-testid="panel-history" /> }))
vi.mock('./sections/BriefSection', () => ({ default: () => <div data-testid="panel-brief" /> }))
vi.mock('./sections/CallSection', () => ({ default: () => <div data-testid="panel-call" /> }))

// The banner's price slot (controller amendment) rides the shared
// useLivePrices pool — a browser-wide singleton store tested on its own in
// livePriceStore.test.js. Stubbing it here (same idiom as
// TickerHubSheet.test.jsx) keeps this suite about the SHELL, not the store's
// own polling/dedup behavior.
const mockLivePrices = vi.fn(() => ({ prices: {} }))
vi.mock('../../hooks/useLivePrices', () => ({ default: (...args) => mockLivePrices(...args) }))

const row = { sym: 'NVDA', company: 'NVIDIA Corporation', sector: 'Technology',
              verdict: 'pending', eps_estimate: 0.94, reported_eps: null }

const NOW = Date.parse('2026-08-06T12:00:00-04:00')

// TickerPopup (the footer's "View Chart" trigger) reaches useFlagged/useTickerTags,
// both of which call useAuth() and THROW outside an AuthProvider — so every
// render needs one, not just MemoryRouter. AuthProvider's own mount fetch
// (`/api/auth/me`) is covered by the `global.fetch` stub below.
function withProviders(children) {
  return <AuthProvider><MemoryRouter>{children}</MemoryRouter></AuthProvider>
}

function renderModal(props = {}) {
  return render(withProviders(
    <EarningsResearchModal
      row={row} label="AFTER MARKET CLOSE" reportDate="2026-08-06" timing="amc"
      section={null} onSectionChange={() => {}} onClose={() => {}}
      onStepPrev={null} onStepNext={null} stepping={false}
      onPollActuals={null} isTodayReporter nowMs={NOW}
      {...props}
    />,
  ))
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
  mockLivePrices.mockReturnValue({ prices: {} })
})

describe('shell structure', () => {
  it('is a labelled modal dialog naming the symbol', () => {
    renderModal()
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.getAttribute('aria-label')).toMatch(/NVDA/)
  })

  it('renders the four launch sections as TABS', () => {
    renderModal()
    const tabs = screen.getAllByRole('tab').map(t => t.textContent.trim())
    expect(tabs).toEqual(['Setup', 'Earnings History', 'Brief', 'Call'])
    expect(SECTIONS.map(s => s.label)).toEqual(tabs)
  })

  it('renders Analyst & Ownership and Filings as LINKS, not tabs', () => {
    renderModal()
    const ao = screen.getByRole('link', { name: /Analyst & Ownership/i })
    const fl = screen.getByRole('link', { name: /Filings/i })
    expect(ao.getAttribute('href')).toBe('/research/NVDA?section=ownership')
    expect(fl.getAttribute('href')).toBe('/research/NVDA?section=filings')
    expect(screen.queryByRole('tab', { name: /Analyst & Ownership/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Filings/i })).toBeNull()
  })
})

// ── GATE b ────────────────────────────────────────────────────────────────────
describe('GATE b — landmarks are per-surface', () => {
  it('the modal contributes NO page landmarks for banner or footer', () => {
    renderModal()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('contentinfo')).toBeNull()
    // the identity + actions rows still RENDER, they are just not landmarks
    expect(screen.getByTestId('rk-banner-line')).toBeTruthy()
    expect(screen.getByTestId('erm-footer')).toBeTruthy()
  })

  it('the kit DEFAULT still produces landmarks (the research page keeps them)', async () => {
    const { default: IdentityBanner } = await import('../research-kit/shell/IdentityBanner')
    const { default: PinnedFooter } = await import('../research-kit/shell/PinnedFooter')
    const { unmount } = render(<><IdentityBanner sym="NVDA" timingText="x" />
                                 <PinnedFooter><button>go</button></PinnedFooter></>)
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('contentinfo')).toBeTruthy()
    unmount()
  })
})

// ── GATE c ────────────────────────────────────────────────────────────────────
describe('GATE c — inactive panels UNMOUNT', () => {
  it('only the active panel is in the DOM', () => {
    renderModal()
    expect(screen.getByTestId('panel-setup')).toBeTruthy()
    expect(screen.queryByTestId('panel-history')).toBeNull()
    expect(screen.queryByTestId('panel-brief')).toBeNull()
    expect(screen.queryByTestId('panel-call')).toBeNull()
  })

  it('switching sections unmounts the previous panel (never display:none)', () => {
    const onSectionChange = vi.fn()
    const { rerender } = renderModal({ onSectionChange })
    fireEvent.click(screen.getByRole('tab', { name: 'Earnings History' }))
    expect(onSectionChange).toHaveBeenCalledWith('history')
    rerender(withProviders(
      <EarningsResearchModal
        row={row} label="AFTER MARKET CLOSE" reportDate="2026-08-06" timing="amc"
        section="history" onSectionChange={onSectionChange} onClose={() => {}}
        onStepPrev={null} onStepNext={null} stepping={false}
        onPollActuals={null} isTodayReporter nowMs={NOW}
      />,
    ))
    expect(screen.getByTestId('panel-history')).toBeTruthy()
    expect(screen.queryByTestId('panel-setup')).toBeNull()
    const canvas = screen.getByTestId('erm-canvas')
    expect(canvas.querySelector('[hidden]')).toBeNull()
    expect(canvas.querySelector('[style*="display: none"]')).toBeNull()
  })

  it('an unknown section id falls back to setup rather than a blank canvas', () => {
    renderModal({ section: 'nonsense' })
    expect(screen.getByTestId('panel-setup')).toBeTruthy()
  })
})

// ── §4.5 wiring ───────────────────────────────────────────────────────────────
describe('§4.5 lifecycle', () => {
  it('PRE shows the timing line plus a countdown', () => {
    renderModal()
    expect(screen.getByTestId('rk-banner-line').textContent).toMatch(/AFTER MARKET CLOSE/i)
    expect(screen.getByText(/^in \d+h \d+m$/)).toBeTruthy()
  })

  it('IMMINENT replaces the timing copy — no stale "reports tonight" past T0', () => {
    renderModal({ nowMs: Date.parse('2026-08-06T16:30:00-04:00') })
    expect(screen.getByTestId('rk-banner-line').textContent).toMatch(/Awaiting numbers/i)
    expect(screen.queryByText(/^in \d/)).toBeNull()
  })

  it('PRINTED flips the banner to the result line', () => {
    renderModal({
      nowMs: Date.parse('2026-08-06T16:30:00-04:00'),
      row: { ...row, verdict: 'beat', reported_eps: 0.98, eps_estimate: 0.94,
             surprise_pct: '+4.3%' },
    })
    const line = screen.getByTestId('rk-banner-line').textContent
    expect(line).toMatch(/0\.98/)
    expect(line).toMatch(/0\.94/)
    expect(line).not.toMatch(/Awaiting/i)
  })

  it('polls actuals ONLY while open on a today-reporter in IMMINENT', () => {
    vi.useFakeTimers()
    const onPollActuals = vi.fn()
    const { unmount } = renderModal({
      nowMs: Date.parse('2026-08-06T16:30:00-04:00'), onPollActuals, isTodayReporter: true,
    })
    vi.advanceTimersByTime(46000)
    expect(onPollActuals).toHaveBeenCalledTimes(1)
    unmount()
    vi.advanceTimersByTime(46000)
    expect(onPollActuals).toHaveBeenCalledTimes(1)   // no orphan interval
    vi.useRealTimers()
  })

  it('does NOT poll in PRE', () => {
    vi.useFakeTimers()
    const onPollActuals = vi.fn()
    renderModal({ onPollActuals, isTodayReporter: true })
    vi.advanceTimersByTime(120000)
    expect(onPollActuals).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// ── price slot (controller amendment) ────────────────────────────────────────
// The plan's own coverage table deferred the banner's `price` slot to a later
// task; the controller overruled that for P2 — it rides the SAME shared
// useLivePrices pool every other surface uses (a one-symbol union add, not a
// new fetch surface), keyed off the RAW symbol so it never lags a step.
describe('price slot — wired via the shared useLivePrices pool', () => {
  it('shows the formatted live price when the pool has one', () => {
    mockLivePrices.mockReturnValue({ prices: { NVDA: { price: 182.4, change_pct: 1.8 } } })
    renderModal()
    expect(screen.getByText('$182.40 ▲1.8%')).toBeTruthy()
  })

  it('renders no crash and no price text when the pool has none', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByText(/^\$\d/)).toBeNull()
  })

  it('price follows the RAW symbol immediately, even mid-step-settle', () => {
    mockLivePrices.mockReturnValue({ prices: { AAPL: { price: 190, change_pct: -0.5 } } })
    const { rerender } = renderModal({ stepping: false })
    mockLivePrices.mockClear()
    rerender(withProviders(
      <EarningsResearchModal
        row={{ ...row, sym: 'AAPL' }} label="AFTER MARKET CLOSE" reportDate="2026-08-06" timing="amc"
        section={null} onSectionChange={() => {}} onClose={() => {}}
        onStepPrev={null} onStepNext={null} stepping
        onPollActuals={null} isTodayReporter nowMs={NOW}
      />,
    ))
    // stepping=true means the SECTION panels still key off the settling
    // (debounced) symbol — but the price slot must have already moved on.
    expect(mockLivePrices).toHaveBeenCalledWith(['AAPL'])
    expect(screen.getByText('$190.00 ▼0.5%')).toBeTruthy()
  })
})

// ── keyboard, focus, stepping ────────────────────────────────────────────────
describe('keyboard + stepping', () => {
  it('Escape closes', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('arrow keys step through the day, and are ignored inside an input', () => {
    const onStepNext = vi.fn(); const onStepPrev = vi.fn()
    renderModal({ onStepNext, onStepPrev })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onStepNext).toHaveBeenCalledTimes(1)
    expect(onStepPrev).toHaveBeenCalledTimes(1)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight', bubbles: true })
    expect(onStepNext).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('renders banner chevrons when stepping is available', () => {
    renderModal({ onStepPrev: vi.fn(), onStepNext: vi.fn() })
    const stepper = screen.getByTestId('rk-banner-stepper')
    expect(within(stepper).getAllByRole('button')).toHaveLength(2)
  })

  it('traps focus inside the dialog', () => {
    renderModal({ onStepPrev: vi.fn(), onStepNext: vi.fn() })
    const dlg = screen.getByRole('dialog')
    const focusables = dlg.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')
    const last = focusables[focusables.length - 1]
    last.focus()
    fireEvent.keyDown(dlg, { key: 'Tab' })
    expect(dlg.contains(document.activeElement)).toBe(true)
  })
})

// ── footer + trust posture ───────────────────────────────────────────────────
describe('footer + §12', () => {
  it('pins View Chart and Open full report', () => {
    renderModal()
    const footer = screen.getByTestId('erm-footer')
    expect(within(footer).getByText(/View Chart/i)).toBeTruthy()
    expect(within(footer).getByText(/full (report|research)/i)).toBeTruthy()
  })

  it('carries the standing not-advice line', () => {
    renderModal()
    expect(screen.getByTestId('erm-not-advice').textContent).toBe(NOT_ADVICE)
  })

  it('never uses the word "verdict" in user-facing copy', () => {
    const { container } = renderModal()
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })

  it('keeps the canvas inside the one-gold-highlight budget', () => {
    renderModal()
    expect(countGoldHighlights(screen.getByTestId('erm-canvas'))).toBeLessThanOrEqual(1)
  })
})
