// UCT News — the "Original release" / "SEC filing" link on a headline row.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Row } from './TradeExchangeNewsParts'

const GNW = 'https://www.globenewswire.com/news-release/2026/10/29/3176543/0/en/Acme-Corp-Reports-Results.html'
const base = { seq: 7, id: '01TEST', source: 'TX-PressRelease', content: 'ACME - Acme Corp Reports Results',
  received_at_ms: Date.UTC(2026, 9, 29, 20, 5), category: 'Earnings', tickers: ['ACME'], mentions: [] }

const row = (item, props = {}) => render(<Row item={item} showCategory onSym={vi.fn()} {...props} />)

describe('release link on a row', () => {
  it('shows "Original release" opening safely in a new tab', () => {
    row({ ...base, link: { kind: 'original_release', url: GNW, publisher: 'GlobeNewswire' } })
    const a = screen.getByRole('link', { name: /original release/i })
    expect(a.getAttribute('href')).toBe(GNW)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.getAttribute('rel')).toContain('noreferrer')
    expect(a.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('shows "SEC filing" for an EDGAR document', () => {
    row({ ...base, link: { kind: 'sec_filing', url: 'https://www.sec.gov/Archives/edgar/data/1/2/ex99.htm', publisher: 'SEC EDGAR' } })
    expect(screen.getByRole('link', { name: /sec filing/i })).toBeTruthy()
  })

  it('shows nothing without a verified link, or with an unsafe one', () => {
    const { unmount } = row(base)
    expect(screen.queryByRole('link', { name: /original release|sec filing/i })).toBeNull()
    unmount()
    row({ ...base, link: { kind: 'original_release', url: 'javascript:alert(1)' } })
    expect(screen.queryByRole('link', { name: /original release/i })).toBeNull()
  })

  it('a click on the link never reaches the row (no chart link, no selection)', () => {
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <Row item={{ ...base, link: { kind: 'original_release', url: GNW, publisher: 'GlobeNewswire' } }} showCategory onSym={vi.fn()} />
      </div>,
    )
    fireEvent.click(screen.getByRole('link', { name: /original release/i }))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
