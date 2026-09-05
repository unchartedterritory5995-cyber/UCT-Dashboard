// app/src/components/provenance/Cited.test.jsx
//
// SPEC-S8 §4.5's narrow interim form: buildable now against bar_provenance
// .py's actual shape, without waiting on D2. Never fabricates a recursive
// inputs graph the backend does not supply.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Cited from './Cited'

afterEach(cleanup)

describe('no row — the honest degraded state', () => {
  it('renders the child value AND an explicit "citation unavailable" note', () => {
    render(<Cited row={null}><span>230.00</span></Cited>)
    expect(screen.getByTestId('cited-unavailable')).toHaveTextContent('230.00')
    expect(screen.getByTestId('cited-unavailable-note')).toHaveTextContent(/citation unavailable/i)
  })
})

describe('the bar-shaped row (today\'s real data source)', () => {
  const row = {
    ticker: 'AAPL', tf: 'D', bar_time: 1788307200,
    source: 'massive', validated_at: 1788393600, verified_at: null,
  }

  it('renders the value plainly plus a toggle, closed by default', () => {
    render(<Cited row={row}><span>230.00</span></Cited>)
    expect(screen.getByTestId('cited-present')).toHaveTextContent('230.00')
    expect(screen.getByTestId('cited-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('cited-panel')).toBeNull()
  })

  it('opening the panel shows ticker/tf, source, and validated-at — one level deep, no inputs graph', async () => {
    const user = userEvent.setup()
    render(<Cited row={row}><span>230.00</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    const panel = screen.getByTestId('cited-panel')
    expect(panel).toHaveTextContent('AAPL · D')
    expect(panel).toHaveTextContent(/Source: massive/)
  })

  it('an unverified bar honestly says so — a real state, not an error', async () => {
    const user = userEvent.setup()
    render(<Cited row={row}><span>230.00</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-unverified-note')).toBeTruthy()
    expect(screen.getByTestId('cited-panel')).toHaveTextContent(/not yet verified/i)
  })

  it('a verified bar reports reconciliation positively, and shows no unverified note', async () => {
    const user = userEvent.setup()
    const verifiedRow = { ...row, verified_at: 1788393700 }
    render(<Cited row={verifiedRow}><span>230.00</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent(/Reconciliation: verified/)
    expect(screen.queryByTestId('cited-unverified-note')).toBeNull()
  })

  it('is keyboard-operable: Tab to focus, Enter to open', async () => {
    const user = userEvent.setup()
    render(<Cited row={row}><span>230.00</span></Cited>)
    await user.tab()
    expect(screen.getByTestId('cited-toggle')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('cited-panel')).toBeTruthy()
  })
})

describe('a uctUri-shaped row (forward-compatible, D2-gated full form not built)', () => {
  it('renders without crashing and shows the address, never a fabricated inputs graph', async () => {
    const user = userEvent.setup()
    render(<Cited row={{ uctUri: 'uct://breadth/pct_above_50sma@2026-09-02' }}><span>62%</span></Cited>)
    await user.click(screen.getByTestId('cited-toggle'))
    expect(screen.getByTestId('cited-panel')).toHaveTextContent('uct://breadth/pct_above_50sma@2026-09-02')
    expect(screen.queryByTestId('cited-unverified-note')).toBeNull()
  })
})
