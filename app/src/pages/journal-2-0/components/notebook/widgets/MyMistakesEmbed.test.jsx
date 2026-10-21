// My recurring mistakes (Task 13): humanised tags, money cost, a trend in words plus an arrow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MyMistakesEmbed, { humanizeMistake } from './MyMistakesEmbed'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'

const PAYLOAD = {
  asOf: '2026-10-17T21:00:00Z',
  source: 'manual',
  rows: [
    { mistake: 'early_exit', cost30d: -1240.5, countNow: 5, countPrior: 3, trend: 'more' },
    { mistake: 'FOMO', cost30d: -300, countNow: 1, countPrior: 4, trend: 'less' },
    { mistake: 'late_entry', cost30d: null, countNow: 2, countPrior: 2, trend: 'same' },
  ],
}
const attrsOf = (p = PAYLOAD) => widgetEmbedNode('myMistakes', p).attrs

let fetchSpy
beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('MyMistakesEmbed', () => {
  it('humanizes raw tags', () => {
    expect(humanizeMistake('early_exit')).toBe('Early exit')
    expect(humanizeMistake('FOMO')).toBe('FOMO')
    expect(humanizeMistake('')).toBe('Unnamed mistake')
  })

  it('renders rows from params with money cost and a text trend, no fetch', () => {
    const { container } = render(<MyMistakesEmbed attrs={attrsOf()} />)
    expect(screen.getByText('Early exit')).toBeInTheDocument()
    expect(screen.queryByText('early_exit')).toBeNull()
    expect(screen.getByText('-$1,240.50')).toBeInTheDocument()
    expect(screen.getByText('More often')).toBeInTheDocument()
    expect(screen.getByText('Less often')).toBeInTheDocument()
    expect(screen.getByText('Same')).toBeInTheDocument()
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3)
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a null cost is n/a with a reason in its title, never $0', () => {
    render(<MyMistakesEmbed attrs={attrsOf()} />)
    expect(screen.getByText('n/a').getAttribute('title')).toMatch(/\w/)
    expect(document.body.textContent).not.toMatch(/\$0(\.00)?\b/)
  })

  it('an empty payload shows the empty sentence', () => {
    render(<MyMistakesEmbed attrs={attrsOf({ asOf: PAYLOAD.asOf, source: 'manual', rows: [], empty: 'No tagged mistakes yet.' })} />)
    expect(screen.getByText('No tagged mistakes yet.')).toBeInTheDocument()
  })
})
