import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { whenLabel } from './NewsSection'

let payload = {
  sym: 'AAPL',
  items: [
    { kind: 'news', title: 'Apple tests CXMT memory chips', publisher: 'Reuters',
      url: 'https://example.com/a', published: '2026-08-09 18:00:00',
      summary: 'Apple is evaluating…' },
    { kind: 'release', title: 'Apple announces dividend', publisher: 'Business Wire',
      url: 'https://example.com/b', published: '2026-08-08 12:00:00', summary: '' },
  ],
}
vi.mock('swr', () => ({ default: (key) => ({ data: key ? payload : null }) }))
import NewsSection from './NewsSection'

const NOW = Date.parse('2026-08-09T20:00:00')

describe('whenLabel', () => {
  it('normalises FMP’s space-separated timestamp before parsing', () => {
    // "2026-08-09 18:00:00" is not valid ISO; Safari returns NaN for it, so a
    // naive new Date(iso) shows every headline as blank on that browser.
    expect(whenLabel('2026-08-09 18:00:00', NOW)).toBe('2h ago')
  })

  it('scales minutes → hours → days → a date', () => {
    expect(whenLabel('2026-08-09 19:30:00', NOW)).toBe('30m ago')
    expect(whenLabel('2026-08-07 20:00:00', NOW)).toBe('2d ago')
    expect(whenLabel('2026-06-01 12:00:00', NOW)).toMatch(/Jun/)
  })

  it('returns empty for junk rather than "Invalid Date"', () => {
    expect(whenLabel(null)).toBe('')
    expect(whenLabel('not a date')).toBe('')
    expect(whenLabel('')).toBe('')
  })
})

describe('NewsSection', () => {
  it('renders headlines with publisher and age', () => {
    render(<NewsSection sym="AAPL" />)
    expect(screen.getByText(/CXMT memory chips/)).toBeTruthy()
    expect(document.body.textContent).toContain('Reuters')
  })

  it('distinguishes a company PRESS RELEASE from independent reporting', () => {
    // A company statement presented as news is the one labelling error that
    // actually misleads a reader.
    render(<NewsSection sym="AAPL" />)
    expect(screen.getByText('PR')).toBeTruthy()
    expect(screen.getByText('NEWS')).toBeTruthy()
  })

  it('opens third-party links without handing them this window', () => {
    render(<NewsSection sym="AAPL" />)
    const a = screen.getByText(/CXMT memory chips/).closest('a')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  })

  it('says there is no news rather than rendering an empty list', () => {
    const prev = payload
    payload = { sym: 'X', items: [] }
    render(<NewsSection sym="X" />)
    expect(document.body.textContent).toMatch(/No recent news/i)
    payload = prev
  })
})
