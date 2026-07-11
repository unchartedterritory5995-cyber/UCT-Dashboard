import { render, screen } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import DayCell from './DayCell'

const cell = { date: '2026-06-09', day: 9, inMonth: true }

function renderCell(props) {
  return render(
    <MemoryRouter>
      <DayCell cell={cell} {...props} />
    </MemoryRouter>,
  )
}

describe('DayCell P&L display', () => {
  it('closed basis: hides $ on a no-trade day (only color tint)', () => {
    // A day with a net-liq delta but no closed trades — closed basis must NOT
    // render a dollar figure (legacy behavior).
    renderCell({
      summary: { pnlDollar: 312.5, pnlPercent: 0.02, rSum: 0, tradeCount: 0 },
      mode: 'pct',
      basis: 'closed',
    })
    expect(screen.queryByText(/\$312/)).toBeNull()
  })

  it('account basis: shows the daily $ change on a no-trade day', () => {
    renderCell({
      summary: { pnlDollar: 312.5, pnlPercent: 0.02, rSum: 0, tradeCount: 0 },
      mode: 'pct',
      basis: 'account',
    })
    expect(screen.getByText(/\$312/)).toBeInTheDocument()
  })

  it('account basis: shows a negative daily $ change too', () => {
    renderCell({
      summary: { pnlDollar: -158.0, pnlPercent: -0.012, rSum: 0, tradeCount: 0 },
      mode: 'pct',
      basis: 'account',
    })
    expect(screen.getByText(/-\$158/)).toBeInTheDocument()
  })

  it('shows $ on a trade day under either basis', () => {
    renderCell({
      summary: { pnlDollar: 500, pnlPercent: 0.03, rSum: 1.2, tradeCount: 2 },
      mode: 'pct',
      basis: 'closed',
    })
    expect(screen.getByText(/\$500/)).toBeInTheDocument()
    expect(screen.getByText(/2 trades/)).toBeInTheDocument()
  })
})

describe('DayCell tilt glyph', () => {
  // Set the psychology override directly on localStorage BEFORE render (the flag
  // hook reads it on the first paint) — no event dispatch, so no act() churn.
  afterEach(() => localStorage.removeItem('uct.j2.feature.psychology'))

  const tiltSummary = { pnlDollar: -150, pnlPercent: -0.01, rSum: -2, tradeCount: 3, tilt: true }

  it('renders the tilt glyph when tilt=true and the psychology flag is on (default)', () => {
    renderCell({ summary: tiltSummary, mode: 'pct' })
    expect(screen.getByTitle(/Tilt day/)).toBeInTheDocument()
  })

  it('renders no tilt glyph when tilt is false', () => {
    renderCell({
      summary: { pnlDollar: 200, pnlPercent: 0.01, rSum: 1, tradeCount: 2, tilt: false },
      mode: 'pct',
    })
    expect(screen.queryByTitle(/Tilt day/)).toBeNull()
  })

  it('renders no tilt glyph when the psychology flag is off', () => {
    localStorage.setItem('uct.j2.feature.psychology', '0')
    renderCell({ summary: tiltSummary, mode: 'pct' })
    expect(screen.queryByTitle(/Tilt day/)).toBeNull()
  })
})
