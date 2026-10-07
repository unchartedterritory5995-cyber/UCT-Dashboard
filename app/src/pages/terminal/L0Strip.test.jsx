// app/src/pages/terminal/L0Strip.test.jsx — the L0 status strip (V7): clock,
// regime chip, alert-inbox affordance, active-channel chip, and the phone
// variant. Hooks are mocked matching the sibling idiom in this codebase
// (vi.mock('../../hooks/useMobileSWR', ...) / vi.mock('../../hooks/useMarketOpen', ...)
// — see MarketBreadth.wirestamp.test.jsx, ChartWidget.test.jsx et al.) and
// AlertBell's own context (AuthContext, react-router-dom) is supplied via
// wrappers rather than stubbed, since the affordance IS the real component.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

// ─── useMarketOpen — pin a known session so the clock/session assertions are
// honest about what the real hook's SHAPE produces (isOpen/isPremarket/isExtended),
// matching the idiom in ChartWidget.test.jsx / GridChartCell.test.jsx. ───────────
vi.mock('../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false }),
}))

// ─── useMobileSWR — the exact hook MarketBreadth.jsx reads `/api/breadth`
// through. Mocked per the idiom in MarketBreadth.wirestamp.test.jsx. ────────────
const breadthData = vi.hoisted(() => ({ current: { exposure: { score: 82 } } }))
vi.mock('../../hooks/useMobileSWR', () => ({
  default: (key) => (key ? { data: breadthData.current } : { data: undefined }),
}))

// ─── AlertBell itself is mocked at the component boundary. Its OWN behaviour
// (feed polling, sound, delivery-failure rendering, identity-reset) is already
// covered by AlertBell.test.jsx / AlertBell.delivery.test.jsx — this suite's
// job is only to prove L0Strip mounts the real affordance in the right place.
// ⚠️ This is also a NECESSARY mock, not just a scoping choice: AlertBell pulls
// in `hooks/usePreferences` → `components/chart/instanceShape` → the chart
// engine's AST module, which imports the `jsep` package — declared in
// package.json but NOT present in this box's installed node_modules (verified:
// the repo's own AlertBell.test.jsx fails on the identical
// `Failed to resolve import "jsep"` error, with no code from this change
// involved). Mocking AlertBell at the component boundary avoids pulling that
// chain in at all. ───────────────────────────────────────────────────────────
vi.mock('../../components/AlertBell', () => ({
  default: () => <div data-testid="alert-bell-stub">AlertBell</div>,
}))

import L0Strip from './L0Strip'

function renderStrip(props = {}, auth = { user: null }) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <L0Strip layout={{ panels: [{ channel: 'B' }], focus: 0, count: 1, activeChannel: 'A' }} isPhone={false} {...props} />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('L0Strip', () => {
  it('renders all four parts: clock, regime chip, alert-inbox affordance, active channel chip', () => {
    renderStrip()
    expect(screen.getByTestId('l0-clock')).toBeInTheDocument()
    expect(screen.getByTestId('l0-regime-chip')).toBeInTheDocument()
    expect(screen.getByTestId('l0-alert-bell')).toBeInTheDocument()
    expect(screen.getByTestId('l0-channel-chip')).toBeInTheDocument()
  })

  it('shows the clock in ET — the same America/New_York hour:minute format the real helper produces', () => {
    // Honest about the real format: `now.toLocaleTimeString('en-US', { timeZone:
    // 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })`
    // (MarketClock.jsx's own recipe) renders like "3:45 PM" — digits, a colon,
    // and an AM/PM suffix — plus this component's own "ET" unit label beside it.
    renderStrip()
    const clock = screen.getByTestId('l0-clock')
    expect(clock.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}\s?(AM|PM)/)
    expect(clock).toHaveTextContent('ET')
  })

  it('shows the market-regime/exposure value MarketBreadth already displays (data.exposure.score)', () => {
    renderStrip()
    expect(screen.getByTestId('l0-regime-chip')).toHaveTextContent('82')
  })

  it('reflects a different exposure score from the same shared data source', () => {
    breadthData.current = { exposure: { score: 24 } }
    renderStrip()
    expect(screen.getByTestId('l0-regime-chip')).toHaveTextContent('24')
    breadthData.current = { exposure: { score: 82 } } // restore for later tests
  })

  it('renders — for a missing exposure score rather than fabricating one', () => {
    breadthData.current = {}
    renderStrip()
    expect(screen.getByTestId('l0-regime-chip')).toHaveTextContent('—')
    breadthData.current = { exposure: { score: 82 } } // restore
  })

  it("renders activeChannelOf(layout) for a given layout fixture — the focused panel's own channel", () => {
    renderStrip()
    // layout.focus=0 -> panels[0].channel = 'B' -> activeChannelOf returns 'B'
    expect(screen.getByTestId('l0-channel-chip')).toHaveTextContent('B')
  })

  it(`names the chip as the active link GROUP (not "CH") and carries the group's stored colour`, () => {
    renderStrip({ layout: { panels: [{ channel: 'B' }], focus: 0, count: 1, activeChannel: 'A',
      channels: [{ id: 'B', name: 'Group B', color: '#60a5fa' }] } })
    const chip = screen.getByTestId('l0-channel-chip')
    expect(chip).toHaveTextContent('GROUP')
    expect(chip).not.toHaveTextContent(/CH/)
    expect(chip).toHaveAccessibleName('Active link group: Group B')
    expect(chip.querySelector('[style]').style.getPropertyValue('--dot')).toBe('#60a5fa')
  })

  it("falls back to layout.activeChannel when the focused panel is unlinked", () => {
    render(
      <AuthContext.Provider value={{ user: null }}>
        <MemoryRouter>
          <L0Strip
            layout={{ panels: [{ channel: null }], focus: 0, count: 1, activeChannel: 'C' }}
            isPhone={false}
          />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    expect(screen.getByTestId('l0-channel-chip')).toHaveTextContent('C')
  })

  describe('phone variant', () => {
    it('renders a compact strip when isPhone is true (data-phone attribute + abbreviated labels)', () => {
      renderStrip({ isPhone: true })
      const strip = screen.getByTestId('terminal-l0-strip')
      expect(strip).toHaveAttribute('data-phone', 'true')
      // Abbreviated exposure label on phone ("EXP" not "EXPOSURE")
      expect(screen.getByTestId('l0-regime-chip')).toHaveTextContent('EXP')
      expect(screen.getByTestId('l0-regime-chip')).not.toHaveTextContent('EXPOSURE')
    })

    it('omits seconds from the clock on phone (minute-precision only)', () => {
      renderStrip({ isPhone: true })
      const clock = screen.getByTestId('l0-clock')
      // hh:mm (AM|PM), no seconds group
      expect(clock.textContent).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/)
      expect(clock.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
    })

    it('still renders all four parts on phone — compact, not absent', () => {
      renderStrip({ isPhone: true })
      expect(screen.getByTestId('l0-clock')).toBeInTheDocument()
      expect(screen.getByTestId('l0-regime-chip')).toBeInTheDocument()
      expect(screen.getByTestId('l0-alert-bell')).toBeInTheDocument()
      expect(screen.getByTestId('l0-channel-chip')).toBeInTheDocument()
    })

    it('data-phone is false on the non-phone render', () => {
      renderStrip({ isPhone: false })
      expect(screen.getByTestId('terminal-l0-strip')).toHaveAttribute('data-phone', 'false')
    })
  })
})

// 2026-10-05 audit #11: the chip ignored `wire_status === 'stale'`, so yesterday's rating read
// as today's. Same rule as MarketBreadth's wire stamp: stale is dimmed and dated; unknown is not.
describe('L0Strip — a stale exposure reading says so', () => {
  it('stale: dimmed, labelled "as of <wire_date>", and the title says it is not today\'s', () => {
    breadthData.current = { exposure: { score: 55 }, wire_status: 'stale', wire_date: '2026-10-02' }
    try {
      renderStrip()
      const chip = screen.getByTestId('l0-regime-chip')
      expect(chip.dataset.stale).toBe('true')
      expect(screen.getByTestId('l0-regime-asof')).toHaveTextContent('as of 2026-10-02')
      expect(chip.getAttribute('title')).toMatch(/as of 2026-10-02.*not today/)
    } finally { breadthData.current = { exposure: { score: 82 } } }
  })

  it('fresh or unknown: no stale marking (asserting staleness we cannot support is the same error)', () => {
    for (const status of ['fresh', 'unknown', undefined]) {
      breadthData.current = { exposure: { score: 55 }, wire_status: status, wire_date: '2026-10-05' }
      const { unmount } = renderStrip()
      expect(screen.getByTestId('l0-regime-chip').dataset.stale).toBe('false')
      expect(screen.queryByTestId('l0-regime-asof')).toBeNull()
      unmount()
    }
    breadthData.current = { exposure: { score: 82 } }
  })
})

// Phone/a11y pass: the session state stays readable on phone, and the exposure chip's colour
// (its tone) is spoken, not only painted.
describe('L0Strip — phone session label and exposure tone in words', () => {
  it('phone keeps a short visible session label, with the full one as its accessible name', () => {
    renderStrip({ isPhone: true })
    const lbl = screen.getByTestId('l0-session-label')
    // What the eye sees: the short label, hidden from the accessibility tree…
    const short = screen.getByTestId('l0-session-short')
    expect(short.textContent).toBe('OPEN')
    expect(short.getAttribute('aria-hidden')).toBe('true')
    // …and what a screen reader reads: the full label as real (visually hidden) text. An
    // aria-label on the bare <span> was not exposed (a11y audit 2026-10-06).
    expect(lbl.querySelector('.sr-only').textContent).toBe('MARKET OPEN')
    expect(lbl.getAttribute('aria-label')).toBeNull()
  })

  it('desktop shows the full session label', () => {
    renderStrip({ isPhone: false })
    expect(screen.getByTestId('l0-session-label')).toHaveTextContent('MARKET OPEN')
  })

  it('the exposure chip names its score AND its tone for a screen reader', () => {
    renderStrip()
    expect(screen.getByRole('group', { name: /UCT Exposure Rating 82, bullish/ })).toBeInTheDocument()
  })

  it('a missing score is named as not available, with no invented tone', () => {
    breadthData.current = {}
    try {
      renderStrip()
      const chip = screen.getByTestId('l0-regime-chip')
      expect(chip.getAttribute('aria-label')).toBe('UCT Exposure Rating not available')
    } finally { breadthData.current = { exposure: { score: 82 } } }
  })
})
