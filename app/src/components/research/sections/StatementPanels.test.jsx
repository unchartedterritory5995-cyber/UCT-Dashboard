import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { money, PANEL_SPECS, yoyShift, PANEL_HEIGHT, EXPANDED_HEIGHT, spanLabel } from './statementSeries'

const captured = []
vi.mock('../../research-kit', () => ({
  SeriesChart: (props) => { captured.push(props); return <div data-testid="chart" /> },
}))

const SERIES = {
  revenue: [1e9, 2e9, 3e9], operating_income: [1e8, 2e8, 3e8],
  net_income: [5e7, 6e7, 7e7], free_cash_flow: [1e8, 1e8, 2e8],
  gross_profit: [5e8, 6e8, 7e8], operating_expenses: [4e8, 4e8, 5e8],
  eps: [1.1, 1.2, 1.3],
  total_assets: [9e9, 9e9, 1e10], total_liabilities: [4e9, 4e9, 5e9],
}
// The real payload echoes the period it was fetched for. Memoised per key the
// way SWR's `data` is referentially stable — a fresh object every render
// would defeat the card memo the real hook never defeats.
const payloads = new Map()
const payload = (key) => {
  if (!payloads.has(key)) {
    payloads.set(key, {
      sym: 'AAPL',
      period: /period=annual/.test(key) ? 'annual' : 'quarter',
      periods: ['Q1 2025', 'Q2 2025', 'Q3 2025'],
      series: SERIES,
    })
  }
  return payloads.get(key)
}

// What useSWR answers with. 'ok' = a full payload for the key · 'empty' =
// resolved with no periods · 'null' = the fetcher's non-OK null · 'first-load'
// = nothing yet · 'inflight' = a flip in progress, where keepPreviousData
// hands back the PREVIOUS (quarterly) payload with isLoading set.
let mode = 'ok'
let url = null
vi.mock('swr', () => ({
  default: (key) => {
    url = key
    if (!key) return { data: null, isLoading: false }
    if (mode === 'first-load') return { data: undefined, isLoading: true }
    if (mode === 'inflight') return { data: payload('period=quarter'), isLoading: true }
    if (mode === 'empty') return { data: { ...payload(key), periods: [], series: {} }, isLoading: false }
    if (mode === 'null') return { data: null, isLoading: false }
    return { data: payload(key), isLoading: false }
  },
}))

import StatementPanels from './StatementPanels'

beforeEach(() => { mode = 'ok'; captured.length = 0 })

describe('money — a statement axis spans nine orders of magnitude', () => {
  it('scales into T / B / M / K', () => {
    expect(money(1.59e9)).toBe('$1.59B')
    expect(money(4.88e7)).toBe('$48.8M')
    expect(money(2.5e12)).toBe('$2.50T')
    expect(money(1500)).toBe('$1.5K')
  })

  it('keeps the sign — an operating LOSS must not read as a gain', () => {
    expect(money(-4.88e7)).toBe('-$48.8M')
    expect(money(-2.1e9)).toBe('-$2.10B')
  })

  it('renders a dash for missing rather than $0', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
    expect(money('n/a')).toBe('—')
  })
})

describe('spanLabel', () => {
  it('counts in the unit of the data, singular when there is one', () => {
    expect(spanLabel(['Q1 2025', 'Q2 2025'], 'quarter')).toBe('2 quarters · Q1 2025 – Q2 2025')
    expect(spanLabel(['2024'], 'annual')).toBe('1 year · 2024 – 2024')
    expect(spanLabel([], 'quarter')).toBeNull()
  })
})

describe('StatementPanels', () => {
  it('renders one chart per declared panel', () => {
    render(<StatementPanels sym="AAPL" />)
    expect(captured).toHaveLength(PANEL_SPECS.length)
    expect(captured.every(c => c.mode === 'bars')).toBe(true)
  })

  it('pairs the series where the RELATIONSHIP is the point', () => {
    render(<StatementPanels sym="AAPL" />)
    // Ghost (year-ago) series are context; the pairing claim is about the
    // real ones.
    const names = captured.map(c =>
      c.series.filter(s => !/yr ago/.test(s.name)).map(s => s.name))
    expect(names).toContainEqual(['Revenue', 'Operating income'])
    expect(names).toContainEqual(['Gross profit', 'Operating expenses'])
    expect(names).toContainEqual(['Total assets', 'Total liabilities'])
  })

  it('every series carries an explicit colour', () => {
    // No PALETTE[i] anywhere: assets vs liabilities must not swap hues because
    // someone reordered the pair.
    render(<StatementPanels sym="AAPL" />)
    expect(captured.flatMap(c => c.series).every(s => !!s.color)).toBe(true)
  })

  it('defaults to quarterly and switches the REQUEST on toggle', () => {
    render(<StatementPanels sym="AAPL" />)
    expect(url).toContain('period=quarter')
    fireEvent.click(screen.getByRole('button', { name: /^Annual$/i }))
    expect(url).toContain('period=annual')
  })

  it('states the span so the reader knows how much history they are seeing', () => {
    render(<StatementPanels sym="AAPL" />)
    expect(document.body.textContent).toContain('Q1 2025')
    expect(document.body.textContent).toContain('3 quarters')
  })

  it('renders nothing without a symbol', () => {
    const { container } = render(<StatementPanels sym={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('a resolved absence says so AND keeps the controls, so the reader can flip back', () => {
    mode = 'empty'
    render(<StatementPanels sym="AAPL" />)
    expect(screen.getByText(/unavailable for this ticker/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Quarterly$/i })).toBeTruthy()
    expect(captured).toHaveLength(0)
  })

  it('the skeleton and the data card share one shell', () => {
    // Same title row, same box — PANEL_HEIGHT reserves one height, so nothing
    // shifts when the data lands. Just no door yet.
    mode = 'first-load'
    render(<StatementPanels sym="AAPL" />)
    const sections = document.querySelectorAll('section')
    expect(sections).toHaveLength(PANEL_SPECS.length)
    expect(sections[0].textContent).toContain('Income statement')
    expect(document.querySelectorAll('button')).toHaveLength(0)
  })
})

describe('yoyShift — the comparable period, not the previous one', () => {
  it('shifts four back for quarters', () => {
    const v = [10, 20, 30, 40, 50, 60]
    expect(yoyShift(v, 'quarter')).toEqual([null, null, null, null, 10, 20])
  })

  it('shifts one back for years', () => {
    expect(yoyShift([1, 2, 3], 'annual')).toEqual([null, 1, 2])
  })

  it('the un-comparable head is NULL, never zero', () => {
    // A zero bar reads as a business that earned nothing that quarter.
    const out = yoyShift([5, 6, 7, 8, 9], 'quarter')
    expect(out.slice(0, 4)).toEqual([null, null, null, null])
    expect(out.includes(0)).toBe(false)
  })

  it('survives empty input', () => {
    expect(yoyShift(null, 'quarter')).toEqual([])
    expect(yoyShift([], 'quarter')).toEqual([])
  })
})

describe('the ghost bar is context, not the subject', () => {
  it('draws the year-ago series BEHIND the current one', () => {
    render(<StatementPanels sym="AAPL" />)
    const income = captured.find(c => c.series.some(s => s.name === 'Revenue'))
    // ECharts paints in series order, so the ghost must come first.
    expect(income.series[0].name).toMatch(/yr ago/)
    expect(income.series.at(-1).name).toBe('Operating income')
  })

  it('can be turned off, leaving only the current series', () => {
    render(<StatementPanels sym="AAPL" />)
    captured.length = 0
    fireEvent.click(screen.getByRole('checkbox', { name: /year-ago/i }))
    const income = captured.find(c => c.series.some(s => s.name === 'Revenue'))
    expect(income.series.every(s => !/yr ago/.test(s.name))).toBe(true)
  })
})

describe('expand — any panel pops out into a larger modal', () => {
  const openIncome = () => {
    render(<StatementPanels sym="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /expand income statement/i }))
    return screen.getByRole('dialog', { name: /income statement/i })
  }

  it('the expand button opens a dialog named for THAT panel, and only that one', () => {
    expect(openIncome()).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /net income/i })).toBeNull()
  })

  it('draws the SAME series as the card, at the expanded height', () => {
    openIncome()
    const card = captured.find(c => c.height === PANEL_HEIGHT && c.series.some(s => s.name === 'Revenue'))
    const big = captured.filter(c => c.height === EXPANDED_HEIGHT)
    expect(big.length).toBeGreaterThanOrEqual(1)
    const last = big.at(-1)
    // Same names, same values, same order — including the ghost bars. A modal
    // that rebuilt its own series list is a second copy waiting to drift.
    expect(last.series.map(s => s.name)).toEqual(card.series.map(s => s.name))
    expect(last.series.map(s => s.values)).toEqual(card.series.map(s => s.values))
    expect(last.mode).toBe('bars')
  })

  it('opening the pop-out re-renders zero cards', () => {
    render(<StatementPanels sym="AAPL" />)
    captured.length = 0
    fireEvent.click(screen.getByRole('button', { name: /expand income statement/i }))
    // Six ECharts canvases behind a backdrop must not re-lay out for a state
    // change that does not touch them.
    expect(captured.filter(c => c.height === PANEL_HEIGHT)).toHaveLength(0)
    expect(captured.filter(c => c.height === EXPANDED_HEIGHT)).toHaveLength(1)
  })

  it('Escape closes the expanded chart WITHOUT reaching the host modal', () => {
    // The earnings modal closes itself on a window-level Escape. A nested
    // Escape must close the chart only — the reader lands back on the
    // Financials tab, not on the calendar.
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    try {
      const dlg = openIncome()
      fireEvent.keyDown(dlg, { key: 'Escape' })
      expect(screen.queryByRole('dialog', { name: /income statement/i })).toBeNull()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', spy)
    }
  })

  it('←/→ inside the pop-out never reach the host, which would step to another reporter', () => {
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    try {
      render(<StatementPanels sym="AAPL" />)
      const expand = screen.getByRole('button', { name: /expand income statement/i })
      // Control: from the page itself the key DOES reach the window, so a
      // silent spy below is the guard working, not a spy that cannot hear.
      fireEvent.keyDown(expand, { key: 'ArrowRight' })
      expect(spy).toHaveBeenCalledTimes(1)
      fireEvent.click(expand)
      const dlg = screen.getByRole('dialog', { name: /income statement/i })
      fireEvent.keyDown(within(dlg).getByRole('button', { name: /^Annual$/i }), { key: 'ArrowRight' })
      fireEvent.keyDown(dlg, { key: 'ArrowLeft' })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('dialog', { name: /income statement/i })).toBeTruthy()
    } finally {
      window.removeEventListener('keydown', spy)
    }
  })

  it('Tab wraps inside the pop-out instead of walking out behind two backdrops', () => {
    const dlg = openIncome()
    const focusables = [...dlg.querySelectorAll('button, input')]
    const first = focusables[0]
    const last = focusables.at(-1)
    expect(focusables.length).toBeGreaterThan(2)
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('the page behind is inert while the pop-out is open, and live again after', () => {
    // The page's controls are the SAME controls; a screen reader must not
    // meet two "Reporting period" groups, and Tab must not land behind.
    openIncome()
    const page = document.querySelector('[inert]')
    expect(page).toBeTruthy()
    expect(page.textContent).toContain('Cash flow')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('the period toggle inside the modal changes the REQUEST and keeps it open', () => {
    const dlg = openIncome()
    fireEvent.click(within(dlg).getByRole('button', { name: /^Annual$/i }))
    expect(url).toContain('period=annual')
    expect(screen.getByRole('dialog', { name: /income statement/i })).toBeTruthy()
  })

  it('while a flip is in flight the previous bars stay, captioned as loading, with THEIR year-ago shift', () => {
    const dlg = openIncome()
    mode = 'inflight'
    captured.length = 0
    fireEvent.click(within(dlg).getByRole('button', { name: /^Annual$/i }))
    expect(url).toContain('period=annual')
    const d = screen.getByRole('dialog', { name: /income statement/i })
    expect(within(d).getByText('Loading…')).toBeTruthy()
    const big = captured.filter(c => c.height === EXPANDED_HEIGHT)
    expect(big.length).toBeGreaterThanOrEqual(1) // no skeleton swap, no re-init
    // The bars on screen are still the quarterly ones, so the ghost is shifted
    // by FOUR (the data's period), not by one (the toggle's).
    const ghost = big.at(-1).series.find(s => s.name === 'Revenue (yr ago)')
    expect(ghost.values).toEqual(yoyShift(SERIES.revenue, 'quarter'))
    expect(ghost.values).not.toEqual(yoyShift(SERIES.revenue, 'annual'))
  })

  it('a resolved absence inside the pop-out says so — never "Loading…"', () => {
    const dlg = openIncome()
    mode = 'empty'
    fireEvent.click(within(dlg).getByRole('button', { name: /^Annual$/i }))
    const d = screen.getByRole('dialog', { name: /income statement/i })
    expect(within(d).getByText(/unavailable for this ticker/i)).toBeTruthy()
    expect(within(d).queryByText(/Loading/)).toBeNull()
    // And the way back is still there, inside the pop-out.
    expect(within(d).getByRole('button', { name: /^Quarterly$/i })).toBeTruthy()
  })

  it('clicking the card itself opens it — the icon is the hint, not the only door', () => {
    render(<StatementPanels sym="AAPL" />)
    fireEvent.click(screen.getByText('Cash flow'))
    expect(screen.getByRole('dialog', { name: /cash flow/i })).toBeTruthy()
  })

  it('the close button dismisses it', () => {
    const dlg = openIncome()
    fireEvent.click(within(dlg).getByRole('button', { name: /^Close$/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when the symbol changes — another company is another pop-out', () => {
    const { rerender } = render(<StatementPanels sym="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /expand income statement/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    rerender(<StatementPanels sym="MSFT" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
