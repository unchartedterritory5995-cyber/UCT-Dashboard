/* ENTERING A REVIEW FROM A RESULTS PAGE — the contract both surfaces share.
 *
 * ⛔ WHY THIS FILE EXISTS SEPARATELY FROM THE TWO SURFACE TESTS. Scan results
 * and screener results each have a wire test proving the button is MOUNTED with
 * the order that surface shows. Neither can prove the two AGREE about what a
 * review is — which symbols, starting where, entering which shell — because
 * each renders only its own page and would stay green while the other drifted.
 * That agreement is the thing worth pinning, so it is pinned once, here, on the
 * component both mount.
 *
 * ⭐ AND THE HANDOFF IS TESTED AS A PRODUCT BEHAVIOUR, never as a flag. The
 * question every case below asks is "does the review survive the trip to the
 * chart", which is the only reason `pending` exists.
 */
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const navigated = []
vi.mock('react-router-dom', () => ({
  useNavigate: () => (to) => { navigated.push(to) },
}))
// Warming is fire-and-forget and never load-bearing; it must not reach a real
// fetch from a unit test.
const warmed = []
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBars: (syms, tf) => { warmed.push([syms, tf]) },
}))

import ReviewChartsButton, { REVIEW_TF } from './ReviewChartsButton'
import useReviewSession from './useReviewSession'
import { read, STORAGE_KEY, publish, enter, currentSymbol } from './reviewSession'

const SYMS = ['NVDA', 'AMD', 'AVGO', 'MU']

beforeEach(() => {
  sessionStorage.clear()
  navigated.length = 0
  warmed.length = 0
})
afterEach(cleanup)

describe('the entry contract', () => {
  it('⭐ publishes the ordered set, starting at the FIRST symbol shown', () => {
    render(<ReviewChartsButton symbols={SYMS} source="scan" sourceId="sha256:abc" label="Momentum" />)
    fireEvent.click(screen.getByTestId('review-charts'))

    const s = read()
    expect(s.symbols).toEqual(SYMS)
    expect(s.index).toBe(0)
    expect(currentSymbol(s)).toBe('NVDA')
    expect(s.source).toBe('scan')
    expect(s.sourceId).toBe('sha256:abc')
    expect(s.label).toBe('Momentum')
  })

  it('⛔⛔ publishes the CALLER order — it never re-sorts', () => {
    // The whole promise of "next" is that it matches the list just read. A
    // surface handing over a member's own sort must get that sort back.
    const sorted = ['MU', 'NVDA', 'AVGO', 'AMD']
    render(<ReviewChartsButton symbols={sorted} source="screener" />)
    fireEvent.click(screen.getByTestId('review-charts'))
    expect(read().symbols).toEqual(sorted)
    expect(currentSymbol(read())).toBe('MU')
  })

  it('lands on the charts shell, pointed at the symbol the review opens on', () => {
    render(<ReviewChartsButton symbols={SYMS} source="scan" />)
    fireEvent.click(screen.getByTestId('review-charts'))
    expect(navigated).toEqual([`/charts?sym=NVDA&tf=${REVIEW_TF}`])
  })

  it('carries a caller timeframe into the link rather than assuming daily', () => {
    render(<ReviewChartsButton symbols={SYMS} tf="60" />)
    fireEvent.click(screen.getByTestId('review-charts'))
    expect(navigated).toEqual(['/charts?sym=NVDA&tf=60'])
  })

  it('⛔ ZERO SYMBOLS DISABLES IT — it publishes nothing and goes nowhere', () => {
    render(<ReviewChartsButton symbols={[]} source="scan" />)
    const btn = screen.getByTestId('review-charts')
    expect(btn).toBeDisabled()
    // Says WHY, rather than presenting a dead control.
    expect(btn.getAttribute('aria-label')).toMatch(/no symbols/i)
    fireEvent.click(btn)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(navigated).toEqual([])
  })

  it('CONTROL: the same component WITH symbols is enabled and counts them', () => {
    // Without this the disabled case above could pass against a button that is
    // disabled always — which is exactly how a shipped review door does nothing.
    render(<ReviewChartsButton symbols={SYMS} />)
    const btn = screen.getByTestId('review-charts')
    expect(btn).not.toBeDisabled()
    expect(btn.getAttribute('aria-label')).toContain('(4)')
  })

  it('⛔ a duplicated symbol is reviewed ONCE, at its first position', () => {
    render(<ReviewChartsButton symbols={['NVDA', 'AMD', 'NVDA']} />)
    fireEvent.click(screen.getByTestId('review-charts'))
    expect(read().symbols).toEqual(['NVDA', 'AMD'])
  })
})

/* ─── THE HANDOFF ──────────────────────────────────────────────────────────
 *
 * A probe standing in for the chart shell: it holds the symbol the chart is
 * showing, exactly as the shell's color group does, and reports what the hook
 * makes of the session.
 */
function ChartProbe({ initial }) {
  const [sym, setSym] = useState(initial)
  const review = useReviewSession(sym, { tf: 'D' })
  return (
    <div>
      <span data-testid="pos">{review.position.label || 'none'}</span>
      <span data-testid="has-session">{review.session ? 'yes' : 'no'}</span>
      <button type="button" data-testid="to-nvda" onClick={() => setSym('NVDA')}>x</button>
    </div>
  )
}

describe('the handoff to the chart shell', () => {
  it('⛔⛔ the shell OWN symbol arriving first does NOT destroy the review', () => {
    // THE FAILURE THIS PREVENTS, and it is deterministic without the flag: the
    // workspace hydrates its saved ticker before it applies the incoming link,
    // so the first symbol the hook sees is a stranger — and the EXIT rule,
    // correctly, reads a stranger as "the review is over".
    publish(enter({ source: 'scan', symbols: SYMS, symbol: 'NVDA', pending: true }))
    render(<ChartProbe initial="TSLA" />)
    expect(read()).not.toBeNull()
    expect(read().symbols).toEqual(SYMS)
  })

  it('⛔ and reports NOTHING while it waits — no "1 / 4" beside a stranger', () => {
    publish(enter({ source: 'scan', symbols: SYMS, symbol: 'NVDA', pending: true }))
    render(<ChartProbe initial="TSLA" />)
    expect(screen.getByTestId('has-session')).toHaveTextContent('no')
    expect(screen.getByTestId('pos')).toHaveTextContent('none')
  })

  it('⭐ the session own symbol arriving IS the adoption, and the review appears', () => {
    publish(enter({ source: 'scan', symbols: SYMS, symbol: 'NVDA', pending: true }))
    render(<ChartProbe initial="TSLA" />)
    act(() => { fireEvent.click(screen.getByTestId('to-nvda')) })
    expect(screen.getByTestId('pos')).toHaveTextContent('1 / 4')
    expect(read().pending).toBe(false)
  })

  it('⛔ ONCE ADOPTED, EXIT WORKS AGAIN — the flag buys one handoff, not immunity', () => {
    // The danger of a wait state is that it becomes permanent and the review
    // starts surviving things it should not. It must not outlive its own entry.
    publish(enter({ source: 'scan', symbols: SYMS, symbol: 'NVDA', pending: true }))
    const { unmount } = render(<ChartProbe initial="NVDA" />)
    expect(read().pending).toBe(false)
    unmount()
    render(<ChartProbe initial="TSLA" />)
    expect(read()).toBeNull()
  })

  it('CONTROL: a SAME-PAGE entry is adopted from the start (the watchlist door)', () => {
    // The watchlist sets the symbol in the same gesture that enters, so it never
    // needs the handoff — and must not accidentally acquire the wait state.
    const s = enter({ source: 'watchlist', symbols: SYMS, symbol: 'AMD' })
    expect(s.pending).toBe(false)
    publish(s)
    render(<ChartProbe initial="TSLA" />)
    expect(read()).toBeNull()
  })

  it('⭐ warming runs DURING the handoff — the navigation is the dead time it was built for', () => {
    publish(enter({ source: 'scan', symbols: SYMS, symbol: 'NVDA', pending: true }))
    render(<ChartProbe initial="TSLA" />)
    expect(warmed.length).toBeGreaterThan(0)
    expect(warmed[0][0]).toEqual(['AMD', 'AVGO'])
  })
})
