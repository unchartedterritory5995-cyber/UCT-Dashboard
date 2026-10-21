// My P&L calendar (Task 20, wave 6): a month heat strip whose every day has words, plus best and worst.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MyPnlCalendarEmbed, { monthCells, monthTitle } from './MyPnlCalendarEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-20T14:05:00Z', source: 'manual', month: '2026-10',
  days: [{ day: '2026-10-02', pnl: 4567.89 }, { day: '2026-10-05', pnl: -2345.67 }, { day: '2026-10-06', pnl: null }],
  best: { day: '2026-10-02', pnl: 4567.89 }, worst: { day: '2026-10-05', pnl: -2345.67 },
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('myPnlCalendar', p).attrs

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => vi.unstubAllGlobals())

describe('MyPnlCalendarEmbed', () => {
  it('one cell per calendar day, each with its value in words for a screen reader, no fetch', () => {
    const { container } = render(<MyPnlCalendarEmbed attrs={attrsOf()} />)
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    expect(container.querySelectorAll('li[data-day]')).toHaveLength(31)
    expect(screen.getByText('Oct 2, 2026: +$4,567.89')).toBeInTheDocument()
    expect(screen.getByText('Oct 5, 2026: -$2,345.67')).toBeInTheDocument()
    expect(screen.getByText('Oct 6, 2026: P&L not available')).toBeInTheDocument()
    expect(screen.getByText('Oct 3, 2026: no closed trades')).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('colour is never the only signal: the visible cell carries a +/− mark and a tooltip with the value', () => {
    const { container } = render(<MyPnlCalendarEmbed attrs={attrsOf()} />)
    const up = container.querySelector('li[data-day="2026-10-02"]')
    const dn = container.querySelector('li[data-day="2026-10-05"]')
    expect(up.querySelector('[aria-hidden="true"]').textContent).toBe('2+')
    expect(dn.querySelector('[aria-hidden="true"]').textContent).toBe('5−')
    expect(up.getAttribute('title')).toBe('Oct 2, 2026: +$4,567.89')
  })

  it('names the best and worst day', () => {
    render(<MyPnlCalendarEmbed attrs={attrsOf()} />)
    expect(screen.getByText('Best day').nextSibling.textContent).toBe('+$4,567.89 on Oct 2, 2026')
    expect(screen.getByText('Worst day').nextSibling.textContent).toBe('-$2,345.67 on Oct 5, 2026')
  })

  it('a month with no closed trades shows the server sentence, never a strip of $0s', () => {
    render(<MyPnlCalendarEmbed attrs={attrsOf({
      asOf: PAYLOAD.asOf, source: 'manual', month: '2026-10', days: [], best: null, worst: null,
      empty: 'No closed trades this month yet.',
    })} />)
    expect(screen.getByText('No closed trades this month yet.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$0(\.00)?\b/)
  })

  it('monthCells and monthTitle read only a real month', () => {
    expect(monthCells('2026-02', [])).toHaveLength(28)
    expect(monthCells('2026-13', [])).toEqual([])
    expect(monthTitle('nope')).toBeNull()
  })
})
