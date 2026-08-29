import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import HeatRibbonView from './HeatRibbonView'

const mk = (key, tierFn) => ({ key, label: key, group: 'G', polarity: 'bull',
                               getFmt: r => String(r[key]), getTier: tierFn })
// Tier flips at row 3 — the fixture can tell a correctly-wired ribbon from a
// constant one, which a single-tier fixture could not.
const metrics = [mk('a', r => (r.a >= 50 ? 'g3' : 'r3'))]
const rows = [70, 60, 55, 20, 10].map((a, i) => ({ date: `2026-08-0${i + 1}`, a }))

describe('HeatRibbonView', () => {
  it('draws one cell per session, oldest at the left', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = container.querySelectorAll('[data-testid^="ribbon-a-"]')
    expect(cells.length).toBe(5)
    expect(cells[0].getAttribute('title')).toContain('2026-08-05')  // oldest first
  })

  it('colors each cell from that session own tier, not today tier', () => {
    const { container } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{ palette: 'ocean' }} />)
    const cells = [...container.querySelectorAll('[data-testid^="ribbon-a-"]')]
    const bg = el => el.style.background.replace(/\s/g, '')
    // ocean g3 = #0891b2, ocean r3 = #e11d48
    expect(bg(cells[cells.length - 1])).toMatch(/#0891b2|rgb\(8,145,178\)/i)  // newest, a=70
    expect(bg(cells[0])).toMatch(/#e11d48|rgb\(225,29,72\)/i)                 // oldest, a=10
  })

  it('states the basis it actually read', () => {
    const { getByText } = render(<HeatRibbonView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByText(/5 sessions · since 2026-08-05/)).toBeTruthy()
  })
})
