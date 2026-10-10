// TERM-043: a statement figure links to the SEC filing it appears in, ONLY when the server
// sent `source_links` for that cell (figure_sources.py, dark flag). No links = the table is
// exactly what it was.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import StatementTables from './StatementTables'
import { buildTable } from './depthFormat'

const URL0 = 'https://www.sec.gov/Archives/edgar/data/1045810/000104581025000001/0001045810-25-000001-index.htm'
const BASE = {
  sym: 'NVDA', period: 'quarter', periods: ['Q1 2026', 'Q2 2026'], dates: ['2025-04-27', '2025-07-27'],
  currency: 'USD', series: { revenue: [4.4e10, 4.67e10], net_income: [1.88e10, 2.6e10] },
}

let payload
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })))
})
afterEach(() => { vi.unstubAllGlobals() })

const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <StatementTables sym="NVDA" />
  </SWRConfig>,
)

describe('figure-to-source links', () => {
  it('buildTable carries links newest first, aligned with the cells', () => {
    const t = buildTable({ ...BASE, source_links: { revenue: [URL0, null] } }, 'income')
    const rev = t.rows.find((r) => r.key === 'revenue')
    expect(rev.links).toEqual([null, URL0])
    expect(t.rows.find((r) => r.key === 'net_income').links).toBeUndefined()
  })

  it('without source_links no row has links', () => {
    expect(buildTable(BASE, 'income').rows.every((r) => r.links === undefined)).toBe(true)
  })

  it('renders a linked cell and the note when the server sent a link', async () => {
    payload = { ...BASE, source_links: { revenue: [URL0, null] } }
    mount()
    const a = await screen.findByTestId('figure-source-link')
    expect(a.getAttribute('href')).toBe(URL0)
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(screen.getAllByTestId('figure-source-link')).toHaveLength(1)
    expect(screen.getByTestId('figure-source-note').textContent).not.toMatch(/—/)
    const row = document.querySelector('tr[data-row="revenue"]')
    expect(within(row).getByTestId('figure-source-link')).toBe(a)
  })

  it('renders no link and no note when the payload has none', async () => {
    payload = BASE
    mount()
    await screen.findByTestId('statement-tables')
    await screen.findByText('Revenue')
    expect(screen.queryByTestId('figure-source-link')).toBeNull()
    expect(screen.queryByTestId('figure-source-note')).toBeNull()
  })
})
