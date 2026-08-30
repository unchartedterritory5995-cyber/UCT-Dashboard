import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import HeatRibbonView from './HeatRibbonView'
import { ALL_METRICS_HIDDEN } from './breadthViewShared'

const mk = (key, tierFn) => ({ key, label: key, group: 'G', polarity: 'bull',
                               getFmt: r => String(r[key]), getTier: tierFn })
// Tier flips at row 3 — the fixture can tell a correctly-wired ribbon from a
// constant one, which a single-tier fixture could not.
const metrics = [mk('a', r => (r.a >= 50 ? 'g3' : 'r3'))]

// 🔴 THE FIXTURE USED TO RUN BACKWARDS. It built dates ASCENDING while the
// contract every caller honours (`BreadthViews.jsx` hands lenses a newest-first
// window) is newest-first — so "oldest at the left" asserted `2026-08-05`, the
// newest date in the fixture. The view was right and the test read as though it
// were not. Newest first, as shipped: rows[0] is 2026-08-05 at a=70.
const rows = [70, 60, 55, 20, 10].map((a, i) => ({ date: `2026-08-0${5 - i}`, a }))

describe('HeatRibbonView', () => {
  it('the fixture is newest-first, like the window the container passes', () => {
    // A control on the fixture itself: the assertions below only mean what they
    // say while this holds.
    expect(rows[0].date > rows[rows.length - 1].date).toBe(true)
  })

  it('draws one cell per session, oldest at the left', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = container.querySelectorAll('[data-testid^="ribbon-cell-a-"]')
    expect(cells.length).toBe(5)
    expect(cells[0].getAttribute('title')).toContain('2026-08-01')          // oldest first
    expect(cells[cells.length - 1].getAttribute('title')).toContain('2026-08-05')  // newest last
  })

  it('colors each cell from that session own tier, not today tier', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = [...container.querySelectorAll('[data-testid^="ribbon-cell-a-"]')]
    const bg = el => el.style.background.replace(/\s/g, '')
    // ocean g3 = #0891b2, ocean r3 = #e11d48
    expect(bg(cells[cells.length - 1])).toMatch(/#0891b2|rgb\(8,145,178\)/i)  // newest, a=70
    expect(bg(cells[0])).toMatch(/#e11d48|rgb\(225,29,72\)/i)                 // oldest, a=10
  })

  it('states the basis it actually read', () => {
    const { getByTestId } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByTestId('ribbon-basis').textContent).toMatch(/5 sessions · since 2026-08-01/)
  })

  // 🔴 EVERY METRIC UNCHECKED USED TO RENDER `null`: a blank panel with nothing
  // to read, which looks exactly like a broken view.
  it('explains an empty board instead of going blank', () => {
    const { getByTestId, container } = render(<HeatRibbonView rows={rows} rowIdx={0}
      currentRow={rows[0]} metrics={[]} onDrill={() => {}} options={{}} />)
    expect(container.innerHTML).not.toBe('')
    expect(getByTestId('ribbon-refusal').textContent).toBe(ALL_METRICS_HIDDEN)
    expect(getByTestId('ribbon-refusal').textContent).toMatch(/customize/i)
  })
})
