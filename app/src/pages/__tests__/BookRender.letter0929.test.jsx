// Owner rulings 2026-09-29 for "THE FULL BOOK" letter panel (/r/book):
//   (a) no UCT score badge (no internal scores in the letter); the setup pill
//       stays; the footer no longer advertises a score;
//   (b) a row with no entry/stop/targets reads "No trigger today" (rank kept),
//       not "E — S — T1 — T2 —".
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BookRender from '../BookRender'

const ROWS = [
  { rank: 1, sym: 'NVDA', theme: 'AI Semis', setup: 'VCP', entry: 182.5, stop: 171.2, t1: 195, t2: 210 },
  { rank: 2, sym: 'PLTR', theme: 'AI Software', setup: 'Flag', entry: null, stop: null, t1: null, t2: null },
]

function mockBook(rows, extra = {}) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ date: '2026-09-29', part: 1, rows, ...extra }),
  })))
}

const renderBook = () => render(
  <MemoryRouter initialEntries={['/r/book?part=1&w=728']}><BookRender /></MemoryRouter>)

beforeEach(() => mockBook(ROWS))
afterEach(() => vi.unstubAllGlobals())

describe('BookRender — 2026-09-29 rulings', () => {
  it('shows no score even when an OLD payload still carries one; keeps the setup pill', async () => {
    mockBook(ROWS.map((r) => ({ ...r, score: 87.5 })))
    renderBook()
    await screen.findByText('NVDA')
    expect(screen.queryByText('87.5')).not.toBeInTheDocument()
    expect(screen.getByText('VCP')).toBeInTheDocument()
    expect(screen.getByText('Flag')).toBeInTheDocument()
  })

  it('footer no longer mentions a UCT score', async () => {
    renderBook()
    await screen.findByText('NVDA')
    expect(document.body.textContent).not.toMatch(/UCT score/i)
    expect(screen.getByText(/Leadership 20 · entry \/ stop \/ targets/)).toBeInTheDocument()
  })

  it('a row with no levels reads "No trigger today" and keeps its rank', async () => {
    renderBook()
    await screen.findByText('PLTR')
    const rows = screen.getAllByTestId('book-row')
    const pltr = rows.find((r) => r.textContent.includes('PLTR'))
    expect(pltr).toHaveTextContent('No trigger today')
    expect(pltr.textContent).toMatch(/^2/)
    expect(pltr.textContent).not.toMatch(/T1/)
  })

  it('CONTROL: a row with levels still shows E / S / T1 / T2', async () => {
    renderBook()
    await screen.findByText('NVDA')
    const nvda = screen.getAllByTestId('book-row').find((r) => r.textContent.includes('NVDA'))
    expect(nvda).not.toHaveTextContent('No trigger today')
    expect(nvda.textContent).toContain('E 182.50')
    expect(nvda.textContent).toContain('S 171.20')
    expect(nvda.textContent).toContain('T1 195')
    expect(nvda.textContent).toContain('T2 210')
  })

  it('a row with only SOME levels is not a no-trigger row', async () => {
    mockBook([{ rank: 3, sym: 'AMD', theme: 'Semis', setup: 'Base', entry: 160, stop: null, t1: null, t2: null }])
    renderBook()
    await waitFor(() => expect(screen.getByText('AMD')).toBeInTheDocument())
    expect(screen.queryByTestId('no-trigger')).not.toBeInTheDocument()
  })
})
