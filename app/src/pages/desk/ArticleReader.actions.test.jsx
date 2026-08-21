// The issue-level actions row (the nickschmidt.so trio): copy the whole
// ticker roster, save it as a watchlist in one click, download a print-styled
// PDF. Plus the print-only masthead/roster the PDF path depends on.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

let mockData = null
vi.mock('swr', () => ({
  default: (key) => (String(key || '').includes('/articles/anchors/')
    ? { data: { anchors: {} }, error: null, isLoading: false }
    : { data: mockData, error: null, isLoading: false }),
}))

vi.mock('../../components/TickerPopup', () => ({ default: () => null }))
vi.mock('../../hooks/useLivePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, error: null, refresh: () => {} }),
}))
vi.mock('../../utils/prefetchBars', () => ({ prefetchBar: vi.fn() }))
vi.mock('../../components/TickerActions', async () => {
  const actual = await vi.importActual('../../components/TickerActions')
  return { ...actual, default: () => null }
})
vi.mock('../../hooks/useUserTickerSet', () => ({ default: () => new Set() }))
vi.mock('../../hooks/useReadAloudFollow', () => ({ default: () => {} }))
vi.mock('../../components/voice/ReadAloudButton', () => ({
  default: ({ children }) => <button type="button">{children || 'Listen'}</button>,
}))

import ArticleReader from './ArticleReader'

const TICKERS = ['INTC', 'ALAB', 'ARM', 'DELL', 'HPE', 'MU', 'MRVL', 'AMD',
                 'NBIS', 'TER', 'RBRK', 'SNOW', 'PLTR', 'FSLY']

const ARTICLE = {
  id: 'https://sub.test/p/sunday-scans-da5',
  slug: 'sunday-scans-da5',
  title: 'Sunday Scans — August 16, 2026',
  url: 'https://sub.test/p/sunday-scans-da5',
  publication_name: 'Uncharted Territory',
  published_at: 1786902774,
  reading_minutes: 18,
  image_count: 62,
  sections: [],
  tickers: TICKERS,
  body_html: '<p>The week in charts.</p>',
}

const renderReader = () => render(
  <MemoryRouter initialEntries={['/desk/article/sunday-scans-da5']}>
    <Routes><Route path="/desk/article/:slug" element={<ArticleReader />} /></Routes>
  </MemoryRouter>,
)

let clipboardText
beforeEach(() => {
  vi.useRealTimers()
  navigate.mockClear()
  localStorage.clear()
  mockData = ARTICLE
  clipboardText = null
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn((t) => { clipboardText = t; return Promise.resolve() }) },
  })
  global.fetch = vi.fn()
  window.print = vi.fn()
})

afterEach(() => {
  document.body.classList.remove('uct-print-article')
})

test('Copy symbols writes the WHOLE roster comma-separated (TradingView import format)', async () => {
  renderReader()
  fireEvent.click(screen.getByRole('button', { name: /copy symbols/i }))
  await waitFor(() => expect(clipboardText).toBe(TICKERS.join(',')))
  // No spaces — TradingView's importer takes the bare comma list as-is.
  expect(clipboardText).not.toContain(' ')
  // Feedback flips the label so the click visibly landed.
  await screen.findByRole('button', { name: /copied/i })
})

test('Save as watchlist creates a list named for the issue, then bulk-adds every ticker', async () => {
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/watchlists') {
      return { ok: true, json: async () => ({ id: 'wl-1', name: ARTICLE.title }) }
    }
    return { ok: true, json: async () => ({ added: TICKERS.length }) }
  })
  renderReader()
  fireEvent.click(screen.getByRole('button', { name: /save as watchlist/i }))
  await screen.findByRole('button', { name: /watchlist saved/i })

  const [createCall, bulkCall] = global.fetch.mock.calls
  expect(createCall[0]).toBe('/api/watchlists')
  const createBody = JSON.parse(createCall[1].body)
  expect(createBody.name).toBe('Sunday Scans — August 16, 2026')
  expect(bulkCall[0]).toBe('/api/watchlists/wl-1/items/bulk')
  // EVERY covered name goes in — not just the 12 preview chips.
  expect(JSON.parse(bulkCall[1].body).symbols).toEqual(TICKERS)
})

test('a failed save reports failure and offers retry — never claims "saved"', async () => {
  global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
  renderReader()
  fireEvent.click(screen.getByRole('button', { name: /save as watchlist/i }))
  await screen.findByRole('button', { name: /save failed/i })
  expect(screen.queryByRole('button', { name: /watchlist saved/i })).toBeNull()
})

test('Download PDF scopes the print stylesheet with the body class and prints', async () => {
  renderReader()
  fireEvent.click(screen.getByRole('button', { name: /download pdf/i }))
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
  expect(document.body.classList.contains('uct-print-article')).toBe(true)
  // afterprint removes the class so the on-screen page is untouched.
  window.dispatchEvent(new Event('afterprint'))
  expect(document.body.classList.contains('uct-print-article')).toBe(false)
})

test('Download PDF force-loads lazy chart images BEFORE printing', async () => {
  // The real defect this pins: a loading="lazy" chart never scrolled near
  // prints as an EMPTY frame. The handler must flip every body image to eager
  // and wait for loads before window.print().
  mockData = {
    ...ARTICLE,
    body_html: '<p>x</p><img src="https://cdn.test/c1.png" loading="lazy" class="uctArticleImage">'
      + '<img src="https://cdn.test/c2.png" loading="lazy" class="uctArticleImage">',
  }
  const { container } = renderReader()
  const imgs = Array.from(container.querySelectorAll('article img'))
  expect(imgs).toHaveLength(2)
  // jsdom images report complete=false and never fire load on their own —
  // exactly the "not yet loaded" state. The handler must be WAITING, not
  // printing.
  fireEvent.click(screen.getByRole('button', { name: /download pdf/i }))
  await screen.findByRole('button', { name: /preparing charts/i })
  expect(imgs.every((i) => i.loading === 'eager')).toBe(true)
  expect(window.print).not.toHaveBeenCalled()
  // Both images finish loading → the print fires.
  imgs.forEach((i) => fireEvent.load(i))
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
})

test('the print masthead + FULL roster exist in the DOM for the PDF', () => {
  const { container } = renderReader()
  expect(container.textContent).toContain('UNCHARTED TERRITORY · UCT INTELLIGENCE')
  // The roster names every ticker — including the ones past the 12-chip
  // preview that the screen collapses.
  const roster = container.textContent
  for (const sym of TICKERS) expect(roster).toContain(sym)
  expect(roster).toContain('Charts covered')
})

test('the interactive chrome is marked for print exclusion; the print root wraps the page', () => {
  const { container } = renderReader()
  expect(container.querySelector('[data-print-root]')).not.toBeNull()
  const excluded = container.querySelectorAll('[data-export-exclude]')
  // At minimum: progress bar, back link, actions row, ticker chips row, footer.
  expect(excluded.length).toBeGreaterThanOrEqual(5)
  // The actions row must not print itself into the PDF it produces.
  const actionRow = screen.getByRole('button', { name: /download pdf/i }).parentElement
  expect(actionRow.hasAttribute('data-export-exclude')).toBe(true)
})

test('no roster → no copy/save buttons, PDF still offered', () => {
  mockData = { ...ARTICLE, tickers: [] }
  renderReader()
  expect(screen.queryByRole('button', { name: /copy symbols/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /save as watchlist/i })).toBeNull()
  expect(screen.getByRole('button', { name: /download pdf/i })).toBeTruthy()
})
