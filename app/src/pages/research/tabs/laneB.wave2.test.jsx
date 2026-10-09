// Audit 2026-10-08, lane B wave 2: loading lines a screen reader is told about (FEED, HIS point 26)
// and insider rows that are only red when they are a sale (OWN point 22).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import FilingsFeedTab from './FilingsFeedTab'
import { sideClass } from './OwnershipTab'
import styles from '../ResearchPage.module.css'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetModules() })

describe('loading lines are announced', () => {
  it('FEED: "Loading filings…" is a status', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FilingsFeedTab sym="AAPL" /></SWRConfig>)
    const el = screen.getByTestId('feed-loading')
    expect(el.getAttribute('role')).toBe('status')
    expect(el.textContent).toBe('Loading filings…')
  })

  it('HIS: "Loading history…" is a status', async () => {
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => ({ data: undefined, isLoading: true }) }))
    const { default: HistoryTab } = await import('./HistoryTab')
    render(<HistoryTab sym="NVDA" />)
    expect(screen.getByRole('status').textContent).toBe('Loading history…')
  })
})

describe('OWN insider side colour', () => {
  it('only a buy is green and only a sale is red; an exercise or a gift is plain', () => {
    expect(sideClass('buy')).toBe(styles.up)
    expect(sideClass('Sell')).toBe(styles.down)
    expect(sideClass('option exercise')).toBe('')
    expect(sideClass('gift')).toBe('')
    expect(sideClass(null)).toBe('')
  })
})
