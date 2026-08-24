import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'

let mockData = null
vi.mock('swr', () => ({ default: () => ({ data: mockData }) }))

import DeskCoverage from './DeskCoverage'

const ISSUE = (slug, title, at) => ({
  id: `https://sub.test/p/${slug}`, slug,
  display_title: title, published_at: at, reading_minutes: 14,
})

const renderCard = (sym = 'MU') =>
  render(<MemoryRouter><DeskCoverage sym={sym} /></MemoryRouter>)

beforeEach(() => {
  mockData = {
    ticker: 'MU', total: 2,
    articles: [
      ISSUE('sunday-scans-da5', 'Sunday Scans — August 16, 2026', 1786902774),
      ISSUE('sunday-scans-1ad', 'Sunday Scans — August 9, 2026', 1786297974),
    ],
  }
})

test('it answers "what has the desk said about this name?"', () => {
  const { container } = renderCard()
  expect(screen.getByText('MU in Sunday Scans')).toBeTruthy()
  expect(screen.getByText('2 issues')).toBeTruthy()
  expect(container.querySelectorAll('a').length).toBe(2)
})

test('each row opens the article in our reader', () => {
  renderCard()
  const row = screen.getByText('Sunday Scans — August 16, 2026').closest('a')
  expect(row.getAttribute('href')).toBe('/desk/article/sunday-scans-da5')
})

test('a symbol the letter has never mentioned renders NOTHING, not an empty box', () => {
  mockData = { ticker: 'TSLA', total: 0, articles: [] }
  const { container } = renderCard('TSLA')
  expect(container.firstChild).toBeNull()
})

test('a reader without archive access sees nothing rather than a broken card', () => {
  mockData = null   // the fetcher yields null on 401/402
  const { container } = renderCard()
  expect(container.firstChild).toBeNull()
})

test('one issue is not pluralised', () => {
  mockData = { ticker: 'MU', total: 1, articles: [mockData.articles[0]] }
  renderCard()
  expect(screen.getByText('1 issue')).toBeTruthy()
})

test('when coverage exceeds the list it links onward WITHOUT promising a count', () => {
  // ⛔ The badge counts issues that CHARTED the symbol; the destination is a
  // full-text search that also finds it mentioned in prose. Measured on the
  // real archive: badge 17, search 30. Naming one and delivering the other is
  // how a link starts lying.
  mockData = { ...mockData, total: 43 }
  renderCard()
  const more = screen.getByText(/Search the archive for MU/)
  expect(more.closest('a').getAttribute('href')).toBe('/desk?section=articles&q=MU')
  expect(more.textContent).not.toMatch(/\b43\b/)
})

test('no onward link when the list already shows everything', () => {
  // Matches the copy the component ACTUALLY renders — a stale probe for text
  // that exists nowhere would pass no matter what the component did.
  renderCard()
  expect(screen.queryByText(/Search the archive for/)).toBeNull()
  expect(screen.getAllByRole('link').length).toBe(2)   // the two issue rows only
})
