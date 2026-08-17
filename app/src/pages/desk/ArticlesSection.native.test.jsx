import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'

vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title, open }) => (open ? <div>{title}{children}</div> : null),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'pro-user' } }) }))

// One SWR stub keyed by URL — the section fetches the list, the search box
// fetches results, and the two must be told apart or the test proves nothing.
let listData = null
let searchData = null
vi.mock('swr', () => ({
  default: (key) => {
    if (key && String(key).includes('/search')) {
      return { data: searchData, isLoading: false, mutate: vi.fn() }
    }
    return { data: listData, isLoading: false, mutate: vi.fn() }
  },
}))

import ArticlesSection from './ArticlesSection'

const NATIVE = {
  id: 'https://sub.test/p/sunday-scans-da5',
  slug: 'sunday-scans-da5',
  title: 'SUNDAY SCANS',
  display_title: 'Sunday Scans — August 16, 2026',
  url: 'https://sub.test/p/sunday-scans-da5',
  author: 'Uncharted Territory',
  publication_name: 'Uncharted Territory',
  published_at: 1786902774,
  has_body: 1, reading_minutes: 18, image_count: 62,
  tickers_json: JSON.stringify(['INTC', 'ALAB', 'ARM']),
}

const LINK_OUT = {
  id: 'https://sub.test/p/older',
  slug: null,
  title: 'The Rest of the Week',
  display_title: 'The Rest of the Week — March 31, 2026',
  url: 'https://sub.test/p/older',
  published_at: 1774000000,
  has_body: 0,
}

const renderSection = () =>
  render(<MemoryRouter><ArticlesSection /></MemoryRouter>)

beforeEach(() => {
  listData = { articles: [NATIVE, LINK_OUT] }
  searchData = null
})

test('an article we hold in full opens IN the app, not on Substack', () => {
  renderSection()
  const card = screen.getByText('Sunday Scans — August 16, 2026').closest('a')
  expect(card.getAttribute('href')).toBe('/desk/article/sunday-scans-da5')
  expect(card.getAttribute('target')).toBeNull()
})

test('an article we do NOT hold still links out rather than opening an empty page', () => {
  renderSection()
  const card = screen.getByText('The Rest of the Week — March 31, 2026').closest('a')
  expect(card.getAttribute('href')).toBe('https://sub.test/p/older')
  expect(card.getAttribute('target')).toBe('_blank')
  expect(card.getAttribute('rel')).toContain('noopener')
})

test('the date-stamped title is what renders — every post is titled SUNDAY SCANS at the source', () => {
  renderSection()
  expect(screen.getByText('Sunday Scans — August 16, 2026')).toBeTruthy()
  expect(screen.queryByText('SUNDAY SCANS')).toBeNull()
})

test('the byline is not printed twice when the author IS the publication', () => {
  renderSection()
  const card = screen.getByText('Sunday Scans — August 16, 2026').closest('a')
  const occurrences = card.textContent.split('Uncharted Territory').length - 1
  expect(occurrences).toBe(0)
})

test("the week's tickers are what distinguishes one card from the next", () => {
  renderSection()
  const card = screen.getByText('Sunday Scans — August 16, 2026').closest('a')
  for (const sym of ['INTC', 'ALAB', 'ARM']) expect(card.textContent).toContain(sym)
  expect(card.textContent).toContain('18 min read')
  expect(card.textContent).toContain('62 charts')
})

test('typing a query swaps the grid for ranked results with highlighted snippets', async () => {
  searchData = {
    query: 'MU',
    available: true,
    results: [{ ...NATIVE, snippet: 'a comparison of <mark>MU</mark> and ARM' }],
  }
  renderSection()
  fireEvent.change(screen.getByLabelText('Search articles'), { target: { value: 'MU' } })

  await waitFor(() => expect(screen.getByText(/1 article matching/)).toBeTruthy())
  // the link-out card from the full list is gone: results replaced the grid
  expect(screen.queryByText('The Rest of the Week — March 31, 2026')).toBeNull()
  expect(document.querySelector('mark')?.textContent).toBe('MU')
})

test('a search result links INTO the reader — only indexed articles can match at all', async () => {
  searchData = { query: 'MU', available: true, results: [{ ...NATIVE, snippet: 'x <mark>MU</mark> y' }] }
  renderSection()
  fireEvent.change(screen.getByLabelText('Search articles'), { target: { value: 'MU' } })
  await waitFor(() => expect(screen.getByText(/1 article matching/)).toBeTruthy())
  const card = screen.getByText('Sunday Scans — August 16, 2026').closest('a')
  expect(card.getAttribute('href')).toBe('/desk/article/sunday-scans-da5')
})

test('a query with no hits says so instead of showing a stale grid', async () => {
  searchData = { query: 'zzz', available: true, results: [] }
  renderSection()
  fireEvent.change(screen.getByLabelText('Search articles'), { target: { value: 'zzz' } })
  await waitFor(() => expect(screen.getByText(/Nothing in the archive matches/)).toBeTruthy())
  expect(screen.queryByText('Sunday Scans — August 16, 2026')).toBeNull()
})

test('when search is unavailable it says so rather than claiming zero results', async () => {
  searchData = { query: 'MU', available: false, results: [] }
  renderSection()
  fireEvent.change(screen.getByLabelText('Search articles'), { target: { value: 'MU' } })
  await waitFor(() => expect(screen.getByText(/isn’t available right now/)).toBeTruthy())
})

test('clearing the query brings the full archive back', async () => {
  searchData = { query: 'MU', available: true, results: [] }
  renderSection()
  const box = screen.getByLabelText('Search articles')
  fireEvent.change(box, { target: { value: 'MU' } })
  await waitFor(() => expect(screen.getByText(/Nothing in the archive matches/)).toBeTruthy())
  fireEvent.change(box, { target: { value: '' } })
  await waitFor(() => expect(screen.getByText('The Rest of the Week — March 31, 2026')).toBeTruthy())
})
