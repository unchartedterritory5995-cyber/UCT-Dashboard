import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'

import EarningsResearchModal, { resolveTrapTargets, PANELS } from './EarningsResearchModal'
import { SECTIONS, normalizeSection } from './railSections'
import { NOT_ADVICE } from '../../constants/disclaimer'
import { countGoldHighlights } from '../research-kit/testing/restraint'

// A controllable mock (not a fixed factory return) — review round 1, item 5
// needs to override `grade` per-test to exercise the chip's defensive guard
// and the phantom-zero-weight fix without a second test file.
const mockUseExpectedMove = vi.fn(() => ({
  data: { live: null, history: [], history_since: null, grade: null }, isLoading: false,
}))
vi.mock('../../hooks/useExpectedMove', () => ({ default: (...args) => mockUseExpectedMove(...args) }))
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

// review round 1, item 7 — the phone Sheet branch had zero coverage. Partial
// mock (spread the real module) so Sheet's own `useIsTouch` import from the
// SAME module keeps working; only `useIsPhone` is overridable per-test.
const mockUseIsPhone = vi.fn(() => false)
vi.mock('../../hooks/useBreakpoint', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useIsPhone: (...args) => mockUseIsPhone(...args) }
})

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
  mockUseExpectedMove.mockReturnValue({
    data: { live: null, history: [], history_since: null, grade: null }, isLoading: false,
  })
  mockUseIsPhone.mockReturnValue(false)
})

afterEach(() => {
  // The body-scroll-lock tests (review round 1, item 3) mutate this global —
  // guarantee isolation even if an assertion above them throws mid-test.
  document.body.style.overflow = ''
})

describe('shell structure', () => {
  it('is a labelled modal dialog naming the symbol', () => {
    renderModal()
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.getAttribute('aria-label')).toMatch(/NVDA/)
  })

  it('renders every section as a TAB, derived from SECTIONS', () => {
    renderModal()
    const tabs = screen.getAllByRole('tab').map(t => t.textContent.trim())
    // Derived, never retyped: a hardcoded list here would pass against a rail
    // that had silently dropped or reordered a section.
    expect(tabs).toEqual(SECTIONS.map(s => s.label))
    expect(tabs).toContain('Setup')
    expect(tabs).toContain('Call')
  })

  it('Analysts and Filings are TABS, and nothing navigates away', () => {
    // These used to be links that CLOSED the modal and pushed /research — a
    // context switch in the middle of reading one company. Analyst & Ownership
    // has since merged into the broader Analysts section.
    renderModal()
    expect(screen.getByRole('tab', { name: /^Analysts$/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Filings/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Analysts/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Filings/i })).toBeNull()

    // The rail must contain NO link that leaves for /research. The explicit
    // "Open full report" button in the footer is a separate, deliberate act
    // and is not part of the rail.
    const rail = screen.getByRole('tablist').closest('nav')
    const escapes = [...rail.querySelectorAll('a[href]')]
      .filter(a => (a.getAttribute('href') || '').includes('/research'))
    expect(escapes.map(a => a.getAttribute('href'))).toEqual([])
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

// ── §4.5 poll interval teardown — every exit path (controller amendment #4,
//    promoted from Task 5's review) ─────────────────────────────────────────
// The suite above already proves teardown on MODAL CLOSE (unmount, in "polls
// actuals ONLY while open..."). The two paths below are the ones a shallow
// dependency-array read could still get wrong: stepping to another symbol
// (the parent hands the modal a fresh onPollActuals closure per row — the
// realistic step-to-a-new-reporter signal, since `row` itself isn't a poll
// effect dependency) and a lifecycle advance past IMMINENT while the SAME
// callback stays mounted (actuals arrive -> PRINTED). PRE never starts a
// timer in the first place (see "does NOT poll in PRE" above), so there is
// nothing to tear down on a PRE transition — IMMINENT -> PRINTED is the
// meaningful "state advance stops the poll" case the amendment is guarding.
describe('§4.5 poll interval teardown — every exit path', () => {
  const IMMINENT_NOW = Date.parse('2026-08-06T16:30:00-04:00')

  it('tears down on stepping to another symbol (new onPollActuals identity)', () => {
    vi.useFakeTimers()
    const onPollActuals1 = vi.fn()
    const onPollActuals2 = vi.fn()
    const { rerender } = renderModal({
      nowMs: IMMINENT_NOW, onPollActuals: onPollActuals1, isTodayReporter: true,
    })
    vi.advanceTimersByTime(45000)
    expect(onPollActuals1).toHaveBeenCalledTimes(1)

    rerender(withProviders(
      <EarningsResearchModal
        row={{ ...row, sym: 'AAPL' }} label="AFTER MARKET CLOSE" reportDate="2026-08-06" timing="amc"
        section={null} onSectionChange={() => {}} onClose={() => {}}
        onStepPrev={null} onStepNext={null} stepping={false}
        onPollActuals={onPollActuals2} isTodayReporter nowMs={IMMINENT_NOW}
      />,
    ))
    vi.advanceTimersByTime(45000)
    expect(onPollActuals1).toHaveBeenCalledTimes(1)   // old interval never fires again
    expect(onPollActuals2).toHaveBeenCalledTimes(1)   // new interval picked up cleanly
    vi.useRealTimers()
  })

  it('tears down when the lifecycle advances past IMMINENT (actuals arrive -> PRINTED)', () => {
    vi.useFakeTimers()
    const onPollActuals = vi.fn()
    const { rerender } = renderModal({ nowMs: IMMINENT_NOW, onPollActuals, isTodayReporter: true })
    vi.advanceTimersByTime(45000)
    expect(onPollActuals).toHaveBeenCalledTimes(1)

    rerender(withProviders(
      <EarningsResearchModal
        row={{ ...row, reported_eps: 0.98, eps_estimate: 0.94, surprise_pct: '+4.3%' }}
        label="AFTER MARKET CLOSE" reportDate="2026-08-06" timing="amc"
        section={null} onSectionChange={() => {}} onClose={() => {}}
        onStepPrev={null} onStepNext={null} stepping={false}
        onPollActuals={onPollActuals} isTodayReporter nowMs={IMMINENT_NOW}
      />,
    ))
    vi.advanceTimersByTime(90000)
    expect(onPollActuals).toHaveBeenCalledTimes(1)   // no further calls once PRINTED — no orphan interval
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

  // Review round 1, item 1: the previous version of this test only asserted
  // `dlg.contains(document.activeElement)` after a Tab press — true whether
  // or not the wrap logic ran at all, since jsdom never moves focus on Tab by
  // itself AND `offsetParent` is always null (so the `first`/`last` picking
  // at resolveTrapTargets was never exercised either). Gutting `onTrapKey`
  // with an early return left this at 26/26 green. Fixed two ways: the WRAP
  // DECISION is now a pure, directly-unit-tested helper (below), and this
  // integration test stubs `offsetParent` so the real visibility filter runs
  // and actually asserts WHERE focus lands, not just that it stayed put.
  it('wraps focus: Tab on the last focusable moves to the first, Shift+Tab on the first moves to the last', () => {
    const offsetParentSpy = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get')
      .mockReturnValue(document.body)
    try {
      renderModal({ onStepPrev: vi.fn(), onStepNext: vi.fn() })
      const dlg = screen.getByRole('dialog')
      const targets = resolveTrapTargets(dlg, document.activeElement)
      // Sanity: a real render has more than one focusable (close button,
      // rail tabs, rail links, stepper chevrons, footer actions) — if this
      // drops to 0-1 the wrap assertions below would pass vacuously again.
      expect(targets.items.length).toBeGreaterThan(2)

      targets.last.focus()
      fireEvent.keyDown(dlg, { key: 'Tab' })
      expect(document.activeElement).toBe(targets.first)

      targets.first.focus()
      fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(targets.last)
    } finally {
      offsetParentSpy.mockRestore()
    }
  })
})

// ── resolveTrapTargets — the wrap decision, unit-tested directly ────────────
// (review round 1, item 1). Pure DOM-in/DOM-out: no render(), no jsdom layout
// dependency to stub around.
describe('resolveTrapTargets (pure)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function makeButtons(n) {
    const container = document.createElement('div')
    const buttons = Array.from({ length: n }, (_, i) => {
      const b = document.createElement('button')
      b.textContent = `btn${i}`
      container.appendChild(b)
      return b
    })
    document.body.appendChild(container)
    return { container, buttons }
  }

  it('returns null for a falsy container', () => {
    expect(resolveTrapTargets(null, null)).toBeNull()
  })

  it('returns null when nothing inside is focusable', () => {
    const container = document.createElement('div')
    expect(resolveTrapTargets(container, null)).toBeNull()
  })

  it('picks first/last from VISIBLE items only (offsetParent-gated)', () => {
    const { container, buttons } = makeButtons(4)
    // Simulate real-browser layout: only buttons 0 and 3 are actually
    // visible (offsetParent non-null); 1 and 2 stay at jsdom's null default.
    Object.defineProperty(buttons[0], 'offsetParent', { value: document.body, configurable: true })
    Object.defineProperty(buttons[3], 'offsetParent', { value: document.body, configurable: true })
    const targets = resolveTrapTargets(container, null)
    expect(targets.first).toBe(buttons[0])
    expect(targets.last).toBe(buttons[3])
  })

  it('the currently-active element is eligible even with no offsetParent (jsdom fallback)', () => {
    const { container, buttons } = makeButtons(2)
    const targets = resolveTrapTargets(container, buttons[1])
    expect(targets.first).toBe(buttons[1])
    expect(targets.last).toBe(buttons[1])
  })
})

// ── footer + trust posture ───────────────────────────────────────────────────
describe('footer + §12', () => {
  it('pins View Chart, and no longer offers a way OUT of the modal', () => {
    // "Open full report" closed the modal and pushed /research. Owner: that
    // dropped the reader onto a new page mid-read. Every section it led to is
    // in the rail now, so the control has nothing left to open.
    renderModal()
    const footer = screen.getByTestId('erm-footer')
    expect(within(footer).getByText(/View Chart/i)).toBeTruthy()
    expect(within(footer).queryByText(/full (report|research)/i)).toBeNull()
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

// ── desktop body-scroll lock (review round 1, item 3) ────────────────────────
// The old modal being replaced locks body scroll (components/tiles/
// EarningsModal.jsx:163-165); the phone branch gets it for free from Sheet's
// own `lockScroll`, but the desktop branch silently dropped it — with
// `.canvas{overflow-y:auto}` sitting over a `position:fixed` backdrop,
// wheeling over the backdrop would scroll the page behind the modal.
describe('desktop body-scroll lock', () => {
  it('locks body scroll while open and restores the PRIOR value on close (never a hardcoded empty string)', () => {
    // A non-default starting value proves the restore is a real capture, not
    // `document.body.style.overflow = ''` — that would still read '' here,
    // not 'scroll'.
    document.body.style.overflow = 'scroll'
    const { unmount } = renderModal()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })
})

// ── backdrop click + focus restoration (review round 1, item 4) ─────────────
describe('backdrop click + focus restoration', () => {
  it('mousedown on the backdrop closes; mousedown that starts/ends inside the dialog does not', () => {
    // Uses fireEvent.mousedown specifically (not .click) so this FAILS if
    // the handler is ever changed from onMouseDown to onClick — a click
    // handler would still fire on a genuine click, but this test would never
    // dispatch one, so a silently-swapped handler shows up as onClose never
    // being called at all.
    const onClose = vi.fn()
    const { container } = renderModal({ onClose })
    const backdrop = container.firstChild
    const dlg = screen.getByRole('dialog')

    fireEvent.mouseDown(dlg)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the triggering element once the modal unmounts', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'open modal'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = renderModal()
    expect(document.activeElement).not.toBe(trigger)   // focus moved into the dialog on mount

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})

// ── grade chip resilience (review round 1, item 5) ───────────────────────────
// The brief-mandated useExpectedMove mock always returns grade: null, so
// nothing in the original suite ever rendered this branch. A cached older
// response or a future payload variant without `.inputs` would throw
// `Cannot read properties of undefined (reading 'map')` and take the WHOLE
// MODAL down, not just the chip.
describe('grade chip — malformed/partial payload resilience', () => {
  it('does not crash when grade.inputs is missing entirely', () => {
    mockUseExpectedMove.mockReturnValue({
      data: { live: null, history: [], history_since: null, grade: { letter: 'B', basis: null } },
      isLoading: false,
    })
    expect(() => renderModal()).not.toThrow()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('renders the chip and distinguishes an unknown weight from a genuine 0% (phantom-zero guard)', () => {
    mockUseExpectedMove.mockReturnValue({
      data: {
        live: null, history: [], history_since: null,
        grade: {
          letter: 'B+', basis: '3 of 4',
          inputs: [
            { label: 'Beat streak', weight: 0.4, detail: '4 of 4' },
            { label: 'Revisions', weight: null, detail: null },   // weight genuinely unknown
            { label: 'IV premium', weight: 0, detail: 'no chain' }, // genuinely zero-weighted
          ],
        },
      },
      isLoading: false,
    })
    renderModal()
    expect(screen.getByText('Setup Grade B+ · 3 of 4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /About Setup Grade/i }))
    const tip = screen.getByRole('tooltip').textContent
    expect(tip).toMatch(/Beat streak \(40%\)/)
    expect(tip).toMatch(/Revisions \(—\)/)
    expect(tip).not.toMatch(/Revisions \(0%\)/)
    // The other direction of the same guard: a real zero is a real number, not
    // an absence. Without this, "fixing" the phantom-zero by rendering — for
    // every falsy weight would still pass the assertions above.
    expect(tip).toMatch(/IV premium \(0%\)/)
    expect(tip).not.toMatch(/IV premium \(—\)/)
  })
})

// ── phone Sheet branch (review round 1, item 7) ──────────────────────────────
// Named in the task title ("...phone sheet") but had zero direct coverage.
describe('phone Sheet branch', () => {
  beforeEach(() => { mockUseIsPhone.mockReturnValue(true) })

  it('mounts the Sheet (portal) branch — labelled, and carrying the shared shell body', () => {
    const { container } = renderModal()
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.getAttribute('aria-label')).toMatch(/NVDA/)
    // Sheet renders via createPortal straight onto document.body — unlike
    // the desktop branch, which mounts in-place inside RTL's own render
    // container. This is the one structural signal that actually PROVES the
    // Sheet branch (not just "some role=dialog somewhere") mounted, without
    // relying on a CSS-module class name.
    expect(container.contains(dlg)).toBe(false)
    expect(document.body.contains(dlg)).toBe(true)
    expect(within(dlg).getByTestId('erm-footer')).toBeTruthy()
    expect(within(dlg).getByTestId('erm-not-advice')).toBeTruthy()
  })

  it('traps focus inside the sheet too', () => {
    // The `onKeyDown` trap handler is on the shell's own inner panelRef div
    // (`erm-phone-body`), a CHILD of Sheet's own role="dialog" panel — not on
    // the dialog element itself. Firing Tab on the outer dialog (as the
    // desktop version of this test does) would never reach it: React events
    // bubble UP from where dispatched, not down into children.
    const offsetParentSpy = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get')
      .mockReturnValue(document.body)
    try {
      renderModal({ onStepPrev: vi.fn(), onStepNext: vi.fn() })
      const phoneBody = screen.getByTestId('erm-phone-body')
      const targets = resolveTrapTargets(phoneBody, document.activeElement)
      expect(targets.items.length).toBeGreaterThan(2)
      targets.last.focus()
      fireEvent.keyDown(phoneBody, { key: 'Tab' })
      expect(document.activeElement).toBe(targets.first)
    } finally {
      offsetParentSpy.mockRestore()
    }
  })
})

describe('the whole report is reachable without leaving the modal', () => {
  it('EVERY section in the rail has a panel behind it', () => {
    // Structural, not visual: the canvas is empty for every section in this
    // harness (no data providers), so asserting rendered text would fail for
    // Setup too and prove nothing. What matters is that no section id can be
    // added to the rail without wiring a panel — that is the "built, green,
    // connected to nothing" failure this repo has shipped before.
    const missing = SECTIONS.filter(s => !PANELS[s.id]).map(s => s.id)
    expect(missing, `rail sections with no panel: ${missing.join(', ')}`).toEqual([])
  })

  it('Analysts and Filings resolve to real components', () => {
    expect(PANELS.analysts).toBeTruthy()
    expect(PANELS.filings).toBeTruthy()
    expect(typeof PANELS.analysts).toBe('function')
    expect(typeof PANELS.filings).toBe('function')
  })

  it('clicking a former LINK section selects a SECTION, it does not navigate', () => {
    // `section` is controlled by the parent, so the assertion is on what the
    // modal REQUESTS, not on aria-selected flipping under a no-op handler.
    const onSectionChange = vi.fn()
    renderModal({ onSectionChange })
    fireEvent.click(screen.getByRole('tab', { name: /^Analysts$/i }))
    expect(onSectionChange).toHaveBeenCalledWith('analysts')

    fireEvent.click(screen.getByRole('tab', { name: /^Filings/i }))
    expect(onSectionChange).toHaveBeenCalledWith('filings')
  })

  it('renders the panel when the parent HAS selected one of them', () => {
    renderModal({ section: 'analysts' })
    expect(screen.getByRole('tab', { name: /^Analysts$/i })
      .getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('erm-canvas')).toBeTruthy()
  })
})

describe('the modal never hands the reader off', () => {
  it('has NO control anywhere that navigates to /research', () => {
    // Owner: the divert dropped people onto a new page mid-read and lost them.
    // Asserted across the WHOLE modal, not just the rail, because the escape
    // that prompted this lived in the footer, not the navigator.
    const { container } = renderModal()
    const escapes = [...container.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => (h || '').includes('/research'))
    expect(escapes, `still links out to: ${escapes.join(', ')}`).toEqual([])
    expect(screen.queryByRole('button', { name: /open full report/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /unlock full research/i })).toBeNull()
  })

  it('every section /research offered is reachable IN the modal', () => {
    // Derived from the panel map, so a section cannot be listed in the rail
    // without a component behind it — the failure that ships a tab leading to
    // an empty canvas.
    for (const id of ['financials', 'analysts', 'filings']) {
      expect(PANELS[id], `no panel wired for "${id}"`).toBeTruthy()
    }
    const missing = SECTIONS.filter(s => !PANELS[s.id]).map(s => s.id)
    expect(missing, `rail sections with no panel: ${missing.join(', ')}`).toEqual([])
  })

  it('still offers View Chart — removing the divert did not remove the chart', () => {
    renderModal()
    expect(screen.getByText(/view chart/i)).toBeTruthy()
  })
})

describe('the rail is curated, and old links still land', () => {
  it('is SEVEN sections, not eleven', () => {
    // Eleven shallow entries split one question across three clicks and made
    // the rail scroll on phone. Fewer, deeper sections.
    expect(SECTIONS).toHaveLength(7)
    expect(SECTIONS.map(s => s.id)).toEqual(
      ['setup', 'history', 'brief', 'call', 'financials', 'analysts', 'filings'])
  })

  it('every id still has a panel', () => {
    const missing = SECTIONS.filter(s => !PANELS[s.id]).map(s => s.id)
    expect(missing, `sections with no panel: ${missing.join(', ')}`).toEqual([])
  })

  it('MERGED ids resolve to their new home rather than falling back to Setup', () => {
    // A bookmark or a shared ?section=statements link must land where the
    // reader meant. Silently defaulting to Setup is the failure here.
    expect(normalizeSection('statements')).toBe('financials')
    expect(normalizeSection('fundamentals')).toBe('financials')
    expect(normalizeSection('estimates')).toBe('analysts')
    expect(normalizeSection('ratings')).toBe('analysts')
    expect(normalizeSection('analyst')).toBe('analysts')
    expect(normalizeSection('ownership')).toBe('analysts')
  })

  it('a genuinely unknown id still falls back', () => {
    expect(normalizeSection('nonsense')).toBe('setup')
    expect(normalizeSection(null)).toBe('setup')
  })

  it('current ids are untouched by the merge map', () => {
    for (const s of SECTIONS) expect(normalizeSection(s.id)).toBe(s.id)
  })
})
